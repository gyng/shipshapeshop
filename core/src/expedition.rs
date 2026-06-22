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
/// A battle is abandoned (timeout, no penalty) past this many rounds — keeps every fight bounded & O(1)-ish.
pub const MAX_ROUNDS: u32 = 30;
/// Ultimate charge needed to fire (gained per action + when struck).
const ULT_CHARGE: i64 = 100;

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
    pub atk_up: i64,   // turns remaining
    pub def_down: i64, // turns remaining
    pub regen: i64,    // turns remaining
    pub stun: i64,     // turns remaining
    pub shield: i64,   // absorb pool
    pub cd_a: i64,
    pub cd_b: i64,
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
];

pub struct QuestDef {
    pub key: &'static str,
    pub nick: &'static str,
    pub chapter: u32,
    pub min_dim: u32, // viewport_dim gate (3 = available at launch)
    pub tier: u32,    // difficulty tier — scales wash stats & the echo-farm base
    pub enemies: &'static [usize],
    pub boss: Option<usize>,
    pub recruit_id: i32, // shape id the boss frees on first clear (-1 = none)
    pub base_echo: u64,  // base Echoes/hr at a power-matched party
}

/// The quest board. Chapters group quests; deeper chapters gate on the viewport dimension (NG+).
pub const QUESTS: &[QuestDef] = &[
    // ── Chapter 1 — the Shallows (launch, 3D) ──
    QuestDef { key: "shallows_1", nick: "Tidepool Steps", chapter: 1, min_dim: 3, tier: 1, enemies: &[0, 0], boss: None, recruit_id: -1, base_echo: 60 },
    QuestDef { key: "shallows_2", nick: "Driftwood Hollow", chapter: 1, min_dim: 3, tier: 1, enemies: &[0, 1], boss: None, recruit_id: -1, base_echo: 75 },
    QuestDef { key: "shallows_3", nick: "The Murmuring Shelf", chapter: 1, min_dim: 3, tier: 2, enemies: &[1, 2], boss: None, recruit_id: -1, base_echo: 95 },
    QuestDef { key: "shallows_boss", nick: "The Lost Ring", chapter: 1, min_dim: 3, tier: 2, enemies: &[0], boss: Some(5), recruit_id: 10, base_echo: 130 },
    // ── Chapter 2 — the Folds (3D) ──
    QuestDef { key: "folds_1", nick: "Sunken Gallery", chapter: 2, min_dim: 3, tier: 3, enemies: &[3, 2], boss: None, recruit_id: -1, base_echo: 150 },
    QuestDef { key: "folds_2", nick: "The Inverted Hall", chapter: 2, min_dim: 3, tier: 3, enemies: &[4, 2], boss: None, recruit_id: -1, base_echo: 175 },
    QuestDef { key: "folds_3", nick: "Mirrorwalk", chapter: 2, min_dim: 3, tier: 4, enemies: &[4, 1, 2], boss: None, recruit_id: -1, base_echo: 210 },
    QuestDef { key: "folds_boss", nick: "The Dimmed Bottle", chapter: 2, min_dim: 3, tier: 4, enemies: &[4], boss: Some(6), recruit_id: 18, base_echo: 280 },
    // ── Chapter 3 — the Deep (3D, the toughest pre-ascension) ──
    QuestDef { key: "deep_1", nick: "The Long Dark", chapter: 3, min_dim: 3, tier: 5, enemies: &[3, 3, 1], boss: None, recruit_id: -1, base_echo: 320 },
    QuestDef { key: "deep_2", nick: "Where the Floor Warps", chapter: 3, min_dim: 3, tier: 6, enemies: &[4, 2, 1], boss: None, recruit_id: -1, base_echo: 390 },
    QuestDef { key: "deep_boss", nick: "The Seven-Fold", chapter: 3, min_dim: 3, tier: 6, enemies: &[3], boss: Some(7), recruit_id: 26, base_echo: 520 },
    // ── Chapter 4 — the Higher Vantage (NG+ / viewport ≥ 4) ──
    QuestDef { key: "vantage_1", nick: "Above the Equator", chapter: 4, min_dim: 4, tier: 8, enemies: &[3, 4, 2], boss: None, recruit_id: -1, base_echo: 760 },
    QuestDef { key: "vantage_boss", nick: "The Folded Cube", chapter: 4, min_dim: 4, tier: 9, enemies: &[4], boss: Some(8), recruit_id: 44, base_echo: 1100 },
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
];
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
        atk_up: 0,
        def_down: 0,
        regen: 0,
        stun: 0,
        shield: 0,
        cd_a: 0,
        cd_b: 0,
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
}

