import { create } from 'zustand'
import init, { Game, shapes_json, recipes_json, upgrades_json, milestones_json, facets_json, banners_json, core_version } from 'shipshape-core'
import { sfxPull, sfxForge, sfxMilestone, sfxAscend, sfxBondUp, sfxDeploy, sfxRecall, sfxTap, sfxPat, sfxDrop } from '../audio'
import { useFloaters, useMascotCheer } from '../juice'
import { glyphOf } from '../content/glyphs'
import { MILESTONE_INFO } from '../content/milestones'
import { useHistory } from '../history'

const screenCx = () => (typeof window !== 'undefined' ? window.innerWidth / 2 : 500)

const SHARD_C = '#5ad4ff'
const FLUX_C = '#ffcf6b'
const RELIC_C = '#ffd76b'
const floatTopRight = () => (typeof window !== 'undefined' ? window.innerWidth - 130 : 600)
const floatShards = (n: number) => {
  if (n > 0) useFloaters.getState().spawn(`+${n} ◈`, { color: SHARD_C, x: floatTopRight(), y: 64 })
}

// ── Types mirrored from the Rust core (the WASM layer is the source of truth) ──
export type RarityName = 'Common' | 'Rare' | 'Epic' | 'Ssr' | 'Ur' | 'Relic' | 'Meta' | 'Transcendent'

export interface ShapeRow {
  id: number
  nick: string
  family: string
  rarity: RarityName
  genus: number
  euler_cost: number
  orientable: boolean // declared topology invariant (from core); drives the orrery "flip" timbre
  forgeable: boolean // is a connected-sum-able surface — drives the forge bench picker
  prod: number
}

export interface View {
  flux: number
  rate_per_hr: number
  shards: number
  owned: number[]
  distinct_owned: number
  loadout: number[]
  board_cells: number[]
  board_w: number
  board_h: number
  euler_used: number
  euler_cap: number
  viewport_dim: number
  ng_cycle: number
  prestige_mult: number
  pity_since_top: number
  resonance: number
  total_pulls: number
  can_pull: boolean
  can_ten_pull: boolean
  pull_cost: number
  ten_pull_cost: number
  core_complete: boolean
  bonds: number[]
  bond_levels: number[]
  discovered: boolean[]
  forged: boolean[]
  platonic_set: boolean
  relics_owned: number
  relic_count: number
  pull_count: number // pullable-core size — the "all N core shapes" completion denominator (was hardcoded 41)
  relic_cost: number
  recipe_costs: number[] // shards to forge each recipe right now (rarity-scaled, mastery-applied) — Rust truth
  cosmetics: number[]
  scene: number
  equipped: number[]
  lifetime_flux: number
  lifetime_shards: number
  total_forges: number
  pulls_by_rarity: number[]
  created_ms: number
  last_seen_ms: number
  active_synergies: number
  upgrades: number[]
  milestones_done: boolean[]
  facets: number
  facet_perks: number[]
  current_banner: number
  star_levels: number[]
  mult_prestige: number
  mult_set: number
  mult_bond: number
  mult_synergy: number
  mult_genus_res: number
  mult_milestone: number
  mult_facet: number
  mult_ballast: number
  mult_crossdim: number
  mult_signature: number
  mult_shape_effects: number
  upgrade_costs: [number, number][]
  upgrade_unlocked: boolean[]
  facet_perk_costs: number[]
  use_orrery: boolean
  orrery_radius: number
  orrery_cell_cap: number
  orrery_cells: [number, number][]
  orrery_period: number
  orrery_tick_ms: number
  flux_emitters: FluxEmitter[]
  flux_contrib: number[]
  flux_amp: number[]
}

// One stationary shape on the hex grid (parallel to loadout): where it sits, which way it faces, how it emits
// flux, and what it does to flux passing through it. The 3D mirrors emission/trace for the visuals.
export type FluxAct = 'pass' | 'multiply' | 'redirect' | 'split' | 'amplify' | 'absorb'
export interface FluxEmitter {
  cell: [number, number]
  dir: number
  phase: number
  emit: 'beam' | 'rotating' | 'scatter' | 'pulse'
  act: FluxAct
  act_mult: number
  act_turn: number
  act2: FluxAct
  act2_mult: number
  act2_turn: number
  amount: number
  tuned: boolean
}

export interface BannerDef {
  key: string
  featured: number[]
  rotating: boolean
}

