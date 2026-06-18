# AGENTS.md — Engineering & Design Guide

Single source of truth for how we build **Shape Gacha**. Tool-agnostic (Claude Code, Cursor, Copilot,
etc. all read this). `CLAUDE.md` is a bare import of this file.

> **Read first:** [`DESIGN.md`](./DESIGN.md) (game design + economy) and [`RENDERING_PLAN.md`](./RENDERING_PLAN.md)
> (3D/shader tech). This file is *how we build it*; those are *what we're building*.

---

## 0. The product in one breath

A free, single-player **gacha + idle** game where collectibles are **mathematical shapes** given
personalities. Calm ASMR collector on the surface, optional optimization underneath.
Tech: **React/TS frontend + Rust→WASM simulation core**, shipped as a static PWA. **Finite core,
completable in ~1–2 days of idle play, extended by New Game Plus.** The core is the addictive gacha+idle
loop; teaching real geometry/topology is a **side effect** (opt-in, OFF by default, never gates fun), not
the goal. Addiction comes from **design, never dark patterns** (see §6 Ethics).

---

## 1. The prime directive

> **Rust decides what is *true*. TypeScript decides how it *looks and feels*.**

Every authoritative number — RNG, pity, economy, offline catch-up, balance, save state — lives in the Rust
core. If TypeScript ever computes a balance number, **that is a bug.** TS *mirrors* and *tweens* the truth;
it never derives it. This single rule resolves most architecture questions before you ask them.

---

## 2. Concentric (clean / onion) architecture

Dependencies point **inward only**. An inner ring must never import, name, or know about an outer one.

```
        ┌───────────────────────────────────────────────┐
        │  Frameworks & Drivers (outermost)              │   React, three.js/r3f, IndexedDB,
        │  ┌─────────────────────────────────────────┐   │   Web Audio, the browser, Vite
        │  │  Interface Adapters                     │   │   wasm-bindgen API, serde/postcard DTOs,
        │  │  ┌───────────────────────────────────┐  │   │   Zustand store, save (de)serialization
        │  │  │  Application / Use Cases          │  │   │   pull(), buy_upgrade(), tick(),
        │  │  │  ┌─────────────────────────────┐  │  │   │   compute_offline(), prestige()
        │  │  │  │  Domain (innermost)         │  │  │   │   shapes, rarity, invariants, the
        │  │  │  │  pure rules + entities      │  │  │   │   economy math, pity, RNG laws
        │  │  │  └─────────────────────────────┘  │  │   │
        │  │  └───────────────────────────────────┘  │   │
        │  └─────────────────────────────────────────┘   │
        └───────────────────────────────────────────────┘
```

- **Domain** (Rust, pure): shape descriptors, rarity, the Euler-budget rule, production formulas, pity
  laws. No I/O, no time, no randomness-source — takes seeds/inputs, returns values. 100% unit-testable.
- **Use cases** (Rust): orchestrate domain operations — `pull`, `buy_upgrade`, `tick`, `compute_offline`,
  `prestige`. Deterministic given (state, inputs).
- **Interface adapters**: the `wasm-bindgen` command/event API, DTO (de)serialization, save envelope.
- **Frameworks & drivers** (TS): React, r3f, IndexedDB, audio, routing. Replaceable without touching the
  core (a Tauri shell later reuses the inner rings untouched).

**Repo layout** mirrors the rings:

```
/core      Rust sim core (domain + use cases + adapters) → one WASM module
/web       Vite + React + TS (frameworks/drivers; rendering, feel, persistence wiring)
/content   RON/TOML data: shapes, banners, character bibles, lore (NOT code)
```

**The dependency rule in practice:** `/web` depends on `/core`'s public WASM API; `/core` knows nothing
about React. Content is *data* the inner rings consume, never logic.

---

## 3. Test-Driven Development

Red → Green → Refactor. Write the failing test first; make it pass minimally; then clean up. **Test the
truth layer hard, the feel layer lightly** — effort follows risk.

**Rust core (highest-value tests — these are non-negotiable):**

- **RNG/pity distributions** — a headless `simulate` binary runs ≥1M pulls and asserts the empirical SSR
  rate, soft/hard-pity hit curve, and 50/50 behavior match spec within tolerance.
