# Shape Gacha — Rendering & Shader Technical Direction

**Scope:** the 3D visual layer for a free, single-player gacha + idle game where the collectibles are mathematical shapes rendered as glass/gemstone jewels. The shapes ARE the reward, so visual quality is the product. Target: 2026 browsers, desktop-first, mobile-tolerant.

**TL;DR recommendation:** `react-three-fiber` + `three.js`, WebGL2 as the baseline render path with a WebGPU opt-in, `@react-three/drei`'s `MeshTransmissionMaterial` for the hero glass look, `pmndrs/postprocessing` for the juice, and Rust→WASM for heavy mesh generation (marching cubes, knot tubes, 4-polytope projection). Render-on-demand everywhere except the focused/pull shape.

---

## 1. Stack decision

### Recommendation: react-three-fiber (R3F) + three.js

| Option | Verdict |
|---|---|
| **R3F + three.js** | **Choose this.** Declarative scene graph maps cleanly to React/TS state, the entire pmndrs ecosystem (`drei`, `postprocessing`, `react-three-rapier`, `leva`) is built around it, and the single most important material we need — `MeshTransmissionMaterial` — ships in `drei`. Largest community, most shader examples, best TS types. |
| Babylon.js | Excellent engine, strong WebGPU story, built-in node material editor and good glass via PBR `subSurface`. But it wants to own the app loop and doesn't integrate with React's render model as naturally; smaller R&D-shader community for the exact gemstone effects we want. Viable, but you'd be swimming against the React current. |
| Raw WebGL2 / WebGPU | Maximum control, maximum cost. You'd reimplement transmission render targets, env mapping, PBR, and post FX yourself. Only justified if this were a bespoke engine product. It isn't — the shapes are the product, not the renderer. |

**Why R3F specifically for React/TS:** components like `<mesh>`, `<MeshTransmissionMaterial>`, `<EffectComposer>` are just JSX; shape rarity, idle state, and pull state live in your normal React/Zustand store and drive props. You get hot-reload, Suspense-based asset loading, and `useFrame` for per-frame shader uniform updates without leaving the React mental model.

### WebGPU vs WebGL2 in 2026

- **WebGL2 = baseline.** Universally available (desktop + mobile Safari included). three.js's `WebGLRenderer` + `MeshPhysicalMaterial`/`MeshTransmissionMaterial` give us everything in section 2. Ship this as the guaranteed path.
- **WebGPU = progressive enhancement.** By 2026 it's shipping in Chrome/Edge stably, Firefox is rolling out, Safari has it behind/at release on recent versions. Wins that matter for us: compute shaders (GPU particle systems for the pull ceremony, GPU marching-cubes/raymarch), `TSL` (Three Shading Language — write node/shader logic once, compiles to GLSL **or** WGSL), and generally lower draw-call overhead so more refractive shapes stay at 60fps.
- **Concrete plan:** author custom material logic in **TSL** so it runs on both backends. Use `WebGPURenderer` with `forceWebGL` auto-fallback. Feature-detect `navigator.gpu`; if absent, fall back to WebGL2. Do **not** gate core gameplay visuals on WebGPU — gate only the "extra sparkle" (GPU particles, SDF raymarched gyroid at full quality) behind it.

---

## 2. Refraction / glass look — the headline

This is where the money is. The pipeline, from cheap to expensive:

### 2.1 The material: `MeshPhysicalMaterial` parameters

`MeshPhysicalMaterial` extends the standard PBR material with the dielectric/glass set. The knobs that matter:

