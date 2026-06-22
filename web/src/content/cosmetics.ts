// Buyable scene cosmetics (the Shop). A scene re-palettes the world cheaply: the page background gradient
// + the hero stage's environment lights. Bought with Flux — the endgame Flux sink. id 0 is the free default.

export interface SceneSpec {
  id: number
  name: string
  cost: number
  desc: string
  bg: string // page background (CSS)
  env: [string, string, string, string] // hero-stage lightformer colours: backdrop, key, cool, warm
  stars: string // sparkle/star tint
  special?: 'cornell'
}

export const SCENES: SceneSpec[] = [
  {
    id: 0, name: 'Nebula', cost: 0, desc: 'The default deep-violet cosmos.',
    bg: 'radial-gradient(circle at 50% -10%, #1a1230, #0a0a12 60%)',
    env: ['#4a2a6a', '#ffffff', '#3a5fff', '#ff5db0'], stars: '#ffffff',
  },
  {
    id: 1, name: 'Aurora', cost: 4000, desc: 'Cold greens and teals, like polar light.',
    bg: 'radial-gradient(circle at 50% -10%, #0c2a26, #08120f 60%)',
    env: ['#0a3a30', '#ccfff0', '#3affc0', '#5fe0c6'], stars: '#bafff0',
  },
  {
    id: 2, name: 'Sunset', cost: 7000, desc: 'Warm amber and rose dusk.',
    bg: 'radial-gradient(circle at 50% -10%, #2a1410, #140a08 60%)',
    env: ['#3a1a10', '#ffe2b0', '#ff9d5c', '#ff5d7a'], stars: '#ffd9a0',
  },
  {
    id: 3, name: 'Void', cost: 6000, desc: 'Near-black, a single cold key light.',
    bg: 'radial-gradient(circle at 50% -10%, #0b0b12, #050507 60%)',
    env: ['#0a0a14', '#cfdcff', '#2a3a6a', '#1a2030'], stars: '#9fb4e0',
  },
  {
    id: 4, name: 'Cornell Box', cost: 12000, desc: 'The famous rendering test room — red & green walls, white box, an area light overhead.',
    bg: 'radial-gradient(circle at 50% -10%, #161410, #0a0a0a 60%)',
    env: ['#bb3030', '#ffffff', '#2faa3a', '#e8e8e8'], stars: '#fff6e0', special: 'cornell',
  },
  {
    id: 5, name: 'Sakura', cost: 5000, desc: 'Soft cherry-blossom pinks and warm white — gentle and cosy.',
    bg: 'radial-gradient(circle at 50% -10%, #2a1622, #120a10 60%)',
    env: ['#5a2a44', '#fff0f6', '#ff9ecf', '#ffc8dd'], stars: '#ffd6ea',
  },
  {
    id: 6, name: 'Abyss', cost: 8000, desc: 'Deep-sea blues with a cold cyan shaft — bioluminescent calm.',
    bg: 'radial-gradient(circle at 50% -10%, #07121f, #04080d 60%)',
    env: ['#0a2438', '#cfeeff', '#1f7fff', '#2fd0d0'], stars: '#a6e6ff',
  },
  {
    id: 7, name: 'Synthwave', cost: 9000, desc: 'Neon magenta and electric cyan — a retro-future grid at dusk.',
    bg: 'radial-gradient(circle at 50% -10%, #2a0e33, #0c0618 60%)',
    env: ['#3a0e5a', '#ff77e0', '#22e6ff', '#ff4fa3'], stars: '#ff9bf0',
  },
  {
    id: 8, name: 'Goldleaf', cost: 15000, desc: 'Warm amber and burnished gold — the patron’s luxe gallery.',
    bg: 'radial-gradient(circle at 50% -10%, #221a0a, #100c05 60%)',
    env: ['#4a3410', '#fff2c8', '#ffcf6b', '#ffae3a'], stars: '#ffe6a8',
  },
  {
    id: 9, name: 'Mint', cost: 6000, desc: 'Pale fresh green and clean white — minimalist and airy.',
    bg: 'radial-gradient(circle at 50% -10%, #102420, #0a1310 60%)',
    env: ['#1a3a30', '#f0fff8', '#9fffd0', '#c8ffe6'], stars: '#d6fff0',
  },
  {
    id: 10, name: 'Ember', cost: 11000, desc: 'Volcanic reds and molten orange against deep char.',
    bg: 'radial-gradient(circle at 50% -10%, #2a0e08, #120604 60%)',
    env: ['#4a1408', '#ffd0b0', '#ff6a3a', '#ff3a4a'], stars: '#ffb088',
  },
  { id: 11, name: 'Toxic Glow', cost: 6500, desc: 'Radioactive chartreuse pooling in tar-black — perfectly safe to cuddle, promise.', bg: 'radial-gradient(circle at 50% -10%, #1a2406, #060a02 60%)', env: ['#243305', '#d4ff3a', '#7bff1f', '#aef03a'], stars: '#e4ff7a' },
  { id: 12, name: 'Old Growth', cost: 4500, desc: 'Deep mossy greens under a quiet, ancient canopy.', bg: 'radial-gradient(circle at 50% -10%, #11261a, #060f0a 60%)', env: ['#163828', '#cfe9c4', '#4f9d6a', '#86c79a'], stars: '#c4e6cf' },
  { id: 13, name: 'Bubblegum', cost: 5000, desc: 'Sugary pinks and sky-blue, sweet enough to sparkle.', bg: 'radial-gradient(circle at 50% -10%, #4a1538, #1a0816 60%)', env: ['#5e1a48', '#ffd0ec', '#ff8fd0', '#8fd8ff'], stars: '#ffc4ec' },
  { id: 14, name: 'Graphite', cost: 3000, desc: 'Quiet monochrome greys, like soft pencil on paper.', bg: 'radial-gradient(circle at 50% -10%, #20232a, #0c0d10 60%)', env: ['#2a2e36', '#e8eaee', '#9aa0ab', '#bcbfc6'], stars: '#dcdee2' },
  { id: 15, name: 'Blacklight', cost: 8500, desc: 'Ultraviolet purples that make every edge quietly glow.', bg: 'radial-gradient(circle at 50% -10%, #1d0640, #0a021c 60%)', env: ['#2a0a66', '#c79bff', '#8a3aff', '#5fe0ff'], stars: '#d6b0ff' },
  { id: 16, name: 'Dune Dusk', cost: 4000, desc: 'Warm sand and burnt amber as the desert cools for the night.', bg: 'radial-gradient(circle at 50% -10%, #3a220e, #160c05 60%)', env: ['#4a2c12', '#ffe1b0', '#e89a52', '#c2603a'], stars: '#ffd6a0' },
  { id: 17, name: 'Glacier', cost: 5500, desc: 'Pale blues and frosted white, cool and impossibly still.', bg: 'radial-gradient(circle at 50% -10%, #16323f, #07141b 60%)', env: ['#1e4658', '#e4f7ff', '#7fd0ec', '#aee6f5'], stars: '#d6f2ff' },
  { id: 18, name: 'Lava Lamp', cost: 9500, desc: 'Slow blobs of orange and violet drifting through a warm haze.', bg: 'radial-gradient(circle at 50% -10%, #2e0a2a, #120414 60%)', env: ['#451040', '#ff9c4a', '#c44ad6', '#ff5fa0'], stars: '#ffbf8a' },
  { id: 19, name: 'Cosmic Latte', cost: 6000, desc: 'Soft cream and warm beige — the average colour of the whole universe.', bg: 'radial-gradient(circle at 50% -10%, #2a2620, #14110c 60%)', env: ['#3a342a', '#fff4e0', '#e8dcc4', '#d8c4a0'], stars: '#fff0d8' },
  { id: 20, name: 'Phosphor', cost: 10000, desc: 'Glowing terminal-green on deep black, like an old screen humming softly at night.', bg: 'radial-gradient(circle at 50% -10%, #021206, #010602 60%)', env: ['#063314', '#9dffb0', '#1aff5a', '#3aff8a'], stars: '#7dff9a' },
]

export const sceneById = (id: number): SceneSpec => SCENES.find((s) => s.id === id) ?? SCENES[0]

// ── Generic cosmetic slots ───────────────────────────────────────────────────
// Scenes keep their own field in the core (back-compat); every other cosmetic class lives in the core's
// generic `equipped` vec, indexed by slot. Cosmetic ids are globally unique across classes (one owned-set in
// the core), so we range them by class. id 0 of each class is the always-owned free default.
export const SLOT_FINISH = 0
export const SLOT_CEREMONY = 1
export const SLOT_BOARD = 2
export const SLOT_TITLE = 3
export const SLOT_LIGHTING = 4
export const SLOT_DECOR = 5
export const SLOT_SOUNDSCAPE = 6
export const SLOT_CURSOR = 7
export const SLOT_ATMOSPHERE = 8

// ── Gem finishes (slot 0) ─────────────────────────────────────────────────────
// A finish re-skins the hero gem's material (pull reveal + inspector). `mat` overrides are merged over the
// rarity-derived base in Gem.tsx, so rarity still reads through; a finish only changes the *surface*.
export interface GemFinishSpec {
  id: number
  name: string
  cost: number
  desc: string
  mat: {
    colorTint?: string // base body colour (default #ffffff)
    roughness?: number // absolute override
    transmissionMul?: number // scales the base transmission (1)
    iorAdd?: number
    chromaticAdd?: number
    clearcoat?: number
    clearcoatRoughness?: number
    attenuationColor?: string // override the rarity tint
    attenuationDistance?: number
    iridescence?: number // absolute override of thin-film shimmer (0 = none)
    envMapIntensityMul?: number // scales the rarity-derived env reflection strength
    emissiveIntensity?: number // absolute override of the inner-core glow
  }
  swatch: string // CSS preview for the shop card
  hues: string[] // spark-burst palette for the purchase pop
}

