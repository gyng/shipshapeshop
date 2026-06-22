//! Flux-emitter engine — the orrery's production model (replaces the moving-orbit version).
//!
//! Shapes are **stationary**, placed on the hex grid by the player. Each tick a shape **emits** flux quanta
//! in a pattern (a beam, a rotating spoke, a scatter…). A quantum travels straight, cell by cell; when it
//! passes through another shape it triggers that shape's **interaction** (multiply, redirect, amplify, absorb);
//! when it falls off the grid (or hits the loop cap) its flux is **banked** into the account. Positioning
//! shapes so a beam chains through multipliers/redirectors before leaving the grid is the spatial puzzle.
//!
//! Determinism + O(1) offline: emission patterns are **periodic** (periods drawn from [`orrery::ALLOWED_PERIODS`]),
//! the board is static, and every quantum resolves in ≤ [`LOOP_CAP`] steps — so the banked flux per tick is a
//! periodic integer sequence with period `L = lcm(emit periods) ≤ L_CAP`. One period's prefix sums then give
//! exact closed-form catch-up for any span via [`orrery::offline_flux`]. Pure, integer, no floats/RNG/clock.

use crate::orrery::{self, hex_dist, pack, unpack, Cell, HEX_DIRS};

/// Max cells a single quantum may travel before its remaining flux is force-banked. Bounds the per-tick work
/// and makes redirect *loops* terminate (a quantum bouncing between two redirectors can't run forever).
pub const LOOP_CAP: u32 = 24;

/// What a shape emits each tick. `period()` must be in [`orrery::ALLOWED_PERIODS`] so the board stays periodic.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Emit {
    None,
    /// One quantum along the shape's base direction, every tick.
    Beam { amount: u64 },
    /// One quantum that rotates one hex step per tick — sweeps all 6 directions (period 6).
    Rotating { amount: u64 },
    /// A quantum in all six directions, every tick (a starburst).
    Scatter { amount: u64 },
    /// One quantum along the base direction every `period` ticks (a slow pulse).
    Pulse { amount: u64, period: u8 },
}

impl Emit {
    pub fn period(&self) -> u32 {
        match self {
            Emit::Rotating { .. } => 6,
            Emit::Pulse { period, .. } => (*period as u32).max(1),
            _ => 1,
        }
    }
}

/// What a shape does to flux passing through its cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    /// Flux passes through unchanged.
    Pass,
    /// Scale the quantum: `amount = amount * num / den` (integer, deterministic).
    Multiply { num: u32, den: u32 },
    /// Turn the quantum's direction by `turn` hex steps (the non-orientable "flip" et al).
    Redirect { turn: i8 },
    /// Add a flat amount to the quantum.
    Amplify { add: u64 },
    /// Fork the beam: a copy of the quantum branches off `turn` hex steps while the original carries straight
    /// on. Both branches bank in full — a duplicating Y-junction (the headline "rare" verb).
    Split { turn: i8 },
    /// Bank the quantum here and stop (a sink).
    Absorb,
}

/// A placed shape: where it sits, which way it points, its emission timing offset, and its behaviours. `act` is
/// the primary interaction; `act2` is an optional SECONDARY effect (Epic+ shapes get a compound kit) applied
/// right after the primary on the same cell — `Pass` for shapes with only one effect.
#[derive(Clone, Debug)]
pub struct Emitter {
    pub cell: Cell,
    pub dir: u8,   // base direction (0..6) — the player-tunable axis
    pub phase: u8, // emission timing offset
    pub emit: Emit,
    pub act: Act,
    pub act2: Act,
}

/// The whole arrangement — the only state the production math needs.
#[derive(Clone, Debug, Default)]
pub struct Board {
    pub emitters: Vec<Emitter>,
    pub radius: i32,
    /// mirrored_rim (#19): how many times a quantum may REFLECT back inward off the grid edge (0 = off, the
    /// historical behaviour — a beam leaving the grid just banks). Set from the upgrade level in `flux_board`.
    pub rim_reflects: u8,
}

/// One hex step from `cell` in direction `dir`.
pub fn step(cell: Cell, dir: u8) -> Cell {
    let (q, r) = unpack(cell);
    let (dq, dr) = HEX_DIRS[(dir % 6) as usize];
    pack(q + dq, r + dr)
}

fn turn_dir(dir: u8, turn: i8) -> u8 {
    (((dir as i32 + turn as i32).rem_euclid(6)) as u8) % 6
}

