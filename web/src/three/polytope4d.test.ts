// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { build4D, POLYTOPES_4D } from './Polytope4D'

// The regular convex 4-polytopes have known vertex/edge counts — the load-bearing check that the Cartesian
// coordinate sets + min-distance edge detection are correct (a wrong parity/value gives the wrong counts).
const EXPECTED: Record<string, { v: number; e: number }> = {
  tesseract: { v: 16, e: 32 },
  cell_16: { v: 8, e: 24 },
  cell_24: { v: 24, e: 96 },
  cell_600: { v: 120, e: 720 },
  cell_120: { v: 600, e: 1200 },
}

describe('4D polytopes', () => {
  it.each(Object.keys(EXPECTED))('%s has the correct vertex + edge count', (fam) => {
    const { verts, edges } = build4D(fam)
    expect(verts.length, `${fam} vertices`).toBe(EXPECTED[fam].v)
    expect(edges.length, `${fam} edges`).toBe(EXPECTED[fam].e)
  })

  it('all vertices lie on the unit 3-sphere (normalised circumradius)', () => {
    for (const fam of POLYTOPES_4D) {
      for (const v of build4D(fam).verts) {
        const r = Math.hypot(v[0], v[1], v[2], v[3])
        expect(Math.abs(r - 1), `${fam} vertex radius`).toBeLessThan(1e-6)
      }
    }
  })

  it('every family in the set is buildable', () => {
    for (const fam of POLYTOPES_4D) expect(EXPECTED[fam], `expected counts for ${fam}`).toBeTruthy()
  })
})
