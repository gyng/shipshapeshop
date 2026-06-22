import { create } from 'zustand'

// Ship "cutscenes": a short two-character dialogue that plays when you first UNITE a kin pair (own both),
// and is re-watchable from the inspector's Kinship row. Voices echo each shape's codex personality.

export interface ShipLine {
  who: 'a' | 'b'
  text: string
}
export interface Ship {
  a: string // family
  b: string // family
  lines: ShipLine[]
}

const key = (x: string, y: string) => [x, y].sort().join('|')
export const shipKey = key

const RAW: Ship[] = [
  { a: 'cube', b: 'octahedron', lines: [
    { who: 'a', text: 'Flat. Flat anywhere you look. …you, though — you’re all points.' },
    { who: 'b', text: 'Six of them! Count— touché. Six points, six faces. We’re the same, mirrored.' },
    { who: 'a', text: 'Duals. Swap my faces for your corners and I simply… become you.' },
    { who: 'b', text: 'So don’t lose me. You’d only be half a joke without your punchline.' },
  ] },
  { a: 'dodecahedron', b: 'icosahedron', lines: [
    { who: 'a', text: 'One need not choose a face to show, when every face is already given.' },
    { who: 'b', text: 'Twenty! …wait, where was— oh. Hello. You’re very calm.' },
    { who: 'a', text: 'You count; I rest. Twelve and twenty — dual, and done.' },
  ] },
  { a: 'catenoid', b: 'helicoid', lines: [
    { who: 'b', text: 'Race you! I love a head start.' },
    { who: 'a', text: 'There’s no need to race. Bend me slowly — I become you without a single tear.' },
    { who: 'b', text: '…oh. We were never apart. Just unrolled.' },
  ] },
  { a: 'trefoil', b: 'seifert', lines: [
    { who: 'a', text: 'I can’t be undone. That’s just— my whole edge is Surface.' },
    { who: 'b', text: 'And alone I’m a quiet sheet. Hand me a knot and I’m complete.' },
    { who: 'a', text: 'Neither of us is whole alone.' },
    { who: 'b', text: 'And we are both completely fine with that.' },
  ] },
  { a: 'torus', b: 'genus2', lines: [
    { who: 'a', text: 'Mind the hole, dear. …Tea?' },
    { who: 'b', text: 'Both lanes aligned, twice-checked! Did— did senpai look?' },
    { who: 'a', text: 'Glue two of me together and you get her. She just worries twice as much.' },
  ] },
  { a: 'mobius', b: 'klein_bottle', lines: [
    { who: 'a', text: 'One side. I keep telling people. Nobody believes a girl until she shows them.' },
    { who: 'b', text: 'Sew two of you together and you get… me. No inside at all.' },
    { who: 'a', text: 'You’re what I become when I stop apologising.' },
  ] },
  { a: 'tesseract', b: 'cell_16', lines: [
    { who: 'b', text: 'Hold still. I only hum before I decide. …the pattern reads blue.' },
    { who: 'a', text: 'You see all eight of my rooms at once now. It’s nice, being seen whole.' },
    { who: 'b', text: 'It’s not like I was aiming at you. Don’t make it weird.' },
  ] },
  { a: 'cell_120', b: 'cell_600', lines: [
    { who: 'a', text: 'You look flat from up here. And lovely. Come up.' },
    { who: 'b', text: 'A cathedral? Pretty. I am the WEATHER.' },
    { who: 'a', text: 'When she rattles the windows it’s only ever my house. She’d never crack a pane.' },
  ] },
  // warped classics ⇄ their parent shape
  { a: 'torus', b: 'twisted_torus', lines: [
    { who: 'a', text: 'Do sit still, dear. You’re making my tea slosh.' },
    { who: 'b', text: 'Can’t! Same hole as you — just wound up twice on the way round.' },
    { who: 'a', text: 'Still my little donut under all that fidgeting. …Mind the hole.' },
  ] },
  { a: 'sphere', b: 'cut_hollow_sphere', lines: [
    { who: 'a', text: 'You used to be round like me! All the way round.' },
    { who: 'b', text: 'Then someone took a slice. Now I’m open — and I can hold things. Pour something in?' },
    { who: 'a', text: 'A bowl made from a ball. You kept the best curve and gave the rest away.' },
  ] },
  { a: 'sphere', b: 'blobby', lines: [
    { who: 'b', text: 'Look! I grew arms. Six of them — every direction at once.' },
    { who: 'a', text: 'You’re still a ball, though. I can tell. Round right at your middle.' },
    { who: 'b', text: 'Round at heart, arms out wide. Squish me and I’d just be you again.' },
  ] },
  // the fractal family (Transcendent)
  { a: 'mandelbulb', b: 'mandelbox', lines: [
    { who: 'a', text: 'We came from the same little sum, you and I. Square it, add it back, again, again…' },
    { who: 'b', text: 'You bloomed outward. I folded inward. Same seed, different architecture.' },
    { who: 'a', text: 'Fall into me and you drift forever. Fall into you, and the hallways rebuild ahead of every step.' },
    { who: 'b', text: 'Two answers to one question. Neither of us ever finishes asking it.' },
  ] },
  { a: 'mandelbulb', b: 'julia', lines: [
    { who: 'b', text: 'You sweep the seed across every value. I pick just one and live inside it.' },
    { who: 'a', text: 'So you’re a single page of my whole book. A lovely page.' },
    { who: 'b', text: 'A page in four dimensions. What you hold is only my shadow — and even that has no end.' },
  ] },
  { a: 'apollonian', b: 'kleinian', lines: [
    { who: 'a', text: 'There’s always a gap for one more circle. Come — there’s room. There’s always room.' },
    { who: 'b', text: 'I fill mine with mirrors instead. Every reflection makes another arch.' },
    { who: 'a', text: 'Packed spheres and your endless spires. Cousins from the same bottomless idea.' },
  ] },
  // ── the NG+ cohort (Meta 4D + Transcendent 5D) ⇄ their nearest kin ──
  { a: 'sphere', b: 'spherinder_slice', lines: [
    { who: 'a', text: 'You sit just like me — low, easy. But you go on a little further, don’t you?' },
    { who: 'b', text: 'One dimension over. Most of me rests back there. This is the part that sits here, with you.' },
    { who: 'a', text: 'A ball, swept into a slab. Same nap, just longer. Stay as long as you like.' },
  ] },
  { a: 'clifford_torus', b: 'duocylinder', lines: [
    { who: 'b', text: 'Two circles, two turns, one of me from both. And you’re the round version of the very same idea.' },
    { who: 'a', text: 'The flat torus. I curve where you keep your corners.' },
    { who: 'b', text: 'Cousins, then. Round and squared, both at once — the only pair that lies truly flat down here.' },
  ] },
  { a: 'cell_24', b: 'cell24_section', lines: [
    { who: 'b', text: 'Square to triangle, triangle to square — one clean cut of you, taken at the waist.' },
    { who: 'a', text: 'My equator. I cast no shadow in three dimensions but this — this is my truest slice.' },
    { who: 'b', text: 'Whole only together: half a cube, half an octahedron, all of your middle.' },
  ] },
  { a: 'torus', b: 'ditorus', lines: [
    { who: 'a', text: 'Mind the hole, dear. …goodness — you’ve gone and put a hole through your hole.' },
    { who: 'b', text: 'Couldn’t help it! Bored a tunnel clean through your dough. A loop, inside the loop.' },
    { who: 'a', text: 'Still my little donut, threaded twice over. …Tea? It’ll have to go round both times.' },
  ] },
  { a: 'aizawa_attractor', b: 'lorenz', lines: [
    { who: 'b', text: 'Same pebble, same moment, same loop-de-loop — ooh, butterfly. You feel it too, cousin?' },
    { who: 'a', text: 'Every time! Same nudge from the same start, and still I wander somewhere new. Determined isn’t predictable.' },
    { who: 'b', text: 'The chaos cousins, then. You spin your funnel, I flap my wings — neither of us ever once repeats.' },
  ] },
  { a: 'barth_sextic', b: 'endrass_octic', lines: [
    { who: 'a', text: 'Sixty-five pinch-points, the most a sextic may carry — and I wear them like a crown.' },
    { who: 'b', text: 'A crown is sweet. I carry a hundred and sixty-eight. Count my crossings if you doubt me — go on, I’ll wait.' },
    { who: 'a', text: 'Record-holders both, then — each the most our degree allows. Algebra’s proudest pair.' },
  ] },
]

