# Shape Gacha — Game Design Doc

> A free, single-player **gacha + idle** game where the collectibles are **mathematical shapes**.
> Pull manifolds instead of waifus; the rarer the topology, the more exotic the power.
> Companion docs: [`RENDERING_PLAN.md`](./RENDERING_PLAN.md) (3D / shader / pull-ceremony tech) ·
> [`CHARACTERS.md`](./CHARACTERS.md) (characters / narrative / bonds / shipping).
>
> **The core is the addictive gacha + idle loop.** The math/topology is a *side effect* — flavor and
> discovery that rides along because personality is derived from geometry. It is opt-in, OFF by default,
> and never gates fun (see `CHARACTERS.md` framing rules).

---

## 1. One-line pitch

A **Museum of Mathematics** you grow by pulling shapes from a gacha and arranging them into a living
production engine. Common pulls are cubes and spheres; SSR/UR pulls are heptoroids, Klein bottles,
gyroids, and 4D polytopes. Each shape's **real topological invariants ARE its in-game effect** — genus,
orientability, curvature, symmetry, knottedness — so building a great engine means (optionally) learning
some real topology, and the collection doubles as edutainment.

The **default experience is a calm, zero-skill ASMR collector**: gorgeous refractive jewels you pull,
spin, and shelve. Underneath it, for players who want it, is a **deep, optional optimization game**.

---

## 2. The decision that makes or breaks this game: *what is scarce?*

A paid gacha runs on **money-scarcity** — every pull is tense because money is finite. We are free and
single-player, so we must replace that spring with a *concrete, costed mechanic*, or the loop collapses
into "idle income makes every shape inevitable → nothing is at stake → the gacha is pointless."

**Resolution — scarcity is a conserved topological budget, not currency.**

- You **own** every shape you pull (collection compulsion is satisfied — nothing is taken away).
- You can only **run a subset at once** — your *active loadout* — and the loadout is bounded by an
  **Euler Budget**.
