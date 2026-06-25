//! Expeditions — the opt-in idle RPG (a Granblue-style second progression spine).
//!
//! Your collected shapes become a party of adventurers that **delve** into the Manifold to free lost shapes
//! in conventional, legible turn-based fights, then **farm** cleared quests as a closed-form idle source.
//!
//! Architecture (AGENTS.md prime directive): this module is the *truth* — pure, deterministic, integer combat
//! resolved into a `BattleLog` the TS layer merely replays. The idle farm rate is a closed-form f64 (mirrors
//! the over-cap-shard carry pattern) so online and offline accrue bit-identically. Topology is **flavour
//! only**: it themes an advantage-only element wheel + roles + skill flavour, never an esoteric mechanic.
//!
//! Economics: Expeditions is **inert to the core economy** — it grants only Echoes (its own currency) and a
//! bounded, interaction-driven bond bump on a clear. It never raises Flux, shards, or stars, and the whole
//! mode is sealed behind an opt-in surface (a guard test proves the core is 100%-able without ever delving).

use serde::{Deserialize, Serialize};

use crate::rng::rand_u64;

/// RNG stream for combat draws (distinct from gacha streams 1–4, see `gacha`/`game`).
const COMBAT_STREAM: u64 = 5;
/// RNG stream for v6 run non-combat rooms (campfire boon, treasure) — can never collide with combat draws.
pub const RUN_STREAM: u64 = 6;

/// The kind of room in a v6 Delve run (stored as u8 in `RunPlan.room_kind`). v1 ships Combat/Boss/Campfire/
/// Treasure; Elite/Event are reserved for a later phase.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoomKind {
    Combat = 0,
    Boss = 1,
    Campfire = 2,
    Treasure = 3,
    Shrine = 4,   // a no-combat blessing: a light heal + a lasting SPEED boon for the rest of the run
    Decision = 5, // a no-combat crossroads: 2 effect-options, auto-picked at send, optionally overridden live (timeout)
}
impl RoomKind {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
    pub fn is_fight(self) -> bool {
        matches!(self, RoomKind::Combat | RoomKind::Boss)
    }
}

/// SplitMix64 finalizer — derives independent per-room seeds from a run seed (`run_seed ^ splitmix64(k)`), so each
/// room's RNG lineage is distinct yet deterministic. Pure.
pub fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}
/// A battle is abandoned (timeout, no penalty) past this many rounds — keeps every fight bounded & O(1)-ish.
pub const MAX_ROUNDS: u32 = 30;
/// Ultimate charge needed to fire (gained per action + when struck).
const ULT_CHARGE: i64 = 100;
/// ATB readiness needed to take a turn. A unit accrues `speed` per combat round, so speed 100 ⇒ ~1 turn/round
/// (the pre-ATB baseline) and faster units act more often. The action rate is `speed / ATB_THRESHOLD`.
const ATB_THRESHOLD: i64 = 100;
/// Safety bound on actions resolved in a single combat round, so a pathological speed can't stall the scheduler.
const MAX_ACTIONS_PER_ROUND: u32 = 64;

// ── The affinity wheel (advantage-only — there is NO off-type penalty, so you're never punished for
//    bringing who you love) ────────────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Element {
    /// Round / Platonic / closed surfaces / 4D polytopes — the dependable bulk.
    Solid,
    /// Non-orientable shapes (Möbius, Klein, …) — the tricksters.
    Twisted,
    /// Knots & links — the entanglers.
    Woven,
}

impl Element {
    /// The wheel: Solid → Twisted → Woven → Solid (each beats the next; advantage only).
    pub fn beats(self, other: Element) -> bool {
        matches!(
            (self, other),
            (Element::Solid, Element::Twisted)
                | (Element::Twisted, Element::Woven)
                | (Element::Woven, Element::Solid)
        )
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Element::Solid => "solid",
            Element::Twisted => "twisted",
            Element::Woven => "woven",
        }
    }
}

/// A shape's combat element, derived from its declared topology (flavour mapping, never a stored field).
pub fn element_of(family: &str, is_knot: bool, is_nonorientable: bool) -> Element {
    if is_nonorientable {
        Element::Twisted
    } else if is_knot {
        Element::Woven
    } else {
        // a couple of curvy surfaces read as "woven" so the wheel isn't lopsided toward Solid
        match family {
            "trefoil" | "figure8_knot" | "torus_knot_2_5" | "borromean" | "seifert" | "hopf_link" => {
                Element::Woven
            }
            _ => Element::Solid,
        }
    }
}

// ── Roles (a conventional RPG taxonomy derived from existing predicates) ────────────────────────────────
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Role {
    Tank,
    Dps,
    Support,
    Control,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Tank => "tank",
            Role::Dps => "dps",
            Role::Support => "support",
            Role::Control => "control",
        }
    }
}

/// Role from declared predicates: ballast→Tank, knot→Control, non-orientable/4D→Support, else DPS.
pub fn role_of(is_ballast: bool, is_knot: bool, is_support: bool) -> Role {
    if is_ballast {
        Role::Tank
    } else if is_knot {
        Role::Control
    } else if is_support {
        Role::Support
    } else {
        Role::Dps
    }
}

// ── Combatant ──────────────────────────────────────────────────────────────────────────────────────────
#[derive(Clone, Debug)]
pub struct Combatant {
    pub shape_id: i32, // party member's shape id, or -1 for a wild "wash" enemy
    pub nick: String,
    pub family: String,
    pub max_hp: i64,
    pub hp: i64,
    pub atk: i64,
    pub def: i64,
    pub speed: i64,
    pub element: Element,
    pub role: Role,
    pub is_enemy: bool,
    pub ai: AiKind,
    pub reflect: bool,    // non-orientable "Reflect" quirk
    pub ult_power: i64,   // signature-scaled ultimate magnitude (percent of a basic, ≥100)
    // volatile battle state
    pub charge: i64,
    pub atb: i64,      // ATB readiness: gains `speed` each combat round; acts when it crosses ATB_THRESHOLD (faster ⇒ more turns)
    pub atk_up: i64,   // turns remaining
    pub def_down: i64, // turns remaining
    pub regen: i64,    // turns remaining
    pub stun: i64,     // turns remaining
    pub bleed: i64,    // turns remaining — true damage at start of turn
    pub shield: i64,   // absorb pool
    pub cd_a: i64,
    pub cd_b: i64,
    // v5 orders/provisions (transient, never serialized): formation front-row flag + a one-shot revive charge.
    pub front: bool,   // formation: enemies prefer front units (false for all ⇒ v4 targeting)
    pub revive: bool,  // ReviveOnce provision: first faint restores 30% hp (deterministic, logged)
    pub volatile: i32, // #5 lure: on faint, ENRAGES its surviving kin by this % atk (0 = none). A smarter gambit
    // (kill the boss before the lure) beats the auto-default (attack the WEAKEST → pops the lure → the boss rages all fight).
}

impl Combatant {
    pub fn alive(&self) -> bool {
        self.hp > 0
    }
}

/// Wild-enemy behaviour archetypes ("wash" — confused shapes you help, not monsters).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum AiKind {
    Bumper,  // straightforward melee, hits the weakest hero
    Skitter, // hits the strongest-attack hero (disrupt your DPS)
    Warden,  // tanky, low damage, occasionally shields itself
    Hexer,   // applies DEF-down / stun
    Boss,    // uses a heavy periodic special
}

// ── Content: wash enemies, quests, chapters ────────────────────────────────────────────────────────────
pub struct EnemyDef {
    pub key: &'static str,
    pub nick: &'static str,
    pub family: &'static str, // a shape family, so the web reuses glyph/portrait art for the "wash"
    pub element: Element,
    pub ai: AiKind,
    pub hp: i64,
    pub atk: i64,
    pub def: i64,
    pub speed: i64,
}

/// Base wash stats at tier 1; quests scale them up by tier (see `enemy_combatant`).
pub const ENEMIES: &[EnemyDef] = &[
    EnemyDef { key: "drift_mote", nick: "Drift-Mote", family: "sphere", element: Element::Solid, ai: AiKind::Bumper, hp: 120, atk: 26, def: 8, speed: 95 },
    EnemyDef { key: "tangle", nick: "Snarl", family: "trefoil", element: Element::Woven, ai: AiKind::Hexer, hp: 110, atk: 22, def: 10, speed: 110 },
    EnemyDef { key: "wisp", nick: "Wisp", family: "mobius", element: Element::Twisted, ai: AiKind::Skitter, hp: 95, atk: 30, def: 6, speed: 125 },
    EnemyDef { key: "husk", nick: "Husk", family: "cube", element: Element::Solid, ai: AiKind::Warden, hp: 240, atk: 16, def: 22, speed: 70 },
    EnemyDef { key: "ripple", nick: "Ripple", family: "klein_bottle", element: Element::Twisted, ai: AiKind::Bumper, hp: 150, atk: 28, def: 12, speed: 100 },
    // bosses (lost shapes you FREE, not kill — see `recruit_id` on the quest)
    EnemyDef { key: "lost_donut", nick: "the Lost Ring", family: "torus", element: Element::Solid, ai: AiKind::Boss, hp: 900, atk: 40, def: 18, speed: 100 },
    EnemyDef { key: "lost_klein", nick: "the Dimmed Bottle", family: "klein_bottle", element: Element::Twisted, ai: AiKind::Boss, hp: 1300, atk: 52, def: 22, speed: 105 },
    EnemyDef { key: "lost_hept", nick: "the Seven-Fold", family: "heptoroid", element: Element::Solid, ai: AiKind::Boss, hp: 2000, atk: 66, def: 30, speed: 110 },
    EnemyDef { key: "lost_tess", nick: "the Folded Cube", family: "tesseract", element: Element::Solid, ai: AiKind::Boss, hp: 3200, atk: 88, def: 40, speed: 120 },
    // #5 a volatile "lure" (index 9): LOW hp so the auto-gambit's attack-weakest pops it first, LOW atk so an
    // attack-THREAT rule targets the boss instead. On death it ENRAGES its kin (see VOLATILE_ENEMIES) — the soft-wall
    // that makes the gambit depth load-bearing at the final gate.
    EnemyDef { key: "echo_lure", nick: "Echo Lure", family: "klein_bottle", element: Element::Twisted, ai: AiKind::Bumper, hp: 90, atk: 10, def: 0, speed: 90 },
];

/// Enemies that ENRAGE their surviving kin on death (key → +atk % granted to every other living enemy). A soft-wall,
/// not a hard wall: a smarter gambit program (kill the boss BEFORE the lure, so there's nothing left to enrage) beats
/// the auto-default (attack the weakest → pops the lure → the boss rages all fight). Power alone doesn't fix the program.
pub const VOLATILE_ENEMIES: &[(&str, i32)] = &[("echo_lure", 100)];
pub fn enemy_volatile(key: &str) -> i32 {
    VOLATILE_ENEMIES.iter().find(|(k, _)| *k == key).map_or(0, |(_, p)| *p)
}

/// A map node's role. `boss.is_some()` stays the source of truth for boss-ness; Elite is the new opt-in branch.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeKind {
    Combat,
    Elite,
    Boss,
}
impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Combat => "combat",
            NodeKind::Elite => "elite",
            NodeKind::Boss => "boss",
        }
    }
}

pub struct QuestDef {
    pub key: &'static str,
    pub nick: &'static str,
    pub chapter: u32,
    pub min_dim: u32, // viewport_dim gate (3 = available at launch)
    pub tier: u32,    // difficulty tier — scales wash stats & the echo-farm base
    pub enemies: &'static [usize],
    pub boss: Option<usize>,
    pub recruit_id: i32,    // shape id the boss frees on first clear (-1 = none)
    pub base_echo: u64,     // base Echoes/hr at a power-matched party
    pub kind: NodeKind,     // v5: node role (Combat/Elite/Boss) for the journey map
    pub map_xy: (i16, i16), // v5: authored layout for the node-graph (render-only; units of ~10px)
}

