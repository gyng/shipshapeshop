//! Ship Shape Shop — simulation core.
//!
//! Clean-architecture rule (see AGENTS.md): **Rust decides what is true; TS decides how it looks.**
//! Everything authoritative — RNG, pity, economy, offline catch-up, save — lives here. M0 ships only a
//! proof-of-pipeline `tick`; the real economy lands in M1.

use wasm_bindgen::prelude::*;

pub mod content;
pub mod expedition;
pub mod flux;
pub mod gacha;
pub mod game;
pub mod orrery;
pub mod rng;

/// Closed-form production over a span: `rate · seconds`.
///
/// This is the shape of the real idle accumulation (piecewise-constant rate ⇒ O(1) per span), so even the
/// hello-tick models the architecture: the number is computed in Rust, never in TS.
#[wasm_bindgen]
pub fn tick(elapsed_seconds: f64, rate_per_sec: f64) -> f64 {
    elapsed_seconds.max(0.0) * rate_per_sec
}

/// Identifies the core build so the web layer can prove the WASM module actually initialised.
#[wasm_bindgen]
pub fn core_version() -> String {
    format!("shipshape-core v{}", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_is_rate_times_time() {
        assert_eq!(tick(10.0, 5.0), 50.0);
    }

    #[test]
    fn tick_clamps_negative_elapsed() {
        assert_eq!(tick(-3.0, 5.0), 0.0);
    }
}
