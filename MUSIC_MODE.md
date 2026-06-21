# MUSIC_MODE.md — PARKED design (music gacha + Eigenform Loom)

> ## 🅿️ PARKED — not the current direction
> The full **parallel music gacha** (composer board, Resonance/Harmonia currencies, the **Eigenform Loom** meta)
> is **shelved for now.** Kept below intact because the thinking is valuable and we may revisit it.
>
> **Active scope instead: music is a COSMETIC-SHOP feature.** Buying a style/soundscape unlocks it in the
> generative bed's rotation — pure presentation, no new currency, no economy, no gameplay effect. This is **mostly
> already built**: `web/src/musicPrefs.ts` (owned/enabled premium styles + `unlock()`/`isOwned()` API),
> `MusicStylesSettings.tsx` (opt-in/out + "Unlock in Shop"), and the premium styles `jpop`/`jrock`/`citypop` in
> `orreryBed.ts`. The only missing piece is the **shop entry** that calls `musicPrefs.unlock(id)` on purchase and
> reads `isOwned(id)` for equip status (shop UI = your active domain). See "Active scope" note right below.
>
> ---
> **(parked design follows)** *Status:* design plan, not built. Reused `AGENTS.md` / `DESIGN.md` architecture; the
> generative audio engine it leans on already exists (`web/src/orreryBed.ts` + `orreryBedDriver.tsx`). Refined by a
> 14-agent pass (the Eigenform Loom section + Decisions/Slice/Risks at the bottom). The music pool was reframed to
> an **independent composer board** (deck-builder over the generator's vocabulary), tied to the orrery only by the
> optional Loom — superseding the §2/§5 equip-onto-shapes framing.

---

## 0. The pitch in one breath

A **second, parallel gacha pool** in the same game — economically the *equipment banner* to the shapes' *character
banner* (own banner, own currency **Resonance ♪**, own pity). You pull **music fragments** (notes, chords,
basslines, grooves, phrases, instruments, styles) and use them to stock a **composer board** — the orrery's twin
for music, a *deck-builder* for the existing generative engine. You don't place notes; the engine keeps
**improvising endless variety within your collected palette**, idling Resonance. Two **independent** boards (orrery
→ Flux ✦; composer → Resonance ♪), each a complete game. Then an **optional** third place — **the Eigenform Loom** —
lets you lay a composition beside a shape-config and, when they share a hidden integer structure, **resonate** them
into an **Eigenform**: a gem that *is* a phrase, the only collectible you can't pull.

> **Design decision (locked):** the Music pool is its **own composer board**. We are **not** equipping music onto
> shapes — the boards stay cleanly independent. The two parallel banners are character-vs-equipment *economically*
> (own currency, own pity), but the *gameplay* is two separate loadout games, not an overlay.

## 1. The core idea: collect the *vocabulary*, not the song

The variety you love comes from the **generator** (`orreryBed.ts`'s banks: `PROGRESSIONS` / `generateProgression`,
`KICKS`/`SNARES`/`BASS_MODES`/`CHORD_HITS`, `generateMotif`, `STYLES`, the driver's `LEAD_TONE`/`BASS_TONE`). A
player-authored *fixed loop* would repeat and kill that magic. So **the player never places notes** — they collect
and curate the generator's **vocabulary**, and the engine improvises forever within it. You're the **bandleader**,
not a note-by-note composer (exactly how lofi/jazz actually works).

So the gacha makes the banks **collectible**. You start with a *tiny* vocabulary (a couple of progressions, one
groove, one style) so early music is simple, and **every pull audibly widens the generator** — the gacha reward
*is* more musical variety:

| Fragment (gacha pull) | What it adds to the generator |
|---|---|
| a **chord / voicing** | an entry in `PROGRESSIONS` / `VOICINGS` / the `FUNC_NEXT` harmony table |
| a **groove** | a `KICKS`/`SNARES`/`CHORD_HITS` pattern, or a `BASS_MODE` |
| a **phrase / lick** | a motif seed for `generateMotif` |
| an **instrument / timbre** | a `LEAD_TONE` / `BASS_TONE` voice |
| a **style / mood** | a `STYLES` entry — *already built as the `musicPrefs` premium-style unlocks* |

## 2. The composer board (a deck-builder, not a piano roll)

The orrery's twin. Instead of placing notes, you **slot which fragments are active** in each lane (harmony / bass /
groove / lead / texture) and set the vibe (style, key, density) — your **generative deck**. The engine then
generates endless variation within it; you hover to audition and *hear it vary*. Cozy, no notation, no theory; the
auto-arrange default makes anything sound nice. Reuses the orrery's interaction grammar (drag to slot, hover to
audition). **`musicPrefs` (style collect + opt-in/out) is already a working slice of this.**

