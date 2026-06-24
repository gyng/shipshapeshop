// Tiny WebAudio synth for juice — no voice acting (deferred), just gentle tones + per-rarity reveal chords
// (a stand-in for the Eigenmode-timbre layer). Created lazily on first user gesture (the pull button).

import { create } from 'zustand'
import { voiceOf } from './content/voiceSignatures'

// Two independent audio channels: SFX (pulls/forge/reveal/voice blips) and the orrery MUSIC bed. Each has its
// own mute + volume, persisted separately. (The old single 'shipshape-mute' migrates into the SFX channel.)
const K = { sfxMute: 'shipshape-mute-sfx', musicMute: 'shipshape-mute-music', sfxVol: 'shipshape-vol-sfx', musicVol: 'shipshape-vol-music', musicUnfocus: 'shipshape-music-unfocus', sfxUnfocus: 'shipshape-sfx-unfocus', musicSource: 'shipshape-music-source' }
const ls = (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null)
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const readVol = (k: string, dflt: number) => {
  const v = ls(k)
  const n = v == null ? NaN : parseFloat(v)
  return Number.isFinite(n) ? clamp01(n) : dflt
}
const legacyMuted = ls('shipshape-mute') === '1'

interface AudioStore {
  sfxMuted: boolean
  musicMuted: boolean
  sfxVol: number // 0..1
  musicVol: number // 0..1
  musicWhenUnfocused: boolean // keep the music playing when the tab/window isn't focused (default off)
  sfxWhenUnfocused: boolean // keep sfx playing when not focused (default off)
  musicSource: 'orrery' | 'library' // generate the bed from the deployed Orrery band, or the whole unlocked collection
  focused: boolean // runtime: is the tab/window focused & visible?
  toggleSfx: () => void
  toggleMusic: () => void
  setSfxVol: (v: number) => void
  setMusicVol: (v: number) => void
  toggleMusicWhenUnfocused: () => void
  toggleSfxWhenUnfocused: () => void
  toggleMusicSource: () => void
}
export const useMute = create<AudioStore>((set, get) => ({
  sfxMuted: ls(K.sfxMute) != null ? ls(K.sfxMute) === '1' : legacyMuted,
  musicMuted: ls(K.musicMute) === '1',
  sfxVol: readVol(K.sfxVol, 0.9),
  musicVol: readVol(K.musicVol, 0.7),
  musicWhenUnfocused: ls(K.musicUnfocus) === '1',
  sfxWhenUnfocused: ls(K.sfxUnfocus) === '1',
  musicSource: ls(K.musicSource) === 'library' ? 'library' : 'orrery',
  focused: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  toggleSfx: () => {
    const sfxMuted = !get().sfxMuted
    save(K.sfxMute, sfxMuted ? '1' : '0')
    if (sfxMuted) stopVoice() // cut off any in-flight spoken line immediately
    set({ sfxMuted })
  },
  toggleMusic: () => {
    const musicMuted = !get().musicMuted
    save(K.musicMute, musicMuted ? '1' : '0')
    set({ musicMuted })
  },
  setSfxVol: (v) => {
    const sfxVol = clamp01(v)
    save(K.sfxVol, String(sfxVol))
    set({ sfxVol })
  },
  setMusicVol: (v) => {
    const musicVol = clamp01(v)
    save(K.musicVol, String(musicVol))
    set({ musicVol })
  },
  toggleMusicWhenUnfocused: () => {
    const v = !get().musicWhenUnfocused
    save(K.musicUnfocus, v ? '1' : '0')
    set({ musicWhenUnfocused: v })
  },
  toggleSfxWhenUnfocused: () => {
    const v = !get().sfxWhenUnfocused
    save(K.sfxUnfocus, v ? '1' : '0')
    set({ sfxWhenUnfocused: v })
  },
  toggleMusicSource: () => {
    const v: 'orrery' | 'library' = get().musicSource === 'library' ? 'orrery' : 'library'
    save(K.musicSource, v)
    set({ musicSource: v })
  },
}))

