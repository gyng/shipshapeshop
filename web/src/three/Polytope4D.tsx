import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RARITY_COLOR, RARITY_RANK } from './Gem'
import type { RarityName } from '../game/store'

// The regular convex 4-polytopes, rendered as their REAL 4D→3D projection (not the 3D-shadow polyhedron the
// gallery uses): glowing glass tube edges + vertex beads, double-rotating in 4-space. Hero-only (the per-frame
// rotate+project+instance-update is too much for gallery thumbnails, which keep the static polyhedron stand-in).
export const POLYTOPES_4D = new Set<string>(['tesseract', 'cell_16', 'cell_24', 'cell_120', 'cell_600'])

type V4 = [number, number, number, number]
const PHI = (1 + Math.sqrt(5)) / 2

// All 24 permutations of [0,1,2,3] tagged with parity (even = in the alternating group A4).
const PERMS4: { perm: number[]; even: boolean }[] = (() => {
  const out: number[][] = []
  const rec = (arr: number[], acc: number[]) => {
    if (!arr.length) return void out.push(acc)
    for (let i = 0; i < arr.length; i++) rec([...arr.slice(0, i), ...arr.slice(i + 1)], [...acc, arr[i]])
  }
  rec([0, 1, 2, 3], [])
  const parity = (p: number[]) => {
    let inv = 0
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (p[i] > p[j]) inv++
    return inv % 2 === 0
  }
  return out.map((perm) => ({ perm, even: parity(perm) }))
})()

// Expand a value tuple into all (or only even) coordinate permutations × all independent sign flips of the
// nonzero entries, deduped — the standard way 4-polytope vertex sets are specified.
function expand(vals: number[], evenOnly: boolean, out: V4[], seen: Set<string>) {
  for (const { perm, even } of PERMS4) {
    if (evenOnly && !even) continue
    const base = [vals[perm[0]], vals[perm[1]], vals[perm[2]], vals[perm[3]]]
    const nz = [0, 1, 2, 3].filter((i) => Math.abs(base[i]) > 1e-9)
    for (let s = 0; s < 1 << nz.length; s++) {
      const pt = base.slice() as V4
      for (let b = 0; b < nz.length; b++) if (s & (1 << b)) pt[nz[b]] = -pt[nz[b]]
      const key = pt.map((x) => Math.round(x * 1e6)).join(',')
      if (!seen.has(key)) { seen.add(key); out.push(pt) }
    }
  }
}

// Edges = all vertex pairs at the minimum pairwise distance (true for every regular polytope). O(n²), once.
function edgesByMinDist(verts: V4[]): [number, number][] {
  const d2 = (a: V4, b: V4) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2
  let min = Infinity
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) { const d = d2(verts[i], verts[j]); if (d > 1e-9 && d < min) min = d }
  const thresh = min * (1 + 1e-3)
  const edges: [number, number][] = []
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) { const d = d2(verts[i], verts[j]); if (d > 1e-9 && d <= thresh) edges.push([i, j]) }
  return edges
}

// The Cartesian vertex coordinates of each regular 4-polytope (Wikipedia's standard sets), normalised to a
// unit circumradius. tesseract 16v/32e · 16-cell 8v/24e · 24-cell 24v/96e · 600-cell 120v/720e · 120-cell 600v/1200e.
export function build4D(family: string): { verts: V4[]; edges: [number, number][] } {
  const P = PHI, P2 = PHI * PHI, IP = 1 / PHI, IP2 = 1 / (PHI * PHI), R5 = Math.sqrt(5)
  const verts: V4[] = []
  const seen = new Set<string>()
  const add = (vals: number[], even = false) => expand(vals, even, verts, seen)
  switch (family) {
    case 'tesseract': add([1, 1, 1, 1]); break
    case 'cell_16': add([1, 0, 0, 0]); break
    case 'cell_24': add([1, 1, 0, 0]); break
    case 'cell_600':
      add([0.5, 0.5, 0.5, 0.5]); add([1, 0, 0, 0]); add([P / 2, 0.5, IP / 2, 0], true)
      break
    case 'cell_120':
      add([0, 0, 2, 2]); add([1, 1, 1, R5]); add([IP2, P, P, P]); add([IP, IP, IP, P2])
      add([0, IP2, 1, P2], true); add([0, IP, P, R5], true); add([IP, 1, P, 2], true)
      break
  }
  const edges = edgesByMinDist(verts)
  let maxR = 0
  for (const v of verts) maxR = Math.max(maxR, Math.hypot(v[0], v[1], v[2], v[3]))
  if (maxR > 0) for (const v of verts) { v[0] /= maxR; v[1] /= maxR; v[2] /= maxR; v[3] /= maxR }
  return { verts, edges }
}

