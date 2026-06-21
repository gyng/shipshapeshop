import { SCALE, instrumentForShape, type AudioShape, type InstrumentVoice } from './orreryAudio'

// ── Orrery lofi bed — the PURE arrangement layer ──────────────────────────────────────────────────────────
// The deployed loadout deterministically becomes a continuous lofi arrangement: key + chord progression +
// tempo come from the set of shapes; each deployed shape contributes one melodic VOICE in its own
// descriptor-derived instrument (so the orrery you built is literally the band). No Tone.js here — this file
// is pure + unit-tested; `orreryBedDriver.tsx` realizes it on Tone synths. No Math.random: every choice is
// seeded from the loadout, so the same arrangement is reproducible (game-truth-derived, per the prime directive).

export type Role = 'keys' | 'pad' | 'bass' | 'pluck' | 'bell'

/** A deployed shape's part in the arrangement — the direct shape→instrument link. */
export interface ShapeVoice {
  id: number
  role: Role
  instrument: InstrumentVoice // patch/wave/detune/bright/space/flip — derived from the shape descriptor
  homeMidi: number // its register-anchored "home" pitch (genus sets the octave); in-scale by construction
}

/** Which layers are audible — the music BUILDS UP incrementally as more shapes are deployed (idle-game feel). */
export interface Layers {
  shapeVoices: boolean // the deployed shapes themselves (the band) + the vinyl/ambience bed
  vinyl: boolean
  chords: boolean // keys + pad harmony
  pad: boolean
  bass: boolean
  drums: boolean // the beat only kicks in once the orrery is busy
}

/** Layer thresholds by deployed-shape count: 0 ⇒ silence; each shape brings the bed further to life. */
export function layersForCount(n: number): Layers {
  return {
    shapeVoices: n >= 1,
    vinyl: n >= 1,
    chords: n >= 2,
    pad: n >= 2,
    bass: n >= 3,
    drums: n >= 4,
  }
}

export interface Arrangement {
  seed: number
  rootMidi: number // MIDI root of the major key the chords are built in
  bpm: number
  swing: number // 0..1 (Tone swing amount)
  /** One realized chord per step (root-position diatonic 7th/9th voicings) — the looping progression. */
  progression: number[][]
  /** One voice per deployed shape (the band); empty loadout ⇒ no music at all. */
  voices: ShapeVoice[]
  /** The chord instrument's patch — taken from the "lead" deployed shape (rarest), default warm rhodes. */
  leadPatch: string
  /** Incremental layer gating from the deployed-shape count. `active` is false for an empty orrery (silence). */
  layers: Layers
  active: boolean
  /** The lofi sub-style of THIS section — the bed crossfades between styles as epochs advance. */
  style: Style
  /** Which section this is (advances over time); folded into the seed so each section is a fresh variation. */
  epoch: number
  // ── per-section groove (seeded variety so no two sections play the same beat) ──
  kick: number[] // 16-step kick pattern
  snare: number[] // 16-step snare pattern
  bassMode: BassMode // how the bass moves under the chord (root / octave bounce / fifth / walking approach)
  chordHits: number[] // comp rhythm for the keys, sized to `meter` (the pad sustains regardless)
  arpMotif: number[] // (2-bar) melody — generated per section, sized to meter*4 (SCALE index per eighth, -1 = rest)
  meter: number // beats per bar (3 or 4); the drum/comp/bass/arp patterns are sized to it
}

/** A procedurally-selected lofi sub-style — its musical bias (tempo/swing/9ths) and its tonal recipe (the
 *  driver maps lowpass/reverb/crush/drum-density onto the per-deck effect chain). The bed crossfades between
 *  these over time, so the music drifts through moods instead of looping one forever. */
export interface Style {
  id: string
  bpmBias: number // added to the base 70–83 BPM
  swingBias: number
  ninthBias: number // 0..1 chance of richer 9th/11th voicings (the jazz-forward styles push this high)
  lowpass: number // Hz — master muffle (lower = warmer/sleepier)
  reverb: number // 0..1 reverb send (space)
  crush: number // 0..1 bitcrush (tape grit)
  drumDensity: number // 0..1 hat liveliness
  feel?: 'straight' | 'swing' | 'halftime' // groove feel (default straight) — swing = swung 8ths, halftime = laid-back backbeat
  bassBias?: BassMode // a style's preferred bass movement (cool jazz walks, bossa rides the fifth, soul bounces octaves)
  jazzBias?: number // 0..1 chance of a SECONDARY DOMINANT colouring a chord (cool-jazz/fusion chromaticism)
  sparse?: boolean // ambient/interlude: drop the kit for a drumless, dreamy passage
  meter?: number // beats per bar (default 4); 3 = a waltz lilt (the bed reshapes its bar to 3/4)
  premium?: boolean // opt-in style unlocked via the shop (J-pop / J-rock / city-pop); off until owned
}

