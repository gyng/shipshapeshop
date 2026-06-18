# Ship Shape Shop

A free, single-player **gacha + idle** game where the collectibles are **mathematical shapes** —
cube/sphere commons up through Klein bottles, heptoroids, gyroids, and 4D polytopes — each a character
whose personality is *derived from its geometry*. Calm ASMR collector on the surface, optional optimization
underneath. Finite ~1–2 day core extended by New Game Plus. Free, no dark patterns; the math is a side
effect, off by default.

**Tech:** React/TypeScript frontend + Rust→WASM simulation core, shipped as a static PWA.

## Design docs

| Doc | What's in it |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Game design: the core loop, the Euler-budget scarcity spring, shape mechanics, the locked economy + New Game Plus, tech architecture, build order. |
| [`RENDERING_PLAN.md`](./RENDERING_PLAN.md) | 3D/shader technical direction: gemstone/refraction materials, exotic-surface geometry, the pull ceremony, performance. |
| [`CHARACTERS.md`](./CHARACTERS.md) | The character layer: narrative frame (the Atlas), personality engine, anime/LN trope layer, authorial house styles, AI-voice casting, bonds, shipping, the 41-character roster. |
| [`AGENTS.md`](./AGENTS.md) | Engineering guide: clean architecture, TDD, atomic design, IA/UX/psychology, gamedev practices, procedural-geometry verification, i18n. (`CLAUDE.md` is a bare import of it.) |

## Development

Monorepo: `core/` (Rust → WASM simulation core), `web/` (Vite + React + TS), `content/` (data, later).
The WASM core must be built **before** installing web deps (`web` depends on `core/pkg` via `file:`):

```sh
pnpm run setup     # build the WASM core, then install web deps
pnpm run dev       # start the Vite dev server
pnpm run test      # cargo tests + web tests
pnpm run build     # release WASM (wasm-opt) + production web build
```

Requires: Node ≥ 20, pnpm, Rust + `wasm32-unknown-unknown` target, `wasm-pack`.

## Status

**In active development** — building toward a complete, fully-playable game (see the milestone roadmap;
AI voice deferred). M0 (scaffold + Rust→WASM↔React pipeline) is done; M1 is the simulation core.
