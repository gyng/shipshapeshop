import { describe, it, expect } from 'vitest'
import { SCALE, SCALE_SET, instrumentForShape, type AudioShape } from './orreryAudio'
import { arrangementForLoadout, arrangementForEpoch, styleForEpoch, STYLES, seedFromLoadout, roleForShape, mulberry32, layersForCount } from './orreryBed'

const mk = (id: number, o: Partial<AudioShape> = {}): AudioShape => ({
  id,
  family: 'sphere',
  genus: 0,
  rarity: 'Common',
  euler_cost: 0,
  orientable: true,
  ...o,
})

// The lofi PALETTE: the diatonic major scale PLUS the two parallel-minor borrows the arrangement may use via
// modal interchange (b3 = 3, b6 = 8 — the soulful "minor iv" colour).
const MAJOR = new Set([0, 2, 3, 4, 5, 7, 8, 9, 11])
// A chord is "in-vocabulary" if every tone is in the palette, OR it's a clean dominant-7th (a SECONDARY DOMINANT
// the jazz styles may colour with — intervals {0,4,7,10} from its own root). So: in-key, a recognized borrow, or
// a textbook secondary dominant — never a random wrong note.
function chordOk(chord: number[], root: number): boolean {
  if (chord.every((n) => MAJOR.has(((n - root) % 12 + 12) % 12))) return true
  const cr = chord[0]
  const ivl = new Set(chord.map((n) => ((n - cr) % 12 + 12) % 12))
  return ivl.size === 4 && [0, 4, 7, 10].every((x) => ivl.has(x)) // dom7
}

describe('orrery bed — deterministic + order-independent', () => {
  it('the same loadout always yields the same arrangement', () => {
    const shapes = [mk(1), mk(7, { family: 'trefoil' }), mk(12, { family: 'klein_bottle', orientable: false })]
    expect(arrangementForLoadout(shapes)).toEqual(arrangementForLoadout(shapes))
  })
  it('the loadout is a SET — shape order does not change the music', () => {
    const a = [mk(1), mk(7, { family: 'trefoil' }), mk(12)]
    const b = [mk(12), mk(1), mk(7, { family: 'trefoil' })]
    expect(seedFromLoadout(a)).toBe(seedFromLoadout(b))
    expect(arrangementForLoadout(a).progression).toEqual(arrangementForLoadout(b).progression)
  })
  it('a different loadout generally produces different music', () => {
    const a = arrangementForLoadout([mk(1), mk(2)])
    const b = arrangementForLoadout([mk(40, { family: 'tesseract' }), mk(41, { family: 'lorenz' })])
    expect(a.seed).not.toBe(b.seed)
  })
})

