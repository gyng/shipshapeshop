// The full universe of renderable shape families for the standalone viewer (/?viewer), independent of the
// game's curated roster. The renderers accept ANY family string and pick a path by membership: SDF/raymarch
// if `family in RAYMARCH_SHAPES`, 4D polytope if in `POLYTOPES_4D`, a downloaded relic mesh if in
// `RELIC_MODELS`, else the procedural mesh (geometry.ts `build()`).
//
// The exported sets below are imported (so SDF/4D/relic families auto-sync); the category grouping and the
// mesh-only list are hand-curated. Any KNOWN family that isn't categorised still shows up — it's appended to
// an "Other" group at runtime so the viewer can never silently hide a shape — and families.test.ts fails if
// that happens, nudging us to file it properly.
import { RAYMARCH_SHAPES } from '../three/RaymarchGem'
import { POLYTOPES_4D } from '../three/Polytope4D'
import { RELIC_MODELS } from '../three/relics'
import { glyphOf } from '../content/glyphs'

export type RenderPath = 'sdf' | '4d' | 'relic' | 'mesh'
export interface FamilyEntry { family: string; label: string; glyph: string; category: string; path: RenderPath }

// Mirrors HeroView's path selection (RaymarchGem first, then Polytope4D, then relic mesh, else mesh).
export function pathOf(family: string): RenderPath {
  if (family in RAYMARCH_SHAPES) return 'sdf'
  if (POLYTOPES_4D.has(family)) return '4d'
  if (family in RELIC_MODELS) return 'relic'
  return 'mesh'
}

const prettify = (f: string) => f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// Mesh-only families handled by geometry.ts build() that aren't in any exported set (no exported list exists
// for them, so this is the one hand-maintained roster — keep it in sync if build() gains a new mesh family).
const MESH_ONLY = [
  'monkey_saddle', 'boys_surface', 'heptoroid', 'seifert', 'lorenz', 'hopf', 'utah_teapot', 'benchy',
  'stanford_dragon', 'suzanne', 'spot', 'cow', 'armadillo', 'lucy', 'csaszar', 'dini', 'clifford_torus', 'cable_knot',
]

const CATEGORIES: { name: string; families: string[] }[] = [
  { name: 'Primitives', families: ['sphere', 'cube', 'cylinder', 'cone', 'disk', 'ellipsoid', 'torus'] },
  { name: 'Platonic solids', families: ['tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron'] },
  { name: 'Knots & links', families: ['trefoil', 'figure8_knot', 'torus_knot_2_5', 'torus_knot_2_7', 'borromean', 'seifert', 'hopf', 'cable_knot'] },
  { name: 'Genus surfaces', families: ['genus2', 'triple_torus', 'klein_quartic'] },
  { name: 'Non-orientable', families: ['mobius', 'klein_bottle', 'roman_surface', 'boys_surface', 'whitney_umbrella'] },
  { name: 'Minimal surfaces (TPMS)', families: ['gyroid', 'schwarz_p', 'schwarz_d'] },
  { name: 'Parametric surfaces', families: ['catenoid', 'helicoid', 'hyperboloid', 'monkey_saddle', 'dini', 'costa', 'clifford_torus', 'helix', 'mazur'] },
  { name: 'Fractals', families: ['mandelbulb', 'mandelbox', 'julia', 'apollonian', 'kleinian', 'menger', 'sierpinski'] },
  { name: '4D polytopes', families: ['tesseract', 'cell_16', 'cell_24', 'cell_120', 'cell_600'] },
  { name: '4D cross-sections', families: ['spherinder_slice', 'duocylinder', 'cell24_section', 'ditorus'] },
  { name: 'Algebraic & attractors', families: ['barth_sextic', 'endrass_octic', 'hyperbolic_honeycomb', 'aizawa_attractor', 'lorenz', 'spike', 'twisted_torus', 'cut_hollow_sphere', 'blobby'] },
  { name: 'Relics', families: ['utah_teapot', 'stanford_bunny', 'stanford_dragon', 'benchy', 'spot', 'cow', 'suzanne', 'armadillo', 'lucy', 'csaszar', 'heptoroid'] },
]

// Every family the renderers know about — the set the registry must cover.
export const KNOWN_FAMILIES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(RAYMARCH_SHAPES), ...POLYTOPES_4D, ...Object.keys(RELIC_MODELS), ...MESH_ONLY,
])

const entry = (family: string, category: string): FamilyEntry => ({ family, label: prettify(family), glyph: glyphOf(family), category, path: pathOf(family) })

export const FAMILY_CATEGORIES: { name: string; families: FamilyEntry[] }[] = (() => {
  const seen = new Set<string>()
  const cats = CATEGORIES.map((c) => ({ name: c.name, families: c.families.map((f) => { seen.add(f); return entry(f, c.name) }) }))
  const orphans = [...KNOWN_FAMILIES].filter((f) => !seen.has(f))
  if (orphans.length) cats.push({ name: 'Other', families: orphans.map((f) => entry(f, 'Other')) })
  return cats
})()

export const ALL_FAMILIES: FamilyEntry[] = FAMILY_CATEGORIES.flatMap((c) => c.families)