- Every shape carries its real **Euler characteristic χ**. Deploying a shape spends `(2 − χ)` of budget:
  - Sphere/cube/Platonic solids: χ = 2 → cost **0** (they're free "ballast").
  - Torus (χ = 0) → cost **2**. Genus-2 (χ = −2) → cost **4**. Heptoroid (genus-7, χ = −12) → cost **14**.
  - Non-orientable & exotic surfaces cost the most.
- Your budget cap rises **slowly**, only via prestige (§6). So at any moment you can run *a few* exotics
  **or** many cheap shapes — never everything.

Why this works:

1. **Every pull stays meaningful** even when you own hundreds — a new SSR *competes for budget* against
   what's already deployed; you must choose, and choosing is the game.
2. **Commons never become useless** (anti-power-creep): high-χ spheres are the ballast that lets you
   afford exotics, and they share symmetry-group set bonuses with the chase URs (§4).
3. It's **grounded in real math** (χ is a genuine conserved invariant under connected sum), so it teaches
   while it constrains.
4. It gives **endless optimization** without an infinite content treadmill we can't fund.

**Secondary rate-limiter — "pity as production."** Pulls cost **Flux** (idle-generated). Better gacha odds
are not bought with patience alone; they're gated by how well-*tuned* your engine is. Wanting better luck
funnels the player into the real game instead of an idle wait. (Numbers in §7.)

> **The honest answer to "why pull when it's free?"** You pull for *options* to optimize a budget-locked
> loadout, and to *complete families and discover recipes* (§5) — not for power you'll inevitably afford.

---

## 3. The core loop

**Second-to-second (calm surface):** your shelf of shapes slowly rotates and refracts; a Flux counter
ticks up; ambient tones drift. Zero input required.

**Minute-to-minute:** (1) spend Flux on a **pull** — the dopamine beat; (2) inspect/shelve the new shape
(read its 30-second math codex card, §8); (3) optionally swap it into your **active loadout** within the
Euler Budget, or let **auto-arrange** pick a good-enough loadout for you (idlers never have to engage the
puzzle).

**Session-to-session:** chase **family completion** (Platonic set, the regular 4-polytopes, the knot
table), discover **connected-sum recipes** (§5), and push the **prestige axis** (§6) toward 4D.

---

## 4. The novel shape effects (the heart of the design)

These survived an adversarial cut that deleted every disguised "+X% multiplier." Each keys off a *real*
property no other shape can fake. **Tentpoles** are the load-bearing systems; ship 2–3 of them, treat the
rest as a content roadmap.

### Tentpoles

| Mechanic | Shape property | What it does |
|---|---|---|
| **Connected-Sum Forge** | the `#` operation | Crafting *is* the surface connected-sum. χ adds (minus 2 per glue), genus adds, non-orientability is contagious. The surface-classification theorem becomes the recipe book — `RP²#T² = 3·RP²`, so "wasteful" recipes secretly equal cheaper ones. Duplicates are the fuel. |
| **Handle Lanes** | genus *g* | A genus-*g* shape runs **g independent production lanes**, each with its own resource, upgrades, and clog/starve state. Genus changes the *arity* of production — a buffed torus can never emulate a heptoroid. Offline recap becomes a diagnosis ("lane 2 clogged, lane 5 starved"), not one number. |
| **Non-Orientable Overdrive** | orientability (Möbius/Klein) | Runs at a huge multiplier, but a transported frame **flips the output sign** each sense-reversing loop — the accumulator drains then refills. Punishes pure neglect, rewards *timed cash-outs* via real monodromy. A sign flip is an op no orientable shape can do. |
| **Ricci-Flow Refinery** | curvature + Gauss–Bonnet | Crafting = running a shape through discretized Ricci flow while idle; total curvature (2πχ) is conserved as local geometry smooths until a neck **pinches and surgery splits** it into two shapes whose χ must sum correctly. A real PDE replaces a recipe table; hyperbolic flows reward long absences, spherical flows risk collapse. |
| **Strange-Attractor Lottery** | deterministic chaos | The pull mechanism is a **chaotic ODE, not a hidden RNG table**: drop a seed onto a Lorenz/Rössler attractor; the lobe it lands in sets rarity. Sensitive dependence gives real gambling *feel*; determinism (same seed+time ⇒ same pull) keeps it fair and lets veterans *time a lobe transition* for clustered rares. |
| **Viewport Dimension** | dimensionality *v* | A single integer gates legibility (`v ≥ d`): shapes above your viewport appear only as flickering shadows. Ascending *v* (the hard prestige) doesn't wipe the collection — it **re-bases the economy so a whole cohort of dormant pulls ignites ~16× at once**. You literally pull for shapes you can't fully see yet. |

### Strong supporting mechanics

- **Euler Budget ledger** — the scarcity spring of §2, promoted to the central constraint.
- **Loop Resonators vs Void Reservoirs** — `b₁` (1-cycles) = recirculating conveyors that compound per
  lap; `b₂` (enclosed voids) = sealed offline-buffer capacity. A shape's identity is a 2-D homology vector
  (compounding-speed, idle-safe-duration) you *can't* collapse into one number. Active players hunt high
  `b₁`; idlers hunt high `b₂`.
- **Knot-Throughput Plumbing** — crossing number = capacitor back-pressure (charge offline, burst on
  release); linking number = free-energy transformer (flux in A induces `lk·flux` in B); cashing out a
  charged knot is its **unknotting-number Reidemeister puzzle**.
- **Eigenmode Orchestra** — idle output is the constructive-interference integral of each shape's
  Laplace–Beltrami spectrum; near-integer frequency ratios phase-lock into a standing wave that charges on
  an S-curve. **You can hear your economy** and re-tune by ear before it saturates.
- **"Sound-of-a-Drum" exploit** — because the Orchestra reads only the spectrum, a *Gordon–Webb
  isospectral* shape is a perfect acoustic counterfeit: run a cheap shape as a dupe of a rare one in
  spectral slots. "You cannot hear the shape of a drum" as a sanctioned glitch to discover.
- **Word-Ordering Automation** — automation programs are built from a shape's `π₁` generators: abelian
  (torus) = order-insensitive set-and-forget; non-abelian (genus ≥ 2) = "pump then flush" ≠ "flush then
  pump." Order of operations as a load-bearing mechanic.
- **Covering-Sheet Prestige** — prestige by lifting a shape to an *n*-fold cover (Riemann–Hurwitz): keep
  upgrades, run *n* synchronized sheets; which covers exist is gated by `π₁` subgroups.
- **Heawood Palette** — a genus-*g* surface hosts at most `⌊(7+√(1+48g))/2⌋` resource colors before they
  collide (sphere = 4 by the Four Color Theorem; torus = exactly 7). Build *width* is capped by a real
  closed-form invariant.

### Flavor / long-tail

Minimal-Surface Lattice (gyroid = zero-upkeep dual-labyrinth infrastructure), Cross-Section Harvesting
(a sweeping hyperplane banks a 4-polytope's 3-D slices as a collectible crop), Truncate/Stellate (a
variance dial: lower-the-floor steady earner vs spiky jackpot bursts, ending at the Kepler–Poinsot solids).

---

## 5. Two slot-machines, not one: pulling **and** crafting

Pulling is variable-ratio reward. We add a **second** variable-ratio surface on **crafting**: the
**Connected-Sum Forge** plus a **Discovery sting** — the first time your account ever produces a shape
(two Möbius strips `#` into a Klein bottle; a cube's dual is an octahedron), you get a one-time codex
unlock + reward. This:

- doubles the dopamine surface area,
- gives the finite collection a *second, deeper* progression axis (the fix for "I've pulled everything"),
- and teaches topology by osmosis through live-updating invariant numbers.

Crafting is **optional and progressively disclosed** — it never gates the casual sensory loop.

---

## 6. Progression & prestige

- **Soft progression:** upgrades (global / per-rarity / per-family multipliers, offline-cap extensions),
  bought with Flux.
- **Family set bonuses:** completing a mathematical family (the 5 Platonic solids, the 6 regular
  4-polytopes, the knot table by crossing number) grants permanent buffs. **Symmetry-group kinship** means
  a chase UR (the 120-cell shares icosahedral symmetry with the humble dodecahedron) *supercharges a pile
  of commons*, keeping early shapes relevant forever.
- **Shelf kinship:** adjacent shelved shapes with mathematical kinship (same genus; a knot + its Seifert
  surface; a polytope + its dual) boost each other and draw a visible glowing thread — a low-cost spatial
  puzzle layer for the gallery, no full board-sim needed.
- **Prestige = New Game Plus = "Recrystallize":** the **Viewport Dimension** ascent (§4) is the meta-spine
  and the *replay spine*. A gorgeous "melt and recrystallize" ceremony the player **wants** to trigger:
  carries over the **full collection + all bonds/cutscenes + family-set flags + shard bank** (and a faded
  upgrade head-start so you never re-climb from zero-feel); resets Flux, Euler-budget cap, and upgrade
  levels. Each ascent **raises v by 1** and **ignites a dormant higher-dimensional cohort ~16×** — new
  chase shapes you literally couldn't *see* before (4D cross-sections in NG+1, 5D shadows + isospectral
  counterfeit pairs later). Each cycle adds **one new optional invariant constraint** (NG+1 Heawood palette,
  NG+2 non-abelian word-order, NG+3 covering-sheet sync) — depth only, never gating the calm loop.
  Narratively, NG+ = *re-meet everyone from a higher vantage* (see `CHARACTERS.md`).
- **Endgame honesty:** no revenue ⇒ no infinite treadmill, so this is a **finite, completable** game.
  **Loop 1** (100% codex + all families + viewport v=4) is the summit; **designed NG+ escalation caps at
  cycle 5** (a "Crystalline Apex" finale + the deepest bond cutscenes). Cycles 6–8 exist as optional
  endless-mode (a "fastest-ascent" self-challenge), **not** fake infinite content. The emotional/bond depth
  is correctly back-loaded onto NG+, which carries everything forward — so months of attachment accrue
  *across* cycles, not within loop 1.

---

## 7. Economy numbers (locked starting constants — tune via the §9 simulator)

> Monte-Carlo verified (20k runs): **loop 1 finishes in ~180 pulls / ~30h idle** (p10 25h, p90 34h),
> **~10–12h for an engaged player**. Squarely the 1–2-day target. All numbers live in the Rust core,
> pinned by tests (§10).

- **Currency:** ONE soft currency, **Flux** (idle-generated). No premium currency. Dupes → **shards**
  (Common 1 / Rare 3 / Epic 8 / SSR 20 / UR 60). 600 shards = one instant Resonance fill.
- **Pull cost:** **100 Flux flat** (10-pull = 1000 Flux for 11 → effective 90.9/pull). ~180 pulls = ~18k
  Flux to 100% core. *(No escalating tax — the idle ramp itself is the rate-limiter.)*
- **Idle earn (ramp, not flat):** Phase A (hr 0–4) **180/hr** (calm cold-start) → Phase B (hr 4–16) ramps
  **180→900/hr** as deployed shapes bring genus-lanes online → Phase C cap **900/hr**. Run-avg ~600/hr.
  The hard 900/hr cap keeps the closed-form offline math from ever running away. *(Smooth the B→C ramp to
  900 to avoid the 720→900 step.)*
- **Offline cap: a generous 12h** of bankable accrual (≈10.8k Flux). Ethics rule — no coercive check-in;
  a once-a-day player still finishes inside the 1–2-day band.
- **Pity (recalibrated for a SHORT free game — Genshin's 90-pity is wrong here):** per-pull base **C 50 /
  R 30 / E 14 / SSR 5 / UR 1 %** (top = SSR+ = 6%). SSR+ **soft pity from pull 20**:
  `p(n)=0.06+(n−20)·0.094`; **hard pity 30**. **Epic floor:** guaranteed Epic+ every 10 pulls. Within a top
  pull: **30% UR / 70% SSR**, featured guaranteed-next-on-loss. *Effective top-rate ~7.8%, ~12.8 pulls
  between tops.* **All odds + both counters are visible** (surprise, not deception).
- **Resonance Spark (the real UR ceiling — non-negotiable):** every pull +1 Resonance; at **40**, claim any
  un-owned **featured TOP shape, UR-priority then SSR**. **The spill-to-SSR is a required fix** — without
  it the unprotected SSR tier (not UR) becomes the bottleneck (~204 pulls, with an ugly p99≈317/38h tail);
  with it the sim lands at mean ~169 / p90 ~200, matching target and giving SSR a hard ceiling too.
- **New Game Plus:** pity/spark **unchanged** (gacha *feel* identical); only earn scales **×1.6^cycle**, so
  chases shrink **180 → 70 → 55 → 45 → 38** pulls (≈20h → 5h → 2.4h → 1.2h → 0.6h). Carried dupe-shards let
  veterans pre-buy spark fills and front-load each new cohort.
- **Euler budget:** base cap ~6 at loop start (a couple of exotics, or many commons); rises only via
  prestige/NG+.
- **Completion target:** **49 codex** (41 named shapes + ~8 Forge "Discovery" unlocks) + 3 family sets
  (Platonic, regular 4-polytopes, knot table) + viewport **v=4**. *Not* required: every dupe, max bonds
  (NG+ long tail), or a perfectly-optimized loadout (opt-in depth). Finishing unlocks the Recrystallize/NG+
  gate.

---

## 8. Launch content inventory (~50 shapes — "procedural ≠ infinite")

Procedural families give variety, but `(7,3)` and `(5,2)` torus knots are **not** psychologically distinct
collectibles. So: hand-curate a named, rarity-assigned launch set, *then* let families extend each tier.

| Tier | Theme | Example launch shapes (count) |
|---|---|---|
| **Common** | genus 0, χ=2, free ballast | Sphere, Cube, Tetrahedron, Octahedron, Dodecahedron, Icosahedron, Cylinder, Cone, Disk, Ellipsoid (**10**) |
| **Rare** | genus 1 / exotic symmetry | Torus, Möbius strip, Genus-2 surface, Hyperboloid, Catenoid, Helicoid, Trefoil (tube), Monkey saddle (**8**) |
| **Epic** | non-orientable closed / knots | Klein bottle, ℝP², Boy's surface, Cross-cap, Figure-8 knot, (2,5) torus knot, Gyroid patch, Schwarz-P surface (**8**) |
| **SSR** | high genus / minimal surfaces / links | Heptoroid (genus-7), Costa surface, Borromean rings, Seifert surface, Lorenz manifold, Schwarz-D surface, Triple torus (**7**) |
| **UR / "Manifold"** | 4D polytopes / famous exotica | Tesseract, 16-cell, 24-cell, 120-cell, 600-cell, Klein quartic, Hopf fibration, Mazur manifold patch (**8**) |

**Procedural multipliers** (filtered by hand into the keepers): the **Gielis superformula** (thousands of
organic shapes from `m,n1,n2,n3`), **torus-knot `(p,q)`**, and **triply-periodic minimal surfaces**.
**Per-shape codex card:** a real 30-second math fact + animated model, unlocked on acquisition — cheap to
produce, intrinsically motivating, and the only free marketing a no-spend game gets (edutainment
word-of-mouth).

---

## 9. Tech architecture (React/TS + Rust)

**Recommendation: web app + Rust→WASM simulation core, shipped as a static PWA.** (Not Tauri, not a local
server.) Lowest install friction for a free game, the idle math needs no server, WASM is native-speed, and
a single-player game needs no server-authoritative anti-cheat. Ship a Tauri shell *later* for Steam/itch.io
wrapping the same build — zero core changes.

**The split — "Rust decides what's true; TS decides how it looks and feels."**

- **Rust (one WASM module, source of truth):** seeded counter-based RNG (`ChaCha8Rng`/`Pcg64`, pull is a
  pure function of `(seed, banner, pull_index)`); all gacha/pity logic; the idle economy tick **and**
  closed-form offline catch-up; every balance formula; save (de)serialization + schema migration + HMAC;
  and shape *descriptor* resolution (family enum + params + rarity) — **not** vertex buffers. API over
  `wasm-bindgen`: `init`, `pull`, `buy_upgrade`, `tick`, `compute_offline`, `serialize`.
- **TS (look & feel):** react-three-fiber rendering, geometry generation from descriptors, the pull
  cinematic, audio, HUD (Zustand mirrors the WASM state — *never* recomputes a balance number), IndexedDB
  persistence. *If TS computes a balance number, that's a bug.*

**Offline catch-up (the key requirement — never loop millions of ticks):** rate is piecewise-constant
between user actions, so an offline span is `rate · elapsed` — O(1), instant after weeks. Time-varying
mechanics get **closed-form** solutions (saturating: `min(C, a₀+r·t)`; exponential approach:
`C−(C−a₀)·e^(−kt)`; compounding: geometric-series sum, invert *n* from *t*). Chaotic "Lorenz" generators
pay `rate·t` plus a *seeded deterministic* discrete event count so reopening reproduces exactly.

**Save:** `postcard`-serialized `PlayerSave` in IndexedDB (2–3 rotating slots, atomic pointer flip),
HMAC-tagged (corruption detection + casual tamper-resistance), file export/import as the cloud-free backup
& cross-device story, linear migration chain with golden-fixture tests. Because `master_seed + total_pulls`
are saved, pull history is reconstructible.

**Shape content pipeline:** a shape is **data** (a descriptor row in a RON/TOML table), not a baked mesh.
~15–20 parametric/implicit **families** in code (one `parametricSurface(fn,uSteps,vSteps)` builder covers
torus/Möbius/Klein/Boy's/heptoroid; Frenet-frame tube sweeps for knots; marching-cubes for gyroid/TPMS;
fixed Vec4 vertex tables for 4D polytopes). Adding content = adding a row, not modeling in Blender. A
build-time script enumerates param grids and renders thumbnails; a human **curates** the keepers — the real
content cost is curation + naming + balance, not geometry.

**4D rendering:** store true Vec4 vertices; rotate in the `xw/yw/zw` planes per frame (the hypnotic
"turning inside out"); project stereographically (clamp the `w≈d` pole singularity) and draw edges as
glowing glass tubes + bloom. The 120-cell (600 vtx / 1200 edges) is cheap and is the top-rarity showpiece.

**Build/deploy:** monorepo (`/core` Rust + `/web` Vite/React + `/content` tables); `wasm-pack build --release`
with `wasm-opt -O3`; static deploy to Cloudflare Pages/Netlify free tier; PWA with **versioned precache +
`skipWaiting`/`clientsClaim`** (see Risks). High-value tests are Rust golden-fixture tests for
RNG/pity/offline/migration + a headless `simulate` binary that runs 1M pulls to assert distributions.

---

## 10. Top risks & the must-resolve-before-building list

**Biggest risk:** *the economy has no stakes.* Resolved in §2 (Euler Budget scarcity) + §7 (one-page
economy spec). Everything else is downstream — do §2 and §7 **first, on paper, before any code.**

Other load-bearing decisions:

1. **Determinism leaks** — keep transcendental functions (`sin/cos`) out of the *authoritative* path
   (render-only); prefer fixed-point/rational currency math; pin the RNG crate version. Save replay &
   golden tests depend on bit-identical f64.
2. **Save-scum resistance** — increment & persist `total_pulls` **before** returning a pull result, or
   players reload to reroll. Cover with a test.
3. **Big-number representation** — decide *now*: capped-f64 vs mantissa+exp. Verify the chosen idle curves
   still admit O(1) closed-form offline (exponential-in-time growth is *not* trivial `rate·t`). A BigNumber
   mantissa complicates the closed forms — pick curves that stay closed-form, or accept bounded step-sim.
4. **Per-frame JS↔WASM cost** — tick the economy on a low cadence and *tween* displayed values in TS; never
   serialize across the boundary every animation frame.
5. **3D perf** — only the *focused* shape gets real transmission (see RENDERING_PLAN); instanced
   thumbnails, LOD, `frameloop="demand"`, per-tier vertex budgets.
6. **PWA stale cache** — *(known issue)* versioned precache + `skipWaiting`, and **verify each frontend
   change on a fresh port**, or the service worker masks fixes and can ship a save-format mismatch.
7. **Audience split** — **decided: the calm collector is primary and zero-skill; optimization is opt-in.**
   `auto-arrange` always provides a good-enough loadout so idlers never face the puzzle.
8. **Offline-cap ethics** — keep the cap *generous* (respects the no-FOMO tone). The real retention drivers
   are **collection completion + recipe discovery + family sets**, not a coercive daily check-in.
9. **Audio is load-bearing but unspecced** — the ASMR thesis (apex haptic click, held-silence-before-UR
   chord, "hear your economy") needs an asset + latency-mitigation plan *and* a visual-only fallback, since
   web-audio latency is inconsistent and mobile is silent-by-default.
10. **Math-literacy gate** — progressive disclosure with a clear first-5-minutes script: cold-load →
    guaranteed-good first pull → first sensory "oh" → an explicit reason to return tomorrow. Invariants
    appear only when the player opts into depth.

---

## 11. Recommended build order

1. **Vertical slice — prove the feel first.** A single gorgeous gem you can pull (Resistance-Pull
   press-and-hold + Tessellation-Bloom reveal ceremony), spin, and shelve. Glass/transmission material,
   bloom, per-rarity escalation. *No economy yet* — just answer "does pulling a shape feel incredible?"
2. **The Rust core + 3 shapes + the economy spec (§2/§7) wired end-to-end.** Flux ticks, pulls cost Flux,
   offline catch-up, save/load. Headless balance simulator online.
3. **Euler Budget + active loadout + auto-arrange.** The scarcity spring becomes real.
4. **Connected-Sum Forge + Discovery sting + codex cards.** The second slot-machine + edutainment.
5. **One tentpole shape mechanic** (recommend **Handle Lanes** — most legible) to prove depth attaches.
6. **Families/set bonuses + the 4D Viewport prestige (= NG+ loop 1→2) wired end-to-end.** The replay spine.
7. **Character/bond layer — Bond 0–5 + inspect-grants-affinity + ~15 hero shapes + the curated ~8–12 ship
   cutscenes.** This is the emotional retention hook; it is **not** optional polish. The Atlas narrative
   frame + the Ledger onboarding land here. (See `CHARACTERS.md` §6 production caps.)
8. **NG+1 content — the 4D-cross-section cohort + Heawood depth rule + Bond-6 tier with *new* dialogue.**
   Launch-or-fast-follow, **not deferred** — prestige as a pure earn-multiplier with recycled content
   breaks the retention thesis.
9. **Audio pass (AI-generated VO from per-character casting briefs + Eigenmode timbre signatures) + onboarding script + PWA hardening.**
10. WebGPU enhancements, more tentpole mechanics, more procedural families, NG+2–5 — additive, post-launch.
