// Expeditions — the opt-in idle RPG screen. Build MULTIPLE persistent teams from your collection, station them
// on quests to auto-clear (first win) then farm Echoes + Flux idle. "Watch" spectates a stationed team's
// deterministic battle (the CombatOverlay replays the Rust log over a 3D stage + a scrolling combat log). Shapes
// earn endless XP → levels → skill points spent in per-role trees. All numbers are Rust truth (the view);
// this file only renders + animates them. Echoes-bought perks live in the Workshop (see WorkshopView).
import { useState, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh, MeshPhysicalMaterial } from 'three'
import { getGeometry, OPEN_FAMILIES, buildPartyPtScene, partyGemLayout, partyTreeLayout } from './three/geometry'
import type { PartyPtScene } from './three/geometry'
import { sceneGemMatProps, sceneGemEmissiveBase } from './three/Gem'
import { ScenePostFX } from './three/ScenePostFX'
import { ExpeditionPathTrace } from './three/ExpeditionPathTrace'
import { GroundFog } from './three/GroundFog'
import { RenderTechBadge } from './three/RenderTechBadge'
import { useGfx } from './gfx'
import { create } from 'zustand'
import { useGame } from './game/store'
import type { ExpElement, UnitInfo, BattleResult, StationResult, RunView, DecisionOption } from './game/store'
import { ShapeGlyph } from './content/shapeGlyphs'
import { sfxHit, sfxHeal, sfxUlt, sfxFaint, sfxVictory, sfxDefeat } from './audio'
import { ExpeditionMap } from './ExpeditionMap'
import { buildTimeline, hpAt, deadAt, combatStats, type Timeline, type Beat } from './three/dungeonWatch'
import { useT } from './i18n'

const ECHO = '#9b8cff'
const GOLD = 'var(--c-accent-gold, #ffcf6b)'
const FLUX = 'var(--c-accent-gold, #ffcf6b)'
const ELEMENT_C: Record<ExpElement, string> = { solid: '#7fb0ff', twisted: '#c08cff', woven: '#5fe0c6' }

// render-only: the gambit rule firing RIGHT NOW in the live combat → the TacticsPanel highlights it (so you can SEE
// your tactics drive the fight). `ruleIdx === -1` is the implicit default "attack" fallback (the "Otherwise → attack"
// line). Cleared when no ally is acting / the combat is paused or unmounts. Truth-free (a presentation echo of the
// already-deterministic `rule_idx` on the battle log).
type LiveFire = { team: number; slot: number; ruleIdx: number } | null
const useLiveFiring = create<{ fire: LiveFire; set: (f: LiveFire) => void }>((set) => ({ fire: null, set: (fire) => set({ fire }) }))

// render-only: the live combat's revealed beats + the current step → the Combat Log tab renders it (newest first). The
// log is a presentation echo of the deterministic battle log (the truth), revealed in step with the on-screen fight.
type LiveLog = { units: UnitInfo[]; beats: Beat[]; step: number } | null
const useLiveLog = create<{ log: LiveLog; set: (l: LiveLog) => void }>((set) => ({ log: null, set: (log) => set({ log }) }))
const ELEMENT_HEX: Record<ExpElement, string> = { solid: '#7fb0ff', twisted: '#c08cff', woven: '#5fe0c6' }
const ROLE: Record<string, { icon: string; c: string }> = {
  tank: { icon: '🛡', c: '#7fb0ff' },
  dps: { icon: '⚔', c: '#ff8a6b' },
  support: { icon: '✚', c: '#5fe0c6' },
  control: { icon: '🌀', c: '#c08cff' },
}
const KNOT_FAMILIES = new Set(['trefoil', 'figure8_knot', 'torus_knot_2_5', 'borromean', 'seifert', 'hopf_link'])

// Floating damage/heal-number juice: scale font by magnitude (log-damped) and emphasize ults / big hits / faints /
// heals with colour + weight. Feel-only — reads the timeline impact, never the truth. `base` is the slot's base px.
function floatFx(ti: { dmg: number; heal: number; fainted: number } | undefined, isUlt: boolean, maxHp: number, base: number): { color: string; fontSize: number; fontWeight: number } {
  if (!ti) return { color: '#ffd1d1', fontSize: base, fontWeight: 800 }
  const heal = ti.heal > 0
  const mag = Math.max(ti.dmg, ti.heal)
  const faint = ti.fainted >= 0
  const big = ti.dmg > 0 && maxHp > 0 && ti.dmg >= maxHp * 0.22
  const scale = Math.min(1.85, 1 + Math.log10(1 + mag) * 0.16 + (isUlt ? 0.28 : 0) + (big ? 0.22 : 0))
  const color = heal ? '#7fe6a0' : isUlt || big ? '#ffd76b' : faint ? '#ff6b6b' : '#ffd1d1'
  return { color, fontSize: Math.round(base * scale), fontWeight: big || isUlt || faint ? 900 : 800 }
}

function elementOf(family: string, orientable: boolean): ExpElement {
  if (!orientable) return 'twisted'
  if (KNOT_FAMILIES.has(family)) return 'woven'
  return 'solid'
}
// NOTE: the expedition ROLE is NOT derived here — it is the authoritative `s.role` from core (prime directive).
const ROLE_IDX: Record<string, number> = { tank: 0, dps: 1, support: 2, control: 3 }
// compact duration (run ETA): minutes under an hour, else hours with one decimal.
// live countdown: mm:ss under an hour, else h m (the delve clock ticks toward the party's return)
const fmtCountdown = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
// a once-a-second self-ticking remaining-time clock (start/total are in the game's wall-clock domain — see store now())
function CountdownClock({ start, total, icon }: { start: number; total: number; icon: string }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 1000)
    return () => clearInterval(id)
  }, [])
  const remaining = Math.max(0, start + total - (performance.timeOrigin + performance.now()))
  return <span style={{ fontSize: 13, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>{icon} {fmtCountdown(remaining)}</span>
}
// shape ids that have a bespoke "freed" voice line (exp.recruit.<id>.freed) — the deep heroes you rescue
const RECRUIT_VOICE = new Set([10, 18, 26, 44])
// delve-track room glyphs (RoomKind: 0 combat, 1 boss, 2 campfire, 3 treasure, 4 shrine, 5 decision)
const DELVE_GLYPH = ['⚔', '👑', '🔥', '💎', '⛩', '🔀']
const EVENT_GLYPH: Record<'rest' | 'boon' | 'find', string> = { rest: '🔥', boon: '⛩', find: '💎' }
const ROOM_KEY = ['combat', 'boss', 'campfire', 'treasure', 'shrine', 'decision'] // i18n suffix for exp.room.* titles

// Display mirror of the Rust SKILL_TREES (same order/values) — Rust owns the effect; this is labels only.

function fmtRate(n: number): string {
  return Math.round(n).toLocaleString()
}

// R8: viewport width gate for the mobile tabbed tier (the desktop two-pane stacks below 1000px ⇒ controls get shoved
// far down; on narrow we show ONE pane at a time via a tab toggle).
function useIsNarrow(max = 999): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= max)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= max)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [max])
  return narrow
}

// The live Crossroads timeout overlay: when the party reaches an un-chosen Decision room, the player gets a countdown
// to steer (safe rest vs gamble) — else it auto-resolves. Truth is choose_decision (re-resolves the unbanked tail);
// this only VISUALIZES the pending choice and counts down to the WASM-emitted deadline (never derives it).
// The themed crossroads (matches core build_decision's `template`): name + flavor + per-option verb labels + a scene.
// The OPTIONS' effects come from Rust (pending_decision.options, authoritative); these strings are presentation only.
const DECISION_TEMPLATES: { name: string; flavor: string; opts: string[]; biome: BiomeKind; focal: FocalKind; theme: SceneTheme }[] = [
  { name: 'A Crossroads', flavor: 'The path forks here. Rest and recover, or press on for the spoils?', opts: ['Rest', 'Press on'], biome: 'forest', focal: 'campfire', theme: { floor: '#1a2e2c', fog: '#102320', key: '#ffcf6b' } },
  { name: 'The Old Altar', flavor: 'An offering-stone, still warm. Ask it for mending, for strength, or for swiftness.', opts: ['Mend', 'Strength', 'Swiftness'], biome: 'zen', focal: 'altar', theme: { floor: '#b8ac86', fog: '#cabd92', key: '#ffe6b0' } },
  { name: 'A Glittering Vein', flavor: 'Echo-crystal threads the rock. Pocket a few, dig it out, or pry the whole geode loose.', opts: ['Pocket a few', 'Dig it out', 'Pry it loose'], biome: 'crystal', focal: 'treasure', theme: { floor: '#1a1430', fog: '#100a22', key: '#9a7aff' } },
]
const decisionTemplate = (t: number) => DECISION_TEMPLATES[t] ?? DECISION_TEMPLATES[0]
// the crossroads' themed diorama scene (reuses the event scene machinery) shown behind the choice overlay
const decisionSceneEvent = (template: number): ExpEvent => {
  const t = decisionTemplate(template)
  return { id: `decision${template}`, name: t.name, flavor: t.flavor, group: 'find', biome: t.biome, focal: t.focal, theme: t.theme }
}
// an option's effect summary — pure icons + numbers (no words ⇒ locale-free + lint-safe as a {variable})
const optionLabel = (o: DecisionOption): string => {
  const parts: string[] = []
  if (o.heal_pct) parts.push(`♥ ${o.heal_pct > 0 ? '+' : ''}${o.heal_pct}%`)
  if (o.atk_pct) parts.push(`⚔ +${o.atk_pct}%`)
  if (o.speed_pct) parts.push(`⚡ +${o.speed_pct}%`)
  if (o.echo_bonus) parts.push(`✶ +${o.echo_bonus}`)
  return parts.join('   ') || '—'
}
function DecisionWindow() {
  const tr = useT()
  const pd = useGame((s) => s.view?.run?.pending_decision ?? null)
  const choose = useGame((s) => s.chooseDecision)
  const key = pd ? `${pd.room_idx}:${pd.deadline_ms}` : ''
  const [lapsedKey, setLapsedKey] = useState('')
  // the bar depletes via CSS (one keyframe over the window) — NO per-frame React loop, no ticking countdown, no red
  // urgency. A single timer dismisses it at the deadline; the safe default is the kind option (anti-FOMO, AGENTS §6).
  const durRef = useRef<{ key: string; dur: number }>({ key: '', dur: 0 })
  if (pd && durRef.current.key !== key) {
    durRef.current = { key, dur: Math.max(0, pd.deadline_ms - (performance.timeOrigin + performance.now())) }
  }
  useEffect(() => {
    if (!pd) return
    const remaining = pd.deadline_ms - (performance.timeOrigin + performance.now())
    if (remaining <= 0) {
      setLapsedKey(key)
      return
    }
    const id = window.setTimeout(() => setLapsedKey(key), remaining)
    return () => window.clearTimeout(id)
  }, [key, pd])
  if (!pd || lapsedKey === key) return null // no pending decision, or this one's window lapsed → the default already stands
  const tpl = decisionTemplate(pd.template)
  return (
    <div style={X.decisionOverlay} aria-live="polite">
      <div style={X.decisionCard}>
        <div style={X.decisionTitle}>{tpl.name}</div>
        <div style={X.decisionFlavor}>{tpl.flavor}</div>
        <div style={X.decisionBarTrack}><div key={key} className="exp-decision-bar" style={{ ...X.decisionBarFill, background: GOLD, animationDuration: `${durRef.current.dur}ms` }} /></div>
        <div style={X.decisionRow}>
          {pd.options.map((o, i) => (
            <button key={i} style={i === pd.auto_option ? X.decisionSafe : X.decisionGamble} onClick={() => choose(pd.room_idx, i)}>
              <span style={X.decisionOptName}>{tpl.opts[i] ?? optionLabel(o)}</span>
              <span style={X.decisionOptEff}>{optionLabel(o)}</span>
            </button>
          ))}
        </div>
        <div style={X.decisionHint}>{tr('exp.decision.hint')}</div>
      </div>
    </div>
  )
}

