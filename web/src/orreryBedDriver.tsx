import { useEffect } from 'react'
import type * as T from 'tone' // type-only (erased at build); runtime Tone is dynamically imported
import { useGame, type ShapeRow } from './game/store'
import { useOrreryUi } from './orreryUi'
import { useMute, createPlaybackContext, registerMusicAnalyser, startAdaptiveLookAhead, stopAdaptiveLookAhead } from './audio'
import { arrangementForEpoch, STYLES, setForcedStyle, setEnabledStyles, type Arrangement, type Role } from './orreryBed'
import { SCALE } from './orreryAudio'
import { useMusicPrefs } from './musicPrefs'
import { useBedStatus } from './bedStatus'
import { bedControl, type BedLayer } from './bedControl'

// ── Orrery lofi bed — the SYNTHESIS + scheduling layer (feel) ──────────────────────────────────────────────
// Realizes the pure Arrangement (orreryBed.ts) on Tone.js synths — NO samples, everything synthesized.
// To keep the music from looping forever, it runs TWO identical "decks" sharing one Transport: one is audible
// while the other is silent. Every few bars the bed advances an EPOCH (a fresh progression/tempo/sub-style),
// configures the idle deck with it, and equal-power CROSSFADES the decks — so the music drifts through moods.
// Tone is lazy-imported so the lib is code-split out of the main bundle. Mute/pause/volume aware; silent when
// the orrery is empty. All variation is seeded from game truth (loadout + epoch) — never Math.random.

const SECTION_BARS = 8 // bars between section crossfades
const CROSSFADE_SEC = 4 // crossfade length

// The shapes that feed the generative bed. Normally the deployed Orrery "band"; in "library" mode the whole
// unlocked collection plays, capped to a sane polyphony so a big collection stays musical rather than a wall.
const LIBRARY_VOICE_CAP = 12
const deployedShapes = (): ShapeRow[] => {
  const { view, shapes } = useGame.getState()
  if (!view) return []
  if (useMute.getState().musicSource === 'library') {
    const lib: ShapeRow[] = []
    for (let id = 0; id < view.owned.length && lib.length < LIBRARY_VOICE_CAP; id++) {
      if (view.owned[id] > 0 && shapes[id]) lib.push(shapes[id])
    }
    return lib
  }
  return view.loadout.map((id) => shapes[id]).filter(Boolean)
}

// A deterministic 0..1 for (seed, slot) — reproducible per arrangement, no Math.random in the played pattern.
// A deterministic 0..1 for (seed, slot) — pure integer hashing, ZERO allocation (the per-step drum/arp/crackle
// loops call this constantly; the old version allocated a mulberry32 closure each call → GC-pause crackle).
const det = (seed: number, slot: number) => {
  let a = (seed ^ Math.imul(slot, 2654435761)) >>> 0
  a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d)
  a = Math.imul(a ^ (a >>> 12), 0x297a2d39)
  a ^= a >>> 15
  return (a >>> 0) / 4294967296
}

type ToneMod = typeof import('tone')

// Per-layer solo/mute (driven from the under-the-hood inspector) — lets you isolate the kit, bass, comp or
// melody to hear what each shape is doing. Module-level so it survives deck rebuilds; pure presentation.
const layerMute: Record<BedLayer, boolean> = { drums: false, bass: false, chords: false, arp: false }

