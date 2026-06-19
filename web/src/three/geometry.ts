import * as THREE from 'three'
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import helvetiker from 'three/examples/fonts/helvetiker_regular.typeface.json'

const FONT = new FontLoader().parse(helvetiker as unknown as Parameters<FontLoader['parse']>[0])

// Family → geometry. Built-ins + parametric surfaces where they're exact; distinctive stand-ins for the
// genuinely hard ones (true TPMS marching-cubes + real 4D projection are a later M2 deepening — for now the
// 4D polytopes render as their 3D "shadow" polyhedron, which is honest and reads well). Everything is
// normalised to ~unit radius and centred, and cached by family.

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

function mergedTori(count: number, spread: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const g = new THREE.TorusGeometry(0.6, 0.22, 20, 48)
    g.translate((i - (count - 1) / 2) * spread, 0, 0)
    parts.push(g)
  }
  return mergeGeometries(parts)!
}

// Borromean-style: three interlocked rings on different planes.
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
    case 'klein_bottle': return parametric(kleinFig8(1), 100, 40)
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
    case 'hopf': return linkedRings()
    case 'mazur': return new THREE.SphereGeometry(1, 40, 28) // the "monster" is secretly a ball
    // ── Relics: famous CG models. The Utah Teapot is exact (three's TeapotGeometry); the scanned/modelled
    // ones are distinctive placeholders until real .glb assets land in /public/models (see README).
    case 'utah_teapot': return new TeapotGeometry(0.62, 12)
    case 'stanford_bunny': return new THREE.CapsuleGeometry(0.5, 0.55, 8, 18)
    case 'benchy': return new THREE.BoxGeometry(1.7, 0.8, 0.95)
    case 'stanford_dragon': return new THREE.TorusKnotGeometry(0.58, 0.2, 200, 20, 3, 7)
    case 'suzanne': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.0, 0.88, 1.12); return g }
    case 'spot': { const g = new THREE.SphereGeometry(1, 28, 18); g.scale(1.35, 0.8, 0.9); return g }
    case 'hello_world': return new TextGeometry('Hello, World!', { font: FONT, size: 0.6, depth: 0.2, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2 })
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
