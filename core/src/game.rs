//! Game state + use cases (the application ring). All authoritative numbers live here; the web layer only
//! mirrors the views. Pure `GameState` is unit-tested natively; the thin `#[wasm_bindgen] Game` wrapper
//! exposes JSON to TypeScript.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

use crate::content::{self, COUNT, SHAPES};
use crate::flux;
use crate::gacha::{banner_unit, relic_unit, roll_rarity, shape_index, PityState, Rarity};
use crate::orrery::{self};

const SCHEMA_VERSION: u32 = 2;
const PULL_COST: f64 = 100.0 * content::FLUX_DENSITY;
const TEN_PULL_COST: f64 = 1000.0 * content::FLUX_DENSITY; // 11 pulls for the price of 10
const BASE_IDLE: f64 = 0.0; // an empty orrery earns nothing — production comes only from deployed shapes
const RATE_CAP: f64 = 10800.0; // Flux/hr cap before prestige (DESIGN §7); scaled ~12× with base_prod (first-run retune)
const OFFLINE_CAP_MS: f64 = 24.0 * 3_600_000.0; // generous full-day cap — respects absence (only ever helps idle players, never speeds active play)
const START_EULER_CAP: u32 = 6;
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
    fn overcap_shard_rate_per_hr(&self) -> f64 {
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
        self.add_affinity(capped);
        self.last_seen_ms = now_ms;
        OfflineReport {
            elapsed_ms: elapsed,
            capped_ms: capped,
            gained_flux: gained,
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
        g.upgrades[0] = 2; // expand_floor L2 — the doctrines' prereq
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
        g.upgrades[0] = 2; // expand_floor L2
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
