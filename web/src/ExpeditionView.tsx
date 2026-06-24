// Expeditions — the opt-in idle RPG screen. Build MULTIPLE persistent teams from your collection, station them
// on quests to auto-clear (first win) then farm Echoes + Flux idle. "Watch" spectates a stationed team's
// deterministic battle (the CombatOverlay replays the Rust log over a 3D stage + a scrolling combat log). Shapes
// earn endless XP → levels → skill points spent in per-role trees. All numbers are Rust truth (the view);
// this file only renders + animates them. Echoes-bought perks live in the Workshop (see WorkshopView).
import { useState, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh, MeshPhysicalMaterial } from 'three'
import { getGeometry, OPEN_FAMILIES } from './three/geometry'
import { sceneGemMatProps } from './three/Gem'
import { useGame } from './game/store'
import type { ExpElement, UnitInfo, BattleResult, StationResult } from './game/store'
import { glyphOf } from './content/glyphs'
import { sfxHit, sfxHeal, sfxUlt, sfxFaint, sfxVictory, sfxDefeat } from './audio'
import { ExpeditionStage } from './three/ExpeditionStage'
import { ExpeditionMap } from './ExpeditionMap'
import { buildTimeline, hpAt, deadAt, type Timeline } from './three/dungeonWatch'
import { useT } from './i18n'

const ECHO = '#9b8cff'
const GOLD = 'var(--c-accent-gold, #ffcf6b)'
const FLUX = 'var(--c-accent-gold, #ffcf6b)'
const ELEMENT_C: Record<ExpElement, string> = { solid: '#7fb0ff', twisted: '#c08cff', woven: '#5fe0c6' }
const ELEMENT_HEX: Record<ExpElement, string> = { solid: '#7fb0ff', twisted: '#c08cff', woven: '#5fe0c6' }
const ROLE: Record<string, { icon: string; c: string }> = {
  tank: { icon: '🛡', c: '#7fb0ff' },
  dps: { icon: '⚔', c: '#ff8a6b' },
  support: { icon: '✚', c: '#5fe0c6' },
  control: { icon: '🌀', c: '#c08cff' },
}
const KNOT_FAMILIES = new Set(['trefoil', 'figure8_knot', 'torus_knot_2_5', 'borromean', 'seifert', 'hopf_link'])

function elementOf(family: string, orientable: boolean): ExpElement {
  if (!orientable) return 'twisted'
  if (KNOT_FAMILIES.has(family)) return 'woven'
  return 'solid'
}
// NOTE: the expedition ROLE is NOT derived here — it is the authoritative `s.role` from core (prime directive).
const ROLE_IDX: Record<string, number> = { tank: 0, dps: 1, support: 2, control: 3 }
// compact duration (run ETA): minutes under an hour, else hours with one decimal.
const fmtMinHr = (ms: number): string => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : `${(ms / 3_600_000).toFixed(1)}h`)

// Display mirror of the Rust SKILL_TREES (same order/values) — Rust owns the effect; this is labels only.
interface SkillNodeUI { key: string; max: number; req?: [number, number]; stat: number; farm: number }
const SKILL_TREES_UI: SkillNodeUI[][] = [
  [ // tank
    { key: 'bulwark', max: 5, stat: 6, farm: 0 }, { key: 'ward', max: 3, req: [0, 2], stat: 5, farm: 0 },
    { key: 'taunt_grip', max: 3, stat: 0, farm: 8 }, { key: 'anchor', max: 3, req: [2, 1], stat: 0, farm: 6 },
    { key: 'stonewall', max: 1, req: [0, 5], stat: 12, farm: 0 }, { key: 'aegis', max: 1, req: [1, 3], stat: 14, farm: 0 },
    { key: 'enduring', max: 5, stat: 4, farm: 0 },
  ],
  [ // dps
    { key: 'edge', max: 5, stat: 6, farm: 0 }, { key: 'precision', max: 3, req: [0, 2], stat: 5, farm: 0 },
    { key: 'hunter', max: 3, stat: 0, farm: 8 }, { key: 'momentum', max: 3, req: [2, 1], stat: 0, farm: 6 },
    { key: 'executioner', max: 1, req: [0, 5], stat: 12, farm: 0 }, { key: 'overkill', max: 1, req: [1, 3], stat: 14, farm: 0 },
    { key: 'relentless', max: 5, stat: 4, farm: 0 },
  ],
  [ // support
    { key: 'mend', max: 5, stat: 5, farm: 0 }, { key: 'grace', max: 3, req: [0, 2], stat: 4, farm: 0 },
    { key: 'wellspring', max: 3, stat: 0, farm: 10 }, { key: 'bounty', max: 3, req: [2, 1], stat: 0, farm: 7 },
    { key: 'sanctuary', max: 1, req: [0, 5], stat: 10, farm: 0 }, { key: 'cleanse_plus', max: 1, req: [1, 3], stat: 12, farm: 0 },
    { key: 'nurture', max: 5, stat: 4, farm: 0 },
  ],
  [ // control
    { key: 'pin', max: 5, stat: 6, farm: 0 }, { key: 'snare', max: 3, req: [0, 2], stat: 5, farm: 0 },
    { key: 'disrupt', max: 3, stat: 0, farm: 8 }, { key: 'entropy', max: 3, req: [2, 1], stat: 0, farm: 6 },
    { key: 'dominator', max: 1, req: [0, 5], stat: 12, farm: 0 }, { key: 'lockdown', max: 1, req: [1, 3], stat: 14, farm: 0 },
    { key: 'tactician', max: 5, stat: 4, farm: 0 },
  ],
]