// Track tab/window focus so audio can pause when you switch away (unless the player opts to keep it playing).
if (typeof window !== 'undefined') {
  const updateFocus = () => useMute.setState({ focused: document.visibilityState === 'visible' && document.hasFocus() })
  window.addEventListener('focus', updateFocus)
  window.addEventListener('blur', updateFocus)
  document.addEventListener('visibilitychange', updateFocus)
}

let ctx: AudioContext | null = null
const ctxClass = () => window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
function ac(): AudioContext {
  if (!ctx) {
    // SFX context: 'interactive' → the SMALLEST buffer, so blips fire with minimal latency (snappy clicks).
    ctx = new (ctxClass())({ latencyHint: 'interactive' })
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** A SEPARATE context with a big output buffer for the MUSIC bed — its fat sample cushion lets the audio thread
 *  ride straight through main-thread stalls (GC/render/HMR) without underrunning. Latency is irrelevant for
 *  background music, so this trades it for glitch-resistance; the SFX stay on the snappy `ac()` context. The
 *  'playback' string gives a moderate browser-chosen output buffer; the *dynamic* cushion is the adaptive
 *  lookAhead below (the only buffer resizable on a LIVE context), which grows on detected crackle. */
export function createPlaybackContext(): AudioContext {
  return new (ctxClass())({ latencyHint: 'playback' })
}

/** The shared lazily-created AudioContext (orrery audio layers onto the same context). */
export function sharedAudioContext(): AudioContext {
  return ac()
}

// A tanh soft-clip curve — output bounded to ±~0.96, so a WaveShaper using it can never emit a clipping sample
// (and peaks round off smoothly instead of hard-edged digital clipping).
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048
  const c = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(1.3 * x) // ≈linear for small x; saturates toward ±1 for peaks + clamps anything over-range
  }
  return c
}

// THE single master bus for ALL audio on the shared context: a brick-wall limiter (research config: thr −1,
// 20:1, fast, hard knee) followed by a soft-clip safety net → destination. Both the SFX/voice blips AND the
// Tone music bed route through this, so their SUM can never clip the hardware output (the real bug: two
// separate graphs each "fine" alone summed unbounded at the speakers).
let masterBusNode: GainNode | null = null
let meterAnalyser: AnalyserNode | null = null
export function audioMaster(): AudioNode {
  const a = ac()
  if (!masterBusNode) {
    const g = a.createGain()
    g.gain.value = 1
    const limiter = a.createDynamicsCompressor()
    limiter.threshold.value = -1
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.08
    const shaper = a.createWaveShaper()
    shaper.curve = softClipCurve()
    shaper.oversample = '2x'
    g.connect(limiter).connect(shaper).connect(a.destination)
    // a parallel tap on the SUMMED input (pre-limiter) so the diagnostics can show the true peak: if this rides
    // ≥ 1.0 the mix is overdriving (hard limiting / soft-clip grit); if it stays under but you still hear
    // crackle, it's buffer underruns / jitter (CPU), not clipping.
    meterAnalyser = a.createAnalyser()
    meterAnalyser.fftSize = 1024
    g.connect(meterAnalyser)
    masterBusNode = g
    startAudioMonitor() // begin watching for the main-thread stalls that cause underrun crackle
  }
  return masterBusNode
}

// The MUSIC bed lives on its own context now, so it registers its master analyser here for the meter to read.
let musicAnalyser: AnalyserNode | null = null
export function registerMusicAnalyser(a: AnalyserNode | null) {
  musicAnalyser = a
  if (a) startAudioMonitor() // the bed booted → start watching for main-thread stalls
}

const meterBuf = new Float32Array(1024)
/** Current peak sample magnitude of the pre-limiter signal (0..~). ≥1 ⇒ clipping into the limiter. Prefers the
 *  music bus (the loud one that can clip); falls back to the SFX bus when no bed is mounted. */
