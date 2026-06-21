import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RARITY_COLOR } from './Gem'
import { sdfActiveGLSL } from './sdfShapes.glsl'
import { sceneById } from '../content/cosmetics'
import { useGame, type RarityName } from '../game/store'
import { useGfxPreset } from '../gfx'

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
  // classical surfaces of revolution / ruled (mazur is already raymarched above; just enriched its SDF)
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
}

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

const VERT = /* glsl */ `
  varying vec2 vUv;
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
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uRes;
  uniform vec3  uColor;   // rarity tint (Beer absorption)
  uniform float uIor;
  uniform float uAberr;   // chromatic dispersion
  uniform float uRim;     // rarity rim-glow strength (HDR → blooms in the post pass)
  uniform float uForm;    // materialize 0→1: a glowing solid "seed" refracts into the finished gem
  uniform float uYaw;     // drag-orbit
  uniform float uPitch;
  uniform float uZoom;    // wheel/pinch zoom (camera distance)
  // scene palette (LINEAR) — the procedural cosmos the gem refracts/reflects, re-tinted per Shop scene
  uniform vec3  uBackdrop;
  uniform vec3  uKey;
  uniform vec3  uCool;
  uniform vec3  uWarm;
  uniform vec3  uStar;

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
    return col;
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
    vec3 col = vec3(env(oR).r, env(oG).g, env(oB).b);
    // rarity-coloured tint via Beer-Lambert. CLAMP the path: a SOLID gem (sphere/ellipsoid) traverses its whole
    // diameter and would over-absorb into a dark void, while thin-shell exotics (short path) are unaffected — so
    // this brightens Pip & the solid commons without touching the tuned look of the exotic gems.
    vec3 absorb = (vec3(1.0)-uColor) * min(dist, 0.8) * 0.9;
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
    float px = 2.0/uRes.y * uZoom * 1.6;
    cover = 1.0 - smoothstep(0.0, px, closest);
    return -1.0;
  }

  vec3 shade(vec3 p, vec3 rd){
    vec3 n = nrm(p);
    vec3 reflCol = env(reflect(rd,n));
    float F0 = pow((1.0-uIor)/(1.0+uIor), 2.0);                      // Schlick F0 from the actual IOR
    float f = F0 + (1.0-F0)*pow(1.0-max(dot(-rd,n),0.0), 5.0);
    vec3 col = mix(refractGem(p,rd,n), reflCol, f) + reflCol*0.05;
    col += uColor * f * uRim;                                        // rarity rim-glow (HDR → blooms)
    return col;
  }

  void main(){
    // camera ORBITS (rotate the rays + the env), gem AUTO-SPINS in place — so the cosmos background moves as you
    // orbit (like the mesh hero), instead of the gem spinning against a screen-pinned cosmos.
    mat3 Rcam = rotY(uYaw) * rotX(0.4 + uPitch);
    R = rotY(uTime*0.12);
    vec2 uv = (vUv*2.0-1.0);
    uv.x *= uRes.x/uRes.y;
    vec3 ro = Rcam * vec3(0.0,0.0,3.2*uZoom);
    vec3 rd = Rcam * normalize(vec3(uv,-2.2));
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
    gl_FragColor = vec4(col * 1.15, 1.0);
  }
`

export function RaymarchGem({ family, rarity, controls = true, autoRotate = false, materialize = false }: { family: string; rarity: RarityName; controls?: boolean; autoRotate?: boolean; materialize?: boolean }) {
  const ref = useRef<THREE.ShaderMaterial>(null)
  const g = useGfxPreset()
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  // Per-shape shader: inject ONLY this family's SDF (sdfActiveGLSL), so the program stays small. Rebuilds when
  // the shape changes (three caches compiled programs by source, so each shape compiles once).
  const frag = useMemo(() => makeFrag(g.raySteps, g.rayInner, sdfActiveGLSL(family)), [g.raySteps, g.rayInner, family])

  const uniforms = useMemo(() => {
    const rank = RANK[rarity]
    const lin = (hex: string) => {
      const k = new THREE.Color(hex).convertSRGBToLinear()
      return new THREE.Vector3(k.r, k.g, k.b)
    }
    const c = lin(RARITY_COLOR[rarity])
    const [backdrop, key, cool, warm] = scene.env
    return {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: c },
      uIor: { value: 1.45 + rank * 0.05 },
      uAberr: { value: 0.02 + rank * 0.02 },
      uRim: { value: rank >= 3 ? 0.25 + (rank - 3) * 0.35 : 0.07 + rank * 0.05 },
      uForm: { value: materialize ? 0 : 1 },
      uYaw: { value: 0 },
      uPitch: { value: 0 },
      uZoom: { value: 1 },
      uBackdrop: { value: lin(backdrop) },
      uKey: { value: lin(key) },
      uCool: { value: lin(cool) },
      uWarm: { value: lin(warm) },
      uStar: { value: lin(scene.stars) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, rarity, scene])

  // The shape is drawn by a fullscreen-quad shader that ignores the three.js camera, so we bridge the
  // SAME OrbitControls the mesh/transmission Stage uses (see Stage.tsx) into the shader's orbit uniforms:
  // read the orbiting camera's azimuth/elevation/distance each frame and feed uYaw/uPitch/uZoom. This gives
  // the raymarched hero identical drag-rotate / wheel-pinch-zoom (from anywhere on the canvas, touch too) as
  // every other shape, while keeping its own procedural cosmos as the backdrop. The gentle auto-spin
  // (uTime in the shader) composes on top of the orbit, matching the mesh gems' spin + orbit.
  useFrame((state, dt) => {
    const m = ref.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    // drawing-buffer size (CSS size × dpr), not CSS size — the analytic silhouette-AA footprint `px` must be in
    // real device pixels or it's ~2× too wide (soft edges) on hi-dpi. (Aspect use of uRes is a ratio, unaffected.)
    state.gl.getDrawingBufferSize(m.uniforms.uRes.value)
    // materialize form-in (reveal only): the seed refracts into the finished gem over ~0.75s
    if (materialize && m.uniforms.uForm.value < 1) m.uniforms.uForm.value = Math.min(1, m.uniforms.uForm.value + dt / 0.75)
    const cam = state.camera
    const dist = cam.position.length() || 5
    m.uniforms.uZoom.value = THREE.MathUtils.clamp(dist / 5, 0.45, 2.6)
    m.uniforms.uYaw.value = Math.atan2(cam.position.x, cam.position.z)
    const polar = Math.acos(THREE.MathUtils.clamp(cam.position.y / dist, -1, 1))
    m.uniforms.uPitch.value = THREE.MathUtils.clamp(Math.PI / 2 - polar, -1.4, 1.4)
  })

  return (
    <>
      <mesh frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial key={`${g.raySteps}-${family}`} ref={ref} vertexShader={VERT} fragmentShader={frag} uniforms={uniforms} />
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
