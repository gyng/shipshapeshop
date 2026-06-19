import { create } from 'zustand'
import init, { Game, shapes_json, recipes_json, core_version } from 'shipshape-core'
import { sfxPull, sfxReveal, sfxForge, rarityRank } from '../audio'
import { useFloaters } from '../juice'

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
  forge: (a: number, b: number) => void
  claimRelic: () => void
  devOpen: boolean
  toggleDev: () => void
  devAddFlux: () => void
  devAddShards: () => void
  devUnlockAll: () => void
  resetSave: () => void
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
  view: null,
  lastReveal: null,
  lastForge: null,
  offline: null,
  devOpen: false,

  boot: async () => {
    await init()
    const shapes = JSON.parse(shapes_json()) as ShapeRow[]
    const recipes = JSON.parse(recipes_json()) as Recipe[]
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
    set({ ready: true, firstLaunch: !saved, version: core_version(), shapes, recipes, offline })
    get().refresh()
    persist()
    // idle tick: advance the economy on a slow cadence (display is extrapolated in the HUD)
    setInterval(() => {
      if (!game) return
      game.tick(now())
      get().refresh()
    }, 1000)
    setInterval(persist, 5000)
    window.addEventListener('pagehide', persist)
  },

  refresh: () => {
    if (game) set({ view: JSON.parse(game.view()) as View })
  },

  pull: () => {
    if (!game) return
    sfxPull()
    const out = JSON.parse(game.pull(now())) as PullOutcome
    if (out.ok) {
      get().refresh()
      persist()
      sfxReveal(rarityRank(out.rarity))
      set({ lastReveal: [out] })
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
      sfxReveal(Math.max(...outs.map((o) => rarityRank(o.rarity))))
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
    }
  },
  inspect: (id) => {
    game?.inspect(id)
    get().refresh()
    persist()
  },
  forge: (a, b) => {
    if (!game) return
    const r = JSON.parse(game.forge(a, b)) as ForgeResult
    if (r.ok) {
      get().refresh()
      persist()
      sfxForge()
      set({ lastForge: r })
      if (r.is_discovery) useFloaters.getState().spawn('Discovery! +100 ◈', { color: SHARD_C, big: true, y: 120 })
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
  dismissWelcome: () => set({ firstLaunch: false }),
  dismissReveal: () => set({ lastReveal: null }),
  dismissForge: () => set({ lastForge: null }),
  dismissOffline: () => {
    const o = get().offline
    if (o) useFloaters.getState().spawn(`+${Math.round(o.gained_flux)} ✦`, { color: FLUX_C, x: 150, y: 64 })
    set({ offline: null })
  },
}))

export const RARITY_ORDER: RarityName[] = ['Common', 'Rare', 'Epic', 'Ssr', 'Ur', 'Relic']
