// Chatlas — a procedurally-generated "curator group chat" feed (pure flavour, feel-layer only). Fake curator
// personas gossip about shapes, pulls, the grind, and shipping — filled with YOUR actual collection's nicks,
// so it feels like a living community reacting to the shapes you own. Endless via persona × template × fill.
import type { ShapeRow } from '../game/store'

export interface ChatMsg {
  handle: string
  color: string
  text: string
  sticker?: number // 1-based index into the sticker set; when set, render the image instead of text
}

// Chat stickers (cut from the art sheet into /public/stickers). Players send them; curators occasionally do too.
export const STICKER_COUNT = 8
export const stickerSrc = (i: number) => `${import.meta.env.BASE_URL}stickers/sticker${i}.webp`

const CURATORS: { handle: string; color: string }[] = [
  { handle: 'manifold_mae', color: '#5fe0c6' },
  { handle: 'genus_grinder', color: '#ffb86b' },
  { handle: 'dr_klein', color: '#b985ff' },
  { handle: 'toruswain', color: '#ff5d8f' },
  { handle: '4Dprophet', color: '#9ef0ff' },
  { handle: 'platonic_pat', color: '#9aa6c2' },
  { handle: 'spark_chaser', color: '#ffd76b' },
  { handle: 'lil_mobius', color: '#ff9d6b' },
  { handle: 'euler_stan', color: '#7fd0ff' },
  { handle: 'cozy_curator', color: '#c9a6ff' },
]

// Each template fills with one or two random shapes the player owns.
const TEMPLATES: ((a: ShapeRow, b: ShapeRow) => string)[] = [
  (a) => `ok ${a.nick} might be my favourite pull this week, no notes`,
  (a) => `does anyone actually main ${a.nick} or are we all just pretending`,
  (a, b) => `${a.nick} and ${b.nick} are SO obviously a pair. the kinship writes itself`,
  () => `pity hit at 29 AGAIN. who do i talk to about this`,
  (a) => `hot take: ${a.nick} is criminally underrated`,
  (a, b) => `forging ${a.nick} into ${b.nick} never gets old tbh`,
  (a) => `3am, flux ticking up, ${a.nick} keeping me company 🧘`,
  () => `who else is exactly one shape off completing the core 😭`,
  (a) => `${a.nick} rotated onto the featured banner, brb spending everything`,
  (a) => `reminder that ${a.nick} has genus ${a.genus}. let that sink in`,
  () => `the spark spilled to an SSR again. i'm not mad. just… disappointed`,
  (a) => `★5 ${a.nick} club, where you at`,
  (a, b) => `unpopular opinion: ${a.nick} carries harder than ${b.nick} and i WILL die on this hill`,
  () => `new curator just joined, everyone say hi 👋`,
  (a) => `i refuse to deploy ${a.nick}, it's too pretty to put to work`,
  (a) => `deployed ${a.nick} next to a knot and my flux went BRRR, arrangement is everything`,
  (a) => `petition to make ${a.nick} the mascot of the whole Manifold`,
  (a) => `tapped ${a.nick} for the 40th time today. we're friends now. it's normal`,
  () => `offline cap is so generous now, came back to a MOUNTAIN of flux`,
  (a) => `${a.nick} said something profound just now or maybe i need sleep`,
  (a, b) => `${a.nick} ➜ ${b.nick} pipeline is the only economy i trust`,
  () => `recrystallized again. the fourth dimension hits different`,
  (a) => `is it just me or is ${a.nick} kind of… the blueprint`,
  (a) => `genuinely emotional about owning ${a.nick}, what a shape`,
]

export function generateMessages(shapes: ShapeRow[], ownedIds: number[], n: number): ChatMsg[] {
  const pool = ownedIds.length ? ownedIds : shapes.map((s) => s.id)
  const pick = () => shapes[pool[Math.floor(Math.random() * pool.length)]]
  const out: ChatMsg[] = []
  for (let i = 0; i < n; i++) {
    const c = CURATORS[Math.floor(Math.random() * CURATORS.length)]
    // ~14% of the time a curator just drops a sticker
    if (Math.random() < 0.14) {
      out.push({ handle: c.handle, color: c.color, text: '', sticker: 1 + Math.floor(Math.random() * STICKER_COUNT) })
      continue
    }
    const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)]
    const a = pick()
    const b = pick()
    if (!a || !b) continue
    out.push({ handle: c.handle, color: c.color, text: t(a, b) })
  }
  return out
}
