//! Headless economy simulator — answers "does a first run complete the 44-shape pullable core in ~4h
//! (greedy) / ~1 day (casual)?" after all the multipliers (bonds, synergy, genus, milestones, Facets) stack up.
//! (2026-06 first-run retune: base_prod + RATE_CAP scaled ~12×; see content.rs / game.rs.)
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
        g.auto_arrange(); // deploy AFTER pulling, so this cycle's new shapes produce next tick (a real player re-arranges before leaving)
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
        g.auto_arrange(); // deploy AFTER pulling so this check-in's new shapes produce during the NEXT offline span
        checks += 1;
    }
    checks as f64 * every_h
}

fn main() {
    println!(
        "Shape Gacha — economy simulation (target: complete the 44-shape core in ~4h greedy / ~1 day casual)\n"
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
                (1.0..8.0).contains(&h),
                "seed {seed}: greedy core completion {h:.1}h is outside the sane 1–8h first-run band — economy may be broken"
            );
        }
    }

    /// A casual idler (checks ~twice a day, 12h) should complete the first run in about a day.
    #[test]
    fn casual_idler_completes_in_about_a_day() {
        let h = casual(42, 12.0);
        assert!(
            (12.0..=36.0).contains(&h),
            "casual 12h-check completion {h:.1}h outside the ~0.5–1.5 day first-run band"
        );
    }
}