export function ExpeditionView() {
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const exp = useGame((s) => s.expContent)
  const setTeam = useGame((s) => s.setTeam)
  const setActiveTeam = useGame((s) => s.setActiveTeam)
  const addTeam = useGame((s) => s.addTeam)
  const removeTeam = useGame((s) => s.removeTeam)
  const unstation = useGame((s) => s.unstation)
  const combat = useGame((s) => s.combat)
  const autoOn = useGame((s) => s.view?.exp_auto ?? true)
  const setAuto = useGame((s) => s.setAuto)
  const sendExpedition = useGame((s) => s.sendExpedition)
  const watchRunRoom = useGame((s) => s.watchRunRoom)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [skillFor, setSkillFor] = useState<number | null>(null) // shape id whose skill tree is open
  const [rightTab, setRightTab] = useState<'dungeon' | 'log' | 'orders' | 'provisions' | 'record'>('log') // RIGHT pane controls as tabs; defaults to the live Combat Log (gambits is the standalone panel above)
  const onScreen = useGame((s) => s.activeTab === 'expedition') // pause the lead canvas off-tab
  const reportOpen = useGame((s) => s.delveReport != null)
  const isNarrow = useIsNarrow() // R8: below 1000px, show one pane at a time
  const [mobilePane, setMobilePane] = useState<'play' | 'controls'>('play')

  if (!view || !exp) return null
  const teams = view.exp_teams
  const activeT = Math.min(view.exp_active_team, teams.length - 1)
  const team = teams[activeT]?.members ?? []
  const partyFull = team.length >= view.exp_party_max

  const setMembers = (ids: number[]) => setTeam(activeT, ids)
  const addToParty = (id: number) => {
    if (!partyFull) setMembers([...team, id])
  }
  const removeFromParty = (id: number) => setMembers(team.filter((x) => x !== id))

  const roster = shapes
    .filter((s) => (view.owned[s.id] ?? 0) > 0 && !team.includes(s.id))
    .filter((s) => !search || s.nick.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (view.exp_power[b.id] ?? 0) - (view.exp_power[a.id] ?? 0))

  const questNick = (qi: number) => exp.quests[qi]?.nick ?? ''

  // perf gate for the lead 3D canvas: pause behind any modal + off-tab (it renders only when truly visible)
  const paused3d = !!combat || skillFor != null || picker || reportOpen || !onScreen
  const chapter = (() => {
    const r = view.run
    if (!r) return 1
    const node = r.path[Math.min(r.current_room, r.path.length - 1)]
    return exp.quests[node]?.chapter ?? 1
  })()
  // the active team's current EVENT NODE (a non-combat room) — its flavor is shown over the scene; null on combat/idle
  const liveEvent = (() => {
    const r = view.run
    if (!r || r.team !== activeT) return null
    const ri = Math.max(0, Math.min(r.current_room, r.room_kind.length - 1))
    return eventForRoom(r.room_kind[ri] ?? null, chapter, ri, r.start_ms)
  })()
  return (
    <div style={X.root}>
      <DecisionWindow />
      <div style={X.header}>
        <div>
          <h2 style={X.title}>{tr('exp.title')}</h2>
          <p style={X.subtitle}>{tr('exp.subtitle')}</p>
          {view.ng_cycle > 0 && <div style={X.deeperBadge} title={tr('exp.deeperHint')}>{tr('exp.deeper', { n: view.ng_cycle })}</div>}
        </div>
        <div style={X.headStats}>
          <div style={X.echoStat}>
            <span style={{ color: ECHO, fontSize: 'var(--fs-h3, 22px)', fontWeight: 700 }}>✶ {Math.floor(view.echoes).toLocaleString()}</span>
            <span style={X.statLbl}>{tr('exp.echoes')}</span>
          </div>
          {view.echo_rate_per_hr > 0 && (
            <div style={X.echoStat}>
              <span style={{ color: ECHO, fontWeight: 600 }}>+{fmtRate(view.echo_rate_per_hr)}/hr</span>
              <span style={X.statLbl}>{tr('exp.farming')}</span>
            </div>
          )}
          {view.exp_flux_rate > 0 && (
            <div style={X.echoStat}>
              <span style={{ color: GOLD, fontWeight: 600 }}>+{fmtRate(view.exp_flux_rate)}/hr</span>
              <span style={X.statLbl}>{tr('hud.flux')} ✦</span>
            </div>
          )}
          <button style={{ ...X.autoBtn, ...(autoOn ? X.autoOn : {}) }} onClick={() => setAuto(!autoOn)} title={tr('exp.autoTip')}>
            {autoOn ? '⏸' : '▶'} {tr('exp.auto')}
          </button>
        </div>
      </div>

      {/* ── desktop two-pane: LEFT = the 3D scene + the journey map below it; RIGHT = parties, gambits & controls.
          R8: below 1000px a tab toggle shows ONE pane at a time so the controls aren't shoved far down the page. ── */}
      {isNarrow && (
        <div style={X.mobileTabs} role="tablist">
          {(['play', 'controls'] as const).map((p) => (
            <button key={p} role="tab" aria-selected={mobilePane === p} style={{ ...X.mobileTab, ...(mobilePane === p ? X.mobileTabOn : {}) }} onClick={() => setMobilePane(p)}>{tr(`exp.mobile.${p}`)}</button>
          ))}
        </div>
      )}
      <div className={`exp-grid${isNarrow ? ` exp-m-${mobilePane}` : ''}`}>
        <div className="exp-left">
          {/* ── team switcher (top-left): switching the active team swaps the live view below ── */}
          <div style={X.teamsRail}>
            {teams.map((t, i) => (
              <button key={i} style={{ ...X.teamTab, ...(i === activeT ? X.teamTabOn : {}) }} onClick={() => setActiveTeam(i)}>
                <span style={X.teamTabName}>{tr('exp.teamN', { n: i + 1 })}</span>
                <span style={X.teamTabGlyphs}>
                  {t.members.length === 0 ? <span style={{ opacity: 0.4 }}>—</span> : t.members.map((id) => <span key={id}><ShapeGlyph family={shapes[id]?.family ?? ''} label={shapes[id]?.nick} /></span>)}
                </span>
                {/* combined with the old Active Farms section: the tab now carries the team's live status + farm rate */}
                {view.run?.team === i ? (
                  <span style={X.teamTabFarm}>⛏ {tr('exp.delving', { a: Math.min(view.run.current_room + 1, view.run.total_rooms), b: view.run.total_rooms })} · +{fmtRate(view.run.delve_echoes_per_hr)} ✶/hr{view.run.delve_flux_per_hr > 0 ? ` · +${fmtRate(view.run.delve_flux_per_hr)} ✦/hr` : ''}</span>
                ) : t.station >= 0 ? (
                  <span style={X.teamTabFarm}>✶ {questNick(t.station)} · +{fmtRate(t.echo_rate_per_hr)} ✶/hr{t.flux_rate_per_hr > 0 ? ` · +${fmtRate(t.flux_rate_per_hr)} ✦/hr` : ''}</span>
                ) : null}
              </button>
            ))}
            {teams.length < view.exp_max_teams && (
              <button style={X.teamAdd} onClick={addTeam} title={tr('exp.addTeam')}>＋ {tr('exp.team')}</button>
            )}
          </div>

          {/* SCENE: the active team's live node view (3D) + the delve HUD */}
          <div style={X.sceneWrap}>
          {/* the LIVE node view — delve combat / farm-clear loop / campfire; LiveNodeStage picks from the team's state */}
          <LiveNodeStage
            run={view.run && view.run.team === activeT ? view.run : null}
            station={teams[activeT]?.station ?? -1}
            teamIdx={activeT}
            members={team}
            shapes={shapes}
            chapter={chapter}
            paused={paused3d}
          />
          <div style={X.sceneHud}>
            {view.run && view.run.team === activeT ? (
              <>
                {liveEvent && (
                  <div style={X.eventCard}>
                    <span style={X.eventName}>{`${EVENT_GLYPH[liveEvent.group]} ${liveEvent.name}`}</span>
                    <span style={X.eventFlavor}>{liveEvent.flavor}</span>
                  </div>
                )}
                <span style={X.runStatus}>⛏ {tr('exp.delving', { a: Math.min(view.run.current_room + 1, view.run.total_rooms), b: view.run.total_rooms })}</span>
                <span style={X.delveRate} title={tr('exp.delveRate')}>
                  <span style={{ color: ECHO }}>+{fmtRate(view.run.delve_echoes_per_hr)} ✶/hr</span>
                  {view.run.delve_flux_per_hr > 0 && <span style={{ color: GOLD }}>{` +${fmtRate(view.run.delve_flux_per_hr)} ✦/hr`}</span>}
                </span>
                <div style={X.delveTrack}>
                  {view.run.room_kind.map((k, i) => {
                    const fight = k <= 1 // 0 combat, 1 boss → watchable
                    const cur = i === view.run!.room_kind.length - 1
                    const pending = !!view.run!.pending_decision && view.run!.pending_decision.room_idx === i // a live Crossroads — pulse it so the fork isn't missed
                    const cls = [cur ? 'exp-room-cur' : '', fight ? 'delve-fight' : '', pending ? 'exp-room-decision' : ''].filter(Boolean).join(' ') || undefined
                    const glyph = DELVE_GLYPH[k] ?? '•'
                    const sty = { ...X.delveRoom, ...(cur ? X.delveRoomCur : {}) }
                    return fight ? (
                      <button key={i} type="button" className={cls} style={{ ...sty, ...X.delveRoomFight }} onClick={() => watchRunRoom(i)} title={tr('exp.watchRoom')}>{glyph}</button>
                    ) : (
                      <span key={i} className={cls} style={sty} title={tr(`exp.room.${ROOM_KEY[k] ?? 'combat'}`)}>{glyph}</span>
                    )
                  })}
                  {Array.from({ length: Math.max(0, view.run.total_rooms - view.run.room_kind.length) }).map((_, i) => (
                    <span key={`d${i}`} style={X.delveDot}>·</span>
                  ))}
                </div>
                <CountdownClock start={view.run.start_ms} total={view.run.total_ms} icon="⏳" />
              </>
            ) : (teams[activeT]?.station ?? -1) >= 0 ? (
              <span style={X.runStatus}>✶ {tr('exp.gatheringAt', { node: questNick(teams[activeT]!.station) })}</span>
            ) : view.run_rest_until > performance.timeOrigin + performance.now() ? (
              <>
                <span style={X.runStatus}>🏕️ {tr('exp.restingCamp')}</span>
                <CountdownClock start={view.run_rest_until} total={0} icon="⏳" />
              </>
            ) : (
              // the PRIMARY action — a persistent, full-size button (never inert text), self-labeling its blocker so
              // the player always knows the next step (Fitts's + "one primary action per screen", AGENTS §6).
              <button
                style={{ ...X.sendBtn, ...(view.can_send_run ? {} : X.sendBtnBlocked) }}
                className={view.can_send_run ? 'btn-primary' : undefined}
                disabled={!view.can_send_run}
                onClick={() => view.can_send_run && sendExpedition(activeT)}
              >
                {view.can_send_run ? `⛏ ${tr('exp.send')}` : team.length === 0 ? tr('exp.sendBlockedEmpty') : tr('exp.sendBlockedNoPath')}
              </button>
            )}
          </div>
        </div>

          {/* TEAM COMPOSITION: the active team's party builder — surface-2, the primary anchor (lighter + accent + lift) */}
          <div style={{ ...X.panel, background: panelBgFocal, borderLeft: '3px solid rgba(155,140,255,0.7)', boxShadow: ELEV_2 }}>
        <div style={X.panelHead}>
          <h3 style={X.panelTitle}>{tr('exp.teamN', { n: activeT + 1 })}</h3>
          <span style={X.powerTag}>
            {tr('exp.power')}: <b style={{ color: GOLD }}>{(teams[activeT]?.power ?? 0).toLocaleString()}</b>
            {teams.length > 1 && teams[activeT]?.station < 0 && (
              <button style={X.removeTeamBtn} onClick={() => removeTeam(activeT)} title={tr('exp.removeTeam')}>🗑</button>
            )}
            {(teams[activeT]?.station ?? -1) >= 0 && (
              <button style={X.removeTeamBtn} onClick={() => unstation(activeT)} title={tr('exp.unstationTip')}>⏏ {tr('exp.farming')}</button>
            )}
          </span>
        </div>
        {teams[activeT] && team.length > 0 && (
          <div style={X.teamSummary}>
            <span style={X.tsGroup} title={tr('exp.ts.roles')}>
              {['tank', 'dps', 'support', 'control'].map((r, i) =>
                (teams[activeT]!.role_counts[i] ?? 0) > 0 ? (
                  <span key={r} style={{ color: ROLE[r].c }}>{`${ROLE[r].icon}${teams[activeT]!.role_counts[i]}`}</span>
                ) : null,
              )}
            </span>
            <span style={X.tsGroup} title={tr('exp.ts.elements')}>
              {['solid', 'twisted', 'woven'].map((e, i) =>
                (teams[activeT]!.element_counts[i] ?? 0) > 0 ? (
                  <span key={e} style={X.tsEl}>
                    <span style={{ ...X.elDot, background: ELEMENT_C[e as ExpElement] }} />
                    {teams[activeT]!.element_counts[i]}
                  </span>
                ) : null,
              )}
            </span>
            {teams[activeT]!.kin_pairs > 0 && (
              <span style={X.tsGroup} title={tr('exp.ts.kin')}>{`🔗${teams[activeT]!.kin_pairs}`}</span>
            )}
            <span style={X.tsGroup}>
              <span title={tr('exp.stat.hp')}>{`♥${teams[activeT]!.total_hp.toLocaleString()}`}</span>
              <span title={tr('exp.stat.atk')}>{`⚔${teams[activeT]!.total_atk.toLocaleString()}`}</span>
              <span title={tr('exp.stat.def')}>{`🛡${teams[activeT]!.total_def.toLocaleString()}`}</span>
            </span>
          </div>
        )}
        <div style={X.partyRow}>
          {Array.from({ length: view.exp_party_max }).map((_, i) => {
            const id = team[i]
            if (id == null) {
              return (
                <button key={`slot-${i}`} style={X.emptySlot} onClick={() => setPicker(true)} title={tr('exp.addMember')}>
                  ＋
                </button>
              )
            }
            const s = shapes[id]
            if (!s) return null
            const role = s.role
            const el = elementOf(s.family, s.orientable)
            const lvl = view.shape_levels[id] ?? 0
            const free = view.skill_points_free[id] ?? 0
            const st = view.exp_stats[id]
            const spdFrac = st ? Math.max(0.06, Math.min(1, (st.speed - 80) / 80)) : 0
            const span = 10 * (lvl + 1) + 45
            const frac = Math.max(0, Math.min(1, (span - (view.xp_to_next[id] ?? span)) / span))
            return (
              <div key={id} style={X.memberCard}>
                <span style={{ ...X.elDot, background: ELEMENT_C[el] }} />
                <button style={X.memberRemove} onClick={() => removeFromParty(id)} title={tr('exp.removeMember', { nick: s.nick })}>✕</button>
                <span style={X.memberGlyph}><ShapeGlyph family={s.family} /></span>
                <span style={X.memberNick}>{s.nick}</span>
                <span style={X.memberMeta}>
                  <span style={{ color: ROLE[role].c }}>{ROLE[role].icon}</span>
                  <span style={{ color: GOLD }}>★{view.star_levels[id] ?? 0}</span>
                </span>
                <span style={X.memberPow}>{(view.exp_power[id] ?? 0).toLocaleString()}</span>
                {st && (
                  <div style={X.statRow}>
                    <span style={X.statChip} title={tr('exp.stat.hp')}>{`♥${st.max_hp.toLocaleString()}`}</span>
                    <span style={X.statChip} title={tr('exp.stat.atk')}>{`⚔${st.atk.toLocaleString()}`}</span>
                    <span style={X.statChip} title={tr('exp.stat.def')}>{`🛡${st.def.toLocaleString()}`}</span>
                    <span style={X.statChip} title={tr('exp.stat.spd')}>{`⚡${st.speed}`}</span>
                  </div>
                )}
                <div style={X.spdBarWrap} title={tr('exp.stat.spd')}>
                  <div style={{ ...X.spdBar, width: `${spdFrac * 100}%` }} />
                </div>
                <div style={X.lvlBarWrap} title={tr('exp.levelN', { n: lvl })}>
                  <div style={{ ...X.lvlBar, width: `${frac * 100}%` }} />
                </div>
                <button style={{ ...X.skillBtn, ...(free > 0 ? X.skillBtnGlow : {}) }} onClick={() => setSkillFor(id)}>
                  Lv{lvl}{free > 0 ? ` · +${free}●` : ''}
                </button>
              </div>
            )
          })}
        </div>
        {team.length === 0 && <p style={X.hint}>{tr('exp.partyHint')}</p>}
      </div>

      {/* ── roster picker ── */}
      {picker && (
        <div style={X.panel}>
          <div style={X.panelHead}>
            <h3 style={X.panelTitle}>{tr('exp.choose')}</h3>
            <button style={X.closeBtn} onClick={() => setPicker(false)}>✕</button>
          </div>
          <input style={X.search} placeholder={tr('exp.searchRoster')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={X.rosterGrid}>
            {roster.map((s) => {
              const role = s.role
              const el = elementOf(s.family, s.orientable)
              return (
                <button key={s.id} style={{ ...X.rosterChip, opacity: partyFull ? 0.4 : 1 }} disabled={partyFull} onClick={() => addToParty(s.id)}>
                  <span style={{ ...X.elDot, background: ELEMENT_C[el] }} />
                  <span style={{ fontSize: 20 }}><ShapeGlyph family={s.family} /></span>
                  <span style={X.rosterNick}>{s.nick}</span>
                  <span style={{ color: ROLE[role].c, fontSize: 12 }}>{ROLE[role].icon}</span>
                  <span style={{ fontSize: 11, opacity: 0.6 }}>Lv{view.shape_levels[s.id] ?? 0}</span>
                  <span style={X.rosterPow}>{(view.exp_power[s.id] ?? 0).toLocaleString()}</span>
                </button>
              )
            })}
            {roster.length === 0 && <p style={X.hint}>{tr('exp.noRoster')}</p>}
          </div>
        </div>
      )}

          {/* MAP: the journey graph below the team section (compact; auto-scrolls to the current node) */}
          <div style={X.panel}>
            <div style={X.panelHead}>
              <h3 style={X.panelTitle}>{tr('exp.map')}</h3>
              <span style={X.mapLegend}>
                <span style={{ color: '#5fe0c6' }}>✓ {tr('exp.cleared')}</span>
                <span style={{ color: GOLD }}>● {tr('exp.ready')}</span>
                <span style={{ color: '#ff8a6b' }}>⚠ {tr('exp.risky')}</span>
                <span style={{ color: ECHO }}>✶ {tr('exp.farming')}</span>
                <span style={{ opacity: 0.6 }}>◆ {tr('exp.node.boss')}</span>
                <span style={{ opacity: 0.6 }}>🔒 {tr('exp.node.locked')}</span>
              </span>
            </div>
            <div style={X.mapScroll}>
              <ExpeditionMap activeTeam={activeT} autoScroll />
            </div>
          </div>
        </div>{/* exp-left */}

        <div className="exp-right">
          {/* GAMBIT / tactics — a standalone panel at the top of the right pane (no longer a tab) */}
          <TacticsPanel activeTeam={activeT} />

      {/* (the old Active Farms panel is gone — its station + rate now live on each team tab in the switcher, and
          selecting a team shows it live inline; unstation moved to the team-composition header.) */}

      {/* ── controls as TABS (log / orders / provisions / record) — defaults to the live Combat Log ── */}
      <div style={X.modeTabs}>
        {(['dungeon', 'log', 'orders', 'provisions', 'record'] as const).map((tb) => (
          <button key={tb} style={{ ...X.modeTab, ...(rightTab === tb ? X.modeTabOn : {}) }} onClick={() => setRightTab(tb)}>{tr(`exp.tab.${tb}`)}</button>
        ))}
      </div>
      {rightTab === 'dungeon' && <DungeonMapPanel run={view.run && view.run.team === activeT ? view.run : null} watchRunRoom={watchRunRoom} />}
      {rightTab === 'log' && <CombatLogPanel />}
      {rightTab === 'orders' && <OrdersPanel activeTeam={activeT} embedded />}
      {rightTab === 'provisions' && <ProvisionsPanel activeTeam={activeT} embedded />}
      {rightTab === 'record' && <RecordPanel embedded />}
        </div>{/* exp-right */}
      </div>{/* exp-grid */}

      {combat && <CombatOverlay battle={combat.battle} result={combat.result} quest={combat.quest} />}
      {skillFor != null && <SkillPanel id={skillFor} onClose={() => setSkillFor(null)} />}
      <DelveReportToast />
    </div>
  )
}

// ── 3D combat stage: one Canvas, the combatant's REAL collected shape (getGeometry, cached + unit-normalized),
// on a cheap clearcoat-PBR material (sceneGemMatProps glass=false — never transmission for a crowd) ──
function CombatGem({ family, element, x, z, rank, toward, adv, dead, acting, telegraph, hitKey, firing }: { family: string; element: ExpElement; x: number; z: number; rank: number; toward: [number, number] | null; adv: boolean; dead: boolean; acting: boolean; telegraph: boolean; hitKey: number; firing?: boolean }) {
  const ref = useRef<Mesh>(null)
  const mat = useRef<MeshPhysicalMaterial>(null)
  const ring = useRef<Mesh>(null) // M1: a tactic-fired halo
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const fireT = useRef(0)
  const flash = useRef(0)
  const lunge = useRef(0)
  const deadT = useRef(0)
  const prevHit = useRef(hitKey)
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (hitKey !== prevHit.current) {
    prevHit.current = hitKey
    flash.current = 1 // a struck gem flashes + recoils
  }
  const base = z > 0 ? 0.34 : 0.22 // allies a touch brighter; foes desaturated
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    const r = reduce.current
    deadT.current = Math.max(0, Math.min(1, deadT.current + (dead ? 1 : -1) * dt * 2.6)) // dissolve ramp
    lunge.current += ((acting && !dead ? 1 : 0) - lunge.current) * Math.min(1, dt * 11) // wind-up → strike → recoil
    flash.current = Math.max(0, flash.current - dt * 3)
    const dz = deadT.current
    if (!r) {
      m.rotation.y += dt * (dz > 0.02 ? 5 : acting ? 2.4 : telegraph ? 1.6 : 0.7) // spin-down on dissolve
      m.rotation.x += dt * 0.25
    }
    // directional STRIKE: the acting shape lunges toward its actual target; the struck shape recoils away
    const tx = toward ? toward[0] : x
    const tz = toward ? toward[1] : z
    const sign = z > 0 ? 1 : -1
    m.position.x = x + (r ? 0 : lunge.current * (tx - x) * 0.4)
    m.position.z = z + (r ? 0 : lunge.current * (tz - z) * 0.5 + flash.current * 0.2 * sign)
    m.position.y = (z > 0 ? -0.1 : 0.35) - dz * 0.25
    if (toward && !r) m.lookAt(tx, m.position.y, tz) // face whoever you're hitting (readability)
    const s = (1 - dz * 0.62) * (1 + (r ? 0 : flash.current * 0.3)) * (telegraph && !dead ? 1.12 : 1)
    m.scale.setScalar(Math.max(0.05, s * 0.5))
    if (mat.current) {
      mat.current.opacity = dead ? 0.12 + (1 - dz) * 0.88 : 1
      // M1: a gambit-fired beat flares the acting shape brighter (the tactic "lights up")
      mat.current.emissiveIntensity = (acting ? 1.0 : telegraph ? 0.62 : base) + flash.current * (adv ? 1.4 : 0.9) + fireT.current * 0.9
    }
    // M1 halo: ramps in when a tactic fires, pulses, fades out
    fireT.current = Math.max(0, Math.min(1, fireT.current + (firing && !dead ? 1 : -1) * dt * 6))
    const rg = ring.current
    if (rg) {
      rg.visible = fireT.current > 0.01
      const pulse = 1 + Math.sin(_.clock.elapsedTime * 9) * 0.08
      rg.position.set(x, (z > 0 ? -0.1 : 0.35) - 0.02, z)
      rg.scale.setScalar(fireT.current * pulse)
      rg.rotation.z += dt * 1.4
      if (ringMat.current) ringMat.current.opacity = fireT.current * 0.85
    }
  })
  const c = ELEMENT_HEX[element]
  const open = OPEN_FAMILIES.has(family)
  const geo = getGeometry(family) // cached, shared, unit-normalized — never disposed (gallery-shared)
  const props = sceneGemMatProps(c, rank, open, false)
  return (
    <>
      <mesh ref={ref} position={[x, 0, z]} geometry={geo} scale={0.5}>
        <meshPhysicalMaterial ref={mat} {...props} side={open ? THREE.DoubleSide : THREE.FrontSide} transparent opacity={1} />
      </mesh>
      <mesh ref={ring} position={[x, 0, z]} rotation-x={-Math.PI / 2} visible={false}>
        <torusGeometry args={[0.46, 0.045, 10, 36]} />
        <meshBasicMaterial ref={ringMat} color="#c9b8ff" transparent opacity={0} toneMapped={false} />
      </mesh>
    </>
  )
}

// Phase 4 — the explorable DUNGEON the fight happens inside (replaces the bare disc-in-void). A stone floor slab,
// a back wall + two side walls, and two rows of pillars receding into the fog — so the combat reads as "deep in a
// dungeon" with real depth/parallax instead of floating. Cheap standard meshes; the Canvas fog (8–18) dissolves the
// far wall/pillars softly. Violet palette matches the combat scene's existing fog (#140e22).
function DungeonRoom() {
  const pillars = useMemo<[number, number][]>(
    () => [-3.7, 3.7].flatMap((x) => [-2.3, -5.3, -8.6].map((z) => [x, z] as [number, number])),
    [],
  )
  return (
    <group>
      {/* floor slab — long, receding down −z into the fog */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.62, -4]}>
        <planeGeometry args={[13, 22]} />
        <meshStandardMaterial color="#241a3a" roughness={0.95} metalness={0.1} />
      </mesh>
      {/* back wall (sits inside the fog band) */}
      <mesh position={[0, 1.3, -12]}>
        <planeGeometry args={[17, 6.4]} />
        <meshStandardMaterial color="#1a1230" roughness={1} />
      </mesh>
      {/* side walls */}
      <mesh rotation-y={Math.PI / 2} position={[-5.6, 1.3, -4]}>
        <planeGeometry args={[22, 6.4]} />
        <meshStandardMaterial color="#160f2a" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-y={-Math.PI / 2} position={[5.6, 1.3, -4]}>
        <planeGeometry args={[22, 6.4]} />
        <meshStandardMaterial color="#160f2a" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* pillars marching into the fog — the parallax that sells the depth as the camera drifts */}
      {pillars.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.28, 0.34, 3.7, 8]} /><meshStandardMaterial color="#2a2142" roughness={0.9} metalness={0.15} /></mesh>
          <mesh position={[0, 2.28, 0]}><boxGeometry args={[0.74, 0.22, 0.74]} /><meshStandardMaterial color="#332954" roughness={0.85} /></mesh>
          <mesh position={[0, -0.52, 0]}><boxGeometry args={[0.78, 0.2, 0.78]} /><meshStandardMaterial color="#1f1838" roughness={0.95} /></mesh>
        </group>
      ))}
    </group>
  )
}

// Phase 4 — the combat CAMERA rig (a null component that drives state.camera each frame). Four moves: an establishing
// ease-in from a wide/high angle on mount; a slow forward DESCENT as beats accrue (the "delving deeper" traversal); a
// tiny per-beat kick on each landed beat; and the CLIMAX — a punch-in toward the winning side when the fight resolves.
// Reduced-motion pins the original static framing. Frame-rate-independent smoothing so it reads identically at any fps.
function CombatCamera({ step, finished, win }: { step: number; finished: boolean; win: boolean }) {
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const t0 = useRef<number | null>(null)
  const kick = useRef(0)
  const lastStep = useRef(step)
  const A = useMemo(() => new THREE.Vector3(), [])
  const B = useMemo(() => new THREE.Vector3(), [])
  const L = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, dt) => {
    const cam = state.camera
    if (reduce.current) { cam.position.set(0, 1.6, 5.2); cam.lookAt(0, 0.2, -0.2); return }
    const now = state.clock.elapsedTime
    if (t0.current === null) t0.current = now
    if (step !== lastStep.current) { kick.current = 1; lastStep.current = step } // a beat landed → a brief jolt
    kick.current = Math.max(0, kick.current - dt * 3.2)
    // base framing eased from a wider establishing shot over the first ~1.2s
    const intro = 1 - Math.pow(1 - Math.min((now - t0.current) / 1.2, 1), 3)
    A.set(0, 3.0, 7.6); B.set(0, 1.55, 5.2)
    B.lerp(A, 1 - intro) // intro 0 → wide establishing; intro 1 → settled framing
    // forward DESCENT as the fight progresses (traversal feel), capped
    B.z -= Math.min(step, 14) * 0.045
    B.y -= Math.min(step, 14) * 0.012
    // gentle idle sway + the decaying per-beat kick
    B.x += Math.sin(now * 0.22) * 0.16 + Math.sin(now * 40) * kick.current * 0.06
    B.y += Math.cos(now * 0.3) * 0.06 + kick.current * 0.04
    L.set(0, 0.15, -0.4)
    if (finished) { // CLIMAX — punch in and hold on the surviving side
      A.set(win ? -0.5 : 0.5, 1.05, 3.4)
      B.lerp(A, 0.7)
      L.set(0, 0.0, win ? 0.7 : -1.1) // allies sit at +z (near), foes at −z (deep)
    }
    cam.position.lerp(B, 1 - Math.pow(0.0009, dt)) // smooth, fps-independent follow
    cam.lookAt(L)
  })
  return null
}

