//! Orrery — periodic-orbit production engine (see ORRERY_PLAN.md).
//!
//! Shapes ride fixed orbits, advancing **one cell per tick**. Co-located shapes "meet" and add a pairwise
//! flux bonus. Because every orbit period is drawn from [`ALLOWED_PERIODS`], the whole system is periodic
//! with `L = lcm(periods) ≤ L_CAP`, so production is periodic and offline catch-up is **closed-form O(1)**:
//! precompute one period's prefix sums, then any span is `full_periods·per_period + partial`.
//!
//! Pure, deterministic, integer (u64 fixed-point) — no floats, no wall-clock, no RNG in this path. This is
//! the truth layer; the TS feel layer tweens the visual orbit motion from these numbers.

/// Orbit periods are restricted to this set so `lcm` of any subset is ≤ [`L_CAP`].
pub const ALLOWED_PERIODS: [u32; 6] = [1, 2, 3, 4, 6, 12];
/// Hard ceiling on the whole-system period. The `lcm` of any subset of [`ALLOWED_PERIODS`] is ≤ 12, which
/// keeps offline O(1) and the per-period precompute trivially small.
pub const L_CAP: u32 = 12;
/// At most this many shapes form a meeting in one cell; extra co-locations are ignored (clamped). The
/// extra shapes still earn their *base* flux — only the pairwise meeting bonus is capped.
pub const MAX_PER_CELL: usize = 3;

/// A packed hex cell key (axial `(q,r)` → one integer) — see [`pack`]. Cells equal ⇒ shapes can meet there.
pub type Cell = i32;

/// A closed orbit: the (packed hex) cells visited in order, one step per tick. Direction is folded into the
/// order of `path` at construction, so the sim only ever steps forward. `path` must be non-empty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Orbit {
    pub path: Vec<Cell>,
    /// Starting offset into `path`.
    pub phase: u8,
}

impl Orbit {
    /// Period = number of cells in the loop.
    pub fn period(&self) -> u32 {
        self.path.len() as u32
    }
    /// Cell occupied at tick `t` (wraps every `period` ticks).
    pub fn cell_at(&self, t: u32) -> Cell {
        let p = self.path.len();
        self.path[(self.phase as usize + t as usize) % p]
    }
}

// ── Hex grid helpers (axial coords) ────────────────────────────────────────────
/// The six axial unit directions. Index = "axis"/rotation (0..6) a lane can point along.
pub const HEX_DIRS: [(i32, i32); 6] = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)];

/// Pack an axial `(q,r)` into a single [`Cell`] key (each coord fits comfortably in 16 bits).
pub fn pack(q: i32, r: i32) -> Cell {
    (q << 16) | (r & 0xFFFF)
}
/// Inverse of [`pack`].
pub fn unpack(c: Cell) -> (i32, i32) {
    let r = (c & 0xFFFF) as i16 as i32; // sign-extend low 16 bits
    let q = c >> 16;
    (q, r)
}
/// Axial hex distance from the origin.
pub fn hex_dist(q: i32, r: i32) -> i32 {
    (q.abs() + r.abs() + (q + r).abs()) / 2
}
/// All cells within `radius` of the origin, in a deterministic order (the anchor region).
pub fn hex_region(radius: i32) -> Vec<(i32, i32)> {
    let mut out = Vec::new();
    for q in -radius..=radius {
        for r in -radius..=radius {
            if hex_dist(q, r) <= radius {
                out.push((q, r));
            }
        }
    }
    out
}
/// A straight back-and-forth lane of `len` cells from `anchor` along `axis`: `anchor`, +1·d, …, +(len-1)·d,
/// then back. Period = `2(len-1)` for `len ≥ 2` (len 1 ⇒ a stationary single cell). Returned as packed cells.
pub fn lane_path(anchor: (i32, i32), axis: usize, len: u32) -> Vec<Cell> {
    let (dq, dr) = HEX_DIRS[axis % 6];
    let l = len.max(1) as i32;
    let mut offsets: Vec<i32> = (0..l).collect(); // out: 0,1,…,len-1
    for k in (1..l - 1).rev() {
        offsets.push(k); // back: len-2,…,1  (omit endpoints to avoid dwelling)
    }
    offsets
        .into_iter()
        .map(|k| pack(anchor.0 + dq * k, anchor.1 + dr * k))
        .collect()
}

/// One shape riding one orbit. `shape` indexes the caller's base-rate / pitch tables.
#[derive(Clone, Debug)]
pub struct Placement {
    pub shape: u16,
    pub orbit: Orbit,
}