/// The quest board, now a JOURNEY NODE-GRAPH (see EDGES). Chapters group nodes into regions; deeper regions gate
/// on the viewport dimension (NG+). Indices 0..12 are append-stable (v5 history/exp_cleared parallel them).
pub const QUESTS: &[QuestDef] = &[
    // ── Chapter 1 — the Shallows (launch, 3D) — mainline lane y=0 ──
    QuestDef { key: "shallows_1", nick: "Tidepool Steps", chapter: 1, min_dim: 3, tier: 1, enemies: &[0, 0], boss: None, recruit_id: -1, base_echo: 60, kind: NodeKind::Combat, map_xy: (0, 0) },
    QuestDef { key: "shallows_2", nick: "Driftwood Hollow", chapter: 1, min_dim: 3, tier: 1, enemies: &[0, 1], boss: None, recruit_id: -1, base_echo: 75, kind: NodeKind::Combat, map_xy: (10, 0) },
    QuestDef { key: "shallows_3", nick: "The Murmuring Shelf", chapter: 1, min_dim: 3, tier: 2, enemies: &[1, 2], boss: None, recruit_id: -1, base_echo: 95, kind: NodeKind::Combat, map_xy: (20, 0) },
    QuestDef { key: "shallows_boss", nick: "The Lost Ring", chapter: 1, min_dim: 3, tier: 2, enemies: &[0], boss: Some(5), recruit_id: 10, base_echo: 130, kind: NodeKind::Boss, map_xy: (30, 0) },
    // ── Chapter 2 — the Folds (3D) ──
    QuestDef { key: "folds_1", nick: "Sunken Gallery", chapter: 2, min_dim: 3, tier: 3, enemies: &[3, 2], boss: None, recruit_id: -1, base_echo: 150, kind: NodeKind::Combat, map_xy: (40, 0) },
    QuestDef { key: "folds_2", nick: "The Inverted Hall", chapter: 2, min_dim: 3, tier: 3, enemies: &[4, 2], boss: None, recruit_id: -1, base_echo: 175, kind: NodeKind::Combat, map_xy: (50, 0) },
    QuestDef { key: "folds_3", nick: "Mirrorwalk", chapter: 2, min_dim: 3, tier: 4, enemies: &[4, 1, 2], boss: None, recruit_id: -1, base_echo: 210, kind: NodeKind::Combat, map_xy: (60, 0) },
    QuestDef { key: "folds_boss", nick: "The Dimmed Bottle", chapter: 2, min_dim: 3, tier: 4, enemies: &[4], boss: Some(6), recruit_id: 18, base_echo: 280, kind: NodeKind::Boss, map_xy: (70, 0) },
    // ── Chapter 3 — the Deep (3D, the toughest pre-ascension) ──
    QuestDef { key: "deep_1", nick: "The Long Dark", chapter: 3, min_dim: 3, tier: 5, enemies: &[3, 3, 1], boss: None, recruit_id: -1, base_echo: 320, kind: NodeKind::Combat, map_xy: (80, 0) },
    QuestDef { key: "deep_2", nick: "Where the Floor Warps", chapter: 3, min_dim: 3, tier: 6, enemies: &[4, 2, 1], boss: None, recruit_id: -1, base_echo: 390, kind: NodeKind::Combat, map_xy: (90, 0) },
    QuestDef { key: "deep_boss", nick: "The Seven-Fold", chapter: 3, min_dim: 3, tier: 6, enemies: &[3], boss: Some(7), recruit_id: 26, base_echo: 520, kind: NodeKind::Boss, map_xy: (100, 0) },
    // ── Chapter 4 — the Higher Vantage (NG+ / viewport ≥ 4) ──
    QuestDef { key: "vantage_1", nick: "Above the Equator", chapter: 4, min_dim: 4, tier: 8, enemies: &[3, 4, 2], boss: None, recruit_id: -1, base_echo: 760, kind: NodeKind::Combat, map_xy: (110, 0) },
    // #5 the tactical climax: the final boss is flanked by an Echo Lure (idx 9) — attack-weakest pops it and the
    // Folded Cube rages; a smarter attack-threat program fells the boss first. Brute power survives; tactics win clean.
    QuestDef { key: "vantage_boss", nick: "The Folded Cube", chapter: 4, min_dim: 4, tier: 9, enemies: &[9, 4], boss: Some(8), recruit_id: 44, base_echo: 1100, kind: NodeKind::Boss, map_xy: (120, 0) },
    // ── Elite branch nodes (v5, appended so indices 0..12 stay stable) — optional harder alt-routes to the boss,
    //    paying a fat first-clear Echoes lump (provision/relic fuel). Lane y=10. ──
    QuestDef { key: "elite_shallows", nick: "Riptide Hollow", chapter: 1, min_dim: 3, tier: 2, enemies: &[2, 2, 3], boss: None, recruit_id: -1, base_echo: 110, kind: NodeKind::Elite, map_xy: (15, 12) },
    QuestDef { key: "elite_folds", nick: "The Cinch", chapter: 2, min_dim: 3, tier: 4, enemies: &[4, 4, 2], boss: None, recruit_id: -1, base_echo: 230, kind: NodeKind::Elite, map_xy: (55, 12) },
    QuestDef { key: "elite_deep", nick: "Crushing Dark", chapter: 3, min_dim: 3, tier: 6, enemies: &[3, 4, 4], boss: None, recruit_id: -1, base_echo: 430, kind: NodeKind::Elite, map_xy: (90, 12) },
];

/// A directed edge in the journey graph (`from` cleared opens `to`). A node with NO in-edges is a region entry
/// (always open at its `min_dim`); a node with in-edges opens when ANY one of them is cleared (OR — so the
/// mainline AND the Elite branch each independently open the boss: "pick your route").
pub struct Edge {
    pub from: usize,
    pub to: usize,
}
pub const EDGES: &[Edge] = &[
    // mainline chain 0→1→…→12
    Edge { from: 0, to: 1 }, Edge { from: 1, to: 2 }, Edge { from: 2, to: 3 },
    Edge { from: 3, to: 4 }, Edge { from: 4, to: 5 }, Edge { from: 5, to: 6 }, Edge { from: 6, to: 7 },
    Edge { from: 7, to: 8 }, Edge { from: 8, to: 9 }, Edge { from: 9, to: 10 },
    Edge { from: 10, to: 11 }, Edge { from: 11, to: 12 },
    // Elite branches (alt route to each region boss): region 1 (0→13→3), region 2 (4→14→7), region 3 (8→15→10)
    Edge { from: 0, to: 13 }, Edge { from: 13, to: 3 },
    Edge { from: 4, to: 14 }, Edge { from: 14, to: 7 },
    Edge { from: 8, to: 15 }, Edge { from: 15, to: 10 },
];

pub const QUEST_COUNT: usize = QUESTS.len();

/// Expedition meta-upgrades, bought with **Echoes** only. Every effect is internal to the mode (party size,
/// farm yield, combat vigor) — NONE touch `globals_mult` or any core currency, so the spoils stay inert.
pub struct ExpPerkDef {
    pub key: &'static str,
    pub cost: u64,    // base Echoes cost (geometric per level)
    pub max_level: u32,
}
pub const EXP_PERKS: &[ExpPerkDef] = &[
    ExpPerkDef { key: "fourth_berth", cost: 400, max_level: 1 }, // +1 party slot (3 → 4)
    ExpPerkDef { key: "rich_currents", cost: 120, max_level: 5 }, // +10%/lvl farm Echoes
    ExpPerkDef { key: "battle_vigor", cost: 200, max_level: 3 }, // party starts each fight with +charge
    ExpPerkDef { key: "stalwart", cost: 250, max_level: 3 }, // +8%/lvl team max HP in COMBAT (folds in exp_combatant — farm-fenced)
];
/// Perk index for `stalwart` (the combat HP perk) — folded in `exp_combatant`, never the farm band.
pub const PERK_STALWART: usize = 3;
pub const EXP_PERK_COUNT: usize = EXP_PERKS.len();

/// One node in a per-ROLE skill tree (shared across all shapes of that role, to bound content). A node grants
/// either a combat StatPct (folds into exp_power) or a farm FarmPct (folds into echo_rate, mode-internal).
pub struct SkillNode {
    pub key: &'static str,
    pub max: u32,
    pub requires: Option<(usize, u32)>, // (node index in this tree, min rank)
    pub stat_pct: i64,
    pub farm_pct: i64,
}
const fn n(key: &'static str, max: u32, requires: Option<(usize, u32)>, stat_pct: i64, farm_pct: i64) -> SkillNode {
    SkillNode { key, max, requires, stat_pct, farm_pct }
}
/// Per-role skill trees, indexed by `Role as usize` (Tank=0, Dps=1, Support=2, Control=3). Endless XP feeds
/// skill points spent here. ≤ MAX_NODES per tree.
pub const SKILL_TREES: [&[SkillNode]; 4] = [
    // Tank
    &[
        n("bulwark", 5, None, 6, 0),
        n("ward", 3, Some((0, 2)), 5, 0),
        n("taunt_grip", 3, None, 0, 8),
        n("anchor", 3, Some((2, 1)), 0, 6),
        n("stonewall", 1, Some((0, 5)), 12, 0),
        n("aegis", 1, Some((1, 3)), 14, 0),
        n("enduring", 5, None, 4, 0),
    ],
    // Dps
    &[
        n("edge", 5, None, 6, 0),
        n("precision", 3, Some((0, 2)), 5, 0),
        n("hunter", 3, None, 0, 8),
        n("momentum", 3, Some((2, 1)), 0, 6),
        n("executioner", 1, Some((0, 5)), 12, 0),
        n("overkill", 1, Some((1, 3)), 14, 0),
        n("relentless", 5, None, 4, 0),
    ],
    // Support
    &[
        n("mend", 5, None, 5, 0),
        n("grace", 3, Some((0, 2)), 4, 0),
        n("wellspring", 3, None, 0, 10),
        n("bounty", 3, Some((2, 1)), 0, 7),
        n("sanctuary", 1, Some((0, 5)), 10, 0),
        n("cleanse_plus", 1, Some((1, 3)), 12, 0),
        n("nurture", 5, None, 4, 0),
    ],
    // Control
    &[
        n("pin", 5, None, 6, 0),
        n("snare", 3, Some((0, 2)), 5, 0),
        n("disrupt", 3, None, 0, 8),
        n("entropy", 3, Some((2, 1)), 0, 6),
        n("dominator", 1, Some((0, 5)), 12, 0),
        n("lockdown", 1, Some((1, 3)), 14, 0),
        n("tactician", 5, None, 4, 0),
    ],
];

// ── v5: provisions, relics, node risk-modifiers (content; effects are folded into the CLEAR battle only) ──
// A deterministic combat/initial-state effect. Kind A = pre-battle state; Kind B = pipeline-constant; plus a
// first-clear-Echoes-only yield bump. NOTHING here touches the farm rate (spec D4) — that fence is load-bearing.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum EffKind {
    StartCharge(u8),     // begin the fight with Ult charge
    StartShield(u16),    // begin with a shield pool (as % of max_hp)
    PartyAtkUp(u8),      // start every member with N turns of atk_up
    ElementShift(Element), // shift the whole party to one element (re-theme the wheel)
    HpBoost(u16),        // +% max_hp
    ReviveOnce,          // first faint revives at 30% hp (deterministic, logged)
    FlatDmgPct(i16),     // ± all outgoing damage %
    FlatDefPct(i16),     // ± defence %
    SpeedPct(i16),       // ± speed %
    DoubleClearEchoes,   // double the FIRST-CLEAR Echoes lump only (never Flux, never the farm rate)
    Reflect,             // grant the Reflect quirk: bounce a sliver of melee damage back at the attacker
}

impl EffKind {
    /// A (tag, magnitude) pair for the web (i18n supplies names/descriptions from the provision/relic key).
    pub fn tag(self) -> (&'static str, i64) {
        use EffKind::*;
        match self {
            StartCharge(n) => ("start_charge", n as i64),
            StartShield(n) => ("start_shield", n as i64),
            PartyAtkUp(n) => ("atk_up", n as i64),
            ElementShift(el) => ("element_shift", el as i64),
            HpBoost(n) => ("hp_boost", n as i64),
            ReviveOnce => ("revive", 0),
            FlatDmgPct(n) => ("dmg_pct", n as i64),
            FlatDefPct(n) => ("def_pct", n as i64),
            SpeedPct(n) => ("speed_pct", n as i64),
            DoubleClearEchoes => ("double_echoes", 0),
            Reflect => ("reflect", 0),
        }
    }
}

/// A consumable provision: bought with Echoes, staged for a team's next clear, consumed on win only.
pub struct ProvisionDef {
    pub key: &'static str,
    pub cost: u64, // Echoes
    pub eff: EffKind,
}
pub const PROVISIONS: &[ProvisionDef] = &[
    ProvisionDef { key: "field_kit", cost: 80, eff: EffKind::StartShield(25) },
    ProvisionDef { key: "war_paint", cost: 110, eff: EffKind::PartyAtkUp(3) },
    ProvisionDef { key: "phoenix_tear", cost: 260, eff: EffKind::ReviveOnce },
    ProvisionDef { key: "prism_draught", cost: 180, eff: EffKind::ElementShift(Element::Twisted) },
    ProvisionDef { key: "iron_rations", cost: 120, eff: EffKind::HpBoost(25) },
    ProvisionDef { key: "double_rations", cost: 320, eff: EffKind::DoubleClearEchoes },
    ProvisionDef { key: "overclock", cost: 150, eff: EffKind::StartCharge(60) },
];
pub const PROVISION_COUNT: usize = PROVISIONS.len();