export const GEM_FINISHES: GemFinishSpec[] = [
  { id: 0, name: 'Prism', cost: 0, desc: 'The default refractive glass — clean dispersion, rarity shows in the core.', mat: {}, swatch: 'conic-gradient(from 210deg, #ff5d8f, #ffb86b, #5fe0c6, #b985ff, #ff5d8f)', hues: ['#fff6dc', '#ffcf6b', '#5fe0c6', '#b985ff'] },
  { id: 201, name: 'Frosted', cost: 4000, desc: 'A soft matte etch — milky, diffused, calm. The ASMR finish.', mat: { roughness: 0.4, transmissionMul: 0.82, chromaticAdd: -0.03, clearcoatRoughness: 0.6, iridescence: 0, emissiveIntensity: 0 }, swatch: 'linear-gradient(135deg, #f4f6ff, #cdd6ea)', hues: ['#ffffff', '#f4f6ff', '#cdd6ea'] },
  { id: 202, name: 'Rose Quartz', cost: 6000, desc: 'A warm pink bloom suspended in the glass.', mat: { attenuationColor: '#ff9ecf', attenuationDistance: 2.0 }, swatch: 'linear-gradient(135deg, #ffd6ea, #ff9ecf)', hues: ['#fff0f6', '#ffd6ea', '#ff9ecf'] },
  { id: 203, name: 'Iridescent', cost: 9000, desc: 'Oil-on-water shimmer — strong chromatic split at every edge.', mat: { chromaticAdd: 0.2, iorAdd: 0.18, clearcoat: 1, iridescence: 0.7, envMapIntensityMul: 1.3 }, swatch: 'linear-gradient(135deg, #a6e6ff, #b985ff, #ff9ecf, #9fffd0)', hues: ['#a6e6ff', '#b985ff', '#ff9ecf', '#9fffd0'] },
  { id: 204, name: 'Obsidian', cost: 7000, desc: 'Near-opaque volcanic glass with a hard gloss.', mat: { colorTint: '#0c0c14', transmissionMul: 0.26, roughness: 0.12, attenuationColor: '#1a1326', attenuationDistance: 0.8, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0, emissiveIntensity: 0 }, swatch: 'linear-gradient(135deg, #2a2c3a, #07070c)', hues: ['#9aa6c2', '#5a5d72', '#2a2c3a'] },
  { id: 205, name: 'Goldleaf', cost: 13000, desc: 'Burnished amber depths — the patron’s gem.', mat: { attenuationColor: '#ffcf6b', attenuationDistance: 1.5, roughness: 0.04, clearcoat: 1 }, swatch: 'linear-gradient(135deg, #ffe6a8, #ffae3a)', hues: ['#fff6dc', '#ffe6a8', '#ffcf6b', '#ffae3a'] },
  { id: 206, name: 'Liquid Chrome', cost: 11000, desc: 'A mirror-bright puddle of molten metal that drinks the light and pours it right back.', mat: { colorTint: '#cfd4dc', transmissionMul: 0.22, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensityMul: 1.5, iridescence: 0 }, swatch: 'linear-gradient(135deg, #f2f4f8, #aab0bd, #6f7686, #d7dbe2)', hues: ['#f2f4f8', '#aab0bd', '#6f7686'] },
  { id: 207, name: 'Sapphire Depths', cost: 8000, desc: 'Cool blue gemstone tint that deepens the longer you gaze into it.', mat: { colorTint: '#3a6cff', attenuationColor: '#1d3fc0', attenuationDistance: 0.9, transmissionMul: 0.95, iorAdd: 0.12, clearcoat: 0.6 }, swatch: 'linear-gradient(135deg, #8fb4ff, #2a6aff, #16277a)', hues: ['#8fb4ff', '#2a6aff', '#16277a'] },
  { id: 208, name: 'Emerald Veil', cost: 8000, desc: 'A soft green glass with a verdant heart, like sunlight through deep leaves.', mat: { colorTint: '#2fd07a', attenuationColor: '#118a4e', attenuationDistance: 1.0, transmissionMul: 0.95, iorAdd: 0.1, clearcoat: 0.5 }, swatch: 'linear-gradient(135deg, #9bf3c4, #2fd07a, #0c6b3d)', hues: ['#9bf3c4', '#2fd07a', '#0c6b3d'] },
  { id: 209, name: 'Matte Clay', cost: 3500, desc: 'Warm, hand-thrown earthenware with no shine to hide behind — humble and lovely.', mat: { colorTint: '#c8836a', roughness: 0.92, transmissionMul: 0.2, clearcoat: 0, iridescence: 0, emissiveIntensity: 0 }, swatch: 'linear-gradient(135deg, #d99a7e, #b5694f, #7d4131)', hues: ['#d99a7e', '#b5694f', '#7d4131'] },
  { id: 210, name: 'Moon Pearl', cost: 9500, desc: 'A creamy orb of soft luster that glows faintly from somewhere within.', mat: { colorTint: '#f4ece0', roughness: 0.32, transmissionMul: 0.55, iridescence: 0.4, attenuationColor: '#f7d9c4', attenuationDistance: 1.4, clearcoat: 0.7, emissiveIntensity: 0.12 }, swatch: 'linear-gradient(135deg, #fdf7ee, #f0dcc9, #d9bfae)', hues: ['#fdf7ee', '#f0dcc9', '#d9bfae'] },
  { id: 211, name: 'Hologram', cost: 13000, desc: 'A flickering rainbow lattice that never holds the same colour twice.', mat: { chromaticAdd: 0.24, iorAdd: 0.16, iridescence: 0.95, clearcoat: 1, envMapIntensityMul: 1.45, transmissionMul: 1.05 }, swatch: 'linear-gradient(135deg, #6cf0ff, #b06cff, #ff6cd0, #6cffb0)', hues: ['#6cf0ff', '#b06cff', '#ff6cd0', '#6cffb0'] },
  { id: 212, name: 'Neon Pulse', cost: 12000, desc: 'An electric magenta core that hums with its own restless inner light.', mat: { colorTint: '#ff2bd0', transmissionMul: 0.5, roughness: 0.18, emissiveIntensity: 1.6, attenuationColor: '#ff5ae0', attenuationDistance: 0.7, clearcoat: 0.8 }, swatch: 'linear-gradient(135deg, #ff8cf0, #ff2bd0, #8a1f99)', hues: ['#ff8cf0', '#ff2bd0', '#8a1f99'] },
  { id: 213, name: 'Smoky Quartz', cost: 6000, desc: 'A hazy curl of grey-brown smoke caught forever in glass.', mat: { colorTint: '#6b6258', transmissionMul: 0.6, roughness: 0.22, attenuationColor: '#4a4038', attenuationDistance: 0.85, clearcoat: 0.5 }, swatch: 'linear-gradient(135deg, #a59a8c, #6b6258, #3b352e)', hues: ['#a59a8c', '#6b6258', '#3b352e'] },
  // ── Exotic finishes ✦ — the showpieces: light that bends, glows, or shatters into fire (pricey endgame sinks) ──
  { id: 214, name: 'Diamond Fire', cost: 15000, desc: 'Flawless brilliance that splinters every ray into darting rainbow fire.', mat: { transmissionMul: 1.1, roughness: 0.02, iorAdd: 0.28, chromaticAdd: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensityMul: 1.5, iridescence: 0.2 }, swatch: 'linear-gradient(135deg, #ffffff, #bfe6ff, #ffd0f0, #d0ffe0)', hues: ['#ffffff', '#bfe6ff', '#ffd0f0', '#d0ffe0'] },
  { id: 215, name: 'Event Horizon', cost: 17000, desc: 'Light bends in and never leaves — just a sliver of glow clinging to the dark.', mat: { colorTint: '#040407', transmissionMul: 0.12, roughness: 0.05, iorAdd: 0.4, attenuationColor: '#0a0a16', attenuationDistance: 0.5, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0, emissiveIntensity: 0.08 }, swatch: 'radial-gradient(circle at 50% 50%, #2a2a3a, #050509 70%)', hues: ['#6a6a8a', '#2a2a3a', '#050509'] },
  { id: 216, name: 'Plasma', cost: 16000, desc: 'A captive star — too bright to look straight at, too warm to put down.', mat: { colorTint: '#fff0d0', transmissionMul: 0.55, roughness: 0.1, attenuationColor: '#ffae5a', attenuationDistance: 0.9, emissiveIntensity: 1.9, clearcoat: 0.6 }, swatch: 'radial-gradient(circle at 50% 45%, #fff6e0, #ff9a3a 70%, #b03a10)', hues: ['#fff6e0', '#ffcf6b', '#ff9a3a'] },
  { id: 217, name: 'Uranium Glass', cost: 13000, desc: 'Vintage vaseline glass that drinks the dark and glows back a radioactive green.', mat: { colorTint: '#caff5a', transmissionMul: 0.8, attenuationColor: '#9be02a', attenuationDistance: 1.2, emissiveIntensity: 0.7, iorAdd: 0.06, clearcoat: 0.4 }, swatch: 'linear-gradient(135deg, #eaff9a, #9be02a, #5a8a14)', hues: ['#eaff9a', '#9be02a', '#5a8a14'] },
  { id: 218, name: 'Opal', cost: 14000, desc: 'Milky and calm until it tilts — then flecks of every colour flash through.', mat: { colorTint: '#f0eef6', transmissionMul: 0.7, roughness: 0.18, iridescence: 0.9, chromaticAdd: 0.12, attenuationColor: '#dfe0ff', attenuationDistance: 1.6, clearcoat: 0.7, emissiveIntensity: 0.06 }, swatch: 'linear-gradient(135deg, #f4f2fa, #bfe0ff, #ffd6ec, #c8ffd8)', hues: ['#f4f2fa', '#bfe0ff', '#ffd6ec', '#c8ffd8'] },
  { id: 219, name: 'Bismuth', cost: 14000, desc: 'An oxidised metal staircase of teal, gold and magenta, terraced like tiny ziggurats.', mat: { colorTint: '#9a9aa6', transmissionMul: 0.3, roughness: 0.14, iridescence: 0.95, chromaticAdd: 0.2, clearcoat: 1, envMapIntensityMul: 1.4 }, swatch: 'linear-gradient(135deg, #46e0c0, #ffcf6b, #ff6cd0, #6c8cff)', hues: ['#46e0c0', '#ffcf6b', '#ff6cd0', '#6c8cff'] },
  { id: 220, name: 'Magma', cost: 15000, desc: 'A blackened crust cracked open over a slow, glowing molten heart.', mat: { colorTint: '#160a06', transmissionMul: 0.45, roughness: 0.3, attenuationColor: '#ff4a1a', attenuationDistance: 0.7, emissiveIntensity: 1.2, iorAdd: 0.05, clearcoat: 0.3 }, swatch: 'radial-gradient(circle at 50% 55%, #ff7a2a, #c41808 60%, #1a0a06)', hues: ['#ffb066', '#ff4a1a', '#c41808'] },
  { id: 221, name: 'Ectoplasm', cost: 13000, desc: 'A ghost caught mid-drift — glowing faint and cold and not entirely there.', mat: { colorTint: '#bfffe6', transmissionMul: 0.92, roughness: 0.15, attenuationColor: '#5affc0', attenuationDistance: 1.8, emissiveIntensity: 0.5, clearcoat: 0.5 }, swatch: 'linear-gradient(135deg, #d6fff0, #5affc0, #2ac0a0)', hues: ['#d6fff0', '#5affc0', '#2ac0a0'] },
]
export const gemFinishById = (id: number): GemFinishSpec => GEM_FINISHES.find((f) => f.id === id) ?? GEM_FINISHES[0]

// ── Ceremony themes (slot 1) ──────────────────────────────────────────────────
// Re-tints the pull reveal cinematic (the engineered "peak"): charge-orb glow, flash wash, spark hues, ring.
// Any undefined field falls back to the rarity-derived default, so a legendary still flashes its own colour.
export interface CeremonySpec {
  id: number
  name: string
  cost: number
  desc: string
  orbCore?: string // charge-orb centre (default '#ffffff')
  flashTint?: string // flash wash colour (default rarity colour)
  sparkHues?: string[] // spark burst palette (default rarity-derived)
  ringTint?: string // expanding ring colour (default rarity colour)
  swatch: string
}

