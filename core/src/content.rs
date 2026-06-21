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
// Scaled ~12× (2026-06 first-run retune: complete the core in ~4h greedy / ~1 day casual; see simulate.rs bands).
const C: f64 = 360.0;
const R: f64 = 960.0;
const E: f64 = 1800.0;
const S: f64 = 3000.0;
const U: f64 = 4800.0;

pub const SHAPES: [ShapeDef; 65] = [
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
    // Two "warped classic" Ssr shapes (ids 33,34), placed just past the highest connected-sum recipe id (32) so
    // RECIPES needs no remap. The 4D-polytope ids below shift +2 (SYNERGY_PAIRS updated to match).
    ShapeDef {
        nick: "Twirl",
        family: "twisted_torus", // a torus wrung around its axis (opTwist) — still genus-1, just twisted
        rarity: Rarity::Ssr,
        genus: 1,
        euler_cost: 3,
        base_prod: S,
    },
    ShapeDef {
        nick: "Dish",
        family: "cut_hollow_sphere", // an open spherical shell — a bowl with a rim (genus 0, bounded)
        rarity: Rarity::Ssr,
        genus: 0,
        euler_cost: 2,
        base_prod: S,
    },
    ShapeDef {
        nick: "Blobby",
        family: "blobby", // a sphere smooth-unioned with three axis dumbbells — a 6-armed organic blob (fogleman/sdf)
        rarity: Rarity::Ssr,
        genus: 0,
        euler_cost: 2,
        base_prod: S,
    },
    // ── UR / "Manifold" (ids 36..44) ──────────────────────────────────────────────────
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
    // ── NG+ Metashapes (ids 55..) — higher-order forms that enter the gacha only as you ascend dimensions ──
    // Meta tier (unlocks at 4D / NG+1):
    ShapeDef {
        nick: "Cliff",
        family: "clifford_torus", // the flat torus living in the 3-sphere — a 4D object, inert until you're 4D
        rarity: Rarity::Meta,
        genus: 1,
        euler_cost: 4,
        base_prod: U,
    },
    ShapeDef {
        nick: "Cabel",
        family: "cable_knot", // a satellite knot — a knot whose strand is itself a knot
        rarity: Rarity::Meta,
        genus: 1,
        euler_cost: 4,
        base_prod: U,
    },
    // Transcendent tier (unlocks at 5D / NG+2):
    ShapeDef {
        nick: "Bulby",
        family: "mandelbulb", // the power-8 Mandelbulb — THE iconic 3D fractal (was a deeper Menger sponge, which read as a dupe of Spongey)
        rarity: Rarity::Transcendent,
        genus: 7,
        euler_cost: 9,
        base_prod: 600.0,
    },
    // The fractal capstone cohort (the "cool SDF" set) — share the Transcendent tier with Bulby, each a compact
    // distance-estimator gem raymarched on the hero. Topology is a game abstraction (fractal boundaries have no
    // clean genus), tuned to the high end like Bulby.
    ShapeDef {
        nick: "Foldy",
        family: "mandelbox", // box-fold + sphere-fold fractal — the Mandelbulb's architectural cousin
        rarity: Rarity::Transcendent,
        genus: 8,
        euler_cost: 10,
        base_prod: 660.0,
    },
    ShapeDef {
        nick: "Jules",
        family: "julia", // a quaternion (4D) Julia set sliced into 3-space — the seed picks the form
        rarity: Rarity::Transcendent,
        genus: 4,
        euler_cost: 6,
        base_prod: 620.0,
    },
    ShapeDef {
        nick: "Bubbles",
        family: "apollonian", // the Apollonian gasket — infinitely nested sphere-packing
        rarity: Rarity::Transcendent,
        genus: 5,
        euler_cost: 7,
        base_prod: 560.0,
    },
    ShapeDef {
        nick: "Spire",
        family: "kleinian", // a pseudo-Kleinian fold fractal — an endless alien cathedral
        rarity: Rarity::Transcendent,
        genus: 6,
        euler_cost: 8,
        base_prod: 580.0,
    },
];

pub const COUNT: usize = SHAPES.len();

/// Global economy scale. Flux is rendered as dust at exactly one mote per flux (web/three FluxStream); for that
/// to be *visible* at the bottom of the curve, base production is scaled so a 0★ Pip (base 30/hr) makes ~1
/// flux/sec (≈1 mote/sec). Everything flux-denominated — production, costs, grants — multiplies by this, so
/// the curve's SHAPE is unchanged; only the units grow 120×. (Shards/Facets/Euler budget are NOT flux.)
pub const FLUX_DENSITY: f64 = 120.0;

