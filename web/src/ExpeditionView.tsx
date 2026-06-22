// Expeditions — the opt-in idle RPG screen. Build a party from your collection, delve quests in a deterministic
// turn-based fight (the CombatOverlay replays the Rust battle log over a 3D stage), then station parties on
// cleared quests to farm Echoes idle — multiple farms run at once. Auto-Expedition automates it all.
// All numbers are Rust truth (the view); this file only renders + animates them. Echoes-bought upgrades live
// in the Workshop (see WorkshopView), not here.
import { useState, useEffect, useMemo, useRef, CSSProperties } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { useGame } from './game/store'
import type { ExpElement, UnitInfo, DelveResult } from './game/store'
import { glyphOf } from './content/glyphs'
import { useT } from './i18n'

const ECHO = '#9b8cff'
const GOLD = 'var(--c-accent-gold, #ffcf6b)'
const ELEMENT_C: Record<ExpElement, string> = { solid: '#7fb0ff', twisted: '#c08cff', woven: '#5fe0c6' }
const ELEMENT_HEX: Record<ExpElement, string> = { solid: '#7fb0ff', twisted: '#c08cff', woven: '#5fe0c6' }
const ROLE: Record<string, { icon: string; c: string }> = {
  tank: { icon: '🛡', c: '#7fb0ff' },
  dps: { icon: '⚔', c: '#ff8a6b' },
  support: { icon: '✚', c: '#5fe0c6' },
  control: { icon: '🌀', c: '#c08cff' },
}
const KNOT_FAMILIES = new Set(['trefoil', 'figure8_knot', 'torus_knot_2_5', 'borromean', 'seifert', 'hopf_link'])
const SUPPORT_FAMILIES = new Set(['dodecahedron', 'disk', 'gyroid', 'schwarz_p', 'schwarz_d', 'seifert', 'costa'])
const TANK_FAMILIES = new Set(['sphere', 'cube', 'cylinder', 'ellipsoid', 'hyperboloid', 'catenoid'])

function elementOf(family: string, orientable: boolean): ExpElement {
  if (!orientable) return 'twisted'
  if (KNOT_FAMILIES.has(family)) return 'woven'
  return 'solid'
}
function roleOf(family: string, eulerCost: number, orientable: boolean): string {
  if (KNOT_FAMILIES.has(family)) return 'control'
  if (!orientable) return 'support'
  if (TANK_FAMILIES.has(family)) return 'tank'
  if (SUPPORT_FAMILIES.has(family)) return 'support'
  if (eulerCost === 0) return 'tank'
  return 'dps'
}

