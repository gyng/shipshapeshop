// DISPLAY for each shape's topology effect (Rust computes the actual numbers — this mirrors the archetype
// sets in core/src/content.rs for the inspector card only). Stars (★) scale every effect's magnitude.
const NONORIENTABLE = new Set(['mobius', 'klein_bottle', 'rp2', 'boys_surface', 'cross_cap', 'klein_quartic'])
const KNOTS = new Set(['trefoil', 'figure8_knot', 'torus_knot_2_5', 'torus_knot_2_7', 'borromean', 'seifert', 'hopf'])
const POLY4D = new Set(['tesseract', 'cell_16', 'cell_24', 'cell_120', 'cell_600'])

export function shapeEffect(family: string, genus: number, eulerCost: number): { name: string; desc: string; icon: string } {
  if (NONORIENTABLE.has(family)) return { name: 'Orientability Overdrive', icon: '🔄', desc: 'One-sided, so it runs in overdrive — a flat production boost that grows with ★.' }
  if (KNOTS.has(family)) return { name: 'Entanglement', icon: '🪢', desc: 'Lifts the shapes placed directly beside it on the floor — arrangement matters. Grows with ★.' }
  if (POLY4D.has(family)) return { name: 'Cross-Dimension', icon: '🧩', desc: 'Inert in 3D; once you Recrystallize into the 4th dimension it grants a global bonus. Grows with ★.' }
  if (eulerCost === 0) return { name: 'Euler Ballast', icon: '⚓', desc: 'A χ=2 anchor — steadies the whole floor with a small team-wide bonus.' }
  if (genus >= 1) return { name: 'Handle Lanes', icon: '🌀', desc: `${genus} hole${genus > 1 ? 's' : ''} = ${genus} parallel production lane${genus > 1 ? 's' : ''}; ★ widens them.` }
  return { name: 'Steady', icon: '✦', desc: 'A dependable producer — no special trick, just reliable Flux.' }
}