export const CEREMONIES: CeremonySpec[] = [
  { id: 0, name: 'Classic', cost: 0, desc: 'The default reveal — each shape flashes in its own rarity colour.', swatch: 'radial-gradient(circle at 50% 40%, #fff, #ffcf6b 70%, #0a0a12)' },
  { id: 301, name: 'Goldrush', cost: 5000, desc: 'A warm cascade of gold motes and amber light.', orbCore: '#fff6dc', flashTint: '#ffcf6b', sparkHues: ['#fff6dc', '#ffe6a8', '#ffcf6b', '#ffae3a'], ringTint: '#ffcf6b', swatch: 'radial-gradient(circle at 50% 40%, #fff6dc, #ffae3a 70%, #2a1a08)' },
  { id: 302, name: 'Frostlight', cost: 5000, desc: 'A cool aurora burst — cyan sparks on white.', orbCore: '#eafcff', flashTint: '#5ad4ff', sparkHues: ['#eafcff', '#ffffff', '#a6e6ff', '#5ad4ff'], ringTint: '#5ad4ff', swatch: 'radial-gradient(circle at 50% 40%, #eafcff, #3aa6e0 70%, #06121f)' },
  { id: 303, name: 'Sakura', cost: 7000, desc: 'Drifting petals of soft pink and warm white.', orbCore: '#fff0f6', flashTint: '#ff9ecf', sparkHues: ['#fff0f6', '#ffd6ea', '#ff9ecf', '#ffc8dd'], ringTint: '#ff9ecf', swatch: 'radial-gradient(circle at 50% 40%, #fff0f6, #ff9ecf 70%, #2a1622)' },
  { id: 304, name: 'Voidstar', cost: 8000, desc: 'A violet supernova against the deep dark.', orbCore: '#f0e0ff', flashTint: '#b985ff', sparkHues: ['#f0e0ff', '#ffffff', '#c8a6ff', '#b985ff'], ringTint: '#b985ff', swatch: 'radial-gradient(circle at 50% 40%, #f0e0ff, #7a3aff 70%, #0c0618)' },
  { id: 305, name: 'Emberfall', cost: 5500, desc: 'Molten sparks tumble up from a glowing forge-red heart.', orbCore: '#ffe6cf', flashTint: '#ff6b2c', sparkHues: ['#ffe6cf', '#ffb37a', '#ff6b2c', '#d62828'], ringTint: '#ff6b2c', swatch: 'radial-gradient(circle at 50% 40%, #ffe6cf, #d62828 70%, #1a0603)' },
  { id: 306, name: 'Tidewell', cost: 4500, desc: 'A cool plunge into deep teal, calm as the sea at dusk.', orbCore: '#dbfbff', flashTint: '#2bb6c4', sparkHues: ['#dbfbff', '#7fe3e8', '#2bb6c4', '#0a6b7a'], ringTint: '#2bb6c4', swatch: 'radial-gradient(circle at 50% 40%, #dbfbff, #0a6b7a 70%, #021519)' },
  { id: 307, name: 'Verdance', cost: 4000, desc: 'Fresh mint light unfurls like the first leaf of spring.', orbCore: '#eaffe6', flashTint: '#46c96b', sparkHues: ['#eaffe6', '#a7f0a0', '#46c96b', '#1f8a4c'], ringTint: '#46c96b', swatch: 'radial-gradient(circle at 50% 40%, #eaffe6, #1f8a4c 70%, #04190d)' },
  { id: 308, name: 'Prismatic', cost: 12000, desc: 'A full spectrum shatters loose in a giddy little rainbow.', orbCore: '#ffffff', flashTint: '#ff5fa2', sparkHues: ['#ff5f6d', '#ffd166', '#5fe08a', '#5fa8ff'], ringTint: '#a05fff', swatch: 'radial-gradient(circle at 50% 40%, #ffffff, #a05fff 70%, #100818)' },
  { id: 309, name: 'Sterling', cost: 3500, desc: 'Clean silver light, polished to a quiet mirror shine.', orbCore: '#ffffff', flashTint: '#c8d2dc', sparkHues: ['#ffffff', '#e4eaef', '#c8d2dc', '#8d99a6'], ringTint: '#c8d2dc', swatch: 'radial-gradient(circle at 50% 40%, #ffffff, #8d99a6 70%, #14181c)' },
  { id: 310, name: 'Blacklight', cost: 9000, desc: 'A secret ultraviolet glow that makes everything hum neon.', orbCore: '#f5e6ff', flashTint: '#8a2be2', sparkHues: ['#f5e6ff', '#d18bff', '#8a2be2', '#39ff14'], ringTint: '#8a2be2', swatch: 'radial-gradient(circle at 50% 40%, #f5e6ff, #4b0082 70%, #07020d)' },
]
export const ceremonyById = (id: number): CeremonySpec => CEREMONIES.find((c) => c.id === id) ?? CEREMONIES[0]

// ── Collector titles (slot 3) ─────────────────────────────────────────────────
// A vanity nameplate shown beside the Curator Rank badge. Pure text — the cheapest, coziest Flux sink.
export interface TitleSpec {
  id: number
  name: string // shop card label
  cost: number
  desc: string
  text: string // the displayed title
  color: string
  swatch: string
}

export const TITLES: TitleSpec[] = [
  { id: 0, name: 'Curator', cost: 0, desc: 'The honest default. You keep the museum.', text: 'Curator', color: '#cdd2e0', swatch: 'linear-gradient(135deg, #3a3d4f, #cdd2e0)' },
  { id: 501, name: 'Topologist', cost: 3000, desc: 'You count holes for fun now.', text: 'Topologist', color: '#5fe0c6', swatch: 'linear-gradient(135deg, #0a3a30, #5fe0c6)' },
  { id: 502, name: 'Shape Whisperer', cost: 5000, desc: 'They settle when you pass by.', text: 'Shape Whisperer', color: '#b985ff', swatch: 'linear-gradient(135deg, #2a0e33, #b985ff)' },
  { id: 503, name: 'Idle Sovereign', cost: 10000, desc: 'The Flux flows whether you watch or not.', text: 'Idle Sovereign', color: '#ffcf6b', swatch: 'linear-gradient(135deg, #4a3410, #ffcf6b)' },
  { id: 504, name: 'Manifold Patron', cost: 15000, desc: 'The gallery bears your name.', text: 'Manifold Patron', color: '#ff9ecf', swatch: 'linear-gradient(135deg, #3a1020, #ff9ecf)' },
  { id: 505, name: 'Genus Counter', cost: 3500, desc: 'Every donut is a research opportunity.', text: 'Genus Counter', color: '#7ab8ff', swatch: 'linear-gradient(135deg, #0c2440, #7ab8ff)' },
  { id: 506, name: 'Shelf Warden', cost: 4000, desc: 'No gem gathers dust on your watch.', text: 'Shelf Warden', color: '#9bd16a', swatch: 'linear-gradient(135deg, #16320e, #9bd16a)' },
  { id: 507, name: 'Knot Theorist', cost: 5500, desc: 'You see the tangle and call it elegant.', text: 'Knot Theorist', color: '#d98cff', swatch: 'linear-gradient(135deg, #2a0f3e, #d98cff)' },
  { id: 508, name: 'Gem Goblin', cost: 4500, desc: 'Hoarding, but make it adorable.', text: 'Gem Goblin', color: '#ff9e6b', swatch: 'linear-gradient(135deg, #3a1a0c, #ff9e6b)' },
  { id: 509, name: 'Flux Baron', cost: 8000, desc: 'The idle economy bends to your whim.', text: 'Flux Baron', color: '#5fd0ff', swatch: 'linear-gradient(135deg, #08303f, #5fd0ff)' },
  { id: 510, name: 'Homeomorph', cost: 6000, desc: 'You and a coffee mug, basically the same.', text: 'Homeomorph', color: '#c0a8ff', swatch: 'linear-gradient(135deg, #1f163e, #c0a8ff)' },
  { id: 511, name: 'Euler\'s Heir', cost: 12000, desc: 'V minus E plus F, and the throne is yours.', text: 'Euler\'s Heir', color: '#ffd24a', swatch: 'linear-gradient(135deg, #3d2e08, #ffd24a)' },
  { id: 512, name: 'Curve Whisperer', cost: 6500, desc: 'Geodesics lean in when you speak softly.', text: 'Curve Whisperer', color: '#6be0a8', swatch: 'linear-gradient(135deg, #08331f, #6be0a8)' },
  { id: 513, name: 'Tessellator', cost: 7000, desc: 'You tile the plane and leave no gap.', text: 'Tessellator', color: '#ff8fae', swatch: 'linear-gradient(135deg, #3a0f20, #ff8fae)' },
  { id: 514, name: 'Prime Mover', cost: 9000, desc: 'The first push, and the Flux never rests.', text: 'Prime Mover', color: '#ffb24a', swatch: 'linear-gradient(135deg, #3d2606, #ffb24a)' },
  { id: 515, name: 'Voidwright', cost: 11000, desc: 'You build with the holes, not the dough.', text: 'Voidwright', color: '#8a9bff', swatch: 'linear-gradient(135deg, #14193e, #8a9bff)' },
  { id: 516, name: 'Orrery Regent', cost: 18000, desc: 'The whole orrery answers to your shelf.', text: 'Orrery Regent', color: '#e8c4ff', swatch: 'linear-gradient(135deg, #261540, #e8c4ff)' },
]
export const titleById = (id: number): TitleSpec => TITLES.find((t) => t.id === id) ?? TITLES[0]

