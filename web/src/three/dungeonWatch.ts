// The Expeditions WATCH timeline — a pure, deterministic compilation of the authoritative turn-based battle log
// into a continuous-time action-combat performance. The Rust `resolve_battle` is the TRUTH; this only renders it.
//
// THE FAITHFULNESS CONTRACT (binding on every renderer that reads this):
//   B1 HP = pure fold of (heal − dmg) over crossed impacts on e.target only, clamped [0, max_hp]. No shield model
//      (deal() logs post-shield deltas). Never an accumulating mutable ref → supports skip-to-end + loop reset.
//   B2 A unit dissolves IFF a crossed impact has fainted == it (a `revive` impact un-dissolves). Never on hp<=0.
//   B3 Winner is read from BattleResult.win, never inferred from end-state HP (round-limit draws leave both alive).
//   B4 Impacts copy the raw LogEvent (target,dmg,heal,status,fainted) verbatim — fusion is VISUAL only.
//   B5 Faint order is faithful (the kill lands at its own impact's time, even inside a fused ult).
//   B7 One integer-only watchSeed (render-only, never fed back to truth).
import type { BattleResult, LogEvent, UnitInfo } from '../game/store'

// pacing (seconds) — eyeball-tunable. Beats overlap for flow, but a faint is a hard sync point (no overlap).
const WINDUP = 0.26 // wind-up before the first impact of a beat
const STAGGER = 0.09 // between impacts fused into one beat (flurry hits / ult targets)
const SETTLE = 0.18 // after the last impact, before the beat "ends"
const OVERLAP = 0.22 // the next beat begins this early — clamped to 0 across any beat carrying a faint
const TAIL = 0.7 // a held beat after the final impact, before the result

export interface Impact {
  target: number
  dmg: number
  heal: number
  status: string
  fainted: number
  at: number // absolute seconds
}
export interface Beat {
  actor: number
  round: number
  action: string // the beat's primary action (first event) — drives the motion primitive
  actionId: number // RENDER-ONLY: which ability fired (0-9, indexes GACT_KEYS), or -1 — names the skill in the combat log
  ruleIdx: number // RENDER-ONLY: the gambit rule (0-based) that fired this beat, or -1 (legacy/fallback/enemy) — M1 watch highlight
  start: number // wind-up begins
  impactStart: number // first impact lands
  impacts: Impact[]
}
export interface Timeline {
  beats: Beat[]
  duration: number
}

// R10 dev perf-harness: set localStorage['exp-perf']='1' to emit a `performance.measure` for the (once-per-battle, NOT
// per-frame) timeline compile — visible in the browser Performance panel. Off by default ⇒ zero overhead. The per-frame
// hpAt/deadAt are deliberately NOT instrumented (a mark per frame would itself be the cost).
const expPerfOn = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('exp-perf') === '1'
  } catch {
    return false
  }
}

/** Compile the battle log into a fused, time-stamped timeline. Pure: same log ⇒ same timeline. */
export function buildTimeline(log: LogEvent[]): Timeline {
  const perf = expPerfOn()
  if (perf) performance.mark('exp:buildTimeline:start')
  const beats: Beat[] = []
  let cursor = 0
  let i = 0
  while (i < log.length) {
    const a = log[i].actor
    const r = log[i].round
    const group: LogEvent[] = []
    // fuse the consecutive run with the same (actor, round) — a multi-hit flurry / multi-target ult is ONE beat
    while (i < log.length && log[i].actor === a && log[i].round === r) {
      group.push(log[i])
      i++
    }
    const start = cursor
    const impactStart = start + WINDUP
    const impacts: Impact[] = group.map((e, k) => ({
      target: e.target,
      dmg: e.dmg,
      heal: e.heal,
      status: e.status,
      fainted: e.fainted, // B4: verbatim
      at: impactStart + k * STAGGER,
    }))
    beats.push({ actor: a, round: r, action: group[0].action, actionId: group[0].action_id ?? -1, ruleIdx: group[0].rule_idx ?? -1, start, impactStart, impacts })
    const beatLen = WINDUP + (group.length - 1) * STAGGER + SETTLE
    const hasFaint = impacts.some((im) => im.fainted >= 0)
    cursor += beatLen - (hasFaint ? 0 : OVERLAP) // B5: a faint hard-syncs (no overlap into the next beat)
  }
  const out: Timeline = { beats, duration: cursor + TAIL }
  if (perf) {
    performance.mark('exp:buildTimeline:end')
    performance.measure('exp:buildTimeline', 'exp:buildTimeline:start', 'exp:buildTimeline:end')
  }
  return out
}