describe('orrery bed — always musical', () => {
  it('every chord is in-vocabulary (in-key, a recognized borrow, or a resolving secondary dominant)', () => {
    for (let s = 0; s < 60; s++) {
      const arr = arrangementForLoadout([mk(s), mk(s * 3 + 1, { genus: s % 3 }), mk(s * 5 + 2)])
      for (const chord of arr.progression) expect(chordOk(chord, arr.rootMidi)).toBe(true)
    }
  })
  it('every per-shape home note is in the pentatonic scale', () => {
    const arr = arrangementForLoadout(Array.from({ length: 12 }, (_, i) => mk(i, { genus: i % 4 })))
    for (const v of arr.voices) expect(SCALE_SET.has(v.homeMidi)).toBe(true)
  })
  it('tempo + swing stay in the lofi pocket (across styles)', () => {
    for (let s = 0; s < 40; s++) {
      const arr = arrangementForLoadout([mk(s), mk(s + 100)])
      expect(arr.bpm).toBeGreaterThanOrEqual(60) // style bias widens it, but the clamp holds
      expect(arr.bpm).toBeLessThanOrEqual(92)
      expect(arr.swing).toBeGreaterThanOrEqual(0)
      expect(arr.swing).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('orrery bed — the band IS the deployed shapes', () => {
  it('one voice per deployed shape, each carrying its descriptor-derived instrument', () => {
    const shapes = [mk(3, { family: 'sphere' }), mk(9, { family: 'trefoil' }), mk(20, { family: 'klein_bottle' })]
    const arr = arrangementForLoadout(shapes)
    expect(arr.voices.map((v) => v.id)).toEqual([3, 9, 20])
    for (const s of shapes) {
      const v = arr.voices.find((x) => x.id === s.id)!
      expect(v.instrument).toEqual(instrumentForShape(s))
    }
  })
  it('roles follow topology: pad shapes pad, knots pluck, high-genus anchors the bass', () => {
    expect(roleForShape(mk(1, { family: 'klein_bottle' }))).toBe('pad') // pad-patch identity wins…
    expect(roleForShape(mk(1, { family: 'trefoil' }))).toBe('pluck') // …as does a knot's pluck…
    // …but a high-genus shape WITHOUT a distinctive patch anchors the low end (genus → register → bass).
    expect(roleForShape(mk(1, { family: 'cube', genus: 3 }))).toBe('bass')
    expect(roleForShape(mk(1, { family: 'sphere' }))).toBe('keys')
  })
  it('the rarest deployed shape leads the chords', () => {
    const arr = arrangementForLoadout([mk(1, { family: 'sphere' }), mk(2, { family: 'tesseract', rarity: 'Ssr' })])
    expect(arr.leadPatch).toBe(instrumentForShape(mk(2, { family: 'tesseract', rarity: 'Ssr' })).patch)
  })
  it('an empty orrery still gives a valid (band-less) bed', () => {
    const arr = arrangementForLoadout([])
    expect(arr.voices).toEqual([])
    expect(arr.leadPatch).toBe('rhodes')
    expect(arr.progression.length).toBeGreaterThan(0)
  })
})

describe('orrery bed — incremental, and silent when empty', () => {
  it('no shapes ⇒ inactive, every layer off (no music)', () => {
    const arr = arrangementForLoadout([])
    expect(arr.active).toBe(false)
    expect(Object.values(arr.layers).every((v) => v === false)).toBe(true)
  })
  it('layers build up with the deployed-shape count', () => {
    expect(layersForCount(0)).toEqual({ shapeVoices: false, vinyl: false, chords: false, pad: false, bass: false, drums: false })
    expect(layersForCount(1).shapeVoices).toBe(true)
    expect(layersForCount(1).chords).toBe(false) // one shape: just its voice + vinyl, no harmony yet
    expect(layersForCount(2).chords).toBe(true) // chords come in at 2
    expect(layersForCount(3).bass).toBe(true) // bass at 3
    expect(layersForCount(4).drums).toBe(true) // the beat only once the orrery is busy
  })
  it('one shape plays (no beat); a full orrery brings the kit', () => {
    expect(arrangementForLoadout([mk(1)]).active).toBe(true)
    expect(arrangementForLoadout([mk(1)]).layers.drums).toBe(false)
    expect(arrangementForLoadout([mk(1), mk(2), mk(3), mk(4)]).layers.drums).toBe(true)
  })
})

describe('orrery bed — evolves over time (sections/styles)', () => {
  const band = [mk(1), mk(7, { family: 'trefoil' }), mk(12, { family: 'klein_bottle' })]
  it('a section is deterministic for a given (loadout, epoch)', () => {
    expect(arrangementForEpoch(band, 3)).toEqual(arrangementForEpoch(band, 3))
  })
  it('arrangementForLoadout is just section 0', () => {
    expect(arrangementForLoadout(band)).toEqual(arrangementForEpoch(band, 0))
  })
  it('the key stays stable across sections, but the section re-rolls', () => {
    const a = arrangementForEpoch(band, 0)
    const b = arrangementForEpoch(band, 1)
    expect(b.rootMidi).toBe(a.rootMidi) // same key — the bed stays coherent
    expect(b.epoch).toBe(1)
    expect(b.seed).not.toBe(a.seed) // but a fresh variation
  })
  it('the sub-style rotates as epochs advance, and is a real STYLE', () => {
    const ids = Array.from({ length: STYLES.length + 1 }, (_, e) => styleForEpoch(band, e).id)
    expect(new Set(ids).size).toBeGreaterThan(1) // not stuck on one style
    for (const e of [0, 1, 2, 5, 13]) expect(STYLES).toContain(styleForEpoch(band, e))
  })
  it('every section, in every style, stays in tempo bounds', () => {
    for (let e = 0; e < 20; e++) {
      const arr = arrangementForEpoch(band, e)
      expect(arr.bpm).toBeGreaterThanOrEqual(60)
      expect(arr.bpm).toBeLessThanOrEqual(92)
      expect(arr.style).toBe(styleForEpoch(band, e))
    }
  })
})

describe('orrery bed — generative variety (stays fresh over 24/7 play)', () => {
  const band = [mk(1), mk(7, { family: 'trefoil' }), mk(12, { family: 'klein_bottle' })]
  it('generated progressions across hundreds of sections stay diatonic (never a wrong chord)', () => {
    for (let e = 0; e < 200; e++) {
      const arr = arrangementForEpoch(band, e)
      for (const chord of arr.progression) expect(chordOk(chord, arr.rootMidi)).toBe(true)
      expect(arr.progression.length).toBeGreaterThanOrEqual(4)
    }
  })
  it('every section carries a valid per-section groove (drums / bass / comp / melody), sized to its meter', () => {
    for (let e = 0; e < 64; e++) {
      const arr = arrangementForEpoch(band, e)
      expect([3, 4]).toContain(arr.meter) // 4/4 or a 3/4 waltz
      expect(arr.kick.length).toBe(arr.meter * 4) // sixteenths per bar
      expect(arr.snare.length).toBe(arr.meter * 4)
      expect(['root', 'octave', 'fifth', 'walk']).toContain(arr.bassMode)
      expect(arr.chordHits.length).toBe(arr.meter) // one comp slot per beat
      expect(arr.arpMotif.length).toBe(arr.meter * 4) // eighths per 2 bars
      for (const d of arr.arpMotif) {
        expect(d).toBeGreaterThanOrEqual(-1) // -1 = rest
        expect(d).toBeLessThan(SCALE.length) // otherwise a real pentatonic degree
      }
    }
  })
  it('does NOT settle into a short loop — lots of distinct sections over a long run', () => {
    const sigs = new Set<string>()
    for (let e = 0; e < 64; e++) {
      const a = arrangementForEpoch(band, e)
      sigs.add(JSON.stringify([a.progression, a.kick, a.snare, a.bassMode, a.chordHits, a.arpMotif, a.style.id]))
    }
    expect(sigs.size).toBeGreaterThan(48) // the bed keeps reinventing itself, not cycling a handful of states
  })
  it('the key slowly modulates over a long session (not one tonality forever)', () => {
    const bands = [[mk(2), mk(3)], band, [mk(40, { family: 'tesseract' }), mk(41, { family: 'lorenz' })]]
    const anyModulates = bands.some((b) => new Set(Array.from({ length: 96 }, (_, e) => arrangementForEpoch(b, e).rootMidi)).size > 1)
    expect(anyModulates).toBe(true)
  })
})

describe('orrery bed — seeded PRNG is stable', () => {
  it('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
