// Lightweight "chibi" glyphs — a recognisable emoji per shape family for the scannable lists (Gallery tiles,
// Engine storage). Many are apt (🍩 torus, 🥨 genus-2, 🦋 Lorenz, 👑 120-cell, 👹 Mazur, 👼 Lucy); the abstract
// ones are best-effort. Shown only for OWNED shapes (so undiscovered identities aren't spoiled).
export const SHAPE_GLYPH: Record<string, string> = {
  // Common
  sphere: '⚪', cube: '🧊', tetrahedron: '🔺', octahedron: '💎', dodecahedron: '⚽', icosahedron: '🎲',
  cylinder: '🥫', cone: '🍦', disk: '🥏', ellipsoid: '🥚',
  // Rare
  torus: '🍩', mobius: '♾️', genus2: '🥨', hyperboloid: '⏳', catenoid: '⌛', helicoid: '🌀', trefoil: '🪢', monkey_saddle: '🐴',
  // Epic
  klein_bottle: '🍶', rp2: '🎭', boys_surface: '🎀', cross_cap: '🧢', figure8_knot: '🎱', torus_knot_2_5: '🪢', gyroid: '🧽', schwarz_p: '🧱',
  // SSR
  heptoroid: '🕸️', costa: '🕳️', borromean: '🔗', seifert: '🍥', lorenz: '🦋', schwarz_d: '🪟', triple_torus: '🥯',
  // UR
  tesseract: '🧩', cell_16: '🔷', cell_24: '🔮', cell_120: '👑', cell_600: '⛈️', klein_quartic: '🎼', hopf: '🪐', mazur: '👹',
  // Relics
  utah_teapot: '🫖', stanford_bunny: '🐰', benchy: '🚤', stanford_dragon: '🐉', suzanne: '🐵', spot: '🐮', cow: '🐄', armadillo: '🦔', lucy: '👼', csaszar: '🍩',
}

export const glyphOf = (family: string): string => SHAPE_GLYPH[family] ?? '✦'
