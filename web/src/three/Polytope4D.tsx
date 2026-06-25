import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RARITY_RANK } from './Gem'
import { useGame, type RarityName } from '../game/store'
import { gemColorById, SLOT_GEM_COLOR } from '../content/cosmetics'

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

// Manual 4D-rotation + projection controls (the Shape Viewer drives these; the game/inspector leaves it undefined
// → the original auto-tumble). `angles` are the 6 rotation-plane angles [XY, XZ, XW, YZ, YW, ZW] in radians;
// `spin` auto-tumbles (XW+YZ, the original churn) ignoring `angles`; `dist` is the 4D eye distance (lower = more
// dramatic stereographic-like foreshortening, higher = flatter).
export type Poly4DControls = { angles: [number, number, number, number, number, number]; spin: boolean; dist: number }
const POLY4D_VEL = [0, 0, 0.17, 0.11, 0, 0] // default auto-tumble velocities: XW 0.17 + YZ 0.11 (the original mesmerising 4-space churn)
export const POLY4D_DEFAULT: Poly4DControls = { angles: [0, 0, 0, 0, 0, 0], spin: true, dist: 2.6 }

export function Polytope4D({ family, rarity, materialize = false, poly4d, previewGemColor }: { family: string; rarity: RarityName; materialize?: boolean; poly4d?: Poly4DControls; previewGemColor?: number }) {
  const { verts, edges } = useMemo(() => getPolytope(family), [family])
  // edge/bead glow = the equipped/previewed Gem Colour (Clear → a soft ice-blue lattice). Rarity → Stage motes.
  const equippedGemColor = useGame((s) => s.view?.equipped?.[SLOT_GEM_COLOR] ?? 0)
  const col = gemColorById(previewGemColor ?? equippedGemColor).color ?? '#cfe0ff'
  const rank = RARITY_RANK[rarity]
  const groupRef = useRef<THREE.Group>(null)
  const formT = useRef(materialize ? 0 : 1)
  const live = useRef<[number, number, number, number, number, number]>([0, 0, 0, 0, 0, 0]) // accumulated 4D angles (auto-tumble integrates here; manual mode copies the slider angles in)
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

  useFrame((_state, dt) => {
    // materialize: the lattice grows into existence from a point (the tubes "construct" in 4-space)
    if (materialize && formT.current < 1) formT.current = Math.min(1, formT.current + dt / 0.8)
    if (groupRef.current) groupRef.current.scale.setScalar(FIT_SCALE * (1 - Math.pow(1 - formT.current, 3)))
    const { angles, spin, dist } = poly4d ?? POLY4D_DEFAULT
    // accumulate the 6 rotation-plane angles: auto-tumble integrates the default churn velocities (XW+YZ); manual
    // mode (spin off) snaps to the slider angles so all six planes [XY, XZ, XW, YZ, YW, ZW] can be posed freely.
    const A = live.current
    if (spin) { for (let i = 0; i < 6; i++) A[i] += POLY4D_VEL[i] * (dt || 0.016) }
    else { for (let i = 0; i < 6; i++) A[i] = angles[i] }
    const cxy = Math.cos(A[0]), sxy = Math.sin(A[0]), cxz = Math.cos(A[1]), sxz = Math.sin(A[1]), cxw = Math.cos(A[2]), sxw = Math.sin(A[2])
    const cyz = Math.cos(A[3]), syz = Math.sin(A[3]), cyw = Math.cos(A[4]), syw = Math.sin(A[4]), czw = Math.cos(A[5]), szw = Math.sin(A[5])
    const D = Math.max(dist, 1.2) // 4D eye distance; clamped so the perspective divide stays well-behaved
    const { dummy, proj, dir, up, q } = scratch
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]
      let x = v[0], y = v[1], z = v[2], w = v[3]
      let nx, ny, nz, nw
      nx = x * cxy - y * sxy; ny = x * sxy + y * cxy; x = nx; y = ny // XY
      nx = x * cxz - z * sxz; nz = x * sxz + z * cxz; x = nx; z = nz // XZ
      nx = x * cxw - w * sxw; nw = x * sxw + w * cxw; x = nx; w = nw // XW
      ny = y * cyz - z * syz; nz = y * syz + z * cyz; y = ny; z = nz // YZ
      ny = y * cyw - w * syw; nw = y * syw + w * cyw; y = ny; w = nw // YW
      nz = z * czw - w * szw; nw = z * szw + w * czw; z = nz; w = nw // ZW
      const k = D / Math.max(D - w, 0.08) // 4D→3D perspective projection (clamp near the 4D pole so it never blows up)
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
