import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RARITY_COLOR } from './Gem'
import { sdfActiveGLSL } from './sdfShapes.glsl'
import { sceneById, atmosphereById, SLOT_ATMOSPHERE } from '../content/cosmetics'
import { useGame, type RarityName } from '../game/store'
import { usePathTraceParams, useGfxPreset, useGfx } from '../gfx'

// ── Custom GLSL multi-bounce path tracer (NO library) ─────────────────────────────────────────────────────
// One HDR fullscreen quad: each frame the fragment shader traces `spp` Monte-Carlo multi-bounce light paths per
// pixel through the gem (Fresnel-stochastic reflect/refract, Beer–Lambert absorption, TIR — real internal
// caustics/"fire") and outputs the average in LINEAR HDR. HeroView wraps it in the SAME EffectComposer (Bloom +
// ACES + Vignette) the mesh hero uses, so the gem gets identical bloom/grade — no custom accumulation or
// render-loop takeover (the auto-spin reset accumulation every frame, so per-frame spp is the quality knob).
// Reuses RaymarchGem's analytic SDF fields, so it covers the SDF families (meshes/4D need a BVH — out of scope).

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

const VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const makePT = (BOUNCES: number, STEPS: number, SPP: number, sdfGLSL: string) => /* glsl */ `
  precision highp float;
  out vec4 fragColor;
  uniform float uSeed;     // per-frame sample index (RNG salt)
  uniform vec2  uRes;      // drawing-buffer size
  uniform vec3  uColor;    // rarity tint (Beer absorption)
  uniform float uIor;
  uniform float uTime;     // gentle auto-spin
  uniform vec3  uCamPos;       // real R3F camera: rays + gl_FragDepth → cosmos moves on orbit + motes composite in-world
  uniform mat4  uInvViewProj;  // NDC → world ray
  uniform vec3  uBackdrop, uKey, uCool, uWarm, uStar;
  uniform int   uMotes;    // # of emissive ambient motes to trace (0 when the gfx Particles setting is off)
  uniform float uHaze;     // volumetric single-scatter haze density (0 = off)

  mat3 R;
  mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
  mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

  // Float hash RNG (Dave Hoskins hash13) — well-distributed for fast convergence, and pure GLSL ES 1.00 (the
  // earlier uint/uvec2 version was GLSL ES 3.00 syntax that fails to compile on strict drivers e.g. ANGLE/win32).
  float gSeed;
  float rnd(){
    gSeed += 1.0;
    vec3 p3 = fract(vec3(gl_FragCoord.xyx) * 0.1031 + gSeed * 0.137 + uSeed * 0.0411);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Smooth blurred-IBL-style gradient — matches the mesh hero's heavily-blurred Environment background (no hard
  // stars/glints/bands, which read as a noisy "ring"/blotch through the glass). A soft vertical gradient plus
  // three BROAD directional glows (low exponents → wide + smooth); a faint hot key core keeps a gentle specular.
  vec3 env(vec3 d){
    float up = clamp(d.y*0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBackdrop*0.42, uBackdrop*1.08, up*up);
    col += uKey  * 0.65 * pow(max(dot(d, normalize(vec3(0.35,0.75,0.40))), 0.0), 3.0);
    col += uCool * 0.35 * pow(max(dot(d, normalize(vec3(-0.6,0.25,0.55))), 0.0), 2.5);
    col += uWarm * 0.35 * pow(max(dot(d, normalize(vec3(0.3,-0.45,-0.55))), 0.0), 2.5);
    col += uKey  * 1.6  * pow(max(dot(d, normalize(vec3(0.35,0.75,0.40))), 0.0), 24.0); // small hot core → gentle glint
    return col;
  }

${sdfGLSL}

  // signed distance to the gem (positive outside). Per-shape field (sdfActiveGLSL) injected as sdfGLSL above.
  float map(vec3 p){
    return sdfActive(R * p);
  }
  vec3 nrm(vec3 p){ vec2 e=vec2(0.0016,0.0); return normalize(vec3(
    map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx))); }

  // march to the next surface from ro along rd. sgn is +1 outside (find entry), -1 inside (find exit).
  // returns distance (or -1 on miss).
  float march(vec3 ro, vec3 rd, float sgn){
    float t = 0.002;
    for(int i=0;i<${STEPS};i++){
      float d = sgn*map(ro+rd*t);
      if(d < 0.0006) return t;
      t += max(d*0.8, 0.001);
      if(t > 20.0) break;   // rays start at the real camera (orbit dist up to ~9), so the cap must clear that
    }
    return -1.0;
  }

  // --- emissive ambient motes: a few glowing points the tracer accumulates as a soft ADDITIVE glow each bounce, so
  // they glow directly AND show up refracted/reflected through the glass (the gem catches their light). World-space
  // (the gem spins under them via R; the motes drift on their own). A Gaussian falloff on the ray's perpendicular
  // miss distance → smooth: no crawling silhouettes, no fireflies (vs a hard ray-sphere hit at our low spp). ---
  #define NMOTES 16
  const float GLOW_R = 0.10;                             // soft glow radius (perpendicular miss distance)
  vec3 motePos(int i){
    float fi = float(i);
    float a = fi * 2.39996323 + uTime * 0.18;            // golden-angle spiral, slow orbital drift
    float r = 1.9 + fract(fi * 0.61803398) * 1.3;        // shell radius — outside the gem, in the space it "catches"
    float y = (fract(fi * 0.37139) - 0.5) * 3.0 + sin(uTime * 0.5 + fi) * 0.2;
    return vec3(cos(a) * r, y, sin(a) * r);
  }
  vec3 moteEmis(int i){
    float fi = float(i);
    vec3 c = mix(uStar, uColor, step(0.66, fract(fi * 0.317)));  // mostly scene-mote colour; a few rarity-tinted
    return c * (0.9 + fract(fi * 0.123) * 0.9);                  // just over the bloom threshold → gentle halo, not a blob
  }
  // soft additive glow from motes whose closest approach is in FRONT of the ray and nearer than maxT (the gem hit, so
  // the gem occludes ones behind it — those re-appear via the refracted bounce ray). Gaussian → antialiased, firefly-free.
  vec3 moteGlow(vec3 ro, vec3 rd, float maxT){
    vec3 g = vec3(0.0);
    for(int i=0;i<NMOTES;i++){
      if(i >= uMotes) break;                             // gfx Particles density caps how many motes we trace
      vec3 oc = ro - motePos(i);
      float b = dot(oc, rd);
      if(b > 0.0) continue;                              // mote is behind the ray
      float tca = -b;                                    // distance along the ray to closest approach
      if(tca > maxT) continue;                           // the gem (nearer) occludes it on this segment
      float m2 = dot(oc, oc) - b*b;                      // squared perpendicular miss distance
      g += moteEmis(i) * exp(-m2 / (GLOW_R*GLOW_R));     // smooth Gaussian glow
    }
    return g;
  }

  // --- volumetric haze: homogeneous single-scatter along [0, tEnd] of a ray. Accumulates in-scattered light (a dim
  // scene-tinted ambient fill + the emissive motes, 1/r²) and returns the segment transmittance. Marched ONCE per
  // pixel on the primary ray (the haze is low-frequency → deterministic, no Monte-Carlo noise). uHaze = 0 → skipped.
  // The motes lighting the medium are the volumetric "smoke" glow; the gem (nearer) caps the march so it occludes. ---
  void volumetric(vec3 ro, vec3 rd, float tEnd, out vec3 inscat, out float trans){
    inscat = vec3(0.0); trans = 1.0;
    if(uHaze <= 0.0 || tEnd <= 0.0) return;
    const int N = 16;
    float dt = tEnd / float(N);
    // dither the march START per pixel — the mote in-scatter kernel is sharp, so a coarse fixed grid would BAND it
    // (concentric rings) and strobe as motes drift; the dithered offset turns that into fine noise bloom/ACES hide.
    float off = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    for(int k=0;k<N;k++){
      float t = (float(k) + off) * dt;
      vec3 x = ro + rd*t;
      vec3 Li = uBackdrop * 0.18;                        // ambient haze fill (scene-tinted)
      for(int i=0;i<NMOTES;i++){
        if(i >= uMotes) break;
        vec3 dv = motePos(i) - x; float d2 = dot(dv, dv);
        Li += moteEmis(i) * (0.06 / (d2 + 0.25));        // mote light scattered into the medium (softened so dt can resolve it)
      }
      float aT = exp(-uHaze * t);                        // transmittance from the camera to this step
      inscat += aT * uHaze * Li * dt;                    // single-scatter (scatter albedo + isotropic phase folded in)
    }
    trans = exp(-uHaze * tEnd);
  }

  void main(){
    R = rotY(uTime * 0.15);                              // gem auto-spins in place (world); the CAMERA orbits it (uCamPos)
    vec3 cam = uCamPos;
    // env (cosmos) is sampled with the WORLD ray, so the background pans as you orbit — like the mesh hero.
    vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
    vec4 fw = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 rdC = normalize(fw.xyz/fw.w - cam);             // non-jittered primary ray (for the once/pixel haze march)
    gSeed = 0.0;
    float F0 = pow((1.0-uIor)/(1.0+uIor), 2.0);
    vec3 sum = vec3(0.0);
    float tAccum = 0.0;                                   // sum of per-sample primary gem depths → averaged for the haze tEnd
    float farMiss = length(cam) + 3.0;                    // haze depth on a gem MISS — scales with the orbit distance (3..9)
    for(int s=0;s<${SPP};s++){                           // samples this frame
      vec2 j = (vec2(rnd(), rnd())-0.5) / uRes * 2.0;    // sub-pixel jitter in NDC (intra-frame MSAA)
      vec4 fj = uInvViewProj * vec4(ndc + j, 1.0, 1.0); fj /= fj.w;
      vec3 ro = cam;
      vec3 rd = normalize(fj.xyz - cam);
      vec3 thru = vec3(1.0), rad = vec3(0.0);
      bool inside = false;
      for(int b=0;b<${BOUNCES};b++){
        float t = march(ro, rd, inside ? -1.0 : 1.0);
        if(b == 0) tAccum += (t < 0.0) ? farMiss : t;    // spp-averaged primary depth → smooth haze across the gem silhouette
        float gemD = (t < 0.0) ? 1e9 : t;
        rad += thru * moteGlow(ro, rd, gemD);            // soft additive mote glow up to the gem hit; a refracted/reflected
                                                         // bounce ray catches motes through the glass (dimmed by thru)
        if(t < 0.0){ rad += thru * env(rd); break; }     // escaped to the environment light
        vec3 p = ro + rd*t;
        vec3 n = nrm(p); if(inside) n = -n;              // face the incoming ray
        if(inside) thru *= exp(-(vec3(1.0)-uColor) * min(t,0.9) * 1.1);  // Beer–Lambert through the glass body
        float ci = clamp(dot(-rd, n), 0.0, 1.0);
        float F = F0 + (1.0-F0)*pow(1.0-ci, 5.0);        // Schlick reflectance
        float eta = inside ? uIor : 1.0/uIor;
        vec3 refr = refract(rd, n, eta);
        bool tir = dot(refr,refr) < 1e-5;
        if(tir || rnd() < F){ rd = reflect(rd, n); }     // reflect (specular)
        else { rd = refr; inside = !inside; }            // refract (cross the interface)
        ro = p + rd*0.003;
        // Russian roulette — the survival probability and the divisor MUST match, or throughput inflates → fireflies
        if(b > 2){ float q = clamp(max(thru.r, max(thru.g, thru.b)), 0.05, 1.0); if(rnd() > q) break; thru /= q; }
      }
      sum += max(rad, 0.0);
    }
    vec3 col = sum / float(${SPP});
    // volumetric haze along the primary ray — marched ONCE/pixel; tEnd = spp-AVERAGED gem depth, so the haze fades
    // smoothly across the antialiased silhouette (no hard fog rim) and the gem occludes the front haze.
    if(uHaze > 0.0){
      vec3 inscat; float trans; volumetric(cam, rdC, tAccum / float(${SPP}), inscat, trans);
      col = trans * col + inscat;
    }
    fragColor = vec4(col, 1.0);                          // LINEAR HDR → composer tonemaps + blooms
  }
`