/// The gacha-pullable shapes (ids 0..PULL_COUNT). Relics (41..) are summoned, not pulled, and don't count
/// toward core completion.
pub const PULL_COUNT: usize = 44;

/// Contiguous id range for a rarity tier (table is ordered by tier).
pub fn rarity_range(r: Rarity) -> std::ops::Range<usize> {
    match r {
        Rarity::Common => 0..10,
        Rarity::Rare => 10..18,
        Rarity::Epic => 18..26,
        Rarity::Ssr => 26..36,          // +3: Twirl, Dish, Blobby inserted at 33,34,35
        Rarity::Ur => 36..44,
        Rarity::Relic => 44..58,
        Rarity::Meta => 58..60,         // NG+ metashapes — enter the gacha at 4D
        Rarity::Transcendent => 60..65, // the capstone cohort (Bulby + 4 fractals) — enters the gacha at 5D
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
        Rarity::Ur | Rarity::Meta | Rarity::Transcendent => 3, // top-tier mastery long-tail
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
            | "cable_knot"
    )
}
/// 4D polytopes → Cross-Dimension (a global bonus, inert until the viewport reaches 4D in New Game+).
pub fn is_polytope_4d(family: &str) -> bool {
    matches!(
        family,
        "tesseract" | "cell_16" | "cell_24" | "cell_120" | "cell_600" | "clifford_torus"
    )
}
/// χ=2 free-to-deploy anchors (Sphere/Platonics) → Euler Ballast (a small steady team bonus).
pub fn is_ballast(id: usize) -> bool {
    SHAPES[id].euler_cost == 0
}

// ── Orrery lane seeding (the hex-grid model; see ORRERY_PLAN.md §1) ──────────────
// Each deployed shape patrols a straight back-and-forth LANE from its anchor. Topology seeds the lane's
// length (→ period), its default direction (hex axis) and default phase; the player tunes anchor + axis +
// phase. The absolute path is built in game.rs via orrery::lane_path(anchor, axis, lane_len).

// ── Flux-emitter model (see flux.rs) — how each shape emits flux and what it does to flux passing through it.

/// The *shape* of a stationary gem's emission (amount is supplied per-deploy in game.rs from its production).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EmitKind {
    Beam,     // a steady beam along the shape's facing — period 1
    Rotating, // a spoke that sweeps all six directions, one step/tick — period 6
    Scatter,  // a starburst in all six directions at once — period 1
    Pulse,    // a burst along the facing every 3 ticks — period 3
}

/// Emission pattern, chosen to echo the geometry — and to make placement matter:
///  • round bodies sweep a **rotating** radial spoke (Pip the sphere is the basic low-rate one),
///  • rings / tubes / chaotic & minimal surfaces **scatter** in all six directions,
///  • 4D polytopes **pulse**, and
///  • everything pointed/solid/knotted fires a focused directional **beam** you aim through neighbours.
/// Pure function of the family (locale-invariant).
pub fn emit_kind(def: &ShapeDef) -> EmitKind {
    match def.family {
        // round / rotationally-symmetric bodies sweep a rotating radial spoke
        "sphere" | "ellipsoid" | "disk" | "torus" | "cylinder" | "dodecahedron" | "icosahedron" => {
            EmitKind::Rotating
        }
        // open, minimal & chaotic surfaces (and the big multi-handle bodies) spray a six-way starburst
        "gyroid" | "schwarz_p" | "schwarz_d" | "costa" | "catenoid" | "helicoid" | "lorenz" | "monkey_saddle"
        | "hyperboloid" | "genus2" | "triple_torus" | "heptoroid" => EmitKind::Scatter,
        // 4D polytopes & links blink between configurations — a slow pulse
        "tesseract" | "cell_16" | "cell_24" | "cell_120" | "cell_600" | "hopf" | "borromean" | "seifert" => {
            EmitKind::Pulse
        }
        // everything pointed / knotted / one-sided fires a focused beam you aim through neighbours
        _ => EmitKind::Beam,
    }
}

/// Emission period (ticks per full cycle). Must be in [`orrery::ALLOWED_PERIODS`] so any board's lcm ≤ L_CAP
/// and offline catch-up stays O(1).
pub fn emit_period(def: &ShapeDef) -> u32 {
    match emit_kind(def) {
        EmitKind::Rotating => 6,
        EmitKind::Pulse => 3,
        EmitKind::Beam | EmitKind::Scatter => 1,
    }
}