// ── Board skins (slot 2) — re-tint the Orrery flux floor, pads & sparkles ─────
export interface BoardSkinSpec {
  id: number
  name: string
  cost: number
  desc: string
  floor: string // floor plane colour
  padLit: string // lit hex pad / emissive accent
  padUnlit: string // resting hex pad colour
  sparkle: string // ambient sparkle tint
  swatch: string
  hues: string[]
}
export const BOARD_SKINS: BoardSkinSpec[] = [
  { id: 0, name: 'Nightfall', cost: 0, desc: 'The default deep-navy floor with a warm gold accent.', floor: '#0d0e1a', padLit: '#ffcf6b', padUnlit: '#1a1c28', sparkle: '#ffcf6b', swatch: 'linear-gradient(135deg, #1a1c28, #ffcf6b)', hues: ['#fff6dc', '#ffcf6b', '#ffae3a'] },
  { id: 101, name: 'Verdant', cost: 5000, desc: 'A mossy field that glows soft green where flux flows.', floor: '#0a1410', padLit: '#7affc0', padUnlit: '#12241c', sparkle: '#9fffd0', swatch: 'linear-gradient(135deg, #12241c, #7affc0)', hues: ['#d6fff0', '#7affc0', '#3ad99a'] },
  { id: 102, name: 'Bloodmoon', cost: 6000, desc: 'Volcanic dark with embers along every lit lane.', floor: '#160a0c', padLit: '#ff6b6b', padUnlit: '#281418', sparkle: '#ff8a6b', swatch: 'linear-gradient(135deg, #281418, #ff6b6b)', hues: ['#ffd0b0', '#ff8a6b', '#ff4a4a'] },
  { id: 103, name: 'Abyssal', cost: 7000, desc: 'Deep-sea floor with cold cyan currents.', floor: '#07101c', padLit: '#3aa6ff', padUnlit: '#0e1c2c', sparkle: '#5ad4ff', swatch: 'linear-gradient(135deg, #0e1c2c, #3aa6ff)', hues: ['#cfeeff', '#5ad4ff', '#1f7fff'] },
  { id: 104, name: 'Porcelain', cost: 9000, desc: 'A bright museum floor — crisp white light on slate.', floor: '#1a1c24', padLit: '#ffffff', padUnlit: '#2a2d38', sparkle: '#eef2ff', swatch: 'linear-gradient(135deg, #2a2d38, #ffffff)', hues: ['#ffffff', '#eef2ff', '#cdd6ea'] },
  { id: 105, name: 'Sakura', cost: 4000, desc: 'A soft pink drift where each lit lane blooms like spring.', floor: '#1a0f14', padLit: '#ff9ec4', padUnlit: '#2a1820', sparkle: '#ffd0e4', swatch: 'linear-gradient(135deg, #2a1820, #ff9ec4)', hues: ['#ffe6f0', '#ff9ec4', '#f25f9e'] },
  { id: 106, name: 'Amethyst', cost: 8000, desc: 'Dusky violet stone that lights amethyst-bright along the flux.', floor: '#120a1c', padLit: '#b07aff', padUnlit: '#1e1430', sparkle: '#d4b0ff', swatch: 'linear-gradient(135deg, #1e1430, #b07aff)', hues: ['#ecdcff', '#b07aff', '#8a3aff'] },
  { id: 107, name: 'Amber Hearth', cost: 6500, desc: 'A warm floor where flux pools and glows like molten honey.', floor: '#160f06', padLit: '#ffb347', padUnlit: '#281c0e', sparkle: '#ffd58a', swatch: 'linear-gradient(135deg, #281c0e, #ffb347)', hues: ['#ffedc4', '#ffb347', '#ff8c1f'] },
  { id: 108, name: 'Lavender Fog', cost: 4500, desc: 'A hushed twilight haze with gentle lavender glints.', floor: '#12121c', padLit: '#b8a6ff', padUnlit: '#1e1e2e', sparkle: '#dcd0ff', swatch: 'linear-gradient(135deg, #1e1e2e, #b8a6ff)', hues: ['#ece6ff', '#b8a6ff', '#9080e0'] },
  { id: 109, name: 'Spearmint', cost: 5500, desc: 'A cool teal-mint floor that breathes fresh where flux flows.', floor: '#08161a', padLit: '#4ee6c0', padUnlit: '#0e2630', sparkle: '#90ffe0', swatch: 'linear-gradient(135deg, #0e2630, #4ee6c0)', hues: ['#d0fff2', '#4ee6c0', '#1fc9a0'] },
  { id: 110, name: 'Orchid Glow', cost: 12000, desc: 'A deep floor where flux blooms in soft, glowing magenta.', floor: '#160814', padLit: '#ff4ad4', padUnlit: '#281024', sparkle: '#ff90e6', swatch: 'linear-gradient(135deg, #281024, #ff4ad4)', hues: ['#ffd0f4', '#ff4ad4', '#e01fb0'] },
]
export const boardSkinById = (id: number): BoardSkinSpec => BOARD_SKINS.find((b) => b.id === id) ?? BOARD_SKINS[0]

// ── Lighting (slot 4) — the 3D stage's mood (intensity multipliers) ───────────
export interface LightingSpec {
  id: number
  name: string
  cost: number
  desc: string
  ambient: number // ×ambientLight (1 = default)
  key: number // ×directional + env key
  rim: number // ×rarity rim/point light
  swatch: string
  hues: string[]
}
export const LIGHTING_MOODS: LightingSpec[] = [
  { id: 0, name: 'Gallery', cost: 0, desc: 'The default balanced gallery light.', ambient: 1, key: 1, rim: 1, swatch: 'linear-gradient(135deg, #3a3d4f, #cdd2e0)', hues: ['#ffffff', '#cdd2e0'] },
  { id: 401, name: 'Studio', cost: 4000, desc: 'Bright, even, product-shot light — every facet pops.', ambient: 1.4, key: 1.25, rim: 0.8, swatch: 'linear-gradient(135deg, #6a6d7a, #ffffff)', hues: ['#ffffff', '#f4f6ff'] },
  { id: 402, name: 'Moody', cost: 5000, desc: 'Low, dramatic light — deep shadows, a single rim.', ambient: 0.5, key: 0.85, rim: 1.5, swatch: 'linear-gradient(135deg, #0a0a12, #5a5d72)', hues: ['#9aa6c2', '#3a3d4f'] },
  { id: 403, name: 'Spotlight', cost: 6000, desc: 'A hard key from above — gallery-pedestal drama.', ambient: 0.35, key: 1.7, rim: 1.3, swatch: 'linear-gradient(135deg, #07070c, #fff2c8)', hues: ['#fff2c8', '#ffcf6b'] },
  { id: 404, name: 'Daydream', cost: 5000, desc: 'Soft, warm, diffuse — a gentle hazy glow.', ambient: 1.25, key: 0.9, rim: 1.15, swatch: 'linear-gradient(135deg, #2a1622, #ffd6ea)', hues: ['#ffd6ea', '#ff9ecf'] },
  { id: 405, name: 'Candlelit', cost: 6000, desc: 'A hush of warm, flickering glow — low and close, like one little flame leaning in.', ambient: 0.45, key: 0.85, rim: 1.15, swatch: 'linear-gradient(135deg, #1a0f06, #ffb169)', hues: ['#ffb169', '#d9742a'] },
  { id: 406, name: 'Overexposed', cost: 9000, desc: 'Everything blown bright and weightless, like a sunny window left wide open all afternoon.', ambient: 1.5, key: 1.75, rim: 0.65, swatch: 'linear-gradient(135deg, #cfd6e6, #ffffff)', hues: ['#ffffff', '#eef3ff'] },
  { id: 407, name: 'Film Noir', cost: 11000, desc: 'Inky dark with one sharp blade of edge-light — every facet keeps a secret.', ambient: 0.32, key: 1.1, rim: 1.6, swatch: 'linear-gradient(135deg, #050507, #c8ccd8)', hues: ['#c8ccd8', '#7a7e8c'] },
  { id: 408, name: 'Golden Hour', cost: 7500, desc: 'Soft low sun and a long honeyed rim — that cozy glow right before the day clocks out.', ambient: 1.05, key: 0.9, rim: 1.45, swatch: 'linear-gradient(135deg, #3a2410, #ffd27a)', hues: ['#ffd27a', '#e89a4c'] },
  { id: 409, name: 'Clean Room', cost: 5500, desc: 'Flat, even, faintly clinical fill — so shadowless not a single one dares step out of line.', ambient: 1.5, key: 0.95, rim: 0.65, swatch: 'linear-gradient(135deg, #aeb9c4, #f2f7fb)', hues: ['#f2f7fb', '#cdd8e2'] },
]
export const lightingById = (id: number): LightingSpec => LIGHTING_MOODS.find((l) => l.id === id) ?? LIGHTING_MOODS[0]

