//! Game state + use cases (the application ring). All authoritative numbers live here; the web layer only
//! mirrors the views. Pure `GameState` is unit-tested natively; the thin `#[wasm_bindgen] Game` wrapper
//! exposes JSON to TypeScript.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

use crate::content::{self, COUNT, SHAPES};
use crate::expedition::{self, Combatant, QUESTS, QUEST_COUNT};
use crate::flux;
use crate::gacha::{banner_unit, relic_unit, roll_rarity, shape_index, PityState, Rarity};
use crate::orrery::{self};

const SCHEMA_VERSION: u32 = 6;
const PULL_COST: f64 = 100.0 * content::FLUX_DENSITY;
const TEN_PULL_COST: f64 = 1000.0 * content::FLUX_DENSITY; // 11 pulls for the price of 10
const BASE_IDLE: f64 = 0.0; // an empty orrery earns nothing — production comes only from deployed shapes
const RATE_CAP: f64 = 10800.0; // Flux/hr cap before prestige (DESIGN §7); scaled ~12× with base_prod (first-run retune)
const OFFLINE_CAP_MS: f64 = 24.0 * 3_600_000.0; // generous full-day cap — respects absence (only ever helps idle players, never speeds active play)
const START_EULER_CAP: u32 = 6;
const MAX_TEAMS: usize = 6; // concurrent Expedition teams (parties) a player builds + keeps
const EXP_PROVISION_SLOTS: usize = 3; // how many provisions a team can stage for one clear
const MAX_NODES: usize = 8; // skill-tree nodes per role tree
// v2: Expeditions pay FLUX too (no longer inert). A team's Flux/hr = its Echoes/hr × FLUX_DENSITY × this,
// clamped to EXP_FLUX_CAP_SHARE of the core rate cap so it scales with the player but never runs away.
const EXP_FLUX_PER_ECHO_RATE: f64 = 0.30;
const EXP_FLUX_CAP_SHARE: f64 = 0.35;
const FIRST_CLEAR_FLUX_K: f64 = 4.0; // first-clear Flux lump = base_echo × this × FLUX_DENSITY
const FARM_XP_PER_HR: f64 = 4.0; // XP/hr per stationed member (× power band)
// overpressure_valve (#18): flux that overflows the rate cap converts to Shards at this fixed exchange (in the
// same density-scaled flux/hr units the cap clamp uses). ~4000 base flux per shard — a modest late-game stream.
const SHARD_PER_OVERCAP_FLUX: f64 = 4000.0 * content::FLUX_DENSITY;
const START_FLUX: f64 = 1000.0 * content::FLUX_DENSITY; // onboarding: ~10 pulls in hand immediately, no wait (first-run retune)
const STARTER_SHAPE: usize = 0; // Pip the sphere — the friendliest common + the Euler-ballast anchor
const BOARD_W: usize = 5; // the Engine floor is a 5×5 grid; placement is a spatial puzzle (2D adjacency)
const BOARD_H: usize = 5;
const BOARD_N: usize = BOARD_W * BOARD_H;
const RELIC_COST: u64 = 500; // shards to summon a Relic (the prestigious dupe-shard sink)
// Non-scene cosmetic equip slots (gem-finish, ceremony, board, title, …). The scene is a separate field for
// back-compat; everything else lives in the generic `equipped` vec indexed by slot. Grow this as classes ship.
pub const COSMETIC_SLOTS: usize = 6;
const BANNER_RATEUP: f64 = 0.5; // on a themed banner, chance the within-tier pick is steered to a featured shape
const RELIC_DROP_STD: f64 = 0.003; // rare "lucky find": chance any pull turns up a missing Relic (Standard banner)
const RELIC_DROP_BANNER: f64 = 0.006; // …doubled on a themed banner (more reason to pull the rotating one)
const MS_PER_HOUR: f64 = 3_600_000.0;
const BOND_INSPECT_GAIN: u32 = 25; // affinity per inspect (the calm idler's path to bonds)
const BOND_PAT_GAIN: u32 = 5; // affinity per pat/rub (very minor)
const BOND_PAT_PERIOD_MS: f64 = 3_600_000.0; // pat-budget window: 1 hour
const BOND_PAT_CAP_PER_SHAPE: u32 = 50; // max affinity a shape can gain from patting per window (anti-spam-grind)
const BOND_THRESHOLDS: [u32; 6] = [0, 100, 300, 700, 1500, 3000]; // levels 0..5
const PLATONIC_SET_MULT: f64 = 0.15; // +15% global for completing the Platonic set
const POLYTOPE_SET_MULT: f64 = 0.15; // +15% for the full 4D-polytope table (mostly an NG+ goal)
const KNOT_SET_MULT: f64 = 0.15; // +15% for the full knot/link table
const SYNERGY_BONUS: f64 = 0.08; // +8% per deployed kin pair (duals/soulmates)
const AFFINITY_PER_HR_DEPLOYED: f64 = 30.0; // passive bond gain while deployed
                                            // ── Orrery (periodic-orbit engine, behind `use_orrery`; see ORRERY_PLAN.md) ──
const ORRERY_RADIUS: i32 = 4; // hex grid radius (61 anchor cells — far more than any loadout)
const ORRERY_TICK_SECONDS: f64 = 1.0; // one orbital step per real second → a period (≤12) cycles in ≤12s
const ORRERY_SCALE: f64 = 1_000_000.0; // fixed-point scale: per-tick flux is small, so store µ-units in u64

fn shard_value(r: Rarity) -> u64 {
    match r {
        Rarity::Common => 1,
        Rarity::Rare => 3,
        Rarity::Epic => 8,
        Rarity::Ssr => 20,
        Rarity::Ur => 60,
        Rarity::Relic => 120,
        Rarity::Meta => 200,
        Rarity::Transcendent => 400,
    }
}

/// A deployed shape's lane placement on the hex grid: its ANCHOR cell `(q,r)` (unique across shapes — drag to
/// move; collisions swap), the AXIS its straight lane points along (0..6), and its PHASE (timing). The lane
/// LENGTH/period is topology-seeded (`content::lane_len`), so the system lcm — and thus O(1) offline — is
/// unaffected by any tuning. Materialised per deployed shape while the Orrery is active.
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct OrbitTune {
    pub q: i8,
    pub r: i8,
    pub axis: u8,
    pub phase: u8,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GameState {
    pub schema_version: u32,
    pub master_seed: u64,
    pub created_ms: f64,
    pub last_seen_ms: f64,
    pub flux: f64,
    pub shards: u64,
    pub pity: PityState,
    pub owned: Vec<u32>,     // count per shape id (len = COUNT); 0 = not owned
    pub loadout: Vec<usize>, // deployed shape ids
    #[serde(default)]
    pub board_cells: Vec<u8>, // parallel to loadout: the grid cell (0..BOARD_N) each deployed shape sits in
    pub euler_cap: u32,
    pub viewport_dim: u32, // prestige axis (starts at 3 = our native 3D vantage)
    pub ng_cycle: u32,
    pub prestige_mult: f64, // 1.6^ng_cycle
    #[serde(default)]
    pub bonds: Vec<u32>, // affinity per shape id (len = COUNT)
    #[serde(default)]
    pub discovered: Vec<bool>, // forge recipes discovered (len = RECIPES.len())
    #[serde(default)]
    pub forged: Vec<bool>, // per-output-shape "ever forged" (len = COUNT) — drives the once-per-shape discovery sting
    #[serde(default)]
    pub pat_window_ms: f64, // start of the current pat-budget window (rolls every BOND_PAT_PERIOD_MS)
    #[serde(default)]
    pub pat_gained: Vec<u32>, // affinity granted by patting each shape in the current window (len = COUNT)
    // ── cosmetics (Shop) ──
    #[serde(default)]
    pub cosmetics: Vec<u32>, // owned scene cosmetic ids (id 0 is the free default)
    #[serde(default)]
    pub scene: u32, // selected scene id
    #[serde(default)]
    pub equipped: Vec<u32>, // equipped cosmetic id per non-scene slot (gem-finish, ceremony, board, title, …); 0 = that slot's free default
    // ── lifetime telemetry (Ledger) ──
    #[serde(default)]
    pub lifetime_flux: f64,
    #[serde(default)]
    pub lifetime_shards: u64,
    #[serde(default)]
    pub total_forges: u32,
    #[serde(default)]
    pub pulls_by_rarity: Vec<u64>, // len 5: Common,Rare,Epic,Ssr,Ur
    #[serde(default)]
    pub upgrades: Vec<u32>, // level per content::UPGRADES id
    #[serde(default)]
    pub milestones_done: Vec<bool>, // latched milestone achievements (len MILESTONE_COUNT)
    #[serde(default)]
    pub facets: u64, // prestige meta-currency (from recrystallizing)
    #[serde(default)]
    pub facet_perks: Vec<u32>, // level per content::FACET_PERKS id
    #[serde(default)]
    pub current_banner: u32, // selected gacha banner (0 = Standard); rate-up steering only
    #[serde(default)]
    pub use_orrery: bool, // opt-in periodic-orbit engine; false ⇒ the static-board path is byte-identical
    #[serde(default)]
    pub orbit_tune: BTreeMap<u16, OrbitTune>, // per-shape orbit overrides (phase + direction); period stays seeded
    #[serde(default)]
    pub overclock_on: bool, // overclock (#19) session toggle: +60% cap, offline clamped to 4h. Default OFF ⇒ band bit-stable.
    #[serde(default)]
    pub overcap_carry: f64, // overpressure_valve (#18): fractional-shard carry so over-cap spill rounds bit-identically online + offline
    // ── Expeditions (the opt-in idle RPG; see expedition.rs) ──
    // All additive #[serde(default)] ⇒ pre-v3 saves load with the mode dormant. Echoes are INERT to the core
    // economy (they buy only expedition-internal upgrades), so adding this stream can't perturb Flux/shard bands.
    #[serde(default)]
    pub echoes: u64, // the expedition spoils currency (its own, never converts to Flux/shards/stars)
    #[serde(default)]
    pub lifetime_echoes: u64,
    #[serde(default)]
    pub echo_carry: f64, // fractional-Echo carry so the closed-form farm rounds bit-identically online + offline
    #[serde(default)]
    pub exp_party: Vec<usize>, // MIGRATION-ONLY (pre-v4): folded into exp_teams[0]; not read at runtime
    #[serde(default)]
    pub exp_cleared: Vec<bool>, // per-quest cleared flag (len = QUEST_COUNT)
    #[serde(default)]
    pub exp_farms: Vec<ExpFarm>, // MIGRATION-ONLY (pre-v4): folded into exp_teams + exp_station
    #[serde(default)]
    pub exp_perks: Vec<u32>, // level per expedition::EXP_PERKS id (Echoes-bought, mode-internal only)
    // ── v4: multiple persistent teams + station assignment + endless XP/skill trees ──
    #[serde(default)]
    pub exp_teams: Vec<Vec<usize>>, // persistent teams, each ≤ exp_party_max() owned shape ids
    #[serde(default)]
    pub exp_station: Vec<i32>, // parallel to exp_teams: quest each team farms, or -1 = idle
    #[serde(default)]
    pub exp_active_team: usize, // which team the builder is editing
    #[serde(default)]
    pub exp_flux_carry: f64, // bit-stable carry for the expedition Flux stream
    #[serde(default)]
    pub shape_xp: Vec<u64>, // lifetime XP per shape id (len COUNT) — endless
    #[serde(default)]
    pub skill_alloc: Vec<Vec<u32>>, // points spent per skill node per shape (len COUNT × MAX_NODES)
    #[serde(default)]
    pub shape_xp_carry: Vec<f64>, // per-shape bit-stable carry for farmed XP (len COUNT)
    // ── v5: journey-map routing, pre-battle orders, provisions/relics, Auto, history ──
    // THE FENCE (spec D4): none of these ever touch the FARM rate / XP / accrual closed-form — they fold ONLY
    // into the clear battle + combat power (clear_seed). The farm rate still bands on base power only.
    #[serde(default)]
    pub exp_node_mod: Vec<u8>, // chosen risk modifier per node (0 = safe); len == QUEST_COUNT
    #[serde(default)]
    pub exp_orders: Vec<Orders>, // pre-battle orders per team (Orders::default() == v4 behavior); team-parallel
    #[serde(default)]
    pub prov_inv: Vec<u32>, // owned consumable provision charges; len == PROVISION_COUNT
    #[serde(default)]
    pub exp_provisions: Vec<Vec<u8>>, // provisions staged for team t's NEXT clear; team-parallel
    #[serde(default)]
    pub relics_owned: Vec<bool>, // unlocked relics; len == RELIC_COUNT
    #[serde(default)]
    pub team_relics: Vec<Vec<u8>>, // equipped relics per team (≤ RELIC_SLOTS_PER_TEAM); team-parallel
    #[serde(default = "default_true")]
    pub exp_auto: bool, // persisted hands-free Auto-Expedition toggle — ON by default (absent in old saves ⇒ on)
    #[serde(default)]
    pub exp_clears_total: u64, // history: lifetime first-clears
    #[serde(default)]
    pub exp_bosses_freed: u64, // history: lifetime bosses freed
    #[serde(default)]
    pub exp_echoes_farmed: u64, // history: lifetime Echoes from idle farming
    #[serde(default)]
    pub exp_flux_farmed: f64, // history: lifetime Flux from idle farming
    #[serde(default)]
    pub exp_runs: Vec<ExpRunRec>, // history: bounded ring of recent run summaries (truncate to 24)
    // ── v6 "The Delve" (additive; None ⇒ v5 station-farm byte-identical) ──
    #[serde(default)]
    pub active_run: Option<RunPlan>, // the one in-flight run (one at a time in v1)
    #[serde(default)]
    pub run_history: Vec<RunRecord>, // completed runs, newest-first bounded ring
    #[serde(default)]
    pub exp_rest_until: f64, // wall-clock ms: the party rests at base camp until here before the next delve (0 = ready)
}

/// One idle Expedition farm: a snapshot party on a cleared quest. MIGRATION-ONLY since v4 (folded into
/// exp_teams + exp_station); retained as a serde source so pre-v4 saves load.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ExpFarm {
    pub quest: usize,
    pub party: Vec<usize>,
}

/// v5 pre-battle orders for ONE team. `Orders::default()` MUST reproduce v4 combat byte-for-byte (steady
/// doctrine, adaptive focus = lowest-hp, balanced stance, balanced formation) so the inert short-circuit holds.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Orders {
    #[serde(default)]
    pub formation: u8, // 0 = balanced (default), 1 = front-heavy, 2 = back-heavy
    #[serde(default)]
    pub doctrine: u8, // 0 = steady (default = v4 ladder), 1 = aggressive, 2 = defensive
    #[serde(default = "focus_default")]
    pub focus: i8, // -1 = adaptive (default, = lowest_hp), 0 = wounded, 1 = threat, 2 = boss
    #[serde(default)]
    pub stance: Vec<u8>, // per-slot 0 = aggressive, 1 = balanced (default), 2 = defensive; empty ⇒ all balanced
    #[serde(default)]
    pub gambits: Vec<Vec<expedition::GambitRule>>, // per-slot FF12-style program; empty slot ⇒ legacy ladder
}
fn focus_default() -> i8 {
    -1
}
fn default_true() -> bool {
    true
}
impl Default for Orders {
    fn default() -> Self {
        Orders { formation: 0, doctrine: 0, focus: -1, stance: Vec::new(), gambits: Vec::new() }
    }
}
/// Fold ONE provision/relic effect into a combatant at build time — all deterministic, zero RNG (Kind B speed/
/// dmg/def fold into the stats so `compute_damage` is untouched). DoubleClearEchoes is a reward effect, not a
/// combatant one. Applied to the CLEAR battle only (the farm/watch pass no effects).
fn apply_team_effect(c: &mut Combatant, e: expedition::EffKind) {
    use expedition::EffKind::*;
    match e {
        StartCharge(n) => c.charge = (c.charge + n as i64).min(99),
        StartShield(pct) => c.shield += (c.max_hp * pct as i64 / 100).max(0),
        PartyAtkUp(n) => c.atk_up = c.atk_up.max(n as i64),
        ElementShift(el) => c.element = el,
        HpBoost(pct) => {
            c.max_hp = (c.max_hp * (100 + pct as i64) / 100).max(1);
            c.hp = c.max_hp;
        }
        ReviveOnce => c.revive = true,
        FlatDmgPct(pct) => c.atk = (c.atk * (100 + pct as i64) / 100).max(1),
        FlatDefPct(pct) => c.def = (c.def * (100 + pct as i64) / 100).max(0),
        SpeedPct(pct) => c.speed = (c.speed * (100 + pct as i64) / 100).max(1),
        DoubleClearEchoes => {} // reward effect — handled in grant_first_clear, not on the combatant
        Reflect => c.reflect = true, // grant the bounce quirk to the whole party (the Retribution Prism relic)
    }
}
/// Stable FNV-1a-ish hash of an Orders for the clear seed (so differently-ordered attempts seed different fights).
fn orders_hash(o: &Orders) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for v in [o.formation as u64, o.doctrine as u64, (o.focus as i16 as u16) as u64] {
        h = (h ^ v).wrapping_mul(0x100_0000_01b3);
    }
    for &s in &o.stance {
        h = (h ^ (s as u64 + 1)).wrapping_mul(0x100_0000_01b3);
    }
    // gambit program (per slot). Only fold when a non-empty slot exists, so default/stance-only teams hash
    // exactly as before (byte-stable seeds). A per-slot delimiter so [[A],[B]] ≠ [[A,B],[]]; +1 offsets so a
    // 0,0 rule isn't XOR-absorbed; the `on` bit is folded so a disabled rule still alters the program.
    if o.gambits.iter().any(|slot| !slot.is_empty()) {
        for slot in &o.gambits {
            for r in slot {
                h = (h ^ (r.cond as u64 + 1)).wrapping_mul(0x100_0000_01b3);
                h = (h ^ (r.action as u64 + 1)).wrapping_mul(0x100_0000_01b3);
                h = (h ^ (r.on as u64 + 1)).wrapping_mul(0x100_0000_01b3);
            }
            h = h.wrapping_mul(0x100_0000_01b3).wrapping_add(0x9e37); // slot delimiter
        }
    }
    h
}

/// v6 "The Delve": a Run is resolved ONCE at SEND into this frozen, persisted schedule; idle advance at elapsed T
/// is a binary-search READ of the prefix arrays (O(1) offline; online==offline by construction). `active_run: None`
/// ⇒ v5 station-farm byte-identical. The schedule is immutable for the run's life; only `claimed_rooms` advances.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RunPlan {
    // ── send-time freeze (immutable) ──
    pub team: usize,
    pub party: Vec<usize>,    // member ids snapshot (roster can't change mid-run)
    pub path: Vec<usize>,     // ordered node indices through QUESTS (linear in v1)
    pub run_seed: u64,        // = clear_seed(team, path[0]); appended lineage (room 0 uses it raw)
    pub start_ms: f64,        // departure wall-clock (the only time field)
    pub orders: Orders,      // snapshot
    pub provisions: Vec<u8>, // snapshot (consumed on completion; retained on wipe — loss-is-free)
    #[serde(default)]
    pub auto_tactics: bool, // snapshot of the auto-tactics unlock at SEND — so replay/offline match the banked outcome, never a mid-run purchase
    // ── resolved schedule (computed ONCE; read-only) ──
    pub prefix_ms: Vec<f64>,     // cumulative ms to FINISH room k
    pub prefix_echoes: Vec<u64>, // cumulative delve-loot Echoes banked through room k
    pub prefix_flux: Vec<u64>,   // cumulative delve-loot Flux through room k
    pub room_kind: Vec<u8>,      // RoomKind per resolved room
    pub room_node: Vec<i32>,     // the QUESTS node a fight room clears (for grant_first_clear), else -1
    pub death_room: Option<usize>, // chained-party-wipe index; run ends early here
    pub planned_rooms: usize,    // intended room count for the FULL path (incl. cozy rooms) — death-leak-free progress
    pub total_ms: f64,           // == prefix_ms.last()
    // ── idle banking cursor (NO carry — integer prefix-diff) ──
    pub claimed_rooms: u32,
    // ── AUTO + timeout-windowed decisions (all serde(default) ⇒ no save migration; empty ⇒ today's behavior) ──
    #[serde(default)]
    pub decisions: Vec<Decision>, // one per Decision room, resolved (option table) AT SEND — immutable
    #[serde(default)]
    pub decision_choices: Vec<i8>, // chosen option per Decision room: -1 = auto-default (frozen), 0/1 = player override
    #[serde(default)]
    pub decision_locked_at_room: u32, // = claimed_rooms after each bank; choose_decision rejects rooms < this (anti-scum)
}

/// A no-fight Decision room's 2-option table, resolved at send. The auto-default (option 0) is what the frozen
/// schedule + every offline player uses; a live player may override within the window (Slice 2). "Flavor, not a
/// power-gate" — effects are bounded.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Decision {
    pub room_idx: usize,    // index into the resolved room arrays
    pub auto_option: u8,    // deterministic safe default (always 0 — the heal/rest option)
    pub window_ms: f64,     // live-choice deadline, relative to the room's arrival time
    pub options: Vec<DecisionEffect>, // 2–3 options; option 0 is the safe auto-default. (Vec ⇒ JSON-backward-compatible: old 2-element saves load fine.)
    #[serde(default)]
    pub template: u8, // which themed crossroads (drives the TS flavor + scene); 0 = the classic fork
}
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct DecisionEffect {
    pub heal_pct: i32,   // ± % of max HP healed when this option resolves
    pub atk_pct: i32,    // ± lasting atk % for the rest of the run
    pub echo_bonus: u64, // bonus delve Echoes (loot) this option grants
    #[serde(default)]
    pub speed_pct: i32,  // ± lasting speed % for the rest of the run (a "swiftness" option)
}

/// A completed-run summary for the home-base history (newest-first, bounded ring).
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RunRecord {
    pub team: u32,
    pub rooms: u32,
    pub echoes: u64,
    pub died: bool,
    pub at_ms: f64,
}

/// Run pacing: a fight room takes `rounds × this` ms of idle time (≈1 min/round). Render/feel-only timing —
/// it never affects combat outcome or rewards (those are integer lumps), so it's freely tunable.
const MS_PER_ROOM_ROUND: f64 = 60_000.0;
const REST_MS: f64 = 30_000.0; // a Campfire takes ~30s of idle time
const TREASURE_MS: f64 = 20_000.0; // a Treasure room ~20s
const CAMPFIRE_HEAL_PCT: i64 = 40; // Campfire restores 40% of max HP to the threaded party
const TREASURE_HEAL_PCT: i64 = 18; // a Treasure room is a light pick-me-up
const SHRINE_MS: f64 = 18_000.0; // a Shrine takes ~18s of idle time
const SHRINE_HEAL_PCT: i64 = 22; // a Shrine restores a little HP
const SHRINE_SPEED_BOON: i64 = 8; // + a lasting +8% speed for the rest of the run (the Shrine's distinct blessing)
const DECISION_MS: f64 = 15_000.0; // a Crossroads takes ~15s of idle time (the party deliberates at the fork)
const DECISION_WINDOW_MS: f64 = 13_000.0; // the live player has 13s to override before it auto-resolves (closes before the room banks)
const NGPLUS_ENEMY_SCALE_PCT: i64 = 35; // NG+ "Deeper Manifold": +35% enemy stats per ascent cycle — combat-only, farm-fenced
const NGPLUS_REWARD_BONUS_PCT: u64 = 50; // NG+: +50% first-clear ECHOES per cycle (the lucrative re-climb; mode-internal, not the rate)
const CAMPFIRE_BOON_PCT: i64 = 10; // + a fixed +10% attack boon for the rest of the run (cozy, deterministic)
const REST_BETWEEN_RUNS_MS: f64 = 120_000.0; // the party rests at base camp ~2 min between delves (a cozy break; the timer ticks)
// Workshop upgrade indices that gate the gambit progression (append-only, behind charter_expeditions #20).
const UPG_AUTO_TACTICS: usize = 21; // empty slots fight with the SMART ladder instead of the simple instinct default
const UPG_GAMBIT_T2: usize = 22; // unlocks skill_ready/ally_low conds + weakest/threat targeting
const UPG_GAMBIT_T3: usize = 23; // unlocks ult_ready cond + buff_team/sweep actions (deep tactics)

/// Append one resolved room to a RunPlan's parallel schedule arrays.
fn push_room(plan: &mut RunPlan, t_ms: f64, ech: u64, flux: u64, kind: u8, node: i32) {
    plan.prefix_ms.push(t_ms);
    plan.prefix_echoes.push(ech);
    plan.prefix_flux.push(flux);
    plan.room_kind.push(kind);
    plan.room_node.push(node);
}

/// Restore `pct`% of each living combatant's max HP (clamped). Used by Campfire/Treasure rooms — meaningful only
/// because P0 threads survivor HP room→room. Pure.
fn heal_party(party: &mut [Combatant], pct: i64) {
    for c in party.iter_mut() {
        if c.hp > 0 {
            c.hp = (c.hp + c.max_hp * pct / 100).min(c.max_hp);
        }
    }
}

/// Build the v1 LINEAR room sequence from a node path: a Treasure after every 2nd combat (a mid-chapter reward),
/// a Campfire to rest right before each Boss. Returns (RoomKind, node-or-(-1)) per room. Pure → deterministic.
fn build_room_plan(path: &[usize]) -> Vec<(expedition::RoomKind, i32)> {
    let mut rooms = Vec::new();
    let mut non_boss_combats = 0u32; // drives the Shrine cadence by COMBAT count (always reachable, unlike a path-index rule)
    for (k, &q) in path.iter().enumerate() {
        let is_boss = matches!(QUESTS[q].kind, expedition::NodeKind::Boss);
        if !is_boss && k > 0 && k % 2 == 0 {
            rooms.push((expedition::RoomKind::Treasure, -1));
        }
        if !is_boss {
            non_boss_combats += 1;
            if non_boss_combats.is_multiple_of(3) {
                rooms.push((expedition::RoomKind::Shrine, -1)); // a Shrine blessing before every 3rd combat
            }
            if non_boss_combats.is_multiple_of(2) {
                rooms.push((expedition::RoomKind::Decision, -1)); // a Crossroads before every 2nd combat (the agency hook)
            }
        }
        if is_boss {
            rooms.push((expedition::RoomKind::Campfire, -1)); // rest before the climax
        }
        rooms.push((if is_boss { expedition::RoomKind::Boss } else { expedition::RoomKind::Combat }, q as i32));
    }
    rooms
}

/// Build a Decision room's deterministic 2-option table from its room seed. Option 0 (the auto-default) is the SAFE
/// rest (a solid heal, no risk); option 1 is the GAMBLE (bonus loot + a small lasting atk boon, but no heal). Bounded
/// — "flavor, not a power-gate". Pure ⇒ same seed ⇒ same table (determinism + online==offline).
fn build_decision(seed: u64, room_idx: usize) -> Decision {
    let h = expedition::splitmix64(seed);
    // Pick one of 3 themed crossroads. EVERY template's option 0 is the safe heal (the auto-default for idle/offline);
    // the others trade the heal for a lasting boon or loot. Bounded — "flavor, not a power-gate".
    let template = (h % 3) as u8;
    let de = |heal_pct: i32, atk_pct: i32, echo_bonus: u64, speed_pct: i32| DecisionEffect { heal_pct, atk_pct, echo_bonus, speed_pct };
    let options: Vec<DecisionEffect> = match template {
        // 1 — The Old Altar (3): mend / strength / swiftness
        1 => {
            let a = 12 + ((h >> 8) % 5) as i32; // 12–16
            let s = 12 + ((h >> 16) % 5) as i32; // 12–16
            vec![de(30, 0, 0, 0), de(0, a, 0, 0), de(0, 0, 0, s)]
        }
        // 2 — A Glittering Vein (3): pocket a few / dig it out / pry the geode
        2 => {
            let e1 = 20 + (h >> 8) % 15; // 20–34
            let e2 = 55 + (h >> 16) % 30; // 55–84
            let e3 = 34 + (h >> 24) % 17; // 34–50
            let a = 6 + ((h >> 32) % 4) as i32; // 6–9
            vec![de(16, 0, e1, 0), de(0, 0, e2, 0), de(0, a, e3, 0)]
        }
        // 0 — The Crossroads (2): rest / press on (the classic safe-vs-gamble fork)
        _ => {
            let echo = 30 + h % 30; // 30–59
            let atk = 6 + ((h >> 8) % 6) as i32; // 6–11
            vec![de(28, 0, 0, 0), de(0, atk, echo, 0)]
        }
    };
    Decision { room_idx, auto_option: 0, window_ms: DECISION_WINDOW_MS, options, template }
}

/// Apply a Decision option's PARTY effect (heal + lasting atk) — the HP-threading half, shared verbatim by
/// resolve_run, replay, and (Slice 2) tail re-resolution so they can never drift apart. The loot half (`echo_bonus`)
/// is added by the caller ONLY where the prefix is built — never in replay (the prefix already holds it).
fn apply_decision_to_party(party: &mut [expedition::Combatant], eff: DecisionEffect) {
    if eff.heal_pct != 0 {
        heal_party(party, eff.heal_pct as i64);
    }
    if eff.atk_pct != 0 {
        for c in party.iter_mut() {
            if c.hp > 0 {
                c.atk = (c.atk * (100 + eff.atk_pct as i64) / 100).max(1);
            }
        }
    }
    if eff.speed_pct != 0 {
        for c in party.iter_mut() {
            if c.hp > 0 {
                c.speed = (c.speed * (100 + eff.speed_pct as i64) / 100).max(1);
            }
        }
    }
}

/// A bounded history record of one completed expedition run (first-clear or boss-freed). Render-only spoils.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ExpRunRec {
    pub kind: u8, // 0 = first-clear, 1 = boss freed
    pub quest: u32,
    pub team: u32,
    pub rounds: u32,
    pub survivors: u32,
    pub party_size: u32,
    pub echoes: u64,
    pub flux: u64,
    pub recruit_id: i32,
    pub ng_cycle: u32,
}

#[derive(Serialize)]
pub struct PullOutcome {
    pub ok: bool,
    pub shape_id: i32, // -1 if the pull failed (not enough Flux)
    pub rarity: Option<Rarity>,
    pub is_new: bool,
    pub dupe_shards: u64,
    pub spark_shape_id: i32, // -1 if no spark this pull
    pub spark_is_new: bool,
}

#[derive(Serialize)]
pub struct ForgeResult {
    pub ok: bool,
    pub out_id: i32,
    pub is_discovery: bool,
}

#[derive(Serialize)]
pub struct OfflineReport {
    pub elapsed_ms: f64,
    pub capped_ms: f64,
    pub gained_flux: f64,
    #[serde(default)]
    pub gained_echoes: u64, // Echoes the stationed expedition party gathered while away (the peak-end beat)
    #[serde(default)]
    pub delve_returned: Option<RunRecord>, // a delve that COMPLETED during the offline span — its return is celebrated on load
}

/// The result of stationing a team on a quest. If the quest was uncleared, `battle` carries the fight that
/// decided it (a win clears + stations + grants first-clear rewards; a loss is free and does NOT station).
#[derive(Serialize)]
pub struct StationResult {
    pub ok: bool,
    pub win: bool,
    pub newly_cleared: bool,
    pub recruited_id: i32,
    pub recruit_is_new: bool,
    pub echoes_gained: u64,
    pub first_clear_flux: f64,
    pub battle: Option<expedition::BattleResult>,
}

/// What one Auto-Expedition step did (for optional toasts). `quest` = the quest newly cleared (-1 if none).
#[derive(Serialize)]
pub struct AutoExpeditionStep {
    pub delved: bool,
    pub quest: i32,
    pub recruited_id: i32,
    pub farms: usize,
}

/// One stationary shape's flux emitter, for the UI to render its gem + animate the flux it sheds. The web
/// mirrors the (deterministic) emission/trace for the VISUAL only; banked flux is Rust truth via rate_per_hr.
#[derive(Serialize)]
pub struct FluxEmitterView {
    pub cell: (i32, i32),   // placement cell (axial q,r) — the draggable anchor
    pub dir: u8,            // facing (hex direction 0..6)
    pub phase: u8,          // emission timing offset
    pub emit: &'static str, // "beam" | "rotating" | "scatter" | "pulse"
    pub act: &'static str,  // "pass" | "multiply" | "redirect" | "split" | "amplify" | "absorb"
    pub act_mult: f64,      // multiply factor (num/den), else 1.0
    pub act_turn: i8,       // redirect/split turn, else 0
    pub act2: &'static str, // SECONDARY effect (Epic+ compound kits), "pass" when there's only one
    pub act2_mult: f64,
    pub act2_turn: i8,
    pub amount: f64, // per-quantum flux/hr (visual scaling)
    pub tuned: bool, // the player has placed/tuned this shape
}

#[derive(Serialize)]
pub struct GameStateView {
    pub flux: f64,
    pub rate_per_hr: f64,
    pub shards: u64,
    pub owned: Vec<u32>,
    pub distinct_owned: u32,
    pub loadout: Vec<usize>,
    pub board_cells: Vec<u8>, // grid cell per loadout entry (parallel)
    pub board_w: u32,
    pub board_h: u32,
    pub euler_used: u32,
    pub euler_cap: u32,
    pub viewport_dim: u32,
    pub ng_cycle: u32,
    pub prestige_mult: f64,
    pub pity_since_top: u32,
    pub resonance: u32,
    pub total_pulls: u64,
    pub can_pull: bool,
    pub can_ten_pull: bool,
    pub pull_cost: f64,     // flux per single pull (density-scaled — UI displays, never hardcodes)
    pub ten_pull_cost: f64, // flux for a ×10
    pub core_complete: bool,
    pub bonds: Vec<u32>,
    pub bond_levels: Vec<u32>,
    pub discovered: Vec<bool>,
    pub forged: Vec<bool>,
    pub platonic_set: bool,
    pub relics_owned: u32,
    pub relic_count: u32,
    pub pull_count: u32, // size of the pullable core (PULL_COUNT) — the "all N core shapes" completion denominator
    pub relic_cost: u64,
    pub recipe_costs: Vec<u64>, // shards to forge each RECIPES entry right now (rarity-scaled, mastery-applied)
    pub cosmetics: Vec<u32>,
    pub scene: u32,
    pub equipped: Vec<u32>,
    pub lifetime_flux: f64,
    pub lifetime_shards: u64,
    pub total_forges: u32,
    pub total_stars: u32, // sum of ★ levels across the whole collection — a mastery metric for the Ledger
    pub pulls_by_rarity: Vec<u64>,
    pub created_ms: f64,
    pub last_seen_ms: f64,
    pub active_synergies: u32,
    pub upgrades: Vec<u32>,
    pub milestones_done: Vec<bool>,
    pub facets: u64,
    pub facet_perks: Vec<u32>,
    pub current_banner: u32,
    pub star_levels: Vec<u32>,
    // Live production-multiplier breakdown (the truth — the UI only displays these, never recomputes them).
    pub mult_prestige: f64,
    pub mult_set: f64,
    pub mult_bond: f64,
    pub mult_synergy: f64,
    pub mult_genus_res: f64,
    pub mult_milestone: f64,
    pub mult_facet: f64,
    pub mult_ballast: f64,
    pub mult_euler_surplus: f64, // euler_surplus (#16): production bonus from UNSPENT Euler-budget headroom
    pub mult_crossdim: f64,
    pub mult_signature: f64,
    pub mult_shape_effects: f64, // aggregate of the deployed shapes' own effects (handle-lane★ · overdrive · knots · signature)
    pub upgrade_costs: Vec<(f64, u64)>, // NEXT-level (flux, shard) cost per upgrade — UI displays, never recomputes
    pub upgrade_unlocked: Vec<bool>,    // tech-tree gate per upgrade (prereq satisfied)
    pub facet_perk_costs: Vec<u64>,     // NEXT-level Facet cost per perk
    pub overclock_on: bool, // overclock (#19) toggle state — UI shows the active "Redline" mode + its 4h offline cost
    // ── Orrery flux-emitter engine (UI mirrors emission/trace from these for the visuals) ──
    pub use_orrery: bool,
    pub orrery_radius: i32,            // hex grid radius
    pub orrery_cell_cap: usize,        // placement cap — #cells on the WORKSHOP-bought floor (deploy limit)
    pub orrery_cells: Vec<(i32, i32)>, // all anchor cells in the region (axial q,r) — the floor
    pub orrery_period: u32,            // system period L (ticks per full cycle)
    pub orrery_tick_ms: f64,           // real ms per emission tick
    pub flux_emitters: Vec<FluxEmitterView>, // parallel to loadout — stationary shapes that emit flux
    pub flux_contrib: Vec<f64>,              // parallel to loadout — each shape's own flux/hr output (DPS meter)
    pub flux_amp: Vec<f64>,                  // parallel to loadout — flux/hr a shape's multiplier lends others
    // ── Expeditions (the opt-in idle RPG) ──
    pub echoes: u64,
    pub lifetime_echoes: u64,
    pub echo_rate_per_hr: f64,
    pub exp_flux_rate: f64, // total Flux/hr expeditions add to the idle economy (v2 — no longer inert)
    pub exp_teams: Vec<TeamView>, // the player's persistent teams (multiple parties)
    pub exp_active_team: u32,
    pub exp_max_teams: u32,
    pub exp_party_max: u32, // members per team
    pub exp_cleared: Vec<bool>,
    pub exp_perks: Vec<u32>,
    pub exp_perk_costs: Vec<u64>,
    pub exp_power: Vec<i64>, // combat/farm power per shape id (len COUNT) — UI shows it, never recomputes
    pub exp_stats: Vec<ExpStatView>, // per-shape base combat stats (hp/atk/def/speed/ult) for the team card (len COUNT)
    pub shape_levels: Vec<u64>, // endless level per shape id
    pub shape_xp: Vec<u64>,
    pub xp_to_next: Vec<u64>, // XP remaining to the next level per shape
    pub skill_points_free: Vec<u32>,
    pub skill_alloc: Vec<Vec<u32>>,
    pub shard_rate_per_hr: f64, // over-cap shard income (display-only)
    pub exp_quest_flux_est: Vec<f64>, // per quest: Flux/hr the ACTIVE team would farm there (preview, len QUEST_COUNT)
    // ── v5: journey map state, provisions/relics inventory, auto, history ──
    pub exp_node_open: Vec<bool>,    // per quest: is it open to attempt now (graph + dimension gate)
    pub exp_node_mod: Vec<u8>,       // per quest: chosen risk modifier (0 safe)
    pub exp_node_beatable: Vec<bool>, // per OPEN node: does the active team win the CONFIGURED clear (selected risk mod + staged provisions) — telegraphing
    pub exp_auto: bool,
    pub prov_inv: Vec<u32>,          // owned provision charges (len PROVISION_COUNT)
    pub prov_costs: Vec<u64>,
    pub exp_relics_owned: Vec<bool>, // unlocked expedition relics (len RELIC_COUNT) — distinct from gacha relics_owned
    pub exp_relic_costs: Vec<u64>,
    pub exp_clears_total: u64,
    pub exp_bosses_freed: u64,
    pub exp_echoes_farmed: u64,
    pub exp_flux_farmed: f64,
    pub exp_runs: Vec<ExpRunRec>,    // recent run history (newest first, bounded)
    pub run: Option<RunView>,        // v6: the in-flight Delve run, CLIPPED (no future loot / death revealed)
    pub can_send_run: bool,          // v6: is a new linear run available to send?
    pub run_rest_until: f64,         // v6: wall-clock ms the party rests at base camp until (TS counts down; 0 = ready)
    pub run_history: Vec<RunRecord>, // v6: completed-run summaries (newest first) — drives the Delve Report
    pub gambit_auto: bool,           // v6 progression: is auto-tactics (the smart empty-slot ladder) unlocked?
    pub gambit_conds: Vec<u8>,       // v6 progression: the currently-unlocked gambit condition ids (editor mirrors this)
    pub gambit_acts: Vec<u8>,        // v6 progression: the currently-unlocked gambit action ids
}

/// The in-flight run, projected for the UI — CLIPPED per D9 (the route node indices + progress only; the future
/// loot lumps and any early-return are NEVER exposed). The web derives per-room kinds from `path` + the content.
#[derive(Serialize)]
pub struct RunView {
    pub team: usize,
    pub path: Vec<usize>,      // the route's node indices (structural — the player's chosen direction)
    pub room_kind: Vec<u8>,    // REVEALED room kinds only (0..=current_room) — the delve track; future tail hidden (D9)
    pub current_room: u32,     // banked cursor (the room the party is at)
    pub total_rooms: usize,
    pub start_ms: f64,
    pub total_ms: f64, // estimated return time (an early return is the gentle soft-land, not a spoiler — D18)
    // ── render-only reward readouts (Slice 5): pure reads of the frozen prefix arrays; NEVER affect banking ──
    pub room_echoes: Vec<u64>, // per-BANKED-room Echo lump (earned only; len == current_room) — drives the post-victory toast
    pub room_flux: Vec<u64>,   // per-BANKED-room Flux lump (earned only; len == current_room)
    pub delve_echoes_per_hr: f64, // whole-run average Echo/hr while delving (the delving team's station farm-rate reads 0)
    pub delve_flux_per_hr: f64,   // whole-run average Flux/hr while delving — fixes the "shows 0/hr" confusion
    pub pending_decision: Option<PendingDecisionView>, // an unbanked, un-chosen Crossroads the live player can override now
}

/// The live Crossroads the party is at, for the timeout UI: which room, the two options to choose between, and the
/// absolute wall-clock deadline. The UI tweens a countdown toward `deadline_ms` (never derives truth) and calls
/// `choose_decision`; if the deadline passes the auto-default stands. Present only while the choice is still legal.
#[derive(Serialize)]
pub struct PendingDecisionView {
    pub room_idx: usize,
    pub deadline_ms: f64, // start_ms + arrival + window_ms — absolute, so the UI clock can count down to it
    pub options: Vec<DecisionOptionView>, // 2–3 options; option `auto_option` is the safe default that stands if the window lapses
    pub auto_option: u8,  // which option idle/offline takes (always 0 — the heal)
    pub template: u8,     // the themed crossroads (drives the TS flavor + scene)
}
#[derive(Serialize, Clone, Copy)]
pub struct DecisionOptionView {
    pub heal_pct: i32,
    pub atk_pct: i32,
    pub echo_bonus: u64,
    pub speed_pct: i32,
}

/// A team row for the UI: members, the quest it's stationed on (-1 idle), its live power + Echo/Flux rates,
/// plus its v5 pre-battle orders, staged provisions, and equipped relics.
#[derive(Serialize)]
pub struct TeamView {
    pub members: Vec<usize>,
    pub station: i32,
    pub power: i64,
    pub echo_rate_per_hr: f64,
    pub flux_rate_per_hr: f64,
    pub orders: Orders,
    pub provisions: Vec<u8>, // staged provision ids
    pub relics: Vec<u8>,     // equipped relic ids
    // ── QW-4 team-selection aggregates (render-only mirror of exp_combatant/role/element — UI compares, never recomputes) ──
    pub total_hp: i64,
    pub total_atk: i64,
    pub total_def: i64,
    pub total_speed: i64,
    pub role_counts: Vec<u32>,    // [tank, dps, support, control] by Role as usize
    pub element_counts: Vec<u32>, // [solid, twisted, woven] by Element as usize
    pub kin_pairs: u32,           // active deployed synergy duos
}

/// Per-shape base combat stats for the team card (len COUNT, indexed by shape id). A pure mirror of what
/// `exp_combatant` derives BEFORE pre-battle orders — the UI shows these, it NEVER recomputes them.
#[derive(Serialize, Clone, Debug, Default)]
pub struct ExpStatView {
    pub max_hp: i64,
    pub atk: i64,
    pub def: i64,
    pub speed: i64,
    pub ult: i64,
}

impl GameState {
    pub fn new(master_seed: u64, now_ms: f64) -> Self {
        let mut owned = vec![0; COUNT];
        owned[STARTER_SHAPE] = 1; // begin owning one common shape, so there's something to deploy/forge from turn one
        GameState {
            schema_version: SCHEMA_VERSION,
            master_seed,
            created_ms: now_ms,
            last_seen_ms: now_ms,
            flux: START_FLUX,
            shards: 0,
            pity: PityState::default(),
            owned,
            board_cells: Vec::new(),
            loadout: Vec::new(),
            euler_cap: START_EULER_CAP,
            viewport_dim: 3,
            ng_cycle: 0,
            prestige_mult: 1.0,
            bonds: vec![0; COUNT],
            discovered: vec![false; content::RECIPES.len()],
            forged: vec![false; COUNT],
            pat_window_ms: 0.0,
            pat_gained: vec![0; COUNT],
            cosmetics: Vec::new(),
            scene: 0,
            equipped: vec![0; COSMETIC_SLOTS],
            lifetime_flux: 0.0,
            lifetime_shards: 0,
            total_forges: 0,
            pulls_by_rarity: vec![0; 5],
            upgrades: vec![0; content::UPGRADE_COUNT],
            milestones_done: vec![false; content::MILESTONE_COUNT],
            facets: 0,
            facet_perks: vec![0; content::FACET_PERK_COUNT],
            current_banner: 0,
            use_orrery: true,
            orbit_tune: BTreeMap::new(),
            overclock_on: false,
            overcap_carry: 0.0,
            echoes: 0,
            lifetime_echoes: 0,
            echo_carry: 0.0,
            exp_party: Vec::new(),
            exp_cleared: vec![false; QUEST_COUNT],
            exp_farms: Vec::new(),
            exp_perks: vec![0; expedition::EXP_PERK_COUNT],
            exp_teams: vec![Vec::new()],
            exp_station: vec![-1],
            exp_active_team: 0,
            exp_flux_carry: 0.0,
            shape_xp: vec![0; COUNT],
            skill_alloc: vec![vec![0; MAX_NODES]; COUNT],
            shape_xp_carry: vec![0.0; COUNT],
            exp_node_mod: vec![0; QUEST_COUNT],
            exp_orders: vec![Orders::default()],
            prov_inv: vec![0; expedition::PROVISION_COUNT],
            exp_provisions: vec![Vec::new()],
            relics_owned: vec![false; expedition::RELIC_COUNT],
            team_relics: vec![Vec::new()],
            exp_auto: true, // Auto-Expedition on by default (hands-free clear + farm); the player can toggle off
            exp_clears_total: 0,
            exp_bosses_freed: 0,
            exp_echoes_farmed: 0,
            exp_flux_farmed: 0.0,
            exp_runs: Vec::new(),
            active_run: None,
            run_history: Vec::new(),
            exp_rest_until: 0.0,
        }
    }

    /// Total production from the deployed loadout, with per-shape ShapeEffects: Handle-Lane (genus × star),
    /// Orientability Overdrive (non-orientable flat boost), and Knot Entanglement (a knot lifts its loadout
    /// neighbours — so ORDER matters). All constant-rate, so the closed-form O(1) offline integral is intact.
    /// Per-deployed-shape SELF production (handle-lane × overdrive × signature self-bonus), parallel to
    /// `loadout`, before any spatial coupling. This is the Orrery's per-shape base rate (flux/hr).
    fn per_shape_self_prod(&self) -> Vec<f64> {
        self.loadout
            .iter()
            .map(|&id| {
                let s = &SHAPES[id];
                let star = self.star_level(id) as f64;
                let mut p = s.base_prod * (1.0 + 0.25 * s.genus as f64 * (1.0 + 0.12 * star)); // handle-lane
                if content::is_nonorientable(s.family) {
                    p *= 1.0 + 0.30 * (1.0 + 0.15 * star); // overdrive
                }
                if let Some((bonus, _)) = content::signature(id) {
                    p *= 1.0 + bonus * (1.0 + 0.15 * star); // bespoke signature self-bonus
                }
                p * content::FLUX_DENSITY // rescale so flux ≈ one visible dust mote per flux (see FLUX_DENSITY)
            })
            .collect()
    }

    fn deployed_production(&self) -> f64 {
        let n = self.loadout.len();
        let mut prod: Vec<f64> = self.per_shape_self_prod();
        let grid = self.occupant_grid();
        for (i, &id) in self.loadout.iter().enumerate() {
            if content::is_knot(SHAPES[id].family) {
                let amt = 0.15 * (1.0 + 0.15 * self.star_level(id) as f64);
                let cell = self.board_cells.get(i).copied().unwrap_or(i as u8);
                for nc in Self::cell_neighbors(cell) {
                    if nc >= 0 {
                        let ni = grid[nc as usize];
                        if ni >= 0 {
                            prod[ni as usize] *= 1.0 + amt; // entangles each orthogonal neighbour on the board
                        }
                    }
                }
            }
        }
        let _ = n;
        prod.iter().sum()
    }

    /// Euler Ballast: each deployed χ=2 anchor steadies the floor (+3%, capped at 6).
    fn ballast_mult(&self) -> f64 {
        let n = self
            .loadout
            .iter()
            .filter(|&&id| content::is_ballast(id))
            .count();
        1.0 + 0.03 * n.min(6) as f64
    }

    /// Cross-Dimension: 4D polytopes pay off only once the viewport reaches 4D (NG+); +6%/polytope (star-scaled), capped.
    fn crossdim_mult(&self) -> f64 {
        if self.viewport_dim < 4 {
            return 1.0;
        }
        let mut bonus = 0.0;
        for &id in &self.loadout {
            if content::is_polytope_4d(SHAPES[id].family) {
                bonus += 0.06 * (1.0 + 0.15 * self.star_level(id) as f64);
            }
        }
        1.0 + bonus.min(0.6)
    }

    /// Two special "signature" globals: the Sphere is an Anchor (steadies the whole team — it's the identity
    /// element of connected sum), and the Hopf link entangles the entire floor at once (a global knot).
    fn signature_global_mult(&self) -> f64 {
        let mut m = 1.0;
        if self.loadout.contains(&0) {
            m *= 1.0 + 0.06 * (1.0 + 0.15 * self.star_level(0) as f64); // Sphere — Anchor
        }
        if self.loadout.contains(&39) {
            m *= 1.0 + 0.08 * (1.0 + 0.15 * self.star_level(39) as f64); // Hopf link — global entanglement
        }
        m
    }

    /// The Flux/hr cap on the *base* rate (BASE_IDLE + production), before global multipliers.
    fn cap_rate(&self) -> f64 {
        // BOTH cap levers are MULTIPLICATIVE so the ceiling scales with the rest of the economy instead of falling
        // behind (the old flat +300/hr overflow_cap was a ~+2.8%/lvl trap nobody was bound by). overflow_cap (#7,
        // Flux-bought) +8%/lvl; overflow_resonance (facet #5, prestige-bought) +10%/lvl. Density-scaled.
        let cap_bump = 1.0 + 0.08 * self.upgrade_level(7) as f64;
        let resonance = 1.0 + 0.10 * self.facet_level(5) as f64;
        // overclock (#19): a reversible session toggle — +60% ceiling while ON (paid for by a 4h offline clamp).
        let overclock = if self.overclock_on && self.upgrade_level(18) > 0 { 1.6 } else { 1.0 };
        RATE_CAP * content::FLUX_DENSITY * cap_bump * resonance * overclock
    }

    /// Product of every global multiplier (prestige, set, bonds, synergy, …) — applied on top of the
    /// capped base rate. Shared by the static-board and Orrery paths so they stack identically.
    fn globals_mult(&self) -> f64 {
        self.prestige_mult
            * self.set_bonus_mult()
            * self.bond_mult()
            * self.synergy_mult()
            * self.genus_resonance_mult()
            * self.doctrine_mult()
            * self.euler_surplus_mult()
            * self.milestone_mult()
            * self.facet_meta_mult()
            * self.ballast_mult()
            * self.crossdim_mult()
            * self.signature_global_mult()
    }

    /// euler_surplus (#16): +6%/level production per point of UNSPENT Euler-budget headroom (capped at 6). The
    /// first lever that rewards NOT deploying — leaving floor budget slack pays rent. A fully-deployed board
    /// (headroom 0) sees ×1.0; a lean board profits. Integer headroom ⇒ exact, O(1).
    fn euler_surplus_mult(&self) -> f64 {
        let lvl = self.upgrade_level(16);
        if lvl == 0 {
            return 1.0;
        }
        let headroom = self.effective_euler_cap().saturating_sub(self.euler_used());
        1.0 + 0.06 * headroom.min(6) as f64 * lvl as f64
    }

    pub fn rate_per_hr(&self) -> f64 {
        let production = if self.use_orrery {
            self.flux_avg_prod_per_hr()
        } else {
            self.deployed_production()
        };
        (BASE_IDLE + production).min(self.cap_rate()) * self.globals_mult()
    }

    // ── Orrery engine (active only when `use_orrery`) ──────────────────────────────────────────────
    /// A loadout shape's orbit: the topology default, with any player tune (phase/direction) applied on top.
    /// A loadout shape's lane parameters: `(anchor (q,r), axis, phase)` — the player's tune if present, else a
    /// deterministic topology default (slot-spread anchor) so the off-mode view still has something to draw.
    fn lane_params(&self, id: usize, slot: usize) -> ((i32, i32), usize, u8) {
        let def = &SHAPES[id];
        match self.orbit_tune.get(&(id as u16)) {
            Some(t) => ((t.q as i32, t.r as i32), t.axis as usize, t.phase),
            None => {
                let region = orrery::hex_region(self.orrery_radius());
                let a = region[slot % region.len()];
                (
                    a,
                    content::default_axis(def) as usize,
                    content::default_phase(def, slot),
                )
            }
        }
    }

    // ── Flux-emitter engine (the production model; see flux.rs) ─────────────────────────────────────────
    /// Build the stationary flux board from the loadout: each shape sits at its placement cell (reusing the
    /// anchor/axis/phase the player tunes), emits per its `EmitKind` at `per_shape_self_prod` strength, and
    /// acts on flux crossing it per `interaction`.
    fn flux_board(&self) -> flux::Board {
        let self_prod = self.per_shape_self_prod(); // flux/hr per slot
        let to_units = |per_hr: f64| (per_hr / 3600.0 * ORRERY_SCALE).round().max(0.0) as u64;
        let lens = self.upgrade_level(9); // lens_polish: +8%/lv to Multiply verbs
        let second_lens = self.upgrade_level(10) > 0; // second_lens: grant Common/Rare a 2nd verb
        let emitters = self
            .loadout
            .iter()
            .enumerate()
            .map(|(slot, &id)| {
                let def = &SHAPES[id];
                let ((q, r), axis, phase) = self.lane_params(id, slot);
                let amt = to_units(self_prod[slot]);
                // each pattern conserves the shape's base flux/hr on a clear board (scatter splits over 6 dirs;
                // pulse concentrates a period's worth into one burst), so positioning is what changes output.
                let emit = match content::emit_kind(def) {
                    content::EmitKind::Beam => flux::Emit::Beam { amount: amt },
                    content::EmitKind::Rotating => flux::Emit::Rotating { amount: amt },
                    content::EmitKind::Scatter => flux::Emit::Scatter { amount: amt / 6 },
                    content::EmitKind::Pulse => flux::Emit::Pulse { amount: amt * 3, period: 3 },
                };
                let mut act = content::interaction(def);
                let mut act2 = content::interaction2(def);
                // second_lens (#10): a Common/Rare shape with no second effect gains a gentle ×1.2 one. Applied
                // BEFORE lens_polish so the new lens also receives the polish bonus ("EVERY multiplier lens").
                if second_lens && act2 == flux::Act::Pass && matches!(def.rarity, Rarity::Common | Rarity::Rare) {
                    act2 = flux::Act::Multiply { num: 6, den: 5 };
                }
                // lens_polish (#9): +8%/level to every Multiply lens on the board (both verb slots)
                if lens > 0 {
                    let boost = |a: flux::Act| match a {
                        flux::Act::Multiply { num, den } => flux::Act::Multiply { num: num * (100 + 8 * lens), den: den * 100 },
                        // the flat ballast add gets the SAME +8%/level so the polish stays universal (integer: ×before÷)
                        flux::Act::Amplify { add } => flux::Act::Amplify { add: add * (100 + 8 * lens as u64) / 100 },
                        other => other,
                    };
                    act = boost(act);
                    act2 = boost(act2);
                }
                // sink_doctrine (#15): open anchors (cone/disk/cylinder) become SINKS — a crossing beam is boosted
                // ×1.5 THEN banked and stopped (Absorb), no longer chaining downstream. Placed AFTER lens_polish so
                // the +50% is a stable, telegraphable boost. flux_view MUST mirror this EXACT swap (keep in sync) or
                // the dust/ring desyncs from the banked truth.
                if self.upgrade_level(15) > 0 && content::is_open_anchor(def.family) {
                    act = flux::Act::Multiply { num: 5, den: 2 };
                    act2 = flux::Act::Absorb;
                }
                flux::Emitter { cell: orrery::pack(q, r), dir: axis as u8, phase, emit, act, act2 }
            })
            .collect();
        flux::Board { emitters, radius: self.orrery_radius(), rim_reflects: self.upgrade_level(19) as u8 }
    }

    /// Sustained production (flux/hr) = per-period average banked flux, mapped back to an hourly rate.
    fn flux_avg_prod_per_hr(&self) -> f64 {
        if self.loadout.is_empty() {
            return 0.0;
        }
        let (prefix, l) = self.flux_board().period_prefix();
        if l == 0 {
            return 0.0;
        }
        (prefix[l as usize] as f64 / l as f64) / ORRERY_SCALE * (3600.0 / ORRERY_TICK_SECONDS)
    }

    /// Per-deployed-shape flux/hr attribution (parallel to `loadout`) for the "DPS meter": `(direct, amp)`.
    /// `direct` = the shape's own banked output; `amp` = the support it lends OTHER shapes via its multiplier.
    /// Both carry the global multipliers so they read in the same units as the HUD rate; `Σ direct` is the
    /// orrery's production×globals (the bulk of `rate_per_hr`, bar the idle floor + any rate-cap throttle).
    fn flux_contributions(&self) -> Vec<(f64, f64)> {
        let n = self.loadout.len();
        if n == 0 {
            return Vec::new();
        }
        let board = self.flux_board();
        let l = board.period().max(1) as f64;
        let (direct, amp) = board.contributions();
        let g = self.globals_mult();
        let per_hr = |units: u64| units as f64 / l / ORRERY_SCALE * (3600.0 / ORRERY_TICK_SECONDS) * g;
        (0..n).map(|i| (per_hr(direct[i]), per_hr(amp[i]))).collect()
    }

    /// Closed-form flux catch-up over a (pre-capped) span — O(1) in the span: the exact periodic banked flux
    /// via `orrery::offline_flux`, throttled by the rate cap, plus the idle floor, times globals.
    fn flux_offline_gain(&self, capped_ms: f64) -> f64 {
        let idle_hours = capped_ms / MS_PER_HOUR;
        let idle = BASE_IDLE.min(self.cap_rate()) * idle_hours * self.globals_mult();
        if self.loadout.is_empty() {
            return idle;
        }
        let (prefix, l) = self.flux_board().period_prefix();
        if l == 0 {
            return idle;
        }
        let tick_ms = ORRERY_TICK_SECONDS * 1000.0;
        let ticks = (capped_ms / tick_ms).floor() as u64;
        let t0 = ((self.last_seen_ms / tick_ms).floor() as i64).rem_euclid(l as i64) as u32;
        let raw_prod_flux = orrery::offline_flux(&prefix, t0, ticks) as f64 / ORRERY_SCALE;
        let avg_prod = (prefix[l as usize] as f64 / l as f64) / ORRERY_SCALE * (3600.0 / ORRERY_TICK_SECONDS);
        let room = (self.cap_rate() - BASE_IDLE).max(0.0);
        let prod_factor = if avg_prod > room && avg_prod > 1e-9 { room / avg_prod } else { 1.0 };
        // offline_efficiency (#12): the orrery banks +15%/level more while you're away
        let offline_eff = 1.0 + 0.15 * self.upgrade_level(12) as f64;
        (BASE_IDLE * idle_hours + raw_prod_flux * prod_factor * offline_eff) * self.globals_mult()
    }

    /// Per-shape emitter descriptors for the UI (kinds as strings + the params the web needs to mirror the
    /// trace for animation). Parallel to `loadout`.
    fn flux_view(&self) -> Vec<FluxEmitterView> {
        let self_prod = self.per_shape_self_prod();
        // The web sheds one dust mote per flux at amount/3600 motes/sec, distributing by `emit` (direction +
        // timing only). So `amount` is this shape's flux/sec contribution INCLUDING the global multipliers
        // (prestige, set, bond, …) — otherwise the motes undercount the actual gain by the globals factor.
        // Grid-interaction multipliers (multiply cells) are applied web-side via mote splitting, NOT here.
        let globals = self.globals_mult();
        self.loadout
            .iter()
            .enumerate()
            .map(|(slot, &id)| {
                let def = &SHAPES[id];
                let ((q, r), axis, phase) = self.lane_params(id, slot);
                let emit = match content::emit_kind(def) {
                    content::EmitKind::Beam => "beam",
                    content::EmitKind::Rotating => "rotating",
                    content::EmitKind::Scatter => "scatter",
                    content::EmitKind::Pulse => "pulse",
                };
                let amount = self_prod[slot] * globals;
                let act_view = |a: flux::Act| -> (&'static str, f64, i8) {
                    match a {
                        flux::Act::Pass => ("pass", 1.0, 0),
                        flux::Act::Multiply { num, den } => ("multiply", num as f64 / den.max(1) as f64, 0),
                        flux::Act::Redirect { turn } => ("redirect", 1.0, turn),
                        flux::Act::Split { turn } => ("split", 1.0, turn),
                        flux::Act::Amplify { add } => ("amplify", add as f64, 0), // carry the flat add in act_mult (for the ring + dust)
                        flux::Act::Absorb => ("absorb", 1.0, 0),
                    }
                };
                let mut a1 = content::interaction(def);
                let mut a2 = content::interaction2(def);
                // sink_doctrine (#15): mirror flux_board's EXACT verb swap so the ring/dust telegraphs the sink
                // (multiply ×1.5 + absorb), not a plain Multiply. Kept in sync with flux_board (truth).
                if self.upgrade_level(15) > 0 && content::is_open_anchor(def.family) {
                    a1 = flux::Act::Multiply { num: 5, den: 2 };
                    a2 = flux::Act::Absorb;
                }
                let (act, act_mult, act_turn) = act_view(a1);
                let (act2, act2_mult, act2_turn) = act_view(a2);
                FluxEmitterView {
                    cell: (q, r),
                    dir: axis as u8,
                    phase,
                    emit,
                    act,
                    act_mult,
                    act_turn,
                    act2,
                    act2_mult,
                    act2_turn,
                    amount,
                    tuned: self.orbit_tune.contains_key(&(id as u16)),
                }
            })
            .collect()
    }

    /// Family set bonus (M7): completing the 5 Platonic solids grants a permanent global multiplier.
    /// Whether every shape in a NON-EMPTY family set (matching `pred`) is owned — shared by the set bonuses and
    /// the NG+ ascent gate. The non-empty guard avoids a vacuous `all()` granting a bonus for an absent set.
    fn owns_set(&self, pred: fn(&str) -> bool) -> bool {
        let ids: Vec<usize> = (0..COUNT).filter(|&id| pred(SHAPES[id].family)).collect();
        !ids.is_empty() && ids.iter().all(|&id| self.owned[id] > 0)
    }

    pub fn set_bonus_mult(&self) -> f64 {
        let platonic = content::PLATONIC_IDS.iter().all(|&id| self.owned[id] > 0);
        1.0 + if platonic { PLATONIC_SET_MULT } else { 0.0 }
            + if self.owns_set(content::is_polytope_4d) { POLYTOPE_SET_MULT } else { 0.0 }
            + if self.owns_set(content::is_knot) { KNOT_SET_MULT } else { 0.0 }
    }

    /// The requirement to ASCEND (Recrystallize) FROM the current viewport dimension. The first ascent (3D→4D)
    /// is the base core only — preserves onboarding + the existing band test. Each LATER ascent requires the
    /// CURRENT cohort owned AND STARRED (plus the prior cohort raised + an idle milestone at NG+2), so the
    /// in-game gate EQUALS the simulate completion metric and NG+ actually takes its target time. Without this,
    /// the cohort size is moot (you could ascend past an empty cohort).
    pub fn ascent_requirement_met(&self) -> bool {
        let (meta, transc) = content::metashape_ids();
        let all_at = |ids: &[usize], star: u32| ids.iter().all(|&id| self.owned[id] > 0 && self.star_level(id) >= star);
        match self.viewport_dim {
            0..=3 => self.core_complete(),
            4 => all_at(meta, 1) && self.owns_set(content::is_polytope_4d), // NG+1: Meta owned+★1 + the 4D-polytope set
            5 => all_at(transc, 1) && all_at(meta, 4), // NG+2: collect+★1 all 8 new Transcendent fractals AND master the prior Meta cohort to ★4 (Meta is 0.70%/pull → a tighter ~24–36h band than the noisier rare-Transcendent ★2)
            _ => self.core_complete(), // NG+3-5: a rising-star ladder — designed but deferred (sketch in the blueprint)
        }
    }

    /// Kin synergy: each kin pair with BOTH partners deployed adds a production multiplier (the shipping payoff).
    pub fn synergy_count(&self) -> u32 {
        // ORTHOGONALLY-ADJACENT kin pairs on the 2D board (the spatial-puzzle combo). Each touching pair is
        // counted once by only looking right + down from every occupied cell.
        let g = self.occupant_grid();
        let mut n = 0u32;
        for cell in 0..BOARD_N {
            let oi = g[cell];
            if oi < 0 {
                continue;
            }
            let a = self.loadout[oi as usize];
            let (r, col) = (cell / BOARD_W, cell % BOARD_W);
            let mut neigh = [-1i32; 2];
            if col + 1 < BOARD_W {
                neigh[0] = g[cell + 1];
            }
            if r + 1 < BOARD_H {
                neigh[1] = g[cell + BOARD_W];
            }
            for &ni in &neigh {
                if ni >= 0 {
                    let b = self.loadout[ni as usize];
                    if content::SYNERGY_PAIRS
                        .iter()
                        .any(|&(x, y)| (x == a && y == b) || (x == b && y == a))
                    {
                        n += 1;
                    }
                }
            }
        }
        n
    }
    pub fn synergy_mult(&self) -> f64 {
        let per_pair = SYNERGY_BONUS * if self.upgrade_level(2) > 0 { 2.0 } else { 1.0 }; // twin_bond
        1.0 + per_pair * self.synergy_count() as f64
    }

    pub fn upgrade_level(&self, id: usize) -> u32 {
        self.upgrades.get(id).copied().unwrap_or(0)
    }
    /// Star level (0–5) of a shape — derived from how many duplicate copies are owned.
    pub fn star_level(&self, id: usize) -> u32 {
        if id >= COUNT {
            return 0;
        }
        content::stars_from_dupes(SHAPES[id].rarity, self.owned[id].saturating_sub(1))
    }
    /// Floor space including the expand_floor upgrade (#0: +2 / level).
    pub fn effective_euler_cap(&self) -> u32 {
        self.euler_cap + 2 * self.upgrade_level(0) + self.facet_level(1) + self.milestone_euler_bonus() // resonant_floor + achievement budget
    }

    /// Anchor-grid radius. Grows just enough to comfortably seat the current Euler budget (one anchor per
    /// deployed shape, and a shape costs ≥1 Euler ⇒ #shapes ≤ cap), starting at a cozy 3-wide (radius 1 =
    /// 7 cells) and capped at `ORRERY_RADIUS` (61 cells). #cells(R) = 3R² + 3R + 1.
    /// Radius from a target cell count (smallest R with #cells(R)=3R²+3R+1 ≥ `need`), clamped to ORRERY_RADIUS.
    fn radius_for(need: i32) -> i32 {
        let mut r = 1;
        while r < ORRERY_RADIUS && 3 * r * r + 3 * r + 1 < need {
            r += 1;
        }
        r
    }

    /// The WORKSHOP-bought floor radius. Each `expand_floor` (#0) level opens the NEXT hex ring (radius 1+level →
    /// 7,19,37,61 cells), so every level is visibly felt — never the old dead zone where the χ-derived radius sat
    /// at 19 cells for L1..L6. It's also never smaller than the χ budget needs to SEAT (resonant_floor / milestone
    /// budget can raise the cap independently of the floor upgrade, and you can't waste χ you can't place).
    /// Clamped to the `ORRERY_RADIUS` ceiling (61 cells — the perf budget the mote/hex systems assume).
    fn floor_radius(&self) -> i32 {
        let by_upgrade = 1 + self.upgrade_level(0) as i32; // expand_floor opens one ring per level
        by_upgrade.max(Self::radius_for(self.effective_euler_cap() as i32)).min(ORRERY_RADIUS)
    }

    /// Number of placement cells on the bought floor — the hard cap on deployed shapes.
    fn floor_cells(&self) -> usize {
        orrery::hex_region(self.floor_radius()).len()
    }

    fn orrery_radius(&self) -> i32 {
        // The RENDERED radius is the bought floor, but never smaller than needed to hold a (legacy) board that
        // was over-deployed before the cap existed — so old saves don't overlap. New deploys are capped to the
        // bought floor (see `deploy`/`auto_arrange`), so this normally just equals `floor_radius`.
        self.floor_radius().max(Self::radius_for(self.loadout.len() as i32))
    }
    fn affinity_mult(&self) -> f64 {
        let base = if self.upgrade_level(6) > 0 { 1.5 } else { 1.0 }; // affinity_bloom
        base + self.milestone_affinity_bonus() // + achievement Affinity bonuses
    }
    /// genus_resonance (#1): +4% production per DISTINCT genus among deployed shapes, PER LEVEL — a scaling lever
    /// (L1 +4%/genus, L2 +8%, L3 +12%) so a genus-diverse floor has a long axis to chase, not a one-and-done bump.
    fn genus_resonance_mult(&self) -> f64 {
        let lvl = self.upgrade_level(1);
        if lvl == 0 {
            return 1.0;
        }
        let mut genera: Vec<u32> = self.loadout.iter().map(|&id| SHAPES[id].genus).collect();
        genera.sort_unstable();
        genera.dedup();
        1.0 + 0.04 * lvl as f64 * genera.len() as f64
    }
    /// Doctrine of Mastery / Variety (#13/#14) — the mutually-exclusive build fork, a global-production lever.
    /// Mastery rewards a "go tall" board (★ invested into deployed shapes); Variety rewards "go wide" (distinct
    /// shape families). Only one can ever be owned (EXCLUSIONS), so at most one branch contributes.
    fn doctrine_mult(&self) -> f64 {
        // Normally only one doctrine can be owned (the choke); with the polymath facet BOTH may apply, so multiply.
        let mut m = 1.0;
        if self.upgrade_level(13) > 0 {
            let stars: u32 = self.loadout.iter().map(|&id| self.star_level(id)).sum();
            m *= 1.0 + 0.04 * stars as f64;
        }
        if self.upgrade_level(14) > 0 {
            let mut fams: Vec<&str> = self.loadout.iter().map(|&id| SHAPES[id].family).collect();
            fams.sort_unstable();
            fams.dedup();
            m *= 1.0 + 0.05 * fams.len() as f64;
        }
        m
    }
    /// Tech-tree gate: an upgrade is unlocked when its prereq (if any) is at the required level AND its
    /// mutually-exclusive sibling (if any) has NOT been taken — picking one doctrine permanently locks the other.
    pub fn upgrade_unlocked(&self, id: usize) -> bool {
        // the polymath facet (#7) is a prestige RULE-CHANGER — it dissolves the doctrine choke so you may own both
        if self.facet_level(7) == 0 {
            if let Some(sib) = content::excluded_sibling(id) {
                if self.upgrade_level(sib) > 0 {
                    return false;
                }
            }
        }
        match content::UPGRADES.get(id).and_then(|u| u.requires) {
            Some((req, lvl)) => self.upgrade_level(req) >= lvl,
            None => true,
        }
    }
    pub fn buy_upgrade(&mut self, id: usize) -> bool {
        if id >= content::UPGRADE_COUNT || !self.upgrade_unlocked(id) {
            return false;
        }
        let level = self.upgrade_level(id);
        if level >= content::UPGRADES[id].max_level {
            return false;
        }
        let (flux_cost, shard_cost) = content::upgrade_cost(id, level);
        if self.flux < flux_cost || self.shards < shard_cost {
            return false;
        }
        self.flux -= flux_cost;
        self.shards -= shard_cost;
        self.upgrades[id] += 1;
        true
    }

    /// Distinct shapes owned within a rarity tier (for tier-completion achievements).
    fn owned_in_tier(&self, r: Rarity) -> u32 {
        content::rarity_ids(r).iter().copied().filter(|&id| self.owned[id] > 0).count() as u32
    }
    /// Whether achievement `i`'s condition currently holds — matched BY KEY so the table order is independent
    /// of the logic (only save positions are positional; append-only). All conditions are pure reads of state.
    fn milestone_condition(&self, i: usize) -> bool {
        let maxed_bonds = (0..COUNT).filter(|&id| self.bond_level(id) >= 5).count();
        let equipped_slots = self.equipped.iter().filter(|&&e| e != 0).count();
        let relic_n = content::rarity_ids(Rarity::Relic).len() as u32;
        match content::MILESTONES[i].key {
            // ── original 9 ──
            "own_10" => self.distinct_owned() >= 10,
            "own_25" => self.distinct_owned() >= 25,
            "core_complete" => self.core_complete(),
            "forge_3" => self.discovered.iter().filter(|&&d| d).count() >= 3,
            "bond_5" => maxed_bonds >= 1,
            "kin_3" => self.synergy_count() >= 3,
            "all_relics" => self.relics_owned() == relic_n,
            "platonic" => content::PLATONIC_IDS.iter().all(|&id| self.owned[id] > 0),
            "ascend" => self.ng_cycle >= 1,
            // ── collection ──
            "own_40" => self.distinct_owned() >= 40,
            "all_commons" => self.owned_in_tier(Rarity::Common) == content::rarity_ids(Rarity::Common).len() as u32,
            "all_rares" => self.owned_in_tier(Rarity::Rare) == content::rarity_ids(Rarity::Rare).len() as u32,
            "all_epics" => self.owned_in_tier(Rarity::Epic) == content::rarity_ids(Rarity::Epic).len() as u32,
            "all_ur" => self.owned_in_tier(Rarity::Ur) == content::rarity_ids(Rarity::Ur).len() as u32,
            "first_ur" => self.owned_in_tier(Rarity::Ur) >= 1,
            // ── stars ──
            "first_star" => (0..COUNT).any(|id| self.star_level(id) >= 1),
            "star_master" => (0..COUNT).any(|id| self.star_level(id) >= 5),
            "constellation" => (0..COUNT).filter(|&id| self.star_level(id) >= 1).count() >= 10,
            // ── economy (lifetime flux, density-scaled units = what the player sees) ──
            "flux_million" => self.lifetime_flux >= 1.0e6,
            "flux_billion" => self.lifetime_flux >= 1.0e9,
            "flux_trillion" => self.lifetime_flux >= 1.0e12,
            // ── shards ──
            "shards_100" => self.lifetime_shards >= 100,
            "shards_5k" => self.lifetime_shards >= 5_000,
            "shards_50k" => self.lifetime_shards >= 50_000,
            "flush" => self.shards >= 2000, // a real hoard (resisting the forge) — not just a few dupes
            // ── forge ──
            "first_forge" => self.total_forges >= 1,
            "forge_10" => self.total_forges >= 10,
            "forge_50" => self.total_forges >= 50,
            "all_recipes" => self.discovered.iter().filter(|&&d| d).count() >= content::RECIPES.len(),
            "fusion_adept" => self.forged.iter().filter(|&&f| f).count() >= 5,
            // ── bonds ──
            "first_bond" => (0..COUNT).any(|id| self.bond_level(id) >= 1),
            "soulbound_3" => maxed_bonds >= 3,
            "soulbound_5" => maxed_bonds >= 5,
            "soulbound_10" => maxed_bonds >= 10,
            // ── orrery / board ──
            "deploy_5" => self.loadout.len() >= 5,
            "deploy_10" => self.loadout.len() >= 10,
            "synergy_5" => self.synergy_count() >= 5,
            "floor_full" => !self.loadout.is_empty() && self.euler_used() >= self.effective_euler_cap(),
            // ── shop / cosmetics ──
            "first_cosmetic" => !self.cosmetics.is_empty(),
            "cosmetics_5" => self.cosmetics.len() >= 5,
            "cosmetics_15" => self.cosmetics.len() >= 15,
            "equip_3" => equipped_slots >= 3,
            "fully_dressed" => equipped_slots >= COSMETIC_SLOTS,
            "redecorated" => self.scene != 0,
            // ── prestige ──
            "ascend_2" => self.ng_cycle >= 2,
            "ascend_3" => self.ng_cycle >= 3,
            "reach_4d" => self.viewport_dim >= 4,
            // ── gacha ──
            "pull_100" => self.pity.counter >= 100,
            "pull_1000" => self.pity.counter >= 1000,
            "ur_5" => self.pulls_by_rarity.get(4).copied().unwrap_or(0) >= 5,
            // ── dedication / meta ──
            "completionist" => self.core_complete() && self.relics_owned() == relic_n,
            "grand_tour" => self.ng_cycle >= 1 && self.core_complete(),
            "devoted" => maxed_bonds >= 5 && self.core_complete(),
            _ => false,
        }
    }
    /// Latch any newly-achieved milestones (idempotent; called from tick). A Flux-effect milestone pays out its
    /// one-time grant the moment it latches.
    fn refresh_milestones(&mut self) {
        for i in 0..content::MILESTONE_COUNT {
            if !self.milestones_done[i] && self.milestone_condition(i) {
                self.milestones_done[i] = true;
                if let content::MilestoneEffect::Flux(f) = content::MILESTONES[i].effect {
                    let grant = f * content::FLUX_DENSITY;
                    self.flux += grant;
                    self.lifetime_flux += grant;
                }
            }
        }
    }
    /// Sum a chosen numeric milestone effect over the latched achievements.
    fn milestone_sum(&self, pick: impl Fn(content::MilestoneEffect) -> f64) -> f64 {
        self.milestones_done
            .iter()
            .enumerate()
            .filter(|&(i, &done)| done && i < content::MILESTONE_COUNT)
            .map(|(i, _)| pick(content::MILESTONES[i].effect))
            .sum()
    }
    /// Global production multiplier from Production milestones (1.0 + Σ).
    pub fn milestone_mult(&self) -> f64 {
        1.0 + self.milestone_sum(|e| if let content::MilestoneEffect::Production(f) = e { f } else { 0.0 })
    }
    /// +hours to the offline catch-up cap from Offline milestones.
    fn milestone_offline_hours(&self) -> f64 {
        self.milestone_sum(|e| if let content::MilestoneEffect::Offline(h) = e { h } else { 0.0 })
    }
    /// Duplicate-pull shard multiplier from Shards milestones (1.0 + Σ).
    fn milestone_shard_mult(&self) -> f64 {
        1.0 + self.milestone_sum(|e| if let content::MilestoneEffect::Shards(f) = e { f } else { 0.0 })
    }
    /// Forge-cost multiplier from Forge milestones: ×(1 − Σ), floored so a forge is never free.
    fn milestone_forge_mult(&self) -> f64 {
        (1.0 - self.milestone_sum(|e| if let content::MilestoneEffect::Forge(f) = e { f } else { 0.0 })).max(0.25)
    }
    /// +affinity-gain from Affinity milestones (added onto the affinity multiplier).
    fn milestone_affinity_bonus(&self) -> f64 {
        self.milestone_sum(|e| if let content::MilestoneEffect::Affinity(f) = e { f } else { 0.0 })
    }
    /// +Euler floor budget from Euler milestones.
    fn milestone_euler_bonus(&self) -> u32 {
        self.milestone_sum(|e| if let content::MilestoneEffect::Euler(n) = e { n as f64 } else { 0.0 }) as u32
    }

    pub fn facet_level(&self, id: usize) -> u32 {
        self.facet_perks.get(id).copied().unwrap_or(0)
    }
    fn facet_meta_mult(&self) -> f64 {
        1.0 + 0.05 * self.facet_level(0) as f64 // meta_production — permanent global %
    }
    fn prestige_base(&self) -> f64 {
        1.6 + 0.1 * self.facet_level(4) as f64 // ascendant — compounds per ascent
    }
    pub fn buy_facet_perk(&mut self, id: usize) -> bool {
        if id >= content::FACET_PERK_COUNT {
            return false;
        }
        let level = self.facet_level(id);
        if level >= content::FACET_PERKS[id].max_level {
            return false;
        }
        let cost = content::facet_perk_cost(id, level);
        if self.facets < cost {
            return false;
        }
        self.facets -= cost;
        self.facet_perks[id] += 1;
        if id == 4 {
            // ascendant raises the prestige base — recompute the live multiplier now
            self.prestige_mult = self.prestige_base().powi(self.ng_cycle as i32);
        }
        true
    }

    pub fn bond_level(&self, id: usize) -> u32 {
        let a = self.bonds.get(id).copied().unwrap_or(0);
        let mut lvl = 0;
        for (i, &t) in BOND_THRESHOLDS.iter().enumerate() {
            if a >= t {
                lvl = i as u32;
            }
        }
        lvl
    }

    /// Small permanent buff from the bond levels of deployed shapes (rewards attachment, never required).
    pub fn bond_mult(&self) -> f64 {
        let lv: u32 = self.loadout.iter().map(|&id| self.bond_level(id)).sum();
        1.0 + 0.03 * lv as f64
    }

    fn add_affinity(&mut self, dt_ms: f64) {
        let gain = (AFFINITY_PER_HR_DEPLOYED * self.affinity_mult() * dt_ms / MS_PER_HOUR) as u32;
        if gain == 0 {
            return;
        }
        let cap = *BOND_THRESHOLDS.last().unwrap();
        for id in self.loadout.clone() {
            self.bonds[id] = (self.bonds[id] + gain).min(cap);
        }
    }

    /// Inspecting a shape (a calm, zero-skill action) grants affinity — the idler's path to bonds.
    pub fn inspect(&mut self, id: usize) {
        if id < COUNT && self.owned[id] > 0 {
            let cap = *BOND_THRESHOLDS.last().unwrap();
            let gain = (BOND_INSPECT_GAIN as f64 * self.affinity_mult()) as u32;
            self.bonds[id] = (self.bonds[id] + gain).min(cap);
        }
    }

    /// A bootstrap "polish" tap in the Forge: grants a little Flux scaled to the shape (trivial once idle
    /// income dwarfs it, but it gets the first pulls moving — clicker-style early progression). Returns the
    /// reward so the UI can float a "+N". NOT part of the idle/offline path, so it can't affect the balance sim.
    pub fn tap_shape(&mut self, id: usize) -> f64 {
        if id >= COUNT || self.owned[id] == 0 {
            return 0.0;
        }
        let reward = (2.0 + SHAPES[id].base_prod * 0.02) * content::FLUX_DENSITY;
        self.flux += reward;
        self.lifetime_flux += reward;
        reward
    }

    /// A "pat" — a very minor affinity bump, capped per shape per time window so spam-patting can't grind
    /// bonds (the calm path is `inspect`, which stays uncapped). The cap is authoritative truth: TS only
    /// fires the cosmetic touch; whether it actually moves the bond is decided here.
    pub fn pat(&mut self, id: usize) {
        if id >= COUNT || self.owned[id] == 0 {
            return;
        }
        // Roll the shared budget window off the last known time — a fresh pat allowance for every shape
        // each period. (Uses last_seen_ms, refreshed every tick, so it's wall-clock-free in the RNG path.)
        if self.last_seen_ms - self.pat_window_ms >= BOND_PAT_PERIOD_MS {
            self.pat_window_ms = self.last_seen_ms;
            for g in self.pat_gained.iter_mut() {
                *g = 0;
            }
        }
        let remaining = BOND_PAT_CAP_PER_SHAPE.saturating_sub(self.pat_gained[id]);
        if remaining == 0 {
            return; // this one's had enough fuss for now
        }
        let gain = ((BOND_PAT_GAIN as f64 * self.affinity_mult()) as u32).min(remaining);
        let cap = *BOND_THRESHOLDS.last().unwrap();
        self.bonds[id] = (self.bonds[id] + gain).min(cap);
        self.pat_gained[id] += gain;
    }

    /// Shards to forge a given output shape right now — scaled by the output's rarity, halved by the
    /// `forge_mastery` upgrade (#5). The single source of truth shared by `forge()`, the view, and the
    /// bench, so the UI never hardcodes a price (see prime directive).
    pub fn forge_cost(&self, out: usize) -> u64 {
        let rarity = if out < COUNT {
            SHAPES[out].rarity
        } else {
            Rarity::Epic
        };
        let base = content::base_forge_cost(rarity);
        let after_mastery = if self.upgrade_level(5) > 0 { base / 2 } else { base }; // forge_mastery (#5)
        // achievement Forge discounts stack on top, multiplicatively; never let a forge become free.
        ((after_mastery as f64 * self.milestone_forge_mult()).floor() as u64).max(1)
    }

    /// Shards it would cost to forge a # b right now (0 if the pair can't be forged) — for the bench/UI.
    pub fn pair_forge_cost(&self, a: usize, b: usize) -> u64 {
        content::connected_sum(a, b).map_or(0, |out| self.forge_cost(out))
    }

    /// Forge two owned shapes via connected sum — ANY surface pair whose connected sum is a catalogued shape,
    /// not just the curated recipe book (the free-form fusion bench). Grants the output, costs shards, and
    /// flags the discovery sting the first time you ever forge that output shape.
    pub fn forge(&mut self, a: usize, b: usize) -> ForgeResult {
        let fail = ForgeResult {
            ok: false,
            out_id: -1,
            is_discovery: false,
        };
        // The law: ANY two surfaces glue if their connected sum is a shape we catalogue. `connected_sum`
        // already bounds-checks a,b and rejects non-surfaces / un-catalogued results.
        let Some(out) = content::connected_sum(a, b) else {
            return fail;
        };
        let cost = self.forge_cost(out);
        if self.owned[a] == 0 || self.owned[b] == 0 || self.shards < cost {
            return fail;
        }
        self.shards -= cost;
        self.total_forges += 1;
        self.grant(out, SHAPES[out].rarity);
        // Discovery is once per output SHAPE (the codex unlock), whichever recipe produced it first.
        let is_discovery = !self.forged[out];
        self.forged[out] = true;
        // Keep the recipe-book ✓ (and the forge_3 milestone) in sync when a curated recipe was used.
        if let Some(ri) = content::find_recipe(a, b) {
            self.discovered[ri] = true;
        }
        if is_discovery {
            self.shards += 100; // discovery sting reward
            self.lifetime_shards += 100;
        }
        ForgeResult {
            ok: true,
            out_id: out as i32,
            is_discovery,
        }
    }

    /// Preview a forge without committing — the output shape id, or -1 if the pair can't be forged. Lets the
    /// free-form bench show the result (and its invariants) before you spend a shard.
    pub fn preview_forge(&self, a: usize, b: usize) -> i32 {
        content::connected_sum(a, b).map_or(-1, |o| o as i32)
    }

    /// Projected `rate_per_hr` IF this upgrade were one level higher — the what-if behind the Workshop's "→ +X/hr"
    /// badge (TS subtracts this from the current rate). A PROJECTION: ignores affordability (so you see the impact
    /// before you can afford it) and never recomputes the economy in TS. At max level it returns the current rate
    /// (Δ 0). Mirrors `preview_forge`. O(1)-ish: one state clone + one rate eval, on demand only.
    pub fn rate_after_upgrade(&self, id: usize) -> f64 {
        if id >= self.upgrades.len() {
            return self.rate_per_hr();
        }
        let mut g = self.clone();
        if g.upgrades[id] < content::UPGRADES[id].max_level {
            g.upgrades[id] += 1;
        }
        g.rate_per_hr()
    }

    /// Projected `rate_per_hr` IF this facet perk were one level higher — same what-if contract as `rate_after_upgrade`.
    pub fn rate_after_facet(&self, id: usize) -> f64 {
        if id >= self.facet_perks.len() {
            return self.rate_per_hr();
        }
        let mut g = self.clone();
        if g.facet_perks[id] < content::FACET_PERKS[id].max_level {
            g.facet_perks[id] += 1;
        }
        g.rate_per_hr()
    }

    /// overpressure_valve (#18): Shards/hr recovered from flux that OVERFLOWS the rate cap (currently deleted by
    /// the `.min(cap_rate())` clamp). Reads the SAME production basis the clamp uses (orrery avg vs static), so
    /// "over-cap" matches exactly what was discarded. Zero while under the cap ⇒ never accelerates core flux.
    pub fn overcap_shard_rate_per_hr(&self) -> f64 {
        let lvl = self.upgrade_level(17);
        if lvl == 0 {
            return 0.0;
        }
        let prod = if self.use_orrery {
            self.flux_avg_prod_per_hr()
        } else {
            self.deployed_production()
        };
        let room = (self.cap_rate() - BASE_IDLE).max(0.0);
        let over = (prod - room).max(0.0);
        over * (0.10 * lvl as f64) / SHARD_PER_OVERCAP_FLUX
    }

    /// Accrue over-cap spill shards across an elapsed span. Shared by `tick` (online) AND `compute_offline`, so
    /// the two paths are IDENTICAL by construction; the fractional `overcap_carry` threads through both ⇒ online
    /// and offline round bit-for-bit the same. O(1) (the over-cap rate is piecewise-constant between actions).
    fn accrue_overcap_shards(&mut self, span_ms: f64) {
        let rate = self.overcap_shard_rate_per_hr();
        if rate <= 0.0 {
            return;
        }
        let s = rate * (span_ms / MS_PER_HOUR) + self.overcap_carry;
        let whole = s.floor();
        self.shards += whole as u64;
        self.lifetime_shards += whole as u64;
        self.overcap_carry = s - whole;
    }

    /// Foreground accumulation (rate is piecewise-constant between actions → O(1)).
    pub fn tick(&mut self, now_ms: f64) {
        let dt = (now_ms - self.last_seen_ms).max(0.0);
        let gain = self.rate_per_hr() * (dt / MS_PER_HOUR);
        self.flux += gain;
        self.lifetime_flux += gain;
        self.accrue_overcap_shards(dt); // overpressure_valve (#18): bank shards from over-cap spill
        self.accrue_expedition_rewards(dt); // expeditions: closed-form Echoes + Flux from stationed teams
        self.accrue_farm_xp(dt); // expeditions: closed-form farmed XP per stationed member
        self.accrue_run(now_ms); // v6: advance the in-flight Delve run to the current wall-clock (inert when None)
        self.add_affinity(dt);
        self.refresh_milestones();
        self.last_seen_ms = now_ms;
    }

    /// Closed-form offline catch-up (same formula, capped). Instant even after weeks away.
    pub fn compute_offline(&mut self, now_ms: f64) -> OfflineReport {
        let elapsed = (now_ms - self.last_seen_ms).max(0.0);
        let cap = OFFLINE_CAP_MS + self.upgrade_level(3) as f64 * 12.0 * MS_PER_HOUR // patience (#3)
            + self.milestone_offline_hours() * MS_PER_HOUR; // + achievement Offline bonuses
        // overclock (#19): while ON, away-time generosity is the price of the +60% active ceiling — offline ≤ 4h.
        let cap = if self.overclock_on && self.upgrade_level(18) > 0 {
            cap.min(4.0 * MS_PER_HOUR)
        } else {
            cap
        };
        let capped = elapsed.min(cap);
        let gained = if self.use_orrery {
            self.flux_offline_gain(capped) // exact periodic, closed-form O(1)
        } else {
            self.rate_per_hr() * (capped / MS_PER_HOUR)
        };
        self.flux += gained;
        self.lifetime_flux += gained;
        self.accrue_overcap_shards(capped); // overpressure_valve (#18): same helper as tick ⇒ offline rounds identically
        let echoes_before = self.echoes;
        self.accrue_expedition_rewards(capped); // expeditions: same helper as tick ⇒ Echoes+Flux farm rounds identically offline
        self.accrue_farm_xp(capped); // expeditions: farmed XP, same helper as tick
        let had_run = self.active_run.is_some();
        self.accrue_run(self.last_seen_ms + capped); // v6: advance the run by the CAPPED span (offline generosity applies)
        // a delve that completed DURING this span (active → none) is celebrated on load (offline peak-end, parity with online)
        let delve_returned = (had_run && self.active_run.is_none()).then(|| self.run_history.first().cloned()).flatten();
        self.add_affinity(capped);
        self.last_seen_ms = now_ms;
        OfflineReport {
            elapsed_ms: elapsed,
            capped_ms: capped,
            gained_flux: gained,
            gained_echoes: self.echoes - echoes_before,
            delve_returned,
        }
    }

    fn first_missing(&self, ids: &[usize]) -> Option<usize> {
        ids.iter().copied().find(|&id| self.owned[id] == 0)
    }

    fn grant(&mut self, id: usize, r: Rarity) -> (bool, u64) {
        let was_new = self.owned[id] == 0;
        self.owned[id] += 1;
        if was_new {
            (true, 0)
        } else {
            let mut mult = if self.upgrade_level(4) > 0 { 1.5 } else { 1.0 }; // shard_dividend (#4)
            mult *= 1.0 + 0.15 * self.facet_level(3) as f64; // collectors_eye
            mult *= self.milestone_shard_mult(); // achievement Shards bonuses
            let s = (shard_value(r) as f64 * mult).floor() as u64;
            self.shards += s;
            self.lifetime_shards += s;
            (false, s)
        }
    }

    /// Pull once. Banks production to `now` first, then spends Flux. Steers tops to a missing "wanted"
    /// shape; lower tiers are random in-tier. Applies the Resonance Spark (UR-priority, SSR-spill).
    /// Which shape to grant for a rolled tier. On a themed banner, a rate-up roll biases the pick toward a
    /// featured shape in that tier (preferring a missing one); otherwise the standard steering applies.
    fn pick_pull_shape(&self, rarity: Rarity, ids: &[usize], counter: u64) -> usize {
        let b = self.current_banner as usize;
        if b < content::BANNER_COUNT && !content::BANNERS[b].featured.is_empty() {
            let featured: Vec<usize> = content::BANNERS[b]
                .featured
                .iter()
                .copied()
                .filter(|id| ids.contains(id))
                .collect();
            if !featured.is_empty() && banner_unit(self.master_seed, counter) < BANNER_RATEUP {
                return featured
                    .iter()
                    .copied()
                    .find(|&id| self.owned[id] == 0)
                    .unwrap_or(featured[0]);
            }
        }
        match rarity {
            // top tiers (incl. metashapes) steer to the first missing shape, then fall back to a dupe. The index
            // picks into the tier's id LIST (was `range.start + i`) — bit-identical while base tiers stay ordered.
            Rarity::Ur | Rarity::Ssr | Rarity::Meta | Rarity::Transcendent => self
                .first_missing(ids)
                .unwrap_or(ids[shape_index(self.master_seed, counter, ids.len())]),
            _ => ids[shape_index(self.master_seed, counter, ids.len())],
        }
    }

    pub fn pull(&mut self, now_ms: f64) -> PullOutcome {
        self.tick(now_ms);
        if self.flux < PULL_COST {
            return PullOutcome {
                ok: false,
                shape_id: -1,
                rarity: None,
                is_new: false,
                dupe_shards: 0,
                spark_shape_id: -1,
                spark_is_new: false,
            };
        }
        self.flux -= PULL_COST;

        let c_before = self.pity.counter;
        // Metashapes enter the pool as you ascend dimensions: Meta at 4D (NG+1), Transcendent at 5D (NG+2).
        let roll = roll_rarity(
            self.master_seed,
            &mut self.pity,
            self.viewport_dim >= 4,
            self.viewport_dim >= 5,
        );
        let ids = content::rarity_ids(roll.rarity);

        // Rare "lucky find": a small chance the pull turns up a missing Relic instead of the rolled shape.
        let relic_chance = if self.current_banner == 0 {
            RELIC_DROP_STD
        } else {
            RELIC_DROP_BANNER
        };
        let (id, out_rarity) = match (
            relic_unit(self.master_seed, c_before) < relic_chance,
            self.first_missing(content::rarity_ids(Rarity::Relic)),
        ) {
            (true, Some(rid)) => (rid, Rarity::Relic),
            _ => (
                self.pick_pull_shape(roll.rarity, ids, c_before),
                roll.rarity,
            ),
        };
        let (is_new, dupe_shards) = self.grant(id, out_rarity);
        let ridx = match out_rarity {
            Rarity::Common => 0,
            Rarity::Rare => 1,
            Rarity::Epic => 2,
            Rarity::Ssr => 3,
            _ => 4,
        };
        if ridx < self.pulls_by_rarity.len() {
            self.pulls_by_rarity[ridx] += 1;
        }

        let (mut spark_shape_id, mut spark_is_new) = (-1i32, false);
        if roll.spark_fired {
            let claim = self
                .first_missing(content::rarity_ids(Rarity::Ur))
                .or_else(|| self.first_missing(content::rarity_ids(Rarity::Ssr)));
            if let Some(sid) = claim {
                let r = SHAPES[sid].rarity;
                let (new, _) = self.grant(sid, r);
                spark_shape_id = sid as i32;
                spark_is_new = new;
            }
        }

        PullOutcome {
            ok: true,
            shape_id: id as i32,
            rarity: Some(out_rarity),
            is_new,
            dupe_shards,
            spark_shape_id,
            spark_is_new,
        }
    }

    pub fn euler_used(&self) -> u32 {
        self.loadout.iter().map(|&id| SHAPES[id].euler_cost).sum()
    }

    fn first_free_cell(&self) -> Option<u8> {
        (0..BOARD_N as u8).find(|c| !self.board_cells.contains(c))
    }
    /// grid cell index -> position in `loadout` (or -1). The authoritative 2D placement.
    fn occupant_grid(&self) -> [i32; BOARD_N] {
        let mut g = [-1i32; BOARD_N];
        for (i, &c) in self.board_cells.iter().enumerate() {
            if (c as usize) < BOARD_N {
                g[c as usize] = i as i32;
            }
        }
        g
    }
    /// the (up to 4) orthogonal neighbour cells of a cell, -1 where off the board.
    fn cell_neighbors(cell: u8) -> [i32; 4] {
        let c = cell as usize;
        let (r, col) = (c / BOARD_W, c % BOARD_W);
        [
            if col > 0 { (c - 1) as i32 } else { -1 },
            if col + 1 < BOARD_W {
                (c + 1) as i32
            } else {
                -1
            },
            if r > 0 { (c - BOARD_W) as i32 } else { -1 },
            if r + 1 < BOARD_H {
                (c + BOARD_W) as i32
            } else {
                -1
            },
        ]
    }
    pub fn deploy(&mut self, id: usize) -> bool {
        if id >= COUNT || self.owned[id] == 0 || self.loadout.contains(&id) {
            return false;
        }
        if self.euler_used() + SHAPES[id].euler_cost > self.effective_euler_cap() {
            return false;
        }
        if self.loadout.len() >= self.floor_cells() {
            return false; // the bought floor is full — buy `expand_floor` in the Workshop for the next ring
        }
        let Some(cell) = self.first_free_cell() else {
            return false;
        };
        self.loadout.push(id);
        self.board_cells.push(cell);
        if self.use_orrery {
            self.assign_anchor(id);
        }
        true
    }

    // ── Orrery anchor placement (hex grid) ─────────────────────────────────────
    /// First anchor cell (region order) not occupied by another shape's tune.
    fn first_free_hex(&self) -> (i32, i32) {
        let used: std::collections::HashSet<(i8, i8)> =
            self.orbit_tune.values().map(|t| (t.q, t.r)).collect();
        orrery::hex_region(self.orrery_radius())
            .into_iter()
            .find(|&(q, r)| !used.contains(&(q as i8, r as i8)))
            .unwrap_or((0, 0))
    }
    /// Materialise a deployed shape's lane tune (free anchor + topology default axis/phase) if it has none.
    fn assign_anchor(&mut self, id: usize) {
        if self.orbit_tune.contains_key(&(id as u16)) {
            return;
        }
        let (q, r) = self.first_free_hex();
        let slot = self.loadout.iter().position(|&x| x == id).unwrap_or(0);
        let def = &SHAPES[id];
        self.orbit_tune.insert(
            id as u16,
            OrbitTune {
                q: q as i8,
                r: r as i8,
                axis: content::default_axis(def),
                phase: content::default_phase(def, slot),
            },
        );
    }
    /// Ensure every deployed shape has an anchor (called when the Orrery is switched on).
    fn ensure_anchors(&mut self) {
        for id in self.loadout.clone() {
            self.assign_anchor(id);
        }
    }
    /// Drag a shape's anchor to `(q,r)`. Out-of-region is rejected; an occupied target SWAPS the two shapes'
    /// anchors (anchors stay unique). Returns false if `id` isn't deployed or the target is off-grid.
    fn move_anchor(&mut self, id: usize, q: i32, r: i32) -> bool {
        if !self.loadout.contains(&id) || orrery::hex_dist(q, r) > self.orrery_radius() {
            return false;
        }
        self.assign_anchor(id);
        let (tq, tr) = (q as i8, r as i8);
        let key = id as u16;
        let my_old = {
            let t = &self.orbit_tune[&key];
            (t.q, t.r)
        };
        if (tq, tr) == my_old {
            return true;
        }
        let occupant = self
            .orbit_tune
            .iter()
            .find(|(&k, t)| k != key && t.q == tq && t.r == tr)
            .map(|(&k, _)| k);
        if let Some(o) = occupant {
            let t = self.orbit_tune.get_mut(&o).unwrap();
            t.q = my_old.0;
            t.r = my_old.1;
        }
        let t = self.orbit_tune.get_mut(&key).unwrap();
        t.q = tq;
        t.r = tr;
        true
    }
    /// Rotate a shape's lane to the next of the 6 hex axes.
    fn cycle_axis(&mut self, id: usize) {
        if !self.loadout.contains(&id) {
            return;
        }
        self.assign_anchor(id);
        let t = self.orbit_tune.get_mut(&(id as u16)).unwrap();
        t.axis = (t.axis + 1) % 6;
    }
    /// Set a shape's lane phase (timing).
    fn set_lane_phase(&mut self, id: usize, phase: u8) {
        if !self.loadout.contains(&id) {
            return;
        }
        self.assign_anchor(id);
        self.orbit_tune.get_mut(&(id as u16)).unwrap().phase = phase;
    }
    /// Reset a shape's axis + phase to the topology default (keeps its anchor).
    fn reset_lane(&mut self, id: usize) {
        if let Some(slot) = self.loadout.iter().position(|&x| x == id) {
            let def = &SHAPES[id];
            if let Some(t) = self.orbit_tune.get_mut(&(id as u16)) {
                t.axis = content::default_axis(def);
                t.phase = content::default_phase(def, slot);
            }
        }
    }
    /// Manual puzzle move: put `id` at `cell` (auto-deploying it if needed). If the cell is taken, the two
    /// shapes swap cells. Returns false if the move is impossible.
    pub fn place_at(&mut self, id: usize, cell: u8) -> bool {
        if (cell as usize) >= BOARD_N {
            return false;
        }
        let idx = match self.loadout.iter().position(|&x| x == id) {
            Some(i) => i,
            None => {
                if !self.deploy(id) {
                    return false;
                }
                self.loadout.len() - 1
            }
        };
        let cur = self.board_cells[idx];
        if let Some(j) = self.board_cells.iter().position(|&c| c == cell) {
            self.board_cells[j] = cur; // swap with the occupant
        }
        self.board_cells[idx] = cell;
        true
    }

    pub fn undeploy(&mut self, id: usize) -> bool {
        if let Some(i) = self.loadout.iter().position(|&x| x == id) {
            self.loadout.remove(i);
            if i < self.board_cells.len() {
                self.board_cells.remove(i);
            }
            self.orbit_tune.remove(&(id as u16));
            true
        } else {
            false
        }
    }

    /// Greedy "good-enough" loadout so idlers never face the puzzle: free ballast first, then best
    /// production-per-Euler-cost while budget remains.
    pub fn auto_arrange(&mut self) {
        self.loadout.clear();
        // NOTE: orbit_tune is NOT cleared — the solver seeds from any existing placement so re-running Auto can
        // only improve a board you've already tuned (monotonic hill-climb), never regress it.
        let mut ids: Vec<usize> = (0..COUNT).filter(|&i| self.owned[i] > 0).collect();
        ids.sort_by(|&a, &b| {
            let eff = |id: usize| {
                let c = SHAPES[id].euler_cost;
                if c == 0 {
                    f64::INFINITY
                } else {
                    content::effective_prod(id) / c as f64
                }
            };
            eff(b)
                .partial_cmp(&eff(a))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self.board_cells.clear();
        let mut used = 0u32;
        let cells = self.floor_cells();
        for id in ids {
            if self.loadout.len() >= cells {
                break; // bought floor is full — Auto won't over-deploy past the placement cap
            }
            let c = SHAPES[id].euler_cost;
            if used + c <= self.effective_euler_cap() {
                if let Some(cell) = self.first_free_cell() {
                    self.loadout.push(id);
                    self.board_cells.push(cell);
                    used += c;
                }
            }
        }
        self.optimize_placement();
    }

    /// Solve the Orrery placement to maximise the ACTUAL flux rate — the real spatial puzzle now that flux is
    /// DIRECTIONAL (a beam aimed through a chain of multipliers/splitters banks far more than one fired off the
    /// rim). Writes `orbit_tune` (the cell + facing the flux engine actually reads — NOT the legacy `board_cells`,
    /// which the orrery production ignores). DUAL-SEED hill-climb: solve once keeping your current placement (so
    /// a good hand-tuned board is never lost) and once from a fresh default (so a bad local optimum can't trap
    /// it), then keep whichever banks more. Deterministic + bounded, so a big board still solves in a snap.
    fn optimize_placement(&mut self) {
        let n = self.loadout.len();
        if n == 0 {
            return;
        }
        let region = orrery::hex_region(self.orrery_radius());
        if region.is_empty() {
            return;
        }
        let ids: Vec<usize> = self.loadout.clone();
        self.orbit_tune.retain(|&k, _| ids.contains(&(k as usize)));
        if n < 2 {
            self.seed_placement(&ids, &region, true);
            return;
        }
        // candidate A — keep your existing placement, then climb
        self.seed_placement(&ids, &region, true);
        let rate_a = self.hill_climb_placement(&ids, &region);
        let tune_a = self.orbit_tune.clone();
        // candidate B — fresh default placement, then climb (can escape a degraded existing layout)
        self.seed_placement(&ids, &region, false);
        let rate_b = self.hill_climb_placement(&ids, &region);
        if rate_a >= rate_b {
            self.orbit_tune = tune_a; // existing-seed won (or tied) → restore it
        }
    }

    /// Seed `orbit_tune` for every deployed shape on a distinct region cell. `keep_existing` reuses a shape's
    /// current valid cell (preserve a hand-tuned board); otherwise everyone gets the tidy default placement.
    fn seed_placement(&mut self, ids: &[usize], region: &[(i32, i32)], keep_existing: bool) {
        let mut taken: Vec<(i32, i32)> = Vec::new();
        for (slot, &id) in ids.iter().enumerate() {
            let keep = if keep_existing {
                self.orbit_tune.get(&(id as u16)).and_then(|t| {
                    let c = (t.q as i32, t.r as i32);
                    (region.contains(&c) && !taken.contains(&c)).then_some(c)
                })
            } else {
                None
            };
            let cell = keep.unwrap_or_else(|| *region.iter().find(|c| !taken.contains(c)).unwrap_or(&region[slot % region.len()]));
            if keep.is_none() {
                self.orbit_tune.insert(
                    id as u16,
                    OrbitTune { q: cell.0 as i8, r: cell.1 as i8, axis: content::default_axis(&SHAPES[id]), phase: content::default_phase(&SHAPES[id], slot) },
                );
            }
            taken.push(cell);
        }
    }

    /// Hill-climb the REAL flux rate over facings then cell relocations from the current seed (facing is the
    /// highest-leverage move now beams are directional). Bounded eval budget; monotonic, so result ≥ seed.
    fn hill_climb_placement(&mut self, ids: &[usize], region: &[(i32, i32)]) -> f64 {
        let mut best = self.rate_per_hr();
        // solver_mk2 (#11): the auto-arranger searches ~3× harder (more eval budget → better beam-chain packing)
        let mut budget: i32 = if self.upgrade_level(11) > 0 { 27000 } else { 9000 };
        let mut improved = true;
        while improved && budget > 0 {
            improved = false;
            for &id in ids {
                let cur = self.orbit_tune[&(id as u16)];
                for axis in 0..6u8 {
                    if axis == cur.axis || budget <= 0 {
                        continue;
                    }
                    budget -= 1;
                    self.orbit_tune.insert(id as u16, OrbitTune { axis, ..cur });
                    let rr = self.rate_per_hr();
                    if rr > best + 1e-9 {
                        best = rr;
                        improved = true;
                    } else {
                        self.orbit_tune.insert(id as u16, cur);
                    }
                }
                let cur = self.orbit_tune[&(id as u16)];
                for &(q, r) in region {
                    if budget <= 0 {
                        break;
                    }
                    if (cur.q as i32, cur.r as i32) == (q, r) {
                        continue;
                    }
                    if ids.iter().any(|&o| o != id && { let t = self.orbit_tune[&(o as u16)]; (t.q as i32, t.r as i32) == (q, r) }) {
                        continue;
                    }
                    budget -= 1;
                    self.orbit_tune.insert(id as u16, OrbitTune { q: q as i8, r: r as i8, ..cur });
                    let rr = self.rate_per_hr();
                    if rr > best + 1e-9 {
                        best = rr;
                        improved = true;
                    } else {
                        self.orbit_tune.insert(id as u16, cur);
                    }
                }
            }
        }
        best
    }

    /// Core completion ignores Relics — they're a bonus tier, not required for the summit.
    pub fn core_complete(&self) -> bool {
        self.owned[..content::PULL_COUNT].iter().all(|&c| c > 0)
    }

    pub fn distinct_owned(&self) -> u32 {
        self.owned[..content::PULL_COUNT]
            .iter()
            .filter(|&&c| c > 0)
            .count() as u32
    }

    pub fn relics_owned(&self) -> u32 {
        // only the Relic tier — metashapes (Meta/Transcendent) sit past it and are counted separately.
        content::rarity_ids(Rarity::Relic)
            .iter()
            .copied()
            .filter(|&id| self.owned[id] > 0)
            .count() as u32
    }

    /// Summon a Relic (famous CG model) — earned with banked dupe-shards, not pulled. Grants the next
    /// un-owned Relic. Returns its id, or -1 if not enough shards / all Relics owned.
    pub fn claim_relic(&mut self) -> i32 {
        if self.shards < RELIC_COST {
            return -1;
        }
        let next = content::rarity_ids(Rarity::Relic).iter().copied().find(|&id| self.owned[id] == 0);
        match next {
            Some(id) => {
                self.shards -= RELIC_COST;
                self.owned[id] += 1;
                id as i32
            }
            None => -1,
        }
    }

    /// Recrystallize = ascend the viewport dimension (NG+). Keeps collection + shards; resets the run.
    pub fn recrystallize(&mut self) -> bool {
        if !self.ascent_requirement_met() {
            return false;
        }
        self.ng_cycle += 1;
        self.viewport_dim += 1;
        self.prestige_mult = self.prestige_base().powi(self.ng_cycle as i32); // ascendant raises the base
        self.euler_cap = START_EULER_CAP + self.ng_cycle; // +1 budget headroom per ascent
        self.loadout.clear();
        // CLEAR the placement state too, or it goes stale: board_cells holds loadout indices that synergy_count
        // (run every tick, in BOTH paths) would index into the now-empty loadout → panic. orbit_tune is keyed by
        // shape so it's harmless-but-pointless once the board is empty; wipe both for a clean fresh board each ascent.
        self.board_cells.clear();
        self.orbit_tune.clear();
        // crystalline_start head-start (flux-denominated → density-scaled)
        self.flux = (500.0 * self.ng_cycle as f64 + 600.0 * self.facet_level(2) as f64) * content::FLUX_DENSITY;
        self.facets += 3 + self.ng_cycle as u64 + self.facet_level(6) as u64; // facet_yield (#6): +1/level per ascent
        // Expeditions: stop all farms on ascent (the economy re-bases). Teams, XP, skill trees, relics, Echoes, the
        // orders, and the History ring all CARRY OVER (mode-internal meta, safe because the D4 fence means none of them
        // touch the farm rate). The run-local state resets (node risk choices, staged provisions), AND — R3 "Deeper
        // Manifold" — the cleared quests RE-OPEN for a fresh, harder (ng_cycle-scaled) descent; carried-over shape
        // power makes it a victory-lap-into-challenge re-climb, and the farm resumes once nodes are re-cleared.
        for s in self.exp_station.iter_mut() {
            *s = -1;
        }
        for c in self.exp_cleared.iter_mut() {
            *c = false; // re-open every quest for the new cycle (exp_clears_total + the History ring stay as lifetime meta)
        }
        // v6: abort any in-flight run BEFORE the rebase changes prestige_mult/viewport_dim (which would stale the
        // frozen schedule). Its loot up to the last tick is already banked (accrue_run runs every tick); the
        // incomplete tail is forfeit by the choice to ascend. (D13)
        self.active_run = None;
        for m in self.exp_node_mod.iter_mut() {
            *m = 0;
        }
        for p in self.exp_provisions.iter_mut() {
            p.clear();
        }
        self.echo_carry = 0.0;
        self.exp_flux_carry = 0.0;
        true
    }

    // ── dev/debug helpers ──
    pub fn dev_add_flux(&mut self, amount: f64) {
        self.flux += amount.max(0.0);
    }
    pub fn dev_add_shards(&mut self, amount: u64) {
        self.shards += amount;
    }
    pub fn dev_unlock_all(&mut self) {
        for c in self.owned.iter_mut() {
            if *c == 0 {
                *c = 1;
            }
        }
    }
    /// Dev: reset the COLLECTION so first-time unlocks (shapes, recipes, achievements, bonds, ★ levels,
    /// cosmetics) can be re-experienced from scratch. Currency, upgrades, and prestige are KEPT, so you can
    /// immediately re-pull and watch the new-shape / SSR / achievement moments fire again.
    pub fn dev_reset_unlocks(&mut self) {
        for c in self.owned.iter_mut() {
            *c = 0;
        }
        self.owned[STARTER_SHAPE] = 1; // keep the starter (Pip — the Euler-ballast anchor)
        self.loadout.clear();
        self.board_cells.clear();
        self.orbit_tune.clear();
        for b in self.bonds.iter_mut() {
            *b = 0;
        }
        for g in self.pat_gained.iter_mut() {
            *g = 0;
        }
        for d in self.discovered.iter_mut() {
            *d = false;
        }
        for f in self.forged.iter_mut() {
            *f = false;
        }
        for m in self.milestones_done.iter_mut() {
            *m = false;
        }
        self.cosmetics.clear();
        for e in self.equipped.iter_mut() {
            *e = 0;
        }
        self.scene = 0;
        self.pity = PityState::default();
        for p in self.pulls_by_rarity.iter_mut() {
            *p = 0;
        }
        self.total_forges = 0;
    }
    /// Dev: wipe & repopulate the orrery for an early/mid/late-game configuration (tier 0/1/2) so the
    /// generative music + incremental layering can be auditioned at each stage. Grants tier-appropriate
    /// ownership + an Euler budget, then greedily deploys a genus-diverse band within that budget.
    pub fn dev_orrery_preset(&mut self, tier: u32) {
        self.use_orrery = true;
        self.loadout.clear();
        self.board_cells.clear();
        self.orbit_tune.clear();

        let (cap, target): (u32, usize) = match tier {
            0 => (6, 2),   // early: a couple of commons — shape voices + chords, no beat yet
            1 => (12, 5),  // mid: chords/bass/drums come in
            _ => (24, 9),  // late: a full, diverse band
        };
        let rarities: &[Rarity] = match tier {
            0 => &[Rarity::Common],
            1 => &[Rarity::Common, Rarity::Rare, Rarity::Epic],
            _ => &[Rarity::Common, Rarity::Rare, Rarity::Epic, Rarity::Ssr, Rarity::Ur],
        };
        for &r in rarities {
            for &id in content::rarity_ids(r) {
                if self.owned[id] == 0 {
                    self.owned[id] = 1;
                }
            }
        }
        if tier >= 2 {
            self.ng_cycle = self.ng_cycle.max(2); // late game also feels prestiged
            self.prestige_mult = 1.6_f64.powi(self.ng_cycle as i32);
        }
        self.euler_cap = cap;

        // genus-diverse spread (so the music covers registers + varied instruments), then greedily deploy in budget
        let owned: Vec<usize> = (0..COUNT).filter(|&i| self.owned[i] > 0).collect();
        let mut order: Vec<usize> = Vec::new();
        let mut seen_genus = std::collections::HashSet::new();
        for &i in &owned {
            if seen_genus.insert(SHAPES[i].genus) {
                order.push(i); // one shape per distinct genus first
            }
        }
        for &i in &owned {
            if !order.contains(&i) {
                order.push(i);
            }
        }
        for id in order {
            if self.loadout.len() >= target {
                break;
            }
            self.deploy(id);
        }
    }

    /// Buy a scene cosmetic with Flux (the endgame Flux sink) and equip it. Re-buying an owned scene just
    /// equips it for free. Returns true on success.
    pub fn buy_cosmetic(&mut self, id: u32, cost: f64) -> bool {
        if id != 0 && !self.cosmetics.contains(&id) {
            if self.flux < cost {
                return false;
            }
            self.flux -= cost;
            self.cosmetics.push(id);
        }
        self.scene = id;
        true
    }

    /// Equip an already-owned scene (id 0 is always available).
    pub fn select_scene(&mut self, id: u32) -> bool {
        if id == 0 || self.cosmetics.contains(&id) {
            self.scene = id;
            true
        } else {
            false
        }
    }

    /// Buy a non-scene cosmetic (gem finish, ceremony theme, board skin, title, …) with Flux and equip it in
    /// its slot. id 0 is each slot's free default. Re-buying an owned cosmetic just re-equips it for free.
    pub fn buy_cosmetic_slot(&mut self, id: u32, slot: u32, cost: f64) -> bool {
        if id != 0 && !self.cosmetics.contains(&id) {
            if self.flux < cost {
                return false;
            }
            self.flux -= cost;
            self.cosmetics.push(id);
        }
        self.equip_slot(slot, id);
        true
    }

    /// Equip an already-owned non-scene cosmetic in its slot (id 0 — that slot's default — is always available).
    pub fn equip_cosmetic_slot(&mut self, id: u32, slot: u32) -> bool {
        if id == 0 || self.cosmetics.contains(&id) {
            self.equip_slot(slot, id);
            true
        } else {
            false
        }
    }

    fn equip_slot(&mut self, slot: u32, id: u32) {
        let s = slot as usize;
        if self.equipped.len() <= s {
            self.equipped.resize(s + 1, 0);
        }
        self.equipped[s] = id;
    }

    // ─────────────────────────── Expeditions (the opt-in idle RPG) ───────────────────────────
    // Truth layer for the party RPG. Combat is the deterministic `expedition::resolve_battle`; the idle farm
    // is a closed-form Echoes rate accrued by `accrue_expedition_rewards` (mirrors `accrue_overcap_shards`).
    // INERT TO THE CORE: Echoes never convert to Flux/shards/stars and `echo_rate` never touches `globals_mult`.

    fn exp_power_base(r: Rarity) -> i64 {
        match r {
            Rarity::Common => 100,
            Rarity::Rare => 120,
            Rarity::Epic => 140,
            Rarity::Ssr => 170,
            Rarity::Ur => 200,
            Rarity::Relic => 210,
            Rarity::Meta => 240,
            Rarity::Transcendent => 280,
        }
    }

    /// A shape's combat/farm power — rarity base + a little genus, scaled by ★ (dupes) and bond level. The
    /// rarity spread is deliberately gentle (×2 across all tiers) so a beloved ★5 common out-powers a fresh
    /// UR — the "bring who you love" guarantee (pinned by a test).
    /// BASE power — rarity + genus + ★ + bond (NO level/skill). The farm RATE bands on this so XP earned while
    /// farming can't compound the rate mid-span (keeps the closed-form farm bit-stable online == offline).
    fn exp_base_power(&self, id: usize) -> i64 {
        if id >= COUNT {
            return 0;
        }
        let s = &SHAPES[id];
        let mut p = Self::exp_power_base(s.rarity) + 4 * s.genus as i64;
        p = p * (100 + 22 * self.star_level(id) as i64) / 100;
        p = p * (100 + 4 * self.bond_level(id) as i64) / 100;
        p
    }
    /// FULL combat power = base × (endless level +5%/lvl + allocated skill StatPct). Folds into the battle seed
    /// so leveling/skills make COMBAT stronger (clearing deeper quests), without compounding the farm rate.
    pub fn exp_power(&self, id: usize) -> i64 {
        if id >= COUNT {
            return 0;
        }
        self.exp_base_power(id) * (100 + 5 * self.shape_level(id) as i64 + self.skill_stat_pct(id)) / 100
    }

    /// Conventional RPG role from declared predicates + a small family spread (so the free commons aren't all
    /// one role). knot→Control, non-orientable/4D→Support; then a family map; else DPS.
    fn exp_role(&self, id: usize) -> expedition::Role {
        role_for(SHAPES[id].family)
    }

    fn exp_combatant(&self, id: usize) -> Combatant {
        let s = &SHAPES[id];
        let p = self.exp_power(id);
        let role = self.exp_role(id);
        let el = expedition::element_of(s.family, content::is_knot(s.family), content::is_nonorientable(s.family));
        let (hpf, atkf) = match role {
            expedition::Role::Tank => (240, 55),
            expedition::Role::Dps => (120, 135),
            expedition::Role::Support => (160, 80),
            expedition::Role::Control => (140, 105),
        };
        let speed = 95
            + match role {
                expedition::Role::Dps => 12,
                expedition::Role::Control => 8,
                expedition::Role::Support => 5,
                expedition::Role::Tank => 0,
            }
            + s.rarity as i64;
        let mut ult = 180i64;
        if let Some((bonus, _)) = content::signature(id) {
            ult += (bonus * 200.0) as i64; // signature shapes hit harder with their Ult
        }
        let vigor = self.exp_perk_level(2) as i64; // battle_vigor: start with charge
        // Per-shape combat identity (Slice 2) — applied to atk/def/speed ONLY, never to `p`/exp_base_power (farm fence).
        let (atk_bias, def_bias, spd_bias) = combat_bias(s.family, s.genus);
        // stalwart perk: a defensive TRADEOFF (not pure upside) — +8%/lvl team max HP but −3%/lvl atk, COMBAT only
        // (folds here in exp_combatant, never exp_base_power → farm rate untouched). Level 0 ⇒ identity.
        let stalwart = self.exp_perk_level(expedition::PERK_STALWART) as i64;
        let hp_perk = 100 + stalwart * 8; // +8%/lvl max HP
        let atk_perk = 100 - stalwart * 3; // −3%/lvl atk — the cost that makes it a choice, not a free buff
        let base_hp = (p * hpf / 100 * hp_perk / 100).max(1);
        Combatant {
            shape_id: id as i32,
            nick: s.nick.to_string(),
            family: s.family.to_string(),
            max_hp: base_hp,
            hp: base_hp,
            atk: (p * atkf / 100 * atk_bias / 100 * atk_perk / 100).max(1),
            def: ((10 + p * 30 / 100) * def_bias / 100).max(1),
            speed: speed + spd_bias,
            element: el,
            role,
            is_enemy: false,
            ai: expedition::AiKind::Bumper,
            reflect: content::is_nonorientable(s.family),
            ult_power: ult,
            charge: (20 * vigor).min(99),
            atb: 0,
            // knot → a "coil" trait: a coiled spring releases early, so a knotted shape OPENS the fight with 2 turns of
            // attack-up (its hardest hits come first). Combat-only; complements its existing +atk bias. Reuses the
            // engine's atk_up buff mechanic — no new field, no balance surprise beyond a short opening burst.
            atk_up: if content::is_knot(s.family) { 2 } else { 0 },
            def_down: 0,
            regen: 0,
            stun: 0,
            bleed: 0,
            // genus → a "handles" trait: each hole is structural bulk, so a handled shape STARTS the fight with a
            // small shield buffer (5% max HP per handle, ≤20%). Combat-only (built here, never in exp_base_power → the
            // closed-form farm rate is untouched). Makes handled shapes PLAY distinctly (they soak the opening blows).
            shield: base_hp * (s.genus.min(4) as i64) * 5 / 100,
            cd_a: 0,
            cd_b: 0,
            front: false,
            revive: false,
            volatile: 0, // party members never detonate (only the enemy lure does)
        }
    }

    /// Build team `t`'s combatants, applying the pre-battle ORDERS (`stance` → derived combat-stat multipliers,
    /// `formation` → the `front` flag). `Orders::default()` leaves every combatant byte-identical to v4 — so the
    /// farm/watch (which pass default) stay inert, and only the CLEAR battle sees orders. Stance NEVER touches
    /// exp_power/exp_base_power (those band the farm rate — spec D4 fence); it scales the derived hp/atk/def only.
    fn build_team_combatants(&self, t: usize, orders: &Orders, effects: &[expedition::EffKind]) -> Vec<Combatant> {
        let front_n = match orders.formation {
            1 => 2, // front-heavy: first two slots soak
            2 => 1, // back-heavy: a single front soaker
            _ => 0, // balanced: no designated front ⇒ v4 enemy targeting
        };
        let doctrine_stance = match orders.doctrine {
            1 => 0u8, // aggressive
            2 => 2u8, // defensive
            _ => 1u8, // steady → balanced
        };
        self.exp_teams.get(t).map_or(Vec::new(), |team| {
            team.iter()
                .filter(|&&id| id < COUNT && self.owned[id] > 0)
                .enumerate()
                .map(|(slot, &id)| {
                    let mut c = self.exp_combatant(id);
                    c.front = slot < front_n;
                    // per-slot stance (falls back to the doctrine's default stance)
                    let stance = orders.stance.get(slot).copied().unwrap_or(doctrine_stance);
                    let (hp_pct, atk_pct, def_pct) = match stance {
                        0 => (90, 120, 80),   // aggressive: hit harder, fold faster
                        2 => (120, 85, 130),  // defensive: tankier, softer hits
                        _ => (100, 100, 100), // balanced (default) ⇒ no change
                    };
                    if (hp_pct, atk_pct, def_pct) != (100, 100, 100) {
                        c.max_hp = (c.max_hp * hp_pct / 100).max(1);
                        c.hp = c.max_hp;
                        c.atk = (c.atk * atk_pct / 100).max(1);
                        c.def = c.def * def_pct / 100;
                    }
                    for &e in effects {
                        apply_team_effect(&mut c, e);
                    }
                    c
                })
                .collect()
        })
    }
    /// Build team `t`'s gambit programs in the SAME filter+order as `build_team_combatants`, so program index ==
    /// combatant unit index in `resolve_battle` (`gambits.get(actor)`). Each SURVIVING member keeps its OWN raw-slot
    /// program; a filtered-out (unowned) member drops its program — never shifting a survivor onto a neighbour's.
    fn build_team_gambits(&self, t: usize, orders: &Orders, auto: bool) -> Vec<Vec<expedition::GambitRule>> {
        self.exp_teams.get(t).map_or(Vec::new(), |team| {
            team.iter()
                .enumerate()
                .filter(|&(_, &id)| id < COUNT && self.owned[id] > 0)
                .map(|(slot, &id)| {
                    let prog = orders.gambits.get(slot).cloned().unwrap_or_default();
                    if !prog.is_empty() {
                        self.sanitize_program(prog) // a player-authored program (its locked-option rules go inert — see sanitize_program)
                    } else if auto {
                        Vec::new() // empty slot + auto-tactics UNLOCKED → hero_turn runs the smart legacy_ladder
                    } else {
                        expedition::simple_program(self.exp_role(id)) // empty slot + LOCKED → the simple instinct default
                    }
                })
                .collect()
        })
    }
    /// Auto-tactics (Workshop upgrade #21): when unlocked, an empty gambit slot fights with the smart ladder; until
    /// then it uses the simple instinct default. A discrete unlock the run snapshots at send (online==offline).
    fn auto_tactics_unlocked(&self) -> bool {
        self.upgrade_level(UPG_AUTO_TACTICS) > 0
    }
    /// Clamp a player-authored program to the currently-UNLOCKED gambit options: a rule whose cond/action is not yet
    /// unlocked (Workshop) is turned OFF for this battle (run_gambits skips `!on`), so a save can never illegally
    /// fire a locked option — and re-buying the unlock restores it (the authored Orders is never mutated). Phase 2
    /// fills the unlock tiers; until then everything is unlocked, so this is the identity.
    fn sanitize_program(&self, mut prog: Vec<expedition::GambitRule>) -> Vec<expedition::GambitRule> {
        let acts = self.unlocked_gambit_acts();
        let conds = self.unlocked_gambit_conds();
        for r in prog.iter_mut() {
            if !acts.contains(&r.action) || !conds.contains(&r.cond) {
                r.on = false;
            }
        }
        prog
    }
    /// The gambit CONDITIONS currently unlocked (Workshop). Tier-0 baseline is always available once Expeditions
    /// exist; deeper conds unlock progressively. Single source of truth — the editor mirrors this (never re-derives).
    pub fn unlocked_gambit_conds(&self) -> Vec<u8> {
        let mut c = vec![expedition::COND_ALWAYS, expedition::COND_ALLY_HURT, expedition::COND_SELF_HURT];
        if self.upgrade_level(UPG_GAMBIT_T2) > 0 {
            c.push(expedition::COND_SKILL_READY);
            c.push(expedition::COND_ALLY_LOW);
        }
        if self.upgrade_level(UPG_GAMBIT_T3) > 0 {
            c.push(expedition::COND_ULT_READY);
        }
        c
    }
    /// The gambit ACTIONS currently unlocked (Workshop). Baseline is enough to hand-write the simple/auto behaviour
    /// (attack-focus + each role's primary skill + ult); targeting + second skills unlock progressively.
    pub fn unlocked_gambit_acts(&self) -> Vec<u8> {
        let mut a = vec![
            expedition::ACT_ATTACK_FOCUS,
            expedition::ACT_HEAL,
            expedition::ACT_GUARD,
            expedition::ACT_HEX,
            expedition::ACT_FLURRY,
            expedition::ACT_ULT,
        ];
        if self.upgrade_level(UPG_GAMBIT_T2) > 0 {
            a.push(expedition::ACT_ATTACK_WEAKEST);
            a.push(expedition::ACT_ATTACK_THREAT);
        }
        if self.upgrade_level(UPG_GAMBIT_T3) > 0 {
            a.push(expedition::ACT_BUFF_TEAM);
            a.push(expedition::ACT_SWEEP);
        }
        a
    }
    /// The provision + relic effects that apply to team `t`'s CLEAR battle (relic up+down for each equipped relic,
    /// plus each staged provision). Aggregated once; the farm/watch never see these.
    fn team_effects(&self, t: usize) -> Vec<expedition::EffKind> {
        let mut v = Vec::new();
        if let Some(rs) = self.team_relics.get(t) {
            for &r in rs {
                if let Some(rd) = expedition::RELICS.get(r as usize) {
                    v.push(rd.up);
                    v.push(rd.down);
                }
            }
        }
        if let Some(ps) = self.exp_provisions.get(t) {
            for &p in ps {
                if let Some(pd) = expedition::PROVISIONS.get(p as usize) {
                    v.push(pd.eff);
                }
            }
        }
        v
    }
    /// The orders that apply to team `t`'s CLEAR battle (default if none).
    fn team_orders(&self, t: usize) -> Orders {
        self.exp_orders.get(t).cloned().unwrap_or_default()
    }

    pub fn exp_party_max(&self) -> usize {
        3 + if self.exp_perk_level(0) > 0 { 1 } else { 0 } // fourth_berth
    }
    pub fn exp_perk_level(&self, id: usize) -> u32 {
        self.exp_perks.get(id).copied().unwrap_or(0)
    }
    /// Clamp a candidate team list to owned shapes, de-duplicated, ≤ exp_party_max.
    fn clean_team(&self, ids: &[usize]) -> Vec<usize> {
        let mut out = Vec::new();
        for &id in ids {
            if id < COUNT && self.owned[id] > 0 && !out.contains(&id) {
                out.push(id);
            }
            if out.len() >= self.exp_party_max() {
                break;
            }
        }
        out
    }
    pub fn set_team(&mut self, t: usize, ids: &[usize]) {
        if t < self.exp_teams.len() {
            self.exp_teams[t] = self.clean_team(ids);
            // an emptied team can't farm — free its slot so another team can take the node (and no empty Watch).
            if self.exp_teams[t].is_empty() {
                if let Some(s) = self.exp_station.get_mut(t) {
                    *s = -1;
                }
            }
        }
    }
    pub fn set_active_team(&mut self, t: usize) {
        if t < self.exp_teams.len() {
            self.exp_active_team = t;
        }
    }
    /// Set team `t`'s pre-battle orders (formation 0-2, doctrine 0-2, focus -1..=2). Clamped. Affects the next
    /// CLEAR battle only (the farm/watch stay inert — spec D4 fence).
    pub fn set_orders(&mut self, t: usize, formation: u8, doctrine: u8, focus: i8) {
        if let Some(o) = self.exp_orders.get_mut(t) {
            o.formation = formation.min(2);
            o.doctrine = doctrine.min(2);
            o.focus = focus.clamp(-1, 2);
        }
    }
    /// Set the stance of one party slot (0 aggressive, 1 balanced, 2 defensive).
    pub fn set_slot_stance(&mut self, t: usize, slot: usize, s: u8) {
        if let Some(o) = self.exp_orders.get_mut(t) {
            if o.stance.len() <= slot {
                o.stance.resize(slot + 1, 1); // pad with balanced
            }
            o.stance[slot] = s.min(2);
        }
    }
    // ── gambit program editing (per team-slot). All clamp ids + bound the list; TS never computes list semantics. ──
    fn gambit_slot(&mut self, t: usize, slot: usize) -> Option<&mut Vec<expedition::GambitRule>> {
        let o = self.exp_orders.get_mut(t)?;
        if o.gambits.len() <= slot {
            o.gambits.resize_with(slot + 1, Vec::new);
        }
        o.gambits.get_mut(slot)
    }
    /// Edit rule `idx`'s condition + action (clamped to the closed vocabularies).
    pub fn set_gambit_rule(&mut self, t: usize, slot: usize, idx: usize, cond: u8, action: u8) {
        if let Some(g) = self.gambit_slot(t, slot) {
            if let Some(r) = g.get_mut(idx) {
                if cond < expedition::COND_COUNT {
                    r.cond = cond;
                }
                if action < expedition::ACT_COUNT {
                    r.action = action;
                }
            }
        }
    }
    /// Enable/disable rule `idx` without deleting it.
    pub fn toggle_gambit(&mut self, t: usize, slot: usize, idx: usize) {
        if let Some(g) = self.gambit_slot(t, slot) {
            if let Some(r) = g.get_mut(idx) {
                r.on = !r.on;
            }
        }
    }
    /// Reorder rule `idx` up (`up=true`) or down — priority is top-to-bottom.
    pub fn move_gambit(&mut self, t: usize, slot: usize, idx: usize, up: bool) {
        if let Some(g) = self.gambit_slot(t, slot) {
            let j = if up { idx.wrapping_sub(1) } else { idx + 1 };
            if idx < g.len() && j < g.len() {
                g.swap(idx, j);
            }
        }
    }
    /// Drag/drop reorder: move rule `from` to position `to` (a pure permutation, same slot semantics as move_gambit).
    pub fn reorder_gambit(&mut self, t: usize, slot: usize, from: usize, to: usize) {
        if let Some(g) = self.gambit_slot(t, slot) {
            if from < g.len() && to < g.len() && from != to {
                let r = g.remove(from);
                g.insert(to, r);
            }
        }
    }
    /// Append a new default rule (always → attack focus) up to the per-slot cap.
    pub fn add_gambit(&mut self, t: usize, slot: usize) {
        if let Some(g) = self.gambit_slot(t, slot) {
            if g.len() < expedition::MAX_GAMBIT_RULES {
                g.push(expedition::GambitRule { cond: expedition::COND_ALWAYS, action: expedition::ACT_ATTACK_FOCUS, on: true });
            }
        }
    }
    /// Remove rule `idx`.
    pub fn remove_gambit(&mut self, t: usize, slot: usize, idx: usize) {
        if let Some(g) = self.gambit_slot(t, slot) {
            if idx < g.len() {
                g.remove(idx);
            }
        }
        self.canon_gambits(t);
    }
    /// Clear a slot's program → empty == the legacy ladder (gentle instincts).
    pub fn reset_gambits(&mut self, t: usize, slot: usize) {
        if let Some(g) = self.gambit_slot(t, slot) {
            g.clear();
        }
        self.canon_gambits(t);
    }
    /// Auto-fill a slot with the SMART role-default gambit program (the "Auto" button) — built from the player's
    /// CURRENTLY-UNLOCKED gambit options, so it gets smarter as they buy the gambit-logic upgrades (ult-timing, skill
    /// gating, emergency heals, kill-securing targeting) and never contains a locked rule. The role comes from the
    /// shape stationed in this slot (truth — TS never decides the role or builds the program). Empty slot ⇒ no-op.
    pub fn auto_gambits(&mut self, t: usize, slot: usize) {
        let role = match self.exp_teams.get(t).and_then(|tm| tm.get(slot).copied()) {
            Some(id) => self.exp_role(id),
            None => return,
        };
        let program = expedition::smart_gambit_program(role, &self.unlocked_gambit_conds(), &self.unlocked_gambit_acts());
        if let Some(g) = self.gambit_slot(t, slot) {
            *g = program;
        }
        self.canon_gambits(t);
    }
    /// Drop the whole gambit program to canonical-empty (`Vec::new()`) when EVERY slot is empty — so an
    /// add-then-remove leaves an `Orders` byte-identical to `default()`, keeping `clear_seed`'s inert
    /// short-circuit firing (it must return EXACTLY farm_seed). Mirrors `orders_hash`'s `any(!empty)` guard.
    fn canon_gambits(&mut self, t: usize) {
        if let Some(o) = self.exp_orders.get_mut(t) {
            if !o.gambits.iter().any(|s| !s.is_empty()) {
                o.gambits.clear();
            }
        }
    }
    pub fn add_team(&mut self) -> usize {
        if self.exp_teams.len() < MAX_TEAMS {
            self.exp_teams.push(Vec::new());
            self.sanitize_exp_vecs(); // grow every team-parallel v5 vec in lockstep
        }
        self.exp_teams.len() - 1
    }
    pub fn remove_team(&mut self, t: usize) -> bool {
        if self.exp_teams.len() <= 1 || t >= self.exp_teams.len() || self.exp_station[t] >= 0 {
            return false;
        }
        self.exp_teams.remove(t);
        // remove the same row from every team-parallel vec (guarding pre-resize lengths)
        if t < self.exp_station.len() {
            self.exp_station.remove(t);
        }
        if t < self.exp_orders.len() {
            self.exp_orders.remove(t);
        }
        if t < self.exp_provisions.len() {
            self.exp_provisions.remove(t);
        }
        if t < self.team_relics.len() {
            self.team_relics.remove(t);
        }
        if self.exp_active_team >= self.exp_teams.len() {
            self.exp_active_team = self.exp_teams.len() - 1;
        }
        self.sanitize_exp_vecs();
        true
    }
    /// THE single owner of v5 vec lengths (spec D8): bring every team-parallel + content-parallel expedition vec
    /// to its correct length + clamp out-of-range ids. Called from `from_json` (migration) and `add_team`/
    /// `remove_team`, so the whole v5 field set always moves in lockstep — no field can drift out of parity.
    fn sanitize_exp_vecs(&mut self) {
        let nt = self.exp_teams.len().max(1);
        self.exp_station.resize(nt, -1);
        self.exp_orders.resize_with(nt, Orders::default);
        self.exp_provisions.resize_with(nt, Vec::new);
        self.team_relics.resize_with(nt, Vec::new);
        self.exp_cleared.resize(QUEST_COUNT, false);
        self.exp_node_mod.resize(QUEST_COUNT, 0);
        self.prov_inv.resize(expedition::PROVISION_COUNT, 0);
        self.relics_owned.resize(expedition::RELIC_COUNT, false);
        // defensive: keep the active run's decision arrays in lockstep with `decisions` (insurance vs a tampered/future
        // save; the engine always pushes the two together in resolve_run_with_choices, so this is a no-op on any save
        // it actually wrote). Guarantees choose_decision's decision_choices[di] index is always in range.
        if let Some(run) = self.active_run.as_mut() {
            run.decision_choices.resize(run.decisions.len(), -1);
        }
        // clamp out-of-range ids (defensive vs tampered/old saves; nothing here consumes them yet in Phase 0)
        for m in self.exp_node_mod.iter_mut() {
            if *m as usize >= expedition::NODE_MOD_COUNT {
                *m = 0;
            }
        }
        for r in self.team_relics.iter_mut() {
            r.retain(|&x| (x as usize) < expedition::RELIC_COUNT);
            r.dedup();
            r.truncate(expedition::RELIC_SLOTS_PER_TEAM);
        }
        for p in self.exp_provisions.iter_mut() {
            p.retain(|&x| (x as usize) < expedition::PROVISION_COUNT);
        }
        // gambit hygiene (vs tampered/old saves): drop rules with out-of-range cond/action ids, cap per slot,
        // and canonicalize an all-empty program to Vec::new() (so the inert clear_seed short-circuit fires).
        for o in self.exp_orders.iter_mut() {
            for slot in o.gambits.iter_mut() {
                slot.retain(|r| r.cond < expedition::COND_COUNT && r.action < expedition::ACT_COUNT);
                slot.truncate(expedition::MAX_GAMBIT_RULES);
            }
            if !o.gambits.iter().any(|s| !s.is_empty()) {
                o.gambits.clear();
            }
        }
        // v6: drop a stale/invalid in-flight run (e.g. a save whose run references content a build removed, or
        // whose schedule arrays are inconsistent) — it degrades to the v5 station-farm rather than panicking.
        if let Some(run) = self.active_run.as_ref() {
            let n = run.prefix_ms.len();
            let valid = run.team < self.exp_teams.len()
                && !run.path.is_empty()
                && run.path.iter().all(|&q| q < QUEST_COUNT)
                && run.prefix_echoes.len() == n
                && run.prefix_flux.len() == n
                && run.room_kind.len() == n
                && run.room_node.len() == n
                && (run.claimed_rooms as usize) <= n;
            if !valid {
                self.active_run = None;
            }
        }
    }

    /// The FARM seed (v4's `team_seed`, byte-identical): folds team `t`'s members + their power so different teams
    /// (and leveling up) face different fights; reproducible (watch == farm loop == golden test). The spectator
    /// Watch + every standing-farm path use THIS, so the watch shows the plain inert loop — orders/provisions are
    /// a one-shot CLEAR thing, never the standing farm (spec D2).
    fn farm_seed(&self, t: usize, q: usize) -> u64 {
        let mut h = self.master_seed ^ (q as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        if let Some(team) = self.exp_teams.get(t) {
            for &id in team {
                h = h
                    .wrapping_mul(0x100_0000_01b3)
                    .wrapping_add(id as u64 + 1)
                    .wrapping_add(self.exp_power(id) as u64);
            }
        }
        h
    }

    /// The CLEAR seed: `farm_seed` PLUS the team's orders, the node's risk mod, staged provisions, and equipped
    /// relics — so a differently-ordered/provisioned attempt is a genuinely different fight. **Inert short-circuit
    /// (spec D2):** when everything is default/empty it returns EXACTLY `farm_seed`, so a vanilla clear stays
    /// bit-identical to v4 and every existing golden battle test passes unchanged.
    fn clear_seed(&self, t: usize, q: usize) -> u64 {
        let o = self.exp_orders.get(t).cloned().unwrap_or_default();
        let mod_q = self.exp_node_mod.get(q).copied().unwrap_or(0);
        let empty: &[u8] = &[];
        let prov = self.exp_provisions.get(t).map(|v| v.as_slice()).unwrap_or(empty);
        let relics = self.team_relics.get(t).map(|v| v.as_slice()).unwrap_or(empty);
        if o == Orders::default() && mod_q == 0 && prov.is_empty() && relics.is_empty() {
            return self.farm_seed(t, q); // inert ⇒ bit-identical to v4
        }
        let mut h = self.farm_seed(t, q);
        h = h.wrapping_mul(0x100_0000_01b3).wrapping_add(orders_hash(&o));
        h = h.wrapping_mul(0x100_0000_01b3).wrapping_add(mod_q as u64);
        for &p in prov {
            h = h.wrapping_mul(0x100_0000_01b3).wrapping_add(p as u64 + 1);
        }
        for &r in relics {
            h = h.wrapping_mul(0x100_0000_01b3).wrapping_add(r as u64 + 0x1000);
        }
        h
    }

    /// The ONE first-clear path (D5): mark cleared, grant Echoes + first-clear Flux + the freed shape + team XP.
    /// Returns (recruited_id, recruit_is_new, echoes_gained, first_clear_flux).
    fn grant_first_clear(&mut self, q: usize, t: usize) -> (i32, bool, u64, f64) {
        self.exp_cleared[q] = true;
        self.exp_clears_total += 1; // history counters (the single first-clear path)
        if QUESTS[q].boss.is_some() {
            self.exp_bosses_freed += 1;
        }
        let base = QUESTS[q].base_echo;
        // v5 risk modifier boosts the first-clear ECHOES lump only (spec D5) — never the Flux windfall, never any
        // standing rate. A perilous/harrowing clear pays out a fat Echoes purse for provisions/relics.
        let mod_pct = expedition::NODE_MODS
            .get(self.exp_node_mod.get(q).copied().unwrap_or(0) as usize)
            .map_or(0, |nm| nm.first_clear_mult_pct)
            .max(0) as u64;
        // Risk-mod % + double_rations (+100%) combine ADDITIVELY (not multiplicatively) so harrowing+double can't
        // print a runaway lump — e.g. harrowing(+150%) + double(+100%) = +250% (×3.5), not ×2.4×2=×4.8.
        let double_pct: u64 = if self.team_effects(t).iter().any(|e| matches!(e, expedition::EffKind::DoubleClearEchoes)) { 100 } else { 0 };
        // NG+ "Deeper Manifold" (R3): each ascent cycle pays more Echoes on a clear (multiplicative on the lump, after the
        // risk/double bonuses). Mode-internal (Echoes never touch globals_mult), so it inflates only the Echoes economy.
        let ng_bonus = 100 + self.ng_cycle as u64 * NGPLUS_REWARD_BONUS_PCT;
        let echoes = base * 5 * (100 + mod_pct + double_pct) / 100 * ng_bonus / 100;
        self.echoes += echoes;
        self.lifetime_echoes += echoes;
        let fc_flux = base as f64 * FIRST_CLEAR_FLUX_K * content::FLUX_DENSITY; // a windfall, not inert (mod-free)
        self.flux += fc_flux;
        self.lifetime_flux += fc_flux;
        let (mut rid_out, mut is_new) = (-1i32, false);
        if QUESTS[q].recruit_id >= 0 {
            let rid = QUESTS[q].recruit_id as usize;
            let r = SHAPES[rid].rarity;
            let (n, _) = self.grant(rid, r); // free the lost shape (a pull-equivalent acquisition)
            rid_out = rid as i32;
            is_new = n;
        }
        let xp = base * 5; // the winning team levels up (interaction-driven XP)
        if let Some(team) = self.exp_teams.get(t).cloned() {
            for id in team {
                self.shape_xp[id] += xp;
            }
        }
        (rid_out, is_new, echoes, fc_flux)
    }

    /// Record one completed first-clear run into the bounded history ring (newest first, ≤ 24). Render-only.
    fn push_run(&mut self, q: usize, t: usize, stats: (u32, u32, u32), echoes: u64, flux: f64) {
        let (rounds, survivors, party_size) = stats;
        let rec = ExpRunRec {
            kind: if QUESTS[q].boss.is_some() { 1 } else { 0 },
            quest: q as u32,
            team: t as u32,
            rounds,
            survivors,
            party_size,
            echoes,
            flux: flux.round() as u64,
            recruit_id: QUESTS[q].recruit_id,
            ng_cycle: self.ng_cycle,
        };
        self.exp_runs.insert(0, rec);
        self.exp_runs.truncate(24);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────
    // v6 "THE DELVE": completable runs through a linear dungeon, resolved ONCE at send into a frozen schedule.
    // Idle advance is a binary-search READ of the prefix arrays (O(1) offline; online==offline by construction).
    // `active_run == None` ⇒ everything below is inert and v5 station-farm is byte-identical.
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────

    /// Resolve an entire run through `path` for team `t` into its immutable schedule. PURE (no mutation) — the
    /// future is computed here, once, and only READ thereafter. Survivor HP threads from each room into the next.
    /// Today's entry: every Decision room takes its auto-default (empty committed-choice list).
    fn resolve_run(&self, team: usize, path: &[usize], seed: u64) -> RunPlan {
        self.resolve_run_with_choices(team, path, seed, &[])
    }

    /// As `resolve_run`, but applying any COMMITTED decision choices: `choices[i]` is the i-th Decision room's chosen
    /// option (0/1), or -1 for the auto-default. Empty ⇒ all auto ⇒ byte-identical to send. Used by `resolve_tail_from`
    /// to re-resolve after a live override. Determinism: same (team, path, seed, choices) ⇒ bit-identical plan.
    fn resolve_run_with_choices(&self, team: usize, path: &[usize], seed: u64, choices: &[i8]) -> RunPlan {
        let orders = self.team_orders(team);
        let effects = self.team_effects(team);
        let auto = self.auto_tactics_unlocked(); // frozen at send — a mid-run purchase can't change this run
        let gambits = self.build_team_gambits(team, &orders, auto);
        let mut party = self.build_team_combatants(team, &orders, &effects); // full HP at room 0
        let mut plan = RunPlan {
            team,
            party: self.exp_teams.get(team).cloned().unwrap_or_default(),
            path: path.to_vec(),
            run_seed: seed,
            start_ms: 0.0,
            orders: orders.clone(),
            provisions: self.exp_provisions.get(team).cloned().unwrap_or_default(),
            auto_tactics: auto,
            ..Default::default()
        };
        let rooms = build_room_plan(path);
        plan.planned_rooms = rooms.len(); // the intended length (death-leak-free progress denominator)
        let (mut t_ms, mut ech, mut flux) = (0.0f64, 0u64, 0u64);
        for (k, &(kind, node)) in rooms.iter().enumerate() {
            // room 0 uses run_seed RAW so a 1-room run resolves bit-identically to clearing that node via `station`.
            let rs = if k == 0 { seed } else { seed ^ expedition::splitmix64(k as u64) };
            match kind {
                expedition::RoomKind::Campfire => {
                    heal_party(&mut party, CAMPFIRE_HEAL_PCT);
                    for c in party.iter_mut() {
                        if c.hp > 0 {
                            c.atk = (c.atk * (100 + CAMPFIRE_BOON_PCT) / 100).max(1); // a steady +10% atk for the rest of the run
                        }
                    }
                    t_ms += REST_MS;
                    push_room(&mut plan, t_ms, ech, flux, kind.as_u8(), -1);
                }
                expedition::RoomKind::Treasure => {
                    let depth = k as u64;
                    let base = 30 + 15 * depth;
                    let lump = base + expedition::splitmix64(rs) % (base / 2 + 1); // deterministic varied loot (RUN lineage)
                    ech += lump;
                    flux += (lump / 2) * content::FLUX_DENSITY as u64; // Flux is density-denominated (see FLUX_DENSITY) — match the economy
                    heal_party(&mut party, TREASURE_HEAL_PCT);
                    t_ms += TREASURE_MS;
                    push_room(&mut plan, t_ms, ech, flux, kind.as_u8(), -1);
                }
                expedition::RoomKind::Shrine => {
                    heal_party(&mut party, SHRINE_HEAL_PCT);
                    for c in party.iter_mut() {
                        if c.hp > 0 {
                            c.speed = (c.speed * (100 + SHRINE_SPEED_BOON) / 100).max(1); // a lasting +speed blessing for the rest of the run
                        }
                    }
                    t_ms += SHRINE_MS;
                    push_room(&mut plan, t_ms, ech, flux, kind.as_u8(), -1);
                }
                expedition::RoomKind::Decision => {
                    // a Crossroads: resolve the COMMITTED choice (choices[di]) or the auto-default into the frozen
                    // schedule. A live override (choose_decision) sets choices[di], then re-resolves the unbanked tail.
                    let d = build_decision(rs, k);
                    let di = plan.decisions.len();
                    let chosen = choices.get(di).copied().unwrap_or(-1);
                    let opt = if chosen < 0 { d.auto_option as usize } else { (chosen as usize).min(d.options.len().saturating_sub(1)) };
                    let eff = d.options[opt];
                    apply_decision_to_party(&mut party, eff);
                    if eff.echo_bonus > 0 {
                        ech += eff.echo_bonus;
                        flux += (eff.echo_bonus / 2) * content::FLUX_DENSITY as u64;
                    }
                    t_ms += DECISION_MS;
                    plan.decisions.push(d);
                    plan.decision_choices.push(chosen); // -1 = auto-default; else the committed override
                    push_room(&mut plan, t_ms, ech, flux, kind.as_u8(), -1);
                }
                _ => {
                    let q = node as usize;
                    let enemies = expedition::quest_enemies_scaled(&QUESTS[q], self.node_mod_scale(q));
                    let r = expedition::resolve_battle_from_hp(rs, party.clone(), enemies, orders.focus, &gambits);
                    t_ms += r.rounds as f64 * MS_PER_ROOM_ROUND;
                    for (i, c) in party.iter_mut().enumerate() {
                        if let Some(&h) = r.final_hp.get(i) {
                            c.hp = h; // thread survivor HP into the next room
                        }
                    }
                    if r.win {
                        ech += QUESTS[q].base_echo; // delve loot (separate from the first-clear bonus granted on banking)
                        flux += (QUESTS[q].base_echo / 2) * content::FLUX_DENSITY as u64; // density-denominated to match the Flux economy
                        push_room(&mut plan, t_ms, ech, flux, kind.as_u8(), node);
                    } else {
                        plan.death_room = Some(k); // chained-party wipe — the run ends here, partial loot kept
                        push_room(&mut plan, t_ms, ech, flux, kind.as_u8(), -1);
                        break;
                    }
                }
            }
        }
        plan.total_ms = plan.prefix_ms.last().copied().unwrap_or(0.0);
        plan
    }

    /// Send team `t` on a run through `path`. Resolves the run ONCE and freezes it as `active_run`, persisted by
    /// the caller's tick before any room outcome is revealed (save-scum-proof, like `station`). Returns false if a
    /// run is already in flight, the path is empty/invalid, or the party is empty.
    pub fn send_expedition(&mut self, t: usize, path: &[usize], now_ms: f64) -> bool {
        self.tick(now_ms); // bank any standing farm first (active_run is None here ⇒ accrue_run is a no-op)
        if self.active_run.is_some() || path.is_empty() || t >= self.exp_teams.len() {
            return false;
        }
        if now_ms < self.exp_rest_until {
            return false; // the party is still resting at base camp between delves
        }
        let orders = self.team_orders(t);
        if self.build_team_combatants(t, &orders, &[]).is_empty() {
            return false; // empty / all-unowned party
        }
        if path.iter().any(|&q| q >= QUEST_COUNT) {
            return false;
        }
        let seed = self.clear_seed(t, path[0]);
        let mut plan = self.resolve_run(t, path, seed);
        plan.start_ms = now_ms;
        self.active_run = Some(plan);
        self.exp_station[t] = -1; // FENCE: a delving team does NOT also farm the closed-form rate (auto re-stations when idle)
        true
    }

    /// Compose the next LINEAR run path (v1: no branching/choice): from the lowest-index OPEN uncleared mainline
    /// node, walk forward (index order, skipping Elite branches + cleared nodes) collecting uncleared nodes,
    /// stopping AFTER the next Boss or at the dimension wall (need NG+ to go deeper). Empty ⇒ nothing to delve
    /// (auto-dispatch then falls back to the v5 station-farm). Pure.
    pub fn compose_run_path(&self, safe_only: bool) -> Vec<usize> {
        let mut path = Vec::new();
        let mut started = false;
        for (q, def) in QUESTS.iter().enumerate() {
            if matches!(def.kind, expedition::NodeKind::Elite) {
                continue; // v1 runs follow the mainline; Elite branches are deferred (no path-choice yet)
            }
            if def.min_dim > self.viewport_dim {
                if started {
                    break; // hit the dimension wall — the run ends here (Recrystallize to go deeper)
                }
                continue;
            }
            if self.exp_cleared[q] {
                continue; // already cleared — a run delves NEW ground
            }
            if safe_only && self.exp_node_mod.get(q).copied().unwrap_or(0) != 0 {
                // AUTO leaves player-set risk mods for deliberate manual runs (it never auto-risks) — stop here.
                if started {
                    break;
                }
                continue;
            }
            if !started {
                if !self.node_open(q) {
                    continue; // wait for the frontier to be reachable
                }
                started = true;
            }
            path.push(q);
            if matches!(def.kind, expedition::NodeKind::Boss) {
                break; // a run is one chapter: end at the next boss
            }
        }
        path
    }

    /// O(1) idle advance of the one in-flight run (mounted in BOTH `tick` and `compute_offline`). Banks newly-
    /// finished rooms' delve loot by INTEGER prefix-diff (online==offline = the same array element) and routes each
    /// newly-cleared node through the idempotent `grant_first_clear`. Inert when `active_run` is None.
    fn accrue_run(&mut self, now_ms: f64) {
        let (finished, total_len, de, df, nodes, team) = match self.active_run.as_ref() {
            Some(run) if !run.prefix_ms.is_empty() => {
                let elapsed = (now_ms - run.start_ms).clamp(0.0, run.total_ms);
                let finished = run.prefix_ms.partition_point(|&t| t <= elapsed); // O(log rooms), span-independent
                let claimed = run.claimed_rooms as usize;
                if finished > claimed {
                    let base_e = if claimed == 0 { 0 } else { run.prefix_echoes[claimed - 1] };
                    let base_f = if claimed == 0 { 0 } else { run.prefix_flux[claimed - 1] };
                    (finished, run.prefix_ms.len(), run.prefix_echoes[finished - 1] - base_e, run.prefix_flux[finished - 1] - base_f, run.room_node[claimed..finished].to_vec(), run.team)
                } else {
                    (finished, run.prefix_ms.len(), 0u64, 0u64, Vec::new(), run.team)
                }
            }
            _ => return,
        };
        if de > 0 {
            self.echoes += de;
            self.lifetime_echoes += de;
        }
        if df > 0 {
            self.flux += df as f64;
            self.lifetime_flux += df as f64;
        }
        for node in nodes {
            if node >= 0 && !self.exp_cleared[node as usize] {
                self.grant_first_clear(node as usize, team); // idempotent via the !cleared guard (shares the v5 ledger)
            }
        }
        if let Some(run) = self.active_run.as_mut() {
            run.claimed_rooms = run.claimed_rooms.max(finished as u32);
            run.decision_locked_at_room = run.claimed_rooms; // banked rooms are locked — choose_decision rejects them (anti-scum)
        }
        if finished >= total_len {
            self.complete_run(now_ms);
        }
    }

    /// Live override of a Decision room's auto-pick, within its timeout window. Banks up to `now_ms` first (so the
    /// window + lock checks are current), validates the room is an UNBANKED Decision still inside its window and not
    /// already chosen, commits the choice, and RE-RESOLVES the unbanked tail. Offline players never call this, so the
    /// auto-pick path stays online==offline. Save-scum-proof: the choice + re-resolution are persisted by the next
    /// tick before any tail outcome is revealed, and banked rooms are locked. Returns false if the choice is illegal.
    pub fn choose_decision(&mut self, room_idx: usize, option: u8, now_ms: f64) -> bool {
        self.tick(now_ms); // bank standing time first ⇒ claimed_rooms, the lock, and the window are all current
        let di = {
            let run = match self.active_run.as_ref() {
                Some(r) => r,
                None => return false,
            };
            if room_idx >= run.room_kind.len() {
                return false;
            }
            if run.room_kind[room_idx] != expedition::RoomKind::Decision.as_u8() {
                return false; // not a Crossroads
            }
            if (room_idx as u32) < run.claimed_rooms || (room_idx as u32) < run.decision_locked_at_room {
                return false; // already banked / locked — the window has closed (anti-scum)
            }
            let di = match run.decisions.iter().position(|d| d.room_idx == room_idx) {
                Some(i) => i,
                None => return false,
            };
            if (option as usize) >= run.decisions[di].options.len() {
                return false; // option out of range for this crossroads (2 or 3 options)
            }
            let arrival = run.start_ms + if room_idx > 0 { run.prefix_ms[room_idx - 1] } else { 0.0 };
            if now_ms > arrival + run.decisions[di].window_ms {
                return false; // the live window lapsed — the auto-pick stands (online==offline preserved)
            }
            if run.decision_choices.get(di).copied().unwrap_or(-1) != -1 {
                return false; // already chosen — no peek-then-reroll
            }
            di
        };
        if let Some(run) = self.active_run.as_mut() {
            run.decision_choices[di] = option as i8;
        }
        self.resolve_tail_from();
        true
    }

    /// Re-resolve the active run with its currently-committed `decision_choices`, preserving the banked head
    /// `[0..claimed_rooms]` byte-identical (the player was already paid those) and rebasing the fresh tail onto it so
    /// the cumulative prefix arrays stay monotonic even if team power drifted since send. Only the UNBANKED future
    /// changes. Deterministic + idempotent given the same committed choices.
    fn resolve_tail_from(&mut self) {
        let old = match self.active_run.as_ref() {
            Some(r) => r.clone(),
            None => return,
        };
        let claimed = old.claimed_rooms as usize;
        let mut fresh = self.resolve_run_with_choices(old.team, &old.path, old.run_seed, &old.decision_choices);
        // restore the live cursor + frozen send-time snapshots (resolve_run_with_choices re-reads current self for these)
        fresh.start_ms = old.start_ms;
        fresh.claimed_rooms = old.claimed_rooms;
        fresh.decision_locked_at_room = old.decision_locked_at_room;
        fresh.provisions = old.provisions.clone();
        fresh.orders = old.orders.clone();
        fresh.auto_tactics = old.auto_tactics;
        // Degenerate guard: the re-resolution must still cover the banked head (it does — the head's committed choices
        // are unchanged, so it re-resolves identically). If a power drop somehow shortened it, keep the old plan.
        if claimed > fresh.prefix_ms.len() {
            return;
        }
        if claimed > 0 && claimed <= old.prefix_ms.len() {
            // Rebase the tail's cumulative arrays to continue from the OLD banked head (head loot is power-independent
            // ⇒ echo/flux offsets are ~0; the time offset absorbs combat-speed drift), then splice the banked head back
            // byte-identical so banking is provably undisturbed.
            let c = claimed;
            let dt = old.prefix_ms[c - 1] - fresh.prefix_ms[c - 1];
            let base_e = old.prefix_echoes[c - 1] as i64;
            let base_f = old.prefix_flux[c - 1] as i64;
            let fe = fresh.prefix_echoes[c - 1] as i64;
            let ff = fresh.prefix_flux[c - 1] as i64;
            for k in c..fresh.prefix_ms.len() {
                fresh.prefix_ms[k] += dt;
                fresh.prefix_echoes[k] = (fresh.prefix_echoes[k] as i64 - fe + base_e).max(base_e) as u64;
                fresh.prefix_flux[k] = (fresh.prefix_flux[k] as i64 - ff + base_f).max(base_f) as u64;
            }
            fresh.prefix_ms[..c].copy_from_slice(&old.prefix_ms[..c]);
            fresh.prefix_echoes[..c].copy_from_slice(&old.prefix_echoes[..c]);
            fresh.prefix_flux[..c].copy_from_slice(&old.prefix_flux[..c]);
            fresh.room_kind[..c].copy_from_slice(&old.room_kind[..c]);
            fresh.room_node[..c].copy_from_slice(&old.room_node[..c]);
        }
        fresh.total_ms = fresh.prefix_ms.last().copied().unwrap_or(old.total_ms);
        self.active_run = Some(fresh);
    }

    /// Finalize a run: consume staged provisions on a COMPLETED run (a wipe is free — loss-is-free), push a
    /// history record, and clear `active_run` so the team is free to be re-sent.
    fn complete_run(&mut self, now_ms: f64) {
        let Some(run) = self.active_run.take() else { return };
        // the party heads home to rest before the next delve — a cozy break starting at the run's DETERMINISTIC
        // completion (start_ms + total_ms), not now_ms, so a long absence lets the rest fully elapse (online==offline)
        self.exp_rest_until = run.start_ms + run.total_ms + REST_BETWEEN_RUNS_MS;
        let died = run.death_room.is_some();
        let rec = RunRecord {
            team: run.team as u32,
            rooms: run.claimed_rooms,
            echoes: run.prefix_echoes.last().copied().unwrap_or(0),
            died,
            at_ms: now_ms,
        };
        if !died {
            // consume the staged provisions only on a clear completion (mirrors station's consume-on-win, D12).
            if let Some(staged) = self.exp_provisions.get(run.team).cloned() {
                for p in staged {
                    if let Some(charge) = self.prov_inv.get_mut(p as usize) {
                        *charge = charge.saturating_sub(1);
                    }
                }
                if let Some(s) = self.exp_provisions.get_mut(run.team) {
                    s.clear();
                }
            }
        }
        self.run_history.insert(0, rec);
        self.run_history.truncate(24);
    }

    /// Re-enact the active run up to room `room_idx` (threading HP through fights + cozy heals) and return that
    /// room's BattleResult — for the spectator Watch of a delve room. None if no run / out of range / a cozy room.
    /// Uses the run's FROZEN seed + orders snapshot, so a revealed (already-won) room re-resolves to the same win
    /// (damage numbers may drift a touch if the team leveled mid-run — purely cosmetic for the replay).
    fn replay_room_battle(&self, room_idx: usize) -> Option<expedition::BattleResult> {
        let run = self.active_run.as_ref()?;
        let rooms = build_room_plan(&run.path);
        if room_idx >= rooms.len() {
            return None;
        }
        let orders = run.orders.clone();
        let effects = self.team_effects(run.team);
        let gambits = self.build_team_gambits(run.team, &orders, run.auto_tactics); // frozen at send (online==offline; no mid-run desync)
        let mut party = self.build_team_combatants(run.team, &orders, &effects);
        let mut decision_seen = 0usize; // tracks which Decision room we're on, to read its committed choice
        for (k, &(kind, node)) in rooms.iter().enumerate() {
            let rs = if k == 0 { run.run_seed } else { run.run_seed ^ expedition::splitmix64(k as u64) };
            if kind.is_fight() {
                let q = node as usize;
                let enemies = expedition::quest_enemies_scaled(&QUESTS[q], self.node_mod_scale(q));
                let r = expedition::resolve_battle_from_hp(rs, party.clone(), enemies, orders.focus, &gambits);
                if k == room_idx {
                    return Some(r);
                }
                for (i, c) in party.iter_mut().enumerate() {
                    if let Some(&h) = r.final_hp.get(i) {
                        c.hp = h;
                    }
                }
                if !r.win {
                    return None; // shouldn't happen for a revealed room (those were won)
                }
            } else if matches!(kind, expedition::RoomKind::Decision) {
                // a Crossroads: apply the COMMITTED choice (or the auto-default) — same party effect as resolve_run,
                // so the threaded HP for the spectator Watch matches the frozen schedule.
                let d = build_decision(rs, k);
                let opt = run.decision_choices.get(decision_seen).copied().unwrap_or(-1);
                let opt = if opt < 0 { d.auto_option as usize } else { (opt as usize).min(d.options.len().saturating_sub(1)) };
                decision_seen += 1;
                apply_decision_to_party(&mut party, d.options[opt]);
                if k == room_idx {
                    return None; // a cozy room — nothing to fight-watch
                }
            } else {
                // cozy room: apply its heal/boon so a later fight uses the threaded HP (matching the schedule)
                let heal = match kind {
                    expedition::RoomKind::Campfire => CAMPFIRE_HEAL_PCT,
                    expedition::RoomKind::Shrine => SHRINE_HEAL_PCT,
                    _ => TREASURE_HEAL_PCT,
                };
                heal_party(&mut party, heal);
                if matches!(kind, expedition::RoomKind::Campfire) {
                    for c in party.iter_mut() {
                        if c.hp > 0 {
                            c.atk = (c.atk * (100 + CAMPFIRE_BOON_PCT) / 100).max(1);
                        }
                    }
                }
                if matches!(kind, expedition::RoomKind::Shrine) {
                    for c in party.iter_mut() {
                        if c.hp > 0 {
                            c.speed = (c.speed * (100 + SHRINE_SPEED_BOON) / 100).max(1);
                        }
                    }
                }
                if k == room_idx {
                    return None; // a cozy room — nothing to fight-watch
                }
            }
        }
        None
    }

    /// v5 journey-map gate: is node `q` open to ATTEMPT (its first clear)? Open iff the dimension gate is met AND
    /// it's a region entry (no in-edges) or ANY in-edge's source is cleared (OR-convergence — clearing either the
    /// mainline path or an Elite branch independently opens a boss, so the player picks a route). Cleared nodes
    /// are always farmable regardless. Pure derivation from `exp_cleared` + `viewport_dim` (no topology state).
    pub fn node_open(&self, q: usize) -> bool {
        if q >= QUEST_COUNT || self.viewport_dim < QUESTS[q].min_dim {
            return false;
        }
        let mut has_in = false;
        for e in expedition::EDGES {
            if e.to == q {
                has_in = true;
                if self.exp_cleared.get(e.from).copied().unwrap_or(false) {
                    return true;
                }
            }
        }
        !has_in
    }
    /// Does team `t` win the CONFIGURED clear of node `q` — its orders + equipped relics + STAGED PROVISIONS
    /// against the SELECTED-risk-mod enemy roster? Byte-equivalent to the real clear (`station`), so the
    /// "ready/risky/underpowered" chip predicts the exact fight the player is about to get. Pure (no mutation).
    fn beatable_safe(&self, t: usize, q: usize) -> bool {
        if q >= QUEST_COUNT {
            return false;
        }
        let o = self.team_orders(t);
        let party = self.build_team_combatants(t, &o, &self.team_effects(t));
        if party.is_empty() {
            return false;
        }
        expedition::resolve_battle(self.clear_seed(t, q), party, expedition::quest_enemies_scaled(&QUESTS[q], self.node_mod_scale(q)), o.focus, &self.build_team_gambits(t, &o, self.auto_tactics_unlocked())).win
    }
    /// The enemy-stat scaling % for node `q`'s chosen risk modifier (0 = safe). Applies to the CLEAR battle only.
    fn node_mod_scale(&self, q: usize) -> i64 {
        let m = self.exp_node_mod.get(q).copied().unwrap_or(0) as usize;
        let mod_pct = expedition::NODE_MODS.get(m).map_or(0, |nm| nm.enemy_scale_pct);
        mod_pct + self.ng_cycle as i64 * NGPLUS_ENEMY_SCALE_PCT // NG+ deepens the manifold (combat-only ⇒ farm rate untouched)
    }
    /// Choose node `q`'s risk modifier (only before it's cleared — after a clear the node is farmed, mod is moot).
    pub fn set_node_mod(&mut self, q: usize, m: u8) {
        if q < self.exp_node_mod.len() && (m as usize) < expedition::NODE_MOD_COUNT && !self.exp_cleared.get(q).copied().unwrap_or(false) {
            self.exp_node_mod[q] = m;
        }
    }
    pub fn set_auto(&mut self, on: bool) {
        self.exp_auto = on;
    }

    // ── provisions (consumable, Echoes-bought, staged per clear, consumed on win) ──
    pub fn provision_cost(&self, id: usize) -> u64 {
        expedition::PROVISIONS.get(id).map_or(0, |p| p.cost)
    }
    pub fn buy_provision(&mut self, id: usize) -> bool {
        let cost = self.provision_cost(id);
        if id >= expedition::PROVISION_COUNT || self.echoes < cost {
            return false;
        }
        self.echoes -= cost;
        self.prov_inv[id] += 1;
        true
    }
    /// Stage a provision (you must own an unstaged charge) for team `t`'s next clear, up to EXP_PROVISION_SLOTS.
    pub fn load_provision(&mut self, t: usize, id: usize) -> bool {
        if t >= self.exp_provisions.len() || id >= expedition::PROVISION_COUNT {
            return false;
        }
        let owned = self.prov_inv.get(id).copied().unwrap_or(0);
        let already = self.exp_provisions[t].iter().filter(|&&x| x as usize == id).count() as u32;
        if already >= owned || self.exp_provisions[t].len() >= EXP_PROVISION_SLOTS {
            return false;
        }
        self.exp_provisions[t].push(id as u8);
        true
    }
    pub fn clear_provisions(&mut self, t: usize) {
        if let Some(s) = self.exp_provisions.get_mut(t) {
            s.clear();
        }
    }

    // ── relics (Echoes-bought once, equipped per team, persistent upside + downside) ──
    pub fn relic_cost(&self, id: usize) -> u64 {
        expedition::RELICS.get(id).map_or(0, |r| r.cost)
    }
    pub fn buy_relic(&mut self, id: usize) -> bool {
        let cost = self.relic_cost(id);
        if id >= expedition::RELIC_COUNT || self.relics_owned.get(id).copied().unwrap_or(true) || self.echoes < cost {
            return false;
        }
        self.echoes -= cost;
        self.relics_owned[id] = true;
        true
    }
    pub fn equip_relic(&mut self, t: usize, id: usize) -> bool {
        if t >= self.team_relics.len() || id >= expedition::RELIC_COUNT || !self.relics_owned.get(id).copied().unwrap_or(false) {
            return false;
        }
        if self.team_relics[t].contains(&(id as u8)) || self.team_relics[t].len() >= expedition::RELIC_SLOTS_PER_TEAM {
            return false;
        }
        self.team_relics[t].push(id as u8);
        true
    }
    pub fn unequip_relic(&mut self, t: usize, id: usize) {
        if let Some(rs) = self.team_relics.get_mut(t) {
            rs.retain(|&x| x as usize != id);
        }
    }

    /// Station team `t` on quest `q`. Banks idle first. If `q` isn't cleared, resolve the battle: a win grants
    /// the first-clear rewards + stations; a loss is free (returns the battle, does NOT station). If already
    /// cleared, stations immediately. One team per quest (any other team there is bumped off).
    pub fn station(&mut self, t: usize, q: usize) -> StationResult {
        let fail = StationResult {
            ok: false,
            win: false,
            newly_cleared: false,
            recruited_id: -1,
            recruit_is_new: false,
            echoes_gained: 0,
            first_clear_flux: 0.0,
            battle: None,
        };
        if t >= self.exp_teams.len() || q >= QUEST_COUNT {
            return fail;
        }
        if self.build_team_combatants(t, &Orders::default(), &[]).is_empty() {
            return fail;
        }
        // an UNCLEARED node must be OPEN (dim gate + a cleared in-edge / region entry); a CLEARED node can always
        // be re-stationed to farm (its prereqs were already met).
        if !self.exp_cleared[q] && !self.node_open(q) {
            return fail;
        }
        let mut res = StationResult { ok: true, win: true, ..fail };
        if !self.exp_cleared[q] {
            let o = self.team_orders(t);
            let battle = expedition::resolve_battle(self.clear_seed(t, q), self.build_team_combatants(t, &o, &self.team_effects(t)), expedition::quest_enemies_scaled(&QUESTS[q], self.node_mod_scale(q)), o.focus, &self.build_team_gambits(t, &o, self.auto_tactics_unlocked()));
            res.win = battle.win;
            res.battle = Some(battle);
            if !res.win {
                return res; // loss is free; not stationed
            }
            let (rid, isnew, ech, fc) = self.grant_first_clear(q, t);
            res.newly_cleared = true;
            res.recruited_id = rid;
            res.recruit_is_new = isnew;
            res.echoes_gained = ech;
            res.first_clear_flux = fc;
            // provisions are consumed on WIN only (a loss retains them — spec D6).
            if let Some(staged) = self.exp_provisions.get(t).cloned() {
                for p in staged {
                    if let Some(charge) = self.prov_inv.get_mut(p as usize) {
                        *charge = charge.saturating_sub(1);
                    }
                }
                if let Some(s) = self.exp_provisions.get_mut(t) {
                    s.clear();
                }
            }
            // history: record this run (newest-first ring) from the deciding battle
            let (rounds, surv, psize) = res.battle.as_ref().map_or((0, 0, 0), |b| (b.rounds, b.party_survivors as u32, b.party_size as u32));
            self.push_run(q, t, (rounds, surv, psize), res.echoes_gained, res.first_clear_flux);
        }
        // station (one team per quest): bump any other team off this quest, then assign.
        for s in self.exp_station.iter_mut() {
            if *s == q as i32 {
                *s = -1;
            }
        }
        self.exp_station[t] = q as i32;
        res
    }
    /// Stop team `t`'s farm.
    pub fn unstation(&mut self, t: usize) {
        if t < self.exp_station.len() {
            self.exp_station[t] = -1;
        }
    }
    /// The deterministic battle the team stationed on quest `q` is running (for the spectator Watch). None if no
    /// team is stationed there. Pure — no tick/mutation; fetch once, replay in TS.
    pub fn watch_data(&self, q: usize, variant: u32) -> Option<expedition::BattleResult> {
        if q >= QUEST_COUNT {
            return None;
        }
        let t = (0..self.exp_teams.len()).find(|&t| self.exp_station.get(t).copied().unwrap_or(-1) == q as i32)?;
        // the WATCH replays the inert FARM loop (default orders, farm_seed) — orders/provisions are a one-shot
        // clear thing, not the standing farm (spec D2). `variant` re-seeds the COSMETIC replay so the live farm view
        // isn't one bit-identical fight forever (#6 "vary"): different rolls, crit timing, the odd close call — while
        // the farm RATE stays the power-banded closed form (this seed never touches loot). variant 0 == byte-identical.
        let seed = self.farm_seed(t, q) ^ (variant as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        Some(expedition::resolve_battle(seed, self.build_team_combatants(t, &Orders::default(), &[]), expedition::quest_enemies(&QUESTS[q]), -1, &[]))
    }

    fn party_power_of(&self, party: &[usize]) -> i64 {
        party.iter().map(|&id| self.exp_power(id)).sum()
    }
    /// Per-team aggregate combat stats for the team-selection summary (QW-4): summed hp/atk/def/speed + role and
    /// element coverage counts. Pure read of exp_combatant/role/element — the UI shows it to compare teams, never
    /// recomputes it. Returns (total_hp, total_atk, total_def, total_speed, role_counts[4], element_counts[3]).
    fn team_summary(&self, party: &[usize]) -> (i64, i64, i64, i64, Vec<u32>, Vec<u32>) {
        let (mut hp, mut atk, mut def, mut spd) = (0i64, 0i64, 0i64, 0i64);
        let mut roles = vec![0u32; 4];
        let mut elems = vec![0u32; 3];
        for &id in party {
            let c = self.exp_combatant(id);
            hp += c.max_hp;
            atk += c.atk;
            def += c.def;
            spd += c.speed;
            roles[self.exp_role(id) as usize] += 1;
            elems[c.element as usize] += 1;
        }
        (hp, atk, def, spd, roles, elems)
    }
    /// Base power of a party (no level/skill) — the farm-rate band reference (keeps the farm closed-form).
    fn party_base_power(&self, party: &[usize]) -> i64 {
        party.iter().map(|&id| self.exp_base_power(id)).sum()
    }
    fn kin_pairs_of(&self, party: &[usize]) -> u32 {
        content::SYNERGY_PAIRS.iter().filter(|&&(a, b)| party.contains(&a) && party.contains(&b)).count() as u32
    }
    fn party_advantage_of(&self, party: &[usize], q: &expedition::QuestDef) -> bool {
        let dom = expedition::quest_dominant_element(q);
        party.iter().any(|&id| {
            let s = &SHAPES[id];
            expedition::element_of(s.family, content::is_knot(s.family), content::is_nonorientable(s.family)).beats(dom)
        })
    }

    /// Echoes/hr a given `party` WOULD farm at quest `qi` — the product of legible multipliers on the SAME team
    /// levers as combat (power band, element match, kin pairs, the yield perk). Piecewise-constant ⇒ O(1) offline.
    /// The Echoes/hr a party WOULD farm at quest `qi` IGNORING the cleared gate — used for "+Flux estimate"
    /// previews on not-yet-cleared quests. `echo_rate_for` adds the cleared gate on top.
    fn echo_rate_est(&self, party: &[usize], qi: usize) -> f64 {
        if qi >= QUEST_COUNT || party.is_empty() {
            return 0.0;
        }
        let quest = &QUESTS[qi];
        let req = expedition::quest_power_req(quest).max(1);
        let pw = self.party_base_power(party); // BASE power → farm rate can't compound from farmed XP (closed-form)
        let band = (pw * 100 / req).clamp(50, 400) as f64 / 100.0; // 0.5×..4× of the quest's reference power
        let base = quest.base_echo as f64;
        let aff = if self.party_advantage_of(party, quest) { 1.25 } else { 1.0 };
        let kin = 1.0 + 0.08 * self.kin_pairs_of(party) as f64;
        let yield_perk = 1.0 + 0.10 * self.exp_perk_level(1) as f64; // rich_currents
        // skill-tree FarmPct nodes (mode-internal; flows into Echoes AND, via exp_flux_for, Flux — never globals).
        let farm = 1.0 + 0.01 * party.iter().map(|&id| self.skill_farm_pct(id)).sum::<i64>() as f64;
        base * band * aff * kin * yield_perk * farm
    }
    /// Echoes/hr a party farms at a CLEARED quest `qi` (0 if uncleared) — the actual farm rate.
    fn echo_rate_for(&self, party: &[usize], qi: usize) -> f64 {
        if !self.exp_cleared.get(qi).copied().unwrap_or(false) {
            return 0.0;
        }
        self.echo_rate_est(party, qi)
    }

    /// Total Echoes/hr across ALL stationed teams (the multiple-parties sum).
    pub fn echo_rate_per_hr(&self) -> f64 {
        (0..self.exp_teams.len())
            .filter(|&t| self.exp_station[t] >= 0)
            .map(|t| self.echo_rate_for(&self.exp_teams[t], self.exp_station[t] as usize))
            .sum()
    }
    /// Echoes/hr team `t` farms (0 if idle) — per-team UI readout.
    pub fn team_echo_rate(&self, t: usize) -> f64 {
        match self.exp_station.get(t).copied().unwrap_or(-1) {
            q if q >= 0 => self.echo_rate_for(&self.exp_teams[t], q as usize),
            _ => 0.0,
        }
    }
    /// Flux/hr a given party would pay at quest `qi` — the ONE flux-estimate formula (D4). Density-scaled.
    fn exp_flux_for(&self, party: &[usize], qi: usize) -> f64 {
        self.echo_rate_for(party, qi) * content::FLUX_DENSITY * EXP_FLUX_PER_ECHO_RATE
    }
    /// Flux/hr team `t` pays (0 if idle).
    pub fn team_flux_rate(&self, t: usize) -> f64 {
        match self.exp_station.get(t).copied().unwrap_or(-1) {
            q if q >= 0 => self.exp_flux_for(&self.exp_teams[t], q as usize),
            _ => 0.0,
        }
    }
    /// Total expedition Flux/hr (sum over stationed teams), CLAMPED to a share of the core rate cap so it scales
    /// with the player but never runs away. A SEPARATE additive stream (never enters cap_rate/globals_mult).
    pub fn expedition_flux_per_hr(&self) -> f64 {
        let raw: f64 = (0..self.exp_teams.len())
            .filter(|&t| self.exp_station[t] >= 0)
            .map(|t| self.exp_flux_for(&self.exp_teams[t], self.exp_station[t] as usize))
            .sum();
        raw.min(self.cap_rate() * EXP_FLUX_CAP_SHARE)
    }

    /// One step of Auto-Expedition (idle automation): clear the next beatable unlocked quest with the current
    /// party (one per call, easiest first — same deterministic battle, no overlay), then fill empty farm slots
    /// with the highest-yield cleared quests (snapshotting the current party). Inert to the core economy exactly
    /// like a manual delve (only Echoes + a one-time boss recruit).
    /// One step of Auto-Expedition: the strongest team clears the next beatable quest (one per call), then every
    /// idle team is stationed on the highest-yield cleared quest not already taken. Hands-free, deterministic.
    pub fn auto_expedition(&mut self, now_ms: f64) -> AutoExpeditionStep {
        self.tick(now_ms); // advances + (when due) COMPLETES the in-flight run via accrue_run before we re-dispatch
        let mut step = AutoExpeditionStep { delved: false, quest: -1, recruited_id: -1, farms: 0 };
        // 1) AUTO-DISPATCH (v6, D23): when no run is in flight + there's new SAFE ground, send the strongest
        //    PROVISION-FREE team on a Delve run (one per call). The run clears the chapter over idle time (via
        //    accrue_run) — Auto never spends consumables (provision-free team) and never risks (safe_only path).
        //    When chapters are exhausted (no safe path), it falls through to the v5 station-farm floor below.
        if self.active_run.is_none() {
            let path = self.compose_run_path(true);
            if !path.is_empty() {
                let sender = (0..self.exp_teams.len())
                    .filter(|&t| !self.build_team_combatants(t, &Orders::default(), &[]).is_empty() && self.exp_provisions.get(t).is_none_or(|p| p.is_empty()))
                    .max_by_key(|&t| self.party_power_of(&self.exp_teams[t]));
                // gate on beatability of the frontier node so Auto never spins on a wall it can't break (the
                // player levels up / pulls to advance) — it falls through to the station-farm floor instead.
                if let Some(t) = sender {
                    if self.beatable_safe(t, path[0]) && self.send_expedition(t, &path, now_ms) {
                        step.delved = true;
                        step.quest = *path.last().unwrap() as i32; // the run's destination (recruits free mid-delve)
                    }
                }
            }
        }
        // 2) station every idle team on the best cleared quest not already stationed by another team. The team
        //    currently ON the run delves instead of farming, so skip it.
        let run_team = self.active_run.as_ref().map(|r| r.team);
        for t in 0..self.exp_teams.len() {
            if Some(t) == run_team || self.exp_station[t] >= 0 || self.build_team_combatants(t, &Orders::default(), &[]).is_empty() {
                continue;
            }
            let taken = self.exp_station.clone();
            let best = (0..QUEST_COUNT)
                .filter(|&qi| self.exp_cleared[qi] && self.viewport_dim >= QUESTS[qi].min_dim && !taken.contains(&(qi as i32)))
                .max_by(|&a, &b| self.echo_rate_for(&self.exp_teams[t], a).partial_cmp(&self.echo_rate_for(&self.exp_teams[t], b)).unwrap_or(std::cmp::Ordering::Equal));
            if let Some(qi) = best {
                self.exp_station[t] = qi as i32;
            }
        }
        step.farms = self.exp_station.iter().filter(|&&s| s >= 0).count();
        step
    }

    /// Accrue farmed Echoes + Flux across a span. Shared by `tick` AND `compute_offline`; both currencies are
    /// carry-threaded so online == offline bit-for-bit. O(1).
    fn accrue_expedition_rewards(&mut self, span_ms: f64) {
        let hours = span_ms / MS_PER_HOUR;
        let rate = self.echo_rate_per_hr();
        if rate > 0.0 {
            let s = rate * hours + self.echo_carry;
            let whole = s.floor();
            self.echoes += whole as u64;
            self.lifetime_echoes += whole as u64;
            self.exp_echoes_farmed += whole as u64; // history counter (banked in the same whole-unit block)
            self.echo_carry = s - whole;
        }
        let frate = self.expedition_flux_per_hr();
        if frate > 0.0 {
            let s = frate * hours + self.exp_flux_carry;
            let whole = s.floor();
            self.flux += whole;
            self.lifetime_flux += whole;
            self.exp_flux_farmed += whole; // history counter
            self.exp_flux_carry = s - whole;
        }
    }

    /// Accrue farmed XP per stationed member, per-shape carry-threaded so online == offline. O(COUNT) per call
    /// (not the span) ⇒ still instant after weeks.
    fn accrue_farm_xp(&mut self, span_ms: f64) {
        let hours = span_ms / MS_PER_HOUR;
        let mut rate = vec![0.0f64; COUNT];
        for t in 0..self.exp_teams.len() {
            let q = self.exp_station[t];
            if q < 0 {
                continue;
            }
            let req = expedition::quest_power_req(&QUESTS[q as usize]).max(1);
            let band = (self.party_base_power(&self.exp_teams[t]) * 100 / req).clamp(50, 400) as f64 / 100.0;
            for &id in &self.exp_teams[t] {
                if id < COUNT {
                    rate[id] += FARM_XP_PER_HR * band;
                }
            }
        }
        for (id, &r) in rate.iter().enumerate() {
            if r <= 0.0 {
                continue;
            }
            let s = r * hours + self.shape_xp_carry[id];
            let whole = s.floor();
            self.shape_xp[id] += whole as u64;
            self.shape_xp_carry[id] = s - whole;
        }
    }

    // ── XP, levels, skill trees (endless) ──
    fn xp_to_reach(l: u64) -> u64 {
        5 * l * l + 50 * l // cumulative XP to BE at level l; per-level cost = 10l+45 (55,65,75,…)
    }
    /// A shape's level from its lifetime XP — endless, integer-exact (f64 estimate + integer correction).
    pub fn shape_level(&self, id: usize) -> u64 {
        let x = self.shape_xp.get(id).copied().unwrap_or(0);
        let mut l = ((-50.0 + (2500.0 + 20.0 * x as f64).sqrt()) / 10.0).floor().max(0.0) as u64;
        while Self::xp_to_reach(l + 1) <= x {
            l += 1;
        }
        while l > 0 && Self::xp_to_reach(l) > x {
            l -= 1;
        }
        l
    }
    pub fn skill_points_total(&self, id: usize) -> u32 {
        self.shape_level(id) as u32 // 1 point per level
    }
    pub fn skill_points_free(&self, id: usize) -> u32 {
        let spent: u32 = self.skill_alloc.get(id).map_or(0, |a| a.iter().sum());
        self.skill_points_total(id).saturating_sub(spent)
    }
    fn role_idx(&self, id: usize) -> usize {
        self.exp_role(id) as usize
    }
    fn skill_stat_pct(&self, id: usize) -> i64 {
        let tree = expedition::SKILL_TREES[self.role_idx(id)];
        self.skill_alloc.get(id).map_or(0, |a| tree.iter().enumerate().map(|(n, nd)| a.get(n).copied().unwrap_or(0) as i64 * nd.stat_pct).sum())
    }
    fn skill_farm_pct(&self, id: usize) -> i64 {
        let tree = expedition::SKILL_TREES[self.role_idx(id)];
        self.skill_alloc.get(id).map_or(0, |a| tree.iter().enumerate().map(|(n, nd)| a.get(n).copied().unwrap_or(0) as i64 * nd.farm_pct).sum())
    }
    /// Spend one free skill point on node `node` of shape `id`'s role tree (checks free points, node max, prereq).
    pub fn spend_skill_point(&mut self, id: usize, node: usize) -> bool {
        if id >= COUNT {
            return false;
        }
        let tree = expedition::SKILL_TREES[self.role_idx(id)];
        if node >= tree.len() || node >= MAX_NODES {
            return false;
        }
        let nd = &tree[node];
        if self.skill_alloc[id][node] >= nd.max {
            return false;
        }
        if let Some((req, lvl)) = nd.requires {
            if self.skill_alloc[id].get(req).copied().unwrap_or(0) < lvl {
                return false;
            }
        }
        if self.skill_points_free(id) == 0 {
            return false;
        }
        self.skill_alloc[id][node] += 1;
        true
    }
    pub fn respec(&mut self, id: usize) {
        if id < COUNT {
            for v in self.skill_alloc[id].iter_mut() {
                *v = 0;
            }
        }
    }

    /// Auto-allocate ALL of shape `id`'s free skill points into a sensible default build — the "otherwise auto
    /// unlocked" path for players who don't want to micro-manage the tree. Greedily spends the readiest node: COMBAT
    /// (stat_pct) nodes before farm, lowest index first, always respecting prereqs + max ranks (it routes through
    /// `spend_skill_point`, so it can never produce an invalid build). Deterministic. Returns the points spent.
    pub fn auto_skill(&mut self, id: usize) -> u32 {
        if id >= COUNT {
            return 0;
        }
        let mut spent = 0u32;
        while self.skill_points_free(id) > 0 {
            let tree = expedition::SKILL_TREES[self.role_idx(id)];
            let pick = (0..tree.len().min(MAX_NODES))
                .filter(|&node| {
                    let nd = &tree[node];
                    self.skill_alloc[id][node] < nd.max
                        && nd.requires.is_none_or(|(req, lvl)| self.skill_alloc[id].get(req).copied().unwrap_or(0) >= lvl)
                })
                .max_by_key(|&node| (tree[node].stat_pct > 0, std::cmp::Reverse(node)));
            match pick {
                Some(node) if self.spend_skill_point(id, node) => spent += 1,
                _ => break, // nothing left to allocate (all maxed or prereq-locked)
            }
        }
        spent
    }

    pub fn exp_perk_cost(&self, id: usize) -> u64 {
        if id >= expedition::EXP_PERK_COUNT {
            return 0;
        }
        let lvl = self.exp_perk_level(id);
        (expedition::EXP_PERKS[id].cost as f64 * 1.8_f64.powi(lvl as i32)).floor() as u64
    }

    /// Buy an expedition perk with Echoes (mode-internal only). Returns true on success.
    pub fn buy_exp_perk(&mut self, id: usize) -> bool {
        if id >= expedition::EXP_PERK_COUNT {
            return false;
        }
        let lvl = self.exp_perk_level(id);
        if lvl >= expedition::EXP_PERKS[id].max_level {
            return false;
        }
        let cost = self.exp_perk_cost(id);
        if self.echoes < cost {
            return false;
        }
        self.echoes -= cost;
        self.exp_perks[id] += 1;
        // shrinking nothing; if fourth_berth was just bought the party cap rose (no party change needed)
        true
    }

    pub fn dev_add_echoes(&mut self, amount: u64) {
        self.echoes += amount;
        self.lifetime_echoes += amount;
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("GameState serializes")
    }

    pub fn from_json(s: &str) -> Result<GameState, String> {
        let mut state: GameState = serde_json::from_str(s).map_err(|e| e.to_string())?;
        if state.schema_version > SCHEMA_VERSION {
            return Err(format!(
                "save schema v{} is newer than this build (v{SCHEMA_VERSION})",
                state.schema_version
            ));
        }
        // Migration chain runs here for older versions. v2→v3 added the Expeditions layer; all its fields are
        // additive #[serde(default)], so a v2 save simply loads with the mode dormant (the resizes below give
        // the per-content vecs their current lengths). No data is rewritten — the bump exists so a v3 build is
        // explicit about the new nested run-state and a future migration has a clean version anchor.
        // defensive: ensure owned vec matches the current content count
        if state.owned.len() != COUNT {
            state.owned.resize(COUNT, 0);
        }
        if state.bonds.len() != COUNT {
            state.bonds.resize(COUNT, 0);
        }
        if state.discovered.len() != content::RECIPES.len() {
            state.discovered.resize(content::RECIPES.len(), false);
        }
        if state.forged.len() != COUNT {
            state.forged.resize(COUNT, false);
        }
        if state.pat_gained.len() != COUNT {
            state.pat_gained.resize(COUNT, 0);
        }
        if state.pulls_by_rarity.len() != 5 {
            state.pulls_by_rarity.resize(5, 0);
        }
        if state.upgrades.len() != content::UPGRADE_COUNT {
            state.upgrades.resize(content::UPGRADE_COUNT, 0);
        }
        if state.milestones_done.len() != content::MILESTONE_COUNT {
            state
                .milestones_done
                .resize(content::MILESTONE_COUNT, false);
        }
        if state.facet_perks.len() != content::FACET_PERK_COUNT {
            state.facet_perks.resize(content::FACET_PERK_COUNT, 0);
        }
        if state.equipped.len() < COSMETIC_SLOTS {
            state.equipped.resize(COSMETIC_SLOTS, 0); // old saves predate the generic cosmetic slots
        }
        // ── Expeditions (v3→v4): size per-content vecs, fold farms→teams, sanitise teams + XP/skill ──
        if state.exp_cleared.len() != QUEST_COUNT {
            state.exp_cleared.resize(QUEST_COUNT, false);
        }
        if state.exp_perks.len() != expedition::EXP_PERK_COUNT {
            state.exp_perks.resize(expedition::EXP_PERK_COUNT, 0);
        }
        if state.shape_xp.len() != COUNT {
            state.shape_xp.resize(COUNT, 0);
        }
        if state.shape_xp_carry.len() != COUNT {
            state.shape_xp_carry.resize(COUNT, 0.0);
        }
        if state.skill_alloc.len() != COUNT {
            state.skill_alloc.resize(COUNT, vec![0; MAX_NODES]);
        }
        for a in state.skill_alloc.iter_mut() {
            a.resize(MAX_NODES, 0);
        }
        let pmax = 3 + if state.exp_perks.first().copied().unwrap_or(0) > 0 { 1 } else { 0 };
        // v3→v4: fold the single exp_party + exp_farms into the new exp_teams + exp_station model (once).
        if state.exp_teams.is_empty() {
            state.exp_teams = if state.exp_party.is_empty() { vec![Vec::new()] } else { vec![state.exp_party.clone()] };
            state.exp_station = vec![-1; state.exp_teams.len()];
            for f in std::mem::take(&mut state.exp_farms) {
                let pos = state.exp_teams.iter().position(|m| *m == f.party).unwrap_or_else(|| {
                    state.exp_teams.push(f.party.clone());
                    state.exp_station.push(-1);
                    state.exp_teams.len() - 1
                });
                if f.quest < QUEST_COUNT && state.exp_cleared.get(f.quest).copied().unwrap_or(false) {
                    state.exp_station[pos] = f.quest as i32;
                }
            }
        }
        // sanitise teams: parity, owned-only + dedupe + truncate, valid+cleared stations, ≤1 team per quest.
        if state.exp_station.len() != state.exp_teams.len() {
            state.exp_station.resize(state.exp_teams.len(), -1);
        }
        for team in state.exp_teams.iter_mut() {
            let mut seen: Vec<usize> = Vec::new();
            team.retain(|&id| id < COUNT && state.owned[id] > 0 && !seen.contains(&id) && { seen.push(id); true });
            team.truncate(pmax);
        }
        for st in state.exp_station.iter_mut() {
            if *st >= 0 && !(((*st as usize) < QUEST_COUNT) && state.exp_cleared.get(*st as usize).copied().unwrap_or(false)) {
                *st = -1;
            }
        }
        let mut used: Vec<i32> = Vec::new();
        for st in state.exp_station.iter_mut().rev() {
            if *st >= 0 {
                if used.contains(st) {
                    *st = -1;
                } else {
                    used.push(*st);
                }
            }
        }
        if state.exp_teams.is_empty() {
            state.exp_teams.push(Vec::new());
            state.exp_station.push(-1);
        }
        if state.exp_active_team >= state.exp_teams.len() {
            state.exp_active_team = 0;
        }
        // v4→v5: bring every team-parallel + content-parallel v5 vec into lockstep (one owner). Pre-v5 saves
        // have none of these (serde-default empty) → they size up to all-default, mode dormant.
        state.sanitize_exp_vecs();
        // v4→v5: backfill the History counters from already-cleared nodes (the v4 player cleared them before the
        // counters existed). Only when total==0 — a real v5 save with clears already has a non-zero count, so
        // this never double-counts; a fresh game backfills 0.
        if state.exp_clears_total == 0 {
            state.exp_clears_total = state.exp_cleared.iter().filter(|&&c| c).count() as u64;
            state.exp_bosses_freed = (0..QUEST_COUNT).filter(|&q| state.exp_cleared.get(q).copied().unwrap_or(false) && QUESTS[q].boss.is_some()).count() as u64;
        }
        // 2D board: older saves have no board_cells — seed them row-packed (0,1,2…). Then prune the loadout +
        // its cells together for any invalid/unowned ids so the two arrays stay parallel.
        if state.board_cells.len() != state.loadout.len() {
            state.board_cells = (0..state.loadout.len().min(BOARD_N) as u8).collect();
        }
        let mut keep_load = Vec::new();
        let mut keep_cells = Vec::new();
        for (i, &id) in state.loadout.iter().enumerate() {
            if id < COUNT && state.owned[id] > 0 {
                let cell = state.board_cells.get(i).copied().unwrap_or(i as u8);
                if (cell as usize) < BOARD_N && !keep_cells.contains(&cell) {
                    keep_load.push(id);
                    keep_cells.push(cell);
                }
            }
        }
        state.loadout = keep_load;
        state.board_cells = keep_cells;
        state.schema_version = SCHEMA_VERSION;
        Ok(state)
    }

    pub fn view(&self) -> GameStateView {
        GameStateView {
            flux: self.flux,
            rate_per_hr: self.rate_per_hr(),
            shards: self.shards,
            owned: self.owned.clone(),
            distinct_owned: self.distinct_owned(),
            loadout: self.loadout.clone(),
            board_cells: self.board_cells.clone(),
            board_w: BOARD_W as u32,
            board_h: BOARD_H as u32,
            euler_used: self.euler_used(),
            euler_cap: self.effective_euler_cap(),
            viewport_dim: self.viewport_dim,
            ng_cycle: self.ng_cycle,
            prestige_mult: self.prestige_mult,
            pity_since_top: self.pity.since_top,
            resonance: self.pity.resonance,
            total_pulls: self.pity.counter,
            can_pull: self.flux >= PULL_COST,
            can_ten_pull: self.flux >= TEN_PULL_COST,
            pull_cost: PULL_COST,
            ten_pull_cost: TEN_PULL_COST,
            core_complete: self.core_complete(),
            bonds: self.bonds.clone(),
            bond_levels: (0..COUNT).map(|i| self.bond_level(i)).collect(),
            discovered: self.discovered.clone(),
            forged: self.forged.clone(),
            platonic_set: content::PLATONIC_IDS.iter().all(|&id| self.owned[id] > 0),
            relics_owned: self.relics_owned(),
            relic_count: content::rarity_ids(Rarity::Relic).len() as u32,
            pull_count: content::PULL_COUNT as u32,
            relic_cost: RELIC_COST,
            recipe_costs: content::RECIPES.iter().map(|r| self.pair_forge_cost(r.a, r.b)).collect(),
            cosmetics: self.cosmetics.clone(),
            scene: self.scene,
            equipped: self.equipped.clone(),
            lifetime_flux: self.lifetime_flux,
            lifetime_shards: self.lifetime_shards,
            total_forges: self.total_forges,
            total_stars: (0..COUNT).map(|id| self.star_level(id)).sum(),
            pulls_by_rarity: self.pulls_by_rarity.clone(),
            created_ms: self.created_ms,
            last_seen_ms: self.last_seen_ms,
            active_synergies: self.synergy_count(),
            upgrades: self.upgrades.clone(),
            milestones_done: self.milestones_done.clone(),
            facets: self.facets,
            facet_perks: self.facet_perks.clone(),
            current_banner: self.current_banner,
            star_levels: (0..COUNT).map(|i| self.star_level(i)).collect(),
            mult_prestige: self.prestige_mult,
            mult_set: self.set_bonus_mult(),
            mult_bond: self.bond_mult(),
            mult_synergy: self.synergy_mult(),
            mult_genus_res: self.genus_resonance_mult(),
            mult_milestone: self.milestone_mult(),
            mult_facet: self.facet_meta_mult(),
            mult_ballast: self.ballast_mult(),
            mult_euler_surplus: self.euler_surplus_mult(),
            mult_crossdim: self.crossdim_mult(),
            mult_signature: self.signature_global_mult(),
            mult_shape_effects: {
                let base: f64 = self
                    .loadout
                    .iter()
                    .map(|&id| SHAPES[id].base_prod * (1.0 + 0.25 * SHAPES[id].genus as f64))
                    .sum::<f64>()
                    * content::FLUX_DENSITY; // match per_shape_self_prod's scaling so the ratio stays the true effects mult
                if base > 1e-9 {
                    self.deployed_production() / base
                } else {
                    1.0
                }
            },
            upgrade_costs: (0..content::UPGRADE_COUNT)
                .map(|i| content::upgrade_cost(i, self.upgrade_level(i)))
                .collect(),
            upgrade_unlocked: (0..content::UPGRADE_COUNT)
                .map(|i| self.upgrade_unlocked(i))
                .collect(),
            facet_perk_costs: (0..content::FACET_PERK_COUNT)
                .map(|i| content::facet_perk_cost(i, self.facet_level(i)))
                .collect(),
            overclock_on: self.overclock_on,
            use_orrery: self.use_orrery,
            orrery_radius: self.orrery_radius(),
            orrery_cell_cap: self.floor_cells(),
            orrery_cells: orrery::hex_region(self.orrery_radius()),
            orrery_period: self.flux_board().period(),
            orrery_tick_ms: ORRERY_TICK_SECONDS * 1000.0,
            flux_emitters: self.flux_view(),
            flux_contrib: {
                let c = self.flux_contributions();
                c.iter().map(|x| x.0).collect()
            },
            flux_amp: {
                let c = self.flux_contributions();
                c.iter().map(|x| x.1).collect()
            },
            echoes: self.echoes,
            lifetime_echoes: self.lifetime_echoes,
            echo_rate_per_hr: self.echo_rate_per_hr(),
            exp_flux_rate: self.expedition_flux_per_hr(),
            exp_teams: (0..self.exp_teams.len())
                .map(|t| {
                    let m = self.exp_teams[t].clone();
                    let (total_hp, total_atk, total_def, total_speed, role_counts, element_counts) = self.team_summary(&m);
                    TeamView {
                        station: self.exp_station.get(t).copied().unwrap_or(-1),
                        power: self.party_power_of(&m),
                        echo_rate_per_hr: self.team_echo_rate(t),
                        flux_rate_per_hr: self.team_flux_rate(t),
                        orders: self.team_orders(t),
                        provisions: self.exp_provisions.get(t).cloned().unwrap_or_default(),
                        relics: self.team_relics.get(t).cloned().unwrap_or_default(),
                        total_hp,
                        total_atk,
                        total_def,
                        total_speed,
                        role_counts,
                        element_counts,
                        kin_pairs: self.kin_pairs_of(&m),
                        members: m,
                    }
                })
                .collect(),
            exp_active_team: self.exp_active_team as u32,
            exp_max_teams: MAX_TEAMS as u32,
            exp_party_max: self.exp_party_max() as u32,
            exp_cleared: self.exp_cleared.clone(),
            exp_perks: self.exp_perks.clone(),
            exp_perk_costs: (0..expedition::EXP_PERK_COUNT).map(|i| self.exp_perk_cost(i)).collect(),
            exp_power: (0..COUNT).map(|i| self.exp_power(i)).collect(),
            exp_stats: (0..COUNT)
                .map(|i| {
                    let c = self.exp_combatant(i);
                    ExpStatView { max_hp: c.max_hp, atk: c.atk, def: c.def, speed: c.speed, ult: c.ult_power }
                })
                .collect(),
            shape_levels: (0..COUNT).map(|i| self.shape_level(i)).collect(),
            shape_xp: self.shape_xp.clone(),
            xp_to_next: (0..COUNT).map(|i| Self::xp_to_reach(self.shape_level(i) + 1).saturating_sub(self.shape_xp.get(i).copied().unwrap_or(0))).collect(),
            skill_points_free: (0..COUNT).map(|i| self.skill_points_free(i)).collect(),
            skill_alloc: self.skill_alloc.clone(),
            shard_rate_per_hr: self.overcap_shard_rate_per_hr(),
            exp_quest_flux_est: {
                let team = self.exp_teams.get(self.exp_active_team).cloned().unwrap_or_default();
                (0..QUEST_COUNT).map(|qi| self.echo_rate_est(&team, qi) * content::FLUX_DENSITY * EXP_FLUX_PER_ECHO_RATE).collect()
            },
            exp_node_open: (0..QUEST_COUNT).map(|q| self.node_open(q)).collect(),
            exp_node_mod: self.exp_node_mod.clone(),
            exp_node_beatable: {
                let t = self.exp_active_team;
                (0..QUEST_COUNT)
                    .map(|q| if self.exp_cleared[q] { true } else if self.node_open(q) { self.beatable_safe(t, q) } else { false })
                    .collect()
            },
            exp_auto: self.exp_auto,
            prov_inv: self.prov_inv.clone(),
            prov_costs: (0..expedition::PROVISION_COUNT).map(|i| self.provision_cost(i)).collect(),
            exp_relics_owned: self.relics_owned.clone(),
            exp_relic_costs: (0..expedition::RELIC_COUNT).map(|i| self.relic_cost(i)).collect(),
            exp_clears_total: self.exp_clears_total,
            exp_bosses_freed: self.exp_bosses_freed,
            exp_echoes_farmed: self.exp_echoes_farmed,
            exp_flux_farmed: self.exp_flux_farmed,
            exp_runs: self.exp_runs.clone(),
            run: self.active_run.as_ref().map(|r| {
                let reveal = ((r.claimed_rooms as usize) + 1).min(r.room_kind.len()); // visited + the current room
                // Per-room reward lumps, BANKED rooms only (earned ⇒ no spoiler of the in-progress/future room).
                let claimed = (r.claimed_rooms as usize).min(r.prefix_echoes.len());
                let lump = |pre: &[u64]| -> Vec<u64> {
                    (0..claimed).map(|k| pre[k] - if k == 0 { 0 } else { pre[k - 1] }).collect()
                };
                // Whole-run average rate (smoother + less spoilery than a per-segment rate) — Rust-emitted, never TS-derived.
                let rate = |pre: &[u64]| -> f64 {
                    if r.total_ms > 0.0 { *pre.last().unwrap_or(&0) as f64 / r.total_ms * 3_600_000.0 } else { 0.0 }
                };
                RunView {
                    team: r.team,
                    path: r.path.clone(),
                    room_kind: r.room_kind[0..reveal].to_vec(),
                    current_room: r.claimed_rooms,
                    total_rooms: r.planned_rooms, // intended room count (incl. cozy rooms) — an early stop reads as a soft-land
                    start_ms: r.start_ms,
                    total_ms: r.total_ms,
                    room_echoes: lump(&r.prefix_echoes),
                    room_flux: lump(&r.prefix_flux),
                    delve_echoes_per_hr: rate(&r.prefix_echoes),
                    delve_flux_per_hr: rate(&r.prefix_flux),
                    pending_decision: {
                        // the IN-PROGRESS room (index claimed_rooms): if it's an un-chosen Crossroads, surface it so the
                        // UI can offer the live override. The UI gates visibility on its own clock vs deadline_ms.
                        let cur = r.claimed_rooms as usize;
                        let is_decision = cur < r.room_kind.len() && r.room_kind[cur] == expedition::RoomKind::Decision.as_u8();
                        is_decision
                            .then(|| r.decisions.iter().position(|d| d.room_idx == cur))
                            .flatten()
                            .filter(|&di| r.decision_choices.get(di).copied().unwrap_or(0) == -1)
                            .map(|di| {
                                let d = &r.decisions[di];
                                let arrival = if cur > 0 { r.prefix_ms[cur - 1] } else { 0.0 };
                                let ov = |e: &DecisionEffect| DecisionOptionView { heal_pct: e.heal_pct, atk_pct: e.atk_pct, echo_bonus: e.echo_bonus, speed_pct: e.speed_pct };
                                PendingDecisionView {
                                    room_idx: cur,
                                    deadline_ms: r.start_ms + arrival + d.window_ms,
                                    options: d.options.iter().map(ov).collect(),
                                    auto_option: d.auto_option,
                                    template: d.template,
                                }
                            })
                    },
                }
            }),
            can_send_run: self.active_run.is_none() && !self.compose_run_path(false).is_empty(),
            run_rest_until: self.exp_rest_until,
            gambit_auto: self.auto_tactics_unlocked(),
            gambit_conds: self.unlocked_gambit_conds(),
            gambit_acts: self.unlocked_gambit_acts(),
            run_history: self.run_history.clone(),
        }
    }
}

// ─────────────────────────── WASM API (adapter ring) ───────────────────────────

#[wasm_bindgen]
pub struct Game {
    state: GameState,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: f64, now_ms: f64) -> Game {
        Game {
            state: GameState::new(seed as u64, now_ms),
        }
    }

    /// Load a save; the caller then typically calls `compute_offline(now)`.
    pub fn from_save(json: &str, _now_ms: f64) -> Result<Game, String> {
        GameState::from_json(json).map(|state| Game { state })
    }

    pub fn pull(&mut self, now_ms: f64) -> String {
        serde_json::to_string(&self.state.pull(now_ms)).unwrap()
    }

    /// Ten-pull (11 for the price of 10). Returns a JSON array of outcomes.
    pub fn ten_pull(&mut self, now_ms: f64) -> String {
        self.state.tick(now_ms);
        if self.state.flux < TEN_PULL_COST {
            return "[]".to_string();
        }
        // grant the bundle discount, then pull 11 at the per-pull path (which won't re-charge incorrectly:
        // we pre-credit the discount so 11 × 100 nets to 1000)
        self.state.flux += PULL_COST; // pre-credit so the 11th is "free"
        let outcomes: Vec<PullOutcome> = (0..11).map(|_| self.state.pull(now_ms)).collect();
        serde_json::to_string(&outcomes).unwrap()
    }

    pub fn tick(&mut self, now_ms: f64) {
        self.state.tick(now_ms);
    }

    pub fn compute_offline(&mut self, now_ms: f64) -> String {
        serde_json::to_string(&self.state.compute_offline(now_ms)).unwrap()
    }

    pub fn deploy(&mut self, id: usize) -> bool {
        self.state.deploy(id)
    }
    pub fn place_at(&mut self, id: usize, cell: u8) -> bool {
        self.state.place_at(id, cell)
    }
    pub fn undeploy(&mut self, id: usize) -> bool {
        self.state.undeploy(id)
    }
    pub fn auto_arrange(&mut self) {
        self.state.auto_arrange();
    }
    pub fn recrystallize(&mut self) -> bool {
        self.state.recrystallize()
    }
    pub fn inspect(&mut self, id: usize) {
        self.state.inspect(id)
    }
    pub fn pat(&mut self, id: usize) {
        self.state.pat(id)
    }
    pub fn tap_shape(&mut self, id: usize) -> f64 {
        self.state.tap_shape(id)
    }
    pub fn forge(&mut self, a: usize, b: usize) -> String {
        serde_json::to_string(&self.state.forge(a, b)).unwrap()
    }
    /// Preview the output of forging a # b (shape id, or -1 if not forgeable) — for the free-form bench.
    pub fn preview_forge(&self, a: usize, b: usize) -> i32 {
        self.state.preview_forge(a, b)
    }
    /// Shards it would cost to forge a # b right now (0 if not forgeable) — for the bench cost label.
    pub fn forge_cost(&self, a: usize, b: usize) -> u64 {
        self.state.pair_forge_cost(a, b)
    }
    /// Projected Flux/hr if `upgrade` / `facet` were one level higher — the Workshop "→ +X/hr" badge subtracts the
    /// current `rate_per_hr` from this. A projection (ignores affordability); the economy stays Rust-computed.
    pub fn rate_after_upgrade(&self, id: usize) -> f64 {
        self.state.rate_after_upgrade(id)
    }
    pub fn rate_after_facet(&self, id: usize) -> f64 {
        self.state.rate_after_facet(id)
    }
    pub fn claim_relic(&mut self) -> i32 {
        self.state.claim_relic()
    }
    pub fn dev_add_flux(&mut self, amount: f64) {
        self.state.dev_add_flux(amount)
    }
    pub fn dev_add_shards(&mut self, amount: f64) {
        self.state.dev_add_shards(amount as u64)
    }
    pub fn dev_unlock_all(&mut self) {
        self.state.dev_unlock_all()
    }
    pub fn dev_reset_unlocks(&mut self) {
        self.state.dev_reset_unlocks()
    }
    pub fn dev_orrery_preset(&mut self, tier: u32) {
        self.state.dev_orrery_preset(tier)
    }
    pub fn buy_cosmetic(&mut self, id: u32, cost: f64) -> bool {
        self.state.buy_cosmetic(id, cost)
    }
    pub fn buy_cosmetic_slot(&mut self, id: u32, slot: u32, cost: f64) -> bool {
        self.state.buy_cosmetic_slot(id, slot, cost)
    }
    pub fn equip_cosmetic_slot(&mut self, id: u32, slot: u32) -> bool {
        self.state.equip_cosmetic_slot(id, slot)
    }
    pub fn buy_upgrade(&mut self, id: usize) -> bool {
        self.state.buy_upgrade(id)
    }
    pub fn buy_facet_perk(&mut self, id: usize) -> bool {
        self.state.buy_facet_perk(id)
    }
    pub fn set_banner(&mut self, id: u32) {
        if (id as usize) < content::BANNER_COUNT {
            self.state.current_banner = id;
        }
    }
    pub fn select_scene(&mut self, id: u32) -> bool {
        self.state.select_scene(id)
    }
    pub fn serialize(&self) -> String {
        self.state.to_json()
    }
    pub fn view(&self) -> String {
        serde_json::to_string(&self.state.view()).unwrap()
    }
    /// Toggle the Orrery engine (opt-in; banks production at `now_ms` first so the switch is seamless).
    pub fn set_use_orrery(&mut self, on: bool, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.use_orrery = on;
        if on {
            self.state.ensure_anchors();
        }
    }
    /// overclock (#19): flip the reversible Redline session toggle. Banks accrued production at the CURRENT cap
    /// first (tick), so flipping never retroactively rewrites earnings. No-op until the upgrade is owned.
    pub fn set_overclock(&mut self, on: bool, now_ms: f64) {
        self.state.tick(now_ms);
        if self.state.upgrade_level(18) > 0 {
            self.state.overclock_on = on;
        }
    }
    /// Drag a deployed shape's anchor to hex cell `(q,r)` — swaps with the occupant if taken; off-grid is a
    /// no-op. Period is untouched (O(1) preserved). Banks production at `now_ms` first.
    pub fn set_anchor(&mut self, shape_id: u16, q: i32, r: i32, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.move_anchor(shape_id as usize, q, r);
    }
    /// Rotate a deployed shape's straight lane to the next of the 6 hex axes.
    pub fn rotate_lane(&mut self, shape_id: u16, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.cycle_axis(shape_id as usize);
    }
    /// Set a deployed shape's lane phase (timing).
    pub fn set_phase(&mut self, shape_id: u16, phase: u8, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.set_lane_phase(shape_id as usize, phase);
    }
    /// Reset a shape's lane axis + phase to the topology default (keeps its anchor).
    pub fn reset_orbit(&mut self, shape_id: u16, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.reset_lane(shape_id as usize);
    }

    // ── Expeditions (the opt-in idle RPG) ──
    /// Set team `t`'s members from a JSON array of shape ids, e.g. "[0,3,10]" (owned only, clamped). Banks first.
    pub fn set_team(&mut self, t: usize, ids_json: &str, now_ms: f64) {
        self.state.tick(now_ms);
        if let Ok(ids) = serde_json::from_str::<Vec<usize>>(ids_json) {
            self.state.set_team(t, &ids);
        }
    }
    pub fn set_active_team(&mut self, t: usize) {
        self.state.set_active_team(t);
    }
    pub fn add_team(&mut self, now_ms: f64) -> u32 {
        self.state.tick(now_ms);
        self.state.add_team() as u32
    }
    pub fn remove_team(&mut self, t: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.remove_team(t)
    }
    /// Station team `t` on quest `q` (clears it first if needed). Returns a JSON `StationResult` (battle + rewards).
    pub fn station(&mut self, t: usize, q: usize, now_ms: f64) -> String {
        self.state.tick(now_ms);
        serde_json::to_string(&self.state.station(t, q)).unwrap()
    }
    /// Stop team `t`'s farm.
    pub fn unstation(&mut self, t: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.unstation(t);
    }
    /// v6: send team `t` on the next auto-composed linear Delve run. Returns false if a run is already in flight,
    /// there's nothing new to delve, or the party is empty. The schedule is frozen + persisted here.
    pub fn send_expedition(&mut self, t: usize, now_ms: f64) -> bool {
        let path = self.state.compose_run_path(false); // manual send may delve through player-set risk mods
        if path.is_empty() {
            return false;
        }
        self.state.send_expedition(t, &path, now_ms)
    }
    /// v6: is there a linear run available to send (the auto-path picker finds new ground)?
    pub fn can_send_expedition(&self) -> bool {
        !self.state.compose_run_path(false).is_empty()
    }
    /// The deterministic battle the team stationed on quest `q` is running (for the spectator Watch), or "null".
    pub fn watch_data(&self, q: usize, variant: u32) -> String {
        serde_json::to_string(&self.state.watch_data(q, variant)).unwrap()
    }
    /// v6: the BattleResult for the active run's room `room_idx` (a fight room the party has reached), or "null".
    pub fn run_room_battle(&self, room_idx: usize) -> String {
        serde_json::to_string(&self.state.replay_room_battle(room_idx)).unwrap()
    }
    /// v6: live override of a Crossroads (Decision room) auto-pick within its timeout window. Banks first internally;
    /// re-resolves only the unbanked tail. Returns false if the choice is illegal (banked / out of window / re-roll).
    pub fn choose_decision(&mut self, room_idx: usize, option: u8, now_ms: f64) -> bool {
        self.state.choose_decision(room_idx, option, now_ms)
    }
    /// One Auto-Expedition step (strongest team clears next quest + idle teams auto-station). JSON AutoExpeditionStep.
    pub fn auto_expedition(&mut self, now_ms: f64) -> String {
        serde_json::to_string(&self.state.auto_expedition(now_ms)).unwrap()
    }
    /// Buy an expedition perk with Echoes (mode-internal effect only). Banks first.
    pub fn buy_exp_perk(&mut self, id: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.buy_exp_perk(id)
    }
    /// Spend a free skill point on node `node` of shape `id`'s role tree. Banks first (level affects power).
    pub fn spend_skill_point(&mut self, id: usize, node: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.spend_skill_point(id, node)
    }
    pub fn respec(&mut self, id: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.respec(id);
    }
    /// Auto-allocate all free skill points for shape `id` into the default build (the "otherwise auto unlocked" path).
    pub fn auto_skill(&mut self, id: usize, now_ms: f64) -> u32 {
        self.state.tick(now_ms);
        self.state.auto_skill(id)
    }
    // ── v5: routing, orders, provisions, relics, auto ──
    pub fn set_node_mod(&mut self, q: usize, m: u8, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.set_node_mod(q, m);
    }
    pub fn set_orders(&mut self, t: usize, formation: u8, doctrine: u8, focus: i32, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.set_orders(t, formation, doctrine, focus as i8);
    }
    pub fn set_slot_stance(&mut self, t: usize, slot: usize, s: u8, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.set_slot_stance(t, slot, s);
    }
    pub fn set_gambit_rule(&mut self, t: usize, slot: usize, idx: usize, cond: u8, action: u8, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.set_gambit_rule(t, slot, idx, cond, action);
    }
    pub fn toggle_gambit(&mut self, t: usize, slot: usize, idx: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.toggle_gambit(t, slot, idx);
    }
    pub fn move_gambit(&mut self, t: usize, slot: usize, idx: usize, up: bool, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.move_gambit(t, slot, idx, up);
    }
    pub fn reorder_gambit(&mut self, t: usize, slot: usize, from: usize, to: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.reorder_gambit(t, slot, from, to);
    }
    pub fn add_gambit(&mut self, t: usize, slot: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.add_gambit(t, slot);
    }
    pub fn remove_gambit(&mut self, t: usize, slot: usize, idx: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.remove_gambit(t, slot, idx);
    }
    pub fn reset_gambits(&mut self, t: usize, slot: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.reset_gambits(t, slot);
    }
    /// Auto-fill slot `slot` with the smart role-default gambit program (role derived from the stationed shape).
    pub fn auto_gambits(&mut self, t: usize, slot: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.auto_gambits(t, slot);
    }
    pub fn buy_provision(&mut self, id: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.buy_provision(id)
    }
    pub fn load_provision(&mut self, t: usize, id: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.load_provision(t, id)
    }
    pub fn clear_provisions(&mut self, t: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.clear_provisions(t);
    }
    pub fn buy_relic(&mut self, id: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.buy_relic(id)
    }
    pub fn equip_relic(&mut self, t: usize, id: usize, now_ms: f64) -> bool {
        self.state.tick(now_ms);
        self.state.equip_relic(t, id)
    }
    pub fn unequip_relic(&mut self, t: usize, id: usize, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.unequip_relic(t, id);
    }
    pub fn set_auto(&mut self, on: bool, now_ms: f64) {
        self.state.tick(now_ms);
        self.state.set_auto(on);
    }
    pub fn dev_add_echoes(&mut self, amount: f64) {
        self.state.dev_add_echoes(amount as u64);
    }
}

/// The AUTHORITATIVE expedition role of a shape family (pure — depends only on the family). The single source
/// of truth used by both combat (`exp_role`) and the shape DTO, so the web never re-derives it (prime directive).
fn role_for(fam: &str) -> expedition::Role {
    if content::is_knot(fam) {
        return expedition::Role::Control;
    }
    if content::is_nonorientable(fam) || content::is_polytope_4d(fam) {
        return expedition::Role::Support;
    }
    match fam {
        "sphere" | "cube" | "cylinder" | "ellipsoid" | "hyperboloid" | "catenoid" => expedition::Role::Tank,
        "dodecahedron" | "disk" | "gyroid" | "schwarz_p" | "schwarz_d" | "seifert" | "costa" => expedition::Role::Support,
        _ => expedition::Role::Dps,
    }
}

/// Per-shape combat IDENTITY (Slice 2): small atk%/def% multipliers + a flat speed delta, derived from a shape's
/// topology so it needs no content migration (D2). Neutral = `(100, 100, 0)`. **COMBAT-ONLY**: folded inside
/// `exp_combatant`, NEVER inside `exp_base_power` — so the closed-form farm rate (which bands on `exp_base_power`)
/// is untouched by construction (the spine of the deepen-combat plan). Deltas stay small so a beloved ★5 common can
/// still out-power a fresh UR — the "bring who you love" guarantee holds.
fn combat_bias(fam: &str, genus: u32) -> (i64, i64, i64) {
    let (mut atk, mut def, mut spd) = (100i64, 100i64, 0i64);
    if content::is_knot(fam) {
        // a knot is a coiled spring: it strikes hard and quick, but it's wiry — light on defense
        atk += 14;
        def -= 8;
        spd += 3;
    }
    if content::is_nonorientable(fam) {
        // one-sided surfaces fight slippery — fast and tricky, a touch glassy
        spd += 6;
        atk += 6;
        def -= 4;
    }
    // genus = handles = structural bulk: each hole trades a little punch + pace for real toughness
    let g = genus.min(4) as i64;
    def += g * 6;
    atk -= g * 2;
    spd -= g;
    (atk.max(60), def.max(60), spd)
}

/// The static shape table for the web layer (nicknames, families, rarities, costs).
#[wasm_bindgen]
pub fn shapes_json() -> String {
    #[derive(Serialize)]
    struct ShapeRow {
        id: usize,
        nick: &'static str,
        family: &'static str,
        rarity: Rarity,
        genus: u32,
        euler_cost: u32,
        orientable: bool, // declared invariant — drives the orrery's Orientability "flip" timbre (feel layer)
        forgeable: bool,  // is a connected-sum-able surface (sphere/torus/Klein/…) — drives the forge bench picker
        role: &'static str, // AUTHORITATIVE expedition role (so the web never re-derives it — prime directive)
        prod: f64, // base production/hr when deployed (before prestige/set/bond multipliers)
    }
    let rows: Vec<ShapeRow> = SHAPES
        .iter()
        .enumerate()
        .map(|(id, s)| ShapeRow {
            id,
            nick: s.nick,
            family: s.family,
            rarity: s.rarity,
            genus: s.genus,
            euler_cost: s.euler_cost,
            orientable: !content::is_nonorientable(s.family),
            forgeable: content::surface_class(s.family).is_some(),
            role: role_for(s.family).as_str(),
            prod: content::effective_prod(id),
        })
        .collect();
    serde_json::to_string(&rows).unwrap()
}

/// The forge recipe table for the web layer.
#[wasm_bindgen]
pub fn recipes_json() -> String {
    #[derive(Serialize)]
    struct RecipeRow {
        a: usize,
        b: usize,
        out: usize,
        a_nick: &'static str,
        b_nick: &'static str,
        out_nick: &'static str,
    }
    let rows: Vec<RecipeRow> = content::RECIPES
        .iter()
        .map(|r| RecipeRow {
            a: r.a,
            b: r.b,
            out: r.out,
            a_nick: SHAPES[r.a].nick,
            b_nick: SHAPES[r.b].nick,
            out_nick: SHAPES[r.out].nick,
        })
        .collect();
    serde_json::to_string(&rows).unwrap()
}

/// The Workshop upgrade table for the web layer (static defs; current levels come from the view).
#[wasm_bindgen]
pub fn upgrades_json() -> String {
    #[derive(Serialize)]
    struct UpgradeRow {
        key: &'static str,
        flux_cost: f64,
        shard_cost: u64,
        max_level: u32,
        requires: Option<(usize, u32)>,
        secret: bool,
    }
    let rows: Vec<UpgradeRow> = content::UPGRADES
        .iter()
        .map(|u| UpgradeRow {
            key: u.key,
            flux_cost: u.flux_cost,
            shard_cost: u.shard_cost,
            max_level: u.max_level,
            requires: u.requires,
            secret: u.secret,
        })
        .collect();
    serde_json::to_string(&rows).unwrap()
}

/// The milestone table for the web layer (key + permanent bonus).
#[wasm_bindgen]
pub fn milestones_json() -> String {
    #[derive(Serialize)]
    struct MilestoneRow {
        key: &'static str,
        kind: &'static str, // production | offline | shards | forge | affinity | euler | flux
        value: f64,         // magnitude in the effect's natural unit (fraction; or hours / count / flux-grant)
    }
    let rows: Vec<MilestoneRow> = content::MILESTONES
        .iter()
        .map(|m| {
            use content::MilestoneEffect::*;
            let (kind, value) = match m.effect {
                Production(f) => ("production", f),
                Offline(h) => ("offline", h),
                Shards(f) => ("shards", f),
                Forge(f) => ("forge", f),
                Affinity(f) => ("affinity", f),
                Euler(n) => ("euler", n as f64),
                Flux(f) => ("flux", f * content::FLUX_DENSITY), // the real granted amount (display matches the player's flux)
            };
            MilestoneRow {
                key: m.key,
                kind,
                value,
            }
        })
        .collect();
    serde_json::to_string(&rows).unwrap()
}

/// The Facet-perk table for the web layer (key + base cost + max level).
#[wasm_bindgen]
pub fn facets_json() -> String {
    #[derive(Serialize)]
    struct FacetRow {
        key: &'static str,
        cost: u64,
        max_level: u32,
    }
    let rows: Vec<FacetRow> = content::FACET_PERKS
        .iter()
        .map(|f| FacetRow {
            key: f.key,
            cost: f.cost,
            max_level: f.max_level,
        })
        .collect();
    serde_json::to_string(&rows).unwrap()
}

/// The gacha banner table for the web layer (key + featured shape ids + whether it rotates).
#[wasm_bindgen]
pub fn banners_json() -> String {
    #[derive(Serialize)]
    struct BannerRow {
        key: &'static str,
        featured: Vec<usize>,
        rotating: bool,
    }
    let rows: Vec<BannerRow> = content::BANNERS
        .iter()
        .map(|b| BannerRow {
            key: b.key,
            featured: b.featured.to_vec(),
            rotating: b.rotating,
        })
        .collect();
    serde_json::to_string(&rows).unwrap()
}

/// The static Expeditions content for the web layer: quests, enemies, and perks (live state is in the view).
#[wasm_bindgen]
pub fn expeditions_json() -> String {
    #[derive(Serialize)]
    struct QuestRow {
        key: &'static str,
        nick: &'static str,
        chapter: u32,
        min_dim: u32,
        tier: u32,
        power_req: i64,
        base_echo: u64,
        enemy_nicks: Vec<&'static str>,
        boss_nick: Option<&'static str>,
        recruit_id: i32,
        recruit_nick: Option<&'static str>,
        dom_element: &'static str,
        kind: &'static str,        // v5: "combat" | "elite" | "boss"
        map_xy: (i16, i16),        // v5: authored node-graph layout
        in_edges: Vec<usize>,      // v5: node indices that gate this one
        out_edges: Vec<usize>,     // v5: nodes this one unlocks
    }
    #[derive(Serialize)]
    struct PerkRow {
        key: &'static str,
        base_cost: u64,
        max_level: u32,
    }
    #[derive(Serialize)]
    struct ProvisionRow {
        key: &'static str,
        cost: u64,
        eff: &'static str, // EffKind tag for the UI (names/descs come from i18n)
        val: i64,
    }
    #[derive(Serialize)]
    struct RelicRow {
        key: &'static str,
        cost: u64,
        up: &'static str,
        up_val: i64,
        down: &'static str,
        down_val: i64,
        slots: u32,
    }
    #[derive(Serialize)]
    struct NodeModRow {
        key: &'static str,
        enemy_scale_pct: i64,
        first_clear_mult_pct: i64,
    }
    #[derive(Serialize)]
    struct SkillNodeRow {
        key: &'static str,
        max: u32,
        req: Option<(usize, u32)>, // (prereq node index, min rank), or null
        stat: i64,
        farm: i64,
    }
    #[derive(Serialize)]
    struct ExpContent {
        quests: Vec<QuestRow>,
        perks: Vec<PerkRow>,
        edges: Vec<(usize, usize)>, // v5: the journey-graph edge list (from, to)
        provisions: Vec<ProvisionRow>,
        relics: Vec<RelicRow>,
        node_mods: Vec<NodeModRow>,
        skill_trees: Vec<Vec<SkillNodeRow>>, // R6: codegen the skill tree so the TS mirror can't drift
    }
    let quests = QUESTS
        .iter()
        .enumerate()
        .map(|(qi, q)| QuestRow {
            key: q.key,
            nick: q.nick,
            chapter: q.chapter,
            min_dim: q.min_dim,
            tier: q.tier,
            power_req: expedition::quest_power_req(q),
            base_echo: q.base_echo,
            enemy_nicks: q.enemies.iter().map(|&e| expedition::ENEMIES[e].nick).collect(),
            boss_nick: q.boss.map(|b| expedition::ENEMIES[b].nick),
            recruit_id: q.recruit_id,
            recruit_nick: if q.recruit_id >= 0 { Some(SHAPES[q.recruit_id as usize].nick) } else { None },
            dom_element: expedition::quest_dominant_element(q).as_str(),
            kind: q.kind.as_str(),
            map_xy: q.map_xy,
            in_edges: expedition::EDGES.iter().filter(|e| e.to == qi).map(|e| e.from).collect(),
            out_edges: expedition::EDGES.iter().filter(|e| e.from == qi).map(|e| e.to).collect(),
        })
        .collect();
    let perks = expedition::EXP_PERKS
        .iter()
        .map(|p| PerkRow { key: p.key, base_cost: p.cost, max_level: p.max_level })
        .collect();
    let edges = expedition::EDGES.iter().map(|e| (e.from, e.to)).collect();
    let provisions = expedition::PROVISIONS
        .iter()
        .map(|p| {
            let (eff, val) = p.eff.tag();
            ProvisionRow { key: p.key, cost: p.cost, eff, val }
        })
        .collect();
    let relics = expedition::RELICS
        .iter()
        .map(|r| {
            let (up, up_val) = r.up.tag();
            let (down, down_val) = r.down.tag();
            RelicRow { key: r.key, cost: r.cost, up, up_val, down, down_val, slots: expedition::RELIC_SLOTS_PER_TEAM as u32 }
        })
        .collect();
    let node_mods = expedition::NODE_MODS
        .iter()
        .map(|m| NodeModRow { key: m.key, enemy_scale_pct: m.enemy_scale_pct, first_clear_mult_pct: m.first_clear_mult_pct })
        .collect();
    let skill_trees = expedition::SKILL_TREES
        .iter()
        .map(|tree| tree.iter().map(|n| SkillNodeRow { key: n.key, max: n.max, req: n.requires, stat: n.stat_pct, farm: n.farm_pct }).collect())
        .collect();
    serde_json::to_string(&ExpContent { quests, perks, edges, provisions, relics, node_mods, skill_trees }).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: f64 = 3_600_000.0;

    #[test]
    fn offline_is_closed_form_and_capped() {
        let mut g = GameState::new(1, 0.0);
        g.flux = 1000.0;
        g.auto_arrange(); // empty collection → empty loadout → base idle rate
        let rate = g.rate_per_hr();
        // 6 hours away
        let r6 = g.compute_offline(6.0 * HOUR);
        assert!((r6.gained_flux - rate * 6.0).abs() < 1e-6);
        // 100 hours away → capped at the offline cap (24h)
        let mut g2 = GameState::new(1, 0.0);
        let r100 = g2.compute_offline(100.0 * HOUR);
        assert_eq!(r100.capped_ms, OFFLINE_CAP_MS);
        assert!((r100.gained_flux - g2.rate_per_hr() * 24.0).abs() < 1e-6);
    }

    #[test]
    fn every_emitter_period_is_bounded() {
        // Every shape's emission period is in the allowed set ⇒ any board's lcm ≤ L_CAP (offline stays O(1)).
        for (id, def) in SHAPES.iter().enumerate() {
            let per = content::emit_period(def);
            assert!(orrery::ALLOWED_PERIODS.contains(&per), "shape {id} emits with period {per}");
        }
    }

    #[test]
    fn ballast_amplify_and_lens_polish_boost() {
        // A deployed closed ballast (Pip the sphere, id 0) gets the FLAT Amplify verb (Common 5_000 µ rung), and
        // lens_polish (#9) boosts that flat add by +8%/level exactly as it boosts Multiply lenses (universal polish).
        let mut g = GameState::new(7, 0.0);
        g.owned[0] = 1;
        g.auto_arrange();
        g.use_orrery = true;
        let add_of = |g: &GameState| {
            g.flux_board()
                .emitters
                .iter()
                .find_map(|e| match e.act {
                    crate::flux::Act::Amplify { add } => Some(add),
                    _ => None,
                })
                .expect("the sphere ballast emits an Amplify verb")
        };
        assert_eq!(add_of(&g), 5_000); // base (no lens)
        g.upgrades[9] = 1; // lens_polish level 1
        assert_eq!(add_of(&g), 5_000 * 108 / 100); // +8% → 5_400, integer (×before÷)
    }

    #[test]
    fn orrery_offline_is_o1_and_stable() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..6 {
            g.owned[id] = 1;
        }
        g.auto_arrange();
        g.use_orrery = true;
        g.last_seen_ms = 0.0;
        assert!(!g.loadout.is_empty() && g.rate_per_hr() > 0.0);

        // seconds span (uncapped): bit-stable + positive (computed via the closed form, no loop).
        let r1 = g.clone().compute_offline(90_000.0);
        let r2 = g.clone().compute_offline(90_000.0);
        assert_eq!(r1.gained_flux.to_bits(), r2.gained_flux.to_bits());
        assert!(r1.gained_flux > 0.0);

        // weeks span: instant (no per-tick loop), capped at the offline cap, and within the rate ceiling.
        let rw = g.clone().compute_offline(14.0 * 24.0 * HOUR);
        assert_eq!(rw.capped_ms, OFFLINE_CAP_MS);
        assert!(rw.gained_flux.is_finite() && rw.gained_flux > r1.gained_flux);
        let ceiling = g.cap_rate() * g.globals_mult() * 24.0;
        assert!(rw.gained_flux <= ceiling + 1e-6);
    }

    #[test]
    fn orrery_flag_off_is_byte_identical_and_deterministic() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..6 {
            g.owned[id] = 1;
        }
        g.auto_arrange();
        g.use_orrery = false; // capture the static-path rate explicitly (don't lean on the engine default)
        let static_rate = g.rate_per_hr();
        g.use_orrery = true;
        let orrery_rate = g.rate_per_hr();
        assert!(orrery_rate > 0.0);
        g.use_orrery = false;
        assert_eq!(g.rate_per_hr().to_bits(), static_rate.to_bits()); // flag off ⇒ unchanged
        // the flux rate is deterministic (bit-stable across calls)
        g.use_orrery = true;
        assert_eq!(g.rate_per_hr().to_bits(), g.rate_per_hr().to_bits());
    }

    #[test]
    fn flux_tuning_keeps_offline_o1_and_resets_clean() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..6 {
            g.owned[id] = 1;
        }
        g.auto_arrange();
        g.use_orrery = true;
        g.ensure_anchors(); // materialise the placement facings
        g.last_seen_ms = 0.0;
        let base = g.clone().compute_offline(90_000.0);

        // tune the first deployed shape: rotate its facing + re-phase (NOT the placement cell)
        let id = g.loadout[0];
        g.cycle_axis(id);
        g.set_lane_phase(id, 1);

        // offline still bit-stable across calls, seconds AND weeks (closed form, no per-tick loop)
        let s1 = g.clone().compute_offline(90_000.0);
        let s2 = g.clone().compute_offline(90_000.0);
        assert_eq!(s1.gained_flux.to_bits(), s2.gained_flux.to_bits());
        let weeks = g.clone().compute_offline(14.0 * 24.0 * 3_600_000.0);
        assert_eq!(weeks.capped_ms, OFFLINE_CAP_MS);
        assert!(weeks.gained_flux.is_finite() && weeks.gained_flux > 0.0);

        // reset facing+phase → bit-identical to the pre-tune default
        g.reset_lane(id);
        let after = g.clone().compute_offline(90_000.0);
        assert_eq!(after.gained_flux.to_bits(), base.gained_flux.to_bits());
    }

    #[test]
    fn orrery_anchors_unique_and_swap() {
        let mut g = GameState::new(5, 0.0);
        for id in 0..6 {
            g.owned[id] = 1;
        }
        g.use_orrery = true;
        g.auto_arrange();
        g.ensure_anchors();
        // every deployed shape has a distinct anchor
        let anchors: Vec<(i8, i8)> = g.orbit_tune.values().map(|t| (t.q, t.r)).collect();
        let uniq: std::collections::HashSet<(i8, i8)> = anchors.iter().copied().collect();
        assert_eq!(anchors.len(), uniq.len(), "anchors must be unique");
        // drag A onto B's cell → they swap (still unique)
        let (a, b) = (g.loadout[0], g.loadout[1]);
        let a_old = {
            let t = &g.orbit_tune[&(a as u16)];
            (t.q, t.r)
        };
        let b_old = {
            let t = &g.orbit_tune[&(b as u16)];
            (t.q, t.r)
        };
        assert!(g.move_anchor(a, b_old.0 as i32, b_old.1 as i32));
        assert_eq!(
            {
                let t = &g.orbit_tune[&(a as u16)];
                (t.q, t.r)
            },
            b_old
        );
        assert_eq!(
            {
                let t = &g.orbit_tune[&(b as u16)];
                (t.q, t.r)
            },
            a_old
        );
        let uniq2: std::collections::HashSet<(i8, i8)> =
            g.orbit_tune.values().map(|t| (t.q, t.r)).collect();
        assert_eq!(uniq2.len(), g.orbit_tune.len());
    }

    #[test]
    fn orrery_oldsave_without_tune_field_loads() {
        // A pre-orbit_tune save must still deserialize (serde default → empty map).
        let g = GameState::new(9, 0.0);
        let mut json: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&g).unwrap()).unwrap();
        json.as_object_mut().unwrap().remove("orbit_tune");
        let restored: GameState = serde_json::from_value(json).unwrap();
        assert!(restored.orbit_tune.is_empty());
    }

    #[test]
    fn starter_shape_and_tap_bootstrap() {
        let mut g = GameState::new(1, 0.0);
        assert_eq!(g.owned[STARTER_SHAPE], 1); // begins owning one common
        assert_eq!(g.distinct_owned(), 1);
        let f0 = g.flux;
        let r = g.tap_shape(STARTER_SHAPE);
        assert!(r > 0.0 && (g.flux - f0 - r).abs() < 1e-9); // grants the returned Flux
        assert_eq!(g.tap_shape(COUNT + 5), 0.0); // out of range → nothing
        assert_eq!(g.tap_shape(40), 0.0); // unowned shape → nothing
    }

    #[test]
    fn pull_costs_flux_and_grants_a_shape() {
        let mut g = GameState::new(42, 0.0);
        g.flux = 250.0 * content::FLUX_DENSITY;
        let before: u32 = g.owned.iter().sum();
        let out = g.pull(0.0);
        assert!(out.ok);
        assert!(out.shape_id >= 0);
        assert!((g.flux - 150.0 * content::FLUX_DENSITY).abs() < 1e-3); // (250 − 100), density-scaled
        assert_eq!(g.owned.iter().sum::<u32>(), before + 1); // pull granted exactly one copy
                                                             // can't pull when broke
        g.flux = 50.0 * content::FLUX_DENSITY;
        assert!(!g.pull(0.0).ok);
    }

    #[test]
    fn pulls_are_deterministic_for_a_seed() {
        let seq = |seed| {
            let mut g = GameState::new(seed, 0.0);
            g.flux = 1_000_000.0;
            (0..50).map(|_| g.pull(0.0).shape_id).collect::<Vec<_>>()
        };
        assert_eq!(seq(7), seq(7));
        assert_ne!(seq(7), seq(8));
    }

    #[test]
    fn deploy_respects_euler_budget() {
        let mut g = GameState::new(1, 0.0);
        g.owned[26] = 1; // Hept, euler_cost 14 (> cap 6)
        g.owned[0] = 1; // Pip, cost 0
        assert!(g.deploy(0), "free ballast should always deploy");
        assert!(
            !g.deploy(26),
            "heptoroid (cost 14) must exceed the cap-6 budget"
        );
        assert_eq!(g.euler_used(), 0);
    }

    #[test]
    fn auto_arrange_stays_within_budget() {
        let mut g = GameState::new(1, 0.0);
        for i in 0..COUNT {
            g.owned[i] = 1; // own everything
        }
        g.auto_arrange();
        assert!(
            g.euler_used() <= g.euler_cap,
            "auto-arrange overspent the budget"
        );
        // the WORKSHOP-bought floor caps placement: never seat more shapes than the floor has cells
        assert_eq!(g.loadout.len(), g.floor_cells());
        // at the starting (radius-1) floor it fills with the free commons first (they cost 0 Euler)
        assert_eq!(g.euler_used(), 0);
        assert!(g.loadout.iter().all(|&i| i < 10), "auto should fill the small floor with free commons");
    }

    #[test]
    fn save_round_trips() {
        let mut g = GameState::new(12345, 1000.0);
        g.flux = 4242.0;
        g.owned[0] = 2;
        g.owned[33] = 1;
        g.deploy(0);
        let json = g.to_json();
        let back = GameState::from_json(&json).expect("loads");
        assert_eq!(back.master_seed, 12345);
        assert!((back.flux - 4242.0).abs() < 1e-9);
        assert_eq!(back.owned[0], 2);
        assert_eq!(back.loadout, vec![0]);
    }

    #[test]
    fn rejects_newer_schema() {
        let mut g = GameState::new(1, 0.0);
        g.schema_version = 999;
        let json = g.to_json();
        assert!(GameState::from_json(&json).is_err());
    }

    // App-update guarantee: a save written by an OLDER build (fewer shapes/upgrades/etc.) must still load —
    // from_json resizes every per-content vec to the current counts. Simulate that by truncating the arrays.
    #[test]
    fn loads_save_from_a_smaller_older_build() {
        let mut g = GameState::new(7, 0.0);
        g.flux = 999.0;
        g.owned[0] = 3;
        let mut v: serde_json::Value = serde_json::from_str(&g.to_json()).unwrap();
        // emulate a pre-content-addition save: shorter arrays + a known shape owned at the front
        v["owned"] = serde_json::json!([3, 1, 0]);
        v["bonds"] = serde_json::json!([5, 0]);
        v["upgrades"] = serde_json::json!([1]);
        v["milestones_done"] = serde_json::json!([true]);
        v["facet_perks"] = serde_json::json!([]);
        v["discovered"] = serde_json::json!([]);
        let back = GameState::from_json(&v.to_string()).expect("older save still loads");
        assert_eq!(back.owned.len(), COUNT);
        assert_eq!(back.bonds.len(), COUNT);
        assert_eq!(back.upgrades.len(), content::UPGRADE_COUNT);
        assert_eq!(back.milestones_done.len(), content::MILESTONE_COUNT);
        assert_eq!(back.facet_perks.len(), content::FACET_PERK_COUNT);
        assert_eq!(back.discovered.len(), content::RECIPES.len());
        assert_eq!(back.owned[0], 3); // preserved
        assert_eq!(back.bonds[0], 5);
        assert!((back.flux - 999.0).abs() < 1e-9);
    }

    #[test]
    fn recrystallize_requires_core_complete_then_ascends() {
        let mut g = GameState::new(1, 0.0);
        assert!(
            !g.recrystallize(),
            "can't ascend before completing the core"
        );
        for i in 0..COUNT {
            g.owned[i] = 1;
        }
        assert!(g.recrystallize());
        assert_eq!(g.viewport_dim, 4);
        assert_eq!(g.ng_cycle, 1);
        assert!((g.prestige_mult - 1.6).abs() < 1e-9);
        // collection carries over; run resets
        assert_eq!(g.distinct_owned(), content::PULL_COUNT as u32);
        assert!(g.loadout.is_empty());
    }

    #[test]
    fn metashapes_enter_the_gacha_by_dimension() {
        // Pull a stack at a fixed viewport dimension and tally which metashapes can drop.
        let tally = |dim: u32| {
            let mut g = GameState::new(31337, 0.0);
            g.viewport_dim = dim;
            let (mut meta, mut trans) = (0u32, 0u32);
            for _ in 0..40_000 {
                g.flux = 1.0e12; // always afford the next pull
                match g.pull(0.0).rarity {
                    Some(Rarity::Meta) => meta += 1,
                    Some(Rarity::Transcendent) => trans += 1,
                    _ => {}
                }
            }
            (meta, trans)
        };
        // 3D (launch): metashapes are locked out entirely
        assert_eq!(tally(3), (0, 0), "no metashapes before ascension");
        // 4D (NG+1): Meta drops, Transcendent still locked
        let (m4, t4) = tally(4);
        assert!(m4 > 0, "Meta should drop once 4D");
        assert_eq!(t4, 0, "Transcendent must wait for 5D");
        // 5D (NG+2): both drop
        let (m5, t5) = tally(5);
        assert!(m5 > 0 && t5 > 0, "both metashapes drop at 5D (meta={m5}, trans={t5})");
    }

    #[test]
    fn forge_connected_sum_grants_output_and_flags_discovery() {
        let mut g = GameState::new(1, 0.0);
        g.owned[11] = 2; // Mo (Möbius)
        g.shards = 100;
        let r = g.forge(11, 11); // Mö # Mö = Klein (id 18)
        assert!(r.ok);
        assert_eq!(r.out_id, 18);
        assert!(r.is_discovery);
        assert!(g.owned[18] > 0, "Klein granted");
        assert_eq!(g.shards, 150); // 100 − 50 cost + 100 discovery reward
        let r2 = g.forge(11, 11);
        assert!(r2.ok && !r2.is_discovery, "second craft is not a discovery");
    }

    #[test]
    fn forge_fails_without_owned_or_shards_or_forgeable_pair() {
        let mut g = GameState::new(1, 0.0);
        g.shards = 100;
        assert!(!g.forge(11, 11).ok, "can't forge unowned inputs");
        g.owned[10] = 1;
        g.shards = 10;
        assert!(!g.forge(10, 10).ok, "not enough shards");
        // Non-surfaces never forge, even fully owned & flush.
        g.shards = 100;
        g.owned[16] = 2; // trefoil — a knot, not a surface
        assert!(!g.forge(16, 16).ok, "knots aren't forgeable surfaces");
        g.owned[18] = 2; // Klein # Klein → χ=−2 non-orientable, a shape we don't catalogue
        assert!(!g.forge(18, 18).ok, "no catalogued result ⇒ no forge");
    }

    #[test]
    fn forge_is_free_form_any_surface_pair_that_resolves() {
        // A pair that is NOT in the curated recipe book still forges, because the connected sum is a
        // catalogued shape: Boy's surface # ℝP² are both ℝP² ⇒ Klein bottle (id 18).
        let mut g = GameState::new(1, 0.0);
        g.owned[20] = 1; // Boy's surface
        g.owned[19] = 1; // ℝP²
        g.shards = 100;
        assert!(content::find_recipe(20, 19).is_none(), "this pair is not a curated recipe");
        let r = g.forge(20, 19);
        assert!(r.ok && r.out_id == 18, "Boy's # ℝP² = Klein, off-book");
        // The sphere is the connected-sum identity: torus # sphere = torus (a valid, if humble, forge).
        g.owned[10] = 1;
        assert_eq!(g.preview_forge(10, 0), 10, "T² # S² previews as T²");
    }

    // ─────────────────────────── Expeditions ───────────────────────────

    /// Helper: own a spread of early shapes (with dupes for ★) so a real team can clear + farm.
    fn own_early(g: &mut GameState) {
        for id in 0..12 {
            g.owned[id] = 50;
        }
    }

    #[test]
    fn exp_bring_who_you_love() {
        // A ★5 beloved common must out-power a fresh ★0 UR (the cozy "bring who you love" guarantee).
        let mut g = GameState::new(1, 0.0);
        let ur_id = content::rarity_ids(Rarity::Ur)[0];
        let common_id = content::rarity_ids(Rarity::Common)[0];
        g.owned[common_id] = 1 + 9999; // ★5
        g.owned[ur_id] = 1; // ★0
        assert!(g.star_level(common_id) >= 5 && g.star_level(ur_id) == 0);
        assert!(g.exp_power(common_id) > g.exp_power(ur_id));
    }

    #[test]
    fn station_clears_on_first_win_then_farms() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]); // Tetra(dps), Pip(tank), Dodi(support)
        assert_eq!(g.exp_teams[0].len(), 3);
        let (flux0, echoes0) = (g.flux, g.echoes);
        let r = g.station(0, 0); // shallows_1: clears on first win, THEN stations
        assert!(r.ok && r.win && r.newly_cleared, "a balanced trio clears the tutorial quest on station");
        assert!(g.exp_cleared[0] && g.exp_station[0] == 0, "cleared + stationed");
        assert!(g.echoes > echoes0 && g.flux > flux0, "first clear grants Echoes + a Flux windfall");
        assert!(g.echo_rate_per_hr() > 0.0, "the stationed team now farms");
        // every member of the winning team gained XP
        assert!(g.shape_xp[2] > 0 && g.shape_xp[0] > 0 && g.shape_xp[4] > 0);
    }

    #[test]
    fn station_frees_a_boss_shape() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..12 {
            g.owned[id] = 9999; // ★5 → strong enough for the boss
        }
        let donna = 10usize;
        g.owned[donna] = 0; // not owned yet
        g.set_team(0, &[2, 0, 4, 5]);
        g.exp_cleared[2] = true; // open shallows_boss (mainline prereq) so the boss is attemptable
        let r = g.station(0, 3); // shallows_boss → recruit_id 10
        if r.win && r.newly_cleared {
            assert_eq!(r.recruited_id, donna as i32);
            assert!(g.owned[donna] > 0, "boss clear freed the lost shape");
        }
    }

    #[test]
    fn weak_team_loss_is_free_and_does_not_station() {
        let mut g = GameState::new(3, 0.0);
        g.owned[0] = 1;
        g.set_team(0, &[0]); // a lone tank can't beat a boss quest
        g.exp_cleared[6] = true; // open folds_boss (its mainline prereq) so the node is attemptable
        let (flux0, echoes0) = (g.flux, g.echoes);
        let r = g.station(0, 7); // folds_boss
        assert!(r.ok);
        if !r.win {
            assert_eq!(g.echoes, echoes0, "a loss grants no Echoes");
            assert!(!g.exp_cleared[7] && g.exp_station[0] < 0, "a loss neither clears nor stations");
        }
        assert!(g.flux >= flux0, "a station attempt never spends Flux");
    }

    #[test]
    fn echo_farm_online_equals_offline_and_is_o1() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        assert!(g.station(0, 0).win);
        assert!(g.echo_rate_per_hr() > 0.0);
        let prep = |x: &mut GameState| {
            x.echoes = 0;
            x.echo_carry = 0.0;
            x.flux = 0.0;
            x.exp_flux_carry = 0.0;
            x.last_seen_ms = 0.0;
        };
        let mut online = g.clone();
        prep(&mut online);
        let mut t = 0.0;
        while t < 10.0 * HOUR {
            t += 60_000.0;
            online.tick(t);
        }
        let mut offline = g.clone();
        prep(&mut offline);
        offline.compute_offline(10.0 * HOUR);
        assert!((online.echoes as i64 - offline.echoes as i64).abs() <= 1, "echoes online {} vs offline {}", online.echoes, offline.echoes);
        assert!((online.flux - offline.flux).abs() < 1.0, "expedition flux online {} vs offline {}", online.flux, offline.flux);
        // O(1): a 40-day span is instant + finite + positive
        let mut weeks = g.clone();
        let e0 = weeks.echoes;
        weeks.compute_offline(40.0 * 24.0 * HOUR);
        assert!(weeks.echoes > e0);
    }

    #[test]
    fn multiparty_sum_and_auto_expedition() {
        // v6: auto dispatches runs over time; once the reachable chapters are exhausted (a strong team clears them
        // all), the idle team auto-stations on the station-farm floor (D23). Then a second team raises the total.
        let mut g = strong_team(7);
        let mut t = 0.0;
        for _ in 0..400 {
            t += 30_000.0;
            g.auto_expedition(t);
        }
        assert!(g.exp_cleared.iter().filter(|&&c| c).count() >= 2, "auto-runs cleared several nodes");
        assert!(g.active_run.is_none(), "all reachable chapters delved ⇒ no run left to dispatch");
        assert!(g.exp_station.iter().any(|&s| s >= 0), "the idle team falls back to the station-farm floor");
        assert!(g.echo_rate_per_hr() > 0.0);
        // a SECOND stationed team raises the total (multiple parties)
        let before = g.echo_rate_per_hr();
        let t2 = g.add_team();
        g.set_team(t2, &[1, 3]); // Boxy, Spike
        if let Some(other) = (0..QUEST_COUNT).find(|&q| g.exp_cleared[q] && !g.exp_station.contains(&(q as i32))) {
            g.station(t2, other);
            assert!(g.echo_rate_per_hr() > before, "a second stationed team raises total Echoes/hr");
        }
        // total == per-team sum
        let sum: f64 = (0..g.exp_teams.len()).map(|t| g.team_echo_rate(t)).sum();
        assert!((g.echo_rate_per_hr() - sum).abs() < 1e-6);
    }

    #[test]
    fn one_team_per_quest() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        assert!(g.station(0, 0).win); // clears + stations team 0 on quest 0
        let t1 = g.add_team();
        g.set_team(t1, &[1, 3]);
        g.station(t1, 0); // already cleared → stations team 1, bumping team 0
        assert_eq!(g.exp_station[t1], 0);
        assert_eq!(g.exp_station[0], -1, "the prior team is bumped off the quest");
    }

    #[test]
    fn watch_matches_the_stationed_battle_and_none_without_station() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        assert!(g.station(0, 0).win);
        let w = g.watch_data(0, 0).expect("a stationed quest has watch data");
        let again = g.watch_data(0, 0).unwrap();
        assert_eq!(w.win, again.win); // deterministic
        assert_eq!(w.log.len(), again.log.len());
        assert!(g.watch_data(1, 0).is_none(), "no team stationed on quest 1 → no watch");
    }

    #[test]
    fn echo_rate_zero_when_not_stationed() {
        let mut g = GameState::new(1, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        assert_eq!(g.echo_rate_per_hr(), 0.0, "no farm until stationed");
        assert!(g.station(0, 0).win);
        assert!(g.echo_rate_per_hr() > 0.0);
        g.unstation(0);
        assert_eq!(g.echo_rate_per_hr(), 0.0);
    }

    #[test]
    fn expedition_pays_flux_but_stays_outside_the_core_rate() {
        // v2: expeditions pay Flux (not inert) — but via a SEPARATE additive stream that never enters
        // rate_per_hr/globals_mult/cap. Stationing leaves rate_per_hr byte-identical; Echoes never touch shards/★.
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.auto_arrange();
        g.tick(0.0); // latch milestones for a stable baseline
        let rate_before = g.rate_per_hr();
        g.set_team(0, &[2, 0, 4]);
        assert!(g.station(0, 0).win);
        g.tick(0.0);
        assert_eq!(g.rate_per_hr().to_bits(), rate_before.to_bits(), "core rate_per_hr excludes the expedition Flux stream");
        assert!(g.expedition_flux_per_hr() > 0.0, "but expeditions DO pay Flux via their own stream");
        let (flux0, echoes0, shards0) = (g.flux, g.echoes, g.shards);
        let stars0: u32 = (0..COUNT).map(|i| g.star_level(i)).sum();
        g.compute_offline(10.0 * HOUR);
        assert!(g.flux > flux0 && g.echoes > echoes0, "farming raises Flux + Echoes");
        assert_eq!(g.shards, shards0, "expeditions never grant shards");
        assert_eq!((0..COUNT).map(|i| g.star_level(i)).sum::<u32>(), stars0, "expeditions never change ★");
        // bounded by the cap-share clamp
        assert!(g.expedition_flux_per_hr() <= g.cap_rate() * EXP_FLUX_CAP_SHARE + 1e-6);
    }

    #[test]
    fn shape_level_is_closed_form_with_boundaries() {
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1;
        assert_eq!(g.shape_level(0), 0);
        for l in 1..200u64 {
            let need = GameState::xp_to_reach(l);
            g.shape_xp[0] = need;
            assert_eq!(g.shape_level(0), l, "at xp {} level should be {}", need, l);
            g.shape_xp[0] = need - 1;
            assert_eq!(g.shape_level(0), l - 1, "one below {} should be {}", need, l - 1);
        }
    }

    #[test]
    fn leveling_and_skills_raise_power_and_respec_refunds() {
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1; // Pip — sphere → Tank tree
        let p0 = g.exp_power(0);
        g.shape_xp[0] = GameState::xp_to_reach(10);
        assert_eq!(g.shape_level(0), 10);
        let p10 = g.exp_power(0);
        assert!(p10 > p0, "leveling raises power ({p0} -> {p10})");
        assert_eq!(g.skill_points_free(0), 10);
        assert!(g.spend_skill_point(0, 0)); // node0 'bulwark' (stat)
        assert_eq!(g.skill_points_free(0), 9);
        assert!(g.exp_power(0) > p10, "a stat node raises power");
        assert!(!g.spend_skill_point(0, 1), "node1 'ward' needs node0@2 — prereq not met");
        assert!(g.spend_skill_point(0, 0)); // node0 → rank 2
        assert!(g.spend_skill_point(0, 1), "prereq met → node1 unlocks");
        g.respec(0);
        assert_eq!(g.skill_points_free(0), 10, "respec refunds all points");
    }

    #[test]
    fn exp_stats_view_mirrors_combatant() {
        // Slice 1: the team-card stat array is a faithful MIRROR of exp_combatant — TS reads it, never re-derives.
        let g = GameState::new(42, 0.0);
        let v = g.view();
        assert_eq!(v.exp_stats.len(), v.exp_power.len(), "exp_stats is len COUNT, parallel to exp_power");
        for id in [0usize, 1, 2, 5, 10] {
            let c = g.exp_combatant(id);
            let s = &v.exp_stats[id];
            assert_eq!(
                (s.max_hp, s.atk, s.def, s.speed, s.ult),
                (c.max_hp, c.atk, c.def, c.speed, c.ult_power),
                "exp_stats[{id}] must mirror exp_combatant verbatim"
            );
        }
    }

    #[test]
    fn combat_bias_is_combat_only_and_farm_fenced() {
        // (1) Per-family combat identity — the point of Slice 2.
        assert_eq!(combat_bias("sphere", 0), (100, 100, 0), "a plain sphere is the neutral baseline");
        let (ka, kd, ks) = combat_bias("trefoil", 0);
        assert!(ka > 100 && kd < 100 && ks > 0, "a knot hits harder + faster, guards less");
        assert!(combat_bias("torus", 1).1 > 100, "a handle (genus) adds bulk (def)");
        // (2) The bias actually reaches combat stats: a knot's atk is raised above its plain role split.
        let g = GameState::new(7, 0.0);
        let knot_id = (0..COUNT).find(|&i| content::is_knot(SHAPES[i].family)).expect("a knot shape exists");
        let c = g.exp_combatant(knot_id);
        let p = g.exp_power(knot_id);
        let atkf = match g.exp_role(knot_id) {
            expedition::Role::Tank => 55,
            expedition::Role::Dps => 135,
            expedition::Role::Support => 80,
            expedition::Role::Control => 105,
        };
        assert!(c.atk >= (p * atkf / 100).max(1), "exp_combatant applies the knot's atk bias");
        // (3) FENCE: the farm-rate band reads exp_base_power, which combat_bias never touches.
        assert_eq!(g.party_base_power(&[knot_id]), g.exp_base_power(knot_id), "farm band = exp_base_power, no combat_bias leak");
    }

    #[test]
    fn auto_skill_spends_all_points_respecting_prereqs() {
        // Slice 4: the "otherwise auto unlocked" path — auto_skill spends every free point into a VALID, deterministic build.
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1;
        g.shape_xp[0] = GameState::xp_to_reach(12); // a pile of skill points (1 per level)
        let free = g.skill_points_free(0);
        assert!(free >= 10, "earned a pile of skill points");
        let spent = g.auto_skill(0);
        assert_eq!(spent, free, "auto-build spends every free point");
        assert_eq!(g.skill_points_free(0), 0);
        // every allocated node is within max rank AND has its prereq satisfied (a valid build, never an illegal one)
        let tree = expedition::SKILL_TREES[g.role_idx(0)];
        for (node, &rank) in g.skill_alloc[0].iter().enumerate() {
            if node < tree.len() {
                assert!(rank <= tree[node].max, "node {node} within max rank");
                if rank > 0 {
                    if let Some((req, lvl)) = tree[node].requires {
                        assert!(g.skill_alloc[0][req] >= lvl, "node {node} prereq satisfied");
                    }
                }
            }
        }
        // deterministic: respec + auto again ⇒ identical allocation
        let alloc1 = g.skill_alloc[0].clone();
        g.respec(0);
        g.auto_skill(0);
        assert_eq!(g.skill_alloc[0], alloc1, "auto-build is deterministic");
    }

    #[test]
    fn auto_gambits_writes_the_smart_unlocked_program() {
        // QW-1 + smarter-auto: the "Auto" button fills a slot with the SMART program built from the player's UNLOCKED
        // gambit options (role from the stationed shape), overwriting whatever was there.
        let mut g = strong_team(7);
        g.upgrades[UPG_GAMBIT_T2] = 1; // unlock the deeper tiers so Auto writes the full smart program
        g.upgrades[UPG_GAMBIT_T3] = 1;
        let id = g.exp_teams[0][0];
        let role = g.exp_role(id);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 0, expedition::COND_ALLY_HURT, expedition::ACT_HEAL); // junk first, then Auto overwrites
        g.auto_gambits(0, 0);
        let want = expedition::smart_gambit_program(role, &g.unlocked_gambit_conds(), &g.unlocked_gambit_acts());
        assert_eq!(g.team_orders(0).gambits[0], want, "Auto writes the smart program for the unlocked tier");
        // an empty/out-of-range slot is a safe no-op (no panic)
        g.auto_gambits(0, 99);
    }

    #[test]
    fn auto_gambit_smartness_scales_with_upgrades() {
        // "smarter auto gambit as upgrade": the SAME slot+role yields a RICHER program after buying gambit upgrades.
        let mut g = strong_team(7);
        g.add_gambit(0, 0);
        g.auto_gambits(0, 0);
        let base_len = g.team_orders(0).gambits[0].len();
        g.upgrades[UPG_GAMBIT_T2] = 1;
        g.upgrades[UPG_GAMBIT_T3] = 1;
        g.auto_gambits(0, 0);
        let upgraded_len = g.team_orders(0).gambits[0].len();
        assert!(upgraded_len > base_len, "unlocking gambit logic makes Auto smarter ({base_len} → {upgraded_len} rules)");
    }

    #[test]
    fn team_summary_aggregates_are_correct() {
        // QW-4: the team-selection aggregates are a faithful read of exp_combatant/role/element (TS compares, never recomputes).
        let g = strong_team(7);
        let v = g.view();
        let tv = &v.exp_teams[0];
        let m = &tv.members;
        assert!(!m.is_empty(), "team 0 is populated");
        assert_eq!(tv.role_counts.len(), 4);
        assert_eq!(tv.element_counts.len(), 3);
        assert_eq!(tv.role_counts.iter().sum::<u32>(), m.len() as u32, "every member counted in exactly one role");
        assert_eq!(tv.element_counts.iter().sum::<u32>(), m.len() as u32, "every member counted in exactly one element");
        let (mut hp, mut spd) = (0i64, 0i64);
        for &id in m {
            let c = g.exp_combatant(id);
            hp += c.max_hp;
            spd += c.speed;
        }
        assert_eq!(tv.total_hp, hp, "total_hp == sum of member max_hp");
        assert_eq!(tv.total_speed, spd, "total_speed == sum of member speed");
        assert!(tv.total_atk > 0 && tv.total_def > 0, "aggregates are populated");
    }

    #[test]
    fn stalwart_perk_is_a_farm_fenced_hp_for_atk_tradeoff() {
        // R2: stalwart is a defensive TRADEOFF (+HP / −atk in combat), NEVER a pure buff, and never touches the farm
        // band (exp_base_power) — so the closed-form farm rate is untouched (combat-only, like combat_bias).
        let mut g = GameState::new(7, 0.0);
        let c0 = g.exp_combatant(0);
        let base0 = g.exp_base_power(0); // the farm-rate band reference
        g.exp_perks[expedition::PERK_STALWART] = 3; // max it
        let c1 = g.exp_combatant(0);
        assert!(c1.max_hp > c0.max_hp, "stalwart raises combat max HP ({} -> {})", c0.max_hp, c1.max_hp);
        assert!(c1.atk < c0.atk, "...at the cost of atk — a real tradeoff, not a free buff ({} -> {})", c0.atk, c1.atk);
        assert_eq!(g.exp_base_power(0), base0, "COMBAT-only — never touches exp_base_power (the farm band)");
    }

    #[test]
    fn retribution_prism_grants_the_reflect_quirk() {
        // R7: the mechanic relic's upside IS the Reflect bounce (not a stat), applied to the party via apply_team_effect.
        let r = expedition::RELICS.iter().find(|r| r.key == "retribution_prism").expect("the mechanic relic exists");
        assert!(matches!(r.up, expedition::EffKind::Reflect), "upside is the Reflect mechanic, not a stat-swap");
        assert!(matches!(r.down, expedition::EffKind::FlatDefPct(n) if n < 0), "with a real defense downside");
        let g = GameState::new(7, 0.0);
        let mut c = g.exp_combatant(0);
        apply_team_effect(&mut c, expedition::EffKind::Reflect);
        assert!(c.reflect, "the Reflect effect grants the bounce quirk to a party member");
    }

    #[test]
    fn teamwork_sigil_is_a_cheaper_entry_relic() {
        // BF-2: a sub-600 on-ramp relic with a bulk-up / softer-punch tradeoff (effects handled by apply_team_effect).
        let r = expedition::RELICS.iter().find(|r| r.key == "teamwork_sigil").expect("the entry relic exists");
        assert!(r.cost < 600, "cheaper than the 600-Echo relics ({})", r.cost);
        assert!(
            matches!(r.up, expedition::EffKind::HpBoost(_)) && matches!(r.down, expedition::EffKind::FlatDmgPct(n) if n < 0),
            "bulk-up upside with a real damage downside"
        );
    }


    #[test]
    fn farm_xp_online_equals_offline() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        assert!(g.station(0, 0).win);
        let prep = |x: &mut GameState| {
            for v in x.shape_xp.iter_mut() {
                *v = 0;
            }
            for c in x.shape_xp_carry.iter_mut() {
                *c = 0.0;
            }
            x.last_seen_ms = 0.0;
        };
        let mut online = g.clone();
        prep(&mut online);
        let mut t = 0.0;
        while t < 10.0 * HOUR {
            t += 60_000.0;
            online.tick(t);
        }
        let mut offline = g.clone();
        prep(&mut offline);
        offline.compute_offline(10.0 * HOUR);
        assert_eq!(online.shape_xp[2], offline.shape_xp[2], "per-shape farm XP is bit-stable online == offline");
        assert!(online.shape_xp[2] > 0, "stationed members earn farm XP");
    }

    #[test]
    fn v5_save_round_trips_with_team_and_xp_state() {
        let mut g = GameState::new(12345, 1000.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.station(0, 0);
        g.dev_add_echoes(500);
        g.buy_exp_perk(1);
        g.shape_xp[0] = 1234;
        g.spend_skill_point(0, 0);
        let json = g.to_json();
        let back = GameState::from_json(&json).expect("v5 loads");
        assert_eq!(back.schema_version, 6);
        assert_eq!(back.exp_teams, g.exp_teams);
        assert_eq!(back.exp_station, g.exp_station);
        assert_eq!(back.echoes, g.echoes);
        assert_eq!(back.shape_xp[0], 1234);
        assert_eq!(back.skill_alloc[0][0], 1);
        // v5 vecs all parallel + correctly sized
        let nt = back.exp_teams.len();
        assert_eq!(back.exp_orders.len(), nt);
        assert_eq!(back.exp_provisions.len(), nt);
        assert_eq!(back.team_relics.len(), nt);
        assert_eq!(back.exp_node_mod.len(), QUEST_COUNT);
        assert_eq!(back.prov_inv.len(), expedition::PROVISION_COUNT);
        assert_eq!(back.relics_owned.len(), expedition::RELIC_COUNT);
        assert_eq!(back.exp_orders[0], Orders::default());
    }

    #[test]
    fn v4_save_without_v5_fields_loads_to_v5_all_default() {
        // A v4 save (no v5 fields) must migrate to v5 with every new vec sized + all-default, and produce a
        // BIT-IDENTICAL offline report (the v5 additions are inert until used). Pins the v4→v5 migration.
        let mut g = GameState::new(777, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.station(0, 0); // clear + farm quest 0 so there's live state to migrate
        let mut v: serde_json::Value = serde_json::from_str(&g.to_json()).unwrap();
        let obj = v.as_object_mut().unwrap();
        obj.insert("schema_version".into(), serde_json::json!(4));
        for k in ["exp_node_mod", "exp_orders", "prov_inv", "exp_provisions", "relics_owned", "team_relics", "exp_auto", "exp_clears_total", "exp_bosses_freed", "exp_echoes_farmed", "exp_flux_farmed", "exp_runs"] {
            obj.remove(k);
        }
        let mut back = GameState::from_json(&v.to_string()).expect("v4 save migrates to v5");
        assert_eq!(back.schema_version, 6);
        let nt = back.exp_teams.len();
        assert_eq!(back.exp_orders.len(), nt);
        assert_eq!(back.exp_provisions.len(), nt);
        assert_eq!(back.team_relics.len(), nt);
        assert_eq!(back.exp_node_mod.len(), QUEST_COUNT);
        assert!(back.exp_orders.iter().all(|o| *o == Orders::default()));
        assert!(back.exp_node_mod.iter().all(|&m| m == 0));
        assert!(back.exp_auto && back.exp_runs.is_empty(), "Auto is ON by default (absent field ⇒ true)");
        assert!(back.exp_clears_total >= 1, "History counters backfill from already-cleared nodes on v4→v5");
        // inert: the migrated v5 state farms identically to the original v5 state
        let mut orig = g.clone();
        let a = back.compute_offline(5.0 * HOUR);
        let b = orig.compute_offline(5.0 * HOUR);
        assert_eq!(a.gained_echoes, b.gained_echoes);
        assert_eq!(a.gained_flux.to_bits(), b.gained_flux.to_bits());
    }

    #[test]
    fn clear_seed_is_farm_seed_when_inert() {
        let mut g = GameState::new(42, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        // default orders, mod 0, no provisions, no relics ⇒ clear_seed == farm_seed (bit-identical to v4)
        for q in 0..QUEST_COUNT {
            assert_eq!(g.clear_seed(0, q), g.farm_seed(0, q), "inert clear seed must equal farm seed for node {q}");
        }
        // any non-default input diverges the CLEAR seed (different fight) but never the FARM seed
        g.exp_orders[0].doctrine = 1;
        assert_ne!(g.clear_seed(0, 0), g.farm_seed(0, 0));
        g.exp_orders[0] = Orders::default();
        g.exp_node_mod[0] = 1;
        assert_ne!(g.clear_seed(0, 0), g.farm_seed(0, 0));
    }

    #[test]
    fn add_then_remove_gambit_stays_inert() {
        // Regression: add+remove a gambit rule leaves the program canonical-empty ⇒ clear_seed stays == farm_seed
        // (the inert short-circuit must keep firing; the orphaned [[]] previously diverged the clear seed).
        let mut g = GameState::new(42, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        let base = g.clear_seed(0, 0);
        assert_eq!(base, g.farm_seed(0, 0));
        g.add_gambit(0, 0);
        assert_ne!(g.clear_seed(0, 0), g.farm_seed(0, 0), "a real rule diverges the clear seed");
        g.remove_gambit(0, 0, 0); // → canonical-empty
        assert!(g.exp_orders[0].gambits.is_empty(), "all-empty gambits canonicalize to Vec::new()");
        assert_eq!(g.clear_seed(0, 0), g.farm_seed(0, 0), "back to inert ⇒ clear seed == farm seed");
        // also a high-slot add then remove (leaves [[],[]] pre-canon)
        g.add_gambit(0, 1);
        g.remove_gambit(0, 1, 0);
        assert_eq!(g.clear_seed(0, 0), g.farm_seed(0, 0), "high-slot add+remove also stays inert");
    }

    #[test]
    fn gambits_bind_to_surviving_members_under_filter() {
        // The gambit program must follow each SURVIVING hero, not its post-filter index. With team [2,0,4] and
        // member 0 unowned, the survivors are 2 (raw slot 0) and 4 (raw slot 2) — so build_team_gambits must
        // return [program-of-slot-0, program-of-slot-2], dropping slot 1's, never shifting 4 onto slot-1's program.
        let mut g = GameState::new(1, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 0, expedition::COND_ALWAYS, expedition::ACT_ATTACK_WEAKEST);
        g.add_gambit(0, 2);
        g.set_gambit_rule(0, 2, 0, expedition::COND_ALWAYS, expedition::ACT_ATTACK_THREAT);
        g.owned[0] = 0; // member in slot 1 becomes unowned ⇒ filtered out of the party
        let o = g.exp_orders[0].clone();
        let progs = g.build_team_gambits(0, &o, g.auto_tactics_unlocked());
        assert_eq!(progs.len(), 2, "two surviving members ⇒ two programs");
        assert_eq!(progs[0][0].action, expedition::ACT_ATTACK_WEAKEST, "survivor 2 keeps slot-0's program");
        assert_eq!(progs[1][0].action, expedition::ACT_ATTACK_THREAT, "survivor 4 keeps slot-2's program (not slot-1's)");
    }

    #[test]
    fn auto_tactics_flips_empty_slot_behaviour() {
        // Empty slots: auto LOCKED → the simple instinct program is materialised; auto UNLOCKED → the slot stays
        // empty so hero_turn runs the smart legacy_ladder. The flag tracks Workshop upgrade #21.
        let mut g = strong_team(7);
        let o = g.team_orders(0);
        assert!(!g.build_team_gambits(0, &o, false)[0].is_empty(), "auto locked ⇒ the empty slot gets the simple program");
        assert!(g.build_team_gambits(0, &o, true)[0].is_empty(), "auto unlocked ⇒ the empty slot stays empty (legacy_ladder)");
        assert!(!g.auto_tactics_unlocked());
        g.upgrades[UPG_AUTO_TACTICS] = 1;
        assert!(g.auto_tactics_unlocked());
    }

    #[test]
    fn auto_tactics_never_changes_the_farm_rate() {
        // THE D4 FENCE tripwire: the whole gambit progression changes CLEAR behaviour but NEVER the closed-form
        // FARM rate (it bands on base power, gambit-blind) — so online==offline holds with any unlock state.
        let mut g = strong_team(7);
        g.station(0, 0);
        let before = g.echo_rate_per_hr();
        g.upgrades[UPG_AUTO_TACTICS] = 1;
        g.upgrades[UPG_GAMBIT_T2] = 1;
        g.upgrades[UPG_GAMBIT_T3] = 1;
        assert_eq!(before, g.echo_rate_per_hr(), "the gambit progression never touches the farm rate");
    }

    #[test]
    fn locked_gambit_option_goes_inert_not_fired() {
        // A player-authored rule using a LOCKED action (ATTACK_THREAT needs tier-2) is turned OFF for the battle
        // (never fires, never panics); buying the tier restores it; the authored Orders is never mutated.
        let mut g = strong_team(7);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 0, expedition::COND_ALWAYS, expedition::ACT_ATTACK_THREAT);
        let o = g.team_orders(0);
        assert!(!g.build_team_gambits(0, &o, false)[0][0].on, "ATTACK_THREAT locked (no tier-2) ⇒ the rule is inert");
        g.upgrades[UPG_GAMBIT_T2] = 1;
        let o2 = g.team_orders(0);
        assert!(g.build_team_gambits(0, &o2, false)[0][0].on, "buying tier-2 restores the rule");
        assert!(g.team_orders(0).gambits[0][0].on, "the authored rule stays ON (only the battle copy went inert)");
    }

    #[test]
    fn reorder_gambit_is_a_permutation() {
        // Drag/drop reorder moves a rule to a new index — same rules, new order (a different priority = a different fight).
        let mut g = strong_team(7);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 0, expedition::COND_ALWAYS, expedition::ACT_ATTACK_FOCUS);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 1, expedition::COND_ALLY_HURT, expedition::ACT_HEAL);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 2, expedition::COND_SELF_HURT, expedition::ACT_GUARD);
        g.reorder_gambit(0, 0, 2, 0); // drag the 3rd rule to the front
        let rules = g.team_orders(0).gambits[0].clone();
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0].action, expedition::ACT_GUARD, "the moved rule is now first");
        assert_eq!(rules[1].action, expedition::ACT_ATTACK_FOCUS);
        assert_eq!(rules[2].action, expedition::ACT_HEAL);
    }

    // ── v6 "The Delve": run schedule determinism + O(1) online==offline + save-scum + coexistence ──
    fn strong_team(seed: u64) -> GameState {
        let mut g = GameState::new(seed, 0.0);
        for id in 0..12 {
            g.owned[id] = 9999; // a party strong enough to delve the early chapters
        }
        g.set_team(0, &[2, 0, 4]);
        g
    }

    fn weak_team(seed: u64) -> GameState {
        let mut g = GameState::new(seed, 0.0);
        g.owned[0] = 1; // a single feeble shape — wipes on a boss
        g.set_team(0, &[0]);
        g
    }

    // ── R1: v6 multi-room delve INTEGRATION coverage (golden scenarios, not just determinism) ──

    #[test]
    fn multi_room_run_completes_consistently() {
        // A strong team's full multi-room run: completes (no wipe), banks positive loot, and the frozen prefix arrays
        // are length-consistent + monotonic (the load-bearing invariant for O(1) offline banking).
        let g = strong_team(11);
        let path: Vec<usize> = (0..6).collect();
        let seed = g.clear_seed(0, path[0]);
        let p = g.resolve_run(0, &path, seed);
        assert!(p.death_room.is_none(), "a strong team completes the run");
        let n = p.prefix_ms.len();
        assert!(n >= path.len(), "≥ one room per node");
        assert!(p.prefix_echoes.len() == n && p.prefix_flux.len() == n && p.room_kind.len() == n && p.room_node.len() == n, "all schedule arrays are length-consistent");
        assert!(*p.prefix_echoes.last().unwrap() > 0 && *p.prefix_flux.last().unwrap() > 0, "banks loot");
        assert!(p.prefix_echoes.windows(2).all(|w| w[1] >= w[0]), "echoes cumulative non-decreasing");
        assert!(p.prefix_flux.windows(2).all(|w| w[1] >= w[0]), "flux cumulative non-decreasing");
        assert!(p.prefix_ms.windows(2).all(|w| w[1] >= w[0]), "time cumulative non-decreasing");
        assert!((p.total_ms - *p.prefix_ms.last().unwrap()).abs() < 1e-6, "total_ms == last prefix_ms");
    }

    #[test]
    fn multi_room_run_wipe_truncates_schedule_and_keeps_partial_loot() {
        // A feeble party that wipes: death_room is set, the schedule TRUNCATES at it (no future rooms leak), and any
        // loot banked before the wipe is retained (loss is free, partial loot kept).
        let g = weak_team(7);
        let path: Vec<usize> = vec![7]; // folds_boss — unbeatable for a lone level-0 shape
        let seed = g.clear_seed(0, path[0]);
        let p = g.resolve_run(0, &path, seed);
        assert!(p.death_room.is_some(), "a feeble party wipes");
        let d = p.death_room.unwrap();
        assert_eq!(p.prefix_ms.len(), d + 1, "the schedule ends exactly at the death room — no future-room leak");
        assert_eq!(p.room_kind.len(), p.prefix_ms.len(), "arrays stay consistent through the wipe");
    }

    #[test]
    fn shrine_event_room_interleaves_and_keeps_the_run_consistent() {
        // R5: the new Shrine event room (a no-combat heal + lasting speed boon) interleaves into longer runs, adding
        // room variety without breaking the frozen-schedule invariants.
        let g = strong_team(13);
        let path: Vec<usize> = (0..6).collect(); // long enough to hit the k=3 shrine cadence (on a non-boss node)
        let seed = g.clear_seed(0, path[0]);
        let p = g.resolve_run(0, &path, seed);
        assert!(p.room_kind.contains(&expedition::RoomKind::Shrine.as_u8()), "a Shrine room interleaves into the run");
        assert!(p.death_room.is_none(), "the strong team still completes");
        assert_eq!(p.prefix_ms.len(), p.room_kind.len(), "the new room kind keeps the schedule arrays consistent");
        assert!(p.prefix_ms.windows(2).all(|w| w[1] >= w[0]), "time stays monotonic");
    }

    #[test]
    fn decision_room_interleaves_and_resolves_to_auto_default() {
        // Delve decisions Slice 1: Crossroads rooms interleave, resolved to their AUTO-default (option 0) AT SEND —
        // the schedule stays consistent + monotonic, decisions/decision_choices are 1:1, and every choice is -1
        // (the frozen auto-pick). This is invariant-safe: with all -1, banking is byte-identical to a no-decision run.
        let g = strong_team(21);
        let path: Vec<usize> = (0..6).collect();
        let seed = g.clear_seed(0, path[0]);
        let p = g.resolve_run(0, &path, seed);
        assert!(p.room_kind.contains(&expedition::RoomKind::Decision.as_u8()), "a Crossroads interleaves into the run");
        assert!(!p.decisions.is_empty(), "the decision table is populated at send");
        assert_eq!(p.decisions.len(), p.decision_choices.len(), "one choice slot per decision");
        assert!(p.decision_choices.iter().all(|&c| c == -1), "Slice 1: every decision is the frozen auto-default");
        assert!(p.decisions.iter().all(|d| (2..=3).contains(&d.options.len()) && d.auto_option == 0), "2–3 options, safe default (option 0)");
        assert!(p.decisions.iter().all(|d| d.options[d.auto_option as usize].heal_pct > 0), "the auto-default is always the safe heal");
        assert_eq!(p.prefix_ms.len(), p.room_kind.len(), "schedule arrays stay consistent");
        assert!(p.prefix_ms.windows(2).all(|w| w[1] >= w[0]), "time stays monotonic");
        assert!(p.death_room.is_none(), "a strong team still completes");
        // determinism: same (team, path, seed) ⇒ identical decision tables + choices
        let p2 = g.resolve_run(0, &path, seed);
        assert_eq!(p.decision_choices, p2.decision_choices);
        assert_eq!(p.decisions.len(), p2.decisions.len());
        assert!(p.decisions.iter().zip(&p2.decisions).all(|(a, b)| a.options[1].echo_bonus == b.options[1].echo_bonus));
    }

    // ── Delve decisions Slice 2: the live override (choose_decision) + tail re-resolution ──

    fn first_decision_room(g: &GameState) -> usize {
        g.active_run.as_ref().unwrap().room_kind.iter().position(|&k| k == expedition::RoomKind::Decision.as_u8()).expect("a crossroads exists")
    }

    #[test]
    fn choose_decision_overrides_to_a_loot_option_and_raises_loot() {
        // Overriding a Crossroads to a LOOT-bearing option (echo_bonus > 0) raises total delve loot vs the safe
        // auto-default, and records exactly one override. (With themed 2–3-option crossroads the loot option isn't
        // always index 1, so we find the best-loot option on the first crossroads that offers one.)
        let path: Vec<usize> = (0..6).collect();
        // not every themed crossroads offers loot (the Offering template is all-boon), so scan team seeds for a run
        // that does, then take that crossroads' best-loot option.
        let (mut g, room, opt) = (20u64..90)
            .find_map(|s| {
                let mut g = strong_team(s);
                if !g.send_expedition(0, &path, 0.0) {
                    return None;
                }
                let pick = g.active_run.as_ref().unwrap().decisions.iter().find_map(|d| {
                    d.options.iter().enumerate().filter(|(_, e)| e.echo_bonus > 0).max_by_key(|(_, e)| e.echo_bonus).map(|(i, _)| (d.room_idx, i as u8))
                });
                pick.map(|(room, opt)| (g, room, opt))
            })
            .expect("some team seed yields a run with a loot crossroads");
        let auto_total = g.active_run.as_ref().unwrap().prefix_echoes.last().copied().unwrap();
        assert!(g.choose_decision(room, opt, 0.0), "the crossroads is overridable before it's reached");
        let run = g.active_run.as_ref().unwrap();
        assert_eq!(run.decision_choices.iter().filter(|&&c| c >= 0).count(), 1, "exactly one decision overridden");
        assert!(run.prefix_echoes.last().copied().unwrap() > auto_total, "the loot option's bonus raises total loot");
    }

    #[test]
    fn decisions_offer_two_to_three_options_with_a_safe_default() {
        // The themed 2–3-option crossroads: every decision has 2 or 3 options, option 0 is always the safe heal
        // (the auto-default for idle/offline), and across a long run at least one 3-option crossroads appears.
        let g = strong_team(29);
        let path: Vec<usize> = (0..9).collect();
        let seed = g.clear_seed(0, path[0]);
        let p = g.resolve_run(0, &path, seed);
        assert!(!p.decisions.is_empty(), "a long run interleaves crossroads");
        for d in &p.decisions {
            assert!((2..=3).contains(&d.options.len()), "2 or 3 options");
            assert_eq!(d.auto_option, 0, "option 0 is the deterministic default");
            assert!(d.options[0].heal_pct > 0 && d.options[0].echo_bonus == 0, "option 0 is the safe heal, no loot");
            assert!((d.template as usize) < 3, "a known template id");
        }
        assert!(p.decisions.iter().any(|d| d.options.len() == 3), "a long run shows at least one 3-option crossroads");
        // a 3-option crossroads' option 2 is choosable + applies (online == a pure resolve with that committed choice)
        let mut g2 = strong_team(29);
        assert!(g2.send_expedition(0, &path, 0.0));
        if let Some(room) = g2.active_run.as_ref().unwrap().decisions.iter().find(|d| d.options.len() == 3).map(|d| d.room_idx) {
            assert!(g2.choose_decision(room, 2, 0.0), "option 2 of a 3-option crossroads is choosable");
            let (rs, ch) = { let r = g2.active_run.as_ref().unwrap(); (r.run_seed, r.decision_choices.clone()) };
            let fresh = g2.resolve_run_with_choices(0, &path, rs, &ch);
            assert_eq!(g2.active_run.as_ref().unwrap().prefix_echoes, fresh.prefix_echoes, "option-2 override == a pure resolve with the committed choice");
        }
    }

    #[test]
    fn choose_then_offline_equals_choose_then_online() {
        // THE GATE — the single test that catches online/offline divergence on the override path: a player who
        // overrides a crossroads then keeps playing must end BYTE-IDENTICAL to one who overrides then goes away.
        let setup = || {
            let mut g = strong_team(41);
            let path: Vec<usize> = (0..6).collect();
            assert!(g.send_expedition(0, &path, 0.0));
            let room = first_decision_room(&g);
            assert!(g.choose_decision(room, 1, 0.0));
            g
        };
        let t_end = setup().active_run.as_ref().unwrap().total_ms + 10_000.0;
        let mut on = setup();
        let step = (t_end / 50.0).max(1.0);
        let mut t = 0.0;
        while t < t_end {
            t = (t + step).min(t_end);
            on.tick(t);
        }
        let mut off = setup();
        off.compute_offline(t_end);
        assert_eq!(on.echoes, off.echoes, "override: online == offline echoes");
        assert_eq!(on.exp_cleared, off.exp_cleared, "override: online == offline clears");
        assert!(on.active_run.is_none() && off.active_run.is_none(), "both runs completed");
    }

    #[test]
    fn choose_keeps_banked_prefix_immutable() {
        // Overriding a decision AFTER earlier rooms have banked must leave the banked head byte-identical (the player
        // was already paid those) — only the unbanked tail may change.
        let mut g = strong_team(53);
        let path: Vec<usize> = (0..8).collect();
        assert!(g.send_expedition(0, &path, 0.0));
        let rk = expedition::RoomKind::Decision.as_u8();
        let decisions: Vec<usize> = g.active_run.as_ref().unwrap().room_kind.iter().enumerate().filter(|(_, &k)| k == rk).map(|(i, _)| i).collect();
        assert!(decisions.len() >= 2, "a long run has multiple crossroads");
        let target = decisions[1];
        let now = g.active_run.as_ref().unwrap().prefix_ms[target - 1] - 1.0; // just before the target arrives
        g.tick(now);
        let claimed = g.active_run.as_ref().unwrap().claimed_rooms as usize;
        assert!(claimed > 0 && claimed <= target, "some rooms banked, the target is still ahead");
        let head_ms = g.active_run.as_ref().unwrap().prefix_ms[..claimed].to_vec();
        let head_ech = g.active_run.as_ref().unwrap().prefix_echoes[..claimed].to_vec();
        let banked = g.echoes;
        assert!(g.choose_decision(target, 1, now), "override the still-unbanked second crossroads");
        let run = g.active_run.as_ref().unwrap();
        assert_eq!(run.prefix_ms[..claimed], head_ms[..], "banked time prefix is immutable");
        assert_eq!(run.prefix_echoes[..claimed], head_ech[..], "banked echo prefix is immutable");
        assert_eq!(g.echoes, banked, "already-banked echoes are unchanged by the override");
    }

    #[test]
    fn choose_is_savescum_proof() {
        // The committed choice survives a save round-trip and can't be re-rolled.
        let mut g = strong_team(61);
        let path: Vec<usize> = (0..6).collect();
        assert!(g.send_expedition(0, &path, 0.0));
        let room = first_decision_room(&g);
        assert!(g.choose_decision(room, 1, 0.0));
        let di = g.active_run.as_ref().unwrap().decisions.iter().position(|d| d.room_idx == room).unwrap();
        let back = GameState::from_json(&g.to_json()).unwrap();
        assert_eq!(back.active_run.as_ref().unwrap().decision_choices[di], 1, "the committed choice persists across reload");
        assert_eq!(back.active_run.as_ref().unwrap().prefix_echoes, g.active_run.as_ref().unwrap().prefix_echoes, "the re-resolved schedule persists");
        assert!(!g.choose_decision(room, 0, 0.0), "re-choosing an already-decided crossroads is rejected (no reroll)");
    }

    #[test]
    fn choose_rejected_after_the_room_banks() {
        // Once the decision room has banked, the window is closed — the override is rejected (anti-scum).
        let mut g = strong_team(71);
        let path: Vec<usize> = (0..6).collect();
        assert!(g.send_expedition(0, &path, 0.0));
        let room = first_decision_room(&g);
        let past = g.active_run.as_ref().unwrap().prefix_ms[room] + 1.0;
        g.tick(past);
        assert!(g.active_run.is_some(), "the run is still in flight (a decision banks well before the run ends)");
        assert!(!g.choose_decision(room, 1, past), "a banked crossroads can't be overridden");
    }

    #[test]
    fn override_loot_equals_a_pure_resolve_with_the_committed_choices() {
        // Hardening (adversary §3): the override's economy is pinned to the PURE deterministic resolution — the active
        // run's loot prefix equals a from-scratch resolve with the same committed choices. So even though tail TIMING
        // may drift if the player re-skills mid-delve, the integer LOOT lumps never do (they're power-independent).
        let mut g = strong_team(83);
        let path: Vec<usize> = (0..6).collect();
        assert!(g.send_expedition(0, &path, 0.0));
        let room = first_decision_room(&g);
        assert!(g.choose_decision(room, 1, 0.0));
        let (seed, choices) = {
            let r = g.active_run.as_ref().unwrap();
            (r.run_seed, r.decision_choices.clone())
        };
        let fresh = g.resolve_run_with_choices(0, &path, seed, &choices);
        let run = g.active_run.as_ref().unwrap();
        assert_eq!(run.prefix_echoes, fresh.prefix_echoes, "override echoes == a pure resolve with the committed choices");
        assert_eq!(run.prefix_flux, fresh.prefix_flux, "override flux == a pure resolve with the committed choices");
    }

    #[test]
    fn offline_report_celebrates_a_delve_that_returned() {
        // R9: a delve that COMPLETES during the offline span surfaces its return in the OfflineReport — the offline
        // peak-end beat (parity with the online "your party returned" report).
        let mut g = strong_team(91);
        assert!(g.send_expedition(0, &[0, 1, 2], 0.0));
        let r = g.compute_offline(6.0 * 7.0 * 24.0 * MS_PER_HOUR); // weeks away — the bounded run completes
        assert!(g.active_run.is_none(), "the run completed offline");
        assert!(r.delve_returned.is_some(), "the offline report celebrates the returned delve");
        // a span with NO active run reports nothing
        let mut g2 = strong_team(91);
        let r2 = g2.compute_offline(5.0 * MS_PER_HOUR);
        assert!(r2.delve_returned.is_none(), "no run in flight ⇒ no delve-return beat");
    }

    #[test]
    fn resolve_run_is_deterministic() {
        let g = strong_team(42);
        let path = [0usize, 1, 2, 3];
        let seed = g.clear_seed(0, path[0]);
        let a = g.resolve_run(0, &path, seed);
        let b = g.resolve_run(0, &path, seed);
        assert_eq!(a.prefix_ms, b.prefix_ms);
        assert_eq!(a.prefix_echoes, b.prefix_echoes);
        assert_eq!(a.prefix_flux, b.prefix_flux);
        assert_eq!(a.room_node, b.room_node);
        assert_eq!(a.room_kind, b.room_kind);
        assert_eq!(a.death_room, b.death_room);
        assert!(a.total_ms > 0.0 && !a.prefix_ms.is_empty());
    }

    #[test]
    fn room0_seed_equals_clear_seed() {
        // A 1-room run to node q resolves the SAME fight as clearing q via station (room 0 uses run_seed raw).
        let g = strong_team(7);
        let seed = g.clear_seed(0, 0);
        let plan = g.resolve_run(0, &[0], seed);
        let o = g.team_orders(0);
        let station_battle = expedition::resolve_battle(seed, g.build_team_combatants(0, &o, &g.team_effects(0)), expedition::quest_enemies_scaled(&QUESTS[0], g.node_mod_scale(0)), o.focus, &g.build_team_gambits(0, &o, g.auto_tactics_unlocked()));
        assert_eq!(plan.prefix_ms[0], station_battle.rounds as f64 * MS_PER_ROOM_ROUND, "room 0 == the station clear fight");
        assert!(plan.death_room.is_none());
    }

    #[test]
    fn run_online_equals_offline() {
        // Bank via 40 small ticks to T == one compute_offline to T (the same frozen array element ⇒ same loot+clears).
        let mk = || strong_team(99);
        let path = [0usize, 1, 2, 3];
        let mut on = mk();
        assert!(on.send_expedition(0, &path, 0.0));
        let t_end = on.active_run.as_ref().unwrap().total_ms + 10_000.0;
        let step = (t_end / 40.0).max(1.0);
        let mut t = 0.0;
        while t < t_end {
            t = (t + step).min(t_end);
            on.tick(t);
        }
        let mut off = mk();
        assert!(off.send_expedition(0, &path, 0.0));
        off.compute_offline(t_end);
        assert_eq!(on.echoes, off.echoes, "run echoes online==offline");
        assert_eq!(on.exp_cleared, off.exp_cleared, "cleared nodes online==offline");
        assert!(on.active_run.is_none() && off.active_run.is_none(), "run completed both ways");
        assert!(on.echoes > 0, "the run paid out");
    }

    #[test]
    fn run_offline_is_o1_and_completes_after_a_long_span() {
        let mut g = strong_team(5);
        g.send_expedition(0, &[0, 1, 2], 0.0);
        g.compute_offline(6.0 * 7.0 * 24.0 * MS_PER_HOUR); // 6 weeks — instant (binary-search read), bounded run completes
        assert!(g.active_run.is_none(), "the bounded run completed");
        assert!(g.echoes > 0);
    }

    #[test]
    fn send_unstations_the_run_team_so_it_does_not_double_dip_the_farm_rate() {
        // FENCE: a stationed team that is sent on a run must STOP farming the closed-form rate — otherwise it
        // banks run loot AND the standing farm rate simultaneously (online==offline holds, but mispriced economy).
        let mut g = strong_team(99);
        g.station(0, 0); // clears node 0 + farms it via the closed-form rate
        assert!(g.echo_rate_per_hr() > 0.0, "team 0 is farming via the closed-form rate");
        assert!(g.send_expedition(0, &[1, 2, 3], 0.0), "send team 0 on a run");
        assert_eq!(g.exp_station[0], -1, "the delving team is un-stationed");
        assert_eq!(g.echo_rate_per_hr(), 0.0, "no closed-form farm rate while delving (no double-dip)");
    }

    #[test]
    fn run_save_scum_proof() {
        // The schedule is frozen + persisted at send, BEFORE any reveal — reload yields identical outcomes.
        let mut g = strong_team(11);
        g.send_expedition(0, &[0, 1, 2], 0.0);
        let back = GameState::from_json(&g.to_json()).unwrap();
        let a = g.active_run.as_ref().unwrap();
        let b = back.active_run.as_ref().unwrap();
        assert_eq!(a.run_seed, b.run_seed);
        assert_eq!(a.prefix_ms, b.prefix_ms);
        assert_eq!(a.prefix_echoes, b.prefix_echoes);
        assert_eq!(a.room_node, b.room_node);
    }

    #[test]
    fn run_clears_nodes_idempotently() {
        // A run first-clears each fight node it traverses (idempotent via grant_first_clear's guard); a later
        // station of an already-cleared node does NOT double-count the first-clear ledger.
        let mut g = strong_team(3);
        g.send_expedition(0, &[0, 1, 2, 3], 0.0);
        let total = g.active_run.as_ref().unwrap().total_ms;
        g.tick(total + 1000.0);
        assert!(g.active_run.is_none());
        assert!(g.exp_cleared[0] && g.exp_cleared[3], "the run cleared the nodes it traversed");
        let clears = g.exp_clears_total;
        g.station(0, 0); // already cleared ⇒ first-clear ledger unchanged
        assert_eq!(g.exp_clears_total, clears, "no double first-clear from re-stationing a run-cleared node");
    }

    #[test]
    fn run_interleaves_cozy_rooms_deterministically() {
        // P2: Treasure rooms interleave (after every 2nd combat) → more rooms than path nodes; the loot + layout
        // are deterministic; the run still completes (cozy heals keep the party alive deeper).
        let g = strong_team(13);
        let path: Vec<usize> = (0..6).collect();
        let seed = g.clear_seed(0, path[0]);
        let plan = g.resolve_run(0, &path, seed);
        assert!(plan.planned_rooms > path.len(), "cozy rooms interleaved ⇒ more rooms than path nodes");
        assert!(plan.room_kind.contains(&expedition::RoomKind::Treasure.as_u8()), "a Treasure room is present");
        assert!(plan.death_room.is_none(), "a strong, cozy-healed party completes the chapter");
        // the Treasure lump bumps cumulative Echoes beyond the bare fight loot
        assert!(*plan.prefix_echoes.last().unwrap() > 0);
        // determinism (layout + loot)
        let plan2 = g.resolve_run(0, &path, seed);
        assert_eq!(plan.room_kind, plan2.room_kind);
        assert_eq!(plan.prefix_echoes, plan2.prefix_echoes);
        assert_eq!(plan.prefix_ms, plan2.prefix_ms);
    }

    #[test]
    fn replay_room_battle_re_enacts_a_run_fight() {
        // P4: clicking a delve-track fight glyph re-resolves that room's battle. Right after send (no mid-run XP
        // yet) it matches the frozen schedule exactly; it's deterministic; cozy/out-of-range rooms return None.
        let mut g = strong_team(7);
        g.send_expedition(0, &[0, 1, 2, 3], 0.0);
        let b0 = g.replay_room_battle(0).expect("room 0 is a fight");
        assert!(b0.win, "a revealed room was won");
        assert_eq!(b0.rounds as f64 * MS_PER_ROOM_ROUND, g.active_run.as_ref().unwrap().prefix_ms[0], "replay matches the frozen schedule's room-0 timing");
        let b0b = g.replay_room_battle(0).expect("deterministic");
        assert_eq!((b0.rounds, b0.log.len()), (b0b.rounds, b0b.log.len()));
        assert!(g.replay_room_battle(9999).is_none(), "out of range ⇒ None");
    }

    #[test]
    fn delve_rewards_and_rate_are_read_only() {
        // Slice 5: the run view exposes per-room reward lumps + a delve-rate, as PURE reads of the frozen schedule.
        // Building the view must not bank anything; lumps cover BANKED rooms only (no spoiler); they sum to the
        // banked total; the rate is the Rust-emitted whole-run average (TS must never derive it from currency deltas).
        let mut g = strong_team(7);
        g.send_expedition(0, &[0, 1, 2, 3], 0.0);
        let t1 = g.active_run.as_ref().unwrap().prefix_ms[1];
        g.tick(t1 + 1.0); // bank rooms 0 and 1
        let (claimed, banked_e, banked_f, total_e, total_ms) = {
            let r = g.active_run.as_ref().unwrap();
            let c = r.claimed_rooms as usize;
            (
                c,
                if c == 0 { 0 } else { r.prefix_echoes[c - 1] },
                if c == 0 { 0 } else { r.prefix_flux[c - 1] },
                *r.prefix_echoes.last().unwrap(),
                r.total_ms,
            )
        };
        assert!(claimed >= 2, "two rooms banked");
        let v = g.view();
        assert_eq!(g.active_run.as_ref().unwrap().claimed_rooms as usize, claimed, "view() is read-only — banking cursor unmoved");
        let rv = v.run.unwrap();
        assert_eq!(rv.room_echoes.len(), claimed, "only BANKED rooms expose a reward (current/future room hidden)");
        assert_eq!(rv.room_flux.len(), claimed);
        assert_eq!(rv.room_echoes.iter().sum::<u64>(), banked_e, "per-room Echo lumps sum to the banked total");
        assert_eq!(rv.room_flux.iter().sum::<u64>(), banked_f, "per-room Flux lumps sum to the banked total");
        let want = total_e as f64 / total_ms * 3_600_000.0;
        assert!((rv.delve_echoes_per_hr - want).abs() < 1e-6, "delve rate is the whole-run average, not 0");
        assert!(rv.delve_flux_per_hr >= 0.0 && rv.delve_echoes_per_hr > 0.0, "a delving team shows a real rate (was 0)");
    }

    #[test]
    fn run_freezes_auto_tactics_at_send() {
        // Buying auto-tactics MID-RUN must not change the in-flight run: the plan + the watch replay use the
        // SEND-time flag, so the visual replay matches the banked schedule (online==offline).
        let mut g = strong_team(7); // auto LOCKED at send
        g.send_expedition(0, &[0, 1, 2, 3], 0.0);
        assert!(!g.active_run.as_ref().unwrap().auto_tactics, "sent with auto locked ⇒ frozen false");
        let before = g.replay_room_battle(0).map(|b| b.rounds);
        g.upgrades[UPG_AUTO_TACTICS] = 1; // buy auto mid-run
        let after = g.replay_room_battle(0).map(|b| b.rounds);
        assert_eq!(before, after, "replay reads the FROZEN flag, not the live purchase");
    }

    #[test]
    fn rest_cooldown_gates_the_next_delve() {
        // After a run completes, the party rests REST_BETWEEN_RUNS_MS (from the run's deterministic completion)
        // before another delve can send — gating manual + auto alike. The window is online==offline (no now_ms).
        let mut g = strong_team(7);
        assert!(g.send_expedition(0, &[0], 1000.0));
        let total = g.active_run.as_ref().unwrap().total_ms;
        g.tick(1000.0 + total + 1.0); // advance past the run's completion
        assert!(g.active_run.is_none(), "the run completed");
        let expect = 1000.0 + total + REST_BETWEEN_RUNS_MS;
        assert!((g.exp_rest_until - expect).abs() < 1.0, "rest_until = completion + the rest window");
        assert!(!g.send_expedition(0, &[1], expect - 1000.0), "still resting ⇒ a send is rejected");
        assert!(g.exp_rest_until > 0.0);
    }

    #[test]
    fn recrystallize_banks_then_aborts_run() {
        let mut g = strong_team(7);
        for i in 0..COUNT {
            g.owned[i] = g.owned[i].max(1); // core complete ⇒ ascent allowed
        }
        g.send_expedition(0, &[0, 1, 2, 3], 0.0);
        let total = g.active_run.as_ref().unwrap().total_ms;
        g.tick(total * 0.5); // bank ~half the rooms, run still in flight
        assert!(g.active_run.is_some());
        let banked = g.echoes;
        assert!(banked > 0, "mid-run loot was banked");
        assert!(g.recrystallize(), "ascent allowed");
        assert!(g.active_run.is_none(), "recrystallize aborts the in-flight run (banked loot kept)");
        assert_eq!(g.echoes, banked, "banked Echoes carry over the ascent");
    }

    #[test]
    fn v5_save_loads_with_no_run_and_farms_byte_identically() {
        // D2 coexistence: a v5-shaped save (no v6 fields) loads with active_run None and the station-farm intact.
        let mut g = GameState::new(42, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.station(0, 0);
        let mut v: serde_json::Value = serde_json::from_str(&g.to_json()).unwrap();
        let obj = v.as_object_mut().unwrap();
        obj.remove("active_run");
        obj.remove("run_history");
        let back = GameState::from_json(&v.to_string()).unwrap();
        assert!(back.active_run.is_none());
        assert_eq!(back.schema_version, 6);
        let mut a = g.clone();
        let mut b = back;
        assert_eq!(a.compute_offline(5.0 * MS_PER_HOUR).gained_echoes, b.compute_offline(5.0 * MS_PER_HOUR).gained_echoes, "farm byte-identical");
    }

    #[test]
    fn orders_do_not_move_the_farm_rate() {
        // D4 fence: NO orders permutation may change the standing farm rate (Echoes or Flux). Orders fold into
        // the CLEAR battle + combat targeting only; the farm bands on base power.
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.station(0, 0); // clear + farm node 0 (default orders)
        let echo0 = g.echo_rate_per_hr();
        let flux0 = g.expedition_flux_per_hr();
        assert!(echo0 > 0.0);
        for formation in 0..3u8 {
            for doctrine in 0..3u8 {
                for focus in -1..=2i8 {
                    g.set_orders(0, formation, doctrine, focus);
                    g.set_slot_stance(0, 0, 0); // aggressive
                    g.set_slot_stance(0, 1, 2); // defensive
                    assert_eq!(g.echo_rate_per_hr().to_bits(), echo0.to_bits(), "orders moved the Echo rate");
                    assert_eq!(g.expedition_flux_per_hr().to_bits(), flux0.to_bits(), "orders moved the Flux rate");
                }
            }
        }
    }

    #[test]
    fn gambits_change_the_clear_not_the_farm_or_watch() {
        // D4 fence: a gambit program changes the CLEAR seed (a different fight) but NEVER the standing farm rate
        // or the watch (both run the inert default ladder via farm_seed + empty gambits).
        let mut g = GameState::new(11, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.station(0, 0); // clear + farm node 0 with default orders
        let echo0 = g.echo_rate_per_hr();
        let flux0 = g.expedition_flux_per_hr();
        let seed_default = g.clear_seed(0, 0);
        let wkey = |g: &GameState| g.watch_data(0, 0).map(|r| (r.win, r.rounds, r.log.iter().map(|e| (e.actor, e.action, e.dmg, e.heal, e.fainted)).collect::<Vec<_>>()));
        let watch0 = wkey(&g);
        // program slot 0 to always attack the threat
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 0, expedition::COND_ALWAYS, expedition::ACT_ATTACK_THREAT);
        assert_eq!(g.echo_rate_per_hr().to_bits(), echo0.to_bits(), "gambits must not move the Echo rate");
        assert_eq!(g.expedition_flux_per_hr().to_bits(), flux0.to_bits(), "gambits must not move the Flux rate");
        assert_eq!(wkey(&g), watch0, "gambits must not change the standing-farm watch");
        assert_ne!(g.clear_seed(0, 0), seed_default, "a gambit program must change the clear seed");
    }

    #[test]
    fn stance_only_orders_hash_is_byte_stable() {
        // the gambit fold is guarded on a non-empty slot, so default / stance-only teams hash exactly as before
        // the gambit field existed (byte-stable seeds — no golden churn).
        let mut a = Orders::default();
        let h_default = orders_hash(&a);
        a.stance = vec![0, 2, 1];
        let h_stance = orders_hash(&a);
        let mut b = a.clone();
        b.gambits = vec![vec![], vec![], vec![]]; // empty slots present
        assert_eq!(orders_hash(&b), h_stance, "empty gambit slots must not perturb the hash");
        assert_ne!(h_stance, h_default);
        let mut c = a.clone();
        c.gambits = vec![vec![expedition::GambitRule { cond: 0, action: 1, on: true }]];
        assert_ne!(orders_hash(&c), h_stance, "a real gambit rule changes the seed");
    }

    #[test]
    fn orders_roundtrip_preserves_gambits() {
        let mut g = GameState::new(3, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.add_gambit(0, 0);
        g.set_gambit_rule(0, 0, 0, expedition::COND_ALLY_LOW, expedition::ACT_HEAL);
        g.toggle_gambit(0, 0, 0); // off
        let json = g.to_json();
        let back = GameState::from_json(&json).unwrap();
        assert_eq!(back.exp_orders[0].gambits, g.exp_orders[0].gambits);
        assert_eq!(back.exp_orders[0].gambits[0][0].cond, expedition::COND_ALLY_LOW);
        assert!(!back.exp_orders[0].gambits[0][0].on);
    }

    #[test]
    fn risk_mod_boosts_first_clear_echoes_only_and_not_the_farm() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..12 {
            g.owned[id] = 9999; // strong enough to clear a harrowing node 0
        }
        g.set_team(0, &[2, 0, 4]);
        let mut safe = g.clone();
        let r_safe = safe.station(0, 0); // mod 0
        assert!(r_safe.win);
        let mut risky = g.clone();
        risky.set_node_mod(0, 2); // harrowing
        let r_risky = risky.station(0, 0);
        assert!(r_risky.win, "a strong team still clears a harrowing node 0");
        assert!(r_risky.echoes_gained > r_safe.echoes_gained, "risk pays a bigger Echoes purse");
        assert_eq!(r_risky.first_clear_flux.to_bits(), r_safe.first_clear_flux.to_bits(), "risk must NOT change the Flux windfall (D5)");
        // the standing farm rate + flux clamp are identical regardless of the clear-time mod (D4 fence)
        assert_eq!(risky.echo_rate_per_hr().to_bits(), safe.echo_rate_per_hr().to_bits());
        assert_eq!(risky.expedition_flux_per_hr().to_bits(), safe.expedition_flux_per_hr().to_bits());
        // a set mod is rejected once the node is cleared (mod is a one-shot clear choice)
        risky.set_node_mod(0, 1);
        assert_eq!(risky.exp_node_mod[0], 2, "can't change a cleared node's mod");
    }

    #[test]
    fn provisions_and_relics_do_not_move_the_farm_rate() {
        // D4 fence again: equipping relics / staging provisions never touches the standing farm rate.
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        g.station(0, 0); // farm node 0
        let echo0 = g.echo_rate_per_hr();
        let flux0 = g.expedition_flux_per_hr();
        g.dev_add_echoes(1_000_000);
        for id in 0..expedition::PROVISION_COUNT {
            g.buy_provision(id);
            g.load_provision(0, id);
        }
        for id in 0..expedition::RELIC_COUNT {
            g.buy_relic(id);
            g.equip_relic(0, id);
        }
        assert!(!g.team_effects(0).is_empty(), "effects are staged/equipped");
        assert_eq!(g.echo_rate_per_hr().to_bits(), echo0.to_bits(), "provisions/relics moved the Echo rate");
        assert_eq!(g.expedition_flux_per_hr().to_bits(), flux0.to_bits(), "provisions/relics moved the Flux rate");
    }

    #[test]
    fn double_rations_doubles_first_clear_echoes_only_consumed_on_win() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        let mut base = g.clone();
        let rb = base.station(0, 0);
        assert!(rb.win);
        let dr = expedition::PROVISIONS.iter().position(|p| p.key == "double_rations").unwrap();
        let mut dbl = g.clone();
        dbl.dev_add_echoes(10_000);
        assert!(dbl.buy_provision(dr) && dbl.load_provision(0, dr));
        let owned_before = dbl.prov_inv[dr];
        let rd = dbl.station(0, 0);
        assert!(rd.win);
        assert_eq!(rd.echoes_gained, rb.echoes_gained * 2, "double_rations doubles the Echoes lump");
        assert_eq!(rd.first_clear_flux.to_bits(), rb.first_clear_flux.to_bits(), "Flux windfall unchanged (D5)");
        assert_eq!(dbl.prov_inv[dr], owned_before - 1, "provision consumed on win");
        assert!(dbl.exp_provisions[0].is_empty(), "staged provisions cleared after the clear");
    }

    #[test]
    fn provision_retained_on_loss() {
        let mut g = GameState::new(3, 0.0);
        g.owned[0] = 1;
        g.set_team(0, &[0]); // too weak for the boss
        g.exp_cleared[6] = true; // open folds_boss
        let pt = expedition::PROVISIONS.iter().position(|p| p.key == "phoenix_tear").unwrap();
        g.dev_add_echoes(10_000);
        assert!(g.buy_provision(pt) && g.load_provision(0, pt));
        let owned = g.prov_inv[pt];
        let r = g.station(0, 7);
        if !r.win {
            assert_eq!(g.prov_inv[pt], owned, "a loss retains the provision charge (D6)");
            assert_eq!(g.exp_provisions[0], vec![pt as u8], "staging is kept on a loss");
        }
    }

    #[test]
    fn stance_folds_into_combat_stats_only() {
        let mut g = GameState::new(3, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        let base = g.build_team_combatants(0, &Orders::default(), &[]);
        assert!(base.iter().all(|c| !c.front), "balanced formation designates no front");
        // aggressive slot 0 hits harder, defends softer (combat stats only — exp_power untouched)
        let p0 = g.exp_power(2);
        let o = Orders { stance: vec![0], formation: 1, ..Default::default() }; // aggressive slot 0, front-heavy
        let agg = g.build_team_combatants(0, &o, &[]);
        assert!(agg[0].atk > base[0].atk && agg[0].def < base[0].def);
        assert!(agg[0].front, "front-heavy formation marks slot 0 front");
        assert_eq!(g.exp_power(2), p0, "stance must NOT touch exp_power (farm-rate band)");
    }

    #[test]
    fn history_records_runs_and_counters() {
        let mut g = GameState::new(7, 0.0);
        own_early(&mut g);
        g.set_team(0, &[2, 0, 4]);
        let r = g.station(0, 0);
        assert!(r.win);
        assert_eq!(g.exp_clears_total, 1);
        assert_eq!(g.exp_runs.len(), 1);
        assert_eq!(g.exp_runs[0].quest, 0);
        assert!(g.exp_runs[0].rounds > 0 && g.exp_runs[0].echoes == r.echoes_gained);
        // farming bumps the lifetime farmed counters
        let (e0, f0) = (g.exp_echoes_farmed, g.exp_flux_farmed);
        g.compute_offline(5.0 * HOUR);
        assert!(g.exp_echoes_farmed > e0 && g.exp_flux_farmed > f0);
        // the ring is bounded at 24 (push many directly)
        for _ in 0..40 {
            g.push_run(0, 0, (5, 1, 3), 100, 50.0);
        }
        assert!(g.exp_runs.len() <= 24, "history ring is bounded so saves don't bloat");
    }

    #[test]
    fn prestige_resets_run_state_keeps_meta() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..COUNT {
            g.owned[id] = 1; // own everything → core_complete → ascent allowed at dim 3
        }
        g.set_team(0, &[2, 0, 4]);
        g.dev_add_echoes(100_000);
        g.buy_relic(0);
        g.equip_relic(0, 0);
        g.set_node_mod(1, 2);
        g.set_orders(0, 1, 1, 1);
        g.station(0, 0);
        let clears = g.exp_clears_total;
        assert!(g.recrystallize(), "owning everything should meet the dim-3 ascent requirement");
        assert!(g.exp_node_mod.iter().all(|&m| m == 0), "node mods reset on ascent");
        assert!(g.exp_provisions.iter().all(|p| p.is_empty()), "staged provisions reset on ascent");
        assert!(g.exp_cleared.iter().all(|&c| !c), "R3 Deeper Manifold: the quests RE-OPEN for a fresh NG+ descent");
        // meta persists
        assert!(g.relics_owned[0] && g.team_relics[0].contains(&0), "relics persist across ascent");
        assert_eq!(g.exp_orders[0].formation, 1, "orders persist across ascent");
        assert_eq!(g.exp_clears_total, clears, "history counters persist (lifetime meta, not per-cycle)");
        assert!(!g.exp_runs.is_empty(), "history ring persists");
    }

    #[test]
    fn ngplus_deepens_the_manifold_combat_only_and_pays_more() {
        // R3: each NG+ cycle scales enemy difficulty AND first-clear Echoes — but the enemy scaling is COMBAT-only
        // (never the farm rate, which is power-banded), so the D4 farm fence holds.
        let mut g = strong_team(7);
        g.station(0, 0); // clear + station node 0 ⇒ a live farm rate to fence against
        let scale0 = g.node_mod_scale(1);
        let rate0 = g.expedition_flux_per_hr(); // the farm-rate band reference
        assert!(rate0 > 0.0, "team 0 is farming via the closed-form rate");
        g.ng_cycle = 2;
        let scale2 = g.node_mod_scale(1);
        assert!(scale2 > scale0, "NG+ enemies are harder ({scale0}% -> {scale2}%)");
        assert_eq!(scale2 - scale0, 2 * NGPLUS_ENEMY_SCALE_PCT, "exactly +{NGPLUS_ENEMY_SCALE_PCT}%/cycle");
        assert_eq!(g.expedition_flux_per_hr().to_bits(), rate0.to_bits(), "enemy scaling is COMBAT-only — the farm rate is untouched (D4 fence)");
    }

    #[test]
    fn ngplus_first_clear_pays_more_echoes() {
        // R3: a clear in NG+ pays more Echoes than the same clear in the base cycle (the lucrative re-climb).
        let mut g0 = strong_team(9);
        let e0 = g0.echoes;
        g0.grant_first_clear(0, 0);
        let base_gain = g0.echoes - e0;
        let mut g1 = strong_team(9);
        g1.ng_cycle = 1;
        let e1 = g1.echoes;
        g1.grant_first_clear(0, 0);
        let ng_gain = g1.echoes - e1;
        assert!(ng_gain > base_gain, "NG+1 clear pays more ({base_gain} -> {ng_gain})");
        assert_eq!(ng_gain, base_gain * (100 + NGPLUS_REWARD_BONUS_PCT) / 100, "exactly +{NGPLUS_REWARD_BONUS_PCT}%");
    }

    #[test]
    fn auto_dispatches_runs_over_time_and_never_spends_or_risks() {
        // v6 D23: Auto now DISPATCHES runs (one in flight at a time); the run clears the chapter over idle TIME via
        // accrue_run, so this advances now_ms each call (the old version froze time + expected instant clears).
        let mut g = strong_team(7); // a party strong enough to actually complete the early chapters
        g.dev_add_echoes(100_000);
        let pt = expedition::PROVISIONS.iter().position(|p| p.key == "phoenix_tear").unwrap();
        g.buy_provision(pt); // owned but NOT staged → auto can still use the (provision-free) team
        let prov_before = g.prov_inv[pt];
        let mut dispatches = 0;
        let mut t = 0.0;
        for _ in 0..400 {
            t += 30_000.0; // advance 30s/call so the in-flight run progresses + completes, then the next dispatches
            if g.auto_expedition(t).delved {
                dispatches += 1;
            }
        }
        assert!(dispatches >= 2, "auto dispatched several runs over time");
        assert!(g.exp_cleared[0] && g.exp_cleared[1], "auto-run cleared the early journey nodes");
        assert_eq!(g.prov_inv[pt], prov_before, "auto NEVER spends provisions (uses a provision-free team)");
        assert!(g.exp_node_mod.iter().all(|&m| m == 0), "auto NEVER sets a risk mod");
        assert!(!g.exp_cleared[13] && !g.exp_cleared[14] && !g.exp_cleared[15], "auto NEVER clears Elite branch nodes");
        // determinism: same start + same time ⇒ same first dispatch destination
        let mut a = strong_team(7);
        let mut b = a.clone();
        assert_eq!(a.auto_expedition(1000.0).quest, b.auto_expedition(1000.0).quest);
    }

    #[test]
    fn node_open_follows_the_journey_graph() {
        let mut g = GameState::new(1, 0.0);
        // fresh: only region entries (no in-edges) are open at dim 3
        assert!(g.node_open(0), "shallows_1 is a region entry → open");
        assert!(!g.node_open(1), "shallows_2 gated until shallows_1 cleared");
        assert!(!g.node_open(3), "boss gated until a path reaches it");
        assert!(!g.node_open(11), "vantage gated by dimension (min_dim 4)");
        // clear node 0 → BOTH the mainline (1) and the Elite branch (13) open — the route choice
        g.exp_cleared[0] = true;
        assert!(g.node_open(1) && g.node_open(13));
        assert!(!g.node_open(3), "boss still needs 2 OR 13 cleared");
        // OR-convergence: clearing EITHER path opens the boss
        let mut via_elite = g.clone();
        via_elite.exp_cleared[13] = true;
        assert!(via_elite.node_open(3), "Elite branch opens the boss");
        let mut via_main = g.clone();
        via_main.exp_cleared[1] = true;
        via_main.exp_cleared[2] = true;
        assert!(via_main.node_open(3), "mainline opens the boss");
        // dimension gate holds even with prereqs cleared
        let mut deep = g.clone();
        for q in 0..11 {
            deep.exp_cleared[q] = true;
        }
        assert!(!deep.node_open(11), "vantage needs viewport_dim >= 4");
        deep.viewport_dim = 4;
        assert!(deep.node_open(11));
    }

    #[test]
    fn pre_v4_save_loads_with_one_empty_team() {
        let mut g = GameState::new(9, 0.0);
        g.owned[0] = 1;
        let mut v: serde_json::Value = serde_json::from_str(&g.to_json()).unwrap();
        let obj = v.as_object_mut().unwrap();
        obj.insert("schema_version".into(), serde_json::json!(2));
        for k in ["echoes", "lifetime_echoes", "echo_carry", "exp_flux_carry", "exp_party", "exp_cleared", "exp_farms", "exp_perks", "exp_teams", "exp_station", "exp_active_team", "shape_xp", "skill_alloc", "shape_xp_carry"] {
            obj.remove(k);
        }
        let back = GameState::from_json(&v.to_string()).expect("pre-v4 save still loads");
        assert_eq!(back.schema_version, 6);
        assert_eq!(back.exp_teams.len(), 1);
        assert!(back.exp_teams[0].is_empty());
        assert_eq!(back.exp_station, vec![-1]);
        assert_eq!(back.echo_rate_per_hr(), 0.0);
        assert_eq!(back.shape_xp.len(), COUNT);
        assert_eq!(back.skill_alloc.len(), COUNT);
        // v5 vecs present + default after a deep migration
        assert_eq!(back.exp_orders.len(), 1);
        assert_eq!(back.exp_node_mod.len(), QUEST_COUNT);
    }

    #[test]
    fn forge_discovery_sting_is_once_per_output_shape() {
        // Two different recipes both produce Klein; the +100 sting fires only the first time Klein is forged.
        let mut g = GameState::new(1, 0.0);
        g.owned[19] = 1; // ℝP²
        g.owned[20] = 1; // Boy's surface
        g.shards = 200;
        let first = g.forge(19, 19); // ℝP² # ℝP² = Klein
        assert!(first.ok && first.is_discovery, "first Klein forge stings");
        assert!(g.forged[18], "Klein flagged as forged");
        let second = g.forge(20, 20); // Boy's # Boy's = Klein (a different recipe, same shape)
        assert!(second.ok && !second.is_discovery, "second route to Klein does not re-sting");
        // …but the recipe book still ticks the second recipe's ✓ (for the grid + forge_3 milestone).
        let boys_recipe = content::find_recipe(20, 20).unwrap();
        assert!(g.discovered[boys_recipe], "Boy's recipe marked discovered");
    }

    #[test]
    fn forge_mastery_halves_cost_and_view_reflects_it() {
        let mut g = GameState::new(1, 0.0);
        assert_eq!(g.forge_cost(18), 50, "Epic output (Klein) costs 50");
        // The view's per-recipe costs mirror the truth (recipe 0 = Mö # Mö → Klein, Epic).
        assert_eq!(g.view().recipe_costs[0], 50, "view mirrors the recipe cost");
        g.upgrades[5] = 1; // forge_mastery (#5)
        assert_eq!(g.forge_cost(18), 25, "mastery halves the cost");
        assert_eq!(g.view().recipe_costs[0], 25, "view mirrors the discounted cost");
        // …and a forge at the discounted price succeeds with only 25 shards in the bank.
        g.owned[11] = 1;
        g.shards = 25;
        assert!(g.forge(11, 11).ok, "25 shards suffices once mastered");
        assert_eq!(g.shards, 100, "25 − 25 cost + 100 discovery reward");
    }

    #[test]
    fn forge_cost_scales_with_output_rarity() {
        let g = GameState::new(1, 0.0);
        assert_eq!(g.forge_cost(12), 30, "genus-2 is Rare → 30");
        assert_eq!(g.forge_cost(18), 50, "Klein is Epic → 50");
        assert_eq!(g.forge_cost(32), 90, "triple-torus is SSR → 90");
        // pair cost routes through the connected sum: ℝP² # ℝP² makes Klein (Epic) → 50.
        assert_eq!(g.pair_forge_cost(19, 19), 50, "ℝP² # ℝP² costs the Klein price");
        assert_eq!(g.pair_forge_cost(16, 16), 0, "non-forgeable pair has no cost");
    }

    #[test]
    fn inspect_raises_bond_and_buffs_when_deployed() {
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1;
        assert_eq!(g.bond_level(0), 0);
        for _ in 0..5 {
            g.inspect(0); // 5 × 25 = 125 ≥ 100 → level 1
        }
        assert_eq!(g.bond_level(0), 1);
        g.deploy(0);
        assert!((g.bond_mult() - 1.03).abs() < 1e-9, "deployed bond-1 → +3%");
    }

    #[test]
    fn pat_bond_gain_is_capped_per_window_then_refreshes() {
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1;
        g.owned[1] = 1;
        g.last_seen_ms = 10_000_000.0; // well past the initial (zeroed) window
        // Spam-patting one shape can only earn up to the per-shape cap this window — not unbounded.
        for _ in 0..100 {
            g.pat(0);
        }
        assert_eq!(g.bonds[0], BOND_PAT_CAP_PER_SHAPE, "pat affinity is capped within a window");
        assert_eq!(g.pat_gained[0], BOND_PAT_CAP_PER_SHAPE);
        // The cap is per shape: a different shape still has its own fresh budget.
        g.pat(1);
        assert!(g.bonds[1] > 0, "the cap is per shape, not global");
        // Inspect is the uncapped path — it still works regardless of the pat budget.
        let before = g.bonds[0];
        g.inspect(0);
        assert!(g.bonds[0] > before, "inspect is not subject to the pat cap");
        // Advance past the window → the pat budget refreshes and patting resumes.
        let mark = g.bonds[0];
        g.last_seen_ms += BOND_PAT_PERIOD_MS + 1.0;
        g.pat(0);
        assert!(g.bonds[0] > mark, "a new window grants a fresh pat budget");
        assert!(g.pat_gained[0] > 0 && g.pat_gained[0] <= BOND_PAT_CAP_PER_SHAPE);
    }

    #[test]
    fn claim_relic_costs_shards_and_excludes_from_core() {
        let mut g = GameState::new(1, 0.0);
        for i in 0..content::PULL_COUNT {
            g.owned[i] = 1; // own all pull shapes → core complete with zero relics
        }
        assert!(g.core_complete());
        assert_eq!(g.relics_owned(), 0);
        assert_eq!(g.claim_relic(), -1, "can't summon without shards");
        g.shards = 1200;
        let id = g.claim_relic();
        assert!(id >= content::PULL_COUNT as i32, "granted a Relic id");
        assert_eq!(g.shards, 700);
        assert_eq!(g.relics_owned(), 1);
        assert!(g.core_complete(), "Relics never affect core completion");
    }

    #[test]
    fn buy_upgrade_expands_floor_and_caps_at_max() {
        let mut g = GameState::new(1, 0.0);
        let base = g.effective_euler_cap();
        g.flux = 1e12; // plenty to max the upgrade at the density-scaled costs
        assert!(g.buy_upgrade(0)); // expand_floor
        assert_eq!(g.effective_euler_cap(), base + 2);
        assert_eq!(g.upgrade_level(0), 1);
        assert!(g.flux < 1e12, "flux was spent");
        for _ in 0..20 {
            g.buy_upgrade(0);
        }
        assert_eq!(
            g.upgrade_level(0),
            content::UPGRADES[0].max_level,
            "stops at max level"
        );
    }

    #[test]
    fn expand_floor_opens_a_ring_each_level() {
        // Regression for the dead-zone bug: pre-fix, floor_radius was derived from the χ cap, which never crossed
        // the radius-3 threshold (needs χ≥20; cap only reaches 18), so L1..L6 all sat at radius 2 / 19 cells — the
        // expensive late levels opened ZERO cells. Now each level opens a real hex ring up to the perf ceiling.
        let mut g = GameState::new(1, 0.0);
        g.flux = 1e12;
        let c0 = g.floor_cells(); // base (L0): radius 1 = 7 cells
        g.buy_upgrade(0);
        let c1 = g.floor_cells(); // L1: radius 2 = 19
        g.buy_upgrade(0);
        let c2 = g.floor_cells(); // L2: radius 3 = 37
        g.buy_upgrade(0);
        let c3 = g.floor_cells(); // L3: radius 4 = 61 (ORRERY_RADIUS ceiling)
        assert_eq!((c0, c1, c2, c3), (7, 19, 37, 61), "each of the first 3 levels opens a real ring");
        assert!(c1 > c0 && c2 > c1 && c3 > c2, "strictly growing — no dead level");
        g.buy_upgrade(0); // L4: past the ceiling
        assert_eq!(g.floor_cells(), 61, "floor clamps at ORRERY_RADIUS");
        assert!(g.effective_euler_cap() >= 6 + 2 * 4, "but L4 still raises the Euler budget (more deployable shapes)");
    }

    #[test]
    fn overflow_cap_is_multiplicative_and_stacks_with_resonance() {
        // Re-tune: overflow_cap was a flat +300/hr (~+2.8%/lvl) trap; now +8%/lvl multiplicative, stacking with the
        // overflow_resonance facet (+10%/lvl), which is left unchanged.
        let mut g = GameState::new(1, 0.0);
        let base = g.cap_rate();
        g.upgrades[7] = 1; // overflow_cap L1
        assert!((g.cap_rate() - base * 1.08).abs() < 1e-3, "L1 = +8% multiplicative");
        g.upgrades[7] = 4; // max
        assert!((g.cap_rate() - base * 1.32).abs() < 1e-3, "L4 = +32%");
        g.facet_perks[5] = 4; // overflow_resonance L4 (+40%)
        assert!((g.cap_rate() - base * 1.32 * 1.40).abs() < 1e-3, "stacks multiplicatively with the resonance facet");
    }

    #[test]
    fn auto_pull_gated_behind_solver_not_overflow_cap() {
        // Re-gate: automation (auto_pull) now hangs off solver_mk2 (the auto-arranger), not the overflow_cap trap —
        // so players no longer have to buy a dead upgrade to reach automation.
        let mut g = GameState::new(1, 0.0);
        assert!(!g.upgrade_unlocked(8), "auto_pull locked initially");
        g.upgrades[0] = 4; // expand_floor L4
        g.upgrades[7] = 1; // overflow_cap L1 — used to unlock auto_pull, now must NOT
        assert!(!g.upgrade_unlocked(8), "overflow_cap no longer gates auto_pull");
        g.upgrades[11] = 1; // solver_mk2 (its own gate, expand_floor L2, is already satisfied)
        assert!(g.upgrade_unlocked(8), "solver_mk2 now unlocks auto_pull");
    }

    #[test]
    fn genus_resonance_scales_per_level_and_per_distinct_genus() {
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1; // sphere — genus 0
        g.owned[10] = 1; // torus — genus 1
        g.deploy(0);
        g.deploy(10); // 2 distinct genera on the floor
        assert!((g.genus_resonance_mult() - 1.0).abs() < 1e-9, "L0 = no bonus");
        g.upgrades[1] = 1; // L1: +4%/genus × 2 = +8%
        assert!((g.genus_resonance_mult() - 1.08).abs() < 1e-9, "L1, 2 genera = +8%");
        g.upgrades[1] = 3; // L3: +12%/genus × 2 = +24% — the long axis the diversity build now chases
        assert!((g.genus_resonance_mult() - 1.24).abs() < 1e-9, "L3, 2 genera = +24%");
    }

    #[test]
    fn rate_after_upgrade_projects_without_mutating() {
        // The what-if behind the Workshop Δ/hr badge: projects a higher rate for the next multiplier level, but
        // is a pure projection (no state mutation, no flux spent).
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 1;
        g.owned[10] = 1;
        g.deploy(0);
        g.deploy(10); // some production on the floor
        g.upgrades[1] = 1; // genus_resonance L1
        let now = g.rate_per_hr();
        let after = g.rate_after_upgrade(1); // projects L2 (+more % per genus)
        assert!(after > now, "next genus_resonance level projects a higher rate ({now} -> {after})");
        assert_eq!(g.upgrade_level(1), 1, "projection did not mutate the real level");
        assert!((g.rate_per_hr() - now).abs() < 1e-9, "projection did not change the live rate");
    }

    #[test]
    fn doctrines_are_mutually_exclusive() {
        let mut g = GameState::new(1, 0.0);
        g.upgrades[1] = 1; // genus_resonance — the doctrines' (deeper) prereq
        assert!(g.upgrade_unlocked(13) && g.upgrade_unlocked(14), "both doctrines open before choosing");
        g.upgrades[13] = 1; // pick Mastery
        assert!(!g.upgrade_unlocked(14), "picking one doctrine permanently locks the other (the choke)");
        g.flux = 1e12;
        g.shards = 1_000_000;
        assert!(!g.buy_upgrade(14), "buy_upgrade refuses the excluded sibling even when affordable");
    }

    #[test]
    fn mastery_and_variety_doctrines_scale_production() {
        let mut g = GameState::new(1, 0.0);
        g.owned[0] = 64; // sphere — plenty of dupes → stars
        g.owned[10] = 64; // torus — a DIFFERENT family
        g.deploy(0);
        g.deploy(10);
        let base = g.globals_mult();
        g.upgrades[13] = 1; // Mastery: +4% per ★ across deployed shapes
        let stars = g.star_level(0) + g.star_level(10);
        assert!(stars > 0, "the board has stars to reward");
        assert!((g.globals_mult() / base - (1.0 + 0.04 * stars as f64)).abs() < 1e-9, "mastery = +4% per ★ (go TALL)");
        g.upgrades[13] = 0;
        g.upgrades[14] = 1; // Variety: +5% per distinct family — 2 families here → +10%
        assert!((g.globals_mult() / base - 1.10).abs() < 1e-9, "variety = +5% × 2 distinct families = +10% (go WIDE)");
    }

    #[test]
    fn polymath_facet_dissolves_the_doctrine_choke() {
        let mut g = GameState::new(1, 0.0);
        g.upgrades[1] = 1; // genus_resonance — the doctrines' prereq
        g.upgrades[13] = 1; // own Mastery
        assert!(!g.upgrade_unlocked(14), "without polymath, the other doctrine stays locked");
        g.facet_perks[7] = 1; // polymath — the rule-changer
        assert!(g.upgrade_unlocked(14), "polymath unlocks the other doctrine");
        g.owned[0] = 64;
        g.owned[10] = 64;
        g.deploy(0);
        g.deploy(10);
        g.upgrades[14] = 1; // now own BOTH
        let stars = g.star_level(0) + g.star_level(10);
        let expect = (1.0 + 0.04 * stars as f64) * 1.10; // mastery × variety(2 families)
        let mut g0 = g.clone();
        g0.upgrades[13] = 0;
        g0.upgrades[14] = 0;
        assert!((g.globals_mult() / g0.globals_mult() - expect).abs() < 1e-6, "both doctrines stack multiplicatively under polymath");
    }

    #[test]
    fn euler_surplus_rewards_unspent_euler_headroom() {
        let mut g = GameState::new(1, 0.0);
        assert!((g.euler_surplus_mult() - 1.0).abs() < 1e-9, "L0: no bonus");
        let h0 = g.effective_euler_cap() - g.euler_used(); // fresh board: full headroom
        g.upgrades[16] = 2; // euler_surplus L2
        assert!((g.euler_surplus_mult() - (1.0 + 0.06 * h0.min(6) as f64 * 2.0)).abs() < 1e-9, "L2 bonus = +6%×2 per spare χ (≤6)");
        g.owned[10] = 1; // deploy a torus (euler_cost > 0, unlike the free χ=2 sphere) → consume headroom
        g.deploy(10);
        let h1 = g.effective_euler_cap() - g.euler_used();
        assert!(h1 < h0, "deploying a non-trivial shape consumed Euler headroom");
        assert!((g.euler_surplus_mult() - (1.0 + 0.06 * h1.min(6) as f64 * 2.0)).abs() < 1e-9, "bonus tracks the live headroom");
    }

    #[test]
    fn euler_surplus_caps_at_6_headroom() {
        let mut g = GameState::new(1, 0.0);
        g.upgrades[0] = 6; // expand_floor → effective cap 6 + 2×6 = 18, headroom 18 (nothing deployed)
        g.upgrades[16] = 1;
        assert!(g.effective_euler_cap() - g.euler_used() > 6, "headroom exceeds the cap");
        assert!((g.euler_surplus_mult() - (1.0 + 0.06 * 6.0)).abs() < 1e-9, "the per-χ bonus is capped at 6 headroom");
    }

    #[test]
    fn overclock_off_is_bitstable_and_on_trades_cap_for_offline() {
        let mut g = GameState::new(1, 0.0);
        g.upgrades[18] = 1; // own overclock, but OFF (default) — must be bit-identical to not owning it
        let base_cap = {
            let mut g0 = g.clone();
            g0.upgrades[18] = 0;
            g0.cap_rate()
        };
        assert!((g.cap_rate() - base_cap).abs() < 1e-9, "owned-but-OFF overclock is bit-stable (cozy default protects the casual band)");
        g.overclock_on = true; // ON
        assert!((g.cap_rate() - base_cap * 1.6).abs() < 1.0, "ON lifts the production ceiling +60%");
        g.last_seen_ms = 0.0;
        let r = g.compute_offline(100.0 * 3_600_000.0); // 100h away
        assert!(r.capped_ms <= 4.0 * 3_600_000.0 + 1.0, "ON clamps offline catch-up to 4h (the price of the active ceiling)");
    }

    #[test]
    fn sink_doctrine_swaps_open_anchor_verb_to_absorb() {
        let cone_id = SHAPES.iter().position(|s| s.family == "cone").expect("cone shape exists");
        let mut g = GameState::new(1, 0.0);
        g.owned[cone_id] = 1;
        g.deploy(cone_id);
        let board0 = g.flux_board();
        assert!(!board0.emitters.is_empty(), "the cone deployed an emitter");
        assert!(board0.emitters.iter().all(|e| e.act2 != flux::Act::Absorb), "no sink before the doctrine — the dead Absorb verb stays dead");
        g.upgrades[15] = 1; // sink_doctrine
        let board1 = g.flux_board();
        let e = &board1.emitters[0];
        assert_eq!(e.act, flux::Act::Multiply { num: 5, den: 2 }, "sink primary = ×2.5");
        assert_eq!(e.act2, flux::Act::Absorb, "sink secondary = absorb (bank + stop, severing the chain)");
    }

    #[test]
    fn overpressure_zero_under_cap_and_online_offline_round_identically() {
        // (a) a normal sub-cap board spills nothing — overpressure NEVER touches/accelerates core flux.
        let mut g = GameState::new(1, 0.0);
        g.owned[10] = 1;
        g.deploy(10);
        g.upgrades[17] = 3;
        assert_eq!(g.overcap_shard_rate_per_hr(), 0.0, "sub-cap board spills no shards");
        let before = g.shards;
        g.last_seen_ms = 0.0;
        g.compute_offline(1000.0 * 3_600_000.0);
        assert_eq!(g.shards, before, "no spill shards accrue while under the cap");

        // (b) online (many small ticks) and offline (one span) accrue IDENTICAL spill shards over the same span —
        // both call the shared accrue_overcap_shards helper and thread the fractional carry (exercises the carry
        // iff the dev board runs over cap; equal either way).
        let mut online = GameState::new(2, 0.0);
        online.dev_unlock_all();
        online.dev_orrery_preset(2);
        online.upgrades[17] = 3;
        online.last_seen_ms = 0.0;
        let mut offline = online.clone();
        let step = 0.37 * 3_600_000.0; // odd step to stress fractional rounding
        let mut t = 0.0;
        for _ in 0..50 {
            t += step;
            online.tick(t);
        }
        offline.compute_offline(t);
        assert_eq!(online.shards, offline.shards, "spill shards round bit-identically online vs offline (carry determinism)");
    }

    #[test]
    fn milestones_latch_permanently_and_boost_production() {
        let mut g = GameState::new(1, 0.0);
        assert!((g.milestone_mult() - 1.0).abs() < 1e-9);
        for i in 0..10 {
            g.owned[i] = 1;
        }
        g.tick(1000.0); // refresh_milestones runs in tick
        assert!(g.milestones_done[0], "own-10 milestone latched");
        assert!(g.milestone_mult() > 1.0);
        // un-owning does NOT un-latch
        for i in 0..10 {
            g.owned[i] = 0;
        }
        g.tick(2000.0);
        assert!(g.milestones_done[0], "milestone stays latched");
    }

    #[test]
    fn achievement_effects_apply_by_kind() {
        let mut g = GameState::new(1, 0.0);
        let idx = |k: &str| {
            content::MILESTONES
                .iter()
                .position(|m| m.key == k)
                .unwrap_or_else(|| panic!("missing achievement key {k}"))
        };
        // baseline — no varied effects active
        let base_euler = g.effective_euler_cap();
        let base_forge_mult = g.milestone_forge_mult();
        assert!((g.milestone_shard_mult() - 1.0).abs() < 1e-9);
        assert_eq!(g.milestone_offline_hours(), 0.0);
        assert_eq!(g.milestone_affinity_bonus(), 0.0);

        g.milestones_done[idx("deploy_5")] = true; // Euler(1)
        assert_eq!(g.effective_euler_cap(), base_euler + 1, "Euler achievement raises the floor budget");

        g.milestones_done[idx("shards_100")] = true; // Shards(0.05)
        assert!(g.milestone_shard_mult() > 1.0, "Shards achievement boosts dupe shards");

        g.milestones_done[idx("flux_million")] = true; // Offline(4)
        assert!((g.milestone_offline_hours() - 4.0).abs() < 1e-9, "Offline achievement extends the away cap");

        g.milestones_done[idx("forge_10")] = true; // Forge(0.10)
        assert!(g.milestone_forge_mult() < base_forge_mult, "Forge achievement discounts forging");

        g.milestones_done[idx("first_bond")] = true; // Affinity(0.15)
        assert!(g.milestone_affinity_bonus() > 0.0, "Affinity achievement speeds bonds");

        // none of the above are Production — they must NOT inflate the production multiplier
        assert!((g.milestone_mult() - 1.0).abs() < 1e-9, "varied effects leave production untouched");
        g.milestones_done[idx("own_40")] = true; // Production(0.05)
        assert!(g.milestone_mult() > 1.0, "Production achievement boosts production");
    }

    #[test]
    fn flux_achievement_grants_once_on_latch() {
        let mut g = GameState::new(1, 0.0);
        let i = content::MILESTONES.iter().position(|m| m.key == "first_forge").unwrap();
        let before = g.flux;
        g.total_forges = 1; // satisfy first_forge's condition
        g.refresh_milestones();
        assert!(g.milestones_done[i], "first_forge latched");
        let after = g.flux;
        assert!(after > before, "Flux achievement paid its one-time grant on latch");
        g.refresh_milestones(); // idempotent
        assert!((g.flux - after).abs() < 1e-6, "Flux grant is one-time, never repeated");
    }

    #[test]
    fn dev_reset_unlocks_clears_collection_keeps_currency() {
        let mut g = GameState::new(1, 0.0);
        // build up a pile of progress
        g.dev_unlock_all();
        g.discovered.iter_mut().for_each(|d| *d = true);
        g.forged.iter_mut().for_each(|f| *f = true);
        g.milestones_done.iter_mut().for_each(|m| *m = true);
        g.bonds[1] = 50;
        g.cosmetics.push(5);
        g.scene = 3;
        g.total_forges = 12;
        let flux = g.flux;
        let upgrades = g.upgrades.clone();

        g.dev_reset_unlocks();

        // the collection is wiped back to the lone starter…
        assert_eq!(g.distinct_owned(), 1, "only the starter remains owned");
        assert_eq!(g.owned[STARTER_SHAPE], 1);
        assert!(g.discovered.iter().all(|&d| !d), "recipes reset");
        assert!(g.forged.iter().all(|&f| !f), "forged reset");
        assert!(g.milestones_done.iter().all(|&m| !m), "achievements reset");
        assert!(g.bonds.iter().all(|&b| b == 0), "bonds reset");
        assert!(g.cosmetics.is_empty(), "cosmetics reset");
        assert_eq!(g.scene, 0, "scene back to default");
        assert_eq!(g.total_forges, 0);
        // …but currency + upgrades are kept, so you can immediately re-pull
        assert_eq!(g.flux, flux, "Flux is preserved");
        assert_eq!(g.upgrades, upgrades, "upgrades preserved");
    }

    #[test]
    fn recrystallize_grants_facets_and_perks_apply() {
        let mut g = GameState::new(1, 0.0);
        for i in 0..content::PULL_COUNT {
            g.owned[i] = 1;
        }
        assert!(g.recrystallize());
        assert!(g.facets >= 4, "ascending grants Facets, got {}", g.facets);
        // buy resonant_floor (#1) → base Euler cap grows
        let cap = g.effective_euler_cap();
        g.facets = 100;
        assert!(g.buy_facet_perk(1));
        assert_eq!(g.effective_euler_cap(), cap + 1);
        // meta_production (#0) lifts the global production multiplier. BASE_IDLE is 0, so an empty board earns
        // nothing — check the multiplier directly rather than via a (zero) rate.
        let gm = g.globals_mult();
        assert!(g.buy_facet_perk(0));
        assert!(g.globals_mult() > gm);
    }

    #[test]
    fn buy_upgrade_rejects_when_too_poor() {
        let mut g = GameState::new(1, 0.0);
        g.flux = 0.0;
        assert!(!g.buy_upgrade(0));
        assert_eq!(g.upgrade_level(0), 0);
    }

    #[test]
    fn synergy_requires_adjacency() {
        let mut g = GameState::new(1, 0.0);
        let (a, b) = content::SYNERGY_PAIRS[0];
        g.owned[a] = 1;
        g.owned[b] = 1;
        g.loadout = vec![a, b];
        g.board_cells = vec![0, 1]; // cells 0 and 1 are orthogonally adjacent
        assert_eq!(g.synergy_count(), 1, "adjacent kin pair counts");
        let filler = (0..COUNT).find(|&i| i != a && i != b).unwrap();
        g.owned[filler] = 1;
        g.loadout = vec![a, filler, b];
        g.board_cells = vec![0, 7, 13]; // a and b placed far apart (not orthogonally adjacent)
        assert_eq!(
            g.synergy_count(),
            0,
            "non-adjacent kin pair gives no synergy"
        );
    }

    #[test]
    fn board_place_swap_and_undeploy_stay_parallel() {
        let mut g = GameState::new(1, 0.0);
        g.owned[1] = 1;
        g.owned[3] = 1;
        assert!(g.deploy(1)); // cell 0
        assert!(g.deploy(3)); // cell 1
        assert_eq!(g.board_cells, vec![0, 1]);
        assert!(g.place_at(1, 1)); // move shape 1 → cell 1, swapping shape 3 to cell 0
        let i1 = g.loadout.iter().position(|&x| x == 1).unwrap();
        let i3 = g.loadout.iter().position(|&x| x == 3).unwrap();
        assert_eq!(g.board_cells[i1], 1);
        assert_eq!(g.board_cells[i3], 0);
        assert!(g.undeploy(1));
        assert_eq!(g.loadout.len(), g.board_cells.len()); // arrays stay parallel
    }

    #[test]
    fn auto_arrange_orders_for_synergy() {
        let mut g = GameState::new(1, 0.0);
        let (a, b) = content::SYNERGY_PAIRS[0];
        g.owned[a] = 1;
        g.owned[b] = 1;
        g.owned[0] = 1; // a free filler that would separate the pair under a naive sort
        g.auto_arrange();
        assert!(g.loadout.contains(&a) && g.loadout.contains(&b));
        assert!(
            g.synergy_count() >= 1,
            "auto-arrange should place the kin pair adjacent"
        );
    }

    #[test]
    fn stars_scale_deployed_production() {
        let mut g = GameState::new(1, 0.0);
        let id = 10; // torus (genus 1) — handle-lane scales with stars
        g.owned[id] = 1;
        g.loadout = vec![id];
        g.board_cells = vec![0];
        let base = g.rate_per_hr();
        g.owned[id] = 100; // many dupes → ★5
        assert!(g.star_level(id) > 0);
        assert!(g.rate_per_hr() > base, "stars increase production");
    }

    #[test]
    fn platonic_set_bonus_applies() {
        let mut g = GameState::new(1, 0.0);
        assert!((g.set_bonus_mult() - 1.0).abs() < 1e-9);
        for &id in content::PLATONIC_IDS.iter() {
            g.owned[id] = 1;
        }
        assert!((g.set_bonus_mult() - 1.15).abs() < 1e-9);
    }

    #[test]
    fn polytope_and_knot_set_bonuses_apply() {
        let mut g = GameState::new(1, 0.0);
        let base = g.set_bonus_mult();
        for (id, s) in SHAPES.iter().enumerate() {
            if content::is_polytope_4d(s.family) {
                g.owned[id] = 1;
            }
        }
        assert!((g.set_bonus_mult() - base - POLYTOPE_SET_MULT).abs() < 1e-9, "completing the 4D-polytope set adds its bonus");
        for (id, s) in SHAPES.iter().enumerate() {
            if content::is_knot(s.family) {
                g.owned[id] = 1;
            }
        }
        assert!((g.set_bonus_mult() - base - POLYTOPE_SET_MULT - KNOT_SET_MULT).abs() < 1e-9, "the knot set adds its bonus too");
    }

    #[test]
    fn recrystallize_after_auto_arrange_does_not_panic() {
        let mut g = GameState::new(1, 0.0);
        for id in 0..content::PULL_COUNT {
            g.owned[id] = 1; // own the core → eligible to ascend
        }
        g.auto_arrange(); // populates board_cells + the loadout
        assert!(g.recrystallize(), "ascend succeeds once the core is complete");
        // regression: a tick right after ascend used to index a stale board_cells into the now-empty loadout
        g.tick(1_000.0);
        let _ = g.rate_per_hr();
        let _ = g.synergy_count();
    }
}
