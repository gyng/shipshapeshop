import { create } from 'zustand'
import init, { Game, shapes_json, recipes_json, upgrades_json, milestones_json, facets_json, banners_json, expeditions_json, core_version } from 'shipshape-core'
import { sfxPull, sfxForge, sfxMilestone, sfxAscend, sfxBondUp, sfxDeploy, sfxRecall, sfxTap, sfxPat, sfxDrop, sfxEmbark, sfxCampfire, sfxTreasure, sfxVictory, sfxDefeat } from '../audio'
import { useFloaters, useMascotCheer } from '../juice'
import { MILESTONE_INFO } from '../content/milestones'
import { useHistory } from '../history'

const screenCx = () => (typeof window !== 'undefined' ? window.innerWidth / 2 : 500)

const SHARD_C = '#5ad4ff'
const FLUX_C = '#ffcf6b'
const RELIC_C = '#ffd76b'
const ECHO_C = '#9b8cff' // Expeditions' Echoes currency — a soft violet, distinct from Flux/Shards
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
  role: string // AUTHORITATIVE expedition role (tank/dps/support/control) from core — never re-derive in TS
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
  total_stars: number
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
  mult_euler_surplus: number // euler_surplus (#16): production bonus from UNSPENT Euler-budget headroom
  mult_crossdim: number
  mult_signature: number
  mult_shape_effects: number
  upgrade_costs: [number, number][]
  upgrade_unlocked: boolean[]
  facet_perk_costs: number[]
  overclock_on: boolean // overclock (#18) Redline toggle state
  use_orrery: boolean
  orrery_radius: number
  orrery_cell_cap: number
  orrery_cells: [number, number][]
  orrery_period: number
  orrery_tick_ms: number
  flux_emitters: FluxEmitter[]
  flux_contrib: number[]
  flux_amp: number[]
  // ── Expeditions (the opt-in idle RPG) ──
  echoes: number
  lifetime_echoes: number
  echo_rate_per_hr: number
  exp_flux_rate: number // total Flux/hr expeditions add to the idle economy (v2)
  exp_teams: TeamView[] // the player's persistent teams (multiple parties)
  exp_active_team: number
  exp_max_teams: number
  exp_party_max: number // members per team
  exp_cleared: boolean[]
  exp_perks: number[]
  exp_perk_costs: number[]
  exp_power: number[] // FULL combat/farm power per shape id (Rust truth)
  exp_stats: ExpStatView[] // per-shape base combat stats (hp/atk/def/speed/ult) for the team card (Rust truth)
  shape_levels: number[]
  shape_xp: number[]
  xp_to_next: number[]
  skill_points_free: number[]
  skill_alloc: number[][]
  shard_rate_per_hr: number
  exp_quest_flux_est: number[] // per quest: Flux/hr the active team would farm there
  // ── v5: journey map state, provisions/relics, auto, history ──
  exp_node_open: boolean[] // per quest: open to attempt (graph + dimension gate)
  exp_node_mod: number[] // per quest: chosen risk modifier (0 safe)
  exp_node_beatable: boolean[] // per node: active team wins at mod 0
  exp_auto: boolean
  prov_inv: number[] // owned provision charges
  prov_costs: number[]
  exp_relics_owned: boolean[]
  exp_relic_costs: number[]
  exp_clears_total: number
  exp_bosses_freed: number
  exp_echoes_farmed: number
  exp_flux_farmed: number
  exp_runs: ExpRunRec[]
  run: RunView | null // v6: the in-flight Delve run (clipped — no future loot/death exposed)
  can_send_run: boolean // v6: a new linear run is available to send
  run_rest_until: number // v6: wall-clock ms the party rests at base camp until (the HUD counts down; 0 = ready)
  run_history: RunRecordView[] // v6: completed-run summaries (newest first) — drives the Delve Report
  gambit_auto: boolean // v6 progression: is auto-tactics (smart empty-slot ladder) unlocked?
  gambit_conds: number[] // v6 progression: currently-unlocked gambit condition ids (the editor mirrors this)
  gambit_acts: number[] // v6 progression: currently-unlocked gambit action ids
}

