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
    /// Euler-budget cost to deploy = max(0, 2 − χ). Spheres/Platonics are free ballast.
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

pub const SHAPES: [ShapeDef; 51] = [
    // ── Common (ids 0..10) — genus 0, χ=2, free ballast ──────────────────────────────
    ShapeDef { nick: "Pip",     family: "sphere",        rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Boxy",    family: "cube",          rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Tetra",   family: "tetrahedron",   rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Spike",   family: "octahedron",    rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Dodi",    family: "dodecahedron",  rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Ico",     family: "icosahedron",   rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Cans",    family: "cylinder",      rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Scoop",   family: "cone",          rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Coaster", family: "disk",          rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    ShapeDef { nick: "Ollie",   family: "ellipsoid",     rarity: Rarity::Common, genus: 0, euler_cost: 0, base_prod: C },
    // ── Rare (ids 10..18) ────────────────────────────────────────────────────────────
    ShapeDef { nick: "Donna",   family: "torus",         rarity: Rarity::Rare, genus: 1, euler_cost: 2, base_prod: R },
    ShapeDef { nick: "Mo",      family: "mobius",        rarity: Rarity::Rare, genus: 1, euler_cost: 2, base_prod: R },
    ShapeDef { nick: "Twiggy",  family: "genus2",        rarity: Rarity::Rare, genus: 2, euler_cost: 4, base_prod: R },
    ShapeDef { nick: "Cooper",  family: "hyperboloid",   rarity: Rarity::Rare, genus: 0, euler_cost: 2, base_prod: R },
    ShapeDef { nick: "Cat",     family: "catenoid",      rarity: Rarity::Rare, genus: 0, euler_cost: 2, base_prod: R },
    ShapeDef { nick: "Lex",     family: "helicoid",      rarity: Rarity::Rare, genus: 0, euler_cost: 2, base_prod: R },
    ShapeDef { nick: "Trey",    family: "trefoil",       rarity: Rarity::Rare, genus: 1, euler_cost: 2, base_prod: R },
    ShapeDef { nick: "Trip",    family: "monkey_saddle", rarity: Rarity::Rare, genus: 0, euler_cost: 1, base_prod: R },
    // ── Epic (ids 18..26) ──────────────────────────────────────────────────────────────
    ShapeDef { nick: "Klein",   family: "klein_bottle",  rarity: Rarity::Epic, genus: 1, euler_cost: 2, base_prod: E },
    ShapeDef { nick: "Ar-Pee",  family: "rp2",           rarity: Rarity::Epic, genus: 1, euler_cost: 1, base_prod: E },
    ShapeDef { nick: "Boyd",    family: "boys_surface",  rarity: Rarity::Epic, genus: 1, euler_cost: 1, base_prod: E },
    ShapeDef { nick: "Cappy",   family: "cross_cap",     rarity: Rarity::Epic, genus: 1, euler_cost: 1, base_prod: E },
    ShapeDef { nick: "Figgy",   family: "figure8_knot",  rarity: Rarity::Epic, genus: 1, euler_cost: 2, base_prod: E },
    ShapeDef { nick: "Cinq",    family: "torus_knot_2_5",rarity: Rarity::Epic, genus: 1, euler_cost: 2, base_prod: E },
    ShapeDef { nick: "Gyro",    family: "gyroid",        rarity: Rarity::Epic, genus: 5, euler_cost: 6, base_prod: E },
    ShapeDef { nick: "Percy",   family: "schwarz_p",     rarity: Rarity::Epic, genus: 5, euler_cost: 6, base_prod: E },
    // ── SSR (ids 26..33) ────────────────────────────────────────────────────────────────
    ShapeDef { nick: "Hept",    family: "heptoroid",     rarity: Rarity::Ssr, genus: 7, euler_cost: 14, base_prod: S },
    ShapeDef { nick: "Costa",   family: "costa",         rarity: Rarity::Ssr, genus: 1, euler_cost: 4,  base_prod: S },
    ShapeDef { nick: "The Bor", family: "borromean",     rarity: Rarity::Ssr, genus: 3, euler_cost: 6,  base_prod: S },
    ShapeDef { nick: "Surface", family: "seifert",       rarity: Rarity::Ssr, genus: 2, euler_cost: 4,  base_prod: S },
    ShapeDef { nick: "Lorrie",  family: "lorenz",        rarity: Rarity::Ssr, genus: 2, euler_cost: 5,  base_prod: S },
    ShapeDef { nick: "Dee",     family: "schwarz_d",     rarity: Rarity::Ssr, genus: 6, euler_cost: 8,  base_prod: S },
    ShapeDef { nick: "Pretzel", family: "triple_torus",  rarity: Rarity::Ssr, genus: 3, euler_cost: 6,  base_prod: S },
    // ── UR / "Manifold" (ids 33..41) ──────────────────────────────────────────────────
    ShapeDef { nick: "Tess",     family: "tesseract",     rarity: Rarity::Ur, genus: 0, euler_cost: 10, base_prod: U },
    ShapeDef { nick: "Hex",      family: "cell_16",       rarity: Rarity::Ur, genus: 0, euler_cost: 10, base_prod: U },
    ShapeDef { nick: "Two-Four", family: "cell_24",       rarity: Rarity::Ur, genus: 0, euler_cost: 12, base_prod: U },
    ShapeDef { nick: "Cosa",     family: "cell_120",      rarity: Rarity::Ur, genus: 0, euler_cost: 20, base_prod: U },
    ShapeDef { nick: "Cosi",     family: "cell_600",      rarity: Rarity::Ur, genus: 0, euler_cost: 20, base_prod: U },
    ShapeDef { nick: "Sette",    family: "klein_quartic", rarity: Rarity::Ur, genus: 3, euler_cost: 6,  base_prod: U },
    ShapeDef { nick: "Link",     family: "hopf",          rarity: Rarity::Ur, genus: 0, euler_cost: 12, base_prod: U },
    ShapeDef { nick: "Corky",    family: "mazur",         rarity: Rarity::Ur, genus: 0, euler_cost: 1,  base_prod: U },
    // ── Relics / "Reference Wing" (ids 41..47) — famous CG models; summoned with shards, not pulled ──
    ShapeDef { nick: "Teapot",  family: "utah_teapot",    rarity: Rarity::Relic, genus: 1, euler_cost: 3, base_prod: U },
    ShapeDef { nick: "Bun",     family: "stanford_bunny", rarity: Rarity::Relic, genus: 0, euler_cost: 4, base_prod: U },
    ShapeDef { nick: "Benchy",  family: "benchy",         rarity: Rarity::Relic, genus: 1, euler_cost: 4, base_prod: U },
    ShapeDef { nick: "Drake",   family: "stanford_dragon",rarity: Rarity::Relic, genus: 0, euler_cost: 6, base_prod: U },
    ShapeDef { nick: "Suzanne", family: "suzanne",        rarity: Rarity::Relic, genus: 0, euler_cost: 4, base_prod: U },
    ShapeDef { nick: "Spot",    family: "spot",           rarity: Rarity::Relic, genus: 0, euler_cost: 3, base_prod: U },
    // Real scanned/sculpted meshes (loaded on demand) — Princeton Suggestive-Contours + Stanford scans
    ShapeDef { nick: "Mooky",   family: "cow",            rarity: Rarity::Relic, genus: 0, euler_cost: 3, base_prod: U },
    ShapeDef { nick: "Dillo",   family: "armadillo",      rarity: Rarity::Relic, genus: 0, euler_cost: 5, base_prod: U },
    ShapeDef { nick: "Lucy",    family: "lucy",           rarity: Rarity::Relic, genus: 0, euler_cost: 6, base_prod: U },
    ShapeDef { nick: "Cee",     family: "csaszar",        rarity: Rarity::Relic, genus: 1, euler_cost: 2, base_prod: U },
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
        Rarity::Relic => 41..51,
    }
}

