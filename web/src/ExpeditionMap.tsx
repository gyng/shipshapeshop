// The Expeditions v5 JOURNEY MAP — a node-graph the player routes through (chapters as regions, quests as
// connected nodes, branching Elite alt-routes). Render-only: every node's state (locked/open/cleared/farming/
// beatable) and the risk choice come from Rust truth (the view); this draws + animates them. Clicking a node
// opens a detail card with the station/watch/recall actions, a risk-mod picker, and clear telegraphing.
import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useGame } from './game/store'
import type { ExpQuest } from './game/store'
import { useT } from './i18n'

const ECHO = '#9b8cff'
const GOLD = 'var(--c-accent-gold, #ffcf6b)'
const READY = '#5fe0c6'
const WARN = '#ff8a6b'
const NODE = 44 // node diameter (px) — ≥44 for touch (#9); the map scrolls horizontally so the wider nodes don't crowd the column
const BOSS_LORE = new Set(['shallows_boss', 'folds_boss', 'deep_boss', 'vantage_boss']) // boss nodes with Ledger lore

type NodeState = 'locked' | 'open' | 'cleared' | 'farming'

function nodeIcon(kind: string): string {
  return kind === 'boss' ? '◆' : kind === 'elite' ? '✦' : '●'
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

export function ExpeditionMap({ activeTeam, autoScroll }: { activeTeam: number; autoScroll?: boolean }) {
  const tr = useT()
  const view = useGame((s) => s.view)
  const exp = useGame((s) => s.expContent)
  const station = useGame((s) => s.station)
  const watch = useGame((s) => s.watch)
  const unstation = useGame((s) => s.unstation)
  const setNodeMod = useGame((s) => s.setNodeMod)
  const [sel, setSel] = useState<number | null>(null)
  const [teamPick, setTeamPick] = useState(false)
  const focusRef = useRef<HTMLButtonElement | null>(null)
  // auto-scroll the map's bounded container to the party's current node (delve node, else the open frontier). The dep
  // tracks BOTH cases so it also re-centers when the open frontier advances during idle/farming (a node clears), not
  // only during a live delve.
  const focusKey = view?.run
    ? view.run.path[Math.min(view.run.current_room, view.run.path.length - 1)]
    : view
      ? view.exp_node_open.findIndex((o, qi) => o && !view.exp_cleared[qi])
      : -2
  useEffect(() => {
    if (!autoScroll) return
    const el = focusRef.current
    if (!el) return
    const er = el.getBoundingClientRect()
    // Center the focused node in BOTH scroll axes — the map's progression is horizontal (X.scroll) AND the column
    // clips vertically (mapScroll). Walk up handling the first horizontal + first vertical scroller (then stop, so
    // we never scroll the whole page); bounding rects keep the math correct across the nested absolute/relative layers.
    let s: HTMLElement | null = el.parentElement
    let doneX = false
    let doneY = false
    while (s && (!doneX || !doneY)) {
      const style = getComputedStyle(s)
      const sr = s.getBoundingClientRect()
      if (!doneX && /auto|scroll/.test(style.overflowX) && s.scrollWidth > s.clientWidth + 1) {
        s.scrollTo({ left: Math.max(0, s.scrollLeft + (er.left - sr.left) - s.clientWidth / 2 + er.width / 2), behavior: 'smooth' })
        doneX = true
      }
      if (!doneY && /auto|scroll/.test(style.overflowY) && s.scrollHeight > s.clientHeight + 1) {
        s.scrollTo({ top: Math.max(0, s.scrollTop + (er.top - sr.top) - s.clientHeight / 2 + er.height / 2), behavior: 'smooth' })
        doneY = true
      }
      s = s.parentElement
    }
  }, [autoScroll, focusKey, activeTeam])

  if (!view || !exp) return null
  const quests = exp.quests
  const teams = view.exp_teams
  // the node the in-flight delve is currently at (so the run is visible on the map, not just the Scene)
  const runNode = view.run ? view.run.path[Math.min(view.run.current_room, view.run.path.length - 1)] : -1

  // layout bounds from the authored map_xy (units of ~10px); pad + scale to a comfortable canvas
  const xs = quests.map((q) => q.map_xy[0])
  const ys = quests.map((q) => q.map_xy[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const SX = 10, SY = 15 // px per map unit (x denser than y) — compacted to fit the left column (SY drives the height)
  const PAD = NODE / 2 + 10
  const W = (maxX - minX) * SX + PAD * 2
  const H = (maxY - minY) * SY + PAD * 2 + 8
  const px = (q: ExpQuest) => PAD + (q.map_xy[0] - minX) * SX
  const py = (q: ExpQuest) => PAD + (q.map_xy[1] - minY) * SY

  const stateOf = (qi: number): NodeState => {
    const onTeam = teams.findIndex((t) => t.station === qi)
    if (onTeam >= 0) return 'farming'
    if (view.exp_cleared[qi]) return 'cleared'
    if (view.exp_node_open[qi]) return 'open'
    return 'locked'
  }
  const stationedBy = (qi: number) => teams.findIndex((t) => t.station === qi)
  // the node to auto-scroll to: the active delve's current node, else the open frontier (farming/open)
  const focusNode = runNode >= 0 ? runNode : quests.findIndex((_, qi) => { const st = stateOf(qi); return st === 'farming' || st === 'open' })

  const colorOf = (qi: number, st: NodeState): string => {
    if (st === 'farming') return ECHO
    if (st === 'cleared') return READY
    if (st === 'locked') return 'rgba(255,255,255,0.18)'
    return view.exp_node_beatable[qi] ? GOLD : WARN // open: ready vs risky
  }

  const selQ = sel != null ? quests[sel] : null
  const teamPower = teams[activeTeam]?.power ?? 0

  return (
    <div style={X.root}>
      <div style={X.scroll}>
        <div style={{ position: 'relative', width: W, height: H, minWidth: '100%' }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
            {/* chapter bands — group the nodes by region so the journey reads as Shallows→Folds→Deep→Vantage,
                not one flat conveyor. Drawn first (behind edges/nodes); pure decoration, intercepts no clicks. */}
            {[...new Set(quests.map((q) => q.chapter))].sort((a, b) => a - b).map((ch, i) => {
              const qs = quests.filter((q) => q.chapter === ch)
              const x0 = Math.min(...qs.map(px)) - 8
              const x1 = Math.max(...qs.map((q) => px(q) + NODE)) + 8
              return (
                <g key={`ch${ch}`}>
                  <rect x={x0} y={4} width={x1 - x0} height={H - 8} rx={12} fill={i % 2 === 0 ? 'rgba(155,140,255,0.055)' : 'rgba(155,140,255,0.02)'} />
                  {i > 0 && <line x1={x0} y1={6} x2={x0} y2={H - 6} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />}
                  <text x={x0 + 11} y={20} fill="rgba(255,255,255,0.4)" fontSize={11} style={{ textTransform: 'uppercase', letterSpacing: '1px' }}>{tr('exp.chapter', { n: ch })}</text>
                </g>
              )
            })}
            {exp.edges.map(([from, to], i) => {
              const a = quests[from], b = quests[to]
              if (!a || !b) return null
              const x1 = px(a) + NODE / 2, y1 = py(a) + NODE / 2
              const x2 = px(b) + NODE / 2, y2 = py(b) + NODE / 2
              const lit = view.exp_cleared[from] // a cleared prereq lights the path forward
              const mx = (x1 + x2) / 2
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={lit ? ECHO : 'rgba(255,255,255,0.14)'}
                  strokeWidth={lit ? 2.5 : 2}
                  strokeOpacity={lit ? 0.7 : 0.4}
                  strokeDasharray={lit ? undefined : '4 5'}
                />
              )
            })}
          </svg>
          {quests.map((q, qi) => {
            const st = stateOf(qi)
            const c = colorOf(qi, st)
            const isSel = sel === qi
            const mod = view.exp_node_mod[qi] ?? 0
            // richer hover tooltip — state + power req + farm-rate estimate, so the map is scannable without clicking
            const fluxEst = view.exp_quest_flux_est[qi] ?? 0
            const stLabel = st === 'farming' ? tr('exp.farming') : st === 'cleared' ? tr('exp.cleared') : st === 'open' ? (view.exp_node_beatable[qi] ? tr('exp.ready') : tr('exp.risky')) : ''
            const nodeTitle = `${q.nick}${stLabel ? ` — ${stLabel}` : ''}${st !== 'locked' ? ` · ${tr('exp.power')} ${q.power_req}` : ''}${fluxEst > 0 && st !== 'cleared' ? ` · ≈+${fmt(fluxEst)} ✦/hr` : ''}`
            // bosses/elites read as special: a larger ring + a soft halo (kept centred on the original position)
            const big = q.kind === 'boss' ? 1.24 : q.kind === 'elite' ? 1.1 : 1
            const sz = NODE * big
            const off = (sz - NODE) / 2
            const kindHalo = st === 'locked' ? '' : q.kind === 'boss' ? `, 0 0 18px ${c}` : q.kind === 'elite' ? `, 0 0 0 1.5px ${c}` : ''
            return (
              <button
                ref={qi === focusNode ? focusRef : undefined}
                key={q.key}
                onClick={() => { setSel(qi); setTeamPick(false) }}
                title={nodeTitle}
                style={{
                  ...X.node,
                  left: px(q) - off,
                  top: py(q) - off,
                  width: sz,
                  height: sz,
                  borderColor: c,
                  borderWidth: q.kind === 'boss' ? 3 : 2,
                  color: c,
                  background: st === 'farming' ? 'rgba(155,140,255,0.18)' : st === 'cleared' ? 'rgba(95,224,198,0.10)' : 'rgba(20,16,34,0.85)',
                  opacity: st === 'locked' ? 0.5 : 1,
                  boxShadow: isSel ? `0 0 0 3px ${c}, 0 0 16px ${c}` : st === 'farming' ? `0 0 12px rgba(155,140,255,0.4)${kindHalo}` : kindHalo ? kindHalo.replace(/^, /, '') : 'none',
                  transform: isSel ? 'scale(1.12)' : 'scale(1)',
                }}
                className={st === 'farming' ? 'exp-node-farm' : undefined}
              >
                <span style={{ fontSize: q.kind === 'boss' ? 16 : 13 }}>{st === 'locked' ? (q.min_dim > view.viewport_dim ? '✧' : '🔒') : st === 'cleared' ? '✓' : nodeIcon(q.kind)}</span>
                {st === 'farming' && <span style={X.nodeFarmTag}>✶</span>}
                {qi === runNode && <span style={X.nodeRunTag}>⛏</span>}
                {mod > 0 && st !== 'cleared' && st !== 'farming' && <span style={{ ...X.nodeModTag, color: mod >= 2 ? '#ff4d4d' : '#ffb74a' }}>{'!'.repeat(mod)}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* node detail card */}
      {selQ && sel != null && (() => {
        const qi = sel
        const st = stateOf(qi)
        const onTeam = stationedBy(qi)
        const ratio = selQ.power_req > 0 ? teamPower / selQ.power_req : 1
        const tone = view.exp_node_beatable[qi] ? READY : ratio >= 0.7 ? GOLD : WARN
        const fluxEst = view.exp_quest_flux_est[qi] ?? 0
        const canStation = st === 'open' && teams[activeTeam]?.members.length > 0
        // first-clear Echoes lump preview (mirrors core grant_first_clear): base×5 × (1 + selected-mod%). Updates
        // live as the mod toggles (setNodeMod round-trips through the view).
        const selMod = exp.node_mods[view.exp_node_mod[qi] ?? 0]
        const fcEchoes = Math.round((selQ.base_echo * 5 * (100 + (selMod?.first_clear_mult_pct ?? 0))) / 100)
        return (
          <div style={X.detail}>
            <div style={X.detailHead}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                <span style={{ color: colorOf(qi, st), marginRight: 6 }}>{nodeIcon(selQ.kind)}</span>
                {selQ.nick}
                {selQ.kind === 'elite' && <span style={X.eliteTag}>{tr('exp.node.elite')}</span>}
              </span>
              <button style={X.close} onClick={() => setSel(null)}>✕</button>
            </div>
            <div style={X.chips}>
              <span style={{ ...X.stateChip, color: tone, borderColor: tone }}>
                {st === 'farming' ? `✶ ${tr('exp.farming')}` : st === 'cleared' ? `✓ ${tr('exp.cleared')}` : view.exp_node_beatable[qi] ? tr('exp.ready') : ratio >= 0.7 ? tr('exp.risky') : tr('exp.underpowered')}
              </span>
              <span style={X.reqChip}>{tr('exp.power')} {teamPower} / {selQ.power_req}</span>
              {st === 'open' && fcEchoes > 0 && <span style={{ ...X.reqChip, color: ECHO }}>{tr('exp.firstClear', { n: fmt(fcEchoes) })}</span>}
              {fluxEst > 0 && <span style={{ ...X.reqChip, color: GOLD }}>≈ +{fmt(fluxEst)} ✦/hr</span>}
            </div>
            <div style={X.enemyRow}>
              {selQ.enemy_nicks.map((n, k) => <span key={k} style={X.enemyChip}>{n}</span>)}
              {selQ.boss_nick && <span style={{ ...X.enemyChip, ...X.bossChip }}>☠ {selQ.boss_nick}</span>}
            </div>
            {selQ.recruit_nick && !view.exp_cleared[qi] && <div style={X.recruit}>{tr('exp.frees', { nick: selQ.recruit_nick })}</div>}
            {BOSS_LORE.has(selQ.key) && <div style={X.bossLore}>{tr(`exp.boss.${selQ.key}.lore`)}</div>}

            {/* risk-mod picker (only when open + uncleared) */}
            {st === 'open' && (
              <div style={X.modRow}>
                <span style={X.modLabel}>{tr('exp.risk')}:</span>
                {exp.node_mods.map((m, mi) => (
                  <button
                    key={m.key}
                    onClick={() => setNodeMod(qi, mi)}
                    style={{ ...X.modBtn, ...(view.exp_node_mod[qi] === mi ? X.modBtnOn : {}) }}
                  >
                    <span style={X.modName}>{tr(`exp.mod.${m.key}`)}</span>
                    <span style={X.modReward}>{mi === 0 ? '—' : `+${m.first_clear_mult_pct}% ✶`}</span>
                    {mi > 0 && <span style={X.modCost}>+{m.enemy_scale_pct}% ⚔</span>}
                  </button>
                ))}
              </div>
            )}

            <div style={X.actions}>
              {st === 'farming' ? (
                <>
                  <button style={X.primary} onClick={() => watch(qi)}>▶ {tr('exp.watch')}</button>
                  <button style={X.secondary} onClick={() => { unstation(onTeam); }}>{tr('exp.recall')}</button>
                </>
              ) : st === 'cleared' ? (
                <button style={{ ...X.primary, opacity: canStationCleared(view, activeTeam) ? 1 : 0.5 }} disabled={!canStationCleared(view, activeTeam)} onClick={() => setTeamPick(true)}>✶ {tr('exp.station')}</button>
              ) : st === 'open' ? (
                <button style={{ ...X.primary, opacity: canStation ? 1 : 0.5 }} disabled={!canStation} onClick={() => setTeamPick(true)}>
                  {view.exp_node_beatable[qi] ? `✶ ${tr('exp.station')}` : `⚔ ${tr('exp.attempt')}`}
                </button>
              ) : (
                <span style={X.lockedNote}>{selQ.min_dim > view.viewport_dim ? `✧ ${tr('exp.locked', { d: selQ.min_dim })}` : tr('exp.locked.prereq')}</span>
              )}
            </div>
            {((st === 'open' && !canStation) || (st === 'cleared' && !canStationCleared(view, activeTeam))) && (
              <span style={X.needTeam}>{tr('exp.needTeam')}</span>
            )}

            {/* team picker — which team sends */}
            {teamPick && (st === 'open' || st === 'cleared') && (
              <div style={X.teamPick}>
                <div style={X.teamPickHead}>{view.exp_cleared[qi] ? tr('exp.pickTeam') : tr('exp.pickTeamClear')}</div>
                {teams.map((t, ti) => {
                  const empty = t.members.length === 0
                  const r2 = selQ.power_req > 0 ? t.power / selQ.power_req : 1
                  const cc = r2 >= 1 ? READY : r2 >= 0.7 ? GOLD : WARN
                  return (
                    <button key={ti} style={{ ...X.teamPickRow, opacity: empty ? 0.4 : 1 }} disabled={empty} onClick={() => { station(ti, qi); setTeamPick(false); setSel(null) }}>
                      <span>{tr('exp.teamN', { n: ti + 1 })}</span>
                      <span style={{ color: cc, fontWeight: 700 }}>{Math.round(r2 * 100)}%</span>
                      {t.provisions.length > 0 && <span style={{ color: GOLD, fontSize: 11 }}>+{t.provisions.length}🧪</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function canStationCleared(view: NonNullable<ReturnType<typeof useGame.getState>['view']>, t: number): boolean {
  return (view.exp_teams[t]?.members.length ?? 0) > 0
}

const border = '1px solid rgba(255,255,255,0.1)'
const X: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12 },
  scroll: { overflowX: 'auto', overflowY: 'hidden', padding: '8px 4px 16px', borderRadius: 12, background: 'rgba(0,0,0,0.18)', border },
  node: { position: 'absolute', width: NODE, height: NODE, borderRadius: '50%', border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', padding: 0 },
  nodeFarmTag: { position: 'absolute', top: -6, right: -2, fontSize: 12, color: ECHO },
  nodeRunTag: { position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', fontSize: 13, filter: 'drop-shadow(0 0 4px rgba(155,140,255,0.7))' },
  nodeModTag: { position: 'absolute', bottom: -4, fontSize: 10, color: WARN, fontWeight: 800, letterSpacing: -1 },
  detail: { background: 'rgba(255,255,255,0.04)', border, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  detailHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  eliteTag: { marginLeft: 8, fontSize: 10, color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase' },
  close: { background: 'transparent', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer', opacity: 0.7 },
  chips: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  stateChip: { fontSize: 12, fontWeight: 700, border: '1px solid', borderRadius: 7, padding: '2px 8px' },
  reqChip: { fontSize: 12, opacity: 0.85, fontVariantNumeric: 'tabular-nums' },
  enemyRow: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  enemyChip: { fontSize: 11, opacity: 0.8, background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '2px 6px' },
  bossChip: { color: '#ff9a6b', background: 'rgba(255,120,80,0.12)' },
  recruit: { fontSize: 12, color: '#ff8fb0' },
  bossLore: { fontSize: 11.5, color: 'rgba(255,255,255,0.66)', fontStyle: 'italic', lineHeight: 1.4, marginTop: 5 },
  modRow: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  modLabel: { fontSize: 12, opacity: 0.7 },
  modBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '4px 11px', borderRadius: 8, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  modBtnOn: { borderColor: WARN, background: 'rgba(255,138,107,0.15)', color: WARN, fontWeight: 700 },
  modName: { fontWeight: 600 },
  modReward: { fontSize: 11, color: GOLD, fontVariantNumeric: 'tabular-nums' },
  modCost: { fontSize: 10, color: WARN, opacity: 0.85, fontVariantNumeric: 'tabular-nums' },
  needTeam: { fontSize: 12, opacity: 0.65, fontStyle: 'italic' },
  actions: { display: 'flex', gap: 8 },
  primary: { flex: 1, padding: '9px 12px', borderRadius: 9, border: 'none', background: GOLD, color: '#1a1410', fontWeight: 700, cursor: 'pointer' },
  secondary: { padding: '9px 12px', borderRadius: 9, border: `1px solid ${ECHO}`, background: 'rgba(155,140,255,0.18)', color: ECHO, fontWeight: 600, cursor: 'pointer' },
  lockedNote: { fontSize: 12, opacity: 0.6, padding: '8px 0' },
  teamPick: { display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 10, background: 'rgba(20,16,34,0.6)', border: `1px solid ${ECHO}` },
  teamPickHead: { fontSize: 12, opacity: 0.8 },
  teamPickRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border, background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
}