## 3. Two pools, two currencies — independent

- **Flux ✦** (existing): shapes deployed in the orrery → idle Flux → pulls the **Shape** banner.
- **Resonance ♪** (new): the composer deck's **palette quality** → idle Resonance → pulls the **Music** banner
  (closed-form offline, constant-rate, O(1) — same discipline as Flux).
- **Each board is a complete game on its own** — no equip-overlay, no required interlock (the refinement banned the
  "flywheel"). The only cross-coupling is a *soft, one-directional ease* at the Loom (deployed-shape genus widens
  the composer's tension-budget cap — see the meta layer). Shape progress *eases* music; music is never required.
- **Pity/odds/50-50** reuse the **exact** Rust gacha engine; only the **item table + currency** differ — a second
  banner, not a second engine.

## 4. The collectibles (the vocabulary table)

Cute nickname first, full musical name on inspect (the shape naming rule). Rarity ladder mirrors shapes; each
fragment carries **declared musical properties** (a chord's quality, a scale's pitch-classes, a pattern's onsets)
— the descriptor analogue the depth layer reads and the tests pin (§7).

| Rarity | Fragments (equippable) |
|---|---|
| **Common** | single **notes** / scale degrees, one-bar **rhythms**, texture/vinyl |
| **Rare** | **triads & 7ths**, **basslines**, **drum patterns**, **comping rhythms** |
| **Epic** | **phrases/licks**, **progressions**, **extended voicings** (9/11/13), **arps** |
| **SSR** | **instruments/timbres** (Rhodes, DX, nylon…), signature **grooves** |
| **UR** | **styles/moods** (cool jazz, city-pop…), **modulation tools** (new keys), **modes/scales** |
| **Relic+** | artist-pastiche kits, exotic scales, math-curio tunings |

Like weapons, fragments have a **rarity stat** (bigger boost) *and* a **fit** that depends on context (below) —
so a humble in-key triad on the right shape can beat a flashy out-of-key SSR, which keeps collection meaningful
rather than strictly power-creeping.

## 5. Depth — "fit" is music theory (folds into the orrery's existing synergy)

The orrery already scores **synergy/overlap** between deployed shapes. The Music pool adds a harmonic/rhythmic
fit score on top — the optimization layer, **opt-in, OFF by default, never gates the cozy loop** (auto-arrange
makes anything sound nice). It mirrors the shape wing's topology depth:

1. **In-key fit / Tension budget** *(the Euler-budget analogue):* in-key fragments fit free; chromatic/dissonant
   ones add **tension** that drags Resonance **unless resolved** by a following fragment (V→I cadence = the big
   multiplier). Teaches tension→release by feel.
2. **Voice-leading chains** *(the overlap-bonus analogue):* equipped chords on adjacent orrery cells that move
   smoothly (shared tones) chain into combos; clunky leaps break them.
3. **Rhythmic interlock** *(groove bonus):* bass/drum/melody fragments whose patterns complement (call-&-
   response, locked syncopation) earn a groove multiplier.
4. **Key & modulation:** the composition sits in a key/mode; **modulation tool** fragments (UR) unlock new keys
   — core progression and NG+ fuel.

End-game: chain loops into **A/B/bridge sections** (a structure multiplier — the families/sets analogue); the
4D-prestige analogue is a **modulation/odd-meter** unlock that re-bases the harmony/rhythm math for NG+.

## 6. What's reused (almost everything — that's the point)

- **One board** (the orrery), **one idle tick**, **one save**, **one gacha engine** (just a second banner+table).
- **Audio engine** unchanged in spirit: the equipped loadout *is* an `Arrangement`; the driver plays it. The
  style/lead/bass timbre profiles, voicings, progressions, drum/bass/comp banks already built become the
  *fragments*.
- **Gacha ceremony, bonds/characters, i18n** (incl. the localized "now playing" captions), the **`musicPrefs`
  store** (owned/enabled → owned/equipped fragments), the **under-the-hood inspector**, the **now-playing pill**.

**New, and small:** the music **content table** (data, locale-keyed like shapes), **equip slots + UI** on the
orrery shape inspector, the **second banner + Resonance currency**, and the Rust **fit/quality → Resonance**
formula + tests.

## 7. Truth & verification (ported rules)

- **Prime directive:** Rust owns the Resonance rate, item rolls, fit/tension math; TS plays & tweens. TS
  computing the rate = a bug.
- **"Honor the descriptor," ported from meshes:** a played fragment **must** match its declared musical spec —
  a `ChordDef{quality:min7}` synthesizes the min7 pitch-class set; a `ScaleDef` contains exactly its declared
  pitch-classes; a pattern's onsets match. A **content test iterates every fragment in `/content`** and asserts
  the realized notes/onsets equal the spec, on **integer pitch-classes/onset grids** (exact, platform-stable) —
  the Euler-characteristic test's twin. Mechanics read the **declared** property, never re-analyze floats.
- **Determinism:** same shapes + same equipped fragments ⇒ bit-identical `Arrangement` ⇒ identical playback &
  rate. No `Math.random` in the truth path.
- **Save:** equipped-fragment ids live in the existing versioned envelope; a `migrate_vN` + golden save covers
  the schema bump. Locale-invariant (ids, not strings).
- **Curation gate:** auto-suggested voicings/licks are *candidates*; a human curates keepers into the table,
  then the property tests guard them — the shape curation gate.

## 8. Cozy ↔ optimize, edutainment, ethics

- **Casual:** pull cute musical creatures, drop them on your shapes, and the orrery sounds lovelier while
  Resonance ticks. Zero theory surfaced; auto-arrange keeps it pretty.
- **Deep:** optimize in-key fit / voice-leading / interlock / structure for max Resonance — **music theory as
  the hidden optimization**, the temporal twin of topology.
- **Edutainment (intuition-first):** teaches that *tension resolves*, *consonance settles*, *smooth voice-
  leading sounds right* — by feel + feedback, then names it as a reward ("musicians call this a **ii–V–I**",
  "that's **modal interchange**"). Never assumes notation; the fragment personalities carry the intuition.
- **Ethics:** craft over dark patterns; visible pity & odds; generous offline; bonds via interaction; **finite &
  completable**, extended by NG+ (keys/modes/meters) — and **not pay-to-win** (free game; equipment can't buy
  power over other players because there are none).

## 9. Build order (feel-first)

1. **Slice:** add 1 **music slot** to the orrery shape inspector + ~6 hand-placed fragments overriding a deployed
   shape's part, driving the *existing* engine; a stub Resonance counter ticks. Prove "dress a shape in music →
   it sounds better → it pays out" is satisfying. (Cheap — audio already works.)
2. **Rust + table:** ~15 fragments across rarities, the **fit/quality → Resonance** formula + `simulate` balance
   binary, the **second banner** wired to the music table + currency, offline catch-up + golden files.
3. **Tension budget** (first depth system) + auto-arrange + the property/verification tests.
4. **Voice-leading chains + rhythmic interlock** + the discovery/term-reveal codex cards.
5. **Instruments & styles as SSR/UR fragments** (reuse `LEAD_TONE`/`BASS_TONE`/style profiles) + **sections**.
6. **Bonds for the music cast** + cross-pool delights (a shape's bond unlocks its paired fragment; a complete
   composition crystallizes a one-off display shape).
7. **NG+:** new keys/modes/odd meters (the 4D-prestige analogue).

## 10. Open decisions (need a call before step 2)

- **Resonance source** — purely the equipped-composition quality (proposed), or also a flat per-fragment trickle?
- **Currency name/glyph** — *Resonance ♪* proposed (alts: *Cadence*, *Harmony*).
- **Slots per shape** — fixed (e.g. 2–3), or scale with rarity/genus?
- **Banner premium currency** — share the Shape banner's premium pull currency, or a parallel one?
- **Unlock gate** — Music pool open from the start, or after some Shape-Wing progress?

> **One-line summary (original draft):** Music is the **equipment banner** to the shapes' **character banner** — a
> parallel gacha whose fragments slot onto your deployed shapes. *(Superseded below: the music pool is an
> independent composer board, not an equip-overlay.)*

---
---

# REFINED META LAYER (14-agent design pass)

## The Eigenform Loom — the optional meta layer (geometry × sound, reunited)

> **Supersedes §2 and §5.** The music pool is now an **independent composer board** with its own currency and
> completion checklist, *not* an equipment overlay on deployed shapes. §1/§3/§4/§7 (character-vs-equipment
> framing, two-currency interlock, the fragment table, honor-the-descriptor) still hold. The Loom is the third,
> **optional** place that ties the two complete games together.

### 0. One breath
Geometry and sound were once one being — the **First Eigenform** — then split into **Geo** (every shape) and
**Cadence** (every fragment). The **Loom** is where you lay a composition beside a shape-config; when they share a
hidden integer structure, they **resonate** into an **Eigenform**: a gem that *is* a phrase, the only collectible
you cannot pull. Eigenforms **hum** a cosmetic meta-currency **Harmonia ✧**; the Atlas becomes a **constellation
of reunions**. Cozy-first, finite (12 reunions in Loop 1), Rust-truthed, ethically dead-ended.

### 1. The four blockers, resolved (load-bearing decisions, not vibes)

**B1 — Music architecture (supersede §2).** The composer is its **own board**, structurally a clone of the
orrery's periodic-board math, **not** a full second trace engine (`score.rs` is cut from v1 — it doubles the test
surface for zero Loom value). A composition is an **authored descriptor**: fragments equipped into 4 named slots
(`progression`, `bass`, `groove`, `lead`), each a `/content` row with declared integers. Resonance ♪ idles via a
constant-rate, rarity-weighted sum, inheriting `tick()`/`compute_offline()` O(1) for free.

**B2 — Prime directive / song signature (the architectural fault).** `Arrangement` lives only in TS and is the
*realized* output — Rust must never read it. **Fix:** Rust owns a ~80-line **song-signature reducer** over the
**declared** fragment descriptors + slot assignments Rust already holds (chord-quality tension weights, onset
bitmasks, declared voice count, declared meter). TS still *realizes* the descriptor into sound; the integer
signature Rust scores is the **sum of content-table integers**, exactly how shape signatures work. The
honor-the-descriptor twin of the Euler-characteristic mesh test (`content.rs` already does the shape side).

**B3 — NG+ gate (independence vs. coercion).** NG+ gates on **shape-core ONLY** — `recrystallize()` already calls
`core_complete()` (game.rs:1411), keyed on the shape codex. **Do not touch it.** Music-core + the constellation
are **bonus** completion, never prestige gates. The only reading consistent with "optional meta."

**B4 — No flywheel.** Two independent ~30h games. The *only* cross-coupling is a **soft, one-directional ease**:
total deployed-shape genus widens the composer's **tension-budget cap** by `+1 per 2 genus` (this IS the
genus↔polyphony correspondence — thematically honest, Rust-ownable). Shape progress *eases* music; music is never
required on the shape side. **Don't** pin `|t_music − t_flux| ≈ 0` in simulate (guarantees two additive
treadmills). Pin: shape-core ≤ ~30h; music-core *independently* ≤ ~30h; **dual-engaged ≤ ~3 days**.

