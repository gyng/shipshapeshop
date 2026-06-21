// Tap-to-chat flavour lines (gacha "my room" idle chatter). Bespoke lines for the cast, in each character's
// voice (see codex.ts / CHARACTERS.md); shapes without bespoke lines fall back to their codex blurb/bond, so
// every owned shape has *something* to say. Short, voice-y, spoken via the synth voice on tap.
import { CODEX } from './codex'

export const CHATTER: Record<string, string[]> = {
  sphere: ['Round day, isn’t it?', 'No corners, no worries.', 'I’ll roll wherever you need me.'],
  cube: ['Still flat. I checked.', 'Stack me. I won’t mind.', 'Six faces. Zero opinions.'],
  octahedron: ['En garde! …oh. It’s you.', 'Eight faces, all of them sharp.', 'Point taken. Literally.'],
  dodecahedron: ['Twelve pentagons, perfectly composed.', 'One does try to keep one’s poise.', 'A pleasure, as always.'],
  icosahedron: ['Twenty faces and proud of each.', 'Roll me — I dare you.', 'The most a Platonic solid can be.'],
  cylinder: ['Cans. Just… cans.', 'I roll one way. It’s a lifestyle.'],
  cone: ['Pointy end up, please.', 'One scoop or two?'],
  torus: ['Is the hole half-empty, or half-full?', 'Don’t mind me — just worrying.', 'One loop, round and round.'],
  mobius: ['One side. I checked both — same side.', 'Follow my edge; you’ll come back… flipped.', 'Left is right is left, with me.'],
  genus2: ['Two holes, so I worry in stereo.', 'Glued from two worriers. It shows.'],
  trefoil: ['I can’t be undone — that’s just— my whole thing.', 'Three crossings, one me.', 'Go on, try to untangle me.'],
  klein_bottle: ['Inside is outside is in— where was I?', 'Pour me a drink; it spills back into me.', 'No inside. No outside. Just me, folding through.'],
  rp2: ['Every line through me comes home.', 'I live one dimension up; you get the shadow.'],
  tesseract: ['You only ever see my shadow.', 'In four dimensions, I’m perfectly ordinary.', 'Rotate me — mind the corners.'],
  cell_16: ['…', 'Pattern recognised. Acceptable.', 'I do not blink. I have no need.'],
  lorenz: ['Flap— sorry, a butterfly— anyway—', 'One tiny nudge and I’m a different me.', 'I never repeat. Probably.'],
  klein_quartic: ['Three holes, three hundred and thirty-six symmetries — keep up.', 'Perfectly balanced, as a quartic should be.'],
  utah_teapot: ['I’ve been rendered more than anyone alive.', 'Short and stout, and famous for it.', 'Tip me — the spout knows the way.'],
  stanford_bunny: ['Hop. Still here since ’94.', 'Every demo, every paper — that’s me.'],
  benchy: ['Built to be hard to print. I don’t mind.', 'Mind the overhangs.'],
  suzanne: ['Press the button and I appear.', 'Tested more than anyone alive. Monkey’s honour.'],
  spot: ['Moo — conformally, of course.', 'Parameterised with love.'],
  menger: ['I’m mostly holes. The rest is optional.', 'Infinite surface. Zero volume. Hold me.'],
  mandelbulb: ['Zoom in close. There I am again — and again, and again.', 'Bulbs of bulbs of bulbs. It’s bulbs all the way down.', 'Folded eight times into myself. I never quite end.'],
  mandelbox: ['Fold the box. Fold it again. Now you live in the creases.', 'An infinite city, and every street folds back into the last.'],
  julia: ['Change one number and I become someone else entirely.', 'I’m the Mandelbrot’s daydream, spun through the fourth dimension.'],
  apollonian: ['A circle, kissed by three more — then do it forever, smaller.', 'There’s always room for one more bubble. Always.'],
  kleinian: ['Mirrors facing mirrors, building a cathedral with no final room.', 'Walk inward. The arches never run out.'],
  twisted_torus: ['Same loop you know — I just gave it a half-turn of attitude.', 'Round and round, and my ribbon turns twice on the way.'],
  cut_hollow_sphere: ['I’m a sphere that gave up on being whole. Now I hold things.', 'Half a shell, wide open. Pour something in.'],
  blobby: ['Six arms, one heart — I reach out in every direction at once.', 'I bulge where I please. It’s very freeing.'],
  dini: ['I curve the wrong way at every point. On purpose.', 'Spiralling since before you looked.'],
}

/** The full tap-to-chat pool for a shape: bespoke lines first, then its codex blurb (+ bond line once bonded). */
export function chatterFor(family: string, bond: number): string[] {
  const lines = [...(CHATTER[family] ?? [])]
  const c = CODEX[family]
  if (c) {
    lines.push(c.blurb)
    if (bond >= 1) lines.push(c.bond)
  }
  return lines.length ? lines : ['…']
}