export function getMasterPeak(): number {
  const an = musicAnalyser ?? meterAnalyser
  if (!an) return 0
  an.getFloatTimeDomainData(meterBuf)
  let p = 0
  for (let i = 0; i < meterBuf.length; i++) {
    const v = meterBuf[i] < 0 ? -meterBuf[i] : meterBuf[i]
    if (v > p) p = v
  }
  return p
}

// ── Glitch / underrun tracking ────────────────────────────────────────────────────────────────────────────
// The Web Audio API exposes no output-underrun counter, but underruns here are caused by MAIN-THREAD STALLS
// (a GC pause or heavy React render that starves the audio callback past its lookAhead). We detect those
// directly: a rAF heartbeat whose inter-frame gap blows past a vsync interval is a stall that very likely
// dropped audio. Counting them (and the worst gap) gives an actionable "is the main thread janking?" signal.
const JANK_MS = 48 // a frame gap beyond ~3 vsync intervals ⇒ a stall worth flagging
let jankCount = 0
let maxJankMs = 0
let lastBeat = 0
let monitoring = false
function startAudioMonitor() {
  if (monitoring || typeof requestAnimationFrame === 'undefined') return
  monitoring = true
  lastBeat = performance.now()
  const beat = () => {
    const now = performance.now()
    const gap = now - lastBeat
    lastBeat = now
    if (gap > JANK_MS) {
      jankCount++
      if (gap > maxJankMs) maxJankMs = gap
    }
    requestAnimationFrame(beat)
  }
  requestAnimationFrame(beat)
}

export interface CtxStats {
  outputLatency: number // s — the output buffer cushion; small ⇒ underrun-prone, large ⇒ rides through stalls
  baseLatency: number // s
  sampleRate: number
  state: string // 'running' | 'suspended' | 'closed'
}
export interface AudioStats {
  jank: number // count of main-thread stalls (>JANK_MS) since the last reset — the underrun proxy (GLOBAL)
  maxJankMs: number // the worst stall
  music: CtxStats | null // the dedicated big-buffer ('playback') bed context
  sfx: CtxStats | null // the snappy ('interactive') SFX/voice context
}
function ctxStats(c: AudioContext | null | undefined): CtxStats | null {
  if (!c) return null
  return { outputLatency: c.outputLatency ?? 0, baseLatency: c.baseLatency ?? 0, sampleRate: c.sampleRate, state: c.state }
}
export function audioStats(): AudioStats {
  // the music context isn't owned here (the bed creates it) — recover it from the registered meter's analyser
  const musicCtx = musicAnalyser?.context as AudioContext | undefined
  return { jank: jankCount, maxJankMs, music: ctxStats(musicCtx), sfx: ctxStats(ctx) }
}
export function resetAudioStats() {
  jankCount = 0
  maxJankMs = 0
}

// ── Adaptive scheduling buffer ──────────────────────────────────────────────────────────────────────────────
// The output buffer is fixed at context creation, but Tone's `lookAhead` — how far ahead notes are scheduled —
// IS resizable on a live context, and it's the cushion that absorbs main-thread stalls. So we run it adaptively:
// hold it at a low MINIMUM (snappy) and grow it ONLY when crackle is detected (a jank stall that likely dropped
// audio), more for a worse burst; once things stay calm, ease it back down toward the minimum so latency
// recovers. Idempotent — a re-call (e.g. HMR re-mount) replaces the prior loop instead of leaking a second one.
let adaptiveTimer: ReturnType<typeof setInterval> | null = null
export function startAdaptiveLookAhead(ctx: { lookAhead: number }, opts?: { min?: number; max?: number }): void {
  startAudioMonitor() // ensure the jank heartbeat (our crackle signal) is running
  if (adaptiveTimer) clearInterval(adaptiveTimer)
  const MIN = opts?.min ?? 0.12 // baseline cushion — low latency while the main thread is calm
  const MAX = opts?.max ?? 0.5 // ceiling — beyond this, latency would be audible and bigger won't help DSP overload
  ctx.lookAhead = MIN
  let lastJank = jankCount
  let calm = 0
  adaptiveTimer = setInterval(() => {
    const dj = jankCount - lastJank
    lastJank = jankCount
    if (dj > 0) {
      // crackle detected this window → grow the buffer (a bigger burst grows it more), capped at MAX
      ctx.lookAhead = Math.min(MAX, ctx.lookAhead + 0.08 + Math.min(dj, 4) * 0.04)
      calm = 0
    } else if (++calm >= 4 && ctx.lookAhead > MIN) {
      // ~6s of calm → ease back toward the snappy minimum so latency isn't permanently inflated by one stall
      ctx.lookAhead = Math.max(MIN, ctx.lookAhead - 0.04)
    }
  }, 1500)
}
export function stopAdaptiveLookAhead() {
  if (adaptiveTimer) {
    clearInterval(adaptiveTimer)
    adaptiveTimer = null
  }
}

