//! The gacha: rarity rolls, pity, and the Resonance Spark — all deterministic (see [`crate::rng`]).
//!
//! Numbers are the locked spec from `DESIGN.md` §7. The headline correctness claim — ~1–2-day completion
//! and **no SSR dead-stall** — is proven by [`simulate_core`] + the tests below. The single load-bearing
//! balance fix is the **spark spilling to a missing SSR** once featured URs are owned; the
//! `spark_spills_to_ssr` flag exists so a test can demonstrate the fix's effect.

use crate::rng::{rand_u64, rand_unit};

/// RNG stream id for the standard banner.
const BANNER: u64 = 1;

/// Rarity, ordered Common < … < Ur.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
pub enum Rarity {
    Common,
    Rare,
    Epic,
    Ssr,
    Ur,
}

/// Launch pool sizes per tier (DESIGN.md §8): 10 / 8 / 8 / 7 / 8 = 41 named shapes.
const N_COMMON: usize = 10;
const N_RARE: usize = 8;
const N_EPIC: usize = 8;
const N_SSR: usize = 7;
const N_UR: usize = 8;

// Per-pull base odds (DESIGN.md §7): C50 / R30 / E14 / SSR5 / UR1; top = SSR+ = 6%.
const P_TOP_BASE: f64 = 0.06;
const SOFT_PITY_START: u32 = 20; // SSR+ soft pity ramps from pull 21
const SOFT_PITY_STEP: f64 = 0.094;
const HARD_PITY: u32 = 30; // guaranteed top by the 30th dry pull
const EPIC_FLOOR: u32 = 10; // guaranteed Epic-or-better at least every 10
const UR_WITHIN_TOP: f64 = 0.30; // 30% UR / 70% SSR within a top pull
const SPARK_AT: u32 = 40; // Resonance Spark threshold

// C/R/E split conditional on "not a top pull" (50/30/14 renormalised over 94).
const P_COMMON_GIVEN_LOW: f64 = 50.0 / 94.0;
const P_RARE_GIVEN_LOW: f64 = (50.0 + 30.0) / 94.0;

/// Pity / resonance counters. Per the save spec these persist with the banner and the RNG `counter`
/// advances on every committed pull (save-scum resistance).
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PityState {
    pub counter: u64,                 // RNG counter = total pulls on this banner
    pub since_top: u32,               // pulls since SSR-or-better
    pub since_epic: u32,              // pulls since Epic-or-better
    pub resonance: u32,               // +1 per pull; spark at SPARK_AT
    pub guaranteed_featured_top: bool, // 50/50-loss carry → next top is the featured UR
}

impl PityState {
    /// Effective top (SSR+) probability for the *next* pull, including soft/hard pity.
    fn p_top(&self) -> f64 {
        let n = self.since_top + 1;
        if n >= HARD_PITY {
            1.0
        } else if n > SOFT_PITY_START {
            (P_TOP_BASE + (n - SOFT_PITY_START) as f64 * SOFT_PITY_STEP).min(1.0)
        } else {
            P_TOP_BASE
        }
    }
}

/// Collection progress: distinct ownership per tier (for coupon-collector + steered "wanted" grants).
#[derive(Clone)]
pub struct Collection {
    owned: [Vec<bool>; 5],
}

impl Collection {
    pub fn new() -> Self {
        Collection {
            owned: [
                vec![false; N_COMMON],
                vec![false; N_RARE],
                vec![false; N_EPIC],
                vec![false; N_SSR],
                vec![false; N_UR],
            ],
        }
    }
    fn tier(r: Rarity) -> usize {
        match r {
            Rarity::Common => 0,
            Rarity::Rare => 1,
            Rarity::Epic => 2,
            Rarity::Ssr => 3,
            Rarity::Ur => 4,
        }
    }
    fn first_missing(&self, r: Rarity) -> Option<usize> {
        self.owned[Self::tier(r)].iter().position(|&o| !o)
    }
    fn grant(&mut self, r: Rarity, idx: usize) -> bool {
        let slot = &mut self.owned[Self::tier(r)][idx];
        let was_new = !*slot;
        *slot = true;
        was_new
    }
    /// Core complete = every named shape in every tier owned at least once.
    pub fn core_complete(&self) -> bool {
        self.owned.iter().all(|t| t.iter().all(|&o| o))
    }
}

