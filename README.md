<div align="center">

# Ship Shape Shop

**A cozy gacha + idle game where the collectibles are mathematical shapes — given personalities.**

Pull for spheres, tori, Klein bottles and 120-cells. Deploy them on a hex-grid orrery to generate Flux.
Glue two surfaces into a third in the Forge (the real connected-sum operation). Bond with the shapes,
ascend through dimensions, and let a generative lofi soundtrack play your collection back to you.

Calm ASMR collector on the surface; an optimization puzzle — and a gentle topology lesson — underneath.

[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#-license)
[![CI](https://github.com/OWNER/shipshapeshop/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/shipshapeshop/actions/workflows/ci.yml)

![Pulling a shape](docs/screenshots/gacha.png)

</div>

---

## ✨ Highlights

- **Two slot machines.** Pull from the gacha, *and* craft in the Forge — gluing two shapes is the real
  surface connected-sum (χ adds, genus adds, non-orientability is contagious), so the math *is* the recipe book.
- **Shapes with souls.** Every shape has a cute nickname, a personality, voiced chatter, and a bond you raise
  by spending time with it. The real mathematical name is a reward you unlock, never jargon you're forced to parse.
- **A board that hums.** Deploy shapes on a hex orrery; their topology drives both production *and* a live
  generative lofi soundtrack — you can literally hear your economy.
- **Finite and completable.** ~1–2 days of idle play to the summit, extended by New Game+ (ascend a dimension,
  re-meet everyone from a higher vantage). No infinite treadmill, no dark patterns.
- **Gorgeous on purpose.** Real-time path-traced gems, 4D polytope projections, and a deterministic Rust core
  so every pull is fair and reproducible.

## 📸 Screenshots

| Gallery | The Orrery | The Forge |
|---|---|---|
| ![Gallery](docs/screenshots/gallery.png) | ![Orrery](docs/screenshots/orrery.png) | ![Forge](docs/screenshots/forge.png) |

> Regenerate these any time with `pnpm screenshots` (see [Screenshots rig](#-screenshots-rig)).

## 🏗️ How it's built

> **One rule:** *Rust decides what is true; TypeScript decides how it looks and feels.* Every authoritative
> number — RNG, pity, economy, offline catch-up — lives in the deterministic Rust core, compiled to WASM. The
> web layer mirrors and tweens that truth; it never derives it.

| Layer | Tech |
|---|---|
| **Simulation core** | Rust → WebAssembly (`wasm-bindgen`), 100% deterministic, unit + balance tested |
| **Frontend** | React + TypeScript, Zustand, Vite, shipped as a static PWA |
| **3D / shaders** | three.js + react-three-fiber, raymarched + path-traced gems, real 4D projection |
| **Audio** | Web Audio + Tone.js — a generative lofi bed derived from your deployed shapes |
| **i18n** | English · 日本語 · 简体中文, locale-keyed from day one |

The deep docs:

| Doc | What's in it |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | Engineering playbook — clean architecture, TDD, atomic design, gamedev practices, procedural-geometry verification, i18n. (`CLAUDE.md` is a bare import of it.) |
| [`DESIGN.md`](./DESIGN.md) | Game design & economy — the core loop, the Euler-budget scarcity spring, shape mechanics, the locked economy + New Game+. |
| [`RENDERING_PLAN.md`](./RENDERING_PLAN.md) | 3D/shader direction — gemstone materials, exotic-surface geometry, the pull ceremony, performance budgets. |
| [`CHARACTERS.md`](./CHARACTERS.md) | The character layer — the Atlas narrative frame, personality engine, AI-voice casting, bonds, the roster. |

## 🚀 Quick start

Prerequisites: [Rust](https://rustup.rs/) + the `wasm32-unknown-unknown` target +
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/), [Node 20+](https://nodejs.org/) and
[pnpm](https://pnpm.io/). The WASM core must be built **before** installing web deps (`web` depends on
`core/pkg` via a `file:` link).

```bash
pnpm setup        # build the Rust→WASM core, then install web deps
pnpm dev          # dev server at http://localhost:5173
pnpm test         # Rust tests + balance sim + web tests
pnpm build        # release WASM (wasm-opt) + static web bundle in web/dist
```

## 🧱 Project layout

```
core/       Rust simulation core (domain + use-cases + WASM API) → one .wasm module
web/        Vite + React + TypeScript app (rendering, feel, persistence)
content/    RON/TOML/JSON data: shapes, banners, character bibles, localization
docs/       screenshots + assets for this README
```

The dependency rule points inward only: `web/` depends on `core/`'s public WASM API; `core/` knows nothing
about React. See [`AGENTS.md`](./AGENTS.md) §2 for the full concentric architecture.

## 📷 Screenshots rig

A headless [Playwright](https://playwright.dev/) script builds the app, serves it, walks the key screens,
and writes PNGs to `docs/screenshots/`:

```bash
pnpm screenshots
```

## 🧪 Testing

The truth layer is tested hard, the feel layer lightly:

- **Rust** — RNG/pity distributions over ≥1M pulls, closed-form offline catch-up golden files, save-migration
  round-trips, save-scum ordering, and **content topology** (a generated mesh's χ/genus must match each
  shape's declared invariant). A `simulate` binary pins completion time to a sane band.
- **Web** — `vitest` for the store/components (asserting the store *mirrors* WASM, never recomputes) and the
  geometry generators.

## 🤝 Contributing

Issues and PRs welcome. Please read [`AGENTS.md`](./AGENTS.md) first — it's the single source of truth for
architecture, testing discipline, and conventions (Conventional Commits, `clippy`/lint clean, truth-layer
tests required for any balance change).

## 📜 License

Dual-licensed under either of:

- **MIT** — see [`LICENSE-MIT`](./LICENSE-MIT)
- **Apache License 2.0** — see [`LICENSE-APACHE`](./LICENSE-APACHE)

at your option. Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion
shall be dual-licensed as above, without any additional terms or conditions.

## 🙏 Acknowledgements

The optional "Reference Wing" celebrates famous computer-graphics models (the Utah Teapot, Stanford Bunny,
Spot the cow, …). Shapes are mathematical objects and topology is public-domain mathematics; check each
bundled model's individual licence before any commercial use.
