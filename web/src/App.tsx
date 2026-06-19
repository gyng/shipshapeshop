import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useGame, RARITY_ORDER, type ShapeRow } from './game/store'
import { HeroView } from './three/HeroView'
import { FactoryFloor } from './three/FactoryFloor'
import { RoomScene } from './three/RoomScene'
import { ForgeAltar } from './three/ForgeAltar'
import { ShipScene } from './three/ShipScene'
import { RARITY_COLOR } from './three/Gem'
import { CODEX } from './content/codex'
import { SCENES, sceneById } from './content/cosmetics'
import { KINSHIP } from './content/kinship'
import { SHIP_SCENES, useShips, hasShip } from './content/ships'
import { glyphOf } from './content/glyphs'
import { fontOf } from './content/fonts'
import { useGfx, type Quality } from './gfx'
import { UPGRADE_INFO } from './content/upgrades'
import { MILESTONE_INFO } from './content/milestones'
import { FACET_INFO } from './content/facets'
import { chatterFor } from './content/chatter'
import { BANNER_INFO, rotatingBannerId } from './content/banners'
import { shapeEffect } from './content/effects'
import { generateMessages, stickerSrc, STICKER_COUNT, type ChatMsg } from './content/chatlas'
import { useDialogLog } from './dialogLog'
import { useTitle, titleSrc, TITLE_COUNT } from './titleArt'
import { curatorRank, RANK_COLOR } from './curatorRank'
import { useInspector } from './inspector'
import { useHistory } from './history'
import { useHelp } from './help'
import { OrreryBoard } from './OrreryBoard'
import { Orrery3D } from './three/Orrery3D'
import { Numeral, Tooltip, COLOR } from './ui'
import { useT, useLangStore, LANGS } from './i18n'
import { useHints, useTour } from './onboarding'
import { useMute, sfxUpgrade, sfxCharge, sfxClimbTick, sfxReveal, speak, stopVoice } from './audio'
import { DEV_MODE } from './devmode'
import { Floaters, useFloaters, Sparks, useSparks } from './juice'

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k'
  return Math.floor(n).toLocaleString()
}

// Smoothly count Flux between the 1s WASM ticks (extrapolate from rate; never the source of truth).
function useFluxDisplay(): number {
  const flux = useGame((s) => s.view?.flux ?? 0)
  const rate = useGame((s) => s.view?.rate_per_hr ?? 0)
  const [disp, setDisp] = useState(0)
  const ref = useRef({ base: 0, rate: 0, t: 0 })
  useEffect(() => {
    ref.current = { base: flux, rate, t: performance.now() }
  }, [flux, rate])
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const { base, rate: r, t } = ref.current
      setDisp(base + (r * (performance.now() - t)) / 3_600_000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return disp
}

type Tab = 'engine' | 'workshop' | 'gacha' | 'room' | 'chatlas' | 'gallery' | 'forge' | 'shop' | 'ledger'
const TABS: Tab[] = ['engine', 'workshop', 'gacha', 'room', 'chatlas', 'gallery', 'forge', 'shop', 'ledger']

// Proper line icons per tab (inherit currentColor, so active/inactive nav colour applies). No emoji.
function TabIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, ReactNode> = {
    gacha: <><path d="M6 9.5l2.5-4.5h7L18 9.5l-6 9.5z" /><path d="M6 9.5h12" /><path d="M9.8 5L8.5 9.5 12 19M14.2 5l1.3 4.5L12 19" /></>, // faceted gem
    room: <><path d="M3.5 11L12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5h4v5" /></>, // house + door
    chatlas: <><path d="M4 5.5h16v9H10l-4.5 4v-4H4z" /><path d="M8 9h8M8 11.5h5" /></>, // speech bubble + lines
    gallery: <><rect x="3.5" y="3.5" width="7.3" height="7.3" rx="1.3" /><rect x="13.2" y="3.5" width="7.3" height="7.3" rx="1.3" /><rect x="3.5" y="13.2" width="7.3" height="7.3" rx="1.3" /><rect x="13.2" y="13.2" width="7.3" height="7.3" rx="1.3" /></>, // grid
    engine: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3.3M12 18.2v3.3M2.5 12h3.3M18.2 12h3.3M5.2 5.2l2.3 2.3M16.5 16.5l2.3 2.3M18.8 5.2l-2.3 2.3M7.5 16.5l-2.3 2.3" /></>, // gear
    workshop: <path d="M15 4.5a4 4 0 01-5 5L5 14.5 4 18l3.5-1 5-5a4 4 0 005-5l-2.4 2.4-2.1-.5-.5-2.1z" />, // wrench
    forge: <><path d="M4 20l7.5-7.5" /><path d="M11.5 5.5l7 7-3 3-7-7z" /></>, // hammer
    shop: <><path d="M5 8h14l-1.2 12.5H6.2z" /><path d="M8.8 8V6.2a3.2 3.2 0 016.4 0V8" /></>, // shopping bag
    ledger: <><path d="M4 20.5h16" /><path d="M6.5 20.5V11M11 20.5V5M15.5 20.5v-6M20 20.5V8" /></>, // bar chart
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {paths[tab]}
    </svg>
  )
}

export function App() {
  const { ready, boot } = useGame()
  useEffect(() => {
    void boot()
  }, [boot])
  const [tab, setTab] = useState<Tab>('gacha')
  const inspect = useInspector((s) => s.id)
  const setInspect = useInspector((s) => s.set)
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const tr = useT()

  // Keyboard shortcuts (hints shown on the pull buttons + Settings ▸ Keybinds).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return // don't hijack the search boxes
      const g = useGame.getState()
      const k = e.key.toLowerCase()
      if (k === 'p' || k === ' ') {
        if (g.view?.can_pull) g.pull()
        e.preventDefault()
      } else if (k === 't') {
        if ((g.view?.flux ?? 0) >= 1000) g.tenPull()
      } else if (k === 'm') {
        useMute.getState().toggle()
      } else if (k === 'escape') {
        if (useShips.getState().active) useShips.getState().close()
        else if (g.settingsOpen) g.setSettingsOpen(false)
        else if (g.lastReveal) g.dismissReveal()
        else if (g.lastForge) g.dismissForge()
        else if (g.offline) g.dismissOffline()
        else setInspect(null)
      } else if (k >= '1' && k <= '9') {
        setTab(TABS[Number(k) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return <div style={S.loading}>{tr('boot.lighting')}</div>
  }
  return (
    <div style={{ ...S.app, background: sceneById(sceneId).bg }}>
      <Hud />
      <nav style={S.nav}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(t)} title={`${tr('nav.shortcutTitle')}${i + 1}`} aria-current={tab === t ? 'page' : undefined} style={{ ...S.navBtn, ...(t === 'engine' ? S.navBtnImportant : {}), ...(tab === t ? S.navBtnActive : {}) }}>
            <TabIcon tab={t} />
            <span>{tr(t === 'gacha' ? 'nav.pull' : `nav.${t}`)}</span>
          </button>
        ))}
      </nav>
      <main style={S.main}>
        <div key={tab} className="fade-in">
          {tab === 'gacha' && <GachaView />}
          {tab === 'room' && <RoomView />}
          {tab === 'chatlas' && <ChatlasView />}
          {tab === 'gallery' && <GalleryView onInspect={setInspect} />}
          {tab === 'engine' && <EngineView />}
          {tab === 'workshop' && <WorkshopView />}
          {tab === 'forge' && <ForgeView />}
          {tab === 'shop' && <ShopView />}
          {tab === 'ledger' && <LedgerView />}
        </div>
      </main>
      <RevealModal />
      <ForgeToast />
      <OfflineModal />
      <WelcomeModal />
      {inspect !== null && <Inspector id={inspect} onClose={() => setInspect(null)} />}
      <SettingsModal />
      <ShipCutscene />
      <DialogLogModal />
      <ShipWatcher />
      <Nudge />
      <DevBar />
      <Floaters />
      <Sparks />
      <IdleFlux />
      <MilestoneToast />
      <TourCoachmark tab={tab} setTab={setTab} />
    </div>
  )
}

// Periodic floating "+X ✦" near the HUD Flux counter — the idle-income dopamine drip.
function IdleFlux() {
  const last = useRef<number | null>(null)
  useEffect(() => {
    const t = setInterval(() => {
      const cur = useGame.getState().view?.flux ?? 0
      if (last.current !== null) {
        const gained = cur - last.current
        if (gained > 0.5) useFloaters.getState().spawn(`+${fmt(gained)} ✦`, { color: '#ffcf6b', x: 150, y: 66 })
      }
      last.current = cur
    }, 4000)
    return () => clearInterval(t)
  }, [])
  return null
}

// Dev toolbar — compiled out at release via DEV_MODE (see devmode.ts).
function DevBar() {
  const { devOpen, toggleDev, devAddFlux, devAddShards, devUnlockAll, recrystallize, resetSave } = useGame()
  if (!DEV_MODE || !devOpen) return null
  return (
    <div style={S.devBar}>
      <span style={S.devTitle}>🛠 dev</span>
      <button style={S.devBtn} onClick={devAddFlux}>+10k <span style={S.fluxIcon}>✦</span></button>
      <button style={S.devBtn} onClick={devAddShards}>+2k <span style={S.shardIcon}>◈</span></button>
      <button style={S.devBtn} onClick={devUnlockAll}>Unlock all</button>
      <button style={S.devBtn} onClick={recrystallize}>Recrystallize ↑</button>
      <button style={S.devBtn} onClick={resetSave}>Reset save</button>
      <button style={S.devBtn} onClick={toggleDev}>close ✕</button>
    </div>
  )
}

// One-time, diegetic onboarding hints (the Ledger's voice). Shows the single most-relevant un-dismissed
// nudge for a non-obvious system; the core pull loop gets none (it's intentionally obvious).
function Nudge() {
  const view = useGame((s) => s.view)
  const recipes = useGame((s) => s.recipes)
  const dismissed = useHints((s) => s.dismissed)
  const dismiss = useHints((s) => s.dismiss)
  const tr = useT()
  if (!view) return null
  let id: string | null = null
  if (view.distinct_owned >= 1 && view.loadout.length === 0) id = 'deploy'
  else if (recipes.some((r, i) => view.owned[r.a] > 0 && view.owned[r.b] > 0 && view.shards >= 50 && !view.discovered[i])) id = 'forge'
  else if (view.core_complete) id = 'prestige'
  if (!id || dismissed.includes(id)) return null
  return (
    <div style={S.nudge}>
      <span style={S.nudgeText}>{tr(`nudge.${id}`)}</span>
      <button style={S.nudgeClose} onClick={() => dismiss(id!)}>✕</button>
    </div>
  )
}

