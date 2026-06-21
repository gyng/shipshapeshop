import { describe, it, expect } from 'vitest'
import { arrangementForEpoch, STYLES, type BassMode } from './orreryBed'
import type { AudioShape } from './orreryAudio'

// ── Verifies the 3/4 meter feature WITHOUT a browser, by replicating the EXACT position-helper formulas the
// driver (orreryBedDriver.tsx, buildDeck) uses, and asserting (a) 4/4 reproduces the old fixed-Sequence step
// indices bit-for-bit, and (b) 3/4 cycles correctly. This is the part that could break the (working) 4/4 path.

const PPQ = 192 // Tone's default; the formulas are PPQ-independent as long as it's divisible by 4
const barTicks = (m: number) => PPQ * m
const beatInBar = (t: number, m: number) => Math.floor((t % barTicks(m)) / PPQ)
const sixteenthInBar = (t: number, m: number) => Math.floor((t % barTicks(m)) / (PPQ / 4))
const eighthIn2Bars = (t: number, m: number) => Math.floor((t % (barTicks(m) * 2)) / (PPQ / 2))

describe('orrery bed — meter helpers (3/4 ⟷ 4/4 scheduling)', () => {
  it('4/4 reproduces the OLD fixed-Sequence step indices exactly (the chord/bass/drum/arp loops)', () => {
    // old drumSeq: a 16-step '16n' Sequence ⇒ step = (T / sixteenthTicks) % 16
    for (let k = 0; k < 64; k++) expect(sixteenthInBar(k * (PPQ / 4), 4)).toBe(k % 16)
    // old chordSeq/bassSeq beat: a 4-step '4n' Sequence ⇒ beat = (T / PPQ) % 4
    for (let k = 0; k < 32; k++) expect(beatInBar(k * PPQ, 4)).toBe(k % 4)
    // old arpSeq: a 16-step '8n' Sequence over 2 bars ⇒ step = (T / eighthTicks) % 16
    for (let k = 0; k < 64; k++) expect(eighthIn2Bars(k * (PPQ / 2), 4)).toBe(k % 16)
  })

  it('3/4 cycles its (shorter) bar correctly: 12 sixteenths, 3 beats, 12 eighths per 2 bars', () => {
    for (let k = 0; k < 48; k++) expect(sixteenthInBar(k * (PPQ / 4), 3)).toBe(k % 12)
    for (let k = 0; k < 24; k++) expect(beatInBar(k * PPQ, 3)).toBe(k % 3)
    for (let k = 0; k < 48; k++) expect(eighthIn2Bars(k * (PPQ / 2), 3)).toBe(k % 12)
  })

  it('the waltz bass fires only the downbeat "oom"; 4/4 bass fires the two half-notes (beats 0 & 2)', () => {
    // replicate the driver's hIdx: 4/4 ⇒ beats 0,2 play; 3/4 ⇒ beat 0 only
    const hIdx = (beat: number, m: number) => (m === 4 ? (beat === 0 ? 0 : beat === 2 ? 1 : -1) : beat === 0 ? 0 : -1)
    expect([0, 1, 2, 3].map((b) => hIdx(b, 4))).toEqual([0, -1, 1, -1]) // old 2n behaviour: beats 0 & 2
    expect([0, 1, 2].map((b) => hIdx(b, 3))).toEqual([0, -1, -1]) // waltz: downbeat only
  })
})

const mk = (id: number, o: Partial<AudioShape> = {}): AudioShape => ({ id, family: 'sphere', genus: 0, rarity: 'Common', euler_cost: 0, orientable: true, ...o })

describe('orrery bed — waltz arrangement is well-formed 3/4', () => {
  const waltz = STYLES.find((s) => s.id === 'waltz')!
  it('the waltz style is meter 3 and premium', () => {
    expect(waltz.meter).toBe(3)
    expect(waltz.premium).toBe(true)
  })
  it('a forced-waltz section produces 3/4-sized, valid patterns', () => {
    // force the waltz style so we exercise the meter-3 branch deterministically
    const band = [mk(1), mk(7, { family: 'trefoil' }), mk(12, { family: 'klein_bottle' })]
    // find an epoch whose style is waltz by scanning (the rotation includes it when premium is enabled = default)
    let found = false
    for (let e = 0; e < 400 && !found; e++) {
      const arr = arrangementForEpoch(band, e)
      if (arr.style.id !== 'waltz') continue
      found = true
      expect(arr.meter).toBe(3)
      expect(arr.kick.length).toBe(12)
      expect(arr.snare.length).toBe(12)
      expect(arr.chordHits.length).toBe(3)
      expect(arr.arpMotif.length).toBe(12)
      expect(arr.kick[0]).toBe(1) // an "oom" on the downbeat
      expect(['root', 'octave', 'fifth', 'walk']).toContain(arr.bassMode)
    }
    expect(found).toBe(true) // the waltz style is actually reachable in the rotation
  })
})

// silence the unused-import lint if BassMode isn't referenced elsewhere
export type _M = BassMode
