import * as THREE from 'three'
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'

// Family → geometry. Built-ins + parametric surfaces where they're exact, REAL marching-cubes isosurfaces for
// the triply-periodic minimal surfaces (gyroid / Schwarz P / D), and the genuine Clifford-torus projection,
// cable knot and Lorenz attractor. The 4D polytopes still render as their 3D "shadow" polyhedron (honest and
// readable; a real 4-space projection is the remaining deepening). Everything is normalised to ~unit radius
// and centred, and cached by family.

// Open / non-orientable / single-sided surfaces — these MUST render double-sided or backface culling
// leaves them looking holey/wrong (closed solids stay front-side for cheaper fill).
export const OPEN_FAMILIES = new Set<string>([
  'mobius', 'klein_bottle', 'roman_surface', 'boys_surface', 'whitney_umbrella',
  'catenoid', 'helicoid', 'hyperboloid', 'monkey_saddle', 'costa', 'seifert', 'disk', 'dini', 'cut_hollow_sphere',
  'gyroid', 'schwarz_p', 'schwarz_d', // TPMS chunks are open at the cell boundary
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

// A Seifert surface of the trefoil: an orientable membrane spanning the (2,3) torus knot — a twisting sheet
// from a small central rim out to the knotted boundary, rising into the trefoil's three lobes. Replaces the old
// Möbius stand-in, so it no longer duplicates Mo.
const seifertTrefoil: ParamFn = (u, v, t) => {
  const th = u * TAU
  const az = 2 * th // (2,3) torus knot: two azimuthal turns
  const R = 1.5 + 0.7 * Math.cos(3 * th) // three lobes
  const lift = 0.7 * Math.sin(3 * th)
  const ir = 0.34 // central rim radius
  // lerp from the inner rim (v=0, flat) out to the knotted boundary (v=1); membrane lies in XZ, rises in Y
  const x = R * Math.cos(az) * v + ir * Math.cos(az) * (1 - v)
  const z = R * Math.sin(az) * v + ir * Math.sin(az) * (1 - v)
  t.set(x, lift * v, z)
}

// Costa's minimal surface (recognisable form): a catenoid threaded through a flat planar 'end' at its waist —
// the iconic three-ended look (two catenoid necks + a horizontal planar sheet). Replaces the catenoid stand-in.
function costaSurface(): THREE.BufferGeometry {
  const cat = parametric(catenoid, 64, 24) // the double-flare tube (two of Costa's three ends), axis = Z
  const ring = new THREE.RingGeometry(1.0, 2.4, 64, 2) // the planar end: a flat sheet in the XY plane at the waist
  return mergeGeometries([cat, ring])!
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

// Menger sponge: recursively divide a cube into 3×3×3 and drop the centre + 6 face-centres (any cell with ≥2
// coordinates in the middle). 20^level surviving sub-cubes → the iconic drilled fractal. level 2 = 400 cubes;
// level 3 = 8000 (the deeper "metashape" sponge).
function mengerSponge(level = 2): THREE.BufferGeometry {
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
  recurse(0, 0, 0, 2.0, level)
  const parts = cells.map(([x, y, z, s]) => {
    const g = new THREE.BoxGeometry(s, s, s)
    g.translate(x, y, z)
    return g
  })
  return mergeGeometries(parts)!
}

// ── Real isosurfaces & space curves (replacing the earlier torus-knot stand-ins) ──

// Mesh the implicit SHELL |f(x)| < t (a closed solid of finite thickness) via marching cubes (THREE's tested
// tables), NOT the infinitely-thin zero level-set. A bare sheet has no inside, so transmission/thickness/
// back-face refraction are undefined on it (RENDERING_PLAN §3.3) — solidifying gives the TPMS gems a real
// interior to refract. `span` = how many half-periods of the field fit across the cell; TPMS read best ~1.3π.
function isosurfaceShell(f: (x: number, y: number, z: number) => number, res = 48, span = Math.PI * 1.3, t = 0.5): THREE.BufferGeometry {
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 300000)
  mc.isolation = 0 // field > 0 ⇒ inside the shell; the surface is where |f| = t (two close sheets → a solid)
  const n = mc.size
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const wx = ((x / (n - 1)) * 2 - 1) * span
        const wy = ((y / (n - 1)) * 2 - 1) * span
        const wz = ((z / (n - 1)) * 2 - 1) * span
        mc.field[z * n * n + y * n + x] = t - Math.abs(f(wx, wy, wz))
      }
  mc.update()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(mc.positionArray.slice(0, mc.count * 3), 3))
  g.computeVertexNormals()
  return g
}
// the three classic triply-periodic minimal surfaces (nodal approximations — the standard implicit forms)
const gyroidF = (x: number, y: number, z: number) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x)
const schwarzPF = (x: number, y: number, z: number) => Math.cos(x) + Math.cos(y) + Math.cos(z)
const schwarzDF = (x: number, y: number, z: number) =>
  Math.sin(x) * Math.sin(y) * Math.sin(z) + Math.sin(x) * Math.cos(y) * Math.cos(z) + Math.cos(x) * Math.sin(y) * Math.cos(z) + Math.cos(x) * Math.cos(y) * Math.sin(z)