impl Board {
    fn occupant(&self, cell: Cell) -> Option<&Emitter> {
        self.emitters.iter().find(|e| e.cell == cell)
    }
    fn on_grid(&self, cell: Cell) -> bool {
        let (q, r) = unpack(cell);
        hex_dist(q, r) <= self.radius
    }

    /// Trace one quantum from `origin` (the emitter cell) heading `dir0` with `amount0`, returning the flux it
    /// banks. It steps cell by cell; a shape it crosses applies its [`Act`]; off-grid (or the loop cap) banks
    /// the remaining flux. Saturating throughout — flux can't wrap the economy.
    pub fn trace(&self, origin: Cell, dir0: u8, amount0: u64) -> u64 {
        let mut banked = 0u64;
        // in-flight branches (a Split forks new ones); each travels ≤ LOOP_CAP cells, a shared budget bounds the
        // total work so a lattice of splitters can't explode. Single-branch (no Split) is identical to the old
        // straight-line trace; act2 just applies a second effect on the same cell (Pass for one-effect shapes).
        let mut stack: Vec<(Cell, u8, u64, u8)> = vec![(step(origin, dir0), dir0, amount0, self.rim_reflects)];
        let mut budget = LOOP_CAP * 4;
        while let Some((mut cell, mut dir, mut amt, mut reflects)) = stack.pop() {
            let mut steps = LOOP_CAP;
            loop {
                if amt == 0 {
                    break;
                }
                if steps == 0 || budget == 0 {
                    banked = banked.saturating_add(amt); // loop cap → bank the remainder
                    break;
                }
                if !self.on_grid(cell) {
                    // mirrored_rim (#19): a beam leaving the grid REFLECTS back inward (180°) once per remaining
                    // reflect — reversing dir then stepping from the off-grid cell lands on the last on-grid cell
                    // (HEX_DIRS d+3 = −d, so step undoes the move that went off). Each reflection spends budget so
                    // the loop stays bounded; rim_reflects=0 ⇒ byte-identical to the old "off-grid banks" path.
                    if reflects > 0 && amt > 0 {
                        reflects -= 1;
                        dir = turn_dir(dir, 3);
                        cell = step(cell, dir);
                        budget -= 1;
                        continue;
                    }
                    banked = banked.saturating_add(amt);
                    break;
                }
                steps -= 1;
                budget -= 1;
                if let Some(e) = self.occupant(cell) {
                    let mut absorbed = false;
                    for act in [e.act, e.act2] {
                        match act {
                            Act::Pass => {}
                            Act::Multiply { num, den } => amt = amt.saturating_mul(num as u64) / (den.max(1) as u64),
                            Act::Amplify { add } => amt = amt.saturating_add(add),
                            Act::Redirect { turn } => dir = turn_dir(dir, turn),
                            Act::Split { turn } => {
                                let bdir = turn_dir(dir, turn);
                                if budget > 0 {
                                    stack.push((step(cell, bdir), bdir, amt, self.rim_reflects)); // fork: fresh reflect budget
                                }
                            }
                            Act::Absorb => {
                                banked = banked.saturating_add(amt);
                                absorbed = true;
                                break;
                            }
                        }
                    }
                    if absorbed {
                        break;
                    }
                }
                cell = step(cell, dir);
            }
        }
        banked
    }

    /// Total flux banked at tick `t` — sum over every quantum every emitter releases this tick.
    pub fn flux_at(&self, t: u32) -> u64 {
        let mut total = 0u64;
        for e in &self.emitters {
            let tt = t.wrapping_add(e.phase as u32);
            match e.emit {
                Emit::None => {}
                Emit::Beam { amount } => total = total.saturating_add(self.trace(e.cell, e.dir, amount)),
                Emit::Rotating { amount } => {
                    let dir = ((e.dir as u32 + tt) % 6) as u8;
                    total = total.saturating_add(self.trace(e.cell, dir, amount));
                }
                Emit::Scatter { amount } => {
                    for d in 0..6u8 {
                        total = total.saturating_add(self.trace(e.cell, d, amount));
                    }
                }
                Emit::Pulse { amount, period } => {
                    if tt.is_multiple_of(period.max(1) as u32) {
                        total = total.saturating_add(self.trace(e.cell, e.dir, amount));
                    }
                }
            }
        }
        total
    }

    /// Whole-board period = lcm of every emitter's emission period (1 when empty). ≤ `L_CAP` by construction.
    pub fn period(&self) -> u32 {
        let l = self
            .emitters
            .iter()
            .fold(1u32, |acc, e| lcm(acc, e.emit.period()));
        debug_assert!(l <= orrery::L_CAP, "board period {l} exceeds L_CAP");
        l.max(1)
    }

