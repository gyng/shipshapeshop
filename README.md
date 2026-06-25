# Ship Shape Shop

A gacha + idle game where the things you collect are mathematical shapes. You pull them, set them on a hex board to generate currency, glue two together in a forge (which is the real connected-sum operation, so crafting is just topology), raise bonds with them, and send them on expeditions. It runs in a browser, finishes in a day or two, and there's nothing to buy.

The shapes are spheres, knots, tori, Klein bottles, 4D polytopes and the like, each given a name and a personality. You can play it as a calm collector and ignore all the maths, or treat it as an optimization puzzle. Either way you pick up some real topology on the way through.

**[▶ Play it in your browser](https://gyng.github.io/shipshapeshop/)** · or [browse every shape in the viewer](https://gyng.github.io/shipshapeshop/?viewer)

![Pulling a shape](docs/screenshots/gacha.png)

## What you do

- **Pull or craft shapes.** The gacha hands you shapes; the Forge lets you glue two into a third. Gluing is the actual connected-sum, so Euler characteristics add, genus adds, and non-orientability spreads. The recipe system is topology, not a lookup table.
- **Deploy them on a board.** A shape's topology and where you put it decide how much currency it makes. The same board drives a generative lofi soundtrack, so the layout you're optimizing is the music you're hearing.
- **Raise bonds.** Every shape has a nickname, a voice built from its own geometry, and a bond that climbs when you visit it. The real mathematical name unlocks as a reward, not a tutorial.
- **Run expeditions.** Optional idle dungeon-crawler: send teams into the Manifold, clear rooms on auto, farm currency. There's a gambit editor for programming the combat, and a few fights where a good rule-set beats a stronger team playing dumb.
- **Finish it.** A day or two to the end, then New Game+ re-opens everything a dimension higher. No daily logins, no FOMO timers, no purchases, because there's nothing to sell.

## Screenshots

| The Orrery | Expeditions | The Forge |
|---|---|---|
| ![Orrery](docs/screenshots/orrery.png) | ![Expeditions](docs/screenshots/expeditions.png) | ![Forge](docs/screenshots/forge.png) |
| **Gallery** | **The Gacha** | **The Ledger** |
| ![Gallery](docs/screenshots/gallery.png) | ![Gacha](docs/screenshots/gacha.png) | ![Ledger](docs/screenshots/ledger.png) |

## Developers

A deterministic Rust core (the things that have to be true — RNG, economy, save state) compiled to WASM, with a React/TypeScript PWA and three.js gems on top. Architecture, the build commands, and the testing discipline are in [`AGENTS.md`](./AGENTS.md); game and economy design in [`DESIGN.md`](./DESIGN.md); the shader work in [`RENDERING_PLAN.md`](./RENDERING_PLAN.md); the cast and the Atlas frame in [`CHARACTERS.md`](./CHARACTERS.md).

## License

MIT or Apache-2.0, your pick: [MIT](./LICENSE-MIT), [Apache-2.0](./LICENSE-APACHE). Contributions come in under the same terms.

The optional Reference Wing tips its hat to a few famous graphics models (the Utah Teapot, the Stanford Bunny, Spot the cow). The shapes themselves are just mathematics, which nobody owns, but check the licence on any bundled model before you sell anything.