- **Offline catch-up golden files** — fixed (save, now_ms) → fixed `OfflineReport`. Spans of seconds and
  of weeks must both be O(1) and bit-stable. Checked-in golden fixtures.
- **Save migration** — every `migrate_vN_to_vN+1` has a checked-in golden save and a round-trip test.
- **Save-scum ordering** — a test proves `total_pulls` is incremented & persisted *before* a pull result
  is returned (reload-to-reroll must be impossible). See §7.
- **Determinism** — same inputs ⇒ bit-identical outputs across runs/platforms (see §5 determinism rules).

**TypeScript / web (lighter):**

- `vitest` + React Testing Library for components and the Zustand store wiring (assert the store *mirrors*
  WASM, never recomputes).
- `Playwright` smoke test for the pull cinematic and core navigation.
- Snapshot/visual tests are allowed for stable UI, but never gate balance correctness on them.

**Rule:** a balance/economy change is not done until a Rust test pins the new behavior. Tune numbers via
the `simulate` binary, not by playing.

### Procedural geometry verification

Shapes are generated parametrically from a **descriptor** (`family` enum + params + *declared* invariants +
rarity). The verification discipline has one rule that is unique to this game and one set that is standard
mesh hygiene.

**THE LOAD-BEARING RULE: the mesh must honor the descriptor's declared topology.** Because the *mechanics
are the invariants* (genus = production lanes, χ = Euler budget, orientability = the overdrive flip), a
generated mesh whose real topology disagrees with its declared descriptor means **the game lies to the
player and the economy mis-prices the shape.** So the mechanics read the *declared* invariant (authoritative,
in the content table — never recomputed from floats at runtime), and a **content test** proves the generated
geometry actually matches it:

- Compute the **Euler characteristic** `V − E + F` on the generated mesh and assert it equals the declared
  χ. Do this on **integer combinatorics** (vertex/edge/face counts of the indexed mesh), *not* floats — so
  it is exact and platform-independent. This single check catches most generator bugs.
- Assert **genus**, **orientability** (consistent face winding ⇒ orientable; a Möbius/Klein *must* fail this
  the same way every time), **component count**, and **boundary-edge count** match the descriptor.
- This is a Rust golden test that iterates **every `ShapeDef` in `/content`** — the content table is
  self-validating, and a bad param set is caught in CI before it ships.

**Standard mesh validity (the "is it a well-formed mesh" set):**

- **Manifoldness** — every edge shared by exactly two faces where a closed surface is intended; flag
  non-manifold edges/vertices.
- **Watertight where the shader needs it.** drei transmission needs a *closed* manifold (see RENDERING_PLAN:
  Klein bottles/gyroids self-intersect or are volumeless and break naive transmission). The visual
  immersion may self-intersect, but the **transmission variant must be a solidified closed shell** — verify
  closedness on that variant specifically.
- No **degenerate triangles** (≈zero area), no unwelded duplicate vertices beyond tolerance, **consistent
  winding**, outward normals on closed shapes, valid in-range UVs, **finite coordinates** (no NaN/Inf), and
  the mesh fits the canonical bounding sphere (centered + unit-scaled so the gallery is consistent).

**Determinism & caching** — same descriptor ⇒ bit-identical mesh, memoized by descriptor hash. Geometry is
render-only, so float drift in the *mesh* is cosmetically fine; the *invariant* check above is integer, so
it stays exact regardless.

**Performance budgets** — triangle/vertex counts within per-rarity caps; marching-cubes grid resolution
bounded; **LOD variants must preserve topology** (a low-LOD that drops a hole visibly "pops" and would also
contradict the declared genus) — assert χ is invariant across LODs.

**4D-specific** — validate edge/vertex incidence against known counts (tesseract 16 v / 32 e; 120-cell
600 v / 1200 e); clamp the stereographic-projection pole singularity so the hero 120-cell reads as
beautiful, not spiky; the 4D rotation must stay rigid (no degenerate projection frame).

