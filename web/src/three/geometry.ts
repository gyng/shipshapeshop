import * as THREE from 'three'
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js'

// Family → geometry. Built-ins + parametric surfaces where they're exact; distinctive stand-ins for the
// genuinely hard ones (true TPMS marching-cubes + real 4D projection are a later M2 deepening — for now the
// 4D polytopes render as their 3D "shadow" polyhedron, which is honest and reads well). Everything is
// normalised to ~unit radius and centred, and cached by family.

// Open / non-orientable / single-sided surfaces — these MUST render double-sided or backface culling
// leaves them looking holey/wrong (closed solids stay front-side for cheaper fill).
export const OPEN_FAMILIES = new Set<string>([
  'mobius', 'klein_bottle', 'rp2', 'boys_surface', 'cross_cap',
  'catenoid', 'helicoid', 'hyperboloid', 'monkey_saddle', 'costa', 'seifert', 'disk', 'dini',
])

type ParamFn = (u: number, v: number, target: THREE.Vector3) => void

function parametric(fn: ParamFn, su = 80, sv = 40): THREE.BufferGeometry {
  return new ParametricGeometry(fn, su, sv)
}

const TAU = Math.PI * 2

const mobius: ParamFn = (u, v, t) => {
  const a = u * TAU
  const w = v * 2 - 1
  const r = 1 + (w / 2) * Math.cos(a / 2)
  t.set(r * Math.cos(a), r * Math.sin(a), (w / 2) * Math.sin(a / 2))
}

// Figure-8 immersion of the Klein bottle (also reused, tweaked, for the non-orientable cousins).
function kleinFig8(twist: number): ParamFn {
  return (u, v, t) => {
    const a = u * TAU
    const b = v * TAU
    const r = 2 + Math.cos(a / 2) * Math.sin(b * twist) - Math.sin(a / 2) * Math.sin(2 * b)
    t.set(
      r * Math.cos(a),
      r * Math.sin(a),
      Math.sin(a / 2) * Math.sin(b * twist) + Math.cos(a / 2) * Math.sin(2 * b),
    )
  }
}

// The iconic "bottle" immersion of the Klein bottle (the recognisable neck-through-side form), not the
// figure-8 band. Paul Bourke's standard parametrisation; normalise() rescales from its native ~16-unit size.
const kleinBottle: ParamFn = (u, v, t) => {
  const a = u * TAU
  const b = v * TAU
  const r = 4 * (1 - Math.cos(a) / 2)
  let x: number
  let y: number
  if (a < Math.PI) {
    x = 6 * Math.cos(a) * (1 + Math.sin(a)) + r * Math.cos(a) * Math.cos(b)
    y = 16 * Math.sin(a) + r * Math.sin(a) * Math.cos(b)
  } else {
    x = 6 * Math.cos(a) * (1 + Math.sin(a)) + r * Math.cos(b + Math.PI)
    y = 16 * Math.sin(a)
  }
  t.set(x, y, r * Math.sin(b))
}

const catenoid: ParamFn = (u, v, t) => {
  const a = (v - 0.5) * 3
  const b = u * TAU
  t.set(Math.cosh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b), a)
}

const helicoid: ParamFn = (u, v, t) => {
  const a = (v - 0.5) * 2
  const b = u * TAU
  t.set(a * Math.cos(b), a * Math.sin(b), b - Math.PI)
}

const hyperboloid: ParamFn = (u, v, t) => {
  const a = (v - 0.5) * 2.4
  const b = u * TAU
  const c = Math.cosh(a)
  t.set(c * Math.cos(b), c * Math.sin(b), Math.sinh(a))
}

const monkeySaddle: ParamFn = (u, v, t) => {
  const x = (u - 0.5) * 2.4
  const y = (v - 0.5) * 2.4
  t.set(x, y, x * x * x - 3 * x * y * y)
}

// Dini's surface — a surface of constant negative curvature: a pseudosphere twisted into a spiralling horn.
// v is kept away from 0 (where ln(tan(v/2)) → −∞); two full twists in u read as the iconic seashell coil.
const dini: ParamFn = (u, v, t) => {
  const a = 1.0
  const b = 0.18
  const uu = u * 4 * Math.PI
  const vv = 0.12 + v * (1.55 - 0.12)
  const x = a * Math.cos(uu) * Math.sin(vv)
  const y = a * Math.sin(uu) * Math.sin(vv)
  const z = a * (Math.cos(vv) + Math.log(Math.tan(vv / 2))) + b * uu
  t.set(x, z, y) // spiral axis vertical-ish — reads better in the gallery
}

function mergedTori(count: number, spread: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const g = new THREE.TorusGeometry(0.6, 0.22, 20, 48)
    g.translate((i - (count - 1) / 2) * spread, 0, 0)
    parts.push(g)
  }
  return mergeGeometries(parts)!
}