/// A relic: bought once with Echoes, equipped per team (persistent), with a strong upside + a real downside.
pub struct RelicDef {
    pub key: &'static str,
    pub cost: u64,           // Echoes
    pub up: EffKind,         // the game-breaking upside
    pub down: EffKind,       // the cost you pay for it
}
pub const RELICS: &[RelicDef] = &[
    // A cheaper ENTRY relic (400 vs the flat 600 of the rest) so the relic system has a gentle on-ramp — a sturdy,
    // forgiving pick (lots of bulk, softer punch) that suits a new player still learning the fights.
    RelicDef { key: "teamwork_sigil", cost: 400, up: EffKind::HpBoost(30), down: EffKind::FlatDmgPct(-20) },
    RelicDef { key: "glass_cannon", cost: 600, up: EffKind::FlatDmgPct(40), down: EffKind::FlatDefPct(-35) },
    RelicDef { key: "slow_heart", cost: 600, up: EffKind::HpBoost(45), down: EffKind::SpeedPct(-25) },
    RelicDef { key: "warding_sigil", cost: 600, up: EffKind::StartShield(50), down: EffKind::FlatDmgPct(-15) },
    // a MECHANIC relic (not a stat-swap) — grants the whole party the Reflect bounce, but you go squishier to feel
    // the hits you punish. Creates a "thorns" archetype distinct from the pure stat relics.
    RelicDef { key: "retribution_prism", cost: 500, up: EffKind::Reflect, down: EffKind::FlatDefPct(-20) },
];
pub const RELIC_COUNT: usize = RELICS.len();
pub const RELIC_SLOTS_PER_TEAM: usize = 2;

/// A node risk modifier: harder enemies in the CLEAR battle + a bigger one-time first-clear Echoes lump only.
pub struct NodeModDef {
    pub key: &'static str,
    pub enemy_scale_pct: i64,     // +% to enemy hp/atk/def in the clear battle
    pub first_clear_mult_pct: i64, // +% to the first-clear Echoes lump
}
// CONCAVE rewards: Perilous is the more EFFICIENT trade (reward/risk 2.0), Harrowing pays more in ABSOLUTE
// terms (1.58) but at a worse ratio + a much harder fight (so neither strictly dominates — it's a real choice;
// losing wastes the run, which is the built-in downside).
pub const NODE_MODS: &[NodeModDef] = &[
    NodeModDef { key: "safe", enemy_scale_pct: 0, first_clear_mult_pct: 0 },
    NodeModDef { key: "perilous", enemy_scale_pct: 40, first_clear_mult_pct: 80 },
    NodeModDef { key: "harrowing", enemy_scale_pct: 95, first_clear_mult_pct: 150 },
];
pub const NODE_MOD_COUNT: usize = NODE_MODS.len();

/// A quest's dominant enemy element (majority; ties → Solid) — drives the farm "affinity match" bonus.
pub fn quest_dominant_element(q: &QuestDef) -> Element {
    let mut counts = [0u32; 3];
    for c in quest_enemies(q) {
        counts[match c.element {
            Element::Solid => 0,
            Element::Twisted => 1,
            Element::Woven => 2,
        }] += 1;
    }
    let best = counts.iter().enumerate().max_by_key(|&(_, &n)| n).map(|(i, _)| i).unwrap_or(0);
    [Element::Solid, Element::Twisted, Element::Woven][best]
}

/// Build a wash enemy combatant for a quest tier. Stats scale ~ +55%/tier over the tier-1 base.
pub fn enemy_combatant(enemy_id: usize, tier: u32, idx: usize) -> Combatant {
    let e = &ENEMIES[enemy_id];
    let scale = |v: i64| v * (100 + 55 * (tier.saturating_sub(1)) as i64) / 100;
    Combatant {
        shape_id: -1,
        nick: e.nick.to_string(),
        family: e.family.to_string(),
        max_hp: scale(e.hp),
        hp: scale(e.hp),
        atk: scale(e.atk),
        def: scale(e.def),
        speed: e.speed + idx as i64, // deterministic speed tie-break by slot
        element: e.element,
        role: Role::Dps,
        is_enemy: true,
        ai: e.ai,
        reflect: false,
        ult_power: 180,
        charge: 0,
        atb: 0,
        atk_up: 0,
        def_down: 0,
        regen: 0,
        stun: 0,
        bleed: 0,
        shield: 0,
        cd_a: 0,
        cd_b: 0,
        front: false,
        revive: false,
        volatile: enemy_volatile(e.key),
    }
}

/// The enemy roster for a quest (regular wash + boss, if any), already tier-scaled.
pub fn quest_enemies(q: &QuestDef) -> Vec<Combatant> {
    let mut v: Vec<Combatant> = q
        .enemies
        .iter()
        .enumerate()
        .map(|(i, &eid)| enemy_combatant(eid, q.tier, i))
        .collect();
    if let Some(b) = q.boss {
        v.push(enemy_combatant(b, q.tier, v.len()));
    }
    v
}

/// The CLEAR-battle enemy roster, with a v5 node risk-modifier scaling enemy stats by `extra_pct` (0 = safe).
/// The farm/watch never use this — they use the un-scaled `quest_enemies` (the standing farm is rate-only).
pub fn quest_enemies_scaled(q: &QuestDef, extra_pct: i64) -> Vec<Combatant> {
    let mut v = quest_enemies(q);
    if extra_pct != 0 {
        let s = |x: i64| (x.saturating_mul(100 + extra_pct) / 100).max(1);
        for c in v.iter_mut() {
            c.max_hp = s(c.max_hp);
            c.hp = c.max_hp;
            c.atk = s(c.atk);
            c.def = c.def.saturating_mul(100 + extra_pct) / 100;
        }
    }
    v
}

/// Required party power for a quest (the farm power-band reference). Roughly the enemy HP+offence budget.
pub fn quest_power_req(q: &QuestDef) -> i64 {
    quest_enemies(q)
        .iter()
        .map(|c| c.max_hp / 4 + c.atk * 3)
        .sum::<i64>()
        .max(1)
}

// ── The battle log (the TS layer replays this; it never recomputes the result) ──────────────────────────
#[derive(Serialize, Clone, Debug)]
pub struct LogEvent {
    pub round: u32,
    pub actor: usize,           // index into the combined unit list (party first, then enemies)
    pub action: &'static str,   // "basic" | "skillA" | "skillB" | "ult" | "regen" | "stunned"
    pub target: i32,            // index, or -1 (self / team / none)
    pub dmg: i64,
    pub heal: i64,
    pub status: &'static str,   // applied status label, or ""
    pub fainted: i32,           // unit index that fainted on this event, or -1
    pub rule_idx: i8, // RENDER-ONLY: the gambit rule (0-based) that produced this event, or -1 (legacy ladder / fallback / enemy). Never compared by goldens.
    pub action_id: i8, // RENDER-ONLY: which ACT_* ability produced this event (0-9, see fire_action), or -1. Lets the combat log name the skill.
}

// ── Gambits: FF12-style "when <cond> → do <action>" party programming. Stored as small ints (locale-invariant +
// tiny save); the UI maps them to plain-language labels. An EMPTY per-slot list runs the legacy ladder verbatim,
// so the default is byte-identical. The selector is PURE — it draws zero RNG; only the chosen action rolls. ──
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct GambitRule {
    pub cond: u8,
    pub action: u8,
    pub on: bool,
}

// condition ids — CLOSED set (append-only for save compatibility)
pub const COND_ALWAYS: u8 = 0; // the `_` fallback
pub const COND_ALLY_HURT: u8 = 1; // any living ally < 85% (== the legacy heal gate)
pub const COND_ALLY_LOW: u8 = 2; // any living ally < 40%
pub const COND_SELF_HURT: u8 = 3; // self < 40%
pub const COND_ULT_READY: u8 = 4; // self charge >= ULT_CHARGE
pub const COND_SKILL_READY: u8 = 5; // the rule's action's skill is off cooldown
pub const COND_COUNT: u8 = 6;

// action ids — CLOSED set (append-only). Each maps 1:1 to an act_* fn; role-bound ones only fire for that role.
pub const ACT_ATTACK_WEAKEST: u8 = 0;
pub const ACT_ATTACK_THREAT: u8 = 1;
pub const ACT_ATTACK_FOCUS: u8 = 2;
pub const ACT_HEAL: u8 = 3;
pub const ACT_BUFF_TEAM: u8 = 4;
pub const ACT_GUARD: u8 = 5;
pub const ACT_SWEEP: u8 = 6;
pub const ACT_HEX: u8 = 7;
pub const ACT_FLURRY: u8 = 8;
pub const ACT_ULT: u8 = 9;
pub const ACT_COUNT: u8 = 10;

/// The per-role DEFAULT gambit program (spec D8) — the "smart" template the editor's Auto button writes. Each role's
/// template MUST equal the empty (legacy ladder) program byte-for-byte (pinned by `template_gambits_equal_legacy`), so
/// "Auto" reproduces today's stock behavior — it just makes the implicit ladder explicit + editable. Authoritative
/// (the templates are truth); TS never constructs a gambit program.
pub fn default_gambit_program(role: Role) -> Vec<GambitRule> {
    let r = |cond: u8, action: u8| GambitRule { cond, action, on: true };
    match role {
        Role::Support => vec![r(COND_ULT_READY, ACT_ULT), r(COND_ALLY_HURT, ACT_HEAL), r(COND_SKILL_READY, ACT_BUFF_TEAM), r(COND_ALWAYS, ACT_ATTACK_FOCUS)],
        Role::Tank => vec![r(COND_ULT_READY, ACT_ULT), r(COND_SKILL_READY, ACT_GUARD), r(COND_SKILL_READY, ACT_SWEEP), r(COND_ALWAYS, ACT_ATTACK_FOCUS)],
        Role::Control => vec![r(COND_ULT_READY, ACT_ULT), r(COND_SKILL_READY, ACT_HEX), r(COND_ALWAYS, ACT_ATTACK_FOCUS)],
        Role::Dps => vec![r(COND_ULT_READY, ACT_ULT), r(COND_SKILL_READY, ACT_FLURRY), r(COND_ALWAYS, ACT_ATTACK_FOCUS)],
    }
}

/// The SMART auto-tactics program (gated by the gambit-logic Workshop upgrades) — builds the best EDITABLE program a
/// role can field from the CURRENTLY-UNLOCKED conditions/actions (`conds`/`acts` = the unlocked sets, game.rs is the
/// single source). It contains ONLY unlocked rules (so none are sanitized off) and visibly grows smarter as the
/// player buys upgrades: ult-timing, skill gating, emergency heals, and kill-securing targeting unlock progressively.
/// Always ends with a valid `ALWAYS → attack` (base-unlocked), so the program is never empty. Pure & deterministic.
pub fn smart_gambit_program(role: Role, conds: &[u8], acts: &[u8]) -> Vec<GambitRule> {
    let has_c = |x: u8| conds.contains(&x);
    let has_a = |x: u8| acts.contains(&x);
    let rule = |c: u8, a: u8| GambitRule { cond: c, action: a, on: true };
    let mut prog: Vec<GambitRule> = Vec::new();
    // Fire the Ultimate the instant it's charged (needs the T3 ult-ready read).
    if has_c(COND_ULT_READY) && has_a(ACT_ULT) {
        prog.push(rule(COND_ULT_READY, ACT_ULT));
    }
    match role {
        Role::Support => {
            if has_c(COND_ALLY_LOW) && has_a(ACT_HEAL) {
                prog.push(rule(COND_ALLY_LOW, ACT_HEAL)); // emergency heal first (T2 ally-low read)
            }
            if has_c(COND_ALLY_HURT) && has_a(ACT_HEAL) {
                prog.push(rule(COND_ALLY_HURT, ACT_HEAL)); // gentle top-ups (base)
            }
            if has_c(COND_SKILL_READY) && has_a(ACT_BUFF_TEAM) {
                prog.push(rule(COND_SKILL_READY, ACT_BUFF_TEAM)); // team buff when off cooldown (T3)
            }
        }
        Role::Tank => {
            if has_c(COND_SELF_HURT) && has_a(ACT_GUARD) {
                prog.push(rule(COND_SELF_HURT, ACT_GUARD)); // guard when hurt (base)
            }
            if has_c(COND_SKILL_READY) && has_a(ACT_SWEEP) {
                prog.push(rule(COND_SKILL_READY, ACT_SWEEP)); // sweep when off cooldown (T3)
            }
        }
        Role::Control => {
            if has_c(COND_SKILL_READY) && has_a(ACT_HEX) {
                prog.push(rule(COND_SKILL_READY, ACT_HEX)); // hex when off cooldown (T2 skill-ready read)
            }
        }
        Role::Dps => {
            if has_c(COND_SKILL_READY) && has_a(ACT_FLURRY) {
                prog.push(rule(COND_SKILL_READY, ACT_FLURRY)); // flurry when off cooldown (T2 skill-ready read)
            }
        }
    }
    // Kill-securing finisher: prefer weakest (secure kills) > threat (focus the dangerous) > plain focus (base).
    let attack = if has_a(ACT_ATTACK_WEAKEST) {
        ACT_ATTACK_WEAKEST
    } else if has_a(ACT_ATTACK_THREAT) {
        ACT_ATTACK_THREAT
    } else {
        ACT_ATTACK_FOCUS
    };
    prog.push(rule(COND_ALWAYS, attack));
    prog
}
pub const MAX_GAMBIT_RULES: usize = 8; // cozy ceiling per slot (O(8) scan, small save)