| Param | What it does for gems | Typical range |
|---|---|---|
| `transmission` | Makes the surface physically see-through (refractive), not just alpha-blended. The single most important flag. | 1.0 for glass/gems |
| `thickness` | Volume the light travels through; drives how much bending + tint accumulates. | 0.5–3.0 (scene-unit dependent) |
| `ior` | Index of refraction. Water 1.33, glass 1.5, sapphire 1.77, **diamond 2.42**. Higher = more dramatic bending and brighter Fresnel edges. | 1.3–2.42 |
| `dispersion` | Chromatic refraction — splits IOR per channel so edges fringe rainbow (the "fire" of a diamond). Added to core three.js MeshPhysicalMaterial. | 0–5 (subtle: 0.5–2) |
| `roughness` | 0 = mirror-clear gem; raise for frosted/sea-glass. | 0.0–0.15 for clear gems |
| `clearcoat` / `clearcoatRoughness` | Thin glossy lacquer on top — adds a crisp second specular highlight; sells "polished." | clearcoat 1.0, roughness 0.03 |
| `iridescence` / `iridescenceIOR` / `iridescenceThicknessRange` | Thin-film interference — oil-slick / opal / bismuth rainbow that shifts with view angle. Killer for high rarity. | iridescence 0.3–1.0 |
| `attenuationColor` / `attenuationDistance` | Beer–Lambert volumetric absorption — light loses color as it travels through the body. THIS is what makes a ruby red in its core and bright at thin edges, not a flat tint. | tune distance to shape scale |
| `sheen` / `sheenColor` | Soft retroreflective fuzz; less for gems, more for "soft energy" rarities. | optional |
| `envMapIntensity` | Multiplies environment reflection/refraction. Crank for high rarity sparkle. | 1.0–3.0 |

### 2.2 Why single-pass transmission isn't enough — and the back-face fix

`MeshPhysicalMaterial.transmission` does **one** refraction event: it samples the scene/transmission render target through the front face and bends it by IOR. That looks like a thin glass shell. Real gems refract on entry **and** exit, with the back surfaces of the shape visible *through* the front — that's what gives a faceted, jewel-like look with internal structure.

**The technique — double refraction via back faces:**
1. Render the object's **back faces** to an off-screen target (front-face culled) so you capture the refracted geometry behind the front surface.
2. In the front-face pass, sample that back-face target with a refracted UV (offset by the surface normal × IOR), so you see *into* the shape and the far wall bends correctly.
3. This is exactly what **`MeshTransmissionMaterial` (drei)** does: it implements a multi-sample, back-face-aware transmission with extra controls — `samples` (blur/quality of the transmission), `chromaticAberration`, `anisotropicBlur`, `distortion` / `distortionScale` / `temporalDistortion` (animated internal warping), `backside` + `backsideThickness` (the explicit second refraction pass), `transmissionSampler`. **Use `MeshTransmissionMaterial` for hero shapes; reserve plain `MeshPhysicalMaterial` for distant/idle ones.**

> Honest framing: this is still a *screen-space approximation*, not true path-traced internal bounces. For genuine multi-bounce caustics inside a faceted gem you'd need an SDF raymarch material (section 2.4) or offline path tracing (`three-gpu-pathtracer`) baked to a video/sprite for the reveal. For interactive play, back-face double-refraction + a fake-caustic env trick is the right cost/quality point.

### 2.3 HDRI environment — what actually sells glass

Glass and gems are **mostly reflections and refractions of their surroundings**. With a black void around them they look dead. The environment map is non-negotiable.

- Use `<Environment />` from `drei`. Options: a packaged `.hdr`/`.exr` equirect, a `files` cubemap, or — important for our budget — a **procedural `<Environment>` with `<Lightformer>` children**: you place glowing rectangles/rings as an in-scene "studio lighting rig" that the material reflects/refracts. This ships as *zero texture bytes* and gives crisp, art-directed highlights (the bright streaks across a gem). Per-rarity, swap the lighting rig (warm studio for common, prismatic ring rig + animated lightformers for SSR).
- For richer real-world reflections, ship a compact HDRI: a **1k or 2k equirect in `.hdr` (RGBE) and/or compressed to a `.ktx2` env**. Keep the env that's *visible as background* separate from the env used only for lighting (you can blur/downsample the lighting one heavily — gems sample mips, so a 512px blurred env is often enough for the body while a sharp one drives edge sparkle).
- `envMapIntensity` per rarity; `Environment background={false}` so the env lights the gem without forcing a skybox (we want a dark, focused stage for the reveal).

### 2.4 Custom GLSL/TSL options for stylized effects

When the physical material isn't stylized enough (we want *jewel fantasy*, not photoreal mineralogy):

