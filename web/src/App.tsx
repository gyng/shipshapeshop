import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useGame, RARITY_ORDER, type ShapeRow, type RarityName, type PullOutcome, type ForgeResult } from './game/store'
import { HeroView } from './three/HeroView'
import { PullCeremony } from './three/PullCeremony'
import { RAYMARCH_SHAPES } from './three/RaymarchGem'
import { FactoryFloor } from './three/FactoryFloor'
import { RoomScene } from './three/RoomScene'
import { ForgeAltar } from './three/ForgeAltar'
import { ShipScene } from './three/ShipScene'
import { RARITY_COLOR } from './three/Gem'
import { CODEX } from './content/codex'
import { SCENES, SOUNDSCAPES, sceneById, SHOP_CATEGORIES, ceremonyById, titleById, soundscapeById, SLOT_CEREMONY, SLOT_TITLE, SLOT_SOUNDSCAPE } from './content/cosmetics'
import { useMusicPrefs } from './musicPrefs'
import { setForcedStyle, STYLES } from './orreryBed'
import { bedControl } from './bedControl'
import { KINSHIP } from './content/kinship'
import { SHIP_SCENES, useShips, hasShip, availableShips } from './content/ships'
import { glyphOf } from './content/glyphs'
import { fontOf } from './content/fonts'
import { useGfx, presetFor, PT_PRESETS, useFpsWatchdog, type Quality, type PathTraceScope, type PathTraceQuality } from './gfx'
import { UPGRADE_INFO, DOCTRINE_EXCLUSIONS } from './content/upgrades'
import { WorkshopTree } from './WorkshopTree'
import { ExpeditionView } from './ExpeditionView'
import { MILESTONE_INFO, milestoneReward } from './content/milestones'
import { FACET_INFO } from './content/facets'
import { chatterFor } from './content/chatter'
import { BANNER_INFO, rotatingBannerId } from './content/banners'
import { shapeEffect, fluxPattern } from './content/effects'
import { FluxBehaviour } from './ui/FluxBehaviour'
import { generateMessages, stickerSrc, STICKER_COUNT, type ChatMsg } from './content/chatlas'
import { useChatlasPlus } from './chatlas/useChatlasPlus'
import { useChatlasFeed, useChatlasChat, useChatlasRoster, useChatlasTyping } from './chatlas/useChatlasFeed'
import { chatlasConnect, chatlasDisconnect, chatlasBroadcast, chatlasSendChat, chatlasSendTyping, onChatlasEvent, onChatlasChat } from './chatlas/chatlasNet'
import { PROFILE_COLORS } from './chatlas/chatlasPlus'
import { useMutes } from './chatlas/mutes'
import { peerEventToMsg, type PeerEvent, type RosterEntry, type ChatMessage, type ChatlasProfile } from './chatlas/transport'
import { useDialogLog } from './dialogLog'
import { useCosmeticsQuick } from './cosmeticsQuick'
import { useTitle, titleSrc, TITLE_COUNT } from './titleArt'
import { curatorRank, RANK_COLOR } from './curatorRank'
import { useInspector } from './inspector'
import { useHistory } from './history'
import { useHelp } from './help'
import { OrreryEngine } from './OrreryEngine'
import { fmt, fmtEta } from './format'
import { Numeral, Tooltip, COLOR } from './ui'
import { useT, useLangStore, LANGS } from './i18n'
import { useHints, useTour } from './onboarding'
import { useMute, sfxUpgrade, sfxClimbTick, sfxReveal, sfxHaul, sfxTab, sfxTap, sfxPat, speak, stopVoice, previewInstrument } from './audio'
import { instrumentForShape, noteForShape } from './orreryAudio'
import { useNav } from './nav'
import { MusicEngineInspector } from './MusicEngineInspector'
import { MusicStylesSettings } from './MusicStylesSettings'
import { OrreryBedDriver } from './orreryBedDriver'
import { installButtonJuice } from './buttonJuice'
import { useBedStatus } from './bedStatus'
import { SoundIcon, MusicIcon, LogIcon, SettingsIcon, WrenchIcon, CosmeticsIcon } from './ui/Icons'
import { SkipBack, SkipForward, Play, Pause, Headphones, Library, Radio } from 'lucide-react'
import { DEV_MODE } from './devmode'
import { Floaters, useFloaters, Sparks, useSparks, purchaseBurst, useMascotCheer } from './juice'

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

type Tab = 'engine' | 'workshop' | 'gacha' | 'room' | 'chatlas' | 'gallery' | 'forge' | 'shop' | 'ledger' | 'expedition'
const TABS: Tab[] = ['engine', 'expedition', 'workshop', 'gacha', 'room', 'chatlas', 'gallery', 'forge', 'shop', 'ledger']

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
    expedition: <><path d="M14.5 4.5l5 5-9 9-5 1 1-5z" /><path d="M12.5 6.5l5 5" /><path d="M3.5 20.5l3-3" /></>, // explorer's blade
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {paths[tab]}
    </svg>
  )
}

// A tiny DOM FPS counter (toggleable in Settings ▸ Graphics). Counts rAF frames over a 0.5s window — independent
// of any Canvas, so it reflects the whole app's frame rate. Greens/ambers/reds at 50/30 fps.
function FpsMeter() {
  const show = useGfx((s) => s.showFps)
  const [fps, setFps] = useState(60)
  useEffect(() => {
    if (!show) return
    let raf = 0
    let frames = 0
    let last = performance.now()
    const loop = (t: number) => {
      frames++
      if (t - last >= 500) {
        setFps(Math.round((frames * 1000) / (t - last)))
        frames = 0
        last = t
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [show])
  if (!show) return null
  const col = fps >= 50 ? '#5fe0c6' : fps >= 30 ? '#ffcf6b' : '#ff6b8a'
  return (
    <div style={{ position: 'fixed', top: 8, left: 8, zIndex: 100, padding: '3px 8px', borderRadius: 6, background: 'rgba(10,11,18,0.82)', border: '1px solid #2a2c3a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, fontWeight: 600, color: col, pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>
      {fps} FPS
    </div>
  )
}

export function App() {
  const { ready, boot } = useGame()
  useEffect(() => {
    void boot()
  }, [boot])
  // Passive FPS watchdog: if the frame rate stays low, auto-step graphics down ONCE (never raises). Mounted once.
  useFpsWatchdog()
  // Equipped Soundscape (Shop cosmetic) pins the lofi bed's mood; null = auto. Applies at the next section.
  const soundscapeStyle = useGame((s) => soundscapeById(s.view?.equipped?.[SLOT_SOUNDSCAPE] ?? 0).style)
  useEffect(() => {
    setForcedStyle(soundscapeStyle)
  }, [soundscapeStyle])
  // Buying a premium-style soundscape in the Shop unlocks that style for the Drift rotation + the Settings ▸
  // Audio list. Core cosmetics (Rust-owned) are the source of truth; musicPrefs mirrors them here on change.
  const ownedCosmetics = useGame((s) => s.view?.cosmetics)
  useEffect(() => {
    if (!ownedCosmetics) return
    const prefs = useMusicPrefs.getState()
    for (const sc of SOUNDSCAPES) {
      if (sc.style && !prefs.owned[sc.style] && ownedCosmetics.includes(sc.id) && STYLES.find((x) => x.id === sc.style)?.premium) prefs.unlock(sc.style)
    }
  }, [ownedCosmetics])
  const [tab, setTab] = useState<Tab>('engine') // fresh load opens on the Orrery (the idle home), not the Pull screen
  // drain one-shot tab requests (e.g. the orrery's Euler meter deep-linking to the Workshop)
  const navPending = useNav((s) => s.pending)
  useEffect(() => {
    if (navPending) {
      setTab(navPending)
      useNav.getState().clear()
    }
  }, [navPending])
  // mirror the active screen into the store so background ticks (auto-forge) can pop reveals only on the Forge
  const setActiveTab = useGame((s) => s.setActiveTab)
  useEffect(() => { setActiveTab(tab) }, [tab, setActiveTab])
  const inspect = useInspector((s) => s.id)
  const setInspect = useInspector((s) => s.set)
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const navShapes = useGame((s) => s.shapes)
  const navOwned = useGame((s) => s.view?.owned)
  const shipSeen = useShips((s) => s.seen)
  const newCutscenes = availableShips(navShapes, navOwned, shipSeen).length
  // nudge the player to the Orrery when it's idle: they own shapes but have none deployed (so it earns nothing)
  const orreryEmpty = useGame((s) => !!s.view && s.view.loadout.length === 0 && s.view.distinct_owned > 0)
  const tr = useT()

  // Cursor-sheen + click-ripple on the primary CTA caps (delegated once, app-wide).
  useEffect(() => installButtonJuice(), [])

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
        if (g.view?.can_ten_pull) g.tenPull()
      } else if (k === 'm') {
        useMute.getState().toggleSfx()
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

  // Primary-button CLICK juice: a celebratory mote firework radiating outward from the click point — reuses the
  // game's own spark system so it reads as the same "particle" language everywhere, but bigger/brighter than the
  // hover drips (the click is the engineered pop). One delegated listener covers every primary button
  // (.btn-primary / the main-CTA .pull-cap); disabled buttons don't dispatch click anyway. Reduced-motion skips it.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement)?.closest?.('.btn-primary, .pull-cap') as HTMLElement | null
      if (!btn || btn.hasAttribute('disabled')) return
      const r = btn.getBoundingClientRect()
      // burst from the actual click point (falling back to the button centre for keyboard activation)
      const cx = e.clientX || r.left + r.width / 2
      const cy = e.clientY || r.top + r.height * 0.4
      useSparks.getState().burst(cx, cy, { count: 14, power: 1.6, hues: ['#fff6dc', '#ffe6a8', '#ffcf6b', '#ffae3a'] })
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [])

  if (!ready) {
    return <div style={S.loading}>{tr('boot.lighting')}</div>
  }
  return (
    <div style={{ ...S.app, background: sceneById(sceneId).bg }}>
      <Hud />
      <OrreryBedDriver />{/* the generative lofi bed — mounted app-wide so it plays on every screen, not just the orrery */}
      <NavRail>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { if (t !== tab) sfxTab(); setTab(t) }} title={`${tr('nav.shortcutTitle')}${i + 1}`} aria-current={tab === t ? 'page' : undefined} style={{ ...S.navBtn, ...(t === 'engine' ? S.navBtnImportant : {}), ...(tab === t ? S.navBtnActive : {}) }}>
            <TabIcon tab={t} />
            <span>{tr(t === 'gacha' ? 'nav.pull' : `nav.${t}`)}</span>
            {t === 'gallery' && newCutscenes > 0 && (
              <span style={S.navBadge}>
                <span style={S.navBadgeHeart}>♥</span>
                <span style={S.navBadgeNum}>{newCutscenes}</span>
              </span>
            )}
            {t === 'engine' && orreryEmpty && (
              <span className="nav-dot" style={S.navDot} title={tr('nav.orreryEmpty')} aria-label={tr('nav.orreryEmpty')}>!</span>
            )}
          </button>
        ))}
      </NavRail>
      <main style={S.main}>
        {/* Orrery + Room are full-bleed stages (their roots use flex:1) — the wrapper must be a flex column that
            fills `main` so that propagates. Other tabs stay auto-height and scroll via main's overflow. */}
        <div key={tab} className="fade-in" style={tab === 'engine' || tab === 'room' ? S.tabFill : undefined}>
          {tab === 'gacha' && <GachaView />}
          {tab === 'room' && <RoomView />}
          {tab === 'chatlas' && <ChatlasView />}
          {tab === 'gallery' && <GalleryView onInspect={setInspect} />}
          {tab === 'engine' && <EngineView />}
          {tab === 'expedition' && <><ExpeditionView /><MascotOverlay family="trefoil" name={tr('expedition.mascot.name')} lines={[tr('expedition.mascot.line'), tr('expedition.mascot.line2'), tr('expedition.mascot.line3')]} thanks={tr('expedition.mascot.thanks')} /></>}
          {tab === 'workshop' && <WorkshopView />}
          {tab === 'forge' && <ForgeView />}
          {tab === 'shop' && <ShopView />}
          {tab === 'ledger' && <LedgerView />}
        </div>
      </main>
      <RevealModal />
      <ForgeToast />
      <AscensionModal />
      <OfflineModal />
      <WelcomeModal />
      {inspect !== null && <Inspector id={inspect} onClose={() => setInspect(null)} />}
      <SettingsModal />
      <CosmeticsQuickPopup />
      <ShipCutscene />
      <DialogLogModal />
      <Nudge onGo={setTab} />
      <DevBar />
      <Floaters />
      <Sparks />
      <FpsMeter />
      <IdleFlux />
      <MilestoneToast />
      <WatchdogToast />
      <ChatlasNetDriver />
      <ChatlasBroadcaster />
      <ChatlasChime />
      <TourCoachmark tab={tab} setTab={setTab} />
    </div>
  )
}