// Clifford torus: the flat torus {(cosθ, sinθ, cosφ, sinφ)/√2} ⊂ S³, stereographically projected to 3-space
// (the genuine projection — its characteristic proportions, not a generic torus).
const cliffordTorus: ParamFn = (u, v, t) => {
  const th = u * TAU
  const ph = v * TAU
  const k = 1 / (Math.SQRT2 - Math.sin(ph)) // = 1/(1 − d), d = sinφ/√2; sinφ ≤ 1 < √2 ⇒ no singularity
  t.set(Math.cos(th) * k, Math.sin(th) * k, Math.cos(ph) * k)
}

// A real cable (satellite) knot: a strand wound many times around a TREFOIL companion — a knot of a knot.
function cableKnot(): THREE.BufferGeometry {
  const seg = 600
  const compPts: THREE.Vector3[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU
    compPts.push(new THREE.Vector3(Math.sin(a) + 2 * Math.sin(2 * a), Math.cos(a) - 2 * Math.cos(2 * a), -Math.sin(3 * a)))
  }
  const companion = new THREE.CatmullRomCurve3(compPts, true)
  const frames = companion.computeFrenetFrames(seg, true)
  const eps = 0.5
  const windings = 13
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= seg; i++) {
    const p = companion.getPointAt((i % seg) / seg)
    const nrm = frames.normals[i % seg]
    const bin = frames.binormals[i % seg]
    const ang = (i / seg) * TAU * windings
    pts.push(p.addScaledVector(nrm, eps * Math.cos(ang)).addScaledVector(bin, eps * Math.sin(ang)))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), seg * 2, 0.16, 10, true)
}

// The Lorenz attractor — the actual ODE integrated into its iconic butterfly, swept as a thin tube.
function lorenzAttractor(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  let x = 0.1
  let y = 0
  let z = 0
  const s = 10
  const r = 28
  const b = 8 / 3
  const dt = 0.006
  for (let i = 0; i < 3200; i++) {
    const dx = s * (y - x)
    const dy = x * (r - z) - y
    const dz = x * y - b * z
    x += dx * dt
    y += dy * dt
    z += dz * dt
    if (i > 150) pts.push(new THREE.Vector3(x, z - 25, y)) // stand it upright + roughly centre
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false), pts.length, 0.55, 8, false)
}

// Marching-cubes mesh of the SOLID where a signed field f < 0 (inside). Unlike isosurfaceShell (which thickens a
// SURFACE into a shell), this extracts the f=0 boundary of a solid object — for the mandelbulb / spike thumbnails.
function solidIso(f: (x: number, y: number, z: number) => number, res = 48, span = 1.35): THREE.BufferGeometry {
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 300000)
  mc.isolation = 0
  const n = mc.size
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const wx = ((x / (n - 1)) * 2 - 1) * span
        const wy = ((y / (n - 1)) * 2 - 1) * span
        const wz = ((z / (n - 1)) * 2 - 1) * span
        mc.field[z * n * n + y * n + x] = -f(wx, wy, wz) // inside (f<0) ⇒ field>0
      }
  mc.update()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(mc.positionArray.slice(0, mc.count * 3), 3))
  g.computeVertexNormals()
  return g
}

