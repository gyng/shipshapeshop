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

// ── Multi-material PARTY scene for the opt-in path tracer (web/src/three/ExpeditionPathTrace.tsx) ──
// The single-object hero tracer can't path-trace a SCENE. We bake the party's frozen pose + the floor + the
// campfire flame into ONE world-space geometry, tagging each triangle with a small materialId (carried in the
// BVH tri-texture's free .w channel), so the shader can shade per-material (glass gems / diffuse floor / emissive
// flame) from a uniform LUT. World-baking the poses means the tracer needs NO per-object transform (simpler than
// the hero, which rotates its single object into object space).
export const MAT_FLOOR = 0
export const MAT_FLAME = 1
export const MAT_TREE = 2
export const MAT_GEM0 = 3 // gem k → MAT_GEM0 + k
export interface PtMaterial {
  color: [number, number, number]
  ior: number
  rough: number
  emissive: number
  kind: number // 0 diffuse, 1 emissive, 2 glass
}
// A path-traced scene is now a small set of OBJECTS (TLAS/BLAS): each keeps its own object-space geometry + a
// runtime transform (pos + base yaw); spinning objects add a live spin angle on top. The tracer transforms the
// RAY into each object's local space (no per-frame BVH rebuild), so the gems can rotate to show off their facets
// + caustics. Object 0 is always the STATIC set (floor/forest/flame), world-baked with an identity transform.
export interface PartyPtObject {
  geo: THREE.BufferGeometry // object-space (gems centred at origin; the static set is world-baked), tagged w/ materialId
  pos: [number, number, number] // world translation applied at trace time
  baseYaw: number // base Y rotation (rest facing); a spinning object adds the shared live spin to this
  spin: boolean // gems spin in place; the static set does not
}
export interface PartyPtScene {
  objects: PartyPtObject[] // [0] = static set (identity); [1..] = gems (each spins about its own centre)
  materials: PtMaterial[]
  firePos: [number, number, number]
  fireOn: boolean
  triCount: number
  hash: string // composition + pose key — drives the accumulation reset (same hash ⇒ same converged image)
}

// ── Shared party LAYOUT (used by BOTH the PT bake and the raster mesh scene, so toggling ❉/◆ keeps the same
// composition). Pure + deterministic. Gems sit in a cozy semicircle around the BACK/sides of the campfire (fire
// in front, fully visible); trees ring the far side in a horseshoe that opens toward the camera. ──
const FIRE_XZ: [number, number] = [0, 1.7] // campfire centre (matches firePos XZ)

export interface PartySlot { pos: [number, number, number]; yaw: number }
/** Gem world positions + rest facings on a semicircle around the campfire (facing the fire). Shared by PT + mesh. */
export function partyGemLayout(n: number): PartySlot[] {
  const [cx, cz] = FIRE_XZ
  const R = 1.75 // ring radius — cozy-close around the fire
  const arcHalf = Math.min(1.4, 0.5 + n * 0.22) // wider arc for a bigger party (capped so gems don't wrap to the front)
  return Array.from({ length: n }, (_, k) => {
    const th = n <= 1 ? 0 : (k / (n - 1) - 0.5) * 2 * arcHalf // θ=0 = directly behind the fire (far side)
    const px = cx + R * Math.sin(th)
    const pz = cz - R * Math.cos(th)
    return { pos: [px, 0, pz] as [number, number, number], yaw: Math.atan2(cx - px, cz - pz) } // yaw → face the fire
  })
}

export interface PartyTree { x: number; z: number; h: number; r: number }
/** A seeded horseshoe of trees ringing the far side of the campfire (opens toward the camera). Shared by PT + mesh. */
export function partyTreeLayout(): PartyTree[] {
  const [cx, cz] = FIRE_XZ
  let s = 0x9e3779b9 >>> 0
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  return Array.from({ length: 16 }, () => {
    const th = -1.9 + rnd() * 3.8 // far-side arc (±109°), jittered — leaves the camera wedge open
    const R = 5.4 + rnd() * 2.0
    return { x: cx + R * Math.sin(th), z: cz - R * Math.cos(th), h: 1.1 + rnd() * 1.1, r: 0.3 + rnd() * 0.16 }
  })
}

const triCountOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count / 3 : Math.floor(g.attributes.position.count / 3))

// Tag every vertex of a CLONE of `src` with `matId` (never mutate — `src` may be the shared getGeometry cache).
function tagged(src: THREE.BufferGeometry, matId: number): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone() // both yield a FRESH, non-indexed geometry (merge needs uniform index)
  if (!g.attributes.normal) g.computeVertexNormals()
  const n = g.attributes.position.count
  g.setAttribute('materialId', new THREE.BufferAttribute(new Float32Array(n).fill(matId), 1))
  return g
}

/** Bake the party's frozen rest-pose + floor (+ campfire flame when resting) into one tagged world-space geometry
 * + its material LUT, for the opt-in scene path tracer. Pure (memoise on `hash`). Never mutates the geometry cache. */
export function buildPartyPtScene(
  gems: { family: string; colorLinear: [number, number, number]; rank: number }[],
  floorColorLinear: [number, number, number],
  resting: boolean,
): PartyPtScene {
  const materials: PtMaterial[] = [
    { color: floorColorLinear, ior: 1, rough: 0.92, emissive: 0, kind: 0 }, // MAT_FLOOR (diffuse)
    { color: [3.0, 1.4, 0.45], ior: 1, rough: 1, emissive: 1, kind: 1 }, // MAT_FLAME (bounded HDR warm)
    { color: [0.05, 0.13, 0.09], ior: 1, rough: 1, emissive: 0, kind: 0 }, // MAT_TREE (dark forest green, diffuse)
  ]
  // ── OBJECT 0: the static set (floor + forest + flame), world-baked, identity transform ──
  const staticPieces: THREE.BufferGeometry[] = [
    tagged(new THREE.CircleGeometry(9, 56).rotateX(-Math.PI / 2).translate(0, -0.62, -0.2), MAT_FLOOR),
  ]
  if (resting) {
    for (const t of partyTreeLayout()) { // a horseshoe of trees ringing the campfire (shared with the mesh <Forest>)
      staticPieces.push(tagged(new THREE.ConeGeometry(t.r, t.h, 7).translate(0, 0.26 + t.h / 2, 0).translate(t.x, -0.62, t.z), MAT_TREE))
      staticPieces.push(tagged(new THREE.ConeGeometry(t.r * 0.68, t.h * 0.62, 7).translate(0, 0.26 + t.h * 0.82, 0).translate(t.x, -0.62, t.z), MAT_TREE))
    }
    // campfire flame cones at the fire centre
    staticPieces.push(tagged(new THREE.ConeGeometry(0.15, 0.44, 8).translate(0, 0.2, 0).translate(FIRE_XZ[0], -0.5, FIRE_XZ[1]), MAT_FLAME))
    staticPieces.push(tagged(new THREE.ConeGeometry(0.08, 0.28, 8).translate(0, 0.13, 0).translate(FIRE_XZ[0], -0.5, FIRE_XZ[1]), MAT_FLAME))
  }
  const objects: PartyPtObject[] = [
    { geo: mergeGeometries(staticPieces, false)!, pos: [0, 0, 0], baseYaw: 0, spin: false },
  ]
  // ── OBJECTS 1..N: gems, each baked at the ORIGIN (scale + tilt only) so the runtime transform spins it about its
  // own centre, then a circle layout places it around the campfire. The merge/world-bake is gone — the ray is
  // transformed per-object instead, which is what lets the gems rotate without rebuilding the BVH every frame. ──
  const layout = partyGemLayout(gems.length)
  gems.forEach((gm, k) => {
    materials.push({ color: gm.colorLinear, ior: 1.45 + gm.rank * 0.05, rough: 0.04, emissive: 0, kind: 2 }) // glass
    const geo = tagged(getGeometry(gm.family).clone().scale(0.62, 0.62, 0.62).rotateX(0.18), MAT_GEM0 + k) // centred at origin
    objects.push({ geo, pos: layout[k].pos, baseYaw: layout[k].yaw, spin: true })
  })
  const triCount = objects.reduce((sum, o) => sum + triCountOf(o.geo), 0)
  const hash = `${resting ? 'rest' : 'delve'}|${floorColorLinear.map((c) => c.toFixed(2)).join(',')}|` + gems.map((g) => `${g.family}:${g.colorLinear.map((c) => c.toFixed(2)).join('/')}:${g.rank}`).join('|')
  return { objects, materials, firePos: [FIRE_XZ[0], 0, FIRE_XZ[1]], fireOn: resting, triCount, hash }
}

