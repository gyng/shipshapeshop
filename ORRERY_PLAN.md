# ORRERY — Engine redesign plan

Replaces the static placement board with a **periodic clockwork of orbiting shapes**. Locked direction:
topology-seeded tunable orbits · hex grid · movement synced to ticks (1 cell/tick) · overlap OK (max 3
per cell) · co-located shapes "meet" and apply effects · a *musical* engine (scales/chords) · hard
validation gates. Inspiration: Zachtronics *Opus Magnum* (a looping, legible machine you tune).

> **Prime directive holds:** Rust decides truth; the offline catch-up stays **O(1)**. The whole point of
> *periodic* orbits is that the production rate is periodic → closed-form offline (proof below). If a design
> idea breaks O(1), it doesn't ship.

---

## 1. Model (Rust domain — pure)

- **Hex grid**, axial coords `(q, r)`, concentric rings around a center. Render-only geometry; the sim only
  needs each shape's **cell at tick t**.
- A placed shape sits on an **orbit** and advances **1 cell/tick** around it. An orbit is fully described by
  `{ ring: u8, period: u8, phase: u8, dir: ±1 }`. `cell_at(t) = ring_cells[ring][(phase + dir*t) mod period]`.
- **Topology-seeded, tunable.** The shape's *declared* invariants seed the orbit, the player tunes within
  topology-allowed ranges:
  - `genus` → ring/radius (more handles = more lanes = outer, busier rings)
  - `χ` (Euler) → base period (the "Euler budget" now buys orbital tempo)
  - `orientability` → `dir` (non-orientable shapes run retrograde — the overdrive flip, now literal)
  - tuning = pick `period` from a **small allowed set** and `phase` (the only knobs), so meetings are
    arrangeable but the system period stays bounded (below).
- **Meetings.** At tick t, shapes sharing a cell (cap **3**/cell) form a meeting. A meeting applies the
  existing pairwise effects — kin synergy (same family), knot/genus interactions, per-shape `signature` —
  as a **flux bonus for that tick**, and emits a musical note (§3). Repeated meetings build **resonance**
  → chords + a resonance multiplier.

## 2. O(1) offline — the load-bearing math

All periods come from a fixed small set `{1,2,3,4,6,12}` ⇒ the **whole system is periodic** with
`L = lcm(all placed periods) ≤ 12` (asserted at load; a hard gate). Production `prod(t)` (base + meeting
bonuses) therefore satisfies `prod(t) = prod(t mod L)`.

Precompute once (O(L · placements²), tiny): `prefix[k] = Σ_{t=0}^{k-1} prod(t)` for k in `0..=L`, so
`per_period = prefix[L]`.

Offline span of `T` ticks starting at phase `t0`:
```
sum[t0, t0+T) = full·per_period + prefix[(t0+T) mod L] − prefix[t0 mod L]      where full = (t0+T)/L − t0/L (integer)
```
O(1) regardless of T (seconds or weeks). This is the **exact** analogue of the current closed-form idle
math, just summed over one period instead of a constant rate. Currency stays integer/fixed-point; `prefix`
is integer → bit-stable golden replay.

**Global multipliers unchanged.** The Orrery yields the per-period base; the existing `mult_*` (bonds,
prestige, set, milestone, facet, signature, …) still multiply on top. The Orrery only **replaces the
static-board adjacency layer** (kin/knot static synergy → dynamic meetings).

## 3. Musical audio (§ TS feel layer; truth = which meetings happen, from Rust)

- Each shape has a **pitch** seeded by topology (e.g. χ/genus → scale degree). Meetings play their notes;
  resonant meetings play **chords**. Eigenmode timbre signature per character.
- Notes are **in-scale by construction** (indices into a pentatonic/diatonic table — you cannot emit an
  out-of-scale pitch), quantized to the tick grid, so the orrery *always* sounds pleasant.

## 4. Validation / verification gates (so it never becomes a mess)

**Core (Rust tests):**
- `lcm(periods) ≤ L_CAP` asserted at content-load and in a test over every ShapeDef → **guarantees O(1)**.
- **Closed-form == brute force**: assert the prefix-sum offline equals a tick-by-tick sum over many periods.
- **Offline golden**: fixed (save, now) → fixed `OfflineReport` for spans of seconds *and* weeks; bit-stable.
- **Determinism**: same inputs ⇒ bit-identical. Max 3/cell enforced + tested. Meeting detection tested.
**Audio (TS tests):**
- Every emitted pitch ∈ active scale (by construction + asserted). Polyphony ≤ cap. Summed gain ≤ loudness
  ceiling (clamped). Quantized. Deterministic (same state → same note list). Golden musicality snapshot.

## 5. Build phases (non-destructive first)

1. **Core** — `orrery.rs` domain + use-case + view fields, built **alongside** the static board behind a
   flag, so the shipping game never breaks. Tests above green. *(task #52)*
2. **UI** — hex board: drag from a shape **palette** onto orbits; tween motion (1 cell/tick) from WASM truth;
   render meetings (glow + note) + resonance meter; replace `BoardGrid`. *(task #53)*
3. **Audio** — the musical engine + gates. *(task #54)*
4. **Swap** — flip the Engine to the Orrery, migrate saves (loadout → default orbits), delete the static
   board once the Orrery is proven in-app.
