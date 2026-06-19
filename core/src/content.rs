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

pub const SHAPES: [ShapeDef; 48] = [
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
    ShapeDef { nick: "Hello",   family: "hello_world",    rarity: Rarity::Relic, genus: 0, euler_cost: 2, base_prod: U },
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
        Rarity::Relic => 41..48,
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