function CombatStage3D({ units, dead, cur, nextActor, step, firingActor, finished, win, paused = false }: { units: UnitInfo[]; dead: boolean[]; cur: { actor: number; target: number; adv: boolean } | null; nextActor: number; step: number; firingActor: number; finished: boolean; win: boolean; paused?: boolean }) {
  const allies = units.map((u, i) => ({ u, i })).filter((x) => !x.u.is_enemy)
  const foes = units.map((u, i) => ({ u, i })).filter((x) => x.u.is_enemy)
  const spread = (n: number, k: number) => (n <= 1 ? 0 : (k - (n - 1) / 2) * 1.5)
  // position of every combatant (unit index → [x, z]) — lets an acting shape lunge toward its actual target
  const posOf: Record<number, [number, number]> = {}
  allies.forEach(({ i }, k) => (posOf[i] = [spread(allies.length, k), 1.3]))
  foes.forEach(({ i }, k) => (posOf[i] = [spread(foes.length, k), -1.3]))
  const towardOf = (i: number): [number, number] | null => (cur?.actor === i && cur.target >= 0 ? posOf[cur.target] ?? null : null)
  return (
    <Canvas frameloop={paused ? 'never' : 'always'} camera={{ position: [0, 1.6, 5.2], fov: 42 }} dpr={[1, 1.5]} style={{ width: '100%', height: 220 }}>
      <fog attach="fog" args={['#140e22', 8, 18]} />
      <hemisphereLight args={['#b9a7ff', '#160f2a', 0.5]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 5, 4]} intensity={60} color="#fff0d8" />
      <pointLight position={[-4, 2, 2]} intensity={30} color="#9b8cff" />
      <CombatCamera step={step} finished={finished} win={win} />
      {/* the dungeon room the fight stands in — replaces the bare disc; recedes into the fog for a delving read */}
      <DungeonRoom />
      {foes.map(({ u, i }, k) => (
        <CombatGem key={`f${i}`} family={u.family} element={u.element} rank={0} x={spread(foes.length, k)} z={-1.3} toward={towardOf(i)} adv={!!cur?.adv && cur.target === i} dead={dead[i]} acting={cur?.actor === i} telegraph={nextActor === i} hitKey={cur?.target === i ? step : 0} />
      ))}
      {allies.map(({ u, i }, k) => (
        <CombatGem key={`a${i}`} family={u.family} element={u.element} rank={2} x={spread(allies.length, k)} z={1.3} toward={towardOf(i)} adv={!!cur?.adv && cur.target === i} dead={dead[i]} acting={cur?.actor === i} telegraph={nextActor === i} hitKey={cur?.target === i ? step : 0} firing={firingActor === i} />
      ))}
      <ScenePostFX bloomIntensity={0.6} vignette />
    </Canvas>
  )
}

// ── The DEFAULT 3D Expedition view: the party's REAL collected shapes in a chapter-themed scene (resting in a hub
// when idle, delving a dungeon when a run is active). Reuses the CombatGem real-shape path + the disc-floor rig;
// ONE perf-gated Canvas (frameloop pauses off-tab / behind any modal). The old fallback-geometry ShowcaseGem is gone. ──
const CHAPTER_THEME: Record<number, { floor: string; fog: string; key: string }> = {
  1: { floor: '#1a2e2c', fog: '#102320', key: '#5fe0c6' }, // Shallows / teal
  2: { floor: '#241a3a', fog: '#140e22', key: '#9b8cff' }, // Folds / violet
  3: { floor: '#15131c', fog: '#0a0910', key: '#6a6480' }, // Deep / near-black
  4: { floor: '#2a2740', fog: '#1c1a2e', key: '#bfe6ff' }, // Vantage / glass-pale
}
function SceneGem({ family, element, pos, yaw, delving }: { family: string; element: ExpElement; pos: [number, number]; yaw: number; delving: boolean }) {
  const ref = useRef<Mesh>(null)
  const mat = useRef<MeshPhysicalMaterial>(null)
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const c = ELEMENT_HEX[element]
  const open = OPEN_FAMILIES.has(family)
  const geo = getGeometry(family) // the REAL collected shape (cached, shared, never disposed)
  const props = sceneGemMatProps(c, 2, open, false) // cheap clearcoat PBR — no transmission for the crowd
  const emBase = sceneGemEmissiveBase(2, false)
  useFrame((state, dt) => {
    const m = ref.current
    if (!m) return
    if (reduce.current) {
      m.position.set(pos[0], 0, pos[1])
      return // reduced-motion: a static framed shot
    }
    const t = state.clock.elapsedTime + pos[0] // x phase-offsets the bob/breathe per gem
    m.rotation.y += dt * (delving ? 0.9 : 0.45) // matches the PT gems spinning in place
    m.rotation.x += dt * 0.06
    m.position.y = Math.sin(t * 0.8) * 0.05
    if (mat.current) mat.current.emissiveIntensity = emBase + Math.sin(t * 0.9) * 0.1
  })
  return (
    <mesh ref={ref} position={[pos[0], 0, pos[1]]} rotation-y={yaw} geometry={geo} scale={0.62}>
      <meshPhysicalMaterial ref={mat} {...props} side={open ? THREE.DoubleSide : THREE.FrontSide} transparent opacity={1} />
    </mesh>
  )
}
// the chapter's signature biome (reuses the diorama palettes so each chapter's delve reads distinctly).
type BiomeKind = 'reef' | 'crystal' | 'forge' | 'shore' | 'forest' | 'meadow' | 'market' | 'teagarden' | 'cloister'
  | 'mushroom' | 'zen' | 'winter' | 'gallery' | 'dungeon' | 'blueprint' | 'orrery' | 'cornell'
const biomeForChapter = (chapter: number): BiomeKind =>
  chapter === 1 ? 'reef' : chapter === 2 ? 'crystal' : chapter === 3 ? 'forge' : chapter === 4 ? 'shore' : 'forest'
// the ground scatter ringing the party (the same horseshoe the PT bakes — shared partyTreeLayout). IDLE = the cozy
// home FOREST (matches the PT portrait); during a DELVE it becomes the current CHAPTER's biome, so each delve looks
// distinct. Same positions, different scatter mesh — cheap (~16 clusters).
function Biome({ kind }: { kind: BiomeKind }) {
  const items = useMemo(() => {
    let s = 0x51ed270b >>> 0 // a separate stream just for the per-item colour/jitter pick (layout is shared with the PT)
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
    return partyTreeLayout().map((t) => ({ ...t, j: rnd() }))
  }, [])
  return (
    <group>
      {items.map((t, i) => (
        <group key={i} position={[t.x, -0.62, t.z]}>
          {kind === 'forest' && (<>
            <mesh position={[0, 0.13, 0]}><cylinderGeometry args={[0.05, 0.07, 0.26, 5]} /><meshStandardMaterial color="#1c130c" roughness={1} /></mesh>
            <mesh position={[0, 0.26 + t.h / 2, 0]}><coneGeometry args={[t.r, t.h, 7]} /><meshStandardMaterial color={t.j > 0.5 ? '#16291e' : '#13241b'} roughness={1} /></mesh>
            <mesh position={[0, 0.26 + t.h * 0.82, 0]}><coneGeometry args={[t.r * 0.68, t.h * 0.62, 7]} /><meshStandardMaterial color="#1b3325" roughness={1} /></mesh>
          </>)}
          {kind === 'reef' && (<>
            <mesh position={[0, 0.2 + t.h * 0.2, 0]} rotation-z={0.18}><coneGeometry args={[0.06, t.h * 0.85, 6]} /><meshStandardMaterial color={t.j > 0.5 ? '#d98aa0' : '#3fb8a8'} roughness={0.9} /></mesh>
            <mesh position={[t.r * 0.45, 0.16, 0]} rotation-z={-0.55}><coneGeometry args={[0.05, t.h * 0.6, 6]} /><meshStandardMaterial color="#3fb8a8" roughness={0.9} /></mesh>
            <mesh position={[-t.r * 0.4, 0.14, t.r * 0.2]} rotation-z={0.55}><coneGeometry args={[0.045, t.h * 0.5, 6]} /><meshStandardMaterial color="#d98aa0" roughness={0.9} /></mesh>
          </>)}
          {kind === 'crystal' && (
            <mesh position={[0, 0.2 + t.h * 0.45, 0]} rotation-z={t.j * 0.4 - 0.2}><coneGeometry args={[t.r * 0.5, t.h * 1.2, 5]} /><meshStandardMaterial color={t.j > 0.5 ? '#9a7aff' : '#6ad0ff'} emissive={t.j > 0.5 ? '#6a3fb0' : '#2a8f9a'} emissiveIntensity={0.7} roughness={0.3} metalness={0.1} /></mesh>
          )}
          {kind === 'forge' && (<>
            <mesh position={[0, 0.12, 0]} rotation={[t.j, t.j * 2, 0]}><icosahedronGeometry args={[t.r * 0.7, 0]} /><meshStandardMaterial color="#2a2420" roughness={1} flatShading /></mesh>
            {t.j > 0.6 && <mesh position={[0, 0.18, 0]}><sphereGeometry args={[0.05, 6, 6]} /><meshStandardMaterial color="#ff7a1a" emissive="#ff6a10" emissiveIntensity={2.2} toneMapped={false} /></mesh>}
          </>)}
          {kind === 'shore' && (<>
            <mesh position={[0, 0.1, 0]} rotation={[t.j, t.j * 3, 0]}><icosahedronGeometry args={[t.r * 0.6, 0]} /><meshStandardMaterial color="#8e8a80" roughness={0.95} flatShading /></mesh>
            {t.j > 0.5 && <mesh position={[t.r * 0.3, 0.18, 0]} rotation-z={0.22}><coneGeometry args={[0.05, t.h * 0.6, 4]} /><meshStandardMaterial color="#56604e" roughness={1} /></mesh>}
          </>)}
          {kind === 'meadow' && (t.j > 0.42 ? (<>
            {/* a wildflower: thin green stem + a warm/pale head */}
            <mesh position={[0, t.h * 0.3, 0]}><coneGeometry args={[0.03, t.h * 0.62, 5]} /><meshStandardMaterial color="#4f7d34" roughness={1} /></mesh>
            <mesh position={[0, t.h * 0.62, 0]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color={t.j > 0.7 ? '#ffe07a' : '#fbf2f5'} roughness={0.9} emissive={t.j > 0.7 ? '#ffd24a' : '#ffe0ec'} emissiveIntensity={0.25} toneMapped={false} /></mesh>
          </>) : (
            // a bright grass tuft
            <mesh position={[0, t.h * 0.28, 0]} rotation={[0.1, t.j * 6, 0]}><coneGeometry args={[0.07, t.h * 0.7, 4]} /><meshStandardMaterial color={t.j > 0.2 ? '#6fa83a' : '#5a8f30'} roughness={1} /></mesh>
          ))}
          {/* the next three are OPEN INTERIORS — a ring of low props / a colonnade (NOT walls), so a rotating camera
              orbits freely between them and is never boxed in. The shop/tearoom/chapel diorama aesthetics, wall-free. */}
          {kind === 'market' && (<>
            {/* a market crate of wares (warm wood) — your shop, open-air */}
            <mesh position={[0, 0.2, 0]} rotation-y={t.j * 2}><boxGeometry args={[0.42, 0.4, 0.36]} /><meshStandardMaterial color={t.j > 0.5 ? '#6a4a2c' : '#7a5230'} roughness={0.9} /></mesh>
            {t.j > 0.55 && <mesh position={[0, 0.46, 0]} rotation-y={t.j}><boxGeometry args={[0.5, 0.12, 0.42]} /><meshStandardMaterial color="#5a3b22" roughness={0.9} /></mesh>}
            {t.j < 0.3 && <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#c08a5a" roughness={0.85} /></mesh>}
          </>)}
          {kind === 'teagarden' && (<>
            {/* a small stone lantern (tōrō) with a warm glow — an open garden path */}
            <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.1, 0.13, 0.12, 8]} /><meshStandardMaterial color="#7a7975" roughness={1} /></mesh>
            <mesh position={[0, 0.28, 0]}><cylinderGeometry args={[0.045, 0.045, 0.22, 6]} /><meshStandardMaterial color="#7a7975" roughness={1} /></mesh>
            <mesh position={[0, 0.42, 0]}><boxGeometry args={[0.16, 0.14, 0.16]} /><meshStandardMaterial color="#ffbe5c" emissive="#ff8a2a" emissiveIntensity={1.4} toneMapped={false} /></mesh>
            <mesh position={[0, 0.52, 0]}><coneGeometry args={[0.15, 0.12, 4]} /><meshStandardMaterial color="#6f6e6a" roughness={1} /></mesh>
          </>)}
          {kind === 'cloister' && (
            // a gothic stone column — an open colonnade ringing the party (tall, but gaps to see between)
            <group>
              <mesh position={[0, 0.16, 0]}><cylinderGeometry args={[0.22, 0.26, 0.16, 12]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
              <mesh position={[0, 0.95 + t.h * 0.5, 0]}><cylinderGeometry args={[0.15, 0.18, 1.5 + t.h, 12]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
              <mesh position={[0, 1.74 + t.h, 0]}><boxGeometry args={[0.4, 0.18, 0.4]} /><meshStandardMaterial color="#a89e8c" roughness={0.85} /></mesh>
            </group>
          )}
          {/* the rest adapt the remaining dioramas as OPEN ring-of-props biomes (low clusters / thin posts, no walls). */}
          {kind === 'mushroom' && (<>
            {/* Glimmercap Grove: a fairy-ring of bioluminescent mushrooms over mossy ground */}
            <mesh position={[0, 0.04, 0]} scale={[1, 0.4, 1]}><sphereGeometry args={[t.r * 0.95 + 0.08, 8, 8]} /><meshStandardMaterial color="#1e3326" roughness={1} /></mesh>
            <mesh position={[0, 0.06 + t.h * 0.18, 0]}><cylinderGeometry args={[0.045, 0.06, 0.12 + t.h * 0.36, 6]} /><meshStandardMaterial color="#d8e7df" roughness={0.85} /></mesh>
            <mesh position={[0, 0.12 + t.h * 0.36, 0]} scale={[1, 0.62, 1]}><sphereGeometry args={[0.1 + t.r * 0.5, 10, 8]} /><meshStandardMaterial color={t.j > 0.5 ? '#5ef0d2' : '#7a52d8'} emissive={t.j > 0.5 ? '#5ef0d2' : '#7a52d8'} emissiveIntensity={1.3} roughness={0.5} toneMapped={false} /></mesh>
            <mesh position={[0, 0.115 + t.h * 0.34, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[0.09 + t.r * 0.42, 12]} /><meshBasicMaterial color={t.j > 0.5 ? '#5ef0d2' : '#7a52d8'} transparent opacity={0.4} toneMapped={false} /></mesh>
            <mesh position={[t.r * 0.7 + 0.08, 0.04 + t.h * 0.1, t.r * 0.3]}><cylinderGeometry args={[0.032, 0.04, 0.1 + t.h * 0.2, 6]} /><meshStandardMaterial color="#c4d6cc" roughness={0.85} /></mesh>
            <mesh position={[t.r * 0.7 + 0.08, 0.1 + t.h * 0.2, t.r * 0.3]} scale={[1, 0.58, 1]}><sphereGeometry args={[0.06 + t.r * 0.28, 8, 7]} /><meshStandardMaterial color={t.j > 0.5 ? '#7a52d8' : '#5ef0d2'} emissive={t.j > 0.5 ? '#7a52d8' : '#5ef0d2'} emissiveIntensity={1.1} roughness={0.5} toneMapped={false} /></mesh>
          </>)}
          {kind === 'zen' && (<>
            {/* Rock Garden (karesansui): a raked-sand ripple + a quiet stone or two */}
            <mesh position={[0, 0.025, 0]} rotation-y={t.j * 3.14} scale={[1 + t.r, 1, 0.5 + t.r * 0.6]}><cylinderGeometry args={[0.34, 0.36, 0.05, 18]} /><meshStandardMaterial color="#d8cba0" roughness={1} /></mesh>
            <mesh position={[t.j * 0.08 - 0.04, 0.06 + t.h * 0.07, 0]} rotation={[t.j * 0.3, t.j * 5, t.j * 0.2 - 0.1]} scale={[1, 0.62 + t.h * 0.18, 0.9]}><icosahedronGeometry args={[0.1 + t.r * 0.5, 0]} /><meshStandardMaterial color={t.j > 0.5 ? '#9a8f72' : '#8a8068'} roughness={0.95} flatShading /></mesh>
            {t.j > 0.55 && <mesh position={[t.r * 0.9 + 0.08, 0.05, t.r * 0.4 - 0.05]} rotation={[t.j, t.j * 3, 0]} scale={[1, 0.6, 1]}><icosahedronGeometry args={[0.06 + t.r * 0.18, 0]} /><meshStandardMaterial color="#9a8f72" roughness={0.95} flatShading /></mesh>}
          </>)}
          {kind === 'winter' && (<>
            {/* Snow Globe (the snowy world, no dome): a snow mound + a frosted shrub or snowman */}
            <mesh position={[0, t.h * 0.14, 0]} scale={[1, 0.55, 1]} rotation-y={t.j * 3}><sphereGeometry args={[t.r + 0.16, 10, 8]} /><meshStandardMaterial color="#ffffff" roughness={0.95} emissive="#bcd6ff" emissiveIntensity={0.12} /></mesh>
            {t.j > 0.62 ? (<>
              <mesh position={[t.r * 0.2, t.h * 0.14 + 0.13, 0]} rotation-z={0.22}><coneGeometry args={[0.035, 0.32 + t.h * 0.28, 5]} /><meshStandardMaterial color="#8aa0d0" roughness={1} /></mesh>
              <mesh position={[-t.r * 0.25, t.h * 0.14 + 0.1, t.r * 0.15]} rotation-z={-0.4}><coneGeometry args={[0.03, 0.24 + t.h * 0.2, 5]} /><meshStandardMaterial color="#8aa0d0" roughness={1} /></mesh>
            </>) : t.j > 0.34 ? (<>
              <mesh position={[0, t.h * 0.14 + 0.14, 0]}><sphereGeometry args={[0.13, 9, 8]} /><meshStandardMaterial color="#ffffff" roughness={0.9} emissive="#bcd6ff" emissiveIntensity={0.14} /></mesh>
              <mesh position={[0, t.h * 0.14 + 0.31, 0]}><sphereGeometry args={[0.09, 9, 8]} /><meshStandardMaterial color="#ffffff" roughness={0.9} emissive="#bcd6ff" emissiveIntensity={0.14} /></mesh>
            </>) : null}
          </>)}
          {kind === 'gallery' && (<group>
            {/* Museum Plinth → a ring of gallery exhibits: a marble plinth + a spotlit display shape */}
            <mesh position={[0, 0.05, 0]}><boxGeometry args={[0.46, 0.1, 0.46]} /><meshStandardMaterial color={t.j > 0.5 ? '#fff8ec' : '#efe7d6'} roughness={0.7} /></mesh>
            <mesh position={[0, 0.3, 0]} rotation-y={t.j * 0.4 - 0.2}><boxGeometry args={[0.34, 0.42, 0.34]} /><meshStandardMaterial color={t.j > 0.5 ? '#f2ead9' : '#cfc8ba'} roughness={0.75} /></mesh>
            <mesh position={[0, 0.535, 0]}><boxGeometry args={[0.4, 0.05, 0.4]} /><meshStandardMaterial color="#fff8ec" roughness={0.6} /></mesh>
            <mesh position={[0, 0.4, 0.18]}><boxGeometry args={[0.14, 0.07, 0.012]} /><meshStandardMaterial color="#c9a24a" roughness={0.4} metalness={0.7} /></mesh>
            {t.j > 0.66 ? (
              <mesh position={[0, 0.66 + t.r * 0.5, 0]} rotation={[t.j, t.j * 3, 0]}><icosahedronGeometry args={[0.1 + t.r * 0.5, 0]} /><meshStandardMaterial color="#ffffff" emissive="#cfe0ff" emissiveIntensity={1.0} roughness={0.4} metalness={0.1} flatShading toneMapped={false} /></mesh>
            ) : t.j > 0.33 ? (
              <mesh position={[0, 0.66 + t.r * 0.45, 0]}><sphereGeometry args={[0.1 + t.r * 0.45, 14, 12]} /><meshStandardMaterial color="#fbf7ee" emissive="#e6ecff" emissiveIntensity={0.95} roughness={0.5} toneMapped={false} /></mesh>
            ) : (
              <mesh position={[0, 0.62 + t.r * 0.6, 0]}><coneGeometry args={[0.09 + t.r * 0.35, 0.22 + t.r, 6]} /><meshStandardMaterial color="#f0ead8" emissive="#dce6ff" emissiveIntensity={0.9} roughness={0.45} flatShading toneMapped={false} /></mesh>
            )}
          </group>)}
          {kind === 'dungeon' && (<>
            {/* Dungeon (no bars/walls): broken stone rubble + a thin iron-bar shard or a glowing ember */}
            <mesh position={[0, t.r * 0.55, 0]} rotation={[t.j * 2, t.j * 4, t.j]}><icosahedronGeometry args={[t.r * 0.95, 0]} /><meshStandardMaterial color={t.j > 0.5 ? '#3a3a42' : '#6b6b73'} roughness={1} flatShading /></mesh>
            <mesh position={[t.r * 1.1, t.r * 0.3, -t.r * 0.5]} rotation={[t.j * 3, t.j, t.j * 2]}><boxGeometry args={[t.r * 0.8, t.r * 0.55, t.r * 0.7]} /><meshStandardMaterial color={t.j > 0.5 ? '#6b6b73' : '#3a3a42'} roughness={1} flatShading /></mesh>
            {t.j > 0.62 ? (
              <mesh position={[-t.r * 0.7, 0.45 + t.h * 0.55, t.r * 0.3]} rotation-z={t.j * 0.3 - 0.15}><cylinderGeometry args={[0.035, 0.045, 0.9 + t.h * 0.7, 6]} /><meshStandardMaterial color="#2c2c33" roughness={0.7} metalness={0.6} /></mesh>
            ) : t.j < 0.16 ? (
              <mesh position={[-t.r * 0.4, t.r * 0.5, t.r * 0.5]}><sphereGeometry args={[0.04, 6, 6]} /><meshStandardMaterial color="#ff8a2a" emissive="#ff6a14" emissiveIntensity={1.8} toneMapped={false} /></mesh>
            ) : null}
          </>)}
          {kind === 'blueprint' && (<group rotation-y={t.j * 6.28}>
            {/* Blueprint: a glowing axis-tripod or a wireframe edge-frame cube on a graph-paper void */}
            {t.j > 0.5 ? (<>
              <mesh position={[0, t.h * 0.5 + 0.02, 0]}><boxGeometry args={[0.03, t.h + 0.04, 0.03]} /><meshStandardMaterial color="#5fe06a" emissive="#5fe06a" emissiveIntensity={1.4} toneMapped={false} /></mesh>
              <mesh position={[(0.18 + t.r) / 2, 0.04, 0]} rotation-z={1.5708}><boxGeometry args={[0.028, 0.18 + t.r, 0.028]} /><meshStandardMaterial color="#2f6df0" emissive="#2f6df0" emissiveIntensity={1.4} toneMapped={false} /></mesh>
              <mesh position={[0, 0.04, (0.18 + t.r) / 2]} rotation-x={1.5708}><boxGeometry args={[0.028, 0.18 + t.r, 0.028]} /><meshStandardMaterial color="#7fb0ff" emissive="#7fb0ff" emissiveIntensity={1.4} toneMapped={false} /></mesh>
              <mesh position={[0, t.h + 0.04, 0]}><icosahedronGeometry args={[0.05, 0]} /><meshStandardMaterial color="#5fe06a" emissive="#5fe06a" emissiveIntensity={1.6} toneMapped={false} /></mesh>
              <mesh position={[0, 0.04, 0]}><sphereGeometry args={[0.045, 7, 7]} /><meshStandardMaterial color="#7fb0ff" emissive="#7fb0ff" emissiveIntensity={1.3} toneMapped={false} /></mesh>
            </>) : (
              <group position={[0, 0.18 + t.h * 0.3, 0]}>
                {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map((p, k) => (
                  <mesh key={k} position={[p[0] * (0.26 + t.r * 0.7) / 2, 0, p[1] * (0.26 + t.r * 0.7) / 2]}><boxGeometry args={[0.026, 0.26 + t.r * 0.7, 0.026]} /><meshStandardMaterial color={t.j > 0.25 ? '#2f6df0' : '#7fb0ff'} emissive={t.j > 0.25 ? '#2f6df0' : '#7fb0ff'} emissiveIntensity={1.4} toneMapped={false} /></mesh>
                ))}
                <mesh position={[0, (0.26 + t.r * 0.7) / 2, (0.26 + t.r * 0.7) / 2]} rotation-z={1.5708}><boxGeometry args={[0.024, 0.26 + t.r * 0.7, 0.024]} /><meshStandardMaterial color="#5fe06a" emissive="#5fe06a" emissiveIntensity={1.4} toneMapped={false} /></mesh>
                <mesh position={[(0.26 + t.r * 0.7) / 2, (0.26 + t.r * 0.7) / 2, 0]} rotation-x={1.5708}><boxGeometry args={[0.024, 0.26 + t.r * 0.7, 0.024]} /><meshStandardMaterial color="#5fe06a" emissive="#5fe06a" emissiveIntensity={1.4} toneMapped={false} /></mesh>
              </group>
            )}
          </group>)}
          {kind === 'orrery' && (<>
            {/* Orrery: a thin brass post holding a floating glowing planet, sometimes ringed by a brass arc */}
            <mesh position={[0, (0.5 + t.h * 0.7) / 2, 0]}><cylinderGeometry args={[0.018, 0.026, 0.5 + t.h * 0.7, 6]} /><meshStandardMaterial color="#b9863a" roughness={0.5} metalness={0.7} /></mesh>
            <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.07, 0.09, 0.05, 8]} /><meshStandardMaterial color="#8a6328" roughness={0.6} metalness={0.6} /></mesh>
            <mesh position={[0, 0.5 + t.h * 0.7, 0]}><sphereGeometry args={[0.1 + t.r * 0.4, 12, 10]} /><meshStandardMaterial color={t.j > 0.62 ? '#ffd27a' : t.j > 0.32 ? '#e8b75a' : '#7a9ad0'} emissive={t.j > 0.62 ? '#ffb84a' : t.j > 0.32 ? '#d99528' : '#3a5ea0'} emissiveIntensity={t.j > 0.32 ? 1.5 : 1.1} toneMapped={false} roughness={0.4} /></mesh>
            {t.j > 0.45 && <mesh position={[0, 0.5 + t.h * 0.7, 0]} rotation={[1.0 + t.j * 0.6, t.j * 1.4, 0.3]}><torusGeometry args={[0.16 + t.r * 0.4, 0.012, 6, 24]} /><meshStandardMaterial color="#e8b75a" emissive="#a8761e" emissiveIntensity={0.5} roughness={0.45} metalness={0.7} toneMapped={false} /></mesh>}
          </>)}
          {kind === 'cornell' && (<group rotation-y={t.j * 0.9 - 0.45}>
            {/* Cornell Box (no walls): a tidy ring of red/green/white colour-bounce blocks + a flat white floor tile */}
            <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.32 + t.r * 0.3, 0.32, 0.32 + t.r * 0.3]} /><meshStandardMaterial color={t.j > 0.62 ? '#c43838' : t.j > 0.24 ? '#2fa83f' : '#e8e8e8'} emissive={t.j > 0.62 ? '#7a1f1f' : t.j > 0.24 ? '#1c6b27' : '#3a3a3a'} emissiveIntensity={0.35} roughness={0.92} /></mesh>
            {t.j > 0.55 && <mesh position={[0, 0.46, 0]}><boxGeometry args={[0.24, 0.26, 0.24]} /><meshStandardMaterial color={t.j > 0.62 ? '#c43838' : '#2fa83f'} emissive={t.j > 0.62 ? '#7a1f1f' : '#1c6b27'} emissiveIntensity={0.35} roughness={0.92} /></mesh>}
            <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[0.5, 0.5]} /><meshStandardMaterial color="#e8e8e8" roughness={0.95} /></mesh>
          </group>)}
        </group>
      ))}
    </group>
  )
}
// a cozy campfire for the resting scene: logs + a flickering flame + a warm pulsing light + rising embers
function Campfire() {
  const light = useRef<THREE.PointLight>(null)
  const flame = useRef<Mesh>(null)
  const embers = useRef<THREE.Group>(null)
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const flick = reduce.current ? 1 : 0.78 + Math.sin(t * 12) * 0.16 + Math.sin(t * 27) * 0.08
    if (light.current) light.current.intensity = 26 * flick
    if (flame.current && !reduce.current) {
      flame.current.scale.y = 1 + Math.sin(t * 10) * 0.16
      flame.current.scale.x = flame.current.scale.z = 0.92 + Math.sin(t * 14 + 1) * 0.06
    }
    if (embers.current && !reduce.current) {
      embers.current.children.forEach((e, i) => {
        const phase = (t * 0.5 + i * 0.37) % 1
        e.position.set(Math.sin(t * 1.5 + i) * 0.12, phase * 1.2, 0)
        const mm = (e as Mesh).material as THREE.MeshBasicMaterial
        mm.opacity = (1 - phase) * 0.8
      })
    }
  })
  return (
    <group position={[0, -0.5, 1.7]}>
      <pointLight ref={light} position={[0, 0.5, 0]} intensity={26} color="#ff9a3c" distance={7} />
      <mesh rotation-z={0.5} position={[0.04, -0.04, 0]}><cylinderGeometry args={[0.045, 0.045, 0.46, 6]} /><meshStandardMaterial color="#3a2416" roughness={1} /></mesh>
      <mesh rotation-z={-0.5} position={[-0.04, -0.04, 0.02]}><cylinderGeometry args={[0.045, 0.045, 0.46, 6]} /><meshStandardMaterial color="#2c1a10" roughness={1} /></mesh>
      <mesh ref={flame} position={[0, 0.2, 0]}><coneGeometry args={[0.15, 0.44, 8]} /><meshBasicMaterial color="#ffb24a" transparent opacity={0.92} toneMapped={false} /></mesh>
      <mesh position={[0, 0.13, 0]}><coneGeometry args={[0.08, 0.28, 8]} /><meshBasicMaterial color="#fff0c0" transparent opacity={0.95} toneMapped={false} /></mesh>
      <group ref={embers}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.012, 5, 5]} />
            <meshBasicMaterial color="#ffcf6b" transparent opacity={0.7} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
