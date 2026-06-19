import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { HeroGem } from './Gem'
import type { RarityName } from '../game/store'

type ModelCfg = { url: string; kind: 'ply' | 'obj'; rot?: [number, number, number] }

// Real downloaded meshes — loaded on demand for the HERO view only (gallery thumbnails use the cheap
// placeholders in geometry.ts). Princeton "Suggestive Contours" .ply scans + Keenan Crane's Spot .obj.
export const MODEL_FILES: Record<string, ModelCfg> = {
  stanford_bunny: { url: '/models/bunny.ply', kind: 'ply', rot: [0, Math.PI, 0] },
  cow: { url: '/models/cow.obj', kind: 'obj', rot: [0, Math.PI / 2, 0] },
  spot: { url: '/models/spot.obj', kind: 'obj', rot: [0, Math.PI, 0] },
  armadillo: { url: '/models/armadillo.ply', kind: 'ply', rot: [0, 0, 0] },
  lucy: { url: '/models/lucy.ply', kind: 'ply', rot: [0, 0, 0] },
  stanford_dragon: { url: '/models/dragon.ply', kind: 'ply', rot: [0, 0, 0] },
  heptoroid: { url: '/models/heptoroid.ply', kind: 'ply', rot: [Math.PI / 2, 0, 0] },
  csaszar: { url: '/models/csaszar.obj', kind: 'obj', rot: [0, 0, 0] },
}

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

export function ModelGem({ family, rarity, spin = 0.4 }: { family: string; rarity: RarityName; spin?: number }) {
  const cfg = MODEL_FILES[family]
  const loaded = useLoader(cfg.kind === 'ply' ? PLYLoader : OBJLoader, cfg.url)
  const geom = useMemo(() => {
    let g: THREE.BufferGeometry
    if (cfg.kind === 'ply') {
      g = (loaded as THREE.BufferGeometry).clone()
    } else {
      // OBJ loads as a Group — take the first mesh's geometry.
      let found: THREE.BufferGeometry | null = null
      ;(loaded as THREE.Object3D).traverse((o) => {
        const m = o as THREE.Mesh
        if (!found && m.isMesh) found = m.geometry.clone()
      })
      g = found ?? new THREE.BufferGeometry()
    }
    normalize(g, cfg.rot)
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, family])
  return <HeroGem family={family} rarity={rarity} spin={spin} geom={geom} />
}