/** All impacts with at <= t, in time order (== raw log order, since beats + impacts preserve it). */
function impactsUpTo(tl: Timeline, t: number, out: Impact[]): Impact[] {
  out.length = 0
  for (const b of tl.beats) {
    for (const im of b.impacts) {
      if (im.at <= t) out.push(im)
    }
  }
  return out
}

/** B1: pure HP-at-time fold. Returns a fresh array each call (no mutable accumulation). */
export function hpAt(tl: Timeline, units: UnitInfo[], t: number): number[] {
  const h = units.map((u) => u.max_hp)
  const buf: Impact[] = []
  for (const im of impactsUpTo(tl, t, buf)) {
    const k = im.target
    if (k >= 0 && k < h.length) {
      h[k] = Math.max(0, Math.min(units[k].max_hp, h[k] - im.dmg + im.heal))
    }
  }
  return h
}

/** Watch-only DPS/HPS/elapsed for the live combat meter — pure fold of ally-side impacts up to t. Attribution is by
 * the ACTING unit's side (not the target), so enemy damage isn't counted as party DPS. This is a RENDER metric off
 * the pacing constants (WINDUP/STAGGER/TAIL), NOT the Rust turn engine's authoritative timing — never persist/feed back. */
export function combatStats(tl: Timeline, units: UnitInfo[], t: number): { dmg: number; heal: number; elapsed: number; dps: number; hps: number; dpsBy: number[]; hpsBy: number[] } {
  let dmg = 0
  let heal = 0
  const dmgBy = units.map(() => 0) // per-ACTOR damage (per-shape attribution)
  const healBy = units.map(() => 0)
  for (const b of tl.beats) {
    if (units[b.actor]?.is_enemy) continue // only the party's own output
    for (const im of b.impacts) {
      if (im.at <= t) {
        dmg += im.dmg
        heal += im.heal
        if (b.actor >= 0 && b.actor < dmgBy.length) {
          dmgBy[b.actor] += im.dmg
          healBy[b.actor] += im.heal
        }
      }
    }
  }
  const el = Math.max(0.001, t)
  return { dmg, heal, elapsed: t, dps: dmg / el, hps: heal / el, dpsBy: dmgBy.map((d) => d / el), hpsBy: healBy.map((h) => h / el) }
}

/** B2: a unit is "down" iff its most-recent faint/revive crossing is a faint. */
export function deadAt(tl: Timeline, units: UnitInfo[], t: number): boolean[] {
  const dead = units.map(() => false)
  const buf: Impact[] = []
  for (const im of impactsUpTo(tl, t, buf)) {
    if (im.fainted >= 0 && im.fainted < dead.length) dead[im.fainted] = true
    if (im.status === 'revive' && im.target >= 0 && im.target < dead.length) dead[im.target] = false
  }
  return dead
}

/** The beat whose wind-up has begun at time t (the current actor's move), or null before the first. */
export function beatAt(tl: Timeline, t: number): Beat | null {
  let cur: Beat | null = null
  for (const b of tl.beats) {
    if (b.start <= t) cur = b
    else break
  }
  return cur
}

/** The next beat's actor (for the in-world pre-glow telegraph), or -1. */
export function nextActorAt(tl: Timeline, t: number): number {
  for (const b of tl.beats) {
    if (b.start > t) return b.actor
  }
  return -1
}

/** B7: one integer-only FNV-1a watch seed. Render-only; never fed back to truth. Drops `family` (no strings). */
export function watchSeed(battle: BattleResult): number {
  let h = 0x811c9dc5
  const mix = (x: number) => {
    h = Math.imul(h ^ (x | 0), 0x01000193) >>> 0
  }
  for (const u of battle.units) {
    mix(u.shape_id)
    mix(u.is_enemy ? 1 : 0)
    mix(u.max_hp)
  }
  mix(battle.rounds)
  mix(battle.log.length)
  return h >>> 0
}

/** A tiny deterministic PRNG seeded by watchSeed — for render-only layout jitter (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