// Horizontally-scrollable top navigation. The chrome (brushed gradient + brass hairline) lives on the
// outer <nav>; an inner scroller holds the tabs. We fade whichever edge still has off-screen tabs as a
// scroll affordance (data-l / data-r toggled from scroll position + size — see .nav-rail in juice.css).
function NavRail({ children }: { children: ReactNode }) {
  const railRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = railRef.current
    const sc = scrollRef.current
    if (!rail || !sc) return
    const update = () => {
      rail.dataset.l = sc.scrollLeft > 1 ? '1' : '0'
      rail.dataset.r = sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1 ? '1' : '0'
    }
    update()
    sc.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(sc)
    return () => {
      sc.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  return (
    <nav ref={railRef} className="nav-rail" style={S.navRail}>
      <div ref={scrollRef} className="nav-scroll">
        {children}
      </div>
    </nav>
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
  const { devOpen, toggleDev, devAddFlux, devAddShards, devUnlockAll, devResetUnlocks, devOrreryPreset, recrystallize, resetSave, setBanner, bannerDefs, view } = useGame()
  if (!DEV_MODE || !devOpen) return null
  const curBanner = bannerDefs[view?.current_banner ?? 0]
  const curBannerName = curBanner ? BANNER_INFO[curBanner.key]?.name ?? curBanner.key : '—'
  return (
    <div style={S.devBar}>
      <span style={S.devTitle}>🛠 dev</span>
      <button style={S.devBtn} onClick={devAddFlux}>+1M <span style={S.fluxIcon}>✦</span></button>
      <button style={S.devBtn} onClick={devAddShards}>+2k <span style={S.shardIcon}>◈</span></button>
      <button style={S.devBtn} onClick={devUnlockAll}>Unlock all</button>
      <button style={S.devBtn} onClick={devResetUnlocks} title="reset the collection (shapes, recipes, achievements, bonds, ★, cosmetics) — keeps Flux/upgrades/prestige so you can re-pull and re-watch first-time moments">Reset unlocks</button>
      <span style={S.devTitle}>orrery:</span>
      <button style={S.devBtn} onClick={() => devOrreryPreset(0)} title="early-game loadout (2 commons)">Early</button>
      <button style={S.devBtn} onClick={() => devOrreryPreset(1)} title="mid-game loadout (5, to Epic)">Mid</button>
      <button style={S.devBtn} onClick={() => devOrreryPreset(2)} title="late-game loadout (9, to UR + prestige)">Late</button>
      <button style={S.devBtn} disabled={!bannerDefs.length} onClick={() => setBanner(((view?.current_banner ?? 0) + 1) % bannerDefs.length)} title="cycle the featured gacha banner (sticks in dev)">Banner: {curBannerName} ▸</button>
      <button style={S.devBtn} onClick={recrystallize}>Recrystallize ↑</button>
      <button style={S.devBtn} onClick={resetSave}>Reset save</button>
      <button style={S.devBtn} onClick={toggleDev}>close ✕</button>
    </div>
  )
}

// One-time, diegetic onboarding hints (the Ledger's voice). Shows the single most-relevant un-dismissed
// nudge for a non-obvious system; the core pull loop gets none (it's intentionally obvious).
function Nudge({ onGo }: { onGo: (tab: Tab) => void }) {
  const view = useGame((s) => s.view)
  const recipes = useGame((s) => s.recipes)
  const dismissed = useHints((s) => s.dismissed)
  const dismiss = useHints((s) => s.dismiss)
  const tr = useT()
  if (!view) return null
  let id: string | null = null
  if (view.distinct_owned >= 1 && view.loadout.length === 0) id = 'deploy'
  else if (recipes.some((r, i) => view.owned[r.a] > 0 && view.owned[r.b] > 0 && view.shards >= (view.recipe_costs[i] ?? 50) && !view.discovered[i])) id = 'forge'
  else if (view.core_complete) id = 'prestige'
  if (!id || dismissed.includes(id)) return null
  // each nudge points at the screen that resolves it — tap the toast to jump straight there
  const target: Record<string, Tab> = { deploy: 'engine', forge: 'forge', prestige: 'engine' }
  return (
    <div style={S.nudge}>
      <button onClick={() => onGo(target[id!])} style={{ ...S.nudgeText, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, flex: 1 }}>
        {tr(`nudge.${id}`)} <span style={{ color: 'var(--c-accent-teal)', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' }}>{tr('nudge.go')} ▸</span>
      </button>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: COLOR.gold, fontWeight: 'var(--fw-bold)' }}>
        <span>✦ {tr('hud.flux')}</span>
        <span>+{fmt(view.rate_per_hr)}{tr('hud.perHour')}</span>
      </div>
      {spark}
      {active.length > 0 && (
        <div style={{ borderTop: '1px solid #2c2f3c', marginTop: 2, paddingTop: 4 }}>
          {active.map(([label, m]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 'var(--fs-caption)' }}>
              <span style={{ color: '#9aa0b4' }}>{label}</span>
              <span style={{ color: '#5fe0c6', fontWeight: 'var(--fw-bold)' }}>×{m.toFixed(2)}</span>
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

// "Now playing" — a cozy lofi-stream caption for the live generative bed, shown in the top bar only while music
// is actually playing (shapes deployed, not muted). Hover for the details: tempo, feel, and your shape "band".
function NowPlaying() {
  const status = useBedStatus()
  const musicMuted = useMute((s) => s.musicMuted)
  const shapes = useGame((s) => s.shapes)
  const tr = useT()
  if (!status.playing || !status.current || musicMuted) return null
  const a = status.current
  const caption = tr(`nowPlaying.cap.${a.style.id}`)
  const band = a.voices.map((v) => shapes[v.id]?.nick).filter(Boolean) as string[]
  const feel = tr(`nowPlaying.feel.${a.style.feel ?? 'straight'}`)
  const tip = (
    <div style={{ fontSize: 'var(--fs-caption)', display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 240 }}>
      <b style={{ color: 'var(--c-accent-gold)' }}>{tr('nowPlaying.title')}</b>
      <span style={{ color: 'var(--c-text-secondary)' }}>♫ {caption}</span>
      <span style={{ color: 'var(--c-text-dim)' }}>{tr('nowPlaying.tempo', { n: a.bpm })} · {feel}</span>
      {band.length > 0 && (
        <span style={{ color: 'var(--c-text-dim)' }}>
          {tr('nowPlaying.band')}: {band.slice(0, 6).join(' · ')}
          {band.length > 6 ? ` +${band.length - 6}` : ''}
        </span>
      )}
      <span style={{ color: 'var(--c-text-faint)', fontStyle: 'italic' }}>{tr('nowPlaying.live')}</span>
    </div>
  )
  return (
    <Tooltip content={tip}>
      <button type="button" style={S.nowPlaying} onClick={() => useGame.getState().setSettingsOpen(true, 'audio')} title={tr('nowPlaying.openSettings')} aria-label={tr('nowPlaying.openSettings')}>
        <span className="np-eq" aria-hidden>
          <i /><i /><i />
        </span>
        {caption}
      </button>
    </Tooltip>
  )
}

// Compact transport for the generative bed, beside "Now playing". The bed has no track list, so ⏮/⏭ step the
// finite STYLE set (the closest thing to "tracks" — each is a distinct mood), via the registered bedControl;
// ⏯ toggles play/pause (mute). Gated on a deployed loadout (not `status.playing`, which goes false on mute) so
// the controls stay visible while paused, letting you un-pause. Degrades to a re-roll if pickStyle isn't wired.
function MusicTransport() {
  const loadout = useGame((s) => s.view?.loadout ?? [])
  const distinctOwned = useGame((s) => s.view?.distinct_owned ?? 0)
  const status = useBedStatus()
  const musicMuted = useMute((s) => s.musicMuted)
  const toggleMusic = useMute((s) => s.toggleMusic)
  const bgMusic = useMute((s) => s.musicWhenUnfocused)
  const toggleBgMusic = useMute((s) => s.toggleMusicWhenUnfocused)
  const musicSource = useMute((s) => s.musicSource)
  const toggleMusicSource = useMute((s) => s.toggleMusicSource)
  const tr = useT()
  // there's a band to control if shapes are deployed (Orrery source) or anything is unlocked (Library source)
  if (loadout.length === 0 && (musicSource !== 'library' || distinctOwned === 0)) return null
  const styleId = status.current?.style.id
  const idx = styleId ? STYLES.findIndex((s) => s.id === styleId) : -1
  const step = (delta: number) => {
    if (bedControl.pickStyle && idx >= 0) bedControl.pickStyle(STYLES[(idx + delta + STYLES.length) % STYLES.length].id)
    else bedControl.advance?.() // no style pin available ⇒ just re-roll a fresh section
  }
  return (
    <div style={S.musicTransport}>
      <Tooltip content={tr('transport.prev')}><button type="button" style={S.transportBtn} onClick={() => step(-1)} aria-label={tr('transport.prev')}><SkipBack size={15} /></button></Tooltip>
      <Tooltip content={tr('transport.toggle')}><button type="button" style={S.transportBtn} onClick={toggleMusic} aria-label={tr('transport.toggle')}>{musicMuted ? <Play size={15} /> : <Pause size={15} />}</button></Tooltip>
      <Tooltip content={tr('transport.next')}><button type="button" style={S.transportBtn} onClick={() => step(1)} aria-label={tr('transport.next')}><SkipForward size={15} /></button></Tooltip>
      <Tooltip content={tr(bgMusic ? 'transport.bgOn' : 'transport.bgOff')}>
        <button type="button" style={{ ...S.transportBtn, opacity: bgMusic ? 1 : 0.4, color: bgMusic ? 'var(--c-accent-gold)' : undefined }} onClick={toggleBgMusic} aria-label={tr('transport.bg')} aria-pressed={bgMusic}><Headphones size={15} /></button>
      </Tooltip>
      <Tooltip content={tr(musicSource === 'library' ? 'transport.sourceLibraryTip' : 'transport.sourceOrreryTip')}>
        <button type="button" style={{ ...S.transportBtn, color: musicSource === 'library' ? 'var(--c-accent-teal)' : undefined }} onClick={toggleMusicSource} aria-label={tr('transport.source')} aria-pressed={musicSource === 'library'}>{musicSource === 'library' ? <Library size={15} /> : <Radio size={15} />}</button>
      </Tooltip>
    </div>
  )
}

function Hud() {
  const view = useGame((s) => s.view)
  const flux = useFluxDisplay()
  const tr = useT()
  const lang = useLangStore((s) => s.lang)
  const setLang = useLangStore((s) => s.setLang)
  const muted = useMute((s) => s.sfxMuted)
  const toggleMute = useMute((s) => s.toggleSfx)
  const musicMuted = useMute((s) => s.musicMuted)
  const toggleMusic = useMute((s) => s.toggleMusic)
  const toggleDev = useGame((s) => s.toggleDev)
  const openSettings = useGame((s) => s.setSettingsOpen)
  // Juice: the Flux counter sparkles on EVERY increase — a gentle trickle as the idle drip accrues, a fuller
  // burst when a discrete reward lands. Particle count scales with the gain and is floored at 1 so even a tiny
  // tick still sparkles. The louder celebration (numeral pop + "+X" floater) is reserved for jumps above the
  // steady idle drip, so the HUD doesn't pulse/spam text every tick.
  const fluxTruth = view?.flux ?? 0
  const rate = view?.rate_per_hr ?? 0
  const prevFlux = useRef(fluxTruth)
  const fluxRef = useRef<HTMLSpanElement>(null)
  const [popN, setPopN] = useState(0)
  useEffect(() => {
    const gain = fluxTruth - prevFlux.current
    prevFlux.current = fluxTruth
    if (gain <= 0) return
    const el = fluxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const mag = Math.log10(Math.max(1, gain)) // 0 (ones) … ~7 (millions)
    // particles fire on every increase, scaled to the gain — small increases still emit one-or-some
    useSparks.getState().burst(cx, cy, { count: Math.max(1, Math.round(mag * 5)), power: Math.min(2.3, 0.5 + mag * 0.32) })
    // the louder celebration — numeral pop + "+X" floater — only for discrete rewards above the idle drip
    if (gain > Math.max(3, (rate / 3600) * 2.5)) {
      setPopN((n) => n + 1)
      useFloaters.getState().spawn(`+${fmt(gain)} ✦`, { color: '#ffe1a3', big: gain > 5000, x: cx, y: cy - 6 })
    }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
        {/* rank badge with the wordmark tucked BENEATH it (was an absolutely-centered wordmark that overlapped the sides) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
          <CuratorBadge compact />
          <div className="app-title" aria-hidden>{tr('app.title')}</div>
        </div>
        <Tooltip content={<FluxTooltipContent />}>
          <div style={{ cursor: 'help' }}>
            <span style={S.fluxLabel}><span style={S.fluxIcon}>✦</span> {tr('hud.flux')}</span>
            <span ref={fluxRef} key={popN} className="value-pop" style={S.fluxValue}>{fmt(flux)}</span>
            <span style={S.rate}>+<Numeral value={view.rate_per_hr} format={fmt} />{tr('hud.perHour')}</span>
          </div>
        </Tooltip>
      </div>
      <div style={S.hudStats}>
        <MusicTransport />
        <NowPlaying />{/* right-aligned, before the stat readouts */}
        <Tooltip content={<span style={{ fontSize: 'var(--fs-caption)' }}>{tr('hud.shardsTip')}</span>}>
          <span style={{ cursor: 'help' }}><span ref={shardRef} key={shardPop} className="value-pop" style={{ display: 'inline-block' }}><span style={S.shardIcon}>◈</span> <Numeral value={view.shards} format={fmt} /></span> {tr('hud.shards')}</span>
        </Tooltip>
        <Tooltip content={<span style={{ fontSize: 'var(--fs-caption)' }}>{tr('hud.collectionTip')}</span>}>
          <span style={{ cursor: 'help' }}>{tr('hud.collection')} {view.distinct_owned}/{view.pull_count}</span>
        </Tooltip>
        <Tooltip content={<span style={{ fontSize: 'var(--fs-caption)' }}>{tr('hud.dimTip')}</span>}>
          <span style={{ cursor: 'help' }}>{tr('hud.dim')} v{view.viewport_dim}{view.ng_cycle > 0 ? ` · NG+${view.ng_cycle}` : ''}</span>
        </Tooltip>
        {/* Ascend affordance — ALWAYS visible (signposts the meta-goal). Locked → dimmed + a tooltip naming what's
            needed; ready → a glowing purple pill that recrystallizes. Sits by the dimension readout (ascend = climb a dim). */}
        <Tooltip content={<span style={{ fontSize: 'var(--fs-caption)' }}>{view.core_complete ? tr('engine.recrystallize.ready') : tr('engine.recrystallize.locked', { n: view.distinct_owned })}</span>}>
          <button
            className={view.core_complete ? 'ascend-hud-ready' : undefined}
            onClick={() => { if (view.core_complete) useGame.getState().recrystallize() }}
            aria-disabled={!view.core_complete}
            aria-label={tr('engine.recrystallizeBtn')}
            style={{ font: 'inherit', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap', padding: '2px 10px', borderRadius: 'var(--r-pill)', cursor: view.core_complete ? 'pointer' : 'help', border: view.core_complete ? '1px solid #c9a6ff' : '1px solid var(--c-border)', color: view.core_complete ? '#efe4ff' : 'var(--c-text-faint)', background: view.core_complete ? 'linear-gradient(180deg, #8a5cd0, #6b3fc0)' : 'transparent', opacity: view.core_complete ? 1 : 0.55 }}
          >
            {tr('engine.recrystallizeBtn')}
          </button>
        </Tooltip>
        {view.facets > 0 && <span title={tr('hud.facetsTip')}>🌌 {view.facets}</span>}
        <button onClick={toggleMute} style={{ ...S.langBtn, ...(muted ? { color: 'var(--c-text-faint)' } : {}) }} aria-label={tr('hud.soundAria')} title={tr('hud.soundTip')}><SoundIcon muted={muted} /></button>
        <button onClick={toggleMusic} style={{ ...S.langBtn, ...(musicMuted ? { color: 'var(--c-text-faint)' } : {}) }} aria-label={tr('hud.musicAria')} title={tr('hud.musicTip')}><MusicIcon muted={musicMuted} /></button>
        <button onClick={() => useDialogLog.getState().setOpen(true)} style={S.langBtn} aria-label={tr('hud.dialogLogAria')} title={tr('hud.dialogLogTip')}><LogIcon /></button>
        <button onClick={() => useCosmeticsQuick.getState().setOpen(true)} style={S.langBtn} aria-label={tr('cosmeticsQuick.aria')} title={tr('cosmeticsQuick.tip')}><CosmeticsIcon /></button>
        <button onClick={() => openSettings(true)} style={S.langBtn} aria-label={tr('hud.settingsAria')} title={tr('hud.settingsTip')}><SettingsIcon /></button>
        {DEV_MODE && <button onClick={toggleDev} style={S.langBtn} aria-label="dev tools" title="Dev tools (compiled out at release)"><WrenchIcon /></button>}
        <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} style={S.langSelect} aria-label={tr('hud.langAria')}>
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
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
      case 'core_complete': return [view.distinct_owned, view.pull_count]
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
            <span style={{ fontSize: 'var(--fs-h4)' }}>{info.icon}</span>
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
    // Dev can force any banner (incl. ones not currently offered) and have it stick for testing.
    if (view && !DEV_MODE && !offered.includes(view.current_banner)) setBanner(0)
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
                <span style={{ color: '#8a90a8', fontSize: 'var(--fs-eyebrow)' }}>{tr('banner.fullPool')}</span>
              ) : (
                def.featured.slice(0, 6).map((id) => (
                  <span key={id} style={{ fontSize: 'var(--fs-h4)' }}>{glyphOf(shapes[id]?.family ?? '')}</span>
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

// Stated pull odds for the active banner (AGENTS §6 — odds are visible; surprise, not deception). The base
// tier rates mirror core/src/gacha.rs (DESIGN §7: C50/R30/E14/SSR5/UR1, SSR+ = 6%); live pity/resonance and
// the featured list come from the view.
const BASE_ODDS: [RarityName, string, string][] = [
  ['Common', 'Common', '50%'],
  ['Rare', 'Rare', '30%'],
  ['Epic', 'Epic', '14%'],
  ['Ssr', 'SSR', '5%'],
  ['Ur', 'UR', '1%'],
]
function OddsModal({ onClose }: { onClose: () => void }) {
  const { view, bannerDefs, shapes } = useGame()
  const tr = useT()
  if (!view) return null
  const bannerDef = bannerDefs[view.current_banner]
  const featured = bannerDef && bannerDef.featured.length ? bannerDef.featured : []
  return (
    <div style={S.modal} onClick={onClose}>
      <div className="pop-in" style={{ ...S.revealCard, maxWidth: 360, textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>{tr('pull.odds.title')}</h2>
        <h4 style={S.oddsSub}>{tr('pull.odds.baseTitle')}</h4>
        <div style={S.oddsTable}>
          {BASE_ODDS.map(([rk, name, pct]) => (
            <div key={rk} style={S.oddsRow}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1_5)' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: RARITY_COLOR[rk] }} />
                {name}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-bold)', color: 'var(--c-text)' }}>{pct}</span>
            </div>
          ))}
        </div>
        <ul style={S.oddsNotes}>
          <li>{tr('pull.odds.softPity')}</li>
          <li>{tr('pull.odds.hardPity')}</li>
          <li>{tr('pull.odds.epicFloor')}</li>
          <li>{tr('pull.odds.resonance')}</li>
          {featured.length > 0 && <li>{tr('pull.odds.featured')}</li>}
        </ul>
        {featured.length > 0 && (
          <div style={S.oddsFeatured}>🔥 {featured.map((id) => shapes[id]?.nick).filter(Boolean).join(' · ')}</div>
        )}
        <button style={{ ...S.smallBtn, width: '100%', marginTop: 'var(--sp-2)', justifyContent: 'center' }} onClick={onClose}>
          {tr('common.close')}
        </button>
      </div>
    </div>
  )
}

// A row of the active banner's rate-up shapes, each a button that opens that shape's inspector / character
// sheet — so you can read a featured shape's lore + effect before deciding to pull for it.
function FeaturedDetails() {
  const { view, bannerDefs, shapes } = useGame()
  const tr = useT()
  if (!view) return null
  const def = bannerDefs[view.current_banner]
  const feat = def?.featured ?? []
  if (!feat.length) return null
  return (
    <div style={S.featRow}>
      <span style={S.featLabel}>🔥 {tr('banner.rateUp')}</span>
      {feat.slice(0, 6).map((id) => {
        const sh = shapes[id]
        if (!sh) return null
        return (
          <button key={id} style={S.featChip} onClick={() => useInspector.getState().set(id)} title={`${sh.nick} · ${tr('gacha.details')}`}>
            <span style={{ fontSize: 'var(--fs-body)' }}>{glyphOf(sh.family)}</span>
            <span style={S.featChipNick}>{sh.nick}</span>
            <span style={{ color: 'var(--c-text-faint)' }}>ⓘ</span>
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
  const [featIdx, setFeatIdx] = useState(0) // which rate-up the themed-banner spotlight is showing
  // On a themed banner the preview spotlights its rate-up shapes — overlay ‹ › step through them; Standard
  // shows your secretary / last pull / Pip.
  const bannerDef = view ? bannerDefs[view.current_banner] : undefined
  const feat = bannerDef?.featured ?? []
  const safeFeatIdx = feat.length ? (((featIdx % feat.length) + feat.length) % feat.length) : 0
  const featuredId = feat.length ? feat[safeFeatIdx] : null
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
  const [oddsOpen, setOddsOpen] = useState(false)
  useEffect(() => setFeatIdx(0), [view?.current_banner]) // reset the spotlight to the first rate-up on banner change
  if (!view) return null
  return (
    <div className="gacha-split">
      <div className="gacha-stage" style={S.stageWrap}>
        {shape && <HeroView key={shape.family} family={shape.family} rarity={shape.rarity} controls autoRotate />}
        {shape && (
          <div style={S.focusName}>
            {shape.nick} <em style={S.focusFam}>· {shape.family.replace(/_/g, ' ')}</em>
            {isBannerPreview ? (
              <span style={{ color: '#ff9d6b', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)' }}> 🔥 {tr('gacha.featured')}{feat.length > 1 ? ` · ${safeFeatIdx + 1}/${feat.length}` : ''}</span>
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
                <span style={{ fontWeight: 'var(--fw-bold)' }}>{e.name}</span>
                <span style={{ color: '#8a90a8' }}>· {tr('gacha.details')}</span>
              </button>
            )
          })()}
        {shape && owned && !isBannerPreview && <button className="ready-pulse" style={S.talkBtn} onClick={() => talk(shape, bond)} title={tr('gacha.talkTooltip')}>💬</button>}
        {bubble && <SpeechBubble bubble={bubble} onClose={() => setBubble(null)} />}
        {isBannerPreview && feat.length > 1 && (
          <>
            <button style={{ ...S.inspNav, left: 8 }} onClick={() => setFeatIdx((i) => i - 1)} title={tr('inspect.prev')} aria-label={tr('inspect.prev')}>‹</button>
            <button style={{ ...S.inspNav, right: 8 }} onClick={() => setFeatIdx((i) => i + 1)} title={tr('inspect.next')} aria-label={tr('inspect.next')}>›</button>
          </>
        )}
      </div>
      <div className="gacha-controls">
        <BannerSelector />
        <FeaturedDetails />
        <div style={S.pitymeters}>
          <Meter label={`${tr('pull.pity')} ${view.pity_since_top}/30`} pct={view.pity_since_top / 30} color="#ffb86b" />
          <Meter label={`${tr('pull.resonance')} ${view.resonance}/40`} pct={view.resonance / 40} color="#ff5d8f" />
          <button style={S.oddsBtn} onClick={() => setOddsOpen(true)}>ⓘ {tr('pull.odds.btn')}</button>
        </div>
        {oddsOpen && <OddsModal onClose={() => setOddsOpen(false)} />}
        <div style={S.pullRow}>
          <button className={`pull-cap ${view.can_pull ? 'ready-pulse' : ''}`} title={tr('pull.oneShortcut')} style={{ ...S.pullBtn, opacity: view.can_pull ? 1 : 0.4 }} disabled={!view.can_pull} onClick={pull}>
            {tr('pull.one', { cost: fmt(view.pull_cost) })} <kbd style={S.kbd}>P</kbd>
          </button>
          <button className="pull-cap" title={tr('pull.tenShortcut')} style={{ ...S.pullBtn10, opacity: view.can_ten_pull ? 1 : 0.4 }} disabled={!view.can_ten_pull} onClick={tenPull}>
            {tr('pull.ten', { cost: fmt(view.ten_pull_cost) })} <kbd style={S.kbd}>T</kbd>
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
        <div key={i} style={{ ...S.histRow, cursor: 'pointer' }} onClick={() => useInspector.getState().set(p.id)} title={tr('pull.history.inspectTip')}>
          <span style={{ ...S.tileDot, background: RARITY_COLOR[p.rarity] }} />
          <span style={{ flex: 1, color: '#cdd2e0' }}>{p.nick}</span>
          <span style={{ color: RARITY_COLOR[p.rarity], fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-caption)' }}>{p.rarity}</span>
          {p.isNew && <span style={{ color: '#ff5d8f', fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)' }}>{tr('pull.history.new')}</span>}
        </div>
      ))}
    </div>
  )
}

// Locale-aware event timestamp: just the time if it happened today, else short date + time. (Browser locale,
// so no hardcoded strings; the title tooltip carries the full date.)
function fmtEventTime(t: number): string {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Persisted activity feed (forges, milestones, relics, prestige…), the Ledger's History subtab.
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
              {e.t ? <span style={S.histTime} title={new Date(e.t).toLocaleString()}>{fmtEventTime(e.t)}</span> : null}
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
  const secretaryId = useGame((s) => s.secretaryId)
  const tr = useT()
  const { bubble, setBubble, talk } = useChatter()
  const cooldown = useRef<Record<number, number>>({})
  const [shuffle, setShuffle] = useState(0) // manual "new visitors" re-roll, on top of the 30-min window
  const epoch = Math.floor(Date.now() / 1_800_000) // 30-minute real-time window
  const ownedIds = view ? shapes.filter((s) => view.owned[s.id] > 0).map((s) => s.id) : []
  const roster = useMemo(
    () => rosterForEpoch(ownedIds, secretaryId, epoch + shuffle, 7).map((id) => shapes[id]).filter(Boolean) as ShapeRow[],
    // snapshot per window (+ secretary change / first shape owned / manual shuffle) — NOT every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch, secretaryId, ownedIds.length === 0, shuffle],
  )
  // Read fresh store state inside a STABLE callback, so the memoised RoamGems don't re-render (and reset)
  // every time the HUD ticks. talk is captured by ref for the same reason.
  const talkRef = useRef(talk)
  talkRef.current = talk
  const onTap = useCallback((id: number) => {
    const st = useGame.getState()
    const v = st.view
    if (!v) return
    talkRef.current(st.shapes[id], v.bond_levels[id] ?? 0)
    const now = performance.now()
    if (!cooldown.current[id] || now - cooldown.current[id] > 1500) {
      cooldown.current[id] = now
      st.pat(id) // minor bond + the store's bond-up celebration
    }
  }, [])
  useIdleChatter(() => {
    if (roster.length && view) {
      const s = roster[Math.floor(Math.random() * roster.length)]
      talk(s, view.bond_levels[s.id] ?? 0)
    }
  })
  if (!view) return null
  return (
    <div style={{ ...S.board, flex: 1, minHeight: 0, paddingBottom: 0 }}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('room.title')}</h3>
        <HelpNote id="help.room"><p style={S.boardDesc}>{tr('room.desc')}</p></HelpNote>
        {ownedIds.length > 7 && (
          <button style={S.smallBtn} onClick={() => setShuffle((n) => n + 1)} title={tr('room.shuffleTip')}>{tr('room.shuffle')}</button>
        )}
      </div>
      <div style={{ ...S.floorWrap, flex: 1, minHeight: 0 }}>
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
  const title = titleById(view.equipped?.[SLOT_TITLE] ?? 0) // equipped collector title (Shop cosmetic)
  const tip = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
      <span style={{ fontSize: 'var(--fs-eyebrow)', color: '#8a90a8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('rank.label')}</span>
      <span style={{ fontSize: 'var(--fs-caption)', color: '#cdd2e0' }}>
        <b style={{ color: col }}>{rank}</b> · {tr('rank.score', { score })}
      </span>
      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-accent-teal)' }}>{next ? tr('rank.toNext', { toNext, next }) : tr('rank.apex')}</span>
      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', lineHeight: 1.4 }}>{tr('rank.tooltipFrom')}</span>
    </div>
  )
  return (
    <Tooltip content={tip}>
      <div style={{ ...S.rankBadge, cursor: 'help' }}>
        <span style={{ ...S.rankLetter, color: col, borderColor: col, background: `radial-gradient(circle at 50% 30%, ${col}22, #0e0f17)`, boxShadow: `0 0 12px ${col}55, inset 0 1px 2px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.15)` }}>{rank}</span>
        {!compact && (
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            {title.id !== 0 && <span style={{ fontSize: 'var(--fs-caption)', color: title.color, fontWeight: 'var(--fw-bold)' }}>{title.text}</span>}
            <span style={{ fontSize: 10.5, color: '#8a90a8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('rank.label')}</span>
            <span style={{ fontSize: 'var(--fs-caption)', color: '#cdd2e0' }}>{next ? tr('rank.toNext', { toNext, next }) : tr('rank.apex')}</span>
          </span>
        )}
      </div>
    </Tooltip>
  )
}

// Chatlas — two sub-tabs. "Feed" is the cozy procgen curator chat (synthetic, always lively). "Plus" is the
// real multiplayer layer: opt-in, peer-to-peer, where you see and greet actual collectors who are online now.
function ChatlasView() {
  const tr = useT()
  const [sub, setSub] = useState<'feed' | 'plus'>('feed')
  // Unread badge on the Plus tab: count live activity that arrives while you're reading the Feed.
  const [unseen, setUnseen] = useState(0)
  useEffect(() => {
    if (sub === 'plus') {
      setUnseen(0)
      return
    }
    const bump = () => setUnseen((u) => Math.min(u + 1, 99))
    const offE = onChatlasEvent(bump)
    const offC = onChatlasChat(bump)
    return () => {
      offE()
      offC()
    }
  }, [sub])
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('chatlas.title')}</h3>
        <HelpNote id="help.chatlas"><p style={S.boardDesc}>{tr('chatlas.desc')}</p></HelpNote>
      </div>
      {/* sub-tabs live OUTSIDE the intro so dismissing the help blurb never moves or hides them */}
      <div style={{ ...S.settingsTabs, marginTop: 0, marginBottom: 'var(--sp-2)' }}>
        {(['feed', 'plus'] as const).map((s) => (
          <button key={s} onClick={() => { sfxTab(); setSub(s) }} style={{ ...S.navBtn, ...(sub === s ? S.navBtnActive : {}), position: 'relative' }}>
            {tr(s === 'feed' ? 'chatlas.tabFeed' : 'chatlas.tabPlus')}
            {s === 'plus' && sub !== 'plus' && unseen > 0 && (
              <span className="chatlas-pop" style={S.unreadDot}>{unseen > 9 ? '9+' : unseen}</span>
            )}
          </button>
        ))}
      </div>
      {/* key re-mounts on switch so the body eases in */}
      <div key={sub} className="fade-in">{sub === 'feed' ? <ChatlasFeed /> : <ChatlasPlus />}</div>
    </div>
  )
}

// One rendered chat line (shared by both sub-tabs). Eases in with a gentle rise; stickers pop.
function ChatLine({ m, onReact }: { m: ChatMsg; onReact?: () => void }) {
  const tr = useT()
  return (
    <div className="chatlas-rise" style={S.chatMsg}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...S.chatHandle, color: m.color }}>@{m.handle}</span>
        {onReact && (
          <button className="chatlas-icon-btn" style={S.reactBtn} title={tr('chatlas.plus.reactTooltip')} onClick={onReact}>♡</button>
        )}
      </div>
      {m.sticker ? <img className="chatlas-pop" src={stickerSrc(m.sticker)} alt="sticker" style={S.chatSticker} /> : <span style={S.chatText}>{m.text}</span>}
    </div>
  )
}

// The sticker tray (shared). onPick gets the 1-based sticker index; a soft blip confirms the send.
function StickerBar({ onPick }: { onPick: (n: number) => void }) {
  const tr = useT()
  return (
    <div style={S.stickerBar}>
      {Array.from({ length: STICKER_COUNT }, (_, i) => i + 1).map((n) => (
        <button key={n} className="chatlas-sticker-btn" style={S.stickerPick} title={tr('chatlas.stickerTooltip')} onClick={() => { sfxTap(); onPick(n) }}>
          <img src={stickerSrc(n)} alt={`sticker ${n}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </button>
      ))}
    </div>
  )
}

// A curator identity pill: colour dot + @handle (+ "· you" for self). With onWave it becomes a button that
// waves at that collector. `className` lets callers add an entrance/hover animation (e.g. roster chips).
function CuratorChip({ handle, color, you, onWave, className }: { handle: string; color: string; you?: boolean; onWave?: () => void; className?: string }) {
  const tr = useT()
  const inner = (
    <>
      <span style={{ ...S.plusDot, background: color, boxShadow: `0 0 6px ${color}` }} />
      @{handle}
      {you && <span style={{ color: 'var(--c-text-dim)', fontWeight: 400 }}>· {tr('chatlas.plus.you')}</span>}
    </>
  )
  return onWave ? (
    <button className={className} style={{ ...S.idChip, cursor: 'pointer' }} title={tr('chatlas.plus.waveTooltip')} onClick={onWave}>
      {inner}
    </button>
  ) : (
    <span className={className} style={S.idChip}>{inner}</span>
  )
}

// Identity editor: re-roll the handle or pick a colour. Persists on-device and updates live (peers see the new
// identity on your next message — no reconnect).
function IdentityEditor() {
  const tr = useT()
  const profile = useChatlasPlus((s) => s.profile)
  const reroll = useChatlasPlus((s) => s.rerollProfile)
  const setColor = useChatlasPlus((s) => s.setProfileColor)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <CuratorChip handle={profile.handle} color={profile.color} />
        <button style={{ ...S.smallBtn, fontSize: 'var(--fs-body-sm)' }} onClick={() => { sfxTap(); reroll() }} title={tr('chatlas.plus.rerollTooltip')}>
          <span className="chatlas-reroll">🎲</span> {tr('chatlas.plus.reroll')}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PROFILE_COLORS.map((c) => (
          <button
            key={c}
            title={tr('chatlas.plus.colorTooltip')}
            onClick={() => setColor(c)}
            style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, border: c === profile.color ? '2px solid var(--c-text-bright)' : '2px solid transparent', boxShadow: c === profile.color ? `0 0 8px ${c}` : 'none' }}
          />
        ))}
      </div>
    </div>
  )
}

// The synthetic curator feed — procgen lines drift in + auto-scroll. Stickers append locally (cozy, no network).
function ChatlasFeed() {
  const shapes = useGame((s) => s.shapes)
  const view = useGame((s) => s.view)
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
    <>
      <div ref={ref} style={S.chatFeed}>
        {msgs.map((m, i) => (
          <ChatLine key={i} m={m} />
        ))}
      </div>
      <StickerBar onPick={(n) => setMsgs((m) => [...m.slice(-60), { handle: 'you', color: '#ffffff', text: '', sticker: n }])} />
    </>
  )
}

// Chatlas Plus router: gate behind explicit consent, then show the live panel.
function ChatlasPlus() {
  const consent = useChatlasPlus((s) => s.consent)
  return consent ? <ChatlasPlusLive /> : <ChatlasPlusIntro />
}

// First-run consent card: what it is, who you'll appear as, the IP disclosure, and one button to go live.
function ChatlasPlusIntro() {
  const tr = useT()
  const setConsent = useChatlasPlus((s) => s.setConsent)
  const setEvents = useChatlasPlus((s) => s.setEvents)
  return (
    <div style={S.plusCard}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h3)', color: 'var(--c-text-bright)' }}>{tr('chatlas.tabPlus')}</div>
        <div style={{ color: 'var(--c-accent-teal)', fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-heavy)' }}>{tr('chatlas.plus.introTagline')}</div>
      </div>
      <p style={S.boardDesc}>{tr('chatlas.plus.desc')}</p>
      <div>
        <div style={{ ...S.hint, marginBottom: 6 }}>{tr('chatlas.plus.youAppearAs')}</div>
        <IdentityEditor />
      </div>
      <p style={{ ...S.hint, padding: '10px 12px', background: 'var(--c-surface-0)', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', margin: 0 }}>
        {tr('chatlas.plus.consentDisclosure')}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={{ ...S.smallBtn, ...S.toggleOn, color: 'var(--c-text-bright)' }} onClick={() => { setConsent(true); setEvents(true) }}>
          {tr('chatlas.plus.connectBtn')}
        </button>
        <span style={S.hint}>{tr('chatlas.plus.manageNote')}</span>
      </div>
    </div>
  )
}

// Live panel: shared status + roster, then Activity (events) and/or Chat (text) bodies per enabled scope.
function ChatlasPlusLive() {
  const tr = useT()
  const events = useChatlasPlus((s) => s.events)
  const chat = useChatlasPlus((s) => s.chat)
  const setEvents = useChatlasPlus((s) => s.setEvents)
  const setChat = useChatlasPlus((s) => s.setChat)
  const me = useChatlasPlus((s) => s.profile)
  const reroll = useChatlasPlus((s) => s.rerollProfile)
  const roster = useChatlasRoster()
  const [mode, setMode] = useState<'activity' | 'chat'>('activity')

  // Ephemeral reaction/wave floats that drift up over the active body, each with a randomised drift/rotation
  // so a flurry feels organic rather than stacked. (Feel-layer — Math.random is fine here.)
  const [floats, setFloats] = useState<{ id: number; emoji: string; dx: number; rot: number }[]>([])
  const floatId = useRef(0)
  const float = useCallback((emoji: string) => {
    const id = ++floatId.current
    const dx = Math.round((Math.random() - 0.5) * 64)
    const rot = Math.round((Math.random() - 0.5) * 40)
    setFloats((f) => [...f, { id, emoji, dx, rot }])
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1250)
  }, [])

  // Peak moment: the first collector appearing in an empty room is a little celebration.
  const wasAlone = useRef(true)
  useEffect(() => {
    if (wasAlone.current && roster.length > 0) {
      float('✨')
      float('✨')
      sfxPat()
    }
    wasAlone.current = roster.length === 0
  }, [roster.length, float])

  const modes: ('activity' | 'chat')[] = [...(events ? ['activity' as const] : []), ...(chat ? ['chat' as const] : [])]

  // Consented but neither scope on.
  if (modes.length === 0) {
    return (
      <div style={S.plusCard}>
        <p style={S.boardDesc}>{tr('chatlas.plus.offlineState')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...S.smallBtn, ...S.toggleOn, color: 'var(--c-text-bright)' }} onClick={() => setEvents(true)}>{tr('chatlas.plus.goLive')}</button>
          <button style={S.smallBtn} onClick={() => setChat(true)}>{tr('chatlas.plus.joinChat')}</button>
        </div>
      </div>
    )
  }

  const activeMode = modes.includes(mode) ? mode : modes[0]
  const live = roster.length > 0
  const teal = 'var(--c-accent-teal)'
  return (
    <>
      <div style={S.plusStatus}>
        <span className={live ? 'chatlas-livedot' : 'chatlas-waitdot'} style={{ ...S.plusDot, background: live ? teal : 'var(--c-accent-amber)', boxShadow: live ? undefined : 'none' }} />
        <span style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-body-sm)', color: 'var(--c-text)' }}>
          {live ? tr('chatlas.plus.collectorsHere', { n: roster.length }) : tr('chatlas.plus.waiting')}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <CuratorChip handle={me.handle} color={me.color} you />
          <button className="chatlas-icon-btn" style={S.reactBtn} title={tr('chatlas.plus.rerollTooltip')} onClick={() => { sfxTap(); reroll() }}>
            <span className="chatlas-reroll">🎲</span>
          </button>
          <button style={{ ...S.toggle, fontSize: 'var(--fs-eyebrow)' }} onClick={() => { setEvents(false); setChat(false) }}>{tr('chatlas.plus.appearOffline')}</button>
        </span>
      </div>
      {live && (
        <div style={S.plusRoster}>
          {roster.map((r: RosterEntry) => (
            <CuratorChip
              key={r.peerId}
              className="chatlas-pop chatlas-wave-chip"
              handle={r.profile.handle}
              color={r.profile.color}
              onWave={() => {
                chatlasBroadcast({ k: 'react', to: r.profile.handle, emoji: '👋' })
                sfxPat()
                float('👋')
              }}
            />
          ))}
        </div>
      )}
      {modes.length > 1 && (
        <div style={S.settingsTabs}>
          {modes.map((md) => (
            <button key={md} onClick={() => { sfxTab(); setMode(md) }} style={{ ...S.navBtn, ...(activeMode === md ? S.navBtnActive : {}) }}>
              {tr(md === 'activity' ? 'chatlas.plus.modeActivity' : 'chatlas.plus.modeChat')}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <div key={activeMode} className="fade-in">
          {activeMode === 'activity' ? <ChatlasActivityBody me={me} onFloat={float} /> : <ChatlasChatBody me={me} />}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, display: 'flex', justifyContent: 'center', gap: 12, pointerEvents: 'none' }}>
          {floats.map((f) => (
            <span key={f.id} className="chatlas-float" style={{ fontSize: 26, ['--dx']: `${f.dx}px`, ['--rot']: `${f.rot}deg` } as CSSProperties}>
              {f.emoji}
            </span>
          ))}
        </div>
      </div>
    </>
  )
}

const plusEmpty: CSSProperties = { margin: 'auto', textAlign: 'center', maxWidth: 360, color: 'var(--c-text-dim)', fontSize: 'var(--fs-body-sm)', lineHeight: 1.5 }

// Activity body: the structured-events feed + sticker tray. Reactions float (via onFloat) instead of cluttering.
function ChatlasActivityBody({ me, onFloat }: { me: ChatlasProfile; onFloat: (emoji: string) => void }) {
  const tr = useT()
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const onPeerEvent = (e: PeerEvent) => {
    if (e.event.k === 'react') {
      onFloat(e.event.emoji) // reactions/waves float, they don't fill the feed
      return
    }
    setMsgs((m) => [...m.slice(-60), peerEventToMsg(e)])
  }
  useChatlasFeed(onPeerEvent)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])
  return (
    <>
      <div ref={ref} style={S.chatFeed}>
        {msgs.length === 0 ? (
          <div style={plusEmpty}>{tr('chatlas.plus.emptyHere')}</div>
        ) : (
          msgs.map((m, i) => (
            <ChatLine
              key={i}
              m={m}
              onReact={
                m.handle !== me.handle
                  ? () => {
                      chatlasBroadcast({ k: 'react', to: m.handle, emoji: '❤' })
                      sfxPat()
                      onFloat('❤')
                    }
                  : undefined
              }
            />
          ))
        )}
      </div>
      <StickerBar
        onPick={(n) => {
          setMsgs((m) => [...m.slice(-60), { handle: me.handle, color: me.color, text: '', sticker: n }])
          chatlasBroadcast({ k: 'sticker', sticker: n })
        }}
      />
    </>
  )
}

// Chat body: free-text conversation with input + client-side mute. Free text is why chat is its own opt-in.
function ChatlasChatBody({ me }: { me: ChatlasProfile }) {
  const tr = useT()
  const muted = useMutes((s) => s.muted)
  const toggleMute = useMutes((s) => s.toggle)
  const [lines, setLines] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [typers, setTypers] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const lastSend = useRef(0)
  const lastTyping = useRef(0)
  const typerTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useChatlasChat((m) => setLines((l) => [...l.slice(-80), m]))
  // A peer's "typing" ping shows their handle for ~3s; each fresh ping resets that handle's timer.
  useChatlasTyping((p) => {
    const h = p.handle
    if (h === me.handle) return
    setTypers((t) => (t.includes(h) ? t : [...t, h]))
    clearTimeout(typerTimers.current[h])
    typerTimers.current[h] = setTimeout(() => setTypers((t) => t.filter((x) => x !== h)), 3000)
  })
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [lines, typers])

  const onDraft = (v: string) => {
    setDraft(v)
    const now = performance.now()
    if (v && now - lastTyping.current > 1200) {
      lastTyping.current = now
      chatlasSendTyping() // throttled "I'm composing" ping
    }
  }

  const send = () => {
    const text = draft.trim()
    if (!text) return
    const now = performance.now()
    if (now - lastSend.current < 800) return // light client-side rate limit
    lastSend.current = now
    sfxTap()
    chatlasSendChat(text)
    setLines((l) => [...l.slice(-80), { profile: me, text, peerId: 'self' }]) // echo locally (relay won't echo self)
    setDraft('')
  }

  const visible = lines.filter((l) => l.peerId === 'self' || !muted.includes(l.profile.handle))
  const activeTypers = typers.filter((h) => !muted.includes(h))
  return (
    <>
      <div ref={ref} style={S.chatFeed}>
        {visible.length === 0 ? (
          <div style={plusEmpty}>{tr('chatlas.plus.chatEmpty')}</div>
        ) : (
          visible.map((l, i) => (
            <div key={i} className="chatlas-rise" style={S.chatMsg}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="chatlas-handle" style={{ ...S.chatHandle, color: l.profile.color }}>@{l.profile.handle}</span>
                {l.peerId !== 'self' && (
                  <button className="chatlas-icon-btn" style={S.reactBtn} title={tr('chatlas.plus.muteTooltip')} onClick={() => toggleMute(l.profile.handle)}>🔇</button>
                )}
              </div>
              <span style={S.chatText}>{l.text}</span>
            </div>
          ))
        )}
      </div>
      <div style={{ height: 16, marginTop: 2 }}>
        {activeTypers.length > 0 && (
          <span style={{ fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-dim)' }}>
            {tr('chatlas.plus.typing', { who: activeTypers.map((h) => '@' + h).join(', ') })}
            <span className="chatlas-dots">…</span>
          </span>
        )}
      </div>
      {muted.length > 0 && (
        <button style={{ ...S.reactBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => muted.forEach(toggleMute)}>
          🔈 {tr('chatlas.plus.unmuteAll', { n: muted.length })}
        </button>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          maxLength={280}
          placeholder={tr('chatlas.plus.chatPlaceholder')}
          className="chatlas-input"
          style={S.chatInput}
        />
        <button disabled={!draft.trim()} style={{ ...S.smallBtn, ...S.toggleOn, color: 'var(--c-text-bright)', opacity: draft.trim() ? 1 : 0.45, cursor: draft.trim() ? 'pointer' : 'default' }} onClick={send}>{tr('chatlas.plus.chatSend')}</button>
      </div>
    </>
  )
}

// Broadcast pulls at this rarity and above. SSR is the first "worth telling the room about" tier.
const NOTABLE_RARITY = RARITY_ORDER.indexOf('Ssr')

// Owns the app-level Chatlas Plus connection: connected whenever the events scope is opted in, regardless of
// which screen is open — so a rare pull on the Gacha tab still reaches the room. Mounted once at app root.
function ChatlasNetDriver() {
  // One connection serves both events and chat, so it's active when either scope is on. Keying on the derived
  // boolean means toggling one scope while the other stays on doesn't churn the connection.
  const active = useChatlasPlus((s) => s.events || s.chat)
  useEffect(() => {
    if (!active) return
    chatlasConnect()
    return () => chatlasDisconnect()
  }, [active])
  return null
}

// Plays a soft chime when a notable peer event (pull/milestone/forge) lands — app-level, so you hear the room
// even from another screen. Throttled, and silent when SFX are muted.
function ChatlasChime() {
  const active = useChatlasPlus((s) => s.events)
  const lastChime = useRef(0)
  useEffect(() => {
    if (!active) return
    return onChatlasEvent((e) => {
      if (e.event.k !== 'pull' && e.event.k !== 'milestone' && e.event.k !== 'forge') return
      if (useMute.getState().sfxMuted) return
      const now = performance.now()
      if (now - lastChime.current < 1500) return // throttle bursts
      lastChime.current = now
      sfxTap()
    })
  }, [active])
  return null
}

// Broadcasts notable real game events to Chatlas Plus. Watches the pull reveal and shares SSR+ pulls. Lives in
// the outer (presentation) layer — it only observes store state and never feeds anything back into game truth.
function ChatlasBroadcaster() {
  const events = useChatlasPlus((s) => s.events)
  const lastReveal = useGame((s) => s.lastReveal)
  const shapes = useGame((s) => s.shapes)
  const milestoneToast = useGame((s) => s.milestoneToast)
  const milestoneDefs = useGame((s) => s.milestoneDefs)
  const lastForge = useGame((s) => s.lastForge)
  const seenReveal = useRef<PullOutcome[] | null>(null)
  const seenMilestone = useRef<number | null>(null)
  const seenForge = useRef<ForgeResult | null>(null)

  useEffect(() => {
    if (!events || !lastReveal || seenReveal.current === lastReveal) return
    seenReveal.current = lastReveal // dedupe: lastReveal is a fresh array per pull batch
    for (const out of lastReveal) {
      if (out.rarity && RARITY_ORDER.indexOf(out.rarity) >= NOTABLE_RARITY) {
        const sh = shapes[out.shape_id]
        if (sh) chatlasBroadcast({ k: 'pull', nick: sh.nick, rarity: out.rarity })
      }
    }
  }, [lastReveal, events, shapes])

  useEffect(() => {
    if (!events || milestoneToast == null || seenMilestone.current === milestoneToast) return
    seenMilestone.current = milestoneToast // dedupe: one broadcast per latch
    const key = milestoneDefs[milestoneToast]?.key
    if (key) chatlasBroadcast({ k: 'milestone', key })
  }, [milestoneToast, events, milestoneDefs])

  useEffect(() => {
    if (!events || !lastForge || seenForge.current === lastForge) return
    seenForge.current = lastForge
    if (lastForge.ok && lastForge.is_discovery) {
      const sh = shapes[lastForge.out_id] // only forge *discoveries* are worth the room's attention
      if (sh) chatlasBroadcast({ k: 'forge', nick: sh.nick })
    }
  }, [lastForge, events, shapes])

  return null
}

function GalleryView({ onInspect }: { onInspect: (id: number) => void }) {
  const { shapes, view } = useGame()
  const tr = useT()
  const [q, setQ] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const shipSeen = useShips((s) => s.seen)
  // hover → small 3D preview popup (owned shapes only — unowned stay a vague ❓), rendered exactly like the Pull.
  // We keep ONE warm canvas PER render-path (raymarched SDF vs mesh-transmission) — each HeroView is locked to
  // its path by only ever receiving a same-path shape, so it never internally swaps paths (the one thing that
  // forces a remount). Hovering just swaps the shape within a path and cross-fades between the two canvases;
  // both stay mounted + their context/shaders/env stay warm, and the hidden one is frameloop-paused (free).
  const [previewSdf, setPreviewSdf] = useState<{ family: string; rarity: RarityName } | null>(null)
  const [previewMesh, setPreviewMesh] = useState<{ family: string; rarity: RarityName } | null>(null)
  const [previewCur, setPreviewCur] = useState<{ rarity: RarityName; nick: string; isSdf: boolean } | null>(null)
  const [previewPos, setPreviewPos] = useState<{ cx: number; top: number; bottom: number } | null>(null)
  const [previewOn, setPreviewOn] = useState(false)
  const hideT = useRef<number | null>(null)
  const showT = useRef<number | null>(null)
  const showPrev = (e: React.MouseEvent, s: ShapeRow) => {
    if (hideT.current) { clearTimeout(hideT.current); hideT.current = null }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const isSdf = s.family in RAYMARCH_SHAPES
    const pos = { cx: r.left + r.width / 2, top: r.top, bottom: r.bottom }
    // hover-intent: only swap the preview once you pause on a tile, so sweeping the grid is smooth
    if (showT.current) clearTimeout(showT.current)
    showT.current = window.setTimeout(() => {
      if (isSdf) setPreviewSdf({ family: s.family, rarity: s.rarity })
      else setPreviewMesh({ family: s.family, rarity: s.rarity })
      setPreviewCur({ rarity: s.rarity, nick: s.nick, isSdf })
      setPreviewPos(pos)
      setPreviewOn(true)
    }, 150) // hover-intent: only swap (and compile a new shape's shader) once you settle, so sweeping never stutters
  }
  const hidePrev = () => {
    if (showT.current) { clearTimeout(showT.current); showT.current = null }
    if (hideT.current) clearTimeout(hideT.current)
    hideT.current = window.setTimeout(() => setPreviewOn(false), 120) // hide but keep both canvases mounted + warm
  }
  if (!view) return null
  const ships = availableShips(shapes, view.owned, shipSeen)
  const ql = q.trim().toLowerCase()
  const toggle = (r: string) => setHidden((h) => { const n = new Set(h); if (n.has(r)) n.delete(r); else n.add(r); return n })
  return (
    <div style={S.gallery}>
      <MascotOverlay family="sphere" name={tr('gallery.mascot.name')} lines={[tr('gallery.mascot.line'), tr('gallery.mascot.line2'), tr('gallery.mascot.line3')]} thanks={tr('gallery.mascot.thanks')} />
      {ships.length > 0 && (
        <div style={S.shipNotice}>
          <div style={S.shipNoticeHead}>♥ {tr('gallery.newCutscenes', { n: ships.length })}</div>
          <div style={S.shipNoticeList}>
            {ships.map((sp) => (
              <button key={sp.key} style={S.shipNoticeBtn} onClick={() => useShips.getState().open(sp.a.family, sp.b.family)}>
                {glyphOf(sp.a.family)} {sp.a.nick} <span style={{ opacity: 0.6 }}>&amp;</span> {sp.b.nick} {glyphOf(sp.b.family)} <span style={{ color: 'var(--c-accent-pink)' }}>▸</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={S.galleryControls}>
        <input style={S.search} placeholder={tr('gallery.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={S.filterChips}>
          {RARITY_ORDER.map((r) => (
            <button key={r} onClick={() => toggle(r)} title={tr('gallery.toggleTooltip', { r })}
              style={{ ...S.filterChip, borderColor: RARITY_COLOR[r], opacity: hidden.has(r) ? 0.35 : 1, color: hidden.has(r) ? '#6b7088' : RARITY_COLOR[r] }}>
              {hidden.has(r) ? '○' : '●'} {r === 'Ssr' ? tr('rarity.ssr') : r === 'Ur' ? tr('rarity.ur') : r === 'Relic' ? tr('rarity.relicsShort') : r === 'Meta' ? tr('rarity.meta') : r === 'Transcendent' ? tr('rarity.transcendent') : r}
            </button>
          ))}
        </div>
      </div>
      {RARITY_ORDER.filter((r) => !hidden.has(r)).map((r) => {
        const tiles = shapes.filter((s) => s.rarity === r && (!ql || (view.owned[s.id] > 0 && s.nick.toLowerCase().includes(ql))))
        if (ql && tiles.length === 0) return null
        return (
        <section key={r}>
          <h3 style={{ ...S.tierHead, color: RARITY_COLOR[r] }}>{r === 'Ssr' ? tr('rarity.ssr') : r === 'Ur' ? tr('rarity.ur') : r === 'Relic' ? tr('rarity.referenceWing') : r === 'Meta' ? tr('rarity.meta') : r === 'Transcendent' ? tr('rarity.transcendent') : r}</h3>
          <div style={S.grid}>
            {tiles.map((s) => {
              const owned = view.owned[s.id] > 0
              return (
                <button key={s.id} onClick={() => onInspect(s.id)} className="chip"
                  onMouseEnter={owned ? (e) => showPrev(e, s) : undefined}
                  onMouseLeave={owned ? hidePrev : undefined}
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
      {/* hover preview: a 3D model rendered exactly like the Pull (HeroView). The canvas is mounted on first hover
          and kept warm — `previewOn` only toggles visibility + frameloop, so re-hovers are instant (no remount). */}
      {previewCur && previewPos && (
        <div style={{ position: 'fixed', left: previewPos.cx, top: previewPos.top < 190 ? previewPos.bottom + 8 : previewPos.top - 8, transform: `translate(-50%, ${previewPos.top < 190 ? '0' : '-100%'})`, zIndex: 80, pointerEvents: 'none', visibility: previewOn ? 'visible' : 'hidden', opacity: previewOn ? 1 : 0, transition: 'opacity 0.12s ease', background: 'rgba(20,22,32,0.96)', border: `1px solid ${RARITY_COLOR[previewCur.rarity]}`, borderRadius: 'var(--r-lg)', padding: 6, boxShadow: `0 10px 30px rgba(0,0,0,0.55), 0 0 16px ${RARITY_COLOR[previewCur.rarity]}44` }}>
          {/* two stacked, path-locked canvases — show the one matching the hovered shape's path, pause the other */}
          <div style={{ position: 'relative', width: 132, height: 132, borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            {previewSdf && (
              <div style={{ position: 'absolute', inset: 0, opacity: previewOn && previewCur.isSdf ? 1 : 0, transition: 'opacity 0.1s ease' }}>
                <HeroView family={previewSdf.family} rarity={previewSdf.rarity} controls={false} motes={false} spin={0.5} compact frameloop={previewOn && previewCur.isSdf ? 'always' : 'never'} />
              </div>
            )}
            {previewMesh && (
              <div style={{ position: 'absolute', inset: 0, opacity: previewOn && !previewCur.isSdf ? 1 : 0, transition: 'opacity 0.1s ease' }}>
                <HeroView family={previewMesh.family} rarity={previewMesh.rarity} controls={false} motes={false} spin={0.5} compact frameloop={previewOn && !previewCur.isSdf ? 'always' : 'never'} />
              </div>
            )}
          </div>
          <div style={{ marginTop: 4, textAlign: 'center', fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-bold)', color: RARITY_COLOR[previewCur.rarity] }}>{previewCur.nick}</div>
        </div>
      )}
    </div>
  )
}

// Facets — the prestige meta-tree, bought with Facets earned by recrystallizing. Persists across all NG+.
function FacetsPanel() {
  const { view, facetDefs, buyFacetPerk, rateIfFacet } = useGame()
  const tr = useT()
  const [popped, setPopped] = useState<string | null>(null)
  if (!view || (view.ng_cycle === 0 && view.facets === 0)) return null // hidden until the first ascent
  const onBuy = (e: { currentTarget: HTMLElement }, i: number, key: string) => {
    const before = useGame.getState().view?.facet_perks[i] ?? 0
    buyFacetPerk(i)
    const after = useGame.getState().view?.facet_perks[i] ?? before
    if (after <= before) return
    useMascotCheer.getState().cheer()
    sfxUpgrade(3 + after)
    const info = FACET_INFO[key] ?? { icon: '🌌', name: key }
    const r = e.currentTarget.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + 4
    purchaseBurst(e.currentTarget, { hues: ['#f0e0ff', '#d8b4ff', '#b388ff', '#7a3aff'], count: 20, power: 1.8 })
    for (let k = 0; k < 7; k++) useFloaters.getState().spawn(info.icon, { x: cx, y: cy, color: '#b388ff', big: true })
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
                <span style={{ fontSize: 'var(--fs-h2)' }}>{info.icon}</span>
                <strong style={{ color: '#e8eaf2' }}>{info.name}</strong>
                {f.max_level > 1 && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-eyebrow)', color: '#8a90a8' }}>{tr('common.lvFraction', { lvl, max: f.max_level })}</span>}
              </div>
              <p style={{ ...S.boardDesc, margin: 0, fontSize: 'var(--fs-caption)' }}>{info.desc}</p>
              {f.max_level > 1 && info.step != null && (
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                  {tr('workshop.now')} <b style={{ color: 'var(--c-text-secondary)' }}>+{fmt(info.step * lvl)}{info.unit}</b>{!maxed && <> · {tr('workshop.next')} +{fmt(info.step)}{info.unit}</>}
                </span>
              )}
              {/* projected Δ/hr (Rust what-if) — hidden when the perk doesn't move the live rate */}
              {!maxed && (() => { const d = rateIfFacet(i) - view.rate_per_hr; return d >= 1 ? (
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-accent-teal)', fontWeight: 'var(--fw-heavy)', fontVariantNumeric: 'tabular-nums' }}>→ +{fmt(d)} <span style={S.fluxIcon}>✦</span>/hr</span>
              ) : null })()}
              <button className="forge-cap" style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={(e) => onBuy(e, i, f.key)}>
                {maxed ? tr('common.maxed') : tr('facets.buy', { cost })}
              </button>
              {!can && !maxed && (
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {tr('workshop.need', { n: fmt(cost - view.facets) })} 🌌
                </span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// The Workshop — permanent, rule-changing upgrades bought with banked Flux (+ some Shards).
function UpgradesPanel() {
  const { view, upgradeDefs, buyUpgrade, rateIfUpgrade, setOverclock } = useGame()
  const tr = useT()
  const [popped, setPopped] = useState<string | null>(null)
  const [treeView, setTreeView] = useState(true) // DAG tree (default) vs. grouped sections
  if (!view) return null
  // Projected Δ/hr per upgrade (Rust what-if) + the single best-VALUE affordable buy (highest Δ/hr per Flux). A
  // quiet opportunity-cost hint — kept to one subtle ★ so the casual "buy the glowy thing" loop still works.
  const deltas = upgradeDefs.map((_, i) => ((view.upgrades[i] ?? 0) >= upgradeDefs[i].max_level ? 0 : rateIfUpgrade(i) - view.rate_per_hr))
  let bestBuy = -1
  {
    let bestVal = 0
    upgradeDefs.forEach((u, i) => {
      const [flux, shards] = view.upgrade_costs[i] ?? [0, 0]
      if (flux <= 0 || view.flux < flux || view.shards < shards || (view.upgrades[i] ?? 0) >= u.max_level) return
      const val = deltas[i] / flux
      if (val > bestVal) { bestVal = val; bestBuy = i }
    })
  }
  // Juice scaled to the upgrade's cost/level: sound climbs, an icon burst + a "Name ↑" pop fire from the button.
  const onBuy = (e: { currentTarget: HTMLElement }, i: number, key: string, flux: number) => {
    const before = useGame.getState().view?.upgrades[i] ?? 0
    const beforeRate = useGame.getState().view?.rate_per_hr ?? 0
    buyUpgrade(i)
    const after = useGame.getState().view?.upgrades[i] ?? before
    if (after <= before) return
    useMascotCheer.getState().cheer()
    const tier = flux > 6000 ? 3 : flux > 3000 ? 2 : 1
    sfxUpgrade(tier + Math.min(2, after))
    const info = UPGRADE_INFO[key] ?? { icon: '⚙', name: key }
    const r = e.currentTarget.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + 4
    purchaseBurst(e.currentTarget, { hues: ['#eafffb', '#9ef0ff', '#5fe0c6', '#3aa6e0'], count: 10 + tier * 6, power: 1 + tier * 0.4 })
    for (let k = 0; k < tier * 4; k++) useFloaters.getState().spawn(info.icon, { x: cx, y: cy, color: '#5fe0c6', big: tier === 3 })
    useFloaters.getState().spawn(`${info.name} ↑`, { x: cx, y: cy - 26, color: '#9ef0ff', big: true })
    // post-purchase confirmation: the number the player optimizes for (closes the peak-end loop)
    const dRate = (useGame.getState().view?.rate_per_hr ?? beforeRate) - beforeRate
    if (dRate >= 1) useFloaters.getState().spawn(`+${fmt(dRate)} ✦/hr`, { x: cx, y: cy - 52, color: '#5fe0c6', big: true })
    setPopped(key)
    setTimeout(() => setPopped(null), 460)
  }
  // one upgrade card (or null if a secret node is still locked) — extracted so the grid can be grouped below
  const renderCard = (i: number) => {
    const u = upgradeDefs[i]
    if (!u) return null
    const lvl = view.upgrades[i] ?? 0
    const unlocked = view.upgrade_unlocked[i] ?? true
    const info = UPGRADE_INFO[u.key] ?? { name: u.key, desc: '', icon: '⚙' }
    if (!unlocked && u.secret) return null // secret nodes stay hidden until unlocked
    if (!unlocked) {
      const req = u.requires
      const reqInfo = req ? UPGRADE_INFO[upgradeDefs[req[0]]?.key] ?? { name: upgradeDefs[req[0]]?.key } : undefined
      // a doctrine locked because its mutually-exclusive sibling was chosen → say so, not a misleading "requires"
      const sibKey = DOCTRINE_EXCLUSIONS[u.key]
      const sibId = sibKey ? upgradeDefs.findIndex((d) => d.key === sibKey) : -1
      const lockedByDoctrine = sibId >= 0 && (view.upgrades[sibId] ?? 0) > 0
      return (
        <div key={u.key} className="chip" title={info.desc} style={{ ...S.recipeCard, gap: 'var(--sp-1_5)', borderColor: '#23252f', opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 'var(--fs-h4)', filter: 'grayscale(1)' }}>🔒</span>
            <strong style={{ color: '#8a90a8' }}>{info.name}</strong>
            {info.short && <span style={{ fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.short}</span>}
          </div>
          <div style={{ ...S.chipMeta, color: '#ff9d6b' }}>
            {lockedByDoctrine
              ? tr('workshop.doctrineLocked', { name: (sibKey ? UPGRADE_INFO[sibKey]?.name : '') ?? '' })
              : <>{tr('workshop.requires', { name: reqInfo?.name ?? '' })}{req && req[1] > 1 ? tr('workshop.requiresLevel', { level: req[1] }) : ''}</>}
          </div>
        </div>
      )
    }
    const maxed = lvl >= u.max_level
    const [flux, shards] = view.upgrade_costs[i] ?? [0, 0] // costs are Rust truth, not recomputed
    const can = !maxed && view.flux >= flux && view.shards >= shards
    return (
      <div key={u.key} className={popped === u.key ? 'chip upgrade-pop' : 'chip'} style={{ ...S.recipeCard, borderColor: maxed ? 'var(--c-accent-gold)' : lvl > 0 ? '#5fe0c6' : '#23252f', boxShadow: maxed ? '0 0 0 1px var(--c-accent-gold) inset, 0 0 12px var(--c-accent-gold-soft, rgba(255,207,107,0.18))' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 'var(--fs-h4)' }}>{info.icon}</span>
          <strong style={{ color: '#e8eaf2', whiteSpace: 'nowrap' }}>{info.name}</strong>
          {i === bestBuy && <span style={{ fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-gold)' }}>★</span>}
          {info.short && <span style={{ fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.short}</span>}
          {u.max_level > 1 && <span style={{ marginLeft: 'auto', flex: '0 0 auto', fontSize: 'var(--fs-eyebrow)', color: maxed ? 'var(--c-accent-gold)' : '#8a90a8', fontWeight: maxed ? 'var(--fw-heavy)' : undefined }}>{maxed ? `✓ ${tr('common.lvFraction', { lvl, max: u.max_level })}` : tr('common.lvFraction', { lvl, max: u.max_level })}</span>}
        </div>
        {/* fused now/next + projected Δ/hr on ONE tabular line (Δ is a Rust what-if; hidden when it doesn't move the live rate) */}
        {((u.max_level > 1 && info.step != null) || (!maxed && deltas[i] >= 1)) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 'var(--sp-1_5)', fontSize: 'var(--fs-micro)', fontVariantNumeric: 'tabular-nums' }}>
            {u.max_level > 1 && info.step != null && (
              <span style={{ color: 'var(--c-text-faint)' }}>
                {tr('workshop.now')} <b style={{ color: 'var(--c-text-secondary)' }}>+{fmt(info.step * lvl)}{info.unit}</b>{!maxed && <> · {tr('workshop.next')} +{fmt(info.step)}{info.unit}</>}
              </span>
            )}
            {!maxed && deltas[i] >= 1 && (
              <span style={{ color: 'var(--c-accent-teal)', fontWeight: 'var(--fw-heavy)' }}>→ +{fmt(deltas[i])} <span style={S.fluxIcon}>✦</span>/hr</span>
            )}
          </span>
        )}
        <button className="forge-cap" style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={(e) => onBuy(e, i, u.key, flux)}>
          {maxed ? tr('common.maxed') : (
            <>{tr('workshop.buy')}{fmt(flux)} <span style={S.fluxIcon}>✦</span>{shards > 0 ? <> + {shards} <span style={S.shardIcon}>◈</span></> : null}</>
          )}
        </button>
        {!maxed && !can && (
          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {view.flux < flux && <>{tr('workshop.need', { n: fmt(flux - view.flux) })} <span style={S.fluxIcon}>✦</span>{view.rate_per_hr + view.exp_flux_rate > 0 && <span style={{ opacity: 0.7 }}> · {fmtEta(flux - view.flux, view.rate_per_hr + view.exp_flux_rate, tr)}</span>}</>}
            {view.shards < shards && <>{view.flux < flux ? ' · ' : ''}{tr('workshop.need', { n: String(shards - view.shards) })} <span style={S.shardIcon}>◈</span></>}
          </span>
        )}
      </div>
    )
  }
  // grouped tech tree: Production / Orrery / Logistics — so the (now 13-node) tree reads as branches, not a flat list
  const sections: { key: string; label: string; ids: number[] }[] = [
    { key: 'production', label: 'workshop.sec.production', ids: [0, 1, 2, 13, 14, 16] },
    { key: 'orrery', label: 'workshop.sec.orrery', ids: [9, 10, 11, 12, 15, 19] },
    { key: 'logistics', label: 'workshop.sec.logistics', ids: [3, 5, 7, 8, 4, 6, 17, 18] },
  ]
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h4 style={{ ...S.boardSub, flex: 1 }}>{tr('workshop.upgradesHeading')}</h4>
        <div style={{ display: 'flex', gap: 2, background: 'var(--c-surface-4)', borderRadius: 'var(--r-md)', padding: 2 }}>
          {([['tree', '⌗'], ['list', '☰']] as const).map(([mode, glyph]) => {
            const on = treeView === (mode === 'tree')
            return (
              <button key={mode} onClick={() => setTreeView(mode === 'tree')} title={tr('workshop.view.' + mode)} aria-label={tr('workshop.view.' + mode)} aria-pressed={on}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 'var(--r-sm)', padding: '3px 9px', fontSize: 'var(--fs-caption)', background: on ? 'var(--c-accent-teal)' : 'transparent', color: on ? '#06141a' : 'var(--c-text-dim)', fontWeight: 'var(--fw-heavy)' }}>{glyph}</button>
            )
          })}
        </div>
      </div>
      {/* overclock (#18) activation: a reversible Redline toggle, shown once the upgrade is owned */}
      {(view.upgrades[18] ?? 0) > 0 && (
        <button
          onClick={() => setOverclock(!view.overclock_on)}
          aria-pressed={view.overclock_on}
          style={{ alignSelf: 'flex-start', marginBottom: 4, border: `1px solid ${view.overclock_on ? '#ff5a5a' : 'var(--c-border-raised)'}`, borderRadius: 'var(--r-pill)', padding: '4px 12px', cursor: 'pointer', background: view.overclock_on ? 'rgba(255,90,90,0.14)' : 'var(--c-surface-3)', color: view.overclock_on ? '#ff8a8a' : 'var(--c-text-secondary)', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-heavy)', fontVariantNumeric: 'tabular-nums' }}
        >
          {view.overclock_on ? tr('workshop.overclock.on') : tr('workshop.overclock.off')}
        </button>
      )}
      {treeView ? (
        <WorkshopTree upgradeDefs={upgradeDefs} view={view} renderNode={renderCard} />
      ) : (
        sections.map((sec) => {
          const cards = sec.ids.map((i) => renderCard(i)).filter(Boolean)
          if (cards.length === 0) return null
          return (
            <div key={sec.key} style={{ marginBottom: 'var(--sp-2_5)' }}>
              <h5 style={S.workshopSection}>{tr(sec.label)}</h5>
              <div className="recipe-grid" style={S.recipeGrid}>{cards}</div>
            </div>
          )
        })
      )}
    </>
  )
}

// A mini gem chip for forge recipes / flows. With `inv`, shows the load-bearing topology invariants in plain
// terms (holes; a one-sided "twist" badge that's "contagious" under connected sum) so the recipe grid teaches
// the rule it enacts — holes add up, one-sidedness spreads. Hidden gems keep a blank slot.
function GemChip({ shape, show, inv }: { shape: ShapeRow | undefined; show: boolean; inv?: boolean }) {
  const tr = useT()
  return (
    <div style={S.gemChip}>
      <span style={{ ...S.gemChipDot, background: show && shape ? RARITY_COLOR[shape.rarity] : '#2a2c3a' }} />
      <span style={S.gemChipName}>{show && shape ? shape.nick : '???'}</span>
      {inv &&
        (show && shape ? (
          <span
            style={S.invLine}
            title={`${tr('forge.inv.genus', { genus: shape.genus })} · ${shape.orientable ? tr('forge.inv.orientable') : tr('forge.inv.nonOrientable')}`}
          >
            <span style={S.invPill}>g{shape.genus}</span>
            {!shape.orientable && <span style={{ ...S.invPill, ...S.invPillFlip }}>⊘</span>}
          </span>
        ) : (
          <span style={{ ...S.invLine, opacity: 0.25 }}>
            <span style={S.invPill}>·</span>
          </span>
        ))}
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
            <span style={{ color: '#cdd2e0', fontSize: 'var(--fs-body-sm)' }}>
              {r.label}
              {r.note ? <span style={{ color: '#8a90a8', fontSize: 'var(--fs-eyebrow)' }}> · {r.note}</span> : null}
            </span>
            <span style={{ color: '#5fe0c6', fontWeight: 'var(--fw-heavy)' }}>×{r.mult.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// A 3D mascot greeter pinned to the screen corner — the shape's gem + a speech box. Fixed (stays put as the
// screen scrolls), and out of the dismissable help-note, so it's the persistent face of the Shop/Workshop.
function MascotOverlay({ family, name, lines, thanks, bob = false, preview = false, previewScene, previewAtmosphere, previewFinish }: { family: string; name: string; lines: string[]; thanks: string; bob?: boolean; preview?: boolean; previewScene?: number; previewAtmosphere?: number; previewFinish?: number }) {
  const [idx, setIdx] = useState(0)
  const [cheering, setCheering] = useState(false)
  const cheerN = useMascotCheer((s) => s.n)
  const gemRef = useRef<HTMLDivElement>(null)
  const firstCheer = useRef(true)
  useEffect(() => {
    if (firstCheer.current) { firstCheer.current = false; return } // ignore the initial value
    setCheering(true)
    const el = gemRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      useSparks.getState().burst(r.left + r.width / 2, r.top + r.height / 2, { count: 22, power: 1.7, hues: ['#fff6dc', '#ffe6a8', '#ffcf6b', '#ffae3a'] })
    }
    const t = setTimeout(() => setCheering(false), 1600)
    return () => clearTimeout(t)
  }, [cheerN])
  const text = cheering ? thanks : lines[idx % lines.length]
  return (
    <div className="mascot-overlay" style={{ position: 'fixed', right: 'var(--sp-3)', bottom: 'var(--sp-3)', zIndex: 30, display: 'flex', alignItems: 'flex-end', gap: 8, pointerEvents: 'none', maxWidth: 'min(92vw, 380px)' }}>
      {/* tap the bubble to cycle the mascot's chatter */}
      <button onClick={() => setIdx((i) => i + 1)} className="pop-in" style={{ pointerEvents: 'auto', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', background: 'var(--c-surface-3)', border: '1px solid var(--c-border-raised)', borderRadius: 'var(--r-lg)', padding: '9px 13px', boxShadow: '0 8px 22px rgba(0,0,0,0.45)' }}>
        <strong style={{ display: 'block', color: '#e8eaf2', fontSize: 'var(--fs-caption)' }}>{name}</strong>
        <span style={{ ...S.boardDesc, display: 'block', margin: '2px 0 0', fontSize: 'var(--fs-caption)', fontStyle: 'italic' }}>“{text}”</span>
      </button>
      <div ref={gemRef} className={bob ? 'float-bob' : undefined} style={{ position: 'relative', width: preview ? 132 : 112, height: preview ? 132 : 112, flexShrink: 0, filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.55))' }}>
        {/* rendered exactly like the Pull (HeroView) so the mascot's gem reads identically to everywhere else. In
            `preview` mode (the Shop) the mascot doubles as the cosmetic preview: it takes the hovered scene/
            atmosphere/finish overrides, and runs controls + full (non-compact) so it path-traces when PT is on and
            the render badge can cycle renderers. pointerEvents auto so you can drag/cycle it. */}
        <div style={{ width: '100%', height: '100%', borderRadius: 'var(--r-md)', overflow: 'hidden', pointerEvents: preview ? 'auto' : undefined }}>
          <HeroView family={family} rarity="Ssr" controls={preview} motes={false} spin={0.6} compact={!preview} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewFinish={previewFinish} />
        </div>
        {/* a few ambient flux motes drifting around the mascot */}
        <span className="float-bob" style={{ position: 'absolute', left: '10%', top: '62%', color: 'var(--c-accent-gold)', fontSize: 11, textShadow: '0 0 6px rgba(255,207,107,0.7)', pointerEvents: 'none' }}>✦</span>
        <span className="float-bob" style={{ position: 'absolute', left: '78%', top: '36%', color: 'var(--c-accent-gold)', fontSize: 9, textShadow: '0 0 6px rgba(255,207,107,0.7)', animationDelay: '1.1s', pointerEvents: 'none' }}>✦</span>
        <span className="float-bob" style={{ position: 'absolute', left: '52%', top: '14%', color: '#fff3b0', fontSize: 8, textShadow: '0 0 6px rgba(255,243,176,0.7)', animationDelay: '2.3s', pointerEvents: 'none' }}>✦</span>
      </div>
    </div>
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
      <MascotOverlay family="cylinder" name={tr('workshop.mascot.name')} lines={[tr('workshop.mascot.line'), tr('workshop.mascot.line2'), tr('workshop.mascot.line3')]} thanks={tr('workshop.mascot.thanks')} />
      {/* day-to-day flux upgrades first; the prestige Facets meta-tree below (only shown after the first ascent) */}
      <UpgradesPanel />
      <ExpeditionPerksPanel />
      <FacetsPanel />
    </div>
  )
}

// Echoes-bought expedition upgrades, surfaced in the Workshop (only once Expeditions is chartered). Inert to
// the core economy — they affect expeditions only.
function ExpeditionPerksPanel() {
  const view = useGame((s) => s.view)
  const exp = useGame((s) => s.expContent)
  const upgradeDefs = useGame((s) => s.upgradeDefs)
  const buyExpPerk = useGame((s) => s.buyExpPerk)
  const tr = useT()
  if (!view || !exp) return null
  const charterIdx = upgradeDefs.findIndex((u) => u.key === 'charter_expeditions')
  if (charterIdx < 0 || (view.upgrades[charterIdx] ?? 0) === 0) return null // hidden until chartered
  return (
    <div style={{ marginTop: 20 }}>
      <h4 style={{ margin: '0 0 2px', fontSize: 'var(--fs-h4, 16px)' }}>✶ {tr('exp.perks')}</h4>
      <p style={{ margin: '0 0 10px', fontSize: 'var(--fs-caption, 12px)', opacity: 0.65 }}>{tr('exp.perksHint')}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {exp.perks.map((p, i) => {
          const lvl = view.exp_perks[i] ?? 0
          const maxed = lvl >= p.max_level
          const cost = view.exp_perk_costs[i] ?? 0
          const afford = view.echoes >= cost
          return (
            <div key={p.key} style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 10, border: '1px solid rgba(155,140,255,0.25)', background: 'rgba(155,140,255,0.06)' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{tr(`exp.perk.${p.key}`)}</span>
              <span style={{ fontSize: 12, opacity: 0.7, minHeight: 32 }}>{tr(`exp.perk.${p.key}.desc`)}</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>{tr('exp.lvl', { lvl, max: p.max_level })}</span>
              <button
                style={{ marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid #9b8cff', background: maxed ? 'rgba(95,224,198,0.12)' : 'transparent', color: maxed ? '#5fe0c6' : '#9b8cff', cursor: maxed || !afford ? 'default' : 'pointer', opacity: maxed || !afford ? 0.5 : 1, fontWeight: 600 }}
                disabled={maxed || !afford}
                onClick={() => buyExpPerk(i)}
              >
                {maxed ? tr('exp.maxed') : `✶ ${cost.toLocaleString()}`}
              </button>
            </div>
          )
        })}
      </div>
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
  if (!view) return null
  if (view.use_orrery) return <OrreryEngine />

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
        <FactoryFloor
          shapes={shapes}
          loadout={view.loadout}
          boardCells={view.board_cells}
          boardW={view.board_w}
          boardH={view.board_h}
          openSlots={view.euler_used < view.euler_cap ? (view.loadout.length === 0 ? 3 : 2) : 0}
          onTap={onTap}
        />
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
            <span style={{ ...S.bigStatNum, color: '#ff9ecf', fontSize: 'var(--fs-numeral)' }}>×{view.mult_synergy.toFixed(2)}</span>
            <span style={S.bigStatLbl}>{tr('engine.kinSynergyStat', { count: view.active_synergies }).replace('{count>1?\'s\':\'\'}', view.active_synergies > 1 ? 's' : '')}</span>
          </div>
        )}
        <div style={S.budgetBox}>
          <div style={S.budgetTop}><span>{tr('engine.floorSpaceUsed')}</span><span>{view.euler_used} / {view.euler_cap}</span></div>
          <div style={S.meterTrack}><div style={{ ...S.meterFill, width: `${Math.min(100, pct * 100)}%`, background: pct > 0.85 ? '#ff5d8f' : '#5fe0c6', color: pct > 0.85 ? '#ff5d8f' : '#5fe0c6' }} /></div>
        </div>
        <div style={S.boardBtns}>
          <button style={S.smallBtn} onClick={autoArrange}>{tr('engine.autoArrange')}</button>
          <button style={{ ...S.smallBtn, opacity: view.core_complete ? 1 : 0.4 }} disabled={!view.core_complete} onClick={recrystallize} title={view.core_complete ? tr('engine.recrystallize.ready') : tr('engine.recrystallize.locked', { n: view.distinct_owned })}>{tr('engine.recrystallizeBtn')}</button>
          <button style={{ ...S.smallBtn, borderColor: 'var(--c-accent-gold)', color: 'var(--c-accent-gold)' }} onClick={() => useGame.getState().setUseOrrery(true)}>{tr('engine.orreryOn')}</button>
        </div>
      </div>

      <ProductionBreakdown />

      <h4 style={S.boardSub}>{tr('engine.floorHeading', { w: view.board_w, h: view.board_h, count: view.loadout.length })}</h4>
      <HelpNote id="help.board">
        <p style={{ ...S.boardDesc, fontSize: 'var(--fs-caption)', margin: '0 0 8px' }}>
          {tr('engine.boardHint')}
          {sel != null && <b style={{ color: '#5fe0c6' }}>{tr('engine.placingHint', { nick: shapes[sel]?.nick ?? '' })}</b>}
        </p>
      </HelpNote>
      <BoardGrid sel={sel} setSel={setSel} />

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
// A persistent "skip animations" preference (set from the ceremony's corner button, cleared in Settings) jumps
// pulls straight to the reveal — the power-user grind path the gacha-ceremony research flags as non-negotiable.
const SKIP_CEREMONY_KEY = 'shipshape-skip-ceremony'
const skipCeremony = () => typeof localStorage !== 'undefined' && localStorage.getItem(SKIP_CEREMONY_KEY) === '1'

// Settings toggle for the 3D pull ceremony — the re-enable for the in-ceremony "Skip animations" button.
// Self-contained (its own localStorage-backed state) so it doesn't touch the big settings component's state.
function CeremonyToggle() {
  const tr = useT()
  const [on, setOn] = useState(!skipCeremony())
  const toggle = () => {
    const next = !on
    setOn(next)
    try {
      if (next) localStorage.removeItem(SKIP_CEREMONY_KEY)
      else localStorage.setItem(SKIP_CEREMONY_KEY, '1')
    } catch {
      /* ignore */
    }
  }
  return (
    <SettingRow label={tr('settings.pullCeremonyLabel')} tip={tr('settings.pullCeremonyTip')}>
      <button style={{ ...S.toggle, ...(on ? S.toggleOn : {}) }} onClick={toggle}>{on ? tr('settings.toggleOn') : tr('settings.toggleOff')}</button>
    </SettingRow>
  )
}

// The pull ceremony. Charge-orb climbs to the best rarity, then we reveal the haul ONE BY ONE (suspense per
// gem) before the final recap grid. A high-rarity (SSR+) NEW shape gets the full cutscene beat — flash, ring,
// shake, layered sparks; everything else a quick reveal. Each card shows the shape's own dialog line.
function RevealModal() {
  const { lastReveal, shapes, dismissReveal } = useGame()
  const tr = useT()
  // Equipped ceremony theme (Shop cosmetic) — re-tints the reveal "peak"; any unset field keeps the rarity default.
  const ceremony = ceremonyById(useGame((s) => s.view?.equipped?.[SLOT_CEREMONY] ?? 0))
  const [phase, setPhase] = useState<'charge' | 'step' | 'summary'>('charge')
  const [step, setStep] = useState(0)
  // Tapping a haul-grid tile shows THAT shape's card directly (a lastReveal index), independent of the SSR+
  // cutscene `revealQueue`. (Bug fix: tiles set step=i and the step phase read revealQueue[i] — undefined for
  // commons/rares → an empty card.)
  const [detailIdx, setDetailIdx] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leftCharge = useRef(false) // guard: the ceremony's onDone and a tap-to-skip must not both advance
  // Which pulls earn an INDIVIDUAL reveal (gacha-style): a single pull always shows its one gem; a multi-pull
  // spotlights only the NEW SSR+ (rank ≥ 3) one-by-one — commons/rares/epics land straight in the summary grid.
  // Empty (a multi-pull with no new SSR+) ⇒ skip individual reveals entirely and go to the grid.
  const revealQueue = useMemo<number[]>(() => {
    if (!lastReveal) return []
    if (lastReveal.length === 1) return [0]
    return lastReveal.reduce<number[]>((acc, o, i) => {
      const sh = shapes[o.shape_id]
      if (sh && RARITY_ORDER.indexOf(sh.rarity) >= 3 && o.is_new) acc.push(i)
      return acc
    }, [])
  }, [lastReveal, shapes])
  const best = lastReveal ? [...lastReveal].sort((a, b) => RARITY_ORDER.indexOf(b.rarity!) - RARITY_ORDER.indexOf(a.rarity!))[0] : null
  const bestShape = best ? shapes[best.shape_id] : undefined
  // Per-reveal spectacle: SSR+ NEW (the "cutscene") gets layered, rarity-scaled bursts; others a soft pop.
  const fireStep = (qi: number) => {
    if (!lastReveal) return
    const o = lastReveal[revealQueue[qi]]
    const sh = o && shapes[o.shape_id]
    if (!sh) return
    const rank = RARITY_ORDER.indexOf(sh.rarity)
    const cut = rank >= 3 && !!o.is_new
    const cx = window.innerWidth / 2
    const cy = window.innerHeight * 0.42
    const hue = RARITY_COLOR[sh.rarity]
    const hues = ceremony.sparkHues ?? [hue, '#ffffff', '#fff6dc', hue]
    if (cut) {
      useSparks.getState().burst(cx, cy, { count: 14 + rank * 8, power: 1.3 + rank * 0.45, hues })
      if (rank >= 4) setTimeout(() => useSparks.getState().burst(cx, cy, { count: 12 + rank * 6, power: 1.1 + rank * 0.4, hues }), 200)
      if (rank >= 5) setTimeout(() => useSparks.getState().burst(cx, cy, { count: 26, power: 2.2, hues }), 430)
      sfxReveal(rank)
    } else {
      useSparks.getState().burst(cx, cy, { count: 6 + rank * 3, power: 0.8 + rank * 0.15, hues })
      sfxClimbTick(Math.min(rank + 1, 4))
    }
  }
  useEffect(() => {
    if (!lastReveal) return
    leftCharge.current = false
    setStep(0)
    setDetailIdx(null)
    // A persistent "skip animations" preference jumps straight to the reveal; otherwise the 3D PullCeremony
    // (the 'charge' phase) drives the timing + audio itself and calls advance() when it finishes or is skipped.
    if (skipCeremony()) {
      if (revealQueue.length) { setPhase('step'); fireStep(0) }
      else setPhase('summary')
    } else setPhase('charge')
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReveal])
  // The haul recap landing gets its own celebratory sting (fires once, however you reach the summary).
  useEffect(() => {
    if (phase === 'summary') sfxHaul()
  }, [phase])
  if (!lastReveal || !best) return null
  const len = lastReveal.length
  const advance = () => {
    if (phase === 'charge') {
      if (leftCharge.current) return // the ceremony's onDone and a tap-to-skip can both fire — transition once
      leftCharge.current = true
      if (timer.current) clearTimeout(timer.current)
      if (revealQueue.length) { setPhase('step'); fireStep(0) }
      else setPhase('summary')
      return
    }
    if (phase === 'step') {
      if (detailIdx != null) { setDetailIdx(null); setPhase('summary'); return } // browsing a haul detail → back to the grid
      const next = step + 1
      if (next < revealQueue.length) { setStep(next); fireStep(next) }
      else if (len > 1) setPhase('summary')
      else dismissReveal()
      return
    }
    dismissReveal()
  }

  if (phase === 'charge') {
    return (
      <div style={S.modal} onClick={advance}>
        <PullCeremony
          pulls={lastReveal}
          shapes={shapes}
          onDone={advance}
          onSkipAll={() => { try { localStorage.setItem(SKIP_CEREMONY_KEY, '1') } catch { /* ignore */ } advance() }}
        />
      </div>
    )
  }

  if (phase === 'step') {
    const detail = detailIdx != null
    const o = detail ? lastReveal[detailIdx] : lastReveal[revealQueue[step]]
    const sh = o && shapes[o.shape_id]
    if (!sh) {
      return <div style={S.modal} onClick={advance}><div style={S.revealCard} onClick={(e) => e.stopPropagation()}><button className="btn-primary" style={S.pullBtn} onClick={advance}>{tr('reveal.continue')}</button></div></div>
    }
    const rank = RARITY_ORDER.indexOf(sh.rarity)
    const cut = rank >= 3 && !!o.is_new // SSR+ and new ⇒ the reveal "cutscene"
    const lines = chatterFor(sh.family, 0)
    const line = lines.length ? lines[step % lines.length] : ''
    const last = detail || step + 1 >= revealQueue.length // detail view: the button reads "see haul" → back to grid
    // basic stats for the pull card — production (shown per-MINUTE) + how it moves flux + its skill
    const eff = shapeEffect(sh.family, sh.genus, sh.euler_cost)
    const pat = fluxPattern(sh.family, sh.genus)
    const perMin = Math.max(1, Math.round(sh.prod / 60))
    const emitIcon = { beam: '➡️', rotating: '🔄', scatter: '✳️', pulse: '💥' }[pat.emit]
    return (
      <div style={S.modal} onClick={advance}>
        {/* SSR+ cutscene: a screen-wide colour flash on entrance (re-fires per SSR+ in a multi-pull) */}
        {cut && <div key={`flash-${step}`} className="ceremony-flash" style={{ background: `radial-gradient(circle at 50% 44%, ${ceremony.flashTint ?? RARITY_COLOR[sh.rarity]}, transparent 60%)`, ['--flash-ms' as string]: '700ms' }} />}
        <div key={step} className={cut ? 'pop-in reveal-shake case-door' : 'pop-in case-door'} style={{ ...S.revealCard, position: 'relative', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
          {cut && <div className="flash" style={{ background: `radial-gradient(circle, ${ceremony.flashTint ?? RARITY_COLOR[sh.rarity]}, transparent 60%)` }} />}
          {cut && rank >= 4 && <div className="flash-ring" style={{ color: ceremony.ringTint ?? RARITY_COLOR[sh.rarity] }} />}
          {!detail && revealQueue.length > 1 && <div style={S.revealCount}>{step + 1} / {revealQueue.length}</div>}
          {/* SSR+ cutscene: a rarity star banner pops in (★ count = tier) above the gem */}
          {cut && (
            <div className="ssr-banner" style={{ position: 'relative', zIndex: 2, marginBottom: 2 }}>
              <div className="ssr-stars" style={{ color: ceremony.flashTint ?? RARITY_COLOR[sh.rarity], fontSize: 'var(--fs-h4)' }}>{'★'.repeat(Math.min(rank + 1, 5))}</div>
              <div style={{ color: ceremony.flashTint ?? RARITY_COLOR[sh.rarity], fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-eyebrow)', letterSpacing: 2 }}>{sh.rarity.toUpperCase()}</div>
            </div>
          )}
          <div style={{ ...S.revealStage, position: 'relative' }}>
            {/* SSR+ gets a slowly-rotating sunburst behind the gem (the classic gacha "rays") */}
            {cut && <div className="ssr-rays" style={{ color: ceremony.flashTint ?? RARITY_COLOR[sh.rarity] }} />}
            <HeroView key={sh.family} family={sh.family} rarity={sh.rarity} controls={len === 1 || detail} spin={0.8} materialize />
            {/* NEW! badge overlaid on the 3D preview — glowing + pulsing (the "this is a fresh shape" peak) */}
            {o.is_new && (
              <div className="reveal-new-badge" style={{ position: 'absolute', top: 12, left: '50%', zIndex: 2, pointerEvents: 'none', fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-h4)', letterSpacing: 0.5, color: ceremony.flashTint ?? RARITY_COLOR[sh.rarity] }}>
                {tr('reveal.new')}
              </div>
            )}
          </div>
          <h2 style={{ color: RARITY_COLOR[sh.rarity], fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: 0.4 }}>{sh.nick}{cut ? ' ✦' : ''}</h2>
          {!o.is_new && <p style={S.revealSub}>+{o.dupe_shards} ◈ {tr('hud.shards')}</p>}
          {/* basic stats: flux/min · emission pattern · skill */}
          <div style={S.revealStats}>
            <div style={S.revealStat} title={tr('reveal.stat.fluxTip')}><span style={{ ...S.revealStatVal, color: 'var(--c-accent-gold-bright)' }}>✦ {fmt(perMin)}</span><span style={S.revealStatLbl}>{tr('reveal.stat.perMin')}</span></div>
            <div style={S.revealStat} title={pat.emitLabel}><span style={S.revealStatVal}>{emitIcon} {tr(`reveal.pattern.${pat.emit}`)}</span><span style={S.revealStatLbl}>{tr('reveal.stat.pattern')}</span></div>
            <div style={S.revealStat} title={eff.desc}><span style={{ ...S.revealStatVal, color: eff.special ? RARITY_COLOR[sh.rarity] : 'var(--c-text-dim)' }}>{eff.icon} {eff.special ? eff.name : tr('reveal.stat.noSkill')}</span><span style={S.revealStatLbl}>{tr('reveal.stat.skill')}</span></div>
          </div>
          {line && <div style={S.revealDialog}>“{line}”</div>}
          <button className="btn-primary" style={S.pullBtn} onClick={advance}>{last ? (len > 1 ? tr('reveal.seeHaul') : tr('reveal.continue')) : tr('reveal.next')}</button>
          {len > 1 && !last && <button style={S.revealSkip} onClick={(e) => { e.stopPropagation(); setPhase('summary') }}>{tr('reveal.skipAll')}</button>}
        </div>
      </div>
    )
  }

  // summary — the haul recap grid (ten-pull)
  return (
    <div style={S.modal} onClick={dismissReveal}>
      <div className="pop-in case-door" style={{ ...S.revealCard, position: 'relative', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ color: bestShape ? RARITY_COLOR[bestShape.rarity] : '#fff', fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: 0.4, marginBottom: 'var(--sp-2)' }}>{tr('reveal.haulHeading')}</h2>
        <div style={S.haulGrid}>
          {lastReveal.map((o, i) => {
            const sh = shapes[o.shape_id]
            if (!sh) return null
            const col = RARITY_COLOR[sh.rarity]
            const rank = RARITY_ORDER.indexOf(sh.rarity)
            const hi = rank >= 3 // SSR+ ("legendary") — gets the loud glow + sparkle
            // rarity-scaled glow; SSR+ a double-layer halo
            const glow = hi ? `0 0 10px ${col}, 0 0 22px ${col}99, inset 0 0 12px ${col}55` : `0 0 ${4 + rank * 2}px ${col}66`
            return (
              <button
                key={i}
                className={`haul-in haul-tile-btn${hi ? ' haul-shine' : ''}`}
                style={{ ...S.haulTile, borderColor: col, background: `${col}1c`, boxShadow: glow, animationDelay: `${i * 55}ms` }}
                title={`${sh.nick} — ${tr('reveal.tapDetails')}`}
                onClick={() => { setDetailIdx(i); setPhase('step') }}
              >
                <span style={{ fontSize: 'var(--fs-numeral)', filter: hi ? `drop-shadow(0 0 6px ${col})` : 'none' }}>{glyphOf(sh.family)}</span>
                {hi && <span className="haul-spark" style={{ color: col }}>✦</span>}
                {o.is_new && <span className="haul-new-pulse" style={S.haulNew}>{tr('reveal.newShort')}</span>}
              </button>
            )
          })}
        </div>
        <p style={S.haulHint}>{tr('reveal.tapDetails')}</p>
        <button className="btn-primary" style={S.pullBtn} onClick={dismissReveal}>{tr('reveal.continue')}</button>
      </div>
    </div>
  )
}

// Friendly "time away" — days / hours / minutes, no noise.
function fmtAway(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Time to afford a Flux `deficit` at the live Flux/hr `rate` — the "~5m" estimate shown on purchasable cards.
// Returns '' when already affordable, '—' when the rate is zero (no estimate possible).
// "Welcome back, Curator" — the gentle, positive *start/end* of a session (peak-end rule). Styled to match the
// welcome screen: the hand-made title art, drifting motes, and the Flux you earned glowing front and centre.
// Away ≥ this → the full "Welcome back, Curator" curation screen; shorter → a quiet self-dismissing toast
// (a brief absence doesn't warrant a full-screen interruption — peak-end rule, but proportionate).
const OFFLINE_MODAL_MIN = 5 * 60_000

// The quiet path for a short absence: a toast that slides in, holds, fades, and clears the report itself.
function OfflineToast({ gained, onDone }: { gained: number; onDone: () => void }) {
  const tr = useT()
  useEffect(() => {
    const t = setTimeout(onDone, 4000) // matches the offline-toast CSS animation
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div
      className="offline-toast"
      onClick={onDone}
      style={{ position: 'fixed', top: 'var(--sp-4)', left: '50%', zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 16px', borderRadius: 'var(--r-lg)', background: 'rgba(28,30,42,0.95)', border: '1px solid rgba(255,207,107,0.3)', boxShadow: '0 6px 24px rgba(0,0,0,0.45), 0 0 18px rgba(255,207,107,0.12)' }}
    >
      <span style={{ fontSize: 22, color: '#ffd76b', textShadow: '0 0 10px rgba(255,207,107,0.6)' }}>✦</span>
      <div style={{ textAlign: 'left' }}>
        <strong style={{ display: 'block', color: '#e8eaf2', fontSize: 'var(--fs-body-sm)' }}>{tr('offline.toast.title')}</strong>
        <span style={{ color: '#ffd76b', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-body)' }}>{tr('offline.toast.body', { flux: fmt(gained) })}</span>
      </div>
    </div>
  )
}

function OfflineModal() {
  const { offline, dismissOffline } = useGame()
  const tr = useT()
  if (!offline) return null
  // brief absence → quiet toast instead of the full curation screen
  if (offline.elapsed_ms < OFFLINE_MODAL_MIN) return <OfflineToast gained={offline.gained_flux} onDone={dismissOffline} />
  const away = fmtAway(offline.elapsed_ms)
  const capped = offline.elapsed_ms > offline.capped_ms + 60_000
  const capH = Math.round(offline.capped_ms / 3_600_000)
  return (
    <div style={S.modal} onClick={dismissOffline}>
      <div className="pop-in" style={{ ...S.revealCard, position: 'relative', overflow: 'hidden', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <WelcomeMotes />
        <TitleArt className="welcome-art" style={{ marginBottom: 14 }} />
        <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 'var(--fw-bold)', letterSpacing: 0.5, animation: 'welcome-title-in 0.8s ease-out both' }}>{tr('offline.title')}</h2>
        <p style={{ ...S.hint, margin: '0 0 16px' }}>{tr('offline.subtitle')}</p>
        <div style={{ margin: '0 auto 14px', padding: '14px 22px', borderRadius: 'var(--r-xl)', display: 'inline-block', background: 'radial-gradient(circle at 50% 0%, rgba(255,207,107,0.16), rgba(255,207,107,0.02))', border: '1px solid rgba(255,207,107,0.25)', boxShadow: '0 0 24px rgba(255,207,107,0.10)' }}>
          <div style={{ fontSize: 'var(--fs-eyebrow)', textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--c-text-dim)' }}>{tr('offline.awayFor', { time: away })}</div>
          <p style={{ margin: '5px 0 0', fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-heavy)', fontSize: 40, lineHeight: 1.05, color: '#ffd76b', textShadow: '0 0 20px rgba(255,207,107,0.55), 0 2px 6px rgba(0,0,0,0.5)' }}>+{fmt(offline.gained_flux)} ✦</p>
          {offline.gained_echoes > 0 && (
            <p style={{ margin: '8px 0 0', fontWeight: 'var(--fw-heavy)', fontSize: 20, color: '#9b8cff', textShadow: '0 0 14px rgba(155,140,255,0.5)' }}>{tr('offline.echoes', { n: fmt(offline.gained_echoes) })}</p>
          )}
        </div>
        {capped && <p style={{ ...S.hint, margin: '0 0 12px', opacity: 0.75 }}>{tr('offline.cappedNote', { h: capH })}</p>}
        <button className="btn-primary" style={{ ...S.pullBtn, display: 'block', width: '100%', marginTop: 4 }} onClick={dismissOffline}>{tr('offline.collect')}</button>
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
        <span key={sp.k} className="floater" style={{ position: 'absolute', left: sp.x, top: sp.y, color: '#fff3b0', fontSize: 'var(--fs-body-sm)', pointerEvents: 'none' }}>✦</span>
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
  // ←/→ page through the full shape list (wrapping). Reads the live id from the store so it never goes stale.
  useEffect(() => {
    const n = shapes.length
    if (!n) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const cur = useInspector.getState().id
      if (cur == null) return
      e.preventDefault()
      useInspector.getState().set(((cur + (e.key === 'ArrowRight' ? 1 : -1)) % n + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shapes.length])
  if (!s || !view) return null
  const codex = CODEX[s.family]
  const bond = view.bond_levels[id] ?? 0
  const st = view.star_levels[id] ?? 0
  const eff = shapeEffect(s.family, s.genus, s.euler_cost)
  // Prev/next browse the full shape list (wrapping); the carousel arrows on the preview do the same as ←/→.
  const go = (delta: number) => {
    const n = shapes.length
    if (n) useInspector.getState().set((((useInspector.getState().id ?? id) + delta) % n + n) % n)
  }
  // Prev/next flank the name + details row, vertically centred (not overlaid on the 3D render).
  const navRow = (content: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', margin: '0 0 12px' }}>
      <button className="insp-nav" style={S.inspNavRow} onClick={(e) => { e.stopPropagation(); go(-1) }} title={tr('inspect.prev')} aria-label={tr('inspect.prev')}>‹</button>
      <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
      <button className="insp-nav" style={S.inspNavRow} onClick={(e) => { e.stopPropagation(); go(1) }} title={tr('inspect.next')} aria-label={tr('inspect.next')}>›</button>
    </div>
  )
  return (
    <div style={S.modal} onClick={onClose}>
      <div className="pop-in" role="dialog" aria-modal="true" aria-label={s.nick}
        style={owned ? { ...S.revealCard, position: 'relative', maxWidth: 'min(900px, 96vw)', width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', padding: 'var(--sp-4)' } : { ...S.revealCard, position: 'relative' }}
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={S.inspectClose} title={tr('common.close')} aria-label={tr('common.close')}>✕</button>
        {/* keyed by id so the sheet gently re-fades each time you page to another shape */}
        <div key={id} className="fade-in" style={owned ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined}>
        {owned ? (
          // Desktop: two columns — a big gem hero (left) beside the independently-scrolling dossier (right),
          // so the long sheet never overflows a short viewport. Stacks back to one column under 760px.
          <div className="inspect-split">
            <div className="inspect-hero">
              <div className="inspect-stage" style={{ ...S.revealStage, position: 'relative', height: 'auto', marginBottom: 0 }}>
                <HeroView key={s.family} family={s.family} rarity={s.rarity} controls={!patMode} />
                {patMode && <PatSurface id={id} />}
                <button style={S.patBtn} onClick={() => setPatMode((p) => !p)} title={tr('inspect.pat.title')}>
                  {patMode ? tr('inspect.pat.orbit') : tr('inspect.pat.pat')}
                </button>
                {!patMode && <button style={S.talkBtn} onClick={() => talk(s, bond)} title={tr('inspect.talk.title')}>💬</button>}
                {bubble && <SpeechBubble bubble={bubble} onClose={() => setBubble(null)} />}
              </div>
              {navRow(
                <>
                  <h2 style={{ color: RARITY_COLOR[s.rarity], margin: '0 0 2px' }}>{s.nick}</h2>
                  <p style={{ ...S.revealSub, margin: 0 }}>{rarityLabel(s.rarity)} · {s.family.replace(/_/g, ' ')}</p>
                </>,
              )}
            </div>
            <div className="inspect-detail">
            {/* ── Abilities: the skill, how it plays on the flux floor, and the topology facts ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', borderRadius: 'var(--r-lg)', padding: '9px 11px', border: `1px solid ${eff.special ? 'rgba(158,240,255,0.28)' : 'var(--c-border)'}`, background: eff.special ? 'rgba(95,224,198,0.07)' : 'var(--c-surface-2)' }}>
                <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0, opacity: eff.special ? 1 : 0.5 }}>{eff.icon}</span>
                <div>
                  <div style={{ fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('inspect.skill.heading')}</div>
                  <strong style={{ color: eff.special ? '#9ef0ff' : 'var(--c-text-secondary)' }}>{eff.name}</strong>
                  <p style={{ ...S.hint, margin: '2px 0 0' }}>{eff.desc}</p>
                </div>
              </div>
              <FluxBehaviour family={s.family} genus={s.genus} heading={tr('inspect.flux.heading')} />
              <p style={{ ...S.hint, margin: 0 }}>
                {s.genus > 0 ? tr('inspect.topology.holesLanes', { genus: s.genus }).replace(/\{s\}/g, s.genus > 1 ? 's' : '') : tr('inspect.topology.noHoles')}
                {tr('inspect.topology.eulerCost', { cost: s.euler_cost })}{codex ? tr('inspect.topology.termReveal', { term: codex.term }) : ''}
              </p>
              {/* Its Eigenmode instrument (the voice it sings in the orrery) — timbre derived from its topology. */}
              {(() => {
                const voice = instrumentForShape(s)
                return (
                  <button
                    style={{ ...S.smallBtn, alignSelf: 'flex-start' }}
                    onClick={() => previewInstrument(noteForShape(s), voice.wave, voice.detune, voice.flip)}
                    title={tr('inspect.instrument.title')}
                  >
                    🔊 {tr('inspect.instrument.label')} · {voice.patch.charAt(0).toUpperCase() + voice.patch.slice(1)}
                  </button>
                )
              })()}
            </div>
            {/* ── Progression: bond + stars ── */}
            <p style={{ ...S.bondRow, marginTop: 4 }}>
              <span style={{ color: '#ff5d8f', letterSpacing: 2 }}>{'♥'.repeat(bond)}</span>
              <span style={{ color: '#3b2b38', letterSpacing: 2 }}>{'♡'.repeat(Math.max(0, 5 - bond))}</span>
              <span style={S.bondHint}>{tr('inspect.bond.hint', { bond })}</span>
            </p>
            <p style={S.bondRow}>
              <span style={{ color: '#ffd76b', letterSpacing: 2 }}>{'★'.repeat(st)}</span>
              <span style={{ color: '#3a3320', letterSpacing: 2 }}>{'☆'.repeat(5 - st)}</span>
              <span style={S.bondHint}>{tr('inspect.star.hint', { st })}</span>
            </p>
            {/* ── Lore ── */}
            {codex && <p style={{ ...S.hint, fontStyle: 'italic', color: '#cdd2e0', fontFamily: fontOf(s.family), marginTop: 6 }}>“{codex.blurb}”</p>}
            {codex && bond >= 1 && <p style={{ ...S.hint, color: RARITY_COLOR[s.rarity], fontFamily: fontOf(s.family) }}>{codex.bond}</p>}
            {codex && bond < 1 && <p style={{ ...S.hint, opacity: 0.7 }}>{tr('inspect.bond.locked')}</p>}
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
                      <span style={{ color: united ? '#e8eaf2' : '#8a90a8', fontWeight: 'var(--fw-bold)', flexShrink: 0 }}>{partner ? partner.nick : '???'}</span>
                      <span style={S.kinNote}>— {k.note}</span>
                      {canWatch && <span style={S.watchPill}>{tr('inspect.kinship.watchScene')}</span>}
                    </div>
                  )
                })}
              </div>
            ) : null}
            </div>
          </div>
        ) : (
          <>
            {/* No 3D preview for undiscovered shapes — pulling is the joy. Just a vague teaser. */}
            <div style={{ ...S.revealStage, display: 'grid', placeItems: 'center' }}>
              <span style={{ fontSize: 72, color: '#2a2c3a', fontWeight: 'var(--fw-bold)' }}>?</span>
            </div>
            {navRow(
              <>
                <h2 style={{ color: '#6b7088', margin: '0 0 2px' }}>{tr('inspect.undiscovered.title')}</h2>
                <p style={{ ...S.revealSub, margin: 0 }}>{rarityLabel(s.rarity)} · {tr('inspect.undiscovered.sub')}</p>
              </>,
            )}
            <p style={{ ...S.hint, fontStyle: 'italic', color: '#aab' }}>{vagueHint(s.rarity, s.genus, tr)}</p>
            <p style={{ ...S.hint, opacity: 0.7 }}>{tr('inspect.undiscovered.pullHint')}</p>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

function ForgeView() {
  const { recipes, view, shapes, forge, claimRelic, autoForge, toggleAutoForge } = useGame()
  const tr = useT()
  const [hover, setHover] = useState<number | null>(null)
  if (!view) return null
  const canRelic = view.shards >= view.relic_cost && view.relics_owned < view.relic_count
  // Feature a recipe in the 3D altar: the one the player is pointing at, else the first forgeable, else #0.
  const featIdx = (() => {
    if (hover != null) return hover
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
      <MascotOverlay family="klein_bottle" name={tr('forge.mascot.name')} lines={[tr('forge.mascot.line'), tr('forge.mascot.line2'), tr('forge.mascot.line3')]} thanks={tr('forge.mascot.thanks')} bob />

      <div style={S.floorWrap}>
        {feat && <ForgeAltar a={shapes[feat.a]} b={shapes[feat.b]} out={shapes[feat.out]} discovered={view.discovered[featIdx]} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <h4 style={{ ...S.boardSub, margin: 0 }}>{tr('forge.recipes.heading')}</h4>
        <button onClick={toggleAutoForge} title={tr('forge.autoTip')} style={{ ...S.smallBtn, ...(autoForge ? S.toggleOn : {}) }}>
          🔨 {tr('forge.autoLabel')} · {autoForge ? tr('common.on') : tr('common.off')}
        </button>
      </div>
      <p style={{ ...S.boardDesc, margin: '6px 0 var(--sp-2_5)' }}>{tr('forge.inv.legend')}</p>
      <div style={S.recipeGrid}>
        {recipes.map((r, i) => {
          const cost = view.recipe_costs[i] ?? 0
          const haveA = view.owned[r.a] > 0
          const haveB = view.owned[r.b] > 0
          const can = haveA && haveB && view.shards >= cost
          const discovered = view.discovered[i]
          const out = shapes[r.out]
          return (
            <div
              key={i}
              className="chip"
              style={{ ...S.recipeCard, borderColor: discovered ? RARITY_COLOR[out.rarity] : '#23252f', outline: featIdx === i ? '1px solid rgba(255,206,92,0.4)' : 'none' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <div style={S.recipeFlow}>
                <GemChip shape={shapes[r.a]} show={haveA} inv />
                <span style={S.flowOp}>＋</span>
                <GemChip shape={shapes[r.b]} show={haveB} inv />
                <span style={S.flowOp}>→</span>
                <GemChip shape={out} show={discovered} inv />
              </div>
              <button className="forge-cap" style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={() => forge(r.a, r.b)}>
                {can ? tr('forge.recipe.forgeCost', { cost }) : !haveA || !haveB ? tr('forge.recipe.missingShape') : tr('forge.recipe.needShards', { cost })}
              </button>
              {discovered && <span style={S.discoveredTag}>{tr('forge.recipe.discovered')}</span>}
            </div>
          )
        })}
      </div>

      <ForgeBench />

      <div style={{ ...S.relicPanel, marginTop: 'var(--sp-4)' }}>
        <div style={{ flex: 1 }}>
          <strong style={{ color: '#ffd76b' }}>{tr('forge.referenceWing.title')}</strong>
          <p style={{ ...S.boardDesc, margin: '4px 0 0' }}>{tr('forge.referenceWing.desc', { owned: view.relics_owned, count: view.relic_count })}</p>
        </div>
        <button className="pull-cap" style={{ ...S.summonBtn, opacity: canRelic ? 1 : 0.4 }} disabled={!canRelic} onClick={claimRelic}>
          {view.relics_owned >= view.relic_count ? tr('forge.summon.complete') : tr('forge.summon.cost', { cost: view.relic_cost })}
        </button>
      </div>
    </div>
  )
}

// The free-form fusion bench: pick ANY two owned surfaces and glue them. The output is the real connected
// sum (computed in the core via previewForge) — not limited to the curated recipe book. First time you ever
// forge a given shape, it stings as a discovery. This is the "second slot machine": open-ended crafting.
function ForgeBench() {
  const { view, shapes, forge, previewForge, forgeCostFor } = useGame()
  const tr = useT()
  const [sel, setSel] = useState<number[]>([])
  if (!view) return null
  const owned = shapes.filter((s) => view.owned[s.id] > 0 && s.forgeable)
  const a = sel[0]
  const b = sel[1]
  const outId = a != null && b != null ? previewForge(a, b) : -1
  const out = outId >= 0 ? shapes[outId] : undefined
  const isIdentity = out != null && (outId === a || outId === b)
  const cost = a != null && b != null && outId >= 0 ? forgeCostFor(a, b) : 0
  const canForge = a != null && b != null && outId >= 0 && view.shards >= cost
  // round-robin select: tap toggles; a third pick drops the oldest.
  const pick = (id: number) =>
    setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[1], id]))
  return (
    <div style={S.fusionPanel}>
      <h4 style={S.boardSub}>{tr('forge.bench.heading')}</h4>
      <p style={{ ...S.boardDesc, margin: '0 0 var(--sp-2_5)' }}>{tr('forge.bench.desc')}</p>
      <div style={S.recipeFlow}>
        <GemChip shape={a != null ? shapes[a] : undefined} show={a != null} inv />
        <span style={S.flowOp}>＋</span>
        <GemChip shape={b != null ? shapes[b] : undefined} show={b != null} inv />
        <span style={S.flowOp}>→</span>
        <GemChip shape={out} show={out != null} inv />
      </div>
      <p style={{ ...S.boardDesc, textAlign: 'center', minHeight: 18, margin: 'var(--sp-1) 0' }}>
        {a == null || b == null
          ? tr('forge.bench.hint')
          : outId < 0
            ? tr('forge.bench.noFusion')
            : isIdentity
              ? tr('forge.bench.identity', { nick: out!.nick })
              : ''}
      </p>
      <button
        className="forge-cap"
        style={{ ...S.forgeBtn, opacity: canForge ? 1 : 0.4 }}
        disabled={!canForge}
        onClick={() => {
          if (a != null && b != null) forge(a, b)
        }}
      >
        {view.shards < cost ? tr('forge.recipe.needShards', { cost }) : tr('forge.recipe.forgeCost', { cost })}
      </button>
      <div style={S.fusionPicker}>
        {owned.map((s) => (
          <button
            key={s.id}
            className="chip"
            style={{ ...S.fusionChip, borderColor: sel.includes(s.id) ? RARITY_COLOR[s.rarity] : '#2a2c3a' }}
            onClick={() => pick(s.id)}
          >
            <span style={{ ...S.gemChipDot, width: 18, height: 18, background: RARITY_COLOR[s.rarity] }} />
            <span style={S.fusionChipName}>{s.nick}</span>
          </button>
        ))}
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
        <div style={S.revealStage}>{s && <HeroView key={s.family} family={s.family} rarity={s.rarity} spin={0.8} materialize />}</div>
        {s && <h2 style={{ color: RARITY_COLOR[s.rarity] }}>{s.nick}</h2>}
        <p style={S.revealSub}>{lastForge.is_discovery ? tr('reveal.discovery') : tr('reveal.forged')}</p>
        <button className="btn-primary" style={S.pullBtn} onClick={dismissForge}>{tr('reveal.continue')}</button>
      </div>
    </div>
  )
}

// After Recrystallizing (NG+), a small celebratory modal naming the cohort that just ignited at the new
// dimension — so the player knows what fresh chase shapes are now within reach.
function AscensionModal() {
  const { ascended, dismissAscension, shapes } = useGame()
  const tr = useT()
  if (ascended == null) return null
  // the cohort that FIRST becomes pullable at exactly this dimension (Meta at v4, Transcendent at v5).
  // Display-only — the actual gacha gating is the Rust truth (gacha::metashapes_gate_on_dimension).
  const fresh = shapes.filter((s) => (ascended === 4 && s.rarity === 'Meta') || (ascended === 5 && s.rarity === 'Transcendent'))
  return (
    <div style={S.modal} onClick={dismissAscension}>
      <div className="pop-in case-door" style={S.revealCard} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ color: '#b388ff', fontFamily: 'var(--font-display)', fontSize: 24 }}>{tr('ascend.title', { dim: ascended })}</h2>
        <p style={S.revealSub}>{tr('ascend.sub')}</p>
        {fresh.length > 0 ? (
          <>
            <p style={{ ...S.boardDesc, margin: '0 0 var(--sp-2_5)' }}>{tr('ascend.newShapes')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3_5)' }}>
              {fresh.map((s) => (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 'var(--fs-numeral)', color: RARITY_COLOR[s.rarity], filter: `drop-shadow(0 0 7px ${RARITY_COLOR[s.rarity]})` }}>{glyphOf(s.family)}</span>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)' }}>{s.nick}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ ...S.boardDesc, margin: '0 0 var(--sp-3_5)' }}>{tr('ascend.deeper')}</p>
        )}
        <button className="btn-primary" style={S.pullBtn} onClick={dismissAscension}>{tr('reveal.continue')}</button>
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
          <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-eyebrow)', color: '#8a90a8' }}>{step + 1}/{TOUR_STEPS.length}</span>
        </div>
        <p style={{ ...S.boardDesc, margin: '8px 0 12px' }}>{tr(`${cur.key}.body`)}</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-primary" style={S.pullBtn} onClick={() => (last ? finish() : next())}>{last ? tr('tour.finish') : tr('tour.next')}</button>
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
        <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 'var(--fw-bold)', letterSpacing: 0.5, animation: 'welcome-title-in 0.8s ease-out both' }}>{tr('welcome.title')}</h2>
        <p style={S.revealSub}>{tr('welcome.body')}</p>
        <p style={S.hint}>{tr('welcome.note')}</p>
        <button className="btn-primary" style={S.pullBtn} onClick={begin}>{tr('welcome.begin')}</button>
        <p style={S.vibecoded}>{tr('welcome.vibecoded')}</p>
      </div>
    </div>
  )
}

// Live hover preview for a Shop scene: Pip the sphere refracting that (unequipped) scene's cosmos — raymarched,
// or path-traced if you've turned that on (the previewScene override works in both paths). So you can see a
// scene on a real gem before buying, without equipping it. (Finishes/lighting are mesh-only, so a raymarched
// sphere can't show them — those would need a forced-mesh preview.)
function ScenePreview({ sceneId }: { sceneId: number }) {
  return (
    <div style={{ width: 204, height: 150, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--c-bg-stage)' }}>
      <HeroView family="sphere" rarity="Ssr" controls={false} motes={false} spin={0.5} previewScene={sceneId} frameloop="always" />
    </div>
  )
}

// Remember the last-opened Shop category for the rest of the session, so leaving and returning keeps your place.
let lastShopCat = 0
function ShopView() {
  const { view, buyCosmetic, selectScene, buyCosmeticSlot, equipCosmeticSlot } = useGame()
  const tr = useT()
  const [cat, setCatState] = useState(lastShopCat)
  const setCat = (i: number) => { lastShopCat = i; setCatState(i) }
  const [popped, setPopped] = useState<number | null>(null)
  const [hoverId, setHoverId] = useState<number | null>(null) // shop hover-preview: which item the gem is previewing
  const hoverT = useRef<number | null>(null) // hover-intent debounce timer
  if (!view) return null
  const category = SHOP_CATEGORIES[cat]
  const isScene = category.slot === 'scene'
  const slot = typeof category.slot === 'number' ? category.slot : -1
  // Hover-preview: hovering an item shows it on a preview gem before you buy/equip. Only the classes that change
  // the HERO gem's look can preview (scene · atmosphere · finish); others have nothing to show on a static gem.
  const previewable = category.key === 'scenes' || category.key === 'atmosphere' || category.key === 'finishes'
  const pScene = category.key === 'scenes' ? hoverId ?? undefined : undefined
  const pAtmo = category.key === 'atmosphere' ? hoverId ?? undefined : undefined
  const pFinish = category.key === 'finishes' ? hoverId ?? undefined : undefined
  // hover-intent: only swap the preview once the cursor SETTLES on an item, so sweeping the grid doesn't churn
  // the preview (and, for atmospheres, repeatedly mount volumetric shaders that compile + stutter on first use).
  const hoverPreview = (id: number) => {
    if (!previewable) return
    if (hoverT.current) clearTimeout(hoverT.current)
    hoverT.current = window.setTimeout(() => setHoverId(id), 150)
  }
  const hoverLeave = (id: number) => {
    if (hoverT.current) { clearTimeout(hoverT.current); hoverT.current = null }
    setHoverId((h) => (h === id ? null : h))
  }
  const equippedId = isScene ? view.scene : view.equipped?.[slot] ?? 0
  // Scenes you own (free default + bought scene cosmetics) — the pool the "Random scene" tile picks from.
  const ownedScenes = isScene ? [0, ...view.cosmetics.filter((c: number) => SCENES.some((s) => s.id === c))] : []
  const canShuffle = ownedScenes.length >= 2
  // Local styles — keeps the Shop self-contained (no edits to the shared style sheet).
  // sticky so the category strip stays reachable as you scroll a long cosmetic list (bg + blur so cards scroll under it cleanly)
  const navWrap: CSSProperties = { position: 'sticky', top: 'calc(-1 * var(--sp-4))', zIndex: 6, display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 8px', padding: 'var(--sp-2) 0', background: 'rgba(13,13,22,0.92)', backdropFilter: 'blur(6px)', borderBottom: '1px solid var(--c-border)' }
  const pill: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', padding: '5px 11px', borderRadius: 'var(--r-pill)', border: '1px solid var(--c-border)', background: 'var(--c-surface-2)', color: 'var(--c-text-secondary)', cursor: 'pointer' }
  const pillOn: CSSProperties = { border: '1px solid #ffcf6b', color: '#ffcf6b', background: 'rgba(255,207,107,0.10)' }
  const swatch: CSSProperties = { height: 46, borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.10)' }
  const soonPanel: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '44px 20px', borderRadius: 'var(--r-md)', border: '1px dashed var(--c-border-raised)', background: 'var(--c-surface-2)', textAlign: 'center' }
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('shop.title')}</h3>
        <HelpNote id="help.shop"><p style={S.boardDesc}>{tr('shop.desc')}</p></HelpNote>
        <div style={S.shardBank}><span style={S.fluxIcon}>✦</span> {fmt(view.flux)} {tr('shop.fluxAvailable')}</div>
      </div>
      <MascotOverlay family="octahedron" name={tr('shop.mascot.name')} lines={[tr('shop.mascot.line'), tr('shop.mascot.line2'), tr('shop.mascot.line3')]} thanks={tr('shop.mascot.thanks')} bob preview previewScene={pScene} previewAtmosphere={pAtmo} previewFinish={pFinish} />
      {/* category nav — one pill per cosmetic class; coming-soon classes show a teaser */}
      <div style={navWrap}>
        {SHOP_CATEGORIES.map((c, i) => (
          <button key={c.key} onClick={() => setCat(i)} style={{ ...pill, ...(i === cat ? pillOn : {}), opacity: c.comingSoon ? 0.7 : 1 }}>
            <span aria-hidden>{c.icon}</span> {tr(`shop.cat.${c.key}`)}{c.comingSoon ? ' ·' : ''}
          </button>
        ))}
      </div>
      <p style={{ ...S.boardDesc, margin: '0 0 10px', fontSize: 'var(--fs-caption)' }}>{tr(`shop.cat.${category.key}.sub`)}</p>
      {category.comingSoon ? (
        <div style={soonPanel}>
          <div style={{ fontSize: 40, opacity: 0.85 }} aria-hidden>{category.icon}</div>
          <strong style={{ color: '#e8eaf2', fontSize: 'var(--fs-h4)' }}>{tr('shop.comingSoon')}</strong>
          <p style={{ ...S.boardDesc, maxWidth: 380, margin: 0 }}>{tr(`shop.cat.${category.key}.sub`)}</p>
        </div>
      ) : (
        <div style={S.recipeGrid}>
          {isScene && (
            <div className="chip" style={{ ...S.recipeCard, border: '2px dashed #5fe0c6' }}>
              <div style={{ ...swatch, background: 'conic-gradient(from 0deg, #ff5db0, #ffcf6b, #5fe0c6, #9ef0ff, #b985ff, #ff5db0)' }} />
              <div>
                <strong style={{ color: '#e8eaf2' }}>🎲 {tr('shop.scene.random')}</strong>
                <p style={{ ...S.boardDesc, margin: '4px 0 0', fontSize: 'var(--fs-caption)' }}>{tr('shop.scene.randomDesc')}</p>
              </div>
              <button
                className="forge-cap"
                style={{ ...S.forgeBtn, opacity: canShuffle ? 1 : 0.4 }}
                disabled={!canShuffle}
                title={canShuffle ? undefined : tr('shop.scene.randomLocked')}
                onClick={(e) => {
                  const pool = ownedScenes.filter((id) => id !== view.scene)
                  if (!pool.length) return
                  selectScene(pool[Math.floor(Math.random() * pool.length)])
                  sfxUpgrade(2)
                  purchaseBurst(e.currentTarget, { hues: ['#5fe0c6', '#ff5db0', '#ffcf6b'], count: 10, power: 1 })
                }}
              >
                {tr('shop.scene.shuffle')}
              </button>
            </div>
          )}
          {category.items.map((it) => {
            const owned = it.cost === 0 || view.cosmetics.includes(it.id)
            const equipped = equippedId === it.id
            const canBuy = !owned && view.flux >= it.cost
            const pop = () => { setPopped(it.id); setTimeout(() => setPopped((p) => (p === it.id ? null : p)), 460) }
            // Buy: confirm it actually landed (afford check is Rust truth) before firing the celebration — a
            // spark burst in the cosmetic's own colours, a "Name ✓" pop, the card pulse, and a rising chime.
            const buy = (e: { currentTarget: HTMLElement }) => {
              const before = useGame.getState().view?.cosmetics.length ?? 0
              if (isScene) buyCosmetic(it.id, it.cost)
              else buyCosmeticSlot(it.id, slot, it.cost)
              if ((useGame.getState().view?.cosmetics.length ?? 0) <= before) return // couldn't afford
              useMascotCheer.getState().cheer()
              const r = e.currentTarget.getBoundingClientRect()
              sfxUpgrade(it.cost >= 9000 ? 4 : it.cost >= 5000 ? 3 : 2)
              purchaseBurst(e.currentTarget, { hues: it.hues, count: it.cost >= 9000 ? 26 : 18, power: it.cost >= 9000 ? 1.9 : 1.4 })
              useFloaters.getState().spawn(`${it.name} ✓`, { color: it.hues[0], big: it.cost >= 8000, x: r.left + r.width / 2, y: r.top - 4 })
              pop()
            }
            // Equip (free, frequent): a lighter sparkle + soft chime so swapping still feels responsive.
            const equip = (e: { currentTarget: HTMLElement }) => {
              if (isScene) selectScene(it.id)
              else equipCosmeticSlot(it.id, slot)
              sfxUpgrade(2)
              purchaseBurst(e.currentTarget, { hues: it.hues, count: 8, power: 0.85 })
              pop()
            }
            return (
              <div key={it.id} className={popped === it.id ? 'chip upgrade-pop' : 'chip'} onMouseEnter={() => hoverPreview(it.id)} onMouseLeave={() => hoverLeave(it.id)} style={{ ...S.recipeCard, border: `2px solid ${equipped ? '#ffcf6b' : owned ? '#3a3d4f' : '#23252f'}` }}>
                {isScene ? (
                  <Tooltip content={<ScenePreview sceneId={it.id} />} maxWidth={228} trigger="block">
                    <div style={{ ...swatch, background: it.swatch, cursor: 'help' }} />
                  </Tooltip>
                ) : (
                  <div style={{ ...swatch, background: it.swatch }} />
                )}
                <div>
                  <strong style={{ color: '#e8eaf2' }}>{it.name}{equipped ? ' ✓' : ''}</strong>
                  <p style={{ ...S.boardDesc, margin: '4px 0 0', fontSize: 'var(--fs-caption)' }}>{it.desc}</p>
                  {it.detail && <p style={{ margin: '5px 0 0', fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-teal)', lineHeight: 1.4 }}>{it.detail}</p>}
                </div>
                {equipped ? (
                  <button style={{ ...S.forgeBtn, opacity: 0.6 }} disabled>{tr('shop.equipped')}</button>
                ) : owned ? (
                  <button className="forge-cap" style={S.forgeBtn} onClick={equip}>{tr('shop.equip')}</button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button className="pull-cap" style={{ ...S.summonBtn, opacity: canBuy ? 1 : 0.4 }} disabled={!canBuy} onClick={buy}>{tr('shop.buy')} · {fmt(it.cost)} ✦</button>
                    {!canBuy && view.rate_per_hr + view.exp_flux_rate > 0 && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtEta(it.cost - view.flux, view.rate_per_hr + view.exp_flux_rate, tr)}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FluxChart({ data }: { data: number[] }) {
  const tr = useT()
  if (data.length < 2) {
    return <div style={{ ...S.boardIntro, height: 110, display: 'grid', placeItems: 'center', color: '#6b7088', fontSize: 'var(--fs-body-sm)' }}>{tr('ledger.fluxTrendEmpty')}</div>
  }
  const w = 600, h = 120
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (h - 14) - 7])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = `${line} L ${w} ${h} L 0 ${h} Z`
  const last = data[data.length - 1]
  const rising = last >= data[0]
  return (
    // annotated: a caption (what am I looking at?) + the live value with a trend arrow — a bare sparkline reads as décor
    <div style={{ ...S.boardIntro, padding: 0, overflow: 'hidden', position: 'relative' }}>
      <div style={S.fluxChartHead}>
        <span style={S.fluxChartCaption}>{tr('ledger.fluxTrendCaption')}</span>
        <span style={{ ...S.fluxChartNow, color: rising ? '#ffcf6b' : 'var(--c-text-secondary)' }}>✦ {fmt(last)} {rising ? '▲' : '▼'}</span>
      </div>
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

const SESSION_START = Date.now() // module load ≈ app open — drives the "this session" timer

// "2d 5h 12m" / "3h 12m" / "12m 5s" — compact elapsed-time formatter for the Ledger timers.
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function LedgerView() {
  const { view, fluxHistory, milestoneDefs } = useGame()
  const tr = useT()
  const [tab, setTab] = useState<'stats' | 'history'>('stats')
  // a 1s live clock so the timers (time since start, this session) tick while you watch
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!view) return null
  const playMin = Math.max(0, (view.last_seen_ms - view.created_ms) / 60000)
  const playStr = playMin >= 60 ? (playMin / 60).toFixed(1) + 'h' : Math.floor(playMin) + 'm'
  const sinceStart = Math.max(0, now - view.created_ms)
  const sessionMs = Math.max(0, now - SESSION_START)
  const avgPerPull = view.total_pulls > 0 ? view.lifetime_flux / view.total_pulls : 0
  const stat = (label: string, value: string) => (
    <div style={S.statCard}><span style={S.statVal}>{value}</span><span style={S.statLbl}>{label}</span></div>
  )
  // A stat that is PROGRESS toward a cap gets a bar, so "how close" reads pre-attentively (vs parsing "12/30")
  // and the incomplete bar gently pulls (Zeigarnik) — honestly, toward a finite, completable goal.
  const statBar = (label: string, cur: number, max: number, color = '#5fe0c6') => {
    const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0
    return (
      <div style={S.statCard}>
        <span style={S.statVal}>{fmt(cur)}<span style={S.statFrac}>/{fmt(max)}</span></span>
        <span style={S.statLbl}>{label}</span>
        <div style={S.barTrack}><div style={{ ...S.barFill, width: `${pct * 100}%`, background: color }} /></div>
      </div>
    )
  }
  const rarityNames = [tr('rarity.common'), tr('rarity.rare'), tr('rarity.epic'), tr('rarity.ssr'), tr('rarity.ur')]
  // owned scenes = the free default + any owned scene cosmetics (cosmetics now spans all classes; filter to scene ids)
  const scenesOwned = 1 + view.cosmetics.filter((c: number) => SCENES.some((s) => s.id === c)).length
  const corePct = view.distinct_owned / view.pull_count
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>{tr('ledger.title')}</h3>
        <HelpNote id="help.ledger"><p style={S.boardDesc}>{tr('ledger.desc')}</p></HelpNote>
      </div>
      <MascotOverlay family="cube" name={tr('ledger.mascot.name')} lines={[tr('ledger.mascot.line'), tr('ledger.mascot.line2'), tr('ledger.mascot.line3')]} thanks={tr('ledger.mascot.thanks')} />
      {/* HEADLINE — the finite-completion goal front and centre (the game IS completable; make "how far" unmissable) */}
      <div style={S.ledgerHero}>
        <div style={S.heroPct}>{Math.round(corePct * 100)}<span style={{ fontSize: 22, fontWeight: 'var(--fw-bold)' }}>%</span></div>
        <div style={S.heroSub}>
          <div style={S.heroLabel}>{tr('ledger.atlasLit')}</div>
          <div style={S.barTrackLg}><div style={{ ...S.barFillLg, width: `${corePct * 100}%` }} /></div>
          <div style={S.heroMeta}>{view.distinct_owned}/{view.pull_count} {tr('ledger.statCoreShapes')} · NG+{view.ng_cycle} · {tr('ledger.statDimension')} v{view.viewport_dim}</div>
        </div>
      </div>
      <div style={S.ledgerTabs}>
        <button onClick={() => setTab('stats')} style={{ ...S.smallBtn, ...(tab === 'stats' ? S.toggleOn : {}) }}>{tr('ledger.tab.stats')}</button>
        <button onClick={() => setTab('history')} style={{ ...S.smallBtn, ...(tab === 'history' ? S.toggleOn : {}) }}>{tr('ledger.tab.history')}</button>
      </div>
      {tab === 'history' ? <EventLog /> : <>
      <FluxChart data={fluxHistory} />
      <h4 style={S.boardSub}>{tr('ledger.sectionTimers')}</h4>
      <div style={S.statGrid}>
        {stat(tr('ledger.statSinceStart'), fmtDuration(sinceStart))}
        {stat(tr('ledger.statSession'), fmtDuration(sessionMs))}
        {stat(tr('ledger.statPlaytime'), playStr)}
        {stat(tr('ledger.statTotalPulls'), fmt(view.total_pulls))}
      </div>
      <h4 style={S.boardSub}>{tr('ledger.sectionEconomy')}</h4>
      <div style={S.statGrid}>
        {stat(tr('ledger.statFluxNow'), fmt(view.flux))}
        {stat(tr('ledger.statFluxPerHr'), '+' + fmt(view.rate_per_hr))}
        {stat(tr('ledger.statLifetimeFlux'), fmt(view.lifetime_flux))}
        {stat(tr('ledger.statAvgPerPull'), '+' + fmt(avgPerPull))}
        {stat(tr('ledger.statShards'), fmt(view.shards))}
        {stat(tr('ledger.statLifetimeShards'), fmt(view.lifetime_shards))}
        {stat(tr('ledger.statForges'), fmt(view.total_forges))}
      </div>
      {/* Collection — every toward-a-cap stat is a bar; the level/multiplier stats stay as plain numerals */}
      <h4 style={S.boardSub}>{tr('ledger.sectionCollection')}</h4>
      <div style={S.statGrid}>
        {statBar(tr('ledger.statCoreShapes'), view.distinct_owned, view.pull_count, '#ffcf6b')}
        {statBar(tr('rarity.relicsShort'), view.relics_owned, view.relic_count, '#ffd76b')}
        {statBar(tr('forge.recipes.heading'), view.discovered.filter(Boolean).length, view.discovered.length, '#b985ff')}
        {statBar(tr('ledger.statScenes'), scenesOwned, SCENES.length, '#5fe0c6')}
        {statBar(tr('ledger.statFloorSpace'), view.euler_used, view.euler_cap, '#5ad1ff')}
        {stat(tr('ledger.statPrestige'), '×' + view.prestige_mult.toFixed(2))}
        {stat(tr('ledger.statPlatonicSet'), view.platonic_set ? tr('ledger.statComplete') : '—')}
        {stat(tr('ledger.statBondsMaxed'), String(view.bond_levels.filter((b) => b >= 5).length))}
        {stat(tr('ledger.statKinSynergies'), String(view.active_synergies))}
        {stat(tr('ledger.statTotalStars'), '★ ' + fmt(view.total_stars))}
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
              {stat(tr('ledger.statTotalPulls'), fmt(view.total_pulls))}
              {stat(tr('ledger.statSsrPulls'), fmt(topPulls))}
              {stat(tr('ledger.statSsrRate'), view.total_pulls ? ((topPulls / view.total_pulls) * 100).toFixed(1) + '%' : '—')}
              {statBar(tr('ledger.statPityToSsr'), view.pity_since_top, 30, '#ff5d8f')}
              {statBar(tr('ledger.statResonance'), view.resonance, 40, '#ffb86b')}
            </div>
          </>
        )
      })()}

      {(() => {
        const done = view.milestones_done
        const total = view.mult_milestone - 1 // truth from the core, not recomputed
        const got = done.filter(Boolean).length
        const nextIdx = done.findIndex((d) => !d)
        const pct = milestoneDefs.length ? got / milestoneDefs.length : 0
        return (
          <>
            <h4 style={S.boardSub}>{tr('ledger.milestonesHeading')} — {got}/{milestoneDefs.length} · +{Math.round(total * 100)}% {tr('ledger.milestonesProductionSuffix')}</h4>
            <div style={{ ...S.barTrack, marginTop: 4, marginBottom: 'var(--sp-1)' }}><div style={{ ...S.barFill, width: `${pct * 100}%`, background: '#5fe0c6' }} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {milestoneDefs.map((m, i) => {
                const ok = done[i]
                const isNext = i === nextIdx
                const info = MILESTONE_INFO[m.key] ?? { name: m.key, icon: '★' }
                return (
                  <div key={m.key} style={{ ...S.milestoneRow, opacity: ok || isNext ? 1 : 0.55, ...(isNext ? { borderColor: 'var(--c-accent-pink)', boxShadow: '0 0 0 1px var(--c-accent-pink)' } : {}) }}>
                    <span>{ok ? '✅' : isNext ? '➡️' : '🔒'}</span>
                    <span style={{ fontSize: 17 }}>{info.icon}</span>
                    <span style={{ flex: 1, color: ok || isNext ? '#e8eaf2' : '#8a90a8' }}>{info.name}{isNext ? ` · ${tr('ledger.nextUp')}` : ''}</span>
                    <span style={{ color: ok ? '#5fe0c6' : '#6b7088', fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-caption)', whiteSpace: 'nowrap' }}>{milestoneReward(m.kind, m.value)}</span>
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}
      </>}
    </div>
  )
}

function SettingRow({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div style={S.settingRow}>
      <span>
        {label}
        {tip && <Tooltip content={tip}><span style={{ marginInlineStart: 5, opacity: 0.55, cursor: 'help' }}>ⓘ</span></Tooltip>}
      </span>
      {children}
    </div>
  )
}

// An Auto / On / Off override toggle for a tier-derived gfx flag. The "Auto" button shows what it currently
// RESOLVES to at the active quality (e.g. "Auto · On"), so the player can see the effective value.
function GfxTriToggle({ label, value, resolved, onChange, tip }: { label: string; value: boolean | null; resolved: boolean; onChange: (v: boolean | null) => void; tip?: string }) {
  const tr = useT()
  return (
    <SettingRow label={label} tip={tip}>
      <span style={{ display: 'flex', gap: 6 }}>
        {([['auto', null], ['on', true], ['off', false]] as [string, boolean | null][]).map(([k, v]) => (
          <button key={k} onClick={() => onChange(v)} style={{ ...S.toggle, ...(value === v ? S.toggleOn : {}) }}>
            {k === 'auto' ? `${tr('settings.shadows.auto')} · ${resolved ? tr('settings.shadows.on') : tr('settings.shadows.off')}` : tr('settings.shadows.' + k)}
          </button>
        ))}
      </span>
    </SettingRow>
  )
}

// A −/+ stepper for a numeric gfx parameter (path-trace bounces/steps/scale/spp). Shows the effective value
// (preset or override); stepping sets an explicit override, clamped to [min,max].
function GfxStepper({ label, tip, value, min, max, step, fmt, onChange }: { label: string; tip?: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  return (
    <SettingRow label={label} tip={tip}>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button style={S.toggle} onClick={() => onChange(clamp(value - step))}>−</button>
        <span style={{ minWidth: 54, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmt ? fmt(value) : String(value)}</span>
        <button style={S.toggle} onClick={() => onChange(clamp(value + step))}>+</button>
      </span>
    </SettingRow>
  )
}

// Chatlas Plus opt-in: an explicit master consent (default OFF) with an IP/relay disclosure, then two
// independent sub-scopes (events now, chat as a separate secondary opt-in). All device-local; we host nothing.
function ChatlasPlusSettings() {
  const tr = useT()
  const { consent, events, chat, setConsent, setEvents, setChat } = useChatlasPlus()
  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button style={{ ...S.toggle, ...(on ? S.toggleOn : {}) }} onClick={onClick}>
      {on ? tr('settings.toggleOn') : tr('settings.toggleOff')}
    </button>
  )
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--c-border)' }}>
      <p style={S.boardDesc}>{tr('chatlas.plus.desc')}</p>
      <SettingRow label={tr('chatlas.plus.consentLabel')}><Toggle on={consent} onClick={() => setConsent(!consent)} /></SettingRow>
      <p style={S.hint}>{tr('chatlas.plus.consentDisclosure')}</p>
      {consent && (
        <>
          <SettingRow label={tr('chatlas.plus.eventsLabel')}><Toggle on={events} onClick={() => setEvents(!events)} /></SettingRow>
          <p style={S.hint}>{tr('chatlas.plus.eventsHint')}</p>
          <SettingRow label={tr('chatlas.plus.chatLabel')}><Toggle on={chat} onClick={() => setChat(!chat)} /></SettingRow>
          <p style={S.hint}>{tr('chatlas.plus.chatHint')}</p>
          <div style={{ marginTop: 12 }}>
            <div style={{ ...S.hint, marginBottom: 6 }}>{tr('chatlas.plus.youAppearAs')}</div>
            <IdentityEditor />
          </div>
        </>
      )}
    </div>
  )
}

function Attribution() {
  const tr = useT()
  return (
    <div style={{ fontSize: 'var(--fs-caption)', lineHeight: 1.6, color: '#9aa0b4' }}>
      <p style={{ margin: '0 0 4px', color: '#cdd2e0', fontWeight: 'var(--fw-bold)' }}>{tr('attribution.referenceModels')}</p>
      <ul style={S.attrList}>
        <li>{tr('attribution.stanford')}</li>
        <li>{tr('attribution.princeton')}</li>
        <li>{tr('attribution.teapot')}</li>
        <li>{tr('attribution.crane')}</li>
        <li>{tr('attribution.benchy')}</li>
      </ul>
      <p style={{ margin: '8px 0 4px', color: '#cdd2e0', fontWeight: 'var(--fw-bold)' }}>{tr('attribution.builtWith')}</p>
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

// Cosmetics quick-popup — a compact picker reachable from the app bar on ANY tab. Equip owned cosmetics (or
// quick-buy affordable ones) across every class without opening the full Shop, with a live preview of the gem
// reflecting your current loadout's look. Reuses SHOP_CATEGORIES + the same core equip/buy actions as the Shop.
function CosmeticsQuickPopup() {
  const open = useCosmeticsQuick((s) => s.open)
  const setOpen = useCosmeticsQuick((s) => s.setOpen)
  const tr = useT()
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const selectScene = useGame((s) => s.selectScene)
  const equipCosmeticSlot = useGame((s) => s.equipCosmeticSlot)
  const [cat, setCat] = useState(0)
  if (!open || !view) return null
  const category = SHOP_CATEGORIES[cat]
  const isScene = category.slot === 'scene'
  const slot = typeof category.slot === 'number' ? category.slot : -1
  const equippedId = isScene ? view.scene : view.equipped?.[slot] ?? 0
  // live preview gem: the first deployed shape (so it feels like "your" gem), else a flattering default
  const previewSh = shapes[view.loadout?.[0] ?? -1]
  const pf = previewSh?.family ?? 'dodecahedron'
  const pr = previewSh?.rarity ?? 'Ssr'
  const pick = (it: { id: number; cost: number }) => {
    // the quick popup only EQUIPS owned cosmetics — buying happens in the Shop (link at the bottom)
    const owned = it.cost === 0 || view.cosmetics.includes(it.id)
    if (!owned) return
    if (isScene) selectScene(it.id)
    else equipCosmeticSlot(it.id, slot)
    sfxTap()
  }
  const quickCard: CSSProperties = { boxSizing: 'border-box', width: 'min(440px, calc(100vw - 28px))', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-2xl)', padding: 'var(--sp-3)', boxShadow: '0 24px 60px rgba(0,0,0,0.7)' }
  return (
    <div style={S.modal} onClick={() => setOpen(false)}>
      <div className="pop-in" style={quickCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.settingsHead}>
          <strong style={{ fontSize: 'var(--fs-h4)' }}>💎 {tr('cosmeticsQuick.title')}</strong>
          <span style={{ marginInlineStart: 'auto', marginInlineEnd: 10, fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', fontVariantNumeric: 'tabular-nums' }}><span style={S.fluxIcon}>✦</span> {fmt(view.flux)}</span>
          <button style={S.langBtn} onClick={() => setOpen(false)}>✕</button>
        </div>
        {/* live preview — NOT compact, so the equipped scene + atmosphere + finish all show and update on equip */}
        <div style={{ height: 170, borderRadius: 'var(--r-lg)', overflow: 'hidden', background: '#0a0b14' }}>
          <HeroView family={pf} rarity={pr} controls={false} autoRotate spin={0.5} frameloop="always" />
        </div>
        {/* category pills (compact, icon-only) */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SHOP_CATEGORIES.map((c, idx) => (c.comingSoon ? null : (
            <button key={c.key} onClick={() => setCat(idx)} title={tr(`shop.cat.${c.key}`)} aria-label={tr(`shop.cat.${c.key}`)} style={{ ...S.navBtn, ...(idx === cat ? S.navBtnActive : {}), padding: '4px 9px', fontSize: 14 }}>{c.icon}</button>
          )))}
        </div>
        <p style={{ ...S.boardDesc, margin: 0, fontSize: 'var(--fs-caption)' }}>{tr(`shop.cat.${category.key}`)} · {tr(`shop.cat.${category.key}.sub`)}</p>
        {/* swatch grid — click to EQUIP an owned cosmetic. Locked ones are bought in the Shop (link below). */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))', gap: 6 }}>
          {category.items.map((it) => {
            const owned = it.cost === 0 || view.cosmetics.includes(it.id)
            const equipped = equippedId === it.id
            return (
              <button key={it.id} onClick={() => pick(it)} disabled={!owned} title={owned ? it.name : `${it.name} · ${fmt(it.cost)} ✦ · ${tr('cosmeticsQuick.lockedTip')}`}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, padding: 4, borderRadius: 'var(--r-md)', border: `2px solid ${equipped ? 'var(--c-accent-teal)' : 'transparent'}`, background: '#16171f', cursor: owned ? 'pointer' : 'not-allowed', opacity: owned ? 1 : 0.45, textAlign: 'left' }}>
                <div style={{ height: 38, borderRadius: 'var(--r-sm)', border: '1px solid rgba(255,255,255,0.1)', background: it.swatch }} />
                <span style={{ fontSize: 9, lineHeight: 1.1, color: '#cdd2e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{equipped ? '✓ ' : ''}{it.name}</span>
                {!owned && <span style={{ fontSize: 8, color: 'var(--c-text-faint)' }}>🔒 {fmt(it.cost)} ✦</span>}
              </button>
            )
          })}
        </div>
        {/* buying happens in the Shop — this quick popup is equip-only */}
        <button onClick={() => { useNav.getState().goTo('shop'); setOpen(false); sfxTap() }} style={{ ...S.navBtn, justifyContent: 'center', gap: 6, marginTop: 2 }}>
          🛍 {tr('cosmeticsQuick.toShop')}
        </button>
      </div>
    </div>
  )
}

function SettingsModal() {
  const tr = useT()
  const settingsOpen = useGame((s) => s.settingsOpen)
  const setSettingsOpen = useGame((s) => s.setSettingsOpen)
  const sfxMuted = useMute((s) => s.sfxMuted)
  const musicMuted = useMute((s) => s.musicMuted)
  const sfxVol = useMute((s) => s.sfxVol)
  const musicVol = useMute((s) => s.musicVol)
  const toggleSfx = useMute((s) => s.toggleSfx)
  const toggleMusic = useMute((s) => s.toggleMusic)
  const setSfxVol = useMute((s) => s.setSfxVol)
  const setMusicVol = useMute((s) => s.setMusicVol)
  const musicBg = useMute((s) => s.musicWhenUnfocused)
  const sfxBg = useMute((s) => s.sfxWhenUnfocused)
  const toggleMusicBg = useMute((s) => s.toggleMusicWhenUnfocused)
  const toggleSfxBg = useMute((s) => s.toggleSfxWhenUnfocused)
  const musicSource = useMute((s) => s.musicSource)
  const toggleMusicSource = useMute((s) => s.toggleMusicSource)
  const quality = useGfx((s) => s.quality)
  const setQuality = useGfx((s) => s.setQuality)
  const showFps = useGfx((s) => s.showFps)
  const gfxShadows = useGfx((s) => s.shadows)
  const particleScale = useGfx((s) => s.particleScale)
  const starScale = useGfx((s) => s.starScale)
  const gfxBloom = useGfx((s) => s.bloom)
  const gfxGlass = useGfx((s) => s.sceneGlass)
  const gfxBackside = useGfx((s) => s.heroBackside)
  const gfxDof = useGfx((s) => s.dof)
  const gfxSsao = useGfx((s) => s.ssao)
  const gfxHdri = useGfx((s) => s.hdri)
  const gfxPathTrace = useGfx((s) => s.pathTrace)
  const gfxPtQuality = useGfx((s) => s.pathTraceQuality)
  const gfxPtBounces = useGfx((s) => s.ptBounces)
  const gfxPtSteps = useGfx((s) => s.ptSteps)
  const gfxPtScale = useGfx((s) => s.ptScale)
  const gfxPtSpp = useGfx((s) => s.ptSpp)
  const gfxPtHaze = useGfx((s) => s.ptHaze)
  const gfxPtEnvCube = useGfx((s) => s.ptEnvCube)
  const gfxPtEnvCubeRes = useGfx((s) => s.ptEnvCubeRes)
  const gfxPtEnvCubeAmt = useGfx((s) => s.ptEnvCubeAmt)
  const gfxMeshPtCycle = useGfx((s) => s.meshPtCycle)
  const gfxUpdate = useGfx((s) => s.update)
  const ptP = PT_PRESETS[gfxPtQuality] // preset the params fall back to
  const preset = presetFor(quality) // what each "Auto" override resolves to at the active quality
  const [tab, setTab] = useState<'graphics' | 'gameplay' | 'audio' | 'title' | 'data' | 'keybinds' | 'attribution'>('graphics')
  const [audioSub, setAudioSub] = useState<'mix' | 'engine'>('mix')
  const settingsTab = useGame((s) => s.settingsTab)
  // deep-link: opening Settings with a target tab (e.g. clicking "now playing" → audio) jumps straight there
  useEffect(() => {
    if (settingsTab) setTab(settingsTab as typeof tab)
  }, [settingsTab])
  if (!settingsOpen) return null
  const tabs: typeof tab[] = ['graphics', 'gameplay', 'audio', 'title', 'data', 'keybinds', 'attribution']
  return (
    <div style={S.modal} onClick={() => setSettingsOpen(false)}>
      <div className="pop-in" style={S.settingsCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.settingsHead}>
          <strong style={{ fontSize: 'var(--fs-h3)' }}>{tr('settings.title')}</strong>
          <span style={{ marginInlineStart: 'auto', marginInlineEnd: 10, fontSize: 'var(--fs-caption)', color: 'var(--c-text-faint)', fontVariantNumeric: 'tabular-nums' }} title={tr('settings.versionTip')}>v{__APP_VERSION__}</span>
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
          {tab === 'audio' && (
            <>
              <div style={{ ...S.settingsTabs, marginBottom: 'var(--sp-2)' }}>
                {(['mix', 'engine'] as const).map((s) => (
                  <button key={s} onClick={() => setAudioSub(s)} style={{ ...S.navBtn, ...(audioSub === s ? S.navBtnActive : {}) }}>
                    {tr(s === 'mix' ? 'settings.audioMix' : 'settings.audioEngine')}
                  </button>
                ))}
              </div>
              {audioSub === 'mix' ? (
                <>
                  <SettingRow label={tr('settings.soundEffectsLabel')}><button style={{ ...S.toggle, ...(sfxMuted ? {} : S.toggleOn) }} onClick={toggleSfx}>{sfxMuted ? tr('settings.toggleOff') : tr('settings.toggleOn')}</button></SettingRow>
                  <SettingRow label={tr('settings.sfxVolumeLabel')}>
                    <input className="range-mix" type="range" min={0} max={1} step={0.05} value={sfxVol} disabled={sfxMuted} aria-label={tr('settings.sfxVolumeLabel')} onChange={(e) => setSfxVol(Number(e.target.value))} style={{ width: 140, opacity: sfxMuted ? 0.4 : 1 }} />
                  </SettingRow>
                  <SettingRow label={tr('settings.musicLabel')}><button style={{ ...S.toggle, ...(musicMuted ? {} : S.toggleOn) }} onClick={toggleMusic}>{musicMuted ? tr('settings.toggleOff') : tr('settings.toggleOn')}</button></SettingRow>
                  <SettingRow label={tr('settings.musicVolumeLabel')}>
                    <input className="range-mix" type="range" min={0} max={1} step={0.05} value={musicVol} disabled={musicMuted} aria-label={tr('settings.musicVolumeLabel')} onChange={(e) => setMusicVol(Number(e.target.value))} style={{ width: 140, opacity: musicMuted ? 0.4 : 1 }} />
                  </SettingRow>
                  <SettingRow label={tr('settings.bgMusicLabel')} tip={tr(musicBg ? 'transport.bgOn' : 'transport.bgOff')}><button style={{ ...S.toggle, ...(musicBg ? S.toggleOn : {}) }} onClick={toggleMusicBg}>{musicBg ? tr('settings.toggleOn') : tr('settings.toggleOff')}</button></SettingRow>
                  <SettingRow label={tr('settings.musicSourceLabel')} tip={tr(musicSource === 'library' ? 'transport.sourceLibraryTip' : 'transport.sourceOrreryTip')}><button style={{ ...S.toggle, ...(musicSource === 'library' ? S.toggleOn : {}) }} onClick={toggleMusicSource}>{tr(musicSource === 'library' ? 'settings.musicSourceLibrary' : 'settings.musicSourceOrrery')}</button></SettingRow>
                  <SettingRow label={tr('settings.bgSfxLabel')}><button style={{ ...S.toggle, ...(sfxBg ? S.toggleOn : {}) }} onClick={toggleSfxBg}>{sfxBg ? tr('settings.toggleOn') : tr('settings.toggleOff')}</button></SettingRow>
                  <CeremonyToggle />
                  <p style={S.hint}>{tr('settings.bgHint')}</p>
                  <p style={S.hint}>{tr('settings.audioHint')}</p>
                  <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 'var(--sp-2)', paddingTop: 'var(--sp-2)' }}>
                    <MusicStylesSettings />
                  </div>
                </>
              ) : (
                <MusicEngineInspector />
              )}
            </>
          )}
          {tab === 'graphics' && (
            <>
              <SettingRow label={tr('settings.graphicsQualityLabel')} tip={tr('settings.tip.quality')}>
                <span style={{ display: 'flex', gap: 6 }}>
                  {(['low', 'medium', 'high'] as Quality[]).map((q) => (
                    <button key={q} onClick={() => setQuality(q)} style={{ ...S.toggle, ...(quality === q ? S.toggleOn : {}) }}>
                      {tr('settings.quality' + q[0].toUpperCase() + q.slice(1))}
                    </button>
                  ))}
                </span>
              </SettingRow>
              <p style={S.hint}>{tr('settings.qualityHint')}</p>
              {/* finer-grained overrides on top of the preset */}
              <SettingRow label={tr('settings.fpsLabel')} tip={tr('settings.tip.fps')}>
                <button onClick={() => gfxUpdate({ showFps: !showFps })} style={{ ...S.toggle, ...(showFps ? S.toggleOn : {}) }}>
                  {showFps ? tr('settings.on') : tr('settings.off')}
                </button>
              </SettingRow>
              <GfxTriToggle label={tr('settings.shadowsLabel')} tip={tr('settings.tip.shadows')} value={gfxShadows} resolved={preset.shadows} onChange={(v) => gfxUpdate({ shadows: v })} />
              <SettingRow label={tr('settings.particlesLabel')} tip={tr('settings.tip.particles')}>
                <span style={{ display: 'flex', gap: 6 }}>
                  {([['off', 0], ['low', 0.5], ['full', 1], ['max', 1.5]] as [string, number][]).map(([k, v]) => (
                    <button key={k} onClick={() => gfxUpdate({ particleScale: v })} style={{ ...S.toggle, ...(particleScale === v ? S.toggleOn : {}) }}>
                      {tr('settings.density.' + k)}
                    </button>
                  ))}
                </span>
              </SettingRow>
              <SettingRow label={tr('settings.starsLabel')} tip={tr('settings.tip.stars')}>
                <span style={{ display: 'flex', gap: 6 }}>
                  {([['off', 0], ['low', 0.5], ['full', 1], ['max', 1.5]] as [string, number][]).map(([k, v]) => (
                    <button key={k} onClick={() => gfxUpdate({ starScale: v })} style={{ ...S.toggle, ...(starScale === v ? S.toggleOn : {}) }}>
                      {tr('settings.density.' + k)}
                    </button>
                  ))}
                </span>
              </SettingRow>
              {/* HQ render features — "Auto" follows the quality preset and shows what it resolves to; On/Off override */}
              <GfxTriToggle label={tr('settings.bloomLabel')} tip={tr('settings.tip.bloom')} value={gfxBloom} resolved={preset.bloom} onChange={(v) => gfxUpdate({ bloom: v })} />
              <GfxTriToggle label={tr('settings.sceneGlassLabel')} tip={tr('settings.tip.glass')} value={gfxGlass} resolved={preset.sceneGlass} onChange={(v) => gfxUpdate({ sceneGlass: v })} />
              <GfxTriToggle label={tr('settings.doubleRefractionLabel')} tip={tr('settings.tip.doubleRefraction')} value={gfxBackside} resolved={preset.heroBackside} onChange={(v) => gfxUpdate({ heroBackside: v })} />
              <GfxTriToggle label={tr('settings.dofLabel')} tip={tr('settings.tip.dof')} value={gfxDof} resolved={preset.dof} onChange={(v) => gfxUpdate({ dof: v })} />
              <GfxTriToggle label={tr('settings.ssaoLabel')} tip={tr('settings.tip.ssao')} value={gfxSsao} resolved={preset.ssao} onChange={(v) => gfxUpdate({ ssao: v })} />
              <GfxTriToggle label={tr('settings.hdriLabel')} tip={tr('settings.tip.hdri')} value={gfxHdri} resolved={preset.hdri} onChange={(v) => gfxUpdate({ hdri: v })} />
              <SettingRow label={tr('settings.pathTraceLabel')} tip={tr('settings.tip.pathTrace')}>
                <span style={{ display: 'flex', gap: 6 }}>
                  {(['off', 'hero', 'all'] as PathTraceScope[]).map((sc) => (
                    <button key={sc} onClick={() => gfxUpdate({ pathTrace: sc })} style={{ ...S.toggle, ...(gfxPathTrace === sc ? S.toggleOn : {}) }}>
                      {tr('settings.pathTrace.' + sc)}
                    </button>
                  ))}
                </span>
              </SettingRow>
              {gfxPathTrace !== 'off' && (
                <>
                  <SettingRow label={tr('settings.pathTraceQualityLabel')} tip={tr('settings.tip.pathTraceQuality')}>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(['low', 'medium', 'high', 'extreme', 'ultra', 'max'] as PathTraceQuality[]).map((qq) => (
                        // picking a preset reseeds all four params (clears overrides)
                        <button key={qq} onClick={() => gfxUpdate({ pathTraceQuality: qq, ptBounces: null, ptSteps: null, ptScale: null, ptSpp: null })} style={{ ...S.toggle, ...(gfxPtQuality === qq ? S.toggleOn : {}) }}>
                          {tr('settings.quality' + qq[0].toUpperCase() + qq.slice(1))}
                        </button>
                      ))}
                    </span>
                  </SettingRow>
                  <p style={S.hint}>{tr('settings.pathTraceHint')}</p>
                  {/* per-param overrides — seeded by the preset, individually tunable */}
                  <GfxStepper label={tr('settings.pt.bounces')} tip={tr('settings.tip.ptBounces')} value={gfxPtBounces ?? ptP.bounces} min={1} max={12} step={1} onChange={(v) => gfxUpdate({ ptBounces: v })} />
                  <GfxStepper label={tr('settings.pt.steps')} tip={tr('settings.tip.ptSteps')} value={gfxPtSteps ?? ptP.steps} min={16} max={192} step={8} onChange={(v) => gfxUpdate({ ptSteps: v })} />
                  <GfxStepper label={tr('settings.pt.scale')} tip={tr('settings.tip.ptScale')} value={gfxPtScale ?? ptP.scale} min={0.25} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => gfxUpdate({ ptScale: v })} />
                  <GfxStepper label={tr('settings.pt.spp')} tip={tr('settings.tip.ptSpp')} value={gfxPtSpp ?? ptP.spp} min={1} max={64} step={1} onChange={(v) => gfxUpdate({ ptSpp: v })} />
                  <GfxStepper label={tr('settings.pt.haze')} tip={tr('settings.tip.ptHaze')} value={gfxPtHaze} min={0} max={0.25} step={0.02} fmt={(v) => (v <= 0 ? tr('settings.off') : v.toFixed(2))} onChange={(v) => gfxUpdate({ ptHaze: v })} />
                  <SettingRow label={tr('settings.pt.envCube')} tip={tr('settings.tip.ptEnvCube')}><button style={{ ...S.toggle, ...(gfxPtEnvCube ? S.toggleOn : {}) }} onClick={() => gfxUpdate({ ptEnvCube: !gfxPtEnvCube })}>{gfxPtEnvCube ? tr('settings.toggleOn') : tr('settings.toggleOff')}</button></SettingRow>
                  {gfxPtEnvCube && <GfxStepper label={tr('settings.pt.envCubeRes')} tip={tr('settings.tip.ptEnvCubeRes')} value={gfxPtEnvCubeRes} min={64} max={256} step={64} fmt={(v) => `${v}px`} onChange={(v) => gfxUpdate({ ptEnvCubeRes: v })} />}
                  {gfxPtEnvCube && <GfxStepper label={tr('settings.pt.envCubeAmt')} tip={tr('settings.tip.ptEnvCubeAmt')} value={gfxPtEnvCubeAmt} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => gfxUpdate({ ptEnvCubeAmt: v })} />}
                  <SettingRow label={tr('settings.pt.meshCycle')} tip={tr('settings.tip.ptMeshCycle')}><button style={{ ...S.toggle, ...(gfxMeshPtCycle ? S.toggleOn : {}) }} onClick={() => gfxUpdate({ meshPtCycle: !gfxMeshPtCycle })}>{gfxMeshPtCycle ? tr('settings.toggleOn') : tr('settings.toggleOff')}</button></SettingRow>
                </>
              )}
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
              <ChatlasPlusSettings />
            </>
          )}
          {tab === 'title' && <TitleArtSettings />}
          {tab === 'data' && <DataSettings />}
          {tab === 'keybinds' && (
            <div style={{ fontSize: 'var(--fs-body-sm)', color: '#cdd2e0' }}>
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
      <span style={{ fontSize: 'var(--fs-h1)' }}>{info.icon}</span>
      <div>
        <div style={{ color: '#ffd76b', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-eyebrow)', letterSpacing: 0.6 }}>{tr('milestone.toastBanner')}</div>
        <div style={{ color: '#e8eaf2', fontSize: 'var(--fs-body-sm)' }}>{info.name}</div>
      </div>
      <span style={{ marginLeft: 'auto', color: '#5fe0c6', fontWeight: 'var(--fw-heavy)', whiteSpace: 'nowrap' }}>{def ? milestoneReward(def.kind, def.value) : ''}</span>
      <div className="toast-drain" style={S.toastDrain} />
    </div>
  )
}

// One-line, self-dismissing notice when the FPS watchdog auto-lowers graphics (fires at most once per session).
function WatchdogToast() {
  const msgId = useGfx((s) => s.watchdogToast)
  const dismiss = useGfx((s) => s.dismissWatchdog)
  const tr = useT()
  useEffect(() => {
    if (!msgId) return
    const t = setTimeout(dismiss, 4200)
    return () => clearTimeout(t)
  }, [msgId, dismiss])
  if (!msgId) return null
  return (
    <div className="pop-in" style={S.watchdogToast} onClick={dismiss}>
      <span style={{ color: '#e8eaf2', fontSize: 'var(--fs-body-sm)' }}>{tr(msgId)}</span>
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
                <strong style={{ color: e.color, fontSize: 'var(--fs-caption)' }}>{e.nick}</strong>
                <p style={{ ...S.shipText, margin: '2px 0 0', fontSize: 'var(--fs-body-sm)', fontStyle: 'normal' }}>{e.line}</p>
              </div>
            ))
          )}
        </div>
        <button className="btn-primary" style={S.pullBtn} onClick={() => setOpen(false)}>{tr('dialogLog.close')}</button>
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
            <span style={{ color: speakerA ? aCol : '#7b8198', fontWeight: 'var(--fw-bold)', transition: 'color .2s' }}>{a?.nick}</span>
            <span style={{ color: '#ff5d8f' }}>♥</span>
            <span style={{ color: speakerA ? '#7b8198' : bCol, fontWeight: 'var(--fw-bold)', transition: 'color .2s' }}>{b?.nick}</span>
          </div>
        </div>
        {showLog ? (
          <div style={S.logBox}>
            {ship.lines.slice(0, i + 1).map((ln, j) => (
              <div key={j} style={{ marginBottom: 9 }}>
                <strong style={{ color: colOf(ln.who), fontSize: 'var(--fs-caption)' }}>{speakerOf(ln.who)?.nick}</strong>
                <p style={{ ...S.shipText, margin: '2px 0 0', fontSize: 'var(--fs-body-sm)', fontFamily: fontOf(ln.who === 'a' ? ship.a : ship.b) }}>{ln.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <div style={S.shipLineBox}>
            <strong style={{ color: speakerA ? aCol : bCol }}>{speakerA ? a?.nick : b?.nick}</strong>
            <p style={{ ...S.shipText, fontFamily: fontOf(speakerA ? ship.a : ship.b) }}>{line.text}</p>
          </div>
        )}
        <button className="btn-primary" style={S.pullBtn} onClick={() => (showLog ? setShowLog(false) : advance())}>{showLog ? tr('ship.resume') : last ? tr('ship.close') : tr('ship.next')}</button>
        <div style={S.shipDots}>{ship.lines.map((_, j) => <span key={j} style={{ ...S.shipDot, opacity: j === i ? 1 : 0.3 }} />)}</div>
      </div>
    </div>
  )
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
  app: { background: 'var(--c-bg-base)', color: 'var(--c-text)', height: '100dvh', overflow: 'hidden', fontFamily: 'var(--font-app)', display: 'flex', flexDirection: 'column' },
  // 3-column grid: equal 1fr sides keep the auto middle column (the wordmark) truly viewport-centered, so it can
  // never overlap the flux block (left) or stats (right) no matter how wide they grow. Below 1180px the wordmark
  // hides (juice.css media query) and the empty middle column collapses, leaving flux-left / stats-right.
  hud: { position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', padding: '12px 20px', gap: 'var(--sp-2)', background: 'linear-gradient(180deg, #16131a 0%, #100f17 100%), linear-gradient(180deg, rgba(255,207,107,0.06), transparent)', borderBottom: '1px solid #2c2f3c', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4)' },
  fluxLabel: { color: 'var(--c-text-dim)', marginRight: 'var(--sp-2)', fontSize: 'var(--fs-body-sm)' },
  // inline-block + reserved min-width + right-align: digits fill the box (tabular, equal-width) instead of
  // widening it, so the +rate/hr label beside it never gets pushed as Flux climbs.
  fluxValue: { display: 'inline-block', minWidth: '7ch', textAlign: 'right', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 'var(--fs-display)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-accent-gold-bright)', fontVariantNumeric: 'oldstyle-nums tabular-nums', textShadow: '0 0 14px rgba(255,207,107,0.35)' },
  rate: { color: 'var(--c-accent-teal)', marginLeft: 'var(--sp-2_5)', fontSize: 'var(--fs-body-sm)' },
  nowPlaying: { display: 'inline-flex', alignItems: 'baseline', gap: 6, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: 'var(--fs-caption)', color: 'var(--c-accent-teal)', opacity: 0.92, cursor: 'pointer', border: 'none', background: 'transparent', padding: 0 },
  musicTransport: { display: 'inline-flex', alignItems: 'center', gap: 1 },
  transportBtn: { background: 'none', border: 'none', color: 'var(--c-text-dim)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '3px 3px', borderRadius: 'var(--r-sm)' },
  hudStats: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 'var(--sp-3)', rowGap: 'var(--sp-1_5)', fontSize: 'var(--fs-body-sm)', color: '#aab', alignItems: 'center', minWidth: 0 },
  langSwitch: { display: 'flex', gap: 'var(--sp-1)' },
  // styled native <select>: native arrow stripped, our own chevron painted as a background SVG; matches langBtn.
  langSelect: {
    appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    background: `var(--c-surface-3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M1 2.5 4 5.5 7 2.5' fill='none' stroke='%238a90a8' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 7px center`,
    border: '1px solid var(--c-border-raised)', borderRadius: 'var(--r-md)', color: 'var(--c-text-secondary)',
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', padding: '4px 22px 4px 9px', cursor: 'pointer',
  },
  langBtn: { ...CAP, color: 'var(--c-text-muted)', borderRadius: 'var(--r-sm)', padding: '2px 7px', fontSize: 'var(--fs-eyebrow)' },
  langBtnOn: { background: 'var(--c-surface-6)', color: 'var(--c-text-bright)', borderColor: 'var(--c-accent-teal)' },
  navRail: { flexShrink: 0, background: 'linear-gradient(180deg,#15161f,#0e0f17)', boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.5)', borderBottom: '1px solid #20222e' },
  navBtn: { background: 'none', border: 'none', color: 'var(--c-text-dim)', padding: '8px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 'var(--fs-body)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1_5)', flexShrink: 0, whiteSpace: 'nowrap' },
  navBtnActive: { background: 'linear-gradient(180deg, #262a3e, #1b1e2c)', color: 'var(--c-text-bright)', border: '1px solid #34384a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -3px 0 -1px #5fe0c6, 0 2px 4px rgba(0,0,0,0.4)' },
  navBtnImportant: { color: 'var(--c-accent-teal-soft)', background: 'rgba(95,224,198,0.10)', boxShadow: 'inset 0 0 0 1px rgba(95,224,198,0.5), inset 0 1px 0 rgba(255,255,255,0.06)', fontWeight: 'var(--fw-bold)' },
  main: { flex: 1, minHeight: 0, padding: 'var(--sp-4)', overflow: 'auto', display: 'flex', flexDirection: 'column' },
  tabFill: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, // full-height stage tabs (orrery/room)
  gacha: { maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3_5)' },
  stageWrap: { position: 'relative', height: 340, borderRadius: 'var(--r-3xl)', overflow: 'hidden', background: 'var(--c-bg-stage)', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  focusName: { position: 'absolute', bottom: 'var(--sp-2_5)', left: 0, right: 0, textAlign: 'center', fontSize: 'var(--fs-h2)', fontWeight: 'var(--fw-medium)', pointerEvents: 'none' },
  focusFam: { color: 'var(--c-text-dim)', fontStyle: 'normal', fontWeight: 'var(--fw-regular)', fontSize: 'var(--fs-body-sm)' },
  secretaryTag: { color: 'var(--c-accent-gold-deep)', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)' },
  effectPreview: { position: 'absolute', top: 'var(--sp-2_5)', right: 'var(--sp-2_5)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1_5)', background: 'rgba(16,17,25,0.82)', border: '1px solid #2a2c3a', borderRadius: 'var(--r-pill)', padding: '6px 12px', fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)', cursor: 'pointer', backdropFilter: 'blur(4px)', maxWidth: 'calc(100% - 20px)' },
  // pull-screen rate-up shape detail chips
  featRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' },
  featLabel: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-coral)', fontWeight: 'var(--fw-bold)', marginRight: 'var(--sp-0_5)' },
  featChip: { display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', background: 'var(--c-surface-3)', border: '1px solid var(--c-border-raised)', borderRadius: 'var(--r-pill)', padding: '3px 9px', color: 'var(--c-text-secondary)', fontSize: 'var(--fs-caption)', cursor: 'pointer' },
  featChipNick: { fontWeight: 'var(--fw-bold)', color: 'var(--c-text)' },
  bannerRow: { display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' },
  bannerCard: { ...VITRINE, flex: 1, textAlign: 'left', borderRadius: 'var(--r-lg)', padding: '8px 10px', cursor: 'pointer', color: 'var(--c-text-secondary)' },
  bannerCardOn: { borderColor: 'var(--c-accent-teal)', background: '#16201f', boxShadow: 'inset 0 -2px 0 #5fe0c6' },
  bannerName: { fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', color: 'var(--c-text)', marginBottom: 'var(--sp-1)' },
  bannerRotate: { color: 'var(--c-accent-coral)', fontSize: 'var(--fs-micro)', fontWeight: 'var(--fw-heavy)' },
  bannerTimer: { marginTop: 'var(--sp-1)', fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-coral)', fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-bold)', letterSpacing: 0.3 },
  bannerFeat: { display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', minHeight: 18 },
  talkBtn: { position: 'absolute', bottom: 'var(--sp-2)', right: 'var(--sp-2)', zIndex: 4, background: 'rgba(20,40,44,0.85)', border: '1px solid #2f6b6a', color: 'var(--c-accent-teal-bright)', borderRadius: 'var(--r-pill)', padding: '5px 12px', fontSize: 'var(--fs-h4)', cursor: 'pointer' },
  bubble: { position: 'absolute', top: 'var(--sp-3)', left: '50%', transform: 'translateX(-50%)', maxWidth: '88%', background: 'rgba(18,19,28,0.97)', border: '1px solid #3a3d4f', borderRadius: 'var(--r-2xl)', padding: '9px 14px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--c-text)', zIndex: 6, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.5)' },
  bubbleNick: { fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', marginBottom: 'var(--sp-0_5)' },
  pitymeters: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)' },
  oddsBtn: { alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--c-text-dim)', fontSize: 'var(--fs-caption)', cursor: 'pointer', padding: '2px 0', textDecoration: 'underline', textUnderlineOffset: 2 },
  oddsSub: { margin: '0 0 var(--sp-1) 0', fontSize: 'var(--fs-eyebrow)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--c-text-dim)' },
  oddsTable: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', marginBottom: 'var(--sp-3)' },
  oddsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-secondary)', padding: '3px 0', borderBottom: '1px solid var(--c-hairline)' },
  oddsNotes: { margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)', fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', lineHeight: 1.4 },
  oddsFeatured: { marginTop: 'var(--sp-2_5)', padding: 'var(--sp-2)', borderRadius: 'var(--r-md)', background: 'rgba(255,157,107,0.10)', border: '1px solid rgba(255,157,107,0.3)', fontSize: 'var(--fs-caption)', color: 'var(--c-accent-coral)' },
  meter: { display: 'flex', flexDirection: 'column', gap: 3 },
  meterLabel: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-muted)' },
  meterTrack: { height: 7, background: 'linear-gradient(180deg, #15161e, #1f2230)', border: '1px solid rgba(0,0,0,0.5)', borderRadius: 'var(--r-xs)', overflow: 'hidden', boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(120,130,160,0.10), 0 1px 0 rgba(255,255,255,0.03)' },
  meterFill: { height: '100%', borderRadius: 'var(--r-xs)', transition: 'width 0.3s', boxShadow: '0 0 6px 0 currentColor, inset 0 1px 0 rgba(255,255,255,0.4)' },
  pullRow: { display: 'flex', gap: 'var(--sp-2_5)' },
  pullBtn: { flex: 1, background: 'linear-gradient(180deg, #ff7ba6 0%, #ff5d8f 38%, #c264e6 78%, #a94fd6 100%)', border: 'none', color: 'var(--c-text-bright)', padding: '14px', borderRadius: 'var(--r-xl)', fontSize: 'var(--fs-h3)', fontWeight: 'var(--fw-heavy)', cursor: 'pointer', textShadow: '0 1px 1px rgba(80,0,40,0.5)', boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(120,0,70,0.45), 0 4px 10px rgba(255,93,143,0.4), 0 2px 4px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,180,210,0.3)' },
  pullBtn10: { flex: 1, background: 'linear-gradient(180deg, #1a1c28, #121420)', border: '1px solid #ff5d8f', color: 'var(--c-accent-pink-light)', padding: '14px', borderRadius: 'var(--r-xl)', fontSize: 'var(--fs-h3)', fontWeight: 'var(--fw-heavy)', cursor: 'pointer', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 12px rgba(255,93,143,0.18), inset 0 -2px 4px rgba(0,0,0,0.5), 0 3px 7px rgba(0,0,0,0.45), 0 0 8px rgba(255,93,143,0.22)' },
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
  chatHandle: { fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)' },
  chatText: { fontSize: 13.5, color: 'var(--c-text-secondary)', lineHeight: 1.45 },
  chatSticker: { width: 132, height: 'auto', borderRadius: 'var(--r-md)', marginTop: 'var(--sp-1)' },
  stickerBar: { display: 'flex', gap: 'var(--sp-1_5)', overflowX: 'auto', padding: '10px 4px 2px', marginTop: 'var(--sp-1)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent)', maskImage: 'linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent)' },
  stickerPick: { ...CAP, flex: '0 0 auto', width: 54, height: 54, padding: 3, borderRadius: 'var(--r-lg)' },
  // Chatlas Plus
  plusCard: { ...VITRINE, borderRadius: 'var(--r-xl)', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  plusStatus: { ...VITRINE, borderRadius: 'var(--r-lg)', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  plusRoster: { display: 'flex', gap: 'var(--sp-1_5)', flexWrap: 'wrap', alignItems: 'center', padding: '2px 2px 0' },
  plusDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block' },
  idChip: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', padding: '3px 9px', borderRadius: 999, background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-secondary)', whiteSpace: 'nowrap' },
  reactBtn: { background: 'none', border: 'none', color: 'var(--c-accent-pink)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', opacity: 0.7 },
  chatInput: { flex: 1, minWidth: 0, background: 'var(--c-surface-0)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', padding: '8px 12px', color: 'var(--c-text)', fontSize: 'var(--fs-body-sm)', outline: 'none' },
  unreadDot: { position: 'absolute', top: 1, right: 1, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999, background: 'var(--c-accent-teal)', color: '#08110f', boxSizing: 'border-box', fontSize: 9.5, fontWeight: 'var(--fw-heavy)', lineHeight: '15px', textAlign: 'center', boxShadow: '0 0 8px rgba(95,224,198,0.6)' },
  subTabs: { display: 'flex', gap: 'var(--sp-1_5)', marginTop: 'var(--sp-1)' },
  subTab: { ...VITRINE, flex: 1, color: 'var(--c-text-dim)', borderRadius: 'var(--r-md)', padding: '7px 10px', cursor: 'pointer', fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-bold)' },
  subTabOn: { background: '#23263a', color: 'var(--c-text-bright)', borderColor: 'var(--c-accent-teal)' },
  histList: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', maxHeight: 340, overflowY: 'auto', marginTop: 'var(--sp-1)' },
  histRow: { ...VITRINE, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', borderRadius: 'var(--r-md)', padding: '7px 10px', fontSize: 13.5 },
  histTime: { color: 'var(--c-text-faint)', fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  ledgerTabs: { display: 'flex', gap: 'var(--sp-1_5)', margin: 'var(--sp-3) 0 var(--sp-1)' },
  rankBadge: { display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', background: 'linear-gradient(180deg, #1a1b24, #101119)', border: '1px solid #3a3320', borderRadius: 'var(--r-xl)', padding: '6px 12px 6px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(255,207,107,0.12), 0 2px 5px rgba(0,0,0,0.4)' },
  rankLetter: { fontSize: 19, lineHeight: 1, fontWeight: 'var(--fw-black)', border: '2px solid', borderRadius: 9, minWidth: 34, height: 34, padding: '1px 4px 0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  multGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--sp-1_5)', marginBottom: 'var(--sp-2_5)' },
  multRow: { ...VITRINE, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 'var(--r-md)', padding: '6px 10px' },
  engine: { maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  engineHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' },
  engineBtns: { display: 'flex', gap: 'var(--sp-2)' },
  smallBtn: { ...CAP, padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-body-sm)' },
  engineList: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)' },
  engineRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', background: 'var(--c-surface-2)', border: '1px solid', borderRadius: 'var(--r-lg)', padding: '8px 12px' },
  engineNick: { fontWeight: 'var(--fw-medium)' },
  engineCost: { color: 'var(--c-text-dim)', fontSize: 'var(--fs-caption)', marginLeft: 'auto', marginRight: 'var(--sp-2_5)' },
  toggle: { ...CAP, padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-body-sm)' },
  toggleOn: { background: 'var(--c-surface-6)', borderColor: 'var(--c-accent-teal)' },
  modal: { position: 'fixed', inset: 0, background: 'radial-gradient(circle at 50% 40%, rgba(10,10,20,0.55), rgba(3,3,8,0.9))', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 10, padding: 'var(--sp-4)' },
  revealCard: { boxSizing: 'border-box', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-4xl)', padding: 'var(--sp-6)', textAlign: 'center', maxWidth: 420, width: '100%', maxHeight: 'calc(100dvh - 2 * var(--sp-4))', overflowY: 'auto', overflowX: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  revealStage: { height: 280, borderRadius: 'var(--r-xl)', overflow: 'hidden', marginBottom: 'var(--sp-2_5)', background: 'var(--c-bg-stage)', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  inspNav: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 5, width: 36, height: 36, borderRadius: '50%', background: 'rgba(20,28,44,0.85)', border: '1px solid #3a4668', color: 'var(--c-text)', fontSize: 24, lineHeight: 1, paddingBottom: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  inspNavRow: { flexShrink: 0, width: 38, height: 38, borderRadius: '50%', background: 'var(--c-surface-3)', border: '1px solid var(--c-border)', color: 'var(--c-text-secondary)', fontSize: 24, lineHeight: 1, paddingBottom: 3, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  revealSub: { color: '#aab', margin: '4px 0 14px' },
  inspectClose: { position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-2)', zIndex: 7, width: 30, height: 30, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(14,16,24,0.7)', border: '1px solid var(--c-border)', color: 'var(--c-text-dim)', fontSize: 14, lineHeight: 1, cursor: 'pointer', backdropFilter: 'blur(2px)' },
  revealCount: { position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-3)', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', color: 'var(--c-text-dim)', letterSpacing: 0.5, fontVariantNumeric: 'tabular-nums' },
  revealDialog: { margin: '-6px auto 16px', maxWidth: 340, padding: '10px 14px', borderRadius: 'var(--r-lg)', background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-secondary)', fontStyle: 'italic', fontSize: 'var(--fs-body-sm)', lineHeight: 1.4 },
  revealStats: { display: 'flex', justifyContent: 'center', gap: 'var(--sp-1_5)', flexWrap: 'wrap', margin: '0 auto 14px', maxWidth: 380 },
  revealStat: { ...VITRINE, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', borderRadius: 'var(--r-md)', padding: '6px 10px', minWidth: 88 },
  revealStatVal: { fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--c-text)', whiteSpace: 'nowrap' },
  revealStatLbl: { fontSize: 'var(--fs-eyebrow)', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--c-text-dim)' },
  revealSkip: { display: 'block', margin: '8px auto 0', background: 'none', border: 'none', color: 'var(--c-text-dim)', cursor: 'pointer', fontSize: 'var(--fs-caption)', textDecoration: 'underline', textUnderlineOffset: 2 },
  revealRow: { display: 'flex', justifyContent: 'center', gap: 'var(--sp-1_5)', marginBottom: 'var(--sp-3_5)', flexWrap: 'wrap' },
  chargeWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-6)' },
  chargeHint: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', letterSpacing: 0.5 },
  haulGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', justifyItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' },
  haulTile: { position: 'relative', width: '100%', maxWidth: 50, aspectRatio: '1', borderRadius: 10, border: '2px solid', display: 'grid', placeItems: 'center', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', transition: 'transform 0.12s ease' },
  haulNew: { position: 'absolute', top: -6, right: -6, fontSize: 8, fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-bright)', background: 'var(--c-accent-pink)', borderRadius: 'var(--r-sm)', padding: '1px 4px', letterSpacing: 0.3, boxShadow: '0 0 8px var(--c-accent-pink)' },
  haulHint: { textAlign: 'center', color: 'var(--c-text-faint)', fontSize: 'var(--fs-caption)', margin: '0 0 var(--sp-2_5)' },
  miniGem: { width: 18, height: 18, borderRadius: '50%' },
  nudge: { position: 'fixed', left: 'var(--sp-4)', bottom: 'var(--sp-4)', maxWidth: 440, width: 'min(440px, calc(100% - 32px))', display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', background: 'rgba(28,30,42,0.94)', border: '1px solid #2a2c3a', borderRadius: 'var(--r-lg)', padding: '10px 14px', boxShadow: '0 6px 24px rgba(0,0,0,0.45)', zIndex: 5 },
  nudgeText: { flex: 1, fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-secondary)', lineHeight: 1.4 },
  nudgeClose: { background: 'none', border: 'none', color: 'var(--c-text-dim)', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: 'var(--sp-1)' },
  devBar: { position: 'fixed', top: 'var(--sp-2)', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 'var(--sp-1_5)', alignItems: 'center', background: 'rgba(40,20,50,0.96)', border: '1px solid #6b3a7a', borderRadius: 'var(--r-lg)', padding: '6px 10px', zIndex: 20, flexWrap: 'wrap', maxWidth: '94%' },
  devTitle: { color: 'var(--c-accent-pink-bright)', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', marginRight: 'var(--sp-1)' },
  devBtn: { ...CAP, border: '1px solid #6b3a7a', borderRadius: 'var(--r-sm)', padding: '4px 8px', fontSize: 'var(--fs-caption)' },
  fluxIcon: { color: 'var(--c-accent-gold)' }, // Flux ✦ — warm gold
  shardIcon: { color: 'var(--c-shard)' }, // Shards ◈ — cool cyan

  // ── Engine / Forge visual boards ──
  board: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', paddingBottom: 'var(--sp-7)' },
  boardIntro: { ...VITRINE, borderRadius: 'var(--r-xl)', padding: '12px 14px' },
  boardTitle: { margin: '0 0 6px', fontSize: 'var(--fs-h2)', color: 'var(--c-text)', fontFamily: 'var(--font-display)', letterSpacing: 0.3 },
  boardDesc: { margin: 0, fontSize: 'var(--fs-body-sm)', lineHeight: 1.5, color: 'var(--c-text-muted)' },
  helpClose: { position: 'absolute', top: -2, right: -4, background: 'none', border: 'none', color: 'var(--c-text-faint)', cursor: 'pointer', fontSize: 'var(--fs-h3)', lineHeight: 1, padding: 'var(--sp-1)' },
  // notification pill: inline-flex centres the ♥N (no baseline drift), even padding, and the button's flex
  // gap — not a hand-tuned marginLeft — owns the spacing so it sits the same distance as the icon does.
  // Heart + count are SEPARATE centred flex items (not one text node), each line-height 1, so the glyph and the
  // digits share a vertical centre. Lining/tabular figures stop the app font's oldstyle numerals from dropping
  // the count below the heart's baseline.
  navBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 16, height: 14, padding: '0 5px', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-bright)', background: 'var(--c-accent-pink)', borderRadius: 'var(--r-pill)', boxShadow: '0 0 8px rgba(255,93,143,0.6)' },
  navDot: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, fontSize: 10, lineHeight: 1, fontWeight: 'var(--fw-heavy)', color: '#1a1206', background: 'var(--c-accent-gold)', borderRadius: '50%', boxShadow: '0 0 8px rgba(255,207,107,0.7)' },
  navBadgeHeart: { display: 'block', fontSize: 8, lineHeight: 1 },
  navBadgeNum: { display: 'block', fontSize: 9, lineHeight: 1, fontVariantNumeric: 'lining-nums tabular-nums' },
  shipNotice: { background: 'linear-gradient(180deg, rgba(255,93,143,0.10), rgba(255,93,143,0.03))', border: '1px solid rgba(255,93,143,0.35)', borderRadius: 'var(--r-2xl)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)' },
  shipNoticeHead: { color: 'var(--c-accent-pink-bright)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-h4)', marginBottom: 'var(--sp-2)' },
  shipNoticeList: { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' },
  shipNoticeBtn: { background: 'var(--c-surface-3)', border: '1px solid rgba(255,93,143,0.4)', borderRadius: 'var(--r-pill)', color: 'var(--c-text-secondary)', padding: '5px 12px', fontSize: 'var(--fs-caption)', cursor: 'pointer' },
  shardBank: { marginTop: 'var(--sp-2)', fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-secondary)', fontWeight: 'var(--fw-medium)' },
  boardStats: { ...VITRINE, display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3_5)' },
  bigStat: { display: 'flex', flexDirection: 'column', minWidth: 120 },
  bigStatNum: { fontSize: 'var(--fs-display)', fontWeight: 'var(--fw-heavy)', lineHeight: 1 },
  bigStatLbl: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', marginTop: 3 },
  budgetBox: { flex: 1, minWidth: 160 },
  budgetTop: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', marginBottom: 'var(--sp-1)' },
  boardBtns: { display: 'flex', gap: 'var(--sp-2)' },
  floorWrap: { position: 'relative', height: 300, borderRadius: 'var(--r-2xl)', overflow: 'hidden', border: '1px solid #23252f', background: '#0a0b12', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  floorTag: { position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-2_5)', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 'var(--fs-body-sm)', pointerEvents: 'none', textShadow: '0 1px 6px #000' },
  floorEmpty: { display: 'grid', placeItems: 'center', height: '100%', padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--c-text-faint)', fontSize: 'var(--fs-body)', lineHeight: 1.5 },
  boardSub: { margin: '6px 2px 0', fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 },
  workshopSection: { margin: '0 2px var(--sp-1_5)', paddingBottom: 4, fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: '1px solid var(--c-border)' },
  chipGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(146px, 1fr))', gap: 'var(--sp-2)' },
  boardGrid: { display: 'grid', gap: 5, maxWidth: 360, margin: '0 auto 4px' },
  boardCell: { aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid', borderRadius: 'var(--r-md)', cursor: 'pointer', color: 'var(--c-text)', padding: 0, transition: 'background .12s, box-shadow .12s' },
  deployChip: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--sp-0_5)', background: 'linear-gradient(180deg, #1e202c, #15161f)', border: '2px solid', borderRadius: 'var(--r-lg)', padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: 'var(--c-text)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 3px 6px rgba(0,0,0,0.4)' },
  benchChip: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--sp-0_5)', background: 'linear-gradient(180deg, #101119, #0c0d15)', border: '1px solid #23252f', borderRadius: 'var(--r-lg)', padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: 'var(--c-text-secondary)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(120,130,160,0.08)' },
  chipNick: { fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)' },
  chipProd: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-muted)', fontWeight: 'var(--fw-medium)' },
  chipMeta: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-faint)' },
  emptyHint: { ...VITRINE, border: '1px dashed #2a2e3e', gridColumn: '1 / -1', fontSize: 'var(--fs-body-sm)', color: 'var(--c-text-muted)', lineHeight: 1.6, borderRadius: 'var(--r-xl)', padding: '22px 16px', textAlign: 'center' },
  relicPanel: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', background: 'linear-gradient(120deg, #221c0e 0%, #16151c 60%)', border: '1px solid #6b5a2a', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3_5)', boxShadow: 'inset 0 1px 0 rgba(255,222,150,0.12), inset 0 0 24px rgba(120,90,20,0.12), inset 0 0 0 1px rgba(255,207,107,0.10), 0 3px 8px rgba(0,0,0,0.4)' },
  summonBtn: { background: 'linear-gradient(180deg, #ffe08a, #ffce5c 45%, #ff9d5c)', color: '#2a1d00', border: 'none', borderRadius: 'var(--r-md)', padding: '10px 14px', fontWeight: 'var(--fw-heavy)', cursor: 'pointer', fontSize: 'var(--fs-body-sm)', whiteSpace: 'nowrap', textShadow: '0 1px 0 rgba(255,230,180,0.5)', boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(150,80,0,0.45), 0 3px 7px rgba(255,170,60,0.4), 0 0 0 1px rgba(120,70,0,0.4)' },
  recipeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 'var(--sp-2_5)' },
  recipeCard: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2_5)', background: 'linear-gradient(180deg, #16171f, #101119)', border: '2px solid', borderRadius: 'var(--r-xl)', padding: 'var(--sp-3)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -2px 5px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.3)' },
  recipeFlow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-1)' },
  flowOp: { color: 'var(--c-text-faint)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)' },
  gemChip: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-1)', width: 56 },
  gemChipDot: { width: 26, height: 26, borderRadius: '50%', boxShadow: '0 0 10px rgba(0,0,0,0.4)' },
  gemChipName: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-secondary)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 56 },
  invLine: { display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'center', minHeight: 15, cursor: 'help' },
  invPill: { fontSize: 'var(--fs-micro)', lineHeight: 1.4, color: 'var(--c-text-faint)', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--r-sm)', padding: '0 4px', fontVariantNumeric: 'tabular-nums' },
  invPillFlip: { color: '#c9a6ff', background: 'rgba(150,110,255,0.16)' },
  forgeBtn: { background: 'linear-gradient(180deg, #303341, #23252f 55%, #1a1b24)', color: 'var(--c-text-bright)', border: '1px solid #3a3d4f', borderTopColor: '#4a4e62', borderRadius: 'var(--r-md)', padding: 'var(--sp-2)', fontWeight: 'var(--fw-bold)', cursor: 'pointer', fontSize: 'var(--fs-body-sm)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 2px rgba(0,0,0,0.45), 0 2px 3px rgba(0,0,0,0.4)' },
  discoveredTag: { position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-2_5)', fontSize: 'var(--fs-micro)', color: 'var(--c-accent-teal)' },
  fusionPanel: { marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3_5)', borderTop: '1px solid #23252f' },
  fusionPicker: { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1_5)', marginTop: 'var(--sp-3)', maxHeight: 168, overflowY: 'auto' },
  fusionChip: { display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', background: 'var(--c-surface-3)', border: '2px solid', borderRadius: 'var(--r-pill)', padding: '4px 11px 4px 6px', cursor: 'pointer', color: 'var(--c-text-secondary)', fontSize: 'var(--fs-body-sm)' },
  fusionChipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 92 },

  // ── Shop / Ledger / Settings ──
  sceneSwatch: { display: 'flex', height: 38, borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid #23252f' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--sp-2)' },
  statCard: { ...VITRINE, display: 'flex', flexDirection: 'column', gap: 'var(--sp-0_5)', borderRadius: 'var(--r-lg)', padding: '10px 12px' },
  statVal: { fontSize: 'var(--fs-numeral)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text)' },
  statLbl: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-dim)' },
  statFrac: { fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--c-text-dim)', marginLeft: 1 },
  barTrack: { marginTop: 7, height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, transition: 'width 0.5s ease' },
  // Ledger headline — the finite-completion goal made unmissable (Zeigarnik, endowed-progress, honestly framed)
  ledgerHero: { ...VITRINE, borderRadius: 'var(--r-xl)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 18 },
  heroPct: { fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-heavy)', fontSize: 46, lineHeight: 1, color: 'var(--c-accent-gold-bright)', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 16px rgba(255,207,107,0.3)' },
  heroSub: { flex: 1, minWidth: 0 },
  heroLabel: { fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)', color: '#e8eaf2' },
  barTrackLg: { marginTop: 7, height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFillLg: { height: '100%', borderRadius: 5, background: 'linear-gradient(90deg, #ffcf6b, #ffae3a)', transition: 'width 0.6s ease', boxShadow: '0 0 10px rgba(255,207,107,0.4)' },
  heroMeta: { marginTop: 7, fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)' },
  fluxChartHead: { position: 'absolute', top: 8, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1, pointerEvents: 'none' },
  fluxChartCaption: { fontSize: 'var(--fs-eyebrow)', textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--c-text-dim)' },
  fluxChartNow: { fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-heavy)', fontVariantNumeric: 'tabular-nums' },
  settingsCard: { boxSizing: 'border-box', width: 'min(620px, calc(100vw - 28px))', height: 'min(680px, 90vh)', minHeight: 'min(560px, 88vh)', overflow: 'auto', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-2xl)', padding: 'var(--sp-4)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
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
  watchPill: { marginLeft: 'auto', flexShrink: 0, background: '#3a2440', color: 'var(--c-accent-pink-bright)', border: '1px solid #6b3a7a', borderRadius: 'var(--r-pill)', padding: '2px 8px', fontSize: 'var(--fs-micro)', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' },

  // ── Ship cutscene ──
  shipCard: { boxSizing: 'border-box', width: 'min(480px, calc(100vw - 28px))', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-3xl)', padding: 'var(--sp-5)', textAlign: 'center', position: 'relative', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  shipHead: { color: 'var(--c-accent-pink-bright)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-h4)', marginBottom: 'var(--sp-3_5)', letterSpacing: 0.3 },
  logBtn: { position: 'absolute', top: 'var(--sp-3_5)', right: 'var(--sp-3_5)', background: 'rgba(40,30,48,0.8)', border: '1px solid #4a3a52', color: '#ffb8e0', borderRadius: 'var(--r-pill)', width: 30, height: 30, cursor: 'pointer', fontSize: 'var(--fs-body)', lineHeight: 1 },
  logBox: { minHeight: 78, maxHeight: 220, overflowY: 'auto', background: 'var(--c-surface-0)', border: '1px solid #23252f', borderRadius: 'var(--r-xl)', padding: '12px 14px', marginBottom: 'var(--sp-3_5)', textAlign: 'left', boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(95,224,198,0.04)' },
  logModalCard: { boxSizing: 'border-box', width: 'min(460px, calc(100vw - 28px))', background: 'radial-gradient(120% 90% at 50% 0%, #1a1c28 0%, #121320 55%, #0c0d15 100%)', border: '1px solid #34384a', borderRadius: 'var(--r-3xl)', padding: 'var(--sp-5)', textAlign: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 0 0 1px rgba(255,207,107,0.10), inset 0 0 40px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)' },
  logModalBox: { maxHeight: '58vh', overflowY: 'auto', textAlign: 'left', margin: '12px 0 14px', background: 'var(--c-surface-0)', border: '1px solid #23252f', borderRadius: 'var(--r-xl)', padding: '12px 14px', boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(95,224,198,0.04)' },
  shipGems: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-4_5)', marginBottom: 'var(--sp-3_5)' },
  shipGem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-1_5)', transition: 'all 0.25s ease', color: 'var(--c-text-secondary)', fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--fw-bold)' },
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
  filterChip: { background: 'var(--c-surface-1)', border: '1px solid', borderRadius: 'var(--r-pill)', padding: '3px 10px', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', cursor: 'pointer' },
  tileGlyph: { fontSize: 'var(--fs-h2)', lineHeight: 1, marginRight: 'var(--sp-0_5)' },
  kbd: { fontSize: 'var(--fs-micro)', background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 'var(--r-xs)', padding: '0 5px', marginLeft: 5, fontFamily: 'ui-monospace, monospace' },
  shipModel: { position: 'relative', width: 132, height: 132, borderRadius: 'var(--r-xl)', overflow: 'hidden', transition: 'all 0.25s ease', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  shipModelName: { position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-1)', textAlign: 'center', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', color: 'var(--c-text-bright)', textShadow: '0 1px 4px #000', pointerEvents: 'none' },
  shipStage: { position: 'relative', height: 250, borderRadius: 'var(--r-xl)', overflow: 'hidden', border: '1px solid #2a2c3a', marginBottom: 'var(--sp-3_5)', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.7)' },
  shipNames: { position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-2)', display: 'flex', justifyContent: 'center', gap: 'var(--sp-3_5)', fontSize: 'var(--fs-body-sm)', textShadow: '0 1px 6px #000', pointerEvents: 'none' },
  kbRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2_5)', padding: '5px 0', borderBottom: '1px solid #1c1e2a' },
  kbDesc: { color: 'var(--c-text-muted)', fontSize: 'var(--fs-caption)' },
  kbd2: { fontFamily: 'ui-monospace, monospace', fontSize: 'var(--fs-caption)', background: 'var(--c-surface-0)', border: '1px solid #3a3d4f', borderRadius: 5, padding: '2px 7px', color: 'var(--c-text)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(120,130,160,0.08)' },
  milestoneRow: { ...VITRINE, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '6px 10px', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-body-sm)' },
  objectives: { ...VITRINE, borderRadius: 'var(--r-xl)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  objHead: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 },
  objRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
  objLabel: { fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  objNum: { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-teal)', fontWeight: 'var(--fw-bold)', flexShrink: 0 },
  mileToast: { position: 'fixed', top: 58, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', background: 'rgba(30,24,12,0.96)', border: '1px solid #6b5a2a', borderRadius: 'var(--r-xl)', padding: '10px 16px', zIndex: 60, minWidth: 290, maxWidth: '92vw', boxShadow: '0 6px 24px rgba(0,0,0,0.55)', cursor: 'pointer', overflow: 'hidden' },
  toastDrain: { position: 'absolute', left: 0, bottom: 0, height: 2, width: '100%', background: 'var(--c-accent-gold-deep)', borderRadius: 2 },
  watchdogToast: { position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', background: 'rgba(18,20,30,0.96)', border: '1px solid #3a3d4e', borderRadius: 'var(--r-lg)', padding: '8px 14px', zIndex: 60, maxWidth: '92vw', boxShadow: '0 6px 24px rgba(0,0,0,0.5)', cursor: 'pointer' },
  tourWrap: { position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', padding: '0 12px 18px', zIndex: 70, pointerEvents: 'none' },
  tourCard: { boxSizing: 'border-box', pointerEvents: 'auto', width: 'min(460px, calc(100vw - 28px))', background: 'rgba(18,19,26,0.97)', border: '1px solid #3a3d4f', borderRadius: 'var(--r-2xl)', padding: '14px 16px', boxShadow: '0 8px 30px rgba(0,0,0,0.6)' },
  patSurface: { position: 'absolute', inset: 0, cursor: 'grab', touchAction: 'none', zIndex: 3, overflow: 'hidden' },
  patGlow: { position: 'absolute', width: 130, height: 130, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,222,150,0.55), rgba(255,180,220,0.18) 45%, transparent 72%)', pointerEvents: 'none' },
  patBtn: { position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-2)', zIndex: 4, background: 'rgba(40,24,44,0.85)', border: '1px solid #6b3a7a', color: 'var(--c-accent-pink-bright)', borderRadius: 'var(--r-pill)', padding: '4px 10px', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', cursor: 'pointer' },
}