function tone(freq: number, dur: number, delay = 0, type: OscillatorType = 'sine', gain = 0.1) {
  const st = useMute.getState()
  if (st.sfxMuted || (!st.focused && !st.sfxWhenUnfocused)) return
  try {
    const a = ac()
    const t0 = a.currentTime + delay
    const osc = a.createOscillator()
    const g = a.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain * st.sfxVol, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(audioMaster()) // through the shared limiter/soft-clip, not straight to destination
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  } catch {
    /* audio unavailable (muted / no gesture yet) — silent fallback */
  }
}

/** Preview a shape's Eigenmode instrument: its descriptor-derived wave at its note, a gentle pluck with an
 *  octave-up shimmer (and a detuned chorus double for non-orientable "flip" voices). Mute/focus-aware. */
export function previewInstrument(midi: number, wave: OscillatorType = 'triangle', detune = 0, flip = false) {
  const st = useMute.getState()
  if (st.sfxMuted || (!st.focused && !st.sfxWhenUnfocused)) return
  try {
    const a = ac()
    const t0 = a.currentTime
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const peak = 0.13 * st.sfxVol
    const voice = (f: number, w: OscillatorType, p: number, dur: number, cents: number) => {
      const osc = a.createOscillator()
      const g = a.createGain()
      osc.type = w
      osc.frequency.value = f
      osc.detune.value = cents
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(p, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(g).connect(audioMaster())
      osc.start(t0)
      osc.stop(t0 + dur + 0.03)
    }
    voice(freq, wave, peak, 1.2, detune) // the note
    voice(freq * 2, 'sine', peak * 0.28, 0.55, detune) // octave-up body
    if (flip) voice(freq, wave, peak * 0.5, 1.2, detune + 14) // the non-orientable mirror chorus
  } catch {
    /* audio unavailable (muted / no gesture yet) — silent fallback */
  }
}

// ── Procedural character "voice" — short pitched blips under dialog captions (Animalese-style) ──
let activeVoice: OscillatorNode[] = []

/** Cut off any in-flight spoken line (called on line-advance / dialog close). */
export function stopVoice() {
  for (const osc of activeVoice) {
    try {
      osc.stop()
    } catch {
      /* already stopped */
    }
  }
  activeVoice = []
}

/** Speak a caption line in a character's voice: one quiet pitched blip per ~2 glyphs, timbre from the family. */
export function speak(family: string, text: string) {
  stopVoice()
  const st = useMute.getState()
  if (st.sfxMuted || (!st.focused && !st.sfxWhenUnfocused)) return
  try {
    const a = ac()
    const sig = voiceOf(family)
    const clean = text.replace(/\s+/g, ' ')
    let blip = 0
    const MAX = 44 // cap so long lines stay snappy
    for (let c = 0; c < clean.length && blip < MAX; c += 2) {
      if (clean[c] === ' ') continue
      const semi = (((clean.charCodeAt(c) % 7) - 3) * sig.jitter) / 6
      const freq = sig.baseFreq * Math.pow(2, semi / 12)
      const t0 = a.currentTime + (blip * sig.rate) / 1000
      const osc = a.createOscillator()
      const g = a.createGain()
      osc.type = sig.waveform
      osc.frequency.value = freq
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.05 * st.sfxVol, t0 + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06)
      osc.connect(g).connect(audioMaster())
      osc.start(t0)
      osc.stop(t0 + 0.08)
      activeVoice.push(osc)
      blip++
    }
  } catch {
    /* audio unavailable — captions remain the fallback */
  }
}