/// A combatant's display info (snapshotted at battle start) so the TS layer can render cards + HP bars and
/// animate the log without recomputing anything.
#[derive(Serialize, Clone, Debug)]
pub struct UnitInfo {
    pub shape_id: i32,
    pub nick: String,
    pub family: String,
    pub is_enemy: bool,
    pub max_hp: i64,
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
    let mut d = (atk - def / 2).max(1);
    d = d * skill_power / 100;
    if advantage {
        d = d * 5 / 4;
    }
    if atk_up {
        d = d * 13 / 10;
    }
    if def_down {
        d = d * 13 / 10;
    }
    d = d * rng.jitter(8) / 100;
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
fn highest_atk(units: &[Combatant], enemy_side: bool) -> Option<usize> {
    units
        .iter()
        .enumerate()
        .filter(|(_, c)| c.is_enemy == enemy_side && c.alive())
        .max_by_key(|(_, c)| c.atk)
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

/// Apply damage (through any shield), return (dealt, fainted?).
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
    (dmg, fainted)
}

/// Resolve a full battle deterministically. `seed` already folds in (master_seed, quest, party) upstream.
/// The same inputs always yield the same `BattleResult`, so watch == full-auto == a golden test.
pub fn resolve_battle(seed: u64, mut party: Vec<Combatant>, mut enemies: Vec<Combatant>) -> BattleResult {
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
            element: c.element.as_str(),
            role: c.role.as_str(),
        })
        .collect();
    let mut rng = Rng { seed, ctr: 0 };
    let mut log: Vec<LogEvent> = Vec::new();
    let mut round = 0u32;

    while round < MAX_ROUNDS && any_living(&units, false) && any_living(&units, true) {
        round += 1;
        // speed order (desc), stable by index
        let mut order: Vec<usize> = (0..units.len()).collect();
        order.sort_by(|&a, &b| units[b].speed.cmp(&units[a].speed).then(a.cmp(&b)));

        for actor in order {
            if !units[actor].alive() {
                continue;
            }
            if !any_living(&units, false) || !any_living(&units, true) {
                break;
            }
            // tick down status timers that gate acting
            if units[actor].stun > 0 {
                units[actor].stun -= 1;
                log.push(LogEvent { round, actor, action: "stunned", target: -1, dmg: 0, heal: 0, status: "", fainted: -1 });
                continue;
            }
            // start-of-turn regen
            if units[actor].regen > 0 {
                let h = (units[actor].max_hp / 12).max(1);
                let healed = (units[actor].max_hp - units[actor].hp).min(h);
                units[actor].hp += healed;
                units[actor].regen -= 1;
                if healed > 0 {
                    log.push(LogEvent { round, actor, action: "regen", target: actor as i32, dmg: 0, heal: healed, status: "", fainted: -1 });
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
                enemy_turn(&mut units, actor, round, &mut rng, &mut log);
            } else {
                hero_turn(&mut units, actor, round, &mut rng, &mut log);
            }
            // gain charge for taking a turn
            units[actor].charge = (units[actor].charge + 18).min(ULT_CHARGE);
        }
    }

    let win = !any_living(&units, true);
    let survivors = units.iter().filter(|c| !c.is_enemy && c.alive()).count();
    BattleResult { win, rounds: round, party_size: p, party_survivors: survivors, units: unit_info, log }
}