/// What a shape does to flux crossing its cell — the heart of the positioning puzzle (aim a beam through a
/// chain of these). Echoes the topology:
///  • round lenses (sphere/ellipsoid) give a gentle **×1.2** nudge — the common amplifier/anchor,
///  • 4D polytopes and links are powerful **×2–3** amplifiers,
///  • a Möbius gives a soft 60° **turn**; the other one-sided shapes **flip flux 180°**,
///  • knots **×1.5** (entanglement), handles **×(1 + genus/2)**, plain genus-0 solids pass flux through.
/// Base amplifier strength by rarity — `(num, den)` so it's exact integer flux math. Higher rarity = a stronger
/// effect, the reason chasing rarer shapes changes the board, not just the numbers. The topology (below) then
/// picks the effect *type* and layers genus/knot bonuses on top.
fn rarity_mult(r: Rarity) -> (u32, u32) {
    match r {
        Rarity::Common => (6, 5),       // ×1.2 — a gentle lens
        Rarity::Rare => (3, 2),         // ×1.5
        Rarity::Epic => (2, 1),         // ×2
        Rarity::Ssr => (5, 2),          // ×2.5
        Rarity::Ur => (3, 1),           // ×3
        Rarity::Relic => (4, 1),        // ×4
        Rarity::Meta => (5, 1),         // ×5
        Rarity::Transcendent => (6, 1), // ×6
    }
}

/// The CLOSED genus-0 χ=2 solids — sphere, ellipsoid, and the five Platonics. Each IS topologically a 2-sphere,
/// the IDENTITY of the connected-sum monoid (S² # X = X), so its flux verb is the *additive* one: a flat baseline
/// `Amplify`, not a multiplier. NOTE this is narrower than the team-bonus `is_ballast(id)` (euler_cost==0), which
/// also tags the OPEN χ≠2 anchors cone/disk/cylinder — those keep the genus-0 Multiply and are the reserved Absorb
/// home (a boundary circle = a sink), deferred until a dedicated sink shape + tests exist.
fn is_closed_ballast(family: &str) -> bool {
    // ONLY the literal sphere (S² itself, the true connected-sum identity). Assigning the additive verb to ALL
    // seven closed solids removed the ×1.2-multiplier CHAINS the late-game economy compounds (×1.2^k on strong
    // beams) and pushed greedy completion 48h→58h — out of the design window. Narrowed to S² alone: the cube and
    // the four Platonics keep their Multiply lens, so the economy holds, while the additive verb still ships on
    // the one shape it's thematically exact for (the others are sphere-LIKE; only S² IS the monoid identity).
    matches!(family, "sphere")
}

/// Flat µ-unit add for a ballast `Amplify`, ≈0.6× a same-rarity beam's per-tick quantum (game::to_units(base_prod)
/// = base_prod·1e6/3600 µ/tick — a Common beam is ~8.3k µ). So it disproportionately lifts WEAK beams and is a
/// rounding error on huge ones: the flat counter-lever the otherwise all-multiplicative economy lacks. Integer +
/// deterministic, monotonic by rarity. (All current ballast are Common → the 5_000 rung dominates; the higher rungs
/// future-proof a higher-rarity closed solid.)
fn amplify_add(r: Rarity) -> u64 {
    match r {
        Rarity::Common => 5_000,
        Rarity::Rare => 13_000,
        Rarity::Epic => 25_000,
        Rarity::Ssr => 42_000,
        Rarity::Ur => 67_000,
        Rarity::Relic => 90_000,
        Rarity::Meta => 120_000,
        Rarity::Transcendent => 160_000,
    }
}

pub fn interaction(def: &ShapeDef) -> crate::flux::Act {
    use crate::flux::Act;
    let (n, d) = rarity_mult(def.rarity);
    match def.family {
        // one-sided shapes route flux instead of amplifying it (the positioning puzzle's "bends")
        "mobius" => Act::Redirect { turn: 1 }, // a gentle 60° half-twist
        _ if is_nonorientable(def.family) => Act::Redirect { turn: 3 }, // Klein/RP²/Boy/cross-cap flip flux 180°
        // knots entangle hardest: the rarity multiplier, boosted by +1×
        _ if is_knot(def.family) => Act::Multiply { num: n + d, den: d },
        // handles scale the rarity base by (2+genus)/2 — i.e. ×(1 + genus/2) of the rarity rational (genus-1 = ×1.5,
        // genus-2 = ×2 of base); MULTIPLICATIVE on (n,d), exact at every rarity (the two forms are algebraically equal)
        _ if def.genus > 0 => Act::Multiply { num: n * (2 + def.genus), den: d * 2 },
        // closed χ=2 ballast (S² = the connected-sum identity) → a FLAT additive baseline, the one non-multiplicative
        // lever: lifts weak beams, negligible on strong ones. (The OPEN χ≠2 ballast cone/disk/cylinder fall through
        // to Multiply below and are the reserved ABSORB home — deferred: a sink verb needs its own shape + tests.)
        _ if is_closed_ballast(def.family) => Act::Amplify { add: amplify_add(def.rarity) },
        // plain solids & lenses: the straight rarity-scaled amplifier
        _ => Act::Multiply { num: n, den: d },
    }
}