// Mandelbulb DE (mirrors sdfShapes.glsl sdfMandelbulb) — sampled for the marching-cubes thumbnail mesh.
function mandelbulbF(x: number, y: number, z: number): number {
  let zx = x
  let zy = y
  let zz = z
  let dr = 1
  let r = 0
  for (let i = 0; i < 10; i++) {
    r = Math.hypot(zx, zy, zz)
    if (r > 2) break
    const theta = Math.acos(Math.max(-1, Math.min(1, zz / r))) * 8
    const phi = Math.atan2(zy, zx) * 8
    const r7 = Math.pow(r, 7)
    dr = r7 * 8 * dr + 1
    const zr = r7 * r
    zx = zr * Math.sin(theta) * Math.cos(phi) + x
    zy = zr * Math.sin(theta) * Math.sin(phi) + y
    zz = zr * Math.cos(theta) + z
  }
  return (0.5 * Math.log(Math.max(r, 1e-6)) * r) / dr
}

// Spike field (mirrors sdfShapes.glsl sdfSpike, sans the conservative trace scale) — for its thumbnail mesh.
function spikeF(x: number, y: number, z: number): number {
  const L = Math.hypot(x, y, z) || 1e-5
  const m = Math.max(Math.abs(x / L), Math.abs(y / L), Math.abs(z / L))
  return L - (0.5 + 0.55 * Math.pow(m, 6))
}

// Klein-quartic stand-in — a thickened tetrahedron frame (genus 3 = 6 edges − 4 verts + 1, tetrahedral symmetry).
// MIRRORS sdfShapes.glsl sdfKleinQuartic (same verts / tube radius / smooth-min) so the raymarched hero and this
// marching-cubes thumbnail agree — the real algebraic Klein quartic has no closed-form SDF, so this is the honest
// genus-3, max-symmetry representative (vs the old (7,3) torus-knot, which was genus 1 and looked nothing like it).
function tetraFrameF(x: number, y: number, z: number): number {
  const V: [number, number, number][] = [[0.55, 0.55, 0.55], [0.55, -0.55, -0.55], [-0.55, 0.55, -0.55], [-0.55, -0.55, 0.55]]
  const r = 0.26, k = 0.08
  const seg = (a: [number, number, number], b: [number, number, number]) => {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2]
    const pax = x - a[0], pay = y - a[1], paz = z - a[2]
    let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)
    h = Math.max(0, Math.min(1, h))
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r
  }
  const kmin = (a: number, b: number) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b * (1 - h) + a * h - k * h * (1 - h) }
  const E: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]
  let d = seg(V[E[0][0]], V[E[0][1]])
  for (let i = 1; i < 6; i++) d = kmin(d, seg(V[E[i][0]], V[E[i][1]]))
  return d
}

// ── Fractal DEs (mirror sdfShapes.glsl) — sampled for the marching-cubes thumbnail meshes. Same scale as each
// raymarch expr so the hero gem and the thumbnail agree. ────────────────────────────────────────────────────
const fract1 = (v: number) => v - Math.floor(v)

