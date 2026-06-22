// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { CODEX } from './content/codex'

// Canonical family list — mirrors core/src/content.rs SHAPES (the Rust side enforces count + rarity-range
// partition invariants in content.rs tests). This guards the web layer: codex coverage + model assets.
const FAMILIES = [
  // Common
  'sphere', 'cube', 'tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron', 'cylinder', 'cone', 'disk', 'ellipsoid',
  // Rare
  'torus', 'mobius', 'genus2', 'hyperboloid', 'catenoid', 'helicoid', 'trefoil', 'monkey_saddle',
  // Epic
  'klein_bottle', 'roman_surface', 'boys_surface', 'whitney_umbrella', 'figure8_knot', 'torus_knot_2_5', 'gyroid', 'schwarz_p',
  // SSR
  'heptoroid', 'costa', 'borromean', 'seifert', 'lorenz', 'schwarz_d', 'triple_torus', 'twisted_torus', 'cut_hollow_sphere', 'blobby',
  // UR
  'tesseract', 'cell_16', 'cell_24', 'cell_120', 'cell_600', 'klein_quartic', 'hopf', 'mazur',
  // Relics (Reference Wing)
  'utah_teapot', 'stanford_bunny', 'benchy', 'stanford_dragon', 'suzanne', 'spot', 'endrass_octic', 'armadillo', 'lucy', 'csaszar',
  // Relics — fractals & classical surfaces (procedurally generated)
  'menger', 'sierpinski', 'dini', 'torus_knot_2_7',
  // NG+ metashapes (Meta) + the Transcendent fractal capstone cohort
  'clifford_torus', 'cable_knot', 'mandelbulb', 'mandelbox', 'julia', 'apollonian', 'kleinian',
  // NG+ cohort expansion: 4D cross-sections (Meta) + algebraic/attractor jewels (Transcendent)
  'spherinder_slice', 'duocylinder', 'cell24_section', 'ditorus', 'hyperbolic_honeycomb', 'aizawa_attractor', 'barth_sextic',
]

// Relic families backed by a real downloaded mesh (loaded once by the shared relics layer → src/three/relics.ts
// RELIC_MODELS, then used across the gallery, Orrery, dioramas, and hero).
const MODEL_FILES_ON_DISK = [
  'bunny.ply', 'spot.obj', 'armadillo.ply', 'lucy.ply', 'dragon.ply', 'heptoroid.ply', 'csaszar.obj', 'benchy.ply', 'suzanne.obj',
]

describe('shape content validation', () => {
  it('has 72 families with no duplicates', () => {
    expect(FAMILIES.length).toBe(72)
    expect(new Set(FAMILIES).size).toBe(72)
  })

  it('every family has a complete codex entry', () => {
    for (const f of FAMILIES) {
      const c = CODEX[f]
      expect(c, `missing codex entry for "${f}"`).toBeTruthy()
      expect(c.term.length, `codex.term too short for "${f}"`).toBeGreaterThan(3)
      expect(c.blurb.length, `codex.blurb too short for "${f}"`).toBeGreaterThan(3)
      expect(c.bond.length, `codex.bond too short for "${f}"`).toBeGreaterThan(3)
    }
  })

  it('has no stray codex entries for removed/unknown families', () => {
    for (const key of Object.keys(CODEX)) {
      expect(FAMILIES.includes(key), `codex has unknown family "${key}"`).toBe(true)
    }
  })

  it('every referenced model mesh exists on disk', () => {
    for (const file of MODEL_FILES_ON_DISK) {
      expect(existsSync(`public/models/${file}`), `missing model file public/models/${file}`).toBe(true)
    }
  })
})
