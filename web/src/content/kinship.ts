// Shape "shipping" / kinship — the relationships between shapes (duals, soulmates, parent/child via forge,
// and families). Shown in the inspector; when you own both partners they light up as "united" (♥). Pure
// lore/display — no economy effect (yet). Keyed by family.

export interface Kin {
  with: string // partner family ('self' relationships use the same family)
  type: string // short relationship label
  note: string // one-line flavour
}

export const KINSHIP: Record<string, Kin[]> = {
  // Platonic duals
  cube: [{ with: 'octahedron', type: 'dual', note: 'Swap faces ↔ corners and you become each other.' }],
  octahedron: [{ with: 'cube', type: 'dual', note: 'Swap faces ↔ corners and you become each other.' }],
  dodecahedron: [{ with: 'icosahedron', type: 'dual', note: '12 faces ↔ 20 — perfect mirrors.' }],
  icosahedron: [{ with: 'dodecahedron', type: 'dual', note: '20 faces ↔ 12 — perfect mirrors.' }],
  tetrahedron: [{ with: 'tetrahedron', type: 'self-dual', note: 'Its own dual — it needs no twin.' }],
  // 4D duals
  tesseract: [{ with: 'cell_16', type: 'dual', note: 'The 4-cube and its cross-polytope dual.' }],
  cell_16: [{ with: 'tesseract', type: 'dual', note: 'The cross-polytope dual of the 4-cube.' }],
  cell_120: [{ with: 'cell_600', type: 'dual', note: 'The crown and the storm — duals in 4D.' }],
  cell_600: [{ with: 'cell_120', type: 'dual', note: 'Dual to the 120-cell.' }],
  cell_24: [{ with: 'cell_24', type: 'self-dual', note: 'Self-dual — unique to four dimensions.' }],
  // soulmates (one continuously deforms into / completes the other)
  catenoid: [{ with: 'helicoid', type: 'soulmate', note: 'Bend one into the other without tearing — the same minimal surface.' }],
  helicoid: [{ with: 'catenoid', type: 'soulmate', note: 'The catenoid’s spiral twin.' }],
  trefoil: [{ with: 'seifert', type: 'soulmate', note: 'A knot and the membrane that spans it — incomplete alone.' }],
  seifert: [{ with: 'trefoil', type: 'soulmate', note: 'Hand me a knot and I complete it.' }],
  // parent / child (the forge connected sums)
  mobius: [{ with: 'klein_bottle', type: 'parent', note: 'Two Möbius strips, glued, make a Klein bottle.' }],
  klein_bottle: [{ with: 'mobius', type: 'child', note: 'Born of two Möbius strips sewn together.' }, { with: 'rp2', type: 'kin', note: 'Both non-orientable, no inside.' }],
  torus: [{ with: 'genus2', type: 'parent', note: 'Two tori, joined, make a genus-2 surface.' }, { with: 'twisted_torus', type: 'kin', note: 'The same donut, given a couple of turns.' }],
  genus2: [{ with: 'torus', type: 'child', note: 'Two donuts, connected.' }, { with: 'triple_torus', type: 'kin', note: 'One more hole along.' }],
  triple_torus: [{ with: 'genus2', type: 'kin', note: 'Genus 2’s tidier sibling.' }],
  // families
  rp2: [{ with: 'boys_surface', type: 'kin', note: 'The same surface — Boy’s is its graceful immersion.' }, { with: 'cross_cap', type: 'kin', note: 'Same soul, pinched presentation.' }],
  boys_surface: [{ with: 'rp2', type: 'kin', note: 'A poised immersion of the projective plane.' }],
  cross_cap: [{ with: 'rp2', type: 'kin', note: 'The honest, pinched RP².' }],
  gyroid: [{ with: 'schwarz_p', type: 'kin', note: 'Triply-periodic minimal surfaces — the lattice family.' }, { with: 'schwarz_d', type: 'kin', note: 'TPMS cousins.' }],
  schwarz_p: [{ with: 'gyroid', type: 'kin', note: 'TPMS family.' }, { with: 'schwarz_d', type: 'kin', note: 'Cubic minimal cousins.' }],
  schwarz_d: [{ with: 'gyroid', type: 'kin', note: 'TPMS family.' }, { with: 'schwarz_p', type: 'kin', note: 'Cubic minimal cousins.' }],
  hopf: [{ with: 'borromean', type: 'kin', note: 'Links and fibrations — the interlinked family.' }],
  borromean: [{ with: 'hopf', type: 'kin', note: 'Three rings, no two linked — yet inseparable.' }],
  sphere: [{ with: 'mazur', type: 'kin', note: 'Both shrink to a point — round at heart.' }, { with: 'cut_hollow_sphere', type: 'parent', note: 'Slice me open and keep one cap — a bowl.' }, { with: 'blobby', type: 'kin', note: 'Give me six arms and I become Blobby.' }],
  mazur: [{ with: 'sphere', type: 'kin', note: 'Looks monstrous; is secretly a ball, like Pip.' }],
  // warped classics (Ssr)
  twisted_torus: [{ with: 'torus', type: 'kin', note: 'A torus, with my ribbon wound twice around.' }],
  cut_hollow_sphere: [{ with: 'sphere', type: 'child', note: 'A sphere opened into a bowl with a rim.' }],
  blobby: [{ with: 'sphere', type: 'kin', note: 'A sphere that sprouted arms — still round at heart.' }],
  // the fractal family (Transcendent)
  mandelbulb: [{ with: 'mandelbox', type: 'kin', note: 'Bulb and box — both born of the Mandelbrot iteration.' }, { with: 'julia', type: 'kin', note: 'Sweep the seed (me) or fix it (Jules) — the same machine.' }],
  mandelbox: [{ with: 'mandelbulb', type: 'kin', note: 'The boxy, architectural cousin of the Mandelbulb.' }],
  julia: [{ with: 'mandelbulb', type: 'kin', note: 'Fix the Mandelbrot’s seed and you get me.' }],
  apollonian: [{ with: 'kleinian', type: 'kin', note: 'Limit sets — packed spheres and mirrored spires.' }],
  kleinian: [{ with: 'apollonian', type: 'kin', note: 'A mirror-group cousin to the sphere-packing gasket.' }],
}