**The curation gate ("procedural ≠ infinite").** Family param-grids (superformula, torus-knot `(p,q)`,
TPMS) generate mostly-ugly candidates; a build-time script renders thumbnails headlessly and a **human
curates the keepers** into the content table. Aesthetic QC is itself a verification step — and once curated,
the frozen param set becomes a named `ShapeDef` that the automated topology/validity/budget tests then guard
forever. Add a **visual-regression** golden (perceptual hash / SSIM on a headless render per `ShapeDef`) to
catch generator regressions that pass the numeric checks but look wrong.

---

## 4. Frontend: Atomic Design

Compose UI bottom-up (Brad Frost). Keep components dumb; state lives in the Zustand store mirroring WASM.

| Level | Examples in this game |
|---|---|
| **Atoms** | `Numeral` (animated counter), `Icon`, `Button`, `RarityGlyph`, `BondPip` |
| **Molecules** | `PullButton` (resistance press-and-hold), `ShapeThumbnail`, `BondMeter`, `CurrencyBadge` |
| **Organisms** | `GachaPanel`, `CollectionGrid`, `ShapeInspector`, `LoadoutBoard`, `DialogBox`, `OfflineReportModal` |
| **Templates** | screen layouts (Gallery, Gacha, Engine, Codex, Bonds) with slots, no data |
| **Pages** | the wired screens pulling from the store + router |

- **r3f scene graph** follows the same spirit: small declarative components (`<Gem>`, `<PullStage>`,
  `<Polytope4D>`); geometry is generated from a shape **descriptor**, never hand-placed.
- **Display values tween toward WASM truth** (Framer Motion / lerp); they are never the source.
- Co-locate component + test + styles. One organism per folder.

---

## 5. Game-dev best practices

- **Determinism is sacred.** Seeded counter-based RNG (pull N is a pure function of `(seed, banner, N)`).
  Fixed-timestep sim. **No wall-clock or `Math.random` in the authoritative path.** Keep transcendental
  funcs (`sin/cos`) out of the *economy* math (render-only) and prefer integer/fixed-point currency where
  exactness matters — f64 drift breaks golden tests and save replay. Pin the RNG crate version.
- **Sim ↔ render separation.** Tick the economy on a low cadence; **never call into WASM every animation
  frame** for display — serialize sparingly, tween in TS, or the boundary tanks 60fps.
- **Closed-form offline, never loop-sim.** Offline spans solve analytically (constant-rate, saturating,
  exponential-approach, geometric-series). Prove any new idle curve still admits O(1) catch-up *before*
  committing to it. Decide **big-number representation** (capped-f64 vs mantissa+exp) early — it constrains
  the closed forms.
- **Content is data, not code.** A shape is a descriptor row in `/content` (family enum + params + rarity +
  lore), resolved to geometry by a pure generator. Adding content ≠ writing code.
- **Save safety.** Versioned envelope, HMAC tag (corruption detection + casual tamper-resist), rotating
  IndexedDB slots with atomic pointer flip, file export/import as the backup. Migrate-once-on-load.
- **Perf budgets.** Only the *focused* shape gets real transmission; `frameloop="demand"`; instanced
  thumbnails; LOD; per-rarity vertex caps (see RENDERING_PLAN §7).
- **Feel/juice lives in the feel layer.** The pull ceremony, bloom, haptics, audio — all presentation;
  none of it touches truth.

---

## 6. IA / UX / cognitive science / psychology

**Information architecture.** Shallow, signposted hierarchy — five top-level destinations: **Gallery**
(collection), **Gacha** (pull), **Engine** (loadout/optimization), **Codex** (lore/math cards), **Bonds**
(characters). Recognition over recall; the player is never lost.

**Cognitive load (manage it deliberately).**
- **Progressive disclosure** is the core trick: the casual sensory loop is fully playable with *zero* math
  surfaced; depth (Euler-budget loadout, connected-sum crafting, invariants) reveals only when opted into.
- Chunk information (Miller 7±2); one primary action per screen; sane defaults (`auto-arrange`).
- **Edutainment, intuition-first.** Target comprehension of a bright high-schooler / anyone with some math;
  a reader with a bit of math background should find it fully clear and a little delightful. Never assume
  topology background. Teach by intuition and visuals first, *then* reveal the real term as a reward
  ("…mathematicians call this a *Klein bottle*"). Jargon is **introduced, not banned** — and always
  optional, never gating the casual sensory loop. Use the clearest metaphor available (everyday/physical/
  visual, sometimes programming); the *character personalities* carry the intuition.
