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
// `na/nb/nc` = per-vertex NORMALS (smooth shading) carried alongside the positions so the GPU tracer can
// barycentrically interpolate a smooth surface normal at the hit instead of using the flat face normal — the
// relic meshes are 40-55k-tri scans, so a per-facet normal reads as low-poly/faceted, especially through the
// refraction. If the source geometry lacks usable normals, these fall back to the geometric face normal.
export interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; na: THREE.Vector3; nb: THREE.Vector3; nc: THREE.Vector3; cx: number; cy: number; cz: number; min: THREE.Vector3; max: THREE.Vector3; mat: number }
export interface BVHData { nodes: BVHNode[]; tris: Tri[] }
export interface PackedBVH {
  triTex: THREE.DataTexture // 6 texels/tri (a,b,c positions then na,nb,nc vertex normals)
  nodeTex: THREE.DataTexture // 2 texels/node
  texW: number
  triCount: number
  nodeCount: number
}

// texels per triangle in triTex: 3 positions (a,b,c) + 3 vertex normals (na,nb,nc).
export const TRI_TEXELS = 6

const MAX_LEAF = 4 // triangles per leaf (the shader loops cnt tris/leaf, so this is pixel-identical; shallower tree → ~10-20% faster traversal + faster build)
const MAX_DEPTH = 40

