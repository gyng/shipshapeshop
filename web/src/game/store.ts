import { create } from 'zustand'
import init, { Game, shapes_json, core_version } from 'shipshape-core'

// ── Types mirrored from the Rust core (the WASM layer is the source of truth) ──
export type RarityName = 'Common' | 'Rare' | 'Epic' | 'Ssr' | 'Ur'

export interface ShapeRow {
  id: number
  nick: string
  family: string
  rarity: RarityName
  genus: number
  euler_cost: number
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
  version: string
  shapes: ShapeRow[]
  view: View | null
  lastReveal: PullOutcome[] | null
  offline: OfflineReport | null
  boot: () => Promise<void>
  refresh: () => void
  pull: () => void
  tenPull: () => void
  deploy: (id: number) => void
  undeploy: (id: number) => void
  autoArrange: () => void
  recrystallize: () => void
  dismissReveal: () => void
  dismissOffline: () => void
}

export const useGame = create<Store>((set, get) => ({
  ready: false,
  version: '',
  shapes: [],
  view: null,
  lastReveal: null,
  offline: null,

  boot: async () => {
    await init()
    const shapes = JSON.parse(shapes_json()) as ShapeRow[]
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
    set({ ready: true, version: core_version(), shapes, offline })
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
    const out = JSON.parse(game.pull(now())) as PullOutcome
    if (out.ok) {
      get().refresh()
      persist()
      set({ lastReveal: [out] })
    }
  },

  tenPull: () => {
    if (!game) return
    const outs = JSON.parse(game.ten_pull(now())) as PullOutcome[]
    if (outs.length > 0) {
      get().refresh()
      persist()
      set({ lastReveal: outs })
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
  dismissReveal: () => set({ lastReveal: null }),
  dismissOffline: () => set({ offline: null }),
}))

export const RARITY_ORDER: RarityName[] = ['Common', 'Rare', 'Epic', 'Ssr', 'Ur']