- **Names: cute nickname first, full name on inspect.** Everywhere in the UI — shelf, gacha, dialog, bond
  screen, notifications, idle chatter — a shape is referred to by its **cute nickname** (e.g. *Dot* the
  sphere, *Linky* the trefoil knot, *Kleine* the Klein bottle). The full mathematical name surfaces **only
  in the detailed character sheet / inspector**, alongside the term-reveal and codex card. This lowers
  cognitive load, keeps the cozy tone, and turns the real name into a discovery reward instead of a label
  the player is forced to parse. (Data is already there: each shape carries `nickname` + full `shapeName` +
  `theTermReveal`.)

**UX laws we honor.** Hick's (limit visible choices) · Fitts's (big, central pull target) · Jakob's
(familiar gacha/idle conventions) · Doherty threshold (<400ms feedback on every input) ·
aesthetic-usability effect (the jewels *are* the UI).

**Engagement psychology — used honestly.**
- **Peak-end rule:** the pull ceremony is the engineered peak; the "while you were away" report is a gentle
  positive end to each session.
- **Zeigarnik effect / endowed progress:** an incomplete collection and visible family-set progress create
  pull, but goals are *finite and completable* (no infinite treadmill).
- **Variable-ratio reinforcement** done transparently — **pity is visible**, odds are stated. Surprise, not
  deception.
- **Self-Determination Theory:** autonomy (calm or optimize — your choice), competence (mastery via the
  optional depth + bonds), **relatedness** (the character/bond/shipping layer is the SDT relatedness hook).
- **Flow:** clear goals + immediate feedback + difficulty that scales with opt-in depth.

