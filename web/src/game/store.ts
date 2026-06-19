import { create } from 'zustand'
import init, { Game, shapes_json, recipes_json, upgrades_json, milestones_json, facets_json, banners_json, core_version } from 'shipshape-core'
import { sfxPull, sfxForge, sfxMilestone, sfxAscend, sfxBondUp } from '../audio'
import { useFloaters } from '../juice'
import { glyphOf } from '../content/glyphs'

const screenCx = () => (typeof window !== 'undefined' ? window.innerWidth / 2 : 500)

const SHARD_C = '#5ad4ff'
const FLUX_C = '#ffcf6b'
const RELIC_C = '#ffd76b'
const floatTopRight = () => (typeof window !== 'undefined' ? window.innerWidth - 130 : 600)
const floatShards = (n: number) => {
  if (n > 0) useFloaters.getState().spawn(`+${n} ◈`, { color: SHARD_C, x: floatTopRight(), y: 64 })
}

// ── Types mirrored from the Rust core (the WASM layer is the source of truth) ──
export type RarityName = 'Common' | 'Rare' | 'Epic' | 'Ssr' | 'Ur' | 'Relic'

export interface ShapeRow {
  id: number
  nick: string
  family: string
  rarity: RarityName
  genus: number
  euler_cost: number
  prod: number
}

export interface View {
  flux: number
  rate_per_hr: number
  shards: number
  owned: number[]
  distinct_owned: number
  loadout: number[]
  euler_used: number
  euler_cap: number
  viewport_dim: number
  ng_cycle: number
  prestige_mult: number
  pity_since_top: number
  resonance: number
  total_pulls: number
  can_pull: boolean
  core_complete: boolean
  bonds: number[]
  bond_levels: number[]
  discovered: boolean[]
  platonic_set: boolean
  relics_owned: number
  relic_count: number
  relic_cost: number
  cosmetics: number[]
  scene: number
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

function now() {
  return performance.timeOrigin + performance.now()
}

function persist() {
  if (game) localStorage.setItem(SAVE_KEY, game.serialize())
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
  inspect: (id: number) => void
  pat: (id: number) => void
  forge: (a: number, b: number) => void
  claimRelic: () => void
  devOpen: boolean
  toggleDev: () => void
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void
  autoPull: boolean
  toggleAutoPull: () => void
  secretaryId: number | null
  setSecretary: (id: number | null) => void
  devAddFlux: () => void
  devAddShards: () => void
  devUnlockAll: () => void
  resetSave: () => void
  buyCosmetic: (id: number, cost: number) => void
  buyUpgrade: (id: number) => void
  buyFacetPerk: (id: number) => void
  setBanner: (id: number) => void
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
  devOpen: false,
  settingsOpen: false,
  autoPull: typeof localStorage !== 'undefined' && localStorage.getItem('shipshape-autopull') === '1',
  secretaryId: typeof localStorage !== 'undefined' && localStorage.getItem('shipshape-secretary') != null ? Number(localStorage.getItem('shipshape-secretary')) : null,
  fluxHistory: [],
  milestoneToast: null,

  boot: async () => {
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
            if (out.is_new) useFloaters.getState().spawn('NEW ★', { color: '#ff5d8f', big: true })
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
    }
  },

  deploy: (id) => {
    if (game?.deploy(id)) {
      get().refresh()
      persist()
    }
  },
  undeploy: (id) => {
    if (game?.undeploy(id)) {
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
      const cx = screenCx()
      const ng = get().view?.ng_cycle ?? 1
      useFloaters.getState().spawn(`NEW GAME+${ng} 🌌`, { color: '#b388ff', big: true, x: cx, y: 170 })
      for (let k = 0; k < 12; k++) {
        useFloaters.getState().spawn(k % 2 ? '✦' : '🌌', { color: k % 2 ? FLUX_C : '#b388ff', big: true, x: cx + (k - 6) * 26, y: 210 })
      }
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
  forge: (a, b) => {
    if (!game) return
    const r = JSON.parse(game.forge(a, b)) as ForgeResult
    if (r.ok) {
      get().refresh()
      persist()
      sfxForge()
      set({ lastForge: r })
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
  claimRelic: () => {
    if (!game) return
    const id = game.claim_relic()
    if (id >= 0) {
      get().refresh()
      persist()
      set({ lastForge: { ok: true, out_id: id, is_discovery: true } }) // reuse the reveal toast
      useFloaters.getState().spawn('RELIC ★', { color: RELIC_C, big: true, y: 120 })
    }
  },
  toggleDev: () => set((s) => ({ devOpen: !s.devOpen })),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  toggleAutoPull: () => {
    const v = !get().autoPull
    try {
      localStorage.setItem('shipshape-autopull', v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ autoPull: v })
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
  resetSave: () => {
    localStorage.removeItem(SAVE_KEY)
    location.reload()
  },
  buyCosmetic: (id, cost) => {
    if (game?.buy_cosmetic(id, cost)) {
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
  selectScene: (id) => {
    if (game?.select_scene(id)) {
      get().refresh()
      persist()
    }
  },
  dismissWelcome: () => set({ firstLaunch: false }),
  dismissMilestone: () => set({ milestoneToast: null }),
  dismissReveal: () => set({ lastReveal: null }),
  dismissForge: () => set({ lastForge: null }),
  dismissOffline: () => {
    const o = get().offline
    if (o) useFloaters.getState().spawn(`+${Math.round(o.gained_flux)} ✦`, { color: FLUX_C, x: 150, y: 64 })
    set({ offline: null })
  },
}))

export const RARITY_ORDER: RarityName[] = ['Common', 'Rare', 'Epic', 'Ssr', 'Ur', 'Relic']