// The palette is PRIMARILY lofi + jazz-fusion + cool jazz; bossa/soul/boom-bap/ambient are occasional inspiration
// mixed in. The rotation is WEIGHTED toward the jazz-forward moods (see STYLE_BAG) so 24/7 play sits in the pocket.
export const STYLES: Style[] = [
  // ── jazz-forward core (the dominant flavour) ──
  { id: 'cooljazz', bpmBias: 1, swingBias: 0.1, ninthBias: 0.85, lowpass: 3100, reverb: 0.34, crush: 0.07, drumDensity: 0.7, feel: 'swing', bassBias: 'walk', jazzBias: 0.3 }, // brushed, modal, walking
  { id: 'fusion', bpmBias: 6, swingBias: 0.06, ninthBias: 0.95, lowpass: 3500, reverb: 0.26, crush: 0.06, drumDensity: 0.9, bassBias: 'octave', jazzBias: 0.35 }, // electric-piano, lush, syncopated
  { id: 'bop', bpmBias: 8, swingBias: 0.13, ninthBias: 0.8, lowpass: 3300, reverb: 0.22, crush: 0.08, drumDensity: 0.95, feel: 'swing', bassBias: 'walk', jazzBias: 0.4 }, // gentle bebop swing
  { id: 'modal', bpmBias: -3, swingBias: 0.05, ninthBias: 0.7, lowpass: 2800, reverb: 0.4, crush: 0.07, drumDensity: 0.55, bassBias: 'fifth', jazzBias: 0.15 }, // Kind-of-Blue suspended space
  { id: 'noir', bpmBias: -5, swingBias: 0.09, ninthBias: 0.78, lowpass: 2400, reverb: 0.42, crush: 0.12, drumDensity: 0.5, feel: 'swing', bassBias: 'walk', jazzBias: 0.25 }, // late-night smoky jazz
  // ── lofi base (the cozy backbone) ──
  { id: 'dusty', bpmBias: 0, swingBias: 0.02, ninthBias: 0.4, lowpass: 2600, reverb: 0.3, crush: 0.14, drumDensity: 0.8 },
  { id: 'rainy', bpmBias: -5, swingBias: 0.0, ninthBias: 0.5, lowpass: 2000, reverb: 0.5, crush: 0.1, drumDensity: 0.5 },
  { id: 'jazzy', bpmBias: 5, swingBias: 0.08, ninthBias: 0.8, lowpass: 3400, reverb: 0.25, crush: 0.08, drumDensity: 0.95 },
  { id: 'sleepy', bpmBias: -8, swingBias: 0.0, ninthBias: 0.5, lowpass: 1700, reverb: 0.45, crush: 0.12, drumDensity: 0.4 },
  { id: 'tape', bpmBias: -2, swingBias: 0.05, ninthBias: 0.45, lowpass: 2300, reverb: 0.35, crush: 0.22, drumDensity: 0.7 },
  // ── inspiration mixed in (rarer) ──
  { id: 'bossa', bpmBias: 9, swingBias: 0.0, ninthBias: 0.75, lowpass: 3200, reverb: 0.3, crush: 0.06, drumDensity: 0.6, feel: 'halftime', bassBias: 'fifth', jazzBias: 0.1 }, // Latin-jazz lilt
  { id: 'soul', bpmBias: 2, swingBias: 0.06, ninthBias: 0.72, lowpass: 2900, reverb: 0.32, crush: 0.1, drumDensity: 0.7, bassBias: 'octave' }, // soul-jazz warmth
  { id: 'boombap', bpmBias: 4, swingBias: 0.04, ninthBias: 0.4, lowpass: 2700, reverb: 0.2, crush: 0.16, drumDensity: 0.85 }, // 90s hip-hop kit
  { id: 'ambient', bpmBias: -10, swingBias: 0.0, ninthBias: 0.6, lowpass: 1600, reverb: 0.6, crush: 0.05, drumDensity: 0.2, sparse: true }, // drumless drift
  // ── premium (shop opt-in) — brighter, more energetic moods, kept lofi-consistent (top of the tempo pocket) ──
  { id: 'jpop', bpmBias: 12, swingBias: 0.0, ninthBias: 0.7, lowpass: 3800, reverb: 0.22, crush: 0.05, drumDensity: 0.9, premium: true }, // bright, catchy
  { id: 'jrock', bpmBias: 12, swingBias: 0.0, ninthBias: 0.35, lowpass: 4000, reverb: 0.18, crush: 0.06, drumDensity: 0.95, premium: true }, // driving, simpler harmony
  { id: 'citypop', bpmBias: 8, swingBias: 0.03, ninthBias: 0.85, lowpass: 3500, reverb: 0.28, crush: 0.06, drumDensity: 0.8, bassBias: 'octave', premium: true }, // 80s funk gloss
  { id: 'synthwave', bpmBias: 10, swingBias: 0.0, ninthBias: 0.45, lowpass: 4200, reverb: 0.36, crush: 0.05, drumDensity: 0.9, premium: true }, // neon retro drive
  { id: 'gospel', bpmBias: 0, swingBias: 0.08, ninthBias: 0.95, lowpass: 3000, reverb: 0.4, crush: 0.07, drumDensity: 0.75, bassBias: 'walk', jazzBias: 0.3, premium: true }, // rich soulful changes
  { id: 'lounge', bpmBias: 3, swingBias: 0.05, ninthBias: 0.8, lowpass: 3300, reverb: 0.3, crush: 0.06, drumDensity: 0.6, bassBias: 'fifth', premium: true }, // smooth easy-listening
  { id: 'triphop', bpmBias: -12, swingBias: 0.02, ninthBias: 0.5, lowpass: 1800, reverb: 0.5, crush: 0.2, drumDensity: 0.5, feel: 'halftime', bassBias: 'root', premium: true }, // dark, downtempo, heavy
  { id: 'neosoul', bpmBias: 0, swingBias: 0.1, ninthBias: 0.92, lowpass: 2900, reverb: 0.34, crush: 0.08, drumDensity: 0.7, bassBias: 'octave', jazzBias: 0.2, premium: true }, // laid-back R&B pocket
  { id: 'vaporwave', bpmBias: -8, swingBias: 0.0, ninthBias: 0.75, lowpass: 2200, reverb: 0.6, crush: 0.1, drumDensity: 0.45, feel: 'halftime', premium: true }, // washed, melted nostalgia
  { id: 'acoustic', bpmBias: -2, swingBias: 0.04, ninthBias: 0.55, lowpass: 3000, reverb: 0.3, crush: 0.04, drumDensity: 0.5, bassBias: 'root', meter: 4, premium: true }, // nylon / organic warmth
  { id: 'waltz', bpmBias: 4, swingBias: 0.06, ninthBias: 0.8, lowpass: 3100, reverb: 0.36, crush: 0.06, drumDensity: 0.6, bassBias: 'root', meter: 3, jazzBias: 0.15, premium: true }, // jazz waltz, 3/4 lilt
]