/// The full arrangement — the only state the production math needs.
#[derive(Clone, Debug, Default)]
pub struct OrreryState {
    pub placements: Vec<Placement>,
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

fn lcm(a: u32, b: u32) -> u32 {
    if a == 0 || b == 0 {
        0
    } else {
        a / gcd(a, b) * b
    }
}

impl OrreryState {
    /// Whole-system period = `lcm` of all orbit periods (1 when empty). `≤ L_CAP` by construction.
    pub fn system_period(&self) -> u32 {
        let l = self
            .placements
            .iter()
            .fold(1u32, |acc, p| lcm(acc, p.orbit.period()));
        debug_assert!(l <= L_CAP, "system period {l} exceeds L_CAP {L_CAP}");
        l
    }

    /// Checked period: `None` if any orbit's period is not in [`ALLOWED_PERIODS`] or the `lcm` would exceed
    /// [`L_CAP`]. Content-load gate — guarantees offline stays O(1).
    pub fn checked_system_period(&self) -> Option<u32> {
        if self
            .placements
            .iter()
            .any(|p| !ALLOWED_PERIODS.contains(&p.orbit.period()))
        {
            return None;
        }
        let l = self
            .placements
            .iter()
            .fold(1u32, |acc, p| lcm(acc, p.orbit.period()));
        (l <= L_CAP).then_some(l)
    }

    /// Placement indices sharing a cell at tick `t`, as meetings (groups of `2..=MAX_PER_CELL`).
    ///
    /// **Cap rule:** a cell holding more than [`MAX_PER_CELL`] shapes keeps only the first `MAX_PER_CELL`
    /// by placement index — extra co-locations don't join the meeting (but still earn base flux elsewhere).
    /// Grouped by cell id then by placement index, so the result is fully deterministic.
    pub fn meetings_at(&self, t: u32) -> Vec<Vec<usize>> {
        use std::collections::BTreeMap;
        let mut by_cell: BTreeMap<Cell, Vec<usize>> = BTreeMap::new();
        for (i, p) in self.placements.iter().enumerate() {
            by_cell.entry(p.orbit.cell_at(t)).or_default().push(i);
        }
        by_cell
            .into_values()
            .filter(|g| g.len() >= 2)
            .map(|mut g| {
                g.truncate(MAX_PER_CELL);
                g
            })
            .collect()
    }

    /// Flux produced at tick `t`: `base[shape]` over **all** placements + `pair_bonus` over every pair
    /// within each (capped) meeting. Saturating u64 — overflow can't wrap the economy.
    pub fn prod_at<F: Fn(u16, u16) -> u64>(&self, t: u32, base: &[u64], pair_bonus: &F) -> u64 {
        let mut flux = self.placements.iter().fold(0u64, |acc, p| {
            acc.saturating_add(base.get(p.shape as usize).copied().unwrap_or(0))
        });
        for meeting in self.meetings_at(t) {
            for a in 0..meeting.len() {
                for b in (a + 1)..meeting.len() {
                    let sa = self.placements[meeting[a]].shape;
                    let sb = self.placements[meeting[b]].shape;
                    flux = flux.saturating_add(pair_bonus(sa, sb));
                }
            }
        }
        flux
    }