/// A combatant's display info (snapshotted at battle start) so the TS layer can render cards + HP bars and
/// animate the log without recomputing anything.
#[derive(Serialize, Clone, Debug)]
pub struct UnitInfo {
    pub shape_id: i32,
    pub nick: String,
    pub family: String,
    pub is_enemy: bool,
    pub max_hp: i64,
    // Combat stats, snapshotted at battle start so the card/HUD can show them WITHOUT recomputing (mirror, never derive).
    pub atk: i64,
    pub def: i64,
    pub speed: i64,
    pub ult_power: i64,
    pub element: &'static str,
    pub role: &'static str,
}

#[derive(Serialize, Clone, Debug)]
pub struct BattleResult {
    pub win: bool,
    pub rounds: u32,
    pub party_size: usize,
    pub party_survivors: usize,
    pub units: Vec<UnitInfo>,
    pub log: Vec<LogEvent>,
    // Live HP of the party slice (0..party_size) at battle end — used by the v6 run resolver to THREAD survivor
    // HP from one room into the next. Empty for the plain `resolve_battle` wrapper so the watch/clear serialized
    // shape stays byte-identical (skip when empty — v6 D4); only `resolve_battle_from_hp` populates it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub final_hp: Vec<i64>,
}

struct Rng {
    seed: u64,
    ctr: u64,
}
impl Rng {
    fn next(&mut self) -> u64 {
        let v = rand_u64(self.seed, COMBAT_STREAM, self.ctr);
        self.ctr += 1;
        v
    }
    /// True with probability num/den.
    fn chance(&mut self, num: u64, den: u64) -> bool {
        den == 0 || self.next() % den < num
    }
    /// ±variance%: returns a multiplier in [100-v, 100+v] as integer percent.
    fn jitter(&mut self, var: u64) -> i64 {
        if var == 0 {
            100
        } else {
            (100 - var as i64) + (self.next() % (2 * var + 1)) as i64
        }
    }
}

/// Integer damage pipeline (exact order, no floats): base = max(1, atk − def/2), then skill power, then
/// element advantage (×5/4), then attacker ATK-up / defender DEF-down, then a small ±8% jitter.
fn compute_damage(
    rng: &mut Rng,
    atk: i64,
    def: i64,
    skill_power: i64,
    advantage: bool,
    atk_up: bool,
    def_down: bool,
) -> i64 {
    // saturating multiplies: identical to plain `*` for all reachable values, but a crafted/future extreme
    // can't overflow-panic (debug) or wrap (release) and silently break determinism.
    let mut d = (atk - def / 2).max(1);
    d = d.saturating_mul(skill_power) / 100;
    if advantage {
        d = d.saturating_mul(5) / 4;
    }
    if atk_up {
        d = d.saturating_mul(13) / 10;
    }
    if def_down {
        d = d.saturating_mul(13) / 10;
    }
    d = d.saturating_mul(rng.jitter(8)) / 100;
    d.max(1)
}

/// Lowest-HP living index in a side (party or enemies); ties → lowest index.
fn lowest_hp(units: &[Combatant], enemy_side: bool) -> Option<usize> {
    units
        .iter()
        .enumerate()
        .filter(|(_, c)| c.is_enemy == enemy_side && c.alive())
        .min_by_key(|(_, c)| c.hp)
        .map(|(i, _)| i)
}
fn any_living(units: &[Combatant], enemy_side: bool) -> bool {
    units.iter().any(|c| c.is_enemy == enemy_side && c.alive())
}
fn taunter(units: &[Combatant]) -> Option<usize> {
    // a party Tank with DEF-up active is "taunting" — enemies focus it
    units
        .iter()
        .enumerate()
        .find(|(_, c)| !c.is_enemy && c.alive() && c.role == Role::Tank && c.atk_up > 0)
        .map(|(i, _)| i)
}

/// Apply damage (through any shield), return (actual_hp_removed, fainted?). We log the POST-shield amount (the
/// real HP delta), not the raw hit, so the TS layer's pure log-replay tracks engine HP bit-for-bit — a shielded
/// unit never shows falsely dead in the watch (the renderer has no shield model; it just replays `dmg`).
fn deal(target: &mut Combatant, dmg: i64) -> (i64, bool) {
    let mut d = dmg;
    if target.shield > 0 {
        let absorbed = target.shield.min(d);
        target.shield -= absorbed;
        d -= absorbed;
    }
    target.hp -= d;
    let fainted = target.hp <= 0;
    if fainted {
        target.hp = 0;
    }
    (d, fainted)
}

/// Resolve a full battle deterministically. `seed` already folds in (master_seed, quest, party) upstream.
/// The same inputs always yield the same `BattleResult`, so watch == full-auto == a golden test. This is the
/// wrapper used everywhere today; it CLEARS `final_hp` so the serialized BattleResult shape is byte-identical to
/// pre-v6 (the watch/clear paths never need survivor HP). The v6 run resolver calls `resolve_battle_from_hp`.
pub fn resolve_battle(seed: u64, party: Vec<Combatant>, enemies: Vec<Combatant>, focus: i8, gambits: &[Vec<GambitRule>]) -> BattleResult {
    let mut r = resolve_battle_from_hp(seed, party, enemies, focus, gambits);
    r.final_hp = Vec::new();
    r
}

/// The battle core. Accepts a party at ARBITRARY hp (so a run can thread survivor HP room→room) and projects the
/// party's live HP into `final_hp` before returning. `resolve_battle` is the full-HP, final_hp-cleared wrapper.
pub fn resolve_battle_from_hp(seed: u64, mut party: Vec<Combatant>, mut enemies: Vec<Combatant>, focus: i8, gambits: &[Vec<GambitRule>]) -> BattleResult {
    let p = party.len();
    // combined unit list: party first (0..p), enemies after (p..)
    let mut units: Vec<Combatant> = Vec::with_capacity(p + enemies.len());
    units.append(&mut party);
    units.append(&mut enemies);
    let unit_info: Vec<UnitInfo> = units
        .iter()
        .map(|c| UnitInfo {
            shape_id: c.shape_id,
            nick: c.nick.clone(),
            family: c.family.clone(),
            is_enemy: c.is_enemy,
            max_hp: c.max_hp,
            atk: c.atk,
            def: c.def,
            speed: c.speed,
            ult_power: c.ult_power,
            element: c.element.as_str(),
            role: c.role.as_str(),
        })
        .collect();
    let mut rng = Rng { seed, ctr: 0 };
    let mut log: Vec<LogEvent> = Vec::new();
    let mut round = 0u32; // combat-round counter — one ATB time-advance per round; bounds the fight + reports `rounds`
    let mut turn = 0u32; // per-ACTION counter, stamped as LogEvent.round so the watch timeline beats once per turn

    while round < MAX_ROUNDS && any_living(&units, false) && any_living(&units, true) {
        round += 1;
        // ATB time-advance: every living unit accrues `speed` readiness this round (Slice 3 / ATB). Callers keep
        // speed ≥ 1; `.max(0)` defensively guards against a future speed≤0 (debuff/content) ever driving atb negative —
        // a 0-speed unit simply never accrues and stays benched (frozen), it can never act "less than never".
        for u in units.iter_mut() {
            if u.alive() {
                u.atb += u.speed.max(0);
            }
        }
        // Everyone who crossed ATB_THRESHOLD acts this round — readiest first, paying the threshold per action; a
        // FAST unit may act more than once (speed 100 ⇒ ~1 turn/round, baseline). Each action gets its own `turn`,
        // so the watch never fuses two turns into one beat. Bounded by MAX_ACTIONS_PER_ROUND against pathological speed.
        let mut acted = 0u32;
        while acted < MAX_ACTIONS_PER_ROUND {
            if !any_living(&units, false) || !any_living(&units, true) {
                break;
            }
            let actor = match (0..units.len())
                .filter(|&i| units[i].alive() && units[i].atb >= ATB_THRESHOLD)
                .max_by_key(|&i| (units[i].atb, std::cmp::Reverse(i)))
            {
                Some(a) => a, // readiest (highest atb), ties to lowest index — fully deterministic, no RNG
                None => break, // no one is ready ⇒ this round is done, advance the clock again
            };
            units[actor].atb -= ATB_THRESHOLD;
            turn += 1;
            acted += 1;
            // tick down status timers that gate acting
            if units[actor].stun > 0 {
                units[actor].stun -= 1;
                log.push(LogEvent { rule_idx: -1, action_id: -1, round: turn, actor, action: "stunned", target: -1, dmg: 0, heal: 0, status: "", fainted: -1 });
                continue;
            }
            // start-of-turn bleed — true damage (bypasses shield), ticks BEFORE regen so a heal can't be
            // out-paced by the same-turn bleed. Deterministic (no RNG).
            if units[actor].bleed > 0 {
                let bd = (units[actor].max_hp / 16).max(1);
                units[actor].hp -= bd;
                units[actor].bleed -= 1;
                let fainted = units[actor].hp <= 0;
                if fainted {
                    units[actor].hp = 0;
                }
                log.push(LogEvent { rule_idx: -1, action_id: -1, round: turn, actor, action: "bleed", target: actor as i32, dmg: bd, heal: 0, status: "bleed", fainted: if fainted { actor as i32 } else { -1 } });
                if fainted {
                    // ReviveOnce (phoenix_tear) must fire on a START-OF-TURN bleed death exactly as on an attack death:
                    // this branch `continue`s past the post-action revive sweep below, and if this was the last living
                    // hero the battle would END as a loss before any later action could revive them — silently dropping
                    // a charged revive and flipping a winnable fight. So revive here, mirroring the sweep.
                    if units[actor].revive {
                        units[actor].revive = false;
                        units[actor].hp = (units[actor].max_hp * 3 / 10).max(1);
                        log.push(LogEvent { rule_idx: -1, action_id: -1, round: turn, actor, action: "revive", target: actor as i32, dmg: 0, heal: units[actor].hp, status: "revive", fainted: -1 });
                    }
                    continue;
                }
            }
            // start-of-turn regen
            if units[actor].regen > 0 {
                let h = (units[actor].max_hp / 12).max(1);
                let healed = (units[actor].max_hp - units[actor].hp).min(h);
                units[actor].hp += healed;
                units[actor].regen -= 1;
                if healed > 0 {
                    log.push(LogEvent { rule_idx: -1, action_id: -1, round: turn, actor, action: "regen", target: actor as i32, dmg: 0, heal: healed, status: "", fainted: -1 });
                }
            }
            // decay buffs
            if units[actor].atk_up > 0 {
                units[actor].atk_up -= 1;
            }
            if units[actor].def_down > 0 {
                units[actor].def_down -= 1;
            }
            if units[actor].cd_a > 0 {
                units[actor].cd_a -= 1;
            }
            if units[actor].cd_b > 0 {
                units[actor].cd_b -= 1;
            }

            if units[actor].is_enemy {
                enemy_turn(&mut units, actor, turn, &mut rng, &mut log);
            } else {
                hero_turn(&mut units, actor, turn, &mut rng, &mut log, focus, gambits);
            }
            // ReviveOnce (provision): any hero downed THIS action with a revive charge pops back at 30% hp —
            // deterministic (no RNG) and LOGGED (heal from 0 → 30%) so the TS replay tracks HP exactly. The
            // "fainted" event already fired this action, so the watch reads as a death-then-phoenix-revive beat.
            for (i, u) in units.iter_mut().enumerate() {
                if !u.is_enemy && u.hp <= 0 && u.revive {
                    u.revive = false;
                    u.hp = (u.max_hp * 3 / 10).max(1);
                    log.push(LogEvent { rule_idx: -1, action_id: -1, round: turn, actor: i, action: "revive", target: i as i32, dmg: 0, heal: u.hp, status: "revive", fainted: -1 });
                }
            }
            // Volatile lure (#5): on death it ENRAGES its surviving kin (+volatile% atk, permanent). The auto-gambit's
            // attack-weakest pops the lure FIRST (lowest HP) → the boss rages for the whole fight → the party is ground
            // down. A smarter attack-THREAT rule kills the boss first → when the lure dies last there's nothing left to
            // enrage. So the SAME power wins-or-loses on the PROGRAM. Consumed (volatile=0) so it fires once.
            let enraging: Vec<usize> = (0..units.len()).filter(|&i| units[i].volatile > 0 && units[i].hp <= 0).collect();
            for i in enraging {
                let pct = units[i].volatile as i64;
                let side = units[i].is_enemy;
                units[i].volatile = 0;
                for (j, u) in units.iter_mut().enumerate() {
                    if j != i && u.is_enemy == side && u.hp > 0 {
                        u.atk += u.atk * pct / 100; // enrage the surviving boss/kin
                        // attribute the beat to the ENRAGED unit (alive), not the dead lure (the UI-fidelity replay
                        // must never show a downed unit acting).
                        log.push(LogEvent { rule_idx: -1, action_id: -1, round: turn, actor: j, action: "enrage", target: j as i32, dmg: 0, heal: 0, status: "enrage", fainted: -1 });
                    }
                }
            }
            // gain charge for taking a turn — flat (ATB already grants faster units MORE turns, so the speed→ult
            // tempo emerges from turn frequency; no extra speed scaling here, which would double-count).
            units[actor].charge = (units[actor].charge + 18).min(ULT_CHARGE);
        }
    }

    let win = !any_living(&units, true);
    let survivors = units.iter().filter(|c| !c.is_enemy && c.alive()).count();
    let final_hp: Vec<i64> = units[0..p].iter().map(|c| c.hp).collect(); // live party HP to thread into the next room
    BattleResult { win, rounds: round, party_size: p, party_survivors: survivors, units: unit_info, log, final_hp }
}