// WEIGHTED rotation — indices into STYLES, jazz-forward moods repeated so the bed sits mostly in lofi/jazz/cool-
// jazz, dipping into the lofi base and (rarely) the mixed-in inspirations. Deterministic, like the styles.
const J = [0, 1, 2, 3, 4] // jazz-forward core
const B = [5, 6, 7, 8, 9] // lofi base
const X = [10, 11, 12, 13] // inspiration
// premium (shop opt-in) — only rotate in when owned + enabled: jpop jrock citypop synthwave gospel lounge triphop neosoul vaporwave acoustic waltz
const P = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
const STYLE_BAG: number[] = [...J, ...J, ...J, ...B, ...B, ...X, ...P, ...P] // ≈ jazz 3× : base 2× : inspiration 1× : premium 2× (when owned)

// ── deterministic helpers ──
/** mulberry32 — a tiny seeded PRNG. Deterministic stream from the loadout seed (never Math.random). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable seed from the deployed set — order-independent (a loadout is a set, not a sequence). */
export function seedFromLoadout(shapes: AudioShape[]): number {
  let h = 0x811c9dc5 // FNV-ish, but summed over a sorted key so order doesn't matter
  const keys = shapes.map((s) => `${s.id}:${s.family}:${s.genus}`).sort()
  for (const k of keys) for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193)
  return h >>> 0
}

