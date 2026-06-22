import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RARITY_COLOR } from './Gem'
import { sdfActiveGLSL } from './sdfShapes.glsl'
import { sceneById, atmosphereById, lightingById, heroCursorById, SLOT_ATMOSPHERE, SLOT_FINISH, SLOT_LIGHTING, SLOT_HERO_CURSOR } from '../content/cosmetics'
import { finishSdf } from './finishSdf'
import { useGame, type RarityName } from '../game/store'
import { useGfxPreset, useGfx } from '../gfx'

// Families with an exact signed-distance field — the hero gem raymarches these for TRUE per-pixel
// refraction (real internal bounces, dispersion) and mathematically-exact implicit surfaces (gyroid,
// Schwarz-P/D). Everything else falls back to the mesh + MeshTransmissionMaterial path.
export const RAYMARCH_SHAPES: Record<string, number> = {
  sphere: 0,
  cube: 1,
  octahedron: 2,
  torus: 3,
  ellipsoid: 4,
  gyroid: 5,
  schwarz_p: 6,
  schwarz_d: 7,
  mazur: 11, // the "monster" — a lumpy ball that's secretly contractible
  // moved off the mesh BVH tracer onto the fast parameterised path (sdfShapes.glsl):
  trefoil: 12,
  figure8_knot: 13,
  torus_knot_2_5: 14,
  torus_knot_2_7: 15,
  // heptoroid removed from the raymarch path: it's a genus-7 SURFACE (real .ply relic), not a (7,2) torus KNOT —
  // the knot SDF looked nothing like the mesh. Falls through to HeroGem, which loads /models/heptoroid.ply.
  klein_quartic: 17,
  menger: 20,
  sierpinski: 22,
  stanford_bunny: 23, // Blackle Mori's neural-network SDF (CC0) — the relic bunny without the mesh/BVH
  mandelbulb: 24, // power-8 fractal distance estimator (sdf-explorer)
  helix: 25, // double helix (sdf-explorer)
  mobius: 26, // non-orientable band (custom SDF — off the parametric mesh path)
  spike: 27, // spiky caltrop / urchin (custom SDF)
  // exact analytic primitives — true-refraction glass for the remaining Platonics + round solids (completes the set)
  tetrahedron: 28,
  dodecahedron: 29,
  icosahedron: 30,
  cylinder: 31,
  cone: 32,
  disk: 33,
  // genus surfaces & links — smooth-min of tori; matches the mergedTori/linkedRings meshes (eyeball the hole count)
  genus2: 34,
  triple_torus: 35,
  borromean: 36,
  klein_bottle: 37, // iconic "bottle" immersion (real SDF, matches the Bourke mesh) — non-orientable, self-intersecting
  // classical surfaces of revolution / ruled — raymarched for true refraction (SDFs are Lipschitz-corrected in
  // sdfShapes.glsl so the thin open shells don't tunnel/vanish at grazing or axial views).
  hyperboloid: 38,
  catenoid: 39,
  helicoid: 40,
  // fractal showpieces (Transcendent cohort) — compact distance estimators, siblings to the Mandelbulb
  mandelbox: 41,
  julia: 42,
  apollonian: 43,
  kleinian: 44,
  // warped classics (Ssr) — opTwist torus + IQ's cut hollow sphere + fogleman's blobby
  twisted_torus: 45,
  cut_hollow_sphere: 46,
  blobby: 47,
  // NG+ cohort expansion — 4D cross-sections (Meta) + algebraic/attractor jewels (Transcendent). Cheap SDFs in
  // sdfShapes.glsl: rounded slab, square-profile torus, exact cuboctahedron (cube∩octa), the ditorus
  // (hollow-tube torus — a tunnel through the dough).
  spherinder_slice: 48,
  duocylinder: 49,
  cell24_section: 50,
  ditorus: 51,
  // Roster rebalance — in-place swaps to raymarched algebraic surfaces, a {4,3,5} honeycomb fold, an attractor
  // coil, and a Costa render-fix (its own SDF, off the catenoid+ring mesh path). Renamed keys keep old numerics.
  hyperbolic_honeycomb: 52, // {4,3,5} Coxeter sphere-inversion fold (inherited slot 52)
  aizawa_attractor: 53,     // tornado-coil strange-attractor tube (inherited slot 53)
  barth_sextic: 54,         // 65-node degree-6 surface, icosahedral symmetry (inherited slot 54)
  roman_surface: 55,        // Steiner's four-lobed quartic (ℝP²)
  whitney_umbrella: 56,     // the pinch-point surface x²−y²z
  endrass_octic: 57,        // many-node degree-8 nodal jewel
  costa: 58,                // render-fix — Costa surface gets its own SDF (off the mesh path)
}

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Outputs LINEAR HDR — ACES tone mapping + sRGB happen in the post pass (EffectComposer in HeroView), the
// SAME operator the mesh/transmission path uses, so a raymarched sphere and a transmission knot grade alike.
// `sdfGLSL` is the per-shape field (sdfActiveGLSL) — ONLY the active shape, so the program stays small.
const makeFrag = (STEPS: number, INNER: number, sdfGLSL: string) => /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform float uTime;
  uniform vec2  uRes;
  uniform vec3  uColor;   // body tint (Beer absorption) — rarity, or the equipped gem finish's colour
  uniform float uIor;
  uniform float uAberr;   // chromatic dispersion
  uniform float uRim;     // rarity rim-glow strength (HDR → blooms in the post pass)
  uniform float uEmissive;  // equipped finish inner glow (0 = none)
  uniform float uAbsorbMul; // equipped finish density (≥1 darkens/denses a low-transmission finish; 1 = default)
  uniform float uReflMul;   // equipped finish env-reflection strength (1 = default)
  uniform float uForm;    // materialize 0→1: a glowing solid "seed" refracts into the finished gem
  // real R3F camera: rays + gl_FragDepth → cosmos pans on orbit + 3D atmosphere depth-composites WITH the gem
  uniform vec3  uCamPos;
  uniform mat4  uInvViewProj;  // NDC → world ray
  uniform mat4  uViewProj;     // world → clip, for writing real gl_FragDepth at the gem hit
  // scene palette (LINEAR) — the procedural cosmos the gem refracts/reflects, re-tinted per Shop scene
  uniform vec3  uBackdrop;
  uniform vec3  uKey;
  uniform vec3  uCool;
  uniform vec3  uWarm;
  uniform vec3  uStar;
  uniform vec3  uAtmoTint;     // equipped Atmosphere's hue, blended into env → refraction/reflection carries the mood
  uniform float uAtmoAmt;      // 0 = Clear (no tint)
  uniform samplerCube uEnvCube; // live cubemap of the atmosphere captured around the gem
  uniform float uEnvCubeAmt;   // 0 = procedural env only; >0 = refract/reflect the real atmosphere
  // cursor follow-light (Gem Spotlight, slot 9 — default OFF): a soft specular/rim that tracks the pointer over
  // the SDF gem, lit by a world-space direction toward the cursor. uCursorAmt = 0 → no-op (the default).
  uniform vec3  uCursorDir;    // world-space direction FROM the gem TOWARD the cursor-light position
  uniform vec3  uCursorCol;    // cursor light colour (linear)
  uniform float uCursorAmt;    // 0 = off; otherwise the highlight strength

  mat3 R;

  mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
  mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

  // Smooth blurred-IBL-style gradient — matches the mesh hero's heavily-blurred Environment background (no hard
  // stars/glints/bands, which read as a noisy ring/blotch through the glass). Soft vertical gradient + broad
  // directional glows (low exponents) + a small hot key core for a gentle specular highlight.
  vec3 env(vec3 d){
    float up = clamp(d.y*0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBackdrop*0.42, uBackdrop*1.08, up*up);
    col += uKey  * 0.65 * pow(max(dot(d, normalize(vec3(0.35,0.75,0.40))), 0.0), 3.0);
    col += uCool * 0.35 * pow(max(dot(d, normalize(vec3(-0.6,0.25,0.55))), 0.0), 2.5);
    col += uWarm * 0.35 * pow(max(dot(d, normalize(vec3(0.3,-0.45,-0.55))), 0.0), 2.5);
    col += uKey  * 1.6  * pow(max(dot(d, normalize(vec3(0.35,0.75,0.40))), 0.0), 24.0);
    // equipped Atmosphere tints the environment the gem refracts/reflects, so it visibly carries the mood
    col += uAtmoTint * uAtmoAmt * (0.28 + 0.6 * up * up);
    return col;
  }

  // env for the gem's REFRACTION/REFLECTION: blends a live cubemap of the real atmosphere over the procedural env,
  // so the gem bends the actual clouds/nebula/aurora. uEnvCubeAmt = 0 → procedural only (cube never sampled).
  vec3 envGem(vec3 d){
    vec3 base = env(d);
    if(uEnvCubeAmt <= 0.0) return base;
    vec3 atmo = min(texture(uEnvCube, d).rgb, vec3(4.0)); // gentle safety clamp so a very bright/additive atmosphere can't blow the refraction out
    return mix(base, base * 0.5 + atmo, uEnvCubeAmt);
  }

