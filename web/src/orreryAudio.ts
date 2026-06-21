// ── Orrery music — the PURE shape→sound derivation library ───────────────────────────────────────────────
// The numbers here are derived from shape TRUTH (descriptors authored in Rust): a shape's pitch and instrument
// are pure functions of its topology. Notes are pentatonic BY CONSTRUCTION (you index a scale table — an
// out-of-scale pitch is unrepresentable). The continuous lofi bed in `orreryBed.ts`/`orreryBedDriver.tsx`
// consumes `SCALE`, `instrumentForShape`, and the descriptor types from here. (No playback lives in this file:
// the old on-intersect chord synth was removed when the orrery dropped meeting-triggered sound.)

const ROOT_MIDI = 57 // A3 — a calm register that sits under the ASMR layer
const PENTATONIC = [0, 2, 4, 7, 9] // major-pentatonic scale degrees (no semitone clashes ⇒ always consonant)

// ~3 octaves of scale tones; every emitted pitch is drawn from here.
export const SCALE: number[] = (() => {
  const out: number[] = []
  for (let oct = 0; oct < 3; oct++) for (const d of PENTATONIC) out.push(ROOT_MIDI + oct * 12 + d)
  return out
})()
export const SCALE_SET: ReadonlySet<number> = new Set(SCALE)

// Gate constants (the design can't violate these — pinned by tests).
export const MAX_POLY = 4 // notes per meeting chord
export const GLOBAL_POLY = 10 // simultaneous live voices across all meetings
export const VOICE_GAIN = 0.12 // peak gain per voice (pre-master)
export const LOUDNESS_CEILING = 0.6 // a max chord's summed pre-master gain must stay under this
/** Pre-master summed peak for n requested voices (capped at MAX_POLY) — used by the loudness gate test. */
export const mixPeak = (nVoices: number) => Math.min(Math.max(0, nVoices), MAX_POLY) * VOICE_GAIN

const mod = (n: number, m: number) => ((n % m) + m) % m
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// ── Eigenmode instrument: the TIMBRE is derived from the shape's DESCRIPTOR, not its id ───────────────────
// A shape "rings" at its own modes, so its instrument is a pure function of the declared invariants (truth,
// authored in Rust): family → which instrument, genus → register, orientability → the mirror "flip", Euler
// cost → brightness, rarity → space. The id only seeds tiny intra-family variety so two cubes aren't clones.
// Backend-agnostic: today an InstrumentVoice renders on oscillators; the SAME voice maps to a Tone.Sampler
// patch later (see `patch`) with zero change to the derivation.

/** The minimal shape descriptor the audio layer reads (ShapeRow is a superset). */
export interface AudioShape {
  id: number
  family: string
  genus: number
  rarity: string
  euler_cost: number
  orientable?: boolean // optional: until the WASM is rebuilt the field is absent ⇒ treat as orientable
}

export interface InstrumentVoice {
  patch: string // family-derived instrument id — the future Tone.Sampler sample set ("rhodes","nylon"…)
  wave: OscillatorType // the current oscillator-backend timbre (sine/triangle-leaning ⇒ stays ASMR-gentle)
  detune: number // cents — id-seeded micro-detune so same-family shapes differ slightly
  bright: number // 0..1 lowpass openness, from Euler cost (exotic shapes shimmer brighter)
  space: number // 0..1 reverb/tail amount, from rarity (rarer = more spacious)
  flip: boolean // non-orientable ⇒ a mirrored "chorus" double (the Orientability flip, made audible)
}