// Per-style LEAD-voice character (FM electric-piano flavour) so each mood is distinct in TIMBRE, not just
// tempo/EQ: warm Rhodes for the cozy/jazz moods, glassy DX for fusion/city-pop, bright/edgy for the energetic
// styles, soft & mellow for the dreamy ones. Unlisted styles fall back to the warm default.
// A lead voice = FM ratio (h/m) + an amp envelope. Most styles keep the stock warm-Rhodes envelope; the
// "plucked" envelope (short, percussive, no sustain) turns the electric piano into a nylon/guitar-like pluck so
// the ACOUSTIC style reads organic instead of electric.
type LeadEnv = { attack: number; decay: number; sustain: number; release: number }
const RHODES_ENV: LeadEnv = { attack: 0.008, decay: 0.7, sustain: 0.12, release: 1.4 }
const PLUCK_ENV: LeadEnv = { attack: 0.004, decay: 0.5, sustain: 0, release: 0.5 } // nylon/guitar — rings then dies
const DEFAULT_TONE: { h: number; m: number; env: LeadEnv } = { h: 3, m: 7, env: RHODES_ENV } // warm Rhodes
const LEAD_TONE: Record<string, { h: number; m: number; env: LeadEnv }> = {
  fusion: { h: 4, m: 10, env: RHODES_ENV }, citypop: { h: 5, m: 9, env: RHODES_ENV }, // glassy DX electric piano
  bop: { h: 3, m: 11, env: RHODES_ENV }, jazzy: { h: 3, m: 10, env: RHODES_ENV }, jpop: { h: 4, m: 11, env: RHODES_ENV }, // bright & clear
  jrock: { h: 5, m: 13, env: RHODES_ENV }, synthwave: { h: 4, m: 12, env: RHODES_ENV }, // edgy / neon-bright
  neosoul: { h: 4, m: 9, env: RHODES_ENV }, vaporwave: { h: 4, m: 8, env: RHODES_ENV }, // lush / glassy-washed
  modal: { h: 2, m: 4, env: RHODES_ENV }, ambient: { h: 1, m: 3, env: RHODES_ENV }, sleepy: { h: 2, m: 4, env: RHODES_ENV }, lounge: { h: 4, m: 8, env: RHODES_ENV }, // soft / smooth
  triphop: { h: 2, m: 5, env: RHODES_ENV }, waltz: { h: 3, m: 8, env: RHODES_ENV }, // dark / warm
  acoustic: { h: 2.5, m: 6, env: PLUCK_ENV }, // nylon-guitar pluck (woody FM + percussive envelope)
}
// Per-style BASS character: round upright sine for jazz, punchy bright osc for the energetic styles, deep soft
// sub for the dreamy ones (osc shape + how far the filter envelope opens).
const DEFAULT_BASS = { osc: 'sine' as OscillatorType, oct: 2.5 }
const BASS_TONE: Record<string, { osc: OscillatorType; oct: number }> = {
  jrock: { osc: 'sawtooth', oct: 3.2 }, boombap: { osc: 'triangle', oct: 3.0 }, jpop: { osc: 'triangle', oct: 3.0 },
  fusion: { osc: 'triangle', oct: 2.8 }, citypop: { osc: 'triangle', oct: 2.8 }, synthwave: { osc: 'sawtooth', oct: 3.4 },
  gospel: { osc: 'triangle', oct: 2.8 }, lounge: { osc: 'sine', oct: 2.4 }, neosoul: { osc: 'triangle', oct: 2.6 },
  triphop: { osc: 'sine', oct: 2.0 }, vaporwave: { osc: 'triangle', oct: 2.4 }, acoustic: { osc: 'sine', oct: 2.4 }, waltz: { osc: 'sine', oct: 2.4 },
  modal: { osc: 'sine', oct: 2.2 }, sleepy: { osc: 'sine', oct: 1.8 }, ambient: { osc: 'sine', oct: 1.8 },
}
// Per-style DRUM-KIT character: brushed/dark (pink-noise snare, boomy soft kick, open ride hats) for the jazz
// moods; tight/bright/punchy for the energetic ones; soft & distant for the dreamy ones. kDecay/kPitch shape the
// kick, sCut/sNoise the snare (pink = brushy), hCut/hDecay the hats (longer = ride-like).
type NoiseKind = 'white' | 'pink' | 'brown'
const DEFAULT_DRUMS = { kDecay: 0.4, kPitch: 0.05, sCut: 1800, sNoise: 'white' as NoiseKind, hCut: 7000, hDecay: 0.045 }
const DRUM_TONE: Record<string, { kDecay: number; kPitch: number; sCut: number; sNoise: NoiseKind; hCut: number; hDecay: number }> = {
  cooljazz: { kDecay: 0.5, kPitch: 0.06, sCut: 1300, sNoise: 'pink', hCut: 8500, hDecay: 0.09 }, // brushed
  bop: { kDecay: 0.45, kPitch: 0.06, sCut: 1500, sNoise: 'pink', hCut: 9000, hDecay: 0.11 }, // swung ride
  noir: { kDecay: 0.55, kPitch: 0.07, sCut: 1200, sNoise: 'pink', hCut: 8000, hDecay: 0.1 }, // smoky
  jrock: { kDecay: 0.28, kPitch: 0.03, sCut: 2600, sNoise: 'white', hCut: 6500, hDecay: 0.04 }, // tight & bright
  jpop: { kDecay: 0.3, kPitch: 0.035, sCut: 2400, sNoise: 'white', hCut: 6800, hDecay: 0.04 }, // crisp
  boombap: { kDecay: 0.35, kPitch: 0.04, sCut: 2200, sNoise: 'white', hCut: 6500, hDecay: 0.05 }, // punchy
  citypop: { kDecay: 0.3, kPitch: 0.035, sCut: 2500, sNoise: 'white', hCut: 7400, hDecay: 0.05 }, // funky, tight, glossy
  synthwave: { kDecay: 0.32, kPitch: 0.03, sCut: 2800, sNoise: 'white', hCut: 7200, hDecay: 0.05 }, // tight, bright, gated
  gospel: { kDecay: 0.42, kPitch: 0.05, sCut: 1600, sNoise: 'pink', hCut: 8500, hDecay: 0.08 }, // warm, brushed ride
  lounge: { kDecay: 0.5, kPitch: 0.06, sCut: 1400, sNoise: 'pink', hCut: 7800, hDecay: 0.07 }, // soft, smooth
  triphop: { kDecay: 0.5, kPitch: 0.06, sCut: 1400, sNoise: 'pink', hCut: 5500, hDecay: 0.06 }, // heavy, dark, dusty
  neosoul: { kDecay: 0.4, kPitch: 0.045, sCut: 1700, sNoise: 'pink', hCut: 8000, hDecay: 0.07 }, // warm, brushed pocket
  vaporwave: { kDecay: 0.52, kPitch: 0.07, sCut: 1200, sNoise: 'pink', hCut: 6000, hDecay: 0.07 }, // soft, washed
  acoustic: { kDecay: 0.42, kPitch: 0.05, sCut: 1600, sNoise: 'pink', hCut: 8000, hDecay: 0.06 }, // natural, soft
  waltz: { kDecay: 0.45, kPitch: 0.055, sCut: 1500, sNoise: 'pink', hCut: 8600, hDecay: 0.08 }, // light brushed lilt
  ambient: { kDecay: 0.6, kPitch: 0.08, sCut: 1000, sNoise: 'pink', hCut: 5500, hDecay: 0.06 }, // soft & distant
  sleepy: { kDecay: 0.55, kPitch: 0.07, sCut: 1100, sNoise: 'pink', hCut: 5800, hDecay: 0.05 },
}