function mandelboxF(x: number, y: number, z: number): number {
  x *= 3.4; y *= 3.4; z *= 3.4 // match the raymarch expr (sdfMandelbox(p*3.4)/3.4)
  const SC = 2.7, MR2 = 0.25, svw = Math.abs(SC) / MR2, sv = SC / MR2
  const C1 = Math.abs(SC - 1), C2 = Math.pow(Math.abs(SC), -9)
  let px = x, py = y, pz = z, pw = 1
  for (let i = 0; i < 10; i++) {
    px = Math.max(-1, Math.min(1, px)) * 2 - px // box fold
    py = Math.max(-1, Math.min(1, py)) * 2 - py
    pz = Math.max(-1, Math.min(1, pz)) * 2 - pz
    const r2 = px * px + py * py + pz * pz
    const m = Math.max(0, Math.min(1, Math.max(MR2 / r2, MR2)))
    px *= m; py *= m; pz *= m; pw *= m
    px = px * sv + x; py = py * sv + y; pz = pz * sv + z; pw = pw * svw + 1
  }
  return ((Math.hypot(px, py, pz) - C1) / pw - C2) / 3.4
}

function juliaF(x: number, y: number, z: number): number {
  x *= 1.4; y *= 1.4; z *= 1.4
  let zx = x, zy = y, zz = z, zw = 0
  const cx = -0.45, cy = 0.3, cz = 0.5, cw = -0.2
  let dz2 = 1
  for (let i = 0; i < 9; i++) {
    dz2 *= 4 * (zx * zx + zy * zy + zz * zz + zw * zw)
    const a = zx, b = zy, c = zz, d = zw
    zx = a * a - b * b - c * c - d * d + cx
    zy = 2 * a * b + cy; zz = 2 * a * c + cz; zw = 2 * a * d + cw
    if (zx * zx + zy * zy + zz * zz + zw * zw > 6) break
  }
  const z2 = zx * zx + zy * zy + zz * zz + zw * zw
  return (0.25 * Math.sqrt(z2 / dz2) * Math.log(Math.max(z2, 1e-12))) / 1.4
}

function apollonianF(x: number, y: number, z: number): number {
  let px = x, py = y, pz = z, s = 1
  for (let i = 0; i < 8; i++) {
    px = -1 + 2 * fract1(0.5 * px + 0.5)
    py = -1 + 2 * fract1(0.5 * py + 0.5)
    pz = -1 + 2 * fract1(0.5 * pz + 0.5)
    const r2 = px * px + py * py + pz * pz
    const k = 1.15 / Math.max(r2, 1e-4)
    px *= k; py *= k; pz *= k; s *= k
  }
  return Math.max((0.25 * Math.abs(py) / s) * 0.9 - 0.06, Math.hypot(x, y, z) - 1.02)
}

function kleinianF(x: number, y: number, z: number): number {
  let px = x, py = y, pz = z, s = 1
  const CS = [0.92436, 0.90756, 0.92436]
  for (let i = 0; i < 8; i++) {
    px = 2 * Math.max(-CS[0], Math.min(CS[0], px)) - px
    py = 2 * Math.max(-CS[1], Math.min(CS[1], py)) - py
    pz = 2 * Math.max(-CS[2], Math.min(CS[2], pz)) - pz
    const k = Math.max(0.70968 / Math.max(px * px + py * py + pz * pz, 1e-4), 1)
    px *= k; py *= k; pz *= k; s *= k
  }
  const r = Math.hypot(px, py)
  const d = 0.7 * Math.max(r - 0.92784, Math.abs(r * pz) / Math.max(Math.hypot(px, py, pz), 1e-4)) / s
  return Math.max(d - 0.06, Math.hypot(x, y, z) - 1.05)
}

// Twisted torus (mirrors sdfShapes.glsl sdfTwistTorus) — a flat ribbon spun 2× around the ring.
function twistTorusF(x: number, y: number, z: number): number {
  const an = Math.atan2(z, x)
  const csx = Math.hypot(x, z) - 0.6, csy = y
  const a = 2 * an, c = Math.cos(a), s = Math.sin(a)
  const rx = c * csx - s * csy, ry = s * csx + c * csy
  return (Math.hypot(rx * 0.55, ry) - 0.16) * 0.7
}

// Cut hollow sphere (mirrors sdfShapes.glsl sdfCutHollow) — IQ's exact bowl/shell.
function cutHollowF(x: number, y: number, z: number): number {
  const r = 0.95, h = -0.35, t = 0.06
  const w = Math.sqrt(r * r - h * h)
  const qx = Math.hypot(x, z), qy = y
  const d = (h * qx < w * qy) ? Math.hypot(qx - w, qy - h) : Math.abs(Math.hypot(qx, qy) - r)
  return d - t
}

