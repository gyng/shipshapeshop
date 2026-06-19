import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useGame, RARITY_ORDER, type ShapeRow } from './game/store'
import { HeroView } from './three/HeroView'
import { FactoryFloor } from './three/FactoryFloor'
import { ForgeAltar } from './three/ForgeAltar'
import { RARITY_COLOR } from './three/Gem'
import { CODEX } from './content/codex'
import { SCENES, sceneById } from './content/cosmetics'
import { KINSHIP } from './content/kinship'
import { useT, useLangStore, LANGS } from './i18n'
import { useHints } from './onboarding'
import { useMute } from './audio'
import { DEV_MODE } from './devmode'
import { Floaters, useFloaters } from './juice'

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

type Tab = 'gacha' | 'gallery' | 'engine' | 'forge' | 'shop' | 'ledger'

export function App() {
  const { ready, boot } = useGame()
  useEffect(() => {
    void boot()
  }, [boot])
  const [tab, setTab] = useState<Tab>('gacha')
  const [inspect, setInspect] = useState<number | null>(null)
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const tr = useT()

  if (!ready) {
    return <div style={S.loading}>Lighting the Atlas…</div>
  }
  return (
    <div style={{ ...S.app, background: sceneById(sceneId).bg }}>
      <Hud />
      <nav style={S.nav}>
        {(['gacha', 'gallery', 'engine', 'forge', 'shop', 'ledger'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...S.navBtn, ...(tab === t ? S.navBtnActive : {}) }}>
            {t === 'gacha' ? tr('nav.pull') : t === 'shop' ? '🛍 Shop' : t === 'ledger' ? '📊 Ledger' : tr(`nav.${t}`)}
          </button>
        ))}
      </nav>
      <main style={S.main}>
        {tab === 'gacha' && <GachaView />}
        {tab === 'gallery' && <GalleryView onInspect={setInspect} />}
        {tab === 'engine' && <EngineView />}
        {tab === 'forge' && <ForgeView />}
        {tab === 'shop' && <ShopView />}
        {tab === 'ledger' && <LedgerView />}
      </main>
      <RevealModal />
      <ForgeToast />
      <OfflineModal />
      <WelcomeModal />
      {inspect !== null && <Inspector id={inspect} onClose={() => setInspect(null)} />}
      <SettingsModal />
      <Nudge />
      <DevBar />
      <Floaters />
      <IdleFlux />
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
  if (!view) return null
  return (
    <header style={S.hud}>
      <div>
        <span style={S.fluxLabel}><span style={S.fluxIcon}>✦</span> {tr('hud.flux')}</span>
        <span style={S.fluxValue}>{fmt(flux)}</span>
        <span style={S.rate}>+{fmt(view.rate_per_hr)}/hr</span>
      </div>
      <div style={S.hudStats}>
        <span><span style={S.shardIcon}>◈</span> {view.shards} {tr('hud.shards')}</span>
        <span>{tr('hud.collection')} {view.distinct_owned}/41</span>
        <span>{tr('hud.dim')} v{view.viewport_dim}{view.ng_cycle > 0 ? ` · NG+${view.ng_cycle}` : ''}</span>
        <button onClick={toggleMute} style={S.langBtn} aria-label="toggle sound">{muted ? '🔇' : '🔊'}</button>
        <button onClick={() => openSettings(true)} style={S.langBtn} aria-label="settings">⚙</button>
        {DEV_MODE && <button onClick={toggleDev} style={S.langBtn} aria-label="dev tools">🛠</button>}
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

function GachaView() {
  const { view, pull, tenPull, shapes, lastReveal } = useGame()
  const tr = useT()
  const focusId = lastReveal?.[0]?.shape_id ?? 0
  const shape = shapes[focusId] ?? shapes[0]
  if (!view) return null
  return (
    <div style={S.gacha}>
      <div style={S.stageWrap}>
        {shape && <HeroView key={shape.family} family={shape.family} rarity={shape.rarity} controls />}
        {shape && <div style={S.focusName}>{shape.nick} <em style={S.focusFam}>· {shape.family.replace(/_/g, ' ')}</em></div>}
      </div>
      <div style={S.pitymeters}>
        <Meter label={`${tr('pull.pity')} ${view.pity_since_top}/30`} pct={view.pity_since_top / 30} color="#ffb86b" />
        <Meter label={`${tr('pull.resonance')} ${view.resonance}/40`} pct={view.resonance / 40} color="#ff5d8f" />
      </div>
      <div style={S.pullRow}>
        <button className={view.can_pull ? 'ready-pulse' : undefined} style={{ ...S.pullBtn, opacity: view.can_pull ? 1 : 0.4 }} disabled={!view.can_pull} onClick={pull}>
          {tr('pull.one')}
        </button>
        <button style={{ ...S.pullBtn10, opacity: view.flux >= 1000 ? 1 : 0.4 }} disabled={view.flux < 1000} onClick={tenPull}>
          {tr('pull.ten')}
        </button>
      </div>
      <p style={S.hint}>{tr('pull.hint')}</p>
    </div>
  )
}

function GalleryView({ onInspect }: { onInspect: (id: number) => void }) {
  const { shapes, view } = useGame()
  if (!view) return null
  return (
    <div style={S.gallery}>
      {RARITY_ORDER.map((r) => (
        <section key={r}>
          <h3 style={{ ...S.tierHead, color: RARITY_COLOR[r] }}>{r === 'Ssr' ? 'SSR' : r === 'Ur' ? 'UR' : r === 'Relic' ? 'Reference Wing' : r}</h3>
          <div style={S.grid}>
            {shapes.filter((s) => s.rarity === r).map((s) => {
              const owned = view.owned[s.id] > 0
              return (
                <button key={s.id} onClick={() => onInspect(s.id)}
                  style={{ ...S.tile, borderColor: owned ? RARITY_COLOR[r] : '#23252f', color: owned ? '#fff' : '#555' }}>
                  <span style={{ ...S.tileDot, background: owned ? RARITY_COLOR[r] : '#2a2c3a' }} />
                  {owned ? s.nick : '???'}
                  {view.owned[s.id] > 1 && <span style={S.dupe}>×{view.owned[s.id]}</span>}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
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

function EngineView() {
  const { shapes, view, deploy, undeploy, autoArrange, recrystallize } = useGame()
  if (!view) return null
  const owned = shapes.filter((s) => view.owned[s.id] > 0)
  const deployed = owned.filter((s) => view.loadout.includes(s.id))
  const bench = owned.filter((s) => !view.loadout.includes(s.id))
  const pct = view.euler_cap ? view.euler_used / view.euler_cap : 0
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>⚙ Engine — your Flux factory</h3>
        <p style={S.boardDesc}>
          Deploy shapes onto the floor and they generate <b style={S.fluxIcon}>✦ Flux</b> every hour — even while you’re away.
          Each shape takes <b>floor space</b> (round shapes are free; exotic many-holed ones cost more but pay far more).
        </p>
      </div>
      <div style={S.floorWrap}>
        {view.loadout.length > 0 ? (
          <FactoryFloor shapes={shapes} loadout={view.loadout} />
        ) : (
          <div style={S.floorEmpty}>🏭 Your factory floor is empty — deploy shapes below to see them spinning here, producing Flux.</div>
        )}
      </div>
      <div style={S.boardStats}>
        <div style={S.bigStat}>
          <span style={{ ...S.bigStatNum, color: '#ffcf6b' }}>+{fmt(view.rate_per_hr)}</span>
          <span style={S.bigStatLbl}>✦ Flux / hour</span>
        </div>
        <div style={S.budgetBox}>
          <div style={S.budgetTop}><span>Floor space used</span><span>{view.euler_used} / {view.euler_cap}</span></div>
          <div style={S.meterTrack}><div style={{ ...S.meterFill, width: `${Math.min(100, pct * 100)}%`, background: pct > 0.85 ? '#ff5d8f' : '#5fe0c6' }} /></div>
        </div>
        <div style={S.boardBtns}>
          <button style={S.smallBtn} onClick={autoArrange}>✨ Auto-arrange</button>
          <button style={{ ...S.smallBtn, opacity: view.core_complete ? 1 : 0.4 }} disabled={!view.core_complete} onClick={recrystallize}>↑ Recrystallize</button>
        </div>
      </div>

      <h4 style={S.boardSub}>On the floor — {deployed.length}</h4>
      <div style={S.chipGrid}>
        {deployed.length === 0 && <p style={S.emptyHint}>Nothing deployed yet — tap a shape below (or hit Auto-arrange) to start earning Flux.</p>}
        {deployed.map((s) => (
          <button key={s.id} className="chip chip-on" style={{ ...S.deployChip, borderColor: RARITY_COLOR[s.rarity] }} onClick={() => undeploy(s.id)}>
            <span style={{ ...S.tileDot, background: RARITY_COLOR[s.rarity] }} />
            <span style={S.chipNick}>{s.nick}</span>
            <span style={{ ...S.chipProd, color: '#ffcf6b' }}>+{fmt(s.prod)} ✦/hr</span>
            <span style={S.chipMeta}>tap to remove ✕</span>
          </button>
        ))}
      </div>

      <h4 style={S.boardSub}>In storage — {bench.length}</h4>
      <div style={S.chipGrid}>
        {bench.length === 0 && <p style={S.emptyHint}>Everything you own is deployed. Pull more shapes to expand the floor!</p>}
        {bench.map((s) => {
          const fits = view.euler_used + s.euler_cost <= view.euler_cap
          return (
            <button key={s.id} className="chip" style={{ ...S.benchChip, opacity: fits ? 1 : 0.45 }} disabled={!fits} onClick={() => deploy(s.id)}>
              <span style={{ ...S.tileDot, background: RARITY_COLOR[s.rarity] }} />
              <span style={S.chipNick}>{s.nick}</span>
              <span style={S.chipProd}>+{fmt(s.prod)} ✦/hr</span>
              <span style={S.chipMeta}>{s.euler_cost === 0 ? 'free to deploy' : fits ? `space: ${s.euler_cost}` : `needs ${s.euler_cost} space`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Meter({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={S.meter}>
      <span style={S.meterLabel}>{label}</span>
      <div style={S.meterTrack}><div style={{ ...S.meterFill, width: `${Math.min(100, pct * 100)}%`, background: color }} /></div>
    </div>
  )
}

function RevealModal() {
  const { lastReveal, shapes, dismissReveal } = useGame()
  const tr = useT()
  if (!lastReveal) return null
  const best = [...lastReveal].sort((a, b) => RARITY_ORDER.indexOf(b.rarity!) - RARITY_ORDER.indexOf(a.rarity!))[0]
  const shape = shapes[best.shape_id]
  return (
    <div style={S.modal} onClick={dismissReveal}>
      <div className="pop-in" style={{ ...S.revealCard, position: 'relative', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        {shape && <div className="flash" style={{ background: `radial-gradient(circle, ${RARITY_COLOR[shape.rarity]}, transparent 60%)` }} />}
        <div style={S.revealStage}>{shape && <HeroView key={shape.family} family={shape.family} rarity={shape.rarity} spin={0.8} />}</div>
        {shape && <h2 style={{ color: RARITY_COLOR[shape.rarity] }}>{shape.nick}</h2>}
        {shape && <p style={S.revealSub}>{best.is_new ? tr('reveal.new') : `+${best.dupe_shards} ◈ ${tr('hud.shards')}`}</p>}
        {lastReveal.length > 1 && (
          <div style={S.revealRow}>
            {lastReveal.map((o, i) => {
              const sh = shapes[o.shape_id]
              return <span key={i} style={{ ...S.miniGem, background: sh ? RARITY_COLOR[sh.rarity] : '#333' }} title={sh?.nick} />
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
function vagueHint(rarity: string, genus: number): string {
  const tier =
    rarity === 'Ur' ? 'A legend of the deep Manifold.'
    : rarity === 'Relic' ? 'Not of the Manifold at all — an artifact of the rendering-folk.'
    : rarity === 'Ssr' ? 'One of the rarer forms, they say.'
    : rarity === 'Epic' ? 'An uncommon find.'
    : 'A common enough shape, once it surfaces.'
  const holes =
    genus === 0 ? 'Word is it has no way through — sealed, or solid.'
    : genus === 1 ? 'A single hole, the Ledger notes — one way to thread it.'
    : genus <= 3 ? 'A handful of holes, if the rumours hold.'
    : 'Riddled with holes — more ways through than anyone has bothered to count.'
  return `${tier} ${holes}`
}

function Inspector({ id, onClose }: { id: number; onClose: () => void }) {
  const { shapes, view, inspect } = useGame()
  const tr = useT()
  const s = shapes[id]
  const owned = !!view && view.owned[id] > 0
  // Inspecting an owned shape grants affinity — the calm idler's path to bonds.
  useEffect(() => {
    if (owned) inspect(id)
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
            <div style={S.revealStage}><HeroView key={s.family} family={s.family} rarity={s.rarity} controls /></div>
            <h2 style={{ color: RARITY_COLOR[s.rarity] }}>{s.nick}</h2>
            <p style={S.revealSub}>{rarityLabel(s.rarity)} · {s.family.replace(/_/g, ' ')} · ♥ Bond {bond}</p>
            {codex && <p style={{ ...S.hint, fontStyle: 'italic', color: '#cdd2e0' }}>“{codex.blurb}”</p>}
            {codex && bond >= 1 && <p style={{ ...S.hint, color: RARITY_COLOR[s.rarity] }}>{codex.bond}</p>}
            <p style={S.hint}>
              {s.genus > 0 ? `${s.genus} hole${s.genus > 1 ? 's' : ''} → ${s.genus} production lane${s.genus > 1 ? 's' : ''}. ` : 'No holes — free to deploy. '}
              Euler cost {s.euler_cost}.{codex ? ` …it is ${codex.term}.` : ''}
            </p>
            {KINSHIP[s.family]?.length ? (
              <div style={S.kinBox}>
                <div style={S.kinHead}>♥ Kinship</div>
                {KINSHIP[s.family].map((k, i) => {
                  const partner = shapes.find((sh) => sh.family === k.with)
                  const self = k.with === s.family
                  const united = self || (!!partner && view.owned[partner.id] > 0)
                  return (
                    <div key={i} style={S.kinRow}>
                      <span style={{ color: united ? '#ff9ecf' : '#4a4d5f', width: 12, flexShrink: 0 }}>{united ? '♥' : '○'}</span>
                      <span style={S.kinType}>{k.type}</span>
                      <span style={{ color: united ? '#e8eaf2' : '#8a90a8', fontWeight: 700, flexShrink: 0 }}>{partner ? partner.nick : '???'}</span>
                      <span style={S.kinNote}>— {k.note}</span>
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
            <h2 style={{ color: '#6b7088' }}>Undiscovered</h2>
            <p style={S.revealSub}>{rarityLabel(s.rarity)} · still adrift in the Manifold</p>
            <p style={{ ...S.hint, fontStyle: 'italic', color: '#aab' }}>{vagueHint(s.rarity, s.genus)}</p>
            <p style={{ ...S.hint, opacity: 0.7 }}>Pull to bring it ashore — the reveal is half the joy.</p>
          </>
        )}
        <button style={S.pullBtn} onClick={onClose}>{tr('common.close')}</button>
      </div>
    </div>
  )
}

function ForgeView() {
  const { recipes, view, shapes, forge, claimRelic } = useGame()
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
        <h3 style={S.boardTitle}>🔨 Forge — fuse shapes together</h3>
        <p style={S.boardDesc}>
          Glue two shapes you own into a rarer third (a <em>connected sum</em> — real topology picks the result).
          Each forge costs <b style={S.shardIcon}>◈ 50</b>; the first time you discover a recipe you earn <b>+100 ◈</b>.
          Shards come from duplicate pulls.
        </p>
        <div style={S.shardBank}><span style={S.shardIcon}>◈</span> {view.shards} shards in the bank</div>
      </div>

      <div style={S.floorWrap}>
        {feat && <ForgeAltar a={shapes[feat.a]} b={shapes[feat.b]} out={shapes[feat.out]} discovered={view.discovered[featIdx]} />}
      </div>

      <div style={S.relicPanel}>
        <div style={{ flex: 1 }}>
          <strong style={{ color: '#ffd76b' }}>★ Reference Wing</strong>
          <p style={{ ...S.boardDesc, margin: '4px 0 0' }}>Summon a legendary CG model — Teapot, Bunny, Dragon… <b>{view.relics_owned}/{view.relic_count}</b> collected.</p>
        </div>
        <button style={{ ...S.summonBtn, opacity: canRelic ? 1 : 0.4 }} disabled={!canRelic} onClick={claimRelic}>
          {view.relics_owned >= view.relic_count ? 'Complete ✓' : `Summon · ${view.relic_cost} ◈`}
        </button>
      </div>

      <h4 style={S.boardSub}>Recipes</h4>
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
              <button style={{ ...S.forgeBtn, opacity: can ? 1 : 0.4 }} disabled={!can} onClick={() => forge(r.a, r.b)}>
                {can ? 'Forge · 50 ◈' : !haveA || !haveB ? 'Missing a shape' : 'Need 50 ◈'}
              </button>
              {discovered && <span style={S.discoveredTag}>✓ discovered</span>}
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

function WelcomeModal() {
  const { firstLaunch, dismissWelcome } = useGame()
  const tr = useT()
  if (!firstLaunch) return null
  return (
    <div style={S.modal} onClick={dismissWelcome}>
      <div className="pop-in" style={S.revealCard} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('welcome.title')}</h2>
        <p style={S.revealSub}>{tr('welcome.body')}</p>
        <p style={S.hint}>{tr('welcome.note')}</p>
        <button style={S.pullBtn} onClick={dismissWelcome}>{tr('welcome.begin')}</button>
      </div>
    </div>
  )
}

function ShopView() {
  const { view, buyCosmetic, selectScene } = useGame()
  if (!view) return null
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>🛍 Shop — scenes &amp; environments</h3>
        <p style={S.boardDesc}>
          Spend <b style={S.fluxIcon}>✦ Flux</b> on swappable scenes that re-light the whole game — the patron sink for
          late-game Flux. Owned scenes equip for free.
        </p>
        <div style={S.shardBank}><span style={S.fluxIcon}>✦</span> {fmt(view.flux)} Flux available</div>
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
                <button style={{ ...S.forgeBtn, opacity: 0.6 }} disabled>Equipped</button>
              ) : owned ? (
                <button style={S.forgeBtn} onClick={() => selectScene(sc.id)}>Equip</button>
              ) : (
                <button style={{ ...S.summonBtn, opacity: canBuy ? 1 : 0.4 }} disabled={!canBuy} onClick={() => buyCosmetic(sc.id, sc.cost)}>Buy · {fmt(sc.cost)} ✦</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FluxChart({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div style={{ ...S.boardIntro, height: 110, display: 'grid', placeItems: 'center', color: '#6b7088', fontSize: 13 }}>Flux trend will appear as you play…</div>
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
  const { view, fluxHistory } = useGame()
  if (!view) return null
  const playMin = Math.max(0, (view.last_seen_ms - view.created_ms) / 60000)
  const playStr = playMin >= 60 ? (playMin / 60).toFixed(1) + 'h' : Math.floor(playMin) + 'm'
  const stat = (label: string, value: string) => (
    <div style={S.statCard}><span style={S.statVal}>{value}</span><span style={S.statLbl}>{label}</span></div>
  )
  const rarityNames = ['Common', 'Rare', 'Epic', 'SSR', 'UR']
  return (
    <div style={S.board}>
      <div style={S.boardIntro}>
        <h3 style={S.boardTitle}>📊 Ledger — your run in numbers</h3>
        <p style={S.boardDesc}>Everything the Atlas has tallied. Flux over the last couple of minutes:</p>
      </div>
      <FluxChart data={fluxHistory} />
      <h4 style={S.boardSub}>Economy</h4>
      <div style={S.statGrid}>
        {stat('Flux now', fmt(view.flux))}
        {stat('Flux / hr', '+' + fmt(view.rate_per_hr))}
        {stat('Lifetime Flux', fmt(view.lifetime_flux))}
        {stat('Shards', fmt(view.shards))}
        {stat('Lifetime shards', fmt(view.lifetime_shards))}
        {stat('Total pulls', fmt(view.total_pulls))}
        {stat('Forges', fmt(view.total_forges))}
        {stat('Playtime', playStr)}
      </div>
      <h4 style={S.boardSub}>Collection &amp; progress</h4>
      <div style={S.statGrid}>
        {stat('Core shapes', view.distinct_owned + '/41')}
        {stat('Relics', view.relics_owned + '/' + view.relic_count)}
        {stat('Dimension', 'v' + view.viewport_dim)}
        {stat('New Game+', '×' + view.ng_cycle)}
        {stat('Prestige', '×' + view.prestige_mult.toFixed(2))}
        {stat('Floor space', view.euler_used + '/' + view.euler_cap)}
        {stat('Platonic set', view.platonic_set ? '✓ complete' : '—')}
        {stat('Scenes', view.cosmetics.length + 1 + '/' + SCENES.length)}
      </div>
      <h4 style={S.boardSub}>Pulls by rarity</h4>
      <div style={S.statGrid}>
        {view.pulls_by_rarity.map((n, i) => (
          <div key={i} style={{ ...S.statCard, borderColor: RARITY_COLOR[RARITY_ORDER[i]] }}>
            <span style={{ ...S.statVal, color: RARITY_COLOR[RARITY_ORDER[i]] }}>{fmt(n)}</span>
            <span style={S.statLbl}>{rarityNames[i]}</span>
          </div>
        ))}
      </div>
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
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#9aa0b4' }}>
      <p style={{ margin: '0 0 4px', color: '#cdd2e0', fontWeight: 700 }}>3D reference models</p>
      <ul style={S.attrList}>
        <li>Stanford Bunny · Dragon · Armadillo · Lucy — Stanford 3D Scanning Repository</li>
        <li>Cow · Horse — Princeton “Suggestive Contours” gallery</li>
        <li>Utah Teapot — Martin Newell, 1975 (procedural via three.js)</li>
        <li>Spot &amp; Császár torus — Keenan Crane (CC0)</li>
        <li>3DBenchy — CreativeTools (CC BY-ND)</li>
      </ul>
      <p style={{ margin: '8px 0 4px', color: '#cdd2e0', fontWeight: 700 }}>Built with</p>
      <ul style={S.attrList}>
        <li>three.js · React Three Fiber · drei</li>
        <li>Rust → WebAssembly (deterministic game core)</li>
        <li>React · Zustand · Vite · TypeScript</li>
      </ul>
      <p style={{ opacity: 0.7, marginTop: 8 }}>Shapes are mathematical objects; topology is public-domain mathematics. Verify each model’s licence before commercial use.</p>
    </div>
  )
}

function SettingsModal() {
  const settingsOpen = useGame((s) => s.settingsOpen)
  const setSettingsOpen = useGame((s) => s.setSettingsOpen)
  const muted = useMute((s) => s.muted)
  const toggleMute = useMute((s) => s.toggle)
  const [tab, setTab] = useState<'graphics' | 'gameplay' | 'keybinds' | 'attribution'>('graphics')
  if (!settingsOpen) return null
  const tabs: typeof tab[] = ['graphics', 'gameplay', 'keybinds', 'attribution']
  return (
    <div style={S.modal} onClick={() => setSettingsOpen(false)}>
      <div className="pop-in" style={S.settingsCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.settingsHead}>
          <strong style={{ fontSize: 16 }}>⚙ Settings</strong>
          <button style={S.langBtn} onClick={() => setSettingsOpen(false)}>✕</button>
        </div>
        <div style={S.settingsTabs}>
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ ...S.navBtn, ...(tab === t ? S.navBtnActive : {}) }}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div style={S.settingsBody}>
          {tab === 'graphics' && (
            <>
              <SettingRow label="Sound effects"><button style={{ ...S.toggle, ...(muted ? {} : S.toggleOn) }} onClick={toggleMute}>{muted ? 'Off' : 'On'}</button></SettingRow>
              <p style={S.hint}>3D quality auto-scales to your device (capped pixel ratio). Backgrounds &amp; environments are buyable in the 🛍 Shop.</p>
            </>
          )}
          {tab === 'gameplay' && (
            <p style={S.boardDesc}>
              The loop: <b>pull</b> shapes → <b>deploy</b> them in the Engine to make Flux → <b>forge</b> rarer shapes →
              <b> recrystallize</b> to ascend a dimension (New Game+). Edutainment (the real maths) lives in each owned
              shape’s Codex — discovery-first, and it never gates the fun.
            </p>
          )}
          {tab === 'keybinds' && (
            <p style={S.boardDesc}>
              Ship Shape Shop is pointer-driven. In any 3D view: <b>drag</b> (left or right) to orbit, <b>scroll / pinch</b>
              to zoom. Top bar: 🔊 sound, ⚙ settings{DEV_MODE ? ', 🛠 dev tools' : ''}.
            </p>
          )}
          {tab === 'attribution' && <Attribution />}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  loading: { color: '#9aa6c2', background: '#0d0d16', height: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', fontSize: 18 },
  app: { background: '#0d0d16', color: '#e8e8f0', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' },
  hud: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #1c1e2a', flexWrap: 'wrap', gap: 8 },
  fluxLabel: { color: '#8a90a8', marginRight: 8, fontSize: 13 },
  fluxValue: { fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  rate: { color: '#5fe0c6', marginLeft: 10, fontSize: 13 },
  hudStats: { display: 'flex', gap: 16, fontSize: 13, color: '#aab', alignItems: 'center' },
  langSwitch: { display: 'flex', gap: 4 },
  langBtn: { background: 'none', border: '1px solid #2a2c3a', color: '#8a90a8', borderRadius: 6, padding: '2px 7px', fontSize: 11, cursor: 'pointer' },
  langBtnOn: { background: '#28304a', color: '#fff', borderColor: '#5fe0c6' },
  nav: { display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid #1c1e2a' },
  navBtn: { background: 'none', border: 'none', color: '#8a90a8', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 15 },
  navBtnActive: { background: '#1c1e2a', color: '#fff' },
  main: { flex: 1, padding: 16, overflow: 'auto' },
  gacha: { maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  stageWrap: { position: 'relative', height: 340, borderRadius: 16, overflow: 'hidden', background: '#0a0a12' },
  focusName: { position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 18, fontWeight: 600, pointerEvents: 'none' },
  focusFam: { color: '#8a90a8', fontStyle: 'normal', fontWeight: 400, fontSize: 13 },
  pitymeters: { display: 'flex', flexDirection: 'column', gap: 6 },
  meter: { display: 'flex', flexDirection: 'column', gap: 3 },
  meterLabel: { fontSize: 11, color: '#8a90a8' },
  meterTrack: { height: 6, background: '#1c1e2a', borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  pullRow: { display: 'flex', gap: 10 },
  pullBtn: { flex: 1, background: 'linear-gradient(135deg,#ff5d8f,#b985ff)', border: 'none', color: '#fff', padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  pullBtn10: { flex: 1, background: '#1c1e2a', border: '1px solid #ff5d8f', color: '#fff', padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  hint: { color: '#8a90a8', fontSize: 12, lineHeight: 1.5 },
  gallery: { maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
  tierHead: { margin: '0 0 8px', fontSize: 15 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8 },
  tile: { display: 'flex', alignItems: 'center', gap: 8, background: '#13141d', border: '1px solid', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 14, textAlign: 'left' },
  tileDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  dupe: { marginLeft: 'auto', color: '#8a90a8', fontSize: 12 },
  engine: { maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 },
  engineHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  engineBtns: { display: 'flex', gap: 8 },
  smallBtn: { background: '#1c1e2a', border: '1px solid #2a2c3a', color: '#fff', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  engineList: { display: 'flex', flexDirection: 'column', gap: 6 },
  engineRow: { display: 'flex', alignItems: 'center', gap: 10, background: '#13141d', border: '1px solid', borderRadius: 10, padding: '8px 12px' },
  engineNick: { fontWeight: 600 },
  engineCost: { color: '#8a90a8', fontSize: 12, marginLeft: 'auto', marginRight: 10 },
  toggle: { background: '#1c1e2a', border: '1px solid #2a2c3a', color: '#fff', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  toggleOn: { background: '#28304a', borderColor: '#5fe0c6' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(5,5,10,0.82)', display: 'grid', placeItems: 'center', zIndex: 10, padding: 16 },
  revealCard: { background: '#13141d', border: '1px solid #2a2c3a', borderRadius: 18, padding: 24, textAlign: 'center', maxWidth: 420, width: '100%' },
  revealStage: { height: 280, borderRadius: 12, overflow: 'hidden', marginBottom: 10, background: '#0a0a12' },
  revealSub: { color: '#aab', margin: '4px 0 14px' },
  revealRow: { display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  miniGem: { width: 18, height: 18, borderRadius: '50%' },
  nudge: { position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', maxWidth: 560, width: 'calc(100% - 32px)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(28,30,42,0.94)', border: '1px solid #2a2c3a', borderRadius: 10, padding: '10px 14px', boxShadow: '0 6px 24px rgba(0,0,0,0.45)', zIndex: 5 },
  nudgeText: { flex: 1, fontSize: 13, color: '#cdd2e0', lineHeight: 1.4 },
  nudgeClose: { background: 'none', border: 'none', color: '#8a90a8', cursor: 'pointer', fontSize: 14, padding: 4 },
  devBar: { position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(40,20,50,0.96)', border: '1px solid #6b3a7a', borderRadius: 10, padding: '6px 10px', zIndex: 20, flexWrap: 'wrap', maxWidth: '94%' },
  devTitle: { color: '#ff9ecf', fontSize: 12, fontWeight: 700, marginRight: 4 },
  devBtn: { background: '#3a2348', border: '1px solid #6b3a7a', color: '#fff', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' },
  fluxIcon: { color: '#ffcf6b' }, // Flux ✦ — warm gold
  shardIcon: { color: '#5ad4ff' }, // Shards ◈ — cool cyan

  // ── Engine / Forge visual boards ──
  board: { display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 28 },
  boardIntro: { background: '#14151c', border: '1px solid #23252f', borderRadius: 12, padding: '12px 14px' },
  boardTitle: { margin: '0 0 6px', fontSize: 16, color: '#e8eaf2' },
  boardDesc: { margin: 0, fontSize: 13, lineHeight: 1.5, color: '#9aa0b4' },
  shardBank: { marginTop: 8, fontSize: 13, color: '#cdd2e0', fontWeight: 600 },
  boardStats: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: '#14151c', border: '1px solid #23252f', borderRadius: 12, padding: 14 },
  bigStat: { display: 'flex', flexDirection: 'column', minWidth: 120 },
  bigStatNum: { fontSize: 28, fontWeight: 800, lineHeight: 1 },
  bigStatLbl: { fontSize: 12, color: '#9aa0b4', marginTop: 3 },
  budgetBox: { flex: 1, minWidth: 160 },
  budgetTop: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9aa0b4', marginBottom: 4 },
  boardBtns: { display: 'flex', gap: 8 },
  floorWrap: { height: 300, borderRadius: 14, overflow: 'hidden', border: '1px solid #23252f', background: '#0a0b12' },
  floorEmpty: { display: 'grid', placeItems: 'center', height: '100%', padding: 24, textAlign: 'center', color: '#6b7088', fontSize: 14, lineHeight: 1.5 },
  boardSub: { margin: '6px 2px 0', fontSize: 12, color: '#8a90a8', textTransform: 'uppercase', letterSpacing: 0.6 },
  chipGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(146px, 1fr))', gap: 8 },
  deployChip: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: '#1a1c26', border: '2px solid', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: '#e8eaf2' },
  benchChip: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: '#101119', border: '1px solid #23252f', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: '#cdd2e0' },
  chipNick: { fontSize: 14, fontWeight: 700 },
  chipProd: { fontSize: 12, color: '#9aa0b4', fontWeight: 600 },
  chipMeta: { fontSize: 11, color: '#6b7088' },
  emptyHint: { gridColumn: '1 / -1', fontSize: 13, color: '#6b7088', fontStyle: 'italic', padding: '8px 2px' },
  relicPanel: { display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(90deg, #1f1a0e, #14151c)', border: '1px solid #6b5a2a', borderRadius: 12, padding: 14 },
  summonBtn: { background: 'linear-gradient(90deg,#ffce5c,#ff9d5c)', color: '#2a1d00', border: 'none', borderRadius: 8, padding: '10px 14px', fontWeight: 800, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  recipeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 10 },
  recipeCard: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, background: '#14151c', border: '2px solid', borderRadius: 12, padding: 12 },
  recipeFlow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 },
  flowOp: { color: '#6b7088', fontSize: 14, fontWeight: 700 },
  gemChip: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 56 },
  gemChipDot: { width: 26, height: 26, borderRadius: '50%', boxShadow: '0 0 10px rgba(0,0,0,0.4)' },
  gemChipName: { fontSize: 11, color: '#cdd2e0', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 56 },
  forgeBtn: { background: '#2a2c3a', color: '#fff', border: '1px solid #3a3d4f', borderRadius: 8, padding: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  discoveredTag: { position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#5fe0c6' },

  // ── Shop / Ledger / Settings ──
  sceneSwatch: { display: 'flex', height: 38, borderRadius: 8, overflow: 'hidden', border: '1px solid #23252f' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 },
  statCard: { display: 'flex', flexDirection: 'column', gap: 2, background: '#14151c', border: '1px solid #23252f', borderRadius: 10, padding: '10px 12px' },
  statVal: { fontSize: 20, fontWeight: 800, color: '#e8eaf2' },
  statLbl: { fontSize: 11, color: '#8a90a8' },
  settingsCard: { width: 'min(560px, 94vw)', maxHeight: '86vh', overflow: 'auto', background: '#101119', border: '1px solid #2a2c3a', borderRadius: 14, padding: 16 },
  settingsHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  settingsTabs: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  settingsBody: { minHeight: 140 },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1c1e2a', color: '#cdd2e0', fontSize: 14 },
  attrList: { margin: '0 0 4px', paddingLeft: 18 },
  kinBox: { marginTop: 6, padding: '8px 10px', background: '#0e0f17', border: '1px solid #23252f', borderRadius: 10, textAlign: 'left' },
  kinHead: { fontSize: 11, color: '#ff9ecf', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  kinRow: { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12, lineHeight: 1.5 },
  kinType: { color: '#8a90a8', fontSize: 10, textTransform: 'uppercase', width: 56, flexShrink: 0 },
  kinNote: { color: '#9aa0b4', overflow: 'hidden', textOverflow: 'ellipsis' },
}