// ── Soundscapes (slot 6) — pick the lofi bed's mood (mirrors orreryBed STYLES) ─
export interface SoundscapeSpec {
  id: number
  name: string
  cost: number
  desc: string
  detail: string // concrete musical character it unlocks (tempo · feel · timbre) — drawn from orreryBed STYLES
  style: string | null // orreryBed Style id, or null = auto (the bed picks from your loadout)
  swatch: string
  hues: string[]
}
export const SOUNDSCAPES: SoundscapeSpec[] = [
  { id: 0, name: 'Drift', cost: 0, desc: 'Auto — the bed chooses a mood from your loadout.', detail: 'Adaptive · tempo, swing & instruments follow your deployed shapes.', style: null, swatch: 'linear-gradient(135deg, #1a1c28, #5fe0c6, #b985ff)', hues: ['#5fe0c6', '#b985ff'] },
  { id: 601, name: 'Dusty', cost: 3000, desc: 'Warm, gritty, crackling — the classic lofi haze.', detail: 'Mid-tempo · straight · heavy vinyl crush, muffled highs, busy kit.', style: 'dusty', swatch: 'linear-gradient(135deg, #2a1a08, #ffcf6b)', hues: ['#ffe6a8', '#ffcf6b'] },
  { id: 602, name: 'Rainy', cost: 3000, desc: 'Soft, reverberant, slow — a window in the rain.', detail: 'Slower · straight · spacious reverb, soft dark tone, sparse beats.', style: 'rainy', swatch: 'linear-gradient(135deg, #07121f, #5ad4ff)', hues: ['#a6e6ff', '#5ad4ff'] },
  { id: 603, name: 'Jazzy', cost: 4000, desc: 'Upbeat, swung, ninth-rich — a little brighter.', detail: 'Upbeat · swung · rich 9th-chord harmony, busy brushed kit.', style: 'jazzy', swatch: 'linear-gradient(135deg, #2a0e33, #ff9ecf)', hues: ['#ffd6ea', '#ff9ecf'] },
  { id: 604, name: 'Sleepy', cost: 3000, desc: 'Minimal, hushed, low — barely-there beats.', detail: 'Slowest · straight · very soft & muffled, minimal beats.', style: 'sleepy', swatch: 'linear-gradient(135deg, #0a1310, #9fffd0)', hues: ['#d6fff0', '#9fffd0'] },
  { id: 605, name: 'Tape', cost: 4000, desc: 'Wobbly, vintage, crushed — worn cassette warmth.', detail: 'Mid-slow · light swing · heavy wobble/crush, worn-cassette warmth.', style: 'tape', swatch: 'linear-gradient(135deg, #221a0a, #d8b48c)', hues: ['#e8d0a8', '#d8b48c'] },
  // Premium styles ✦ — the richer / more characterful moods. Buying one (a real Flux sink) lets you force it
  // here AND unlocks it for the Drift rotation (Settings ▸ Audio). Pricier than the base moods above.
  { id: 606, name: 'J-Pop ✦', cost: 12000, desc: 'Bright, catchy, polished — radio-ready sparkle.', detail: 'Fast · straight · bright clear keys, crisp punchy kit.', style: 'jpop', swatch: 'linear-gradient(135deg, #ff5db0, #5ad4ff)', hues: ['#ff9bf0', '#5ad4ff'] },
  { id: 607, name: 'J-Rock ✦', cost: 12000, desc: 'Driving and anthemic — guitars-forward push.', detail: 'Fast · straight · edgy bright lead, tight driving kit.', style: 'jrock', swatch: 'linear-gradient(135deg, #2a0a0a, #ff5d4a)', hues: ['#ff8a6b', '#ff4a4a'] },
  { id: 608, name: 'City Pop ✦', cost: 13000, desc: 'Glossy 80s funk — a neon nightdrive.', detail: 'Upbeat · light swing · glassy DX keys, funky octave bass.', style: 'citypop', swatch: 'linear-gradient(135deg, #2a0e33, #ffcf6b)', hues: ['#ff9ecf', '#ffcf6b'] },
  { id: 609, name: 'Synthwave ✦', cost: 11000, desc: 'Neon retro-future — gated drive at dusk.', detail: 'Upbeat · straight · bright synth lead, gated-reverb kit.', style: 'synthwave', swatch: 'linear-gradient(135deg, #2a0e44, #22e6ff)', hues: ['#ff77e0', '#22e6ff'] },
  { id: 610, name: 'Gospel ✦', cost: 13000, desc: 'Rich, soulful, uplifting — lush extended changes.', detail: 'Mid · swung · 9th/13th keys, walking bass, warm ride.', style: 'gospel', swatch: 'linear-gradient(135deg, #2a1a08, #b985ff)', hues: ['#ffcf6b', '#b985ff'] },
  { id: 611, name: 'Lounge ✦', cost: 10000, desc: 'Smooth easy-listening — a velvet hotel bar.', detail: 'Mid · light swing · mellow keys, soft brushed kit.', style: 'lounge', swatch: 'linear-gradient(135deg, #221a0a, #5fe0c6)', hues: ['#ffe6a8', '#5fe0c6'] },
  { id: 612, name: 'Trip-Hop ✦', cost: 11000, desc: 'Dark, heavy, downtempo — dusty halftime weight.', detail: 'Slow · halftime · heavy crushed kit, deep root bass.', style: 'triphop', swatch: 'linear-gradient(135deg, #07101c, #6a4aff)', hues: ['#5a6aff', '#3a3d6a'] },
  { id: 613, name: 'Neo-Soul ✦', cost: 13000, desc: 'Laid-back R&B pocket — buttery and warm.', detail: 'Mid · swung · lush 9th keys, pocket octave bass.', style: 'neosoul', swatch: 'linear-gradient(135deg, #1a0e1f, #ff9ecf)', hues: ['#c8a6ff', '#ff9ecf'] },
  { id: 614, name: 'Vaporwave ✦', cost: 10000, desc: 'Washed, melted, nostalgic — slowed and reverbed.', detail: 'Slow · halftime · heavy reverb wash, soft sparse kit.', style: 'vaporwave', swatch: 'linear-gradient(135deg, #2a1030, #5ad4ff)', hues: ['#ff9ecf', '#a6e6ff'] },
  { id: 615, name: 'Acoustic ✦', cost: 11000, desc: 'Organic nylon-guitar warmth — unplugged and woody.', detail: 'Mid-slow · light swing · nylon-pluck lead, soft natural kit.', style: 'acoustic', swatch: 'linear-gradient(135deg, #221608, #d8b48c)', hues: ['#e8d0a8', '#c89a6a'] },
  { id: 616, name: 'Jazz Waltz ✦', cost: 11000, desc: 'A gentle 3/4 lilt — a café waltz sway.', detail: 'Mid · swung · lilting 3/4 brushed waltz kit.', style: 'waltz', swatch: 'linear-gradient(135deg, #1a1430, #ffcf6b)', hues: ['#c8a6ff', '#ffcf6b'] },
  { id: 617, name: 'Cool Cat', cost: 4000, desc: 'Brushed and unhurried — a modal stroll on a walking bass.', detail: 'Easy mid-tempo · swung · brushed modal keys, mellow walking bass.', style: 'cooljazz', swatch: 'linear-gradient(135deg, #0e1a2a, #6ba3d6)', hues: ['#bcdcff', '#6ba3d6'] },
  { id: 618, name: 'Voltage', cost: 4500, desc: 'Electric-piano shimmer, syncopated and lush — plugged right in.', detail: 'Faster · light swing · lush electric-piano, syncopated octave bass.', style: 'fusion', swatch: 'linear-gradient(135deg, #1a0e2a, #b07cff)', hues: ['#d9c2ff', '#b07cff'] },
  { id: 619, name: 'Snappy', cost: 4500, desc: 'Quick, springy bebop — toes tapping all on their own.', detail: 'Brisk · heavy swing · gentle bebop bounce, busy walking bass.', style: 'bop', swatch: 'linear-gradient(135deg, #2a1a0e, #ff9a4a)', hues: ['#ffd2a0', '#ff9a4a'] },
  { id: 620, name: 'Kind of Calm', cost: 4000, desc: 'Suspended, spacious, blue — a wide open chord to drift in.', detail: 'Slower · nearly straight · suspended modal space, airy reverb, fifth bass.', style: 'modal', swatch: 'linear-gradient(135deg, #0a1424, #4a7fb0)', hues: ['#a8cdf0', '#4a7fb0'] },
  { id: 621, name: 'After Hours', cost: 4500, desc: 'Smoky, dim, and slow — the last set of the night.', detail: 'Slow · swung · smoky dark tone, deep reverb, sparse walking bass.', style: 'noir', swatch: 'linear-gradient(135deg, #050810, #3a4a66)', hues: ['#8a9ec4', '#3a4a66'] },
  { id: 622, name: 'Seaside', cost: 4000, desc: 'A breezy Latin lilt — sand between your toes.', detail: 'Bright tempo · straight halftime · gentle bossa lilt, mellow fifth bass.', style: 'bossa', swatch: 'linear-gradient(135deg, #0e2a22, #4ad6a0)', hues: ['#a8ffe0', '#4ad6a0'] },
  { id: 623, name: 'Velvet', cost: 4000, desc: 'Warm soul-jazz with a little grit — easy and rich.', detail: 'Easy upbeat · light swing · warm soulful keys, gritty octave bass.', style: 'soul', swatch: 'linear-gradient(135deg, #2a0e1a, #d65a8f)', hues: ['#ffb0cf', '#d65a8f'] },
  { id: 624, name: 'Crate Dust', cost: 4500, desc: 'Chunky 90s boom-bap — heads nodding, crisp and crunchy.', detail: 'Mid-tempo · straight · crunchy boom-bap kit, plain chords, busy beats.', style: 'boombap', swatch: 'linear-gradient(135deg, #1a1810, #c0a060)', hues: ['#e0cc8a', '#c0a060'] },
  { id: 625, name: 'Driftwood', cost: 4500, desc: 'Drumless and dreamy — a slow tide of soft pads.', detail: 'Slowest · straight · drumless drift, dark soft pads, vast reverb.', style: 'ambient', swatch: 'linear-gradient(135deg, #0a1216, #6a8c9a)', hues: ['#bcd6e0', '#6a8c9a'] },
]
export const soundscapeById = (id: number): SoundscapeSpec => SOUNDSCAPES.find((s) => s.id === id) ?? SOUNDSCAPES[0]

// ── Cursor light (slot 7) — the little light that follows your cursor on the 3D floors ────────────────────
export interface CursorFxSpec {
  id: number
  name: string
  cost: number
  desc: string
  color: string
  intensity: number // 0 = off
  distance?: number
  disco?: boolean // cycle the hue over time
  swatch: string
  hues: string[]
}
export const CURSOR_FX: CursorFxSpec[] = [
  { id: 0, name: 'Candleglow', cost: 0, desc: 'A soft warm pool of light that trails your cursor.', color: '#ffe6b0', intensity: 2.2, swatch: 'radial-gradient(circle at 50% 50%, #ffe6b0, #2a1a08)', hues: ['#fff6dc', '#ffe6b0'] },
  { id: 701, name: 'Off', cost: 0, desc: 'No cursor light — keep the floor flat.', color: '#000000', intensity: 0, swatch: 'linear-gradient(135deg, #1a1c28, #0a0b12)', hues: ['#3a3d4f'] },
  { id: 702, name: 'Frostpoint', cost: 3000, desc: 'A cool cyan pinpoint.', color: '#9fe6ff', intensity: 2.6, swatch: 'radial-gradient(circle at 50% 50%, #9fe6ff, #06121f)', hues: ['#cfeeff', '#5ad4ff'] },
  { id: 703, name: 'Ember', cost: 3000, desc: 'A warm coal-red glow.', color: '#ff7a4a', intensity: 2.8, swatch: 'radial-gradient(circle at 50% 50%, #ff7a4a, #1a0a06)', hues: ['#ffb088', '#ff6a3a'] },
  { id: 704, name: 'Spotlight', cost: 5000, desc: 'A bright white follow-spot — picks out every gem.', color: '#ffffff', intensity: 5, distance: 5.5, swatch: 'radial-gradient(circle at 50% 50%, #ffffff, #2a2d38)', hues: ['#ffffff', '#eef2ff'] },
  { id: 705, name: 'Disco 🪩', cost: 8000, desc: 'WTF mode — a rainbow that never sits still.', color: '#ff5db0', intensity: 3.6, distance: 5, disco: true, swatch: 'conic-gradient(from 0deg, #ff5d8f, #ffcf6b, #5fe0c6, #b985ff, #ff5d8f)', hues: ['#ff5d8f', '#5fe0c6', '#b985ff'] },
  { id: 706, name: 'Wisp', cost: 3200, desc: "A pale will-o'-the-wisp green that drifts wherever you wander.", color: '#a6f0b8', intensity: 2.4, swatch: 'radial-gradient(circle at 50% 50%, #a6f0b8, #07140d)', hues: ['#d4ffe0', '#5fd98a'] },
  { id: 707, name: 'Amethyst', cost: 4200, desc: 'A soft violet glow, like a gem catching the evening light.', color: '#b388ff', intensity: 2.7, swatch: 'radial-gradient(circle at 50% 50%, #b388ff, #110a1f)', hues: ['#d9c4ff', '#8a5cff'] },
  { id: 708, name: 'Rosewater', cost: 4800, desc: 'A tender rose-pink that makes every floor feel a little fonder.', color: '#ff9ec4', intensity: 2.8, swatch: 'radial-gradient(circle at 50% 50%, #ff9ec4, #1f0a14)', hues: ['#ffd0e4', '#ff6fae'] },
  { id: 709, name: 'Lagoon', cost: 5600, desc: 'A breezy aqua-teal pool, like sunlight through shallow water.', color: '#4fe3d0', intensity: 3, swatch: 'radial-gradient(circle at 50% 50%, #4fe3d0, #05181a)', hues: ['#bdfff4', '#22c8b6'] },
  { id: 710, name: 'Gilded', cost: 9000, desc: 'A warm gold follow-spot that gives your cursor the star treatment.', color: '#ffd479', intensity: 3.4, distance: 5.2, swatch: 'radial-gradient(circle at 50% 50%, #ffd479, #1c1306)', hues: ['#ffeab0', '#ffbe3d'] },
  { id: 711, name: 'Sherbet', cost: 12000, desc: 'A slow pastel cycle that wanders through soft sherbet hues all day long.', color: '#ffc1e0', intensity: 3, distance: 5, disco: true, swatch: 'radial-gradient(circle at 50% 50%, #ffc1e0, #140a12)', hues: ['#ffc1e0', '#c7d4ff', '#bdf5d6'] },
]
export const cursorFxById = (id: number): CursorFxSpec => CURSOR_FX.find((c) => c.id === id) ?? CURSOR_FX[0]