/// SECONDARY effect — the second slot in a shape's kit, so rarer shapes do TWO things to flux crossing them
/// (applied right after [`interaction`] on the same cell). Common/Rare have none (`Pass`); Epic and above gain
/// a complementary verb chosen to be interesting next to their primary: knots & 4D/links FORK the beam (Split),
/// one-sided shapes amplify on top of their flip, big handles bend, the rest get a gentle extra lens.
pub fn interaction2(def: &ShapeDef) -> crate::flux::Act {
    use crate::flux::Act;
    use crate::gacha::Rarity;
    if matches!(def.rarity, Rarity::Common | Rarity::Rare) {
        return Act::Pass; // one-effect kit
    }
    let (n, d) = rarity_mult(def.rarity);
    match def.family {
        _ if is_knot(def.family) => Act::Split { turn: 2 }, // entangled beams fork into a wide Y
        _ if is_nonorientable(def.family) => Act::Multiply { num: n, den: d }, // flip AND amplify
        "tesseract" | "cell_16" | "cell_24" | "cell_120" | "cell_600" | "hopf" | "borromean" | "seifert" => {
            Act::Split { turn: 1 } // 4D & links split a second lane off
        }
        _ if def.genus >= 2 => Act::Redirect { turn: 1 }, // big handles amplify then bend
        _ => Act::Multiply { num: 6, den: 5 }, // a gentle ×1.2 second lens
    }
}

/// The *shape* of a gem's orbit on the hex grid. Each pattern's period stays inside [`orrery::ALLOWED_PERIODS`]
/// so the whole-system lcm is ≤ `L_CAP` and offline catch-up remains O(1) — see orrery.rs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LanePattern {
    Line,     // straight out-and-back patrol (the default); period 2(L-1)
    Triangle, // a tight 3-cell triangle loop; period 3
    Ring,     // a hexagonal loop around the anchor (6 neighbours); period 6
}

/// Which orbit shape a gem rides — chosen to echo the geometry: round things loop, pointed things triangle,
/// everything else patrols a line. Pure function of the family (locale-invariant, like all topology data).
pub fn lane_pattern(def: &ShapeDef) -> LanePattern {
    match def.family {
        "sphere" | "ellipsoid" | "disk" | "torus" | "hopf" => LanePattern::Ring,
        "cone" | "tetrahedron" | "monkey_saddle" => LanePattern::Triangle,
        _ => LanePattern::Line,
    }
}

/// Lane length L for a LINE-pattern shape: χ-cost → L ∈ {2,3,4,7} ⇒ period 2(L-1) ∈ {2,4,6,12}. The lcm of any
/// subset of those periods is 12 ≤ L_CAP, so the whole-system period stays bounded and offline stays O(1).
pub fn lane_len(def: &ShapeDef) -> u32 {
    const LENS: [u32; 4] = [2, 3, 4, 7];
    LENS[def.euler_cost.min(3) as usize]
}

/// Lane period — the number of ticks for one full orbit (Line: 2(L-1); Triangle: 3; Ring: 6). Always in
/// `ALLOWED_PERIODS`, so any loadout's system lcm ≤ L_CAP.
pub fn lane_period(def: &ShapeDef) -> u32 {
    match lane_pattern(def) {
        LanePattern::Line => 2 * (lane_len(def) - 1),
        LanePattern::Triangle => 3,
        LanePattern::Ring => 6,
    }
}

/// Default lane direction (hex axis 0..5): genus picks the axis; a non-orientable shape points the opposite
/// way (the "overdrive flip", now literal in the grid).
pub fn default_axis(def: &ShapeDef) -> u8 {
    ((def.genus + if is_nonorientable(def.family) { 3 } else { 0 }) % 6) as u8
}