// a small stone lantern (ishidoro) under a vermilion torii — the SHRINE room's focal (its quiet blessing waypoint).
// Warm lantern light, same warm-key role the campfire plays; reuses the Dusk Shrine diorama's iconography at hub scale.
function ShrineFocal() {
  const light = useRef<THREE.PointLight>(null)
  const flame = useRef<Mesh>(null)
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const flick = reduce.current ? 1 : 0.84 + Math.sin(t * 8) * 0.1 + Math.sin(t * 19) * 0.06
    if (light.current) light.current.intensity = 19 * flick
    if (flame.current && !reduce.current) flame.current.scale.setScalar(0.88 + Math.sin(t * 11) * 0.12)
  })
  const stone = '#857f76'
  const torii = '#c2403a'
  return (
    <group position={[0, -0.62, 1.7]}>
      {[-0.62, 0.62].map((x) => <mesh key={x} position={[x, 0.5, -0.55]}><cylinderGeometry args={[0.05, 0.06, 1.0, 8]} /><meshStandardMaterial color={torii} roughness={0.85} /></mesh>)}
      <mesh position={[0, 1.02, -0.55]}><boxGeometry args={[1.55, 0.11, 0.12]} /><meshStandardMaterial color={torii} roughness={0.85} /></mesh>
      <mesh position={[0, 0.82, -0.55]}><boxGeometry args={[1.3, 0.08, 0.1]} /><meshStandardMaterial color={torii} roughness={0.85} /></mesh>
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.13, 0.17, 0.1, 12]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.045, 0.05, 0.26, 8]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <mesh position={[0, 0.38, 0]}><cylinderGeometry args={[0.18, 0.13, 0.07, 12]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <mesh ref={flame} position={[0, 0.47, 0]}><sphereGeometry args={[0.075, 10, 10]} /><meshBasicMaterial color="#ffbe5c" transparent opacity={0.95} toneMapped={false} /></mesh>
      <mesh position={[0, 0.56, 0]} rotation-x={Math.PI}><coneGeometry args={[0.17, 0.13, 6]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <mesh position={[0, 0.64, 0]}><sphereGeometry args={[0.04, 8, 8]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <pointLight ref={light} position={[0, 0.47, 0]} intensity={19} color="#ffb35a" distance={6.5} decay={1.4} />
    </group>
  )
}
// an open treasure chest spilling glowing gold — the TREASURE room's focal. Warm gold light + a few rising motes.
function TreasureFocal() {
  const light = useRef<THREE.PointLight>(null)
  const motes = useRef<THREE.Group>(null)
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (light.current) light.current.intensity = reduce.current ? 16 : 16 + Math.sin(t * 5) * 1.5
    if (motes.current && !reduce.current) motes.current.children.forEach((e, i) => {
      const phase = (t * 0.4 + i * 0.3) % 1
      e.position.set(Math.sin(t + i) * 0.1, phase * 0.7, Math.cos(t * 0.7 + i) * 0.08)
      ;((e as Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.85
    })
  })
  const wood = '#5a3b22'
  const brass = '#c9a24a'
  return (
    <group position={[0, -0.62, 1.7]}>
      <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.66, 0.32, 0.44]} /><meshStandardMaterial color={wood} roughness={0.8} /></mesh>
      <mesh position={[0, 0.4, -0.22]} rotation-x={-1.15}><boxGeometry args={[0.66, 0.24, 0.06]} /><meshStandardMaterial color="#4a3018" roughness={0.8} /></mesh>
      <mesh position={[0, 0.16, 0.225]}><boxGeometry args={[0.68, 0.06, 0.02]} /><meshStandardMaterial color={brass} roughness={0.4} metalness={0.8} /></mesh>
      {[-0.26, 0.26].map((x) => <mesh key={x} position={[x, 0.16, 0]}><boxGeometry args={[0.04, 0.34, 0.46]} /><meshStandardMaterial color={brass} roughness={0.4} metalness={0.8} /></mesh>)}
      <mesh position={[0, 0.34, 0.02]}><sphereGeometry args={[0.22, 14, 8]} /><meshStandardMaterial color="#ffd24a" emissive="#ffae1a" emissiveIntensity={2.2} toneMapped={false} /></mesh>
      <pointLight ref={light} position={[0, 0.42, 0.05]} intensity={16} color="#ffce5a" distance={5.5} decay={1.4} />
      <group ref={motes} position={[0, 0.36, 0.05]}>
        {Array.from({ length: 8 }).map((_, i) => (
          <mesh key={i}><sphereGeometry args={[0.014, 5, 5]} /><meshBasicMaterial color="#ffe08a" transparent opacity={0.8} toneMapped={false} /></mesh>
        ))}
      </group>
    </group>
  )
}
// a stepped stone altar between two pillars with a warm offering + a faint shaft of god-light — the Altar diorama as a focal.
function AltarFocal() {
  const light = useRef<THREE.PointLight>(null)
  const glow = useRef<Mesh>(null)
  const reduce = useRef(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (light.current) light.current.intensity = reduce.current ? 17 : 17 + Math.sin(t * 3) * 1.6
    if (glow.current && !reduce.current) glow.current.scale.setScalar(0.9 + Math.sin(t * 4) * 0.1)
  })
  const stone = '#cdbb92'
  const dark = '#9a8a66'
  return (
    <group position={[0, -0.62, 1.7]}>
      {[-0.6, 0.6].map((x) => <mesh key={x} position={[x, 0.55, -0.5]}><cylinderGeometry args={[0.1, 0.12, 1.1, 12]} /><meshStandardMaterial color={stone} roughness={0.9} /></mesh>)}
      {[-0.6, 0.6].map((x) => <mesh key={`cap${x}`} position={[x, 1.14, -0.5]}><boxGeometry args={[0.3, 0.12, 0.3]} /><meshStandardMaterial color={dark} roughness={0.9} /></mesh>)}
      <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.9, 0.16, 0.66]} /><meshStandardMaterial color={dark} roughness={1} /></mesh>
      <mesh position={[0, 0.24, 0]}><boxGeometry args={[0.7, 0.16, 0.5]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <mesh ref={glow} position={[0, 0.42, 0]}><sphereGeometry args={[0.13, 14, 12]} /><meshStandardMaterial color="#ffe6b0" emissive="#ffb860" emissiveIntensity={2.2} toneMapped={false} /></mesh>
      <mesh position={[0, 1.32, 0]}><coneGeometry args={[0.42, 1.9, 16, 1, true]} /><meshBasicMaterial color="#fff0d0" transparent opacity={0.08} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} /></mesh>
      <pointLight ref={light} position={[0, 0.5, 0.05]} intensity={17} color="#ffce8a" distance={6} decay={1.4} />
    </group>
  )
}
// the hub's central feature, chosen by the current room kind: idle / campfire room → cozy fire; a TREASURE or SHRINE
// room (during a delve) shows its own warm focal. All play the same warm-key-light role so the party stays lit.
function HubFocal({ kind }: { kind: 'campfire' | 'shrine' | 'treasure' | 'altar' }) {
  if (kind === 'shrine') return <ShrineFocal />
  if (kind === 'treasure') return <TreasureFocal />
  if (kind === 'altar') return <AltarFocal />
  return <Campfire />
}
// the hub focal for a room kind (RoomKind: 2 campfire, 3 treasure, 4 shrine; everything else / idle → cozy campfire).
const focalForRoom = (roomKind: number | null): 'campfire' | 'shrine' | 'treasure' => (roomKind === 4 ? 'shrine' : roomKind === 3 ? 'treasure' : 'campfire')
type SceneProps = { members: number[]; shapes: { family: string; orientable: boolean }[]; delving: boolean; paused: boolean; chapter: number; roomKind: number | null; event?: ExpEvent | null }
// ── P2: the LIVE in-run node view ───────────────────────────────────────────────────────────────────────────
// When the active team is delving, its CURRENT room plays inline and AUTO-ADVANCES — no Watch→Continue modal. The
// deterministic battle replay (buildTimeline) runs on a rAF clock and HOLDS on the won/lost pose (CombatStage3D's
// climax camera settles on the winner) until the banked `current_room` cursor advances — the core already decided
// it — then the next room's battle loads and replays. A non-combat room (campfire/treasure) shows the resting hub.
// Truth is unchanged: this only VISUALIZES the room the core advanced to (reward banking is `accrue_run`, not this).
// The Combat Log tab — the live fight's events, newest-first, revealed in step with the on-screen combat (reads the
// useLiveLog signal LiveCombat publishes). Glyph by beat kind (✦ ult / ✚ heal / ⚔ attack); idle text when nothing fights.
// BF-1: the dungeon-crawler map — a render-only serpentine layout of the active delve's rooms (truth: room_kind clipped
// to revealed, current_room, total_rooms). Visited rooms glow, the party's room is highlighted, the unexplored tail is
// fogged; fight rooms are clickable to re-watch. No core change — a 2D reframing of the (deterministic, linear) run.
function DungeonMapPanel({ run, watchRunRoom }: { run: RunView | null; watchRunRoom: (i: number) => void }) {
  const tr = useT()
  const head = <h3 style={X.panelTitle}>{tr('exp.tab.dungeon')}</h3>
  if (!run) return <div style={X.panel}>{head}<div style={X.logIdle}>{tr('exp.dungeon.none')}</div></div>
  const revealed = run.room_kind.length
  const total = Math.max(run.total_rooms, revealed)
  const curIdx = revealed - 1 // the room the party is currently in
  const perRow = 5
  const cell = 48
  const R = 18 // node radius
  const rows = Math.max(1, Math.ceil(total / perRow))
  const pos = (i: number) => {
    const row = Math.floor(i / perRow)
    const inRow = i % perRow
    const col = row % 2 === 0 ? inRow : perRow - 1 - inRow // serpentine: alternate the row direction so it snakes
    return { x: col * cell + cell / 2, y: row * cell + cell / 2 }
  }
  const W = perRow * cell
  const H = rows * cell
  return (
    <div style={X.panel}>
      {head}
      <div style={X.dungeonWrap}>
        <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
            {Array.from({ length: Math.max(0, total - 1) }).map((_, i) => {
              const a = pos(i)
              const b = pos(i + 1)
              const lit = i + 1 <= curIdx // the trail behind the party glows
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lit ? ECHO : 'rgba(255,255,255,0.14)'} strokeWidth={lit ? 2.5 : 2} strokeOpacity={lit ? 0.75 : 0.4} strokeDasharray={lit ? undefined : '3 4'} />
            })}
          </svg>
          {Array.from({ length: total }).map((_, i) => {
            const p = pos(i)
            const known = i < revealed
            const k = known ? run.room_kind[i] : -1
            const glyph = known ? (DELVE_GLYPH[k] ?? '•') : '?'
            const isCur = i === curIdx
            const done = i < curIdx
            const fight = known && k <= 1
            const sty: CSSProperties = {
              ...X.dungeonRoom,
              left: p.x - R,
              top: p.y - R,
              borderColor: isCur ? GOLD : done ? '#5fe0c6' : known ? ECHO : 'rgba(255,255,255,0.22)',
              color: isCur ? GOLD : done ? '#5fe0c6' : known ? '#e8e0ff' : 'rgba(255,255,255,0.5)',
              opacity: known ? 1 : 0.55,
              background: isCur ? 'rgba(255,207,107,0.16)' : done ? 'rgba(95,224,198,0.08)' : 'rgba(20,16,34,0.82)',
              boxShadow: isCur ? `0 0 0 2px ${GOLD}, 0 0 12px ${GOLD}` : 'none',
            }
            return fight ? (
              <button key={i} type="button" style={{ ...sty, cursor: 'pointer' }} onClick={() => watchRunRoom(i)} title={tr('exp.watchRoom')}>{glyph}</button>
            ) : (
              <span key={i} style={sty} title={known ? tr(`exp.room.${ROOM_KEY[k] ?? 'combat'}`) : tr('exp.dungeon.unknown')}>{glyph}</span>
            )
          })}
        </div>
        <div style={X.dungeonLegend}>{tr('exp.delving', { a: Math.min(curIdx + 1, total), b: total })}</div>
      </div>
    </div>
  )
}

