import { describe, it, expect } from 'vitest'
import {
  SCALE,
  SCALE_SET,
  MAX_POLY,
  LOUDNESS_CEILING,
  mixPeak,
  noteForShape,
  chordForMeeting,
  meetingsAtTick,
} from './orreryAudio'

// The validation gates: the orrery can never become noise — in-scale by construction, polyphony-capped,
// loudness-bounded, deterministic, and the musicality is pinned by a golden snapshot.

describe('orrery audio — in-scale by construction', () => {
  it('every shape note is a scale member', () => {
    for (let id = 0; id < 500; id++) expect(SCALE_SET.has(noteForShape(id))).toBe(true)
  })
  it('every chord pitch is a scale member', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ids = [seed, seed * 3 + 1, seed * 7 + 2, seed * 11 + 5, seed * 13 + 8]
      for (const m of chordForMeeting(ids).midis) expect(SCALE_SET.has(m)).toBe(true)
    }
  })
})

describe('orrery audio — polyphony cap + determinism', () => {
  it('a chord never exceeds the polyphony cap', () => {
    const big = Array.from({ length: 40 }, (_, i) => i)
    expect(chordForMeeting(big).midis.length).toBeLessThanOrEqual(MAX_POLY)
  })
  it('same shape ids → identical chord (deterministic)', () => {
    const a = chordForMeeting([3, 8, 14, 2])
    const b = chordForMeeting([3, 8, 14, 2])
    expect(a.midis).toEqual(b.midis)
    expect(a.timbres).toEqual(b.timbres)
  })
  it('chords are deduped + sorted ascending', () => {
    const { midis } = chordForMeeting([5, 5, 5]) // same shape thrice → one note
    expect(midis.length).toBe(1)
    const c = chordForMeeting([9, 1, 4]).midis
    expect([...c].sort((x, y) => x - y)).toEqual(c)
  })
})

describe('orrery audio — loudness ceiling', () => {
  it('a max chord stays under the loudness ceiling', () => {
    expect(mixPeak(MAX_POLY)).toBeLessThanOrEqual(LOUDNESS_CEILING)
  })
  it('the mix is capped no matter how many voices are requested', () => {
    expect(mixPeak(1000)).toBeLessThanOrEqual(LOUDNESS_CEILING)
    expect(mixPeak(1000)).toBe(mixPeak(MAX_POLY))
  })
})

describe('orrery audio — golden musicality snapshot', () => {
  it('a fixed two-lane orrery yields a stable chord sequence over its period', () => {
    // Two lanes that cross at [1,0] (tick 1) and [0,0] (tick 2). period = 4.
    const orbits = [
      { path: [[0, 0], [1, 0], [0, 0], [-1, 0]] as [number, number][], phase: 0, period: 4 },
      { path: [[2, 0], [1, 0], [0, 0], [1, 0]] as [number, number][], phase: 0, period: 4 },
    ]
    const loadout = [3, 8]
    const perTick: number[][][] = []
    for (let t = 0; t < 4; t++) {
      perTick.push(meetingsAtTick(orbits, loadout, t).map((ids) => chordForMeeting(ids).midis))
    }
    // shape 3 → SCALE[3]=64, shape 8 → SCALE[8]=76; meet at ticks 1 and 2 only.
    expect(SCALE[3]).toBe(64)
    expect(SCALE[8]).toBe(76)
    expect(perTick).toEqual([[], [[64, 76]], [[64, 76]], []])
  })
})