interface Deck {
  out: T.Gain // unity DRY output → the engine's CrossFade (the wet send self-connects to the shared reverb)
  setAudible: (v: boolean) => void // gate note-triggering (silent decks idle)
  setArrangement: (a: Arrangement, time?: number) => void
  dispose: () => void
}

/** One full synth set + its own lofi effect chain, output through a crossfade gain. Plays its own arrangement. */
function buildDeck(Tone: ToneMod, initial: Arrangement, sharedReverb: T.Reverb): Deck {
  const arrRef = { current: initial }
  // Perf: a silent (faded-out) deck stops TRIGGERING notes — its synths idle instead of voicing into a 0-gain
  // crossfade. The engine flips this on for both decks across a crossfade window, then off for the outgoing one.
  let audible = false
  const transport = Tone.getTransport()
  // MIDI → frequency (Hz), pure math. Triggering synths with a NUMBER avoids the per-note Tone.Frequency
  // object + string allocation that `toNote()` does — that allocation churn is a prime cause of GC-pause crackle.
  const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
  // Meter-aware position helpers — the single source of truth for "where are we in the bar" so every loop agrees
  // (and both decks, sharing the Transport, stay in lockstep). All derived from the deck's own arrangement meter
  // (3 or 4 beats/bar) and the transport tick, so they're drift-free and identical to the old 4/4 path when meter=4.
  const ppq = transport.PPQ
  const meterOf = () => arrRef.current.meter ?? 4
  const barTicks = () => ppq * meterOf() // ticks per bar (PPQ*4 for 4/4, PPQ*3 for 3/4)
  const ticksAt = (time: number) => transport.getTicksAtTime(time)
  const barAt = (time: number) => Math.floor(ticksAt(time) / barTicks())
  const beatInBar = (time: number) => Math.floor((ticksAt(time) % barTicks()) / ppq) // 0..meter-1
  const sixteenthInBar = (time: number) => Math.floor((ticksAt(time) % barTicks()) / (ppq / 4)) // 0..meter*4-1
  const eighthIn2Bars = (time: number) => Math.floor((ticksAt(time) % (barTicks() * 2)) / (ppq / 2)) // 0..meter*4-1

  // ── per-deck lofi chain → out (unity; the engine's CrossFade does the equal-power blend) ──
  const out = new Tone.Gain(1)
  const crush = new Tone.BitCrusher(8)
  crush.wet.value = initial.style.crush
  crush.connect(out)
  const lowpass = new Tone.Filter({ frequency: initial.style.lowpass, type: 'lowpass', rolloff: -12 }).connect(crush)
  const chorus = new Tone.Chorus(0.5, 3.0, 0.35) // slow wow/flutter
  chorus.wet.value = 0.3
  chorus.start()
  chorus.connect(lowpass)
  const widener = new Tone.StereoWidener(0.5).connect(chorus) // a little stereo spread (lofi width)
  const dryBus = new Tone.Gain(1).connect(widener)
  // ONE reverb is shared across both decks (engine-owned) — a convolver per deck was the heaviest fixed cost.
  // Each deck still controls its OWN send level (per-style × per-rarity space), so the wet stays per-deck.
  const wetSend = new Tone.Gain(initial.style.reverb).connect(sharedReverb)
  const both = (node: T.ToneAudioNode) => {
    node.connect(dryBus)
    node.connect(wetSend)
  }
  // sidechain bus: keys + pad route through here so the kick can DUCK them (the lofi "pump" — also keeps the
  // two loudest layers from peaking together, which buys clipping headroom).
  const duck = new Tone.Gain(1)
  both(duck)

  // ── instruments (all synthesized) ──
  const keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 7,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.008, decay: 0.7, sustain: 0.12, release: 1.4 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.2 },
    volume: -12,
  })
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
    envelope: { attack: 0.9, decay: 0.6, sustain: 0.7, release: 3 },
    volume: -26,
  })
  // `keys` carries BOTH the comp chords (long 1.4s release tail) AND the shape-voice arp, so on a dense late-game
  // orrery the voices stack past the default 32 ("Max polyphony exceeded; note dropped"). Give it headroom; the
  // pad only ever holds one sustained chord so it stays modest. (Idle-deck gating keeps the steady-state count to
  // one deck's worth, so this doesn't balloon CPU.)
  keys.maxPolyphony = 48
  pad.maxPolyphony = 24
  // Cap polyphony so overlapping voices (long releases × two decks; pad voices are 3 oscillators each) can't
  // pile up and spike CPU into buffer-underrun crackle. Generous — only bites on overload, stealing the oldest.
  keys.maxPolyphony = 12
  pad.maxPolyphony = 8
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.8 },
    filter: { Q: 1, type: 'lowpass' },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, baseFrequency: 120, octaves: 2.5 },
    volume: -11,
  })
  const pluck = new Tone.PluckSynth({ attackNoise: 0.7, dampening: 2600, resonance: 0.86, volume: -12 })
  const bell = new Tone.FMSynth({
    harmonicity: 5,
    modulationIndex: 11,
    envelope: { attack: 0.001, decay: 1.3, sustain: 0, release: 1.3 },
    volume: -18,
  })
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0 }, volume: -11 })
  const snareFilter = new Tone.Filter({ frequency: 1800, type: 'bandpass', Q: 0.8 })
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: -18 })
  snare.connect(snareFilter)
  const hatFilter = new Tone.Filter({ frequency: 7000, type: 'highpass' })
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 }, volume: -28 })
  hat.connect(hatFilter)
  const vinylFilter = new Tone.Filter({ frequency: 1400, type: 'bandpass', Q: 0.5 })
  const vinylGain = new Tone.Gain(0.05).connect(dryBus)
  vinylFilter.connect(vinylGain)
  const vinyl = new Tone.Noise('brown')
  vinyl.connect(vinylFilter)
  vinyl.start()
  const crackle = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.02, sustain: 0 }, volume: -22 }).connect(vinylGain)

  keys.connect(duck) // chords + pad get ducked by the kick
  pad.connect(duck)
  both(pluck)
  both(bell)
  bass.connect(dryBus)
  kick.connect(dryBus)
  snareFilter.connect(dryBus)
  hatFilter.connect(dryBus)

  const playRole = (role: Role, midi: number, dur: string, time: number, vel: number) => {
    const hz = midiHz(midi)
    switch (role) {
      case 'keys':
        keys.triggerAttackRelease(hz, dur, time, vel)
        break
      case 'pad':
        pad.triggerAttackRelease(hz, dur, time, vel)
        break
      case 'bass':
        bass.triggerAttackRelease(hz, dur, time, vel)
        break
      case 'bell':
        bell.triggerAttackRelease(hz, dur, time, vel)
        break
      case 'pluck':
        pluck.triggerAttack(hz, time) // PluckSynth has no velocity arg
        break
    }
  }

  // ── scheduling (each loop checks the deck's own arrangement layers; a silent deck skips triggering) ──
  // chord index = bar position, so chords + bass agree (no shared mutable counter that can race / drift).
  // The pad lays a sustained bed once per bar; the KEYS comp on the section's chordHits rhythm, each stab
  // ringing until the next hit (so [1,0,0,0] sustains a whole bar, [1,0,1,0] is half-note stabs, etc.).
  const chordSeq = new Tone.Loop((time) => {
    const a = arrRef.current
    if (!audible || !a.layers.chords || layerMute.chords) return
    const m = a.meter ?? 4
    const beat = beatInBar(time) // 0..m-1
    const hzs = a.progression[barAt(time) % a.progression.length].map(midiHz)
    if (beat === 0 && a.layers.pad) pad.triggerAttackRelease(hzs, '1m', time, 0.25)
    if (a.chordHits[beat]) {
      let gap = 1
      while (gap < m && !a.chordHits[(beat + gap) % m]) gap++ // ring until the next comp hit (this bar's meter)
      keys.triggerAttackRelease(hzs, `0:${gap}:0`, time, 0.5)
    }
  }, '4n').start(0)

  // Bass moves under the chord per the section's bassMode (octave bounce / fifth / walking approach). In 4/4 it
  // plays the two half-notes (beats 0 & 2); in 3/4 it plays the waltz "oom" on the downbeat only.
  const bassSeq = new Tone.Loop((time) => {
    const a = arrRef.current
    if (!audible || !a.layers.bass || layerMute.bass) return
    const m = a.meter ?? 4
    const beat = beatInBar(time)
    const hIdx = m === 4 ? (beat === 0 ? 0 : beat === 2 ? 1 : -1) : beat === 0 ? 0 : -1 // which bass hit (−1 = none)
    if (hIdx < 0) return
    const bar = barAt(time)
    const root = a.progression[bar % a.progression.length][0] - 12
    let note = root
    if (a.bassMode === 'octave') note = hIdx === 0 ? root : root + 12
    else if (a.bassMode === 'fifth') note = hIdx === 0 ? root : root + 7
    else if (a.bassMode === 'walk' && hIdx === 1) {
      const next = a.progression[(bar + 1) % a.progression.length][0] - 12
      note = root + (next === root ? 2 : Math.sign(next - root) * 2) // step toward the next root
    }
    bass.triggerAttackRelease(midiHz(note), '4n', time, 0.7)
  }, '4n').start(0)

  const drumSeq = new Tone.Loop((time) => {
    const a = arrRef.current
    if (!audible || !a.layers.drums || a.style.sparse || layerMute.drums) return // ambient styles drop the kit
    const step = sixteenthInBar(time) // 0..m*4-1 (a.kick / a.snare are sized to the meter)
    const halftime = a.style.feel === 'halftime'
    if (a.kick[step] && !(halftime && step >= 8)) {
      // halftime: only the first half of the bar's kicks (laid-back, on beat 1) → a slower-feeling groove
      kick.triggerAttackRelease('C1', '8n', time, 0.9)
      // sidechain pump: dip the chords/pad on each kick, recover over ~⅙ s
      duck.gain.setValueAtTime(0.58, time)
      duck.gain.linearRampToValueAtTime(1, time + 0.18)
    }
    const snareOn = halftime ? step === 8 : a.snare[step] // halftime backbeat lands on beat 3, not 2 & 4
    if (snareOn) snare.triggerAttackRelease('8n', time, 0.7)
    const r = det(a.seed, step + 100)
    if (r > 1 - a.style.drumDensity) hat.triggerAttackRelease('16n', time, 0.15 + r * 0.3) // density from the style
  }, '16n').start(0)

  // The shape-voice arp plays the section's GENERATED (2-bar) pentatonic motif — an actual evolving tune, fresh
  // every section. Each note lands on the next deployed shape's voice (its instrument), transposed to the voice's
  // register, so the melody is literally played by your collection.
  const arpSeq = new Tone.Loop((time) => {
    const a = arrRef.current
    if (!audible || !a.layers.shapeVoices || !a.voices.length || layerMute.arp) return
    const step = eighthIn2Bars(time) // 0..m*4-1 (a.arpMotif is sized to the meter)
    const deg = a.arpMotif[step]
    if (deg === undefined || deg < 0) return // rest
    const v = a.voices[step % a.voices.length]
    const octave = 12 * Math.floor((v.homeMidi - SCALE[0]) / 12) // lift the motif into this voice's register
    playRole(v.role, SCALE[deg] + octave, '8n', time, 0.3 + v.instrument.space * 0.2)
  }, '8n').start(0)

  let crackleStep = 0
  const crackleLoop = new Tone.Loop((time) => {
    const a = arrRef.current
    if (!audible || !a.layers.vinyl) return
    if (det(a.seed, (crackleStep++ + 300) >>> 0) > 0.6) crackle.triggerAttackRelease('32n', time) // reproducible (not wall-clock)
  }, '8n').start(0)

  const loops = [chordSeq, bassSeq, drumSeq, arpSeq, crackleLoop]
  const nodes = [keys, pad, bass, pluck, bell, kick, snare, snareFilter, hat, hatFilter, vinyl, vinylFilter, vinylGain, crackle, chorus, widener, lowpass, crush, wetSend, dryBus, duck, out]
  const avgSpace = (a: Arrangement) => (a.voices.length ? a.voices.reduce((s, v) => s + v.instrument.space, 0) / a.voices.length : 0.2)

  return {
    out,
    setAudible: (v) => {
      audible = v
    },
    setArrangement: (a, time) => {
      arrRef.current = a
      // morph this deck's tonal recipe toward the new section's style (while it's silent, before the fade-in)
      lowpass.frequency.rampTo(a.style.lowpass, 0.6, time)
      crush.wet.rampTo(a.style.crush, 0.6, time)
      // reverb SEND level = style bias × per-rarity space (the shared reverb itself is engine-owned, wet=1)
      wetSend.gain.rampTo(a.style.reverb + avgSpace(a) * 0.25, 0.6, time)
      // INSTRUMENT timbre: each STYLE sets the lead's base character (so jrock bites, ambient stays mellow); the
      // "instrument variation" setting then adds a per-section nudge + pad movement on top (opt-out leaves the
      // pure style voice). Safe to set() here — this deck is silent (pre-fade), so no zipper/click.
      const base = LEAD_TONE[a.style.id] ?? DEFAULT_TONE
      const vary = useMusicPrefs.getState().instrumentVariation
      const nudge = vary ? (det(a.seed, 0x5151) - 0.5) * 4 : 0 // ± a bit of mod-index per section
      keys.set({ harmonicity: base.h, modulationIndex: Math.max(1, base.m + nudge), envelope: base.env })
      pad.set({ detune: vary ? -10 + Math.round(det(a.seed, 0x7373) * 20) : 0 })
      const bt = BASS_TONE[a.style.id] ?? DEFAULT_BASS
      bass.set({ oscillator: { type: bt.osc }, filterEnvelope: { octaves: bt.oct } })
      const dt = DRUM_TONE[a.style.id] ?? DEFAULT_DRUMS
      kick.set({ pitchDecay: dt.kPitch, envelope: { decay: dt.kDecay } })
      snare.set({ noise: { type: dt.sNoise } })
      snareFilter.frequency.rampTo(dt.sCut, 0.5, time)
      hat.set({ envelope: { decay: dt.hDecay } })
      hatFilter.frequency.rampTo(dt.hCut, 0.5, time)
    },
    dispose: () => {
      try {
        loops.forEach((l) => l.dispose())
        vinyl.stop()
        nodes.forEach((n) => (n as { dispose: () => void }).dispose())
      } catch {
        /* best-effort */
      }
    },
  }
}

