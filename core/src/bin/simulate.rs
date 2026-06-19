//! Headless economy simulator — answers "does a run still complete the 41-shape core in ~1–2 days?"
//! after all the multipliers (bonds, synergy, genus, milestones, Facets, prestige) stacked up.
//! Run: `cargo run --release --bin simulate`.

use shipshape_core::content;
use shipshape_core::game::GameState;

const MIN_MS: f64 = 60_000.0;

/// Greedy/optimal player: idle in 1-minute steps, auto-arrange the floor, pull whenever affordable, forge
/// every discoverable recipe. Returns hours to complete the core.
fn greedy(seed: u64) -> (f64, u64, f64) {
    let mut g = GameState::new(seed, 0.0);
    let mut now = 0.0;
    let mut minutes: u64 = 0;
    let cap = 60 * 24 * 10; // 10-day safety cap
    while !g.core_complete() && minutes < cap {
        now += MIN_MS;
        g.tick(now);
        g.auto_arrange();
        let mut guard = 0;
        while g.flux >= 100.0 && guard < 200 {
            if !g.pull(now).ok {
                break;
            }
            guard += 1;
        }
        for r in content::RECIPES.iter() {
            g.forge(r.a, r.b); // no-op unless owned + affordable
        }
        minutes += 1;
    }
    (minutes as f64 / 60.0, g.pity.counter, g.rate_per_hr())
}

/// Casual idler: only "checks in" every `every_h` hours (offline catch-up), then pulls/deploys/forges.
fn casual(seed: u64, every_h: f64) -> f64 {
    let mut g = GameState::new(seed, 0.0);
    let mut now = 0.0;
    let mut checks: u64 = 0;
    let cap = (24.0 / every_h * 14.0) as u64; // ~14-day safety cap
    while !g.core_complete() && checks < cap {
        now += every_h * 60.0 * MIN_MS;
        g.compute_offline(now);
        g.auto_arrange();
        let mut guard = 0;
        while g.flux >= 100.0 && guard < 500 {
            if !g.pull(now).ok {
                break;
            }
            guard += 1;
        }
        for r in content::RECIPES.iter() {
            g.forge(r.a, r.b);
        }
        checks += 1;
    }
    checks as f64 * every_h
}

fn main() {
    println!(
        "Shape Gacha — economy simulation (target: complete the 41-shape core in ~1–2 days)\n"
    );
    let mut gh = vec![];
    for seed in [1u64, 7, 42, 99, 2024] {
        let (h, pulls, rate) = greedy(seed);
        println!(
            "  greedy  seed {seed:>4}: {h:5.1}h ({:.2}d), {pulls} pulls, end rate {rate:.0}/hr",
            h / 24.0
        );
        gh.push(h);
    }
    let avg = gh.iter().sum::<f64>() / gh.len() as f64;
    println!("  greedy AVERAGE: {:.1}h ({:.2} days)\n", avg, avg / 24.0);

    for every in [8.0, 12.0, 24.0] {
        let h = casual(42, every);
        println!(
            "  casual (checks every {every:>4.0}h): {h:5.1}h ({:.2} days)",
            h / 24.0
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Balance guardrail: optimal play must still finish the core in a sane band. If a future multiplier
    /// change makes this trivially fast or grindingly slow, CI catches it here.
    #[test]
    fn economy_completes_in_target_window() {
        for seed in [1u64, 42, 2024] {
            let (h, _, _) = greedy(seed);
            assert!(
                (8.0..48.0).contains(&h),
                "seed {seed}: greedy core completion {h:.1}h is outside the sane 8–48h band — economy may be broken"
            );
        }
    }

    /// A casual idler (checks ~twice a day) should land in the intended ~1–3 day window.
    #[test]
    fn casual_idler_in_one_to_three_days() {
        let h = casual(42, 12.0);
        assert!(
            (24.0..=72.0).contains(&h),
            "casual 12h-check completion {h:.1}h outside 1–3 days"
        );
    }
}
