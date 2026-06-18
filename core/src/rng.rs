//! Deterministic, counter-based PRNG.
//!
//! Every random draw is a **pure function of `(master_seed, stream, counter)`** — no global state, no
//! wall-clock, no `rand` crate. This is what makes the gacha replayable and save-scum-proof: pull *N* is a
//! pure function of the seed and the pull index, so closing before a result and reopening replays the same
//! draw. It is also bit-identical across platforms (integer ops only), which the golden tests depend on.

/// SplitMix64 finalizer — a strong integer hash/avalanche.
#[inline]
fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

const GOLDEN: u64 = 0x9e37_79b9_7f4a_7c15;

/// A `u64` of hashed entropy from `(seed, stream, counter)`.
#[inline]
pub fn rand_u64(seed: u64, stream: u64, counter: u64) -> u64 {
    let a = mix64(seed ^ GOLDEN);
    let b = mix64(a ^ stream.wrapping_mul(GOLDEN));
    mix64(b ^ counter.wrapping_mul(GOLDEN))
}

/// A uniform `f64` in `[0, 1)` with full 53-bit mantissa.
#[inline]
pub fn rand_unit(seed: u64, stream: u64, counter: u64) -> f64 {
    (rand_u64(seed, stream, counter) >> 11) as f64 / ((1u64 << 53) as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic() {
        assert_eq!(rand_u64(1, 2, 3), rand_u64(1, 2, 3));
        assert_eq!(rand_unit(42, 7, 100), rand_unit(42, 7, 100));
    }

    #[test]
    fn distinct_inputs_distinct_outputs() {
        assert_ne!(rand_u64(1, 2, 3), rand_u64(1, 2, 4));
        assert_ne!(rand_u64(1, 2, 3), rand_u64(2, 2, 3));
        assert_ne!(rand_u64(1, 2, 3), rand_u64(1, 3, 3));
    }

    #[test]
    fn unit_in_range_and_roughly_uniform() {
        let n = 100_000u64;
        let mut sum = 0.0;
        let mut buckets = [0u32; 10];
        for c in 0..n {
            let u = rand_unit(0xABCDEF, 1, c);
            assert!((0.0..1.0).contains(&u));
            sum += u;
            buckets[(u * 10.0) as usize] += 1;
        }
        let mean = sum / n as f64;
        assert!((mean - 0.5).abs() < 0.01, "mean {mean} not ~0.5");
        // every decile within ±15% of the expected 10k
        for (i, &b) in buckets.iter().enumerate() {
            assert!((9_000..=11_000).contains(&b), "bucket {i} = {b} skewed");
        }
    }
}
