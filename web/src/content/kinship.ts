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
  cell_24: [
    { with: 'cell_24', type: 'self-dual', note: 'Self-dual — unique to four dimensions.' },
    { with: 'cell24_section', type: 'parent', note: 'Cubocta is my equatorial waistline — one clean cut of me.' },
  ],
  clifford_torus: [{ with: 'duocylinder', type: 'kin', note: 'My cornered cousin — same flat 4D torus, square cross-section.' }],
  // soulmates (one continuously deforms into / completes the other)
  catenoid: [{ with: 'helicoid', type: 'soulmate', note: 'Bend one into the other without tearing — the same minimal surface.' }],
  helicoid: [{ with: 'catenoid', type: 'soulmate', note: 'The catenoid’s spiral twin.' }],
  trefoil: [{ with: 'seifert', type: 'soulmate', note: 'A knot and the membrane that spans it — incomplete alone.' }],
  seifert: [{ with: 'trefoil', type: 'soulmate', note: 'Hand me a knot and I complete it.' }],
  // parent / child (the forge connected sums)
  mobius: [{ with: 'klein_bottle', type: 'parent', note: 'Two Möbius strips, glued, make a Klein bottle.' }],
  klein_bottle: [{ with: 'mobius', type: 'child', note: 'Born of two Möbius strips sewn together.' }, { with: 'roman_surface', type: 'kin', note: 'Both non-orientable, no inside.' }],
  torus: [{ with: 'genus2', type: 'parent', note: 'Two tori, joined, make a genus-2 surface.' }, { with: 'twisted_torus', type: 'kin', note: 'The same donut, given a couple of turns.' }, { with: 'ditorus', type: 'parent', note: 'Bore a tunnel through my dough and you get Dito — a torus with a hole through its hole.' }],
  genus2: [{ with: 'torus', type: 'child', note: 'Two donuts, connected.' }, { with: 'triple_torus', type: 'kin', note: 'One more hole along.' }, { with: 'ditorus', type: 'kin', note: 'Two holes apiece — mine side by side, Dito’s threaded one through the other.' }],
  triple_torus: [{ with: 'genus2', type: 'kin', note: 'Genus 2’s tidier sibling.' }],
  // families — ℝP² and its self-crossing kin
  roman_surface: [{ with: 'boys_surface', type: 'kin', note: 'The same ℝP² — Boy’s is its graceful immersion; mine the four-lobed quartic.' }, { with: 'whitney_umbrella', type: 'kin', note: 'Both wear their self-crossings openly — my three creases, Brolly’s one pinch.' }],
  boys_surface: [{ with: 'roman_surface', type: 'kin', note: 'A poised immersion of the same projective plane Romy draws as a quartic.' }],
  whitney_umbrella: [{ with: 'roman_surface', type: 'kin', note: 'Romy crosses herself along three creases; I do it at one pinch-point.' }],
  gyroid: [{ with: 'schwarz_p', type: 'kin', note: 'Triply-periodic minimal surfaces — the lattice family.' }, { with: 'schwarz_d', type: 'kin', note: 'TPMS cousins.' }],
  schwarz_p: [{ with: 'gyroid', type: 'kin', note: 'TPMS family.' }, { with: 'schwarz_d', type: 'kin', note: 'Cubic minimal cousins.' }],
  schwarz_d: [{ with: 'gyroid', type: 'kin', note: 'TPMS family.' }, { with: 'schwarz_p', type: 'kin', note: 'Cubic minimal cousins.' }],
  hopf: [{ with: 'borromean', type: 'kin', note: 'Links and fibrations — the interlinked family.' }],
  borromean: [{ with: 'hopf', type: 'kin', note: 'Three rings, no two linked — yet inseparable.' }],
  sphere: [{ with: 'mazur', type: 'kin', note: 'Both shrink to a point — round at heart.' }, { with: 'cut_hollow_sphere', type: 'parent', note: 'Slice me open and keep one cap — a bowl.' }, { with: 'blobby', type: 'kin', note: 'Give me six arms and I become Blobby.' }, { with: 'spherinder_slice', type: 'kin', note: 'Sweep me into 4D and slice — Slabby, my big-sib echo.' }],
  mazur: [{ with: 'sphere', type: 'kin', note: 'Looks monstrous; is secretly a ball, like Pip.' }],
  // warped classics (Ssr)
  twisted_torus: [{ with: 'torus', type: 'kin', note: 'A torus, with my ribbon wound twice around.' }, { with: 'ditorus', type: 'kin', note: 'Both of us are donuts with a twist — mine in the ribbon, Dito’s a whole extra tunnel.' }],
  cut_hollow_sphere: [{ with: 'sphere', type: 'child', note: 'A sphere opened into a bowl with a rim.' }],
  blobby: [{ with: 'sphere', type: 'kin', note: 'A sphere that sprouted arms — still round at heart.' }],
  // the fractal family (Transcendent)
  mandelbulb: [{ with: 'mandelbox', type: 'kin', note: 'Bulb and box — both born of the Mandelbrot iteration.' }, { with: 'julia', type: 'kin', note: 'Sweep the seed (me) or fix it (Jules) — the same machine.' }],
  mandelbox: [{ with: 'mandelbulb', type: 'kin', note: 'The boxy, architectural cousin of the Mandelbulb.' }],
  julia: [{ with: 'mandelbulb', type: 'kin', note: 'Fix the Mandelbrot’s seed and you get me.' }],
  apollonian: [{ with: 'kleinian', type: 'kin', note: 'Limit sets — packed spheres and mirrored spires.' }, { with: 'hyperbolic_honeycomb', type: 'kin', note: 'Vault folds space the way I pack it — sphere-inversion, repeated forever.' }],
  kleinian: [{ with: 'apollonian', type: 'kin', note: 'A mirror-group cousin to the sphere-packing gasket.' }, { with: 'hyperbolic_honeycomb', type: 'kin', note: 'A fold-geometry cousin — mirror-spheres and an endless arcade of arches.' }],
  // the two cows — the lab staple and the conformal-maps mascot
  spot: [{ with: 'cow', type: 'kin', note: 'Two cows of computer graphics — Mooky’s the lab staple, I’m the one mapped with love.' }],
  cow: [{ with: 'spot', type: 'kin', note: 'Two cows of computer graphics — Spot got parameterised; I just got rendered, everywhere.' }],
  // chaos — strange attractors
  lorenz: [{ with: 'aizawa_attractor', type: 'kin', note: 'The chaos cousins — determined, never repeating; we just spin different funnels.' }],
  // ── NG+ cohort (Meta / Transcendent slices & lattices) ──────────────────────────────
  // Meta — 4D slices & polytopes
  spherinder_slice: [{ with: 'sphere', type: 'kin', note: 'Pip, swept into 4D and sliced — most of me sits one dimension over.' }],
  duocylinder: [
    { with: 'clifford_torus', type: 'kin', note: 'Cliff with corners — two circles spun at right angles, a square ridge.' },
    { with: 'torus', type: 'kin', note: 'A flat 4D torus — the genus-1 "way through", one dimension up.' },
  ],
  cell24_section: [
    { with: 'cell_24', type: 'child', note: 'One clean equatorial cut of the self-dual 24-cell.' },
    { with: 'cube', type: 'kin', note: 'Half a cube, half an octahedron — where Boxy and Spike share corners.' },
    { with: 'octahedron', type: 'kin', note: 'The waistline where cube-and-octahedron duality fuses.' },
  ],
  ditorus: [
    { with: 'torus', type: 'child', note: 'A torus with a tunnel bored through its dough — Dot, with a hole through her hole.' },
    { with: 'twisted_torus', type: 'kin', note: 'Donuts with a twist — mine an extra tunnel, hers a wound ribbon.' },
    { with: 'genus2', type: 'kin', note: 'Both genus 2 — her holes sit side by side; mine thread one through the other.' },
  ],
  // Transcendent — algebraic jewels, a hyperbolic fold, and an attractor
  hyperbolic_honeycomb: [
    { with: 'apollonian', type: 'kin', note: 'Sphere-inversion fold-geometry — the gasket packs, I tessellate, both forever.' },
    { with: 'kleinian', type: 'kin', note: 'A mirror-group cousin — endless arches where the spheres agree to meet.' },
  ],
  aizawa_attractor: [
    { with: 'lorenz', type: 'kin', note: 'The chaos cousins — same nudge, same start, never the same path. Different funnels, is all.' },
  ],
  barth_sextic: [
    { with: 'endrass_octic', type: 'kin', note: 'Record-holders both — my 65 pinch-points to Sexta’s 168, the most each degree allows.' },
    { with: 'icosahedron', type: 'kin', note: 'I wear an icosahedron’s full symmetry — twenty-faced order, sixty-five times dimpled.' },
  ],
  endrass_octic: [
    { with: 'barth_sextic', type: 'kin', note: 'Algebraic record-holders — Sixsy’s 65 nodes to my 168, each the most its degree allows.' },
  ],
}