interface Engine {
  setLoadout: (shapes: ShapeRow[]) => void
  setVolume: (v: number) => void
  play: () => void
  pause: () => void
  dispose: () => void
}

function buildEngine(Tone: ToneMod, initialShapes: ShapeRow[]): Engine {
  const transport = Tone.getTransport()
  let epoch = 0
  let current = arrangementForEpoch(initialShapes, epoch)

  // music-volume + on/off kill-switch (silences the vinyl too). The MUSIC has its OWN context + master now
  // (split from the SFX): master → a final tanh soft-clip safety → this context's destination. A native analyser
  // taps the master so the under-the-hood meter still reads the music's peak (the loud bus that can clip).
  const master = new Tone.Gain(0)
  const softclip = new Tone.WaveShaper((x: number) => Math.tanh(1.3 * x)) // bounded ±, so no hard digital clip
  master.connect(softclip)
  softclip.toDestination()
  const musicMeter = (Tone.getContext().rawContext as unknown as AudioContext).createAnalyser()
  musicMeter.fftSize = 1024
  master.connect(musicMeter as unknown as T.InputNode)
  registerMusicAnalyser(musicMeter)
  // Gain staging that fixes clipping WITHOUT going soft: keep the body at a healthy level (premaster), then a
  // fast compressor tames the drum TRANSIENTS (the actual clip culprits), and a brickwall limiter is the final
  // ceiling. Makeup is implicit — the compressor lets the average sit loud while peaks stay under the limiter.
  const limiter = new Tone.Limiter(-1.5).connect(master)
  const glue = new Tone.Compressor({ threshold: -14, ratio: 4, attack: 0.004, release: 0.16 }).connect(limiter)
  const premaster = new Tone.Gain(0.62).connect(glue)
  // ONE shared reverb (wet=1 send bus) for both decks — halves the convolution cost vs a reverb per deck.
  const reverb = new Tone.Reverb({ decay: 4.5, wet: 1 }).connect(premaster)
  // equal-power crossfade between the two decks (no mid-fade level dip): fade 0 = deck A, 1 = deck B.
  const xfade = new Tone.CrossFade(0).connect(premaster)
  const deckA = buildDeck(Tone, current, reverb)
  const deckB = buildDeck(Tone, arrangementForEpoch(initialShapes, 1), reverb)
  deckA.out.connect(xfade.a)
  deckB.out.connect(xfade.b) // each deck self-connects its wetSend → the shared reverb passed in
  deckA.setAudible(true) // A starts as the playing deck; B idles silently until the first crossfade
  const sideOf = (d: Deck) => (d === deckA ? 0 : 1)
  let active = deckA
  let idle = deckB
  let disposed = false
  const timers: ReturnType<typeof setTimeout>[] = [] // pending "silence the outgoing deck after the fade"

  const barAt = (t: number) => Math.floor(transport.getTicksAtTime(t) / (transport.PPQ * current.meter)) // meter-aware (3/4 or 4/4)

  const setTempo = (a: Arrangement, time?: number, fadeSec = CROSSFADE_SEC) => {
    transport.swing = a.style.feel === 'swing' ? Math.max(a.swing, 0.34) : a.swing // jazz styles ride a deeper shuffle
    transport.swingSubdivision = '8n'
    transport.timeSignature = a.meter // 3 (waltz) or 4 — keeps `1m` pad durations the right length
    if (time != null) transport.bpm.rampTo(a.bpm, fadeSec, time)
    else transport.bpm.value = a.bpm
  }
  setTempo(current)

  const publish = (playing: boolean) => useBedStatus.getState().publish({ playing, current, sectionBars: SECTION_BARS })
  publish(false)

  // advance to a fresh section: configure the idle deck with the next epoch, then equal-power crossfade to it.
  // Called automatically every SECTION_BARS, and on demand from the inspector's reroll/style buttons.
  let fadeUntil = 0
  const advance = (time: number) => {
    const shapes = deployedShapes()
    if (!shapes.length) return // empty orrery → don't evolve
    if (time < fadeUntil) return // a crossfade is already in flight — ignore (debounces manual reroll spam)
    const prevMeter = current.meter
    epoch++
    current = arrangementForEpoch(shapes, epoch)
    // a meter change (into/out of a 3/4 waltz) can't smoothly cross-fade — the two bars don't line up — so cut
    // quickly instead of the long equal-power blend; same-meter sections keep the lush crossfade.
    const fadeSec = current.meter !== prevMeter ? 0.5 : CROSSFADE_SEC
    fadeUntil = time + fadeSec
    const outgoing = active
    idle.setAudible(true) // the incoming deck must trigger notes through the fade
    idle.setArrangement(current, time)
    setTempo(current, time, fadeSec)
    xfade.fade.rampTo(sideOf(idle), fadeSec, time) // equal-power blend toward the freshly-configured deck
    active = idle
    idle = outgoing
    publish(true)
    // once the fade completes, the outgoing deck goes silent (idles) until it's the incoming deck again
    timers.push(setTimeout(() => { if (!disposed) outgoing.setAudible(false) }, fadeSec * 1000 + 150))
  }
  const sectionId = transport.scheduleRepeat((time) => advance(time), `${SECTION_BARS}m`, `${SECTION_BARS}m`)

  // controls for the "under the hood" inspector (reroll / cycle or pick the sub-style / mute layers / automatic)
  bedControl.advance = () => advance(Tone.now())
  bedControl.cycleStyle = () => {
    const ids = STYLES.map((s) => s.id)
    setForcedStyle(ids[(ids.indexOf(current.style.id) + 1) % ids.length])
    advance(Tone.now())
  }
  bedControl.pickStyle = (id) => {
    setForcedStyle(id)
    advance(Tone.now())
  }
  bedControl.clearStyle = () => {
    setForcedStyle(null)
    advance(Tone.now())
  }
  bedControl.setLayerMute = (layer, muted) => {
    layerMute[layer] = muted
  }
  bedControl.getLayerMute = () => ({ ...layerMute })

  // beat meter: publish the live Transport position, drawn at the exact audio time so the meter stays in sync.
  let step = 0
  const meterLoop = new Tone.Loop((time) => {
    const s = step++
    const ci = current.active ? barAt(time) % current.progression.length : -1 // the chord actually sounding now
    Tone.getDraw().schedule(() => {
      useBedStatus.getState().publish({ step16: s % 16, sectionBar: Math.floor(s / 16) % SECTION_BARS, chordIdx: ci })
    }, time)
  }, '16n').start(0)

  let vol = 0.7
  return {
    setLoadout: (shapes) => {
      // reflect a deploy/recall immediately on the audible deck (idle deck refreshes on the next crossfade)
      current = arrangementForEpoch(shapes, epoch)
      active.setArrangement(current)
      publish(transport.state === 'started')
    },
    setVolume: (v) => {
      vol = v
      if (transport.state === 'started') master.gain.rampTo(v, 0.15)
    },
    play: () => {
      master.gain.rampTo(vol, 0.3)
      if (transport.state !== 'started') transport.start()
      publish(true)
    },
    pause: () => {
      master.gain.rampTo(0, 0.3)
      if (transport.state === 'started') transport.pause()
      publish(false)
    },
    dispose: () => {
      disposed = true
      timers.forEach(clearTimeout)
      bedControl.advance = bedControl.cycleStyle = bedControl.pickStyle = bedControl.clearStyle = bedControl.setLayerMute = bedControl.getLayerMute = undefined
      registerMusicAnalyser(null) // detach the meter tap (the analyser dies with the context)
      try {
        transport.clear(sectionId)
        meterLoop.dispose()
        deckA.dispose()
        deckB.dispose()
        reverb.dispose()
        xfade.dispose()
        premaster.dispose()
        glue.dispose()
        limiter.dispose()
        softclip.dispose()
        master.dispose()
        transport.stop()
        transport.cancel(0)
      } catch {
        /* best-effort teardown */
      }
      useBedStatus.getState().publish({ playing: false, current: null })
    },
  }
}

