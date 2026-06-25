import { describe, it, expect } from 'vitest'
import type { BattleResult, LogEvent, UnitInfo } from '../game/store'
import { buildTimeline, hpAt, deadAt, watchSeed } from './dungeonWatch'

const U = (shape_id: number, is_enemy: boolean, max_hp: number): UnitInfo => ({
  shape_id,
  nick: 'u' + shape_id,
  family: 'sphere',
  is_enemy,
  max_hp,
  atk: 100,
  def: 12,
  speed: 100,
  ult_power: 200,
  element: 'solid',
  role: 'dps',
})
const E = (actor: number, round: number, action: string, target: number, dmg: number, heal: number, fainted = -1, status = ''): LogEvent => ({
  round,
  actor,
  action,
  target,
  dmg,
  heal,
  status,
  fainted,
})

// allies 0,1 (100 hp); foes 2,3 (60 hp). A fused ult (2 targets), a flurry (3 hits → a faith-bearing faint), a heal.
const units: UnitInfo[] = [U(10, false, 100), U(11, false, 100), U(-1, true, 60), U(-1, true, 60)]
const log: LogEvent[] = [
  E(0, 1, 'ult', 2, 30, 0), // beat A: ally 0 ults both foes (fused, 2 impacts)
  E(0, 1, 'ult', 3, 30, 0),
  E(2, 1, 'basic', 0, 20, 0), // beat B: foe 2 hits ally 0
  E(1, 1, 'skillB', 2, 15, 0), // beat C: ally 1 flurry on foe 2 (3 impacts)
  E(1, 1, 'skillB', 2, 15, 0),
  E(1, 1, 'skillB', 2, 15, 0, 2), // ← the kill: foe 2 faints on THIS impact
  E(0, 2, 'skillA', 0, 0, 25, -1, 'regen'), // beat D: ally 0 self-heal
]
const battle: BattleResult = { win: true, rounds: 2, party_size: 2, party_survivors: 2, units, log }

describe('dungeonWatch timeline (faithfulness contract)', () => {
  const tl = buildTimeline(log)

  it('fuses consecutive same-(actor,round) events into one beat (visual only — B4)', () => {
    expect(tl.beats.length).toBe(4) // ult, foe-basic, flurry, heal
    expect(tl.beats[0].impacts.length).toBe(2) // the 2-target ult
    expect(tl.beats[2].impacts.length).toBe(3) // the 3-hit flurry
    // impacts copy the raw LogEvent verbatim (B4)
    expect(tl.beats[2].impacts.map((i) => i.dmg)).toEqual([15, 15, 15])
    expect(tl.beats[0].impacts.map((i) => i.target)).toEqual([2, 3])
  })

  it('B1: HP is a pure clamped fold of (heal − dmg) on target only', () => {
    const h = hpAt(tl, units, tl.duration)
    expect(h[0]).toBe(100) // 100 −20 +25 = 105 → clamped to max 100
    expect(h[1]).toBe(100)
    expect(h[2]).toBe(0) // 60 −30 −15 −15 −15 = −15 → clamped 0
    expect(h[3]).toBe(30) // 60 −30
    // pure: two calls at the same t are equal (no mutable accumulation)
    expect(hpAt(tl, units, tl.duration)).toEqual(h)
  })

  it('B2/B5: a unit dissolves IFF a crossed impact faints it, at THAT impact time (not the beat end)', () => {
    const killImpact = tl.beats[2].impacts[2] // the 3rd flurry hit carries fainted=2
    expect(killImpact.fainted).toBe(2)
    // just before the kill impact, foe 2 is still alive; just after, it's down
    expect(deadAt(tl, units, killImpact.at - 0.001)[2]).toBe(false)
    expect(deadAt(tl, units, killImpact.at + 0.001)[2]).toBe(true)
    // the other foe never faints
    expect(deadAt(tl, units, tl.duration)[3]).toBe(false)
    expect(deadAt(tl, units, tl.duration)[2]).toBe(true)
  })

  it('a revive impact un-dissolves the unit (phoenix path)', () => {
    const rlog: LogEvent[] = [
      E(2, 1, 'basic', 0, 200, 0, 0), // ally 0 (100hp) is killed
      E(0, 1, 'revive', 0, 0, 30, -1, 'revive'), // ...then revives at 30
    ]
    const rtl = buildTimeline(rlog)
    const faintAt = rtl.beats[0].impacts[0].at
    const reviveAt = rtl.beats[1].impacts[0].at
    expect(deadAt(rtl, [U(10, false, 100), U(-1, true, 60)], faintAt + 0.001)[0]).toBe(true)
    expect(deadAt(rtl, [U(10, false, 100), U(-1, true, 60)], reviveAt + 0.001)[0]).toBe(false)
  })

  it('B7: watchSeed is a stable integer and takes plain data (no WASM)', () => {
    const a = watchSeed(battle)
    const b = watchSeed(battle)
    expect(a).toBe(b)
    expect(Number.isInteger(a)).toBe(true)
    expect(a).toBeGreaterThanOrEqual(0)
  })

  it('beats are time-ordered and a faint hard-syncs (no overlap into the next beat)', () => {
    for (let k = 1; k < tl.beats.length; k++) {
      expect(tl.beats[k].start).toBeGreaterThanOrEqual(tl.beats[k - 1].start)
    }
    // the flurry beat (index 2) carries a faint → the next beat starts at/after the flurry fully ends
    const flurry = tl.beats[2]
    const lastImpact = flurry.impacts[flurry.impacts.length - 1].at
    expect(tl.beats[3].start).toBeGreaterThanOrEqual(lastImpact)
  })
})