export interface UpgradeDef {
  key: string
  flux_cost: number
  shard_cost: number
  max_level: number
  requires: [number, number] | null
  secret: boolean
}

export interface MilestoneDef {
  key: string
  bonus: number
}

export interface FacetDef {
  key: string
  cost: number
  max_level: number
}

export interface Recipe {
  a: number
  b: number
  out: number
  a_nick: string
  b_nick: string
  out_nick: string
}

export interface ForgeResult {
  ok: boolean
  out_id: number
  is_discovery: boolean
}

export interface PullOutcome {
  ok: boolean
  shape_id: number
  rarity: RarityName | null
  is_new: boolean
  dupe_shards: number
  spark_shape_id: number
  spark_is_new: boolean
}

export interface OfflineReport {
  elapsed_ms: number
  capped_ms: number
  gained_flux: number
}

const SAVE_KEY = 'shipshape-save-v1'

// The wasm Game object lives outside React state (it isn't serialisable); the store mirrors its views.
let game: Game | null = null
// boot() must run exactly once. React StrictMode (dev) double-invokes the mounting effect, which would
// otherwise build two Game objects (orphaning the first for GC → its wasm ptr is freed, and any lingering
// call then traps in ref_mut_from_abi) and two uncleared tick intervals. This synchronous guard (set before
// the first await) makes boot idempotent regardless of how the double-invoke is timed.
let booted = false
// Set by resetSave before it reloads: without this, the `pagehide` listener and the 5s autosave fire one
// last time during the reload and re-serialize the still-in-memory game, restoring the save we just wiped.
let resetting = false

function now() {
  return performance.timeOrigin + performance.now()
}

function persist() {
  if (resetting) return
  if (game) localStorage.setItem(SAVE_KEY, game.serialize())
}

// Record a pull into the (display-only) gacha history log.
function recPull(shapes: ShapeRow[], out: PullOutcome) {
  const sh = shapes[out.shape_id]
  if (sh && out.rarity) useHistory.getState().recordPull({ id: out.shape_id, nick: sh.nick, rarity: out.rarity, isNew: out.is_new })
}

interface Store {
  ready: boolean
  firstLaunch: boolean
  version: string
  shapes: ShapeRow[]
  recipes: Recipe[]
  upgradeDefs: UpgradeDef[]
  milestoneDefs: MilestoneDef[]
  facetDefs: FacetDef[]
  bannerDefs: BannerDef[]
  view: View | null
  lastReveal: PullOutcome[] | null
  lastForge: ForgeResult | null
  offline: OfflineReport | null
  boot: () => Promise<void>
  dismissWelcome: () => void
  refresh: () => void
  pull: () => void
  tenPull: () => void
  deploy: (id: number) => void
  undeploy: (id: number) => void
  autoArrange: () => void
  recrystallize: () => void
  ascended: number | null // the viewport dimension just ascended INTO (drives the post-ascension "what's new" modal); null = none
  dismissAscension: () => void
  inspect: (id: number) => void
  pat: (id: number) => void
  tapShape: (id: number) => number
  placeAt: (id: number, cell: number) => void
  forge: (a: number, b: number) => void
  previewForge: (a: number, b: number) => number
  forgeCostFor: (a: number, b: number) => number
  claimRelic: () => void
  devOpen: boolean
  toggleDev: () => void
  settingsOpen: boolean
  settingsTab: string | null // when set on open, deep-links the Settings modal to a tab (e.g. 'audio')
  setSettingsOpen: (v: boolean, tab?: string) => void
  autoPull: boolean
  toggleAutoPull: () => void
  autoForge: boolean
  toggleAutoForge: () => void
  activeTab: string // the main screen currently shown (mirrored from App) — lets the tick pop forge reveals only while you're watching the Forge
  setActiveTab: (t: string) => void
  secretaryId: number | null
  setSecretary: (id: number | null) => void
  devAddFlux: () => void
  devAddShards: () => void
  devUnlockAll: () => void
  devOrreryPreset: (tier: number) => void
  resetSave: () => void
  exportSave: () => string
  importSave: (text: string) => boolean
  buyCosmetic: (id: number, cost: number) => void
  buyCosmeticSlot: (id: number, slot: number, cost: number) => void
  equipCosmeticSlot: (id: number, slot: number) => void
  buyUpgrade: (id: number) => void
  buyFacetPerk: (id: number) => void
  setBanner: (id: number) => void
  setUseOrrery: (on: boolean) => void
  setAnchor: (id: number, q: number, r: number) => void
  rotateLane: (id: number) => void
  setPhase: (id: number, phase: number) => void
  resetOrbit: (id: number) => void
  selectScene: (id: number) => void
  fluxHistory: number[]
  milestoneToast: number | null
  dismissMilestone: () => void
  dismissReveal: () => void
  dismissForge: () => void
  dismissOffline: () => void
}