// ── music theory: diatonic 7th/9th chords (jazz voicings are automatic from the major scale) ──
const MAJOR = [0, 2, 4, 5, 7, 9, 11] // major-scale semitone offsets
/** Note `deg` steps up the major scale from `root` (deg may exceed 6 ⇒ wraps up octaves). Always diatonic. */
function scaleNote(root: number, deg: number): number {
  const oct = Math.floor(deg / 7)
  return root + 12 * oct + MAJOR[((deg % 7) + 7) % 7]
}
/** Stacked-thirds 7th chord on a scale degree (+ optional 9th). The quality (maj7/min7/dom7/ø7) falls out
 *  of the scale automatically — exactly the diatonic jazz harmony lofi is built on. */
export function diatonicChord(root: number, degree: number, ninth: boolean): number[] {
  const ns = [0, 2, 4, 6].map((i) => scaleNote(root, degree + i)) // 1-3-5-7
  if (ninth) ns.push(scaleNote(root, degree + 8)) // add the 9th up an octave
  return ns
}

// Extended jazz voicings — the genre's signature "color without complexity" (6/7/9/11). All diatonic.
export type Voicing = 'seventh' | 'sixth' | 'ninth' | 'eleventh'
/** Voice a diatonic chord with a chosen extension, plus an optional parallel-minor borrow (modal interchange:
 *  the iconic lofi "minor iv" — flattening the 3rd & 7th of the IV chord brings in the soulful b3/b6 color). */
export function voicedChord(root: number, degree: number, voicing: Voicing, borrowMinorIV: boolean): number[] {
  const ns = [0, 2, 4].map((i) => scaleNote(root, degree + i)) // 1-3-5
  if (voicing === 'sixth') ns.push(scaleNote(root, degree + 5)) // add 6
  else {
    ns.push(scaleNote(root, degree + 6)) // add 7
    if (voicing === 'ninth' || voicing === 'eleventh') ns.push(scaleNote(root, degree + 8)) // + 9
    if (voicing === 'eleventh') ns.push(scaleNote(root, degree + 10)) // + 11 (lush)
  }
  // modal interchange: turn IV into iv (minor) — lower its 3rd (→ Fm) and, if present, its 7th a semitone
  // (Fmaj7 → Fm7, or Fmaj6 → Fm6 in C). The single most-loved borrowed chord in lofi/soul; only the IV is
  // borrowed, so the colour is controlled, never random. (The 6th at index 3 stays put — Fm6 is the right chord.)
  if (borrowMinorIV && ((degree % 7) + 7) % 7 === 3) {
    ns[1] -= 1 // minor 3rd
    if (voicing !== 'sixth') ns[3] -= 1 // index 3 is the 7th only when a 7th was added
  }
  return ns
}
/** The V7 of a target chord — a dominant 7th a fifth above the target's root, resolving down into it. The cool-
 *  jazz turnaround staple; its chromatic leading-tone 3rd resolves up into the target, so it's always "in" when
 *  placed right before its target. A dom7 shape (root, M3, P5, m7). */
export function secondaryDominant(targetRoot: number): number[] {
  const r = targetRoot + 7 - 12 // a fifth above the target, dropped an octave to sit in the chord register
  return [r, r + 4, r + 7, r + 10]
}

// Cozy lofi keys (chord-register roots ≈ C3..) and smooth diatonic turnarounds (degrees: I=0 ii=1 iii=2 IV=3 V=4 vi=5).
const KEY_ROOTS = [48, 53, 55, 50, 45] // C3, F3, G3, D3, A2
const PROGRESSIONS: number[][] = [
  [1, 4, 0, 0], // ii–V–I–I
  [0, 5, 1, 4], // I–vi–ii–V (the classic lofi turnaround)
  [5, 1, 4, 0], // vi–ii–V–I
  [0, 3, 1, 4], // I–IV–ii–V
  [5, 3, 0, 4], // vi–IV–I–V
  [1, 4, 5, 0], // ii–V–vi–I (deceptive)
  [0, 4, 5, 3], // I–V–vi–IV (the "four chords")
  [5, 3, 0, 4], // vi–IV–I–V (pop-punk axis, minor start)
  [0, 2, 5, 3], // I–iii–vi–IV (dreamy)
  [3, 4, 2, 5], // IV–V–iii–vi
  [0, 5, 3, 4, 1, 4, 0, 0], // 8-bar: I–vi–IV–V–ii–V–I–I (a longer phrase that resolves)
  [5, 1, 4, 0, 3, 2, 1, 4], // 8-bar wandering turnaround
]