function fmtRate(n: number): string {
  return Math.round(n).toLocaleString()
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
  const watch = useGame((s) => s.watch)
  const combat = useGame((s) => s.combat)
  const autoOn = useGame((s) => s.view?.exp_auto ?? true)
  const setAuto = useGame((s) => s.setAuto)
  const sendExpedition = useGame((s) => s.sendExpedition)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [skillFor, setSkillFor] = useState<number | null>(null) // shape id whose skill tree is open

  if (!view || !exp) return null
  const teams = view.exp_teams
  const activeT = Math.min(view.exp_active_team, teams.length - 1)
  const team = teams[activeT]?.members ?? []
  const partyFull = team.length >= view.exp_party_max
  const activeFarms = teams.filter((t) => t.station >= 0)

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

  return (
    <div style={X.root}>
      <ExpeditionStage paused={!!combat} />
      <div style={X.header}>
        <div>
          <h2 style={X.title}>{tr('exp.title')}</h2>
          <p style={X.subtitle}>{tr('exp.subtitle')}</p>
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

      {/* ── v6 Delve: send a party on a run, or watch the one in flight ── */}
      {(view.run || view.can_send_run) && (
        <div style={X.runBanner}>
          {view.run ? (
            <>
              <span style={X.runStatus}>⛏ {tr('exp.delving', { a: Math.min(view.run.current_room + 1, view.run.total_rooms), b: view.run.total_rooms })}</span>
              <div style={X.runBarWrap}>
                <div style={{ ...X.runBar, width: `${view.run.total_rooms > 0 ? Math.round((view.run.current_room / view.run.total_rooms) * 100) : 0}%` }} />
              </div>
              <span style={X.runEta}>≈ {fmtMinHr(view.run.total_ms)}</span>
            </>
          ) : (
            <>
              <span style={X.runStatus}>⛏ {tr('exp.sendHint')}</span>
              <button style={X.sendBtn} className="btn-primary" onClick={() => sendExpedition(activeT)}>{tr('exp.send')}</button>
            </>
          )}
        </div>
      )}

      {/* ── teams rail (multiple parties) ── */}
      <div style={X.teamsRail}>
        {teams.map((t, i) => (
          <button key={i} style={{ ...X.teamTab, ...(i === activeT ? X.teamTabOn : {}) }} onClick={() => setActiveTeam(i)}>
            <span style={X.teamTabName}>{tr('exp.teamN', { n: i + 1 })}</span>
            <span style={X.teamTabGlyphs}>
              {t.members.length === 0 ? <span style={{ opacity: 0.4 }}>—</span> : t.members.map((id) => <span key={id}>{glyphOf(shapes[id]?.family ?? '')}</span>)}
            </span>
            {t.station >= 0 && <span style={X.teamTabFarm}>✶ {questNick(t.station)}</span>}
          </button>
        ))}
        {teams.length < view.exp_max_teams && (
          <button style={X.teamAdd} onClick={addTeam} title={tr('exp.addTeam')}>＋ {tr('exp.team')}</button>
        )}
      </div>

      {/* ── party builder for the active team ── */}
      <div style={X.panel}>
        <div style={X.panelHead}>
          <h3 style={X.panelTitle}>{tr('exp.teamN', { n: activeT + 1 })}</h3>
          <span style={X.powerTag}>
            {tr('exp.power')}: <b style={{ color: GOLD }}>{(teams[activeT]?.power ?? 0).toLocaleString()}</b>
            {teams.length > 1 && teams[activeT]?.station < 0 && (
              <button style={X.removeTeamBtn} onClick={() => removeTeam(activeT)} title={tr('exp.removeTeam')}>🗑</button>
            )}
          </span>
        </div>
        {team.length > 0 && <PartyShowcase3D members={team} shapes={shapes} paused={!!combat} />}
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
            const span = 10 * (lvl + 1) + 45
            const frac = Math.max(0, Math.min(1, (span - (view.xp_to_next[id] ?? span)) / span))
            return (
              <div key={id} style={X.memberCard}>
                <span style={{ ...X.elDot, background: ELEMENT_C[el] }} />
                <button style={X.memberRemove} onClick={() => removeFromParty(id)} title={tr('exp.removeMember', { nick: s.nick })}>✕</button>
                <span style={X.memberGlyph}>{glyphOf(s.family)}</span>
                <span style={X.memberNick}>{s.nick}</span>
                <span style={X.memberMeta}>
                  <span style={{ color: ROLE[role].c }}>{ROLE[role].icon}</span>
                  <span style={{ color: GOLD }}>★{view.star_levels[id] ?? 0}</span>
                </span>
                <span style={X.memberPow}>{(view.exp_power[id] ?? 0).toLocaleString()}</span>
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
                  <span style={{ fontSize: 20 }}>{glyphOf(s.family)}</span>
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

      {/* ── active farms summary (stationed teams) ── */}
      {activeFarms.length > 0 && (
        <div style={X.panel}>
          <h3 style={X.panelTitle}>{tr('exp.farms', { n: activeFarms.length, max: view.exp_max_teams })}</h3>
          <div style={X.farmGrid}>
            {teams.map((t, ti) => t.station < 0 ? null : (
              <div key={ti} style={X.farmCard}>
                <div style={X.farmTop}>
                  <span style={X.farmNick}>✶ {questNick(t.station)}</span>
                  <button style={X.closeBtn} onClick={() => unstation(ti)} title={tr('exp.unstationTip')}>✕</button>
                </div>
                <div style={X.farmParty}>
                  <span style={{ opacity: 0.6, fontSize: 11, marginRight: 4 }}>{tr('exp.teamN', { n: ti + 1 })}</span>
                  {t.members.map((id) => <span key={id} title={shapes[id]?.nick} style={X.farmGlyph}>{glyphOf(shapes[id]?.family ?? '')}</span>)}
                </div>
                <span style={{ color: ECHO, fontWeight: 600, fontSize: 13 }}>+{fmtRate(t.echo_rate_per_hr)} ✶/hr</span>
                {t.flux_rate_per_hr > 0 && <span style={{ color: GOLD, fontWeight: 600, fontSize: 12 }}>+{fmtRate(t.flux_rate_per_hr)} ✦/hr</span>}
                <button style={X.watchBtn} onClick={() => watch(t.station)}>▶ {tr('exp.watch')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── journey map ── */}
      <div style={X.panel}>
        <div style={X.panelHead}>
          <h3 style={X.panelTitle}>{tr('exp.map')}</h3>
          <span style={X.mapLegend}>
            <span style={{ color: '#5fe0c6' }}>✓ {tr('exp.cleared')}</span>
            <span style={{ color: GOLD }}>● {tr('exp.ready')}</span>
            <span style={{ color: '#ff8a6b' }}>⚠ {tr('exp.risky')}</span>
            <span style={{ color: ECHO }}>✶ {tr('exp.farming')}</span>
            <span style={{ opacity: 0.6 }}>◆ {tr('exp.node.boss')}</span>
            <span style={{ opacity: 0.6 }}>✦ {tr('exp.node.elite')}</span>
            <span style={{ opacity: 0.5 }}>🔒 {tr('exp.node.locked')}</span>
          </span>
        </div>
        <ExpeditionMap activeTeam={activeT} />
      </div>

      {/* ── pre-battle orders + provisions/relics + record for the active team ── */}
      <OrdersPanel activeTeam={activeT} />
      <TacticsPanel activeTeam={activeT} />
      <ProvisionsPanel activeTeam={activeT} />
      <RecordPanel />

      {combat && <CombatOverlay battle={combat.battle} result={combat.result} quest={combat.quest} />}
      {skillFor != null && <SkillPanel id={skillFor} onClose={() => setSkillFor(null)} />}
    </div>
  )
}

// ── 3D combat stage: one Canvas, the combatant's REAL collected shape (getGeometry, cached + unit-normalized),
// on a cheap clearcoat-PBR material (sceneGemMatProps glass=false — never transmission for a crowd) ──
function CombatGem({ family, element, x, z, rank, toward, adv, dead, acting, telegraph, hitKey }: { family: string; element: ExpElement; x: number; z: number; rank: number; toward: [number, number] | null; adv: boolean; dead: boolean; acting: boolean; telegraph: boolean; hitKey: number }) {
  const ref = useRef<Mesh>(null)
  const mat = useRef<MeshPhysicalMaterial>(null)
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
      mat.current.emissiveIntensity = (acting ? 1.0 : telegraph ? 0.62 : base) + flash.current * (adv ? 1.4 : 0.9)
    }
  })
  const c = ELEMENT_HEX[element]
  const open = OPEN_FAMILIES.has(family)
  const geo = getGeometry(family) // cached, shared, unit-normalized — never disposed (gallery-shared)
  const props = sceneGemMatProps(c, rank, open, false)
  return (
    <mesh ref={ref} position={[x, 0, z]} geometry={geo} scale={0.5}>
      <meshPhysicalMaterial ref={mat} {...props} side={open ? THREE.DoubleSide : THREE.FrontSide} transparent opacity={1} />
    </mesh>
  )
}

function CombatStage3D({ units, dead, cur, nextActor, step }: { units: UnitInfo[]; dead: boolean[]; cur: { actor: number; target: number; adv: boolean } | null; nextActor: number; step: number }) {
  const allies = units.map((u, i) => ({ u, i })).filter((x) => !x.u.is_enemy)
  const foes = units.map((u, i) => ({ u, i })).filter((x) => x.u.is_enemy)
  const spread = (n: number, k: number) => (n <= 1 ? 0 : (k - (n - 1) / 2) * 1.5)
  // position of every combatant (unit index → [x, z]) — lets an acting shape lunge toward its actual target
  const posOf: Record<number, [number, number]> = {}
  allies.forEach(({ i }, k) => (posOf[i] = [spread(allies.length, k), 1.3]))
  foes.forEach(({ i }, k) => (posOf[i] = [spread(foes.length, k), -1.3]))
  const towardOf = (i: number): [number, number] | null => (cur?.actor === i && cur.target >= 0 ? posOf[cur.target] ?? null : null)
  return (
    <Canvas camera={{ position: [0, 1.6, 5.2], fov: 42 }} dpr={[1, 1.5]} style={{ width: '100%', height: 220 }}>
      <fog attach="fog" args={['#140e22', 8, 18]} />
      <hemisphereLight args={['#b9a7ff', '#160f2a', 0.5]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 5, 4]} intensity={60} color="#fff0d8" />
      <pointLight position={[-4, 2, 2]} intensity={30} color="#9b8cff" />
      {/* the floor the fight stands on — a fogged disc so the gems read as somewhere, not floating in void */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.62, -0.2]}>
        <circleGeometry args={[9, 56]} />
        <meshStandardMaterial color="#241a3a" roughness={0.92} metalness={0.12} />
      </mesh>
      {foes.map(({ u, i }, k) => (
        <CombatGem key={`f${i}`} family={u.family} element={u.element} rank={0} x={spread(foes.length, k)} z={-1.3} toward={towardOf(i)} adv={!!cur?.adv && cur.target === i} dead={dead[i]} acting={cur?.actor === i} telegraph={nextActor === i} hitKey={cur?.target === i ? step : 0} />
      ))}
      {allies.map(({ u, i }, k) => (
        <CombatGem key={`a${i}`} family={u.family} element={u.element} rank={2} x={spread(allies.length, k)} z={1.3} toward={towardOf(i)} adv={!!cur?.adv && cur.target === i} dead={dead[i]} acting={cur?.actor === i} telegraph={nextActor === i} hitKey={cur?.target === i ? step : 0} />
      ))}
    </Canvas>
  )
}

// ── 3D party showcase: one shared Canvas, a slowly-turning gem per member (the "party has 3D viz") ──
function ShowcaseGem({ family, element, x }: { family: string; element: ExpElement; x: number }) {
  const ref = useRef<Mesh>(null)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    m.rotation.y += dt * 0.6
    m.rotation.x += dt * 0.12
  })
  const c = ELEMENT_HEX[element]
  const geo =
    element === 'woven' ? <torusKnotGeometry args={[0.42, 0.15, 90, 14]} /> :
    element === 'twisted' ? <torusKnotGeometry args={[0.4, 0.14, 80, 10, 2, 3]} /> :
    family === 'torus' || family === 'genus2' ? <torusGeometry args={[0.42, 0.18, 18, 44]} /> :
    family === 'cube' ? <boxGeometry args={[0.66, 0.66, 0.66]} /> :
    <icosahedronGeometry args={[0.52, 0]} />
  return (
    <mesh ref={ref} position={[x, 0, 0]} scale={0.7}>
      {geo}
      <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.4} metalness={0.5} roughness={0.25} />
    </mesh>
  )
}
function PartyShowcase3D({ members, shapes, paused }: { members: number[]; shapes: { family: string; orientable: boolean }[]; paused?: boolean }) {
  if (members.length === 0) return null
  const spread = (k: number) => (members.length <= 1 ? 0 : (k - (members.length - 1) / 2) * 1.4)
  return (
    <Canvas frameloop={paused ? 'never' : 'always'} camera={{ position: [0, 0.4, 4], fov: 40 }} dpr={[1, 1.5]} style={{ width: '100%', height: 120 }}>
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 4, 4]} intensity={50} color="#fff0d8" />
      <pointLight position={[-3, 1, 2]} intensity={26} color="#9b8cff" />
      {members.map((id, k) => {
        const s = shapes[id]
        if (!s) return null
        return <ShowcaseGem key={id} family={s.family} element={elementOf(s.family, s.orientable)} x={spread(k)} />
      })}
    </Canvas>
  )
}