/** The press: a soft confirming blip. */
export function sfxPull() {
  tone(330, 0.09, 0, 'triangle', 0.07)
}

// ── Interaction SFX (UI juice) — quiet, gentle two-note gestures; all sfxVol/mute-aware via tone(). ──

/** Deploy a shape into the orrery: a confirming rising "plonk". */
export function sfxDeploy() {
  tone(523.25, 0.07, 0, 'sine', 0.08) // C5
  tone(783.99, 0.12, 0.05, 'triangle', 0.06) // → G5
}
/** Recall a shape from the orrery: a gentle descending lift-off. */
export function sfxRecall() {
  tone(659.25, 0.07, 0, 'sine', 0.06) // E5
  tone(440.0, 0.12, 0.05, 'sine', 0.05) // → A4
}
/** Tap a shape for Flux: a tiny bright coin blip (kept very quiet — taps can be rapid). */
export function sfxTap() {
  tone(880, 0.045, 0, 'triangle', 0.04) // A5
  tone(1318.51, 0.05, 0.02, 'sine', 0.022) // E6 sparkle
}
/** Pat a shape: an affectionate soft two-note. */
export function sfxPat() {
  tone(587.33, 0.09, 0, 'sine', 0.045) // D5
  tone(880, 0.13, 0.05, 'sine', 0.04) // → A5
}
/** Pick a gem up (drag start): a soft lift. */
export function sfxPickup() {
  tone(392, 0.05, 0, 'triangle', 0.045) // G4
}
/** Set a gem down (drag end / placement): a soft tap. */
export function sfxDrop() {
  tone(311.13, 0.07, 0, 'sine', 0.06) // E♭4
  tone(466.16, 0.06, 0.012, 'sine', 0.03) // B♭4
}
/** Switch screens: a barely-there swish. */
export function sfxTab() {
  tone(622.25, 0.04, 0, 'sine', 0.032) // E♭5
  tone(830.61, 0.05, 0.015, 'sine', 0.022) // → G♯5
}

/** The reveal: a chord that grows richer with rarity (0=Common … 4=UR). */
export function sfxReveal(rank: number) {
  const roots = [392, 440, 523.25, 587.33, 659.25] // G4 A4 C5 D5 E5
  const root = roots[Math.min(4, Math.max(0, rank))]
  tone(root, 0.5, 0, 'sine', 0.1)
  if (rank >= 1) tone(root * 1.25, 0.55, 0.02, 'sine', 0.08) // major third
  if (rank >= 2) tone(root * 1.5, 0.6, 0.04, 'sine', 0.07) // fifth
  if (rank >= 3) tone(root * 2, 0.7, 0.08, 'sine', 0.06) // octave shimmer
  if (rank >= 4) tone(root * 2.5, 0.9, 0.14, 'triangle', 0.05) // UR sparkle
}

export function sfxForge() {
  tone(220, 0.12, 0, 'sawtooth', 0.05)
  tone(330, 0.3, 0.06, 'sine', 0.08)
}

// The 10-pull haul recap lands: a quick upward flourish resolving onto a warm sustained major chord.
export function sfxHaul() {
  ;[392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.18, i * 0.05, 'triangle', 0.07)) // G C E G run-up
  ;[523.25, 659.25, 783.99].forEach((f) => tone(f, 0.8, 0.22, 'sine', 0.07)) // C-major pad
  tone(1046.5, 0.7, 0.28, 'sine', 0.04) // high shimmer
}

