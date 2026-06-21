import * as THREE from 'three'

// ── From-scratch BVH for GPU mesh path tracing (NO library) ───────────────────────────────────────────────
// Build a median-split bounding-volume hierarchy over a mesh's triangles on the CPU, then pack the triangles
// and nodes into RGBA float data-textures the fragment shader walks with a stackless-ish loop (see
// MeshPathTraceGem). Median split (not SAH) — simple, correct, fine for the ≤~25k-tri hero meshes.

export interface BVHNode {
  min: [number, number, number]
  max: [number, number, number]
  left: number // child node index (internal) — else -1
  right: number // child node index (internal) — else -1
  triStart: number // first triangle (leaf) — else -1
  triCount: number // triangle count (leaf) — else 0
}
export interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; cx: number; cy: number; cz: number; min: THREE.Vector3; max: THREE.Vector3 }
export interface BVHData { nodes: BVHNode[]; tris: Tri[] }
export interface PackedBVH {
  triTex: THREE.DataTexture // 3 texels/tri (a,b,c positions)
  nodeTex: THREE.DataTexture // 2 texels/node
  texW: number
  triCount: number
  nodeCount: number
}

const MAX_LEAF = 2 // triangles per leaf
const MAX_DEPTH = 40

/** Build the BVH tree (testable): a flat node array + the leaf-ordered triangle list. */
export function buildBVHData(geo: THREE.BufferGeometry): BVHData {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const index = geo.index
  const triCount = index ? index.count / 3 : Math.floor(pos.count / 3)
  const all: Tri[] = []
  for (let f = 0; f < triCount; f++) {
    const ia = index ? index.getX(3 * f) : 3 * f
    const ib = index ? index.getX(3 * f + 1) : 3 * f + 1
    const ic = index ? index.getX(3 * f + 2) : 3 * f + 2
    const a = new THREE.Vector3(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
    const b = new THREE.Vector3(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
    const c = new THREE.Vector3(pos.getX(ic), pos.getY(ic), pos.getZ(ic))
    const min = a.clone().min(b).min(c)
    const max = a.clone().max(b).max(c)
    all.push({ a, b, c, cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3, cz: (a.z + b.z + c.z) / 3, min, max })
  }

  const nodes: BVHNode[] = []
  const ordered: Tri[] = []

  // recursively split `items`; returns the index of the node it appends to `nodes`.
  const build = (items: Tri[], depth: number): number => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const t of items) {
      min[0] = Math.min(min[0], t.min.x); min[1] = Math.min(min[1], t.min.y); min[2] = Math.min(min[2], t.min.z)
      max[0] = Math.max(max[0], t.max.x); max[1] = Math.max(max[1], t.max.y); max[2] = Math.max(max[2], t.max.z)
    }
    const idx = nodes.length
    const node: BVHNode = { min, max, left: -1, right: -1, triStart: -1, triCount: 0 }
    nodes.push(node)

    if (items.length <= MAX_LEAF || depth >= MAX_DEPTH) {
      node.triStart = ordered.length
      node.triCount = items.length
      for (const t of items) ordered.push(t)
      return idx
    }
    // split on the longest axis of the centroid bounds, at the median
    const cmin = [Infinity, Infinity, Infinity]
    const cmax = [-Infinity, -Infinity, -Infinity]
    for (const t of items) {
      cmin[0] = Math.min(cmin[0], t.cx); cmin[1] = Math.min(cmin[1], t.cy); cmin[2] = Math.min(cmin[2], t.cz)
      cmax[0] = Math.max(cmax[0], t.cx); cmax[1] = Math.max(cmax[1], t.cy); cmax[2] = Math.max(cmax[2], t.cz)
    }
    const ex = cmax[0] - cmin[0], ey = cmax[1] - cmin[1], ez = cmax[2] - cmin[2]
    const axis = ex > ey ? (ex > ez ? 0 : 2) : ey > ez ? 1 : 2
    const key = (t: Tri) => (axis === 0 ? t.cx : axis === 1 ? t.cy : t.cz)
    items.sort((p, q) => key(p) - key(q))
    const mid = items.length >> 1
    node.left = build(items.slice(0, mid), depth + 1)
    node.right = build(items.slice(mid), depth + 1)
    return idx
  }
  build(all, 0)
  return { nodes, tris: ordered }
}

const TEX_W = 1024

function makeTex(texels: number, fill: (i: number, out: Float32Array, o: number) => void): { tex: THREE.DataTexture; w: number } {
  const h = Math.max(1, Math.ceil(texels / TEX_W))
  const data = new Float32Array(TEX_W * h * 4)
  for (let i = 0; i < texels; i++) fill(i, data, i * 4)
  const tex = new THREE.DataTexture(data, TEX_W, h, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return { tex, w: TEX_W }
}

/** Pack a built BVH into the two float textures the shader reads. */
export function packBVH(data: BVHData): PackedBVH {
  const { nodes, tris } = data
  // triangle texture: 3 texels/tri = a, b, c positions
  const triPacked = makeTex(tris.length * 3, (i, out, o) => {
    const t = tris[(i / 3) | 0]
    const v = i % 3 === 0 ? t.a : i % 3 === 1 ? t.b : t.c
    out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z; out[o + 3] = 0
  })
  // node texture: 2 texels/node.
  //   texel0 = (min.xyz, leaf ? triStart : leftChild)
  //   texel1 = (max.xyz, leaf ? -triCount : rightChild)   ← negative w ⇒ leaf
  const nodePacked = makeTex(nodes.length * 2, (i, out, o) => {
    const n = nodes[(i / 2) | 0]
    const leaf = n.triCount > 0
    if (i % 2 === 0) { out[o] = n.min[0]; out[o + 1] = n.min[1]; out[o + 2] = n.min[2]; out[o + 3] = leaf ? n.triStart : n.left }
    else { out[o] = n.max[0]; out[o + 1] = n.max[1]; out[o + 2] = n.max[2]; out[o + 3] = leaf ? -n.triCount : n.right }
  })
  return { triTex: triPacked.tex, nodeTex: nodePacked.tex, texW: TEX_W, triCount: tris.length, nodeCount: nodes.length }
}

export function buildBVH(geo: THREE.BufferGeometry): PackedBVH {
  return packBVH(buildBVHData(geo))
}