// ── the combat WATCH: a continuous-time rendering of the deterministic battle log (Phase 1 — timeline spine).
// The turn engine is the TRUTH; this plays its log over a single clock (fetched once, no WASM per frame). Faith-
// fulness (HP fold, dissolve-on-fainted, winner-read, verbatim numbers) lives in three/dungeonWatch.ts. ──
function CombatOverlay({ battle, result, quest }: { battle: BattleResult; result: StationResult | null; quest: number }) {
  const tr = useT()
  const dismiss = useGame((s) => s.dismissCombat)
  const shapes = useGame((s) => s.shapes)
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
        {float && <span key={beatIdx} style={{ ...X.floatNum, color: ti && ti.heal > 0 ? '#7fe6a0' : '#ffd1d1' }}>{float}</span>}
      </div>
    )
  }

  const recruitNick = result && result.recruited_id >= 0 ? shapes[result.recruited_id]?.nick : null
  const spectator = result == null

  return (
    <div style={X.overlay} onClick={finished ? dismiss : undefined}>
      <div style={X.battleBox} onClick={(e) => e.stopPropagation()}>
        <div style={X.foeBars}>{foes.map(renderBar)}</div>
        <CombatStage3D units={units} dead={dead} cur={cur} nextActor={nextActor} step={beatIdx} />
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

function exp_questNick(exp: { quests: { nick: string }[] } | null, qi: number): string {
  return exp?.quests[qi]?.nick ?? ''
}

// ── skill tree panel: per-role nodes, mirror of the Rust tree; Rust validates every spend ──
function SkillPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const spend = useGame((s) => s.spendSkillPoint)
  const respec = useGame((s) => s.respec)
  if (!view) return null
  const s = shapes[id]
  if (!s) return null
  const role = s.role
  const tree = SKILL_TREES_UI[ROLE_IDX[role]] ?? []
  const alloc = view.skill_alloc[id] ?? []
  const free = view.skill_points_free[id] ?? 0
  const lvl = view.shape_levels[id] ?? 0
  return (
    <div style={X.overlay} onClick={onClose}>
      <div style={X.skillBox} onClick={(e) => e.stopPropagation()}>
        <div style={X.panelHead}>
          <h3 style={X.panelTitle}>
            {glyphOf(s.family)} {s.nick} · {tr('exp.levelN', { n: lvl })} · <span style={{ color: ROLE[role].c }}>{ROLE[role].icon} {tr(`exp.role.${role}`)}</span>
          </h3>
          <button style={X.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={X.skillPointsRow}>
          <span style={{ color: free > 0 ? GOLD : 'inherit', fontWeight: 700 }}>{tr('exp.skillPoints', { n: free })}</span>
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
function OrdersPanel({ activeTeam }: { activeTeam: number }) {
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
      <button style={OX.head} onClick={() => setOpen(!open)}>
        <span style={OX.title}>⚑ {tr('exp.orders.title')}</span>
        <span style={OX.summary}>{FORM[o.formation]} · {tr(`exp.doctrine.${DOCTRINE_KEYS[o.doctrine]}`)} · {tr(`exp.focus.${focusKey}`)}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
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
                      <span style={OX.stanceNick}>{glyphOf(shapes[id]?.family ?? '')} {shapes[id]?.nick}</span>
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
function TacticsPanel({ activeTeam }: { activeTeam: number }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const setRule = useGame((s) => s.setGambitRule)
  const toggle = useGame((s) => s.toggleGambit)
  const move = useGame((s) => s.moveGambit)
  const add = useGame((s) => s.addGambit)
  const remove = useGame((s) => s.removeGambit)
  const reset = useGame((s) => s.resetGambits)
  const [open, setOpen] = useState(false)
  const t = view?.exp_teams[activeTeam]
  if (!view || !t) return null
  const gambits = t.orders.gambits ?? []
  const ruleCount = gambits.reduce((n, slot) => n + (slot?.filter((r) => r.on).length ?? 0), 0)
  return (
    <div style={OX.panel}>
      <button style={OX.head} onClick={() => setOpen(!open)}>
        <span style={OX.title}>🜂 {tr('exp.tactics.title')}</span>
        <span style={OX.summary}>{ruleCount > 0 ? `● ${ruleCount}` : tr('exp.tactics.summary')}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={OX.body}>
          <div style={OX.scopeHint}>{tr('exp.tactics.scope')}</div>
          {t.members.length === 0 ? (
            <span style={{ opacity: 0.5, fontSize: 12 }}>{tr('exp.partyHint')}</span>
          ) : (
            t.members.map((id, slot) => {
              const s = shapes[id]
              if (!s) return null
              const role = s.role
              const legal = GROLE_ACTS[role] ?? [0, 1, 2, 9]
              const rules = gambits[slot] ?? []
              return (
                <div key={id} style={GX.slot}>
                  <div style={GX.slotHead}>
                    <span style={{ color: ROLE[role].c }}>{ROLE[role].icon}</span> {glyphOf(s.family)} {s.nick}
                  </div>
                  {rules.length === 0 && <div style={GX.ghost}>{tr('exp.tactics.empty', { nick: s.nick })}</div>}
                  {rules.map((r, idx) => {
                    const opts = legal.includes(r.action) ? legal : [r.action, ...legal]
                    return (
                      <div key={idx} style={{ ...GX.row, opacity: r.on ? 1 : 0.45 }}>
                        <button style={GX.arrow} disabled={idx === 0} onClick={() => move(activeTeam, slot, idx, true)}>↑</button>
                        <button style={GX.arrow} disabled={idx === rules.length - 1} onClick={() => move(activeTeam, slot, idx, false)}>↓</button>
                        <button style={GX.toggle} onClick={() => toggle(activeTeam, slot, idx)} title={r.on ? 'on' : 'off'}>{r.on ? '◉' : '◎'}</button>
                        <span style={GX.kw}>{tr('exp.tactics.when')}</span>
                        <select style={GX.sel} value={r.cond} onChange={(e) => setRule(activeTeam, slot, idx, +e.target.value, r.action)}>
                          {GCOND_KEYS.map((c, ci) => <option key={c} value={ci}>{tr(`exp.gcond.${c}`)}</option>)}
                        </select>
                        <span style={GX.then}>→</span>
                        <select style={GX.sel} value={r.action} onChange={(e) => setRule(activeTeam, slot, idx, r.cond, +e.target.value)}>
                          {opts.map((ai) => <option key={ai} value={ai}>{tr(`exp.gact.${GACT_KEYS[ai]}`)}</option>)}
                        </select>
                        <button style={GX.del} onClick={() => remove(activeTeam, slot, idx)} title="remove">×</button>
                      </div>
                    )
                  })}
                  <div style={GX.otherwise}>{tr('exp.tactics.otherwise')}</div>
                  <div style={GX.slotActions}>
                    {rules.length < 8 && <button style={GX.addBtn} onClick={() => add(activeTeam, slot)}>{tr('exp.tactics.addRule')}</button>}
                    {rules.length > 0 && <button style={GX.resetBtn} onClick={() => reset(activeTeam, slot)}>{tr('exp.tactics.reset')}</button>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── provisions + relics Echoes shop for the active team ──
function ProvisionsPanel({ activeTeam }: { activeTeam: number }) {
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
      <button style={OX.head} onClick={() => setOpen(!open)}>
        <span style={OX.title}>🧪 {tr('prov.title')}</span>
        <span style={OX.summary}>{tr('prov.staged', { n: stagedN })} · {tr('relic.equippedN', { n: t?.relics.length ?? 0 })}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
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
function RecordPanel() {
  const tr = useT()
  const view = useGame((s) => s.view)
  const exp = useGame((s) => s.expContent)
  const shapes = useGame((s) => s.shapes)
  const [open, setOpen] = useState(false)
  if (!view || !exp) return null
  return (
    <div style={OX.panel}>
      <button style={OX.head} onClick={() => setOpen(!open)}>
        <span style={OX.title}>📖 {tr('exp.record')}</span>
        <span style={OX.summary}>{tr('exp.clearsN', { n: view.exp_clears_total })} · {tr('exp.bossesN', { n: view.exp_bosses_freed })}</span>
        <span style={OX.caret}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
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
  statLbl: { fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 },
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
  slotActions: { display: 'flex', gap: 8, marginTop: 2 },
  addBtn: { padding: '4px 10px', borderRadius: 7, border: '1px dashed rgba(255,255,255,0.2)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  resetBtn: { padding: '4px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.7 },
}

const panelBg = 'rgba(255,255,255,0.035)'
const border = '1px solid rgba(255,255,255,0.1)'
const X: Record<string, CSSProperties> = {
  root: { position: 'relative', zIndex: 0, isolation: 'isolate', padding: '16px 18px 80px', maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 'var(--fs-h2, 26px)' },
  subtitle: { margin: '4px 0 0', opacity: 0.7, fontSize: 'var(--fs-caption, 13px)', maxWidth: 520 },
  headStats: { display: 'flex', gap: 16, alignItems: 'center' },
  echoStat: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  statLbl: { fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 },
  autoBtn: { padding: '8px 14px', borderRadius: 10, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontWeight: 700, alignSelf: 'center' },
  autoOn: { borderColor: ECHO, background: 'rgba(155,140,255,0.2)', color: ECHO, boxShadow: '0 0 12px rgba(155,140,255,0.3)' },
  runBanner: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 12, border: `1px solid ${ECHO}`, background: 'linear-gradient(90deg, rgba(155,140,255,0.14), rgba(155,140,255,0.05))', flexWrap: 'wrap' },
  runStatus: { fontWeight: 700, fontSize: 14, color: ECHO },
  runBarWrap: { flex: 1, minWidth: 120, height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  runBar: { height: '100%', background: ECHO, borderRadius: 6, transition: 'width 0.5s ease' },
  runEta: { fontSize: 13, opacity: 0.8, fontVariantNumeric: 'tabular-nums' },
  sendBtn: { padding: '8px 18px', borderRadius: 10, border: 'none', background: ECHO, color: '#160f2a', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
  teamsRail: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  teamTab: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', padding: '8px 12px', borderRadius: 10, border, background: 'rgba(255,255,255,0.04)', color: 'inherit', cursor: 'pointer', minWidth: 96 },
  teamTabOn: { borderColor: ECHO, background: 'rgba(155,140,255,0.16)', boxShadow: '0 0 10px rgba(155,140,255,0.22)' },
  teamTabName: { fontSize: 12, fontWeight: 700 },
  teamTabGlyphs: { display: 'flex', gap: 3, fontSize: 16 },
  teamTabFarm: { fontSize: 10, color: ECHO },
  teamAdd: { padding: '8px 12px', borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.25)', background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontWeight: 600 },
  panel: { background: panelBg, border, borderRadius: 14, padding: 14 },
  panelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  panelTitle: { margin: 0, fontSize: 'var(--fs-h3, 18px)' },
  powerTag: { fontSize: 13, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 8 },
  removeTeamBtn: { background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.5, fontSize: 13 },
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
  battleMid: { minHeight: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 },
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
  skillNodeRank: { fontSize: 11, color: GOLD, fontWeight: 600 },
}