/// Resolve a hero's action via a fixed priority ladder (the AUTO / FULL-AUTO policy).
fn hero_turn(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>) {
    let role = units[actor].role;
    // 1) Ultimate when charged
    if units[actor].charge >= ULT_CHARGE {
        units[actor].charge = 0;
        ultimate(units, actor, role, round, rng, log);
        return;
    }
    // 2) Role skill when off cooldown
    match role {
        Role::Support => {
            // heal the most-wounded ally if anyone is hurting, else buff
            if let Some(t) = most_wounded_ally(units, actor) {
                if units[t].hp * 5 < units[t].max_hp * 4 && units[actor].cd_a == 0 {
                    let h = (units[actor].atk * 9 / 5).max(1);
                    let healed = (units[t].max_hp - units[t].hp).min(h);
                    units[t].hp += healed;
                    units[t].regen = units[t].regen.max(2);
                    units[actor].cd_a = 2;
                    log.push(LogEvent { round, actor, action: "skillA", target: t as i32, dmg: 0, heal: healed, status: "regen", fainted: -1 });
                    return;
                }
            }
            if units[actor].cd_b == 0 {
                // team ATK-up
                for c in units.iter_mut().filter(|c| !c.is_enemy && c.alive()) {
                    c.atk_up = c.atk_up.max(3);
                }
                units[actor].cd_b = 3;
                log.push(LogEvent { round, actor, action: "skillB", target: -1, dmg: 0, heal: 0, status: "atk_up", fainted: -1 });
                return;
            }
        }
        Role::Tank => {
            if units[actor].cd_a == 0 {
                // Taunt: self DEF-up (read as taunt by enemy AI) + a shield
                units[actor].atk_up = units[actor].atk_up.max(3); // reuse atk_up flag as the "taunt/guard" marker
                units[actor].shield += units[actor].max_hp / 5;
                units[actor].cd_a = 3;
                log.push(LogEvent { round, actor, action: "skillA", target: actor as i32, dmg: 0, heal: 0, status: "guard", fainted: -1 });
                return;
            }
        }
        Role::Control => {
            if units[actor].cd_a == 0 {
                if let Some(t) = lowest_hp(units, true) {
                    let adv = units[actor].element.beats(units[t].element);
                    let dmg = compute_damage(rng, units[actor].atk, units[t].def, 110, adv, units[actor].atk_up > 0, units[t].def_down > 0);
                    let (dealt, fainted) = deal(&mut units[t], dmg);
                    units[t].def_down = units[t].def_down.max(3);
                    let stunned = rng.chance(45, 100);
                    if stunned {
                        units[t].stun = units[t].stun.max(1);
                    }
                    units[actor].cd_a = 3;
                    log.push(LogEvent { round, actor, action: "skillA", target: t as i32, dmg: dealt, heal: 0, status: if stunned { "stun" } else { "def_down" }, fainted: if fainted { t as i32 } else { -1 } });
                    return;
                }
            }
        }
        Role::Dps => {
            if units[actor].cd_b == 0 {
                // Flurry: a few smaller hits spread across living enemies (one log event per hit ⇒ exact replay)
                let hits = 3;
                for _ in 0..hits {
                    if let Some(t) = lowest_hp(units, true) {
                        let adv = units[actor].element.beats(units[t].element);
                        let dmg = compute_damage(rng, units[actor].atk, units[t].def, 55, adv, units[actor].atk_up > 0, units[t].def_down > 0);
                        let (dealt, fainted) = deal(&mut units[t], dmg);
                        log.push(LogEvent { round, actor, action: "skillB", target: t as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { t as i32 } else { -1 } });
                    }
                }
                units[actor].cd_b = 2;
                return;
            }
        }
    }
    // 3) Basic attack
    if let Some(t) = lowest_hp(units, true) {
        let adv = units[actor].element.beats(units[t].element);
        let power = if role == Role::Dps { 120 } else { 90 };
        let dmg = compute_damage(rng, units[actor].atk, units[t].def, power, adv, units[actor].atk_up > 0, units[t].def_down > 0);
        let (dealt, fainted) = deal(&mut units[t], dmg);
        // Reflect quirk (non-orientable): a sliver of damage bounces back to a random attacker later — modelled
        // as the target taking a little self-thorn now is wrong; instead enemies hitting a reflector get bounced
        // (handled in enemy_turn). Basic hero attack has no reflect interaction.
        log.push(LogEvent { round, actor, action: "basic", target: t as i32, dmg: dealt, heal: 0, status: if adv { "adv" } else { "" }, fainted: if fainted { t as i32 } else { -1 } });
    }
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
                    log.push(LogEvent { round, actor, action: "ult", target: i as i32, dmg: 0, heal: healed, status: "cleanse", fainted: -1 });
                }
            }
        }
        Role::Tank => {
            // team shield (shields don't change HP, so one event per ally just telegraphs the bulwark)
            for (i, c) in units.iter_mut().enumerate() {
                if !c.is_enemy && c.alive() {
                    c.shield += c.max_hp / 4;
                    log.push(LogEvent { round, actor, action: "ult", target: i as i32, dmg: 0, heal: 0, status: "bulwark", fainted: -1 });
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
                log.push(LogEvent { round, actor, action: "ult", target: t as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { t as i32 } else { -1 } });
            }
        }
    }
}

