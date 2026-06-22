// Per-character VOICE timbre — drives the synthesized "blip" speech (Animal-Crossing / Undertale style) that
// plays under dialog captions. This is the captioned-fallback the design (AGENTS.md, CHARACTERS.md) calls for
// until/if real AI VO is produced; it's keyed to the same per-character voiceDirection intent (vocal age,
// brightness, pace). A handful of heroes are hand-tuned; every other shape derives a stable, distinct voice.
export interface VoiceSignature {
  baseFreq: number // Hz — lower = deeper
  waveform: OscillatorType // sine=warm, triangle=bright, square=flat/retro, sawtooth=edgy
  jitter: number // pitch expressiveness (semitone spread across the line)
  rate: number // ms between blips — lower = quicker/sharper delivery
}

// Hand-tuned hero voices (by family id). Matches the character briefs: Pip warm, Boxy deadpan-flat,
// Spike a bright fencer (dual-mirror inverse of Boxy), Tess cool/synthetic, Klein burbling, etc.
const HERO: Record<string, VoiceSignature> = {
  sphere: { baseFreq: 300, waveform: 'sine', jitter: 1.6, rate: 72 }, // Pip — warm storybook
  cube: { baseFreq: 148, waveform: 'square', jitter: 0.3, rate: 98 }, // Boxy — gravel deadpan
  octahedron: { baseFreq: 366, waveform: 'triangle', jitter: 4.2, rate: 58 }, // Spike — bright, lively
  dodecahedron: { baseFreq: 240, waveform: 'sine', jitter: 1.2, rate: 84 }, // Dodi — courtly, measured
  klein_bottle: { baseFreq: 268, waveform: 'sine', jitter: 2.8, rate: 70 }, // Klein — burbling, self-folding
  mobius: { baseFreq: 210, waveform: 'triangle', jitter: 2.0, rate: 76 }, // Mo — mirror-flip
  tesseract: { baseFreq: 196, waveform: 'sawtooth', jitter: 1.0, rate: 82 }, // Tess — cool 4D synth
  cell_16: { baseFreq: 320, waveform: 'sawtooth', jitter: 0.6, rate: 64 }, // Hex — angular/Ramiel
  lorenz: { baseFreq: 286, waveform: 'triangle', jitter: 5.0, rate: 54 }, // Lorrie — chaotic, fluttery
  trefoil: { baseFreq: 256, waveform: 'triangle', jitter: 2.4, rate: 74 }, // Trey — self-interrupting knot
  utah_teapot: { baseFreq: 226, waveform: 'sine', jitter: 1.4, rate: 86 }, // Teapot — venerable
  // Transcendent fractal capstones — bespoke voices for the headline tier
  mandelbox: { baseFreq: 180, waveform: 'sine', jitter: 1.0, rate: 80 }, // Foldy — deep, cool, deliberate
  julia: { baseFreq: 300, waveform: 'sine', jitter: 2.6, rate: 70 }, // Jules — ethereal, ever-shifting
  apollonian: { baseFreq: 340, waveform: 'sine', jitter: 2.2, rate: 66 }, // Bubbles — bright, bubbly, inviting
  kleinian: { baseFreq: 220, waveform: 'sine', jitter: 1.8, rate: 78 }, // Spire — resonant, cavernous, reflected
  // NG+ cohort — Meta/4D slices and Transcendent algebraic/attractor jewels. Tuned to rhyme with their kin
  // (Slabby↔Pip warmth, Dito↔Torus playful-nested lilt, Whirly↔Lorrie chaos flutter, Sixsy/Sexta record-holder poise).
  spherinder_slice: { baseFreq: 256, waveform: 'sine', jitter: 1.2, rate: 90 }, // Slabby — warm, solid, unhurried (Pip's deeper 4D kin)
  duocylinder: { baseFreq: 248, waveform: 'sine', jitter: 1.4, rate: 80 }, // Duoey — calm, even, paired/balanced
  cell24_section: { baseFreq: 244, waveform: 'sine', jitter: 1.0, rate: 84 }, // Cubocta — poised, mirror-balanced (Dodi's ascended kin)
  ditorus: { baseFreq: 274, waveform: 'sine', jitter: 2.4, rate: 74 }, // Dito — warm, playful, looping lilt (Torus family, nested)
  hyperbolic_honeycomb: { baseFreq: 168, waveform: 'sine', jitter: 1.6, rate: 92 }, // Vault — deep, vast, echoing cloister (endless arches)
  aizawa_attractor: { baseFreq: 290, waveform: 'triangle', jitter: 4.6, rate: 56 }, // Whirly — fluttery, restless, never-repeating (Lorrie's chaos cousin)
  barth_sextic: { baseFreq: 252, waveform: 'sine', jitter: 1.4, rate: 82 }, // Sixsy — poised, jewelled, record-holder's calm (icosahedral symmetry)
  endrass_octic: { baseFreq: 236, waveform: 'sawtooth', jitter: 1.2, rate: 78 }, // Sexta — proud, edged, record-holder (168 crossings)
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const WAVES: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth']

// Deterministic fallback so every shape has a stable, recognisably-its-own voice without hand-authoring 55.
export function voiceOf(family: string): VoiceSignature {
  const hero = HERO[family]
  if (hero) return hero
  const h = hash(family)
  return {
    baseFreq: 165 + (h % 210), // 165–375 Hz
    waveform: WAVES[h % WAVES.length],
    jitter: 1 + ((h >> 3) % 4),
    rate: 64 + ((h >> 5) % 46),
  }
}
