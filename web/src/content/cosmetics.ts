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
]

export const sceneById = (id: number): SceneSpec => SCENES.find((s) => s.id === id) ?? SCENES[0]