${sdfGLSL}

  float map(vec3 p){
    // gentle float bob (visible even on a sphere, whose spin is otherwise invisible), then spin in place
    p = R * (p - vec3(0.0, sin(uTime * 1.15) * 0.14, 0.0));
    return sdfActive(p);   // the ONE active shape (sdfActiveGLSL), injected above as sdfGLSL
  }

  vec3 nrm(vec3 p){
    vec2 e=vec2(0.0012,0.0);
    return normalize(vec3(
      map(p+e.xyy)-map(p-e.xyy),
      map(p+e.yxy)-map(p-e.yxy),
      map(p+e.yyx)-map(p-e.yyx)));
  }

  // refract in → march the interior → refract out (with per-channel dispersion + Beer absorption)
  vec3 refractGem(vec3 p, vec3 rd, vec3 n){
    vec3 ri = refract(rd, n, 1.0/uIor);
    vec3 ip = p + ri*0.02;
    float dist=0.0;
    for(int i=0;i<${INNER};i++){
      float d = -map(ip);
      if(d<0.0008) break;
      ip += ri*d*0.7; dist += d*0.7;
      if(dist>5.0) break;
    }
    vec3 ne = -nrm(ip);
    vec3 oR = refract(ri, ne, uIor*(1.0-uAberr));
    vec3 oG = refract(ri, ne, uIor);
    vec3 oB = refract(ri, ne, uIor*(1.0+uAberr));
    vec3 tir = reflect(ri, ne);
    if(dot(oR,oR)<0.001) oR=tir;
    if(dot(oG,oG)<0.001) oG=tir;
    if(dot(oB,oB)<0.001) oB=tir;
    vec3 col = vec3(envGem(oR).r, envGem(oG).g, envGem(oB).b);
    // rarity-coloured tint via Beer-Lambert. CLAMP the path: a SOLID gem (sphere/ellipsoid) traverses its whole
    // diameter and would over-absorb into a dark void, while thin-shell exotics (short path) are unaffected — so
    // this brightens Pip & the solid commons without touching the tuned look of the exotic gems.
    vec3 absorb = (vec3(1.0)-uColor) * min(dist, 0.8) * 0.9 * uAbsorbMul; // finish density (low transmission → denser)
    return col * exp(-absorb);
  }

  // sphere-trace; also reports soft silhouette coverage + the closest-approach distance for analytic edge AA
  float trace(vec3 ro, vec3 rd, out float cover, out float tEdge){
    float t=0.0, closest=1e9;
    tEdge=0.0; cover=0.0;
    for(int i=0;i<${STEPS};i++){
      float d=map(ro+rd*t);
      if(d<closest){ closest=d; tEdge=t; }
      if(d<0.0007){ cover=1.0; return t; }
      t += d*0.7;                  // <1 for the approximate TPMS fields
      if(t>8.0) break;
    }
    // miss: a grazing near-miss still partially covers the pixel — antialias the silhouette by the SDF's
    // closest approach vs the pixel footprint (free with sphere tracing; canvas MSAA can't touch SDF edges).
    // px grows with the surface distance (tEdge) — a reasonable screen-space pixel footprint now that the
    // camera matrix (not uZoom) sets the framing.
    float px = (2.0/uRes.y) * tEdge * 1.2;
    cover = 1.0 - smoothstep(0.0, px, closest);
    return -1.0;
  }

  vec3 shade(vec3 p, vec3 rd){
    vec3 n = nrm(p);
    vec3 reflCol = envGem(reflect(rd,n)) * uReflMul;                 // finish env-reflection strength
    float F0 = pow((1.0-uIor)/(1.0+uIor), 2.0);                      // Schlick F0 from the actual IOR
    float f = F0 + (1.0-F0)*pow(1.0-max(dot(-rd,n),0.0), 5.0);
    vec3 col = mix(refractGem(p,rd,n), reflCol, f) + reflCol*0.05;
    col += uColor * f * uRim;                                        // rarity rim-glow (HDR → blooms)
    col += uColor * uEmissive * 0.6;                                 // equipped finish inner glow (0 = none)
    // cursor follow-light: a tracking specular highlight + a soft rim where the gem faces the cursor. Active only
    // when the inspector enables it (uCursorAmt > 0). A tight Blinn-style lobe gives the "spot grazing the facet"
    // read as you sweep the pointer; the rim term keeps it visible on edges too. HDR → it blooms in the post pass.
    if(uCursorAmt > 0.0){
      vec3 ld = normalize(uCursorDir);
      vec3 h  = normalize(ld - rd);                                  // half-vector (view = -rd)
      float spec = pow(max(dot(n, h), 0.0), 48.0);                  // crisp tracking highlight
      float lit  = max(dot(n, ld), 0.0);                            // soft diffuse-ish wrap on the lit side
      col += uCursorCol * uCursorAmt * (spec * 1.6 + lit * 0.12 + f * lit * 0.5);
    }
    return col;
  }

  void main(){
    // gem AUTO-SPINS in place (R in map()); the REAL camera orbits it, so the cosmos background pans as you
    // orbit (env(rd) uses the world ray), instead of the gem spinning against a screen-pinned cosmos.
    R = rotY(uTime*0.12);
    // primary ray from the real R3F camera (aspect handled by the camera matrix — no manual aspect divide)
    vec2 ndc = vUv*2.0 - 1.0;
    vec4 fw = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 ro = uCamPos;
    vec3 rd = normalize(fw.xyz/fw.w - uCamPos);
    float cover, tEdge;
    float t = trace(ro,rd,cover,tEdge);
    vec3 col;
    // while forming, the gem reads as a solid glowing rarity-coloured seed (HDR → blooms) that refracts into
    // the finished glass as uForm→1 — matching the mesh path's "opaque glowing core → clear glass".
    vec3 seed = uColor * 2.0;
    if(t>=0.0)            col = mix(seed, shade(ro+rd*t, rd), uForm);                  // hit (cover = 1)
    else if(cover>0.001)  col = mix(env(rd), mix(seed, shade(ro+rd*tEdge, rd), uForm), cover); // antialiased silhouette
    else                  col = env(rd);                            // background cosmos
    // mild exposure lift — the post pass applies ACES, which rolls midtones down harder than the old Reinhard
    // curve this shader used to bake in; 1.15 keeps the cosmos from reading muddy. (Tune once eyeballed.)
    fragColor = vec4(col * 1.15, 1.0);
    // Write REAL per-pixel depth so 3D atmosphere depth-composites WITH the gem: a gem hit writes its near
    // depth (atmosphere behind is occluded), a miss/silhouette writes far=1.0 (background atmosphere shows).
    if(t >= 0.0){
      vec4 clip = uViewProj * vec4(ro + rd*t, 1.0);
      gl_FragDepth = clamp((clip.z/clip.w)*0.5 + 0.5, 0.0, 1.0);
    } else {
      gl_FragDepth = 1.0;
    }
  }