    fn index_of(&self, cell: Cell) -> Option<usize> {
        self.emitters.iter().position(|e| e.cell == cell)
    }

    /// Like [`trace`], but ALSO credits each multiply/amplify cell's flux gain to that cell's emitter in `amp`
    /// — the "support" a shape provides to OTHER shapes' flux passing through it. Same banking result as `trace`.
    fn trace_attr(&self, origin: Cell, dir0: u8, amount0: u64, amp: &mut [u64]) -> u64 {
        let mut banked = 0u64;
        let mut stack: Vec<(Cell, u8, u64, u8)> = vec![(step(origin, dir0), dir0, amount0, self.rim_reflects)];
        let mut budget = LOOP_CAP * 4;
        while let Some((mut cell, mut dir, mut amt, mut reflects)) = stack.pop() {
            let mut steps = LOOP_CAP;
            loop {
                if amt == 0 {
                    break;
                }
                if steps == 0 || budget == 0 {
                    banked = banked.saturating_add(amt);
                    break;
                }
                if !self.on_grid(cell) {
                    // mirrored_rim (#19): mirror trace's reflection so the support-attribution matches the banked truth.
                    if reflects > 0 && amt > 0 {
                        reflects -= 1;
                        dir = turn_dir(dir, 3);
                        cell = step(cell, dir);
                        budget -= 1;
                        continue;
                    }
                    banked = banked.saturating_add(amt);
                    break;
                }
                steps -= 1;
                budget -= 1;
                if let Some(e) = self.occupant(cell) {
                    let j = self.index_of(cell);
                    let mut absorbed = false;
                    for act in [e.act, e.act2] {
                        match act {
                            Act::Pass => {}
                            Act::Multiply { num, den } => {
                                let before = amt;
                                amt = amt.saturating_mul(num as u64) / (den.max(1) as u64);
                                if let Some(j) = j {
                                    amp[j] = amp[j].saturating_add(amt.saturating_sub(before));
                                }
                            }
                            Act::Amplify { add } => {
                                amt = amt.saturating_add(add);
                                if let Some(j) = j {
                                    amp[j] = amp[j].saturating_add(add);
                                }
                            }
                            Act::Redirect { turn } => dir = turn_dir(dir, turn),
                            Act::Split { turn } => {
                                let bdir = turn_dir(dir, turn);
                                if budget > 0 {
                                    if let Some(j) = j {
                                        amp[j] = amp[j].saturating_add(amt); // the forked copy is support
                                    }
                                    stack.push((step(cell, bdir), bdir, amt, self.rim_reflects));
                                }
                            }
                            Act::Absorb => {
                                banked = banked.saturating_add(amt);
                                absorbed = true;
                                break;
                            }
                        }
                    }
                    if absorbed {
                        break;
                    }
                }
                cell = step(cell, dir);
            }
        }
        banked
    }

    /// Per-emitter flux attribution over one full period (µ-units summed across the period). This is the data a
    /// "DPS meter" reads. **Accounting principle — source attribution:** every banked unit is credited to the
    /// shape that EMITTED it (incl. any multipliers along its path), so `direct` is each shape's true output.
    /// - `direct[i]` = flux banked from emitter i's own quanta. (Σ `direct` == one period's total banked flux.)
    /// - `amp[i]` = extra flux emitter i's multiply/amplify cell added to OTHER shapes' quanta — a *support*
    ///   re-attribution of value already inside the emitters' `direct`, NOT added to the total.
    pub fn contributions(&self) -> (Vec<u64>, Vec<u64>) {
        let n = self.emitters.len();
        let mut direct = vec![0u64; n];
        let mut amp = vec![0u64; n];
        let l = self.period();
        for t in 0..l {
            for (i, e) in self.emitters.iter().enumerate() {
                let tt = t.wrapping_add(e.phase as u32);
                let add = |d: &mut Vec<u64>, v: u64| d[i] = d[i].saturating_add(v);
                match e.emit {
                    Emit::None => {}
                    Emit::Beam { amount } => add(&mut direct, self.trace_attr(e.cell, e.dir, amount, &mut amp)),
                    Emit::Rotating { amount } => {
                        let dir = ((e.dir as u32 + tt) % 6) as u8;
                        add(&mut direct, self.trace_attr(e.cell, dir, amount, &mut amp));
                    }
                    Emit::Scatter { amount } => {
                        for d in 0..6u8 {
                            add(&mut direct, self.trace_attr(e.cell, d, amount, &mut amp));
                        }
                    }
                    Emit::Pulse { amount, period } => {
                        if tt.is_multiple_of(period.max(1) as u32) {
                            add(&mut direct, self.trace_attr(e.cell, e.dir, amount, &mut amp));
                        }
                    }
                }
            }
        }
        (direct, amp)
    }