### 2. The day-one music hook (the composer's "first five minutes")
The shape board bites from pull #1 via the Euler budget. The composer needs its own teeth without re-stapling to
shapes:
- **The zero-fragment auto-loop is deliberately ONE-VOICE-THIN** — a literal greyed/silent voice-lane; the bed is
  pleasant but *audibly & visibly incomplete*. Your first fragment **fills the hole** (a release, not a sidegrade).
- **A ♪ tension-budget cap** (reuse the `EulerMeter` component verbatim, ♪ glyph) forces a real fragment-#1
  choice: in-key costs 0; a chromatic/dissonant one spends toward the cap unless resolved by a cadence fragment.

### 3. The resonance math (Rust, deterministic, integer-exact)
Two 6-integer signatures. **Shape S** = `{g, chi, sym, nonori, cross, dim}` from the deployed config; **Song M** =
`{voices, tension, meter, flip, syncopation, extension}` from declared descriptors. Existing in `content.rs`:
`genus`, `surface_class().chi`, `is_nonorientable`, dimension. **Two net-new static per-family integer fields:**
`sym_order: u8` (tetra=3, cube/octa=4, dodeca/icosa=5, torus/round=0=meter-free, knots use q) and `crossings: u8`
(trefoil=3, fig-8=4, (p,q)→(p−1)·q) — both self-validated by the golden content test that iterates every `ShapeDef`.

