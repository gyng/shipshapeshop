// DISPLAY for each shape's topology effect (Rust computes the actual numbers — this mirrors the archetype
// sets in core/src/content.rs for the inspector card only). Stars (★) scale every effect's magnitude.
const NONORIENTABLE = new Set(['mobius', 'klein_bottle', 'rp2', 'boys_surface', 'cross_cap', 'klein_quartic'])
const KNOTS = new Set(['trefoil', 'figure8_knot', 'torus_knot_2_5', 'torus_knot_2_7', 'borromean', 'seifert', 'hopf', 'cable_knot'])
const POLY4D = new Set(['tesseract', 'cell_16', 'cell_24', 'cell_120', 'cell_600', 'clifford_torus'])

// `special` = has a real skill; false is the "no special effect" fallback (the inspector says so plainly).
export function shapeEffect(family: string, genus: number, eulerCost: number): { name: string; desc: string; icon: string; special: boolean } {
  if (NONORIENTABLE.has(family)) return { name: 'Orientability Overdrive', icon: '🔄', desc: 'One-sided, so it runs in overdrive — a flat production boost that grows with ★.', special: true }
  if (KNOTS.has(family)) return { name: 'Entanglement', icon: '🪢', desc: 'Lifts the shapes placed directly beside it on the floor — arrangement matters. Grows with ★.', special: true }
  if (POLY4D.has(family)) return { name: 'Cross-Dimension', icon: '🧩', desc: 'Inert in 3D; once you Ascend into the 4th dimension it grants a global bonus. Grows with ★.', special: true }
  if (eulerCost === 0) return { name: 'Euler Ballast', icon: '⚓', desc: 'A solid, hole-free anchor — steadies the whole floor with a small team-wide bonus.', special: true }
  if (genus >= 1) return { name: 'Handle Lanes', icon: '🌀', desc: `${genus} hole${genus > 1 ? 's' : ''} → it produces ${genus} stream${genus > 1 ? 's' : ''} at once; ★ widens them.`, special: true }
  return { name: 'No special skill', icon: '✦', desc: 'No special trick — just a dependable, steady producer of Flux.', special: false }
}

// How a shape behaves on the Orrery flux floor — qualitative mirror of core::content emit_kind + interaction
// (the actual rates live in Rust). `emit` = how it fires flux; `act` = what it does to flux passing through it.
const ROTATING = new Set(['sphere', 'ellipsoid', 'disk'])
const SCATTER = new Set(['torus', 'hopf', 'cylinder', 'lorenz', 'monkey_saddle', 'gyroid', 'schwarz_p', 'schwarz_d', 'costa', 'catenoid', 'helicoid'])
const AMPLIFY = new Set(['sphere', 'ellipsoid', 'cell_120', 'cell_600', 'tesseract', 'cell_16', 'cell_24', 'hopf', 'borromean', 'seifert', 'trefoil', 'figure8_knot', 'torus_knot_2_5', 'torus_knot_2_7'])

export type EmitKind = 'beam' | 'rotating' | 'scatter' | 'pulse'
export type ActKind = 'pass' | 'multiply' | 'redirect'

export function fluxPattern(family: string, genus: number): { emit: EmitKind; emitLabel: string; act: ActKind; actLabel: string } {
  const emit: EmitKind = ROTATING.has(family) ? 'rotating' : SCATTER.has(family) ? 'scatter' : POLY4D.has(family) ? 'pulse' : 'beam'
  const emitLabel = { beam: 'Beams flux straight ahead.', rotating: 'Sweeps flux around like a lighthouse.', scatter: 'Scatters flux to all six sides at once.', pulse: 'Fires flux in timed bursts.' }[emit]
  let act: ActKind = 'pass'
  let actLabel = 'Lets flux pass straight through.'
  if (NONORIENTABLE.has(family)) {
    act = 'redirect'
    actLabel = family === 'mobius' ? 'Bends flux passing through by a half-twist.' : 'Flips flux passing through right around.'
  } else if (AMPLIFY.has(family) || genus >= 1) {
    act = 'multiply'
    actLabel = 'Amplifies the flux that passes through it.'
  }
  return { emit, emitLabel, act, actLabel }
}