// Bake a DIORAMA into a path-traceable scene: object 0 = the set (walls/logs/lights, world-baked, tagged with
// diffuse/emissive materials) + object 1 = the hero gem (glass) at the origin. Rendered by <ExpeditionPathTrace>,
// so the whole set is genuinely path-traced (real GI: the Cornell box bleeds colour, the campfire lights the glass).
// Returns null for kinds without a PT recipe yet → the caller falls back to the rasterised mesh-transmission set.
export function buildDioramaPtScene(family: string, gemColorHex: string | null, rank: number, kind: string): PartyPtScene | null {
  const materials: PtMaterial[] = []
  const pieces: THREE.BufferGeometry[] = []
  const mat = (m: PtMaterial) => { materials.push(m); return materials.length - 1 }
  const lin3 = (hex: string): [number, number, number] => { const c = new THREE.Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b] }
  const plane = (w: number, h: number, rx: number, ry: number, rz: number, tx: number, ty: number, tz: number, id: number) => pieces.push(tagged(new THREE.PlaneGeometry(w, h).rotateX(rx).rotateY(ry).rotateZ(rz).translate(tx, ty, tz), id))
  const cyl = (rt: number, rb: number, h: number, rx: number, ry: number, rz: number, tx: number, ty: number, tz: number, id: number) => pieces.push(tagged(new THREE.CylinderGeometry(rt, rb, h, 10).rotateX(rx).rotateY(ry).rotateZ(rz).translate(tx, ty, tz), id))
  const sph = (r: number, tx: number, ty: number, tz: number, id: number) => pieces.push(tagged(new THREE.SphereGeometry(r, 12, 12).translate(tx, ty, tz), id))
  const boxG = (w: number, h: number, d: number, tx: number, ty: number, tz: number, id: number) => pieces.push(tagged(new THREE.BoxGeometry(w, h, d).translate(tx, ty, tz), id))
  const ico = (r: number, rot: number, tx: number, ty: number, tz: number, id: number) => pieces.push(tagged(new THREE.IcosahedronGeometry(r, 0).rotateY(rot).translate(tx, ty, tz), id))
  const cone = (r: number, h: number, rx: number, ry: number, rz: number, tx: number, ty: number, tz: number, id: number) => pieces.push(tagged(new THREE.ConeGeometry(r, h, 5).rotateX(rx).rotateY(ry).rotateZ(rz).translate(tx, ty, tz), id))
  const torus = (r: number, tube: number, rx: number, ry: number, rz: number, id: number) => pieces.push(tagged(new THREE.TorusGeometry(r, tube, 8, 60).rotateX(rx).rotateY(ry).rotateZ(rz), id))
  let fireOn = false; let firePos: [number, number, number] = [0, 0, 0]
  switch (kind) {
    case 'cornell': {
      const white = mat({ color: lin3('#e8e8e8'), ior: 1, rough: 0.95, emissive: 0, kind: 0 })
      const red = mat({ color: lin3('#c43838'), ior: 1, rough: 0.95, emissive: 0, kind: 0 })
      const green = mat({ color: lin3('#2fa83f'), ior: 1, rough: 0.95, emissive: 0, kind: 0 })
      const lightM = mat({ color: [5, 5, 4.6], ior: 1, rough: 1, emissive: 1, kind: 1 })
      plane(6, 6, -Math.PI / 2, 0, 0, 0, -3, 0, white) // floor
      plane(6, 6, Math.PI / 2, 0, 0, 0, 3, 0, white) // ceiling
      plane(6, 6, 0, 0, 0, 0, 0, -3, white) // back
      plane(6, 6, 0, Math.PI / 2, 0, -3, 0, 0, red) // left
      plane(6, 6, 0, -Math.PI / 2, 0, 3, 0, 0, green) // right
      plane(2.2, 2.2, Math.PI / 2, 0, 0, 0, 2.96, 0, lightM) // ceiling area light
      break
    }
    case 'campfire': {
      const ground = mat({ color: lin3('#1c160f'), ior: 1, rough: 1, emissive: 0, kind: 0 })
      const logM = mat({ color: lin3('#5a3b27'), ior: 1, rough: 0.95, emissive: 0, kind: 0 })
      const stoneM = mat({ color: lin3('#6b6b73'), ior: 1, rough: 1, emissive: 0, kind: 0 })
      const coalM = mat({ color: [7, 2.8, 0.7], ior: 1, rough: 1, emissive: 1, kind: 1 })
      pieces.push(tagged(new THREE.CircleGeometry(4.5, 32).rotateX(-Math.PI / 2).translate(0, -2.3, 0), ground))
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; cyl(0.11, 0.13, 1.5, Math.PI / 2.4, a, 0, Math.cos(a) * 0.18, -1.95, Math.sin(a) * 0.18, logM) }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; pieces.push(tagged(new THREE.IcosahedronGeometry(0.26, 0).translate(Math.cos(a) * 1.15, -2.15, Math.sin(a) * 1.15), stoneM)) }
      sph(0.3, 0, -2.0, 0, coalM)
      fireOn = true; firePos = [0, -1.7, 0]
      break
    }
    case 'blueprint': {
      const darkM = mat({ color: lin3('#0e1a3a'), ior: 1, rough: 0.9, emissive: 0, kind: 0 })
      const xA = mat({ color: [3, 0.3, 0.4], ior: 1, rough: 1, emissive: 1, kind: 1 })
      const yA = mat({ color: [0.3, 3, 0.35], ior: 1, rough: 1, emissive: 1, kind: 1 })
      const zA = mat({ color: [0.35, 0.6, 3], ior: 1, rough: 1, emissive: 1, kind: 1 })
      plane(10, 10, -Math.PI / 2, 0, 0, 0, -2, 0, darkM) // floor
      plane(10, 10, 0, 0, 0, 0, 0, -3.2, darkM) // back
      cyl(0.02, 0.02, 4, 0, 0, Math.PI / 2, 0, 0, 0, xA) // X axis (red)
      cyl(0.02, 0.02, 4, 0, 0, 0, 0, 0, 0, yA) // Y axis (green)
      cyl(0.02, 0.02, 4, Math.PI / 2, 0, 0, 0, 0, 0, zA) // Z axis (blue)
      break
    }
    case 'dungeon': {
      const stoneM = mat({ color: lin3('#55504a'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // lifted, warmer stone so torchlight reads through the glass
      const ironM = mat({ color: lin3('#15151a'), ior: 1, rough: 0.6, emissive: 0, kind: 0 })
      const brazierM = mat({ color: lin3('#2a2420'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // dark iron brazier bowl / bracket
      const emberM = mat({ color: [4.6, 1.9, 0.5], ior: 1, rough: 1, emissive: 1, kind: 1 }) // glowing coals, energy spread over a wide bed so it never blows to white
      const torchM = mat({ color: [4.4, 2.0, 0.7], ior: 1, rough: 1, emissive: 1, kind: 1 }) // wall torch flame (behind gem)
      plane(7, 7, 0, 0, 0, 0, 0, -3, stoneM) // back wall
      plane(7, 7, 0, Math.PI / 2, 0, -3.2, 0, 0, stoneM) // left wall
      plane(7, 7, -Math.PI / 2, 0, 0, 0, -2.6, 0, stoneM) // floor
      for (const z of [-0.8, -0.3, 0.2, 0.7]) cyl(0.045, 0.045, 5, 0, 0, 0, 3, 0, z, ironM) // iron bars (right)
      // BRAZIER of embers LOW + front-centre, directly under the gem's lower hemisphere (the Campfire-coal pattern)
      cyl(0.62, 0.7, 0.45, 0, 0, 0, 0, -2.18, 0.4, brazierM) // brazier bowl (top ~y -1.96, clears gem bottom y -1.4)
      cyl(0.16, 0.16, 1.0, 0, 0, 0, 0, -2.55, 0.4, brazierM) // stubby leg/base
      pieces.push(tagged(new THREE.CircleGeometry(0.58, 24).rotateX(-Math.PI / 2).translate(0, -1.98, 0.4), emberM)) // wide bed of coals -> warm, not blown
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ico(0.14, i, Math.cos(a) * 0.28, -1.9, 0.4 + Math.sin(a) * 0.28, emberM) } // ember lumps raised slightly above the bed, into the deeper refraction cone
      // wall torch pulled LOW and BEHIND the gem (z<0) so the back of the glass catches warm light
      cyl(0.05, 0.05, 0.6, Math.PI / 3, 0, 0, -2.7, 0.0, -1.2, brazierM) // torch bracket
      sph(0.24, -2.82, 0.4, -1.2, torchM) // torch flame (slightly larger + dimmer so it never blows to white)
      fireOn = true; firePos = [0, -1.6, 0.4]
      break
    }
    case 'altar': {
      // DRAMATIC TEMPLE, calibrated EXACTLY like the gold-standard Dungeon brazier: the gem's key is a
      // FLAT ember BED (top at y=-1.96, never bulges up) recessed inside a dark socket sunk into the
      // altar top, central so the gem body fully occludes it from the camera; everything the camera sees
      // directly is DIFFUSE lifted marble/stone, and the god-shaft is kept faint (radiance 0.55) as ambience.
      const stone = mat({ color: lin3('#b8b09c'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // lifted warm stone steps, lit by the ember + env
      const marble = mat({ color: lin3('#efe9d6'), ior: 1, rough: 0.7, emissive: 0, kind: 0 }) // lifted marble: pillars, capitals, top step, back reredos slab — all DIFFUSE
      const socketM = mat({ color: lin3('#2a2620'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark stone socket recessing the ember (Dungeon's brazier-bowl trick)
      const emberM = mat({ color: [4.6, 2.4, 0.9], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: small warm offering-ember bed, FLAT + low + central, hidden UNDER the gem
      const godM = mat({ color: [0.55, 0.55, 0.48], ior: 1, rough: 1, emissive: 1, kind: 1 }) // soft god-shaft (radiance <= 0.6 — safe for the camera to see, reads as a gentle lit beam)
      // stepped stone altar (top step top at y=-1.55, the gem floats just above it)
      boxG(3, 0.5, 2.2, 0, -2.4, 0, stone)
      boxG(2.2, 0.4, 1.6, 0, -2.0, 0, stone)
      boxG(1.5, 0.3, 1.1, 0, -1.7, 0, marble)
      // dark socket sunk into the altar top — the camera sees a dark cup, not a bright surface (rim top ~y -1.6)
      cyl(0.52, 0.58, 0.46, 0, 0, 0, 0, -1.82, 0, socketM)
      // THE KEY: a FLAT ember bed at y=-1.96 (>=0.5 below the gem bottom y=-1.4) recessed below the socket rim,
      // central → the gem's body occludes the raw surface from the camera while its lower hemisphere drinks the glow
      pieces.push(tagged(new THREE.CircleGeometry(0.44, 28).rotateX(-Math.PI / 2).translate(0, -1.96, 0), emberM)) // wide flat bed — energy spread, never bulges up to peek over the rim
      ico(0.12, 0.0, 0.18, -1.9, 0.0, emberM)  // a couple of tiny ember lumps just above the bed, into the deeper refraction cone
      ico(0.1, 1.0, -0.18, -1.92, 0.14, emberM)
      // softly-lit DIFFUSE reredos slab BEHIND the gem (z<0), facing the camera (+z) — the back of the glass refracts lit marble, not a void
      plane(2.6, 3.2, 0, 0, 0, 0, 0.1, -2.3, marble)
      // twin marble pillars flanking the relic, with capitals (DIFFUSE, lit by the ember + env)
      for (const x of [-1.9, 1.9]) { cyl(0.3, 0.34, 4.4, 0, 0, 0, x, -0.4, -1.3, marble); boxG(0.85, 0.3, 0.85, x, 2.0, -1.3, marble) }
      // soft shaft of god-light from above-front — kept faint (radiance 0.55) so it reads as ambience, never the key
      plane(2.4, 2.4, Math.PI / 2, 0, 0, 0.3, 4.4, 1.0, godM)
      // warm point-light hint anchored at the ember so the steps + pillar bases glow
      fireOn = true; firePos = [0, -1.8, 0]
      break
    }
    case 'plinth': {
      // Clean minimal museum pedestal, lit the WORKING way (Dungeon/Campfire pattern):
      // ONE small bright 'display light' recessed LOW + central into the pedestal top
      // (y ~ -1.9, r ~ 0.4) so the GEM ITSELF occludes it from the camera — the jewel
      // glows from below while the camera sees only a sliver. Everything the camera sees
      // directly (pedestal, floor, back wall, placard) is DIFFUSE marble/grey, lit by the
      // key + ambient env. No emissive panels in view → nothing blows.
      const marble = mat({ color: lin3('#e9e3d6'), ior: 1, rough: 0.6, emissive: 0, kind: 0 }) // warm gallery marble
      const marbleTop = mat({ color: lin3('#f2ede2'), ior: 1, rough: 0.5, emissive: 0, kind: 0 }) // brighter polished top slab
      const wallM = mat({ color: lin3('#cdc8bd'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // soft light-grey gallery wall (DIFFUSE, behind gem)
      const socketM = mat({ color: lin3('#262320'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // dark recessed socket that hides the key
      const brass = mat({ color: lin3('#9a7b32'), ior: 1, rough: 0.45, emissive: 0, kind: 0 }) // brass placard (diffuse, no glow)
      const keyM = mat({ color: [4.4, 4.1, 3.6], ior: 1, rough: 1, emissive: 1, kind: 1 }) // small warm-white display light, LOW + central, occluded by the gem
      // diffuse gallery backdrop + floor (camera-facing → must be diffuse)
      plane(8, 6, 0, 0, 0, 0, 0.4, -3.2, wallM) // back wall (z<0): the back of the glass refracts this lit grey
      plane(9, 7, -Math.PI / 2, 0, 0, 0, -2.66, 0, marble) // gallery floor
      // clean pedestal silhouette (all diffuse marble)
      boxG(2, 0.3, 2, 0, -2.5, 0, marble) // base block
      cyl(0.7, 0.8, 1.1, 0, 0, 0, 0, -1.85, 0, marble) // column
      boxG(1.5, 0.16, 1.5, 0, -1.28, 0, marbleTop) // square top slab (gem sits here, top at y=-1.20)
      boxG(0.7, 0.26, 0.05, 0, -1.95, 0.78, brass) // front placard
      // THE KEY: a small dark socket recessed into the column top, holding one small bright
      // light disc facing UP at y=-1.92 (>=0.5 below gem bottom y=-1.4) with small |x|,|z| →
      // the gem occludes the raw bright surface from the camera and refracts it into a warm
      // inner glow in the gem's lower hemisphere.
      cyl(0.46, 0.5, 0.5, 0, 0, 0, 0, -1.78, 0, socketM) // dark socket cup around the key (top ~-1.53, hides the rim from camera)
      pieces.push(tagged(new THREE.CircleGeometry(0.38, 32).rotateX(-Math.PI / 2).translate(0, -1.92, 0), keyM)) // small up-facing display light, deep in the socket
      // warm point-light hint anchored at the key so the socket interior + slab read as lit
      fireOn = true; firePos = [0, -1.7, 0]
      break
    }
    case 'snowglobe': {
      // EVERYTHING THE CAMERA SEES DIRECTLY IS DIFFUSE (warm wood/brass base, white snow,
      // cool back wall). The ONLY emissive is a small, dim, gem-occluded warm snow-glow
      // recessed LOW + central under the gem, so the jewel glows softly without the base
      // blowing to a white spot (the previous failure).
      const wood = mat({ color: lin3('#8a5e3c'), ior: 1, rough: 0.7, emissive: 0, kind: 0 })   // warm base, diffuse
      const brass = mat({ color: lin3('#d8b257'), ior: 1, rough: 0.3, emissive: 0, kind: 0 })  // brass ring + ground, diffuse
      const snowWhite = mat({ color: lin3('#e9eef5'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // DIFFUSE snow the camera sees — lit by the key via GI, never blows
      const backWall = mat({ color: lin3('#46506a'), ior: 1, rough: 1, emissive: 0, kind: 0 })  // DIFFUSE cool back wall behind the globe (z<0). NOTE: the gem's CENTRE stays dark by nature — the camera looks through dome+gem (nested glass) into the back gap; an emissive wall here only haloed the dome corners without fixing it, so we keep it clean diffuse and accept this as the moodiest set.
      const glassM = mat({ color: [0.96, 0.98, 1.0], ior: 1.46, rough: 0.04, emissive: 0, kind: 2 }) // thin clean dome: dome->gem->dome
      const snowGlow = mat({ color: [3.4, 2.8, 2.0], ior: 1, rough: 1, emissive: 1, kind: 1 }) // warm key — brighter than the first try (1.9 read dark THROUGH the glass dome); still SMALL + LOW + central, gem+socket-occluded so it doesn't blow
      // wooden + brass base, tucked UNDER the dome (dome bottom y=-1.85; base tops ~-1.98)
      cyl(1.55, 1.75, 0.45, 0, 0, 0, 0, -2.45, 0, wood)
      cyl(1.35, 1.55, 0.28, 0, 0, 0, 0, -2.12, 0, brass)
      // DIFFUSE snow floor INSIDE the globe — the camera sees white snow lit by the key (GI), not a glowing disc
      pieces.push(tagged(new THREE.CircleGeometry(0.7, 40).rotateX(-Math.PI / 2).translate(0, -1.74, 0), snowWhite))
      // diffuse snow-mound icos nestled at the base INSIDE the dome (small radii so they clear the glass wall)
      ico(0.2, 0.0, -0.32, -1.6, 0.18, snowWhite)
      ico(0.16, 1.0, 0.3, -1.62, 0.24, snowWhite)
      ico(0.15, 2.0, 0.05, -1.62, -0.34, snowWhite)
      // THE KEY: a SMALL (r=0.3) DIM warm glow LOW + central (y=-1.95, ~0.55 below the gem bottom at -1.4,
      // matching the gold-standard Dungeon/Altar ember at y~-1.98), recessed in a warm snow-socket whose
      // rim (y~-1.7) sits ABOVE the key's top (y=-1.65) — the camera (looking down from [1.5,1.5,4.5])
      // sees the dark socket cup + the gem's lower hemisphere in front of it, not the raw bright surface.
      // The gem occludes + refracts it, glowing the jewel's lower hemisphere softly from within.
      cyl(0.52, 0.46, 0.42, 0, 0, 0, 0, -1.92, 0, wood) // warm socket cupping the glow (rim ~y -1.71, hides the key)
      sph(0.3, 0, -1.95, 0, snowGlow)                    // the dim warm key, recessed in the socket (top y=-1.65, below the rim)
      // the thin glass dome SNUGLY around the r~1.4 gem (spans y[-1.85,1.85], gem spans [-1.4,1.4])
      sph(1.85, 0, 0, 0, glassM)
      // DIFFUSE cool back wall BEHIND the whole globe (outside it, z=-3) so the back of the glass picks up lit colour, not a dark void
      plane(7, 5, 0, 0, 0, 0, -0.2, -3.0, backWall)
      // ground disc beneath, catching warm spill, lifts the floor through the glass (diffuse brass)
      pieces.push(tagged(new THREE.CircleGeometry(4.5, 40).rotateX(-Math.PI / 2).translate(0, -2.62, -0.3), brass))
      // warm point-light hint anchored at the key so the snow + base glow gently
      fireOn = true; firePos = [0, -1.7, 0]
      break
    }
    case 'crystal': {
      // CALIBRATED to the Dungeon/Campfire pattern: ONE small bright key tucked LOW + CENTRAL under
      // the gem (gem-occluded from the camera, only its refraction shows), recessed in a dark socket;
      // everything the camera sees directly (floor, cave wall) is DIFFUSE; the standing crystals glow
      // only dimly (<=~1.7) when camera-facing, and the brighter cool/magenta accents sit BEHIND the gem.
      const groundM = mat({ color: lin3('#2c2842'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // cool slate cave floor (DIFFUSE — lit by the key + env)
      const wallM = mat({ color: lin3('#363052'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // cool cave wall behind the gem (DIFFUSE) — feeds the back of the glass with lit colour, not a void
      const socketM = mat({ color: lin3('#161320'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // dark rock socket cradling the bright key (recesses it, Campfire-bowl pattern)
      const keyM = mat({ color: [1.5, 3.4, 4.9], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: small bright cool-cyan crystal cluster, LOW + central + gem-occluded -> gem's lower hemisphere glows
      const litM = mat({ color: [0.32, 0.46, 0.6], ior: 1, rough: 1, emissive: 1, kind: 1 }) // SAFE-band cool-blue crystal glow (peak 0.6) for standing crystals the camera sees — reads as gently self-lit, never blooms
      const backLitM = mat({ color: [1.0, 0.45, 1.15], ior: 1, rough: 1, emissive: 1, kind: 1 }) // modest magenta glow, only on crystals BEHIND the gem (z<0) — lights the back of the glass; held low so a peeking sliver can't bloom
      // dark cool cave floor + back wall (both DIFFUSE — they read as lit cool stone, never blow)
      pieces.push(tagged(new THREE.CircleGeometry(5, 40).rotateX(-Math.PI / 2).translate(0, -2.4, -0.3), groundM))
      plane(8, 6, 0, 0, 0, 0, 0.5, -3.4, wallM) // cave back wall (z<0), camera-facing diffuse, lit by the key
      // THE KEY cluster: a few small bright crystal shards LOW + central (y~-1.95, |x|,|z|<=0.35) recessed in a dark socket.
      // The gem (lower bulk to y=-1.4) occludes this from the camera at [1.5,1.5,4.5]; only the refraction glows.
      cone(0.5, 0.55, 0, 0, 0, 0, -2.45, 0.1, socketM) // dark rock socket / base around the bright shards
      cone(0.2, 0.62, -0.1, 0, 0.0, 0.0, -1.95, 0.08, keyM) // central bright shard
      cone(0.14, 0.5, 0.18, 1, -0.22, -2.02, 0.05, -0.2, keyM) // left bright shard
      cone(0.13, 0.46, -0.16, 2, 0.24, -2.04, 0.02, 0.22, keyM) // right bright shard
      // standing crystal cones AROUND + BEHIND the gem. Camera-facing ones use the DIM litM; the brighter
      // backLitM accents are kept to z<0 so they are gem-occluded and only enrich the back-of-glass refraction.
      const cr: [number, number, number, number, number][] = [
        [-2.0, -1.4, 0.4, 1.3, litM],   // left, near, low — dim, camera-facing
        [2.1, -1.5, 0.2, 1.5, litM],    // right, near — dim, camera-facing
        [0.1, -1.7, -2.3, 2.0, backLitM], // BEHIND, tall — back of the glass (occluded, can be brighter)
        [2.3, -1.6, -1.9, 1.5, backLitM], // back-right (occluded)
        [-2.4, -1.6, -1.8, 1.6, backLitM],// back-left (occluded)
        [-1.2, -1.5, 1.6, 1.0, litM],   // front-left, short, dim — a little near-foreground sparkle
      ]
      cr.forEach((c, i) => cone(0.4, 1.5 * c[3], i * 0.14, i, 0, c[0], c[1], c[2], c[4]))
      // warm-ish point-light hint anchored at the key so the floor + socket glow with GI
      fireOn = true; firePos = [0, -1.75, 0.1]
      break
    }
    case 'orrery': {
      // Elegant warm-gold armillary. Calibration fix (this set blew white before via a 2.6-r EMISSIVE base
      // disc + bright emissive rings): the big base disc, plinth, and core stem are now DIFFUSE brass — the
      // camera sees them directly, so they MUST NOT be emissive. The ONLY bright key is a SMALL brass core
      // sphere (r 0.42) sunk LOW + slightly BEHIND the gem so the gem occludes it; the gem's lower/back
      // hemisphere refracts that glow and reads as a gilded jewel. The thin rings are gently emissive
      // (peak ~1.3, tube 0.04–0.045 → tiny camera-facing area) so they glint gold without blooming to a blob.
      const brassM = mat({ color: lin3('#b58637'), ior: 1, rough: 0.55, emissive: 0, kind: 0 }) // DIFFUSE warm brass: base disc, plinth, core stem (camera-facing → diffuse)
      const floorM = mat({ color: lin3('#6f5a33'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // DIFFUSE dim warm floor, fills the back/under of the glass with lit colour (no void)
      const gildM = mat({ color: [1.28, 0.82, 0.28], ior: 1, rough: 0.4, emissive: 1, kind: 1 }) // thin armillary rings, gently self-glowing gold (peak 1.28, thin tube → glint not blob)
      const coreM = mat({ color: [4.2, 2.6, 0.9], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: small bright brass core, LOW + behind, gem-occluded → gilded refraction
      const backM = mat({ color: [0.7, 0.95, 1.5], ior: 1, rough: 1, emissive: 1, kind: 1 }) // dim cool "distant planet" low + behind, for the far side of the glass
      // diffuse warm floor (large) — back-of-glass + ground fill, lit by the key + env (never blows)
      pieces.push(tagged(new THREE.CircleGeometry(5, 48).rotateX(-Math.PI / 2).translate(0, -2.45, -0.3), floorM))
      // diffuse brass base disc under the armillary (the old 2.6-r EMISSIVE disc, now DIFFUSE)
      pieces.push(tagged(new THREE.CircleGeometry(2.3, 48).rotateX(-Math.PI / 2).translate(0, -2.28, 0), brassM))
      cyl(1.0, 1.15, 0.34, 0, 0, 0, 0, -2.12, 0, brassM) // brass plinth drum
      cyl(0.16, 0.18, 0.9, 0, 0, 0, 0, -1.95, -0.4, brassM) // brass core stem rising toward the gem
      // the three elegant armillary rings — thin warm-gold tori, gently emissive so they glint to the camera
      torus(2.5, 0.045, Math.PI / 2, 0, 0, gildM)
      torus(2.05, 0.045, 0, 0, Math.PI / 2.4, gildM)
      torus(2.85, 0.04, Math.PI / 3, 0, 0, gildM)
      // THE BRIGHT KEY: small brass core sphere LOW (y -2.05, top ≈ -1.63, ≥0.2 below gem bottom -1.4) +
      // central (x 0) + slightly BEHIND (z -0.4); r 0.42 ≤ 0.45 → the gem occludes it from the camera.
      sph(0.42, 0, -2.05, -0.4, coreM)
      // small cool celestial accent low + behind (z<0), for the back of the glass + a hint of cosmos
      sph(0.3, -1.3, -1.5, -2.1, backM)
      // warm point-light hint anchored at the brass core
      fireOn = true; firePos = [0, -1.75, -0.3]
      break
    }
    case 'rockgarden': {
      const sandM = mat({ color: lin3('#d8cba0'), ior: 1, rough: 1, emissive: 0, kind: 0 })
      const rockM = mat({ color: lin3('#5a564e'), ior: 1, rough: 1, emissive: 0, kind: 0 })
      const woodM = mat({ color: lin3('#6a4a32'), ior: 1, rough: 0.85, emissive: 0, kind: 0 })
      const skyM = mat({ color: [3, 2.8, 2.4], ior: 1, rough: 1, emissive: 1, kind: 1 })
      pieces.push(tagged(new THREE.CircleGeometry(3.6, 48).rotateX(-Math.PI / 2).translate(0, -2.2, 0), sandM))
      ico(0.6, 0, -1.4, -1.9, 0.3, rockM); ico(0.45, 1, 1.2, -1.95, -0.4, rockM); ico(0.38, 2, 0.2, -2.0, 1.0, rockM); ico(0.4, 3, 1.9, -1.88, 0.8, rockM)
      boxG(7.2, 0.3, 0.2, 0, -2.05, 3.5, woodM); boxG(7.2, 0.3, 0.2, 0, -2.05, -3.5, woodM); boxG(0.2, 0.3, 7.2, 3.5, -2.05, 0, woodM); boxG(0.2, 0.3, 7.2, -3.5, -2.05, 0, woodM)
      plane(8, 8, Math.PI / 2, 0, 0, 0, 5, 0, skyM)
      break
    }
    case 'forge': {
      // BLACKSMITH'S FORGE, calibrated like the gold-standard Dungeon/Campfire brazier: a small FLAT molten-coal
      // bed recessed inside a dark firepot socket, central + low so the gem occludes it; everything else diffuse.
      const stoneM = mat({ color: lin3('#564f47'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // warm hearth stone backdrop
      const brickM = mat({ color: lin3('#6e3d2c'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // fired-brick firepot wall
      const ironM = mat({ color: lin3('#26242a'), ior: 1, rough: 0.5, emissive: 0, kind: 0 }) // soot-dark iron anvil + tongs
      const sootM = mat({ color: lin3('#1a1814'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark firepot bowl + quench bucket
      const woodM = mat({ color: lin3('#4a3322'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // bucket banding
      const coalM = mat({ color: [4.6, 2.0, 0.55], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: molten-coal bed, FLAT + low + central
      pieces.push(tagged(new THREE.CircleGeometry(4.6, 32).rotateX(-Math.PI / 2).translate(0, -2.3, 0), stoneM)) // forge floor
      plane(7, 5.4, 0, 0, 0, 0, 0.2, -3, stoneM) // back hearth wall (z<0)
      boxG(3.4, 1.4, 0.5, 0, 1.9, -2.95, stoneM) // chimney-hood lintel
      boxG(1.5, 0.42, 0.78, 0, -1.62, -0.55, ironM) // anvil face block (top ~y -1.41, just under gem bottom)
      boxG(0.52, 0.5, 0.5, 0, -2.0, -0.55, ironM) // anvil waist
      boxG(1.1, 0.34, 0.62, 0, -2.32, -0.55, ironM) // anvil base
      cone(0.3, 0.7, 0, 0, Math.PI / 2, 0.98, -1.55, -0.55, ironM) // anvil horn poking +x
      cyl(0.66, 0.74, 0.5, 0, 0, 0, 0, -2.12, 0.42, brickM) // brick firepot wall (rim ~y -1.87)
      cyl(0.5, 0.56, 0.4, 0, 0, 0, 0, -2.0, 0.42, sootM) // dark soot bowl recessing the coals (rim ~y -1.8)
      pieces.push(tagged(new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2).translate(0, -1.95, 0.42), coalM)) // FLAT coal bed
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ico(0.12, i, Math.cos(a) * 0.24, -1.88, 0.42 + Math.sin(a) * 0.24, coalM) } // tiny ember lumps inside the bowl
      cyl(0.34, 0.3, 0.66, 0, 0, 0, -2.4, -1.95, 0.5, sootM) // quench bucket body (-x side)
      cyl(0.36, 0.36, 0.08, 0, 0, 0, -2.4, -1.62, 0.5, woodM) // bucket rim band
      cyl(0.04, 0.04, 1.5, Math.PI / 5, 0, 0.35, 1.0, -1.7, 0.7, ironM) // tongs
      cyl(0.04, 0.04, 1.5, Math.PI / 5, 0, 0.5, 1.12, -1.7, 0.62, ironM)
      fireOn = true; firePos = [0, -1.75, 0.42]
      break
    }
    case 'shrine': {
      // Japanese shrine at dusk. PRIMARY key = a small warm flame recessed LOW + central in a dark socket under the
      // gem; the two lantern flames are tiny + buried deep inside dark capped stone fireboxes (housing-occluded).
      const groundM = mat({ color: lin3('#39455f'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // dusk-blue stone ground
      const toriiM = mat({ color: lin3('#c2403a'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // vermilion torii (diffuse)
      const stoneM = mat({ color: lin3('#6b6a66'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // lantern + plinth grey stone
      const socketM = mat({ color: lin3('#241f1b'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark recess that hides every flame
      const flameM = mat({ color: [4.2, 2.0, 0.7], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY (and twin lantern flames)
      plane(11, 9, -Math.PI / 2, 0, 0, 0, -2.0, 0, groundM) // dusk-blue ground
      for (const x of [-1.7, 1.7]) cyl(0.17, 0.21, 3.4, 0, 0, 0, x, -0.3, -2.3, toriiM) // torii uprights
      boxG(4.6, 0.32, 0.34, 0, 1.5, -2.3, toriiM) // kasagi (top crossbeam)
      boxG(4.0, 0.2, 0.3, 0, 1.16, -2.3, toriiM) // shimaki (second beam, the iconic double top)
      for (const x of [-2.15, 2.15]) cyl(0.12, 0.12, 0.5, 0, 0, Math.PI / 2.6, x, 1.62, -2.3, toriiM) // tilted beam ends
      boxG(3.7, 0.22, 0.26, 0, 0.55, -2.3, toriiM) // nuki (tie beam)
      boxG(0.34, 0.5, 0.34, 0, 0.86, -2.3, toriiM) // gakuzuka (central post)
      for (const x of [-2.55, 2.55]) {
        cyl(0.34, 0.42, 0.34, 0, 0, 0, x, -1.78, -1.1, stoneM) // lantern base
        cyl(0.12, 0.12, 0.7, 0, 0, 0, x, -1.36, -1.1, stoneM) // post
        cyl(0.46, 0.34, 0.2, 0, 0, 0, x, -0.96, -1.1, stoneM) // platform
        cyl(0.4, 0.4, 0.5, 0, 0, 0, x, -0.66, -1.1, socketM) // dark capped firebox shell wrapping the flame
        sph(0.12, x, -0.66, -1.1, flameM) // tiny flame deep inside the dark firebox (housing-occluded)
        cone(0.5, 0.34, Math.PI, 0, 0, x, -0.27, -1.1, stoneM) // kasa (roof cap)
        sph(0.1, x, -0.06, -1.1, stoneM) // hoju finial
      }
      cyl(0.55, 0.62, 0.36, 0, 0, 0, 0, -1.86, 0, stoneM) // low offering plinth
      cyl(0.4, 0.44, 0.4, 0, 0, 0, 0, -1.78, 0, socketM) // dark socket cup hiding the key
      pieces.push(tagged(new THREE.CircleGeometry(0.36, 28).rotateX(-Math.PI / 2).translate(0, -1.92, 0), flameM)) // flat warm key, gem-occluded
      ico(0.1, 0.0, 0.0, -1.86, 0.0, flameM) // one tiny ember lump
      fireOn = true; firePos = [0, -1.7, 0]
      break
    }
    case 'aquarium': {
      // Underwater coral reef (NO glass dome). Keys = tiny cyan anemone polyps recessed LOW + central in dark rock
      // sockets so the gem occludes them; everything the camera sees directly is diffuse cool-water stone/sand/coral.
      const sandM = mat({ color: lin3('#9fb0a6'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // pale blue-green seabed sand
      const rockM = mat({ color: lin3('#2f5560'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // cool teal-grey reef rock
      const socketM = mat({ color: lin3('#10262c'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark recess cupping each polyp
      const coralPinkM = mat({ color: lin3('#d98aa0'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // soft pink coral
      const coralTealM = mat({ color: lin3('#3fb8a8'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // teal coral / sea-fan
      const polypM = mat({ color: [0.7, 3.4, 3.3], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: tiny bioluminescent cyan anemone
      pieces.push(tagged(new THREE.CircleGeometry(5, 40).rotateX(-Math.PI / 2).translate(0, -2.0, 0), sandM))
      plane(7, 6, 0, 0, 0, 0, 0.6, -3, rockM) // back reef wall
      plane(7, 6, 0, Math.PI / 2, 0, -3.2, 0.6, 0, rockM) // left reef wall
      sph(0.85, -2.2, -2.0, -1.2, rockM) // boulders
      sph(0.7, 2.3, -2.05, -1.4, rockM)
      sph(0.55, 1.3, -2.15, -2.3, rockM)
      for (let i = 0; i < 4; i++) { const a = -0.9 + i * 0.5; cone(0.12, 1.4 - i * 0.12, Math.PI + 0.18 * Math.sin(i), a, 0, -1.9 + 0.55 * a, -1.4 + 0.3 * i, -2.1 - 0.2 * Math.cos(a), coralPinkM) }
      for (let i = 0; i < 3; i++) { const a = 0.4 + i * 0.45; cone(0.1, 1.1 - i * 0.1, Math.PI - 0.2 * i, a * 0.7, 0, 2.0, -1.5 + 0.3 * i, -1.7 - 0.2 * i, coralTealM) }
      pieces.push(tagged(new THREE.TorusGeometry(0.55, 0.07, 8, 40).rotateX(Math.PI / 2.2).rotateY(0.4).translate(-2.0, -1.3, -1.7), coralTealM)) // sea-fan ring
      cyl(0.34, 0.4, 0.34, 0, 0, 0, 0.0, -2.04, 0.1, socketM) // central socket bowl
      pieces.push(tagged(new THREE.CircleGeometry(0.26, 24).rotateX(-Math.PI / 2).translate(0.0, -1.98, 0.1), polypM)) // flat polyp glow, below rim
      sph(0.1, 0.0, -1.94, 0.1, polypM) // tiny polyp bulb (gem-occluded)
      cyl(0.24, 0.3, 0.3, 0, 0, 0, -0.5, -2.06, -0.35, socketM) // second socket, behind-left
      sph(0.09, -0.5, -1.97, -0.35, polypM)
      fireOn = true; firePos = [0, -1.8, 0.05] // keep the fill — the cool polyps alone leave the gem near-black; the warm fill reads as deep-water gloom, acceptable
      break
    }
    case 'mushroom': {
      // Bioluminescent fairy-ring. ONE bright KEY (a glow-cap sunk in a dark mossy socket, gem-occluded); the ring
      // caps the camera sees are kept TINY so they read as glowing dots; floor/logs/stems diffuse.
      const mossM = mat({ color: lin3('#1e3326'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // dark mossy floor
      const moundM = mat({ color: lin3('#2a4030'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // mossy hummock under the gem
      const logM = mat({ color: lin3('#4a3a2c'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // fallen log bark
      const stemM = mat({ color: lin3('#cdbfae'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // pale mushroom stems
      const socketM = mat({ color: lin3('#16241b'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // dark socket recessing the key
      const tealM = mat({ color: [0.7, 3.5, 3.0], ior: 1, rough: 1, emissive: 1, kind: 1 }) // KEY + ring caps: teal glow
      const violetM = mat({ color: [2.4, 1.0, 3.6], ior: 1, rough: 1, emissive: 1, kind: 1 }) // accent violet caps (ring only)
      plane(9, 7, -Math.PI / 2, 0, 0, 0, -2.0, 0, mossM) // floor
      cyl(1.05, 1.25, 0.5, 0, 0, 0, 0, -2.05, 0, moundM) // hummock (top ~y -1.8)
      cyl(0.22, 0.24, 2.6, Math.PI / 2, 0.5, 0, -1.7, -1.78, -1.3, logM) // log behind-left
      cyl(0.18, 0.2, 2.0, Math.PI / 2, -0.4, 0, 1.9, -1.82, -1.0, logM) // log behind-right
      cyl(0.42, 0.48, 0.42, 0, 0, 0, 0, -1.88, 0, socketM) // dark socket cup (rim ~y -1.67)
      pieces.push(tagged(new THREE.SphereGeometry(0.34, 14, 14).scale(1, 0.5, 1).translate(0, -1.95, 0), tealM)) // up-facing glow-cap KEY
      const ring: [number, number, number, number][] = [
        [-1.5, -1.6, -0.4, 0], [1.5, -1.55, -0.5, 1], [-0.9, -1.6, -1.5, 0],
        [0.9, -1.65, -1.6, 1], [0.2, -1.6, -1.9, 0], [-2.0, -1.7, 0.3, 1], [2.0, -1.7, 0.2, 0],
      ]
      for (const [x, y, z, v] of ring) {
        cyl(0.05, 0.07, 0.5, 0, 0, 0, x, y - 0.28, z, stemM) // little stem
        const capM = v ? violetM : tealM
        pieces.push(tagged(new THREE.SphereGeometry(0.14, 12, 12).scale(1.2, 0.7, 1.2).translate(x, y, z), capM)) // small glowing cap
      }
      // NO fireOn — the warm fire-light would wash out the cool teal/violet bioluminescence; the glow-caps light the gem
      break
    }
    case 'shore': {
      // Quiet moonlit shore. ONLY bright key = a small COOL moon-glint LOW + central (gem-occluded). The MOON is a
      // DIM pale disc (radiance <=0.7) on the horizon; the sea is a dark near-mirror diffuse plane.
      const sand = mat({ color: lin3('#94a0ac'), ior: 1, rough: 0.92, emissive: 0, kind: 0 }) // pale COOL moonlit sand strip (blue-grey, not warm — keeps the melancholy register)
      const sea = mat({ color: lin3('#1b2336'), ior: 1, rough: 0.16, emissive: 0, kind: 0 }) // dark calm sea (low rough, catches dim sky)
      const stoneM = mat({ color: lin3('#8e8a80'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // pale beach stones
      const grassM = mat({ color: lin3('#56604e'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // muted dune-grass tufts
      const socketM = mat({ color: lin3('#23282f'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark wet-sand hollow recessing the glint
      const moonM = mat({ color: [0.58, 0.62, 0.68], ior: 1, rough: 1, emissive: 1, kind: 1 }) // DIM pale moon disc (peak 0.68, safe to see)
      const glintM = mat({ color: [1.9, 2.5, 3.4], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: small COOL moon-glint
      plane(14, 9, -Math.PI / 2, 0, 0, 0, -2.02, -4.0, sea) // sea fills the back (z<0)
      plane(14, 4.4, -Math.PI / 2, 0, 0, 0, -2.0, 1.4, sand) // sand strip in front
      pieces.push(tagged(new THREE.CircleGeometry(1.5, 40).translate(0, -0.55, -6.4), moonM)) // soft dim moon on the horizon
      ico(0.36, 0.0, -2.0, -1.86, 0.5, stoneM) // pale beach stones
      ico(0.27, 1.0, 2.1, -1.88, 0.2, stoneM)
      ico(0.2, 2.0, 1.5, -1.92, 1.1, stoneM)
      ico(0.3, 3.0, -1.5, -1.9, -1.0, stoneM)
      for (const [x, z] of [[-2.4, 0.4], [-2.15, 0.9], [2.5, 0.6], [2.25, 1.1]]) {
        cone(0.12, 0.7, 0, 0, 0.18, x, -1.7, z, grassM) // dune-grass tufts (sides)
        cone(0.1, 0.6, 0, 0, -0.22, x + 0.18, -1.74, z + 0.1, grassM)
      }
      cyl(0.5, 0.56, 0.3, 0, 0, 0, 0, -1.86, 0.05, socketM) // dark hollow rim (top ~-1.71) hiding the glint
      pieces.push(tagged(new THREE.CircleGeometry(0.4, 32).rotateX(-Math.PI / 2).translate(0, -1.95, 0.05), glintM)) // small cool moon-glint KEY
      // NO fireOn here — it adds a warm orange fire-light that would wreck the cool melancholy; the cool glint lights the gem
      break
    }
    case 'shop': {
      // THE CURATOR'S SHOP — a warm wooden interior. The ONLY bright key is a small warm bulb (radiance 4.4)
      // recessed LOW + CENTRAL inside a dark lampshade socket (y=-1.95, gem-occluded). Everything else DIFFUSE warm
      // wood/clay; the one camera-visible glow is a soft window patch at 0.5 (safe band).
      const wood = mat({ color: lin3('#7a5230'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // warm shelf/counter wood
      const darkWood = mat({ color: lin3('#3a2614'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // back wall + lampshade socket
      const clay = mat({ color: lin3('#c08a5a'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // teacup + jars
      const trinketA = mat({ color: lin3('#a85c4a'), ior: 1, rough: 0.8, emissive: 0, kind: 0 }) // book spines / curios (terracotta)
      const trinketB = mat({ color: lin3('#5a7a5c'), ior: 1, rough: 0.8, emissive: 0, kind: 0 }) // book spines / curios (sage)
      const bulbM = mat({ color: [4.4, 3.0, 1.3], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: warm lamp bulb, low + central, gem-occluded
      const winM = mat({ color: [0.5, 0.42, 0.3], ior: 1, rough: 1, emissive: 1, kind: 1 }) // soft warm window pane (safe band 0.5)
      plane(8, 6, -Math.PI / 2, 0, 0, 0, -2.4, 0, wood) // wooden floor
      plane(8, 6, 0, 0, 0, 0, 0.4, -3.0, darkWood) // back wall
      plane(6, 6, 0, Math.PI / 2, 0, -3.1, 0.4, 0, darkWood) // left wall
      plane(1.1, 1.5, 0, 0, 0, -1.7, 1.7, -2.96, winM) // soft warm window patch
      boxG(1.3, 1.6, 0.12, -1.7, 1.7, -2.9, darkWood) // window frame
      boxG(3.4, 0.14, 0.5, -0.8, 1.3, -2.55, wood) // upper shelf
      boxG(3.4, 0.14, 0.5, -0.8, 0.4, -2.55, wood) // mid shelf
      cyl(0.18, 0.2, 0.42, 0, 0, 0, -1.9, 1.58, -2.55, clay) // jar
      cyl(0.16, 0.18, 0.36, 0, 0, 0, -1.4, 1.55, -2.55, trinketB) // jar
      boxG(0.16, 0.5, 0.34, -0.7, 1.61, -2.55, trinketA) // book
      boxG(0.16, 0.44, 0.34, -0.5, 1.58, -2.55, trinketB) // book
      boxG(0.16, 0.48, 0.34, -0.3, 1.6, -2.55, clay) // book
      ico(0.16, 0.5, 0.4, 1.52, -2.55, trinketA) // curio
      boxG(0.6, 0.14, 0.34, 1.9, 0.69, -2.55, trinketA) // stacked book
      boxG(0.56, 0.14, 0.34, 1.9, 0.55, -2.55, trinketB) // stacked book
      cyl(0.17, 0.19, 0.4, 0, 0, 0, -2.0, 0.68, -2.55, clay) // jar
      ico(0.15, 1.0, -1.3, 0.62, -2.55, trinketB) // curio
      boxG(2.6, 0.5, 1.4, 0, -2.1, 0, wood) // counter block
      cyl(0.5, 0.62, 0.3, 0, 0, 0, 0, -1.7, 0, darkWood) // display stand
      cyl(0.18, 0.15, 0.22, 0, 0, 0, 1.5, -1.65, 0.7, clay) // teacup body
      pieces.push(tagged(new THREE.TorusGeometry(0.1, 0.025, 6, 20).rotateY(Math.PI / 2).translate(1.68, -1.62, 0.7), clay)) // cup handle
      boxG(0.7, 0.32, 0.06, 2.0, 1.4, -1.8, trinketA) // sign board
      cyl(0.02, 0.02, 0.5, 0, 0, 0, 2.0, 1.78, -1.8, darkWood) // sign post
      cyl(0.04, 0.04, 0.7, 0, 0, 0, 0, -2.3, 0, darkWood) // lamp stem
      cyl(0.44, 0.3, 0.4, 0, 0, 0, 0, -1.78, 0, darkWood) // dark lampshade socket cupping the bulb (rim ~y -1.58)
      sph(0.3, 0, -1.95, 0, bulbM) // THE KEY: warm bulb deep in the shade, gem-occluded
      fireOn = true; firePos = [0, -1.7, 0]
      break
    }
    case 'tearoom': {
      // Warm Japanese tatami interior at dusk (pairs with the Shrine). PRIMARY key = a small warm bulb recessed LOW +
      // central UNDER the gem. The paper ANDON beside the gem glows SOFT via SAFE-band (<=0.55) emissive panels, framed
      // by dark posts; its inner flame is tiny + buried in the box (housing-occluded). Everything else DIFFUSE.
      const tatamiM = mat({ color: lin3('#bdb487'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // straw mat
      const woodM = mat({ color: lin3('#5a4632'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // table, andon frame, shoji stiles
      const shojiM = mat({ color: lin3('#e6ddc8'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // shoji paper + scroll
      const socketM = mat({ color: lin3('#241d16'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark recess hiding the keys
      const paperM = mat({ color: [0.55, 0.42, 0.22], ior: 1, rough: 1, emissive: 1, kind: 1 }) // SAFE-band warm andon paper (<=0.55)
      const flameM = mat({ color: [4.4, 2.1, 0.7], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY + the andon's tiny inner flame
      pieces.push(tagged(new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2).translate(0, -2.0, 0), tatamiM)) // tatami floor
      plane(8, 6, 0, 0, 0, 0, 0.8, -3.0, shojiM) // shoji back wall
      plane(7, 6, 0, Math.PI / 2, 0, -3.2, 0.8, 0, shojiM) // left shoji wall
      for (const y of [-0.6, 0.6, 1.8]) boxG(8, 0.05, 0.05, 0, y, -2.96, woodM) // shoji horizontal rails
      for (const x of [-2.4, -0.8, 0.8, 2.4]) boxG(0.05, 6, 0.05, x, 0.8, -2.96, woodM) // shoji vertical stiles
      boxG(0.9, 2.0, 0.04, -1.9, 0.7, -2.93, shojiM) // hanging scroll
      for (const y of [1.74, -0.34]) boxG(1.0, 0.1, 0.08, -1.9, y, -2.92, woodM) // scroll rollers
      boxG(1.5, 0.1, 0.9, 1.9, -1.5, -0.6, woodM) // table top
      for (const dx of [-0.6, 0.6]) for (const dz of [-0.35, 0.35]) cyl(0.07, 0.07, 0.5, 0, 0, 0, 1.9 + dx, -1.8, -0.6 + dz, woodM) // table legs
      boxG(0.78, 0.1, 0.78, -2.2, -1.92, -0.7, woodM) // andon base
      boxG(0.86, 0.1, 0.86, -2.2, 0.0, -0.7, woodM) // andon top cap
      for (const dx of [-0.36, 0.36]) for (const dz of [-0.36, 0.36]) cyl(0.045, 0.045, 1.9, 0, 0, 0, -2.2 + dx, -0.95, -0.7 + dz, woodM) // andon posts
      cyl(0.3, 0.3, 1.5, 0, 0, 0, -2.2, -0.95, -0.7, socketM) // dark inner sleeve hiding the flame
      sph(0.16, -2.2, -1.2, -0.7, flameM) // tiny flame deep inside the andon (housing-occluded)
      plane(0.62, 1.7, 0, 0, 0, -2.2, -0.95, -0.31, paperM) // andon +z paper face
      plane(0.62, 1.7, 0, Math.PI / 2, 0, -1.81, -0.95, -0.7, paperM) // +x face
      plane(0.62, 1.7, 0, -Math.PI / 2, 0, -2.59, -0.95, -0.7, paperM) // -x face
      cyl(0.42, 0.46, 0.42, 0, 0, 0, 0, -1.8, 0, socketM) // dark socket cup hiding the key
      pieces.push(tagged(new THREE.CircleGeometry(0.34, 28).rotateX(-Math.PI / 2).translate(0, -1.94, 0), flameM)) // THE KEY: flat warm bed, gem-occluded
      ico(0.1, 0.0, 0.0, -1.88, 0.0, flameM) // a tiny warm lump
      fireOn = true; firePos = [-1.6, -1.4, -0.3]
      break
    }
    case 'meadow': {
      // SUNLIT MEADOW — the BRIGHT/DAYTIME register. The airy feel comes from bright DIFFUSE albedos, NOT bright
      // emissives. The only large camera-visible emissive is ONE pale SAFE-BAND sky (<=0.62) the gem's upper hemisphere
      // refracts; the SUN is a small soft disc (<=0.68) low + behind; the bright KEY is a small warm sun-pool UNDER the
      // gem (gem-occluded). NO fireOn (neutral-bright).
      const grassM = mat({ color: lin3('#7fbf52'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // BRIGHT grass floor
      const grassDarkM = mat({ color: lin3('#4f7d34'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // darker grass: stems, tufts, dimple
      const flowerWarmM = mat({ color: lin3('#ffe07a'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // bright yellow petals
      const flowerPaleM = mat({ color: lin3('#fbf2f5'), ior: 1, rough: 1, emissive: 0, kind: 0 }) // bright white-pink petals
      const skyM = mat({ color: [0.5, 0.56, 0.62], ior: 1, rough: 1, emissive: 1, kind: 1 }) // ONE pale SAFE-BAND sky (<=0.62)
      const sunM = mat({ color: [0.66, 0.6, 0.42], ior: 1, rough: 1, emissive: 1, kind: 1 }) // small SOFT sun disc (<=0.68)
      const sunPoolM = mat({ color: [3.8, 3.1, 1.7], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE KEY: warm sun-pool, gem-occluded
      pieces.push(tagged(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2).translate(0, -2.0, 0), grassM)) // grass floor
      plane(16, 9, 0, 0, 0, 0, 1.4, -5, skyM) // distant pale sky wall
      plane(14, 14, Math.PI / 2, 0, 0, 0, 6.5, 0, skyM) // soft pale sky overhead
      pieces.push(tagged(new THREE.CircleGeometry(0.7, 32).translate(-2.4, 0.2, -4.85), sunM)) // soft sun disc on the horizon
      cyl(0.5, 0.56, 0.18, 0, 0, 0, 0, -2.02, 0, grassDarkM) // darker-grass dimple cupping the sun-pool
      pieces.push(tagged(new THREE.CircleGeometry(0.4, 28).rotateX(-Math.PI / 2).translate(0, -1.95, 0), sunPoolM)) // THE KEY: warm sun-pool, gem-occluded
      const flowers: [number, number, number, number][] = [
        [-2.2, -2.0, 0.6, 0], [2.1, -2.0, 0.3, 1], [-1.5, -2.0, -1.4, 0], [1.7, -2.0, -1.6, 1], [0.4, -2.0, -2.3, 0],
        [-2.7, -2.0, -0.8, 1], [2.6, -2.0, -1.0, 0], [-0.9, -2.0, 1.6, 1], [1.2, -2.0, 1.4, 0],
      ]
      flowers.forEach((f, i) => {
        const headM = f[3] === 0 ? flowerWarmM : flowerPaleM
        cone(0.03, 0.5, 0, 0, 0, f[0], f[1] + 0.25, f[2], grassDarkM) // stem
        sph(0.11, f[0], f[1] + 0.5, f[2], headM) // flower head
        for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2 + i; cone(0.07, 0.16, Math.PI / 2.2, a, 0, f[0] + Math.cos(a) * 0.12, f[1] + 0.5, f[2] + Math.sin(a) * 0.12, headM) } // petals
      })
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const r = 2.4 + (i % 3) * 0.5; if (Math.sin(a) > -0.15) continue; cone(0.06, 0.6, 0.12, i, 0, Math.cos(a) * r, -1.85, Math.sin(a) * r, grassDarkM) } // grass tufts
      break
    }
    case 'chapel': {
      // STAINED-GLASS CHAPEL — coloured-light GI showcase. The coloured panes ARE camera-visible, so each is a SAFE-BAND
      // emissive (<=0.7) broken up by DARK stone mullions (no flat bright panel). Everything else DIFFUSE stone. The warm
      // KEY is a small altar-ember bed recessed in a dark socket, low + central (gem-occluded). The Cornell-box trick, warm.
      const stone = mat({ color: lin3('#9a9082'), ior: 1, rough: 0.95, emissive: 0, kind: 0 }) // nave stone (floor, back wall)
      const colStone = mat({ color: lin3('#b4aa98'), ior: 1, rough: 0.85, emissive: 0, kind: 0 }) // column/arch stone
      const mullion = mat({ color: lin3('#2c2824'), ior: 1, rough: 0.9, emissive: 0, kind: 0 }) // dark tracery + altar socket
      const redM = mat({ color: [0.66, 0.12, 0.14], ior: 1, rough: 1, emissive: 1, kind: 1 }) // ruby pane (safe-band)
      const blueM = mat({ color: [0.14, 0.22, 0.62], ior: 1, rough: 1, emissive: 1, kind: 1 }) // sapphire pane
      const goldM = mat({ color: [0.64, 0.46, 0.12], ior: 1, rough: 1, emissive: 1, kind: 1 }) // amber/gold pane
      const emberM = mat({ color: [4.2, 2.2, 0.9], ior: 1, rough: 1, emissive: 1, kind: 1 }) // THE warm KEY: altar-ember bed, gem-occluded
      plane(9, 7, -Math.PI / 2, 0, 0, 0, -2.0, 0, stone) // nave floor
      plane(7, 6.5, 0, 0, 0, 0, 0.6, -3.0, stone) // back wall
      // a stained-glass window: a recessed coloured pane in a dark mullioned frame, chopped into a leaded grid
      const stainedWindow = (px: number, py: number, pz: number, ry: number, glassId: number) => {
        plane(2.0, 3.2, 0, ry, 0, px - Math.sin(ry) * 0.06, py, pz - Math.cos(ry) * 0.06, mullion) // frame backplate
        cone(1.05, 1.0, 0, ry, 0, px - Math.sin(ry) * 0.04, py + 1.85, pz - Math.cos(ry) * 0.04, mullion) // pointed arch cap
        plane(1.7, 2.9, 0, ry, 0, px, py, pz, glassId) // the glowing coloured pane
        cyl(0.05, 0.05, 2.9, Math.PI / 2, ry, 0, px + Math.cos(ry) * 0.01, py, pz - Math.sin(ry) * 0.01, mullion) // vertical bar
        for (const dy of [-0.95, 0.95]) plane(1.7, 0.1, 0, ry, 0, px, py + dy, pz, mullion) // horizontal bars
      }
      stainedWindow(-1.6, 1.4, -2.85, 0, blueM) // blue, back-left
      stainedWindow(1.6, 1.4, -2.85, 0, redM) // red, back-right
      stainedWindow(-3.0, 1.2, -0.4, Math.PI / 2, goldM) // gold, left side wall
      for (const x of [-2.2, 2.2]) {
        cyl(0.26, 0.3, 4.6, 0, 0, 0, x, -0.3, -1.1, colStone) // column shaft
        cyl(0.4, 0.34, 0.3, 0, 0, 0, x, -1.95, -1.1, colStone) // base
        boxG(0.7, 0.34, 0.7, x, 2.05, -1.1, colStone) // capital
      }
      pieces.push(tagged(new THREE.TorusGeometry(1.9, 0.18, 6, 24, Math.PI).translate(0, 2.0, -1.1), colStone)) // half-arch
      boxG(1.5, 0.4, 1.1, 0, -1.8, 0, colStone) // altar top step
      cyl(0.5, 0.56, 0.46, 0, 0, 0, 0, -1.84, 0, mullion) // dark altar socket
      pieces.push(tagged(new THREE.CircleGeometry(0.4, 28).rotateX(-Math.PI / 2).translate(0, -1.96, 0), emberM)) // THE KEY: flat ember bed, gem-occluded
      ico(0.11, 0.0, 0.16, -1.9, 0.0, emberM) // ember lump
      ico(0.1, 1.0, -0.17, -1.92, 0.13, emberM) // ember lump
      fireOn = true; firePos = [0, -1.7, 0]
      break
    }
    default: return null
  }
  // OBJECT 1: the hero gem (glass) at the origin, sized to sit inside the set
  const gemId = mat({ color: gemColorHex ? lin3(gemColorHex) : [1, 1, 1], ior: 1.45 + rank * 0.05, rough: 0.04, emissive: 0, kind: 2 })
  const gemGeo = tagged(getGeometry(family).clone().scale(1.4, 1.4, 1.4).rotateX(0.18), gemId)
  const setGeo = mergeGeometries(pieces, false)!
  const objects: PartyPtObject[] = [
    { geo: setGeo, pos: [0, 0, 0], baseYaw: 0, spin: false },
    { geo: gemGeo, pos: [0, 0, 0], baseYaw: 0, spin: false },
  ]
  const triCount = objects.reduce((s, o) => s + triCountOf(o.geo), 0)
  const hash = `dio|${kind}|${family}|${gemColorHex ?? 'clear'}|${rank}`
  return { objects, materials, firePos, fireOn, triCount, hash }
}

type PtGem = { family: string; colorLinear: [number, number, number]; rank: number }
/** A two-character CUTSCENE scene for the PT tracer: the speaker is larger + forward, the listener smaller + back.
 * No floor/campfire — a cinematic glass stage. Glass-only; meant to be rendered static + denoised (not orbited). */
export function buildCutscenePtScene(a: PtGem | null, b: PtGem | null, speakerA: boolean): PartyPtScene {
  const pieces: THREE.BufferGeometry[] = []
  const materials: PtMaterial[] = []
  const add = (gm: PtGem, side: -1 | 1, speaking: boolean) => {
    const matId = materials.length
    materials.push({ color: gm.colorLinear, ior: 1.45 + gm.rank * 0.05, rough: 0.04, emissive: 0, kind: 2 })
    const scale = speaking ? 1.0 : 0.62
    const z = speaking ? 0 : -0.35
    const g = getGeometry(gm.family).clone().scale(scale, scale, scale).rotateX(0.12).rotateY(side * 0.32).translate(side * 1.3, 0, z)
    pieces.push(tagged(g, matId))
  }
  if (a) add(a, -1, speakerA)
  if (b) add(b, 1, !speakerA)
  // the two talking gems are world-baked into ONE static object (identity transform) — a framed shot, no spin.
  const geo = mergeGeometries(pieces, false)!
  const objects: PartyPtObject[] = [{ geo, pos: [0, 0, 0], baseYaw: 0, spin: false }]
  const key = (g: PtGem | null) => (g ? `${g.family}:${g.colorLinear.map((c) => c.toFixed(2)).join('/')}:${g.rank}` : '-')
  return { objects, materials, firePos: [0, 0, 0], fireOn: false, triCount: triCountOf(geo), hash: `cut|${speakerA ? 'a' : 'b'}|${key(a)}|${key(b)}` }
}