function CombatLogPanel() {
  const tr = useT()
  const log = useLiveLog((s) => s.log)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const step = log?.step ?? -1
  // keep the newest-first log pinned to the top so it follows the live action without hand-scrolling
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [step])
  const head = <h3 style={X.panelTitle}>{tr('exp.tab.log')}</h3>
  if (!log || log.step < 0) return <div style={X.panel}>{head}<div style={X.logIdle}>{tr('exp.log.idle')}</div></div>
  const { units, beats } = log
  const idxs: number[] = []
  for (let k = Math.min(step, beats.length - 1); k >= 0 && idxs.length < 50; k--) idxs.push(k)
  return (
    <div style={X.panel}>
      {head}
      <div style={X.logScroll} ref={scrollRef}>
        {idxs.map((k) => {
          const b = beats[k]
          const actor = units[b.actor]
          if (!actor) return null
          const ally = !actor.is_enemy
          const dmgs = b.impacts.filter((im) => im.dmg > 0).map((im) => `${units[im.target]?.nick ?? '?'} −${im.dmg.toLocaleString()}`)
          const heals = b.impacts.filter((im) => im.heal > 0).map((im) => `${units[im.target]?.nick ?? '?'} +${im.heal.toLocaleString()}`)
          const faints = b.impacts.filter((im) => im.fainted >= 0).map((im) => units[im.fainted]?.nick ?? '?')
          const glyph = b.action === 'ult' ? '✦' : dmgs.length === 0 && heals.length > 0 ? '✚' : '⚔'
          const tail = [dmgs.join(', '), heals.join(', '), faints.length ? `☠ ${faints.join(', ')}` : ''].filter(Boolean).join('  ')
          // name the ability that fired (the same plain-language labels the gambit editor uses), so you learn kits by watching
          const skill = b.actionId >= 0 && b.actionId < GACT_KEYS.length ? ` · ${tr(`exp.gact.${GACT_KEYS[b.actionId]}`)}` : ''
          return <div key={k} style={{ ...X.logRow, color: ally ? '#cfe0ff' : '#ffc8b0' }}>{`${glyph} ${actor.nick}${skill}${tail ? '  →  ' + tail : ''}`}</div>
        })}
      </div>
    </div>
  )
}

// LiveNodeStage decides what the active team is DOING and shows it live:
//  • delving a combat/boss room → that room's live battle (advances as `current_room` does)
//  • delving a rest/treasure room → the campfire hub (a resting node IN the manifold)
//  • stationed/farming a cleared node → its clear battle on LOOP (the team keeps clearing/exploring — NOT resting)
//  • idle between delves → the campfire hub
// (`run` is null when this team isn't delving; `station` is its farmed node index, or −1.)
function LiveNodeStage({ run, station, teamIdx, members, shapes, chapter, paused }: { run: RunView | null; station: number; teamIdx: number; members: number[]; shapes: { family: string; orientable: boolean }[]; chapter: number; paused: boolean }) {
  const runRoomBattle = useGame((s) => s.runRoomBattle)
  const stationBattle = useGame((s) => s.stationBattle)
  const roomIdx = run ? Math.max(0, Math.min(run.current_room, run.room_kind.length - 1)) : -1
  const runIsCombat = run ? (run.room_kind[roomIdx] ?? 0) <= 1 : false
  const hubRoomKind = run ? (run.room_kind[roomIdx] ?? null) : null // the live room's kind drives the hub focal (campfire/treasure/shrine)
  // a non-combat room is a narrative EVENT NODE: a Crossroads (Decision) shows its themed-template scene; the other
  // non-combat rooms pick a diorama scene deterministically from their kind's pool.
  const hubEvent = run
    ? (run.pending_decision ? decisionSceneEvent(run.pending_decision.template) : eventForRoom(hubRoomKind, chapter, roomIdx, run.start_ms))
    : null
  // both fetches are memoized (a WASM JSON serialize, never per frame — gotcha #4) and only fire for the live state
  const runBattle = useMemo(() => (run && runIsCombat ? runRoomBattle(roomIdx) : null), [run, runIsCombat, roomIdx, runRoomBattle])
  // #6 vary: rotate the COSMETIC farm replay every ~11s so the live farm view isn't one bit-identical fight forever —
  // varied rolls, crit timing, the odd close call. The farm RATE is the power-banded closed form; this re-seed never
  // touches loot. Reset on station/team change; pause when paused. 11s lets each short clear play through before the cut.
  const farming = !run && station >= 0
  const [farmVariant, setFarmVariant] = useState(0)
  useEffect(() => { setFarmVariant(0) }, [station, teamIdx])
  useEffect(() => {
    if (!farming || paused) return
    const id = window.setInterval(() => setFarmVariant((v) => v + 1), 11000)
    return () => window.clearInterval(id)
  }, [farming, paused])
  const farmBattle = useMemo(() => (farming ? stationBattle(station, farmVariant) : null), [farming, station, stationBattle, farmVariant])
  const hub = <ExpeditionScene3D members={members} shapes={shapes} delving={!!run} paused={paused} chapter={chapter} roomKind={hubRoomKind} event={hubEvent} />
  if (run) return runBattle ? <LiveCombat key={`run-${run.start_ms}-${roomIdx}`} battle={runBattle} paused={paused} looping={false} teamIdx={teamIdx} /> : hub // rest room within the delve → campfire
  if (farming && farmBattle) return <LiveCombat key={`farm-${station}-${farmVariant}`} battle={farmBattle} paused={paused} looping teamIdx={teamIdx} /> // farming → loop the (re-seeded) clear
  return hub // idle between delves → campfire
}

function LiveCombat({ battle, paused, looping, teamIdx }: { battle: BattleResult; paused: boolean; looping: boolean; teamIdx: number }) {
  const units = useMemo(() => battle.units ?? [], [battle])
  const tl = useMemo(() => buildTimeline(battle.log ?? []), [battle])
  const clockRef = useRef(0)
  const [beatIdx, setBeatIdx] = useState(-1)
  const [finished, setFinished] = useState(!looping && tl.beats.length === 0)
  // one rAF clock; re-renders only on beat change / finish (not per frame). A DELVE room HOLDS the final pose until
  // re-keyed by the next room; a FARM loops — holds the won pose ~1.4s then re-clears (the team keeps farming).
  useEffect(() => {
    if (finished || paused) return
    let raf = 0
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      clockRef.current += Math.min(0.05, (now - last) / 1000)
      last = now
      if (clockRef.current >= tl.duration) {
        if (looping) {
          if (clockRef.current >= tl.duration + 1.4) clockRef.current = 0 // re-clear the node
        } else {
          setBeatIdx(Math.max(0, tl.beats.length - 1))
          setFinished(true)
          return
        }
      }
      let bi = -1
      for (let k = 0; k < tl.beats.length; k++) {
        if (tl.beats[k].start <= clockRef.current) bi = k
        else break
      }
      setBeatIdx((p) => (p === bi ? p : bi))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [tl, finished, paused, looping])
  const curBeat = beatIdx >= 0 ? tl.beats[beatIdx] : null
  const evalT = finished ? tl.duration : curBeat ? curBeat.impacts[curBeat.impacts.length - 1]?.at ?? 0 : 0
  const dead = deadAt(tl, units, evalT)
  const curTargetImpact = curBeat?.impacts.find((im) => im.dmg > 0 || im.heal > 0) ?? curBeat?.impacts[0]
  const cur = curBeat ? { actor: curBeat.actor, target: curTargetImpact?.target ?? -1, adv: curTargetImpact?.status === 'adv' } : null
  const nextActor = beatIdx + 1 < tl.beats.length ? tl.beats[beatIdx + 1].actor : -1
  const firing = curBeat && curBeat.ruleIdx >= 0 && cur && cur.actor >= 0 && !units[cur.actor]?.is_enemy ? cur.actor : -1
  // publish the firing gambit rule for the TacticsPanel highlight — surfaces the DEFAULT attack (ruleIdx -1) too,
  // whenever an ALLY is acting (unlike `firing`, which gates the 3D halo to authored rules only).
  const setFire = useLiveFiring((s) => s.set)
  const fSlot = !paused && cur && cur.actor >= 0 && !units[cur.actor]?.is_enemy ? cur.actor : -1
  const fIdx = curBeat ? curBeat.ruleIdx : -1
  useEffect(() => { setFire(fSlot >= 0 ? { team: teamIdx, slot: fSlot, ruleIdx: fIdx } : null) }, [teamIdx, fSlot, fIdx, setFire])
  useEffect(() => () => setFire(null), [setFire]) // clear the highlight when this live combat unmounts (room/team change)
  // publish the revealed combat log (newest beats) for the Combat Log tab
  const setLog = useLiveLog((s) => s.set)
  useEffect(() => { setLog({ units, beats: tl.beats, step: beatIdx }) }, [units, tl, beatIdx, setLog])
  useEffect(() => () => setLog(null), [setLog])
  const hp = hpAt(tl, units, evalT)
  const stats = combatStats(tl, units, Math.min(clockRef.current, tl.duration)) // live DPS/HPS/elapsed (render metric)
  return (
    <>
      <CombatStage3D units={units} dead={dead} cur={cur} nextActor={nextActor} step={beatIdx} firingActor={firing} finished={finished} win={battle.win} paused={paused} />
      <CombatHud units={units} hp={hp} dead={dead} cur={cur} curBeat={curBeat} beatIdx={beatIdx} firing={firing} stats={stats} />
    </>
  )
}

// The live-combat HUD overlaid on the inline 3D stage: compact foe/ally HP bars with floating damage/heal numbers, a
// DPS/HPS/time meter, and a "tactic fired" skill cut-in — so the inline view reads like a fight, not a silent diorama.
function CombatHud({ units, hp, dead, cur, curBeat, beatIdx, firing, stats }: { units: UnitInfo[]; hp: number[]; dead: boolean[]; cur: { actor: number; target: number; adv: boolean } | null; curBeat: Beat | null; beatIdx: number; firing: number; stats: { dps: number; hps: number; elapsed: number; dpsBy: number[]; hpsBy: number[] } }) {
  const tr = useT()
  const allies = units.map((u, i) => ({ u, i })).filter((x) => !x.u.is_enemy)
  const foes = units.map((u, i) => ({ u, i })).filter((x) => x.u.is_enemy)
  const bar = ({ u, i }: { u: UnitInfo; i: number }) => {
    const frac = u.max_hp > 0 ? Math.max(0, hp[i]) / u.max_hp : 0
    const ti = cur?.target === i ? curBeat?.impacts.find((im) => im.target === i) : undefined
    const float = ti ? (ti.heal > 0 ? `+${ti.heal}` : ti.dmg > 0 ? `−${ti.dmg}` : '') : ''
    const myDps = !u.is_enemy ? Math.round(stats.dpsBy[i] ?? 0) : 0 // per-shape DPS attribution
    const myHps = !u.is_enemy ? Math.round(stats.hpsBy[i] ?? 0) : 0
    return (
      <div key={`${u.is_enemy ? 'e' : 'a'}-${i}`} style={{ ...X.hudBar, opacity: dead[i] ? 0.35 : 1 }}>
        {/* #4 declutter: per-shape DPS/HPS demoted to the hover title — the live view shows HP + one headline meter */}
        <span style={X.hudNick} title={`${u.nick}${myDps > 0 ? `  ⚔${myDps.toLocaleString()}` : ''}${myHps > 0 ? `  ✚${myHps.toLocaleString()}` : ''}`}>
          <span style={{ color: ELEMENT_C[u.element] }}>●</span> {u.nick}
        </span>
        <div style={X.hudHpWrap}><div style={{ ...X.hudHp, width: `${frac * 100}%`, background: u.is_enemy ? '#ff7a7a' : '#7fe6a0' }} /></div>
        {float && <span key={beatIdx} style={{ ...X.floatNum, top: -4, right: 2, ...floatFx(ti, curBeat?.action === 'ult', u.max_hp, 13) }}>{float}{ti && ti.fainted >= 0 ? ' ☠' : ''}</span>}
        {ti && ti.dmg > 0 && (
          <span key={`spk-${beatIdx}`} style={X.sparkBurst} aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((s) => (
              <span key={s} className="exp-spark" style={{ ...X.spark, background: ELEMENT_C[u.element], '--ang': `${s * 60}deg` } as CSSProperties} />
            ))}
          </span>
        )}
      </div>
    )
  }
  const lowHp = allies.some(({ i }) => !dead[i] && units[i].max_hp > 0 && hp[i] / units[i].max_hp < 0.3)
  const nick = firing >= 0 ? units[firing]?.nick : null
  return (
    <>
      {curBeat?.action === 'ult' && <div key={`flash-${beatIdx}`} className="exp-ult-flash" style={X.ultFlash} aria-hidden />}
      {lowHp && <div style={X.lowHpVignette} aria-hidden />}
      <div style={X.hudTop}>
        <div style={X.hudCol}>{foes.map(bar)}</div>
        <div style={X.hudMeter}>
          <span style={{ color: '#ff8a6b' }}>{`⚔ ${Math.round(stats.dps).toLocaleString()}`}</span>
          <span style={{ color: '#7fe6a0' }}>{`✚ ${Math.round(stats.hps).toLocaleString()}`}</span>
          <span style={{ opacity: 0.75 }}>{`⏱ ${stats.elapsed.toFixed(1)}s`}</span>
        </div>
        <div style={X.hudCol}>{allies.map(bar)}</div>
      </div>
      {nick && <div key={`cut-${beatIdx}`} className="exp-tactic-cut" style={{ ...X.tacticCut, top: 'auto', bottom: 28 }}>⚡ {tr('exp.tacticCutGeneric', { nick })}</div>}
    </>
  )
}