    /// `prefix[k] = Σ_{t<k} flux_at(t)` for `k in 0..=L`. `prefix[L]` is one period's total banked flux. With
    /// [`orrery::offline_flux`] this gives exact O(1) catch-up over any span.
    pub fn period_prefix(&self) -> (Vec<u64>, u32) {
        let l = self.period();
        let mut prefix = Vec::with_capacity(l as usize + 1);
        prefix.push(0u64);
        let mut acc = 0u64;
        for t in 0..l {
            acc = acc.saturating_add(self.flux_at(t));
            prefix.push(acc);
        }
        (prefix, l)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn emitter(q: i32, r: i32, dir: u8, emit: Emit, act: Act) -> Emitter {
        Emitter { cell: pack(q, r), dir, phase: 0, emit, act, act2: Act::Pass }
    }

    #[test]
    fn beam_falls_off_and_banks_full_amount() {
        // a lone beamer on a radius-3 grid: its quantum travels to the edge and banks its amount each tick.
        let b = Board { emitters: vec![emitter(0, 0, 0, Emit::Beam { amount: 10 }, Act::Pass)], radius: 3, rim_reflects: 0 };
        assert_eq!(b.flux_at(0), 10);
        assert_eq!(b.period(), 1);
        let (prefix, l) = b.period_prefix();
        assert_eq!(l, 1);
        assert_eq!(prefix[l as usize], 10); // one period banks 10
    }

    #[test]
    fn multiplier_in_the_path_scales_flux() {
        // beamer at (0,0) firing +q (dir 0); a ×3 multiplier one cell along the beam → banks 30.
        let b = Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Beam { amount: 10 }, Act::Pass),
                emitter(1, 0, 0, Emit::None, Act::Multiply { num: 3, den: 1 }),
            ],
            radius: 4, rim_reflects: 0,
        };
        assert_eq!(b.flux_at(0), 30);
    }

    #[test]
    fn redirect_loop_terminates_via_cap() {
        // two facing redirectors would bounce a quantum forever; the loop cap force-banks it instead of hanging.
        let b = Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Beam { amount: 7 }, Act::Pass),
                emitter(1, 0, 3, Emit::None, Act::Redirect { turn: 3 }), // turn 180°
                emitter(-1, 0, 0, Emit::None, Act::Redirect { turn: 3 }),
            ],
            radius: 5, rim_reflects: 0,
        };
        let f = b.flux_at(0); // must return (not hang) and bank the quantum
        assert!(f >= 7, "loop-capped flux should still be banked, got {f}");
    }

    #[test]
    fn rim_reflects_recrosses_multiplier_and_caps_reflections() {
        // mirrored_rim (#19): a ×2 cell sits on a beam's path to the rim. With reflection the beam bounces back
        // inward and re-crosses it; with rim_reflects=1 that happens EXACTLY once (the cap), so ×2 lands twice.
        let mult = emitter(1, 0, 0, Emit::None, Act::Multiply { num: 2, den: 1 });
        let a = pack(0, 0);
        let b0 = Board { emitters: vec![mult.clone()], radius: 3, rim_reflects: 0 };
        let b1 = Board { emitters: vec![mult], radius: 3, rim_reflects: 1 };
        assert_eq!(b0.trace(a, 0, 10), 20, "no reflection: crosses the ×2 once = 20 (byte-identical to before)");
        assert_eq!(b1.trace(a, 0, 10), 40, "one reflection: re-crosses the ×2 = 40 (capped at exactly 1 bounce)");
    }

    #[test]
    fn rim_reflect_terminates() {
        // reflection + a redirector could fold a beam around forever; the shared budget still force-banks it.
        let b = Board {
            emitters: vec![emitter(2, 0, 0, Emit::None, Act::Redirect { turn: 2 })],
            radius: 5,
            rim_reflects: 3,
        };
        let f = b.trace(pack(0, 0), 0, 10); // reaching the assert means it RETURNED (didn't hang)
        assert!(f > 0, "a reflecting + redirecting board still terminates and banks, got {f}");
    }

    #[test]
    fn rotating_has_period_6_and_is_deterministic() {
        let b = Board { emitters: vec![emitter(0, 0, 0, Emit::Rotating { amount: 5 }, Act::Pass)], radius: 3, rim_reflects: 0 };
        assert_eq!(b.period(), 6);
        let (p1, _) = b.period_prefix();
        let (p2, _) = b.period_prefix();
        assert_eq!(p1, p2); // bit-stable
    }

    #[test]
    fn offline_closed_form_matches_bruteforce() {
        let b = Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Rotating { amount: 8 }, Act::Pass),
                emitter(2, -1, 0, Emit::Beam { amount: 4 }, Act::Multiply { num: 2, den: 1 }),
            ],
            radius: 4, rim_reflects: 0,
        };
        let (prefix, l) = b.period_prefix();
        // brute-force sum the first N ticks; compare to the closed form
        for &(t0, ticks) in &[(0u32, 5u64), (3, 20), (1, 100)] {
            let mut brute = 0u64;
            for k in 0..ticks {
                brute = brute.saturating_add(b.flux_at(t0 + k as u32));
            }
            assert_eq!(orrery::offline_flux(&prefix, t0, ticks), brute, "span t0={t0} ticks={ticks}");
            let _ = l;
        }
    }

    #[test]
    fn contributions_use_source_attribution_and_credit_support() {
        // beamer (amount 10) firing into a ×3 multiplier one cell along → banks 30.
        let b = Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Beam { amount: 10 }, Act::Pass),
                emitter(1, 0, 0, Emit::None, Act::Multiply { num: 3, den: 1 }),
            ],
            radius: 4, rim_reflects: 0,
        };
        let (direct, amp) = b.contributions();
        let (prefix, l) = b.period_prefix();
        // ACCOUNTING PRINCIPLE: Σ direct == one period's total banked flux (every unit attributed to its emitter).
        assert_eq!(direct.iter().sum::<u64>(), prefix[l as usize]);
        assert_eq!(direct[0], 30); // all 30 credited to the shape that emitted it
        assert_eq!(direct[1], 0); // the pure multiplier emits nothing of its own
        assert_eq!(amp[1], 20); // …but it lent +20 (30−10) of support to the beam
        assert_eq!(amp[0], 0);
    }

    #[test]
    fn split_forks_and_duplicates_the_beam() {
        // a beam of 10 into a 120° splitter → the straight branch AND the forked branch each bank 10 = 20.
        let b = Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Beam { amount: 10 }, Act::Pass),
                Emitter { cell: pack(1, 0), dir: 0, phase: 0, emit: Emit::None, act: Act::Split { turn: 2 }, act2: Act::Pass },
            ],
            radius: 5, rim_reflects: 0,
        };
        assert_eq!(b.flux_at(0), 20);
        // the splitter is credited the forked copy as support, the beamer keeps source-attribution of both.
        let (direct, amp) = b.contributions();
        assert_eq!(direct[0], 20);
        assert_eq!(amp[1], 10);
    }

    #[test]
    fn amplify_adds_flat_amount() {
        // a flat Amplify is ADDITIVE, not multiplicative — a tiny beam and a huge beam BOTH gain exactly `add`.
        let board = |amount: u64| Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Beam { amount }, Act::Pass),
                Emitter { cell: pack(1, 0), dir: 0, phase: 0, emit: Emit::None, act: Act::Amplify { add: 5 }, act2: Act::Pass },
            ],
            radius: 5, rim_reflects: 0,
        };
        assert_eq!(board(10).flux_at(0), 15); // 10 + 5
        assert_eq!(board(1_000_000).flux_at(0), 1_000_005); // FLAT: +5 regardless of magnitude, never ×
        // the amplifier is credited the flat add it lent (support attribution stays correct for the DPS meter)
        let (direct, amp) = board(10).contributions();
        assert_eq!(direct[0], 15);
        assert_eq!(amp[1], 5);
    }

    #[test]
    fn secondary_effect_applies_after_primary() {
        // a cell that multiplies ×2 (primary) THEN ×3 (secondary) → a beam of 5 banks 30.
        let b = Board {
            emitters: vec![
                emitter(0, 0, 0, Emit::Beam { amount: 5 }, Act::Pass),
                Emitter { cell: pack(1, 0), dir: 0, phase: 0, emit: Emit::None, act: Act::Multiply { num: 2, den: 1 }, act2: Act::Multiply { num: 3, den: 1 } },
            ],
            radius: 4, rim_reflects: 0,
        };
        assert_eq!(b.flux_at(0), 30);
    }
}