/**
 * Mounted inside the Orrery. Builds the evolving bed once (lazy Tone), keeps it in sync with the loadout, and
 * honors the Music mute + the orrery pause + the Music volume. Renders nothing.
 */
export function OrreryBedDriver() {
  useEffect(() => {
    let engine: Engine | null = null
    let cancelled = false

    const applyTransport = () => {
      if (!engine) return
      const { musicMuted, musicVol, focused, musicWhenUnfocused } = useMute.getState()
      const paused = useOrreryUi.getState().paused
      engine.setVolume(musicVol)
      const unfocusedGate = !focused && !musicWhenUnfocused // pause when the tab isn't focused, unless opted in
      if (musicMuted || paused || unfocusedGate || deployedShapes().length === 0) engine.pause()
      else engine.play()
    }

    let removeGesture: (() => void) | null = null
    let musicCtx: AudioContext | null = null
    ;(async () => {
      try {
        const Tone = await import('tone')
        if (cancelled) return
        // MUSIC gets its OWN big-buffer ('playback') context, separate from the snappy SFX context — its fat
        // sample cushion lets the audio thread ride through main-thread stalls (GC/render/HMR) without crackle.
        musicCtx = createPlaybackContext()
        Tone.setContext(musicCtx)
        // adaptive scheduling buffer: low/snappy by default, grows only when crackle (jank) is detected (see audio.ts)
        startAdaptiveLookAhead(Tone.getContext())
        engine = buildEngine(Tone, deployedShapes())
        const ensure = async () => {
          try {
            await Tone.start()
          } catch {
            /* ignore */
          }
          applyTransport()
        }
        await ensure()
        if (Tone.getContext().state !== 'running') {
          const onGesture = () => {
            void ensure().then(() => {
              if (Tone.getContext().state === 'running') removeGesture?.()
            })
          }
          window.addEventListener('pointerdown', onGesture)
          window.addEventListener('keydown', onGesture)
          removeGesture = () => {
            window.removeEventListener('pointerdown', onGesture)
            window.removeEventListener('keydown', onGesture)
            removeGesture = null
          }
        }
      } catch {
        /* audio unavailable — the orrery is just silent */
      }
    })()

    // keep the arrangement live as the player deploys/recalls shapes
    let lastLoadout = useGame.getState().view?.loadout
    const unsubGame = useGame.subscribe((s) => {
      const lo = s.view?.loadout
      if (lo !== lastLoadout) {
        lastLoadout = lo
        engine?.setLoadout(deployedShapes())
        applyTransport()
      }
    })
    // Only react to the fields we care about — NOT every hover/zoom/pan on the orrery UI, which would thrash
    // a master-gain ramp on every pointer move.
    let lastMute = { m: useMute.getState().musicMuted, v: useMute.getState().musicVol, f: useMute.getState().focused, u: useMute.getState().musicWhenUnfocused }
    let lastSrc = useMute.getState().musicSource
    const unsubMute = useMute.subscribe((s) => {
      if (s.musicSource !== lastSrc) {
        lastSrc = s.musicSource
        engine?.setLoadout(deployedShapes()) // orrery↔library: rebuild the band from the new source
        applyTransport()
      }
      if (s.musicMuted !== lastMute.m || s.musicVol !== lastMute.v || s.focused !== lastMute.f || s.musicWhenUnfocused !== lastMute.u) {
        lastMute = { m: s.musicMuted, v: s.musicVol, f: s.focused, u: s.musicWhenUnfocused }
        applyTransport()
      }
    })
    let lastPaused = useOrreryUi.getState().paused
    const unsubUi = useOrreryUi.subscribe((s) => {
      if (s.paused !== lastPaused) {
        lastPaused = s.paused
        applyTransport()
      }
    })
    // restrict the rotation to the player's enabled (owned + opted-in) styles; re-apply when they change in
    // settings or unlock one in the shop, and reroll so the change is heard immediately.
    const applyStyles = () => setEnabledStyles(useMusicPrefs.getState().enabledStyleIds())
    applyStyles()
    let lastEnabled = useMusicPrefs.getState().enabledStyleIds().join(',')
    const unsubPrefs = useMusicPrefs.subscribe(() => {
      const now = useMusicPrefs.getState().enabledStyleIds().join(',')
      if (now !== lastEnabled) {
        lastEnabled = now
        applyStyles()
        bedControl.advance?.() // roll into a section using the new style set
      }
    })

    return () => {
      cancelled = true
      removeGesture?.()
      unsubGame()
      unsubMute()
      unsubUi()
      unsubPrefs()
      stopAdaptiveLookAhead()
      engine?.dispose()
      void musicCtx?.close() // tear down the dedicated music context (frees its audio thread)
    }
  }, [])
  return null
}