**Ethics — a hard requirement, not a nicety.**
- Addiction must come from **craft, not dark patterns.** Explicitly banned: FOMO countdown timers, daily
  login guilt, loss-framing, manipulative streak pressure, anything pay-to-win (it's free anyway).
- The offline cap is **generous** (respects absence; real retention comes from completion + discovery +
  bonds, not coercion).
- Bonds level via **interaction, not time-gating**, so engagement is rewarded without punishing absence.
- When a feature could become manipulative, choose the version that respects the player — it retains better
  long-term and it's the right call.

---

## 7. Known gotchas (bite-marks already mapped)

1. **PWA stale cache** *(recurring)* — the service worker can serve an old build and mask fixes (even ship
   a save-format mismatch). Use versioned precache + `skipWaiting`/`clientsClaim`, and **verify every
   frontend change on a fresh port / with cache-busting.**
2. **Save-scum** — increment & persist `total_pulls` **before** returning a pull result, or players reload
   to reroll and the gacha loses all tension. Covered by a mandatory test.
3. **Big-number ceiling** — idle progression hits f64 limits on long prestige loops. Decide capped-f64 vs
   mantissa+exp early; verify it against the closed-form offline math.
4. **JS↔WASM per-frame cost** — never serialize state across the boundary every frame; low-cadence tick +
   TS tween.
5. **4D projection** — stereographic projection has a pole singularity; clamp/cull near it so the hero
   120-cell reads as beautiful, not spiky.

---

## 8. Conventions & workflow

- **Rust:** `rustfmt` + `clippy` clean (warnings are errors in CI). Small pure functions in the domain.
  `cargo test` + the `simulate` balance binary.
- **TS:** strict TypeScript, ESLint + Prettier (or Biome). No `any` in core data types. Functional
  components + hooks.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`). Commit/push only when
  asked; branch off `main` first.
- **CI:** build WASM (`wasm-pack build --release`, `wasm-opt -O3`), run `cargo test` + `vitest`, build web,
  deploy static (Cloudflare Pages/Netlify free tier).
- **Definition of done:** behavior is tested (truth layer pinned in Rust), `clippy`/lint clean, the change
  is verified in the running app on a fresh origin, and player-facing text follows the edutainment rule
  (intuition-first; terms introduced as rewards, never assumed; depth always optional).

---

## 9. Build order (from DESIGN.md §11)

Feel-first. **1)** Vertical slice — one gorgeous gem, the resistance-pull + tessellation-bloom reveal,
*no economy yet* (prove the feel). **2)** Rust core + 3 shapes + the economy spec wired end-to-end +
`simulate`. **3)** Euler-budget loadout + auto-arrange. **4)** Connected-sum forge + discovery sting +
codex. **5)** One tentpole shape mechanic (Handle Lanes). **6)** Families/sets + 4D viewport prestige
(= NG+ loop 1→2). **7)** Character/bond layer (Bond 0–5, inspect-grants-affinity, ~15 hero shapes, ~8–12
ship cutscenes) + the Atlas narrative frame — the retention hook, **not optional polish**. **8)** NG+1
content (4D-cross-section cohort + Heawood rule + Bond-6 with *new* dialogue) — **launch-or-fast-follow,
not deferred**. **9)** Audio (AI-generated VO cast from each character's `voiceDirection` brief + the Eigenmode timbre
signature; captioned fallback) + onboarding + PWA hardening. **10+)** WebGPU,
more mechanics, procedural families, NG+2–5. *(See `CHARACTERS.md` §6 for production caps.)*

---

## 10. Internationalization (i18n) — localizable by construction

i18n is nearly free if designed in from day one and painful to retrofit, so **bake it in from the first
commit**. The bar: *adding a language = adding a resource bundle, never touching code.*

**Locale tiers (build the plumbing for all three now; tiers differ only in how much bespoke
transcreation/VO each gets):**
- **T1 — English + Japanese, co-primary, authored in parallel, dual-audio VO.** Given the anime/LN DNA,
  Japanese is not a port of English but arguably the *native* register (the tropes are literally Japanese).
- **T1.5 — Chinese (Simplified `zh-Hans` first, Traditional `zh-Hant` derived).** A huge market, planned
  upfront: full localized **text at launch-or-fast-follow**, **Mandarin VO as a fast-follow** (AI-generated,
  same casting framework).
- **T2 — everything else** via the add-a-bundle path.

JA and ZH specifics are in the CJK subsection below.

- **No hardcoded player-facing strings, ever.** All UI copy lives in locale resource files keyed by ID
  (`en.json`, `ja.json`, …), resolved at runtime (react-i18next / FormatJS / Lingui). An **ESLint rule fails
  the build on literal JSX text.** (This is just the prime directive again — strings are *presentation*, so
  they live in the TS/feel layer, never in the Rust core.)
- **Content is already data → make it locale-keyed data.** The `/content` tables (character bibles, codex
  cards, lore, banners) key every human-facing field to a message ID resolved per locale. **Shape
  descriptors (math params) are locale-invariant**; only `nickname`, full name, dialog, and codex text
  localize. So the content pipeline and the i18n pipeline are the same pipeline.
- **ICU MessageFormat for plurals / gender / select** — never string-concatenate. The game is full of
  count-driven copy (`"{count, plural, one {# shape} other {# shapes}}"`, pull results, lane states).
- **Locale-aware number formatting is load-bearing here.** Idle games emit *huge* numbers, and the
  big-number representation (capped-f64 vs mantissa+exp, §7) must format **per-locale**: grouping/decimal
  separators differ, and CJK locales often prefer **myriad grouping (万/億)** over thousands. Rust emits raw
  values; **TS formats** via `Intl.NumberFormat` + a pluggable abbreviation scheme (1.23M / 1.23e6 / 万) —
  keep it in the feel layer, locale-switchable.
- **RTL** — author with CSS logical properties (`margin-inline`, `dir`), mirror the *layout* for Arabic/
  Hebrew, but **never mirror the 3D gems or directional shape animations** (a mirrored Möbius is a *different
  shape* — the math must not flip).
- **Fonts & text expansion** — budget for CJK glyph coverage and ~+30–40% expansion (German/Finnish); size
  containers to the longest locale, never to English. Cute nicknames may need per-locale variants.
- **Locale-invariant save** — saves store message IDs + shape IDs, **never localized strings**, so a save is
  fully portable across languages (switch language → same save). Migration is unaffected.

### The transcreation tension (important — the stylized voices)

The character voices are **heavily stylized**: palindromes (high-symmetry), mirror-inverted text
(non-orientable), self-interrupting nested clauses (knots), seeded non-sequiturs (chaos), per-character
**authorial pastiche**, and pun-based term-reveals. **These do not literally translate.** So split the
content into two tracks:

- **Trivial track** (the bulk): plain UI, menus, economy/HUD strings, system messages → standard translation
  / MT-friendly. This is where "trivially i18n-able" fully holds.
- **Transcreation track** (curated): all stylized character/codex/lore text → **creative re-authoring per
  locale by a skilled human**, shipped with **translator notes describing the *effect* to reproduce** ("this
  line must read as a palindrome in the target language"; "render the back half mirror-inverted"; "in the
  style of the target language's nearest equivalent to <author>") — *not* machine-translatable.
- **Voice localizes with the text.** Because VO is **AI-generated**, each locale re-casts the character's
  spoken voice from its `voiceDirection` brief (accent/register/delivery adapted to the target language) —
  cheap to produce, which is a real i18n win, but it *is* part of the transcreation track, not an
  afterthought. Keep the brief language-neutral in intent (vocal age, warmth, pace, archetype) so it ports.

So **i18n-*ability* is structural and free** (everything externalized + keyed + locale-invariant saves);
full **localization *quality* of the stylized voices is a per-locale content investment**, gated like the
shape curation gate and bounded by the production caps (15 deep heroes carry most of it; commons/rares are
light). Tag each string `plain | transcreate` in the content schema so the two tracks are explicit from day
one.

### CJK & the language-character toolkits (JA Tier-1, ZH Tier-1.5)

Each language characterizes through *different machinery*, so the per-character voice is **authored
natively per language**, never translated. Build the schema to hold a `localeVoice` block (`ja`, `zh-Hans`,
`zh-Hant`, …) per character from day one.

**Japanese (T1) — richer toolkit than English.**
- **Dual-audio VO:** every character voiced in EN *and* JA (AI); player picks **VO language independently of
  text** (the gacha-standard "JP audio / EN text"). Dual-mirror & kin **voice locks hold within each language**.
- **Pronouns** (私／わたくし／僕／俺／うち／我…) and **sentence-final particles / tics** (わ／ぜ／のだ／なのじゃ／っす…)
  carry trope + personality the way English *diction* does — primary per-character casting choices. **Keigo**
  encodes senpai/kouhai & ojou natively, so JA uses the tropes *directly*.
- **Speech-patterns re-create via JA-native devices:** high-symmetry palindrome → **回文 (kaibun)**;
  non-orientable flip → a 内/外 or clause reversal at the pivot. **Authorial styles** map to JA registers
  (Ico's Sei Shōnagon and the chuunibyou are already JA-native).
- **Furigana/ruby is a feature:** gloss kanji *and* deliver the edutainment **term-reveals** (クラインの壺 +
  ruby — "intuition first, term as reward"). Apply **kinsoku** line-breaking.

**Chinese (T1.5) — a different toolkit again.**
- **Simplified (`zh-Hans`, the mainland market) first; Traditional (`zh-Hant`) as a derived bundle** — two
  bundles, *not* a blind auto-convert (vocabulary & idiom differ).
- **Less pronoun/particle characterization than JA** (mostly 我; particles 啊/吧/呢/啦/嘛 are light), so ZH
  voice leans on **diction, register, and 成语 (four-character idioms)** — chengyu are a gift for the
  symmetry-diplomats & elders (compact, balanced, classical); **文言/classical** register for the
  devotional/upperclassman voices vs **vernacular warmth** for homebodies. **Authorial styles** map to ZH
  registers (e.g. 鲁迅-spare, 老舍-vernacular-warm, wuxia cadence for the rivals).
- **Speech-patterns:** Chinese has **回文** palindromes too (high-symmetry); chengyu balance for diplomats;
  mirror-flip / self-choir / nesting re-created natively.
- **Numbers:** zh-Hans myriad grouping is **万/亿** (vs JA 万/億) — the big-number formatter keys the myriad
  glyphs per locale.
- **Mandarin VO (fast-follow):** same casting framework; dual-mirror/kin locks must hold in ZH too. **Tone**
  is a real factor — flag any voice whose effect (e.g. Mo's mirror-flip) interacts with lexical tone.
- Fonts: ship Simplified **and** Traditional glyph coverage; CJK line-breaking (break between characters,
  with punctuation rules).
