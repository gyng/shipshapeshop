//! Static content table: the 41 launch shapes (DESIGN.md §8, CHARACTERS.md roster).
//!
//! A shape is **data**: a descriptor the game economy reads and the web layer turns into geometry. Ordered
//! contiguously by rarity tier so a gacha `(rarity, index)` maps directly to a shape id.

use crate::gacha::Rarity;

#[derive(Clone, Copy)]
pub struct ShapeDef {
    pub nick: &'static str,
    /// Geometry-generator key consumed by the web layer (M2).
    pub family: &'static str,
    pub rarity: Rarity,
    /// Number of holes (handle lanes, M7).
    pub genus: u32,
    /// Euler-budget cost to deploy — typically max(0, 2 − χ), but tuned per shape for game balance
    /// (exotic/fractal Relics in particular). Spheres/Platonics are free ballast.
    pub euler_cost: u32,
    /// Base idle production in Flux/hour when deployed (before genus bonus + prestige).
    pub base_prod: f64,
}

// Tier base production (Flux/hr) — exotic shapes pull far harder, the reason to chase them.
const C: f64 = 30.0;
const R: f64 = 80.0;
const E: f64 = 150.0;
const S: f64 = 250.0;
const U: f64 = 400.0;

pub const SHAPES: [ShapeDef; 55] = [
    // ── Common (ids 0..10) — genus 0, χ=2, free ballast ──────────────────────────────
    ShapeDef {
        nick: "Pip",
        family: "sphere",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Boxy",
        family: "cube",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Tetra",
        family: "tetrahedron",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Spike",
        family: "octahedron",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Dodi",
        family: "dodecahedron",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Ico",
        family: "icosahedron",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Cans",
        family: "cylinder",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Scoop",
        family: "cone",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Coaster",
        family: "disk",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    ShapeDef {
        nick: "Ollie",
        family: "ellipsoid",
        rarity: Rarity::Common,
        genus: 0,
        euler_cost: 0,
        base_prod: C,
    },
    // ── Rare (ids 10..18) ────────────────────────────────────────────────────────────
    ShapeDef {
        nick: "Donna",
        family: "torus",
        rarity: Rarity::Rare,
        genus: 1,
        euler_cost: 2,
        base_prod: R,
    },
    ShapeDef {
        nick: "Mo",
        family: "mobius",
        rarity: Rarity::Rare,
        genus: 1,
        euler_cost: 2,
        base_prod: R,
    },
    ShapeDef {
        nick: "Twiggy",
        family: "genus2",
        rarity: Rarity::Rare,
        genus: 2,
        euler_cost: 4,
        base_prod: R,
    },
    ShapeDef {
        nick: "Cooper",
        family: "hyperboloid",
        rarity: Rarity::Rare,
        genus: 0,
        euler_cost: 2,
        base_prod: R,
    },
    ShapeDef {
        nick: "Cat",
        family: "catenoid",
        rarity: Rarity::Rare,
        genus: 0,
        euler_cost: 2,
        base_prod: R,
    },
    ShapeDef {
        nick: "Lex",
        family: "helicoid",
        rarity: Rarity::Rare,
        genus: 0,
        euler_cost: 2,
        base_prod: R,
    },
    ShapeDef {
        nick: "Trey",
        family: "trefoil",
        rarity: Rarity::Rare,
        genus: 1,
        euler_cost: 2,
        base_prod: R,
    },
    ShapeDef {
        nick: "Trip",
        family: "monkey_saddle",
        rarity: Rarity::Rare,
        genus: 0,
        euler_cost: 1,
        base_prod: R,
    },
    // ── Epic (ids 18..26) ──────────────────────────────────────────────────────────────
    ShapeDef {
        nick: "Klein",
        family: "klein_bottle",
        rarity: Rarity::Epic,
        genus: 1,
        euler_cost: 2,
        base_prod: E,
    },
    ShapeDef {
        nick: "Ar-Pee",
        family: "rp2",
        rarity: Rarity::Epic,
        genus: 1,
        euler_cost: 1,
        base_prod: E,
    },
    ShapeDef {
        nick: "Boyd",
        family: "boys_surface",
        rarity: Rarity::Epic,
        genus: 1,
        euler_cost: 1,
        base_prod: E,
    },
    ShapeDef {
        nick: "Cappy",
        family: "cross_cap",
        rarity: Rarity::Epic,
        genus: 1,
        euler_cost: 1,
        base_prod: E,
    },
    ShapeDef {
        nick: "Figgy",
        family: "figure8_knot",
        rarity: Rarity::Epic,
        genus: 1,
        euler_cost: 2,
        base_prod: E,
    },
    ShapeDef {
        nick: "Cinq",
        family: "torus_knot_2_5",
        rarity: Rarity::Epic,
        genus: 1,
        euler_cost: 2,
        base_prod: E,
    },
    ShapeDef {
        nick: "Gyro",
        family: "gyroid",
        rarity: Rarity::Epic,
        genus: 5,
        euler_cost: 6,
        base_prod: E,
    },
    ShapeDef {
        nick: "Percy",
        family: "schwarz_p",
        rarity: Rarity::Epic,
        genus: 5,
        euler_cost: 6,
        base_prod: E,
    },
    // ── SSR (ids 26..33) ────────────────────────────────────────────────────────────────
    ShapeDef {
        nick: "Hept",
        family: "heptoroid",
        rarity: Rarity::Ssr,
        genus: 7,
        euler_cost: 14,
        base_prod: S,
    },
    ShapeDef {
        nick: "Costa",
        family: "costa",
        rarity: Rarity::Ssr,
        genus: 1,
        euler_cost: 4,
        base_prod: S,
    },
    ShapeDef {
        nick: "The Bor",
        family: "borromean",
        rarity: Rarity::Ssr,
        genus: 3,
        euler_cost: 6,
        base_prod: S,
    },
    ShapeDef {
        nick: "Surface",
        family: "seifert",
        rarity: Rarity::Ssr,
        genus: 2,
        euler_cost: 4,
        base_prod: S,
    },
    ShapeDef {
        nick: "Lorrie",
        family: "lorenz",
        rarity: Rarity::Ssr,
        genus: 2,
        euler_cost: 5,
        base_prod: S,
    },
    ShapeDef {
        nick: "Dee",
        family: "schwarz_d",
        rarity: Rarity::Ssr,
        genus: 6,
        euler_cost: 8,
        base_prod: S,
    },
    ShapeDef {
        nick: "Pretzel",
        family: "triple_torus",
        rarity: Rarity::Ssr,
        genus: 3,
        euler_cost: 6,
        base_prod: S,
    },
    // ── UR / "Manifold" (ids 33..41) ──────────────────────────────────────────────────
    ShapeDef {
        nick: "Tess",
        family: "tesseract",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 10,
        base_prod: U,
    },
    ShapeDef {
        nick: "Hex",
        family: "cell_16",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 10,
        base_prod: U,
    },
    ShapeDef {
        nick: "Two-Four",
        family: "cell_24",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 12,
        base_prod: U,
    },
    ShapeDef {
        nick: "Cosa",
        family: "cell_120",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 20,
        base_prod: U,
    },
    ShapeDef {
        nick: "Cosi",
        family: "cell_600",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 20,
        base_prod: U,
    },
    ShapeDef {
        nick: "Sette",
        family: "klein_quartic",
        rarity: Rarity::Ur,
        genus: 3,
        euler_cost: 6,
        base_prod: U,
    },
    ShapeDef {
        nick: "Link",
        family: "hopf",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 12,
        base_prod: U,
    },
    ShapeDef {
        nick: "Corky",
        family: "mazur",
        rarity: Rarity::Ur,
        genus: 0,
        euler_cost: 1,
        base_prod: U,
    },
    // ── Relics / "Reference Wing" (ids 41..47) — famous CG models; summoned with shards, not pulled ──
    ShapeDef {
        nick: "Teapot",
        family: "utah_teapot",
        rarity: Rarity::Relic,
        genus: 1,
        euler_cost: 3,
        base_prod: U,
    },
    ShapeDef {
        nick: "Bun",
        family: "stanford_bunny",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 4,
        base_prod: U,
    },
    ShapeDef {
        nick: "Benchy",
        family: "benchy",
        rarity: Rarity::Relic,
        genus: 1,
        euler_cost: 4,
        base_prod: U,
    },
    ShapeDef {
        nick: "Drake",
        family: "stanford_dragon",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 6,
        base_prod: U,
    },
    ShapeDef {
        nick: "Suzanne",
        family: "suzanne",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 4,
        base_prod: U,
    },
    ShapeDef {
        nick: "Spot",
        family: "spot",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 3,
        base_prod: U,
    },
    // Real scanned/sculpted meshes (loaded on demand) — Princeton Suggestive-Contours + Stanford scans
    ShapeDef {
        nick: "Mooky",
        family: "cow",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 3,
        base_prod: U,
    },
    ShapeDef {
        nick: "Dillo",
        family: "armadillo",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 5,
        base_prod: U,
    },
    ShapeDef {
        nick: "Lucy",
        family: "lucy",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 6,
        base_prod: U,
    },
    ShapeDef {
        nick: "Cee",
        family: "csaszar",
        rarity: Rarity::Relic,
        genus: 1,
        euler_cost: 2,
        base_prod: U,
    },
    // Famous fractals & classical surfaces (procedurally generated in the web layer) — ids 51..55
    ShapeDef {
        nick: "Spongey",
        family: "menger",
        rarity: Rarity::Relic,
        genus: 5,
        euler_cost: 8,
        base_prod: U,
    },
    ShapeDef {
        nick: "Pinski",
        family: "sierpinski",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 4,
        base_prod: U,
    },
    ShapeDef {
        nick: "Dini",
        family: "dini",
        rarity: Rarity::Relic,
        genus: 0,
        euler_cost: 2,
        base_prod: U,
    },
    ShapeDef {
        nick: "Sevvy",
        family: "torus_knot_2_7",
        rarity: Rarity::Relic,
        genus: 1,
        euler_cost: 2,
        base_prod: U,
    },
];

pub const COUNT: usize = SHAPES.len();
/// The gacha-pullable shapes (ids 0..PULL_COUNT). Relics (41..) are summoned, not pulled, and don't count
/// toward core completion.
pub const PULL_COUNT: usize = 41;

/// Contiguous id range for a rarity tier (table is ordered by tier).
pub fn rarity_range(r: Rarity) -> std::ops::Range<usize> {
    match r {
        Rarity::Common => 0..10,
        Rarity::Rare => 10..18,
        Rarity::Epic => 18..26,
        Rarity::Ssr => 26..33,
        Rarity::Ur => 33..41,
        Rarity::Relic => 41..55,
    }
}

/// Effective production (Flux/hr) of a deployed shape: base + genus "handle-lane" bonus (M7: each hole is
/// a parallel production lane).
pub fn effective_prod(id: usize) -> f64 {
    let s = &SHAPES[id];
    s.base_prod * (1.0 + 0.25 * s.genus as f64)
}

// ── Star levels (★1–★5) — duplicate copies "ascend" a shape, scaling its ShapeEffect magnitude. ──
// Derived purely from `owned[id]` (copies), so there's no new save state to migrate. Cheap for commons,
// brutal for URs (the post-NG+ mastery long-tail). Incremental dupes per star × a per-rarity scalar.
const STAR_INCR: [u32; 5] = [1, 2, 3, 4, 5]; // extra copies needed for ★1, ★2, … ★5 (before the rarity scalar)
fn star_scalar(r: Rarity) -> u32 {
    match r {
        Rarity::Common | Rarity::Rare | Rarity::Epic => 1,
        Rarity::Ssr => 2,
        Rarity::Relic => 2,
        Rarity::Ur => 3,
    }
}
/// Star level (0–5) for a shape given how many DUPLICATE copies are owned (owned-1).
pub fn stars_from_dupes(r: Rarity, dupes: u32) -> u32 {
    let scalar = star_scalar(r);
    let mut need = 0u32;
    for star in 1..=5u32 {
        need += STAR_INCR[(star - 1) as usize] * scalar;
        if dupes < need {
            return star - 1;
        }
    }
    5
}
/// Duplicates needed to reach the NEXT star (None if already ★5) — for the inspector progress bar.
pub fn dupes_to_next_star(r: Rarity, dupes: u32) -> Option<(u32, u32)> {
    let scalar = star_scalar(r);
    let mut need = 0u32;
    for star in 1..=5u32 {
        let prev = need;
        need += STAR_INCR[(star - 1) as usize] * scalar;
        if dupes < need {
            return Some((dupes - prev, need - prev)); // (have, needed) toward this star
        }
    }
    None
}

// ── ShapeEffect archetypes (keyed to real topology) — the "each character is unique" layer. ──
/// Non-orientable surfaces → Orientability Overdrive (a flat production boost; the oscillation is cosmetic).
pub fn is_nonorientable(family: &str) -> bool {
    matches!(
        family,
        "mobius" | "klein_bottle" | "rp2" | "boys_surface" | "cross_cap" | "klein_quartic"
    )
}
/// Knots & links → Entanglement (boost loadout-adjacent neighbours — makes ORDER matter).
pub fn is_knot(family: &str) -> bool {
    matches!(
        family,
        "trefoil"
            | "figure8_knot"
            | "torus_knot_2_5"
            | "torus_knot_2_7"
            | "borromean"
            | "seifert"
            | "hopf"
    )
}
/// 4D polytopes → Cross-Dimension (a global bonus, inert until the viewport reaches 4D in New Game+).
pub fn is_polytope_4d(family: &str) -> bool {
    matches!(
        family,
        "tesseract" | "cell_16" | "cell_24" | "cell_120" | "cell_600"
    )
}
/// χ=2 free-to-deploy anchors (Sphere/Platonics) → Euler Ballast (a small steady team bonus).
pub fn is_ballast(id: usize) -> bool {
    SHAPES[id].euler_cost == 0
}

/// Topology → orbit seeding for the Orrery (see ORRERY_PLAN.md). Shapes ride a 12-cell "clock" ring; every
/// allowed period divides 12, so a shape cleanly steps `12/period` cells per tick (period 12 = the
/// second-hand, period 1 = stationary) and `lcm` of any loadout is ≤ `L_CAP` by construction.
/// - **χ (via `euler_cost`)** → orbital tempo (`period`): the Euler budget now buys speed.
/// - **orientability** → direction: non-orientable shapes run *retrograde* (the overdrive flip, made literal).
/// - **genus** → a phase offset (more handles → staggered start), so meetings are arrangeable.
pub fn orbit_for(def: &ShapeDef, slot: usize) -> crate::orrery::Orbit {
    use crate::orrery::{Orbit, ALLOWED_PERIODS};
    const RING: u32 = 12;
    // period from χ-cost but NEVER 1 → every shape actually orbits; drawn from {2,3,4,6,12} whose lcm is 12 ⇒ ≤ L_CAP.
    let period = ALLOWED_PERIODS[1 + def.euler_cost.min(4) as usize]; // 0..4 → 2,3,4,6,12
    let step = RING / period;
    let retro = is_nonorientable(def.family);
    // rotate each slot's starting cells around the ring (5 ⟂ 12 ⇒ even spread) + a genus nudge, so shapes don't clump.
    let rot = (slot as u32 * 5 + def.genus) % RING;
    let path: Vec<u8> = (0..period)
        .map(|i| {
            let k = if retro { (period - i) % period } else { i };
            ((k * step + rot) % RING) as u8
        })
        .collect();
    let phase = (slot as u32 % period) as u8;
    Orbit { path, phase }
}

/// Bespoke "signature" SELF bonuses for iconic shapes — layered on top of their archetype, star-scaled.
/// (id, self-production bonus, inspector label). The truly special globals (Sphere anchor, Hopf link) are
/// handled separately in game.rs::signature_global_mult.
pub const SIGNATURE: &[(usize, f64, &str)] = &[
    (18, 0.30, "Flagship Klein — the overdrive runs deepest here"),
    (
        26,
        0.50,
        "Genus-7 powerhouse — seven handle-lanes roaring at once",
    ),
    (
        16,
        0.20,
        "The first knot — it sets the standard others follow",
    ),
    (
        30,
        0.25,
        "Strange attractor — chaotic, relentless throughput",
    ),
    (51, 0.30, "Infinite surface, finite swagger"),
    (
        40,
        0.25,
        "The Mazur trick — something from very nearly nothing",
    ),
];
pub fn signature(id: usize) -> Option<(f64, &'static str)> {
    SIGNATURE
        .iter()
        .find(|&&(i, _, _)| i == id)
        .map(|&(_, b, l)| (b, l))
}

/// Connected-sum forge recipes (M6): gluing two shapes makes a third, by the real topology
/// (Mö # Mö = Klein; torus # torus = genus-2; …). Inputs unordered; the output is granted on craft.
pub struct Recipe {
    pub a: usize,
    pub b: usize,
    pub out: usize,
}

pub const RECIPES: &[Recipe] = &[
    Recipe {
        a: 11,
        b: 11,
        out: 18,
    }, // Mo # Mo = Klein bottle (the flagship)
    Recipe {
        a: 19,
        b: 19,
        out: 18,
    }, // RP2 # RP2 = Klein bottle
    Recipe {
        a: 10,
        b: 10,
        out: 12,
    }, // torus # torus = genus-2
    Recipe {
        a: 10,
        b: 12,
        out: 32,
    }, // torus # genus-2 = triple torus
];

/// Find a recipe matching an unordered input pair.
pub fn find_recipe(a: usize, b: usize) -> Option<usize> {
    RECIPES
        .iter()
        .position(|r| (r.a == a && r.b == b) || (r.a == b && r.b == a))
}

/// The 5 Platonic solids (a family set, M7): completing it grants a permanent global bonus.
pub const PLATONIC_IDS: [usize; 5] = [1, 2, 3, 4, 5]; // cube, tetra, octa, dodeca, icosa

/// Permanent upgrades (the Workshop) — mostly *rule-changing* effects, not flat multipliers. Bought with
/// banked Flux (the endgame sink) + sometimes Shards; persist across New Game+. Effects are applied by the
/// matching arms in game.rs (keyed by index). Repeatable ones escalate in cost by 1.8× per level.
pub struct UpgradeDef {
    pub key: &'static str, // UI/i18n key
    pub flux_cost: f64,
    pub shard_cost: u64,
    pub max_level: u32,
    pub requires: Option<(usize, u32)>, // tech-tree prereq: (upgrade index, min level); None = a root node
    pub secret: bool, // when locked: secret nodes are HIDDEN until unlocked; non-secret ones show disabled
}

// Order is load-bearing — game.rs reads effects by index. Keep in sync. A small tech tree: two roots
// (expand_floor, patience) branch into the rest; `twin_bond` + `auto_pull` are secret (revealed on unlock).
pub const UPGRADES: [UpgradeDef; 9] = [
    UpgradeDef {
        key: "expand_floor",
        flux_cost: 700.0,
        shard_cost: 0,
        max_level: 6,
        requires: None,
        secret: false,
    }, // 0: +2 Euler cap / level (root)
    UpgradeDef {
        key: "genus_resonance",
        flux_cost: 4500.0,
        shard_cost: 15,
        max_level: 1,
        requires: Some((0, 2)),
        secret: false,
    }, // 1: +6% per distinct genus
    UpgradeDef {
        key: "twin_bond",
        flux_cost: 6000.0,
        shard_cost: 25,
        max_level: 1,
        requires: Some((1, 1)),
        secret: true,
    }, // 2: kin synergy doubled (secret)
    UpgradeDef {
        key: "patience",
        flux_cost: 2500.0,
        shard_cost: 0,
        max_level: 3,
        requires: None,
        secret: false,
    }, // 3: +12h offline cap / level (root)
    UpgradeDef {
        key: "shard_dividend",
        flux_cost: 3500.0,
        shard_cost: 0,
        max_level: 1,
        requires: Some((3, 1)),
        secret: false,
    }, // 4: dupe shards ×1.5
    UpgradeDef {
        key: "forge_mastery",
        flux_cost: 3000.0,
        shard_cost: 30,
        max_level: 1,
        requires: Some((0, 1)),
        secret: false,
    }, // 5: forge costs 25
    UpgradeDef {
        key: "affinity_bloom",
        flux_cost: 5000.0,
        shard_cost: 0,
        max_level: 1,
        requires: Some((4, 1)),
        secret: false,
    }, // 6: bond gains ×1.5
    UpgradeDef {
        key: "overflow_cap",
        flux_cost: 8000.0,
        shard_cost: 0,
        max_level: 4,
        requires: Some((0, 4)),
        secret: false,
    }, // 7: cap +300/hr / level
    UpgradeDef {
        key: "auto_pull",
        flux_cost: 9000.0,
        shard_cost: 0,
        max_level: 1,
        requires: Some((7, 1)),
        secret: true,
    }, // 8: auto-pull toggle (secret)
];
pub const UPGRADE_COUNT: usize = UPGRADES.len();

/// Flux + Shard cost for the NEXT level of an upgrade (escalates for repeatables).
pub fn upgrade_cost(id: usize, level: u32) -> (f64, u64) {
    let d = &UPGRADES[id];
    let mult = 1.8_f64.powi(level as i32);
    (
        (d.flux_cost * mult).floor(),
        (d.shard_cost as f64 * mult).floor() as u64,
    )
}

/// Facet perks — the PRESTIGE meta-tree. Recrystallizing grants Facets (a meta-currency); these perks are
/// bought with Facets and persist across every New Game+ forever. Effects keyed by index in game.rs.
pub struct FacetPerk {
    pub key: &'static str,
    pub cost: u64,
    pub max_level: u32,
}
pub const FACET_PERKS: [FacetPerk; 5] = [
    FacetPerk {
        key: "meta_production",
        cost: 2,
        max_level: 5,
    }, // 0: +5% global production / level (forever)
    FacetPerk {
        key: "resonant_floor",
        cost: 3,
        max_level: 4,
    }, // 1: +1 base Euler cap / level
    FacetPerk {
        key: "crystalline_start",
        cost: 2,
        max_level: 5,
    }, // 2: +600 Flux head-start each ascent / level
    FacetPerk {
        key: "collectors_eye",
        cost: 3,
        max_level: 3,
    }, // 3: +15% dupe shards / level
    FacetPerk {
        key: "ascendant",
        cost: 5,
        max_level: 3,
    }, // 4: +0.1 to the prestige base / level (compounds NG+)
];
pub const FACET_PERK_COUNT: usize = FACET_PERKS.len();
pub fn facet_perk_cost(id: usize, level: u32) -> u64 {
    (FACET_PERKS[id].cost as f64 * 1.6_f64.powi(level as i32)).floor() as u64
}

/// Milestones — once achieved they latch permanently and each adds a small global production bonus (the
/// classic idle "achievement multiplier"). Conditions live in game.rs (by index). The checklist itself is
/// the dopamine; the bonus is the cherry.
pub struct Milestone {
    pub key: &'static str,
    pub bonus: f64, // permanent global production bonus once latched
}
pub const MILESTONES: [Milestone; 9] = [
    Milestone {
        key: "own_10",
        bonus: 0.03,
    }, // 0
    Milestone {
        key: "own_25",
        bonus: 0.05,
    }, // 1
    Milestone {
        key: "core_complete",
        bonus: 0.10,
    }, // 2
    Milestone {
        key: "forge_3",
        bonus: 0.04,
    }, // 3
    Milestone {
        key: "bond_5",
        bonus: 0.05,
    }, // 4
    Milestone {
        key: "kin_3",
        bonus: 0.05,
    }, // 5
    Milestone {
        key: "all_relics",
        bonus: 0.08,
    }, // 6
    Milestone {
        key: "platonic",
        bonus: 0.03,
    }, // 7
    Milestone {
        key: "ascend",
        bonus: 0.05,
    }, // 8
];
pub const MILESTONE_COUNT: usize = MILESTONES.len();

/// Gacha banners. The Standard banner pulls the whole pool evenly (steered to missing shapes); themed
/// banners add a rate-up that biases the within-tier pick toward their `featured` shape ids. Themed banners
/// ROTATE (the web layer surfaces one featured banner at a time alongside Standard). Banners only change
/// *which* shape you get within a rolled tier — never the rarity odds or pity (those stay in gacha.rs).
pub struct BannerDef {
    pub key: &'static str,
    pub featured: &'static [usize], // shape ids with rate-up
    pub rotating: bool,             // themed banners rotate in/out; Standard is always available
}
pub const BANNERS: [BannerDef; 4] = [
    BannerDef {
        key: "standard",
        featured: &[],
        rotating: false,
    },
    BannerDef {
        key: "knots",
        featured: &[16, 22, 23, 28, 29, 39],
        rotating: true,
    }, // Knots & Links (UR: Hopf link)
    BannerDef {
        key: "fourth_dim",
        featured: &[33, 34, 35, 36, 37],
        rotating: true,
    }, // The Fourth Dimension (4D polytopes)
    BannerDef {
        key: "nonorientable",
        featured: &[11, 18, 19, 20, 21, 38],
        rotating: true,
    }, // Non-Orientable (UR: Klein quartic)
];
pub const BANNER_COUNT: usize = BANNERS.len();

/// Kin pairs (duals & soulmates) — deploying BOTH grants a production synergy (the "shipping" payoff).
pub const SYNERGY_PAIRS: [(usize, usize); 8] = [
    (1, 3),   // cube ⇄ octahedron (dual)
    (4, 5),   // dodecahedron ⇄ icosahedron (dual)
    (14, 15), // catenoid ⇄ helicoid (soulmate)
    (16, 29), // trefoil ⇄ Seifert (soulmate)
    (10, 12), // torus → genus-2 (parent/child)
    (11, 18), // Möbius → Klein (parent/child)
    (33, 34), // tesseract ⇄ 16-cell (dual)
    (36, 37), // 120-cell ⇄ 600-cell (dual)
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn stars_ramp_and_cap() {
        // 0 dupes = ★0; commons reach ★5 fast, URs slowly; never exceeds ★5.
        assert_eq!(stars_from_dupes(Rarity::Common, 0), 0);
        assert_eq!(stars_from_dupes(Rarity::Common, 1), 1); // 1 dupe → ★1 (scalar 1)
        assert_eq!(stars_from_dupes(Rarity::Common, 15), 5); // 1+2+3+4+5 = 15 → ★5
        assert_eq!(stars_from_dupes(Rarity::Common, 999), 5); // hard cap
        assert_eq!(stars_from_dupes(Rarity::Ur, 1), 0); // UR ★1 needs 3 dupes (scalar 3)
        assert_eq!(stars_from_dupes(Rarity::Ur, 3), 1);
        assert!(stars_from_dupes(Rarity::Ur, 44) < 5 && stars_from_dupes(Rarity::Ur, 45) == 5);
        // ★5 = 45 dupes
    }

    const TIERS: [Rarity; 6] = [
        Rarity::Common,
        Rarity::Rare,
        Rarity::Epic,
        Rarity::Ssr,
        Rarity::Ur,
        Rarity::Relic,
    ];

    #[test]
    fn nicks_are_distinct_case_insensitive() {
        let mut seen = HashSet::new();
        for s in SHAPES.iter() {
            assert!(
                seen.insert(s.nick.to_lowercase()),
                "duplicate nick: {}",
                s.nick
            );
        }
    }

    #[test]
    fn families_are_distinct() {
        let mut seen = HashSet::new();
        for s in SHAPES.iter() {
            assert!(seen.insert(s.family), "duplicate family: {}", s.family);
        }
    }

    #[test]
    fn rarity_ranges_partition_every_shape() {
        let mut next = 0usize;
        for t in TIERS {
            let r = rarity_range(t);
            assert_eq!(r.start, next, "gap/overlap before {:?}", t);
            for id in r.clone() {
                assert_eq!(
                    SHAPES[id].rarity, t,
                    "shape {} ({}) wrong tier for {:?}",
                    id, SHAPES[id].nick, t
                );
            }
            next = r.end;
        }
        assert_eq!(next, COUNT, "rarity ranges must cover all {} shapes", COUNT);
    }

    #[test]
    #[allow(clippy::assertions_on_constants)] // intentional: pins a compile-time content invariant
    fn pull_count_is_consistent() {
        assert_eq!(PULL_COUNT, rarity_range(Rarity::Ur).end);
        assert_eq!(rarity_range(Rarity::Relic).start, PULL_COUNT);
        assert!(PULL_COUNT < COUNT, "there should be at least one relic");
    }

    #[test]
    fn recipes_reference_valid_distinct_ids() {
        for r in RECIPES.iter() {
            assert!(
                r.a < COUNT && r.b < COUNT && r.out < COUNT,
                "recipe id out of range"
            );
            assert!(
                r.out >= PULL_COUNT || SHAPES[r.out].rarity != Rarity::Common,
                "forge output too cheap"
            );
        }
    }

    #[test]
    fn every_shape_produces_flux() {
        for s in SHAPES.iter() {
            assert!(s.base_prod > 0.0, "{} has non-positive base_prod", s.nick);
        }
    }

    #[test]
    fn effective_prod_scales_with_genus() {
        for (id, s) in SHAPES.iter().enumerate() {
            let expected = s.base_prod * (1.0 + 0.25 * s.genus as f64);
            assert!(
                (effective_prod(id) - expected).abs() < 1e-9,
                "effective_prod mismatch for {}",
                s.nick
            );
        }
    }

    #[test]
    fn synergy_pairs_are_valid_distinct_ids() {
        for (a, b) in SYNERGY_PAIRS {
            assert!(
                a < COUNT && b < COUNT && a != b,
                "bad synergy pair ({a},{b})"
            );
        }
    }

    #[test]
    fn platonic_ids_are_valid_and_common() {
        assert_eq!(PLATONIC_IDS.len(), 5);
        for &id in PLATONIC_IDS.iter() {
            assert!(id < COUNT);
            assert_eq!(
                SHAPES[id].rarity,
                Rarity::Common,
                "platonic set should be Common-tier"
            );
        }
    }
}