/// The hero target policy (v5 orders `focus`). focus = -1 adaptive (lowest-hp, the v4 default) → byte-identical;
/// 0 wounded (lowest hp%), 1 threat (highest-atk enemy), 2 boss (highest-max-hp enemy). Pure min/max — zero RNG.
fn focus_target(units: &[Combatant], focus: i8) -> Option<usize> {
    let living = |i: &usize| units[*i].is_enemy && units[*i].alive();
    let idxs = || (0..units.len()).filter(living);
    match focus {
        0 => idxs().min_by_key(|&i| units[i].hp.saturating_mul(1000) / units[i].max_hp.max(1)),
        1 => idxs().max_by_key(|&i| units[i].atk),
        2 => idxs().max_by_key(|&i| units[i].max_hp),
        _ => lowest_hp(units, true), // -1 adaptive (and any unknown) ⇒ v4 lowest-hp
    }
}

/// Resolve a hero's action. If this slot has a non-empty gambit program, scan it; otherwise run the fixed
/// `legacy_ladder` (the byte-identical default). `gambits` is indexed by party-slot == the actor's unit index
/// (party occupies 0..p in `units`). `focus` selects the default target.
fn hero_turn(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8, gambits: &[Vec<GambitRule>]) {
    match gambits.get(actor) {
        Some(rules) if !rules.is_empty() => run_gambits(units, actor, round, rng, log, focus, rules),
        _ => legacy_ladder(units, actor, round, rng, log, focus),
    }
}

/// Scan a slot's gambit list top-down: the first ENABLED rule whose (pure) condition matches AND whose action
/// legally fires wins. Falls through to a basic attack so a unit never idles. The condition scan + cooldown
/// checks draw ZERO RNG (like `focus_target`); only the fired action's compute_damage/chance advances `ctr` —
/// so a program that selects the same (action,target) sequence as the ladder yields a byte-identical log.
fn run_gambits(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8, rules: &[GambitRule]) {
    for (idx, r) in rules.iter().enumerate() {
        if !r.on {
            continue;
        }
        if cond_matches(units, actor, *r) {
            let before = log.len();
            if fire_action(units, actor, round, rng, log, focus, r.action) {
                // RENDER-ONLY tag: mark every event this fired rule produced so the watch can surface it (the
                // tag is never read by the truth path or compared by goldens — log_key omits rule_idx).
                for e in log[before..].iter_mut() {
                    e.rule_idx = idx as i8;
                }
                return;
            }
        }
    }
    act_basic(units, actor, round, rng, log, focus_target(units, focus)); // guaranteed fallback (rule_idx stays -1)
}

/// The LOCKED-default program for an empty slot BEFORE the player buys auto-tactics (Workshop). Deliberately
/// simple: ult-when-charged → the role's PRIMARY skill when ready → basic attack on the focus target. It drops
/// what `legacy_ladder` (= the auto-tactics reward) adds — the SECOND role skill, HP-conditional prioritisation,
/// and smart weakest/threat targeting. Expressed in the existing GambitRule vocabulary so it runs through
/// `run_gambits` with ZERO new combat code; deterministic (cond scan + fire_action draw no extra RNG).
pub fn simple_program(role: Role) -> Vec<GambitRule> {
    let primary = match role {
        Role::Support => ACT_HEAL,
        Role::Tank => ACT_GUARD,
        Role::Control => ACT_HEX,
        Role::Dps => ACT_FLURRY,
    };
    vec![
        GambitRule { cond: COND_ULT_READY, action: ACT_ULT, on: true },
        GambitRule { cond: COND_SKILL_READY, action: primary, on: true },
        GambitRule { cond: COND_ALWAYS, action: ACT_ATTACK_FOCUS, on: true },
    ]
}

/// Is the skill a given action maps to off cooldown / chargeable? (basic attacks are always "ready"). Pure.
fn skill_ready(units: &[Combatant], actor: usize, action: u8) -> bool {
    match action {
        ACT_HEAL | ACT_GUARD | ACT_HEX => units[actor].cd_a == 0,
        ACT_BUFF_TEAM | ACT_SWEEP | ACT_FLURRY => units[actor].cd_b == 0,
        ACT_ULT => units[actor].charge >= ULT_CHARGE,
        _ => true,
    }
}

/// Evaluate a gambit condition — PURE (min/max/compare over `units`, zero RNG), exactly like `focus_target`.
fn cond_matches(units: &[Combatant], actor: usize, rule: GambitRule) -> bool {
    match rule.cond {
        COND_ALWAYS => true,
        COND_ALLY_HURT => units.iter().any(|c| !c.is_enemy && c.alive() && c.hp * 20 < c.max_hp * 17),
        COND_ALLY_LOW => units.iter().any(|c| !c.is_enemy && c.alive() && c.hp * 5 < c.max_hp * 2),
        COND_SELF_HURT => units[actor].hp * 5 < units[actor].max_hp * 2,
        COND_ULT_READY => units[actor].charge >= ULT_CHARGE,
        COND_SKILL_READY => skill_ready(units, actor, rule.action),
        _ => false, // unknown ⇒ never matches (tampered save)
    }
}

/// Fire a gambit action, returning whether it actually fired. Role-bound actions only fire for that role (an
/// out-of-role or unknown action returns false so the scan continues); each act_* also self-checks cd/charge/target.
fn fire_action(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8, action: u8) -> bool {
    let role = units[actor].role;
    let before = log.len();
    let fired = match action {
        ACT_ATTACK_WEAKEST => act_basic(units, actor, round, rng, log, focus_target(units, -1)),
        ACT_ATTACK_THREAT => act_basic(units, actor, round, rng, log, focus_target(units, 1)),
        ACT_ATTACK_FOCUS => act_basic(units, actor, round, rng, log, focus_target(units, focus)),
        ACT_HEAL if role == Role::Support => act_heal(units, actor, round, log),
        ACT_BUFF_TEAM if role == Role::Support => act_buff_team(units, actor, round, log),
        ACT_GUARD if role == Role::Tank => act_guard(units, actor, round, log),
        ACT_SWEEP if role == Role::Tank => act_sweep(units, actor, round, rng, log, focus),
        ACT_HEX if role == Role::Control => act_hex(units, actor, round, rng, log, focus),
        ACT_FLURRY if role == Role::Dps => act_flurry(units, actor, round, rng, log, focus),
        ACT_ULT => act_ult(units, actor, round, rng, log),
        _ => false,
    };
    if fired {
        // stamp every event this action produced with its id, so the combat log can name the ability (render-only)
        for e in log[before..].iter_mut() {
            e.action_id = action as i8;
        }
    }
    fired
}

/// The original fixed ladder, now a thin sequence over the extracted `act_*` actions in their exact prior order.
fn legacy_ladder(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8) {
    if act_ult(units, actor, round, rng, log) {
        return;
    }
    match units[actor].role {
        Role::Support => {
            if act_heal(units, actor, round, log) {
                return;
            }
            if act_buff_team(units, actor, round, log) {
                return;
            }
        }
        Role::Tank => {
            if act_guard(units, actor, round, log) {
                return;
            }
            if act_sweep(units, actor, round, rng, log, focus) {
                return;
            }
        }
        Role::Control => {
            if act_hex(units, actor, round, rng, log, focus) {
                return;
            }
        }
        Role::Dps => {
            if act_flurry(units, actor, round, rng, log, focus) {
                return;
            }
        }
    }
    act_basic(units, actor, round, rng, log, focus_target(units, focus));
}

// ── the extracted hero actions. Each checks its OWN legality (cooldown / charge / a valid target) and returns
// `true` if it fired (mutating + logging exactly as the legacy ladder did) or `false` if it was illegal — in
// which case the caller (ladder or gambit scan) tries the next option. NO action draws RNG except via the
// existing compute_damage / rng.chance, so the COMBAT_STREAM counter advances identically to before. ──

/// Ultimate (any role) — fires only when fully charged. Resets charge then dispatches by role.
fn act_ult(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>) -> bool {
    if units[actor].charge < ULT_CHARGE {
        return false;
    }
    units[actor].charge = 0;
    let role = units[actor].role;
    ultimate(units, actor, role, round, rng, log);
    true
}

/// Support skillA — heal the most-wounded ally if anyone is below 85% and it's off cooldown.
fn act_heal(units: &mut [Combatant], actor: usize, round: u32, log: &mut Vec<LogEvent>) -> bool {
    if let Some(t) = most_wounded_ally(units, actor) {
        if units[t].hp * 20 < units[t].max_hp * 17 && units[actor].cd_a == 0 {
            let h = (units[actor].atk * 2).max(1);
            let healed = (units[t].max_hp - units[t].hp).min(h);
            units[t].hp += healed;
            units[t].regen = units[t].regen.max(2);
            units[t].shield += units[actor].atk; // a little ward on top of the mend
            units[actor].cd_a = 2;
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillA", target: t as i32, dmg: 0, heal: healed, status: "regen", fainted: -1 });
            return true;
        }
    }
    false
}

/// Support skillB — team ATK-up (off cooldown).
fn act_buff_team(units: &mut [Combatant], actor: usize, round: u32, log: &mut Vec<LogEvent>) -> bool {
    if units[actor].cd_b == 0 {
        for c in units.iter_mut().filter(|c| !c.is_enemy && c.alive()) {
            c.atk_up = c.atk_up.max(3);
        }
        units[actor].cd_b = 3;
        log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillB", target: -1, dmg: 0, heal: 0, status: "atk_up", fainted: -1 });
        return true;
    }
    false
}

/// Tank skillA — Taunt: self ATK-up marker (read as taunt by enemy AI) + a shield (off cooldown).
fn act_guard(units: &mut [Combatant], actor: usize, round: u32, log: &mut Vec<LogEvent>) -> bool {
    if units[actor].cd_a == 0 {
        units[actor].atk_up = units[actor].atk_up.max(3); // reuse atk_up flag as the "taunt/guard" marker
        units[actor].shield += units[actor].max_hp / 5;
        units[actor].cd_a = 3;
        log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillA", target: actor as i32, dmg: 0, heal: 0, status: "guard", fainted: -1 });
        return true;
    }
    false
}

/// Tank skillB — Bulwark Sweep: re-assert the taunt + a DEF-down strike on the focus target (off cooldown).
fn act_sweep(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8) -> bool {
    if units[actor].cd_b == 0 {
        units[actor].atk_up = units[actor].atk_up.max(3);
        if let Some(t) = focus_target(units, focus) {
            let adv = units[actor].element.beats(units[t].element);
            let dmg = compute_damage(rng, units[actor].atk, units[t].def, 70, adv, units[actor].atk_up > 0, units[t].def_down > 0);
            let (dealt, fainted) = deal(&mut units[t], dmg);
            units[t].def_down = units[t].def_down.max(2);
            units[actor].cd_b = 3;
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillB", target: t as i32, dmg: dealt, heal: 0, status: "def_down", fainted: if fainted { t as i32 } else { -1 } });
            return true;
        }
    }
    false
}

/// Control skillA — Hex: a heavy DEF-down strike on the focus target with a stun roll (off cooldown).
fn act_hex(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8) -> bool {
    if units[actor].cd_a == 0 {
        if let Some(t) = focus_target(units, focus) {
            let adv = units[actor].element.beats(units[t].element);
            let dmg = compute_damage(rng, units[actor].atk, units[t].def, 110, adv, units[actor].atk_up > 0, units[t].def_down > 0);
            let (dealt, fainted) = deal(&mut units[t], dmg);
            units[t].def_down = units[t].def_down.max(3);
            let stunned = rng.chance(45, 100);
            if stunned {
                units[t].stun = units[t].stun.max(1);
                units[t].bleed = units[t].bleed.max(3); // a hard lock-down also leaves them bleeding
            }
            units[actor].cd_a = 3;
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillA", target: t as i32, dmg: dealt, heal: 0, status: if stunned { "stun" } else { "def_down" }, fainted: if fainted { t as i32 } else { -1 } });
            return true;
        }
    }
    false
}