export const SHIP_SCENES: Record<string, Ship> = Object.fromEntries(RAW.map((s) => [key(s.a, s.b), s]))
export const hasShip = (x: string, y: string) => key(x, y) in SHIP_SCENES

type ShipShape = { id: number; family: string; nick: string; rarity: string }
// Cutscenes you've UNLOCKED (own both shapes) but not yet watched — surfaced as a Gallery notification so the
// player starts them at leisure instead of having them pop up mid-play.
export function availableShips(shapes: ShipShape[], owned: number[] | undefined, seen: string[]) {
  const out: { key: string; a: ShipShape; b: ShipShape }[] = []
  if (!owned) return out
  for (const k of Object.keys(SHIP_SCENES)) {
    if (seen.includes(k)) continue
    const sc = SHIP_SCENES[k]
    const a = shapes.find((s) => s.family === sc.a)
    const b = shapes.find((s) => s.family === sc.b)
    if (a && b && (owned[a.id] ?? 0) > 0 && (owned[b.id] ?? 0) > 0) out.push({ key: k, a, b })
  }
  return out
}

const SEEN_KEY = 'shipshape-ships-v1'
function loadSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
  } catch {
    return []
  }
}

interface ShipStore {
  active: string | null // ship key currently playing
  seen: string[]
  open: (a: string, b: string) => void
  close: () => void
}
export const useShips = create<ShipStore>((set, get) => ({
  active: null,
  seen: loadSeen(),
  open: (a, b) => {
    const k = key(a, b)
    if (!(k in SHIP_SCENES)) return
    const seen = get().seen.includes(k) ? get().seen : [...get().seen, k]
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
    } catch {
      /* ignore */
    }
    set({ active: k, seen })
  },
  close: () => set({ active: null }),
}))