`

export function RaymarchGem({ family, rarity, controls = true, autoRotate = false, materialize = false, previewScene, previewFinish, envMap }: { family: string; rarity: RarityName; controls?: boolean; autoRotate?: boolean; materialize?: boolean; previewScene?: number; previewFinish?: number; envMap?: THREE.Texture | null }) {
  const ref = useRef<THREE.ShaderMaterial>(null)
  const g = useGfxPreset()
  const ptEnvCubeAmt = useGfx((s) => s.ptEnvCubeAmt) // user-tunable atmosphere-refraction strength
  // `previewScene` (shop preview) shows the gem in an UNequipped scene without touching the equipped one.
  const storeScene = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(previewScene ?? storeScene)
  const atmo = atmosphereById(useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)) // equipped Atmosphere tints refraction
  const lin = (hex: string) => {
    const k = new THREE.Color(hex).convertSRGBToLinear()
    return new THREE.Vector3(k.r, k.g, k.b)
  }
  // a representative hue for the equipped atmosphere → blended into env() so the gem's refraction/reflection carries it
  const atmoTint = useMemo(() => lin(atmo.vol?.colorB ?? atmo.clouds?.colorLight ?? atmo.godRays?.color ?? atmo.aurora?.colorA ?? atmo.mote), [atmo])
  const atmoAmt = atmo.id === 0 ? 0 : 0.32
  // Equipped gem finish (Shop cosmetic) mapped onto the SDF shader — `previewFinish` lets the shop hover-preview one.
  const equippedFinish = useGame((s) => s.view?.equipped?.[SLOT_FINISH] ?? 0)
  const fin = finishSdf(previewFinish ?? equippedFinish)
  const L = lightingById(useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)) // equipped Lighting mood — scales the env the gem is lit by
  // hero cursor light (Gem Spotlight, slot 9 — default OFF). Only feeds the shader in the interactive inspector.
  const cursorFx = heroCursorById(useGame((s) => s.view?.equipped?.[SLOT_HERO_CURSOR] ?? 0))
  const cursorOn = controls && cursorFx.intensity > 0
  const { pointer } = useThree()
  // scratch objects reused per frame (no per-frame allocation in the hot loop). `baseCol` holds the cursor's
  // linear-space colour (disco moods mutate it in HSL each frame before it's written into the uniform).
  const cursorScratch = useMemo(() => ({ ray: new THREE.Raycaster(), plane: new THREE.Plane(), camDir: new THREE.Vector3(), hit: new THREE.Vector3(), dir: new THREE.Vector3(), origin: new THREE.Vector3(), col: new THREE.Color(cursorFx.color).convertSRGBToLinear() }), [cursorFx])
  const rarityCol = lin(RARITY_COLOR[rarity])
  const baseIor = 1.45 + RANK[rarity] * 0.05
  const baseAberr = 0.02 + RANK[rarity] * 0.02
  // base rim/key the animated "Moving light ✦" moods breathe around (must match the uniforms' initial values)
  const baseRim = (RANK[rarity] >= 3 ? 0.25 + (RANK[rarity] - 3) * 0.35 : 0.07 + RANK[rarity] * 0.05) * L.rim
  const baseKeyVec = useMemo(() => lin(scene.env[1]).multiplyScalar(L.key), [scene, L])
  // Per-shape shader: inject ONLY this family's SDF (sdfActiveGLSL), so the program stays small. Rebuilds when
  // the shape changes (three caches compiled programs by source, so each shape compiles once).
  const frag = useMemo(() => makeFrag(g.raySteps, g.rayInner, sdfActiveGLSL(family)), [g.raySteps, g.rayInner, family])

  const uniforms = useMemo(() => {
    const rank = RANK[rarity]
    const c = lin(RARITY_COLOR[rarity])
    const [backdrop, key, cool, warm] = scene.env
    return {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: c },
      uIor: { value: 1.45 + rank * 0.05 },
      uAberr: { value: 0.02 + rank * 0.02 },
      uRim: { value: (rank >= 3 ? 0.25 + (rank - 3) * 0.35 : 0.07 + rank * 0.05) * L.rim }, // equipped Lighting scales the rim glow
      uForm: { value: materialize ? 0 : 1 },
      uCamPos: { value: new THREE.Vector3() },
      uInvViewProj: { value: new THREE.Matrix4() },
      uViewProj: { value: new THREE.Matrix4() },
      uBackdrop: { value: lin(backdrop).multiplyScalar(L.ambient) },
      uKey: { value: lin(key).multiplyScalar(L.key) },
      uCool: { value: lin(cool).multiplyScalar(L.ambient) },
      uWarm: { value: lin(warm).multiplyScalar(L.ambient) },
      uStar: { value: lin(scene.stars) },
      uAtmoTint: { value: new THREE.Vector3() },
      uAtmoAmt: { value: 0 },
      uEnvCube: { value: null as THREE.Texture | null },
      uEnvCubeAmt: { value: 0 },
      uEmissive: { value: 0 },
      uAbsorbMul: { value: 1 },
      uReflMul: { value: 1 },
      uCursorDir: { value: new THREE.Vector3(0, 0, 1) },
      uCursorCol: { value: new THREE.Vector3(1, 1, 1) },
      uCursorAmt: { value: 0 },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, rarity, scene, L])

  // The shape is drawn by a fullscreen-quad shader that builds its primary rays from the REAL R3F camera
  // (uCamPos/uInvViewProj/uViewProj), so the OrbitControls below drive the gem exactly like every other shape
  // (drag-rotate / wheel-pinch-zoom from anywhere on the canvas, touch too), the cosmos pans on orbit, and the
  // gem writes real gl_FragDepth so the 3D atmosphere layer depth-composites WITH it. The gentle auto-spin
  // (uTime → R in map()) composes on top, matching the mesh gems' spin + orbit.
  useFrame((state, dt) => {
    const m = ref.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    // drawing-buffer size (CSS size × dpr), not CSS size — the analytic silhouette-AA footprint `px` must be in
    // real device pixels or it's ~2× too wide (soft edges) on hi-dpi.
    state.gl.getDrawingBufferSize(m.uniforms.uRes.value)
    // materialize form-in (reveal only): the seed refracts into the finished gem over ~0.75s
    if (materialize && m.uniforms.uForm.value < 1) m.uniforms.uForm.value = Math.min(1, m.uniforms.uForm.value + dt / 0.75)
    const cam = state.camera
    m.uniforms.uCamPos.value.copy(cam.position)
    // NDC → world ray for the raymarcher (inverse of projection · view); forward matrix for the depth write
    m.uniforms.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    m.uniforms.uInvViewProj.value.copy(m.uniforms.uViewProj.value).invert()
    m.uniforms.uAtmoTint.value.copy(atmoTint)
    m.uniforms.uAtmoAmt.value = atmoAmt
    m.uniforms.uEnvCube.value = envMap ?? null // live atmosphere cubemap (HeroView provides it for skyey moods on high gfx)
    m.uniforms.uEnvCubeAmt.value = envMap ? ptEnvCubeAmt : 0
    // equipped gem finish → SDF look (live, so a shop hover-preview updates instantly). Default Prism = no-op.
    m.uniforms.uColor.value.copy(fin.tint ?? rarityCol)
    m.uniforms.uIor.value = baseIor + fin.iorAdd
    m.uniforms.uAberr.value = baseAberr + fin.aberrAdd
    m.uniforms.uEmissive.value = fin.emissive
    m.uniforms.uAbsorbMul.value = fin.absorbMul
    m.uniforms.uReflMul.value = fin.reflMul
    // "Moving light ✦" moods on the SDF hero: the env() is direction-baked, so we can't orbit a light here — but
    // we breathe the rim glow + key intensity so the PULSE part of the motion reads (intensity/hue breathing).
    const mot = L.motion
    if (mot && (mot.pulseDepth || mot.hueShift)) {
      const tt = state.clock.elapsedTime
      const breath = 1 + Math.sin(tt * (mot.pulseRate ?? 0.3) * Math.PI * 2) * (mot.pulseDepth ?? 0)
      m.uniforms.uRim.value = baseRim * breath
      m.uniforms.uKey.value.copy(baseKeyVec).multiplyScalar(breath)
    } else {
      m.uniforms.uRim.value = baseRim
    }
    // cursor follow-light: map the pointer onto a camera-facing plane through the gem and feed the shader the
    // world-space direction toward it. Active only in the interactive inspector when a Gem Spotlight is equipped.
    if (cursorOn) {
      const { ray, plane, camDir, hit, dir, origin, col } = cursorScratch
      cam.getWorldDirection(camDir)
      plane.setFromNormalAndCoplanarPoint(camDir, origin.set(0, 0, 0)) // plane through the gem, facing the camera
      ray.setFromCamera(pointer, cam)
      if (ray.ray.intersectPlane(plane, hit)) {
        dir.copy(hit).addScaledVector(camDir, -1.6).normalize() // gem at origin → direction toward the cursor light
        m.uniforms.uCursorDir.value.copy(dir)
      }
      if (cursorFx.disco) col.setHSL((state.clock.elapsedTime * 0.4) % 1, 0.85, 0.6)
      const cc = m.uniforms.uCursorCol.value as THREE.Vector3
      cc.set(col.r, col.g, col.b)
      m.uniforms.uCursorAmt.value = cursorFx.intensity * 0.4 // scale the point-intensity into a shader rim gain
    } else {
      m.uniforms.uCursorAmt.value = 0
    }
  })

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-10}>
        <planeGeometry args={[2, 2]} />
        {/* drawn first (renderOrder −10) and writes REAL per-pixel depth (gl_FragDepth: the gem hit's depth, far
            on a miss), so the equipped Atmosphere depth-composites WITH the gem — occluded behind it, visible in
            the cosmos around it — instead of flat-overlaying. */}
        <shaderMaterial key={`${g.raySteps}-${family}`} ref={ref} glslVersion={THREE.GLSL3} vertexShader={VERT} fragmentShader={frag} uniforms={uniforms} />
      </mesh>
      {controls && (
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
          minDistance={3}
          maxDistance={9}
          rotateSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      )}
    </>
  )
}