/// Dps skillB — Flurry: 3 (or 4 when near-charged) smaller hits on the focus target (off cooldown).
fn act_flurry(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, focus: i8) -> bool {
    if units[actor].cd_b == 0 {
        let hits = if units[actor].charge >= 72 { 4 } else { 3 };
        for _ in 0..hits {
            if let Some(t) = focus_target(units, focus) {
                let adv = units[actor].element.beats(units[t].element);
                let dmg = compute_damage(rng, units[actor].atk, units[t].def, 55, adv, units[actor].atk_up > 0, units[t].def_down > 0);
                let (dealt, fainted) = deal(&mut units[t], dmg);
                log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillB", target: t as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { t as i32 } else { -1 } });
            }
        }
        units[actor].cd_b = 2;
        return true;
    }
    false
}

/// Basic attack on an explicit target (the 3 gambit attack-verbs differ only in how `target` is chosen).
fn act_basic(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>, target: Option<usize>) -> bool {
    if let Some(t) = target {
        let adv = units[actor].element.beats(units[t].element);
        let power = if units[actor].role == Role::Dps { 120 } else { 90 };
        let dmg = compute_damage(rng, units[actor].atk, units[t].def, power, adv, units[actor].atk_up > 0, units[t].def_down > 0);
        let (dealt, fainted) = deal(&mut units[t], dmg);
        log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "basic", target: t as i32, dmg: dealt, heal: 0, status: if adv { "adv" } else { "" }, fainted: if fainted { t as i32 } else { -1 } });
        return true;
    }
    false
}

fn ultimate(units: &mut [Combatant], actor: usize, role: Role, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>) {
    let up = units[actor].ult_power; // ≥100, signature-scaled
    match role {
        Role::Support => {
            // big team heal + cleanse (one event per ally ⇒ exact HP replay)
            let h = units[actor].atk * up / 100 * 2;
            for (i, c) in units.iter_mut().enumerate() {
                if !c.is_enemy && c.alive() {
                    let healed = (c.max_hp - c.hp).min(h);
                    c.hp += healed;
                    c.stun = 0;
                    c.def_down = 0;
                    log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "ult", target: i as i32, dmg: 0, heal: healed, status: "cleanse", fainted: -1 });
                }
            }
        }
        Role::Tank => {
            // team shield (shields don't change HP, so one event per ally just telegraphs the bulwark)
            for (i, c) in units.iter_mut().enumerate() {
                if !c.is_enemy && c.alive() {
                    c.shield += c.max_hp / 4;
                    log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "ult", target: i as i32, dmg: 0, heal: 0, status: "bulwark", fainted: -1 });
                }
            }
        }
        _ => {
            // Control/DPS ult: heavy hit on all enemies (one event per target)
            let targets: Vec<usize> = (0..units.len()).filter(|&i| units[i].is_enemy && units[i].alive()).collect();
            for t in targets {
                let adv = units[actor].element.beats(units[t].element);
                let dmg = compute_damage(rng, units[actor].atk, units[t].def, up, adv, units[actor].atk_up > 0, units[t].def_down > 0);
                let (dealt, fainted) = deal(&mut units[t], dmg);
                log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "ult", target: t as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { t as i32 } else { -1 } });
            }
        }
    }
}

/// Enemy target policy. A taunting Tank always wins. Otherwise, if the FORMATION designated any living front-row
/// hero (orders formation != balanced), enemies are kept to the front pool; else they target across the whole
/// party (the v4 behaviour — so balanced formation stays byte-identical). Pure min/max, zero RNG.
fn enemy_target(units: &[Combatant], ai: AiKind) -> Option<usize> {
    if let Some(tk) = taunter(units) {
        return Some(tk);
    }
    let any_front = units.iter().any(|c| !c.is_enemy && c.alive() && c.front);
    let in_pool = |i: usize| {
        let c = &units[i];
        !c.is_enemy && c.alive() && (!any_front || c.front)
    };
    let idxs = (0..units.len()).filter(|&i| in_pool(i));
    match ai {
        AiKind::Skitter => idxs.max_by_key(|&i| units[i].atk),
        _ => idxs.min_by_key(|&i| units[i].hp),
    }
}

fn enemy_turn(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>) {
    let ai = units[actor].ai;
    let target = enemy_target(units, ai);
    let Some(t) = target else { return };

    // bosses periodically use a heavy special (all-party hit)
    if ai == AiKind::Boss && units[actor].charge >= ULT_CHARGE {
        units[actor].charge = 0;
        let targets: Vec<usize> = (0..units.len()).filter(|&i| !units[i].is_enemy && units[i].alive()).collect();
        for ti in targets {
            let dmg = compute_damage(rng, units[actor].atk, units[ti].def, 130, false, units[actor].atk_up > 0, units[ti].def_down > 0);
            let (dealt, fainted) = deal(&mut units[ti], dmg);
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "ult", target: ti as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { ti as i32 } else { -1 } });
        }
        return;
    }

    match ai {
        AiKind::Warden if rng.chance(1, 3) => {
            units[actor].shield += units[actor].max_hp / 6;
            units[actor].def_down = 0; // bracing also shakes off a DEF-down
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillA", target: actor as i32, dmg: 0, heal: 0, status: "guard", fainted: -1 });
        }
        AiKind::Hexer if rng.chance(1, 2) => {
            let dmg = compute_damage(rng, units[actor].atk, units[t].def, 80, false, units[actor].atk_up > 0, units[t].def_down > 0);
            let (dealt, fainted) = deal(&mut units[t], dmg);
            units[t].def_down = units[t].def_down.max(2);
            units[t].bleed = units[t].bleed.max(2); // a hex leaves a lingering bleed
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "skillA", target: t as i32, dmg: dealt, heal: 0, status: "def_down", fainted: if fainted { t as i32 } else { -1 } });
        }
        _ => {
            let dmg = compute_damage(rng, units[actor].atk, units[t].def, 100, false, units[actor].atk_up > 0, units[t].def_down > 0);
            let (dealt, fainted) = deal(&mut units[t], dmg);
            // Skitter jostles the hero it hits (a high-ATK DPS) — pushes their Flurry off-rhythm a beat.
            if units[actor].ai == AiKind::Skitter && !units[t].is_enemy && units[t].alive() {
                units[t].cd_b = units[t].cd_b.max(1);
            }
            log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor, action: "basic", target: t as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { t as i32 } else { -1 } });
            // Reflect quirk: a non-orientable hero bounces a sliver back at a melee attacker
            if !units[t].is_enemy && units[t].reflect && units[t].alive() {
                let bounce = (dealt / 5).max(1);
                let (_, f2) = deal(&mut units[actor], bounce);
                log.push(LogEvent { rule_idx: -1, action_id: -1, round,actor: t, action: "skillB", target: actor as i32, dmg: bounce, heal: 0, status: "reflect", fainted: if f2 { actor as i32 } else { -1 } });
            }
        }
    }
    // enemy charge for boss specials
    units[actor].charge = (units[actor].charge + 16).min(ULT_CHARGE);
}