// ── Atmosphere (slot 8) — volumetric scene mood: distance fog + drifting motes (+ extra path-trace haze) ─────
// Applies to the Orrery floor (fog + motes) and the hero stage (motes, plus deeper path-traced haze). id 0 =
// Clear: each scene keeps its native look. Themed atmospheres override the fog and add a drifting-mote layer;
// `haze` adds to the hero's path-traced volumetric haze (the effect we already had) so the mood carries into
// the path tracer too. Fog colour tints how distance fades; smaller fogFar = thicker.
export interface AtmosphereSpec {
  id: number
  name: string
  cost: number
  desc: string
  fog: string // distance-fog colour (hex)
  fogNear: number // fog start (world units from camera)
  fogFar: number // fog full-density distance (smaller = thicker)
  mote: string // drifting-mote colour (hex)
  moteCount: number // base mote count, ×gfx sparkle (0 = no mote layer)
  moteSize: number
  moteSpeed: number
  moteOpacity: number // 0..1
  haze: number // EXTRA path-trace volumetric haze on the hero, added to the gfx setting (0 = none)
  // optional ray-marched volumetric field (clouds / nebula) — a backdrop sphere of animated fbm noise
  vol?: { kind: 'clouds' | 'nebula'; colorA: string; colorB: string; colorC?: string; density: number; speed: number; scale: number }
  // optional volumetric scene effects — rendered by <Atmosphere> (groundFog/godRays/precip/aurora/smokePlume),
  // the Orrery (beams), or the post chain (shimmer); each costs nothing unless a preset sets it.
  groundFog?: { color: string; density: number; speed: number; thickness?: number; floor?: number; radius?: number }
  godRays?: { color: string; intensity: number; spread?: number; speed?: number; sunDir?: [number, number, number] }
  precip?: { kind: 'rain' | 'snow'; color: string; count: number; speed: number; area?: [number, number, number] }
  aurora?: { colorA: string; colorB: string; intensity: number; speed: number }
  smokePlume?: { color: string; density: number; speed: number; height?: number; radius?: number; pos?: [number, number, number] }
  beams?: { color?: string; intensity: number; length?: number } // Orrery flux beams — per-emitter light shafts
  shimmer?: { intensity: number; speed: number } // screen-space heat-haze (post chain)
  caustics?: { color: string; intensity: number; scale?: number; speed?: number; radius?: number; floor?: number } // rippling jewel-light on the floor
  petals?: { color: string; count: number; speed: number; area?: [number, number, number]; secondary?: string } // drifting petals/leaves
  meteors?: { color: string; count: number; speed: number; area?: [number, number, number] } // shooting stars
  clouds?: { colorLight: string; colorDark: string; density: number; coverage: number; speed: number; scale?: number; sunDir?: [number, number, number] } // self-shadowed lit clouds
  swatch: string
  hues: string[]
}
export const ATMOSPHERES: AtmosphereSpec[] = [
  { id: 0, name: 'Clear', cost: 0, desc: 'The default — clean air, just the scene’s own gentle depth.', fog: '#0a0b14', fogNear: 10, fogFar: 30, mote: '#ffffff', moteCount: 0, moteSize: 1.5, moteSpeed: 0.3, moteOpacity: 0.5, haze: 0, swatch: 'linear-gradient(135deg, #0a0b14, #2a2d3a)', hues: ['#cdd6ea', '#3a3d4f'] },
  { id: 901, name: 'Mist', cost: 4000, desc: 'A soft pale haze rolls in, softening everything in the distance.', fog: '#7e8aa0', fogNear: 3, fogFar: 16, mote: '#dfe6f2', moteCount: 30, moteSize: 1.4, moteSpeed: 0.14, moteOpacity: 0.5, haze: 0.06, swatch: 'linear-gradient(135deg, #2a3340, #aeb9cc)', hues: ['#dfe6f2', '#aeb9cc', '#7e8aa0'] },
  { id: 902, name: 'Dust Motes', cost: 4500, desc: 'Warm flecks of dust drift lazily through a stray sunbeam.', fog: '#1a140c', fogNear: 8, fogFar: 28, mote: '#ffcf8a', moteCount: 80, moteSize: 1.6, moteSpeed: 0.12, moteOpacity: 0.55, haze: 0.04, swatch: 'linear-gradient(135deg, #1a140c, #ffcf8a)', hues: ['#fff0d0', '#ffcf8a', '#d9a35c'] },
  { id: 903, name: 'Deep Fog', cost: 5000, desc: 'A thick, hushed dark that swallows the far edges of the room.', fog: '#0a0d12', fogNear: 2, fogFar: 12, mote: '#3a4458', moteCount: 24, moteSize: 1.2, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.1, swatch: 'linear-gradient(135deg, #04060a, #3a4458)', hues: ['#5a6478', '#3a4458', '#1a1f2a'] },
  { id: 904, name: 'Smoke', cost: 11000, desc: 'Slow grey smoke curls and pools — the gem floats in a soft cloud.', fog: '#3a3d44', fogNear: 3, fogFar: 15, mote: '#9aa0aa', moteCount: 44, moteSize: 2.0, moteSpeed: 0.2, moteOpacity: 0.4, haze: 0.18, swatch: 'linear-gradient(135deg, #1a1c20, #9aa0aa)', hues: ['#c8ccd2', '#9aa0aa', '#5a5d64'] },
  { id: 905, name: 'Snowfall', cost: 7500, desc: 'Quiet flurries of white drift down through the cold blue air.', fog: '#0e1622', fogNear: 6, fogFar: 26, mote: '#ffffff', moteCount: 120, moteSize: 1.4, moteSpeed: 0.34, moteOpacity: 0.85, haze: 0.03, swatch: 'linear-gradient(135deg, #0e1622, #ffffff)', hues: ['#ffffff', '#dcefff', '#a6c8e0'] },
  { id: 906, name: 'Embersoot', cost: 8000, desc: 'Glowing embers and soot rise on the warm draft of a dying fire.', fog: '#160a06', fogNear: 6, fogFar: 24, mote: '#ff7a3a', moteCount: 70, moteSize: 1.8, moteSpeed: 0.4, moteOpacity: 0.75, haze: 0.08, swatch: 'linear-gradient(135deg, #160a06, #ff7a3a)', hues: ['#ffd0a0', '#ff7a3a', '#d63a1a'] },
  { id: 907, name: 'Spores', cost: 5500, desc: 'Tiny luminous spores float up from some unseen forest floor.', fog: '#0a160e', fogNear: 6, fogFar: 24, mote: '#9fffb0', moteCount: 90, moteSize: 1.5, moteSpeed: 0.12, moteOpacity: 0.55, haze: 0.05, swatch: 'linear-gradient(135deg, #0a160e, #9fffb0)', hues: ['#d4ffe0', '#9fffb0', '#4fd97a'] },
  { id: 908, name: 'Nebula Drift', cost: 9000, desc: 'A violet cosmic mist with motes adrift like distant stars.', fog: '#140a22', fogNear: 5, fogFar: 24, mote: '#c79bff', moteCount: 100, moteSize: 1.7, moteSpeed: 0.16, moteOpacity: 0.6, haze: 0.07, swatch: 'linear-gradient(135deg, #140a22, #c79bff)', hues: ['#e6d4ff', '#c79bff', '#8a5cff'] },
  { id: 909, name: 'Aurora Veil', cost: 7000, desc: 'A teal-green veil shimmers and drifts like polar light.', fog: '#08201c', fogNear: 5, fogFar: 24, mote: '#7affd0', moteCount: 80, moteSize: 1.6, moteSpeed: 0.18, moteOpacity: 0.55, haze: 0.06, swatch: 'linear-gradient(135deg, #08201c, #7affd0)', hues: ['#c4fff0', '#7affd0', '#3ad9a0'] },
  // ── Volumetric clouds & nebula (ray-marched fbm field) — premium showpieces ──
  { id: 910, name: 'Cloudbank', cost: 10000, desc: 'Soft luminous clouds roll slowly across the whole sky.', fog: '#10141c', fogNear: 7, fogFar: 28, mote: '#dfe9ff', moteCount: 24, moteSize: 1.4, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.05, vol: { kind: 'clouds', colorA: '#cfe0ff', colorB: '#ffffff', colorC: '#9fb4e0', density: 0.6, speed: 0.5, scale: 0.13 }, swatch: 'linear-gradient(135deg, #10141c, #cfe0ff)', hues: ['#ffffff', '#cfe0ff', '#9fb4e0'] },
  { id: 911, name: 'Golden Clouds', cost: 11000, desc: 'Warm amber cloudbanks glow like a sky at golden hour.', fog: '#1a1206', fogNear: 7, fogFar: 28, mote: '#ffd9a0', moteCount: 30, moteSize: 1.5, moteSpeed: 0.12, moteOpacity: 0.45, haze: 0.06, vol: { kind: 'clouds', colorA: '#ffd27a', colorB: '#ffae3a', colorC: '#ff8a5c', density: 0.6, speed: 0.45, scale: 0.12 }, swatch: 'linear-gradient(135deg, #1a1206, #ffd27a)', hues: ['#fff0c4', '#ffd27a', '#ff8a5c'] },
  { id: 912, name: 'Storm Veil', cost: 12000, desc: 'Restless blue-grey storm clouds churn and glow overhead.', fog: '#0c0f16', fogNear: 5, fogFar: 22, mote: '#aeb9cc', moteCount: 36, moteSize: 1.6, moteSpeed: 0.3, moteOpacity: 0.45, haze: 0.09, vol: { kind: 'clouds', colorA: '#6a7a9a', colorB: '#aeb9cc', colorC: '#3a4458', density: 0.72, speed: 0.95, scale: 0.14 }, swatch: 'linear-gradient(135deg, #0c0f16, #aeb9cc)', hues: ['#cdd6ea', '#aeb9cc', '#5a6478'] },
  { id: 913, name: 'Crimson Nebula', cost: 13000, desc: 'A vast red-and-rose nebula billows through deep space.', fog: '#160610', fogNear: 6, fogFar: 26, mote: '#ff9ec4', moteCount: 60, moteSize: 1.6, moteSpeed: 0.14, moteOpacity: 0.55, haze: 0.07, vol: { kind: 'nebula', colorA: '#ff5a6e', colorB: '#ffae6b', colorC: '#b03a8f', density: 0.5, speed: 0.7, scale: 0.1 }, swatch: 'linear-gradient(135deg, #160610, #ff5a6e)', hues: ['#ffae6b', '#ff5a6e', '#b03a8f'] },
  { id: 914, name: 'Emerald Nebula', cost: 13000, desc: 'Curtains of green and teal gas drift among the stars.', fog: '#04140f', fogNear: 6, fogFar: 26, mote: '#9fffd0', moteCount: 60, moteSize: 1.6, moteSpeed: 0.14, moteOpacity: 0.55, haze: 0.07, vol: { kind: 'nebula', colorA: '#3affc0', colorB: '#5fe0c6', colorC: '#2a8f6a', density: 0.5, speed: 0.7, scale: 0.1 }, swatch: 'linear-gradient(135deg, #04140f, #3affc0)', hues: ['#c4fff0', '#3affc0', '#2a8f6a'] },
  { id: 915, name: 'Stellar Nursery', cost: 16000, desc: 'A glowing cradle of newborn stars in pink, blue and violet.', fog: '#0a0820', fogNear: 6, fogFar: 26, mote: '#ffffff', moteCount: 90, moteSize: 1.5, moteSpeed: 0.16, moteOpacity: 0.7, haze: 0.08, vol: { kind: 'nebula', colorA: '#ff8fd0', colorB: '#6aa6ff', colorC: '#b985ff', density: 0.55, speed: 0.6, scale: 0.09 }, swatch: 'linear-gradient(135deg, #0a0820, #ff8fd0)', hues: ['#ff8fd0', '#6aa6ff', '#b985ff'] },
  { id: 916, name: 'Sandstorm', cost: 12000, desc: 'A whirling wall of tan dust sweeps across the desert air.', fog: '#1a1206', fogNear: 4, fogFar: 18, mote: '#d9b87a', moteCount: 90, moteSize: 1.6, moteSpeed: 0.5, moteOpacity: 0.5, haze: 0.1, vol: { kind: 'clouds', colorA: '#d9b87a', colorB: '#c2956a', colorC: '#8a6a3a', density: 0.7, speed: 1.2, scale: 0.14 }, swatch: 'linear-gradient(135deg, #1a1206, #d9b87a)', hues: ['#f0d6a0', '#d9b87a', '#8a6a3a'] },
  { id: 917, name: 'Toxic Cloud', cost: 12000, desc: 'Sickly green vapour curls and glows — best admired from afar.', fog: '#0c1606', fogNear: 5, fogFar: 20, mote: '#aef03a', moteCount: 50, moteSize: 1.6, moteSpeed: 0.3, moteOpacity: 0.5, haze: 0.08, vol: { kind: 'clouds', colorA: '#aef03a', colorB: '#7bff1f', colorC: '#3a7a1a', density: 0.6, speed: 0.7, scale: 0.12 }, swatch: 'linear-gradient(135deg, #0c1606, #aef03a)', hues: ['#d4ff7a', '#aef03a', '#3a7a1a'] },
  { id: 918, name: 'Ion Storm', cost: 13000, desc: 'Crackling electric-blue plasma drifts in charged sheets.', fog: '#060f1c', fogNear: 6, fogFar: 26, mote: '#7fd0ff', moteCount: 70, moteSize: 1.6, moteSpeed: 0.2, moteOpacity: 0.6, haze: 0.08, vol: { kind: 'nebula', colorA: '#3a8fff', colorB: '#5fe0ff', colorC: '#7a3aff', density: 0.5, speed: 1.1, scale: 0.1 }, swatch: 'linear-gradient(135deg, #060f1c, #5fe0ff)', hues: ['#bdeeff', '#5fe0ff', '#7a3aff'] },
  { id: 919, name: 'Supernova', cost: 18000, desc: 'A blinding bloom of gold and fire — a star giving everything.', fog: '#1a0e06', fogNear: 6, fogFar: 26, mote: '#fff0c4', moteCount: 100, moteSize: 1.6, moteSpeed: 0.18, moteOpacity: 0.7, haze: 0.1, vol: { kind: 'nebula', colorA: '#fff0c4', colorB: '#ffae3a', colorC: '#ff5a3a', density: 0.6, speed: 0.8, scale: 0.085 }, swatch: 'linear-gradient(135deg, #1a0e06, #ffae3a)', hues: ['#fff0c4', '#ffae3a', '#ff5a3a'] },
  { id: 920, name: 'Bioluminescence', cost: 8000, desc: 'Cool cyan glimmers drift like deep-sea creatures in the dark.', fog: '#04101a', fogNear: 5, fogFar: 24, mote: '#5fffd0', moteCount: 110, moteSize: 1.5, moteSpeed: 0.1, moteOpacity: 0.7, haze: 0.05, swatch: 'linear-gradient(135deg, #04101a, #5fffd0)', hues: ['#bdfff0', '#5fffd0', '#2ac0a0'] },
  { id: 921, name: 'Fireflies', cost: 7000, desc: 'Warm golden sparks blink lazily through a summer-night hush.', fog: '#0a1208', fogNear: 7, fogFar: 26, mote: '#ffe08a', moteCount: 60, moteSize: 1.8, moteSpeed: 0.14, moteOpacity: 0.8, haze: 0.04, swatch: 'linear-gradient(135deg, #0a1208, #ffe08a)', hues: ['#fff0c4', '#ffe08a', '#d9a83a'] },
  // ── Volumetric scene effects (god rays · ground fog · rain/snow · aurora · steam · heat · flux beams) ──
  { id: 922, name: 'Cathedral Light', cost: 12000, desc: 'Soft golden shafts of light pour down through the still air.', fog: '#10100a', fogNear: 8, fogFar: 28, mote: '#fff0c4', moteCount: 30, moteSize: 1.4, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.05, godRays: { color: '#fff0c4', intensity: 0.5, sunDir: [0.5, 0.8, 0.3] }, swatch: 'linear-gradient(135deg, #10100a, #fff0c4)', hues: ['#fff6dc', '#fff0c4', '#ffcf6b'] },
  { id: 923, name: 'Marsh', cost: 9000, desc: 'A low green mist rolls and pools across the quiet wetland floor.', fog: '#0a1410', fogNear: 6, fogFar: 24, mote: '#bfffd0', moteCount: 40, moteSize: 1.4, moteSpeed: 0.1, moteOpacity: 0.45, haze: 0.05, groundFog: { color: '#9fd6c0', density: 0.7, speed: 0.3 }, swatch: 'linear-gradient(135deg, #0a1410, #9fd6c0)', hues: ['#d4ffe6', '#9fd6c0', '#4f9d7a'] },
  { id: 924, name: 'Graveyard', cost: 10000, desc: 'Pale fog creeps thick and slow along the cold, still ground.', fog: '#0c0e16', fogNear: 5, fogFar: 22, mote: '#dfe6f2', moteCount: 20, moteSize: 1.3, moteSpeed: 0.08, moteOpacity: 0.4, haze: 0.07, groundFog: { color: '#cfe0ff', density: 0.9, speed: 0.2, thickness: 1.4, radius: 9 }, swatch: 'linear-gradient(135deg, #0c0e16, #cfe0ff)', hues: ['#ffffff', '#cfe0ff', '#9fb0cc'] },
  { id: 925, name: 'Rainstorm', cost: 11000, desc: 'A steady downpour streaks through the grey, rain-washed dark.', fog: '#0a0e16', fogNear: 5, fogFar: 24, mote: '#9fc0e0', moteCount: 0, moteSize: 1.4, moteSpeed: 0.3, moteOpacity: 0.5, haze: 0.06, precip: { kind: 'rain', color: '#9fc0e0', count: 1200, speed: 1.4 }, swatch: 'linear-gradient(135deg, #0a0e16, #9fc0e0)', hues: ['#cfe0f4', '#9fc0e0', '#5a7a9a'] },
  { id: 926, name: 'Blizzard', cost: 11000, desc: 'Thick snow whirls down through a hushed, freezing white-out.', fog: '#0e1622', fogNear: 4, fogFar: 20, mote: '#ffffff', moteCount: 0, moteSize: 1.4, moteSpeed: 0.3, moteOpacity: 0.7, haze: 0.05, precip: { kind: 'snow', color: '#ffffff', count: 900, speed: 0.5 }, swatch: 'linear-gradient(135deg, #0e1622, #ffffff)', hues: ['#ffffff', '#dcefff', '#a6c8e0'] },
  { id: 927, name: 'Aurora Borealis', cost: 14000, desc: 'Curtains of green and violet light ripple across the night.', fog: '#040a14', fogNear: 6, fogFar: 26, mote: '#ffffff', moteCount: 60, moteSize: 1.3, moteSpeed: 0.12, moteOpacity: 0.6, haze: 0.05, aurora: { colorA: '#3affc0', colorB: '#7a3aff', intensity: 1.0, speed: 0.5 }, swatch: 'linear-gradient(135deg, #040a14, #3affc0)', hues: ['#7affd0', '#3affc0', '#7a3aff'] },
  { id: 928, name: 'Steam Room', cost: 10000, desc: 'A warm column of steam curls and rises through the cosy haze.', fog: '#1a1208', fogNear: 6, fogFar: 24, mote: '#ffd9a0', moteCount: 20, moteSize: 1.4, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.06, smokePlume: { color: '#ffcaa0', density: 0.8, speed: 1.0, pos: [0, -0.3, 0] }, swatch: 'linear-gradient(135deg, #1a1208, #ffcaa0)', hues: ['#ffe6c4', '#ffcaa0', '#d99a6a'] },
  { id: 929, name: 'Desert Heat', cost: 11000, desc: 'The air ripples and shimmers in the dry, baking afternoon.', fog: '#1a1206', fogNear: 7, fogFar: 26, mote: '#ffd9a0', moteCount: 60, moteSize: 1.5, moteSpeed: 0.3, moteOpacity: 0.5, haze: 0.04, shimmer: { intensity: 0.006, speed: 1.0 }, swatch: 'linear-gradient(135deg, #1a1206, #ffd9a0)', hues: ['#fff0c4', '#ffd9a0', '#d9a35c'] },
  { id: 930, name: 'Flux Cascade', cost: 13000, desc: 'In the Orrery, each deployed shape sheds a visible shaft of streaming flux-light along its facing.', fog: '#0a0b14', fogNear: 8, fogFar: 28, mote: '#ffcf6b', moteCount: 0, moteSize: 1.5, moteSpeed: 0.2, moteOpacity: 0.5, haze: 0.04, beams: { intensity: 1.0, length: 4 }, swatch: 'linear-gradient(135deg, #0a0b14, #ffcf6b)', hues: ['#fff6dc', '#ffcf6b', '#ffae3a'] },
  // ── Caustics · petals · meteors · self-shadowed clouds ──
  { id: 931, name: 'Jewel Caustics', cost: 14000, desc: 'Refracted light ripples and dances across the floor, as if cast by the gems themselves.', fog: '#0a0d14', fogNear: 8, fogFar: 28, mote: '#bfe6ff', moteCount: 24, moteSize: 1.3, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.04, caustics: { color: '#bfe6ff', intensity: 0.9 }, swatch: 'linear-gradient(135deg, #0a0d14, #bfe6ff)', hues: ['#e4f4ff', '#bfe6ff', '#7ac0e0'] },
  { id: 932, name: 'Golden Caustics', cost: 14000, desc: 'Warm amber light shimmers in bright woven veins along the ground.', fog: '#140e06', fogNear: 8, fogFar: 28, mote: '#ffd27a', moteCount: 24, moteSize: 1.3, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.04, caustics: { color: '#ffd27a', intensity: 1.0, scale: 1.4, speed: 0.8 }, swatch: 'linear-gradient(135deg, #140e06, #ffd27a)', hues: ['#fff0c4', '#ffd27a', '#d9a35c'] },
  { id: 933, name: 'Cherry Blossom', cost: 9000, desc: 'Soft pink petals drift and tumble gently down through the air.', fog: '#160e14', fogNear: 7, fogFar: 26, mote: '#ffd6ea', moteCount: 20, moteSize: 1.3, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.04, petals: { color: '#ffc8dd', count: 120, speed: 0.5 }, swatch: 'linear-gradient(135deg, #160e14, #ffc8dd)', hues: ['#fff0f6', '#ffc8dd', '#ff9ecf'] },
  { id: 934, name: 'Autumn Leaves', cost: 9000, desc: 'Amber and rust leaves tumble lazily down on the cool breeze.', fog: '#140c06', fogNear: 7, fogFar: 26, mote: '#ffb87a', moteCount: 20, moteSize: 1.4, moteSpeed: 0.1, moteOpacity: 0.4, haze: 0.04, petals: { color: '#ff9e4a', count: 90, speed: 0.6, secondary: '#d9622a' }, swatch: 'linear-gradient(135deg, #140c06, #ff9e4a)', hues: ['#ffd6a0', '#ff9e4a', '#d9622a'] },
  { id: 935, name: 'Meteor Shower', cost: 12000, desc: 'Bright shooting stars streak quietly across the night sky.', fog: '#06080f', fogNear: 8, fogFar: 28, mote: '#ffffff', moteCount: 70, moteSize: 1.2, moteSpeed: 0.14, moteOpacity: 0.7, haze: 0.04, meteors: { color: '#ffffff', count: 14, speed: 1.0 }, swatch: 'linear-gradient(135deg, #06080f, #ffffff)', hues: ['#ffffff', '#dce6ff', '#9fb4e0'] },
  { id: 936, name: 'Golden Streaks', cost: 12000, desc: 'Slow golden meteors trail warm light across the dark.', fog: '#100c06', fogNear: 8, fogFar: 28, mote: '#ffe6a8', moteCount: 60, moteSize: 1.3, moteSpeed: 0.14, moteOpacity: 0.7, haze: 0.04, meteors: { color: '#ffe6a8', count: 10, speed: 0.8 }, swatch: 'linear-gradient(135deg, #100c06, #ffe6a8)', hues: ['#fff6dc', '#ffe6a8', '#ffcf6b'] },
  { id: 937, name: 'Cloudscape', cost: 16000, desc: 'Soft sunlit clouds drift overhead, bright on top and shadowed below.', fog: '#10141c', fogNear: 8, fogFar: 30, mote: '#dfe9ff', moteCount: 16, moteSize: 1.3, moteSpeed: 0.08, moteOpacity: 0.35, haze: 0.04, clouds: { colorLight: '#ffffff', colorDark: '#6a7488', density: 1.0, coverage: 0.5, speed: 0.4, sunDir: [0.5, 0.8, 0.3] }, swatch: 'linear-gradient(135deg, #10141c, #ffffff)', hues: ['#ffffff', '#dfe9ff', '#9fb4cc'] },
  { id: 938, name: 'Storm Clouds', cost: 16000, desc: 'Heavy grey clouds roll and churn, dark-bellied and brooding.', fog: '#0c0e12', fogNear: 6, fogFar: 26, mote: '#aeb9cc', moteCount: 20, moteSize: 1.4, moteSpeed: 0.2, moteOpacity: 0.4, haze: 0.06, clouds: { colorLight: '#cfd6e0', colorDark: '#2a3038', density: 1.3, coverage: 0.7, speed: 0.7 }, swatch: 'linear-gradient(135deg, #0c0e12, #cfd6e0)', hues: ['#dce2ea', '#cfd6e0', '#3a4048'] },
]
export const atmosphereById = (id: number): AtmosphereSpec => ATMOSPHERES.find((a) => a.id === id) ?? ATMOSPHERES[0]