**Six Harmonic Conditions**, each {MET=2, NEAR=1, DISSONANT=0} (cond. 4 binary):

| # | MET when | NEAR when | Teaches |
|---|---|---|---|
| 1 Polyphony (heavy) | `voices == g+1` | off by 1 | holes ↔ voices |
| 2 Tension (heavy) | `tension == tension_target(chi)` | off by 1 | χ ↔ harmonic tension |
| 3 Meter | `meter == sym` (sym=0 ⇒ meter-free = MET) | meter divides/multiplies sym | symmetry ↔ meter |
| 4 Flip | `flip == nonori` | — | orientability ↔ mode flip |
| 5 Syncopation | `|syncopation − cross| ≤ 1` | ≤ 2 | crossings ↔ syncopation |
| 6 Extension | `extension == dim−2` | off by 1 | dimension ↔ extended harmony |

**`tension_target` fixes the χ dead-zone:** derive from the **dominant deployed shape's χ**, not `clamp(2−χ)` over
the SUM (a genus-7 sum → 14, unreachable by a 4–8-chord loop → meta-orphaned). `tension_target = min(max(0,
2 − chi_dominant), 6)`. Pin a content test: *every curated shape-config has ≥1 curated composition that
crystallizes* (the twin of "every ShapeDef passes the Euler test"). No shape is meta-orphaned.