// Hand-picked hero instruments (by family) — warm/plucky/glassy to match each character; everyone else
// derives a stable instrument from a hash of the family. Waves stay sine/triangle so the orrery never bites.
const PATCH: Record<string, { patch: string; wave: OscillatorType }> = {
  sphere: { patch: 'rhodes', wave: 'sine' }, // Pip — warm e-piano
  cube: { patch: 'mallet', wave: 'triangle' }, // Boxy — boxy mallet
  tetrahedron: { patch: 'pluck', wave: 'triangle' },
  octahedron: { patch: 'glass', wave: 'triangle' }, // Spike — bright
  dodecahedron: { patch: 'keys', wave: 'sine' }, // Dodi — courtly keys
  icosahedron: { patch: 'keys', wave: 'sine' },
  torus: { patch: 'pad', wave: 'sine' },
  trefoil: { patch: 'nylon', wave: 'triangle' }, // Trey — plucked knot
  klein_bottle: { patch: 'pad', wave: 'sine' }, // Kleine — burbling pad
  mobius: { patch: 'pad', wave: 'triangle' }, // Mo — mirror pad
  tesseract: { patch: 'celesta', wave: 'sine' }, // Tess — glassy 4D
  cell_16: { patch: 'glass', wave: 'sine' }, // Hex — angular
  lorenz: { patch: 'bell', wave: 'sine' }, // Lorrie — shimmer bell
  utah_teapot: { patch: 'rhodes', wave: 'sine' },
  // warped classics (Ssr) — timbre echoes their host shape
  twisted_torus: { patch: 'pad', wave: 'sine' }, // Twirl — torus kin, a wound pad
  cut_hollow_sphere: { patch: 'glass', wave: 'sine' }, // Dish — an open bowl rings glassy
  blobby: { patch: 'pad', wave: 'sine' }, // Blobby — soft no-edges metaball
  // fractal capstones (Transcendent)
  mandelbox: { patch: 'bell', wave: 'sine' }, // Foldy — a metallic folded city
  julia: { patch: 'celesta', wave: 'sine' }, // Jules — glassy 4D-shadow celesta
  apollonian: { patch: 'glass', wave: 'sine' }, // Bubbles — a froth of nested spheres
  kleinian: { patch: 'pad', wave: 'sine' }, // Spire — a spacious reflective cathedral pad
}
const FALLBACK_PATCHES = ['rhodes', 'keys', 'pluck', 'pad', 'mallet', 'glass', 'bell', 'nylon', 'celesta']
const FALLBACK_WAVES: OscillatorType[] = ['sine', 'triangle', 'sine', 'triangle', 'sine']
const RARITY_RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 5, Meta: 6, Transcendent: 7 }

/** Deterministic instrument for a shape, derived purely from its topology descriptor. */
export function instrumentForShape(s: AudioShape): InstrumentVoice {
  const hero = PATCH[s.family]
  const h = hash(s.family)
  const variant = mod(s.id * 2654435761, 997) // id-seeded (Knuth) — stable per shape, no Math.random
  return {
    patch: hero?.patch ?? FALLBACK_PATCHES[h % FALLBACK_PATCHES.length],
    wave: hero?.wave ?? FALLBACK_WAVES[h % FALLBACK_WAVES.length],
    detune: (variant % 11) - 5, // ±5 cents
    bright: clamp01(0.35 + 0.13 * s.euler_cost), // higher Euler cost (exotic) ⇒ brighter
    space: clamp01((RARITY_RANK[s.rarity] ?? 0) / 5), // rarer ⇒ more reverb/tail
    flip: s.orientable === false, // absent ⇒ orientable ⇒ no flip
  }
}

const PENTA = PENTATONIC.length // 5 scale steps per octave

/**
 * Deterministic, always-in-scale note for a shape. The scale DEGREE comes from the id (spread across the
 * 3-octave table); GENUS pulls the register down a whole octave per hole (heavier shapes sit lower), so a
 * varied-genus loadout spreads across the register and chords read fuller. Still indexes SCALE ⇒ in-scale.
 */
export function noteForShape(s: AudioShape): number {
  const base = mod(s.id, SCALE.length)
  const drop = Math.min(s.genus, 2) * PENTA // genus → octaves down (capped at 2 so we stay on the table)
  return SCALE[mod(base - drop, SCALE.length)]
}

/**
 * Build a meeting's chord: dedupe by pitch (keeping each pitch's first shape's instrument), sort low→high,
 * and cap to MAX_POLY. Pure + deterministic.
 */
export function chordForMeeting(shapes: AudioShape[]): { midis: number[]; voices: InstrumentVoice[] } {
  const byPitch = new Map<number, InstrumentVoice>()
  for (const s of shapes) {
    const m = noteForShape(s)
    if (!byPitch.has(m)) byPitch.set(m, instrumentForShape(s))
  }
  const entries = [...byPitch.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_POLY)
  return { midis: entries.map((e) => e[0]), voices: entries.map((e) => e[1]) }
}

/** Meetings at a given tick: groups (of shape ids) that share a cell, ≥2 each. Pure (mirrors the timeline). */
export function meetingsAtTick(
  orbits: { path: [number, number][]; phase: number; period: number }[],
  loadout: number[],
  tick: number,
): number[][] {
  const byCell = new Map<string, number[]>()
  orbits.forEach((orb, i) => {
    if (!orb || orb.period === 0 || orb.path.length === 0) return
    const c = orb.path[mod(orb.phase + tick, orb.period)]
    if (!c) return
    const k = `${c[0]},${c[1]}`
    const arr = byCell.get(k) ?? []
    arr.push(loadout[i])
    byCell.set(k, arr)
  })
  return [...byCell.values()].filter((g) => g.length >= 2)
}

/** MIDI note → frequency (Hz). Render-only; not used by the economy. */
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
