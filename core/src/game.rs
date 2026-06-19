//! Game state + use cases (the application ring). All authoritative numbers live here; the web layer only
//! mirrors the views. Pure `GameState` is unit-tested natively; the thin `#[wasm_bindgen] Game` wrapper
//! exposes JSON to TypeScript.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

use crate::content::{self, COUNT, SHAPES};
use crate::gacha::{banner_unit, relic_unit, roll_rarity, shape_index, PityState, Rarity};
use crate::orrery::{self, OrreryState, Placement};

const SCHEMA_VERSION: u32 = 2;
const PULL_COST: f64 = 100.0;
const TEN_PULL_COST: f64 = 1000.0; // 11 pulls for the price of 10
const BASE_IDLE: f64 = 60.0; // Flux/hr with an empty loadout
const RATE_CAP: f64 = 900.0; // Flux/hr cap before prestige (DESIGN §7)
const OFFLINE_CAP_MS: f64 = 24.0 * 3_600_000.0; // generous full-day cap — respects absence (only ever helps idle players, never speeds active play)
const START_EULER_CAP: u32 = 6;
const START_FLUX: f64 = 350.0; // onboarding: ~3 pulls in hand immediately, no 100-minute wait
const STARTER_SHAPE: usize = 0; // Pip the sphere — the friendliest common + the Euler-ballast anchor
const BOARD_W: usize = 5; // the Engine floor is a 5×5 grid; placement is a spatial puzzle (2D adjacency)
const BOARD_H: usize = 5;
const BOARD_N: usize = BOARD_W * BOARD_H;
const RELIC_COST: u64 = 500; // shards to summon a Relic (the prestigious dupe-shard sink)
const BANNER_RATEUP: f64 = 0.5; // on a themed banner, chance the within-tier pick is steered to a featured shape
const RELIC_DROP_STD: f64 = 0.003; // rare "lucky find": chance any pull turns up a missing Relic (Standard banner)
const RELIC_DROP_BANNER: f64 = 0.006; // …doubled on a themed banner (more reason to pull the rotating one)
const MS_PER_HOUR: f64 = 3_600_000.0;
const FORGE_COST: u64 = 50; // shards to forge
const BOND_INSPECT_GAIN: u32 = 25; // affinity per inspect (the calm idler's path to bonds)
const BOND_PAT_GAIN: u32 = 5; // affinity per pat/rub (very minor; rate-limited in the UI)
const BOND_THRESHOLDS: [u32; 6] = [0, 100, 300, 700, 1500, 3000]; // levels 0..5
const PLATONIC_SET_MULT: f64 = 0.15; // +15% global for completing the Platonic set
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
    // ── cosmetics (Shop) ──
    #[serde(default)]
    pub cosmetics: Vec<u32>, // owned scene cosmetic ids (id 0 is the free default)
    #[serde(default)]
    pub scene: u32, // selected scene id
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
}

