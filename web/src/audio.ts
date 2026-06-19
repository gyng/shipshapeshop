// Tiny WebAudio synth for juice — no voice acting (deferred), just gentle tones + per-rarity reveal chords
// (a stand-in for the Eigenmode-timbre layer). Created lazily on first user gesture (the pull button).

import { create } from 'zustand'

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

const RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4 }
export function rarityRank(r: string | null): number {
  return r ? (RANK[r] ?? 0) : 0
}