/** Build the BVH tree (testable): a flat node array + the leaf-ordered triangle list. */
export function buildBVHData(geo: THREE.BufferGeometry): BVHData {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined // per-vertex smooth normals (may be absent)
  const index = geo.index
  const triCount = index ? index.count / 3 : Math.floor(pos.count / 3)
  const all: Tri[] = []
  // a per-vertex normal from the attribute, or zero if there's none → packBVH falls back to the face normal.
  const vn = (i: number): THREE.Vector3 => (nrm ? new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) : new THREE.Vector3())
  // optional per-vertex MATERIAL id (multi-material scene tracer) — a tri's material = its first vertex's id; absent ⇒ 0.
  const matAttr = geo.attributes.materialId as THREE.BufferAttribute | undefined
  for (let f = 0; f < triCount; f++) {
    const ia = index ? index.getX(3 * f) : 3 * f
    const ib = index ? index.getX(3 * f + 1) : 3 * f + 1
    const ic = index ? index.getX(3 * f + 2) : 3 * f + 2
    const a = new THREE.Vector3(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
    const b = new THREE.Vector3(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
    const c = new THREE.Vector3(pos.getX(ic), pos.getY(ic), pos.getZ(ic))
    const min = a.clone().min(b).min(c)
    const max = a.clone().max(b).max(c)
    const mat = matAttr ? Math.round(matAttr.getX(ia)) : 0
    all.push({ a, b, c, na: vn(ia), nb: vn(ib), nc: vn(ic), cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3, cz: (a.z + b.z + c.z) / 3, min, max, mat })
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
  // triangle texture: TRI_TEXELS (6) texels/tri = a, b, c positions then na, nb, nc vertex normals.
  // For each triangle we precompute the geometric face normal so any missing/degenerate vertex normal
  // (zero-length, as flagged by buildBVHData when the source geometry has no normal attribute) falls back to
  // it — the GPU then interpolates real per-vertex normals where present and the flat normal where they aren't.
  const triPacked = makeTex(tris.length * TRI_TEXELS, (i, out, o) => {
    const t = tris[(i / TRI_TEXELS) | 0]
    const slot = i % TRI_TEXELS // 0,1,2 = positions a,b,c ; 3,4,5 = normals na,nb,nc
    if (slot < 3) {
      const v = slot === 0 ? t.a : slot === 1 ? t.b : t.c
      // slot-0 .w carries the per-triangle materialId (multi-material scene tracer); slots 1,2 stay 0. Single-object
      // callers never set materialId ⇒ mat=0 ⇒ unchanged.
      out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z; out[o + 3] = slot === 0 ? t.mat : 0
    } else {
      const n = slot === 3 ? t.na : slot === 4 ? t.nb : t.nc
      // geometric (face) normal as the fallback when this vertex normal is absent/degenerate
      const fn = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a))
      const fl = fn.length()
      const safe = n.lengthSq() > 1e-12 ? n : fl > 1e-12 ? fn.multiplyScalar(1 / fl) : new THREE.Vector3(0, 0, 1)
      out[o] = safe.x; out[o + 1] = safe.y; out[o + 2] = safe.z; out[o + 3] = 0
    }
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

// ── Multi-object (TLAS/BLAS) pack for the scene tracer ────────────────────────────────────────────────────
// The party path tracer (ExpeditionPathTrace) traces several objects that each rotate independently. Rebuilding
// one merged BVH every frame would be too slow for heavy gems, so instead each object keeps its OWN object-space
// BVH and the shader transforms the RAY into each object's local space at trace time (no per-frame rebuild). To
// feed that, we pack N per-object BVHs into the SAME two float textures `packBVH` uses — concatenated, with each
// object's child/triStart indices OFFSET by its running base so the shader can walk object k from `nodeBase[k]`
// and decode indices as `index + base`. The texel layout per tri/node is byte-identical to `packBVH`, so the
// shared GLSL `ftri`/`fnode`/`hitTri`/`hitAABB` read it unchanged — only the index decode adds the base.
export interface MultiPackedBVH {
  triTex: THREE.DataTexture
  nodeTex: THREE.DataTexture
  texW: number
  objs: { nodeBase: number; triBase: number; triCount: number; nodeCount: number }[]
}

/** Pack several built BVHs (one per object) into shared float textures, offsetting each object's node-child and
 * leaf-triStart indices by its running base. Additive — does not touch packBVH/buildBVH (the single-object path). */
export function packMultiBVH(datas: BVHData[]): MultiPackedBVH {
  // running bases + a flat view of every tri / node tagged with its object's bases (objs is tiny, so flattening
  // up front keeps the per-texel fill O(1) instead of scanning the object list).
  const objs: MultiPackedBVH['objs'] = []
  const allTris: Tri[] = []
  const allNodes: { node: BVHNode; nodeBase: number; triBase: number }[] = []
  let triBase = 0
  let nodeBase = 0
  for (const d of datas) {
    objs.push({ nodeBase, triBase, triCount: d.tris.length, nodeCount: d.nodes.length })
    for (const t of d.tris) allTris.push(t)
    for (const n of d.nodes) allNodes.push({ node: n, nodeBase, triBase })
    triBase += d.tris.length
    nodeBase += d.nodes.length
  }
  // triangle texture: identical per-slot logic to packBVH (positions + slot-0 materialId, then vertex normals with
  // a geometric-face fallback) — the triangles are object-space; the shader transforms the ray, not the geometry.
  const triPacked = makeTex(allTris.length * TRI_TEXELS, (i, out, o) => {
    const t = allTris[(i / TRI_TEXELS) | 0]
    const slot = i % TRI_TEXELS
    if (slot < 3) {
      const v = slot === 0 ? t.a : slot === 1 ? t.b : t.c
      out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z; out[o + 3] = slot === 0 ? t.mat : 0
    } else {
      const n = slot === 3 ? t.na : slot === 4 ? t.nb : t.nc
      const fn = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a))
      const fl = fn.length()
      const safe = n.lengthSq() > 1e-12 ? n : fl > 1e-12 ? fn.multiplyScalar(1 / fl) : new THREE.Vector3(0, 0, 1)
      out[o] = safe.x; out[o + 1] = safe.y; out[o + 2] = safe.z; out[o + 3] = 0
    }
  })
  // node texture: same 2-texel layout as packBVH, but child indices and leaf triStart are OFFSET by the owning
  // object's base so the concatenated array is internally consistent (the negative-w leaf flag is preserved).
  const nodePacked = makeTex(allNodes.length * 2, (i, out, o) => {
    const e = allNodes[(i / 2) | 0]
    const n = e.node
    const leaf = n.triCount > 0
    if (i % 2 === 0) { out[o] = n.min[0]; out[o + 1] = n.min[1]; out[o + 2] = n.min[2]; out[o + 3] = leaf ? n.triStart + e.triBase : n.left + e.nodeBase }
    else { out[o] = n.max[0]; out[o + 1] = n.max[1]; out[o + 2] = n.max[2]; out[o + 3] = leaf ? -n.triCount : n.right + e.nodeBase }
  })
  return { triTex: triPacked.tex, nodeTex: nodePacked.tex, texW: TEX_W, objs }
}
