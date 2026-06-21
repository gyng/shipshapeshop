import { describe, it, expect } from 'vitest'
import {
  SCALE,
  SCALE_SET,
  MAX_POLY,
  GLOBAL_POLY,
  VOICE_GAIN,
  LOUDNESS_CEILING,
  mixPeak,
  noteForShape,
  instrumentForShape,
  chordForMeeting,
  meetingsAtTick,
  type AudioShape,
} from './orreryAudio'

// A test shape descriptor — sphere/common/genus-0/orientable by default; override per case.
const mk = (id: number, o: Partial<AudioShape> = {}): AudioShape => ({
  id,
  family: 'sphere',
  genus: 0,
  rarity: 'Common',
  euler_cost: 0,
  orientable: true,
  ...o,
})

// The validation gates: the orrery can never become noise — in-scale by construction, polyphony-capped,
// loudness-bounded, deterministic, and the musicality is pinned by a golden snapshot.

describe('orrery audio — in-scale by construction', () => {
  it('every shape note is a scale member (any genus)', () => {
    for (let id = 0; id < 500; id++) expect(SCALE_SET.has(noteForShape(mk(id, { genus: id % 4 })))).toBe(true)
  })
  it('every chord pitch is a scale member', () => {
    for (let seed = 0; seed < 200; seed++) {
      const shapes = [seed, seed * 3 + 1, seed * 7 + 2, seed * 11 + 5, seed * 13 + 8].map((id) =>
        mk(id, { genus: id % 3 }),
      )
      for (const m of chordForMeeting(shapes).midis) expect(SCALE_SET.has(m)).toBe(true)
    }
  })
})

describe('orrery audio — polyphony cap + determinism', () => {
  it('a chord never exceeds the polyphony cap', () => {
    const big = Array.from({ length: 40 }, (_, i) => mk(i))
    expect(chordForMeeting(big).midis.length).toBeLessThanOrEqual(MAX_POLY)
  })
  it('same shapes → identical chord + voices (deterministic)', () => {
    const ids = [3, 8, 14, 2].map((id) => mk(id))
    const a = chordForMeeting(ids)
    const b = chordForMeeting(ids)
    expect(a.midis).toEqual(b.midis)
    expect(a.voices).toEqual(b.voices)
  })
  it('chords are deduped + sorted ascending', () => {
    const { midis } = chordForMeeting([mk(5), mk(5), mk(5)]) // same shape thrice → one note
    expect(midis.length).toBe(1)
    const c = chordForMeeting([mk(9), mk(1), mk(4)]).midis
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

describe('orrery audio — instrument derived from the shape descriptor', () => {
  it('the instrument is a stable function of family, not the id', () => {
    const a = instrumentForShape(mk(1, { family: 'trefoil' }))
    const b = instrumentForShape(mk(99, { family: 'trefoil' }))
    expect(a.patch).toBe(b.patch) // same family ⇒ same instrument
    expect(a.wave).toBe(b.wave)
    expect(a.patch).not.toBe(instrumentForShape(mk(1, { family: 'sphere' })).patch) // family changes it
  })
  it('genus pulls the register down one whole octave per hole', () => {
    // id 7: genus 0 → SCALE[7]=73; genus 1 → SCALE[2]=61 — exactly 12 semitones lower.
    expect(noteForShape(mk(7, { genus: 0 })) - noteForShape(mk(7, { genus: 1 }))).toBe(12)
  })
  it('non-orientability is the "flip"; orientable (or unknown) shapes do not flip', () => {
    expect(instrumentForShape(mk(1, { orientable: false })).flip).toBe(true)
    expect(instrumentForShape(mk(1, { orientable: true })).flip).toBe(false)
    expect(instrumentForShape(mk(1, { orientable: undefined })).flip).toBe(false) // field absent ⇒ no flip
  })
  it('exotic shapes (higher Euler cost) are brighter; rarer shapes are more spacious', () => {
    expect(instrumentForShape(mk(1, { euler_cost: 4 })).bright).toBeGreaterThan(
      instrumentForShape(mk(1, { euler_cost: 0 })).bright,
    )
    expect(instrumentForShape(mk(1, { rarity: 'Relic' })).space).toBeGreaterThan(
      instrumentForShape(mk(1, { rarity: 'Common' })).space,
    )
  })
})

describe('orrery audio — polyphony interaction', () => {
  it('a flip voice still counts as ONE musical voice (one voice per chord pitch)', () => {
    // distinct pitches via ids 0,1,2,3 (genus 0); all non-orientable so every voice flips.
    const chord = chordForMeeting([0, 1, 2, 3].map((id) => mk(id, { orientable: false })))
    expect(chord.voices.length).toBe(chord.midis.length) // the flip's extra oscillator is NOT a new voice
    expect(chord.voices.every((v) => v.flip)).toBe(true)
  })
  it('the global voice budget bounds peak loudness independent of patch richness', () => {
    // Per-voice peak is VOICE_GAIN regardless of instrument/flip, so GLOBAL_POLY voices is the worst case.
    expect(GLOBAL_POLY * VOICE_GAIN).toBeGreaterThan(0)
    expect(mixPeak(GLOBAL_POLY)).toBe(mixPeak(MAX_POLY)) // a single chord is still gated at MAX_POLY voices
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
      perTick.push(
        meetingsAtTick(orbits, loadout, t).map((ids) => chordForMeeting(ids.map((id) => mk(id))).midis),
      )
    }
    // shape 3 → SCALE[3]=64, shape 8 → SCALE[8]=76 (both genus 0); meet at ticks 1 and 2 only.
    expect(SCALE[3]).toBe(64)
    expect(SCALE[8]).toBe(76)
    expect(perTick).toEqual([[], [[64, 76]], [[64, 76]], []])
  })
})
