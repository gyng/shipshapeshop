import { useEffect, useRef } from 'react'
import { useGame } from './game/store'
import { useOrreryUi } from './orreryUi'
import { useMute, sharedAudioContext } from './audio'

// ── Orrery music engine ───────────────────────────────────────────────────────
// When shapes MEET on the hex grid (≥2 share a cell at a tick) they sing. The FEEL layer decides how it
// sounds; the truth (which meetings happen) comes from the Rust-authored orbit paths. Notes are pentatonic
// BY CONSTRUCTION (you index into a scale table — an out-of-scale pitch is unrepresentable), polyphony is
// hard-capped, and a master limiter guarantees stacked chords can't clip. So the orrery is always pleasant.

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

/** Deterministic, always-in-scale note for a shape. */
export function noteForShape(shapeId: number): number {
  return SCALE[mod(shapeId, SCALE.length)]
}

// Eigenmode timbre: a soft waveform chosen deterministically per shape (sine-leaning so it stays gentle).
const WAVES: OscillatorType[] = ['sine', 'triangle', 'sine', 'sine', 'triangle']
export function timbreForShape(shapeId: number): OscillatorType {
  return WAVES[mod(shapeId, WAVES.length)]
}

/**
 * Build a meeting's chord: dedupe by pitch (keeping each pitch's first shape's timbre), sort low→high, and
 * cap to MAX_POLY. Pure + deterministic.
 */
export function chordForMeeting(shapeIds: number[]): { midis: number[]; timbres: OscillatorType[] } {
  const byPitch = new Map<number, OscillatorType>()
  for (const id of shapeIds) {
    const m = noteForShape(id)
    if (!byPitch.has(m)) byPitch.set(m, timbreForShape(id))
  }
  const entries = [...byPitch.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_POLY)
  return { midis: entries.map((e) => e[0]), timbres: entries.map((e) => e[1]) }
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

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// ── Web Audio layer (shared context + master limiter + global voice cap) ──
let master: GainNode | null = null
let activeVoices: { osc: OscillatorNode; end: number }[] = []

function masterChain(ac: AudioContext): GainNode {
  if (master) return master
  const g = ac.createGain()
  g.gain.value = 0.55
  // hard limiter — stacked chords are squeezed under the ceiling, never clip
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.knee.value = 6
  comp.ratio.value = 12
  comp.attack.value = 0.003
  comp.release.value = 0.18
  g.connect(comp).connect(ac.destination)
  master = g
  return g
}

/** Play a meeting chord on the shared context (plucky, quiet). Mute-aware; global polyphony-capped. */
export function playChord(midis: number[], timbres: OscillatorType[]) {
  if (useMute.getState().muted || midis.length === 0) return
  try {
    const ac = sharedAudioContext()
    const out = masterChain(ac)
    const t0 = ac.currentTime + 0.001
    activeVoices = activeVoices.filter((v) => v.end > ac.currentTime) // reap finished
    if (activeVoices.length > GLOBAL_POLY) {
      // steal oldest
      const steal = activeVoices.splice(0, activeVoices.length - GLOBAL_POLY)
      for (const v of steal) try { v.osc.stop() } catch { /* already stopped */ }
    }
    const room = Math.max(1, GLOBAL_POLY - activeVoices.length)
    midis.slice(0, room).forEach((m, i) => {
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = timbres[i] ?? 'sine'
      osc.frequency.value = midiToFreq(m)
      const dur = 0.6
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(VOICE_GAIN, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(g).connect(out)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
      activeVoices.push({ osc, end: t0 + dur })
    })
  } catch {
    /* audio unavailable (no gesture / muted) — silent */
  }
}

/**
 * The driver: mounted in the Orrery engine. Advances a tick accumulator in real time (paused via orreryUi,
 * silent when muted), and on each NEW integer tick plays the meeting chords for that tick — once per tick.
 */
export function OrreryAudioDriver() {
  const tickMs = useGame((s) => s.view?.orrery_tick_ms ?? 1000)
  const orbits = useGame((s) => s.view?.orrery_orbits)
  const loadout = useGame((s) => s.view?.loadout)
  const orbitsRef = useRef(orbits)
  orbitsRef.current = orbits
  const loadoutRef = useRef(loadout)
  loadoutRef.current = loadout
  const paused = useOrreryUi((s) => s.paused)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    let t = 0
    let last = -1
    const loop = (now: number) => {
      const dt = now - prev
      prev = now
      if (!pausedRef.current && !useMute.getState().muted) t += dt / tickMs
      const tick = Math.floor(t)
      if (tick !== last) {
        last = tick
        const orbs = orbitsRef.current
        const lo = loadoutRef.current
        if (orbs && lo && orbs.length) {
          for (const ids of meetingsAtTick(orbs, lo, tick)) {
            const { midis, timbres } = chordForMeeting(ids)
            playChord(midis, timbres)
          }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tickMs])
  return null
}
