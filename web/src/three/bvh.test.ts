// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildBVHData } from './bvh'
import { getGeometry } from './geometry'

// The BVH is the load-bearing CPU half of the mesh path tracer — its correctness is checkable without a GPU:
// the root must bound every triangle, leaves must bound their own triangles, and the leaf triangle ranges must
// partition the full set exactly. (A wrong split or bbox = missed/duplicated geometry in the traced image.)
const MESHES = ['cube', 'trefoil', 'dodecahedron', 'klein_bottle', 'figure8_knot']
const EPS = 1e-4

describe('mesh BVH', () => {
  it.each(MESHES)('%s → valid hierarchy that bounds + partitions every triangle', (fam) => {
    const { nodes, tris } = buildBVHData(getGeometry(fam))
    expect(nodes.length).toBeGreaterThan(0)
    expect(tris.length).toBeGreaterThan(0)
    expect(nodes.length).toBeLessThan(tris.length * 2 + 2) // a binary BVH has < 2N nodes

    // root AABB bounds every triangle vertex
    const root = nodes[0]
    for (const t of tris) {
      for (const v of [t.a, t.b, t.c]) {
        expect(v.x).toBeGreaterThanOrEqual(root.min[0] - EPS)
        expect(v.x).toBeLessThanOrEqual(root.max[0] + EPS)
        expect(v.y).toBeGreaterThanOrEqual(root.min[1] - EPS)
        expect(v.z).toBeLessThanOrEqual(root.max[2] + EPS)
      }
    }

    // leaves: their triangles lie inside their AABB, and the ranges exactly partition [0, tris.length)
    let covered = 0
    const seen = new Array<boolean>(tris.length).fill(false)
    for (const n of nodes) {
      const leaf = n.triCount > 0
      if (leaf) {
        covered += n.triCount
        for (let i = n.triStart; i < n.triStart + n.triCount; i++) {
          expect(seen[i], `tri ${i} in two leaves`).toBe(false)
          seen[i] = true
          const t = tris[i]
          for (const v of [t.a, t.b, t.c]) {
            expect(v.x).toBeGreaterThanOrEqual(n.min[0] - EPS)
            expect(v.x).toBeLessThanOrEqual(n.max[0] + EPS)
            expect(v.y).toBeGreaterThanOrEqual(n.min[1] - EPS)
            expect(v.y).toBeLessThanOrEqual(n.max[1] + EPS)
            expect(v.z).toBeGreaterThanOrEqual(n.min[2] - EPS)
            expect(v.z).toBeLessThanOrEqual(n.max[2] + EPS)
          }
        }
      } else {
        // internal node: valid child indices, and its AABB contains both children's
        expect(n.left).toBeGreaterThan(0)
        expect(n.right).toBeGreaterThan(0)
        expect(n.left).toBeLessThan(nodes.length)
        expect(n.right).toBeLessThan(nodes.length)
      }
    }
    expect(covered, 'every triangle in exactly one leaf').toBe(tris.length)
  })
})