const lin = (hex: string) => { const k = new THREE.Color(hex).convertSRGBToLinear(); return new THREE.Vector3(k.r, k.g, k.b) }

export function PathTraceGem({ family, rarity, controls = true, autoRotate = false }: { family: string; rarity: RarityName; controls?: boolean; autoRotate?: boolean }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const ptp = usePathTraceParams()
  const g = useGfxPreset()
  const ptHaze = useGfx((s) => s.ptHaze)
  const atmoHaze = atmosphereById(useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)).haze // equipped Atmosphere deepens the haze
  const rank = RANK[rarity]

  // Inject ONLY this shape's SDF (sdfActiveGLSL) → small program. Rebuilds when the shape/params change.
  const frag = useMemo(() => makePT(ptp.bounces, ptp.steps, ptp.spp, sdfActiveGLSL(family)), [ptp.bounces, ptp.steps, ptp.spp, family])

  const uniforms = useMemo(() => {
    const [backdrop, key, cool, warm] = scene.env
    return {
      uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: lin(RARITY_COLOR[rarity]) }, uIor: { value: 1.45 + rank * 0.05 },
      uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uInvViewProj: { value: new THREE.Matrix4() },
      uBackdrop: { value: lin(backdrop) }, uKey: { value: lin(key) }, uCool: { value: lin(cool) }, uWarm: { value: lin(warm) }, uStar: { value: lin(scene.stars) },
      uMotes: { value: 16 }, uHaze: { value: 0 },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rarity, scene])

  const ref = useRef<THREE.ShaderMaterial>(null)
  const seed = useRef(0)
  useFrame((state) => {
    const m = ref.current
    if (!m) return
    const u = m.uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uSeed.value = seed.current = (seed.current + 1) % 1024 // decorrelate the RNG each frame (no accumulation)
    state.gl.getDrawingBufferSize(u.uRes.value)
    const cam = state.camera
    u.uCamPos.value.copy(cam.position)
    // NDC → world ray for the path tracer (inverse of projection · view)
    u.uInvViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert()
    u.uMotes.value = Math.max(0, Math.min(6, Math.round(6 * g.sparkle))) // a FEW motes; honour gfx Particles density (0 = off)
    u.uHaze.value = ptHaze + atmoHaze // volumetric haze: gfx setting + equipped Atmosphere's contribution (0 = off)
  })

  return (
    <>
      {/* fullscreen quad cast from the REAL camera: the SDF gem + the procedural cosmos + emissive ambient motes
          are ALL traced here (so the gem genuinely refracts/reflects the motes), writing gl_FragDepth from the gem
          hit. HeroView's EffectComposer reads this scene → Bloom + ACES (mesh-matching). */}
      <mesh frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial key={`${family}-${ptp.bounces}-${ptp.steps}-${ptp.spp}`} ref={ref} glslVersion={THREE.GLSL3} vertexShader={VERT} fragmentShader={frag} uniforms={uniforms} />
      </mesh>
      {controls && (
        <OrbitControls makeDefault enablePan={false} enableZoom autoRotate={autoRotate} autoRotateSpeed={0.6} minDistance={3} maxDistance={9} rotateSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      )}
    </>
  )
}