// A bright, triumphant major arpeggio for completing a milestone.
export function sfxMilestone() {
  ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, i * 0.08, 'triangle', 0.1))
  tone(1568, 0.5, 0.32, 'sine', 0.07) // shimmer up top
}

// Ascension (Recrystallize → New Game+): the grandest sting — a full rising sweep + a held shimmering chord.
export function sfxAscend() {
  ;[392, 523, 659, 784, 988, 1175].forEach((f, i) => tone(f, 0.6, i * 0.09, 'triangle', 0.1))
  tone(1568, 0.9, 0.55, 'sine', 0.08)
  tone(2093, 0.9, 0.62, 'sine', 0.05) // high shimmer
}

// Bond level-up: a warm, gentle rising third — affectionate, not fanfare.
export function sfxBondUp() {
  ;[523, 659, 880].forEach((f, i) => tone(f, 0.4, i * 0.07, 'sine', 0.09))
}

// Pull charge-up: a rising tension shimmer; longer & taller the rarer the incoming haul (anticipation).
export function sfxCharge(rank: number) {
  const steps = 5 + rank * 2
  for (let i = 0; i < steps; i++) {
    tone(196 * Math.pow(1.07, i), 0.16, i * 0.07, 'sawtooth', 0.035)
  }
}

// One tick per rarity tier "climbed" during the charge — pitch rises with the tier (the "it's going up!" beat).
export function sfxClimbTick(level: number) {
  tone(294 * Math.pow(1.2, level), 0.12, 0, 'triangle', 0.09)
  if (level >= 3) tone(294 * Math.pow(1.2, level) * 2, 0.18, 0.02, 'sine', 0.05) // sparkle on top tiers
}

// A rising arpeggio that gets taller/brighter the bigger the upgrade (intensity ~1..6).
export function sfxUpgrade(intensity: number) {
  const base = 330
  const notes = Math.max(2, Math.min(5, intensity))
  for (let i = 0; i < notes; i++) {
    tone(base * Math.pow(1.18, i), 0.12, i * 0.05, 'triangle', 0.11)
  }
  tone(base * Math.pow(1.18, notes), 0.34, notes * 0.05, 'sine', 0.1) // resolve note
}

// ── Expedition combat SFX (the spectator Watch is the engineered peak — it should sing) ──
/** A hit — short triangle thunk; bigger damage = a touch lower + louder (capped so a ×4 replay isn't a jackhammer). */
export function sfxHit(dmg: number) {
  const big = Math.min(1, dmg / 300)
  tone(240 - big * 70, 0.09, 0, 'triangle', 0.06 + big * 0.04)
}
/** A heal — gentle rising sine pair. */
export function sfxHeal() {
  tone(523, 0.12, 0, 'sine', 0.05)
  tone(784, 0.16, 0.06, 'sine', 0.045)
}
/** An Ultimate — a rising 5-note flourish; rank brightens it. */
export function sfxUlt(rank: number) {
  const base = 392 + rank * 40
  for (let i = 0; i < 5; i++) tone(base * Math.pow(1.2, i), 0.13, i * 0.05, 'sawtooth', 0.07)
  tone(base * 3, 0.4, 0.28, 'sine', 0.08)
}
/** A KO — a falling sine. */
export function sfxFaint() {
  tone(330, 0.1, 0, 'sine', 0.07)
  tone(165, 0.32, 0.08, 'sine', 0.07)
}
/** Battle outcome stings. */
export function sfxVictory() {
  const base = 523
  for (let i = 0; i < 4; i++) tone(base * [1, 1.26, 1.5, 2][i], 0.22, i * 0.1, 'triangle', 0.09)
}
export function sfxDefeat() {
  tone(294, 0.3, 0, 'sine', 0.08)
  tone(220, 0.45, 0.14, 'sine', 0.08)
}

const RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }
export function rarityRank(r: string | null): number {
  return r ? (RANK[r] ?? 0) : 0
}