export function ExpeditionView() {
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const exp = useGame((s) => s.expContent)
  const setParty = useGame((s) => s.setParty)
  const delve = useGame((s) => s.delve)
  const station = useGame((s) => s.station)
  const unstation = useGame((s) => s.unstation)
  const lastDelve = useGame((s) => s.lastDelve)
  const autoOn = useGame((s) => s.autoExpedition)
  const toggleAuto = useGame((s) => s.toggleAutoExpedition)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [lastQuest, setLastQuest] = useState<number | null>(null)

  if (!view || !exp) return null
  const party = view.exp_party
  const partyFull = party.length >= view.exp_party_max
  const farms = view.exp_farms
  const farmsFull = farms.length >= view.exp_max_farms
  const farmingQuests = new Set(farms.map((f) => f.quest))
  const doDelve = (qi: number) => {
    setLastQuest(qi)
    delve(qi)
  }
  const addToParty = (id: number) => {
    if (!partyFull) setParty([...party, id])
  }
  const removeFromParty = (id: number) => setParty(party.filter((x) => x !== id))

  const roster = shapes
    .filter((s) => (view.owned[s.id] ?? 0) > 0 && !party.includes(s.id))
    .filter((s) => !search || s.nick.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (view.exp_power[b.id] ?? 0) - (view.exp_power[a.id] ?? 0))

  const byChapter = new Map<number, { quest: (typeof exp.quests)[number]; idx: number }[]>()
  exp.quests.forEach((quest, idx) => {
    const arr = byChapter.get(quest.chapter) ?? []
    arr.push({ quest, idx })
    byChapter.set(quest.chapter, arr)
  })

  const questNick = (qi: number) => exp.quests[qi]?.nick ?? ''

  return (
    <div style={X.root}>
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
              <span style={{ color: ECHO, fontWeight: 600 }}>+{Math.round(view.echo_rate_per_hr).toLocaleString()}/hr</span>
              <span style={X.statLbl}>{tr('exp.farming')}</span>
            </div>
          )}
          {view.exp_flux_rate > 0 && (
            <div style={X.echoStat}>
              <span style={{ color: GOLD, fontWeight: 600 }}>+{Math.round(view.exp_flux_rate).toLocaleString()}/hr</span>
              <span style={X.statLbl}>{tr('hud.flux')} ✦</span>
            </div>
          )}
          <button style={{ ...X.autoBtn, ...(autoOn ? X.autoOn : {}) }} onClick={toggleAuto} title={tr('exp.autoTip')}>
            {autoOn ? '⏸' : '▶'} {tr('exp.auto')}
          </button>
        </div>
      </div>

      {/* ── party builder ── */}
      <div style={X.panel}>
        <div style={X.panelHead}>
          <h3 style={X.panelTitle}>{tr('exp.party')}</h3>
          <span style={X.powerTag}>{tr('exp.power')}: <b style={{ color: GOLD }}>{view.exp_party_power.toLocaleString()}</b></span>
        </div>
        <div style={X.partyRow}>
          {Array.from({ length: view.exp_party_max }).map((_, i) => {
            const id = party[i]
            if (id == null) {
              return (
                <button key={`slot-${i}`} style={X.emptySlot} onClick={() => setPicker(true)} title={tr('exp.addMember')}>
                  ＋
                </button>
              )
            }
            const s = shapes[id]
            if (!s) return null
            const role = roleOf(s.family, s.euler_cost, s.orientable)
            const el = elementOf(s.family, s.orientable)
            const bond = view.bond_levels[id] ?? 0
            return (
              <button key={id} style={X.memberCard} onClick={() => removeFromParty(id)} title={tr('exp.removeMember', { nick: s.nick })}>
                <span style={{ ...X.elDot, background: ELEMENT_C[el] }} />
                <span style={X.memberGlyph}>{glyphOf(s.family)}</span>
                <span style={X.memberNick}>{s.nick}</span>
                <span style={X.memberMeta}>
                  <span style={{ color: ROLE[role].c }}>{ROLE[role].icon}</span>
                  <span style={{ color: GOLD }}>★{view.star_levels[id] ?? 0}</span>
                </span>
                <span style={X.memberPow}>{(view.exp_power[id] ?? 0).toLocaleString()}</span>
                {bond > 0 && <span style={X.bondHearts}>{'♥'.repeat(Math.min(bond, 5))}</span>}
              </button>
            )
          })}
        </div>
        {party.length === 0 && <p style={X.hint}>{tr('exp.partyHint')}</p>}
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
              const role = roleOf(s.family, s.euler_cost, s.orientable)
              const el = elementOf(s.family, s.orientable)
              return (
                <button key={s.id} style={{ ...X.rosterChip, opacity: partyFull ? 0.4 : 1 }} disabled={partyFull} onClick={() => addToParty(s.id)}>
                  <span style={{ ...X.elDot, background: ELEMENT_C[el] }} />
                  <span style={{ fontSize: 20 }}>{glyphOf(s.family)}</span>
                  <span style={X.rosterNick}>{s.nick}</span>
                  <span style={{ color: ROLE[role].c, fontSize: 12 }}>{ROLE[role].icon}</span>
                  <span style={X.rosterPow}>{(view.exp_power[s.id] ?? 0).toLocaleString()}</span>
                </button>
              )
            })}
            {roster.length === 0 && <p style={X.hint}>{tr('exp.noRoster')}</p>}
          </div>
        </div>
      )}

      {/* ── active farms (multiple parties) ── */}
      {farms.length > 0 && (
        <div style={X.panel}>
          <h3 style={X.panelTitle}>{tr('exp.farms', { n: farms.length, max: view.exp_max_farms })}</h3>
          <div style={X.farmGrid}>
            {farms.map((f) => (
              <div key={f.quest} style={X.farmCard}>
                <div style={X.farmTop}>
                  <span style={X.farmNick}>✶ {questNick(f.quest)}</span>
                  <button style={X.closeBtn} onClick={() => unstation(f.quest)} title={tr('exp.unstationTip')}>✕</button>
                </div>
                <div style={X.farmParty}>
                  {f.party.map((id) => <span key={id} title={shapes[id]?.nick} style={X.farmGlyph}>{glyphOf(shapes[id]?.family ?? '')}</span>)}
                </div>
                <span style={{ color: ECHO, fontWeight: 600, fontSize: 13 }}>+{Math.round(f.rate_per_hr).toLocaleString()} ✶/hr</span>
                {f.flux_rate > 0 && <span style={{ color: GOLD, fontWeight: 600, fontSize: 12 }}>+{Math.round(f.flux_rate).toLocaleString()} ✦/hr</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── quest board ── */}
      <div style={X.panel}>
        <h3 style={X.panelTitle}>{tr('exp.quests')}</h3>
        {[...byChapter.entries()].map(([ch, items]) => (
          <div key={ch} style={{ marginBottom: 14 }}>
            <div style={X.chapterLabel}>{tr('exp.chapter', { n: ch })}</div>
            <div style={X.questGrid}>
              {items.map(({ quest, idx }) => {
                const locked = view.viewport_dim < quest.min_dim
                const cleared = view.exp_cleared[idx]
                const farming = farmingQuests.has(idx)
                const ratio = quest.power_req > 0 ? view.exp_party_power / quest.power_req : 1
                const tone = ratio >= 1 ? '#5fe0c6' : ratio >= 0.6 ? GOLD : '#ff8a6b'
                return (
                  <div key={quest.key} style={{ ...X.questCard, ...(farming ? X.questStationed : {}), opacity: locked ? 0.5 : 1 }}>
                    <div style={X.questTop}>
                      <span style={X.questNick}>{cleared && <span style={{ color: '#5fe0c6' }}>✓ </span>}{quest.nick}</span>
                      <span style={X.tierTag}>{tr('exp.tier', { t: quest.tier })}</span>
                    </div>
                    <div style={X.enemyRow}>
                      {quest.enemy_nicks.map((n, k) => <span key={k} style={X.enemyChip}>{n}</span>)}
                      {quest.boss_nick && <span style={{ ...X.enemyChip, ...X.bossChip }}>☠ {quest.boss_nick}</span>}
                    </div>
                    {quest.recruit_nick && !cleared && <div style={X.recruitHint}>{tr('exp.frees', { nick: quest.recruit_nick })}</div>}
                    <div style={X.powBarWrap} title={tr('exp.powerVs', { p: view.exp_party_power, r: quest.power_req })}>
                      <div style={{ ...X.powBar, width: `${Math.min(100, ratio * 100)}%`, background: tone }} />
                      <span style={X.powBarTxt}>{Math.round(ratio * 100)}%</span>
                    </div>
                    <div style={X.questBtns}>
                      {locked ? (
                        <span style={X.lockedTag}>{tr('exp.locked', { d: quest.min_dim })}</span>
                      ) : (
                        <>
                          <button style={{ ...X.delveBtn, opacity: party.length === 0 ? 0.4 : 1 }} disabled={party.length === 0} onClick={() => doDelve(idx)} className="btn-primary">
                            {tr('exp.delve')}
                          </button>
                          {cleared &&
                            (farming ? (
                              <button style={X.unstationBtn} onClick={() => unstation(idx)}>{tr('exp.stationed')}</button>
                            ) : (
                              <button style={{ ...X.stationBtn, opacity: party.length === 0 || farmsFull ? 0.4 : 1 }} disabled={party.length === 0 || farmsFull} onClick={() => station(idx)} title={farmsFull ? tr('exp.farmsFull') : tr('exp.stationTip')}>✶ {tr('exp.station')}</button>
                            ))}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {lastDelve && <CombatOverlay result={lastDelve} quest={lastQuest} onDelve={doDelve} />}
    </div>
  )
}

// ── 3D combat stage: one Canvas, a procedural gem per combatant (cheap meshes, not transmission) ──
function CombatGem({ family, element, x, z, dead, acting, hitKey }: { family: string; element: ExpElement; x: number; z: number; dead: boolean; acting: boolean; hitKey: number }) {
  const ref = useRef<Mesh>(null)
  const flash = useRef(0)
  const prevHit = useRef(hitKey)
  if (hitKey !== prevHit.current) {
    prevHit.current = hitKey
    flash.current = 1
  }
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    m.rotation.y += dt * (acting ? 2.4 : 0.7)
    m.rotation.x += dt * 0.25
    flash.current = Math.max(0, flash.current - dt * 3)
    const s = (dead ? 0.55 : 1) * (1 + flash.current * 0.25)
    m.scale.setScalar(s)
    m.position.y = z > 0 ? -0.1 : 0.35 // allies sit a touch lower than foes
  })
  const c = ELEMENT_HEX[element]
  const geo =
    element === 'woven' ? <torusKnotGeometry args={[0.42, 0.15, 90, 14]} /> :
    element === 'twisted' ? <torusKnotGeometry args={[0.4, 0.14, 80, 10, 2, 3]} /> :
    family === 'torus' || family === 'genus2' ? <torusGeometry args={[0.42, 0.18, 18, 44]} /> :
    family === 'cube' ? <boxGeometry args={[0.7, 0.7, 0.7]} /> :
    <icosahedronGeometry args={[0.55, 0]} />
  return (
    <mesh ref={ref} position={[x, 0, z]}>
      {geo}
      <meshStandardMaterial color={c} emissive={c} emissiveIntensity={acting ? 0.85 : 0.3} metalness={0.5} roughness={0.25} transparent opacity={dead ? 0.28 : 1} />
    </mesh>
  )
}

function CombatStage3D({ units, hp, cur, step }: { units: UnitInfo[]; hp: number[]; cur: { actor: number; target: number } | null; step: number }) {
  const allies = units.map((u, i) => ({ u, i })).filter((x) => !x.u.is_enemy)
  const foes = units.map((u, i) => ({ u, i })).filter((x) => x.u.is_enemy)
  const spread = (n: number, k: number) => (n <= 1 ? 0 : (k - (n - 1) / 2) * 1.5)
  return (
    <Canvas camera={{ position: [0, 1.6, 5.2], fov: 42 }} dpr={[1, 1.5]} style={{ width: '100%', height: 220 }}>
      <ambientLight intensity={0.55} />
      <pointLight position={[3, 5, 4]} intensity={60} color="#fff0d8" />
      <pointLight position={[-4, 2, 2]} intensity={30} color="#9b8cff" />
      {foes.map(({ u, i }, k) => (
        <CombatGem key={`f${i}`} family={u.family} element={u.element} x={spread(foes.length, k)} z={-1.3} dead={hp[i] <= 0} acting={cur?.actor === i} hitKey={cur?.target === i ? step : 0} />
      ))}
      {allies.map(({ u, i }, k) => (
        <CombatGem key={`a${i}`} family={u.family} element={u.element} x={spread(allies.length, k)} z={1.3} dead={hp[i] <= 0} acting={cur?.actor === i} hitKey={cur?.target === i ? step : 0} />
      ))}
    </Canvas>
  )
}

// ── the combat overlay: replays the deterministic battle log over the 3D stage + HTML HP bars ──
function CombatOverlay({ result, quest, onDelve }: { result: DelveResult; quest: number | null; onDelve: (q: number) => void }) {
  const tr = useT()
  const dismiss = useGame((s) => s.dismissDelve)
  const station = useGame((s) => s.station)
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const battle = result.battle
  const log = useMemo(() => battle?.log ?? [], [battle])
  const units = useMemo(() => battle?.units ?? [], [battle])
  const [step, setStep] = useState(0)
  const [speed, setSpeed] = useState(1)
  const finished = step >= log.length

  useEffect(() => {
    if (finished) return
    const id = setTimeout(() => setStep((s) => s + 1), 560 / speed)
    return () => clearTimeout(id)
  }, [step, speed, finished, log.length])

  const hp = useMemo(() => {
    const h = units.map((u) => u.max_hp)
    for (let i = 0; i < step && i < log.length; i++) {
      const e = log[i]
      if (e.target >= 0 && e.target < h.length) {
        if (e.dmg > 0) h[e.target] = Math.max(0, h[e.target] - e.dmg)
        if (e.heal > 0) h[e.target] = Math.min(units[e.target].max_hp, h[e.target] + e.heal)
      }
    }
    return h
  }, [step, log, units])

  const cur = step > 0 ? log[step - 1] : null
  const allies = units.map((u, i) => ({ u, i })).filter((x) => !x.u.is_enemy)
  const foes = units.map((u, i) => ({ u, i })).filter((x) => x.u.is_enemy)

  const renderBar = ({ u, i }: { u: UnitInfo; i: number }) => {
    const cur_hp = hp[i]
    const dead = cur_hp <= 0
    const frac = u.max_hp > 0 ? cur_hp / u.max_hp : 0
    const isTarget = cur && cur.target === i
    const float = isTarget && cur ? (cur.heal > 0 ? `+${cur.heal}` : cur.dmg > 0 ? `−${cur.dmg}` : '') : ''
    return (
      <div key={`${u.is_enemy ? 'e' : 'a'}-${i}`} style={{ ...X.barCard, opacity: dead ? 0.4 : 1 }}>
        <span style={X.barNick} title={u.nick}><span style={{ color: ELEMENT_C[u.element] }}>●</span> {u.nick}</span>
        <div style={X.hpBarWrap}>
          <div style={{ ...X.hpBar, width: `${frac * 100}%`, background: u.is_enemy ? '#ff7a7a' : '#7fe6a0' }} />
        </div>
        <span style={X.hpTxt}>{Math.max(0, cur_hp)}/{u.max_hp}</span>
        {float && <span key={step} style={{ ...X.floatNum, color: cur && cur.heal > 0 ? '#7fe6a0' : '#ffd1d1' }}>{float}</span>}
      </div>
    )
  }

  const recruitNick = result.recruited_id >= 0 ? shapes[result.recruited_id]?.nick : null

  return (
    <div style={X.overlay} onClick={finished ? dismiss : undefined}>
      <div style={X.battleBox} onClick={(e) => e.stopPropagation()}>
        <div style={X.foeBars}>{foes.map(renderBar)}</div>
        <CombatStage3D units={units} hp={hp} cur={cur} step={step} />
        <div style={X.allyBars}>{allies.map(renderBar)}</div>

        <div style={X.battleMid}>
          {!finished ? (
            <>
              <div style={X.ticker}>{cur ? actionLine(tr, cur, units) : tr('exp.battleStart')}</div>
              <div style={X.battleCtrls}>
                <button style={X.ctrlBtn} onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}>×{speed}</button>
                <button style={X.ctrlBtn} onClick={() => setStep(log.length)}>{tr('exp.skip')} ⏭</button>
              </div>
            </>
          ) : (
            <div style={X.resultBox}>
              <div style={{ ...X.resultBanner, color: result.win ? '#7fe6a0' : GOLD }}>{result.win ? tr('exp.victory') : tr('exp.notReady')}</div>
              {result.win && result.echoes_gained > 0 && <div style={{ color: ECHO, fontWeight: 600 }}>+{result.echoes_gained.toLocaleString()} ✶ {tr('exp.echoes')}</div>}
              {result.win && recruitNick && result.recruit_is_new && <div style={{ color: '#ff8fb0', fontWeight: 700 }}>{tr('exp.freed', { nick: recruitNick })}</div>}
              {!result.win && <div style={X.hint}>{tr('exp.notReadyHint')}</div>}
              <div style={X.resultBtns}>
                {result.win && quest != null && view && view.exp_cleared[quest] && !view.exp_farms.some((f) => f.quest === quest) && view.exp_farms.length < view.exp_max_farms && (
                  <button style={X.stationBtn} onClick={() => { station(quest); dismiss() }}>✶ {tr('exp.stationHere')}</button>
                )}
                {quest != null && <button style={X.ctrlBtn} onClick={() => onDelve(quest)}>↻ {tr('exp.retry')}</button>}
                <button style={X.delveBtn} className="btn-primary" onClick={dismiss}>{tr('exp.continue')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function actionLine(tr: (k: string, v?: Record<string, string | number>) => string, e: { actor: number; action: string; target: number; dmg: number; heal: number; status: string }, units: UnitInfo[]): string {
  const a = units[e.actor]?.nick ?? '?'
  const t = e.target >= 0 ? units[e.target]?.nick ?? '' : ''
  const verb = tr(`exp.act.${e.action}`)
  if (e.action === 'stunned') return tr('exp.line.stunned', { a })
  if (e.heal > 0) return tr('exp.line.heal', { a, verb, t, n: e.heal })
  if (e.dmg > 0) return tr('exp.line.hit', { a, verb, t, n: e.dmg })
  return tr('exp.line.cast', { a, verb, t })
}

const panelBg = 'rgba(255,255,255,0.035)'
const border = '1px solid rgba(255,255,255,0.1)'
const X: Record<string, CSSProperties> = {
  root: { padding: '16px 18px 80px', maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 'var(--fs-h2, 26px)' },
  subtitle: { margin: '4px 0 0', opacity: 0.7, fontSize: 'var(--fs-caption, 13px)', maxWidth: 520 },
  headStats: { display: 'flex', gap: 16, alignItems: 'center' },
  echoStat: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  statLbl: { fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 },
  autoBtn: { padding: '8px 14px', borderRadius: 10, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontWeight: 700, alignSelf: 'center' },
  autoOn: { borderColor: ECHO, background: 'rgba(155,140,255,0.2)', color: ECHO, boxShadow: '0 0 12px rgba(155,140,255,0.3)' },
  panel: { background: panelBg, border, borderRadius: 14, padding: 14 },
  panelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  panelTitle: { margin: 0, fontSize: 'var(--fs-h3, 18px)' },
  powerTag: { fontSize: 13, opacity: 0.85 },
  partyRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  emptySlot: { width: 92, height: 116, borderRadius: 12, border: '1.5px dashed rgba(255,255,255,0.25)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 30, cursor: 'pointer' },
  memberCard: { position: 'relative', width: 92, height: 116, borderRadius: 12, border, background: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', padding: 4 },
  elDot: { position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderRadius: 4 },
  memberGlyph: { fontSize: 30 },
  memberNick: { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 84 },
  memberMeta: { display: 'flex', gap: 6, fontSize: 12 },
  memberPow: { fontSize: 12, color: GOLD, fontWeight: 600 },
  bondHearts: { position: 'absolute', bottom: 4, fontSize: 9, color: '#ff5d8f', letterSpacing: -1 },
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
  farmParty: { display: 'flex', gap: 4 },
  farmGlyph: { fontSize: 18 },
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
  questBtns: { display: 'flex', gap: 8, marginTop: 2 },
  delveBtn: { flex: 1, padding: '8px 10px', borderRadius: 9, border: 'none', background: GOLD, color: '#1a1410', fontWeight: 700, cursor: 'pointer' },
  stationBtn: { padding: '8px 10px', borderRadius: 9, border: `1px solid ${ECHO}`, background: 'transparent', color: ECHO, fontWeight: 600, cursor: 'pointer' },
  unstationBtn: { padding: '8px 10px', borderRadius: 9, border: `1px solid ${ECHO}`, background: 'rgba(155,140,255,0.18)', color: ECHO, fontWeight: 600, cursor: 'pointer' },
  lockedTag: { fontSize: 12, opacity: 0.6, padding: '8px 0' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(8,6,16,0.82)', backdropFilter: 'blur(6px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  battleBox: { width: 'min(720px, 96vw)', display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 16px', borderRadius: 18, background: 'rgba(20,16,34,0.96)', border: '1px solid rgba(155,140,255,0.3)', boxShadow: '0 20px 70px rgba(0,0,0,0.6)' },
  foeBars: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  allyBars: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  barCard: { position: 'relative', width: 104, padding: '5px 7px', borderRadius: 8, border, background: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 3, transition: 'opacity 0.3s' },
  barNick: { fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hpBarWrap: { width: '100%', height: 7, borderRadius: 4, background: 'rgba(0,0,0,0.4)', overflow: 'hidden' },
  hpBar: { height: '100%', borderRadius: 4, transition: 'width 0.35s ease-out' },
  hpTxt: { fontSize: 10, opacity: 0.75 },
  floatNum: { position: 'absolute', top: -8, right: 6, fontSize: 18, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,0.7)', animation: 'expFloatUp 0.9s ease-out forwards', pointerEvents: 'none' },
  battleMid: { minHeight: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ticker: { fontSize: 15, textAlign: 'center', minHeight: 22, opacity: 0.95 },
  battleCtrls: { display: 'flex', gap: 10 },
  ctrlBtn: { padding: '6px 12px', borderRadius: 8, border, background: 'rgba(255,255,255,0.06)', color: 'inherit', cursor: 'pointer', fontWeight: 600 },
  resultBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  resultBanner: { fontSize: 26, fontWeight: 800, letterSpacing: 1 },
  resultBtns: { display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
}