// Blobby (mirrors sdfShapes.glsl sdfBlobby) — sphere smooth-unioned with three axis dumbbells.
function blobbyF(x: number, y: number, z: number): number {
  const k = 0.28, R = 0.42, A = 0.8, rod = 0.14, ball = 0.2
  const bmin = (a: number, b: number) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b * (1 - h) + a * h - k * h * (1 - h) }
  const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const bax = bx - ax, bay = by - ay, baz = bz - az
    const pax = x - ax, pay = y - ay, paz = z - az
    let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)
    h = Math.max(0, Math.min(1, h))
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - rod
  }
  const bl = (cx: number, cy: number, cz: number) => Math.hypot(x - cx, y - cy, z - cz) - ball
  let d = Math.hypot(x, y, z) - R
  d = bmin(d, seg(-A, 0, 0, A, 0, 0)); d = bmin(d, bl(A, 0, 0)); d = bmin(d, bl(-A, 0, 0))
  d = bmin(d, seg(0, -A, 0, 0, A, 0)); d = bmin(d, bl(0, A, 0)); d = bmin(d, bl(0, -A, 0))
  d = bmin(d, seg(0, 0, -A, 0, 0, A)); d = bmin(d, bl(0, 0, A)); d = bmin(d, bl(0, 0, -A))
  return d
}