// ── per-section rhythm/voicing banks — chosen by seed so each section grooves differently (not one loop forever) ──
export type BassMode = 'root' | 'octave' | 'fifth' | 'walk'
const BASS_MODES: BassMode[] = ['root', 'octave', 'fifth', 'walk']
// 16-step kick patterns (1 = hit). Boom-bap variations from sparse/sleepy to pushed/busy.
const KICKS: number[][] = [
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], // classic boom-bap
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], // on-beats + a syncopated tail
  [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0], // busy
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], // minimal (sleepy)
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0], // pushed
]
// 16-step snare/backbeat patterns (1 = hit) — the 2 & 4 backbone with varying ghost notes.
const SNARES: number[][] = [
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], // backbeat + ghost
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], // plain backbeat
  [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0], // ghosted
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0], // clap on the "and"
]
// 4-step (per-quarter) chord comping rhythms (1 = the keys re-articulate; the pad always sustains underneath).
const CHORD_HITS: number[][] = [
  [1, 0, 0, 0], // sustained — one chord per bar
  [1, 0, 1, 0], // half-note comp
  [1, 0, 0, 1], // anticipated (1 + the "and" of 4)
  [1, 0, 1, 1], // busier comp
]
// ── 3/4 (waltz) variants — 12-step kick/snare (3 beats × 4) + 3-step comp. The bass plays the downbeat "oom";
// the snare/comp give the "pah-pah" on 2 & 3. Used only by styles with meter === 3. ──
const KICKS_3: number[][] = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // oom on 1
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], // 1 + 2
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], // 1 + 3
]
const SNARES_3: number[][] = [
  [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], // pah-pah (2 & 3)
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], // just 2
  [0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0], // ghosted pah-pah
]
const CHORD_HITS_3: number[][] = [
  [1, 0, 0], // sustained (one chord per bar)
  [1, 1, 1], // pah-pah-pah comp
  [1, 0, 1], // 1 & 3
]
// ── GENERATIVE variety (for 24/7 play: finite banks eventually repeat, so harmony + melody are *generated*) ──
// Functional-harmony successor table over diatonic degrees (I=0 ii=1 iii=2 IV=3 V=4 vi=5 vii°=6): each degree
// lists musically-strong next degrees (weighted by repetition). A seeded walk yields endless progressions that
// still cadence like lofi — diatonic by construction, so never a wrong chord.
const FUNC_NEXT: number[][] = [
  [3, 4, 5, 1, 2], // I  → IV V vi ii iii
  [4, 4, 6, 3], //    ii → V (strong), vii°, IV
  [5, 3, 1], //      iii → vi IV ii
  [4, 1, 0, 5], //   IV → V ii I vi
  [0, 0, 5, 0], //   V  → I (strong), vi (deceptive)
  [3, 1, 4, 2], //   vi → IV ii V iii
  [0], //          vii° → I
]
/** A seeded functional progression (4 bars, sometimes 8) that always starts on a tonic and walks strong moves. */
function generateProgression(rng: () => number): number[] {
  const len = rng() < 0.25 ? 8 : 4 // mostly 4-bar; an occasional 8-bar phrase for longer-form interest
  const out = [rng() < 0.7 ? 0 : 5] // start on I (or its relative vi)
  for (let i = 1; i < len; i++) {
    const opts = FUNC_NEXT[out[i - 1]]
    out.push(opts[Math.floor(rng() * opts.length)])
  }
  return out
}
/** A seeded 16-step (2-bar) melodic motif over the PENTATONIC scale (values = SCALE index, -1 = rest). Stepwise-
 *  biased so it sings rather than leaps; pentatonic ⇒ consonant over any chord in the bed. Endless tunes. */
