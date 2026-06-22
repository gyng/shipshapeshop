import { useEffect } from 'react'
import { create } from 'zustand'
import * as THREE from 'three'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { getGeometry } from './geometry'

// ── The Relic ("Reference Wing") meshes ───────────────────────────────────────────────────────────────────
// Famous computer-graphics reference models. These are REAL downloaded meshes — loaded once, async, then
// shared across EVERY view that renders 3D shapes (gallery thumbnails, the Orrery, the diorama scenes, AND the
// hero). Until a mesh finishes loading (or if it fails), callers transparently fall back to the procedural
// placeholder in geometry.ts. This is the single source of truth for the model registry (the old
// ModelGem.MODEL_FILES lived here, hero-only — now unified so a benchy looks like a benchy everywhere).

// `face` (radians, optional): the model's intrinsic front direction in its canonical XZ frame. When set, the
// orrery orients the relic to point its FRONT along its flux beam (instead of free-spinning) — for models with
// an obvious facing (spot, bunny, …). Omit it for rotationally-symmetric relics (heptoroid, csaszar) → they spin.
// Tune per-model in ±π/2 steps if a model points the wrong way.
export type RelicCfg = { url: string; kind: 'ply' | 'obj'; rot?: [number, number, number]; face?: number }

export const RELIC_MODELS: Record<string, RelicCfg> = {
  stanford_bunny: { url: '/models/bunny.ply', kind: 'ply', rot: [0, Math.PI, 0], face: 0 },
  benchy: { url: '/models/benchy.ply', kind: 'ply', rot: [-Math.PI / 2, 0, 0], face: 0 },
  spot: { url: '/models/spot.obj', kind: 'obj', rot: [0, Math.PI, 0], face: 0 },
  armadillo: { url: '/models/armadillo.ply', kind: 'ply', rot: [0, 0, 0], face: 0 },
  lucy: { url: '/models/lucy.ply', kind: 'ply', rot: [0, 0, 0], face: 0 },
  stanford_dragon: { url: '/models/dragon.ply', kind: 'ply', rot: [0, 0, 0], face: 0 },
  heptoroid: { url: '/models/heptoroid.ply', kind: 'ply', rot: [Math.PI / 2, 0, 0] }, // symmetric → keeps spinning
  csaszar: { url: '/models/csaszar.obj', kind: 'obj', rot: [0, 0, 0] }, // symmetric → keeps spinning
  suzanne: { url: '/models/suzanne.obj', kind: 'obj', rot: [0, 0, 0], face: 0 }, // Blender's monkey (public domain)
}

export const isRelic = (family: string): boolean => family in RELIC_MODELS

// The relic's front offset (radians) if it has an obvious facing, else undefined (→ it free-spins).
export const relicFace = (family: string): number | undefined => RELIC_MODELS[family]?.face

const relicCache = new Map<string, THREE.BufferGeometry>()

// A version counter bumped when relics finish loading; components subscribe via useRelics() so their
// shapeGeometry() calls re-evaluate (placeholder → real mesh) without per-mesh Suspense.
const useRelicStore = create<{ version: number }>(() => ({ version: 0 }))

// Centre, orient, and normalise to a unit bounding sphere — identical treatment to the procedural geometries
// (geometry.ts normalize) so a relic drops into the same canonical frame as every other shape.
function normalize(g: THREE.BufferGeometry, rot?: [number, number, number]) {
  g.center()
  if (rot) {
    g.rotateX(rot[0])
    g.rotateY(rot[1])
    g.rotateZ(rot[2])
  }
  g.center()
  g.computeBoundingSphere()
  const r = g.boundingSphere?.radius || 1
  g.scale(1 / r, 1 / r, 1 / r)
  g.computeVertexNormals()
}

async function loadOne(family: string, cfg: RelicCfg): Promise<void> {
  try {
    let geo: THREE.BufferGeometry
    if (cfg.kind === 'ply') {
      geo = await new PLYLoader().loadAsync(cfg.url)
    } else {
      const grp = await new OBJLoader().loadAsync(cfg.url)
      let found: THREE.BufferGeometry | undefined
      grp.traverse((o) => {
        const m = o as THREE.Mesh
        if (!found && m.isMesh) found = m.geometry
      })
      if (!found) return // empty OBJ → keep the placeholder
      geo = found
    }
    normalize(geo, cfg.rot)
    relicCache.set(family, geo)
    useRelicStore.setState((s) => ({ version: s.version + 1 })) // swap THIS relic in as soon as it's ready
  } catch (e) {
    // a missing/failed mesh simply keeps its procedural placeholder — never blocks rendering
    console.warn(`[relics] failed to load ${family} (${cfg.url})`, e)
  }
}

let started = false
export async function loadRelics(): Promise<void> {
  if (started) return
  started = true
  THREE.Cache.enabled = true // dedupe the fetch if a hero view also triggers a load of the same URL
  // each mesh bumps the version on arrival (loadOne), so a fast bunny appears without waiting for the dragon
  await Promise.all(Object.entries(RELIC_MODELS).map(([fam, cfg]) => loadOne(fam, cfg)))
}

// Real relic mesh if it has finished loading, else the procedural placeholder (geometry.ts). NOT a hook —
// safe to call inside `.map()` render loops (pair with a single useRelics() at the component top).
export function shapeGeometry(family: string): THREE.BufferGeometry {
  return relicCache.get(family) ?? getGeometry(family)
}

// Call once near the top of any component that renders 3D shapes: subscribes it to relic-load completion (so
// its shapeGeometry() calls swap placeholder → real mesh) AND kicks off the one-time async load.
export function useRelics(): number {
  const version = useRelicStore((s) => s.version)
  useEffect(() => {
    void loadRelics()
  }, [])
  return version
}
