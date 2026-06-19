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
]

export const SHIP_SCENES: Record<string, Ship> = Object.fromEntries(RAW.map((s) => [key(s.a, s.b), s]))
export const hasShip = (x: string, y: string) => key(x, y) in SHIP_SCENES

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