export interface RunView {
  team: number
  path: number[] // route node indices
  room_kind: number[] // REVEALED room kinds (0 combat, 1 boss, 2 campfire, 3 treasure) — the delve track
  current_room: number
  total_rooms: number
  start_ms: number
  total_ms: number // estimated return time
  room_echoes: number[] // per-BANKED-room Echo lump (earned only; len == current_room) — Slice 5 reward toast
  room_flux: number[] // per-BANKED-room Flux lump (earned only; len == current_room)
  delve_echoes_per_hr: number // whole-run average Echo/hr while delving (Rust-emitted; never derived in TS)
  delve_flux_per_hr: number // whole-run average Flux/hr while delving — fixes the "shows 0/hr" gap
  pending_decision: PendingDecision | null // a live Crossroads the player can override now (else null)
}
export interface DecisionOption {
  heal_pct: number
  atk_pct: number
  echo_bonus: number
  speed_pct: number
}
export interface PendingDecision {
  room_idx: number
  deadline_ms: number // absolute wall-clock; the UI counts down to it (never derives truth)
  options: DecisionOption[] // 2–3 themed options; index `auto_option` is the safe default if the window lapses
  auto_option: number // which option idle/offline takes (always 0 — the heal)
  template: number // the themed crossroads (drives the flavor + scene)
}
export interface RunRecordView {
  team: number
  rooms: number
  echoes: number
  died: boolean
  at_ms: number
}

export interface GambitRule {
  cond: number // condition id (see exp.gcond.*)
  action: number // action id (see exp.gact.*)
  on: boolean
}
export interface Orders {
  formation: number // 0 balanced, 1 front-heavy, 2 back-heavy
  doctrine: number // 0 steady, 1 aggressive, 2 defensive
  focus: number // -1 adaptive, 0 wounded, 1 threat, 2 boss
  stance: number[] // per-slot 0 aggr 1 balanced 2 def
  gambits?: GambitRule[][] // per-slot FF12-style program; empty/absent ⇒ legacy ladder
}
export interface TeamView {
  members: number[]
  station: number // quest idx farmed, or -1 idle
  power: number
  echo_rate_per_hr: number
  flux_rate_per_hr: number
  orders: Orders
  provisions: number[] // staged provision ids
  relics: number[] // equipped relic ids
  // QW-4 team-selection aggregates (Rust-computed; UI compares teams, never recomputes)
  total_hp: number
  total_atk: number
  total_def: number
  total_speed: number
  role_counts: number[] // [tank, dps, support, control]
  element_counts: number[] // [solid, twisted, woven]
  kin_pairs: number
}
export interface ExpRunRec {
  kind: number // 0 first-clear, 1 boss freed
  quest: number
  team: number
  rounds: number
  survivors: number
  party_size: number
  echoes: number
  flux: number
  recruit_id: number
  ng_cycle: number
}