// Borromean rings: three interlocked rings on mutually-perpendicular planes (remove any one and the other
// two fall apart — but visually, three clean rings).
function linkedRings(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const planes: [number, number, number][] = [
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    [0, Math.PI / 2, 0],
  ]
  for (const [rx, ry, rz] of planes) {
    const g = new THREE.TorusGeometry(0.85, 0.13, 16, 60)
    g.rotateX(rx)
    g.rotateY(ry)
    g.rotateZ(rz)
    parts.push(g)
  }
  return mergeGeometries(parts)!
}

// Hopf fibration: a bundle of mutually-linked fibre circles (each offset from the axis and swept around it),
// visually distinct from the three perpendicular Borromean rings.
function hopfFibration(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const n = 7
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(0.62, 0.085, 12, 48)
    g.rotateX(Math.PI / 2)
    g.translate(0.5, 0, 0)
    g.rotateZ((i / n) * TAU)
    parts.push(g)
  }
  return mergeGeometries(parts)!
}

// Menger sponge (level 2): recursively divide a cube into 3×3×3 and drop the centre + 6 face-centres
// (any cell with ≥2 coordinates in the middle). 20² = 400 surviving sub-cubes → the iconic drilled fractal.
function mengerSponge(): THREE.BufferGeometry {
  const cells: [number, number, number, number][] = [] // x, y, z, size
  const keep = (i: number, j: number, k: number) => {
    let mid = 0
    if (i === 1) mid++
    if (j === 1) mid++
    if (k === 1) mid++
    return mid < 2
  }
  const recurse = (cx: number, cy: number, cz: number, size: number, depth: number) => {
    if (depth === 0) {
      cells.push([cx, cy, cz, size])
      return
    }
    const s = size / 3
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          if (keep(i, j, k)) recurse(cx + (i - 1) * s, cy + (j - 1) * s, cz + (k - 1) * s, s, depth - 1)
  }
  recurse(0, 0, 0, 2.0, 2)
  const parts = cells.map(([x, y, z, s]) => {
    const g = new THREE.BoxGeometry(s, s, s)
    g.translate(x, y, z)
    return g
  })
  return mergeGeometries(parts)!
}

// One solid tetrahedron from 4 points, with every face wound outward (so normals point away from centroid).
function tetraFromPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  const center = a.clone().add(b).add(c).add(d).multiplyScalar(0.25)
  const tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [a, b, c],
    [a, b, d],
    [a, c, d],
    [b, c, d],
  ]
  const pos: number[] = []
  for (const [p, q, r] of tris) {
    const n = q.clone().sub(p).cross(r.clone().sub(p))
    const faceCenter = p.clone().add(q).add(r).multiplyScalar(1 / 3).sub(center)
    if (n.dot(faceCenter) < 0) pos.push(p.x, p.y, p.z, r.x, r.y, r.z, q.x, q.y, q.z)
    else pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

// Sierpinski tetrahedron (level 3): the classic midpoint recursion — each tetra spawns 4 half-scale copies at
// its corners, leaving the central void. 4³ = 64 solid tetrahedra.
function sierpinskiTetra(): THREE.BufferGeometry {
  const leaves: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = []
  const mid = (p: THREE.Vector3, q: THREE.Vector3) => p.clone().add(q).multiplyScalar(0.5)
  const recurse = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, depth: number) => {
    if (depth === 0) {
      leaves.push([a, b, c, d])
      return
    }
    const ab = mid(a, b)
    const ac = mid(a, c)
    const ad = mid(a, d)
    const bc = mid(b, c)
    const bd = mid(b, d)
    const cd = mid(c, d)
    recurse(a, ab, ac, ad, depth - 1)
    recurse(ab, b, bc, bd, depth - 1)
    recurse(ac, bc, c, cd, depth - 1)
    recurse(ad, bd, cd, d, depth - 1)
  }
  recurse(
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(-1, -1, 1),
    3,
  )
  return mergeGeometries(leaves.map(([a, b, c, d]) => tetraFromPoints(a, b, c, d)))!
}

// Stylised 3DBenchy: hull + cabin + funnel (a recognisable little boat, not a plain box).
function benchyBoat(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(1.9, 0.55, 0.95)
  hull.translate(0, -0.1, 0)
  const cabin = new THREE.BoxGeometry(0.75, 0.5, 0.62)
  cabin.translate(-0.25, 0.42, 0)
  const funnel = new THREE.CylinderGeometry(0.13, 0.13, 0.42, 16)
  funnel.translate(0.18, 0.5, 0)
  return mergeGeometries([hull, cabin, funnel])!
}