export const useGame = create<Store>((set, get) => ({
  ready: false,
  firstLaunch: false,
  version: '',
  shapes: [],
  recipes: [],
  upgradeDefs: [],
  milestoneDefs: [],
  facetDefs: [],
  bannerDefs: [],
  view: null,
  lastReveal: null,
  lastForge: null,
  offline: null,
  activeTab: '',
  setActiveTab: (t) => set({ activeTab: t }),
  devOpen: false,
  settingsOpen: false,
  settingsTab: null,
  autoPull: typeof localStorage !== 'undefined' && localStorage.getItem('shipshape-autopull') === '1',
  autoForge: typeof localStorage !== 'undefined' && localStorage.getItem('shipshape-autoforge') === '1',
  secretaryId: typeof localStorage !== 'undefined' && localStorage.getItem('shipshape-secretary') != null ? Number(localStorage.getItem('shipshape-secretary')) : null,
  fluxHistory: [],
  milestoneToast: null,

  boot: async () => {
    if (booted) return // idempotent: survive StrictMode's double-invoke (see `booted` above)
    booted = true
    await init()
    const shapes = JSON.parse(shapes_json()) as ShapeRow[]
    const recipes = JSON.parse(recipes_json()) as Recipe[]
    const upgradeDefs = JSON.parse(upgrades_json()) as UpgradeDef[]
    const milestoneDefs = JSON.parse(milestones_json()) as MilestoneDef[]
    const facetDefs = JSON.parse(facets_json()) as FacetDef[]
    const bannerDefs = JSON.parse(banners_json()) as BannerDef[]
    const saved = localStorage.getItem(SAVE_KEY)
    let offline: OfflineReport | null = null
    if (saved) {
      try {
        game = Game.from_save(saved, now())
        offline = JSON.parse(game.compute_offline(now())) as OfflineReport
        if (offline.gained_flux < 1) offline = null
      } catch {
        game = null
      }
    }
    if (!game) {
      const seed = Math.floor(Math.random() * 2 ** 48)
      game = new Game(seed, now())
    }
    // The Orrery is the default (and only) engine now — the static floor has no opt-out UI. New games already
    // default to it; this also adopts it for existing saves that were created on the old static-floor default.
    // (After compute_offline above, so a returning player's catch-up is unaffected by the switch.)
    game.set_use_orrery(true, now())
    set({ ready: true, firstLaunch: !saved, version: core_version(), shapes, recipes, upgradeDefs, milestoneDefs, facetDefs, bannerDefs, offline })
    get().refresh()
    persist()
    // idle tick: advance the economy on a slow cadence (display is extrapolated in the HUD)
    setInterval(() => {
      if (!game) return
      game.tick(now())
      get().refresh()
      const v = get().view
      if (v) {
        set((s) => ({ fluxHistory: [...s.fluxHistory, v.flux].slice(-120) }))
        // auto-pull: once unlocked + toggled on, spend spare Flux silently (no reveal ceremony)
        if (get().autoPull && v.upgrades[8] > 0 && v.can_pull) {
          const out = JSON.parse(game.pull(now())) as PullOutcome
          if (out.ok) {
            get().refresh()
            persist()
            floatShards(out.dupe_shards)
            recPull(get().shapes, out)
            if (out.is_new) useFloaters.getState().spawn('NEW ★', { color: '#ff5d8f', big: true })
          }
        }
        // auto-forge: quietly complete any recipe you can afford but haven't discovered yet — one per tick,
        // no reveal modal. BOUNDED to undiscovered recipes, so it never endlessly drains shards.
        if (get().autoForge) {
          const recs = get().recipes
          const idx = recs.findIndex((r, i) => !v.discovered[i] && v.owned[r.a] > 0 && v.owned[r.b] > 0 && v.shards >= (v.recipe_costs[i] ?? Infinity))
          if (idx >= 0) {
            const r = JSON.parse(game.forge(recs[idx].a, recs[idx].b)) as ForgeResult
            if (r.ok) {
              get().refresh()
              persist()
              sfxForge()
              const fout = get().shapes[r.out_id]
              if (fout) useHistory.getState().recordEvent({ icon: '🔨', text: `Auto-forged ${fout.nick}${r.is_discovery ? ' — discovered!' : ''}`, color: r.is_discovery ? '#5fe0c6' : undefined })
              if (r.is_discovery) useFloaters.getState().spawn('Discovery! +100 ◈', { color: SHARD_C, big: true, y: 120 })
              // pop the forged-shape reveal only while you're actually watching the Forge (no interruptions elsewhere)
              if (get().activeTab === 'forge') set({ lastForge: r })
            }
          }
        }
      }
    }, 1000)
    setInterval(persist, 5000)
    window.addEventListener('pagehide', persist)
  },

  refresh: () => {
    if (!game) return
    const v = JSON.parse(game.view()) as View
    const prev = get().view?.milestones_done
    if (prev) {
      for (let i = 0; i < v.milestones_done.length; i++) {
        if (v.milestones_done[i] && !prev[i]) {
          useFloaters.getState().spawn('🏆', { color: '#ffd76b', big: true, y: 150 })
          sfxMilestone()
          set({ milestoneToast: i })
          const mkey = get().milestoneDefs[i]?.key
          const mname = mkey ? (MILESTONE_INFO[mkey]?.name ?? mkey) : ''
          useHistory.getState().recordEvent({ icon: '🏆', text: `Milestone — ${mname}`, color: '#ffd76b' })
        }
      }
    }
    set({ view: v })
  },

  pull: () => {
    if (!game) return
    sfxPull()
    const out = JSON.parse(game.pull(now())) as PullOutcome
    if (out.ok) {
      get().refresh()
      persist()
      set({ lastReveal: [out] }) // the RevealModal owns the charge→reveal ceremony + its sounds
      floatShards(out.dupe_shards)
      recPull(get().shapes, out)
    }
  },

  tenPull: () => {
    if (!game) return
    sfxPull()
    const outs = JSON.parse(game.ten_pull(now())) as PullOutcome[]
    if (outs.length > 0) {
      get().refresh()
      persist()
      set({ lastReveal: outs })
      floatShards(outs.reduce((a, o) => a + o.dupe_shards, 0))
      outs.forEach((o) => recPull(get().shapes, o))
    }
  },

  deploy: (id) => {
    if (game?.deploy(id)) {
      sfxDeploy()
      get().refresh()
      persist()
    }
  },
  undeploy: (id) => {
    if (game?.undeploy(id)) {
      sfxRecall()
      get().refresh()
      persist()
    }
  },
  autoArrange: () => {
    game?.auto_arrange()
    get().refresh()
    persist()
  },
  recrystallize: () => {
    if (game?.recrystallize()) {
      get().refresh()
      persist()
      // Ascension is the second-biggest moment in the game — celebrate it loudly.
      sfxAscend()
      useHistory.getState().recordEvent({ icon: '🌌', text: `Ascended into dimension v${get().view?.viewport_dim ?? ''} (New Game+${get().view?.ng_cycle ?? ''})`, color: '#b388ff' })
      const cx = screenCx()
      const ng = get().view?.ng_cycle ?? 1
      useFloaters.getState().spawn(`NEW GAME+${ng} 🌌`, { color: '#b388ff', big: true, x: cx, y: 170 })
      for (let k = 0; k < 12; k++) {
        useFloaters.getState().spawn(k % 2 ? '✦' : '🌌', { color: k % 2 ? FLUX_C : '#b388ff', big: true, x: cx + (k - 6) * 26, y: 210 })
      }
      set({ ascended: get().view?.viewport_dim ?? null }) // pop the "what's new at this dimension" modal
    }
  },
  inspect: (id) => {
    game?.inspect(id)
    get().refresh()
    persist()
  },
  pat: (id) => {
    if (game) {
      const before = get().view?.bond_levels[id] ?? 0
      game.pat(id)
      sfxPat() // a gentle touch on every pat (the bond-up chime still fires on a level)
      get().refresh() // rate-limited in the UI; the 5s autosave persists it
      const after = get().view?.bond_levels[id] ?? 0
      if (after > before) {
        // Bond level-up: a warm chime + a flutter of hearts (the SDT-relatedness payoff).
        sfxBondUp()
        const cx = screenCx()
        for (let k = 0; k < 6; k++) useFloaters.getState().spawn('♥', { color: '#ff5d8f', big: true, x: cx + (k - 3) * 22, y: 250 })
        persist()
      }
    }
  },
  tapShape: (id) => {
    if (!game) return 0
    const r = game.tap_shape(id)
    if (r > 0) {
      sfxTap()
      get().refresh()
      persist()
    }
    return r
  },
  placeAt: (id, cell) => {
    if (game?.place_at(id, cell)) {
      sfxDrop()
      get().refresh()
      persist()
    }
  },
  forge: (a, b) => {
    if (!game) return
    const r = JSON.parse(game.forge(a, b)) as ForgeResult
    if (r.ok) {
      get().refresh()
      persist()
      sfxForge()
      set({ lastForge: r })
      useMascotCheer.getState().cheer() // the forge-keeper mascot reacts (sparks + a "thanks" line)
      {
        const fout = get().shapes[r.out_id]
        if (fout) useHistory.getState().recordEvent({ icon: '🔨', text: `Forged ${fout.nick}${r.is_discovery ? ' — new recipe discovered!' : ''}`, color: r.is_discovery ? '#5fe0c6' : undefined })
      }
      if (r.is_discovery) {
        useFloaters.getState().spawn('Discovery! +100 ◈', { color: SHARD_C, big: true, y: 120 })
        // a shower of the newly-discovered shape's glyph — parity with the pull reveal
        const out = get().shapes[r.out_id]
        if (out) {
          const cx = screenCx()
          for (let k = 0; k < 7; k++) {
            const j = k
            setTimeout(() => useFloaters.getState().spawn(glyphOf(out.family), { color: FLUX_C, big: true, x: cx + (j - 3) * 26, y: 200 }), k * 60)
          }
        }
      }
    }
  },
  // Read-only preview for the free-form bench: the shape id A # B would produce, or -1 if it can't be forged.
  previewForge: (a, b) => (game ? game.preview_forge(a, b) : -1),
  // Read-only: shards it would cost to forge A # B right now (0 if not forgeable) — never recomputed in TS.
  // (wasm marshals the u64 as a bigint; the store mirrors it as a plain number.)
  forgeCostFor: (a, b) => (game ? Number(game.forge_cost(a, b)) : 0),
  claimRelic: () => {
    if (!game) return
    const id = game.claim_relic()
    if (id >= 0) {
      get().refresh()
      persist()
      set({ lastForge: { ok: true, out_id: id, is_discovery: true } }) // reuse the reveal toast
      useFloaters.getState().spawn('RELIC ★', { color: RELIC_C, big: true, y: 120 })
      const rsh = get().shapes[id]
      useHistory.getState().recordEvent({ icon: '★', text: `Summoned the relic ${rsh?.nick ?? ''}`.trim(), color: RELIC_C })
    }
  },
  toggleDev: () => set((s) => ({ devOpen: !s.devOpen })),
  setSettingsOpen: (v, tab) => set({ settingsOpen: v, settingsTab: v ? (tab ?? null) : null }),
  toggleAutoPull: () => {
    const v = !get().autoPull
    try {
      localStorage.setItem('shipshape-autopull', v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ autoPull: v })
  },
  toggleAutoForge: () => {
    const v = !get().autoForge
    try {
      localStorage.setItem('shipshape-autoforge', v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ autoForge: v })
  },
  setSecretary: (id) => {
    try {
      if (id == null) localStorage.removeItem('shipshape-secretary')
      else localStorage.setItem('shipshape-secretary', String(id))
    } catch {
      /* ignore */
    }
    set({ secretaryId: id })
  },
  devAddFlux: () => {
    game?.dev_add_flux(10000)
    get().refresh()
    persist()
  },
  devAddShards: () => {
    game?.dev_add_shards(2000)
    get().refresh()
    persist()
  },
  devUnlockAll: () => {
    game?.dev_unlock_all()
    get().refresh()
    persist()
  },
  devOrreryPreset: (tier: number) => {
    game?.dev_orrery_preset(tier)
    get().refresh()
    persist()
  },
  resetSave: () => {
    resetting = true // stop the autosave/pagehide from re-persisting the in-memory game during the reload
    // the authoritative save…
    localStorage.removeItem(SAVE_KEY)
    // …plus every bit of player progress that lives in its own key outside the core save:
    localStorage.removeItem('shipshape-secretary') // equipped secretary
    localStorage.removeItem('shipshape-autopull') // auto-pull toggle
    localStorage.removeItem('shipshape-autoforge') // auto-forge toggle
    localStorage.removeItem('shapegacha.title') // equipped title (cosmetic)
    localStorage.removeItem('shapegacha.pulls') // pull history
    localStorage.removeItem('shapegacha.events') // event history (the Ledger activity feed)
    localStorage.removeItem('shipshape-ships-v1') // seen ship cutscenes
    location.reload()
  },
  // Portable backup: the authoritative core save (game.serialize) wrapped with the gameplay-relevant UI prefs.
  exportSave: () => {
    if (!game) return ''
    const env = {
      app: 'shape-gacha',
      exported: new Date().toISOString(),
      game: game.serialize(),
      secretary: get().secretaryId,
      autopull: get().autoPull,
      autoforge: get().autoForge,
      title: Number(localStorage.getItem('shapegacha.title')) || 0,
    }
    return JSON.stringify(env)
  },
  importSave: (text) => {
    try {
      let raw = text.trim()
      let env: { game?: string; secretary?: number | null; autopull?: boolean; autoforge?: boolean; title?: number } | null = null
      if (raw.startsWith('{') && raw.includes('"game"')) {
        env = JSON.parse(raw)
        if (env && typeof env.game === 'string') raw = env.game
      }
      const g = Game.from_save(raw, now()) // throws on invalid/corrupt/newer-schema
      game = g
      localStorage.setItem(SAVE_KEY, raw)
      if (env) {
        if (env.secretary == null) localStorage.removeItem('shipshape-secretary')
        else localStorage.setItem('shipshape-secretary', String(env.secretary))
        if (env.autopull != null) localStorage.setItem('shipshape-autopull', env.autopull ? '1' : '0')
        if (env.autoforge != null) localStorage.setItem('shipshape-autoforge', env.autoforge ? '1' : '0')
        if (Number.isInteger(env.title)) localStorage.setItem('shapegacha.title', String(env.title))
      }
      location.reload()
      return true
    } catch {
      return false
    }
  },
  buyCosmetic: (id, cost) => {
    if (game?.buy_cosmetic(id, cost)) {
      get().refresh()
      persist()
    }
  },
  buyCosmeticSlot: (id, slot, cost) => {
    if (game?.buy_cosmetic_slot(id, slot, cost)) {
      get().refresh()
      persist()
    }
  },
  equipCosmeticSlot: (id, slot) => {
    if (game?.equip_cosmetic_slot(id, slot)) {
      get().refresh()
      persist()
    }
  },
  buyUpgrade: (id) => {
    if (game?.buy_upgrade(id)) {
      get().refresh()
      persist()
    }
  },
  buyFacetPerk: (id) => {
    if (game?.buy_facet_perk(id)) {
      get().refresh()
      persist()
    }
  },
  setBanner: (id) => {
    game?.set_banner(id)
    get().refresh()
    persist()
  },
  setUseOrrery: (on) => {
    game?.set_use_orrery(on, Date.now())
    get().refresh()
    persist()
  },
  setAnchor: (id, q, r) => {
    game?.set_anchor(id, q, r, Date.now())
    get().refresh()
    persist()
  },
  rotateLane: (id) => {
    game?.rotate_lane(id, Date.now())
    get().refresh()
    persist()
  },
  setPhase: (id, phase) => {
    game?.set_phase(id, phase, Date.now())
    get().refresh()
    persist()
  },
  resetOrbit: (id) => {
    game?.reset_orbit(id, Date.now())
    get().refresh()
    persist()
  },
  selectScene: (id) => {
    if (game?.select_scene(id)) {
      get().refresh()
      persist()
    }
  },
  dismissWelcome: () => set({ firstLaunch: false }),
  dismissMilestone: () => set({ milestoneToast: null }),
  ascended: null,
  dismissAscension: () => set({ ascended: null }),
  dismissReveal: () => set({ lastReveal: null }),
  dismissForge: () => set({ lastForge: null }),
  dismissOffline: () => {
    const o = get().offline
    if (o) useFloaters.getState().spawn(`+${Math.round(o.gained_flux)} ✦`, { color: FLUX_C, x: 150, y: 64 })
    set({ offline: null })
  },
}))

export const RARITY_ORDER: RarityName[] = ['Common', 'Rare', 'Epic', 'Ssr', 'Ur', 'Relic', 'Meta', 'Transcendent']