function generateMotif(rng: () => number, scaleLen: number, len: number): number[] {
  const out: number[] = []
  let deg = Math.floor(rng() * scaleLen)
  for (let i = 0; i < len; i++) {
    if (rng() < 0.35) {
      out.push(-1) // rest — space is what makes a motif read as a phrase, not a scale run
      continue
    }
    deg = clamp(deg + Math.round((rng() - 0.5) * 5), 0, scaleLen - 1) // mostly small melodic steps
    out.push(deg)
  }
  return out
}
// Over a 24/7 session the KEY slowly modulates among the (closely-related) cozy roots so the bed never sits in
// one tonality forever — but it holds for a block of sections (≈ minutes) so adjacent sections stay coherent.
const MODULATE_EVERY = 8 // epochs per key block
function rootForEpoch(base: number, epoch: number): number {
  const baseIdx = Math.floor(mulberry32(base)() * KEY_ROOTS.length)
  const block = Math.floor(epoch / MODULATE_EVERY)
  const offset = block === 0 ? 0 : hash32(base ^ Math.imul(block, 0x9e3779b1)) % KEY_ROOTS.length
  return KEY_ROOTS[(baseIdx + offset) % KEY_ROOTS.length] // block 0 = the loadout's home key; later blocks drift
}

const RARITY_RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 5, Meta: 6, Transcendent: 7 }