- **Manual split-RGB dispersion:** sample the transmission/back-face target three times with three slightly different IOR-scaled refraction vectors (R, G, B) and recombine. Gives controllable, exaggerated rainbow fringing beyond the physical `dispersion` param. Cheap, very effective. (Sketch in §8.)
- **Fresnel rim:** `pow(1.0 - dot(normal, viewDir), power)` → additive emissive rim. Makes the silhouette glow; scale by rarity.
- **Fake caustics:** project an animated voronoi/caustic texture (or a procedural noise) as an additive emissive term, masked by thickness/Fresnel, to imply light focusing inside. For the hero shape, optionally render real caustics from a path-traced bake.
- **Animated internal energy:** drive `MeshTransmissionMaterial.temporalDistortion` + a noise-scrolled emissive core so SSR gems look *alive* (slowly churning light inside).
- Author all of this in **TSL** (`materialX`-like node graph in JS) so it cross-compiles WebGL2↔WebGPU, or use `CustomShaderMaterial` (`three-custom-shader-material`) to inject GLSL into `MeshPhysicalMaterial` without forking the whole shader — you keep PBR + transmission and just add your dispersion/rim/caustic terms.

### 2.5 Rarity escalation ladder

The look must *visibly* climb so a pull feels like a jackpot. Concrete recipe per tier:

| Rarity | Material recipe |
|---|---|
| **Common (C)** | `MeshStandardMaterial`, matte→satin. `roughness 0.6`, slight `clearcoat`. Plastic toy. No transmission (cheap). |
| **Uncommon (UC)** | Frosted glass: `MeshPhysicalMaterial` `transmission 1`, `roughness 0.25`, low `thickness`, subtle `attenuationColor`. Sea-glass. |
| **Rare (R)** | Clear glass: `MeshTransmissionMaterial` `samples 6`, `roughness 0.05`, `ior 1.5`, modest `chromaticAberration`, clearcoat. Reads as real glass. |
| **Super Rare (SR)** | Gemstone: `ior 1.9`, strong `attenuationColor`/`Distance` (deep colored core), `dispersion`/manual RGB split on, `iridescence 0.3`, higher `envMapIntensity`, faceted geometry, soft Fresnel rim. |
| **SSR / Ultra** | Dispersive diamond: `ior 2.42`, high `samples`, full split-RGB dispersion + animated `temporalDistortion`, `iridescence 0.6–1.0`, fake/baked caustics, pulsing emissive core, dedicated prismatic Lightformer rig, bloom-boosted. The shape is rendered with its own higher-quality transmission target while everything else drops to cheap materials. |

Tie the per-tier numbers to a `RARITY_PRESETS` map keyed by rarity enum so design can tune without touching shaders.

---

## 3. Geometry generation for exotic shapes

### 3.1 Categories and methods

| Shape class | Method |
|---|---|
| Torus, Möbius strip, Klein bottle (figure-8 immersion), Boy's surface, heptoroid | **Parametric surface** — sample (u,v) over the known parametric equations, build a grid mesh. three.js `ParametricGeometry` (now in `three/addons`) or generate the vertex buffer directly. |
| Gyroid, Schwarz P, smooth blended knots, metaballs | **Implicit surface / SDF** → either (a) **marching cubes** to get a polygon mesh, or (b) **raymarch the SDF** in a fragment shader for infinite smoothness. |
| Trefoil & general (p,q) torus knots | **Tube geometry** swept along the knot curve. three.js `TorusKnotGeometry` for the simple case; for arbitrary knots, build a Catmull-Rom/Frenet-framed `TubeGeometry` along sampled curve points. |
| 120-cell, tesseract, 600-cell | **4D polytope** projected to 3D (section 4). |
| Any of the above, smoother | **Loop/Catmull-Clark subdivision** as a post step for low-poly→silky. |

### 3.2 Rust(→WASM) vs JS — the split