// Rich tooltip for the HUD Flux: a live history sparkline + rate + the active production-multiplier breakdown
// (Paradox-style — the useful detail, on hover/tap).
function FluxTooltipContent() {
  const view = useGame((s) => s.view)
  const fluxHistory = useGame((s) => s.fluxHistory)
  const tr = useT()
  if (!view) return null
  const data = fluxHistory.slice(-60)
  let spark: ReactNode = null
  if (data.length >= 2) {
    const w = 200
    const h = 34
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (h - 6) - 3])
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
    spark = (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 34, display: 'block', margin: '6px 0' }} preserveAspectRatio="none">
        <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill="rgba(255,207,107,0.18)" />
        <path d={line} fill="none" stroke={COLOR.gold} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  const mults: [string, number][] = [
    [tr('production.shapeEffects.label'), view.mult_shape_effects],
    [tr('production.synergy.label'), view.mult_synergy],
    [tr('production.genusRes.label'), view.mult_genus_res],
    [tr('production.ballast.label'), view.mult_ballast],
    [tr('production.crossdim.label'), view.mult_crossdim],
    [tr('production.bond.label'), view.mult_bond],
    [tr('production.set.label'), view.mult_set],
    [tr('production.milestone.label'), view.mult_milestone],
    [tr('production.facet.label'), view.mult_facet],
    [tr('production.prestige.label'), view.mult_prestige],
    [tr('production.signature.label'), view.mult_signature],
  ]
  const active = mults.filter(([, m]) => m > 1.0001)
  return (
    <div style={{ minWidth: 210 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: COLOR.gold, fontWeight: 700 }}>
        <span>✦ {tr('hud.flux')}</span>
        <span>+{fmt(view.rate_per_hr)}{tr('hud.perHour')}</span>
      </div>
      {spark}
      {active.length > 0 && (
        <div style={{ borderTop: '1px solid #2c2f3c', marginTop: 2, paddingTop: 4 }}>
          {active.map(([label, m]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 12 }}>
              <span style={{ color: '#9aa0b4' }}>{label}</span>
              <span style={{ color: '#5fe0c6', fontWeight: 700 }}>×{m.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A dismissible help/intro blurb. Tap × to hide it (persisted); Settings ▸ Gameplay reopens all of them.
function HelpNote({ id, children, style }: { id: string; children: ReactNode; style?: CSSProperties }) {
  const dismissed = useHelp((s) => s.dismissed.includes(id))
  const dismiss = useHelp((s) => s.dismiss)
  const tr = useT()
  if (dismissed) return null
  return (
    <div style={{ position: 'relative', paddingRight: 20, ...style }}>
      {children}
      <button onClick={() => dismiss(id)} title={tr('help.hide')} aria-label={tr('help.hide')} style={S.helpClose}>
        ×
      </button>
    </div>
  )
}

function Hud() {
  const view = useGame((s) => s.view)
  const flux = useFluxDisplay()
  const tr = useT()
  const lang = useLangStore((s) => s.lang)
  const setLang = useLangStore((s) => s.setLang)
  const muted = useMute((s) => s.muted)
  const toggleMute = useMute((s) => s.toggle)
  const toggleDev = useGame((s) => s.toggleDev)
  const openSettings = useGame((s) => s.setSettingsOpen)
  // Juice: flash the Flux numeral when a discrete reward lands (jump bigger than a couple seconds of idle drip).
  const fluxTruth = view?.flux ?? 0
  const rate = view?.rate_per_hr ?? 0
  const prevFlux = useRef(fluxTruth)
  const fluxRef = useRef<HTMLSpanElement>(null)
  const [popN, setPopN] = useState(0)
  useEffect(() => {
    const gain = fluxTruth - prevFlux.current
    prevFlux.current = fluxTruth
    if (gain <= Math.max(3, (rate / 3600) * 2.5)) return // ignore the steady idle drip
    setPopN((n) => n + 1)
    // particle burst scaled to the magnitude of the gain, from the counter
    const el = fluxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const mag = Math.log10(Math.max(10, gain)) // ~1 (tens) … ~7 (millions)
    // particles + the "+X" number fire in the SAME frame, from the counter, both scaled to the gain
    useSparks.getState().burst(cx, cy, { count: Math.round(4 + mag * 4), power: Math.min(2.3, 0.5 + mag * 0.32) })
    useFloaters.getState().spawn(`+${fmt(gain)} ✦`, { color: '#ffe1a3', big: gain > 5000, x: cx, y: cy - 6 })
  }, [fluxTruth, rate])
  // Shards: a cyan burst when they tick up (dupe pulls / forge refunds). No drip, so any gain fires.
  const shardTruth = view?.shards ?? 0
  const prevShard = useRef(shardTruth)
  const shardRef = useRef<HTMLSpanElement>(null)
  const [shardPop, setShardPop] = useState(0)
  useEffect(() => {
    const gain = shardTruth - prevShard.current
    prevShard.current = shardTruth
    if (gain <= 0) return
    setShardPop((n) => n + 1)
    const el = shardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const mag = Math.log10(Math.max(2, gain))
    useSparks.getState().burst(cx, cy, { count: Math.round(4 + mag * 4), power: Math.min(2, 0.5 + mag * 0.4), hues: ['#eafcff', '#a6e6ff', '#5ad4ff', '#3aa6e0'] })
    useFloaters.getState().spawn(`+${fmt(gain)} ◈`, { color: '#9fe6ff', x: cx, y: cy - 6 })
  }, [shardTruth])
  if (!view) return null
  return (
    <header style={S.hud}>
      <Tooltip content={<FluxTooltipContent />}>
        <div style={{ cursor: 'help' }}>
          <span style={S.fluxLabel}><span style={S.fluxIcon}>✦</span> {tr('hud.flux')}</span>
          <span ref={fluxRef} key={popN} className="value-pop" style={S.fluxValue}>{fmt(flux)}</span>
          <span style={S.rate}>+<Numeral value={view.rate_per_hr} format={fmt} />{tr('hud.perHour')}</span>
        </div>
      </Tooltip>
      <div style={S.hudStats}>
        <Tooltip content={<span style={{ fontSize: 12.5 }}>{tr('hud.shardsTip')}</span>}>
          <span style={{ cursor: 'help' }}><span ref={shardRef} key={shardPop} className="value-pop" style={{ display: 'inline-block' }}><span style={S.shardIcon}>◈</span> <Numeral value={view.shards} format={fmt} /></span> {tr('hud.shards')}</span>
        </Tooltip>
        <Tooltip content={<span style={{ fontSize: 12.5 }}>{tr('hud.collectionTip')}</span>}>
          <span style={{ cursor: 'help' }}>{tr('hud.collection')} {view.distinct_owned}/41</span>
        </Tooltip>
        <Tooltip content={<span style={{ fontSize: 12.5 }}>{tr('hud.dimTip')}</span>}>
          <span style={{ cursor: 'help' }}>{tr('hud.dim')} v{view.viewport_dim}{view.ng_cycle > 0 ? ` · NG+${view.ng_cycle}` : ''}</span>
        </Tooltip>
        {view.facets > 0 && <span title={tr('hud.facetsTip')}>🌌 {view.facets}</span>}
        <button onClick={toggleMute} style={S.langBtn} aria-label={tr('hud.muteAria')} title={tr('common.toggleSound')}>{muted ? '🔇' : '🔊'}</button>
        <button onClick={() => useDialogLog.getState().setOpen(true)} style={S.langBtn} aria-label={tr('hud.dialogLogAria')} title={tr('hud.dialogLogTip')}>📜</button>
        <button onClick={() => openSettings(true)} style={S.langBtn} aria-label={tr('hud.settingsAria')} title={tr('hud.settingsTip')}>⚙</button>
        {DEV_MODE && <button onClick={toggleDev} style={S.langBtn} aria-label="dev tools" title="Dev tools (compiled out at release)">🛠</button>}
        <span style={S.langSwitch}>
          {LANGS.map((l) => (
            <button key={l.id} onClick={() => setLang(l.id)} style={{ ...S.langBtn, ...(lang === l.id ? S.langBtnOn : {}) }}>
              {l.label}
            </button>
          ))}
        </span>
      </div>
    </header>
  )
}

// The next 2–3 concrete goals (nearest-to-complete incomplete milestones), with progress bars.
function Objectives() {
  const { view, milestoneDefs } = useGame()
  const tr = useT()
  if (!view || milestoneDefs.length === 0) return null
  const prog = (key: string): [number, number] => {
    switch (key) {
      case 'own_10': return [view.distinct_owned, 10]
      case 'own_25': return [view.distinct_owned, 25]
      case 'core_complete': return [view.distinct_owned, 41]
      case 'forge_3': return [view.discovered.filter(Boolean).length, 3]
      case 'bond_5': return [view.bond_levels.length ? Math.max(...view.bond_levels) : 0, 5]
      case 'kin_3': return [view.active_synergies, 3]
      case 'all_relics': return [view.relics_owned, view.relic_count]
      case 'platonic': return [[1, 2, 3, 4, 5].filter((id) => view.owned[id] > 0).length, 5]
      case 'ascend': return [view.ng_cycle >= 1 ? 1 : 0, 1]
      default: return [0, 1]
    }
  }
  const items = milestoneDefs
    .map((m, i) => ({ key: m.key, done: view.milestones_done[i] }))
    .filter((x) => !x.done)
    .map((x) => { const [cur, target] = prog(x.key); return { ...x, cur, target, pct: Math.min(1, cur / target) } })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
  if (items.length === 0) return null
  return (
    <div style={S.objectives}>
      <div style={S.objHead}>{tr('objectives.heading')}</div>
      {items.map((x) => {
        const info = MILESTONE_INFO[x.key] ?? { name: x.key, icon: '★' }
        return (
          <div key={x.key} style={S.objRow}>
            <span style={{ fontSize: 15 }}>{info.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.objLabel}>{info.name}</div>
              <div style={S.meterTrack}><div style={{ ...S.meterFill, width: `${x.pct * 100}%`, background: '#5fe0c6', color: '#5fe0c6' }} /></div>
            </div>
            <span style={S.objNum}>{Math.min(x.cur, x.target)}/{x.target}</span>
          </div>
        )
      })}
    </div>
  )
}

// A tappable flavour-dialog bubble (gacha "my room" chatter). Auto-dismisses; tap to close.
type Bubble = { nick: string; line: string; color: string }
function SpeechBubble({ bubble, onClose }: { bubble: Bubble; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble])
  return (
    <div className="bubble-in" style={S.bubble} onClick={onClose}>
      <div style={{ ...S.bubbleNick, color: bubble.color }}>{bubble.nick}</div>
      <div>{bubble.line}</div>
    </div>
  )
}

// Cycles a shape's flavour lines on each tap, shows a bubble + speaks it in the character's voice.
function useChatter() {
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const idx = useRef(0)
  const talk = (shape: ShapeRow | undefined, bond: number) => {
    if (!shape) return
    const lines = chatterFor(shape.family, bond)
    const line = lines[idx.current % lines.length]
    idx.current += 1
    const color = RARITY_COLOR[shape.rarity]
    setBubble({ nick: shape.nick, line, color })
    useDialogLog.getState().log({ nick: shape.nick, line, color })
    speak(shape.family, line)
  }
  return { bubble, setBubble, talk }
}

// Occasionally trigger an unprompted line (idle chatter). Self-schedules every ~18–38s; runs only while the
// hosting screen is mounted (so it only chatters on the tab you're looking at). Calls the latest fn each time.
function useIdleChatter(fire: () => void) {
  const ref = useRef(fire)
  ref.current = fire
  useEffect(() => {
    let to: ReturnType<typeof setTimeout>
    const schedule = () => {
      to = setTimeout(() => {
        ref.current()
        schedule()
      }, 18000 + Math.random() * 20000)
    }
    schedule()
    return () => clearTimeout(to)
  }, [])
}

// Banner picker: Standard (always) + the currently-featured themed banner (rotates daily). Selecting sets
// the rate-up steering in the core; a stale selection (a themed banner that rotated out) resets to Standard.
// Live countdown to the next banner rotation (banners rotate at the UTC-day boundary).
function BannerCountdown() {
  const tr = useT()
  const [ms, setMs] = useState(() => 86_400_000 - (Date.now() % 86_400_000))
  useEffect(() => {
    const id = setInterval(() => setMs(86_400_000 - (Date.now() % 86_400_000)), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return (
    <div style={S.bannerTimer} title={tr('banner.rotateTip')}>
      ⏳ {tr('banner.rotatesIn')} {pad(h)}:{pad(m)}:{pad(s)}
    </div>
  )
}

function BannerSelector() {
  const { bannerDefs, view, setBanner, shapes } = useGame()
  const tr = useT()
  const themedCount = Math.max(0, bannerDefs.length - 1)
  const rotId = rotatingBannerId(Date.now(), themedCount)
  const offered = [0, rotId]
  useEffect(() => {
    if (view && !offered.includes(view.current_banner)) setBanner(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.current_banner, rotId])
  if (bannerDefs.length === 0 || !view) return null
  return (
    <div style={S.bannerRow}>
      {offered.map((bid) => {
        const def = bannerDefs[bid]
        if (!def) return null
        const info = BANNER_INFO[def.key] ?? { name: def.key, blurb: '', icon: '✦' }
        const sel = view.current_banner === bid
        return (
          <button key={bid} onClick={() => setBanner(bid)} style={{ ...S.bannerCard, ...(sel ? S.bannerCardOn : {}) }} title={info.blurb}>
            <div style={S.bannerName}>
              {info.icon} {info.name}
              {def.rotating ? <span style={S.bannerRotate}> 🔥 {tr('banner.rateUp')}</span> : null}
            </div>
            <div style={S.bannerFeat}>
              {def.featured.length === 0 ? (
                <span style={{ color: '#8a90a8', fontSize: 11 }}>{tr('banner.fullPool')}</span>
              ) : (
                def.featured.slice(0, 6).map((id) => (
                  <span key={id} style={{ fontSize: 15 }}>{glyphOf(shapes[id]?.family ?? '')}</span>
                ))
              )}
            </div>
            {def.rotating && <BannerCountdown />}
          </button>
        )
      })}
    </div>
  )
}

function GachaView() {
  const { view, pull, tenPull, shapes, lastReveal, autoPull, toggleAutoPull, secretaryId, bannerDefs } = useGame()
  const tr = useT()
  const { bubble, setBubble, talk } = useChatter()
  // On a themed banner, the preview shows its featured spotlight (the rate-up headline); Standard shows your
  // secretary / last pull / Pip.
  const bannerDef = view ? bannerDefs[view.current_banner] : undefined
  const featuredId = bannerDef && bannerDef.featured.length ? bannerDef.featured[bannerDef.featured.length - 1] : null
  const isBannerPreview = featuredId != null
  const focusId = isBannerPreview
    ? (featuredId as number)
    : secretaryId != null && (view?.owned[secretaryId] ?? 0) > 0
      ? secretaryId
      : lastReveal?.[0]?.shape_id ?? 0
  const shape = shapes[focusId] ?? shapes[0]
  const owned = !!view && (view.owned[focusId] ?? 0) > 0
  const bond = view?.bond_levels[focusId] ?? 0
  useIdleChatter(() => {
    if (shape && view && owned && !isBannerPreview) talk(shape, bond)
  })
  const [sub, setSub] = useState<'goals' | 'history'>('goals')
  if (!view) return null
  return (
    <div className="gacha-split">
      <div className="gacha-stage" style={S.stageWrap}>
        {shape && <HeroView key={shape.family} family={shape.family} rarity={shape.rarity} controls />}
        {shape && (
          <div style={S.focusName}>
            {shape.nick} <em style={S.focusFam}>· {shape.family.replace(/_/g, ' ')}</em>
            {isBannerPreview ? (
              <span style={{ color: '#ff9d6b', fontSize: 12, fontWeight: 700 }}> 🔥 {tr('gacha.featured')}</span>
            ) : secretaryId === focusId ? (
              <span style={S.secretaryTag}> ★ {tr('gacha.secretaryTag')}</span>
            ) : null}
          </div>
        )}
        {shape &&
          (() => {
            const e = shapeEffect(shape.family, shape.genus, shape.euler_cost)
            return (
              <button style={S.effectPreview} onClick={() => useInspector.getState().set(focusId)} title={`${e.name} — ${e.desc}\n${tr('gacha.effectTooltip')}`}>
                <span>{e.icon}</span>
                <span style={{ fontWeight: 700 }}>{e.name}</span>
                <span style={{ color: '#8a90a8' }}>· {tr('gacha.details')}</span>
              </button>
            )
          })()}
        {shape && owned && !isBannerPreview && <button className="ready-pulse" style={S.talkBtn} onClick={() => talk(shape, bond)} title={tr('gacha.talkTooltip')}>💬</button>}
        {bubble && <SpeechBubble bubble={bubble} onClose={() => setBubble(null)} />}
      </div>
      <div className="gacha-controls">
        <BannerSelector />
        <div style={S.pitymeters}>
          <Meter label={`${tr('pull.pity')} ${view.pity_since_top}/30`} pct={view.pity_since_top / 30} color="#ffb86b" />
          <Meter label={`${tr('pull.resonance')} ${view.resonance}/40`} pct={view.resonance / 40} color="#ff5d8f" />
        </div>
        <div style={S.pullRow}>
          <button className={`pull-cap ${view.can_pull ? 'ready-pulse' : ''}`} title={tr('pull.oneShortcut')} style={{ ...S.pullBtn, opacity: view.can_pull ? 1 : 0.4 }} disabled={!view.can_pull} onClick={pull}>
            {tr('pull.one')} <kbd style={S.kbd}>P</kbd>
          </button>
          <button className="pull-cap" title={tr('pull.tenShortcut')} style={{ ...S.pullBtn10, opacity: view.flux >= 1000 ? 1 : 0.4 }} disabled={view.flux < 1000} onClick={tenPull}>
            {tr('pull.ten')} <kbd style={S.kbd}>T</kbd>
          </button>
        </div>
        <HelpNote id="help.pull"><p style={S.hint}>{tr('pull.hint')}</p></HelpNote>
        {view.upgrades[8] > 0 && (
          <button
            onClick={toggleAutoPull}
            title={tr('pull.autoTooltip')}
            style={{ ...S.smallBtn, alignSelf: 'flex-start', ...(autoPull ? S.toggleOn : {}) }}
          >
            🤖 {tr('pull.autoLabel')} · {autoPull ? tr('common.on') : tr('common.off')}
          </button>
        )}
        <div style={S.subTabs}>
          <button style={{ ...S.subTab, ...(sub === 'goals' ? S.subTabOn : {}) }} onClick={() => setSub('goals')}>{tr('pull.goals')}</button>
          <button style={{ ...S.subTab, ...(sub === 'history' ? S.subTabOn : {}) }} onClick={() => setSub('history')}>{tr('pull.history')}</button>
        </div>
        {sub === 'goals' ? <Objectives /> : <PullHistory />}
      </div>
    </div>
  )
}

// The gacha pull history — a persisted log of what you've pulled (newest first), rarity-coloured.
function PullHistory() {
  const pulls = useHistory((s) => s.pulls)
  const tr = useT()
  if (!pulls.length) return <p style={S.hint}>{tr('pull.history.empty')}</p>
  return (
    <div style={S.histList}>
      {pulls.map((p, i) => (
        <div key={i} style={S.histRow}>
          <span style={{ ...S.tileDot, background: RARITY_COLOR[p.rarity] }} />
          <span style={{ flex: 1, color: '#cdd2e0' }}>{p.nick}</span>
          <span style={{ color: RARITY_COLOR[p.rarity], fontWeight: 700, fontSize: 12 }}>{p.rarity}</span>
          {p.isNew && <span style={{ color: '#ff5d8f', fontSize: 11, fontWeight: 800 }}>{tr('pull.history.new')}</span>}
        </div>
      ))}
    </div>
  )
}

// Session events feed (forges, relics, prestige…), shown at the foot of the Ledger.
function EventLog() {
  const events = useHistory((s) => s.events)
  const tr = useT()
  return (
    <>
      <h4 style={S.boardSub}>{tr('ledger.events')}</h4>
      {events.length === 0 ? (
        <p style={S.hint}>{tr('ledger.events.empty')}</p>
      ) : (
        <div style={S.histList}>
          {events.map((e, i) => (
            <div key={i} style={S.histRow}>
              <span>{e.icon}</span>
              <span style={{ flex: 1, color: e.color ?? '#cdd2e0' }}>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// Pick the room's cast for a given 30-min window: the secretary (always) + a deterministic, seeded selection
// of owned shapes. Seeded by the epoch so the cast is STABLE within the window and rotates at each boundary.
function rosterForEpoch(ownedIds: number[], secretaryId: number | null, epoch: number, n: number): number[] {
  let seed = (epoch * 2654435761) >>> 0
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pool = ownedIds.filter((id) => id !== secretaryId)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const out: number[] = []
  if (secretaryId != null && ownedIds.includes(secretaryId)) out.push(secretaryId)
  for (const id of pool) {
    if (out.length >= n) break
    out.push(id)
  }
  return out
}

// The lobby ("My Room"): your shapes roam a cozy floor; tap to chat + a tiny bond boost. Scene re-skins it.
// The cast is fixed per 30-min real-time window (rotates at the top of each), so shapes don't churn as you play.
function RoomView() {
  const shapes = useGame((s) => s.shapes)
  const view = useGame((s) => s.view)
  const pat = useGame((s) => s.pat)
  const secretaryId = useGame((s) => s.secretaryId)
  const tr = useT()
  const { bubble, setBubble, talk } = useChatter()
  const cooldown = useRef<Record<number, number>>({})
  const epoch = Math.floor(Date.now() / 1_800_000) // 30-minute real-time window
  const ownedIds = view ? shapes.filter((s) => view.owned[s.id] > 0).map((s) => s.id) : []
  const roster = useMemo(
    () => rosterForEpoch(ownedIds, secretaryId, epoch, 7).map((id) => shapes[id]).filter(Boolean) as ShapeRow[],
    // snapshot per window (+ when the secretary changes, or the first shape is ever owned) — NOT every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch, secretaryId, ownedIds.length === 0],
  )
  useIdleChatter(() => {
    if (roster.length && view) {
      const s = roster[Math.floor(Math.random() * roster.length)]
      talk(s, view.bond_levels[s.id] ?? 0)
    }
  })
  if (!view) return null
  const onTap = (id: number) => {
    talk(shapes[id], view.bond_levels[id] ?? 0)
    const now = performance.now()
    if (!cooldown.current[id] || now - cooldown.current[id] > 1500) {
      cooldown.current[id] = now
      pat(id) // minor bond + the store's bond-up celebration
    }
  }
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('room.title')}</h3>
        <HelpNote id="help.room"><p style={S.boardDesc}>{tr('room.desc')}</p></HelpNote>
      </div>
      <div style={{ ...S.floorWrap, height: 380 }}>
        {roster.length > 0 ? (
          <RoomScene roster={roster} secretaryId={secretaryId} onTap={onTap} />
        ) : (
          <div style={S.floorTag}>{tr('room.moveIn')}</div>
        )}
        {bubble && <SpeechBubble bubble={bubble} onClose={() => setBubble(null)} />}
        {!bubble && roster.length > 0 && <div style={S.floorTag}>{tr('room.tapHint')}</div>}
      </div>
    </div>
  )
}

// The player's Curator Rank badge (F → … → SS → ?). Derived from collection progress; display-only.
function CuratorBadge({ compact = false }: { compact?: boolean }) {
  const view = useGame((s) => s.view)
  const tr = useT()
  if (!view) return null
  const { rank, score, next, toNext } = curatorRank(view)
  const col = RANK_COLOR[rank] ?? '#8a90a8'
  return (
    <div
      style={S.rankBadge}
      title={`Curator score ${score}${next ? ` · ${toNext} to rank ${next}` : ' · apex rank'} — from collection, relics, recipes, maxed bonds & prestige.`}
    >
      <span style={{ ...S.rankLetter, color: col, borderColor: col, background: `radial-gradient(circle at 50% 30%, ${col}22, #0e0f17)`, boxShadow: `0 0 12px ${col}55, inset 0 1px 2px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.15)` }}>{rank}</span>
      {!compact && (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span style={{ fontSize: 10.5, color: '#8a90a8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('rank.label')}</span>
          <span style={{ fontSize: 12, color: '#cdd2e0' }}>{next ? tr('rank.toNext', { toNext, next }) : tr('rank.apex')}</span>
        </span>
      )}
    </div>
  )
}

// Chatlas — the curators' procgen group chat. New lines drift in over time + auto-scroll (a living feed).
function ChatlasView() {
  const shapes = useGame((s) => s.shapes)
  const view = useGame((s) => s.view)
  const tr = useT()
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const ownedIds = view ? shapes.filter((s) => view.owned[s.id] > 0).map((s) => s.id) : []
    setMsgs(generateMessages(shapes, ownedIds, 16))
    const id = setInterval(() => setMsgs((m) => [...m.slice(-50), ...generateMessages(shapes, ownedIds, 1)]), 7000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes.length])
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={S.boardTitle}>{tr('chatlas.title')}</h3>
          <CuratorBadge />
        </div>
        <HelpNote id="help.chatlas"><p style={S.boardDesc}>{tr('chatlas.desc')}</p></HelpNote>
      </div>
      <div ref={ref} style={S.chatFeed}>
        {msgs.map((m, i) => (
          <div key={i} className="fade-in" style={S.chatMsg}>
            <span style={{ ...S.chatHandle, color: m.color }}>@{m.handle}</span>
            {m.sticker ? <img src={stickerSrc(m.sticker)} alt="sticker" style={S.chatSticker} /> : <span style={S.chatText}>{m.text}</span>}
          </div>
        ))}
      </div>
      <div style={S.stickerBar}>
        {Array.from({ length: STICKER_COUNT }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            style={S.stickerPick}
            title={tr('chatlas.stickerTooltip')}
            onClick={() => setMsgs((m) => [...m.slice(-60), { handle: 'you', color: '#ffffff', text: '', sticker: n }])}
          >
            <img src={stickerSrc(n)} alt={`sticker ${n}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </button>
        ))}
      </div>
    </div>
  )
}

function GalleryView({ onInspect }: { onInspect: (id: number) => void }) {
  const { shapes, view } = useGame()
  const tr = useT()
  const [q, setQ] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  if (!view) return null
  const ql = q.trim().toLowerCase()
  const toggle = (r: string) => setHidden((h) => { const n = new Set(h); n.has(r) ? n.delete(r) : n.add(r); return n })
  return (
    <div style={S.gallery}>
      <div style={S.galleryControls}>
        <input style={S.search} placeholder={tr('gallery.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={S.filterChips}>
          {RARITY_ORDER.map((r) => (
            <button key={r} onClick={() => toggle(r)} title={tr('gallery.toggleTooltip', { r })}
              style={{ ...S.filterChip, borderColor: RARITY_COLOR[r], opacity: hidden.has(r) ? 0.35 : 1, color: hidden.has(r) ? '#6b7088' : RARITY_COLOR[r] }}>
              {hidden.has(r) ? '○' : '●'} {r === 'Ssr' ? tr('rarity.ssr') : r === 'Ur' ? tr('rarity.ur') : r === 'Relic' ? tr('rarity.relicsShort') : r}
            </button>
          ))}
        </div>
      </div>
      {RARITY_ORDER.filter((r) => !hidden.has(r)).map((r) => {
        const tiles = shapes.filter((s) => s.rarity === r && (!ql || (view.owned[s.id] > 0 && s.nick.toLowerCase().includes(ql))))
        if (ql && tiles.length === 0) return null
        return (
        <section key={r}>
          <h3 style={{ ...S.tierHead, color: RARITY_COLOR[r] }}>{r === 'Ssr' ? tr('rarity.ssr') : r === 'Ur' ? tr('rarity.ur') : r === 'Relic' ? tr('rarity.referenceWing') : r}</h3>
          <div style={S.grid}>
            {tiles.map((s) => {
              const owned = view.owned[s.id] > 0
              return (
                <button key={s.id} onClick={() => onInspect(s.id)} className="chip"
                  style={{ ...S.tile, borderColor: owned ? RARITY_COLOR[r] : '#23252f', color: owned ? '#fff' : '#555', background: owned ? `${RARITY_COLOR[r]}14` : 'linear-gradient(180deg,#15161f,#0e0f16)', boxShadow: owned ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.4), 0 0 10px ${RARITY_COLOR[r]}33` : 'inset 0 2px 5px rgba(0,0,0,0.55)' }}>
                  <span style={S.tileGlyph}>{owned ? glyphOf(s.family) : '❓'}</span>
                  {owned ? s.nick : tr('gallery.unknownTile')}
                  {(view.star_levels[s.id] ?? 0) > 0 ? (
                    <span style={S.starBadge} title={tr('gallery.starTooltip', { level: view.star_levels[s.id], copies: view.owned[s.id] })}>{'★'.repeat(view.star_levels[s.id])}</span>
                  ) : (
                    view.owned[s.id] > 1 && <span style={S.dupe}>×{view.owned[s.id]}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
        )
      })}
    </div>
  )
}

// Facets — the prestige meta-tree, bought with Facets earned by recrystallizing. Persists across all NG+.
function FacetsPanel() {
  const { view, facetDefs, buyFacetPerk } = useGame()
  const tr = useT()
  const [popped, setPopped] = useState<string | null>(null)
  if (!view || (view.ng_cycle === 0 && view.facets === 0)) return null // hidden until the first ascent
  const onBuy = (e: { currentTarget: HTMLElement }, i: number, key: string) => {
    const before = useGame.getState().view?.facet_perks[i] ?? 0
    buyFacetPerk(i)
    const after = useGame.getState().view?.facet_perks[i] ?? before
    if (after <= before) return
    sfxUpgrade(3 + after)
    const info = FACET_INFO[key] ?? { icon: '🌌', name: key }
    const r = e.currentTarget.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + 4
    for (let k = 0; k < 9; k++) useFloaters.getState().spawn(info.icon, { x: cx, y: cy, color: '#b388ff', big: true })
    useFloaters.getState().spawn(`${info.name} ↑`, { x: cx, y: cy - 26, color: '#d8b4ff', big: true })
    setPopped(key)
    setTimeout(() => setPopped(null), 460)
  }
  return (
    <>
      <h4 style={S.boardSub}>{tr('facets.heading', { n: view.facets })}</h4>
      <div style={S.recipeGrid}>
        {facetDefs.map((f, i) => {
          const lvl = view.facet_perks[i] ?? 0
          const maxed = lvl >= f.max_level
          const cost = view.facet_perk_costs[i] ?? 0 // cost is Rust truth, not recomputed
          const can = !maxed && view.facets >= cost
          const info = FACET_INFO[f.key] ?? { name: f.key, desc: '', icon: '🌌' }
          return (
            <div key={f.key} className={popped === f.key ? 'chip upgrade-pop' : 'chip'} style={{ ...S.recipeCard, borderColor: lvl > 0 ? '#b388ff' : '#2a2440' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 18 }}>{info.icon}</span>
                <strong style={{ color: '#e8eaf2' }}>{info.name}</strong>
                {f.max_level > 1 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8a90a8' }}>{tr('common.lvFraction', { lvl, max: f.max_level })}</span>}
              </div>
              <p style={{ ...S.boardDesc, margin: 0, fontSize: 12 }}>{info.desc}</p>
              <button className="forge-cap" style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={(e) => onBuy(e, i, f.key)}>
                {maxed ? tr('common.maxed') : tr('facets.buy', { cost })}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

// The Workshop — permanent, rule-changing upgrades bought with banked Flux (+ some Shards).
function UpgradesPanel() {
  const { view, upgradeDefs, buyUpgrade } = useGame()
  const tr = useT()
  const [popped, setPopped] = useState<string | null>(null)
  if (!view) return null
  // Juice scaled to the upgrade's cost/level: sound climbs, an icon burst + a "Name ↑" pop fire from the button.
  const onBuy = (e: { currentTarget: HTMLElement }, i: number, key: string, flux: number) => {
    const before = useGame.getState().view?.upgrades[i] ?? 0
    buyUpgrade(i)
    const after = useGame.getState().view?.upgrades[i] ?? before
    if (after <= before) return
    const tier = flux > 6000 ? 3 : flux > 3000 ? 2 : 1
    sfxUpgrade(tier + Math.min(2, after))
    const info = UPGRADE_INFO[key] ?? { icon: '⚙', name: key }
    const r = e.currentTarget.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + 4
    for (let k = 0; k < tier * 5; k++) useFloaters.getState().spawn(info.icon, { x: cx, y: cy, color: '#5fe0c6', big: tier === 3 })
    useFloaters.getState().spawn(`${info.name} ↑`, { x: cx, y: cy - 26, color: '#9ef0ff', big: true })
    setPopped(key)
    setTimeout(() => setPopped(null), 460)
  }
  return (
    <>
      <h4 style={S.boardSub}>{tr('workshop.upgradesHeading')}</h4>
      <div style={S.recipeGrid}>
        {upgradeDefs.map((u, i) => {
          const lvl = view.upgrades[i] ?? 0
          const unlocked = view.upgrade_unlocked[i] ?? true
          const info = UPGRADE_INFO[u.key] ?? { name: u.key, desc: '', icon: '⚙' }
          // Tech tree: secret nodes stay hidden until unlocked; the rest tease as a locked card.
          if (!unlocked && u.secret) return null
          if (!unlocked) {
            const req = u.requires
            const reqInfo = req ? UPGRADE_INFO[upgradeDefs[req[0]]?.key] ?? { name: upgradeDefs[req[0]]?.key } : undefined
            return (
              <div key={u.key} className="chip" style={{ ...S.recipeCard, borderColor: '#23252f', opacity: 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 18, filter: 'grayscale(1)' }}>🔒</span>
                  <strong style={{ color: '#8a90a8' }}>{info.name}</strong>
                </div>
                <p style={{ ...S.boardDesc, margin: 0, fontSize: 12 }}>{info.desc}</p>
                <div style={{ ...S.chipMeta, color: '#ff9d6b', marginTop: 4 }}>
                  {tr('workshop.requires', { name: reqInfo?.name ?? '' })}{req && req[1] > 1 ? tr('workshop.requiresLevel', { level: req[1] }) : ''}
                </div>
              </div>
            )
          }
          const maxed = lvl >= u.max_level
          const [flux, shards] = view.upgrade_costs[i] ?? [0, 0] // costs are Rust truth, not recomputed
          const can = !maxed && view.flux >= flux && view.shards >= shards
          return (
            <div key={u.key} className={popped === u.key ? 'chip upgrade-pop' : 'chip'} style={{ ...S.recipeCard, borderColor: lvl > 0 ? '#5fe0c6' : '#23252f' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 18 }}>{info.icon}</span>
                <strong style={{ color: '#e8eaf2' }}>{info.name}</strong>
                {u.max_level > 1 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8a90a8' }}>{tr('common.lvFraction', { lvl, max: u.max_level })}</span>}
              </div>
              <p style={{ ...S.boardDesc, margin: 0, fontSize: 12 }}>{info.desc}</p>
              <button className="forge-cap" style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={(e) => onBuy(e, i, u.key, flux)}>
                {maxed ? tr('common.maxed') : (
                  <>{tr('workshop.buy')}{fmt(flux)} <span style={S.fluxIcon}>✦</span>{shards > 0 ? <> + {shards} <span style={S.shardIcon}>◈</span></> : null}</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

// A mini gem chip for forge recipes / flows.
function GemChip({ shape, show }: { shape: ShapeRow | undefined; show: boolean }) {
  return (
    <div style={S.gemChip}>
      <span style={{ ...S.gemChipDot, background: show && shape ? RARITY_COLOR[shape.rarity] : '#2a2c3a' }} />
      <span style={S.gemChipName}>{show && shape ? shape.nick : '???'}</span>
    </div>
  )
}

// Active production multipliers — the combos + topology effects made visible. Values come straight from the
// Rust view (the truth); the UI only displays them. Shows just the multipliers currently doing something.
function ProductionBreakdown() {
  const view = useGame((s) => s.view)
  const tr = useT()
  if (!view) return null
  const rows: { label: string; mult: number; note?: string }[] = [
    { label: tr('production.shapeEffects.label'), mult: view.mult_shape_effects, note: tr('production.shapeEffects.note') },
    { label: tr('production.signature.label'), mult: view.mult_signature, note: tr('production.signature.note') },
    { label: tr('production.synergy.label'), mult: view.mult_synergy, note: view.active_synergies > 0 ? tr('production.synergy.notePair', { count: view.active_synergies }).replace('{count===1?\'\':\'s\'}', view.active_synergies === 1 ? '' : 's') : undefined },
    { label: tr('production.genusRes.label'), mult: view.mult_genus_res },
    { label: tr('production.ballast.label'), mult: view.mult_ballast },
    { label: tr('production.crossdim.label'), mult: view.mult_crossdim },
    { label: tr('production.bond.label'), mult: view.mult_bond },
    { label: tr('production.set.label'), mult: view.mult_set },
    { label: tr('production.milestone.label'), mult: view.mult_milestone },
    { label: tr('production.facet.label'), mult: view.mult_facet },
    { label: tr('production.prestige.label'), mult: view.mult_prestige },
  ]
  const active = rows.filter((r) => r.mult > 1.0001)
  if (active.length === 0) return null
  return (
    <>
      <h4 style={S.boardSub}>{tr('production.activeHeading', { count: active.length })}</h4>
      <div style={S.multGrid}>
        {active.map((r) => (
          <div key={r.label} className="chip" style={S.multRow}>
            <span style={{ color: '#cdd2e0', fontSize: 13 }}>
              {r.label}
              {r.note ? <span style={{ color: '#8a90a8', fontSize: 11 }}> · {r.note}</span> : null}
            </span>
            <span style={{ color: '#5fe0c6', fontWeight: 800 }}>×{r.mult.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// The Workshop is now its own tab: permanent Flux/Shard upgrades + the Facets prestige tree.
function WorkshopView() {
  const view = useGame((s) => s.view)
  const tr = useT()
  if (!view) return null
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('workshop.title')}</h3>
        <HelpNote id="help.workshop"><p style={S.boardDesc}>{tr('workshop.intro')}</p></HelpNote>
      </div>
      <FacetsPanel />
      <UpgradesPanel />
    </div>
  )
}

// The spatial puzzle board: a W×H grid. Tap a stored shape to pick it up, tap a cell to place; tap a placed
// shape to pick it up, tap its own cell to remove. Adjacency (kin synergy, knot entanglement) is 2D.
function BoardGrid({ sel, setSel }: { sel: number | null; setSel: (id: number | null) => void }) {
  const shapes = useGame((s) => s.shapes)
  const view = useGame((s) => s.view)
  const placeAt = useGame((s) => s.placeAt)
  const undeploy = useGame((s) => s.undeploy)
  const tr = useT()
  if (!view) return null
  const W = view.board_w
  const H = view.board_h
  const cellShape: (number | null)[] = Array(W * H).fill(null)
  view.loadout.forEach((id, i) => {
    const c = view.board_cells[i]
    if (c != null && c < W * H) cellShape[c] = id
  })
  const onCell = (cell: number) => {
    const occ = cellShape[cell]
    if (sel != null) {
      if (occ === sel) {
        undeploy(sel)
        setSel(null)
      } else {
        placeAt(sel, cell)
        setSel(null)
      }
    } else if (occ != null) {
      setSel(occ)
    }
  }
  return (
    <div style={{ ...S.boardGrid, gridTemplateColumns: `repeat(${W}, 1fr)` }}>
      {Array.from({ length: W * H }, (_, cell) => {
        const id = cellShape[cell]
        const s = id != null ? shapes[id] : null
        const selected = sel != null && id === sel
        return (
          <button
            key={cell}
            onClick={() => onCell(cell)}
            title={s ? s.nick : tr('board.emptyCell')}
            style={{ ...S.boardCell, borderColor: s ? RARITY_COLOR[s.rarity] : '#23252f', background: selected ? '#33384e' : s ? '#171922' : 'linear-gradient(180deg, #14151e, #0e0f17)', boxShadow: selected ? '0 0 10px #5fe0c6, inset 0 0 0 1px #5fe0c6' : s ? `inset 0 0 10px -2px ${RARITY_COLOR[s.rarity]}, 0 0 0 1px ${RARITY_COLOR[s.rarity]}` : 'inset 0 1px 2px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(120,130,160,0.06)' }}
          >
            {s ? <span style={{ fontSize: 'clamp(14px, 5vw, 22px)' }}>{glyphOf(s.family)}</span> : sel != null ? <span style={{ color: '#5fe0c6', opacity: 0.5 }}>+</span> : ''}
          </button>
        )
      })}
    </div>
  )
}

function EngineView() {
  const { shapes, view, autoArrange, recrystallize, tapShape } = useGame()
  const tr = useT()
  const { bubble, setBubble, talk } = useChatter()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<number | null>(null) // shape selected to place/move on the board
  const [orrery3d, setOrrery3d] = useState(true) // 3D orrery by default; 2D clock-ring is a toggle
  if (!view) return null
  // Tapping a PLACED gem on the floor polishes it: a little Flux (clicker bootstrap) + a line of dialogue.
  const onTap = (sid: number, x: number, y: number) => {
    const r = tapShape(sid)
    if (r > 0) {
      sfxClimbTick(0)
      useFloaters.getState().spawn(`+${Math.round(r)} ✦`, { color: '#ffd76b', x, y: y - 12 })
    }
    talk(shapes[sid], view.bond_levels[sid] ?? 0)
  }
  const owned = shapes.filter((s) => view.owned[s.id] > 0)
  const ql = q.trim().toLowerCase()
  const bench = owned.filter((s) => !view.loadout.includes(s.id) && (!ql || s.nick.toLowerCase().includes(ql) || s.family.includes(ql)))
  const pct = view.euler_cap ? view.euler_used / view.euler_cap : 0
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('engine.title')}</h3>
        <HelpNote id="help.engine"><p style={S.boardDesc}>{tr('engine.intro')}</p></HelpNote>
      </div>
      <div style={S.floorWrap}>
        {view.use_orrery ? (
          orrery3d ? <Orrery3D /> : <OrreryBoard />
        ) : (
          <FactoryFloor
            shapes={shapes}
            loadout={view.loadout}
            boardCells={view.board_cells}
            boardW={view.board_w}
            boardH={view.board_h}
            openSlots={view.euler_used < view.euler_cap ? (view.loadout.length === 0 ? 3 : 2) : 0}
            onTap={onTap}
          />
        )}
        {view.loadout.length === 0 && <div style={S.floorTag}>{tr('engine.emptyFloor')}</div>}
        {view.loadout.length > 0 && !bubble && <div style={S.floorTag}>{tr('engine.tapToChat')}</div>}
        {bubble && <SpeechBubble bubble={bubble} onClose={() => setBubble(null)} />}
      </div>
      <div style={S.boardStats}>
        <div style={S.bigStat}>
          <span style={{ ...S.bigStatNum, color: '#ffcf6b' }}>+{fmt(view.rate_per_hr)}</span>
          <span style={S.bigStatLbl}>{tr('engine.fluxPerHour')}</span>
        </div>
        {view.active_synergies > 0 && (
          <div style={S.bigStat}>
            <span style={{ ...S.bigStatNum, color: '#ff9ecf', fontSize: 20 }}>×{view.mult_synergy.toFixed(2)}</span>
            <span style={S.bigStatLbl}>{tr('engine.kinSynergyStat', { count: view.active_synergies }).replace('{count>1?\'s\':\'\'}', view.active_synergies > 1 ? 's' : '')}</span>
          </div>
        )}
        <div style={S.budgetBox}>
          <div style={S.budgetTop}><span>{tr('engine.floorSpaceUsed')}</span><span>{view.euler_used} / {view.euler_cap}</span></div>
          <div style={S.meterTrack}><div style={{ ...S.meterFill, width: `${Math.min(100, pct * 100)}%`, background: pct > 0.85 ? '#ff5d8f' : '#5fe0c6', color: pct > 0.85 ? '#ff5d8f' : '#5fe0c6' }} /></div>
        </div>
        <div style={S.boardBtns}>
          {!view.use_orrery && <button style={S.smallBtn} onClick={autoArrange}>{tr('engine.autoArrange')}</button>}
          <button style={{ ...S.smallBtn, opacity: view.core_complete ? 1 : 0.4 }} disabled={!view.core_complete} onClick={recrystallize}>{tr('engine.recrystallizeBtn')}</button>
          <button style={{ ...S.smallBtn, ...(view.use_orrery ? { borderColor: 'var(--c-accent-gold)', color: 'var(--c-accent-gold)' } : {}) }} onClick={() => useGame.getState().setUseOrrery(!view.use_orrery)}>{view.use_orrery ? tr('engine.orreryOff') : tr('engine.orreryOn')}</button>
          {view.use_orrery && <button style={S.smallBtn} onClick={() => setOrrery3d((v) => !v)}>{orrery3d ? tr('engine.orrery2d') : tr('engine.orrery3d')}</button>}
        </div>
      </div>

      <ProductionBreakdown />

      {view.use_orrery ? (
        <HelpNote id="help.orrery">
          <p style={{ ...S.boardDesc, fontSize: 12, margin: '0 0 8px' }}>{tr('engine.orreryHint')}</p>
        </HelpNote>
      ) : (
        <>
          <h4 style={S.boardSub}>{tr('engine.floorHeading', { w: view.board_w, h: view.board_h, count: view.loadout.length })}</h4>
          <HelpNote id="help.board">
            <p style={{ ...S.boardDesc, fontSize: 12, margin: '0 0 8px' }}>
              {tr('engine.boardHint')}
              {sel != null && <b style={{ color: '#5fe0c6' }}>{tr('engine.placingHint', { nick: shapes[sel]?.nick ?? '' })}</b>}
            </p>
          </HelpNote>
          <BoardGrid sel={sel} setSel={setSel} />
        </>
      )}

      <div style={S.listHead}>
        <h4 style={{ ...S.boardSub, margin: 0 }}>{tr('engine.storageHeading', { count: bench.length })}</h4>
        <input style={S.search} placeholder={tr('engine.filterPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={S.chipGrid}>
        {bench.length === 0 && <p style={S.emptyHint}>{ql ? tr('engine.noFilterMatch') : tr('engine.allDeployed')}</p>}
        {bench.map((s) => {
          const fits = view.euler_used + s.euler_cost <= view.euler_cap
          const picked = sel === s.id
          return (
            <button
              key={s.id}
              className="chip"
              style={{ ...S.benchChip, opacity: fits ? 1 : 0.45, borderColor: picked ? '#5fe0c6' : '#23252f', boxShadow: picked ? '0 0 10px #5fe0c655' : 'none' }}
              disabled={!fits}
              onClick={() => setSel(picked ? null : s.id)}
            >
              <span style={{ ...S.tileDot, background: RARITY_COLOR[s.rarity] }} />
              <span style={S.chipNick}>{glyphOf(s.family)} {s.nick}</span>
              <span style={S.chipProd}>+{fmt(s.prod)} ✦/hr</span>
              <span style={S.chipMeta}>{picked ? tr('engine.benchTapToPlace') : s.euler_cost === 0 ? tr('engine.benchFree') : fits ? tr('engine.benchSpace', { cost: s.euler_cost }) : tr('engine.benchNeedsSpace', { cost: s.euler_cost })}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Meter({ label, pct, color }: { label: string; pct: number; color: string }) {
  const p = Math.min(1, pct)
  // Ramp toward the pink "ready" colour as a guarantee nears; pulse once full — a wordless "you're close".
  const fill = p >= 1 ? '#ff5d8f' : p > 0.88 ? '#ff9d6b' : color
  return (
    <div style={S.meter}>
      <span style={S.meterLabel}>{label}</span>
      <div style={S.meterTrack}>
        <div
          className={p >= 1 ? 'meter-ready' : undefined}
          style={{ ...S.meterFill, width: `${p * 100}%`, background: fill, color: fill, transition: 'width .4s ease, background .4s ease' }}
        />
      </div>
    </div>
  )
}

// The charge-up: a glowing orb whose colour CLIMBS the rarity ladder (Common→…→the real result), each tier a
// rising tick. The longer/brighter the climb, the rarer the haul — the "is it gold?!" suspense beat.
function ChargeOrb({ bestRank, ms, ten }: { bestRank: number; ms: number; ten: boolean }) {
  const tr = useT()
  const [lvl, setLvl] = useState(0)
  useEffect(() => {
    sfxClimbTick(0)
    if (bestRank === 0) return
    const per = ms / (bestRank + 1)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setLvl(i)
      sfxClimbTick(i)
      if (i >= bestRank) clearInterval(id)
    }, per)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const color = RARITY_COLOR[RARITY_ORDER[Math.min(lvl, bestRank)]]
  return (
    <div style={S.chargeWrap}>
      <div
        className="charge-orb"
        style={{ background: `radial-gradient(circle at 40% 35%, #fff, ${color})`, boxShadow: `0 0 ${34 + lvl * 26}px ${10 + lvl * 9}px ${color}`, transition: 'box-shadow .25s ease, background .25s ease' }}
      />
      <div style={S.chargeHint}>{ten ? tr('reveal.drawingTen') : tr('reveal.drawing')}{tr('reveal.tapToSkip')}</div>
    </div>
  )
}

function RevealModal() {
  const { lastReveal, shapes, dismissReveal } = useGame()
  const tr = useT()
  const [phase, setPhase] = useState<'charge' | 'show'>('charge')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const best = lastReveal ? [...lastReveal].sort((a, b) => RARITY_ORDER.indexOf(b.rarity!) - RARITY_ORDER.indexOf(a.rarity!))[0] : null
  const bestShape = best ? shapes[best.shape_id] : undefined
  const bestRank = bestShape ? RARITY_ORDER.indexOf(bestShape.rarity) : 0
  const chargeMs = 650 + bestRank * 240
  // Rarity-scaled spark spectacle at the reveal moment: a base burst, then extra staggered ones for SSR/UR+.
  const fireReveal = () => {
    if (!bestShape) return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight * 0.42
    const hue = RARITY_COLOR[bestShape.rarity]
    useSparks.getState().burst(cx, cy, { count: 14 + bestRank * 8, power: 1.3 + bestRank * 0.45, hues: [hue, '#ffffff', '#fff6dc', hue] })
    if (bestRank >= 3) setTimeout(() => useSparks.getState().burst(cx, cy, { count: 12 + bestRank * 6, power: 1.1 + bestRank * 0.4, hues: [hue, '#ffffff'] }), 200)
    if (bestRank >= 4) setTimeout(() => useSparks.getState().burst(cx, cy, { count: 26, power: 2.2, hues: [hue, '#fff6dc'] }), 430)
  }
  useEffect(() => {
    if (!lastReveal) return
    setPhase('charge')
    sfxCharge(bestRank)
    timer.current = setTimeout(() => {
      setPhase('show')
      sfxReveal(bestRank)
      fireReveal()
    }, chargeMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReveal])
  if (!lastReveal || !best) return null
  const skip = () => {
    if (timer.current) clearTimeout(timer.current)
    if (phase === 'charge') {
      setPhase('show')
      sfxReveal(bestRank)
      fireReveal()
    }
  }

  if (phase === 'charge') {
    return (
      <div style={S.modal} onClick={skip}>
        <ChargeOrb bestRank={bestRank} ms={chargeMs} ten={lastReveal.length > 1} />
      </div>
    )
  }

  return (
    <div style={S.modal} onClick={dismissReveal}>
      <div className={bestRank >= 3 ? 'pop-in reveal-shake case-door' : 'pop-in case-door'} style={{ ...S.revealCard, position: 'relative', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        {bestShape && <div className="flash" style={{ background: `radial-gradient(circle, ${RARITY_COLOR[bestShape.rarity]}, transparent 60%)` }} />}
        {bestShape && bestRank >= 4 && <div className="flash-ring" style={{ color: RARITY_COLOR[bestShape.rarity] }} />}
        <div style={S.revealStage}>{bestShape && <HeroView key={bestShape.family} family={bestShape.family} rarity={bestShape.rarity} spin={0.8} />}</div>
        {bestShape && <h2 style={{ color: RARITY_COLOR[bestShape.rarity], fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: 0.4 }}>{bestShape.nick}</h2>}
        {bestShape && <p style={S.revealSub}>{best.is_new ? tr('reveal.new') : `+${best.dupe_shards} ◈ ${tr('hud.shards')}`}</p>}
        {lastReveal.length > 1 && (
          <div style={S.haulGrid}>
            {lastReveal.map((o, i) => {
              const sh = shapes[o.shape_id]
              if (!sh) return null
              return (
                <div key={i} className="haul-in" style={{ ...S.haulTile, borderColor: RARITY_COLOR[sh.rarity], background: `${RARITY_COLOR[sh.rarity]}1c`, animationDelay: `${i * 55}ms` }} title={sh.nick}>
                  <span style={{ fontSize: 20 }}>{glyphOf(sh.family)}</span>
                  {o.is_new && <span style={S.haulNew}>NEW</span>}
                </div>
              )
            })}
          </div>
        )}
        <button style={S.pullBtn} onClick={dismissReveal}>{tr('reveal.continue')}</button>
      </div>
    </div>
  )
}

function OfflineModal() {
  const { offline, dismissOffline } = useGame()
  const tr = useT()
  if (!offline) return null
  const hrs = (offline.capped_ms / 3_600_000).toFixed(1)
  return (
    <div style={S.modal} onClick={dismissOffline}>
      <div className="pop-in" style={S.revealCard} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('offline.title')}</h2>
        <p style={S.revealSub}>{hrs}h</p>
        <p style={{ ...S.fluxValue, color: '#5fe0c6' }}>+{fmt(offline.gained_flux)} ✦</p>
        <button style={S.pullBtn} onClick={dismissOffline}>{tr('offline.collect')}</button>
      </div>
    </div>
  )
}

const rarityLabel = (r: string) => (r === 'Ssr' ? 'SSR' : r === 'Ur' ? 'UR' : r)

// A deliberately VAGUE teaser for undiscovered shapes — no model, no name, no spoiler. Pulling is the joy.
function vagueHint(rarity: string, genus: number, tr: (key: string) => string): string {
  const tier =
    rarity === 'Ur' ? tr('inspect.vagueHint.tier.ur')
    : rarity === 'Relic' ? tr('inspect.vagueHint.tier.relic')
    : rarity === 'Ssr' ? tr('inspect.vagueHint.tier.ssr')
    : rarity === 'Epic' ? tr('inspect.vagueHint.tier.epic')
    : tr('inspect.vagueHint.tier.common')
  const holes =
    genus === 0 ? tr('inspect.vagueHint.holes.g0')
    : genus === 1 ? tr('inspect.vagueHint.holes.g1')
    : genus <= 3 ? tr('inspect.vagueHint.holes.gFew')
    : tr('inspect.vagueHint.holes.gMany')
  return `${tier} ${holes}`
}

let patSparkId = 0
// The "pat" surface (a gentle parody of you-know-what genre): rub the model → a soft glow follows + shine
// particles spawn → a rate-limited, very minor bond bump.
function PatSurface({ id }: { id: number }) {
  const pat = useGame((s) => s.pat)
  const [glow, setGlow] = useState<{ x: number; y: number } | null>(null)
  const [sparks, setSparks] = useState<{ k: number; x: number; y: number }[]>([])
  const rubbing = useRef(false)
  const lastPat = useRef(0)
  const lastSpark = useRef(0)
  const move = (e: React.PointerEvent) => {
    if (!rubbing.current) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    setGlow({ x, y })
    const now = performance.now()
    if (now - lastSpark.current > 55) {
      lastSpark.current = now
      const k = ++patSparkId
      setSparks((s) => [...s.slice(-16), { k, x: x + (Math.random() * 28 - 14), y: y + (Math.random() * 28 - 14) }])
      setTimeout(() => setSparks((s) => s.filter((p) => p.k !== k)), 700)
    }
    if (now - lastPat.current > 550) {
      lastPat.current = now
      pat(id)
      useFloaters.getState().spawn('♥', { color: '#ff9ecf', x: e.clientX, y: e.clientY })
    }
  }
  const start = (e: React.PointerEvent) => {
    rubbing.current = true
    move(e)
  }
  const end = () => {
    rubbing.current = false
    setGlow(null)
  }
  return (
    <div style={S.patSurface} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
      {glow && <div style={{ ...S.patGlow, left: glow.x, top: glow.y }} />}
      {sparks.map((sp) => (
        <span key={sp.k} className="floater" style={{ position: 'absolute', left: sp.x, top: sp.y, color: '#fff3b0', fontSize: 13, pointerEvents: 'none' }}>✦</span>
      ))}
    </div>
  )
}

function Inspector({ id, onClose }: { id: number; onClose: () => void }) {
  const { shapes, view, inspect, secretaryId, setSecretary } = useGame()
  const tr = useT()
  const { bubble, setBubble, talk } = useChatter()
  const [patMode, setPatMode] = useState(false)
  const s = shapes[id]
  const owned = !!view && view.owned[id] > 0
  // Inspecting an owned shape grants affinity — the calm idler's path to bonds — and a little spoken greeting.
  useEffect(() => {
    if (owned) {
      inspect(id)
      const sh = shapes[id]
      const cx = sh ? CODEX[sh.family] : undefined
      if (sh && cx) {
        const line = (view?.bond_levels[id] ?? 0) >= 1 ? cx.bond : cx.blurb
        speak(sh.family, line)
        useDialogLog.getState().log({ nick: sh.nick, line, color: RARITY_COLOR[sh.rarity] })
      }
    }
    return () => stopVoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!s || !view) return null
  const codex = CODEX[s.family]
  const bond = view.bond_levels[id] ?? 0
  return (
    <div style={S.modal} onClick={onClose}>
      <div className="pop-in" style={S.revealCard} onClick={(e) => e.stopPropagation()}>
        {owned ? (
          <>
            <div style={{ ...S.revealStage, position: 'relative' }}>
              <HeroView key={s.family} family={s.family} rarity={s.rarity} controls={!patMode} />
              {patMode && <PatSurface id={id} />}
              <button style={S.patBtn} onClick={() => setPatMode((p) => !p)} title={tr('inspect.pat.title')}>
                {patMode ? tr('inspect.pat.orbit') : tr('inspect.pat.pat')}
              </button>
              {!patMode && <button style={S.talkBtn} onClick={() => talk(s, bond)} title={tr('inspect.talk.title')}>💬</button>}
              {bubble && <SpeechBubble bubble={bubble} onClose={() => setBubble(null)} />}
            </div>
            <h2 style={{ color: RARITY_COLOR[s.rarity] }}>{s.nick}</h2>
            <p style={S.revealSub}>{rarityLabel(s.rarity)} · {s.family.replace(/_/g, ' ')}</p>
            <p style={S.bondRow}>
              <span style={{ color: '#ff5d8f', letterSpacing: 2 }}>{'♥'.repeat(bond)}</span>
              <span style={{ color: '#3b2b38', letterSpacing: 2 }}>{'♡'.repeat(Math.max(0, 5 - bond))}</span>
              <span style={S.bondHint}>{tr('inspect.bond.hint', { bond })}</span>
            </p>
            {(() => {
              const st = view.star_levels[id] ?? 0
              const e = shapeEffect(s.family, s.genus, s.euler_cost)
              return (
                <>
                  <p style={S.bondRow}>
                    <span style={{ color: '#ffd76b', letterSpacing: 2 }}>{'★'.repeat(st)}</span>
                    <span style={{ color: '#3a3320', letterSpacing: 2 }}>{'☆'.repeat(5 - st)}</span>
                    <span style={S.bondHint}>{tr('inspect.star.hint', { st })}</span>
                  </p>
                  <div style={S.effectBox}>
                    <strong style={{ color: '#9ef0ff' }}>{e.icon} {e.name}</strong>
                    <p style={{ ...S.hint, margin: '3px 0 0' }}>{e.desc}</p>
                  </div>
                </>
              )
            })()}
            {codex && <p style={{ ...S.hint, fontStyle: 'italic', color: '#cdd2e0', fontFamily: fontOf(s.family) }}>“{codex.blurb}”</p>}
            {codex && bond >= 1 && <p style={{ ...S.hint, color: RARITY_COLOR[s.rarity], fontFamily: fontOf(s.family) }}>{codex.bond}</p>}
            {codex && bond < 1 && <p style={{ ...S.hint, opacity: 0.7 }}>{tr('inspect.bond.locked')}</p>}
            <p style={S.hint}>
              {s.genus > 0 ? tr('inspect.topology.holesLanes', { genus: s.genus }).replace(/\{s\}/g, s.genus > 1 ? 's' : '') : tr('inspect.topology.noHoles')}
              {tr('inspect.topology.eulerCost', { cost: s.euler_cost })}{codex ? tr('inspect.topology.termReveal', { term: codex.term }) : ''}
            </p>
            <button
              style={{ ...S.smallBtn, marginBottom: 6, ...(secretaryId === id ? S.toggleOn : {}) }}
              onClick={() => setSecretary(secretaryId === id ? null : id)}
              title={tr('inspect.secretary.title')}
            >
              {secretaryId === id ? tr('inspect.secretary.on') : tr('inspect.secretary.set')}
            </button>
            {KINSHIP[s.family]?.length ? (
              <div style={S.kinBox}>
                <div style={S.kinHead}>{tr('inspect.kinship.head')}</div>
                {KINSHIP[s.family].map((k, i) => {
                  const partner = shapes.find((sh) => sh.family === k.with)
                  const self = k.with === s.family
                  const united = self || (!!partner && view.owned[partner.id] > 0)
                  const canWatch = united && hasShip(s.family, k.with)
                  return (
                    <div
                      key={i}
                      style={{ ...S.kinRow, cursor: canWatch ? 'pointer' : 'default' }}
                      onClick={canWatch ? () => useShips.getState().open(s.family, k.with) : undefined}
                    >
                      <span style={{ color: united ? '#ff9ecf' : '#4a4d5f', width: 12, flexShrink: 0 }}>{united ? '♥' : '○'}</span>
                      <span style={S.kinType}>{k.type}</span>
                      <span style={{ color: united ? '#e8eaf2' : '#8a90a8', fontWeight: 700, flexShrink: 0 }}>{partner ? partner.nick : '???'}</span>
                      <span style={S.kinNote}>— {k.note}</span>
                      {canWatch && <span style={S.watchPill}>{tr('inspect.kinship.watchScene')}</span>}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {/* No 3D preview for undiscovered shapes — pulling is the joy. Just a vague teaser. */}
            <div style={{ ...S.revealStage, display: 'grid', placeItems: 'center' }}>
              <span style={{ fontSize: 72, color: '#2a2c3a', fontWeight: 700 }}>?</span>
            </div>
            <h2 style={{ color: '#6b7088' }}>{tr('inspect.undiscovered.title')}</h2>
            <p style={S.revealSub}>{rarityLabel(s.rarity)} · {tr('inspect.undiscovered.sub')}</p>
            <p style={{ ...S.hint, fontStyle: 'italic', color: '#aab' }}>{vagueHint(s.rarity, s.genus, tr)}</p>
            <p style={{ ...S.hint, opacity: 0.7 }}>{tr('inspect.undiscovered.pullHint')}</p>
          </>
        )}
        <button style={S.pullBtn} onClick={onClose}>{tr('common.close')}</button>
      </div>
    </div>
  )
}

function ForgeView() {
  const { recipes, view, shapes, forge, claimRelic } = useGame()
  const tr = useT()
  if (!view) return null
  const canRelic = view.shards >= view.relic_cost && view.relics_owned < view.relic_count
  // Feature a recipe in the 3D altar: prefer one you can forge, else any with both parts, else the first.
  const featIdx = (() => {
    const forgeable = recipes.findIndex((r) => view.owned[r.a] > 0 && view.owned[r.b] > 0)
    return forgeable >= 0 ? forgeable : 0
  })()
  const feat = recipes[featIdx]
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('forge.titleFull')}</h3>
        <HelpNote id="help.forge"><p style={S.boardDesc}>{tr('forge.desc')}</p></HelpNote>
        <div style={S.shardBank}><span style={S.shardIcon}>◈</span> {tr('forge.shardBank', { shards: view.shards })}</div>
      </div>

      <div style={S.floorWrap}>
        {feat && <ForgeAltar a={shapes[feat.a]} b={shapes[feat.b]} out={shapes[feat.out]} discovered={view.discovered[featIdx]} />}
      </div>

      <div style={S.relicPanel}>
        <div style={{ flex: 1 }}>
          <strong style={{ color: '#ffd76b' }}>{tr('forge.referenceWing.title')}</strong>
          <p style={{ ...S.boardDesc, margin: '4px 0 0' }}>{tr('forge.referenceWing.desc', { owned: view.relics_owned, count: view.relic_count })}</p>
        </div>
        <button className="pull-cap" style={{ ...S.summonBtn, opacity: canRelic ? 1 : 0.4 }} disabled={!canRelic} onClick={claimRelic}>
          {view.relics_owned >= view.relic_count ? tr('forge.summon.complete') : tr('forge.summon.cost', { cost: view.relic_cost })}
        </button>
      </div>

      <h4 style={S.boardSub}>{tr('forge.recipes.heading')}</h4>
      <div style={S.recipeGrid}>
        {recipes.map((r, i) => {
          const haveA = view.owned[r.a] > 0
          const haveB = view.owned[r.b] > 0
          const can = haveA && haveB && view.shards >= 50
          const discovered = view.discovered[i]
          const out = shapes[r.out]
          return (
            <div key={i} className="chip" style={{ ...S.recipeCard, borderColor: discovered ? RARITY_COLOR[out.rarity] : '#23252f' }}>
              <div style={S.recipeFlow}>
                <GemChip shape={shapes[r.a]} show={haveA} />
                <span style={S.flowOp}>＋</span>
                <GemChip shape={shapes[r.b]} show={haveB} />
                <span style={S.flowOp}>→</span>
                <GemChip shape={out} show={discovered} />
              </div>
              <button className="forge-cap" style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={() => forge(r.a, r.b)}>
                {can ? tr('forge.recipe.forgeCost') : !haveA || !haveB ? tr('forge.recipe.missingShape') : tr('forge.recipe.needShards')}
              </button>
              {discovered && <span style={S.discoveredTag}>{tr('forge.recipe.discovered')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ForgeToast() {
  const { lastForge, shapes, dismissForge } = useGame()
  const tr = useT()
  if (!lastForge) return null
  const s = shapes[lastForge.out_id]
  return (
    <div style={S.modal} onClick={dismissForge}>
      <div className="pop-in" style={S.revealCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.revealStage}>{s && <HeroView key={s.family} family={s.family} rarity={s.rarity} spin={0.8} />}</div>
        {s && <h2 style={{ color: RARITY_COLOR[s.rarity] }}>{s.nick}</h2>}
        <p style={S.revealSub}>{lastForge.is_discovery ? tr('reveal.discovery') : tr('reveal.forged')}</p>
        <button style={S.pullBtn} onClick={dismissForge}>{tr('reveal.continue')}</button>
      </div>
    </div>
  )
}

// A light, skippable, replayable first-run tour. A bottom card walks the player through the systems, switching
// tabs as it goes; it never blocks play (the backdrop is click-through).
const TOUR_STEPS: { tab: Tab; icon: string; key: string }[] = [
  { tab: 'engine', icon: '🏭', key: 'tour.s2' }, // deploy your starter shape first
  { tab: 'gacha', icon: '✦', key: 'tour.s0' }, // then pull for more
  { tab: 'gallery', icon: '🗂️', key: 'tour.s1' },
  { tab: 'workshop', icon: '🔧', key: 'tour.s3' }, // upgrades now live in their own tab
  { tab: 'forge', icon: '🔨', key: 'tour.s4' },
  { tab: 'gacha', icon: '🎯', key: 'tour.s5' },
]

function TourCoachmark({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tr = useT()
  const running = useTour((s) => s.running)
  const step = useTour((s) => s.step)
  const next = useTour((s) => s.next)
  const finish = useTour((s) => s.finish)
  const cur = TOUR_STEPS[step]
  useEffect(() => {
    if (running && cur && tab !== cur.tab) setTab(cur.tab) // keep the player on the step's screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, step, tab])
  if (!running || !cur) return null
  const last = step >= TOUR_STEPS.length - 1
  return (
    <div style={S.tourWrap}>
      <div className="pop-in" style={S.tourCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>{cur.icon}</span>
          <strong style={{ color: '#e8eaf2' }}>{tr(`${cur.key}.title`)}</strong>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8a90a8' }}>{step + 1}/{TOUR_STEPS.length}</span>
        </div>
        <p style={{ ...S.boardDesc, margin: '8px 0 12px' }}>{tr(`${cur.key}.body`)}</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={S.pullBtn} onClick={() => (last ? finish() : next())}>{last ? tr('tour.finish') : tr('tour.next')}</button>
          {!last && <button style={S.smallBtn} onClick={finish}>{tr('tour.skip')}</button>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {TOUR_STEPS.map((_, j) => <span key={j} style={{ ...S.shipDot, opacity: j === step ? 1 : 0.3 }} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// The hand-made title art — click to rotate through the set. Persists the choice.
function TitleArt({ style, rounded = 12, className }: { style?: CSSProperties; rounded?: number; className?: string }) {
  const idx = useTitle((s) => s.idx)
  const next = useTitle((s) => s.next)
  const tr = useT()
  return (
    <img
      src={titleSrc(idx)}
      alt={tr('title.alt')}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        next()
      }}
      title={tr('title.cycle')}
      style={{ width: '100%', borderRadius: rounded, cursor: 'pointer', display: 'block', aspectRatio: '4 / 3', objectFit: 'cover', ...style }}
    />
  )
}

// A scatter of ambient motes that drift up around the welcome card.
function WelcomeMotes() {
  const motes = [
    { left: '8%', top: '60%', mx: '8px', md: '5.5s', dl: '0s', mc: '#ffcf6b', ms: '7px' },
    { left: '20%', top: '40%', mx: '-6px', md: '6.5s', dl: '1.2s', mc: '#ff9ecf', ms: '5px' },
    { left: '46%', top: '30%', mx: '4px', md: '7s', dl: '2.4s', mc: '#fff3b0', ms: '6px' },
    { left: '74%', top: '44%', mx: '-8px', md: '6s', dl: '0.8s', mc: '#5fe0c6', ms: '5px' },
    { left: '88%', top: '62%', mx: '6px', md: '5.8s', dl: '2s', mc: '#ffcf6b', ms: '7px' },
    { left: '60%', top: '70%', mx: '-4px', md: '6.8s', dl: '3.1s', mc: '#b388ff', ms: '5px' },
  ]
  return (
    <>
      {motes.map((m, i) => (
        <span
          key={i}
          className="welcome-mote"
          style={{ left: m.left, top: m.top, '--mx': m.mx, '--md': m.md, '--mdl': m.dl, '--mc': m.mc, '--ms': m.ms } as CSSProperties}
        />
      ))}
    </>
  )
}

function WelcomeModal() {
  const { firstLaunch, dismissWelcome } = useGame()
  const startTour = useTour((s) => s.start)
  const tr = useT()
  if (!firstLaunch) return null
  const begin = () => {
    dismissWelcome()
    startTour()
  }
  return (
    <div style={S.modal} onClick={begin}>
      <div className="pop-in" style={{ ...S.revealCard, position: 'relative', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <WelcomeMotes />
        <TitleArt className="welcome-art" style={{ marginBottom: 14 }} />
        <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: 0.5, animation: 'welcome-title-in 0.8s ease-out both' }}>{tr('welcome.title')}</h2>
        <p style={S.revealSub}>{tr('welcome.body')}</p>
        <p style={S.hint}>{tr('welcome.note')}</p>
        <button style={S.pullBtn} onClick={begin}>{tr('welcome.begin')}</button>
        <p style={S.vibecoded}>{tr('welcome.vibecoded')}</p>
      </div>
    </div>
  )
}

function ShopView() {
  const { view, buyCosmetic, selectScene } = useGame()
  const tr = useT()
  if (!view) return null
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('shop.title')}</h3>
        <HelpNote id="help.shop"><p style={S.boardDesc}>{tr('shop.desc')}</p></HelpNote>
        <div style={S.shardBank}><span style={S.fluxIcon}>✦</span> {fmt(view.flux)} {tr('shop.fluxAvailable')}</div>
      </div>
      <div style={S.recipeGrid}>
        {SCENES.map((sc) => {
          const owned = sc.id === 0 || view.cosmetics.includes(sc.id)
          const equipped = view.scene === sc.id
          const canBuy = !owned && view.flux >= sc.cost
          return (
            <div key={sc.id} className="chip" style={{ ...S.recipeCard, borderColor: equipped ? '#ffcf6b' : owned ? '#3a3d4f' : '#23252f' }}>
              <div style={S.sceneSwatch}>{sc.env.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}</div>
              <div>
                <strong style={{ color: '#e8eaf2' }}>{sc.name}{equipped ? ' ✓' : ''}</strong>
                <p style={{ ...S.boardDesc, margin: '4px 0 0', fontSize: 12 }}>{sc.desc}</p>
              </div>
              {equipped ? (
                <button style={{ ...S.forgeBtn, opacity: 0.6 }} disabled>{tr('shop.equipped')}</button>
              ) : owned ? (
                <button style={S.forgeBtn} onClick={() => selectScene(sc.id)}>{tr('shop.equip')}</button>
              ) : (
                <button className="pull-cap" style={{ ...S.summonBtn, opacity: canBuy ? 1 : 0.4 }} disabled={!canBuy} onClick={() => buyCosmetic(sc.id, sc.cost)}>{tr('shop.buy')} · {fmt(sc.cost)} ✦</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FluxChart({ data }: { data: number[] }) {
  const tr = useT()
  if (data.length < 2) {
    return <div style={{ ...S.boardIntro, height: 110, display: 'grid', placeItems: 'center', color: '#6b7088', fontSize: 13 }}>{tr('ledger.fluxTrendEmpty')}</div>
  }
  const w = 600, h = 120
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (h - 14) - 7])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = `${line} L ${w} ${h} L 0 ${h} Z`
  return (
    <div style={{ ...S.boardIntro, padding: 0, overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 130, display: 'block' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="fluxgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffcf6b" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffcf6b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#fluxgrad)" />
        <path d={line} fill="none" stroke="#ffcf6b" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function LedgerView() {
  const { view, fluxHistory, milestoneDefs } = useGame()
  const tr = useT()
  if (!view) return null
  const playMin = Math.max(0, (view.last_seen_ms - view.created_ms) / 60000)
  const playStr = playMin >= 60 ? (playMin / 60).toFixed(1) + 'h' : Math.floor(playMin) + 'm'
  const stat = (label: string, value: string) => (
    <div style={S.statCard}><span style={S.statVal}>{value}</span><span style={S.statLbl}>{label}</span></div>
  )
  const rarityNames = [tr('rarity.common'), tr('rarity.rare'), tr('rarity.epic'), tr('rarity.ssr'), tr('rarity.ur')]
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={S.boardTitle}>{tr('ledger.title')}</h3>
          <CuratorBadge />
        </div>
        <HelpNote id="help.ledger"><p style={S.boardDesc}>{tr('ledger.desc')}</p></HelpNote>
      </div>
      <FluxChart data={fluxHistory} />
      <h4 style={S.boardSub}>{tr('ledger.sectionEconomy')}</h4>
      <div style={S.statGrid}>
        {stat(tr('ledger.statFluxNow'), fmt(view.flux))}
        {stat(tr('ledger.statFluxPerHr'), '+' + fmt(view.rate_per_hr))}
        {stat(tr('ledger.statLifetimeFlux'), fmt(view.lifetime_flux))}
        {stat(tr('ledger.statShards'), fmt(view.shards))}
        {stat(tr('ledger.statLifetimeShards'), fmt(view.lifetime_shards))}
        {stat(tr('ledger.statTotalPulls'), fmt(view.total_pulls))}
        {stat(tr('ledger.statForges'), fmt(view.total_forges))}
        {stat(tr('ledger.statPlaytime'), playStr)}
      </div>
      <h4 style={S.boardSub}>{tr('ledger.sectionCollection')}</h4>
      <div style={S.statGrid}>
        {stat(tr('ledger.statCoreShapes'), view.distinct_owned + '/41')}
        {stat(tr('rarity.relicsShort'), view.relics_owned + '/' + view.relic_count)}
        {stat(tr('ledger.statDimension'), 'v' + view.viewport_dim)}
        {stat(tr('ledger.statNewGamePlus'), '×' + view.ng_cycle)}
        {stat(tr('ledger.statPrestige'), '×' + view.prestige_mult.toFixed(2))}
        {stat(tr('ledger.statFloorSpace'), view.euler_used + '/' + view.euler_cap)}
        {stat(tr('ledger.statPlatonicSet'), view.platonic_set ? tr('ledger.statComplete') : '—')}
        {stat(tr('ledger.statScenes'), view.cosmetics.length + 1 + '/' + SCENES.length)}
        {stat(tr('forge.recipes.heading'), view.discovered.filter(Boolean).length + '/' + view.discovered.length)}
        {stat(tr('ledger.statBondsMaxed'), String(view.bond_levels.filter((b) => b >= 5).length))}
        {stat(tr('ledger.statKinSynergies'), String(view.active_synergies))}
      </div>
      <h4 style={S.boardSub}>{tr('ledger.sectionPullsByRarity')}</h4>
      <div style={S.statGrid}>
        {view.pulls_by_rarity.map((n, i) => (
          <div key={i} style={{ ...S.statCard, borderColor: RARITY_COLOR[RARITY_ORDER[i]] }}>
            <span style={{ ...S.statVal, color: RARITY_COLOR[RARITY_ORDER[i]] }}>{fmt(n)}</span>
            <span style={S.statLbl}>{rarityNames[i]}</span>
          </div>
        ))}
      </div>
      {(() => {
        const topPulls = (view.pulls_by_rarity[3] ?? 0) + (view.pulls_by_rarity[4] ?? 0)
        return (
          <>
            <h4 style={S.boardSub}>{tr('ledger.luck')}</h4>
            <div style={S.statGrid}>
              {stat(tr('ledger.statSsrPulls'), fmt(topPulls))}
              {stat(tr('ledger.statSsrRate'), view.total_pulls ? ((topPulls / view.total_pulls) * 100).toFixed(1) + '%' : '—')}
              {stat(tr('ledger.statPityToSsr'), view.pity_since_top + '/30')}
              {stat(tr('ledger.statResonance'), view.resonance + '/40')}
            </div>
          </>
        )
      })()}

      {(() => {
        const done = view.milestones_done
        const total = view.mult_milestone - 1 // truth from the core, not recomputed
        const got = done.filter(Boolean).length
        return (
          <>
            <h4 style={S.boardSub}>{tr('ledger.milestonesHeading')} — {got}/{milestoneDefs.length} · +{Math.round(total * 100)}% {tr('ledger.milestonesProductionSuffix')}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {milestoneDefs.map((m, i) => {
                const ok = done[i]
                const info = MILESTONE_INFO[m.key] ?? { name: m.key, icon: '★' }
                return (
                  <div key={m.key} style={{ ...S.milestoneRow, opacity: ok ? 1 : 0.6 }}>
                    <span>{ok ? '✅' : '🔒'}</span>
                    <span style={{ fontSize: 17 }}>{info.icon}</span>
                    <span style={{ flex: 1, color: ok ? '#e8eaf2' : '#8a90a8' }}>{info.name}</span>
                    <span style={{ color: ok ? '#5fe0c6' : '#6b7088', fontWeight: 700, fontSize: 12 }}>+{Math.round(m.bonus * 100)}%</span>
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}
      <EventLog />
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={S.settingRow}>
      <span>{label}</span>
      {children}
    </div>
  )
}

function Attribution() {
  const tr = useT()
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#9aa0b4' }}>
      <p style={{ margin: '0 0 4px', color: '#cdd2e0', fontWeight: 700 }}>{tr('attribution.referenceModels')}</p>
      <ul style={S.attrList}>
        <li>{tr('attribution.stanford')}</li>
        <li>{tr('attribution.princeton')}</li>
        <li>{tr('attribution.teapot')}</li>
        <li>{tr('attribution.crane')}</li>
        <li>{tr('attribution.benchy')}</li>
      </ul>
      <p style={{ margin: '8px 0 4px', color: '#cdd2e0', fontWeight: 700 }}>{tr('attribution.builtWith')}</p>
      <ul style={S.attrList}>
        <li>{tr('attribution.builtThree')}</li>
        <li>{tr('attribution.builtRust')}</li>
        <li>{tr('attribution.builtReact')}</li>
      </ul>
      <p style={{ opacity: 0.7, marginTop: 8 }}>{tr('attribution.licenceNote')}</p>
    </div>
  )
}

function TitleArtSettings() {
  const idx = useTitle((s) => s.idx)
  const next = useTitle((s) => s.next)
  const prev = useTitle((s) => s.prev)
  const tr = useT()
  return (
    <>
      <p style={S.boardDesc}>{tr('settings.titleArtDesc', { count: TITLE_COUNT })}</p>
      <img src={titleSrc(idx)} alt={tr('settings.titleArtAlt')} onClick={next} title={tr('settings.titleArtClickHint')} style={{ width: '100%', borderRadius: 12, cursor: 'pointer', aspectRatio: '4 / 3', objectFit: 'cover' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <button style={S.smallBtn} onClick={prev}>{tr('settings.prev')}</button>
        <span style={S.hint}>{idx + 1} / {TITLE_COUNT}</span>
        <button style={S.smallBtn} onClick={next}>{tr('settings.next')}</button>
      </div>
    </>
  )
}

function DataSettings() {
  const exportSave = useGame((s) => s.exportSave)
  const importSave = useGame((s) => s.importSave)
  const resetSave = useGame((s) => s.resetSave)
  const tr = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const doExport = () => {
    const data = exportSave()
    if (!data) return
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shape-gacha-save-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMsg(tr('settings.dataExportMsg'))
  }
  const onFile = async () => {
    const f = fileRef.current?.files?.[0]
    if (!f) return
    const text = await f.text()
    if (fileRef.current) fileRef.current.value = ''
    if (!window.confirm(tr('settings.dataImportConfirm'))) return
    if (!importSave(text)) setMsg(tr('settings.dataImportInvalid'))
    // on success the page reloads
  }
  const doReset = () => {
    if (!window.confirm(tr('settings.dataResetConfirm1'))) return
    if (window.confirm(tr('settings.dataResetConfirm2'))) resetSave()
  }
  return (
    <>
      <p style={S.boardDesc}>{tr('settings.dataDesc')}</p>
      <SettingRow label={tr('settings.dataBackupLabel')}><button style={S.smallBtn} onClick={doExport}>{tr('settings.dataExport')}</button></SettingRow>
      <SettingRow label={tr('settings.dataRestoreLabel')}><button style={S.smallBtn} onClick={() => fileRef.current?.click()}>{tr('settings.dataImport')}</button></SettingRow>
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onFile} />
      <SettingRow label={tr('settings.dataDangerLabel')}><button style={{ ...S.smallBtn, borderColor: '#a3434f', color: '#ff8a8a' }} onClick={doReset}>{tr('settings.dataReset')}</button></SettingRow>
      {msg && <p style={{ ...S.hint, color: '#ffd76b' }}>{msg}</p>}
    </>
  )
}

function SettingsModal() {
  const tr = useT()
  const settingsOpen = useGame((s) => s.settingsOpen)
  const setSettingsOpen = useGame((s) => s.setSettingsOpen)
  const muted = useMute((s) => s.muted)
  const toggleMute = useMute((s) => s.toggle)
  const quality = useGfx((s) => s.quality)
  const setQuality = useGfx((s) => s.setQuality)
  const [tab, setTab] = useState<'graphics' | 'gameplay' | 'title' | 'data' | 'keybinds' | 'attribution'>('graphics')
  if (!settingsOpen) return null
  const tabs: typeof tab[] = ['graphics', 'gameplay', 'title', 'data', 'keybinds', 'attribution']
  return (
    <div style={S.modal} onClick={() => setSettingsOpen(false)}>
      <div className="pop-in" style={S.settingsCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.settingsHead}>
          <strong style={{ fontSize: 16 }}>{tr('settings.title')}</strong>
          <button style={S.langBtn} onClick={() => setSettingsOpen(false)}>✕</button>
        </div>
        <div style={S.settingsTabs}>
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ ...S.navBtn, ...(tab === t ? S.navBtnActive : {}) }}>
              {tr('settings.tab' + t[0].toUpperCase() + t.slice(1))}
            </button>
          ))}
        </div>
        <div style={S.settingsBody}>
          {tab === 'graphics' && (
            <>
              <SettingRow label={tr('settings.soundEffectsLabel')}><button style={{ ...S.toggle, ...(muted ? {} : S.toggleOn) }} onClick={toggleMute}>{muted ? tr('settings.toggleOff') : tr('settings.toggleOn')}</button></SettingRow>
              <SettingRow label={tr('settings.graphicsQualityLabel')}>
                <span style={{ display: 'flex', gap: 6 }}>
                  {(['low', 'medium', 'high'] as Quality[]).map((q) => (
                    <button key={q} onClick={() => setQuality(q)} style={{ ...S.toggle, ...(quality === q ? S.toggleOn : {}) }}>
                      {tr('settings.quality' + q[0].toUpperCase() + q.slice(1))}
                    </button>
                  ))}
                </span>
              </SettingRow>
              <p style={S.hint}>{tr('settings.qualityHint')}</p>
            </>
          )}
          {tab === 'gameplay' && (
            <>
              <p style={S.boardDesc}>{tr('settings.gameplayLoopDesc')}</p>
              <button
                style={{ ...S.smallBtn, marginTop: 10 }}
                onClick={() => {
                  useGame.getState().setSettingsOpen(false)
                  useTour.getState().restart()
                }}
              >
                {tr('settings.replay')}
              </button>
              <button style={{ ...S.smallBtn, marginTop: 10, marginLeft: 8 }} onClick={() => useHelp.getState().reset()}>
                {tr('help.showAll')}
              </button>
            </>
          )}
          {tab === 'title' && <TitleArtSettings />}
          {tab === 'data' && <DataSettings />}
          {tab === 'keybinds' && (
            <div style={{ fontSize: 13, color: '#cdd2e0' }}>
              <div style={S.kbRow}><span><kbd style={S.kbd2}>P</kbd> <kbd style={S.kbd2}>Space</kbd></span><span style={S.kbDesc}>{tr('settings.kbPullx1')}</span></div>
              <div style={S.kbRow}><kbd style={S.kbd2}>T</kbd><span style={S.kbDesc}>{tr('settings.kbPullx10')}</span></div>
              <div style={S.kbRow}><span><kbd style={S.kbd2}>1</kbd>–<kbd style={S.kbd2}>9</kbd></span><span style={S.kbDesc}>{tr('settings.kbNavScreens')}</span></div>
              <div style={S.kbRow}><kbd style={S.kbd2}>M</kbd><span style={S.kbDesc}>{tr('common.toggleSound')}</span></div>
              <div style={S.kbRow}><kbd style={S.kbd2}>Esc</kbd><span style={S.kbDesc}>{tr('settings.kbCloseDialog')}</span></div>
              <p style={{ ...S.boardDesc, marginTop: 12 }}>{tr('settings.kbOrbitHint')}</p>
            </div>
          )}
          {tab === 'attribution' && <Attribution />}
        </div>
      </div>
    </div>
  )
}

// A non-blocking celebratory banner when a milestone latches.
function MilestoneToast() {
  const idx = useGame((s) => s.milestoneToast)
  const dismiss = useGame((s) => s.dismissMilestone)
  const defs = useGame((s) => s.milestoneDefs)
  const tr = useT()
  useEffect(() => {
    if (idx === null) return
    const t = setTimeout(dismiss, 3800)
    return () => clearTimeout(t)
  }, [idx, dismiss])
  if (idx === null) return null
  const def = defs[idx]
  const info = MILESTONE_INFO[def?.key] ?? { name: tr('milestone.fallbackName'), icon: '🏆' }
  return (
    <div className="pop-in" style={S.mileToast} onClick={dismiss}>
      <span style={{ fontSize: 24 }}>{info.icon}</span>
      <div>
        <div style={{ color: '#ffd76b', fontWeight: 800, fontSize: 11, letterSpacing: 0.6 }}>{tr('milestone.toastBanner')}</div>
        <div style={{ color: '#e8eaf2', fontSize: 13 }}>{info.name}</div>
      </div>
      <span style={{ marginLeft: 'auto', color: '#5fe0c6', fontWeight: 800 }}>+{Math.round((def?.bonus ?? 0) * 100)}%</span>
      <div className="toast-drain" style={S.toastDrain} />
    </div>
  )
}

// The global dialogue log — every line any shape has said (chatter, greetings, cutscenes), viewable anytime.
function DialogLogModal() {
  const open = useDialogLog((s) => s.open)
  const entries = useDialogLog((s) => s.entries)
  const setOpen = useDialogLog((s) => s.setOpen)
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [open, entries.length])
  if (!open) return null
  return (
    <div style={S.modal} onClick={() => setOpen(false)}>
      <div className="pop-in" style={S.logModalCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.shipHead}>📜 {tr('dialogLog.title')}</div>
        <div ref={ref} style={S.logModalBox}>
          {entries.length === 0 ? (
            <p style={{ ...S.hint, textAlign: 'center' }}>{tr('dialogLog.empty')}</p>
          ) : (
            entries.map((e, i) => (
              <div key={i} style={{ marginBottom: 9 }}>
                <strong style={{ color: e.color, fontSize: 12 }}>{e.nick}</strong>
                <p style={{ ...S.shipText, margin: '2px 0 0', fontSize: 13, fontStyle: 'normal' }}>{e.line}</p>
              </div>
            ))
          )}
        </div>
        <button style={S.pullBtn} onClick={() => setOpen(false)}>{tr('dialogLog.close')}</button>
      </div>
    </div>
  )
}

// A two-character "ship" dialogue that plays when a kin pair first unites (and is re-watchable).
function ShipCutscene() {
  const activeKey = useShips((s) => s.active)
  const close = useShips((s) => s.close)
  const shapes = useGame((s) => s.shapes)
  const tr = useT()
  const [i, setI] = useState(0)
  const [showLog, setShowLog] = useState(false)
  useEffect(() => {
    setI(0)
    setShowLog(false)
  }, [activeKey])
  // Speak each line in the active speaker's voice; cut off on advance / close.
  useEffect(() => {
    if (!activeKey) return
    const sc = SHIP_SCENES[activeKey]
    const ln = sc?.lines[i]
    if (!ln) return
    const fam = ln.who === 'a' ? sc.a : sc.b
    speak(fam, ln.text)
    const sh = shapes.find((s) => s.family === fam)
    if (sh) useDialogLog.getState().log({ nick: sh.nick, line: ln.text, color: RARITY_COLOR[sh.rarity] })
    return () => stopVoice()
  }, [activeKey, i])
  if (!activeKey) return null
  const ship = SHIP_SCENES[activeKey]
  const a = shapes.find((s) => s.family === ship.a)
  const b = shapes.find((s) => s.family === ship.b)
  const line = ship.lines[i]
  const last = i >= ship.lines.length - 1
  const speakerA = line.who === 'a'
  const advance = () => {
    if (showLog) return
    if (last) close()
    else setI(i + 1)
  }
  const aCol = a ? RARITY_COLOR[a.rarity] : '#888'
  const bCol = b ? RARITY_COLOR[b.rarity] : '#888'
  const speakerOf = (who: 'a' | 'b') => (who === 'a' ? a : b)
  const colOf = (who: 'a' | 'b') => (who === 'a' ? aCol : bCol)
  return (
    <div style={S.modal} onClick={advance}>
      <div className="pop-in case-door" style={S.shipCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.shipHead}>♥ {a?.nick} &amp; {b?.nick}</div>
        <button style={S.logBtn} onClick={() => setShowLog((v) => !v)} title={tr('dialogLog.title')}>{showLog ? '✕' : '📜'}</button>
        <div style={S.shipStage}>
          <ShipScene a={a} b={b} speakerA={speakerA} />
          <div style={S.shipNames}>
            <span style={{ color: speakerA ? aCol : '#7b8198', fontWeight: 700, transition: 'color .2s' }}>{a?.nick}</span>
            <span style={{ color: '#ff5d8f' }}>♥</span>
            <span style={{ color: speakerA ? '#7b8198' : bCol, fontWeight: 700, transition: 'color .2s' }}>{b?.nick}</span>
          </div>
        </div>
        {showLog ? (
          <div style={S.logBox}>
            {ship.lines.slice(0, i + 1).map((ln, j) => (
              <div key={j} style={{ marginBottom: 9 }}>
                <strong style={{ color: colOf(ln.who), fontSize: 12 }}>{speakerOf(ln.who)?.nick}</strong>
                <p style={{ ...S.shipText, margin: '2px 0 0', fontSize: 13, fontFamily: fontOf(ln.who === 'a' ? ship.a : ship.b) }}>{ln.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <div style={S.shipLineBox}>
            <strong style={{ color: speakerA ? aCol : bCol }}>{speakerA ? a?.nick : b?.nick}</strong>
            <p style={{ ...S.shipText, fontFamily: fontOf(speakerA ? ship.a : ship.b) }}>{line.text}</p>
          </div>
        )}
        <button style={S.pullBtn} onClick={() => (showLog ? setShowLog(false) : advance())}>{showLog ? tr('ship.resume') : last ? tr('ship.close') : tr('ship.next')}</button>
        <div style={S.shipDots}>{ship.lines.map((_, j) => <span key={j} style={{ ...S.shipDot, opacity: j === i ? 1 : 0.3 }} />)}</div>
      </div>
    </div>
  )
}

// Auto-plays a ship cutscene the first time a kin pair becomes united (both owned).
function ShipWatcher() {
  const owned = useGame((s) => s.view?.owned)
  const shapes = useGame((s) => s.shapes)
  // Don't pop a cutscene over a reveal/forge/offline modal or onboarding — queue it. When the blocker clears,
  // `busy` flips and this effect re-runs, opening the next unseen pair. (open() marks it seen, so no repeats.)
  const busy = useGame((s) => !!(s.lastReveal || s.lastForge || s.offline || s.settingsOpen || s.firstLaunch))
  const tourRunning = useTour((s) => s.running)
  const open = useShips((s) => s.open)
  const seen = useShips((s) => s.seen)
  const active = useShips((s) => s.active)
  useEffect(() => {
    if (!owned || shapes.length === 0 || active || busy || tourRunning) return
    for (const k of Object.keys(SHIP_SCENES)) {
      if (seen.includes(k)) continue
      const ship = SHIP_SCENES[k]
      const a = shapes.find((s) => s.family === ship.a)
      const b = shapes.find((s) => s.family === ship.b)
      if (a && b && owned[a.id] > 0 && owned[b.id] > 0) {
        open(ship.a, ship.b)
        break
      }
    }
  }, [owned, shapes, seen, active, open, busy, tourRunning])
  return null
}

// VITRINE skeuomorph — two reusable materials. RECESSED PANEL = a frosted pane sunk into a bezel;
// RAISED CAP = a domed metal button that sits proud (and sinks on :active via juice.css). Spread these in,
// then keep each element's own borderRadius/padding/layout.
const VITRINE: CSSProperties = {
  background: 'linear-gradient(180deg, #0c0d15 0%, #111219 60%, #15161f 100%)',
  border: '1px solid #2c2f3c',
  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(120,130,160,0.10), inset 0 0 0 1px rgba(255,207,107,0.05), 0 1px 0 rgba(255,255,255,0.03)',
}
const CAP: CSSProperties = {
  background: 'linear-gradient(180deg, #2a2d3b 0%, #20222e 52%, #181922 100%)',
  border: '1px solid #34384a',
  borderTopColor: '#444a5e',
  borderBottomColor: '#14151d',
  color: '#e8eaf2',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 2px rgba(0,0,0,0.4), 0 2px 3px rgba(0,0,0,0.45), 0 1px 0 rgba(0,0,0,0.3)',
  cursor: 'pointer',
}

const S: Record<string, CSSProperties> = {
  loading: { color: 'var(--c-text-muted)', background: 'var(--c-bg-base)', height: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-app)', fontSize: 'var(--fs-h2)' },
  app: { background: 'var(--c-bg-base)', color: 'var(--c-text)', minHeight: '100vh', fontFamily: 'var(--font-app)', display: 'flex', flexDirection: 'column' },
  hud: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', flexWrap: 'wrap', gap: 'var(--sp-2)', background: 'linear-gradient(180deg, #16131a 0%, #100f17 100%), linear-gradient(180deg, rgba(255,207,107,0.06), transparent)', borderBottom: '1px solid #2c2f3c', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4)' },
  fluxLabel: { color: 'var(--c-text-dim)', marginRight: 'var(--sp-2)', fontSize: 'var(--fs-body-sm)' },
  fluxValue: { fontSize: 'var(--fs-display)', fontWeight: 800, color: 'var(--c-accent-gold-bright)', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 14px rgba(255,207,107,0.35)' },
  rate: { color: 'var(--c-accent-teal)', marginLeft: 'var(--sp-2_5)', fontSize: 'var(--fs-body-sm)' },
  hudStats: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 'var(--sp-3)', rowGap: 'var(--sp-1_5)', fontSize: 'var(--fs-body-sm)', color: '#aab', alignItems: 'center', minWidth: 0 },
  langSwitch: { display: 'flex', gap: 'var(--sp-1)' },
  langBtn: { ...CAP, color: 'var(--c-text-muted)', borderRadius: 'var(--r-sm)', padding: '2px 7px', fontSize: 'var(--fs-eyebrow)' },
  langBtnOn: { background: 'var(--c-surface-6)', color: 'var(--c-text-bright)', borderColor: 'var(--c-accent-teal)' },
  nav: { display: 'flex', gap: 'var(--sp-1)', padding: '8px 16px', overflowX: 'auto', background: 'linear-gradient(180deg,#15161f,#0e0f17)', boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.5)', borderBottom: '1px solid #20222e' },
  navBtn: { background: 'none', border: 'none', color: 'var(--c-text-dim)', padding: '8px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 'var(--fs-body)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1_5)', flexShrink: 0, whiteSpace: 'nowrap' },
  navBtnActive: { background: 'linear-gradient(180deg, #262a3e, #1b1e2c)', color: 'var(--c-text-bright)', border: '1px solid #34384a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -3px 0 -1px #5fe0c6, 0 2px 4px rgba(0,0,0,0.4)' },
  navBtnImportant: { color: 'var(--c-accent-teal-soft)', background: 'rgba(95,224,198,0.10)', boxShadow: 'inset 0 0 0 1px rgba(95,224,198,0.5), inset 0 1px 0 rgba(255,255,255,0.06)', fontWeight: 700 },
  main: { flex: 1, padding: 'var(--sp-4)', overflow: 'auto' },
  gacha: { maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3_5)' },
  stageWrap: { position: 'relative', height: 340, borderRadius: 'var(--r-3xl)', overflow: 'hidden', background: 'var(--c-bg-stage)', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  focusName: { position: 'absolute', bottom: 'var(--sp-2_5)', left: 0, right: 0, textAlign: 'center', fontSize: 'var(--fs-h2)', fontWeight: 600, pointerEvents: 'none' },
  focusFam: { color: 'var(--c-text-dim)', fontStyle: 'normal', fontWeight: 400, fontSize: 'var(--fs-body-sm)' },
  secretaryTag: { color: 'var(--c-accent-gold-deep)', fontSize: 'var(--fs-caption)', fontWeight: 700 },
  effectPreview: { position: 'absolute', top: 'var(--sp-2_5)', left: 'var(--sp-2_5)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1_5)', background: 'rgba(16,17,25,0.82)', border: '1px solid #2a2c3a', borderRadius: 'var(--r-pill)', padding: '6px 12px', fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)', cursor: 'pointer', backdropFilter: 'blur(4px)', maxWidth: 'calc(100% - 20px)' },
  bannerRow: { display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' },
  bannerCard: { ...VITRINE, flex: 1, textAlign: 'left', borderRadius: 'var(--r-lg)', padding: '8px 10px', cursor: 'pointer', color: 'var(--c-text-secondary)' },
  bannerCardOn: { borderColor: 'var(--c-accent-teal)', background: '#16201f', boxShadow: 'inset 0 -2px 0 #5fe0c6' },
  bannerName: { fontSize: 12.5, fontWeight: 700, color: 'var(--c-text)', marginBottom: 'var(--sp-1)' },
  bannerRotate: { color: 'var(--c-accent-coral)', fontSize: 'var(--fs-micro)', fontWeight: 800 },
  bannerTimer: { marginTop: 'var(--sp-1)', fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-coral)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, letterSpacing: 0.3 },
  bannerFeat: { display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', minHeight: 18 },
  talkBtn: { position: 'absolute', bottom: 'var(--sp-2)', right: 'var(--sp-2)', zIndex: 4, background: 'rgba(20,40,44,0.85)', border: '1px solid #2f6b6a', color: 'var(--c-accent-teal-bright)', borderRadius: 'var(--r-pill)', padding: '5px 12px', fontSize: 'var(--fs-h4)', cursor: 'pointer' },
  bubble: { position: 'absolute', top: 'var(--sp-3)', left: '50%', transform: 'translateX(-50%)', maxWidth: '88%', background: 'rgba(18,19,28,0.97)', border: '1px solid #3a3d4f', borderRadius: 'var(--r-2xl)', padding: '9px 14px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--c-text)', zIndex: 6, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.5)' },
  bubbleNick: { fontSize: 'var(--fs-eyebrow)', fontWeight: 800, marginBottom: 'var(--sp-0_5)' },
  pitymeters: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)' },
  meter: { display: 'flex', flexDirection: 'column', gap: 3 },
  meterLabel: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-muted)' },
  meterTrack: { height: 7, background: 'linear-gradient(180deg, #15161e, #1f2230)', border: '1px solid rgba(0,0,0,0.5)', borderRadius: 'var(--r-xs)', overflow: 'hidden', boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(120,130,160,0.10), 0 1px 0 rgba(255,255,255,0.03)' },
  meterFill: { height: '100%', borderRadius: 'var(--r-xs)', transition: 'width 0.3s', boxShadow: '0 0 6px 0 currentColor, inset 0 1px 0 rgba(255,255,255,0.4)' },
  pullRow: { display: 'flex', gap: 'var(--sp-2_5)' },
  pullBtn: { flex: 1, background: 'linear-gradient(180deg, #ff7ba6 0%, #ff5d8f 38%, #c264e6 78%, #a94fd6 100%)', border: 'none', color: 'var(--c-text-bright)', padding: '14px', borderRadius: 'var(--r-xl)', fontSize: 'var(--fs-h3)', fontWeight: 800, cursor: 'pointer', textShadow: '0 1px 1px rgba(80,0,40,0.5)', boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(120,0,70,0.45), 0 4px 10px rgba(255,93,143,0.4), 0 2px 4px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,180,210,0.3)' },
  pullBtn10: { flex: 1, background: 'linear-gradient(180deg, #1a1c28, #121420)', border: '1px solid #ff5d8f', color: 'var(--c-accent-pink-light)', padding: '14px', borderRadius: 'var(--r-xl)', fontSize: 'var(--fs-h3)', fontWeight: 800, cursor: 'pointer', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 12px rgba(255,93,143,0.18), inset 0 -2px 4px rgba(0,0,0,0.5), 0 3px 7px rgba(0,0,0,0.45), 0 0 8px rgba(255,93,143,0.22)' },
  hint: { color: 'var(--c-text-dim)', fontSize: 'var(--fs-caption)', lineHeight: 1.5 },
  vibecoded: { margin: '14px 0 0', fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-faint)', fontStyle: 'italic', lineHeight: 1.5 },
  gallery: { maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4_5)' },
  tierHead: { margin: '0 0 8px', fontSize: 'var(--fs-h4)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 'var(--sp-2)' },
  tile: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', background: 'var(--c-surface-2)', border: '1px solid', borderRadius: 'var(--r-lg)', padding: '10px 12px', cursor: 'pointer', fontSize: 'var(--fs-body)', textAlign: 'left' },
  tileDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  dupe: { marginLeft: 'auto', color: 'var(--c-text-dim)', fontSize: 'var(--fs-caption)' },
  starBadge: { marginLeft: 'auto', color: 'var(--c-accent-gold-deep)', fontSize: 'var(--fs-micro)', letterSpacing: -1 },
  effectBox: { ...VITRINE, borderRadius: 'var(--r-lg)', padding: '8px 12px', margin: '2px 0 8px' },
  chatFeed: { height: 'min(62vh, 500px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', background: 'var(--c-surface-0)', border: '1px solid #23252f', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3_5)', boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(95,224,198,0.04)' },
  chatMsg: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-px)', background: 'linear-gradient(180deg, #181a24, #131420)', borderRadius: 'var(--r-lg)', padding: '8px 12px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.35)' },
  chatHandle: { fontSize: 'var(--fs-eyebrow)', fontWeight: 800 },
  chatText: { fontSize: 13.5, color: 'var(--c-text-secondary)', lineHeight: 1.45 },
  chatSticker: { width: 132, height: 'auto', borderRadius: 'var(--r-md)', marginTop: 'var(--sp-1)' },
  stickerBar: { display: 'flex', gap: 'var(--sp-1_5)', overflowX: 'auto', padding: '10px 4px 2px', marginTop: 'var(--sp-1)' },
  stickerPick: { ...CAP, flex: '0 0 auto', width: 54, height: 54, padding: 3, borderRadius: 'var(--r-lg)' },
  subTabs: { display: 'flex', gap: 'var(--sp-1_5)', marginTop: 'var(--sp-1)' },
  subTab: { ...VITRINE, flex: 1, color: 'var(--c-text-dim)', borderRadius: 'var(--r-md)', padding: '7px 10px', cursor: 'pointer', fontSize: 'var(--fs-body-sm)', fontWeight: 700 },
  subTabOn: { background: '#23263a', color: 'var(--c-text-bright)', borderColor: 'var(--c-accent-teal)' },
  histList: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', maxHeight: 340, overflowY: 'auto', marginTop: 'var(--sp-1)' },
  histRow: { ...VITRINE, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', borderRadius: 'var(--r-md)', padding: '7px 10px', fontSize: 13.5 },
  rankBadge: { display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', background: 'linear-gradient(180deg, #1a1b24, #101119)', border: '1px solid #3a3320', borderRadius: 'var(--r-xl)', padding: '6px 12px 6px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(255,207,107,0.12), 0 2px 5px rgba(0,0,0,0.4)' },
  rankLetter: { fontSize: 19, fontWeight: 900, border: '2px solid', borderRadius: 9, minWidth: 34, height: 34, padding: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  multGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--sp-1_5)', marginBottom: 'var(--sp-2_5)' },
  multRow: { ...VITRINE, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 'var(--r-md)', padding: '6px 10px' },
  engine: { maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  engineHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' },
  engineBtns: { display: 'flex', gap: 'var(--sp-2)' },
  smallBtn: { ...CAP, padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-body-sm)' },
  engineList: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)' },
  engineRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', background: 'var(--c-surface-2)', border: '1px solid', borderRadius: 'var(--r-lg)', padding: '8px 12px' },
  engineNick: { fontWeight: 600 },
  engineCost: { color: 'var(--c-text-dim)', fontSize: 'var(--fs-caption)', marginLeft: 'auto', marginRight: 'var(--sp-2_5)' },
  toggle: { ...CAP, padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-body-sm)' },
  toggleOn: { background: 'var(--c-surface-6)', borderColor: 'var(--c-accent-teal)' },
  modal: { position: 'fixed', inset: 0, background: 'radial-gradient(circle at 50% 40%, rgba(10,10,20,0.55), rgba(3,3,8,0.9))', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 10, padding: 'var(--sp-4)' },
  revealCard: { boxSizing: 'border-box', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-4xl)', padding: 'var(--sp-6)', textAlign: 'center', maxWidth: 420, width: '100%', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  revealStage: { height: 280, borderRadius: 'var(--r-xl)', overflow: 'hidden', marginBottom: 'var(--sp-2_5)', background: 'var(--c-bg-stage)', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  revealSub: { color: '#aab', margin: '4px 0 14px' },
  revealRow: { display: 'flex', justifyContent: 'center', gap: 'var(--sp-1_5)', marginBottom: 'var(--sp-3_5)', flexWrap: 'wrap' },
  chargeWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-6)' },
  chargeHint: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', letterSpacing: 0.5 },
  haulGrid: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--sp-1_5)', marginBottom: 'var(--sp-3_5)' },
  haulTile: { position: 'relative', width: 44, height: 44, borderRadius: 9, border: '2px solid', display: 'grid', placeItems: 'center' },
  haulNew: { position: 'absolute', top: -6, right: -6, fontSize: 8, fontWeight: 800, color: 'var(--c-text-bright)', background: 'var(--c-accent-pink)', borderRadius: 'var(--r-sm)', padding: '1px 4px', letterSpacing: 0.3 },
  miniGem: { width: 18, height: 18, borderRadius: '50%' },
  nudge: { position: 'fixed', left: '50%', bottom: 'var(--sp-4)', transform: 'translateX(-50%)', maxWidth: 560, width: 'calc(100% - 32px)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', background: 'rgba(28,30,42,0.94)', border: '1px solid #2a2c3a', borderRadius: 'var(--r-lg)', padding: '10px 14px', boxShadow: '0 6px 24px rgba(0,0,0,0.45)', zIndex: 5 },
  nudgeText: { flex: 1, fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-secondary)', lineHeight: 1.4 },
  nudgeClose: { background: 'none', border: 'none', color: 'var(--c-text-dim)', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: 'var(--sp-1)' },
  devBar: { position: 'fixed', top: 'var(--sp-2)', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 'var(--sp-1_5)', alignItems: 'center', background: 'rgba(40,20,50,0.96)', border: '1px solid #6b3a7a', borderRadius: 'var(--r-lg)', padding: '6px 10px', zIndex: 20, flexWrap: 'wrap', maxWidth: '94%' },
  devTitle: { color: 'var(--c-accent-pink-bright)', fontSize: 'var(--fs-caption)', fontWeight: 700, marginRight: 'var(--sp-1)' },
  devBtn: { ...CAP, border: '1px solid #6b3a7a', borderRadius: 'var(--r-sm)', padding: '4px 8px', fontSize: 'var(--fs-caption)' },
  fluxIcon: { color: 'var(--c-accent-gold)' }, // Flux ✦ — warm gold
  shardIcon: { color: 'var(--c-shard)' }, // Shards ◈ — cool cyan

  // ── Engine / Forge visual boards ──
  board: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', paddingBottom: 'var(--sp-7)' },
  boardIntro: { ...VITRINE, borderRadius: 'var(--r-xl)', padding: '12px 14px' },
  boardTitle: { margin: '0 0 6px', fontSize: 'var(--fs-h2)', color: 'var(--c-text)', fontFamily: 'var(--font-display)', letterSpacing: 0.3 },
  boardDesc: { margin: 0, fontSize: 'var(--fs-body-sm)', lineHeight: 1.5, color: 'var(--c-text-muted)' },
  helpClose: { position: 'absolute', top: -2, right: -4, background: 'none', border: 'none', color: 'var(--c-text-faint)', cursor: 'pointer', fontSize: 'var(--fs-h3)', lineHeight: 1, padding: 'var(--sp-1)' },
  shardBank: { marginTop: 'var(--sp-2)', fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-secondary)', fontWeight: 600 },
  boardStats: { ...VITRINE, display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3_5)' },
  bigStat: { display: 'flex', flexDirection: 'column', minWidth: 120 },
  bigStatNum: { fontSize: 'var(--fs-display)', fontWeight: 800, lineHeight: 1 },
  bigStatLbl: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', marginTop: 3 },
  budgetBox: { flex: 1, minWidth: 160 },
  budgetTop: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', marginBottom: 'var(--sp-1)' },
  boardBtns: { display: 'flex', gap: 'var(--sp-2)' },
  floorWrap: { position: 'relative', height: 300, borderRadius: 'var(--r-2xl)', overflow: 'hidden', border: '1px solid #23252f', background: '#0a0b12', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  floorTag: { position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-2_5)', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 'var(--fs-body-sm)', pointerEvents: 'none', textShadow: '0 1px 6px #000' },
  floorEmpty: { display: 'grid', placeItems: 'center', height: '100%', padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--c-text-faint)', fontSize: 'var(--fs-body)', lineHeight: 1.5 },
  boardSub: { margin: '6px 2px 0', fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 },
  chipGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(146px, 1fr))', gap: 'var(--sp-2)' },
  boardGrid: { display: 'grid', gap: 5, maxWidth: 360, margin: '0 auto 4px' },
  boardCell: { aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid', borderRadius: 'var(--r-md)', cursor: 'pointer', color: 'var(--c-text)', padding: 0, transition: 'background .12s, box-shadow .12s' },
  deployChip: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--sp-0_5)', background: 'linear-gradient(180deg, #1e202c, #15161f)', border: '2px solid', borderRadius: 'var(--r-lg)', padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: 'var(--c-text)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 3px 6px rgba(0,0,0,0.4)' },
  benchChip: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--sp-0_5)', background: 'linear-gradient(180deg, #101119, #0c0d15)', border: '1px solid #23252f', borderRadius: 'var(--r-lg)', padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: 'var(--c-text-secondary)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(120,130,160,0.08)' },
  chipNick: { fontSize: 'var(--fs-body)', fontWeight: 700 },
  chipProd: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', fontWeight: 600 },
  chipMeta: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-faint)' },
  emptyHint: { ...VITRINE, border: '1px dashed #2a2e3e', gridColumn: '1 / -1', fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-muted)', lineHeight: 1.6, borderRadius: 'var(--r-xl)', padding: '22px 16px', textAlign: 'center' },
  relicPanel: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', background: 'linear-gradient(120deg, #221c0e 0%, #16151c 60%)', border: '1px solid #6b5a2a', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3_5)', boxShadow: 'inset 0 1px 0 rgba(255,222,150,0.12), inset 0 0 24px rgba(120,90,20,0.12), inset 0 0 0 1px rgba(255,207,107,0.10), 0 3px 8px rgba(0,0,0,0.4)' },
  summonBtn: { background: 'linear-gradient(180deg, #ffe08a, #ffce5c 45%, #ff9d5c)', color: '#2a1d00', border: 'none', borderRadius: 'var(--r-md)', padding: '10px 14px', fontWeight: 800, cursor: 'pointer', fontSize: 'var(--fs-body-sm)', whiteSpace: 'nowrap', textShadow: '0 1px 0 rgba(255,230,180,0.5)', boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(150,80,0,0.45), 0 3px 7px rgba(255,170,60,0.4), 0 0 0 1px rgba(120,70,0,0.4)' },
  recipeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 'var(--sp-2_5)' },
  recipeCard: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2_5)', background: 'linear-gradient(180deg, #16171f, #101119)', border: '2px solid', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -2px 5px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.3)' },
  recipeFlow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-1)' },
  flowOp: { color: 'var(--c-text-faint)', fontSize: 'var(--fs-body)', fontWeight: 700 },
  gemChip: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-1)', width: 56 },
  gemChipDot: { width: 26, height: 26, borderRadius: '50%', boxShadow: '0 0 10px rgba(0,0,0,0.4)' },
  gemChipName: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-secondary)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 56 },
  forgeBtn: { background: 'linear-gradient(180deg, #303341, #23252f 55%, #1a1b24)', color: 'var(--c-text-bright)', border: '1px solid #3a3d4f', borderTopColor: '#4a4e62', borderRadius: 'var(--r-md)', padding: 'var(--sp-2)', fontWeight: 700, cursor: 'pointer', fontSize: 'var(--fs-body-sm)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 2px rgba(0,0,0,0.45), 0 2px 3px rgba(0,0,0,0.4)' },
  discoveredTag: { position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-2_5)', fontSize: 'var(--fs-micro)', color: 'var(--c-accent-teal)' },

  // ── Shop / Ledger / Settings ──
  sceneSwatch: { display: 'flex', height: 38, borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid #23252f' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--sp-2)' },
  statCard: { ...VITRINE, display: 'flex', flexDirection: 'column', gap: 'var(--sp-0_5)', borderRadius: 'var(--r-lg)', padding: '10px 12px' },
  statVal: { fontSize: 'var(--fs-numeral)', fontWeight: 800, color: 'var(--c-text)' },
  statLbl: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-dim)' },
  settingsCard: { boxSizing: 'border-box', width: 'min(560px, calc(100vw - 28px))', maxHeight: '86vh', overflow: 'auto', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-2xl)', padding: 'var(--sp-4)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  settingsHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2_5)' },
  settingsTabs: { display: 'flex', gap: 'var(--sp-1_5)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' },
  settingsBody: { minHeight: 140 },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1c1e2a', color: 'var(--c-text-secondary)', fontSize: 'var(--fs-body)' },
  attrList: { margin: '0 0 4px', paddingLeft: 'var(--sp-4_5)' },
  kinBox: { ...VITRINE, marginTop: 'var(--sp-1_5)', padding: '8px 10px', borderRadius: 'var(--r-lg)', textAlign: 'left' },
  kinHead: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-pink-bright)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 'var(--sp-1)' },
  kinRow: { display: 'flex', gap: 'var(--sp-1_5)', alignItems: 'baseline', fontSize: 'var(--fs-caption)', lineHeight: 1.5 },
  kinType: { color: 'var(--c-text-dim)', fontSize: 'var(--fs-micro)', textTransform: 'uppercase', width: 56, flexShrink: 0 },
  kinNote: { color: 'var(--c-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' },
  bondRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-h2)', margin: '0 0 6px' },
  bondHint: { color: 'var(--c-text-dim)', fontSize: 'var(--fs-caption)' },
  watchPill: { marginLeft: 'auto', flexShrink: 0, background: '#3a2440', color: 'var(--c-accent-pink-bright)', border: '1px solid #6b3a7a', borderRadius: 'var(--r-pill)', padding: '2px 8px', fontSize: 'var(--fs-micro)', fontWeight: 700, whiteSpace: 'nowrap' },

  // ── Ship cutscene ──
  shipCard: { boxSizing: 'border-box', width: 'min(480px, calc(100vw - 28px))', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-3xl)', padding: 'var(--sp-5)', textAlign: 'center', position: 'relative', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  shipHead: { color: 'var(--c-accent-pink-bright)', fontWeight: 800, fontSize: 'var(--fs-h4)', marginBottom: 'var(--sp-3_5)', letterSpacing: 0.3 },
  logBtn: { position: 'absolute', top: 'var(--sp-3_5)', right: 'var(--sp-3_5)', background: 'rgba(40,30,48,0.8)', border: '1px solid #4a3a52', color: '#ffb8e0', borderRadius: 'var(--r-pill)', width: 30, height: 30, cursor: 'pointer', fontSize: 'var(--fs-body)', lineHeight: 1 },
  logBox: { minHeight: 78, maxHeight: 220, overflowY: 'auto', background: 'var(--c-surface-0)', border: '1px solid #23252f', borderRadius: 'var(--r-xl)', padding: '12px 14px', marginBottom: 'var(--sp-3_5)', textAlign: 'left', boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(95,224,198,0.04)' },
  logModalCard: { boxSizing: 'border-box', width: 'min(460px, calc(100vw - 28px))', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-3xl)', padding: 'var(--sp-5)', textAlign: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  logModalBox: { maxHeight: '58vh', overflowY: 'auto', textAlign: 'left', margin: '12px 0 14px', background: 'var(--c-surface-0)', border: '1px solid #23252f', borderRadius: 'var(--r-xl)', padding: '12px 14px', boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(95,224,198,0.04)' },
  shipGems: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-4_5)', marginBottom: 'var(--sp-3_5)' },
  shipGem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-1_5)', transition: 'all 0.25s ease', color: 'var(--c-text-secondary)', fontSize: 'var(--fs-body-sm)', fontWeight: 700 },
  shipGemDot: { width: 52, height: 52, borderRadius: '50%', transition: 'all 0.25s ease' },
  shipHeart: { color: 'var(--c-accent-pink)', fontSize: 22 },
  shipLineBox: { minHeight: 78, background: 'var(--c-surface-0)', border: '1px solid #23252f', borderRadius: 'var(--r-xl)', padding: '12px 14px', marginBottom: 'var(--sp-3_5)', textAlign: 'left', boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(95,224,198,0.04)' },
  shipText: { color: 'var(--c-text)', fontSize: 'var(--fs-h4)', lineHeight: 1.5, margin: '6px 0 0', fontStyle: 'italic' },
  shipDots: { display: 'flex', justifyContent: 'center', gap: 'var(--sp-1_5)', marginTop: 'var(--sp-3)' },
  shipDot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--c-accent-pink-bright)' },

  // ── list search / filters ──
  listHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', justifyContent: 'space-between', flexWrap: 'wrap' },
  search: { background: 'var(--c-surface-0)', border: '1px solid #2a2c3a', borderRadius: 'var(--r-md)', color: 'var(--c-text)', padding: '6px 10px', fontSize: 'var(--fs-body-sm)', width: 170, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(120,130,160,0.08)' },
  galleryControls: { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2_5)', alignItems: 'center', marginBottom: 'var(--sp-2)' },
  filterChips: { display: 'flex', gap: 'var(--sp-1_5)', flexWrap: 'wrap' },
  filterChip: { background: 'var(--c-surface-1)', border: '1px solid', borderRadius: 'var(--r-pill)', padding: '3px 10px', fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: 'pointer' },
  tileGlyph: { fontSize: 'var(--fs-h2)', lineHeight: 1, marginRight: 'var(--sp-0_5)' },
  kbd: { fontSize: 'var(--fs-micro)', background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 'var(--r-xs)', padding: '0 5px', marginLeft: 5, fontFamily: 'ui-monospace, monospace' },
  shipModel: { position: 'relative', width: 132, height: 132, borderRadius: 'var(--r-xl)', overflow: 'hidden', transition: 'all 0.25s ease', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  shipModelName: { position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-1)', textAlign: 'center', fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--c-text-bright)', textShadow: '0 1px 4px #000', pointerEvents: 'none' },
  shipStage: { position: 'relative', height: 250, borderRadius: 'var(--r-xl)', overflow: 'hidden', border: '1px solid #2a2c3a', marginBottom: 'var(--sp-3_5)', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  shipNames: { position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-2)', display: 'flex', justifyContent: 'center', gap: 'var(--sp-3_5)', fontSize: 'var(--fs-body-sm)', textShadow: '0 1px 6px #000', pointerEvents: 'none' },
  kbRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', padding: '5px 0', borderBottom: '1px solid #1c1e2a' },
  kbDesc: { color: 'var(--c-text-muted)', fontSize: 12.5 },
  kbd2: { fontFamily: 'ui-monospace, monospace', fontSize: 'var(--fs-caption)', background: 'var(--c-surface-0)', border: '1px solid #3a3d4f', borderRadius: 5, padding: '2px 7px', color: 'var(--c-text)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(120,130,160,0.08)' },
  milestoneRow: { ...VITRINE, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '6px 10px', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-body-sm)' },
  objectives: { ...VITRINE, borderRadius: 'var(--r-xl)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  objHead: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 },
  objRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
  objLabel: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  objNum: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-teal)', fontWeight: 700, flexShrink: 0 },
  mileToast: { position: 'fixed', top: 58, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', background: 'rgba(30,24,12,0.96)', border: '1px solid #6b5a2a', borderRadius: 'var(--r-xl)', padding: '10px 16px', zIndex: 60, minWidth: 290, maxWidth: '92vw', boxShadow: '0 6px 24px rgba(0,0,0,0.55)', cursor: 'pointer', overflow: 'hidden' },
  toastDrain: { position: 'absolute', left: 0, bottom: 0, height: 2, width: '100%', background: 'var(--c-accent-gold-deep)', borderRadius: 2 },
  tourWrap: { position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', padding: '0 12px 18px', zIndex: 70, pointerEvents: 'none' },
  tourCard: { boxSizing: 'border-box', pointerEvents: 'auto', width: 'min(460px, calc(100vw - 28px))', background: 'rgba(18,19,26,0.97)', border: '1px solid #3a3d4f', borderRadius: 'var(--r-2xl)', padding: '14px 16px', boxShadow: '0 8px 30px rgba(0,0,0,0.6)' },
  patSurface: { position: 'absolute', inset: 0, cursor: 'grab', touchAction: 'none', zIndex: 3, overflow: 'hidden' },
  patGlow: { position: 'absolute', width: 130, height: 130, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,222,150,0.55), rgba(255,180,220,0.18) 45%, transparent 72%)', pointerEvents: 'none' },
  patBtn: { position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-2)', zIndex: 4, background: 'rgba(40,24,44,0.85)', border: '1px solid #6b3a7a', color: 'var(--c-accent-pink-bright)', borderRadius: 'var(--r-pill)', padding: '4px 10px', fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: 'pointer' },
}