/** Which arrangement role a shape plays, from its instrument/topology. */
export function roleForShape(s: AudioShape): Role {
  const patch = instrumentForShape(s).patch
  if (patch === 'pad') return 'pad'
  if (patch === 'bell' || patch === 'celesta' || patch === 'glass') return 'bell'
  if (patch === 'nylon' || patch === 'pluck') return 'pluck'
  if (s.genus >= 2) return 'bass' // shapes with many holes anchor the low end
  return 'keys'
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
/** Integer avalanche hash — mixes the epoch into the loadout seed so each section is a distinct variation. */
function hash32(n: number): number {
  let h = n >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

// Optional player-chosen soundscape (Shop cosmetic). When set, it pins the bed's mood instead of the
// loadout-derived rotation. Defaults off, so deterministic tests/behaviour are unchanged until a cosmetic sets it.
let _forcedStyle: string | null = null
export function setForcedStyle(id: string | null) {
  _forcedStyle = id
}

// The set of styles the rotation is allowed to use — opt-in/out from settings, minus any unowned premium styles.
// null = all styles (the default, so tests + first-run are unchanged). Empty/filtered-to-nothing falls back to all.
let _enabledStyles: Set<string> | null = null
export function setEnabledStyles(ids: string[] | null) {
  _enabledStyles = ids ? new Set(ids) : null
}
function effectiveBag(): number[] {
  if (!_enabledStyles) return STYLE_BAG
  const bag = STYLE_BAG.filter((i) => _enabledStyles!.has(STYLES[i].id))
  return bag.length ? bag : STYLE_BAG // never silence the bed by disabling everything
}

/** The style for a given loadout + section — rotates as epochs advance (stable per loadout), within the styles
 *  the player has enabled (and owns). */
export function styleForEpoch(shapes: AudioShape[], epoch: number): Style {
  if (_forcedStyle) {
    const s = STYLES.find((x) => x.id === _forcedStyle)
    if (s) return s
  }
  const bag = effectiveBag()
  return STYLES[bag[(seedFromLoadout(shapes) + epoch) % bag.length]] // weighted toward the jazz-forward moods
}

/** Back-compat: the section-0 arrangement of a loadout. */
export function arrangementForLoadout(shapes: AudioShape[]): Arrangement {
  return arrangementForEpoch(shapes, 0)
}

/**
 * Deterministically arrange a loadout into one SECTION of the evolving bed. The KEY stays stable per loadout
 * (so the music feels coherent), but the progression, tempo, swing and sub-style are re-rolled per epoch —
 * folding `epoch` into the seed — so the bed drifts through fresh variations over time. Pure.
 */
export function arrangementForEpoch(shapes: AudioShape[], epoch: number): Arrangement {
  const base = seedFromLoadout(shapes)
  const rootMidi = rootForEpoch(base, epoch) // key: home per loadout, slowly modulating among related keys over a long session
  const style = styleForEpoch(shapes, epoch)

  const seed = (base ^ hash32(epoch + 1)) >>> 0 // per-section variation
  const rng = mulberry32(seed)
  // harmony: blend the hand-authored lofi turnarounds (recognizable) with GENERATED functional progressions
  // (endless, never-repeating over 24/7) — both diatonic, so always in-key.
  const progRng = mulberry32(hash32(seed ^ 0x5bd1e995))
  const prog = progRng() < 0.5 ? PROGRESSIONS[Math.floor(progRng() * PROGRESSIONS.length)] : generateProgression(progRng)
  // voicing: richer extensions when the style leans jazzy (ninthBias); modal interchange (minor iv) is an
  // occasional soulful color. Both fuse jazz harmony in without ever leaving the lofi palette.
  const rich = rng() < style.ninthBias
  const voicing: Voicing = rich ? (rng() < 0.4 ? 'eleventh' : 'ninth') : rng() < 0.4 ? 'sixth' : 'seventh'
  const borrowMinorIV = rng() < 0.28
  const progression = prog.map((deg) => voicedChord(rootMidi, deg, voicing, borrowMinorIV))
  // SECONDARY DOMINANTS (cool-jazz/fusion chromaticism): occasionally re-colour a chord as the V7 of the NEXT
  // chord, so it leads chromatically into it. Gated to jazz-forward styles (style.jazzBias) and always placed
  // before its target, so the chromatic tones always resolve — the one bit of "outside" harmony, used tastefully.
  if (style.jazzBias) {
    for (let i = 0; i < progression.length - 1; i++) {
      if (rng() < style.jazzBias) progression[i] = secondaryDominant(progression[i + 1][0])
    }
  }
  const bpm = clamp(70 + Math.floor(rng() * 14) + style.bpmBias, 60, 92)
  const swing = clamp(0.22 + rng() * 0.18 + style.swingBias, 0, 0.5)

  // Groove choices keyed off the section seed via independent salts — so kick, snare, bass and comp each vary on
  // their own axis (kept OFF the rng() stream above, so the existing harmony/tempo rolls are unchanged).
  const pick = <T>(bank: T[], salt: number): T => bank[hash32(seed ^ salt) % bank.length]
  const meter = style.meter ?? 4 // 3 = waltz; the groove patterns below are sized to it
  const busierBeat = style.drumDensity > 0.7 // jazzy/dusty styles lean to busier kits, sleepy/rainy to sparser
  const kick = pick(meter === 3 ? KICKS_3 : KICKS, busierBeat ? 0x9e3779b1 : 0x1b56c4e9)
  const snare = pick(meter === 3 ? SNARES_3 : SNARES, 0xc2b2ae35)
  const bassMode = style.bassBias ?? pick(BASS_MODES, 0x27d4eb2f) // styles can prefer a bass feel (cool jazz walks…)
  const chordHits = pick(meter === 3 ? CHORD_HITS_3 : CHORD_HITS, 0x165667b1)
  const arpMotif = generateMotif(mulberry32(hash32(seed ^ 0x85ebca77)), SCALE.length, meter * 4) // 2-bar tune, sized to meter

  const voices: ShapeVoice[] = shapes.map((s) => ({
    id: s.id,
    role: roleForShape(s),
    instrument: instrumentForShape(s),
    homeMidi: noteHomeMidi(s),
  }))

  // lead chord instrument = the rarest deployed shape's patch (ties → first); warm rhodes if the bench is empty.
  const lead = shapes.reduce<AudioShape | null>(
    (best, s) => (best && (RARITY_RANK[best.rarity] ?? 0) >= (RARITY_RANK[s.rarity] ?? 0) ? best : s),
    null,
  )
  const leadPatch = lead ? instrumentForShape(lead).patch : 'rhodes'

  return { seed, rootMidi, bpm, swing, progression, voices, leadPatch, layers: layersForCount(shapes.length), active: shapes.length > 0, style, epoch, kick, snare, bassMode, chordHits, arpMotif, meter }
}

/** A shape's in-scale "home" pitch — pentatonic (always consonant over the diatonic bed), genus sets octave. */
function noteHomeMidi(s: AudioShape): number {
  const base = ((s.id % SCALE.length) + SCALE.length) % SCALE.length
  const drop = Math.min(s.genus, 2) * 5 // genus pulls register down (5 pentatonic steps = an octave)
  return SCALE[((base - drop) % SCALE.length + SCALE.length) % SCALE.length]
}