**Do in Rust→WASM (compute-heavy, parallelizable, deterministic):**
- **Marching cubes / marching tetrahedra** for gyroid and minimal surfaces. Sampling a 3D scalar field at, say, 128³ and meshing it is exactly the SIMD/loop-heavy work where Rust crushes JS. Output a flat `Float32Array` (positions + normals) over the WASM memory boundary — zero-copy into a three.js `BufferGeometry`.
- **Knot tube generation** with proper Frenet/parallel-transport frames (avoid twist artifacts) for arbitrary (p,q) knots.
- **4-polytope vertex/edge tables + 4D rotation + projection** (the 120-cell has 600 vertices / 1200 edges — fine, but the rotation math per frame benefits from being tight; can also stay in JS, see §4).
- **Mesh post-processing**: weld/dedupe vertices, recompute normals, **subdivision**, and crucially **manifold repair / remeshing** (section 3.3).
- **Procedural variation**: gacha should produce *variants* (color, twist count, knot parameters, gyroid cell size). Seed → mesh in Rust for determinism, so the same item ID always renders identically.

**Do in JS/R3F (cheap, interactive, or already provided):**
- Simple analytic geometries three.js already has (`TorusGeometry`, `TorusKnotGeometry`, `SphereGeometry`, `BoxGeometry`).
- Parametric surfaces with small sample counts (Klein/Möbius at moderate res) — fine in JS via `ParametricGeometry`; move to WASM only if profiling shows a hitch.
- Anything driven by per-frame UI interaction where the latency of a WASM call/regeneration isn't worth it.

**Boundary contract:** WASM exposes `generate(shapeId, seed, params) -> { positions, normals, indices, uvs }` as typed-array views; JS wraps them in a `BufferGeometry`. Cache generated geometries by `(shapeId, seed, lod)` so re-summoning an owned shape is instant. Generate **offline at build time** for the canonical/featured shapes and ship the binary geometry; generate **on demand** for procedurally-seeded variants.

### 3.3 Making Klein bottles / gyroids genuinely refractive (the hard part)

Naive transmission **breaks** on these shapes because:
- A Klein bottle's standard immersion **self-intersects** (the neck passes through the wall).
- Gyroids and minimal surfaces are **single-sided sheets with no enclosed volume** — "thickness" and back-face refraction are undefined; the surface is non-manifold-ish for transmission purposes.
- Self-intersection makes back-face depth sorting and `thickness` ambiguous → flickering, wrong tint.

**Mitigations, in order of preference:**

1. **Give sheets real volume.** Don't render the gyroid/minimal surface as an infinitely thin sheet. **Solidify it**: in marching cubes, mesh the region `|gyroid(x)| < t` (a shell of finite thickness) instead of the zero-isosurface. Now it's a closed, manifold solid with a well-defined inside → transmission, thickness, and attenuation all work. This is the single biggest win and should be the default for any minimal-surface gem.
2. **Tube-ify knots** (already done — a tube is a closed manifold solid, refracts perfectly).
3. **For the Klein bottle self-intersection:** either (a) accept it and use `MeshTransmissionMaterial` with `backside` off and a moderate `thickness` (looks like blown glass — actually quite beautiful and "impossible-object" appropriate), or (b) use the **figure-8 immersion at a thickness** so intersections are minimized, or (c) render it via **SDF raymarching** (below) where self-intersection is irrelevant because you're integrating along the ray, not depth-sorting triangles.
4. **SDF raymarch material for the truly exotic gems (WebGPU path):** render gyroid/Klein/smooth-knot as a raymarched signed-distance field in a fragment shader on a bounding proxy mesh. Inside the shader you get *true* refraction (refract the ray on entry, march through the medium, refract on exit), Beer–Lambert absorption along the actual path, and even cheap internal bounces — the genuinely refractive look that triangle transmission fakes. Expensive, so reserve for the **focused/hero shape only**, gate full quality behind WebGPU, and fall back to the solidified-mesh + `MeshTransmissionMaterial` path on WebGL2/mobile.
5. **Always recompute smooth normals and weld vertices** post-generation; bad normals wreck Fresnel and refraction direction more than any other single bug.

---

## 4. 4D shapes (tesseract, 120-cell)

The 4-polytopes are wireframe/edge beauty objects, rendered as glowing glass tubes rather than filled solids.