// EXPEDITION EVENT NODES — a narrative encounter is a presentation SKIN over a non-combat room (the Rust RoomKind +
// its effect stay authoritative). Each event reuses a diorama's look: a biome scatter + focal + palette + flavor text.
// `group` = the room kind it skins: 'rest'→Campfire(2), 'boon'→Shrine(4), 'find'→Treasure(3). Pure presentation; the
// strings live here as data (the cosmetics-catalog pattern) and render via variables so the no-literal-JSX rule passes.
type SceneTheme = { floor: string; fog: string; key: string }
type FocalKind = 'campfire' | 'shrine' | 'treasure' | 'altar'
type ExpEvent = { id: string; name: string; flavor: string; group: 'rest' | 'boon' | 'find'; biome: BiomeKind; focal: FocalKind; theme: SceneTheme }
const EXP_EVENTS: ExpEvent[] = [
  // 🔥 REST nodes (skin Campfire, kind 2): the party recovers
  { id: 'campfire', name: 'Campfire', flavor: 'Crossed logs and a ring of stones — the party warms their hands and catches their breath.', group: 'rest', biome: 'forest', focal: 'campfire', theme: { floor: '#1a2e2c', fog: '#102320', key: '#ffcf6b' } },
  { id: 'tearoom', name: 'Hidden Tearoom', flavor: 'A paper lantern behind a shoji screen, the kettle still warm. A quiet cup, and the party feels lighter.', group: 'rest', biome: 'teagarden', focal: 'shrine', theme: { floor: '#222636', fog: '#141826', key: '#ffb876' } },
  { id: 'clearing', name: 'Sunlit Clearing', flavor: 'The dark opens onto an impossibly bright field of wildflowers. They rest a while in a pool of sun.', group: 'rest', biome: 'meadow', focal: 'campfire', theme: { floor: '#46732e', fog: '#c2dcc4', key: '#fff0c4' } },
  { id: 'shore', name: 'Moonlit Shore', flavor: 'A still, mirror-dark sea at the edge of the world. They sit a while at the quiet edge.', group: 'rest', biome: 'shore', focal: 'campfire', theme: { floor: '#1b2336', fog: '#0e131f', key: '#9fb3d6' } },
  { id: 'zen', name: 'Zen Garden', flavor: 'Raked sand and a few quiet stones — a karesansui, a garden for the mind, not the feet. Nothing to solve here.', group: 'rest', biome: 'zen', focal: 'shrine', theme: { floor: '#cabf9a', fog: '#d8cda8', key: '#f3e6c0' } },
  { id: 'frozen', name: 'Frozen Vault', flavor: 'A pocket of endless gentle snow, hushed and cold. The cold clears the head.', group: 'rest', biome: 'winter', focal: 'campfire', theme: { floor: '#dfeaf7', fog: '#c3d4e8', key: '#ffe2b0' } },
  // ⛩ BOON nodes (skin Shrine, kind 4): a lasting blessing
  { id: 'shrine', name: 'Wayside Shrine', flavor: 'A vermilion torii at dusk — the threshold where the everyday ends and the sacred begins. They bow, and feel quicker.', group: 'boon', biome: 'forest', focal: 'shrine', theme: { floor: '#1c2438', fog: '#101626', key: '#ffb060' } },
  { id: 'altar', name: 'The Old Altar', flavor: 'A stepped stone altar under a shaft of light. Leave a little of what you carry, and something answers.', group: 'boon', biome: 'zen', focal: 'altar', theme: { floor: '#b8ac86', fog: '#cabd92', key: '#ffe6b0' } },
  { id: 'chapel', name: 'Stained Chapel', flavor: 'Tall windows pour ruby and sapphire across the stone; the coloured light settles on the party like a blessing.', group: 'boon', biome: 'cloister', focal: 'altar', theme: { floor: '#241f2e', fog: '#15121c', key: '#c98aa0' } },
  // 💎 FIND nodes (skin Treasure, kind 3): Echoes & loot
  { id: 'cache', name: 'Hidden Cache', flavor: 'Cold stone, iron bars, and a chest someone left in the dark long ago.', group: 'find', biome: 'dungeon', focal: 'treasure', theme: { floor: '#26262c', fog: '#15151a', key: '#ff8a2a' } },
  { id: 'gallery', name: 'Gallery of Lost Shapes', flavor: 'Marble plinths, each holding a shape under one light — the ones who came before. One stand waits, empty.', group: 'find', biome: 'gallery', focal: 'treasure', theme: { floor: '#1c1a22', fog: '#100e16', key: '#e6ecff' } },
  { id: 'orrery', name: 'Orrery Chamber', flavor: 'Slow brass rings wheel overhead, little worlds on their courses. The party catches a fallen star.', group: 'find', biome: 'orrery', focal: 'treasure', theme: { floor: '#241a3a', fog: '#150e26', key: '#e8b75a' } },
  { id: 'geode', name: 'Geode Hollow', flavor: 'A geode cracked open, crystals leaning in and glowing. A handful of bright shards.', group: 'find', biome: 'crystal', focal: 'treasure', theme: { floor: '#1a1430', fog: '#100a22', key: '#9a7aff' } },
  { id: 'reef', name: 'Sunken Reef', flavor: 'A flooded cavern, coral leaning in, anemones breathing teal light — treasure resting on the sand.', group: 'find', biome: 'reef', focal: 'treasure', theme: { floor: '#123b44', fog: '#0a1e22', key: '#3fb8a8' } },
  { id: 'forge', name: 'Deep Forge', flavor: 'An anvil and a firepot of coals, hammer-and-spark warmth. A good place to temper what you carry.', group: 'find', biome: 'forge', focal: 'treasure', theme: { floor: '#2a1c14', fog: '#160e08', key: '#ff8a3a' } },
  { id: 'grove', name: 'Glimmercap Grove', flavor: 'A fairy-ring of glowing mushrooms, teal and violet — the spores leave a curious gift.', group: 'find', biome: 'mushroom', focal: 'treasure', theme: { floor: '#16291f', fog: '#0b1813', key: '#5ef0d2' } },
  { id: 'archive', name: "The Architect's Archive", flavor: 'Graph-paper void and the three axes drawn straight through the air — a shape’s hidden numbers, read at last.', group: 'find', biome: 'blueprint', focal: 'treasure', theme: { floor: '#0a1226', fog: '#0c1730', key: '#3f78ff' } },
  { id: 'merchant', name: 'Wandering Merchant', flavor: 'A cozy counter where none should be — shelves of odd wares, a teacup gone cold. The shopkeep waves you over.', group: 'find', biome: 'market', focal: 'treasure', theme: { floor: '#2a1c12', fog: '#1a1208', key: '#ffce5a' } },
  { id: 'testchamber', name: 'The Test Chamber', flavor: 'A perfectly square room: one red wall, one green, an honest light above. The light bounces strangely — and leaves a gift.', group: 'find', biome: 'cornell', focal: 'treasure', theme: { floor: '#d8d6d2', fog: '#cfcdc8', key: '#f4f1ea' } },
]
// The idle hub slowly cycles through every event's scene (~22s each) so it never sits static — pure presentation.
const IDLE_SCENES: { biome: BiomeKind; focal: FocalKind; theme: SceneTheme }[] = EXP_EVENTS.map((e) => ({ biome: e.biome, focal: e.focal, theme: e.theme }))
const EVENTS_BY_GROUP = { rest: EXP_EVENTS.filter((e) => e.group === 'rest'), boon: EXP_EVENTS.filter((e) => e.group === 'boon'), find: EXP_EVENTS.filter((e) => e.group === 'find') }
// Pick THIS room's event deterministically from its kind's pool — keyed on the run's departure + room index + chapter,
// so a given run always shows the same events (bit-stable presentation), but different runs vary. RoomKind: 2/3/4.
function eventForRoom(roomKind: number | null, chapter: number, roomIdx: number, startMs: number): ExpEvent | null {
  const pool = roomKind === 2 ? EVENTS_BY_GROUP.rest : roomKind === 4 ? EVENTS_BY_GROUP.boon : roomKind === 3 ? EVENTS_BY_GROUP.find : null
  if (!pool || pool.length === 0) return null
  const h = ((Math.floor(startMs) >>> 0) ^ Math.imul(roomIdx + 1, 2654435761) ^ Math.imul(chapter + 1, 40503)) >>> 0
  return pool[h % pool.length]
}
function ExpeditionScene3DMesh({ members, shapes, delving, paused, chapter, roomKind, event }: SceneProps) {
  const [idle, setIdle] = useState(0)
  useEffect(() => {
    if (delving) return // a delve pins the scene; only the resting hub cycles
    const id = setInterval(() => setIdle((i) => (i + 1) % IDLE_SCENES.length), 22000)
    return () => clearInterval(id)
  }, [delving])
  // a DELVE non-combat room shows its EVENT's scene (the diorama assigned to that node); idle cycles the vignettes;
  // anything else falls back to the chapter biome + the room-kind focal.
  const ev = delving ? (event ?? null) : null
  const sc = delving ? null : IDLE_SCENES[idle]
  const theme = ev ? ev.theme : sc ? sc.theme : (CHAPTER_THEME[chapter] ?? CHAPTER_THEME[1])
  const biomeKind = ev ? ev.biome : sc ? sc.biome : biomeForChapter(chapter)
  const focalKind = ev ? ev.focal : sc ? sc.focal : focalForRoom(roomKind)
  return (
    <Canvas frameloop={paused ? 'never' : 'always'} camera={{ position: [0, 1.0, 4.5], fov: 42 }} dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
      <fog attach="fog" args={[theme.fog, 8, 18]} />
      <hemisphereLight args={[theme.key, theme.fog, 0.5]} />
      <ambientLight intensity={0.42} />
      <pointLight position={[3, 5, 4]} intensity={60} color="#fff0d8" />
      <pointLight position={[-4, 2, 2]} intensity={30} color={theme.key} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.62, -0.2]}>
        <circleGeometry args={[9, 56]} />
        <meshStandardMaterial color={theme.floor} roughness={0.92} metalness={0.12} />
      </mesh>
      {/* focal + biome: a DELVE pins them to the room kind + chapter; the resting hub cycles cohesive vignettes (IDLE_SCENES) */}
      <HubFocal kind={focalKind} />
      <Biome kind={biomeKind} />
      {/* volumetric ground fog pooling on the floor — resting-only ambiance (caustics live in the PT only, not here) */}
      {!delving && <GroundFog options={{ color: theme.fog, density: 0.55, speed: 0.25, floor: -0.62, thickness: 0.9, radius: 7 }} />}
      {(() => {
        const layout = partyGemLayout(members.length) // same semicircle around the campfire the PT bakes
        return members.map((id, k) => {
          const s = shapes[id]
          if (!s) return null
          const slot = layout[k]
          return <SceneGem key={id} family={s.family} element={elementOf(s.family, s.orientable)} pos={[slot.pos[0], slot.pos[2]]} yaw={slot.yaw} delving={delving} />
        })
      })()}
      <ScenePostFX bloomIntensity={0.5} vignette />
    </Canvas>
  )
}
// linear-space color of a gem's element (for the path tracer's material LUT)
const elemLin = (family: string, orientable: boolean): [number, number, number] => {
  const c = new THREE.Color(ELEMENT_HEX[elementOf(family, orientable)]).convertSRGBToLinear()
  return [c.r, c.g, c.b]
}
const hexLin = (hex: string): [number, number, number] => { const c = new THREE.Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b] }
// the opt-in PT party portrait: its OWN demand-frameloop Canvas (frozen pose ⇒ converges then idles); pauses off-tab/behind-modal.
function ExpeditionScenePT({ paused, chapter, scene }: SceneProps & { scene: PartyPtScene }) {
  const theme = CHAPTER_THEME[chapter] ?? CHAPTER_THEME[1]
  return (
    <Canvas frameloop={paused ? 'never' : 'demand'} camera={{ position: [0, 1.0, 4.5], fov: 42 }} dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
      <ExpeditionPathTrace scene={scene} backdrop={theme.fog} keyCol={theme.key} />
    </Canvas>
  )
}
// chooser: default = the live raster MESH scene; opt-in (badge, while resting, not low-preset) = the PT portrait.
function ExpeditionScene3D(props: SceneProps) {
  const { members, shapes, delving, paused, chapter } = props
  const quality = useGfx((s) => s.quality)
  const ptOptIn = useGfx((s) => s.expeditionPt)
  const update = useGfx((s) => s.update)
  const theme = CHAPTER_THEME[chapter] ?? CHAPTER_THEME[1]
  const ptOffered = quality !== 'low' && members.length > 0
  const partyKey = members.join(',') + '|' + chapter + '|r'
  const scene = useMemo(() => {
    if (!ptOffered || !ptOptIn || delving) return null
    const gems = members.map((id) => shapes[id]).filter(Boolean).map((s) => ({ family: s.family, colorLinear: elemLin(s.family, s.orientable), rank: 2 }))
    return buildPartyPtScene(gems, hexLin(theme.floor), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyKey, ptOffered, ptOptIn, delving])
  const usePT = !!scene && !paused && scene.triCount <= 180_000
  const cycle = ptOffered ? () => update({ expeditionPt: !ptOptIn }) : undefined
  return (
    <div style={{ position: 'relative', width: '100%', height: delving ? 340 : 220 }}>{/* idle hub is shorter so compose+send sit in the first viewport; full height while delving */}
      {usePT && scene ? <ExpeditionScenePT {...props} scene={scene} /> : <ExpeditionScene3DMesh {...props} />}
      {ptOffered && <RenderTechBadge tech={usePT ? 'partypt' : 'mesh'} onCycle={cycle} />}
    </div>
  )
}

// ── the combat WATCH: a continuous-time rendering of the deterministic battle log (Phase 1 — timeline spine).
// The turn engine is the TRUTH; this plays its log over a single clock (fetched once, no WASM per frame). Faith-
// fulness (HP fold, dissolve-on-fainted, winner-read, verbatim numbers) lives in three/dungeonWatch.ts. ──
function CombatOverlay({ battle, result, quest }: { battle: BattleResult; result: StationResult | null; quest: number }) {
  const tr = useT()
  const dismiss = useGame((s) => s.dismissCombat)
  const shapes = useGame((s) => s.shapes)
  const view = useGame((s) => s.view)
  const units = useMemo(() => battle.units ?? [], [battle])
  const tl = useMemo<Timeline>(() => buildTimeline(battle.log ?? []), [battle])
  const clockRef = useRef(0)
  const speedRef = useRef(1)
  const [speed, setSpeed] = useState(1)
  const [beatIdx, setBeatIdx] = useState(-1)
  const [finished, setFinished] = useState(tl.beats.length === 0)
  const playedEnd = useRef(false)
  const firedBeat = useRef(-1)

  // one clock, advanced by rAF (continuous time) — re-render ONLY on beat change / finish, not per frame.
  useEffect(() => {
    if (finished) return
    let raf = 0
    let last = performance.now()
    const loop = () => {
      const now = performance.now()
      clockRef.current += Math.min(0.05, (now - last) / 1000) * speedRef.current
      last = now
      let bi = -1
      for (let k = 0; k < tl.beats.length; k++) {
        if (tl.beats[k].start <= clockRef.current) bi = k
        else break
      }
      setBeatIdx((p) => (p === bi ? p : bi))
      if (clockRef.current >= tl.duration) {
        setFinished(true)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tl, finished])

  // evaluate HP/dead AFTER the current beat's impacts land (bars step once per beat, showing that beat's result)
  const curBeat = beatIdx >= 0 ? tl.beats[beatIdx] : null
  const evalT = finished ? tl.duration : curBeat ? curBeat.impacts[curBeat.impacts.length - 1]?.at ?? 0 : 0
  const hp = hpAt(tl, units, evalT)
  const dead = deadAt(tl, units, evalT)
  const curTargetImpact = curBeat?.impacts.find((im) => im.dmg > 0 || im.heal > 0) ?? curBeat?.impacts[0]
  const cur = curBeat ? { actor: curBeat.actor, target: curTargetImpact?.target ?? -1, adv: curTargetImpact?.status === 'adv' } : null
  const nextActor = beatIdx + 1 < tl.beats.length ? tl.beats[beatIdx + 1].actor : -1
  const win = result ? result.win : battle.win

  // M1: when the current beat was driven by a programmed gambit rule (ruleIdx >= 0) on an ALLY, highlight that
  // shape + show a "tactic fired" cut-in naming the action (resolved from the watched team's program).
  const firing = curBeat && curBeat.ruleIdx >= 0 && cur && cur.actor >= 0 && !units[cur.actor]?.is_enemy ? cur.actor : -1
  const firingLabel = (() => {
    if (firing < 0 || !curBeat || !view) return null
    const team = quest === -1 ? (view.run?.team ?? -1) : view.exp_teams.findIndex((tm) => tm.station === quest)
    const act = team >= 0 ? view.exp_teams[team]?.orders.gambits?.[firing]?.[curBeat.ruleIdx]?.action : undefined
    const nick = units[firing]?.nick ?? ''
    return act != null ? tr('exp.tacticCut', { nick, act: tr(`exp.gact.${GACT_KEYS[act]}`) }) : tr('exp.tacticCutGeneric', { nick })
  })()

  // combat SFX — once per beat (the Watch is the engineered peak; it should sing)
  useEffect(() => {
    if (beatIdx < 0 || beatIdx === firedBeat.current) return
    firedBeat.current = beatIdx
    const b = tl.beats[beatIdx]
    if (!b) return
    if (b.action === 'ult') sfxUlt(2)
    else if (b.impacts.some((im) => im.heal > 0)) sfxHeal()
    else if (b.impacts.some((im) => im.dmg > 0)) sfxHit(b.impacts.reduce((m, im) => Math.max(m, im.dmg), 0))
    if (b.impacts.some((im) => im.fainted >= 0)) sfxFaint()
  }, [beatIdx, tl])
  useEffect(() => {
    if (finished && !playedEnd.current) {
      playedEnd.current = true
      ;(win ? sfxVictory : sfxDefeat)()
    }
  }, [finished, win])

  const skip = () => {
    clockRef.current = tl.duration
    setFinished(true)
  }
  const cycleSpeed = () => {
    const s = speed === 1 ? 2 : speed === 2 ? 4 : 1
    setSpeed(s)
    speedRef.current = s
  }

  const allies = units.map((u, i) => ({ u, i })).filter((x) => !x.u.is_enemy)
  const foes = units.map((u, i) => ({ u, i })).filter((x) => x.u.is_enemy)

  const renderBar = ({ u, i }: { u: UnitInfo; i: number }) => {
    const cur_hp = hp[i]
    const frac = u.max_hp > 0 ? cur_hp / u.max_hp : 0
    const ti = cur?.target === i ? curBeat?.impacts.find((im) => im.target === i) : undefined
    const float = ti ? (ti.heal > 0 ? `+${ti.heal}` : ti.dmg > 0 ? `−${ti.dmg}` : '') : ''
    return (
      <div key={`${u.is_enemy ? 'e' : 'a'}-${i}`} style={{ ...X.barCard, opacity: dead[i] ? 0.4 : 1 }}>
        <span style={X.barNick} title={u.nick}><span style={{ color: ELEMENT_C[u.element] }}>●</span> {u.nick}</span>
        <div style={X.hpBarWrap}>
          <div style={{ ...X.hpBar, width: `${frac * 100}%`, background: u.is_enemy ? '#ff7a7a' : '#7fe6a0' }} />
        </div>
        <span style={X.hpTxt}>{Math.max(0, cur_hp)}/{u.max_hp}</span>
        {float && <span key={beatIdx} style={{ ...X.floatNum, ...floatFx(ti, curBeat?.action === 'ult', u.max_hp, 18) }}>{float}{ti && ti.fainted >= 0 ? ' ☠' : ''}</span>}
      </div>
    )
  }

  const recruitNick = result && result.recruited_id >= 0 ? shapes[result.recruited_id]?.nick : null
  const spectator = result == null

  return (
    <div style={X.overlay} onClick={finished ? dismiss : undefined}>
      <div style={X.battleBox} onClick={(e) => e.stopPropagation()}>
        <div style={X.foeBars}>{foes.map(renderBar)}</div>
        <div style={X.stageWrap}>
          <CombatStage3D units={units} dead={dead} cur={cur} nextActor={nextActor} step={beatIdx} firingActor={firing} finished={finished} win={win} />
          {firingLabel && <div key={`fire-${beatIdx}`} className="exp-tactic-cut" style={X.tacticCut}>⚡ {firingLabel}</div>}
        </div>
        <div style={X.allyBars}>{allies.map(renderBar)}</div>

        <div style={X.battleMid}>
          {!finished ? (
            <div style={X.battleCtrls}>
              <button style={X.ctrlBtn} onClick={cycleSpeed}>×{speed}</button>
              <button style={X.ctrlBtn} onClick={skip}>{tr('exp.skip')} ⏭</button>
            </div>
          ) : (
            <div style={X.resultBox}>
              <div style={{ ...X.resultBanner, color: win ? '#7fe6a0' : GOLD }}>{win ? tr('exp.victory') : tr('exp.notReady')}</div>
              {spectator && <div style={X.hint}>{tr('exp.spectating', { q: exp_questNick(useGame.getState().expContent, quest) })}</div>}
              {result && result.win && result.echoes_gained > 0 && <div style={{ color: ECHO, fontWeight: 600 }}>+{result.echoes_gained.toLocaleString()} ✶ {tr('exp.echoes')}</div>}
              {result && result.win && result.first_clear_flux > 0 && <div style={{ color: FLUX, fontWeight: 600 }}>+{Math.round(result.first_clear_flux).toLocaleString()} ✦ {tr('hud.flux')}</div>}
              {result && result.win && recruitNick && result.recruit_is_new && <div style={{ color: '#ff8fb0', fontWeight: 700 }}>{tr('exp.freed', { nick: recruitNick })}</div>}
              {result && result.win && result.recruit_is_new && RECRUIT_VOICE.has(result.recruited_id) && <div style={X.recruitVoice}>{tr(`exp.recruit.${result.recruited_id}.freed`)}</div>}
              {result && !result.win && <div style={X.hint}>{tr('exp.notReadyHint')}</div>}
              <div style={X.resultBtns}>
                <button style={X.delveBtn} className="btn-primary" onClick={dismiss}>{tr('exp.continue')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── the Delve Report: the peak-end "your party returned" beat, as a NON-blocking toast (inform, don't interrupt) that
// auto-dismisses; tap to clear early. Fires for BOTH online completions (refresh's justReturned) and offline ones
// (boot surfaces offline.delve_returned). Replaces the old click-through modal. ──
function DelveReportToast() {
  const tr = useT()
  const report = useGame((s) => s.delveReport)
  const dismiss = useGame((s) => s.dismissDelveReport)
  useEffect(() => {
    if (!report) return
    const id = window.setTimeout(dismiss, 5500) // a gentle positive end — never a wall to click through
    return () => window.clearTimeout(id)
  }, [report, dismiss])
  if (!report) return null
  return (
    <button style={X.reportToast} onClick={dismiss} aria-label={report.died ? tr('exp.delve.retreated') : tr('exp.delve.returned')}>
      <div style={{ ...X.reportBanner, color: report.died ? GOLD : '#7fe6a0' }}>{report.died ? tr('exp.delve.retreated') : tr('exp.delve.returned')}</div>
      <div style={X.reportLine}>{`${tr('exp.delve.rooms', { n: report.rooms })}${report.echoes > 0 ? ` · +${report.echoes.toLocaleString()} ✶` : ''}`}</div>
      <div style={X.reportFlavor}>{tr(`exp.delve.flavor.${report.died ? 'retreat' : 'victory'}.${report.rooms % 3}`)}</div>
    </button>
  )
}

function exp_questNick(exp: { quests: { nick: string }[] } | null, qi: number): string {
  return exp?.quests[qi]?.nick ?? ''
}

// ── skill tree panel: per-role nodes, mirror of the Rust tree; Rust validates every spend ──
function SkillPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const expContent = useGame((s) => s.expContent)
  const spend = useGame((s) => s.spendSkillPoint)
  const respec = useGame((s) => s.respec)
  const autoSkill = useGame((s) => s.autoSkill)
  if (!view) return null
  const s = shapes[id]
  if (!s) return null
  const role = s.role
  const tree = expContent?.skill_trees[ROLE_IDX[role]] ?? [] // R6: codegen'd from Rust — single source, no drift
  const alloc = view.skill_alloc[id] ?? []
  const free = view.skill_points_free[id] ?? 0
  const lvl = view.shape_levels[id] ?? 0
  return (
    <div style={X.overlay} onClick={onClose}>
      <div style={X.skillBox} onClick={(e) => e.stopPropagation()}>
        <div style={X.panelHead}>
          <h3 style={X.panelTitle}>
            <ShapeGlyph family={s.family} /> {s.nick} · {tr('exp.levelN', { n: lvl })} · <span style={{ color: ROLE[role].c }}>{ROLE[role].icon} {tr(`exp.role.${role}`)}</span>
          </h3>
          <button style={X.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={X.skillPointsRow}>
          <span style={{ color: free > 0 ? GOLD : 'inherit', fontWeight: 700 }}>{tr('exp.skillPoints', { n: free })}</span>
          {free > 0 && (
            <button style={X.respecBtn} onClick={() => autoSkill(id)} title={tr('exp.autoSkillHint')}>✨ {tr('exp.autoSkill')}</button>
          )}
          <button style={X.respecBtn} onClick={() => respec(id)}>↺ {tr('exp.respec')}</button>
        </div>
        <div style={X.skillGrid}>
          {tree.map((nd, ni) => {
            const rank = alloc[ni] ?? 0
            const reqMet = !nd.req || (alloc[nd.req[0]] ?? 0) >= nd.req[1]
            const maxed = rank >= nd.max
            const canBuy = free > 0 && !maxed && reqMet
            const effect = nd.stat > 0 ? `+${nd.stat}% ${tr('exp.skillStat')}` : `+${nd.farm}% ${tr('exp.skillFarm')}`
            return (
              <button
                key={nd.key}
                style={{ ...X.skillNode, ...(rank > 0 ? X.skillNodeOn : {}), opacity: reqMet ? 1 : 0.45 }}
                disabled={!canBuy}
                onClick={() => spend(id, ni)}
                title={!reqMet && nd.req ? tr('exp.skillLocked', { node: tr(`skill.${role}.${tree[nd.req[0]].key}`), n: nd.req[1] }) : ''}
              >
                <span style={X.skillNodeName}>{tr(`skill.${role}.${nd.key}`)}</span>
                <span style={X.skillNodeEffect}>{effect}</span>
                <span style={X.skillNodeDesc}>{tr(nd.stat > 0 ? 'exp.skillStatDesc' : 'exp.skillFarmDesc')}</span>
                <span style={X.skillNodeRank}>{rank}/{nd.max}{canBuy ? ' ＋' : ''}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ── small order/segment building blocks ──
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={OX.row}>
      <span style={OX.rowLabel}>{label}</span>
      <div style={OX.segs}>{children}</div>
    </div>
  )
}
function Seg({ on, small, onClick, children }: { on: boolean; small?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{ ...OX.seg, ...(small ? OX.segSmall : {}), ...(on ? OX.segOn : {}) }}>
      {children}
    </button>
  )
}
function Stat({ n, l, c }: { n: number; l: string; c?: string }) {
  return (
    <div style={OX.stat}>
      <span style={{ fontSize: 18, fontWeight: 700, color: c ?? 'inherit' }}>{n.toLocaleString()}</span>
      <span style={OX.statLbl}>{l}</span>
    </div>
  )
}

// ── pre-battle orders for the active team ──
const DOCTRINE_KEYS = ['steady', 'aggressive', 'defensive']
const FOCUS_OPTS: [string, number][] = [['adaptive', -1], ['wounded', 0], ['threat', 1], ['boss', 2]]
const STANCE_KEYS = ['aggressive', 'balanced', 'defensive']
function OrdersPanel({ activeTeam, embedded }: { activeTeam: number; embedded?: boolean }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const setOrders = useGame((s) => s.setOrders)
  const setSlotStance = useGame((s) => s.setSlotStance)
  const [open, setOpen] = useState(false)
  const t = view?.exp_teams[activeTeam]
  if (!view || !t) return null
  const o = t.orders
  const FORM = [tr('exp.form.balanced'), tr('exp.form.front'), tr('exp.form.back')]
  const focusKey = FOCUS_OPTS.find((f) => f[1] === o.focus)?.[0] ?? 'adaptive'
  return (
    <div style={OX.panel}>
      <button style={OX.head} onClick={() => setOpen(!open)} hidden={embedded}>
        <span style={OX.title}>⚑ {tr('exp.orders.title')}</span>
        <span style={OX.summary}>{FORM[o.formation]} · {tr(`exp.doctrine.${DOCTRINE_KEYS[o.doctrine]}`)} · {tr(`exp.focus.${focusKey}`)}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {(embedded || open) && (
        <div style={OX.body}>
          <div style={OX.scopeHint}>{tr('exp.orders.scope')}</div>
          <Row label={tr('exp.orders.formation')}>{FORM.map((lbl, i) => <Seg key={i} on={o.formation === i} onClick={() => setOrders(activeTeam, i, o.doctrine, o.focus)}>{lbl}</Seg>)}</Row>
          <Row label={tr('exp.orders.doctrine')}>{DOCTRINE_KEYS.map((d, i) => <Seg key={d} on={o.doctrine === i} onClick={() => setOrders(activeTeam, o.formation, i, o.focus)}>{tr(`exp.doctrine.${d}`)}</Seg>)}</Row>
          <Row label={tr('exp.orders.focus')}>{FOCUS_OPTS.map(([k, v]) => <Seg key={k} on={o.focus === v} onClick={() => setOrders(activeTeam, o.formation, o.doctrine, v)}>{tr(`exp.focus.${k}`)}</Seg>)}</Row>
          <Row label={tr('exp.orders.stance')}>
            {t.members.length === 0 ? (
              <span style={{ opacity: 0.5, fontSize: 12 }}>{tr('exp.partyHint')}</span>
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {t.members.map((id, slot) => {
                  const cur = o.stance[slot] ?? (o.doctrine === 1 ? 0 : o.doctrine === 2 ? 2 : 1)
                  return (
                    <div key={id} style={OX.stanceShape}>
                      <span style={OX.stanceNick}><ShapeGlyph family={shapes[id]?.family ?? ''} /> {shapes[id]?.nick}</span>
                      <div style={{ display: 'flex', gap: 3 }}>{STANCE_KEYS.map((s, si) => <Seg key={s} small on={cur === si} onClick={() => setSlotStance(activeTeam, slot, si)}>{tr(`exp.stance.${s}`)}</Seg>)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </Row>
        </div>
      )}
    </div>
  )
}

// ── Tactics: FF12-style gambit programming. Empty = the default ladder (the casual player never opens this).
// Each shape gets a priority list of "WHEN <cond> → DO <action>"; the engine fires the first matching rule. ──
const GCOND_KEYS = ['always', 'ally_hurt', 'ally_low', 'self_hurt', 'ult_ready', 'skill_ready'] // index = cond id
const GACT_KEYS = ['attack_weakest', 'attack_threat', 'attack_focus', 'heal', 'buff_team', 'guard', 'sweep', 'hex', 'flurry', 'ult'] // index = action id
// which action ids each role may fire (3 attacks + ult for all, + the role's own skill)
const GROLE_ACTS: Record<string, number[]> = { support: [0, 1, 2, 3, 4, 9], tank: [0, 1, 2, 5, 6, 9], control: [0, 1, 2, 7, 9], dps: [0, 1, 2, 8, 9] }
function TacticsPanel({ activeTeam, embedded }: { activeTeam: number; embedded?: boolean }) {
  const tr = useT()
  const fire = useLiveFiring((s) => s.fire) // the gambit rule firing RIGHT NOW in the live combat (highlight it)
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const setRule = useGame((s) => s.setGambitRule)
  const toggle = useGame((s) => s.toggleGambit)
  const move = useGame((s) => s.moveGambit)
  const reorder = useGame((s) => s.reorderGambit)
  const add = useGame((s) => s.addGambit)
  const remove = useGame((s) => s.removeGambit)
  const reset = useGame((s) => s.resetGambits)
  const auto = useGame((s) => s.autoGambits)
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<{ slot: number; from: number } | null>(null)
  // progressive disclosure: collapsed-with-summary by default; auto-open while THIS team is live-delving so the
  // firing-rule highlight is visible (the player can still collapse it). The casual player never has to open it.
  const isDelving = !!view?.run && view.run.team === activeTeam
  useEffect(() => {
    if (isDelving) setOpen(true)
  }, [isDelving])
  const t = view?.exp_teams[activeTeam]
  if (!view || !t) return null
  const gambits = t.orders.gambits ?? []
  const ruleCount = gambits.reduce((n, slot) => n + (slot?.filter((r) => r.on).length ?? 0), 0)
  // v6 progression: the editor only offers Workshop-UNLOCKED options; deeper tactics unlock progressively.
  const unlockedActs = view.gambit_acts ?? GACT_KEYS.map((_, i) => i)
  const unlockedConds = view.gambit_conds ?? GCOND_KEYS.map((_, i) => i)
  const moreToUnlock = unlockedActs.length < GACT_KEYS.length || unlockedConds.length < GCOND_KEYS.length
  const summaryCopy = ruleCount > 0 ? `● ${ruleCount}` : tr(view.gambit_auto ? 'exp.tactics.summaryAuto' : 'exp.tactics.summaryInstinct')
  return (
    <div style={OX.panel}>
      <button style={OX.head} onClick={() => setOpen(!open)} hidden={embedded}>
        <span style={OX.title}>🜂 {tr('exp.tactics.title')}</span>
        <span style={OX.summary}>{summaryCopy}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {(embedded || open) && (
        <div style={OX.body}>
          <div style={OX.scopeHint}>{tr('exp.tactics.scope')}</div>
          {t.members.length === 0 ? (
            <span style={{ opacity: 0.5, fontSize: 12 }}>{tr('exp.partyHint')}</span>
          ) : (
            t.members.map((id, slot) => {
              const s = shapes[id]
              if (!s) return null
              const role = s.role
              const legal = (GROLE_ACTS[role] ?? [0, 1, 2, 9]).filter((a) => unlockedActs.includes(a))
              const condList = GCOND_KEYS.map((_, ci) => ci).filter((ci) => unlockedConds.includes(ci))
              const rules = gambits[slot] ?? []
              return (
                <div key={id} style={GX.slot}>
                  <div style={GX.slotHead}>
                    <span style={{ color: ROLE[role].c }}>{ROLE[role].icon}</span> <ShapeGlyph family={s.family} /> {s.nick}
                  </div>
                  {rules.length === 0 && <div style={GX.ghost}>{tr(view.gambit_auto ? 'exp.tactics.emptyAuto' : 'exp.tactics.emptyInstinct', { nick: s.nick })}</div>}
                  {rules.map((r, idx) => {
                    const opts = legal.includes(r.action) ? legal : [r.action, ...legal] // keep a now-locked value visible
                    const conds = condList.includes(r.cond) ? condList : [r.cond, ...condList]
                    const dragging = drag?.slot === slot && drag.from === idx
                    return (
                      <div
                        key={idx}
                        style={{ ...GX.row, opacity: r.on ? (dragging ? 0.4 : 1) : 0.45, ...(dragging ? GX.rowDragging : {}), ...(fire && fire.team === activeTeam && fire.slot === slot && fire.ruleIdx === idx ? GX.rowFiring : {}) }}
                        className={fire && fire.team === activeTeam && fire.slot === slot && fire.ruleIdx === idx ? 'exp-rule-firing' : undefined}
                        onDragOver={(e) => { if (drag && drag.slot === slot && drag.from !== idx) e.preventDefault() }}
                        onDrop={() => { if (drag && drag.slot === slot && drag.from !== idx) reorder(activeTeam, slot, drag.from, idx); setDrag(null) }}
                        onDragEnd={() => setDrag(null)}
                      >
                        <span style={GX.handle} draggable onDragStart={() => setDrag({ slot, from: idx })} title={tr('exp.tactics.drag')}>⠿</span>
                        <span style={GX.pri}>{idx + 1}</span>
                        <button style={GX.arrow} disabled={idx === 0} aria-label={tr('exp.tactics.moveUp')} onClick={() => move(activeTeam, slot, idx, true)}>↑</button>
                        <button style={GX.arrow} disabled={idx === rules.length - 1} aria-label={tr('exp.tactics.moveDown')} onClick={() => move(activeTeam, slot, idx, false)}>↓</button>
                        <button style={GX.toggle} onClick={() => toggle(activeTeam, slot, idx)} title={r.on ? 'on' : 'off'}>{r.on ? '◉' : '◎'}</button>
                        <span style={GX.kw}>{tr('exp.tactics.when')}</span>
                        <select style={GX.sel} value={r.cond} onChange={(e) => setRule(activeTeam, slot, idx, +e.target.value, r.action)}>
                          {conds.map((ci) => <option key={ci} value={ci}>{tr(`exp.gcond.${GCOND_KEYS[ci]}`)}{condList.includes(ci) ? '' : ' 🔒'}</option>)}
                        </select>
                        <span style={GX.then}>→</span>
                        <select style={GX.sel} value={r.action} onChange={(e) => setRule(activeTeam, slot, idx, r.cond, +e.target.value)}>
                          {opts.map((ai) => <option key={ai} value={ai}>{tr(`exp.gact.${GACT_KEYS[ai]}`)}{legal.includes(ai) ? '' : ' 🔒'}</option>)}
                        </select>
                        <button style={GX.del} onClick={() => remove(activeTeam, slot, idx)} title="remove">×</button>
                      </div>
                    )
                  })}
                  {rules.length > 0 && <div style={GX.priHint}>{tr('exp.tactics.priorityHint')}</div>}
                  <div style={{ ...GX.otherwise, ...(fire && fire.team === activeTeam && fire.slot === slot && fire.ruleIdx === -1 ? GX.otherwiseFiring : {}) }} className={fire && fire.team === activeTeam && fire.slot === slot && fire.ruleIdx === -1 ? 'exp-rule-firing' : undefined}>{tr('exp.tactics.otherwise')}</div>
                  <div style={GX.slotActions}>
                    {rules.length < 8 && <button style={GX.addBtn} onClick={() => add(activeTeam, slot)}>{tr('exp.tactics.addRule')}</button>}
                    {view.gambit_auto && <button style={GX.resetBtn} onClick={() => auto(activeTeam, slot)} title={tr('exp.tactics.autoHint')}>✨ {tr('exp.tactics.auto')}</button>}
                    {rules.length > 0 && <button style={GX.resetBtn} onClick={() => reset(activeTeam, slot)}>{tr('exp.tactics.reset')}</button>}
                  </div>
                </div>
              )
            })
          )}
          {moreToUnlock && <div style={GX.moreLocked}>{tr('exp.tactics.moreLocked')}</div>}
        </div>
      )}
    </div>
  )
}

// ── provisions + relics Echoes shop for the active team ──
function ProvisionsPanel({ activeTeam, embedded }: { activeTeam: number; embedded?: boolean }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const exp = useGame((s) => s.expContent)
  const buyProvision = useGame((s) => s.buyProvision)
  const loadProvision = useGame((s) => s.loadProvision)
  const clearProvisions = useGame((s) => s.clearProvisions)
  const buyRelic = useGame((s) => s.buyRelic)
  const equipRelic = useGame((s) => s.equipRelic)
  const unequipRelic = useGame((s) => s.unequipRelic)
  const [open, setOpen] = useState(false)
  if (!view || !exp) return null
  const t = view.exp_teams[activeTeam]
  const echoes = Math.floor(view.echoes)
  const stagedN = t?.provisions.length ?? 0
  return (
    <div style={OX.panel}>
      <button style={OX.head} onClick={() => setOpen(!open)} hidden={embedded}>
        <span style={OX.title}>🧪 {tr('prov.title')}</span>
        <span style={OX.summary}>{tr('prov.staged', { n: stagedN })} · {tr('relic.equippedN', { n: t?.relics.length ?? 0 })}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {(embedded || open) && (
        <div style={OX.body}>
          <div style={OX.scopeHint}>{tr('exp.prov.scope')}</div>
          <div style={OX.subTitle}>{tr('prov.provisions')} <span style={{ opacity: 0.5, fontWeight: 400 }}>· {tr('prov.hint')}</span></div>
          <div style={OX.shopGrid}>
            {exp.provisions.map((p, id) => {
              const owned = view.prov_inv[id] ?? 0
              const staged = t?.provisions.filter((x) => x === id).length ?? 0
              const afford = echoes >= p.cost
              const canStage = owned > staged && stagedN < 3
              return (
                <div key={p.key} style={OX.card}>
                  <span style={OX.cardName}>{tr(`prov.${p.key}.name`)}{staged > 0 && <span style={{ color: GOLD }}> ×{staged}</span>}</span>
                  <span style={OX.cardDesc}>{tr(`prov.${p.key}.desc`)}</span>
                  <div style={OX.cardRow}>
                    <button style={{ ...OX.buyBtn, opacity: afford ? 1 : 0.4 }} disabled={!afford} onClick={() => buyProvision(id)}>{p.cost} ✶</button>
                    <span style={OX.owned}>×{owned}</span>
                    <button style={{ ...OX.loadBtn, opacity: canStage ? 1 : 0.4 }} disabled={!canStage} onClick={() => loadProvision(activeTeam, id)}>＋ {tr('prov.stage')}</button>
                  </div>
                </div>
              )
            })}
          </div>
          {stagedN > 0 && <button style={OX.clearBtn} onClick={() => clearProvisions(activeTeam)}>✕ {tr('prov.clear')}</button>}
          <div style={OX.subTitle}>{tr('relic.title')} <span style={{ opacity: 0.5, fontWeight: 400 }}>· {tr('relic.hint')}</span></div>
          <div style={OX.shopGrid}>
            {exp.relics.map((r, id) => {
              const owned = view.exp_relics_owned[id]
              const equipped = t?.relics.includes(id) ?? false
              const afford = echoes >= r.cost
              const slotsFull = (t?.relics.length ?? 0) >= r.slots
              return (
                <div key={r.key} style={{ ...OX.card, ...(equipped ? { borderColor: ECHO } : {}) }}>
                  <span style={OX.cardName}>{tr(`relic.${r.key}.name`)}</span>
                  <span style={OX.cardDesc}>{tr(`relic.${r.key}.desc`)}</span>
                  <div style={OX.cardRow}>
                    {!owned ? (
                      <button style={{ ...OX.buyBtn, opacity: afford ? 1 : 0.4 }} disabled={!afford} onClick={() => buyRelic(id)}>{r.cost} ✶</button>
                    ) : equipped ? (
                      <button style={OX.equippedBtn} onClick={() => unequipRelic(activeTeam, id)}>✓ {tr('relic.equipped')}</button>
                    ) : (
                      <button style={{ ...OX.loadBtn, opacity: slotsFull ? 0.4 : 1 }} disabled={slotsFull} onClick={() => equipRelic(activeTeam, id)}>{tr('relic.equip')}</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── expedition record (lifetime counters + recent runs) ──
function RecordPanel({ embedded }: { embedded?: boolean }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const exp = useGame((s) => s.expContent)
  const shapes = useGame((s) => s.shapes)
  const [open, setOpen] = useState(false)
  if (!view || !exp) return null
  return (
    <div style={OX.panel}>
      <button style={OX.head} onClick={() => setOpen(!open)} hidden={embedded}>
        <span style={OX.title}>📖 {tr('exp.record')}</span>
        <span style={OX.summary}>{tr('exp.clearsN', { n: view.exp_clears_total })} · {tr('exp.bossesN', { n: view.exp_bosses_freed })}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {(embedded || open) && (
        <div style={OX.body}>
          <div style={OX.statsRow}>
            <Stat n={view.exp_clears_total} l={tr('exp.clears')} />
            <Stat n={view.exp_bosses_freed} l={tr('exp.bossesFreed')} />
            <Stat n={Math.floor(view.exp_echoes_farmed)} l={tr('exp.echoesFarmed')} c={ECHO} />
            <Stat n={Math.floor(view.exp_flux_farmed)} l={tr('exp.fluxFarmed')} c={GOLD} />
          </div>
          <div style={OX.subTitle}>{tr('exp.recentRuns')}</div>
          {view.exp_runs.length === 0 && <span style={{ opacity: 0.5, fontSize: 12 }}>{tr('exp.noRuns')}</span>}
          {view.exp_runs.map((r, i) => (
            <div key={i} style={OX.runRow}>
              <span style={{ fontWeight: 600 }}>{r.kind === 1 ? '◆' : '✓'} {exp.quests[r.quest]?.nick ?? '?'}</span>
              <span style={{ opacity: 0.7, fontSize: 11 }}>{tr('exp.teamN', { n: r.team + 1 })} · {tr('exp.inRounds', { n: r.rounds })} · {r.survivors}/{r.party_size}</span>
              <span style={{ color: ECHO, fontSize: 12 }}>+{r.echoes.toLocaleString()} ✶</span>
              {r.recruit_id >= 0 && <span style={{ color: '#ff8fb0', fontSize: 12 }}>★ {shapes[r.recruit_id]?.nick}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const OX: Record<string, CSSProperties> = {
  panel: { background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, overflow: 'hidden' },
  head: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  title: { fontSize: 15, fontWeight: 700 },
  summary: { flex: 1, fontSize: 12, opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  caret: { opacity: 0.6 },
  body: { padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  scopeHint: { fontSize: 12, opacity: 0.6, lineHeight: 1.4, fontStyle: 'italic' },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' },
  rowLabel: { fontSize: 12, opacity: 0.7, width: 90, paddingTop: 5 },
  segs: { display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 },
  seg: { padding: '5px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  segSmall: { padding: '3px 8px', fontSize: 11 },
  segOn: { borderColor: 'var(--c-accent-gold, #ffcf6b)', background: 'rgba(255,207,107,0.16)', color: 'var(--c-accent-gold, #ffcf6b)', fontWeight: 700 },
  stanceShape: { display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' },
  stanceNick: { fontSize: 12, fontWeight: 600 },
  subTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6, fontWeight: 700, marginTop: 4 },
  shopGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 },
  card: { display: 'flex', flexDirection: 'column', gap: 4, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' },
  cardName: { fontSize: 13, fontWeight: 700 },
  cardDesc: { fontSize: 11, opacity: 0.7, lineHeight: 1.3, minHeight: 28 },
  cardRow: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 },
  buyBtn: { padding: '4px 10px', borderRadius: 7, border: 'none', background: ECHO, color: '#160f2a', fontWeight: 700, cursor: 'pointer', fontSize: 12 },
  owned: { fontSize: 11, opacity: 0.7 },
  loadBtn: { marginLeft: 'auto', padding: '4px 9px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontSize: 11 },
  equippedBtn: { marginLeft: 'auto', padding: '4px 9px', borderRadius: 7, border: `1px solid ${ECHO}`, background: 'rgba(155,140,255,0.18)', color: ECHO, cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  clearBtn: { alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 11, opacity: 0.8 },
  statsRow: { display: 'flex', gap: 18, flexWrap: 'wrap' },
  stat: { display: 'flex', flexDirection: 'column' },
  statLbl: { fontSize: 11, opacity: 0.72, textTransform: 'uppercase', letterSpacing: 0.4 },
  runRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', fontSize: 13 },
}

// gambit editor styles
const GX: Record<string, CSSProperties> = {
  slot: { display: 'flex', flexDirection: 'column', gap: 5, padding: 9, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' },
  slotHead: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  ghost: { fontSize: 12, opacity: 0.5, fontStyle: 'italic', padding: '2px 0' },
  row: { display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 },
  arrow: { width: 22, height: 24, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'inherit', cursor: 'pointer', padding: 0 },
  toggle: { width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--c-accent-teal, #5fe0c6)', cursor: 'pointer', fontSize: 14, padding: 0 },
  kw: { fontSize: 10, opacity: 0.5, letterSpacing: 0.5 },
  then: { opacity: 0.7, fontWeight: 700 },
  sel: { padding: '4px 6px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)', background: '#1b1430', color: 'inherit', fontSize: 12, cursor: 'pointer' },
  del: { width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--c-accent-coral, #ff9d6b)', cursor: 'pointer', fontSize: 15, padding: 0, marginLeft: 'auto' },
  otherwise: { fontSize: 11, opacity: 0.45, fontStyle: 'italic', paddingLeft: 4 },
  rowFiring: { background: 'rgba(155,140,255,0.20)', boxShadow: 'inset 0 0 0 1.5px rgba(201,184,255,0.85), 0 0 10px rgba(155,140,255,0.45)', borderRadius: 8 }, // the gambit rule firing in the live combat
  otherwiseFiring: { opacity: 1, color: '#d6c9ff', fontWeight: 700, fontStyle: 'normal', background: 'rgba(155,140,255,0.18)', borderRadius: 6, paddingLeft: 6 },
  pri: { minWidth: 14, textAlign: 'center', fontSize: 11, opacity: 0.4, fontVariantNumeric: 'tabular-nums' },
  priHint: { fontSize: 11, opacity: 0.45, fontStyle: 'italic', paddingLeft: 4 },
  handle: { cursor: 'grab', opacity: 0.45, fontSize: 14, padding: '0 2px', touchAction: 'none', userSelect: 'none' },
  rowDragging: { outline: '1px dashed rgba(155,140,255,0.7)', outlineOffset: 1 },
  moreLocked: { fontSize: 11, opacity: 0.5, fontStyle: 'italic', paddingLeft: 4, marginTop: 2 },
  slotActions: { display: 'flex', gap: 8, marginTop: 2 },
  addBtn: { padding: '4px 10px', borderRadius: 7, border: '1px dashed rgba(255,255,255,0.2)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  resetBtn: { padding: '4px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.7 },
}

// #3 elevation ladder — the page is surface-0; base panels float on it via a soft drop shadow (surface-1); the
// PRIMARY compose panel sits one step higher (lighter fill + accent edge + stronger shadow = surface-2) so it reads
// as the anchor. Nested cards/slots keep NO shadow → they read as recessed *inside* their panel, completing the depth.
const ELEV_1 = '0 2px 10px rgba(0,0,0,0.32)'
const ELEV_2 = '0 4px 20px rgba(0,0,0,0.46)'
const panelBg = 'rgba(255,255,255,0.035)' // surface-1
const panelBgFocal = 'rgba(255,255,255,0.062)' // surface-2 (the compose anchor)
const border = '1px solid rgba(255,255,255,0.1)'
const X: Record<string, CSSProperties> = {
  decisionOverlay: { position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', paddingBottom: '14vh', pointerEvents: 'none', zIndex: 40 },
  decisionCard: { pointerEvents: 'auto', background: 'rgba(20,16,32,0.93)', border: '1px solid rgba(255,200,90,0.5)', borderRadius: 14, padding: '12px 16px', width: 'min(92vw, 420px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' },
  decisionTitle: { fontSize: 15, fontWeight: 800, color: '#ffe1a0', textAlign: 'center', marginBottom: 3 },
  decisionFlavor: { fontSize: 11.5, fontStyle: 'italic', color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 9, lineHeight: 1.35 },
  decisionBarTrack: { height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginBottom: 10 },
  decisionBarFill: { height: '100%', width: '100%', borderRadius: 3 },
  decisionRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  decisionSafe: { flex: 1, minWidth: 92, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 8px', borderRadius: 10, border: '1px solid rgba(120,200,255,0.6)', background: 'rgba(60,110,160,0.38)', color: '#dff0ff', cursor: 'pointer', boxShadow: '0 0 10px rgba(120,200,255,0.18)' },
  decisionGamble: { flex: 1, minWidth: 92, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 8px', borderRadius: 10, border: '1px solid rgba(255,180,80,0.5)', background: 'rgba(150,90,40,0.32)', color: '#ffe7c0', cursor: 'pointer' },
  decisionOptName: { fontSize: 12.5, fontWeight: 700 },
  decisionOptEff: { fontSize: 11, fontWeight: 600, opacity: 0.92, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  decisionHint: { fontSize: 10.5, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 8, fontVariantNumeric: 'tabular-nums' },
  reportToast: { position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 45, background: 'rgba(20,16,32,0.94)', border: '1px solid rgba(127,230,160,0.4)', borderRadius: 12, padding: '9px 20px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 6px 24px rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', minWidth: 220 },
  reportBanner: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  reportLine: { fontSize: 11.5, color: 'rgba(255,255,255,0.82)', fontVariantNumeric: 'tabular-nums' },
  reportFlavor: { fontSize: 11, color: 'rgba(255,255,255,0.62)', fontStyle: 'italic', marginTop: 5, maxWidth: 300, lineHeight: 1.35 },
  recruitVoice: { fontSize: 12, color: '#ffd0e0', fontStyle: 'italic', marginTop: 6, maxWidth: 340, lineHeight: 1.4, textShadow: '0 0 10px rgba(255,143,176,0.3)' },
  deeperBadge: { display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, color: '#c9a8ff', background: 'rgba(140,90,200,0.18)', border: '1px solid rgba(160,110,220,0.4)', borderRadius: 8, padding: '2px 9px', cursor: 'help' },
  mobileTabs: { position: 'sticky', top: 0, zIndex: 20, display: 'flex', gap: 6, padding: '6px 0 8px', background: 'linear-gradient(rgba(12,10,20,0.96), rgba(12,10,20,0.82))' },
  mobileTab: { flex: 1, minHeight: 44, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }, // ≥44px touch target (#9)
  mobileTabOn: { background: 'rgba(155,140,255,0.22)', border: '1px solid rgba(155,140,255,0.55)', color: '#fff' },
  root: { position: 'relative', zIndex: 0, isolation: 'isolate', padding: '16px 18px 80px', maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 'var(--fs-h2, 26px)' },
  subtitle: { margin: '4px 0 0', opacity: 0.7, fontSize: 'var(--fs-caption, 13px)', maxWidth: 520 },
  headStats: { display: 'flex', gap: 16, alignItems: 'center' },
  echoStat: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  statLbl: { fontSize: 11, opacity: 0.72, textTransform: 'uppercase', letterSpacing: 0.5 },
  autoBtn: { padding: '8px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontWeight: 700, alignSelf: 'center' }, // ≥44px touch target (#9)
  autoOn: { borderColor: ECHO, background: 'rgba(155,140,255,0.2)', color: ECHO, boxShadow: '0 0 12px rgba(155,140,255,0.3)' },
  runBanner: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 12, border: `1px solid ${ECHO}`, background: 'linear-gradient(90deg, rgba(155,140,255,0.14), rgba(155,140,255,0.05))', flexWrap: 'wrap' },
  runStatus: { fontWeight: 700, fontSize: 14, color: ECHO, textShadow: '0 1px 4px rgba(0,0,0,0.7)' },
  // event-node flavor card (shown over the scene when the party is at a non-combat event room)
  eventCard: { flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 3 },
  eventName: { fontWeight: 800, fontSize: 15, color: GOLD, letterSpacing: 0.2, textShadow: '0 1px 4px rgba(0,0,0,0.7)' },
  eventFlavor: { fontSize: 12.5, fontStyle: 'italic', color: 'rgba(255,255,255,0.82)', maxWidth: 560, lineHeight: 1.4, textShadow: '0 1px 3px rgba(0,0,0,0.65)' },
  delveRate: { display: 'inline-flex', gap: 8, fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 7, background: 'rgba(0,0,0,0.28)', cursor: 'help' },
  modeTabs: { display: 'flex', gap: 6, alignSelf: 'center' },
  modeTab: { padding: '6px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  modeTabOn: { border: `1px solid ${ECHO}`, background: 'rgba(155,140,255,0.2)', color: ECHO, boxShadow: '0 0 12px rgba(155,140,255,0.25)' },
  sceneWrap: { position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#0c0a16' },
  mapScroll: { maxHeight: 'min(30vh, 280px)', overflow: 'auto', borderRadius: 10 }, // compact — the map sits under the team section on the left
  sceneHud: { position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', flexWrap: 'wrap', background: 'linear-gradient(0deg, rgba(12,10,22,0.85), transparent)', pointerEvents: 'auto' },
  runBarWrap: { flex: 1, minWidth: 120, height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  runBar: { height: '100%', background: ECHO, borderRadius: 6, transition: 'width 0.5s ease' },
  delveTrack: { flex: 1, minWidth: 120, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  delveRoom: { fontSize: 15, opacity: 0.85, filter: 'grayscale(0.3)' },
  delveRoomCur: { opacity: 1, filter: 'none', textShadow: `0 0 8px ${ECHO}` }, // transform owned by the .exp-room-cur keyframe (J4)
  delveRoomFight: { cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', lineHeight: 1 },
  delveDot: { fontSize: 15, opacity: 0.3 },
  runEta: { fontSize: 13, opacity: 0.8, fontVariantNumeric: 'tabular-nums' },
  sendBtn: { padding: '11px 20px', minHeight: 44, borderRadius: 10, border: 'none', background: ECHO, color: '#160f2a', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
  sendBtnBlocked: { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', cursor: 'default', border: '1px dashed rgba(255,255,255,0.2)' },
  teamsRail: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  teamTab: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', padding: '8px 12px', borderRadius: 10, border, background: 'rgba(255,255,255,0.04)', color: 'inherit', cursor: 'pointer', minWidth: 96 },
  teamTabOn: { borderColor: ECHO, background: 'rgba(155,140,255,0.16)', boxShadow: '0 0 10px rgba(155,140,255,0.22)' },
  teamTabName: { fontSize: 12, fontWeight: 700 },
  teamTabGlyphs: { display: 'flex', gap: 3, fontSize: 15, flexWrap: 'wrap', maxWidth: 92, lineHeight: 1 },
  teamTabFarm: { fontSize: 10, color: ECHO },
  teamAdd: { padding: '8px 12px', borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.25)', background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontWeight: 600 },
  panel: { background: panelBg, border, borderRadius: 14, padding: 14, boxShadow: ELEV_1 }, // surface-1: floats above the page
  panelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  panelTitle: { margin: 0, fontSize: 'var(--fs-h3, 18px)' },
  powerTag: { fontSize: 13, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 8 },
  removeTeamBtn: { background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.5, fontSize: 13 },
  teamSummary: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '2px 0 8px', padding: '5px 9px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', fontSize: 12, fontWeight: 600 },
  tsGroup: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'help', whiteSpace: 'nowrap' },
  tsEl: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  partyRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  emptySlot: { width: 96, height: 136, borderRadius: 12, border: '1.5px dashed rgba(255,255,255,0.25)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 30, cursor: 'pointer' },
  memberCard: { position: 'relative', width: 96, height: 136, borderRadius: 12, border, background: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4 },
  memberRemove: { position: 'absolute', top: 4, right: 5, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, lineHeight: 1 },
  elDot: { position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderRadius: 4 },
  memberGlyph: { fontSize: 28 },
  memberNick: { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 88 },
  memberMeta: { display: 'flex', gap: 6, fontSize: 12 },
  memberPow: { fontSize: 12, color: GOLD, fontWeight: 600 },
  lvlBarWrap: { width: '82%', height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 },
  lvlBar: { height: '100%', borderRadius: 2, background: ECHO, transition: 'width 0.4s' },
  statRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 6px', justifyItems: 'start', width: '82%', fontSize: 9.5, color: 'rgba(255,255,255,0.82)', lineHeight: 1.3, marginTop: 2 },
  statChip: { whiteSpace: 'nowrap', cursor: 'help' },
  spdBarWrap: { width: '82%', height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 },
  spdBar: { height: '100%', borderRadius: 2, background: '#7fd4ff', transition: 'width 0.4s' },
  skillBtn: { marginTop: 3, padding: '2px 7px', borderRadius: 7, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  skillBtnGlow: { borderColor: GOLD, color: GOLD, boxShadow: '0 0 8px rgba(255,207,107,0.4)' },
  hint: { opacity: 0.6, fontSize: 13, margin: '8px 2px 0' },
  closeBtn: { background: 'transparent', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer', opacity: 0.7, lineHeight: 1 },
  search: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border, background: 'rgba(0,0,0,0.25)', color: 'inherit', marginBottom: 10 },
  rosterGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 240, overflowY: 'auto' },
  rosterChip: { position: 'relative', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 9, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer' },
  rosterNick: { fontSize: 13, fontWeight: 600 },
  rosterPow: { fontSize: 12, color: GOLD },
  farmGrid: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  farmCard: { flex: '1 1 180px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 10, border: `1px solid ${ECHO}`, background: 'rgba(155,140,255,0.08)' },
  farmTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  farmNick: { fontWeight: 700, fontSize: 13, color: ECHO },
  farmParty: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  farmGlyph: { fontSize: 18 },
  watchBtn: { marginTop: 2, padding: '5px 8px', borderRadius: 8, border, background: 'rgba(255,255,255,0.06)', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 12 },
  chapterLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.55, margin: '4px 0 8px' },
  questGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 },
  questCard: { display: 'flex', flexDirection: 'column', gap: 7, padding: 12, borderRadius: 12, border, background: 'rgba(255,255,255,0.04)' },
  questStationed: { border: `1.5px solid ${ECHO}`, boxShadow: `0 0 14px rgba(155,140,255,0.25)` },
  questTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  questNick: { fontWeight: 700, fontSize: 14 },
  tierTag: { fontSize: 11, opacity: 0.6, border, borderRadius: 6, padding: '1px 6px' },
  enemyRow: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  enemyChip: { fontSize: 11, opacity: 0.8, background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '2px 6px' },
  bossChip: { color: '#ff9a6b', background: 'rgba(255,120,80,0.12)' },
  recruitHint: { fontSize: 12, color: '#ff8fb0' },
  powBarWrap: { position: 'relative', height: 14, borderRadius: 7, background: 'rgba(0,0,0,0.3)', overflow: 'hidden' },
  powBar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7, transition: 'width 0.4s' },
  powBarTxt: { position: 'absolute', right: 6, top: 0, fontSize: 10, lineHeight: '14px', opacity: 0.9 },
  fluxEst: { fontSize: 11, color: GOLD, opacity: 0.9 },
  questBtns: { display: 'flex', gap: 8, marginTop: 2 },
  delveBtn: { flex: 1, padding: '8px 10px', borderRadius: 9, border: 'none', background: GOLD, color: '#1a1410', fontWeight: 700, cursor: 'pointer' },
  unstationBtn: { padding: '8px 10px', borderRadius: 9, border: `1px solid ${ECHO}`, background: 'rgba(155,140,255,0.18)', color: ECHO, fontWeight: 600, cursor: 'pointer' },
  lockedTag: { fontSize: 12, opacity: 0.6, padding: '8px 0' },
  stationMenu: { position: 'absolute', top: '100%', left: 8, right: 8, marginTop: 6, zIndex: 10, padding: 8, borderRadius: 10, background: 'rgba(20,16,34,0.98)', border: `1px solid ${ECHO}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 6 },
  stationMenuHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, opacity: 0.8 },
  stationMenuRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  stationMenuGlyphs: { display: 'flex', gap: 3, fontSize: 15 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(8,6,16,0.82)', backdropFilter: 'blur(6px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  battleBox: { width: 'min(720px, 96vw)', maxHeight: '94vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 16px', borderRadius: 18, background: 'rgba(20,16,34,0.96)', border: '1px solid rgba(155,140,255,0.3)', boxShadow: '0 20px 70px rgba(0,0,0,0.6)' },
  foeBars: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  allyBars: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  barCard: { position: 'relative', width: 104, padding: '5px 7px', borderRadius: 8, border, background: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 3, transition: 'opacity 0.3s' },
  barNick: { fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hpBarWrap: { width: '100%', height: 7, borderRadius: 4, background: 'rgba(0,0,0,0.4)', overflow: 'hidden' },
  hpBar: { height: '100%', borderRadius: 4, transition: 'width 0.35s ease-out' },
  hpTxt: { fontSize: 10, opacity: 0.75 },
  floatNum: { position: 'absolute', top: -8, right: 6, fontSize: 18, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,0.7)', animation: 'expFloatUp 0.9s ease-out forwards', pointerEvents: 'none' },
  logPanel: { maxHeight: 96, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.25)', border, fontSize: 12, opacity: 0.9 },
  logLine: { lineHeight: 1.3 },
  logScroll: { display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 'min(46vh, 420px)', overflowY: 'auto', fontSize: 12, fontVariantNumeric: 'tabular-nums', lineHeight: 1.45, paddingRight: 4 },
  logRow: { padding: '1px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  logIdle: { fontSize: 12, opacity: 0.5, fontStyle: 'italic', padding: '8px 2px' },
  dungeonWrap: { display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 4px', overflowX: 'auto' },
  dungeonRoom: { position: 'absolute', width: 36, height: 36, borderRadius: '50%', border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, padding: 0, transition: 'box-shadow 0.2s' },
  dungeonLegend: { textAlign: 'center', fontSize: 12, opacity: 0.7, fontWeight: 600 },
  battleMid: { minHeight: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 },
  stageWrap: { position: 'relative' },
  tacticCut: { position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', padding: '4px 14px', borderRadius: 999, background: 'rgba(155,140,255,0.22)', border: '1px solid rgba(201,184,255,0.7)', color: '#e8e0ff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none', textShadow: '0 0 8px rgba(155,140,255,0.6)' },
  // live combat HUD overlay (inline LiveCombat) — compact HP bars + a DPS/HPS/time meter over the 3D stage
  hudTop: { position: 'absolute', top: 6, left: 6, right: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, pointerEvents: 'none' },
  ultFlash: { position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 14, background: 'radial-gradient(circle at 50% 58%, rgba(255,215,107,0.45), rgba(255,180,80,0.12) 42%, transparent 70%)', mixBlendMode: 'screen', zIndex: 4 },
  sparkBurst: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' },
  spark: { position: 'absolute', left: -2, top: -2, width: 4, height: 4, borderRadius: '50%' },
  lowHpVignette: { position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 14, background: 'radial-gradient(circle at 50% 50%, transparent 52%, rgba(255,60,60,0.26) 100%)', zIndex: 3 },
  hudCol: { display: 'flex', flexDirection: 'column', gap: 3, maxWidth: '36%' },
  hudBar: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 1, background: 'rgba(10,8,18,0.55)', borderRadius: 6, padding: '2px 6px', minWidth: 76 },
  hudNick: { fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hudHpWrap: { height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' },
  hudHp: { height: '100%', borderRadius: 2, transition: 'width 0.25s' },
  hudMeter: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, background: 'rgba(10,8,18,0.62)', borderRadius: 8, padding: '3px 9px', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  telegraph: { fontSize: 12, textAlign: 'center', opacity: 0.6, fontStyle: 'italic', minHeight: 16 },
  ticker: { fontSize: 15, textAlign: 'center', minHeight: 22, opacity: 0.95 },
  battleCtrls: { display: 'flex', gap: 10 },
  ctrlBtn: { padding: '6px 12px', borderRadius: 8, border, background: 'rgba(255,255,255,0.06)', color: 'inherit', cursor: 'pointer', fontWeight: 600 },
  resultBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  resultBanner: { fontSize: 26, fontWeight: 800, letterSpacing: 1 },
  resultBtns: { display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  skillBox: { width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: '18px 16px', borderRadius: 18, background: 'rgba(20,16,34,0.97)', border: '1px solid rgba(155,140,255,0.3)', boxShadow: '0 20px 70px rgba(0,0,0,0.6)' },
  skillPointsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  respecBtn: { padding: '5px 10px', borderRadius: 8, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  skillGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 },
  skillNode: { display: 'flex', flexDirection: 'column', gap: 3, padding: 10, borderRadius: 10, border, background: 'rgba(255,255,255,0.04)', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  skillNodeOn: { borderColor: ECHO, background: 'rgba(155,140,255,0.12)' },
  skillNodeName: { fontSize: 13, fontWeight: 700 },
  skillNodeEffect: { fontSize: 11, opacity: 0.75 },
  skillNodeDesc: { fontSize: 10.5, opacity: 0.6, lineHeight: 1.3, marginTop: 1 },
  skillNodeRank: { fontSize: 11, color: GOLD, fontWeight: 600 },
}