    /// `prefix[k] = Σ_{t=0}^{k-1} prod_at(t)` for `k in 0..=L`, where `L = system_period()`. `prefix[L]` is
    /// the per-period total. Cost `O(L · placements²)`; `L ≤ L_CAP` so this is tiny. This single vector is
    /// everything [`offline_flux`] needs.
    pub fn period_prefix<F: Fn(u16, u16) -> u64>(&self, base: &[u64], pair_bonus: &F) -> Vec<u64> {
        let l = self.system_period();
        let mut prefix = Vec::with_capacity(l as usize + 1);
        prefix.push(0u64);
        let mut acc = 0u64;
        for t in 0..l {
            acc = acc.saturating_add(self.prod_at(t, base, pair_bonus));
            prefix.push(acc);
        }
        prefix
    }
}

/// Closed-form flux over `ticks` starting at phase `t0`, given a period `prefix` from
/// [`OrreryState::period_prefix`]. **O(1) in `ticks`** — the same formula for one second or ten weeks.
///
/// Let `g(t) = prod_at(t mod L)` and `CUM(N) = Σ_{t=0}^{N-1} g(t) = (N/L)·per_period + prefix[N mod L]`.
/// The span sum is `CUM(s+ticks) − CUM(s)` with `s = t0 mod L`.
pub fn offline_flux(prefix: &[u64], t0: u32, ticks: u64) -> u64 {
    let l = (prefix.len() as u64).saturating_sub(1); // system period L
    if l == 0 || ticks == 0 {
        return 0;
    }
    let per_period = prefix[l as usize];
    let cum = |n: u64| -> u64 {
        (n / l)
            .saturating_mul(per_period)
            .saturating_add(prefix[(n % l) as usize])
    };
    let s = (t0 as u64) % l;
    cum(s.saturating_add(ticks)).saturating_sub(cum(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deterministic PRNG for *test data only* (never the economy path).
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    // The pairwise bonus used across tests — a pure fn so prefix + brute force agree exactly.
    fn pair(a: u16, b: u16) -> u64 {
        ((a as u64 + b as u64) % 7) * 10 + 1
    }

    fn random_state(seed: u64, n_shapes: u16) -> (OrreryState, Vec<u64>) {
        let mut r = Lcg(seed);
        let n = 2 + r.below(7) as usize; // 2..=8 placements
        let cells = 6u8; // small grid → meetings actually happen
        let mut placements = Vec::new();
        for _ in 0..n {
            let period = ALLOWED_PERIODS[r.below(ALLOWED_PERIODS.len() as u64) as usize];
            let path: Vec<Cell> = (0..period).map(|_| r.below(cells as u64) as Cell).collect();
            let phase = r.below(period as u64) as u8;
            let shape = r.below(n_shapes as u64) as u16;
            placements.push(Placement {
                shape,
                orbit: Orbit { path, phase },
            });
        }
        let base: Vec<u64> = (0..n_shapes).map(|_| r.below(100)).collect();
        (OrreryState { placements }, base)
    }

    // Reference: brute-force span sum by stepping each tick (only for modest `ticks`).
    fn brute(state: &OrreryState, base: &[u64], t0: u32, ticks: u64) -> u64 {
        let l = state.system_period();
        (0..ticks).fold(0u64, |acc, i| {
            let t = ((t0 as u64 + i) % l as u64) as u32;
            acc.saturating_add(state.prod_at(t, base, &pair))
        })
    }

    #[test]
    fn closed_form_equals_bruteforce() {
        for seed in 0..40u64 {
            let (state, base) = random_state(seed.wrapping_mul(0x9E3779B97F4A7C15), 5);
            let prefix = state.period_prefix(&base, &pair);
            let l = state.system_period();
            // many phases and span lengths: 0, 1, partial, several full periods + remainder
            for t0 in 0..(2 * l + 1) {
                for &ticks in &[0u64, 1, 2, l as u64, l as u64 + 1, 3 * l as u64 + 2, 25] {
                    assert_eq!(
                        offline_flux(&prefix, t0, ticks),
                        brute(&state, &base, t0, ticks),
                        "seed {seed} t0 {t0} ticks {ticks} L {l}"
                    );
                }
            }
        }
    }

    #[test]
    fn offline_o1_spans() {
        // A fixed state. The closed form must hold at huge spans WITHOUT looping — proving O(1).
        let (state, base) = random_state(0xC0FFEE, 6);
        let prefix = state.period_prefix(&base, &pair);
        let l = state.system_period() as u64;
        let per = prefix[l as usize];

        // (a) k whole periods from any phase == k · per_period, for a weeks-scale k.
        let weeks: u64 = 7 * 24 * 3600; // ticks if 1 tick = 1s; far beyond any loop budget
        for t0 in 0..(l as u32) {
            assert_eq!(
                offline_flux(&prefix, t0, weeks * l),
                weeks.saturating_mul(per)
            );
        }
        // (b) additivity (the semigroup the real offline relies on) at huge spans.
        let big_a = 9_876_543_210u64;
        let big_b = 1_234_567_890u64;
        assert_eq!(
            offline_flux(&prefix, 3, big_a + big_b),
            offline_flux(&prefix, 3, big_a) + offline_flux(&prefix, 3 + (big_a % l) as u32, big_b)
        );
        // (c) a seconds-scale span still matches brute force (bit-stable small case).
        assert_eq!(offline_flux(&prefix, 5, 90), brute(&state, &base, 5, 90));
    }

    #[test]
    fn lcm_within_cap() {
        // Every combination of allowed periods stays within the cap.
        for &p in &ALLOWED_PERIODS {
            for &q in &ALLOWED_PERIODS {
                for &s in &ALLOWED_PERIODS {
                    let state = OrreryState {
                        placements: [p, q, s]
                            .iter()
                            .map(|&per| Placement {
                                shape: 0,
                                orbit: Orbit {
                                    path: vec![0i32; per as usize],
                                    phase: 0,
                                },
                            })
                            .collect(),
                    };
                    assert!(state.system_period() <= L_CAP);
                    assert_eq!(state.checked_system_period(), Some(state.system_period()));
                }
            }
        }
        // A disallowed period (5) fails the gate.
        let bad = OrreryState {
            placements: vec![Placement {
                shape: 0,
                orbit: Orbit {
                    path: vec![0i32; 5],
                    phase: 0,
                },
            }],
        };
        assert_eq!(bad.checked_system_period(), None);
    }

    #[test]
    fn max_three_per_cell() {
        // Four shapes pinned to the same single cell (period-1 orbits) → meeting clamps to 3.
        let state = OrreryState {
            placements: (0..4)
                .map(|i| Placement {
                    shape: i,
                    orbit: Orbit {
                        path: vec![7],
                        phase: 0,
                    },
                })
                .collect(),
        };
        let m = state.meetings_at(0);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].len(), MAX_PER_CELL);
        // base over all 4 + pair bonus over exactly 3-choose-2 = 3 pairs (shapes 0,1,2).
        let base = vec![1u64, 1, 1, 1];
        let expected_base = 4u64;
        let expected_pairs = pair(0, 1) + pair(0, 2) + pair(1, 2);
        assert_eq!(
            state.prod_at(0, &base, &pair),
            expected_base + expected_pairs
        );
    }

    #[test]
    fn determinism() {
        let (state, base) = random_state(42, 5);
        assert_eq!(
            state.period_prefix(&base, &pair),
            state.period_prefix(&base, &pair)
        );
    }

    #[test]
    fn golden_known_meetings() {
        // Two shapes: A on a period-2 orbit [0,1], B fixed at cell 0 (period-1). They meet only when A is
        // at cell 0 — i.e. even ticks. base = 10 each.
        let state = OrreryState {
            placements: vec![
                Placement {
                    shape: 0, // A
                    orbit: Orbit {
                        path: vec![0, 1],
                        phase: 0,
                    },
                },
                Placement {
                    shape: 1, // B
                    orbit: Orbit {
                        path: vec![0],
                        phase: 0,
                    },
                },
            ],
        };
        let base = vec![10u64, 10];
        // t=0: both at cell 0 → meeting → base(20) + pair(0,1).
        assert_eq!(state.prod_at(0, &base, &pair), 20 + pair(0, 1));
        // t=1: A at cell 1, B at cell 0 → no meeting → just base(20).
        assert_eq!(state.prod_at(1, &base, &pair), 20);
        // system period = lcm(2,1) = 2; per-period total = (20+pair) + 20.
        let prefix = state.period_prefix(&base, &pair);
        assert_eq!(state.system_period(), 2);
        assert_eq!(*prefix.last().unwrap(), 40 + pair(0, 1));
    }

    #[test]
    fn pack_roundtrip() {
        for q in -50..50 {
            for r in -50..50 {
                assert_eq!(unpack(pack(q, r)), (q, r));
            }
        }
    }

    #[test]
    fn lane_is_straight_and_periodic() {
        // length-4 lane along each axis → period 6, every cell collinear with the anchor on that axis.
        for (axis, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
            let anchor = (2, -1);
            let path = lane_path(anchor, axis, 4);
            assert_eq!(path.len(), 6, "period = 2*(len-1)");
            for &c in &path {
                let (q, r) = unpack(c);
                let (eq, er) = (q - anchor.0, r - anchor.1); // offset from anchor
                let k = if dq != 0 { eq / dq } else { er / dr };
                assert_eq!((eq, er), (dq * k, dr * k), "axis {axis}: cell off the lane");
                assert!(
                    (0..4).contains(&k),
                    "axis {axis}: step {k} out of lane range"
                );
            }
            assert_eq!(unpack(path[0]), anchor);
            assert_eq!(unpack(path[3]), (anchor.0 + dq * 3, anchor.1 + dr * 3));
        }
    }

    #[test]
    fn hex_region_within_radius() {
        let cells = hex_region(3);
        assert!(cells.iter().all(|&(q, r)| hex_dist(q, r) <= 3));
        assert_eq!(cells.len(), 37); // 1 + 3*R*(R+1) for R=3
    }
}