**Pipeline:**
1. **Vertex/edge tables** for the polytope in ℝ⁴ (tesseract: 16 verts/32 edges; 120-cell: 600 verts/1200 edges/720 pentagonal faces). Precompute once (Rust or a static JSON table).
2. **4D rotation = double rotation.** In 4D you rotate in a *plane*, not about an axis. The mesmerizing motion is a **double/isoclinic rotation**: simultaneously rotate in two orthogonal planes (e.g. the XW and YZ planes) at independent rates. Build a 4×4 rotation matrix as the product of two planar rotations and animate both angles in `useFrame`.
3. **Project 4D→3D.** Use **stereographic** or **perspective (4-point) projection**: `p3 = p4.xyz / (d - p4.w)` for perspective from a 4D eye at distance `d`. Stereographic projection of the 120-cell onto S³→ℝ³ gives the iconic nested-spheres look. Perspective projection gives the "tesseract breathing" effect (inner cube growing/shrinking).
4. **Render edges as glass tubes:** each projected edge becomes an instanced cylinder / a `TubeGeometry`, with `MeshTransmissionMaterial` or an emissive glass material, and a small glowing sphere at each vertex. Bloom does the heavy lifting on the glow.
5. **Faces (optional, gorgeous):** for the 120-cell, render the pentagonal cells as **translucent panes** (`transmission` + low opacity + iridescence) so light passes through the nested structure — like a crystalline soap-foam. Sort/blend carefully or use OIT-ish additive blending to avoid sort artifacts.
6. Vertex positions recompute on the GPU is overkill at these counts; do the 4D rotate+project in JS each frame (1200 edges is trivial) and update instanced matrices.

Visually: a slowly double-rotating, stereographically-projected 120-cell in glowing glass tubes, blooming, on a dark stage, is one of the most beautiful "what even is that" objects you can put in front of a player — make it a top-rarity pull.

---

## 5. Post-processing — the juice stack

Use **`pmndrs/postprocessing`** via **`@react-three/postprocessing`** (`<EffectComposer>` + effect components). It merges compatible effects into fewer passes (cheaper than raw three.js `EffectComposer`).

Order matters. Recommended chain:

1. **Render pass** (scene).
2. **Bloom** (`<Bloom>`): the glow that makes gems and emissive cores feel radiant. Use `mipmapBlur`, `luminanceThreshold ≈ 0.9` (only bright bits bloom), `intensity` per rarity. Drive emissive HDR values >1.0 on hero gems so they bloom selectively. This is the #1 juice effect.
3. **Chromatic aberration** (`<ChromaticAberration>`): subtle global RGB split at screen edges; *spike it* momentarily during the pull reveal for impact.
4. **Depth of field** (`<DepthOfField>`): focus on the gem, melt the background to creamy bokeh → product-photography feel. Cheap way to look expensive; great for the inspect/reveal view.
5. **Tone mapping — ACES Filmic.** Set `gl.toneMapping = ACESFilmicToneMapping` (or `AgXToneMapping` for a more neutral 2026 look) and render in HDR. This is what turns blown-out highlights into pleasing rolled-off light and makes the whole scene look cinematic rather than "WebGL default." Non-negotiable. Also enable correct color management (`THREE.ColorManagement` on, `outputColorSpace = SRGB`).
6. **Color grading**: `<HueSaturation>` / `<BrightnessContrast>` or a **LUT** (`<LUT>` with a `.cube` file via `LUTCubeLoader`) for a consistent, branded mood. Warm/jewel-toned grade.
7. **Vignette** (`<Vignette>`): gently darken edges to focus the eye on the centered gem.
8. (Optional) **Noise/film grain** at very low opacity to kill banding on the dark gradient background; **SMAA** for cheap AA (cheaper than MSAA with post).

Keep the background a subtle dark radial gradient so bloom and the gem read; never pure black (banding) and never busy.

---

## 6. The pull ceremony — the dopamine moment

This is the most important 3 seconds in the game. A scripted, shader-driven sequence for an **SSR pull**. Drive it with a timeline (`gsap` or a hand-rolled `useFrame` state machine writing material/post uniforms). Phases:

**Phase 0 — Anticipation (0.0–0.8s).** Camera pushes in on a dark stage. A single point of light at center. Audio sting. Slow down time/idle systems. Optional "rarity tell": the ambient light color hints at tier (gold/prismatic shimmer = high) — a controlled fake-out beat raises tension.

**Phase 1 — Charge (0.8–1.6s).** Particles (GPU `Points`, or `drei` `<Sparkles>`) spiral *inward* toward center, accelerating. A volumetric **light beam / god-ray column** rises (a stretched additive cone mesh + bloom). Screen-space chromatic aberration ramps up. Low-frequency screen shake builds. Vignette tightens.

**Phase 2 — Materialize (1.6–2.2s).** The shape **refracts into existence**:
- The gem's `transmission` and `thickness` animate 0→target so it fades in *as glass forming*, not as opacity. Its `envMapIntensity` and emissive core ramp up.
- A **dissolve/reveal shader**: a noise-thresholded clip (`step(noise, progress)`) with a bright emissive edge at the dissolve boundary, so the shape "crystallizes" from a glowing seed outward. (Works on the gem material via a clip term, or on a shell that peels away.)
- Manual **RGB dispersion** is briefly over-cranked then settles, so the moment of formation throws rainbow light.
- A radial **shockwave** post effect / expanding ring quad fires outward; brief **white flash** (additive fullscreen quad) at the peak masks the geometry pop-in.

**Phase 3 — Reveal & flourish (2.2–3.2s).** Flash fades to the finished gem, now slowly auto-rotating under its prismatic Lightformer rig. **Bloom intensity** and **chromatic aberration** settle from spiked → ambient. Particles drift outward and twinkle (`<Sparkles>`). **Depth of field** racks onto the gem; background bokeh blooms. Caustic light flickers across the (faux) floor. Rarity nameplate / "SSR" wipes in with its own glow.

**Phase 4 — Settle (3.2s+).** Hand control to the player: drag to rotate (with inertia, `OrbitControls` or custom), pinch/scroll to zoom. Idle micro-animation continues (internal energy churn via `temporalDistortion`, slow rotation). This is the "rotate the jewel" payoff the user asked for.

**Tiering the ceremony:** lower rarities get a *compressed, dimmer* version (shorter, less bloom, no beam, white instead of prismatic). The escalation of the *ceremony itself* — not just the gem — is a core dopamine lever. Reserve the full beam+shockwave+DoF rack for SR/SSR. Always allow a **skip/fast-forward** (hold to skip) for repeat pulls, but make the first reveal of a *new* shape unskippable-by-default to preserve the moment.

---

## 7. Performance — 60fps with many glossy refractive shapes

Refraction is expensive because each `MeshTransmissionMaterial` does an extra render of the scene to a target. Naively, 20 transmissive shapes = 20 extra scene renders = death. Strategy:

- **Only the focused shape gets real transmission.** In the gallery/idle view, the active/hovered/pulled shape uses `MeshTransmissionMaterial` (full back-face refraction). All others use cheap `MeshPhysicalMaterial` with `transmission` faked by a **pre-baked env reflection** + a static blurred backdrop sample, or even just an opaque iridescent PBR material. Swap materials on focus change. Players never inspect two gems at full quality simultaneously.
- **`frameloop="demand"`.** The idle/gallery is mostly static — render only on interaction/animation via `invalidate()`. Massive battery + perf win on web. Switch to continuous `frameloop="always"` only during the pull ceremony and active rotation, then back to demand.
- **Shared transmission render target.** drei's `MeshTransmissionMaterial` supports a shared `MeshTransmissionMaterial`-level buffer; render the transmission target at **half resolution** (`resolution={512}` or lower) — transmission is blurry anyway, nobody notices. Big cost saver.
- **Instancing for repeated elements:** particles, 4D-polytope edge tubes, gallery shelf items use `InstancedMesh` / drei `<Instances>`. One draw call for hundreds of edges/sparkles.
- **LOD.** `drei <Detailed>` / three `LOD`: high-poly mesh when focused/near, decimated mesh in the gallery grid, billboard/sprite when tiny. Generate LOD chain in Rust (decimation) at bake time.
- **Bake the gallery.** Items the player owns but isn't inspecting can be **pre-rendered to sprite thumbnails** (render once to a texture, display as a billboard) — zero per-frame cost for the collection grid. Re-render the sprite only when the item changes.
- **HDRI/texture budget:** prefer **Lightformer-based procedural environments** (0 bytes) for most scenes; one shared compressed `.ktx2`/`.hdr` env (≤2k, blurred-mip for body lighting) loaded once. Use **KTX2 + Basis** GPU-compressed textures for any image textures (LUTs, caustic maps). Total texture budget target: a few MB.
- **Mobile/web:** detect tier (GPU string, `dpr`). On mobile: cap `dpr` at ~1.5, drop `MeshTransmissionMaterial` to `MeshPhysicalMaterial`, lower transmission target res, reduce bloom mip levels, disable DoF, disable the SDF raymarch path, fewer particles. Keep the *ceremony* (it's the dopamine) but at reduced fidelity.
- **General hygiene:** dispose geometries/materials/render targets on unmount; reuse a single `EffectComposer`; avoid per-frame allocations in `useFrame` (mutate cached vectors); throttle WASM mesh regeneration; lazy-load the postprocessing + heavy geometry chunks via code-splitting.
- **WebGPU upside (when available):** GPU compute for particles and marching cubes offloads the CPU; lower draw-call overhead lets more shapes stay live. Treat as bonus headroom, not a requirement.

**Budget targets:** ≤1 full transmission pass/frame, ≤2–3 bloom mip levels on mobile, transmission target ≤512px, ≤~150k tris on the focused gem, gallery items as sprites or ≤5k-tri LODs.

---

## 8. Concrete library list + code sketches

### Libraries

| Purpose | Package |
|---|---|
| Core | `three`, `@react-three/fiber` |
| Helpers (Environment, Lightformer, controls, MeshTransmissionMaterial, Sparkles, Instances, Detailed, useGLTF, MeshReflectorMaterial) | `@react-three/drei` |
| Post FX | `@react-three/postprocessing`, `postprocessing` |
| Inject GLSL into PBR without forking | `three-custom-shader-material` |
| Path-traced bakes (caustics, hero stills/loops) | `three-gpu-pathtracer` |
| Timeline for the ceremony | `gsap` (or `@react-spring/three`) |
| State | `zustand` |
| Dev tuning of material params | `leva` |
| Geometry (WASM) | Rust crate (your own) compiled with `wasm-pack`; mesh I/O via `wasm-bindgen` typed arrays |
| Texture compression | `@gltf-transform/*` / `toktx` for KTX2/Basis |
| Perf monitor | `r3f-perf` |

### Sketch A — gemstone material per rarity (R3F/JSX)

```tsx
import { MeshTransmissionMaterial, Environment, Lightformer } from '@react-three/drei'

const RARITY = {
  SSR: { ior: 2.42, thickness: 2.5, chromaticAberration: 0.6, samples: 10,
         iridescence: 0.8, attenuationColor: '#ff3355', attenuationDistance: 0.8,
         emissive: '#ff88aa', emissiveIntensity: 2.5, distortion: 0.4 },
  R:   { ior: 1.5,  thickness: 1.0, chromaticAberration: 0.15, samples: 6,
         iridescence: 0.0, attenuationColor: '#88ccff', attenuationDistance: 2.0,
         emissive: '#000000', emissiveIntensity: 0.0, distortion: 0.0 },
}

function Gem({ geometry, rarity = 'SSR', t = 0 }) {
  const p = RARITY[rarity]
  return (
    <>
      <Environment background={false} resolution={512}>
        {/* zero-byte procedural studio rig; animate for SSR */}
        <Lightformer form="ring" intensity={6} position={[0, 2, 3]} scale={4} color="#ffe9c0" />
        <Lightformer form="rect" intensity={3} position={[-4, 1, 2]} scale={[2, 6, 1]} color="#a0c8ff" />
      </Environment>

      <mesh geometry={geometry}>
        <MeshTransmissionMaterial
          transmission={1} ior={p.ior} thickness={p.thickness}
          roughness={0.03} clearcoat={1} clearcoatRoughness={0.03}
          chromaticAberration={p.chromaticAberration} samples={p.samples}
          resolution={512} backside backsideThickness={p.thickness}
          iridescence={p.iridescence} iridescenceIOR={1.3}
          attenuationColor={p.attenuationColor} attenuationDistance={p.attenuationDistance}
          distortion={p.distortion} temporalDistortion={0.1}
          emissive={p.emissive} emissiveIntensity={p.emissiveIntensity}
          envMapIntensity={2.0}
        />
      </mesh>
    </>
  )
}
```

### Sketch B — stylized split-RGB dispersion + Fresnel rim (GLSL, injected via three-custom-shader-material)

Sample the transmission/back-face buffer three times with per-channel IOR so edges fringe rainbow, plus an emissive Fresnel rim that scales with rarity:

```glsl
// fragment additions; uTransmission = back-face/scene target, vViewDir & vNormal from vertex stage
uniform sampler2D uTransmission;
uniform float uIor;          // base index of refraction
uniform float uDispersion;   // rainbow spread, scaled by rarity
uniform float uRimPower;     // Fresnel exponent
uniform vec3  uRimColor;     // rim glow color (HDR > 1.0 so it blooms)

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // per-channel refraction -> chromatic dispersion ("fire")
  vec3 rR = refract(-V, N, 1.0 / (uIor - uDispersion));
  vec3 rG = refract(-V, N, 1.0 / (uIor));
  vec3 rB = refract(-V, N, 1.0 / (uIor + uDispersion));
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uTransmission, 0));
  float r = texture(uTransmission, uv + rR.xy * 0.04).r;
  float g = texture(uTransmission, uv + rG.xy * 0.04).g;
  float b = texture(uTransmission, uv + rB.xy * 0.04).b;
  vec3 refracted = vec3(r, g, b);

  // Fresnel rim (additive, HDR so postprocessing Bloom catches it)
  float fres = pow(1.0 - max(dot(N, V), 0.0), uRimPower);
  vec3 rim = uRimColor * fres;

  csm_DiffuseColor.rgb = refracted + rim;   // CSM hook back into MeshPhysicalMaterial
}
```

### Sketch C — render-on-demand + ceremony-driven frameloop (R3F)

```tsx
import { Canvas, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, ChromaticAberration, DepthOfField, Vignette } from '@react-three/postprocessing'

function Scene({ ceremonyActive }) {
  return (
    <Canvas
      // demand by default; switch to 'always' during ceremony/rotation
      frameloop={ceremonyActive ? 'always' : 'demand'}
      dpr={[1, 2]}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping }}
    >
      {/* ...gem, environment... */}
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur luminanceThreshold={0.9} intensity={ceremonyActive ? 1.8 : 0.8} />
        <ChromaticAberration offset={ceremonyActive ? [0.004, 0.004] : [0.0008, 0.0008]} />
        <DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={3} />
        <Vignette eskil={false} offset={0.2} darkness={0.9} />
      </EffectComposer>
    </Canvas>
  )
}
```

---

## Build order (suggested)

1. R3F canvas + ACES + dark stage + `OrbitControls` + a `TorusKnotGeometry` with `MeshTransmissionMaterial` + Lightformer environment → **prove the glass look** first.
2. Add the postprocessing chain (Bloom → CA → DoF → Vignette) → prove the juice.
3. `RARITY_PRESETS` material map + rarity ladder → prove escalation reads.
4. Rust→WASM marching cubes for the **solidified gyroid** + knot tubes → prove exotic shapes refract.
5. 4D 120-cell glass-tube projection → prove the showpiece.
6. Build the **pull ceremony** timeline → prove the dopamine.
7. Performance pass: `frameloop="demand"`, focused-only transmission, LOD/sprite gallery, mobile tiers.
8. (Optional, WebGPU) TSL materials + SDF raymarch hero path + GPU particles.

Everything here runs on the WebGL2 baseline; WebGPU/TSL/SDF-raymarch are additive quality tiers, not prerequisites.
```