/// Effective production (Flux/hr) of a deployed shape: base + genus "handle-lane" bonus (M7: each hole is
/// a parallel production lane).
pub fn effective_prod(id: usize) -> f64 {
    let s = &SHAPES[id];
    s.base_prod * (1.0 + 0.25 * s.genus as f64)
}

/// Connected-sum forge recipes (M6): gluing two shapes makes a third, by the real topology
/// (Mö # Mö = Klein; torus # torus = genus-2; …). Inputs unordered; the output is granted on craft.
pub struct Recipe {
    pub a: usize,
    pub b: usize,
    pub out: usize,
}

pub const RECIPES: &[Recipe] = &[
    Recipe { a: 11, b: 11, out: 18 }, // Mo # Mo = Klein bottle (the flagship)
    Recipe { a: 19, b: 19, out: 18 }, // RP2 # RP2 = Klein bottle
    Recipe { a: 10, b: 10, out: 12 }, // torus # torus = genus-2
    Recipe { a: 10, b: 12, out: 32 }, // torus # genus-2 = triple torus
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
}

// Order is load-bearing — game.rs reads effects by index. Keep in sync.
pub const UPGRADES: [UpgradeDef; 9] = [
    UpgradeDef { key: "expand_floor", flux_cost: 700.0, shard_cost: 0, max_level: 6 }, // 0: +2 Euler cap / level
    UpgradeDef { key: "genus_resonance", flux_cost: 4500.0, shard_cost: 15, max_level: 1 }, // 1: +6% per distinct genus on the floor
    UpgradeDef { key: "twin_bond", flux_cost: 6000.0, shard_cost: 25, max_level: 1 }, // 2: kin synergy doubled
    UpgradeDef { key: "patience", flux_cost: 2500.0, shard_cost: 0, max_level: 3 }, // 3: +12h offline cap / level
    UpgradeDef { key: "shard_dividend", flux_cost: 3500.0, shard_cost: 0, max_level: 1 }, // 4: dupe shards ×1.5
    UpgradeDef { key: "forge_mastery", flux_cost: 3000.0, shard_cost: 30, max_level: 1 }, // 5: forge costs 25 (was 50)
    UpgradeDef { key: "affinity_bloom", flux_cost: 5000.0, shard_cost: 0, max_level: 1 }, // 6: all bond gains ×1.5
    UpgradeDef { key: "overflow_cap", flux_cost: 8000.0, shard_cost: 0, max_level: 4 }, // 7: production cap +300/hr / level
    UpgradeDef { key: "auto_pull", flux_cost: 9000.0, shard_cost: 0, max_level: 1 }, // 8: unlocks the auto-pull toggle (UI)
];
pub const UPGRADE_COUNT: usize = UPGRADES.len();

