<div align="center">

# Ship Shape Shop

**Mathematical shapes, collected like creatures. Each has a nickname and a personality, and most have opinions about where you put them.**

Pull them from the gacha. Set them on a hex board, where a shape's topology decides what it produces and what it sounds like. In the Forge you glue two shapes into a third, which happens to be the actual connected-sum operation, so the maths doubles as the recipe book. Send a party into the Manifold and they fight their way through it while you're gone.

It's a calm thing to look at. There's an optimization puzzle underneath if you go looking, and you'll pick up some real topology without being asked to. It finishes in a day or two of playing, and it doesn't mind you putting it down.

### [▶ Play in your browser](https://gyng.github.io/shipshapeshop/)

Free, runs entirely in the browser, no accounts. Just here for the shapes? [The viewer](https://gyng.github.io/shipshapeshop/?viewer) browses every one of them.

[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)
[![CI](https://github.com/gyng/shipshapeshop/actions/workflows/ci.yml/badge.svg)](https://github.com/gyng/shipshapeshop/actions/workflows/ci.yml)

![Pulling a shape](docs/screenshots/gacha.png)

</div>

---

## What's in it

- **A gacha and a crafting bench.** Pull shapes, or make new ones in the Forge by gluing two together. The glue is the real connected-sum: Euler characteristics add, genus adds, and non-orientability is catching. So the recipe book is just topology.
- **The shapes talk.** Each has a voice built from its own geometry, and a bond that climbs when you spend time with it. You learn the real mathematical name as a reward, not as homework.
- **The board makes music.** Whatever you've deployed drives the production numbers and a generative lofi soundtrack at once, so you can hear the economy tick over.
- **Expeditions.** Send teams to delve the Manifold: idle auto-combat with a gambit editor, where a good set of rules beats a stronger team that's playing dumb. Optional, and walled off from the calm game.
- **It ends.** A day or two to finish, then New Game+ if you feel like climbing a dimension and meeting everyone again from higher up. No login streaks, no FOMO timers, none of that.

## A look around

| The Orrery | Expeditions | The Forge |
|---|---|---|
| ![Orrery](docs/screenshots/orrery.png) | ![Expeditions](docs/screenshots/expeditions.png) | ![Forge](docs/screenshots/forge.png) |
| **Gallery** | **The Gacha** | **The Ledger** |
| ![Gallery](docs/screenshots/gallery.png) | ![Gacha](docs/screenshots/gacha.png) | ![Ledger](docs/screenshots/ledger.png) |

## How it's built

The whole thing is organized around one rule: Rust decides what's true, TypeScript decides how it looks. Every number that matters — the RNG, pity, the economy, offline catch-up — lives in a deterministic Rust core compiled to WASM. The web layer just mirrors and animates it; if TypeScript ever computes a balance number, that's a bug.

| Layer | Tech |
|---|---|
| Simulation core | Rust → WebAssembly, deterministic, unit + balance tested |
| Frontend | React + TypeScript, Zustand, Vite, shipped as a static PWA |
| 3D / shaders | three.js + react-three-fiber, raymarched and path-traced gems, real 4D projection |
| Audio | Web Audio + Tone.js, a generative lofi bed read off your board |
| i18n | English, 日本語, 简体中文, keyed from the first commit |

More in [`AGENTS.md`](./AGENTS.md) (engineering), [`DESIGN.md`](./DESIGN.md) (game and economy), [`RENDERING_PLAN.md`](./RENDERING_PLAN.md) (shaders), and [`CHARACTERS.md`](./CHARACTERS.md) (the cast and the Atlas frame).

## Quick start

You'll need [Rust](https://rustup.rs/) with the `wasm32-unknown-unknown` target and [`wasm-pack`](https://rustwasm.github.io/wasm-pack/), plus [Node 20+](https://nodejs.org/) and [pnpm](https://pnpm.io/). Build the WASM core before the web deps, since `web` links against `core/pkg`.

```bash
pnpm setup    # build the Rust→WASM core, then install web deps
pnpm dev      # http://localhost:5173
pnpm test     # Rust tests + balance sim + web tests
pnpm build    # release WASM + static bundle in web/dist
```

The repo is `core/` (the Rust sim, one `.wasm`), `web/` (the React/TS app), `content/` (data: shapes, banners, lore), and `docs/` (the screenshots, regenerated with `pnpm screenshots`). Dependencies only point inward: `web/` uses `core/`'s WASM API, and `core/` has never heard of React.

## Testing

Tested hard where it counts. The Rust side checks RNG and pity over a million-plus pulls, the closed-form offline catch-up against golden files, and save migrations. The load-bearing one: every generated mesh's χ and genus have to match the invariant the shape declares, or CI throws it out. A `simulate` binary keeps completion time in a sane range, and on the web side `vitest` makes sure the store only ever mirrors WASM instead of doing its own maths. PRs welcome; [`AGENTS.md`](./AGENTS.md) has the house rules.

## License

MIT or Apache-2.0, your pick: [MIT](./LICENSE-MIT), [Apache-2.0](./LICENSE-APACHE). Contributions come in under the same terms.

The optional Reference Wing tips its hat to a few famous graphics models (the Utah Teapot, the Stanford Bunny, Spot the cow). The shapes themselves are just mathematics, which nobody owns, but check the licence on any bundled model before you sell anything.