/// Default phase (timing), spread by deploy slot so freshly-placed shapes don't all start in lockstep.
pub fn default_phase(def: &ShapeDef, slot: usize) -> u8 {
    let period = lane_period(def).max(1);
    ((slot as u32 * 2 + def.genus) % period) as u8
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

// ── Connected-sum topology (M6) ─────────────────────────────────────────────────────────────────────
// The forge IS the surface connected-sum. A closed surface is *uniquely* determined by its Euler
// characteristic χ and its orientability (the surface-classification theorem), so we don't need a
// hand-keyed output table — given the two inputs' invariants the result is forced:
//   χ(A # B) = χ(A) + χ(B) − 2   ·   orientable(A#B) = orientable(A) ∧ orientable(B)   (non-orientability
//   is contagious). Dyck's theorem (a handle on a non-orientable surface ≡ two cross-caps) falls out for
//   free: RP² # T² lands on χ=−1, non-orientable = 3·RP², without any special rule.
// The `RECIPES` list below is now just the *curated, discoverable* subset (the recipe book the player
// sees); `connected_sum` is the law, and a golden test pins every recipe's output to it.

/// Topological class of a surface shape: enough to drive connected-sum (χ + orientability + whether the
/// surface is closed). Non-surface shapes (knots, links, 4-polytopes, fractals, relics) have no class.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SurfaceClass {
    pub chi: i32,
    pub orientable: bool,
    pub closed: bool,
}

/// The surface class of a shape family, or `None` if it isn't a forgeable surface. Authored from real
/// topology — the Platonic solids are all spheres (χ=2); Boy's surface / cross-cap are both ℝP² (χ=1);
/// triple-torus and the Klein quartic are both genus-3 (χ=−4); the Möbius band is the one *bounded* input.
pub fn surface_class(family: &str) -> Option<SurfaceClass> {
    let (chi, orientable, closed) = match family {
        // closed orientable, genus 0 — the sphere and every Platonic solid are topologically a sphere
        "sphere" | "cube" | "tetrahedron" | "octahedron" | "dodecahedron" | "icosahedron" => (2, true, true),
        "torus" => (0, true, true),         // genus 1
        "genus2" => (-2, true, true),       // genus 2
        "triple_torus" | "klein_quartic" => (-4, true, true), // genus 3
        // closed non-orientable
        "klein_bottle" => (0, false, true), // 2 cross-caps
        "rp2" | "boys_surface" | "cross_cap" => (1, false, true), // ℝP² in three disguises
        // bounded: the Möbius band has a boundary circle, so it glues rather than connect-sums
        "mobius" => (0, false, false),
        _ => return None,
    };
    Some(SurfaceClass { chi, orientable, closed })
}

/// The catalogued *closed* surface with a given (χ, orientability) — canonical = lowest id, so when several
/// shapes share a class (ℝP²/Boy/cross-cap; triple-torus/Klein-quartic) the plainest representative wins.
fn surface_with(chi: i32, orientable: bool) -> Option<usize> {
    (0..COUNT).find(|&id| {
        surface_class(SHAPES[id].family).is_some_and(|c| c.closed && c.chi == chi && c.orientable == orientable)
    })
}

/// Connected sum A # B resolved to a catalogued shape, by the real classification theorem — the single
/// source of truth for what a forge produces. `None` if either input isn't a forgeable surface or the
/// result isn't a shape we have in the catalogue.
pub fn connected_sum(a: usize, b: usize) -> Option<usize> {
    if a >= COUNT || b >= COUNT {
        return None;
    }
    let ca = surface_class(SHAPES[a].family)?;
    let cb = surface_class(SHAPES[b].family)?;
    if !ca.closed || !cb.closed {
        // The only bounded input we model: two Möbius bands glued along their boundary close into a Klein
        // bottle (χ stays 0; non-orientable). This is a boundary-glue, not the closed χ−2 formula.
        if SHAPES[a].family == "mobius" && SHAPES[b].family == "mobius" {
            return surface_with(0, false);
        }
        return None;
    }
    surface_with(ca.chi + cb.chi - 2, ca.orientable && cb.orientable)
}

/// Curated, discoverable connected-sum recipes — the recipe book the player sees. Outputs are *computed* by
/// `connected_sum` (golden-tested), never hand-keyed. APPEND-ONLY: `discovered[i]` is positional and saved,
/// so new recipes go on the end and existing rows never move (see `from_json`'s resize).
pub struct Recipe {
    pub a: usize,
    pub b: usize,
    pub out: usize,
}

pub const RECIPES: &[Recipe] = &[
    Recipe { a: 11, b: 11, out: 18 }, // Mö # Mö = Klein bottle (the flagship — two bands glued at the boundary)
    Recipe { a: 19, b: 19, out: 18 }, // ℝP² # ℝP² = Klein bottle
    Recipe { a: 10, b: 10, out: 12 }, // torus # torus = genus-2
    Recipe { a: 10, b: 12, out: 32 }, // torus # genus-2 = triple torus
    Recipe { a: 20, b: 20, out: 18 }, // Boy's # Boy's = Klein bottle (Boy's surface is secretly ℝP²)
    Recipe { a: 21, b: 21, out: 18 }, // cross-cap # cross-cap = Klein bottle (cross-cap is secretly ℝP²)
];