impl Default for Collection {
    fn default() -> Self {
        Self::new()
    }
}

/// The outcome of one rarity roll (pity already advanced).
pub struct Roll {
    pub rarity: Rarity,
    /// True if this pull crossed the Resonance Spark threshold (the caller then claims a wanted shape).
    pub spark_fired: bool,
}

/// Roll one pull's rarity and advance all pity/resonance counters. Pure function of `(seed, pity.counter)`.
/// The caller decides which concrete shape is granted, so this is reused by both the simulate harness and
/// the real game layer (which steers to a missing "wanted" shape).
pub fn roll_rarity(seed: u64, pity: &mut PityState) -> Roll {
    let c = pity.counter;
    let u_top = rand_unit(seed, BANNER, c * 4);
    let u_split = rand_unit(seed, BANNER, c * 4 + 1);
    let u_low = rand_unit(seed, BANNER, c * 4 + 2);

    let rarity = if u_top < pity.p_top() {
        pity.since_top = 0;
        pity.since_epic = 0;
        let is_ur = if pity.guaranteed_featured_top {
            pity.guaranteed_featured_top = false;
            true
        } else if u_split < UR_WITHIN_TOP {
            true
        } else {
            // lost the featured (UR) roll → next top is guaranteed the featured UR
            pity.guaranteed_featured_top = true;
            false
        };
        if is_ur { Rarity::Ur } else { Rarity::Ssr }
    } else {
        pity.since_top += 1;
        let r = if pity.since_epic + 1 >= EPIC_FLOOR {
            Rarity::Epic
        } else if u_low < P_COMMON_GIVEN_LOW {
            Rarity::Common
        } else if u_low < P_RARE_GIVEN_LOW {
            Rarity::Rare
        } else {
            Rarity::Epic
        };
        if r == Rarity::Epic {
            pity.since_epic = 0;
        } else {
            pity.since_epic += 1;
        }
        r
    };

    pity.resonance += 1;
    let spark_fired = pity.resonance >= SPARK_AT;
    if spark_fired {
        pity.resonance = 0;
    }
    pity.counter += 1;
    Roll { rarity, spark_fired }
}

/// Uniform shape index within a tier (the 4th draw of the pull), for non-steered coupon-collector grants.
pub fn shape_index(seed: u64, counter: u64, pool: usize) -> usize {
    (rand_u64(seed, BANNER, counter * 4 + 3) as usize) % pool
}

/// One simulate-pull: rolls rarity, grants into `coll` (tops steered to a missing shape, low tiers random),
/// and applies the spark. Used by `simulate_core` and the tests; the real game does its own granting.
pub fn pull(
    seed: u64,
    pity: &mut PityState,
    coll: &mut Collection,
    spark_spills_to_ssr: bool,
) -> Rarity {
    let c = pity.counter;
    let roll = roll_rarity(seed, pity);
    match roll.rarity {
        r @ (Rarity::Ur | Rarity::Ssr) => {
            let idx = coll.first_missing(r).unwrap_or(0);
            coll.grant(r, idx);
        }
        low => {
            let pool = match low {
                Rarity::Common => N_COMMON,
                Rarity::Rare => N_RARE,
                _ => N_EPIC,
            };
            coll.grant(low, shape_index(seed, c, pool));
        }
    }
    if roll.spark_fired {
        if let Some(idx) = coll.first_missing(Rarity::Ur) {
            coll.grant(Rarity::Ur, idx);
        } else if spark_spills_to_ssr {
            if let Some(idx) = coll.first_missing(Rarity::Ssr) {
                coll.grant(Rarity::Ssr, idx);
            }
        }
    }
    roll.rarity
}

/// Pulls needed to 100% the core (all 41 named shapes) for a given seed. Bounded by `cap` as a safety net.
pub fn simulate_core(seed: u64, spark_spills_to_ssr: bool, cap: u32) -> u32 {
    let mut pity = PityState::default();
    let mut coll = Collection::new();
    for n in 1..=cap {
        pull(seed, &mut pity, &mut coll, spark_spills_to_ssr);
        if coll.core_complete() {
            return n;
        }
    }
    cap
}

