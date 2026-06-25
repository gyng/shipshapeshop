// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildBVHData, packMultiBVH } from './bvh'
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

describe('per-triangle materialId (multi-material scene tracer)', () => {
  it('carries each triangle\'s materialId (from its first vertex) through the BVH', () => {
    // two non-indexed tris; verts 0-2 = material 0, verts 3-5 = material 1
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]), 3))
    geo.setAttribute('materialId', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 1))
    const { tris } = buildBVHData(geo)
    expect(tris.length).toBe(2)
    // a median split may reorder the tris — assert the SET of materials, not positions
    expect(new Set(tris.map((t) => t.mat))).toEqual(new Set([0, 1]))
  })
  it('defaults materialId to 0 when the attribute is absent (single-object callers unaffected)', () => {
    const { tris } = buildBVHData(getGeometry('cube'))
    expect(tris.every((t) => t.mat === 0)).toBe(true)
  })
})

describe('packMultiBVH (multi-object TLAS/BLAS concatenation)', () => {
  // The party tracer concatenates per-object BVHs into shared textures and the shader walks object k from its
  // running base, decoding child/triStart indices as `local + base`. If the offset is wrong, the shader reads
  // another object's nodes/tris → garbage geometry. This pins the offsetting against the per-object BVH data.
  it('records running bases + offsets every node child / leaf triStart by the owning object base', () => {
    const a = buildBVHData(getGeometry('cube'))
    const b = buildBVHData(getGeometry('trefoil'))
    const packed = packMultiBVH([a, b])

    // bases are the running node/tri counts; counts mirror the inputs
    expect(packed.objs[0]).toMatchObject({ nodeBase: 0, triBase: 0, nodeCount: a.nodes.length, triCount: a.tris.length })
    expect(packed.objs[1]).toMatchObject({ nodeBase: a.nodes.length, triBase: a.tris.length, nodeCount: b.nodes.length, triCount: b.tris.length })

    const node = packed.nodeTex.image.data as unknown as Float32Array // 2 texels/node, RGBA → 8 floats/node
    const wOf = (globalNode: number, texel: 0 | 1) => node[(globalNode * 2 + texel) * 4 + 3] // the .w slot
    const isLeaf = (n: { triCount: number }) => n.triCount > 0

    // object 0 (base 0): indices are unoffset — identical to its own BVH data
    const r0 = a.nodes[0]
    expect(wOf(0, 0)).toBe(isLeaf(r0) ? r0.triStart : r0.left)
    expect(wOf(0, 1)).toBe(isLeaf(r0) ? -r0.triCount : r0.right)

    // object 1 (base = a.nodes.length): EVERY node's child indices + leaf triStart shift by the object's bases;
    // the negative-w leaf flag (triCount) is preserved verbatim.
    const { nodeBase, triBase } = packed.objs[1]
    for (let li = 0; li < b.nodes.length; li++) {
      const n = b.nodes[li]
      const g = li + nodeBase
      if (isLeaf(n)) {
        expect(wOf(g, 0)).toBe(n.triStart + triBase) // leaf triStart offset by triBase
        expect(wOf(g, 1)).toBe(-n.triCount) // leaf flag unchanged
      } else {
        expect(wOf(g, 0)).toBe(n.left + nodeBase) // child indices offset by nodeBase
        expect(wOf(g, 1)).toBe(n.right + nodeBase)
      }
    }
  })
})