/// Find a recipe matching an unordered input pair.
pub fn find_recipe(a: usize, b: usize) -> Option<usize> {
    RECIPES
        .iter()
        .position(|r| (r.a == a && r.b == b) || (r.a == b && r.b == a))
}

/// Shards to forge a shape of this rarity, before the `forge_mastery` discount. Rarer outputs cost more —
/// the forge is a progression-scaled shard sink, not a flat fee. Epic stays at the familiar 50 so the
/// flagship Klein-bottle recipe feels unchanged. (Relic/Meta/Transcendent aren't normal forge outputs.)
pub fn base_forge_cost(r: Rarity) -> u64 {
    match r {
        Rarity::Common => 15,
        Rarity::Rare => 30,
        Rarity::Epic => 50,
        Rarity::Ssr => 90,
        Rarity::Ur => 150,
        Rarity::Relic | Rarity::Meta | Rarity::Transcendent => 250,
    }
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
pub const UPGRADES: [UpgradeDef; 13] = [
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
    // ── Orrery branch (effect-verb / placement levers — the orrery is the production engine) ──
    UpgradeDef {
        key: "lens_polish",
        flux_cost: 3000.0,
        shard_cost: 20,
        max_level: 3,
        requires: Some((0, 1)),
        secret: false,
    }, // 9: +8% to every Multiply lens on the board / level
    UpgradeDef {
        key: "second_lens",
        flux_cost: 6500.0,
        shard_cost: 40,
        max_level: 1,
        requires: Some((9, 1)),
        secret: false,
    }, // 10: Common/Rare shapes gain a gentle ×1.2 SECOND effect (was Epic+ only)
    UpgradeDef {
        key: "solver_mk2",
        flux_cost: 4000.0,
        shard_cost: 0,
        max_level: 1,
        requires: Some((0, 2)),
        secret: false,
    }, // 11: auto-arrange searches harder (better beam-chain packing)
    UpgradeDef {
        key: "offline_efficiency",
        flux_cost: 3500.0,
        shard_cost: 0,
        max_level: 2,
        requires: Some((3, 1)),
        secret: false,
    }, // 12: orrery offline earns a higher fraction of online / level
];
pub const UPGRADE_COUNT: usize = UPGRADES.len();

/// Flux + Shard cost for the NEXT level of an upgrade (escalates for repeatables).
pub fn upgrade_cost(id: usize, level: u32) -> (f64, u64) {
    let d = &UPGRADES[id];
    let mult = 1.8_f64.powi(level as i32);
    (
        (d.flux_cost * mult * FLUX_DENSITY).floor(), // flux costs scale with the economy (see FLUX_DENSITY)
        (d.shard_cost as f64 * mult).floor() as u64, // shards do NOT
    )
}

/// Facet perks — the PRESTIGE meta-tree. Recrystallizing grants Facets (a meta-currency); these perks are
/// bought with Facets and persist across every New Game+ forever. Effects keyed by index in game.rs.
pub struct FacetPerk {
    pub key: &'static str,
    pub cost: u64,
    pub max_level: u32,
}
pub const FACET_PERKS: [FacetPerk; 7] = [
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
    FacetPerk {
        key: "overflow_resonance",
        cost: 4,
        max_level: 4,
    }, // 5: +10% to the rate cap / level — MULTIPLICATIVE, so the ceiling scales with prestige
    FacetPerk {
        key: "facet_yield",
        cost: 6,
        max_level: 3,
    }, // 6: +1 Facet per ascent / level — keeps the meta-tree fed deep into NG+
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
pub const BANNERS: [BannerDef; 5] = [
    BannerDef {
        key: "standard",
        featured: &[],
        rotating: false,
    },
    BannerDef {
        key: "knots",
        featured: &[16, 22, 23, 28, 29, 42], // +3: hopf was 39, now 42 (Ssr insertions shifted ids >=33)
        rotating: true,
    }, // Knots & Links (UR: Hopf link)
    BannerDef {
        key: "fourth_dim",
        featured: &[36, 37, 38, 39, 40], // +3: the 4D polytopes (tesseract,cell_16,cell_24,cell_120,cell_600) shifted from 33..37
        rotating: true,
    }, // The Fourth Dimension (4D polytopes)
    BannerDef {
        key: "nonorientable",
        featured: &[11, 18, 19, 20, 21, 41], // +3: klein_quartic was 38, now 41 (Ssr insertions shifted ids >=33)
        rotating: true,
    }, // Non-Orientable (UR: Klein quartic)
    BannerDef {
        key: "fractals",
        featured: &[60, 61, 62, 63, 64], // the Transcendent capstone cohort: Bulby, Foldy, Jules, Bubbles, Spire
        rotating: true,
    }, // Fractal Depths (NG+2 capstones — the whole Transcendent tier)
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
    (36, 37), // tesseract ⇄ 16-cell (dual) — +3 from the Ssr insertions
    (39, 40), // 120-cell ⇄ 600-cell (dual) — +3 from the Ssr insertions
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

    const TIERS: [Rarity; 8] = [
        Rarity::Common,
        Rarity::Rare,
        Rarity::Epic,
        Rarity::Ssr,
        Rarity::Ur,
        Rarity::Relic,
        Rarity::Meta,
        Rarity::Transcendent,
    ];

    fn shape_by_family(fam: &str) -> &'static ShapeDef {
        SHAPES.iter().find(|s| s.family == fam).expect("family present in SHAPES")
    }

    #[test]
    fn only_the_sphere_resolves_to_amplify() {
        use crate::flux::Act;
        // S² alone gets the additive verb (economy guard — see is_closed_ballast). Every OTHER genus-0 solid,
        // closed Platonic or open ballast alike, keeps a Multiply lens so the ×1.2 chains the economy needs survive.
        assert!(matches!(interaction(shape_by_family("sphere")), Act::Amplify { .. }), "sphere (S²) should Amplify");
        for fam in ["cube", "tetrahedron", "octahedron", "dodecahedron", "icosahedron", "ellipsoid", "cone", "disk", "cylinder"] {
            let a = interaction(shape_by_family(fam));
            assert!(!matches!(a, Act::Amplify { .. }), "{fam} must NOT Amplify (only S² does)");
            assert!(matches!(a, Act::Multiply { .. }), "{fam} keeps a Multiply lens");
        }
    }

    #[test]
    fn ballast_amplify_add_matches_rarity_ladder() {
        use crate::flux::Act;
        // a Common sphere amplifies by exactly the Common rung (5_000 µ ≈ 0.6× its ~8.3k µ/tick quantum).
        assert_eq!(interaction(shape_by_family("sphere")), Act::Amplify { add: amplify_add(Rarity::Common) });
        assert_eq!(amplify_add(Rarity::Common), 5_000);
    }

    #[test]
    fn amplify_add_monotonic_by_rarity() {
        for w in TIERS.windows(2) {
            assert!(amplify_add(w[0]) < amplify_add(w[1]), "amplify_add must strictly increase: {:?} !< {:?}", w[0], w[1]);
        }
    }

    #[test]
    fn handle_bonus_formula_pins() {
        use crate::flux::Act;
        // pin the handle formula on a synthetic Epic genus-1 def (the shipped torus is Rare): Multiply{ n*(2+1), d*2 }
        // with Epic (n,d)=(2,1) → {6,2} = ×3 = ×1.5 of the ×2 Epic base. Locks code AND the algebraically-equal comment.
        let epic_g1 = ShapeDef { rarity: Rarity::Epic, genus: 1, ..*shape_by_family("torus") };
        assert_eq!(interaction(&epic_g1), Act::Multiply { num: 6, den: 2 });
    }

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
    fn metashapes_are_well_formed() {
        // the NG+ metashapes, at the tail (ids +2 from the Ssr insertion at 33,34)
        assert_eq!(COUNT, 65);
        assert_eq!(rarity_range(Rarity::Meta), 58..60);
        assert_eq!(rarity_range(Rarity::Transcendent), 60..65);
        // they sit ABOVE the pullable core and are NOT Relics
        for id in 58..65 {
            assert!(id >= PULL_COUNT, "metashape {id} must be past the core");
            assert!(!rarity_range(Rarity::Relic).contains(&id), "metashape {id} must not be a Relic");
        }
        // identities + topology classifiers behave as declared
        assert_eq!((SHAPES[58].family, SHAPES[58].rarity), ("clifford_torus", Rarity::Meta));
        assert!(is_polytope_4d("clifford_torus")); // a 4D object → inert until you reach 4D (its unlock)
        assert_eq!((SHAPES[59].family, SHAPES[59].rarity), ("cable_knot", Rarity::Meta));
        assert!(is_knot("cable_knot"));
        // the Transcendent fractal cohort (Bulby + the four "cool SDF" fractals)
        assert_eq!(SHAPES[60].family, "mandelbulb");
        assert_eq!(SHAPES[61].family, "mandelbox");
        assert_eq!(SHAPES[62].family, "julia");
        assert_eq!(SHAPES[63].family, "apollonian");
        assert_eq!(SHAPES[64].family, "kleinian");
        // all produce flux and are orientable (none declared non-orientable)
        for id in 58..65 {
            assert!(SHAPES[id].base_prod > 0.0);
            assert!(!is_nonorientable(SHAPES[id].family));
        }
    }

    #[test]
    fn banner_features_match_their_theme() {
        // Guards against the id-drift that the +3 Ssr insertion caused: themed banners reference shapes by
        // NUMERIC id, so a mid-array insert silently re-points their rate-up. Pin each banner to its topology.
        let fam = |id: usize| SHAPES[id].family;
        for &id in BANNERS[1].featured {
            // Knots & Links — knots, plus the two links (Borromean, Hopf) and the trefoil's Seifert surface.
            let f = fam(id);
            assert!(is_knot(f) || matches!(f, "borromean" | "seifert" | "hopf"), "knots banner features non-knot/link id {id} ({f})");
        }
        for &id in BANNERS[2].featured {
            assert!(is_polytope_4d(fam(id)), "fourth_dim banner features non-4D id {id} ({})", fam(id));
        }
        for &id in BANNERS[3].featured {
            assert!(is_nonorientable(fam(id)), "nonorientable banner features orientable id {id} ({})", fam(id));
        }
        for &id in BANNERS[4].featured {
            // Fractal Depths — the Transcendent capstone cohort (Bulby + the four fractals)
            assert_eq!(SHAPES[id].rarity, Rarity::Transcendent, "fractals banner features non-Transcendent id {id} ({})", fam(id));
        }
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

    // ── Connected-sum topology (the law the recipe book must obey) ──────────────────────────────────────

    #[test]
    fn connected_sum_matches_every_recipe() {
        // The curated `out` of every recipe must equal what the classification theorem computes — and the
        // operation is commutative (inputs are unordered).
        for r in RECIPES.iter() {
            assert_eq!(
                connected_sum(r.a, r.b),
                Some(r.out),
                "recipe {} # {} should connected-sum to {} ({})",
                SHAPES[r.a].nick,
                SHAPES[r.b].nick,
                SHAPES[r.out].nick,
                r.out
            );
            assert_eq!(connected_sum(r.a, r.b), connected_sum(r.b, r.a), "connected sum is commutative");
        }
    }

    #[test]
    fn surface_classification_invariants() {
        // χ + orientability of the catalogued surfaces (real topology).
        let chi = |fam: &str| surface_class(fam).unwrap().chi;
        assert_eq!(chi("sphere"), 2);
        assert_eq!(chi("icosahedron"), 2, "a Platonic solid is a topological sphere");
        assert_eq!(chi("torus"), 0);
        assert_eq!(chi("genus2"), -2);
        assert_eq!(chi("triple_torus"), -4);
        assert_eq!(chi("klein_bottle"), 0);
        assert_eq!(chi("rp2"), 1);
        assert!(!surface_class("klein_bottle").unwrap().orientable);
        assert!(surface_class("torus").unwrap().orientable);
        // ℝP² in three disguises share one class; non-surfaces have none.
        assert_eq!(surface_class("boys_surface"), surface_class("rp2"));
        assert_eq!(surface_class("cross_cap"), surface_class("rp2"));
        assert_eq!(surface_class("trefoil"), None);
        assert_eq!(surface_class("clifford_torus"), None);
        // The Möbius band is the one bounded input.
        assert!(!surface_class("mobius").unwrap().closed);
    }

    #[test]
    fn sphere_is_the_connected_sum_identity() {
        // S² # X = X for every catalogued closed surface (χ: 2 + χ_X − 2 = χ_X; orientability preserved).
        for (id, s) in SHAPES.iter().enumerate() {
            if let Some(c) = surface_class(s.family) {
                if c.closed {
                    assert_eq!(connected_sum(0, id), surface_with(c.chi, c.orientable), "S² # {} = {}", s.nick, s.nick);
                }
            }
        }
    }

    #[test]
    fn dycks_theorem_handle_becomes_two_crosscaps() {
        // ℝP² # T² is non-orientable with χ = 1 + 0 − 2 = −1, i.e. 3 cross-caps (Dyck's surface) — even
        // though we don't catalogue that shape, the *class* must come out right (a handle ≡ two cross-caps).
        let ra = surface_class("rp2").unwrap();
        let t = surface_class("torus").unwrap();
        let chi = ra.chi + t.chi - 2;
        assert_eq!(chi, -1);
        assert!(!(ra.orientable && t.orientable), "non-orientability is contagious");
        assert_eq!(connected_sum(19, 10), None, "3·ℝP² isn't in the catalogue, so the forge yields nothing");
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