fn enemy_turn(units: &mut [Combatant], actor: usize, round: u32, rng: &mut Rng, log: &mut Vec<LogEvent>) {
    let ai = units[actor].ai;
    // pick a target by AI kind, honouring a taunting party Tank
    let target = if let Some(tk) = taunter(units) {
        Some(tk)
    } else {
        match ai {
            AiKind::Skitter => highest_atk(units, false),
            _ => lowest_hp(units, false),
        }
    };
    let Some(t) = target else { return };

    // bosses periodically use a heavy special (all-party hit)
    if ai == AiKind::Boss && units[actor].charge >= ULT_CHARGE {
        units[actor].charge = 0;
        let targets: Vec<usize> = (0..units.len()).filter(|&i| !units[i].is_enemy && units[i].alive()).collect();
        for ti in targets {
            let dmg = compute_damage(rng, units[actor].atk, units[ti].def, 130, false, units[actor].atk_up > 0, units[ti].def_down > 0);
            let (dealt, fainted) = deal(&mut units[ti], dmg);
            log.push(LogEvent { round, actor, action: "ult", target: ti as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { ti as i32 } else { -1 } });
        }
        return;
    }

    match ai {
        AiKind::Warden if rng.chance(1, 3) => {
            units[actor].shield += units[actor].max_hp / 6;
            log.push(LogEvent { round, actor, action: "skillA", target: actor as i32, dmg: 0, heal: 0, status: "guard", fainted: -1 });
        }
        AiKind::Hexer if rng.chance(1, 2) => {
            let dmg = compute_damage(rng, units[actor].atk, units[t].def, 80, false, units[actor].atk_up > 0, units[t].def_down > 0);
            let (dealt, fainted) = deal(&mut units[t], dmg);
            units[t].def_down = units[t].def_down.max(2);
            log.push(LogEvent { round, actor, action: "skillA", target: t as i32, dmg: dealt, heal: 0, status: "def_down", fainted: if fainted { t as i32 } else { -1 } });
        }
        _ => {
            let dmg = compute_damage(rng, units[actor].atk, units[t].def, 100, false, units[actor].atk_up > 0, units[t].def_down > 0);
            let (dealt, fainted) = deal(&mut units[t], dmg);
            log.push(LogEvent { round, actor, action: "basic", target: t as i32, dmg: dealt, heal: 0, status: "", fainted: if fainted { t as i32 } else { -1 } });
            // Reflect quirk: a non-orientable hero bounces a sliver back at a melee attacker
            if !units[t].is_enemy && units[t].reflect && units[t].alive() {
                let bounce = (dealt / 5).max(1);
                let (_, f2) = deal(&mut units[actor], bounce);
                log.push(LogEvent { round, actor: t, action: "skillB", target: actor as i32, dmg: bounce, heal: 0, status: "reflect", fainted: if f2 { actor as i32 } else { -1 } });
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
            ult_power: 200, charge: 0, atk_up: 0, def_down: 0, regen: 0, stun: 0, shield: 0, cd_a: 0, cd_b: 0,
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
    fn battle_is_deterministic() {
        let party = vec![hero(120, 400, Role::Dps, Element::Solid), hero(60, 600, Role::Tank, Element::Solid)];
        let enemies = quest_enemies(&QUESTS[0]);
        let a = resolve_battle(99, party.clone(), enemies.clone());
        let b = resolve_battle(99, party, enemies);
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
        let r = resolve_battle(1, party, quest_enemies(&QUESTS[0]));
        assert!(r.win, "a strong party should clear the tutorial quest");
        assert!(r.rounds < MAX_ROUNDS);
    }

    #[test]
    fn weak_party_loses_without_penalty_semantics() {
        // a single feeble hero against a boss quest should fail (loss is free; the caller grants nothing)
        let party = vec![hero(8, 60, Role::Dps, Element::Solid)];
        let r = resolve_battle(3, party, quest_enemies(&QUESTS[7]));
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
}