function build(family: string): THREE.BufferGeometry {
  switch (family) {
    case 'sphere': return new THREE.SphereGeometry(1, 48, 32)
    case 'cube': return new THREE.BoxGeometry(1.4, 1.4, 1.4)
    case 'tetrahedron': return new THREE.TetrahedronGeometry(1.1)
    case 'octahedron': return new THREE.OctahedronGeometry(1.1)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(1)
    case 'icosahedron': return new THREE.IcosahedronGeometry(1)
    case 'cylinder': return new THREE.CylinderGeometry(0.7, 0.7, 1.6, 48)
    case 'cone': return new THREE.ConeGeometry(0.9, 1.6, 48)
    case 'disk': return new THREE.CylinderGeometry(1.1, 1.1, 0.18, 56)
    case 'ellipsoid': { const g = new THREE.SphereGeometry(1, 48, 32); g.scale(1.3, 0.7, 1); return g }
    case 'torus': return new THREE.TorusGeometry(0.75, 0.3, 28, 64)
    case 'mobius': return parametric(mobius, 120, 20)
    case 'genus2': return mergedTori(2, 1.0)
    case 'triple_torus': return mergedTori(3, 1.0)
    case 'hyperboloid': return parametric(hyperboloid, 64, 24)
    case 'catenoid': return parametric(catenoid, 64, 24)
    case 'helicoid': return parametric(helicoid, 80, 24)
    case 'monkey_saddle': return parametric(monkeySaddle, 48, 48)
    case 'trefoil': return new THREE.TorusKnotGeometry(0.7, 0.24, 128, 20, 2, 3)
    case 'figure8_knot': return new THREE.TorusKnotGeometry(0.7, 0.22, 160, 20, 3, 2)
    case 'torus_knot_2_5': return new THREE.TorusKnotGeometry(0.7, 0.2, 160, 20, 2, 5)
    case 'klein_bottle': return parametric(kleinBottle, 110, 40)
    case 'rp2': return parametric(kleinFig8(2), 100, 40)
    case 'boys_surface': return parametric(kleinFig8(3), 120, 40)
    case 'cross_cap': return parametric(kleinFig8(0.5), 100, 40)
    case 'gyroid': return new THREE.TorusKnotGeometry(0.62, 0.26, 200, 24, 3, 5)
    case 'schwarz_p': return new THREE.TorusKnotGeometry(0.62, 0.26, 200, 24, 4, 3)
    case 'schwarz_d': return new THREE.TorusKnotGeometry(0.6, 0.26, 220, 24, 5, 4)
    case 'heptoroid': return new THREE.TorusKnotGeometry(0.62, 0.22, 240, 24, 7, 2)
    case 'costa': return parametric(catenoid, 80, 30)
    case 'borromean': return linkedRings()
    case 'seifert': return parametric(mobius, 140, 24)
    case 'lorenz': return new THREE.TorusKnotGeometry(0.66, 0.18, 200, 18, 2, 3)
    case 'klein_quartic': return new THREE.TorusKnotGeometry(0.6, 0.2, 240, 22, 7, 3)
    // 4D polytopes → their 3D shadow polyhedron (deepens to real projection later)
    case 'tesseract': return new THREE.BoxGeometry(1.3, 1.3, 1.3)
    case 'cell_16': return new THREE.OctahedronGeometry(1.15)
    case 'cell_24': return new THREE.IcosahedronGeometry(1.05, 0)
    case 'cell_120': return new THREE.DodecahedronGeometry(1.05)
    case 'cell_600': return new THREE.IcosahedronGeometry(1.1, 1)
    case 'hopf': return hopfFibration()
    case 'mazur': return new THREE.SphereGeometry(1, 40, 28) // the "monster" is secretly a ball
    // ── Relics (Reference Wing). These are GALLERY-THUMBNAIL placeholders only; the hero view loads the real
    // meshes via ModelGem (Princeton .ply scans + Spot's .obj). The Utah Teapot is exact everywhere.
    case 'utah_teapot': return new TeapotGeometry(0.62, 12)
    case 'stanford_bunny': return new THREE.CapsuleGeometry(0.5, 0.55, 8, 18)
    case 'benchy': return benchyBoat()
    case 'stanford_dragon': return new THREE.TorusKnotGeometry(0.58, 0.2, 200, 20, 3, 7)
    case 'suzanne': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.0, 0.88, 1.12); return g }
    case 'spot': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.35, 0.8, 0.9); return g }
    case 'cow': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.4, 0.82, 0.86); return g }
    case 'armadillo': return new THREE.IcosahedronGeometry(1.05, 1)
    case 'lucy': return new THREE.CapsuleGeometry(0.34, 1.15, 8, 16)
    case 'csaszar': return new THREE.TorusGeometry(0.7, 0.3, 6, 14)
    // Famous fractals & classical surfaces (Relic tier)
    case 'menger': return mengerSponge()
    case 'sierpinski': return sierpinskiTetra()
    case 'dini': return parametric(dini, 140, 40)
    case 'torus_knot_2_7': return new THREE.TorusKnotGeometry(0.7, 0.16, 240, 18, 2, 7)
    default: return new THREE.IcosahedronGeometry(1)
  }
}

function normalize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingSphere()
  const r = geo.boundingSphere?.radius ?? 1
  geo.center()
  geo.scale(1 / r, 1 / r, 1 / r)
  geo.computeVertexNormals()
  return geo
}

const cache = new Map<string, THREE.BufferGeometry>()

export function getGeometry(family: string): THREE.BufferGeometry {
  let g = cache.get(family)
  if (!g) {
    g = normalize(build(family))
    cache.set(family, g)
  }
  return g
}