const cache = new Map<string, { verts: V4[]; edges: [number, number][] }>()
function getPolytope(family: string) {
  let p = cache.get(family)
  if (!p) { p = build4D(family); cache.set(family, p) }
  return p
}

export function Polytope4D({ family, rarity, materialize = false }: { family: string; rarity: RarityName; materialize?: boolean }) {
  const { verts, edges } = useMemo(() => getPolytope(family), [family])
  const col = RARITY_COLOR[rarity]
  const rank = RARITY_RANK[rarity]
  const groupRef = useRef<THREE.Group>(null)
  const formT = useRef(materialize ? 0 : 1)
  const edgeRef = useRef<THREE.InstancedMesh>(null)
  const vertRef = useRef<THREE.InstancedMesh>(null)
  // dense polytopes (120/600-cell) → thinner tubes/beads so the structure doesn't read as a solid blob
  const dense = edges.length > 200
  const tubeR = dense ? 0.012 : 0.026
  const vertR = dense ? 0.03 : 0.055
  // Fill the frame like the hero gems (~1.55). The perspective projection caps the projected radius at ~1.08
  // (unit-circumradius verts, D=2.6), so this lands at ~1.62 world — well inside the Stage's ~1.92 half-height
  // (the ~1.78 clip limit), with room for the rotation's "breathing".
  const FIT_SCALE = 1.5

  // reusable scratch — never allocate in useFrame (per §5 perf rules)
  const scratch = useMemo(() => ({
    dummy: new THREE.Object3D(),
    proj: verts.map(() => new THREE.Vector3()),
    dir: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    q: new THREE.Quaternion(),
  }), [verts])

  useFrame((state, dt) => {
    // materialize: the lattice grows into existence from a point (the tubes "construct" in 4-space)
    if (materialize && formT.current < 1) formT.current = Math.min(1, formT.current + dt / 0.8)
    if (groupRef.current) groupRef.current.scale.setScalar(FIT_SCALE * (1 - Math.pow(1 - formT.current, 3)))
    const t = state.clock.elapsedTime
    // double (independent-plane) rotation: XW and YZ at slightly different rates → the mesmerising 4D churn
    const a = t * 0.17, b = t * 0.11
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b)
    const D = 2.6 // 4D eye distance (> 1 = unit circumradius, so the perspective divide never blows up)
    const { dummy, proj, dir, up, q } = scratch
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]
      const x = v[0] * ca - v[3] * sa, w = v[0] * sa + v[3] * ca // rotate XW
      const y = v[1] * cb - v[2] * sb, z = v[1] * sb + v[2] * cb // rotate YZ
      const k = D / (D - w) // 4D→3D perspective projection
      proj[i].set(x * k, y * k, z * k)
    }
    const em = edgeRef.current
    if (em) {
      for (let e = 0; e < edges.length; e++) {
        const pa = proj[edges[e][0]], pb = proj[edges[e][1]]
        dir.subVectors(pb, pa)
        const len = dir.length()
        dummy.position.copy(pa).addScaledVector(dir, 0.5)
        if (len > 1e-6) { dir.divideScalar(len); q.setFromUnitVectors(up, dir); dummy.quaternion.copy(q) }
        dummy.scale.set(1, len, 1)
        dummy.updateMatrix()
        em.setMatrixAt(e, dummy.matrix)
      }
      em.instanceMatrix.needsUpdate = true
    }
    const vm = vertRef.current
    if (vm) {
      dummy.quaternion.identity()
      dummy.scale.set(1, 1, 1)
      for (let i = 0; i < verts.length; i++) {
        dummy.position.copy(proj[i])
        dummy.updateMatrix()
        vm.setMatrixAt(i, dummy.matrix)
      }
      vm.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group ref={groupRef} scale={materialize ? 0 : FIT_SCALE}>
      {/* glowing glass tube edges — HDR emissive so bloom halos them */}
      <instancedMesh ref={edgeRef} args={[undefined, undefined, edges.length]} frustumCulled={false}>
        <cylinderGeometry args={[tubeR, tubeR, 1, 8]} />
        <meshPhysicalMaterial color={col} emissive={col} emissiveIntensity={1.3 + rank * 0.3} roughness={0.18} metalness={0.1} clearcoat={1} clearcoatRoughness={0.15} envMapIntensity={1.5} />
      </instancedMesh>
      {/* vertex beads — brighter, near-white core so they pop as the "nodes" of the lattice */}
      <instancedMesh ref={vertRef} args={[undefined, undefined, verts.length]} frustumCulled={false}>
        <sphereGeometry args={[vertR, 12, 12]} />
        <meshPhysicalMaterial color="#ffffff" emissive={col} emissiveIntensity={2.0 + rank * 0.4} roughness={0.2} metalness={0.1} clearcoat={1} />
      </instancedMesh>
    </group>
  )
}