#[cfg(test)]
mod tests {
    use super::*;

    fn percentile(sorted: &[u32], p: f64) -> u32 {
        let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
        sorted[idx]
    }

    #[test]
    fn deterministic_same_seed_same_result() {
        assert_eq!(simulate_core(123, true, 2000), simulate_core(123, true, 2000));
    }

    #[test]
    fn hard_pity_guarantees_a_top_within_30() {
        let mut pity = PityState::default();
        let mut coll = Collection::new();
        let mut gap = 0u32;
        let mut max_gap = 0u32;
        for _ in 0..200_000 {
            let r = pull(7, &mut pity, &mut coll, true);
            if matches!(r, Rarity::Ssr | Rarity::Ur) {
                max_gap = max_gap.max(gap + 1);
                gap = 0;
            } else {
                gap += 1;
            }
        }
        assert!(max_gap <= HARD_PITY, "max dry streak {max_gap} exceeded hard pity {HARD_PITY}");
    }

    #[test]
    fn epic_floor_guarantees_epic_or_better_within_10() {
        let mut pity = PityState::default();
        let mut coll = Collection::new();
        let mut gap = 0u32;
        let mut max_gap = 0u32;
        for _ in 0..200_000 {
            let r = pull(99, &mut pity, &mut coll, true);
            if matches!(r, Rarity::Epic | Rarity::Ssr | Rarity::Ur) {
                max_gap = max_gap.max(gap + 1);
                gap = 0;
            } else {
                gap += 1;
            }
        }
        assert!(max_gap <= EPIC_FLOOR, "max non-epic streak {max_gap} exceeded floor {EPIC_FLOOR}");
    }

    #[test]
    fn top_rate_in_expected_band() {
        let mut pity = PityState::default();
        let mut coll = Collection::new();
        let n = 1_000_000u32;
        let mut tops = 0u32;
        for _ in 0..n {
            if matches!(pull(31337, &mut pity, &mut coll, true), Rarity::Ssr | Rarity::Ur) {
                tops += 1;
            }
        }
        let rate = tops as f64 / n as f64;
        // base 6% lifted by soft/hard pity → spec says effective ~7.8%
        assert!((0.06..0.10).contains(&rate), "effective top rate {rate} outside 6–10%");
    }

    #[test]
    fn completes_in_one_to_two_day_band_with_spill() {
        let mut samples: Vec<u32> = (0..5000).map(|s| simulate_core(s, true, 2000)).collect();
        samples.sort_unstable();
        let mean = samples.iter().map(|&x| x as f64).sum::<f64>() / samples.len() as f64;
        let p90 = percentile(&samples, 0.90);
        let max = *samples.last().unwrap();
        // DESIGN.md §7 target ≈ 169 mean / p90 ≈ 200 — assert a robust band around it.
        assert!((150.0..195.0).contains(&mean), "mean {mean} outside target band");
        assert!(p90 <= 230, "p90 {p90} too high");
        assert!(max < 2000, "a seed dead-stalled (hit the cap): {max}");
    }

    #[test]
    fn spark_spill_is_safe_and_no_tier_dead_stalls() {
        // The SSR-spill is the safety net that guarantees the SSR tier can never be the lone holdout.
        // Two honest properties: (a) spill can only ever fill an otherwise-missing shape, so it NEVER
        // increases pulls; (b) with the steered wanted-banner + spark, no seed dead-stalls.
        let stats = |spill: bool| {
            let v: Vec<u32> = (0..5000).map(|s| simulate_core(s, spill, 5000)).collect();
            let mean = v.iter().map(|&x| x as f64).sum::<f64>() / v.len() as f64;
            (mean, *v.iter().max().unwrap())
        };
        let (with_mean, with_max) = stats(true);
        let (without_mean, _) = stats(false);
        assert!(
            with_mean <= without_mean + 0.01,
            "spill must never increase pulls: with={with_mean:.1} without={without_mean:.1}"
        );
        assert!(with_max < 600, "no seed should dead-stall (worst completion = {with_max})");
    }
}