// ── Pull "ball drop" ceremony SFX (appended; the engineered PEAK of the gacha loop) ─────────────────────────
// A noise burst routed through a band-pass — the percussive body shared by the drop/impact sounds. Mute/focus-
// aware via the same guard `tone()` uses. Used for the tactile "thock" of a capsule hitting the pile.
function noiseHit(centerFreq: number, dur: number, delay = 0, gain = 0.08, q = 1.2) {
  const st = useMute.getState()
  if (st.sfxMuted || (!st.focused && !st.sfxWhenUnfocused)) return
  try {
    const a = ac()
    const t0 = a.currentTime + delay
    const n = Math.floor(a.sampleRate * (dur + 0.02))
    const buf = a.createBuffer(1, n, a.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) // pre-decayed white noise
    const src = a.createBufferSource()
    src.buffer = buf
    const bp = a.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = centerFreq
    bp.Q.value = q
    const g = a.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain * st.sfxVol, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(bp).connect(g).connect(audioMaster())
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  } catch {
    /* audio unavailable — silent fallback */
  }
}

/** Drag wind-up: a soft rising tension whoosh that tracks the pull. `t` 0..1 = drag progress → higher/louder.
 *  Quiet by design (it fires repeatedly as the player drags); the climb is the "sensing the prize" tell. */
export function sfxPullDrag(t: number) {
  const p = Math.min(1, Math.max(0, t))
  tone(160 * Math.pow(2, p * 1.3), 0.13, 0, 'sawtooth', 0.018 + p * 0.03)
  if (p > 0.6) tone(160 * Math.pow(2, p * 1.3) * 1.5, 0.1, 0.01, 'sine', 0.012 * p) // a fifth shimmers in near the threshold
}

/** Release the gacha: a satisfying downward "thunk + air" as the drop is let go (the commit beat). */
export function sfxPullRelease(rank: number) {
  const r = Math.min(4, Math.max(0, rank))
  noiseHit(520 + r * 120, 0.16, 0, 0.07, 0.9) // air burst
  tone(220 - r * 12, 0.22, 0, 'sine', 0.09) // body thump, a touch deeper for rarer hauls
  tone(330, 0.14, 0.015, 'triangle', 0.05)
}

/** One capsule landing in the pile, sequenced on the ceremony's rhythm. `step` = which ball (rising pitch as
 *  the drops accelerate toward the reveal); `rank` brightens the top of the hit. A percussive noise "thock"
 *  fused with a pitched body — lands musically, building anticipation (the spec's "tempo" word). */
export function sfxBallDrop(step: number, rank: number) {
  const r = Math.min(4, Math.max(0, rank))
  // pentatonic climb so successive landings sound like a rising melody, not a random patter
  const penta = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
  const semis = penta[step % penta.length] + 12 * Math.floor(step / penta.length)
  const freq = 196 * Math.pow(2, semis / 12) // from G3 up the pentatonic ladder
  noiseHit(900 + r * 200, 0.07, 0, 0.05 + r * 0.012, 1.4) // the percussive "thock"
  tone(freq, 0.16, 0, 'triangle', 0.06 + r * 0.012) // the pitched body
  if (r >= 3) tone(freq * 2, 0.2, 0.02, 'sine', 0.035) // sparkle on top-tier landings
}

/** The big finale landing (the gold/top capsule settling) — a deeper, fuller impact that punctuates the drop
 *  sequence right before the reveal flash. */
export function sfxBallFinale(rank: number) {
  const r = Math.min(4, Math.max(0, rank))
  noiseHit(360, 0.26, 0, 0.1, 0.8) // a fat low thud
  tone(98, 0.34, 0, 'sine', 0.1) // sub body
  tone(196, 0.3, 0.01, 'triangle', 0.07)
  if (r >= 2) tone(392, 0.4, 0.04, 'sine', 0.05) // a bright overtone blooms for rare hauls
}