/// One shape's lane, for the UI to render + animate on the hex floor. `path` is the absolute hex cells (axial
/// `[q,r]`) visited in order, one per tick; cell at tick t = path[(phase + t) % period].
#[derive(Serialize)]
pub struct OrbitView {
    pub anchor: (i32, i32),    // the draggable anchor cell (axial q,r)
    pub path: Vec<(i32, i32)>, // absolute hex cells over one period
    pub phase: u8,
    pub period: u8,
    pub axis: u8,    // hex direction the lane points (0..6)
    pub tuned: bool, // the player has placed/tuned this lane
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
    pub core_complete: bool,
    pub bonds: Vec<u32>,
    pub bond_levels: Vec<u32>,
    pub discovered: Vec<bool>,
    pub platonic_set: bool,
    pub relics_owned: u32,
    pub relic_count: u32,
    pub relic_cost: u64,
    pub cosmetics: Vec<u32>,
    pub scene: u32,
    pub lifetime_flux: f64,
    pub lifetime_shards: u64,
    pub total_forges: u32,
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
    pub mult_crossdim: f64,
    pub mult_signature: f64,
    pub mult_shape_effects: f64, // aggregate of the deployed shapes' own effects (handle-lane★ · overdrive · knots · signature)
    pub upgrade_costs: Vec<(f64, u64)>, // NEXT-level (flux, shard) cost per upgrade — UI displays, never recomputes
    pub upgrade_unlocked: Vec<bool>,    // tech-tree gate per upgrade (prereq satisfied)
    pub facet_perk_costs: Vec<u64>,     // NEXT-level Facet cost per perk
    // ── Orrery (engine v2; UI tweens the orbit motion from these) ──
    pub use_orrery: bool,
    pub orrery_radius: i32,            // hex grid radius
    pub orrery_cells: Vec<(i32, i32)>, // all anchor cells in the region (axial q,r) — the floor
    pub orrery_period: u32,            // system period L (ticks per full cycle)
    pub orrery_tick_ms: f64,           // real ms per orbital step
    pub orrery_orbits: Vec<OrbitView>, // parallel to loadout
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
            cosmetics: Vec::new(),
            scene: 0,
            lifetime_flux: 0.0,
            lifetime_shards: 0,
            total_forges: 0,
            pulls_by_rarity: vec![0; 5],
            upgrades: vec![0; content::UPGRADE_COUNT],
            milestones_done: vec![false; content::MILESTONE_COUNT],
            facets: 0,
            facet_perks: vec![0; content::FACET_PERK_COUNT],
            current_banner: 0,
            use_orrery: false,
            orbit_tune: BTreeMap::new(),
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
                p
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
        RATE_CAP + 300.0 * self.upgrade_level(7) as f64 // overflow_cap (#7)
    }

    /// Product of every global multiplier (prestige, set, bonds, synergy, …) — applied on top of the
    /// capped base rate. Shared by the static-board and Orrery paths so they stack identically.
    fn globals_mult(&self) -> f64 {
        self.prestige_mult
            * self.set_bonus_mult()
            * self.bond_mult()
            * self.synergy_mult()
            * self.genus_resonance_mult()
            * self.milestone_mult()
            * self.facet_meta_mult()
            * self.ballast_mult()
            * self.crossdim_mult()
            * self.signature_global_mult()
    }

    pub fn rate_per_hr(&self) -> f64 {
        let production = if self.use_orrery {
            self.orrery_avg_prod_per_hr()
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
                let region = orrery::hex_region(ORRERY_RADIUS);
                let a = region[slot % region.len()];
                (
                    a,
                    content::default_axis(def) as usize,
                    content::default_phase(def, slot),
                )
            }
        }
    }

    /// A loadout shape's lane as an orbit (absolute hex path from its anchor along its axis; period from topology).
    fn tuned_orbit(&self, id: usize, slot: usize) -> orrery::Orbit {
        let (anchor, axis, phase) = self.lane_params(id, slot);
        let path = orrery::lane_path(anchor, axis, content::lane_len(&SHAPES[id]));
        let p = path.len().max(1);
        orrery::Orbit {
            path,
            phase: (phase as usize % p) as u8,
        }
    }

    /// Build the orbit arrangement from the current loadout (placement `shape` = loadout slot index, so the
    /// base-rate / pair-bonus tables below index by slot).
    fn orrery_state(&self) -> OrreryState {
        OrreryState {
            placements: self
                .loadout
                .iter()
                .enumerate()
                .map(|(i, &id)| Placement {
                    shape: i as u16,
                    orbit: self.tuned_orbit(id, i),
                })
                .collect(),
        }
    }

    /// `(per-period prefix sums, system period L)` for the current loadout. Base = each shape's self-prod
    /// in per-tick µ-units; the meeting `pair_bonus` is **knot entanglement** — the only old *spatial*
    /// effect (board adjacency) now triggered by co-location. All other effects stay global.
    fn orrery_prefix(&self) -> (Vec<u64>, u32) {
        let self_prod = self.per_shape_self_prod(); // flux/hr per slot
        let to_units = |per_hr: f64| (per_hr / 3600.0 * ORRERY_SCALE).round().max(0.0) as u64;
        let base: Vec<u64> = self_prod.iter().map(|&p| to_units(p)).collect();
        let knot_amt: Vec<f64> = self
            .loadout
            .iter()
            .map(|&id| {
                if content::is_knot(SHAPES[id].family) {
                    0.15 * (1.0 + 0.15 * self.star_level(id) as f64)
                } else {
                    0.0
                }
            })
            .collect();
        let pair = |a: u16, b: u16| -> u64 {
            let (a, b) = (a as usize, b as usize);
            // a knot lifts whom it meets (and vice-versa) — the entanglement bonus, as added flux/hr.
            to_units(knot_amt[a] * self_prod[b] + knot_amt[b] * self_prod[a])
        };
        let st = self.orrery_state();
        let l = st.system_period();
        (st.period_prefix(&base, &pair), l)
    }

    /// Sustained Orrery production (flux/hr) = per-period average, mapped back to an hourly rate.
    fn orrery_avg_prod_per_hr(&self) -> f64 {
        if self.loadout.is_empty() {
            return 0.0;
        }
        let (prefix, l) = self.orrery_prefix();
        if l == 0 {
            return 0.0;
        }
        (prefix[l as usize] as f64 / l as f64) / ORRERY_SCALE * (3600.0 / ORRERY_TICK_SECONDS)
    }

    /// Closed-form Orrery catch-up over a (pre-capped) span — O(1) in the span length: the exact periodic
    /// production via `orrery::offline_flux`, throttled by the rate cap, plus the idle floor, times globals.
    fn orrery_offline_gain(&self, capped_ms: f64) -> f64 {
        let idle_hours = capped_ms / MS_PER_HOUR;
        if self.loadout.is_empty() {
            return BASE_IDLE.min(self.cap_rate()) * idle_hours * self.globals_mult();
        }
        let (prefix, l) = self.orrery_prefix();
        let tick_ms = ORRERY_TICK_SECONDS * 1000.0;
        let ticks = (capped_ms / tick_ms).floor() as u64;
        let t0 = ((self.last_seen_ms / tick_ms).floor() as i64).rem_euclid(l as i64) as u32;
        let raw_prod_flux = orrery::offline_flux(&prefix, t0, ticks) as f64 / ORRERY_SCALE;
        // The cap applies to (BASE_IDLE + production rate); throttle the production by how far it overshoots.
        let avg_prod =
            (prefix[l as usize] as f64 / l as f64) / ORRERY_SCALE * (3600.0 / ORRERY_TICK_SECONDS);
        let room = (self.cap_rate() - BASE_IDLE).max(0.0);
        let prod_factor = if avg_prod > room && avg_prod > 1e-9 {
            room / avg_prod
        } else {
            1.0
        };
        (BASE_IDLE * idle_hours + raw_prod_flux * prod_factor) * self.globals_mult()
    }

    /// Family set bonus (M7): completing the 5 Platonic solids grants a permanent global multiplier.
    pub fn set_bonus_mult(&self) -> f64 {
        let platonic = content::PLATONIC_IDS.iter().all(|&id| self.owned[id] > 0);
        1.0 + if platonic { PLATONIC_SET_MULT } else { 0.0 }
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
        self.euler_cap + 2 * self.upgrade_level(0) + self.facet_level(1) // resonant_floor
    }
    fn affinity_mult(&self) -> f64 {
        if self.upgrade_level(6) > 0 {
            1.5
        } else {
            1.0
        } // affinity_bloom
    }
    /// genus_resonance (#1): +6% production per DISTINCT genus among deployed shapes.
    fn genus_resonance_mult(&self) -> f64 {
        if self.upgrade_level(1) == 0 {
            return 1.0;
        }
        let mut genera: Vec<u32> = self.loadout.iter().map(|&id| SHAPES[id].genus).collect();
        genera.sort_unstable();
        genera.dedup();
        1.0 + 0.06 * genera.len() as f64
    }
    /// Tech-tree gate: an upgrade is unlocked when its prereq (if any) is at the required level.
    pub fn upgrade_unlocked(&self, id: usize) -> bool {
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

    fn milestone_condition(&self, i: usize) -> bool {
        match i {
            0 => self.distinct_owned() >= 10,
            1 => self.distinct_owned() >= 25,
            2 => self.core_complete(),
            3 => self.discovered.iter().filter(|&&d| d).count() >= 3,
            4 => (0..COUNT).any(|id| self.bond_level(id) >= 5),
            5 => self.synergy_count() >= 3,
            6 => self.relics_owned() == (content::COUNT - content::PULL_COUNT) as u32,
            7 => content::PLATONIC_IDS.iter().all(|&id| self.owned[id] > 0),
            8 => self.ng_cycle >= 1,
            _ => false,
        }
    }
    /// Latch any newly-achieved milestones (idempotent; called from tick).
    fn refresh_milestones(&mut self) {
        for i in 0..content::MILESTONE_COUNT {
            if !self.milestones_done[i] && self.milestone_condition(i) {
                self.milestones_done[i] = true;
            }
        }
    }
    pub fn milestone_mult(&self) -> f64 {
        let mut m = 1.0;
        for (i, &done) in self.milestones_done.iter().enumerate() {
            if done && i < content::MILESTONE_COUNT {
                m += content::MILESTONES[i].bonus;
            }
        }
        m
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
        let reward = 2.0 + SHAPES[id].base_prod * 0.02;
        self.flux += reward;
        self.lifetime_flux += reward;
        reward
    }

    /// A "pat" — a very minor affinity bump (rate-limited by the UI).
    pub fn pat(&mut self, id: usize) {
        if id < COUNT && self.owned[id] > 0 {
            let cap = *BOND_THRESHOLDS.last().unwrap();
            let gain = (BOND_PAT_GAIN as f64 * self.affinity_mult()) as u32;
            self.bonds[id] = (self.bonds[id] + gain).min(cap);
        }
    }

    /// Forge two owned shapes via a connected-sum recipe; grants the output, costs shards, flags discovery.
    pub fn forge(&mut self, a: usize, b: usize) -> ForgeResult {
        let fail = ForgeResult {
            ok: false,
            out_id: -1,
            is_discovery: false,
        };
        let Some(ri) = content::find_recipe(a, b) else {
            return fail;
        };
        let cost = if self.upgrade_level(5) > 0 {
            25
        } else {
            FORGE_COST
        }; // forge_mastery (#5)
        if a >= COUNT
            || b >= COUNT
            || self.owned[a] == 0
            || self.owned[b] == 0
            || self.shards < cost
        {
            return fail;
        }
        self.shards -= cost;
        self.total_forges += 1;
        let out = content::RECIPES[ri].out;
        self.grant(out, SHAPES[out].rarity);
        let is_discovery = !self.discovered[ri];
        self.discovered[ri] = true;
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

    /// Foreground accumulation (rate is piecewise-constant between actions → O(1)).
    pub fn tick(&mut self, now_ms: f64) {
        let dt = (now_ms - self.last_seen_ms).max(0.0);
        let gain = self.rate_per_hr() * (dt / MS_PER_HOUR);
        self.flux += gain;
        self.lifetime_flux += gain;
        self.add_affinity(dt);
        self.refresh_milestones();
        self.last_seen_ms = now_ms;
    }

    /// Closed-form offline catch-up (same formula, capped). Instant even after weeks away.
    pub fn compute_offline(&mut self, now_ms: f64) -> OfflineReport {
        let elapsed = (now_ms - self.last_seen_ms).max(0.0);
        let cap = OFFLINE_CAP_MS + self.upgrade_level(3) as f64 * 12.0 * MS_PER_HOUR; // patience (#3)
        let capped = elapsed.min(cap);
        let gained = if self.use_orrery {
            self.orrery_offline_gain(capped) // exact periodic, closed-form O(1)
        } else {
            self.rate_per_hr() * (capped / MS_PER_HOUR)
        };
        self.flux += gained;
        self.lifetime_flux += gained;
        self.add_affinity(capped);
        self.last_seen_ms = now_ms;
        OfflineReport {
            elapsed_ms: elapsed,
            capped_ms: capped,
            gained_flux: gained,
        }
    }

    fn first_missing(&self, range: std::ops::Range<usize>) -> Option<usize> {
        range.into_iter().find(|&id| self.owned[id] == 0)
    }

    fn grant(&mut self, id: usize, r: Rarity) -> (bool, u64) {
        let was_new = self.owned[id] == 0;
        self.owned[id] += 1;
        if was_new {
            (true, 0)
        } else {
            let mut mult = if self.upgrade_level(4) > 0 { 1.5 } else { 1.0 }; // shard_dividend (#4)
            mult *= 1.0 + 0.15 * self.facet_level(3) as f64; // collectors_eye
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
    fn pick_pull_shape(
        &self,
        rarity: Rarity,
        range: &std::ops::Range<usize>,
        counter: u64,
    ) -> usize {
        let b = self.current_banner as usize;
        if b < content::BANNER_COUNT && !content::BANNERS[b].featured.is_empty() {
            let featured: Vec<usize> = content::BANNERS[b]
                .featured
                .iter()
                .copied()
                .filter(|id| range.contains(id))
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
            Rarity::Ur | Rarity::Ssr => self
                .first_missing(range.clone())
                .unwrap_or(range.start + shape_index(self.master_seed, counter, range.len())),
            _ => range.start + shape_index(self.master_seed, counter, range.len()),
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
        let roll = roll_rarity(self.master_seed, &mut self.pity);
        let range = content::rarity_range(roll.rarity);

        // Rare "lucky find": a small chance the pull turns up a missing Relic instead of the rolled shape.
        let relic_chance = if self.current_banner == 0 {
            RELIC_DROP_STD
        } else {
            RELIC_DROP_BANNER
        };
        let (id, out_rarity) = match (
            relic_unit(self.master_seed, c_before) < relic_chance,
            self.first_missing(content::rarity_range(Rarity::Relic)),
        ) {
            (true, Some(rid)) => (rid, Rarity::Relic),
            _ => (
                self.pick_pull_shape(roll.rarity, &range, c_before),
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
                .first_missing(content::rarity_range(Rarity::Ur))
                .or_else(|| self.first_missing(content::rarity_range(Rarity::Ssr)));
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
        orrery::hex_region(ORRERY_RADIUS)
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
        if !self.loadout.contains(&id) || orrery::hex_dist(q, r) > ORRERY_RADIUS {
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
        for id in ids {
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

    /// Reposition shapes on the 2D board to maximise the ACTUAL rate — solving the spatial puzzle (kin pairs
    /// touching, knots central so they entangle 4 neighbours). Deterministic hill-climb: move/swap each shape
    /// to every cell and keep any change that raises the rate.
    fn optimize_placement(&mut self) {
        let n = self.loadout.len();
        if n < 2 {
            return;
        }
        let mut best = self.rate_per_hr();
        let mut improved = true;
        let mut guard = 0;
        while improved && guard < 8 {
            improved = false;
            guard += 1;
            for i in 0..n {
                for target in 0..BOARD_N as u8 {
                    let cur = self.board_cells[i];
                    if cur == target {
                        continue;
                    }
                    let occ = self.board_cells.iter().position(|&c| c == target);
                    self.board_cells[i] = target;
                    if let Some(j) = occ {
                        self.board_cells[j] = cur;
                    }
                    let r = self.rate_per_hr();
                    if r > best + 1e-9 {
                        best = r;
                        improved = true;
                    } else {
                        self.board_cells[i] = cur; // revert
                        if let Some(j) = occ {
                            self.board_cells[j] = target;
                        }
                    }
                }
            }
        }
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
        self.owned[content::PULL_COUNT..]
            .iter()
            .filter(|&&c| c > 0)
            .count() as u32
    }

    /// Summon a Relic (famous CG model) — earned with banked dupe-shards, not pulled. Grants the next
    /// un-owned Relic. Returns its id, or -1 if not enough shards / all Relics owned.
    pub fn claim_relic(&mut self) -> i32 {
        if self.shards < RELIC_COST {
            return -1;
        }
        let next = content::rarity_range(Rarity::Relic).find(|&id| self.owned[id] == 0);
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
        if !self.core_complete() {
            return false;
        }
        self.ng_cycle += 1;
        self.viewport_dim += 1;
        self.prestige_mult = self.prestige_base().powi(self.ng_cycle as i32); // ascendant raises the base
        self.euler_cap = START_EULER_CAP + self.ng_cycle; // +1 budget headroom per ascent
        self.loadout.clear();
        self.flux = 500.0 * self.ng_cycle as f64 + 600.0 * self.facet_level(2) as f64; // crystalline_start head-start
        self.facets += 3 + self.ng_cycle as u64; // Facets — the prestige meta-currency
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
        // migration chain would run here for older versions; v1 is current.
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
            core_complete: self.core_complete(),
            bonds: self.bonds.clone(),
            bond_levels: (0..COUNT).map(|i| self.bond_level(i)).collect(),
            discovered: self.discovered.clone(),
            platonic_set: content::PLATONIC_IDS.iter().all(|&id| self.owned[id] > 0),
            relics_owned: self.relics_owned(),
            relic_count: (content::COUNT - content::PULL_COUNT) as u32,
            relic_cost: RELIC_COST,
            cosmetics: self.cosmetics.clone(),
            scene: self.scene,
            lifetime_flux: self.lifetime_flux,
            lifetime_shards: self.lifetime_shards,
            total_forges: self.total_forges,
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
            mult_crossdim: self.crossdim_mult(),
            mult_signature: self.signature_global_mult(),
            mult_shape_effects: {
                let base: f64 = self
                    .loadout
                    .iter()
                    .map(|&id| SHAPES[id].base_prod * (1.0 + 0.25 * SHAPES[id].genus as f64))
                    .sum();
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
            use_orrery: self.use_orrery,
            orrery_radius: ORRERY_RADIUS,
            orrery_cells: orrery::hex_region(ORRERY_RADIUS),
            orrery_period: self.orrery_state().system_period(),
            orrery_tick_ms: ORRERY_TICK_SECONDS * 1000.0,
            orrery_orbits: self
                .loadout
                .iter()
                .enumerate()
                .map(|(i, &id)| {
                    let (anchor, axis, _) = self.lane_params(id, i);
                    let o = self.tuned_orbit(id, i);
                    OrbitView {
                        anchor,
                        path: o.path.iter().map(|&c| orrery::unpack(c)).collect(),
                        phase: o.phase,
                        period: o.period() as u8,
                        axis: axis as u8,
                        tuned: self.orbit_tune.contains_key(&(id as u16)),
                    }
                })
                .collect(),
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
    pub fn buy_cosmetic(&mut self, id: u32, cost: f64) -> bool {
        self.state.buy_cosmetic(id, cost)
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
        bonus: f64,
    }
    let rows: Vec<MilestoneRow> = content::MILESTONES
        .iter()
        .map(|m| MilestoneRow {
            key: m.key,
            bonus: m.bonus,
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
    fn orrery_every_shapedef_orbit_valid() {
        // Every shape's lane period is in the allowed set ⇒ any loadout's lcm ≤ L_CAP (offline stays O(1)).
        let region = orrery::hex_region(ORRERY_RADIUS);
        for (id, def) in SHAPES.iter().enumerate() {
            let per = content::lane_period(def);
            assert!(
                orrery::ALLOWED_PERIODS.contains(&per),
                "shape {id} got lane period {per}"
            );
        }
        // Even the entire catalogue, each on its own anchor, respects the cap.
        let st = OrreryState {
            placements: (0..COUNT)
                .map(|id| {
                    let anchor = region[id % region.len()];
                    let path = orrery::lane_path(
                        anchor,
                        content::default_axis(&SHAPES[id]) as usize,
                        content::lane_len(&SHAPES[id]),
                    );
                    Placement {
                        shape: id as u16,
                        orbit: orrery::Orbit { path, phase: 0 },
                    }
                })
                .collect(),
        };
        assert!(st.checked_system_period().is_some());
        assert!(st.system_period() <= orrery::L_CAP);
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
        let static_rate = g.rate_per_hr();
        g.use_orrery = true;
        let orrery_rate = g.rate_per_hr();
        assert!(orrery_rate > 0.0);
        g.use_orrery = false;
        assert_eq!(g.rate_per_hr().to_bits(), static_rate.to_bits()); // flag off ⇒ unchanged
                                                                      // orrery prefix is deterministic
        g.use_orrery = true;
        assert_eq!(g.orrery_prefix(), g.orrery_prefix());
    }

    #[test]
    fn orrery_tuning_preserves_period_and_offline_o1() {
        let mut g = GameState::new(7, 0.0);
        for id in 0..6 {
            g.owned[id] = 1;
        }
        g.auto_arrange();
        g.use_orrery = true;
        g.ensure_anchors(); // materialise the topology-default lanes
        g.last_seen_ms = 0.0;
        let period_before = g.orrery_state().system_period();
        let base = g.clone().compute_offline(90_000.0);

        // tune the first deployed shape: rotate its lane + re-phase (NOT the anchor)
        let id = g.loadout[0];
        g.cycle_axis(id);
        g.set_lane_phase(id, 3);

        // period (⇒ lcm ⇒ O(1) offline) is unchanged by tuning
        assert_eq!(g.orrery_state().system_period(), period_before);
        assert!(g.orrery_state().checked_system_period().is_some());
        assert!(g.orrery_state().system_period() <= orrery::L_CAP);

        // offline still bit-stable across calls, seconds AND weeks (closed form, no per-tick loop)
        let s1 = g.clone().compute_offline(90_000.0);
        let s2 = g.clone().compute_offline(90_000.0);
        assert_eq!(s1.gained_flux.to_bits(), s2.gained_flux.to_bits());
        let weeks = g.clone().compute_offline(14.0 * 24.0 * 3_600_000.0);
        assert_eq!(weeks.capped_ms, OFFLINE_CAP_MS);
        assert!(weeks.gained_flux.is_finite() && weeks.gained_flux > 0.0);

        // reset axis+phase → bit-identical to the pre-tune default
        g.reset_lane(id);
        let after = g.clone().compute_offline(90_000.0);
        assert_eq!(after.gained_flux.to_bits(), base.gained_flux.to_bits());
    }

    #[test]
    fn orrery_tune_changes_phase_not_period() {
        let mut g = GameState::new(3, 0.0);
        for id in 0..6 {
            g.owned[id] = 1;
        }
        g.auto_arrange();
        g.use_orrery = true;
        g.ensure_anchors();
        let id = g.loadout[0];
        let base = g.tuned_orbit(id, 0);
        let new_phase = (base.phase + 1) % base.period() as u8;
        g.set_lane_phase(id, new_phase);
        let tuned = g.tuned_orbit(id, 0);
        assert_eq!(base.period(), tuned.period()); // period preserved (lcm safe)
        assert_eq!(tuned.phase, new_phase); // phase actually moved
        assert_ne!(base.phase, tuned.phase);
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
        g.flux = 250.0;
        let before: u32 = g.owned.iter().sum();
        let out = g.pull(0.0);
        assert!(out.ok);
        assert!(out.shape_id >= 0);
        assert!((g.flux - 150.0).abs() < 1e-6); // 250 − 100
        assert_eq!(g.owned.iter().sum::<u32>(), before + 1); // pull granted exactly one copy
                                                             // can't pull when broke
        g.flux = 50.0;
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
        // free commons (cost 0) should all be deployed
        assert!((0..10).all(|i| g.loadout.contains(&i)));
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
    fn forge_fails_without_owned_or_shards_or_recipe() {
        let mut g = GameState::new(1, 0.0);
        g.shards = 100;
        assert!(!g.forge(11, 11).ok, "can't forge unowned inputs");
        g.owned[10] = 1;
        g.shards = 10;
        assert!(!g.forge(10, 10).ok, "not enough shards");
        g.shards = 100;
        assert!(!g.forge(0, 1).ok, "no recipe for sphere + cube");
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
        g.flux = 1_000_000.0;
        assert!(g.buy_upgrade(0)); // expand_floor
        assert_eq!(g.effective_euler_cap(), base + 2);
        assert_eq!(g.upgrade_level(0), 1);
        assert!(g.flux < 1_000_000.0, "flux was spent");
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
        // meta_production (#0) lifts the rate multiplier
        let before = g.milestone_mult(); // sanity unrelated; check facet_meta via rate
        let r0 = g.rate_per_hr();
        assert!(g.buy_facet_perk(0));
        assert!(g.rate_per_hr() > r0);
        let _ = before;
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
}