// Double helix — two intertwined tubes (matching sdfHelix's proportions), a finite coil.
function doubleHelix(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const seg = 240
  const R = 0.42
  const pitch = 0.42
  const tMax = 2.0 * TAU // ~2 turns
  for (let s = 0; s < 2; s++) {
    const off = s * Math.PI
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg - 0.5) * tMax
      pts.push(new THREE.Vector3(R * Math.cos(t + off), pitch * t, R * Math.sin(t + off)))
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false), seg, 0.085, 8, false))
  }
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
    case 'roman_surface': return parametric(kleinFig8(2), 100, 40) // Steiner's ℝP² immersion (raymarched on hero; mesh thumbnail)
    case 'boys_surface': return parametric(kleinFig8(3), 120, 40)
    case 'whitney_umbrella': return parametric(kleinFig8(0.5), 100, 40) // pinch-point thumbnail (raymarched on hero)
    case 'gyroid': return isosurfaceShell(gyroidF)
    case 'schwarz_p': return isosurfaceShell(schwarzPF)
    case 'schwarz_d': return isosurfaceShell(schwarzDF)
    case 'heptoroid': return new THREE.TorusKnotGeometry(0.62, 0.22, 240, 24, 7, 2) // genus-7 surface — stand-in
    case 'costa': return costaSurface() // catenoid threaded through a planar end — Costa's three-ended look
    case 'borromean': return linkedRings()
    case 'seifert': return parametric(seifertTrefoil, 200, 24) // a membrane spanning the trefoil (genus-1)
    case 'lorenz': return lorenzAttractor()
    case 'klein_quartic': return solidIso(tetraFrameF, 64, 1.3) // genus-3 tetrahedral frame (matches its SDF)
    // 4D polytopes → their 3D shadow polyhedron (deepens to real projection later)
    case 'tesseract': return new THREE.BoxGeometry(1.3, 1.3, 1.3)
    case 'cell_16': return new THREE.OctahedronGeometry(1.15)
    case 'cell_24': return new THREE.IcosahedronGeometry(1.05, 0)
    case 'cell_120': return new THREE.DodecahedronGeometry(1.05)
    case 'cell_600': return new THREE.IcosahedronGeometry(1.1, 1)
    case 'hopf': return hopfFibration()
    case 'mazur': return new THREE.SphereGeometry(1, 40, 28) // the "monster" is secretly a ball
    // ── Relics (Reference Wing). These are PROCEDURAL FALLBACK placeholders, shown only until the real mesh
    // loads — the shared relics layer (relics.ts) swaps in the downloaded .ply/.obj across every view (gallery,
    // Orrery, dioramas, hero). The Utah Teapot is exact everywhere (no file needed).
    case 'utah_teapot': return new TeapotGeometry(0.62, 12)
    case 'stanford_bunny': return new THREE.CapsuleGeometry(0.5, 0.55, 8, 18)
    case 'benchy': return benchyBoat()
    case 'stanford_dragon': return new THREE.TorusKnotGeometry(0.58, 0.2, 200, 20, 3, 7)
    case 'suzanne': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.0, 0.88, 1.12); return g }
    case 'spot': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.35, 0.8, 0.9); return g }
    // The classic CG test cow — a DISTINCT placeholder from Spot on purpose (the audit flagged that both read as
    // identical squashed spheres before the .obj loads). Stockier & lower-poly: a longer, boxier capsule barrel
    // (a beefier, more rectangular silhouette) so the two cows never look like twins pre-load.
    case 'cow': { const g = new THREE.CapsuleGeometry(0.62, 0.95, 6, 12); g.rotateZ(Math.PI / 2); g.scale(1.0, 0.74, 0.82); return g }
    case 'armadillo': return new THREE.IcosahedronGeometry(1.05, 1)
    case 'lucy': return new THREE.CapsuleGeometry(0.34, 1.15, 8, 16)
    case 'csaszar': return new THREE.TorusGeometry(0.7, 0.3, 6, 14)
    // Famous fractals & classical surfaces (Relic tier)
    case 'menger': return mengerSponge()
    case 'sierpinski': return sierpinskiTetra()
    case 'dini': return parametric(dini, 140, 40)
    case 'torus_knot_2_7': return new THREE.TorusKnotGeometry(0.7, 0.16, 240, 18, 2, 7)
    // NG+ Metashapes
    case 'clifford_torus': return parametric(cliffordTorus, 140, 100) // real stereographic projection from S³
    case 'cable_knot': return cableKnot() // a strand wound around a trefoil companion (a knot of a knot)
    // SDF families (raymarched on the hero gem; these are their marching-cubes thumbnail meshes)
    case 'mandelbulb': return solidIso(mandelbulbF, 48, 1.35)
    case 'mandelbox': return solidIso(mandelboxF, 64, 1.0) // fractal showpieces — fields already match their raymarch scale
    case 'julia': return solidIso(juliaF, 64, 1.0)
    case 'apollonian': return solidIso(apollonianF, 80, 1.05)
    case 'kleinian': return solidIso(kleinianF, 80, 1.08)
    case 'twisted_torus': return solidIso(twistTorusF, 72, 0.85)
    case 'cut_hollow_sphere': return solidIso(cutHollowF, 72, 1.05)
    case 'blobby': return solidIso(blobbyF, 72, 1.05)
    case 'spike': return solidIso(spikeF, 48, 1.4)
    case 'helix': return doubleHelix()
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

// A cheap proxy for "how much glass a typical ray crosses" — the smallest bounding-box extent. Geometries are
// normalised to a unit bounding sphere, so a solid (sphere/dodeca) reads ~1.7 while a thin tube-knot or disk
// reads ~0.3. Drives MeshTransmissionMaterial.thickness so absorption/back-refraction match the actual shape
// instead of a flat constant. Memoised per-geometry (cached geoms are stable).
const _thickCache = new WeakMap<THREE.BufferGeometry, number>()
const _thickSize = new THREE.Vector3()
export function glassThickness(g: THREE.BufferGeometry): number {
  const hit = _thickCache.get(g)
  if (hit !== undefined) return hit
  if (!g.boundingBox) g.computeBoundingBox()
  g.boundingBox!.getSize(_thickSize)
  const minExt = Math.min(_thickSize.x, _thickSize.y, _thickSize.z)
  const t = THREE.MathUtils.clamp(minExt * 0.85, 0.3, 1.7)
  _thickCache.set(g, t)
  return t
}
