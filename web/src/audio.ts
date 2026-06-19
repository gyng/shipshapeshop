// Tiny WebAudio synth for juice — no voice acting (deferred), just gentle tones + per-rarity reveal chords
// (a stand-in for the Eigenmode-timbre layer). Created lazily on first user gesture (the pull button).

import { create } from 'zustand'
import { voiceOf } from './content/voiceSignatures'

const MUTE_KEY = 'shipshape-mute'
interface MuteStore {
  muted: boolean
  toggle: () => void
}
export const useMute = create<MuteStore>((set, get) => ({
  muted: typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1',
  toggle: () => {
    const muted = !get().muted
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (muted) stopVoice() // cut off any in-flight spoken line immediately
    set({ muted })
  },
}))

let ctx: AudioContext | null = null
function ac(): AudioContext {
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new C()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** The shared lazily-created AudioContext (orrery audio layers onto the same context). */
export function sharedAudioContext(): AudioContext {
  return ac()
}

function tone(freq: number, dur: number, delay = 0, type: OscillatorType = 'sine', gain = 0.1) {
  if (useMute.getState().muted) return
  try {
    const a = ac()
    const t0 = a.currentTime + delay
    const osc = a.createOscillator()
    const g = a.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(a.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
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
  if (useMute.getState().muted) return
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
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06)
      osc.connect(g).connect(a.destination)
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

const RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4 }
export function rarityRank(r: string | null): number {
  return r ? (RANK[r] ?? 0) : 0
}