fn most_wounded_ally(units: &[Combatant], actor: usize) -> Option<usize> {
    let _ = actor;
    units
        .iter()
        .enumerate()
        .filter(|(_, c)| !c.is_enemy && c.alive())
        .min_by_key(|(_, c)| c.hp * 1000 / c.max_hp.max(1))
        .map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hero(atk: i64, hp: i64, role: Role, el: Element) -> Combatant {
        Combatant {
            shape_id: 0, nick: "H".into(), family: "sphere".into(), max_hp: hp, hp, atk, def: 12,
            speed: 100, element: el, role, is_enemy: false, ai: AiKind::Bumper, reflect: false,
            ult_power: 200, charge: 0, atb: 0, atk_up: 0, def_down: 0, regen: 0, stun: 0, bleed: 0, shield: 0, cd_a: 0, cd_b: 0,
            front: false, revive: false, volatile: 0,
        }
    }

    #[test]
    fn wheel_is_a_cycle() {
        assert!(Element::Solid.beats(Element::Twisted));
        assert!(Element::Twisted.beats(Element::Woven));
        assert!(Element::Woven.beats(Element::Solid));
        assert!(!Element::Solid.beats(Element::Woven)); // advantage only, no reverse
        assert!(!Element::Solid.beats(Element::Solid));
    }

    #[test]
    fn volatile_lure_punishes_attack_weakest_and_rewards_attack_threat() {
        // #5: an encounter with a low-HP volatile LURE + a boss. The auto-default (attack the weakest) pops the lure
        // → it DETONATES → the party suffers. A smarter program (attack the THREAT, leave the lure) ends cleaner. This
        // makes the gambit depth LOAD-BEARING — a soft-wall that authoring beats, not just raw power.
        let lure = ENEMIES.iter().position(|e| e.key == "echo_lure").unwrap();
        let boss = ENEMIES.iter().position(|e| e.key == "lost_klein").unwrap();
        let party = || vec![hero(95, 800, Role::Dps, Element::Solid), hero(95, 800, Role::Dps, Element::Solid), hero(45, 1000, Role::Tank, Element::Solid)];
        let foes = || vec![enemy_combatant(lure, 1, 0), enemy_combatant(boss, 1, 1)];
        let prog = |act: u8| -> Vec<Vec<GambitRule>> { vec![vec![GambitRule { cond: COND_ALWAYS, action: act, on: true }]; 3] };
        let weak = resolve_battle_from_hp(7, party(), foes(), -1, &prog(ACT_ATTACK_WEAKEST));
        let threat = resolve_battle_from_hp(7, party(), foes(), -1, &prog(ACT_ATTACK_THREAT));
        assert!(weak.log.iter().any(|e| e.status == "enrage"), "attack-weakest pops the lure → the boss enrages for the rest of the fight");
        let hp = |r: &BattleResult| r.final_hp.iter().map(|&h| h.max(0)).sum::<i64>();
        assert!(threat.win, "the attack-threat plan clears it (kills the boss before the lure can enrage it)");
        assert!(hp(&threat) > hp(&weak), "the tactic pays — attack-threat ends with more party HP ({} vs {})", hp(&threat), hp(&weak));
    }

    #[test]
    fn battle_is_deterministic() {
        let party = vec![hero(120, 400, Role::Dps, Element::Solid), hero(60, 600, Role::Tank, Element::Solid)];
        let enemies = quest_enemies(&QUESTS[0]);
        let a = resolve_battle(99, party.clone(), enemies.clone(), -1, &[]);
        let b = resolve_battle(99, party, enemies, -1, &[]);
        assert_eq!(a.win, b.win);
        assert_eq!(a.rounds, b.rounds);
        assert_eq!(a.log.len(), b.log.len());
        // bit-identical event stream
        for (x, y) in a.log.iter().zip(b.log.iter()) {
            assert_eq!(x.dmg, y.dmg);
            assert_eq!(x.actor, y.actor);
            assert_eq!(x.action, y.action);
        }
    }

    #[test]
    fn strong_party_beats_first_quest() {
        let party = vec![
            hero(200, 500, Role::Dps, Element::Solid),
            hero(80, 900, Role::Tank, Element::Solid),
            hero(120, 500, Role::Support, Element::Solid),
        ];
        let r = resolve_battle(1, party, quest_enemies(&QUESTS[0]), -1, &[]);
        assert!(r.win, "a strong party should clear the tutorial quest");
        assert!(r.rounds < MAX_ROUNDS);
    }

    #[test]
    fn weak_party_loses_without_penalty_semantics() {
        // a single feeble hero against a boss quest should fail (loss is free; the caller grants nothing)
        let party = vec![hero(8, 60, Role::Dps, Element::Solid)];
        let r = resolve_battle(3, party, quest_enemies(&QUESTS[7]), -1, &[]);
        assert!(!r.win);
    }

    #[test]
    fn quests_gate_and_recruit_is_valid() {
        for q in QUESTS {
            assert!(q.min_dim >= 3);
            assert!(q.recruit_id == -1 || (q.recruit_id as usize) < crate::content::COUNT);
            assert!(!q.enemies.is_empty() || q.boss.is_some());
        }
    }

    // ── Gambit party-programming: determinism + faithfulness (the keystone safety properties) ──
    fn gr(cond: u8, action: u8) -> GambitRule {
        GambitRule { cond, action, on: true }
    }
    /// The per-role default editor templates (spec D8) — each MUST equal the empty (legacy) program byte-for-byte.
    fn template_for(role: Role) -> Vec<GambitRule> {
        // delegate to the production template so the editor's Auto button + this keystone test share ONE source.
        default_gambit_program(role)
    }
    fn log_key(e: &LogEvent) -> (usize, &'static str, i32, i64, i64, i32) {
        (e.actor, e.action, e.target, e.dmg, e.heal, e.fainted)
    }
    // (round, actor, action, target, dmg, heal, status, fainted) — the full golden-log row for value-pinning tests.
    type GoldenRow = (u32, usize, &'static str, i32, i64, i64, &'static str, i32);

    #[test]
    fn legacy_ladder_golden_log_is_pinned() {
        // Pins the EXACT default-ladder combat output for a fixed party+quest+seed. The keystone tests prove
        // default==legacy_ladder (internal consistency); THIS guards the actual dmg/heal/action VALUES so a future
        // edit to any act_* (the v5 combat depth: flurry retarget, atk*2 heal+shield, bleed-on-stun, sweep) is caught.
        let party = vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        let r = resolve_battle(7, party, quest_enemies(&QUESTS[0]), -1, &[]);
        assert!(r.win);
        assert_eq!(r.rounds, 2);
        let got: Vec<GoldenRow> = r.log.iter().map(|e| (e.round, e.actor, e.action, e.target, e.dmg, e.heal, e.status, e.fainted)).collect();
        // Note (ATB): the first column is now a per-TURN counter (the watch beats once per turn), not a combat round —
        // hence 1,1,1,2,3,4 rather than 1,1,1,1,1,2. Every dmg/heal/action/target is byte-identical to pre-ATB, which
        // proves ATB re-sequenced the turns WITHOUT changing the combat math for these speed-100 units.
        let want: Vec<GoldenRow> = vec![
            (1, 0, "skillB", 2, 57, 0, "", -1),
            (1, 0, "skillB", 2, 65, 0, "", 2),
            (1, 0, "skillB", 3, 63, 0, "", -1),
            (2, 1, "skillB", -1, 0, 0, "atk_up", -1),
            (3, 3, "basic", 1, 20, 0, "", -1),
            (4, 0, "basic", 3, 185, 0, "", 3),
        ];
        assert_eq!(got, want, "combat golden drifted — a default-ladder value/sequence changed");
    }

    #[test]
    fn update_golden_printer() {
        // De-risks RE-PINNING the combat golden when a balance change is INTENDED (Slices 2-4). Run:
        //   UPDATE_GOLDEN=1 cargo test update_golden_printer -- --nocapture
        // then paste the printed rows into `legacy_ladder_golden_log_is_pinned`. No-op (passes) otherwise, so
        // it never blocks CI — it exists purely so the golden is regenerated mechanically, never hand-typed.
        if std::env::var("UPDATE_GOLDEN").is_err() {
            return;
        }
        let party = vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        let r = resolve_battle(7, party, quest_enemies(&QUESTS[0]), -1, &[]);
        eprintln!("// assert rounds == {}", r.rounds);
        for e in &r.log {
            eprintln!(
                "            ({}, {}, {:?}, {}, {}, {}, {:?}, {}),",
                e.round, e.actor, e.action, e.target, e.dmg, e.heal, e.status, e.fainted
            );
        }
    }

    #[test]
    fn unit_info_carries_combat_stats() {
        // Slice 1: the UnitInfo projection surfaces atk/def/speed/ult_power verbatim from the Combatant (so the
        // TS card/HUD mirror, never recompute). Pin that the projection is faithful and the values are sane.
        let h = hero(120, 1000, Role::Dps, Element::Solid);
        let (atk, def, speed, ult) = (h.atk, h.def, h.speed, h.ult_power);
        let r = resolve_battle(7, vec![h], quest_enemies(&QUESTS[0]), -1, &[]);
        let u = &r.units[0];
        assert_eq!((u.atk, u.def, u.speed, u.ult_power), (atk, def, speed, ult), "UnitInfo must mirror the Combatant stats");
        assert!(u.atk > 0 && u.speed > 0 && u.ult_power >= 100, "combat stats must be populated, not defaulted to 0");
    }

    #[test]
    fn speed_scales_ult_charge_so_faster_ults_sooner() {
        // Slice 3: ult charge accrues ∝ speed, so a faster unit reaches its Ultimate in fewer rounds (speed → tempo).
        let mk = |spd: i64, enemy: bool| {
            let mut c = hero(80, 4000, Role::Dps, Element::Solid); // big HP so the fight lasts many rounds
            c.speed = spd;
            c.is_enemy = enemy;
            c
        };
        let party = vec![mk(150, false), mk(90, false)];
        let enemies = vec![mk(100, true), mk(100, true)];
        let r = resolve_battle(1, party, enemies, -1, &[]);
        let first_ult = |actor: usize| r.log.iter().filter(|e| e.actor == actor && e.action == "ult").map(|e| e.round).min();
        let fast = first_ult(0);
        let slow = first_ult(1);
        assert!(fast.is_some(), "the fast hero reaches its ult within the fight");
        if let (Some(f), Some(s)) = (fast, slow) {
            assert!(f < s, "the faster hero (speed 150) ults strictly sooner than the slower one (90): {f} vs {s}");
        }
    }

    #[test]
    fn atb_fast_unit_takes_more_turns() {
        // The core ATB guarantee: a faster unit acts MORE OFTEN. Low atk + huge HP ⇒ a long, survivable fight so the
        // turn counts diverge cleanly. Each action carries a unique turn id (the log's first column), so counting
        // distinct turn ids per actor == that actor's number of turns.
        let mk = |spd: i64, enemy: bool| {
            let mut c = hero(40, 6000, Role::Dps, Element::Solid);
            c.speed = spd;
            c.is_enemy = enemy;
            c
        };
        let party = vec![mk(160, false), mk(80, false)];
        let enemies = vec![mk(100, true), mk(100, true)];
        let r = resolve_battle(3, party, enemies, -1, &[]);
        let turns_of = |actor: usize| {
            r.log.iter().filter(|e| e.actor == actor).map(|e| e.round).collect::<std::collections::BTreeSet<u32>>().len()
        };
        let fast = turns_of(0);
        let slow = turns_of(1);
        assert!(fast > slow, "the speed-160 hero takes more turns than the speed-80 hero ({fast} vs {slow})");
        assert!(slow > 0, "the slow hero still acts");
    }

    #[test]
    fn bleed_death_revives_once_like_attack_death() {
        // Regression: a phoenix_tear (ReviveOnce) hero dying to a START-OF-TURN bleed must revive exactly like an
        // attack death — and as the LAST hero, that revive turns a silent loss into a win (the bug skipped the revive
        // sweep via `continue`, ending the fight as a loss before the charge could fire).
        let mut h = hero(60, 160, Role::Dps, Element::Solid);
        h.revive = true;
        h.bleed = 1;
        h.hp = 10; // the first bleed tick (max_hp/16 = 10) drops it to 0 on its own turn
        let mut e = hero(4, 24, Role::Dps, Element::Solid); // a weak foe the revived hero can finish
        e.is_enemy = true;
        let r = resolve_battle(1, vec![h], vec![e], -1, &[]);
        let revives = r.log.iter().filter(|ev| ev.action == "revive").count();
        assert_eq!(revives, 1, "the bleed death triggers the one-shot revive (not skipped by `continue`)");
        assert!(r.win, "the revived last hero wins instead of silently losing the fight");
    }

    #[test]
    fn reflect_quirk_bounces_damage_at_melee_attackers() {
        // The non-orientable Reflect quirk: when a melee BASIC attack lands on a reflecting hero, it bounces dealt/5
        // back at the attacker (a "reflect"-status event). This is a shipped invariant→mechanic link (non-orientable
        // shapes are priced on it), so pin it: a Reflect hero produces bounces; a plain hero never does.
        let mk = |reflect: bool| {
            let mut h = hero(60, 3000, Role::Tank, Element::Solid);
            h.reflect = reflect;
            h
        };
        let enemy = || {
            let mut e = hero(150, 3000, Role::Dps, Element::Solid);
            e.is_enemy = true;
            e
        };
        let r = resolve_battle(5, vec![mk(true)], vec![enemy()], -1, &[]);
        let bounces: Vec<&LogEvent> = r.log.iter().filter(|ev| ev.status == "reflect").collect();
        assert!(!bounces.is_empty(), "a Reflect hero bounces a sliver back at melee attackers");
        for b in &bounces {
            assert_eq!(b.actor, 0, "the reflecting hero is the actor of the bounce");
            assert_eq!(b.target, 1, "the bounce hits the attacker");
            assert!(b.dmg >= 1, "the bounce deals at least 1");
        }
        // control: an identical NON-reflect hero never produces a bounce — proving it's the quirk, not a baseline.
        let r2 = resolve_battle(5, vec![mk(false)], vec![enemy()], -1, &[]);
        assert!(r2.log.iter().all(|ev| ev.status != "reflect"), "no Reflect quirk ⇒ no bounces");
    }

    #[test]
    fn resolve_battle_respects_threaded_hp() {
        // The HP-threading contract that carries survivor HP room→room in a delve: resolve_battle_from_hp starts from
        // the GIVEN hp (not max_hp), so a party entering a room already wounded ends strictly worse — less HP, or a loss.
        let full = vec![hero(70, 1200, Role::Dps, Element::Solid)];
        let wounded = {
            let mut p = full.clone();
            p[0].hp = 60; // enters the room nearly dead
            p
        };
        let rf = resolve_battle_from_hp(3, full, quest_enemies(&QUESTS[0]), -1, &[]);
        let rw = resolve_battle_from_hp(3, wounded, quest_enemies(&QUESTS[0]), -1, &[]);
        let sf: i64 = rf.final_hp.iter().sum();
        let sw: i64 = rw.final_hp.iter().sum();
        assert!(!rw.win || sw < sf, "a wounded entry threads through to a strictly worse outcome (less HP or a loss)");
    }

    #[test]
    fn default_gambits_equal_legacy_ladder() {
        // KEYSTONE: an empty program (whole OR per-slot) is byte-identical to the legacy ladder, seeds × quests.
        let mk = || vec![hero(120, 1000, Role::Dps, Element::Solid), hero(80, 1400, Role::Tank, Element::Woven), hero(70, 900, Role::Support, Element::Twisted)];
        for qi in [0usize, 2, 3, 7, 10] {
            for seed in 0..30u64 {
                let s = seed + qi as u64 * 100;
                let base = resolve_battle(s, mk(), quest_enemies(&QUESTS[qi]), -1, &[]);
                let empty_slots = resolve_battle(s, mk(), quest_enemies(&QUESTS[qi]), -1, &[vec![], vec![], vec![]]);
                assert_eq!(base.win, empty_slots.win);
                assert_eq!(base.log.len(), empty_slots.log.len());
                for (x, y) in base.log.iter().zip(empty_slots.log.iter()) {
                    assert_eq!(log_key(x), log_key(y));
                }
            }
        }
    }

    #[test]
    fn template_gambits_equal_legacy() {
        // each role's default editor template reproduces the ladder byte-for-byte (so "Reset to defaults" == today).
        let party = || vec![hero(120, 1000, Role::Dps, Element::Solid), hero(80, 1400, Role::Tank, Element::Woven), hero(70, 900, Role::Support, Element::Twisted), hero(140, 700, Role::Control, Element::Twisted)];
        for qi in [0usize, 3, 7, 10] {
            for seed in 0..30u64 {
                let s = seed + qi as u64 * 17;
                let progs: Vec<Vec<GambitRule>> = party().iter().map(|c| template_for(c.role)).collect();
                let legacy = resolve_battle(s, party(), quest_enemies(&QUESTS[qi]), -1, &[]);
                let templated = resolve_battle(s, party(), quest_enemies(&QUESTS[qi]), -1, &progs);
                assert_eq!(legacy.log.len(), templated.log.len(), "template==legacy (qi={qi} seed={seed})");
                for (x, y) in legacy.log.iter().zip(templated.log.iter()) {
                    assert_eq!(log_key(x), log_key(y), "template==legacy (qi={qi} seed={seed})");
                }
            }
        }
    }

    #[test]
    fn smart_gambit_program_grows_with_unlocks_and_stays_valid() {
        // The "smarter auto gambit" feature: more unlocked options ⇒ a richer program, and EVERY rule uses only
        // unlocked primitives (so none is ever sanitized off), always ending with a valid ALWAYS rule.
        let base_c = vec![COND_ALWAYS, COND_ALLY_HURT, COND_SELF_HURT];
        let base_a = vec![ACT_ATTACK_FOCUS, ACT_HEAL, ACT_GUARD, ACT_HEX, ACT_FLURRY, ACT_ULT];
        let full_c = vec![COND_ALWAYS, COND_ALLY_HURT, COND_SELF_HURT, COND_SKILL_READY, COND_ALLY_LOW, COND_ULT_READY];
        let mut full_a = base_a.clone();
        full_a.extend([ACT_ATTACK_WEAKEST, ACT_ATTACK_THREAT, ACT_BUFF_TEAM, ACT_SWEEP]);
        for role in [Role::Tank, Role::Dps, Role::Support, Role::Control] {
            let base = smart_gambit_program(role, &base_c, &base_a);
            let full = smart_gambit_program(role, &full_c, &full_a);
            assert!(!base.is_empty() && base.last().unwrap().cond == COND_ALWAYS, "never empty; ends with ALWAYS");
            assert!(full.len() >= base.len(), "more unlocks ⇒ a richer (≥) program for {role:?}");
            for r in &base {
                assert!(base_c.contains(&r.cond) && base_a.contains(&r.action), "base program uses only base primitives");
            }
            for r in &full {
                assert!(full_c.contains(&r.cond) && full_a.contains(&r.action), "full program uses only unlocked primitives");
            }
            assert!(full.iter().any(|r| r.cond == COND_ULT_READY && r.action == ACT_ULT), "T3 unlock adds ult-timing");
            assert!(full.last().unwrap().action == ACT_ATTACK_WEAKEST, "T2 unlock upgrades the finisher to kill-securing");
        }
    }

    #[test]
    fn custom_gambits_are_deterministic_and_override_the_ladder() {
        // A custom program is deterministic AND diverges from the ladder. Here the Dps is told to only basic-attack
        // (never Flurry) — proving the selector overrode the ladder, and the selector itself drew no extra RNG
        // (same seed ⇒ identical log twice).
        let party = || vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        let progs = vec![vec![gr(COND_ALWAYS, ACT_ATTACK_THREAT)], vec![gr(COND_ALWAYS, ACT_ATTACK_FOCUS)]];
        let a = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &progs);
        let b = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &progs);
        assert_eq!(a.log.len(), b.log.len());
        for (x, y) in a.log.iter().zip(b.log.iter()) {
            assert_eq!(log_key(x), log_key(y));
        }
        assert!(!a.log.iter().any(|e| e.actor == 0 && e.action == "skillB"), "custom 'always attack' suppresses Flurry");
        let legacy = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &[]);
        assert!(legacy.log.iter().any(|e| e.actor == 0 && e.action == "skillB"), "the legacy ladder DOES Flurry — so the program changed behaviour");
    }

    #[test]
    fn gambit_rule_idx_tags_fired_rules_only() {
        // RENDER-ONLY rule_idx (M1 watch feedback): the legacy ladder leaves every event at -1; a program tags the
        // events ITS fired rule produced with that rule's 0-based index. Members without a program + enemies stay -1.
        let party = || vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        let legacy = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &[]);
        assert!(legacy.log.iter().all(|e| e.rule_idx == -1), "the legacy ladder tags nothing");
        let progs = vec![vec![gr(COND_ALWAYS, ACT_ATTACK_THREAT)], vec![]]; // Dps: rule 0 = always attack; Support: none
        let r = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &progs);
        assert!(r.log.iter().any(|e| e.actor == 0 && e.rule_idx == 0), "the Dps's fired rule 0 is tagged");
        assert!(r.log.iter().filter(|e| e.actor == 1).all(|e| e.rule_idx == -1), "the program-less Support stays untagged");
        assert!(r.log.iter().filter(|e| e.actor >= 2).all(|e| e.rule_idx == -1), "enemies are never gambit-tagged");
    }

    #[test]
    fn simple_program_is_deterministic_and_drops_the_second_skill() {
        // The LOCKED default (simple_program): deterministic + deliberately dumber than legacy_ladder. A Support
        // uses its PRIMARY skill (heal=skillA) but never the SECOND (buff=skillB) the smart ladder would add.
        let party = || vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        let progs = vec![simple_program(Role::Dps), simple_program(Role::Support)];
        let a = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &progs);
        let b = resolve_battle(42, party(), quest_enemies(&QUESTS[3]), -1, &progs);
        assert_eq!(a.log.len(), b.log.len());
        for (x, y) in a.log.iter().zip(b.log.iter()) {
            assert_eq!(log_key(x), log_key(y));
        }
        assert!(a.log.iter().any(|e| e.actor == 1 && e.action == "skillA"), "Support uses its primary (heal)");
        assert!(!a.log.iter().any(|e| e.actor == 1 && e.action == "skillB"), "simple_program never fires the second skill (buff)");
    }

    #[test]
    fn out_of_role_gambit_is_skipped_not_panicked() {
        // A Dps with an (illegal) heal rule falls through to its attack — never casts a skill, never panics.
        let party = vec![hero(120, 1000, Role::Dps, Element::Solid)];
        let progs = vec![vec![gr(COND_ALWAYS, ACT_HEAL), gr(COND_ALWAYS, ACT_ATTACK_FOCUS)]];
        let r = resolve_battle(5, party, quest_enemies(&QUESTS[0]), -1, &progs);
        assert!(!r.log.iter().any(|e| e.actor == 0 && matches!(e.action, "skillA" | "skillB" | "ult")), "out-of-role heal skipped → Dps only basic-attacks");
    }

    #[test]
    fn short_gambits_vec_falls_to_ladder() {
        // a 1-element program vec for a 2-hero party: slot 1 has no entry ⇒ .get(1)=None ⇒ legacy ladder, no panic.
        let party = vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        let progs = vec![vec![gr(COND_ALWAYS, ACT_ATTACK_FOCUS)]];
        let r = resolve_battle(9, party, quest_enemies(&QUESTS[2]), -1, &progs);
        assert!(r.rounds > 0);
    }

    #[test]
    fn final_hp_threads_for_runs_but_wrapper_clears_it() {
        // v6 P0 engine change: `resolve_battle` (the wrapper) CLEARS final_hp so the serialized BattleResult shape
        // is byte-identical to pre-v6 (the watch/clear never need it); `resolve_battle_from_hp` (the run core)
        // projects live party HP so a run can thread survivor HP from one room into the next.
        let party = || vec![hero(120, 1000, Role::Dps, Element::Solid), hero(70, 900, Role::Support, Element::Twisted)];
        assert!(resolve_battle(3, party(), quest_enemies(&QUESTS[0]), -1, &[]).final_hp.is_empty(), "wrapper clears final_hp");
        let r = resolve_battle_from_hp(3, party(), quest_enemies(&QUESTS[0]), -1, &[]);
        assert_eq!(r.final_hp.len(), 2, "final_hp covers the party slice 0..p");
        assert!(r.final_hp.iter().enumerate().all(|(i, &h)| h >= 0 && h <= r.units[i].max_hp), "final_hp is sane (0..=max_hp)");
        // threading: a party that DEPARTS at 1 HP can't outlast a full one (proves start HP flows in, not reset to max)
        let mut hurt = party();
        for c in hurt.iter_mut() {
            c.hp = 1;
        }
        let rh = resolve_battle_from_hp(3, hurt, quest_enemies(&QUESTS[0]), -1, &[]);
        assert!(rh.party_survivors <= r.party_survivors, "a near-dead party can't outlast a full-HP one");
    }

    #[test]
    fn bleed_mechanic_fires_and_is_logged() {
        // A Hexer (hex → bleed) or a Control hero (stun → bleed) leaves a "bleed" event in some battle.
        let party = vec![hero(140, 500, Role::Control, Element::Twisted), hero(90, 800, Role::Tank, Element::Solid)];
        let mut saw_bleed = false;
        for seed in 0..60u64 {
            let r = resolve_battle(seed, party.clone(), quest_enemies(&QUESTS[2]), -1, &[]); // Snarl(Hexer) + Wisp
            if r.log.iter().any(|e| e.action == "bleed") {
                saw_bleed = true;
                break;
            }
        }
        assert!(saw_bleed, "bleed (start-of-turn true damage) should appear in some battle");
    }

    #[test]
    fn tank_bulwark_sweep_fires_in_a_long_fight() {
        // Over a long boss fight, the tank cycles past its guard cooldown and lands a Bulwark Sweep (skillB).
        let mut saw = false;
        for seed in 0..40u64 {
            let party = vec![hero(70, 2000, Role::Tank, Element::Solid), hero(120, 800, Role::Dps, Element::Solid)];
            let r = resolve_battle(seed, party, quest_enemies(&QUESTS[3]), -1, &[]);
            if r.log.iter().any(|e| e.actor == 0 && e.action == "skillB") {
                saw = true;
                break;
            }
        }
        assert!(saw, "the tank's Bulwark Sweep (skillB) should fire in some long fight");
    }

    #[test]
    fn ui_hp_replay_never_shows_a_unit_acting_while_dead() {
        // Replays each quest's log EXACTLY like the web hp-memo (subtract the full logged dmg, add heal — NO
        // shield model) and asserts no unit ever ACTS while its reconstructed HP is ≤ 0. This pins the
        // "deal() logs the real post-shield HP delta" invariant so the spectator Watch can't show a shielded
        // unit dead-but-still-acting. A 4-role party maximises shield usage (Tank self/team shields, Support
        // ally ward) — the exact widened blast-radius the reviewer flagged.
        let mk = || {
            vec![
                hero(150, 700, Role::Dps, Element::Solid),
                hero(70, 1500, Role::Tank, Element::Solid),
                hero(110, 700, Role::Support, Element::Solid),
                hero(130, 650, Role::Control, Element::Twisted),
            ]
        };
        for (qi, q) in QUESTS.iter().enumerate() {
            for seed in 0..8u64 {
                let r = resolve_battle(seed + qi as u64 * 100, mk(), quest_enemies(q), -1, &[]);
                let mut h: Vec<i64> = r.units.iter().map(|u| u.max_hp).collect();
                for e in &r.log {
                    assert!(h[e.actor] > 0, "quest {qi} seed {seed}: unit {} acts ({}) while UI-replayed HP is {} (≤0) — log/engine HP desync", e.actor, e.action, h[e.actor]);
                    if e.target >= 0 {
                        let t = e.target as usize;
                        if e.dmg > 0 {
                            h[t] = (h[t] - e.dmg).max(0);
                        }
                        if e.heal > 0 {
                            h[t] = (h[t] + e.heal).min(r.units[t].max_hp);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn every_fainted_event_marks_a_unit_at_zero_hp() {
        // Pins the dissolve-VFX contract: whenever a LogEvent's `fainted` points at a unit, that unit is at 0 HP
        // in the pure log replay (so the renderer can dissolve on `fainted` and never mis-fire on a shielded/
        // revived unit). Complements ui_hp_replay_never_shows_a_unit_acting_while_dead.
        let mk = || vec![hero(150, 700, Role::Dps, Element::Solid), hero(70, 1400, Role::Tank, Element::Solid)];
        for (qi, q) in QUESTS.iter().enumerate() {
            for seed in 0..6u64 {
                let r = resolve_battle(seed + qi as u64 * 50, mk(), quest_enemies(q), -1, &[]);
                let mut h: Vec<i64> = r.units.iter().map(|u| u.max_hp).collect();
                for e in &r.log {
                    if e.target >= 0 {
                        let t = e.target as usize;
                        if e.dmg > 0 {
                            h[t] = (h[t] - e.dmg).max(0);
                        }
                        if e.heal > 0 {
                            h[t] = (h[t] + e.heal).min(r.units[t].max_hp);
                        }
                    }
                    if e.fainted >= 0 {
                        assert_eq!(h[e.fainted as usize], 0, "fainted unit must read 0 HP in replay (qi {qi} seed {seed})");
                    }
                }
            }
        }
    }

    #[test]
    fn revive_pops_back_once_and_is_logged_deterministically() {
        // a fragile hero with a ReviveOnce charge vs a boss: it's downed, pops back at 30% (logged), then can be
        // downed again and stays down. Deterministic (no extra RNG — the revive is a pure post-action sweep).
        let mut h = hero(60, 120, Role::Dps, Element::Solid);
        h.revive = true;
        let party = vec![h];
        let enemies = quest_enemies(&QUESTS[7]); // folds_boss
        let a = resolve_battle(123, party.clone(), enemies.clone(), -1, &[]);
        let b = resolve_battle(123, party, enemies, -1, &[]);
        assert_eq!(a.log.len(), b.log.len(), "revive keeps the battle deterministic");
        let revives = a.log.iter().filter(|e| e.action == "revive").count();
        assert_eq!(revives, 1, "ReviveOnce fires exactly once");
        // the revive event heals from 0 → 30% (so the TS replay tracks HP)
        let rev = a.log.iter().find(|e| e.action == "revive").unwrap();
        assert!(rev.heal > 0 && rev.target >= 0);
    }

    #[test]
    fn power_matched_party_clears_early_quests_under_round_cap() {
        // an intended-band trio clears each Chapter-1 quest well under MAX_ROUNDS (guards the endless curve so no
        // quest goes silently unbeatable).
        let mk = || {
            vec![
                hero(180, 650, Role::Dps, Element::Solid),
                hero(80, 1100, Role::Tank, Element::Solid),
                hero(120, 650, Role::Support, Element::Solid),
            ]
        };
        for (qi, q) in QUESTS.iter().take(4).enumerate() {
            let r = resolve_battle(7 + qi as u64, mk(), quest_enemies(q), -1, &[]);
            assert!(r.win, "quest {qi} should be winnable by a power-matched party");
            assert!(r.rounds < MAX_ROUNDS, "quest {qi} finished in {} rounds (cap {MAX_ROUNDS})", r.rounds);
        }
    }
}