**Meter & tension are DECLARED, never re-derived:** `tension` = Σ fixed integer weights per declared chord quality
(maj/maj7=0, min7=1, dom7=2, half-dim/altered/secondary-dom=3); `meter` = the **declared meter field** on the
groove fragment — *not* "largest evenly-dividing rotation of a 16-step grid" (which can teach a falsehood). The
edutainment reveal reads the exact integer the matcher compared; a content test asserts it.

**Weights** `w = [3,3,2,2,2,1]` (cond. 6 = 1 pre-NG+ since dim is constant 3), max **24**; re-weight to
`[3,3,2,2,2,2]` (max 28) when 4D arrives at NG+1. **Crystallization gate:** `met_count ≥ 3` AND no DISSONANT among
the two heavy conditions (1, 2). **`met_count` sets rarity** (3→Resonant, 4→Harmonic, 5→Eigen, 6→Unison-the-chase);
**which conditions met sets traits** (met-1 → hums on g+1 lanes; met-4 → overdrive flip; met-5 → syncopated
Harmonia bursts; met-6 → 4D/odd-meter NG+ tier). The trait kit *is* the list of correspondences that lined up.

### 4. The peak — make the LAST input the deciding one
The frozen-snapshot Loom is an anticlimax (all agency upstream). **Refined:** the **composition is fixed & dim** on
one rail; the player **drags ONE shape in/out of the config (or rotates a lane)** on the live board and **hears the
bed climb toward lock** (reusing the orrery's drag-a-gem grammar). Each NEAR pip shows a directional **"one nudge
away"** affordance (one dark lane; the phrase audibly *wanting* one more voice). The 6th condition snaps **under
the player's own hand** — *then* the ceremony fires.

**Build the ceremony — it does NOT exist yet.** A grep of `web/src` confirms there's no resistance-pull /
tessellation-bloom component; every doc claiming "reuse it" is wrong. The slice must build (1) a **press-hold
resonate** gesture, (2) a **held silence**, (3) a **tessellation bloom** where the gem's facets seat onto the
phrase's onsets.

**The gem-that-breathes is the one genuinely cheap magic (~30 lines, verified).** `registerMusicAnalyser` exists
(audio.ts:160); the driver taps a 1024-FFT `AnalyserNode` on the music master (orreryBedDriver.tsx:330). Bind it to
the existing `RaymarchGem`/`MeshTransmissionMaterial` uniforms each r3f frame: `uPulse = rms(freq)` → emissive;
`uBands[8]` → displacement. Play the Eigenform on a **3rd solo Tone deck** (the `Deck` class already supports N
decks on one Transport). **Hard-cap 2–3 concurrent live hums** (= Loom display slots); the rest freeze to a still
gem + a pre-rendered waveform thumbnail. Keep analyser→shader in the frame loop; **never cross into WASM per
frame** (gotcha #4). **Frozen for collection, live for tuning:** crystallization commits on an explicit
**snapshot** (the config the instant it locked), preserving determinism.

### 5. The Overtone Shadow — give the Loom a LOOP, not just six ahas (the headline graft)
The matcher is a deterministic finite puzzle (~6 genuine first-snaps, then a wiki flattens it). **Graft the
Overtone Shadow** (the matcher run *backward*, near-zero code): a humming Eigenform's signature re-reads through
the six correspondences into a canonical **shadow shape** (the minimum-genus shape satisfying the song — a
deterministic, golden-tested single pre-image; some cast no valid shadow, making Recognitions rare). When a
shadow's signature equals a shape **you already own**, a **Recognition** fires: a *second* Eigenform crystallizes
free — *this shape always WAS this song*. The Atlas gains **ghost-edges that light retroactively**. Hide shadow
signatures until the Eigenform has hummed past a threshold (no day-one wiki spoiler). **Recognitions count only
toward the K=12 curated set.** *Defer:* Chord Inversions (NG+1, auto-revealed at a bond threshold), Polyphonic
Resonance (NG+2+). **Cut Detuning Drift** entirely — any hum-penalty is the banned come-back-or-decay loss-frame.

### 6. Bonds & the first reunion (don't make the warm peak a grind wall)
B3 = 700 affinity at 25/inspect = **28 inspects × 2 items** per Eigenform (game.rs:35,37). Gating *every* reunion
on that = a quota.
- **The inaugural Eigenform is gate-free** — reachable by laying a matching pair (the "First Resonance" beat). Learn
  the verb cheaply.
- **B3-on-both-parents gates only the ~12 bespoke NAMED reunions**, leaning on **passive deploy affinity**
  (`AFFINITY_PER_HR_DEPLOYED=30`) so bonds ripen while idling — never tap-farming.
- Eigenforms are **Bond-6+ "union beings"** — the apex of the *existing* ladder (`EIGEN_BASE..` id range), not a
  parallel system.

### 7. Harmonia, finiteness, the ethical dead-end (pin in simulate)
- **Harmonia ✧ NEVER converts back** into Flux/Resonance/pulls/pity. It idles only from Eigenforms, spends only on
  **cosmetic/narrative** goods (constellation skins, gem-and-phrase display variants, Duet cutscene chapters). No
  path back ⇒ nothing to grind it *for* except finite decoration — the key anti-treadmill ruling. (Strip the
  sibling docs' "+5 affinity/hr to parents" trickle and any Rosetta→spark path so "dead-end" is literally true.)
- **Rate:** `harmonia_rate_per_hr = base · Σ_eigenforms (1 + 0.15·near_count) · resonance_raw/MAX`; constant between
  actions ⇒ O(1) offline, same 24h cap as Flux. **Only the K=12 curated (+ Recognitions) hum.** Generic combos → a
  **one-time cosmetic flourish, ZERO idle** (procedural ≠ infinite) ⇒ Harmonia bounded by K ⇒ capped-f64.
- **Finiteness is COUNTED, not asserted:** before building, run an offline Rust script (the matcher is pure) over
  curated configs × compositions to compute the reachable Eigenform count + 6/6 Unisons. Curate exactly **K=12**
  for Loop 1. Pin K and `harmonia_rate × K` in `simulate`.

### 8. The unforgettable song (spend here — the peak demands it)
Lofi is *engineered to be unmemorable*; a collectible whose pitch is "it has its own song" can't be generic
wallpaper. The **12 curated Eigenforms get HAND-AUTHORED signature phrases** (4–8 hummable bars) that deliberately
**break the lofi register at crystallization** — the bloom is the one place the cozy bed blooms into something
distinct & bright. 12 short motifs, not a soundtrack.

### 9. Truth, save, and the naming collision (mandatory plumbing)
- **Gacha:** refactor `roll_rarity` to take a `stream: u64` (`BANNER=1` shapes, `MUSIC_BANNER=5` music) — it
  currently hardcodes `const BANNER: u64 = 1` (gacha.rs:11,143-145). A second `PityState`. The music banner clones
  the exact pity (C50/R30/E14/SSR5/UR1, soft@20, hard@30, Epic@10, **Cadence Spark@40** with SSR-spill). Re-run the
  1M-pull distribution tests on stream=5.
- **Naming collision:** `PityState.resonance` (gacha.rs:62) is the internal spark counter; the new currency is
  "Resonance ♪". **Rename the field → `spark_progress`** with an explicit migration step (a bare rename drops the
  value via serde default).
- **Save:** `from_json` is a stub (game.rs:1561; `SCHEMA_VERSION=2`). Two pools + Eigenforms is the schema bump
  that needs the **first real `migrate_v2_to_v3`** + a checked-in golden round-trip test. New fields additive
  (`#[serde(default)]`); bump the versioned precache + `SAVE_KEY`; verify on a fresh origin (gotcha #1). Honestly
  correct DESIGN/AGENTS to say localStorage+serde_json (the documented HMAC/postcard/rotating-slots backend does
  not exist — do not bundle building it here).

### 10. Numbers to pin
- Music banner: C50/R30/E14/SSR5/UR1, soft@20, hard@30, Epic@10, Cadence Spark@40. Pull 100 ♪ flat. Dupe shards
  C1/R3/E8/SSR20/UR60; 600 → 1 spark.
- Composer: 4 slots; ♪ tension-budget base cap ~6 (+1 per 2 deployed-shape genus); one-voice-thin zero-state.
- Resonance tuned to ~30h independent core; dual-engaged ≤ ~3 days (NOT equal-time-asserted).
- Eigenforms: K=12 (Loop 1); named gate = both-parents-B3; first reunion gate-free.
- Harmonia ~5 ✧/hr base × resonance scaling/Eigenform; 24h cap; cosmetic-only sinks; bounded by K.
- Loom: 2–3 live-hum slots; rest freeze to waveform thumbnails. Weights `[3,3,2,2,2,1]`→`[3,3,2,2,2,2]` at NG+1.

---

## Decisions resolved by the refinement

1. **Rust/TS boundary for the song signature** → Rust owns a ~80-line reducer over **declared** fragment
   descriptors (not a port of the TS arranger). TS realizes/plays; the signature is a sum of content-table
   integers. *Anything else lets TS compute truth = a prime-directive bug.*
2. **NG+ gate** → **shape-core ONLY** (`recrystallize`/`core_complete` untouched). Music + constellation are bonus.
   *Gating prestige on an "optional" pool makes it mandatory — the coercion AGENTS §6 forbids.*
3. **Frozen vs live resonance** → **live drag is the input**; crystallization commits on the explicit snapshot.
   *Fixes the anticlimax; preserves determinism.*
4. **χ↔tension target** → from the **dominant** shape's χ bucketed to 0..6, not `clamp(2−χ)` over the sum. Pin "no
   shape orphaned" content test. *Summed χ orphans high-genus chase shapes on a heavy blocking condition.*
5. **Meter** → **declared** integer (+ declared per-chord tension weights), never re-derived. *The grid heuristic
   can test a 3-feel as 16 → teaches a falsehood, violates honor-the-descriptor.*
6. **Loom's lasting loop** → graft the **Overtone Shadow** (matcher backward → retroactive Recognitions →
   ghost-edges). *Emergent treasure-hunt at near-zero cost; no added RNG.*
7. **How many Eigenforms** → exactly **12** (Loop 1), COMPUTED offline before building. Only curated hum Harmonia;
   generic combos = zero-idle flourish. *Closes the generic-farming treadmill hole; keeps it provably finite.*
8. **Bond gating** → first reunion **gate-free**; only the 12 named reunions gate on both-parents-B3 via passive
   deploy affinity. *Gating every reunion turns the warm peak into a quota.*
9. **Songs** → **hand-author** the 12 signature phrases. *Generic generative songs collapse "it has its own song."*
10. **Ceremony** → **must be built** (press-hold + held-silence + tessellation-bloom); the gem-breathes
    analyser→shader (~30 lines) is the only verified-cheap part. *The "reuse" claim is fiction.*

## Vertical slice (feel-first — build this before anything else)
One Eigenform, **born live, breathing**. Truth-cheats allowed (hardcode one shape-config + one composition + one
hand-authored 4-bar phrase). **No** music banner, Resonance economy, save migration, or Harmonia idle yet. (1) A
throwaway Loom screen: the fixed composition plays (dim) on one rail; the live orrery board on the other, the target
config one shape short. (2) Drag the missing shape on; as it nears match the bed audibly climbs and one dark pip's
lane brightens (the "one nudge away" affordance). (3) The instant the last condition locks (hardcode the integer
compare in TS for the slice, port to Rust right after): press-hold + ~1s held silence + tessellation-bloom — facets
seat onto the phrase's onsets. (4) The gem **BREATHES** (`registerMusicAnalyser` → `RaymarchGem` uniforms on a 3rd
solo deck). **If "I dragged the last shape and FELT them recognize each other, and now this gem pulses to its own
song" gives chills, the meta is worth building. If it's a shrug, stop and rethink before any Rust/economy/save.**

## Top risks
1. **The ceremony is vaporware** — no resistance-pull/tessellation-bloom exists in `web/src`; budget & build it, or
   the peak degrades to an inspect-screen confirmation.
2. **Prime-directive boundary** — if the reducer isn't in Rust and TS computes any resonance/Harmonia number, the
   meta is built on a bug. The ~80-line reducer lands before any Loom truth code.
3. **Save migration is a real stub** (game.rs:1561) — the two-pool + Eigenform bump + `spark_progress` rename forces
   the first real `migrate_v2_to_v3` + golden fixture; PWA stale-cache can ship a save-format mismatch.
4. **Wiki-flattening** — even with the Shadow the matcher is solvable; joy must come from the live-tune SNAP +
   bespoke narrative + hand-authored phrases, not from the match being hard. Keep K=12.
5. **Content cost is the real budget** — 12 phrases + 12 Geo×Cadence reunions + the fragment table + the composer
   board. Tie K to the NG+ cadence (a few per cycle, final at NG+5) so it ships incrementally.
6. **Audio perf on mobile** — each live hum = a solo deck + analyser atop deckA/deckB sharing one reverb convolver;
   >2–3 concurrent risks GC-crackle. The 2–3-slot cap + thumbnail freeze is a day-one constraint, not a perf-test
   discovery.
7. **Cognitive load** — 3 currencies + 2 pity counters + 6 pips can read as accounting. Progressive disclosure is
   mandatory (Resonance after a first orrery row; Loom/Harmonia only after both boards have real progress); every
   NEAR pip MUST show the "one nudge away" affordance or the gate reads as a slot machine.

## What the refinement changed (deltas vs the brainstorm)
- **Architecture:** cut `score.rs` (a full 2nd trace engine) — the composer is a periodic-board clone reusing
  `offline_flux`, not a structural sibling of `flux.rs`.
- **Prime directive:** Rust ports a ~80-line **signature reducer over declared descriptors**, not the TS arranger
  (the single unestimated architectural fault).
- **NG+ gate:** "both pools complete" → **shape-core only** (fixes optional-yet-mandatory coercion).
- **Flywheel:** removed (and the `|t_music−t_flux|≈0` simulate assertion that guaranteed two treadmills) → a soft
  one-directional ease (genus widens the ♪ budget cap).
- **Peak:** frozen-snapshot pip-watching → **live tuning** (drag one shape until it snaps under your hand).
- **Ceremony reality:** flagged the "reuse" as fiction; the slice must BUILD it.
- **Dead-zone fix:** `tension_target` from dominant χ, not summed χ → high-genus shapes no longer meta-orphaned.
- **Honor-the-descriptor fix:** meter & tension are **declared** integers, killing the fragile grid heuristic.
- **Overtone Shadow grafted** as the headline addition → emergent collection loop, not a peak-with-no-loop.
- **Finiteness:** K = exactly 12, only curated hum (generic = zero idle), COUNTED via an offline script.
- **Bonds:** first reunion gate-free; named gates via passive deploy affinity, not 28×2 inspect-farming.
- **Memorability:** 12 **hand-authored** signature phrases that break the lofi register at crystallization.
- **Cut/deferred:** Detuning Drift (loss-frame) cut; Station/Rosetta/Duet-as-system cut from v1; Chord Inversions →
  NG+1; Polyphonic Resonance → NG+2+; cond. 6 weighted 1 pre-NG+ (dim constant until 4D).
- **Harmonia dead-end** made literally true (stripped the sibling docs' affinity trickle + Rosetta→spark path).
- **Supersede note** written in (the brainstorm silently overrode §2/§5, leaving two contradictory architectures).
