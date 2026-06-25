// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getGeometry, buildPartyPtScene, MAT_GEM0 } from './geometry'

// Every family in the content table — the geometry layer must produce a finite, non-empty, normalised mesh
// for each (AGENTS.md §3 "procedural geometry verification").
const ALL_FAMILIES = [
  'sphere', 'cube', 'tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron', 'cylinder', 'cone', 'disk',
  'ellipsoid', 'torus', 'mobius', 'genus2', 'hyperboloid', 'catenoid', 'helicoid', 'trefoil', 'monkey_saddle',
  'klein_bottle', 'roman_surface', 'boys_surface', 'whitney_umbrella', 'figure8_knot', 'torus_knot_2_5', 'gyroid', 'schwarz_p',
  'heptoroid', 'costa', 'borromean', 'seifert', 'lorenz', 'schwarz_d', 'triple_torus', 'tesseract', 'cell_16',
  'cell_24', 'cell_120', 'cell_600', 'klein_quartic', 'hopf', 'mazur',
  // Relics (procedural fallback geometry; real meshes load via the shared relics layer at runtime)
  'utah_teapot', 'stanford_bunny', 'benchy', 'stanford_dragon', 'suzanne', 'spot', 'endrass_octic', 'armadillo', 'lucy', 'csaszar',
  // NG+ metashapes + the fractal capstone cohort
  'clifford_torus', 'cable_knot', 'mandelbulb', 'mandelbox', 'julia', 'apollonian', 'kleinian',
  // warped classics (Ssr)
  'twisted_torus', 'cut_hollow_sphere', 'blobby',
]

// Euler characteristic V−E+F, welding by POSITION only (three duplicates verts per face for flat shading,
// so we strip normals/uv first or coincident verts won't merge). For a closed genus-g surface χ = 2−2g.
function eulerChar(geo: THREE.BufferGeometry): number {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', (geo.attributes.position as THREE.BufferAttribute).clone())
  if (geo.index) g.setIndex(geo.index.clone())
  const m = mergeVertices(g, 1e-4)
  const pos = m.attributes.position
  const idx = m.index
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const edges = new Set<number>()
  const key = (a: number, b: number) => (a < b ? a * 1e7 + b : b * 1e7 + a)
  for (let f = 0; f < triCount; f++) {
    const a = idx ? idx.getX(3 * f) : 3 * f
    const b = idx ? idx.getX(3 * f + 1) : 3 * f + 1
    const c = idx ? idx.getX(3 * f + 2) : 3 * f + 2
    edges.add(key(a, b))
    edges.add(key(b, c))
    edges.add(key(c, a))
  }
  return pos.count - edges.size + triCount
}

describe('geometry generators', () => {
  it.each(ALL_FAMILIES)('%s → finite, non-empty, normalised mesh', (fam) => {
    const g = getGeometry(fam)
    const pos = g.attributes.position as THREE.BufferAttribute
    expect(pos).toBeTruthy()
    expect(pos.count).toBeGreaterThan(2)
    const arr = pos.array as Float32Array
    for (let i = 0; i < arr.length; i++) {
      expect(Number.isFinite(arr[i])).toBe(true) // no NaN/Inf
    }
    g.computeBoundingSphere()
    const r = g.boundingSphere!.radius
    expect(r).toBeGreaterThan(0.4) // normalised to ~unit
    expect(r).toBeLessThan(1.6)
  })

  // The load-bearing check: the rendered topology matches the declared invariant.
  // Genus-0 closed solids → χ=2; the torus (genus 1) → χ=0.
  it.each([
    ['cube', 2],
    ['tetrahedron', 2],
    ['octahedron', 2],
    ['dodecahedron', 2],
    ['icosahedron', 2],
    ['torus', 0],
  ] as const)('%s has Euler characteristic %i', (fam, chi) => {
    expect(eulerChar(getGeometry(fam))).toBe(chi)
  })

  it('caches geometry by family (same instance)', () => {
    expect(getGeometry('sphere')).toBe(getGeometry('sphere'))
  })

  it('buildPartyPtScene merges a tagged world-space scene without mutating the geometry cache', () => {
    const gems = [
      { family: 'sphere', colorLinear: [0.2, 0.8, 0.6] as [number, number, number], rank: 2 },
      { family: 'cube', colorLinear: [0.6, 0.4, 0.9] as [number, number, number], rank: 1 },
    ]
    const scene = buildPartyPtScene(gems, [0.1, 0.18, 0.17], true)
    expect(scene.objects[0].geo.attributes.materialId).toBeTruthy() // per-vertex materialId survives the static-set merge
    expect(scene.objects.length).toBe(1 + gems.length) // static set + one object per gem
    expect(scene.objects[1].spin).toBe(true) // gems spin in place
    expect(scene.triCount).toBeGreaterThan(0)
    expect(scene.materials.length).toBe(3 + gems.length) // floor + flame + tree + 2 gems
    expect(scene.materials[MAT_GEM0].kind).toBe(2) // first gem is glass
    expect(scene.fireOn).toBe(true)
    // D6: the shared getGeometry cache instance is NEVER tagged (clone-always)
    expect((getGeometry('sphere').attributes as Record<string, unknown>).materialId).toBeUndefined()
  })
})