// ── Expeditions content + battle types (mirrored from the Rust core) ──
export type ExpElement = 'solid' | 'twisted' | 'woven'
export interface ExpQuest {
  key: string
  nick: string
  chapter: number
  min_dim: number
  tier: number
  power_req: number
  base_echo: number
  enemy_nicks: string[]
  boss_nick: string | null
  recruit_id: number
  recruit_nick: string | null
  dom_element: ExpElement
  kind: 'combat' | 'elite' | 'boss'
  map_xy: [number, number]
  in_edges: number[]
  out_edges: number[]
}
export interface ExpPerk {
  key: string
  base_cost: number
  max_level: number
}
export interface ProvisionRow {
  key: string
  cost: number
  eff: string
  val: number
}
export interface RelicRow {
  key: string
  cost: number
  up: string
  up_val: number
  down: string
  down_val: number
  slots: number
}
export interface NodeModRow {
  key: string
  enemy_scale_pct: number
  first_clear_mult_pct: number
}
export interface SkillNodeDef {
  key: string
  max: number
  req: [number, number] | null // (prereq node index, min rank), or null
  stat: number
  farm: number
}
export interface ExpContent {
  quests: ExpQuest[]
  perks: ExpPerk[]
  edges: [number, number][]
  provisions: ProvisionRow[]
  relics: RelicRow[]
  node_mods: NodeModRow[]
  skill_trees: SkillNodeDef[][] // R6: codegen'd from Rust SKILL_TREES — no hand-mirror to drift
}
export interface LogEvent {
  round: number
  actor: number
  action: string
  target: number
  dmg: number
  heal: number
  status: string
  fainted: number
  rule_idx?: number // RENDER-ONLY: the gambit rule (0-based) that produced this event, or -1 (legacy/fallback/enemy)
  action_id?: number // RENDER-ONLY: which ability fired (0-9, indexes GACT_KEYS), or -1 — lets the combat log name the skill
}
export interface UnitInfo {
  shape_id: number
  nick: string
  family: string
  is_enemy: boolean
  max_hp: number
  atk: number
  def: number
  speed: number
  ult_power: number
  element: ExpElement
  role: string
}
/** Per-shape base combat stats for the team card (mirror of Rust `exp_combatant`, indexed by shape id). */
export interface ExpStatView {
  max_hp: number
  atk: number
  def: number
  speed: number
  ult: number
}
export interface BattleResult {
  win: boolean
  rounds: number
  party_size: number
  party_survivors: number
  units: UnitInfo[]
  log: LogEvent[]
}
export interface StationResult {
  ok: boolean
  win: boolean
  newly_cleared: boolean
  recruited_id: number
  recruit_is_new: boolean
  echoes_gained: number
  first_clear_flux: number
  battle: BattleResult | null
}
export interface AutoExpeditionStep {
  delved: boolean
  quest: number
  recruited_id: number
  farms: number
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
  kind: import('../content/milestones').MilestoneKind
  value: number // magnitude in the effect's natural unit (fraction; or hours / floor-count / one-time flux)
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
  delve_returned?: RunRecordView | null // a delve that completed while away — surfaced as the offline peak-end beat
  gained_flux: number
  gained_echoes: number
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
  expContent: ExpContent | null
  view: View | null
  lastReveal: PullOutcome[] | null
  lastForge: ForgeResult | null
  combat: { battle: BattleResult; quest: number; result: StationResult | null } | null // active combat/watch overlay
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
  delveReport: RunRecordView | null // v6: a just-returned Delve run's summary (peak-end report); null = none
  dismissDelveReport: () => void
  inspect: (id: number) => void
  pat: (id: number) => void
  tapShape: (id: number) => number
  placeAt: (id: number, cell: number) => void
  forge: (a: number, b: number) => void
  previewForge: (a: number, b: number) => number
  forgeCostFor: (a: number, b: number) => number
  rateIfUpgrade: (id: number) => number // projected Flux/hr if upgrade `id` were one level higher (Rust truth)
  rateIfFacet: (id: number) => number
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
  devResetUnlocks: () => void
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
  setOverclock: (on: boolean) => void // overclock (#18) Redline toggle — +60% cap, offline clamped to 4h
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
  // ── Expeditions (the opt-in idle RPG) ──
  setTeam: (t: number, ids: number[]) => void
  setActiveTeam: (t: number) => void
  addTeam: () => void
  removeTeam: (t: number) => void
  sendExpedition: (t: number) => void
  station: (t: number, q: number) => void
  unstation: (t: number) => void
  watch: (q: number) => void
  watchRunRoom: (roomIdx: number) => void
  runRoomBattle: (roomIdx: number) => BattleResult | null // fetch a delve room's re-enacted battle WITHOUT opening the modal (for the live in-run view)
  stationBattle: (q: number, variant?: number) => BattleResult | null // fetch a stationed/farming team's re-enacted clear battle WITHOUT the modal (live farm view); `variant` re-seeds the cosmetic replay (#6 vary)
  spendSkillPoint: (id: number, node: number) => void
  respec: (id: number) => void
  autoSkill: (id: number) => void
  chooseDecision: (roomIdx: number, option: number) => void
  buyExpPerk: (id: number) => void
  // ── v5: routing, orders, provisions, relics, auto ──
  setNodeMod: (q: number, m: number) => void
  setOrders: (t: number, formation: number, doctrine: number, focus: number) => void
  setSlotStance: (t: number, slot: number, s: number) => void
  setGambitRule: (t: number, slot: number, idx: number, cond: number, action: number) => void
  toggleGambit: (t: number, slot: number, idx: number) => void
  moveGambit: (t: number, slot: number, idx: number, up: boolean) => void
  reorderGambit: (t: number, slot: number, from: number, to: number) => void
  addGambit: (t: number, slot: number) => void
  removeGambit: (t: number, slot: number, idx: number) => void
  resetGambits: (t: number, slot: number) => void
  autoGambits: (t: number, slot: number) => void
  buyProvision: (id: number) => void
  loadProvision: (t: number, id: number) => void
  clearProvisions: (t: number) => void
  buyRelic: (id: number) => void
  equipRelic: (t: number, id: number) => void
  unequipRelic: (t: number, id: number) => void
  setAuto: (on: boolean) => void
  devAddEchoes: () => void
  dismissCombat: () => void
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
  expContent: null,
  view: null,
  lastReveal: null,
  lastForge: null,
  combat: null,
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
    const expContent = JSON.parse(expeditions_json()) as ExpContent
    const saved = localStorage.getItem(SAVE_KEY)
    let offline: OfflineReport | null = null
    if (saved) {
      try {
        game = Game.from_save(saved, now())
        offline = JSON.parse(game.compute_offline(now())) as OfflineReport
        if (offline.gained_flux < 1 && !offline.delve_returned) offline = null // keep it if a delve returned (R9 peak-end)
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
    set({ ready: true, firstLaunch: !saved, version: core_version(), shapes, recipes, upgradeDefs, milestoneDefs, facetDefs, bannerDefs, expContent, offline })
    get().refresh()
    if (offline?.delve_returned) set({ delveReport: offline.delve_returned }) // R9: celebrate an offline-completed delve on load
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
        // auto-expedition: hands-free route the map + keep farms stationed (no combat overlay). Bounded (one
        // clear/tick). The persisted `exp_auto` (in the save, ON by default) is the single source of truth.
        if (get().view?.exp_auto) {
          const step = JSON.parse(game.auto_expedition(now())) as AutoExpeditionStep
          if (step.delved || step.recruited_id >= 0) {
            get().refresh()
            persist()
            const q = get().expContent?.quests[step.quest]
            if (q) useHistory.getState().recordEvent({ icon: '⚔️', text: `Auto-cleared ${q.nick}`, color: ECHO_C })
            if (step.recruited_id >= 0) {
              const sh = get().shapes[step.recruited_id]
              if (sh) {
                useFloaters.getState().spawn('FREED ★', { color: '#ff5d8f', big: true })
                useHistory.getState().recordEvent({ icon: '✶', text: `Freed ${sh.nick} on an expedition!`, color: '#ff5d8f' })
              }
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
    // v6: a Delve run just returned (active → none) → surface the Delve Report (peak-end "your party returned")
    const prevRun = get().view?.run
    const justReturned = !!prevRun && !v.run && v.run_history.length > 0
    // cozy-room beats: when the SAME run advanced across a campfire/treasure, play its sound (at most one each —
    // offline catch-up can jump many rooms in one tick, so we fire by kind-crossed, never per-room)
    if (prevRun && v.run && prevRun.start_ms === v.run.start_ms && v.run.current_room > prevRun.current_room) {
      let campfire = false
      let treasure = false
      for (let r = prevRun.current_room + 1; r <= v.run.current_room && r < v.run.room_kind.length; r++) {
        if (v.run.room_kind[r] === 2) campfire = true
        if (v.run.room_kind[r] === 3) treasure = true
      }
      if (campfire) sfxCampfire()
      if (treasure) sfxTreasure()
      // v6 reward toast (Slice 5): surface the loot banked across the newly-cleared room(s) — peak-end "rewards earned".
      // Sums the per-room lumps for rooms [prev, current) (offline catch-up can jump many rooms ⇒ one aggregate toast).
      let de = 0
      let df = 0
      for (let r = prevRun.current_room; r < v.run.current_room && r < v.run.room_echoes.length; r++) {
        de += v.run.room_echoes[r] ?? 0
        df += v.run.room_flux[r] ?? 0
      }
      if (de > 0) useFloaters.getState().spawn(`+${de.toLocaleString()} ✶`, { color: '#9b8cff', big: de > 50, y: 190 })
      if (df > 0) useFloaters.getState().spawn(`+${df.toLocaleString()} ✦`, { color: '#ffcf6b', big: df > 30, y: 216 })
    }
    set({ view: v, ...(justReturned ? { delveReport: v.run_history[0] } : {}) })
    if (justReturned) {
      // peak-end: celebrate a safe return (NOT the orrery goodbye blip); a wipe gets a soft defeat note
      const rep = v.run_history[0]
      if (rep.died) {
        sfxDefeat()
      } else {
        sfxVictory()
        useFloaters.getState().spawn('✶', { color: '#9b8cff', big: true, y: 150 })
      }
    }
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
            setTimeout(() => useFloaters.getState().spawn('', { family: out.family, color: FLUX_C, big: true, x: cx + (j - 3) * 26, y: 200 }), k * 60)
          }
        }
      }
    }
  },
  // Read-only preview for the free-form bench: the shape id A # B would produce, or -1 if it can't be forged.
  previewForge: (a, b) => (game ? game.preview_forge(a, b) : -1),
  // Read-only what-if for the Workshop Δ/hr badge: projected Flux/hr if upgrade/facet `id` were one level higher.
  // Rust truth (clones + bumps the level + re-evaluates rate_per_hr); the UI subtracts the current rate. No TS math.
  rateIfUpgrade: (id) => (game ? game.rate_after_upgrade(id) : 0),
  rateIfFacet: (id) => (game ? game.rate_after_facet(id) : 0),
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
    game?.dev_add_flux(1_000_000)
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
  devResetUnlocks: () => {
    game?.dev_reset_unlocks()
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
  setOverclock: (on) => {
    game?.set_overclock(on, Date.now())
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
  delveReport: null,
  dismissDelveReport: () => set({ delveReport: null }),
  dismissReveal: () => set({ lastReveal: null }),
  dismissForge: () => set({ lastForge: null }),
  dismissOffline: () => {
    const o = get().offline
    if (o) useFloaters.getState().spawn(`+${Math.round(o.gained_flux)} ✦`, { color: FLUX_C, x: 150, y: 64 })
    set({ offline: null })
  },

  // ── Expeditions (the opt-in idle RPG) ──
  setTeam: (t, ids) => {
    if (!game) return
    game.set_team(t, JSON.stringify(ids), now())
    get().refresh()
    persist()
  },
  setActiveTeam: (t) => {
    game?.set_active_team(t)
    get().refresh()
  },
  addTeam: () => {
    if (!game) return
    game.add_team(now())
    sfxTap()
    get().refresh()
    persist()
  },
  removeTeam: (t) => {
    if (game?.remove_team(t, now())) {
      get().refresh()
      persist()
    }
  },
  sendExpedition: (t) => {
    if (game?.send_expedition(t, now())) {
      sfxEmbark() // a decisive embark sting (not a generic tap) — the party sets off
      useFloaters.getState().spawn('⛏ Delving…', { color: '#9b8cff', y: 150 })
      get().refresh()
      persist()
    }
  },
  station: (t, q) => {
    if (!game) return
    const r = JSON.parse(game.station(t, q, now())) as StationResult
    if (!r.ok) return
    get().refresh()
    persist()
    // a cleared-this-call quest carries the deciding battle → open the combat overlay; else it just stationed
    if (r.battle) set({ combat: { battle: r.battle, quest: q, result: r } })
    else sfxDeploy()
    if (r.win) {
      const cx = screenCx()
      if (r.newly_cleared) {
        sfxMilestone()
        const q2 = get().expContent?.quests[q]
        useHistory.getState().recordEvent({ icon: '⚔️', text: `Cleared ${q2?.nick ?? 'a quest'} — +${r.echoes_gained} ✶ Echoes`, color: ECHO_C })
        if (r.first_clear_flux > 0) useFloaters.getState().spawn(`+${Math.round(r.first_clear_flux)} ✦`, { color: FLUX_C, x: cx, y: 150 })
      }
      if (r.echoes_gained > 0) useFloaters.getState().spawn(`+${r.echoes_gained} ✶`, { color: ECHO_C, x: cx, y: 120 })
      if (r.recruited_id >= 0 && r.recruit_is_new) {
        sfxAscend()
        const sh = get().shapes[r.recruited_id]
        useFloaters.getState().spawn('FREED ★', { color: '#ff5d8f', big: true, x: cx, y: 170 })
        if (sh) {
          for (let k = 0; k < 7; k++) setTimeout(() => useFloaters.getState().spawn('', { family: sh.family, color: ECHO_C, big: true, x: cx + (k - 3) * 26, y: 210 }), k * 60)
          useHistory.getState().recordEvent({ icon: '✶', text: `Freed ${sh.nick} from the Manifold!`, color: '#ff5d8f' })
        }
      }
    }
  },
  unstation: (t) => {
    game?.unstation(t, now())
    get().refresh()
    persist()
  },
  watch: (q) => {
    if (!game) return
    const battle = JSON.parse(game.watch_data(q, 0)) as BattleResult | null // the modal watch shows the canonical clear (variant 0)
    if (battle) set({ combat: { battle, quest: q, result: null } }) // spectator — no rewards
  },
  watchRunRoom: (roomIdx) => {
    if (!game) return
    const battle = JSON.parse(game.run_room_battle(roomIdx)) as BattleResult | null
    if (battle) set({ combat: { battle, quest: -1, result: null } }) // spectate a delve room's fight (re-enacted)
  },
  runRoomBattle: (roomIdx) => {
    if (!game) return null
    return JSON.parse(game.run_room_battle(roomIdx)) as BattleResult | null // null for non-combat rooms (campfire/treasure)
  },
  stationBattle: (q, variant = 0) => {
    if (!game) return null
    return JSON.parse(game.watch_data(q, variant >>> 0)) as BattleResult | null // re-enacted clear; `variant` re-seeds the cosmetic farm replay (#6 vary)
  },
  spendSkillPoint: (id, node) => {
    if (game?.spend_skill_point(id, node, now())) {
      sfxTap()
      get().refresh()
      persist()
    }
  },
  respec: (id) => {
    game?.respec(id, now())
    sfxTap()
    get().refresh()
    persist()
  },
  autoSkill: (id) => {
    game?.auto_skill(id, now())
    sfxTap()
    get().refresh()
    persist()
  },
  chooseDecision: (roomIdx, option) => {
    // live Crossroads override — the core re-resolves the unbanked tail; persist immediately (save-scum-proof)
    if (game?.choose_decision(roomIdx, option, now())) {
      sfxTap()
      get().refresh()
      persist()
    }
  },
  buyExpPerk: (id) => {
    if (game?.buy_exp_perk(id, now())) {
      sfxTap()
      get().refresh()
      persist()
    }
  },
  // ── v5: routing, orders, provisions, relics, auto (all thin passthroughs — Rust owns the truth) ──
  setNodeMod: (q, m) => {
    game?.set_node_mod(q, m, now())
    sfxTap()
    get().refresh()
    persist()
  },
  setOrders: (t, formation, doctrine, focus) => {
    game?.set_orders(t, formation, doctrine, focus, now())
    get().refresh()
    persist()
  },
  setSlotStance: (t, slot, s) => {
    game?.set_slot_stance(t, slot, s, now())
    get().refresh()
    persist()
  },
  setGambitRule: (t, slot, idx, cond, action) => {
    game?.set_gambit_rule(t, slot, idx, cond, action, now())
    get().refresh()
    persist()
  },
  toggleGambit: (t, slot, idx) => {
    game?.toggle_gambit(t, slot, idx, now())
    get().refresh()
    persist()
  },
  moveGambit: (t, slot, idx, up) => {
    game?.move_gambit(t, slot, idx, up, now())
    get().refresh()
    persist()
  },
  reorderGambit: (t, slot, from, to) => {
    game?.reorder_gambit(t, slot, from, to, now())
    get().refresh()
    persist()
  },
  addGambit: (t, slot) => {
    game?.add_gambit(t, slot, now())
    sfxTap()
    get().refresh()
    persist()
  },
  removeGambit: (t, slot, idx) => {
    game?.remove_gambit(t, slot, idx, now())
    get().refresh()
    persist()
  },
  resetGambits: (t, slot) => {
    game?.reset_gambits(t, slot, now())
    sfxTap()
    get().refresh()
    persist()
  },
  autoGambits: (t, slot) => {
    game?.auto_gambits(t, slot, now())
    sfxTap()
    get().refresh()
    persist()
  },
  buyProvision: (id) => {
    if (game?.buy_provision(id, now())) {
      sfxTap()
      get().refresh()
      persist()
    }
  },
  loadProvision: (t, id) => {
    if (game?.load_provision(t, id, now())) {
      sfxDeploy()
      get().refresh()
      persist()
    }
  },
  clearProvisions: (t) => {
    game?.clear_provisions(t, now())
    get().refresh()
    persist()
  },
  buyRelic: (id) => {
    if (game?.buy_relic(id, now())) {
      sfxForge()
      get().refresh()
      persist()
    }
  },
  equipRelic: (t, id) => {
    if (game?.equip_relic(t, id, now())) {
      sfxDeploy()
      get().refresh()
      persist()
    }
  },
  unequipRelic: (t, id) => {
    game?.unequip_relic(t, id, now())
    get().refresh()
    persist()
  },
  setAuto: (on) => {
    game?.set_auto(on, now())
    get().refresh()
    persist()
  },
  devAddEchoes: () => {
    game?.dev_add_echoes(100000)
    get().refresh()
    persist()
  },
  dismissCombat: () => set({ combat: null }),
}))

export const RARITY_ORDER: RarityName[] = ['Common', 'Rare', 'Epic', 'Ssr', 'Ur', 'Relic', 'Meta', 'Transcendent']