/// Flux + Shard cost for the NEXT level of an upgrade (escalates for repeatables).
pub fn upgrade_cost(id: usize, level: u32) -> (f64, u64) {
    let d = &UPGRADES[id];
    let mult = 1.8_f64.powi(level as i32);
    ((d.flux_cost * mult).floor(), (d.shard_cost as f64 * mult).floor() as u64)
}

/// Milestones — once achieved they latch permanently and each adds a small global production bonus (the
/// classic idle "achievement multiplier"). Conditions live in game.rs (by index). The checklist itself is
/// the dopamine; the bonus is the cherry.
pub struct Milestone {
    pub key: &'static str,
    pub bonus: f64, // permanent global production bonus once latched
}
pub const MILESTONES: [Milestone; 9] = [
    Milestone { key: "own_10", bonus: 0.03 },        // 0
    Milestone { key: "own_25", bonus: 0.05 },        // 1
    Milestone { key: "core_complete", bonus: 0.10 }, // 2
    Milestone { key: "forge_3", bonus: 0.04 },       // 3
    Milestone { key: "bond_5", bonus: 0.05 },        // 4
    Milestone { key: "kin_3", bonus: 0.05 },         // 5
    Milestone { key: "all_relics", bonus: 0.08 },    // 6
    Milestone { key: "platonic", bonus: 0.03 },      // 7
    Milestone { key: "ascend", bonus: 0.05 },        // 8
];
pub const MILESTONE_COUNT: usize = MILESTONES.len();

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
            assert!(seen.insert(s.nick.to_lowercase()), "duplicate nick: {}", s.nick);
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
                assert_eq!(SHAPES[id].rarity, t, "shape {} ({}) wrong tier for {:?}", id, SHAPES[id].nick, t);
            }
            next = r.end;
        }
        assert_eq!(next, COUNT, "rarity ranges must cover all {} shapes", COUNT);
    }

    #[test]
    fn pull_count_is_consistent() {
        assert_eq!(PULL_COUNT, rarity_range(Rarity::Ur).end);
        assert_eq!(rarity_range(Rarity::Relic).start, PULL_COUNT);
        assert!(PULL_COUNT < COUNT, "there should be at least one relic");
    }

    #[test]
    fn recipes_reference_valid_distinct_ids() {
        for r in RECIPES.iter() {
            assert!(r.a < COUNT && r.b < COUNT && r.out < COUNT, "recipe id out of range");
            assert!(r.out >= PULL_COUNT || SHAPES[r.out].rarity != Rarity::Common, "forge output too cheap");
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
        for id in 0..COUNT {
            let s = &SHAPES[id];
            let expected = s.base_prod * (1.0 + 0.25 * s.genus as f64);
            assert!((effective_prod(id) - expected).abs() < 1e-9, "effective_prod mismatch for {}", s.nick);
        }
    }

    #[test]
    fn synergy_pairs_are_valid_distinct_ids() {
        for (a, b) in SYNERGY_PAIRS {
            assert!(a < COUNT && b < COUNT && a != b, "bad synergy pair ({a},{b})");
        }
    }

    #[test]
    fn platonic_ids_are_valid_and_common() {
        assert_eq!(PLATONIC_IDS.len(), 5);
        for &id in PLATONIC_IDS.iter() {
            assert!(id < COUNT);
            assert_eq!(SHAPES[id].rarity, Rarity::Common, "platonic set should be Common-tier");
        }
    }
}