// ── Room decor (slot 5) — themed prop sets that dress the Room ("My Room") floor where your shapes roam ───
// `kind` selects a prop set rendered by RoomScene's <RoomDecor> (built from primitives — no external assets).
export interface DecorSpec {
  id: number
  name: string
  cost: number
  desc: string
  kind: 'bare' | 'cozy' | 'zen' | 'arcade' | 'starlit'
  swatch: string
  hues: string[]
}
export const DECOR: DecorSpec[] = [
  { id: 0, name: 'Bare Floor', cost: 0, desc: 'Just the gems and the grid — clean and open.', kind: 'bare', swatch: 'linear-gradient(135deg, #11131f, #1a1c28)', hues: ['#3a3d4f'] },
  { id: 801, name: 'Cozy Corner', cost: 4000, desc: 'A warm rug, a soft lamp, a couple of potted friends.', kind: 'cozy', swatch: 'radial-gradient(circle at 30% 60%, #ffd9a0, #5a3a4a)', hues: ['#ffd9a0', '#5a3a4a', '#4a8f4a'] },
  { id: 802, name: 'Zen Garden', cost: 4000, desc: 'Raked sand, a few quiet stones, one little bonsai.', kind: 'zen', swatch: 'radial-gradient(circle at 50% 50%, #cabf9a, #6a6e7e)', hues: ['#cabf9a', '#6a6e7e', '#4a8f4a'] },
  { id: 803, name: 'Neon Arcade', cost: 6000, desc: 'Standing neon rings and a glowing floor tile. WTF-adjacent.', kind: 'arcade', swatch: 'conic-gradient(from 0deg, #ff5d8f, #5fe0c6, #b985ff, #ff5d8f)', hues: ['#ff5d8f', '#5fe0c6', '#b985ff'] },
  { id: 804, name: 'Starlit Lanterns', cost: 6000, desc: 'Paper lanterns drifting on a warm night breeze.', kind: 'starlit', swatch: 'radial-gradient(circle at 50% 30%, #ffcf6b, #1a1430)', hues: ['#ffcf6b', '#ffae3a', '#fff3b0'] },
]
export const decorById = (id: number): DecorSpec => DECOR.find((d) => d.id === id) ?? DECOR[0]

// ── Unified shop catalogue ────────────────────────────────────────────────────
// One descriptor per class the Shop renders. `slot: 'scene'` routes through the scene path (its own core
// field); a numeric slot routes through the generic equip path. `comingSoon` classes render a teaser, no buy.
export interface ShopItem {
  id: number
  name: string
  cost: number
  desc: string
  detail?: string // optional second line: concretely what this unlocks (used by soundscapes)
  swatch: string
  hues: string[] // spark-burst palette for the purchase pop
}
export interface ShopCategory {
  key: string // i18n suffix + react key
  icon: string
  slot: 'scene' | number
  items: ShopItem[]
  comingSoon?: boolean
}

// Flux is abundant late-game (millions/day from idle), so cosmetics — the endgame Flux *sink* — are scaled up
// here to be a multi-session completionist goal rather than pocket change. The per-item specs above keep their
// readable relative tiers; tune the absolute economy with this single multiplier. (Free items stay free: 0×N=0.)
const SHOP_PRICE_SCALE = 20

const sceneItems: ShopItem[] = SCENES.map((s) => ({ id: s.id, name: s.name, cost: s.cost * SHOP_PRICE_SCALE, desc: s.desc, swatch: `linear-gradient(90deg, ${s.env[0]}, ${s.env[1]}, ${s.env[2]}, ${s.env[3]})`, hues: [s.stars, s.env[1], s.env[2], s.env[3]] }))
const finishItems: ShopItem[] = GEM_FINISHES.map((f) => ({ id: f.id, name: f.name, cost: f.cost * SHOP_PRICE_SCALE, desc: f.desc, swatch: f.swatch, hues: f.hues }))
const ceremonyItems: ShopItem[] = CEREMONIES.map((c) => ({ id: c.id, name: c.name, cost: c.cost * SHOP_PRICE_SCALE, desc: c.desc, swatch: c.swatch, hues: c.sparkHues ?? ['#fff6dc', '#ffe6a8', '#ffcf6b', '#ffae3a'] }))
const titleItems: ShopItem[] = TITLES.map((t) => ({ id: t.id, name: t.name, cost: t.cost * SHOP_PRICE_SCALE, desc: t.desc, swatch: t.swatch, hues: [t.color, '#ffffff', t.color] }))
const boardItems: ShopItem[] = BOARD_SKINS.map((b) => ({ id: b.id, name: b.name, cost: b.cost * SHOP_PRICE_SCALE, desc: b.desc, swatch: b.swatch, hues: b.hues }))
const lightingItems: ShopItem[] = LIGHTING_MOODS.map((l) => ({ id: l.id, name: l.name, cost: l.cost * SHOP_PRICE_SCALE, desc: l.desc, swatch: l.swatch, hues: l.hues }))
const soundscapeItems: ShopItem[] = SOUNDSCAPES.map((s) => ({ id: s.id, name: s.name, cost: s.cost * SHOP_PRICE_SCALE, desc: s.desc, detail: s.detail, swatch: s.swatch, hues: s.hues }))
const cursorItems: ShopItem[] = CURSOR_FX.map((c) => ({ id: c.id, name: c.name, cost: c.cost * SHOP_PRICE_SCALE, desc: c.desc, swatch: c.swatch, hues: c.hues }))
const atmosphereItems: ShopItem[] = ATMOSPHERES.map((a) => ({ id: a.id, name: a.name, cost: a.cost * SHOP_PRICE_SCALE, desc: a.desc, swatch: a.swatch, hues: a.hues }))
const decorItems: ShopItem[] = DECOR.map((d) => ({ id: d.id, name: d.name, cost: d.cost * SHOP_PRICE_SCALE, desc: d.desc, swatch: d.swatch, hues: d.hues }))

export const SHOP_CATEGORIES: ShopCategory[] = [
  { key: 'scenes', icon: '🌌', slot: 'scene', items: sceneItems },
  { key: 'atmosphere', icon: '🌫', slot: SLOT_ATMOSPHERE, items: atmosphereItems },
  { key: 'finishes', icon: '💎', slot: SLOT_FINISH, items: finishItems },
  { key: 'lighting', icon: '💡', slot: SLOT_LIGHTING, items: lightingItems },
  { key: 'cursor', icon: '🖱', slot: SLOT_CURSOR, items: cursorItems },
  { key: 'ceremony', icon: '✦', slot: SLOT_CEREMONY, items: ceremonyItems },
  { key: 'boards', icon: '⬡', slot: SLOT_BOARD, items: boardItems },
  { key: 'audio', icon: '🎵', slot: SLOT_SOUNDSCAPE, items: soundscapeItems },
  { key: 'titles', icon: '🏷', slot: SLOT_TITLE, items: titleItems },
  { key: 'decor', icon: '🪴', slot: SLOT_DECOR, items: decorItems },
]
