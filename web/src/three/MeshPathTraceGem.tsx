import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO, OrbitControls, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { RARITY_COLOR } from './Gem'
import { shapeGeometry, useRelics } from './relics'
import { buildBVH } from './bvh'
import { sceneById, atmosphereById, lightingById, gemColorById, SLOT_ATMOSPHERE, SLOT_FINISH, SLOT_LIGHTING, SLOT_GEM_COLOR } from '../content/cosmetics'
import { finishSdf, lightingKey } from './finishSdf'
import { useGame, type RarityName } from '../game/store'
import { usePathTraceParams, useGfxPreset, useGfx } from '../gfx'

// ── From-scratch GPU MESH path tracer (NO library) ────────────────────────────────────────────────────────
// The sibling of PathTraceGem for arbitrary triangle meshes (knots, Klein, relics, fractals): the CPU builds a
// BVH (bvh.ts) packed into float textures; this GLSL3 shader walks it with a stack, intersects triangles
// (Möller–Trumbore), and runs the same multi-bounce glass transport + progressive accumulation as the SDF
// tracer. GLSL ES 3.00 is required (texelFetch + a dynamic traversal stack). SMOOTH shading: the triangle data
// carries the 3 per-vertex normals, and the hit normal is the barycentric interpolation of them (bvh.ts packs a
// face-normal fallback per vertex), so 40-55k-tri relic scans refract organically instead of reading faceted.
//
// Feature parity with PathTraceGem (the SDF reference): this reads the equipped/previewed SCENE, ATMOSPHERE,
// gem FINISH and LIGHTING and feeds them into the trace exactly as PathTraceGem does — atmosphere tint+amount
// blended into the env the gem refracts, gem-finish absorption/emissive/IOR (participating-volume emission so
// an emissive finish glows from within), env-cube refraction, and the backdrop/key scaled by the Lighting
// mood — so a MESH path-trace grades IDENTICALLY to an SDF path-trace.

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

// spin/converge tuning: 'default spin' keeps the gem turning (SPIN_RATE rad/s) until the viewer hits Freeze, which
// eases the spin to 0 so the accumulation FBO converges over ACCUM_TARGET frames into a clean still (then the trace
// is skipped while the live particles keep compositing).
const SPIN_RATE = 0.15
const ACCUM_TARGET = 64

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const makeMeshPT = (BOUNCES: number, SPP: number) => /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec2 vUv;
  out vec4 fragColor;
  uniform float uSeed;
  uniform vec2  uRes;
  uniform vec3  uColor;     // gem body tint (Beer absorption) — rarity colour or finish tint
  uniform float uIor;
  uniform float uAberr;    // chromatic dispersion: per-sample wavelength splits the IOR (finish aberrAdd) → rainbow fire
  uniform float uSpin;     // gentle auto-spin ANGLE (accumulated; frozen when idle so the accumulation converges) — composes with the orbit
  uniform float uYaw, uPitch, uZoom;
  uniform vec3  uBackdrop, uKey, uCool, uWarm, uStar; // env colours, already scaled by the Lighting mood (key/ambient)
  uniform vec3  uKeyDir;   // equipped Lighting mood: the key glow's (animated) direction — sweeps for orbit/ring moods
  uniform vec3  uKeyTint;  // the mood's hue (pure-hue, max-channel-1) tinting the key glint; disco cycles the rainbow
  uniform float uKeyPulse; // the mood's key intensity breath/flicker (1 = steady)
  uniform vec3  uAtmoTint;     // equipped Atmosphere's hue, blended into env → the gem's refraction/reflection carries the atmosphere
  uniform float uAtmoAmt;      // 0 = Clear (no tint)
  uniform samplerCube uEnvCube; // a live cubemap of the atmosphere (clouds/nebula/aurora), captured around the gem
  uniform float uEnvCubeAmt;   // 0 = no cube (use procedural env only); >0 = refract/reflect the real atmosphere
  uniform float uEmissive;     // equipped finish inner glow (0 = none)
  uniform float uAbsorbMul;    // equipped finish density (≥1 darkens a low-transmission finish; 1 = default)
  uniform float uHaze;     // volumetric single-scatter haze density (gfx setting + equipped Atmosphere; 0 = off)
  uniform float uReflMul;  // equipped finish env-reflection strength (envMapIntensityMul); 1 = default
  uniform float uMatte;    // exotic finish: 0 = glass; >0 = opaque DIFFUSE surface (prob. of a diffuse vs refract bounce)
  uniform float uLensing;  // exotic finish: gravitational lensing — pinch the escaping background toward the gem
  uniform float uVolume;   // exotic finish: the gem interior is a ray-marched fbm cloud/smoke at this density
  float nhash(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(nhash(i),nhash(i+vec3(1,0,0)),f.x), mix(nhash(i+vec3(0,1,0)),nhash(i+vec3(1,1,0)),f.x), f.y),
               mix(mix(nhash(i+vec3(0,0,1)),nhash(i+vec3(1,0,1)),f.x), mix(nhash(i+vec3(0,1,1)),nhash(i+vec3(1,1,1)),f.x), f.y), f.z); }
  float fbmN(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.02; a *= 0.5; } return s; }
  uniform sampler2D uTriTex;   // 6 texels/tri: a,b,c positions then na,nb,nc vertex normals (TRI_TEXELS in bvh.ts)
  uniform sampler2D uNodeTex;  // 2 texels/node
  uniform int uTexW;
  uniform int uNodeCount;

  float gSeed;
  float rnd(){ gSeed += 1.0; vec3 p3 = fract(vec3(gl_FragCoord.xyx) * 0.1031 + gSeed * 0.137 + uSeed * 0.0411); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  // Smooth blurred-IBL-style env — mirrors PathTraceGem.env(): a soft vertical gradient plus broad directional
  // glows (low exponents → wide + smooth) and a faint hot key core for a gentle specular glint, so the mesh
  // gem reads against the SAME atmosphere the SDF gem does (no hard stars/bands that strobe through glass).
  vec3 env(vec3 d){
    float up = clamp(d.y*0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBackdrop*0.42, uBackdrop*1.08, up*up);
    vec3 kcol = uKey * mix(vec3(1.0), uKeyTint, 0.6) * uKeyPulse;          // key glow takes the equipped Lighting mood's hue + pulse
    col += kcol * 0.65 * pow(max(dot(d, uKeyDir), 0.0), 3.0);             // ...and sweeps with uKeyDir (orbit/ring/disco motion)
    col += uCool * 0.35 * pow(max(dot(d, normalize(vec3(-0.6,0.25,0.55))), 0.0), 2.5);
    col += uWarm * 0.35 * pow(max(dot(d, normalize(vec3(0.3,-0.45,-0.55))), 0.0), 2.5);
    col += kcol * 1.6 * pow(max(dot(d, uKeyDir), 0.0), 24.0); // small hot core → gentle glint (mood-coloured + swept)
    // equipped Atmosphere tints the environment the gem refracts/reflects, so it visibly interacts with the mood
    col += uAtmoTint * uAtmoAmt * (0.28 + 0.6 * up * up);
    return col;
  }

  // env for the gem's REFRACTION/REFLECTION bounces: blends a live cubemap of the real atmosphere (clouds/nebula/
  // aurora) over the procedural env, so the gem genuinely BENDS the atmosphere in its glass. uEnvCubeAmt = 0 →
  // procedural env only (the texture is never sampled). Mirrors PathTraceGem.envGem().
  vec3 envGem(vec3 d){
    vec3 base = env(d);
    if(uEnvCubeAmt <= 0.0) return base;
    // soft HDR rolloff (mirrors PathTraceGem) so a very bright atmosphere glows in the glass instead of blowing
    // the gem to white: values ≤1 pass through, brighter ones compress toward an asymptote (~1.1).
    vec3 a = texture(uEnvCube, d).rgb;
    vec3 atmo = a / (1.0 + max(a - 1.0, 0.0) * 0.9);
    return mix(base, base * 0.5 + atmo, uEnvCubeAmt);
  }

  vec4 ftri(int i){ return texelFetch(uTriTex, ivec2(i % uTexW, i / uTexW), 0); }
  vec4 fnode(int i){ return texelFetch(uNodeTex, ivec2(i % uTexW, i / uTexW), 0); }

  // Möller–Trumbore; on a nearer hit updates t, the geometric face normal, and the barycentric (u,v) of the hit
  // (so the caller can interpolate the triangle's 3 vertex normals → smooth shading). u,v are the weights of v1,v2.
  bool hitTri(vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2, inout float t, inout vec3 n, inout vec2 bary){
    vec3 e1 = v1-v0, e2 = v2-v0;
    vec3 pv = cross(rd, e2);
    float det = dot(e1, pv);
    if(abs(det) < 1e-9) return false;
    float inv = 1.0/det;
    vec3 tv = ro - v0;
    float u = dot(tv, pv)*inv; if(u < 0.0 || u > 1.0) return false;
    vec3 qv = cross(tv, e1);
    float v = dot(rd, qv)*inv; if(v < 0.0 || u+v > 1.0) return false;
    float tt = dot(e2, qv)*inv;
    if(tt > 0.0009 && tt < t){ t = tt; n = normalize(cross(e1, e2)); bary = vec2(u, v); return true; }
    return false;
  }

  bool hitAABB(vec3 ro, vec3 invRd, vec3 bmin, vec3 bmax, float tMax){
    vec3 t0 = (bmin-ro)*invRd, t1 = (bmax-ro)*invRd;
    vec3 lo = min(t0,t1), hi = max(t0,t1);
    float tn = max(max(lo.x,lo.y),lo.z);
    float tf = min(min(hi.x,hi.y),hi.z);
    return tf >= max(tn, 0.0) && tn < tMax;
  }

  // walk the BVH (explicit stack) for the nearest triangle hit. Returns the SMOOTH (barycentrically interpolated
  // per-vertex) normal in nHit, falling back to the geometric face normal when the interpolated normal is
  // degenerate — so the refraction reads organic, not faceted, on the dense relic scans.
  bool intersect(vec3 ro, vec3 rd, out float tHit, out vec3 nHit){
    vec3 invRd = 1.0/rd;
    int stack[40];
    int sp = 0; stack[sp++] = 0;
    tHit = 1e9; bool hit = false;
    vec3 nGeo = vec3(0.0, 0.0, 1.0); // geometric face normal of the winning triangle (smooth-normal fallback)
    vec2 bary = vec2(0.0);           // barycentric (u,v) of the winning hit
    int hitBase = -1;                // texel base index of the winning triangle (6 texels/tri)
    int guard = 0;
    while(sp > 0 && guard < 4096){
      guard++;
      int ni = stack[--sp];
      vec4 a = fnode(ni*2);
      vec4 b = fnode(ni*2+1);
      if(!hitAABB(ro, invRd, a.xyz, b.xyz, tHit)) continue;
      if(b.w < 0.0){                                   // leaf: w encodes -triCount
        int start = int(a.w + 0.5);
        int cnt = int(-b.w + 0.5);
        for(int k=0;k<cnt;k++){
          int ti = (start+k)*6;                        // 6 texels/tri: a,b,c, na,nb,nc
          vec3 v0 = ftri(ti).xyz, v1 = ftri(ti+1).xyz, v2 = ftri(ti+2).xyz;
          if(hitTri(ro, rd, v0, v1, v2, tHit, nGeo, bary)){ hit = true; hitBase = ti; }
        }
      } else if(sp < 38){                              // internal: push both children
        stack[sp++] = int(a.w + 0.5);
        stack[sp++] = int(b.w + 0.5);
      }
    }
    if(hit){
      // barycentric interpolation of the 3 vertex normals: w0=v0, u=v1, v=v2 (matches hitTri's bary).
      vec3 n0 = ftri(hitBase + 3).xyz, n1 = ftri(hitBase + 4).xyz, n2 = ftri(hitBase + 5).xyz;
      float u = bary.x, v = bary.y;
      vec3 ns = n0 * (1.0 - u - v) + n1 * u + n2 * v;
      nHit = dot(ns, ns) > 1e-10 ? normalize(ns) : nGeo; // fall back to the flat normal if degenerate
    }
    return hit;
  }

  void main(){
    mat3 R = mat3(1.0);
    {
      float yaw = uSpin + uYaw;
      float cy=cos(yaw), sy=sin(yaw), cx=cos(uPitch), sx=sin(uPitch);  // no baked tilt — pitch is the real camera (matches the SDF PT)
      mat3 ry = mat3(cy,0.,sy, 0.,1.,0., -sy,0.,cy);
      mat3 rx = mat3(1.,0.,0., 0.,cx,-sx, 0.,sx,cx);
      R = ry * rx;
    }
    mat3 Rt = transpose(R);   // world → object (R is orthonormal)
    gSeed = 0.0;
    float F0 = pow((1.0-uIor)/(1.0+uIor), 2.0);

    vec3 sum = vec3(0.0);
    float tAccum = 0.0;                       // spp-averaged primary depth → smooth haze across the gem silhouette
    float farMiss = 3.2*uZoom + 3.0;          // haze depth on a primary MISS (scales with orbit distance)
    for(int s=0;s<${SPP};s++){
      vec2 j = (vec2(rnd(), rnd())-0.5);
      vec2 uv = ((vUv*uRes + j)/uRes * 2.0 - 1.0);
      uv.x *= uRes.x/uRes.y;
      // hero-wavelength dispersion: ONE wavelength per sample (Monte-Carlo spectral) → true dispersion at zero extra
      // ray cost. Blue bends more than red; the spectral weight tints the sample, averaging to white over accumulation.
      float wl = rnd();
      float iorS = uIor + uAberr * (wl - 0.5);
      vec3 spec = vec3(smoothstep(1.0, 0.4, wl), 1.0 - 1.6*abs(wl - 0.5), smoothstep(0.0, 0.6, wl));
      spec = spec / max(spec.x + spec.y + spec.z, 1e-3) * 3.0;   // normalise so the average is ~white (energy-safe)
      // primary ray (world), then into object space so the static BVH appears rotated by R
      vec3 ro = Rt * vec3(0.0,0.0,3.2*uZoom);
      vec3 rd = normalize(Rt * normalize(vec3(uv,-2.61)));  // focal length = 1/tan(42°/2) → matches the Canvas fov:42 (and the SDF PT)
      vec3 thru = vec3(1.0), rad = vec3(0.0);
      bool inside = false;
      for(int b=0;b<${BOUNCES};b++){
        float t; vec3 n;
        bool didHit = intersect(ro, rd, t, n);
        if(b == 0) tAccum += didHit ? t : farMiss;                         // primary depth for the haze march
        // escaped: primary ray → world-space env (cosmos); a bounce ray → envGem (refracts the atmosphere cube)
        if(!didHit){
          vec3 erd = rd;
          if(uLensing > 0.0 && b == 0){                  // black-hole lensing: bend the escaping ray toward the gem centre (origin)
            vec3 perp = -ro - rd*dot(-ro, rd);
            float bp = length(perp);
            erd = normalize(rd + normalize(perp + 1e-5) * (uLensing * 0.5 / (bp*bp + 0.35)));
          }
          rad += thru * (b == 0 ? env(R * erd) : envGem(R * erd)); break;
        }
        vec3 p = ro + rd*t;
        if(dot(rd, n) > 0.0) n = -n;                   // face the incoming ray
        // VOLUMETRIC cloud interior — on ENTERING, march fbm density from this entry hit to the BVH exit hit (lit by
        // the equipped Lighting key). A soft self-shadowed cloud/smoke/nebula filling the shape. Consumes the ray.
        if(uVolume > 0.0 && !inside){
          float texit; vec3 nx; vec3 acc = vec3(0.0); float vtr = 1.0;
          if(intersect(p + rd*0.01, rd, texit, nx)){
            float ds = texit / 20.0; vec3 vp = p + rd*0.01;
            for(int k=0;k<20;k++){
              float rho = clamp(fbmN(vp*3.4) * uVolume * 1.7 - 0.15, 0.0, 1.0);
              if(rho > 0.001){
                float sh = 1.0 - clamp(fbmN((vp + uKeyDir*0.2)*3.4)*uVolume*0.6, 0.0, 0.6);
                vec3 lit = uColor * (0.25 + 0.95*sh) * mix(vec3(1.0), uKeyTint, 0.4) * uKeyPulse;
                acc += vtr * rho * lit; vtr *= 1.0 - rho;
              }
              vp += rd*ds;
              if(vtr < 0.02) break;
            }
          }
          rad += thru * (acc + vtr * env(R*rd) * 0.5);
          break;
        }
        if(inside){
          thru *= exp(-(vec3(1.0)-uColor) * min(t,1.4) * 1.1 * uAbsorbMul);  // Beer–Lambert (deeper clamp so dense finishes read truly dark)
          rad += thru * uColor * (min(t,0.9)*min(t,0.9)) * 0.12;             // internal focusing: long internal chords gather transmitted light into a richer caustic core
          // PARTICIPATING (volume) EMISSION — an emissive finish glows from WITHIN, and that glow refracts/bends
          // out through the glass, dimming correctly through each interface (× thru). Path-length weighted
          // (thicker → brighter). Default uEmissive 0 = exact no-op. Mirrors PathTraceGem.
          rad += thru * uColor * uEmissive * min(t, 0.9) * 1.6;
        }
        // MATTE: opaque DIFFUSE surface — a fraction (uMatte) of surface hits scatter diffusely (Lambert albedo =
        // body colour) instead of refracting, so rough finishes read opaque/matte rather than clear glass.
        if(uMatte > 0.0 && !inside && rnd() < uMatte){
          thru *= uColor;
          vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0,1.0,0.0)) : cross(n, vec3(1.0,0.0,0.0)));
          vec3 t2 = cross(n, t1); float du = rnd(), dv = rnd(), rr = sqrt(du), ph2 = 6.2831853*dv;
          rd = normalize(t1*rr*cos(ph2) + t2*rr*sin(ph2) + n*sqrt(1.0-du));
          ro = p + n*0.003;
          if(b > 1){ float qm = max(thru.r, max(thru.g, thru.b)); if(rnd() > qm) break; thru /= max(qm, 0.05); }
          continue;
        }
        float ci = clamp(dot(-rd, n), 0.0, 1.0);
        float F = F0 + (1.0-F0)*pow(1.0-ci, 5.0);
        float eta = inside ? iorS : 1.0/iorS;          // wavelength-split IOR → chromatic dispersion
        vec3 refr = refract(rd, n, eta);
        if(dot(refr,refr) < 1e-5 || rnd() < F){ rd = reflect(rd, n); thru *= uReflMul; }  // reflect — finish reflectivity (TIR thresh matches SDF)
        else { rd = refr; inside = !inside; }
        ro = p + rd*0.003;
        if(b > 2){ float q = max(thru.r, max(thru.g, thru.b)); if(rnd() > q) break; thru /= max(q, 0.05); }
      }
      sum += max(rad, 0.0) * spec;                   // weight by the sample's spectral response → chromatic dispersion
    }
    vec3 outc = sum / float(${SPP});
    // volumetric haze: homogeneous single-scatter along the spp-AVERAGED primary depth (low-frequency →
    // deterministic, no Monte-Carlo noise). The gem occludes the front haze; a miss hazes out to farMiss. An
    // emissive gem lights the surrounding haze (gem sits near tEnd) — mirrors PathTraceGem's volumetric().
    float tEnd = tAccum / float(${SPP});
    if(uHaze > 0.0 && tEnd > 0.0){
      vec3 inscat = vec3(0.0);
      float dt = tEnd / 12.0;
      for(int i=0;i<12;i++){
        float t = (float(i)+0.5)*dt;
        vec3 Li = uBackdrop * 0.18;                   // ambient haze fill (scene-tinted)
        float gemProx = t / tEnd;
        Li += uColor * uEmissive * (0.10 + 0.5 * gemProx * gemProx); // emissive gem glows out into the fog
        inscat += exp(-uHaze*t) * uHaze * Li * dt;
      }
      outc = outc * exp(-uHaze*tEnd) + inscat;
    }
    fragColor = vec4(outc, 1.0);
  }
`

const DISP = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTex;
  uniform float uN;
  uniform vec2 uRes;       // accumulation-buffer size (for the bloom tap offsets)
  uniform float uBloomInt; // 0.5 + rank*0.22 — matches the SDF hero's composer Bloom intensity
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  void main(){
    float inv = 1.0 / max(uN, 1.0);
    vec3 c = texture(uTex, vUv).rgb * inv;
    // The mesh PT bypasses the EffectComposer (no shared post chain), so the SDF hero's Bloom is reproduced HERE:
    // a thresholded golden-spiral disk blur of the bright parts (luminanceThreshold 0.8) over ~3..33px — a soft glow
    // around the hot cores / specular glints, so emissive finishes + glints bloom like they do on the SDF hero.
    vec3 bloom = vec3(0.0);
    for(int i=0;i<32;i++){
      float fi = float(i);
      float ang = fi * 2.39996323;
      float rr = (fi + 0.5) / 32.0;
      vec2 off = vec2(cos(ang), sin(ang)) * (3.0 + rr * 30.0) / uRes;
      bloom += max(texture(uTex, vUv + off).rgb * inv - 1.0, 0.0) * (1.0 - rr * 0.55); // thresh 1.0 → only genuinely HDR-bright parts (not spin/disp noise)
    }
    c += bloom / 32.0 * uBloomInt * 1.4;
    c = aces(c * 1.7);   // keep the env-lit glass bright (it reads dark raw); the bloom + vignette add the SDF hero's grade CHARACTER on top
    c = pow(c, vec3(1.0/2.2));
    c *= smoothstep(0.85, 0.32, distance(vUv, vec2(0.5))) * 0.5 + 0.5; // gentle vignette, matching the SDF hero (offset 0.32 / darkness 0.5)
    fragColor = vec4(c, 1.0);
  }
`

const lin = (hex: string) => { const k = new THREE.Color(hex).convertSRGBToLinear(); return new THREE.Vector3(k.r, k.g, k.b) }

export function MeshPathTraceGem({ family, rarity, controls = true, paused = false, previewScene, previewAtmosphere, previewLighting, previewFinish, previewGemColor, envMap }: { family: string; rarity: RarityName; controls?: boolean; paused?: boolean; previewScene?: number; previewAtmosphere?: number; previewLighting?: number; previewFinish?: number; previewGemColor?: number; envMap?: THREE.Texture | null }) {
  const { gl, size, invalidate } = useThree()
  // `previewScene`/`previewAtmosphere`/`previewFinish` (shop preview) render an UNequipped cosmetic without
  // touching the equipped one — mirrors PathTraceGem's preview props so the same hover-previews work on meshes.
  const storeScene = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(previewScene ?? storeScene)
  const ptp = usePathTraceParams()
  const g = useGfxPreset()
  const ptHaze = useGfx((s) => s.ptHaze)
  const ptEnvCubeAmt = useGfx((s) => s.ptEnvCubeAmt) // user-tunable atmosphere-refraction strength
  const equippedAtmo = useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)
  const atmo = atmosphereById(previewAtmosphere ?? equippedAtmo) // equipped Atmosphere: deepens haze + tints refraction
  const atmoHaze = atmo.haze
  // a representative hue for the equipped atmosphere → blended into env() so the gem's refraction/reflection carries it
  const atmoTint = useMemo(() => lin(atmo.vol?.colorB ?? atmo.clouds?.colorLight ?? atmo.godRays?.color ?? atmo.aurora?.colorA ?? atmo.mote), [atmo])
  const atmoAmt = atmo.id === 0 ? 0 : 0.32
  // Equipped gem finish (Shop cosmetic) mapped onto the path tracer — `previewFinish` lets the shop hover-preview one.
  const equippedFinish = useGame((s) => s.view?.equipped?.[SLOT_FINISH] ?? 0)
  const fin = finishSdf(previewFinish ?? equippedFinish)
  const equippedLighting = useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)
  const L = lightingById(previewLighting ?? equippedLighting) // equipped/previewed Lighting mood — scales the env the gem is lit by
  const rank = RANK[rarity]
  // gem BODY hue from the Gem Colour cosmetic (Clear → neutral white = no absorption). Rarity → motes, not tint.
  const equippedGemColor = useGame((s) => s.view?.equipped?.[SLOT_GEM_COLOR] ?? 0)
  const gcHex = gemColorById(previewGemColor ?? equippedGemColor).color
  const gemBodyCol = useMemo(() => (gcHex ? lin(gcHex) : new THREE.Vector3(1, 1, 1)), [gcHex])
  const rarityMotes = useGfx((s) => s.rarityMotes)
  useRelics() // rebuild the BVH once the real Relic mesh arrives
  const geo = shapeGeometry(family)
  const bvh = useMemo(() => buildBVH(geo), [geo])
  const w = Math.max(2, Math.round(size.width * ptp.scale))
  const h = Math.max(2, Math.round(size.height * ptp.scale))
  const accum = useFBO(w, h, { type: THREE.FloatType, depthBuffer: false })

  const ptMat = useMemo(() => {
    const [backdrop, key, cool, warm] = scene.env
    // env colours scaled by the equipped Lighting mood (key/ambient) — mirrors PathTraceGem's uniform build,
    // so the mesh gem is lit by the SAME graded env as the SDF gem.
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: makeMeshPT(ptp.bounces, ptp.spp),
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) },
        uColor: { value: new THREE.Vector3(1, 1, 1) }, uIor: { value: 1.45 + RANK[rarity] * 0.05 },
        uSpin: { value: 0 }, uYaw: { value: 0 }, uPitch: { value: 0 }, uZoom: { value: 1 },
        uBackdrop: { value: lin(backdrop).multiplyScalar(L.ambient) }, uKey: { value: lin(key).multiplyScalar(L.key) }, uCool: { value: lin(cool).multiplyScalar(L.ambient) }, uWarm: { value: lin(warm).multiplyScalar(L.ambient) }, uStar: { value: lin(scene.stars) },
        uAtmoTint: { value: new THREE.Vector3() }, uAtmoAmt: { value: 0 },
        uKeyDir: { value: new THREE.Vector3(0.35, 0.75, 0.40).normalize() }, uKeyTint: { value: new THREE.Vector3(1, 1, 1) }, uKeyPulse: { value: 1 },
        uEnvCube: { value: null as THREE.Texture | null }, uEnvCubeAmt: { value: 0 },
        uEmissive: { value: 0 }, uAbsorbMul: { value: 1 }, uAberr: { value: 0 }, uReflMul: { value: 1 }, // (finish-driven; set live in useFrame)
        uMatte: { value: 0 }, uLensing: { value: 0 }, uVolume: { value: 0 }, // exotic finishes (matte / black-hole lensing / cloud)
        uHaze: { value: 0 },
        uTriTex: { value: bvh.triTex }, uNodeTex: { value: bvh.nodeTex }, uTexW: { value: bvh.texW }, uNodeCount: { value: bvh.nodeCount },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, rarity, scene, L, bvh, ptp.bounces, ptp.spp, w, h])

  const dispMat = useMemo(() => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DISP, depthTest: false, depthWrite: false, uniforms: { uTex: { value: accum.texture }, uN: { value: 1 }, uRes: { value: new THREE.Vector2(w, h) }, uBloomInt: { value: 0.5 + rank * 0.22 } } }), [accum, w, h, rank])
  const quad = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
  const ptScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, ptMat)); return s }, [quad, ptMat])
  const dispScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, dispMat)); return s }, [quad, dispMat])
  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
  const frame = useRef(0)
  const lastKey = useRef('')

  // ── converge-then-idle state ──────────────────────────────────────────────────────────────────────────────
  const spin = useRef(0) // accumulated auto-spin angle (replaces uTime*0.15)
  const spinSpeed = useRef(1) // eased 0..1 multiplier — ramps to 0 when idle, to 1 when active (smooth settle)
  const lastInteract = useRef(performance.now()) // any pointer/orbit event → active for IDLE_MS after
  const lastT = useRef(performance.now())
  // wake on interaction: reset the idle timer + re-render (OrbitControls 'change' also invalidates for us)
  const wake = () => { lastInteract.current = performance.now(); invalidate() }

  useFrame((state) => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - lastT.current) / 1000)
    lastT.current = now
    const active = !paused // 'default spin': spin continuously until the viewer hits Freeze (then it eases to 0 → converges)
    // smoothly ease the auto-spin speed to 0 (idle) / 1 (active) — the gem settles to a STILL product shot, never
    // a hard stop. Once eased to ~0 the spin angle stops advancing → the reset key holds → the FBO converges.
    spinSpeed.current += ((active ? 1 : 0) - spinSpeed.current) * Math.min(1, dt * 4)
    if (spinSpeed.current < 0.001) spinSpeed.current = 0
    spin.current += dt * SPIN_RATE * spinSpeed.current

    const m = ptMat.uniforms
    m.uSpin.value = spin.current
    m.uHaze.value = ptHaze + atmoHaze // gfx setting + equipped Atmosphere
    m.uAtmoTint.value.copy(atmoTint)
    m.uAtmoAmt.value = atmoAmt
    m.uEnvCube.value = envMap ?? null // live atmosphere cubemap (provided when HeroView captures one around the gem)
    m.uEnvCubeAmt.value = envMap ? ptEnvCubeAmt : 0
    // equipped gem finish → traced look (live, so a shop hover-preview updates). Default Prism = no-op.
    m.uColor.value.copy(fin.tint ?? gemBodyCol)
    m.uIor.value = 1.45 + rank * 0.05 + fin.iorAdd
    m.uEmissive.value = fin.emissive
    m.uAbsorbMul.value = fin.absorbMul
    m.uAberr.value = 0.02 + rank * 0.02 + fin.aberrAdd          // a faint base dispersion (rank-scaled) + the finish's chromatic add
    m.uReflMul.value = THREE.MathUtils.clamp(fin.reflMul, 0.6, 1.6) // finish env-reflection strength
    m.uMatte.value = fin.matte; m.uLensing.value = fin.lensing; m.uVolume.value = fin.volumetric // exotic finishes
    // animate the env() key glow from the equipped Lighting mood so this PT hero SHOWS it (motion + hue), not just brightness
    m.uKeyPulse.value = lightingKey(L, state.clock.elapsedTime, m.uKeyDir.value, m.uKeyTint.value)
    const cam = state.camera
    const dist = cam.position.length() || 5
    m.uZoom.value = THREE.MathUtils.clamp(dist / 5, 0.45, 2.6)
    m.uYaw.value = Math.atan2(cam.position.x, cam.position.z)
    const polar = Math.acos(THREE.MathUtils.clamp(cam.position.y / dist, -1, 1))
    m.uPitch.value = THREE.MathUtils.clamp(Math.PI / 2 - polar, -1.4, 1.4)

    // Accumulation resets when ANY trace input changes: the orbit (yaw/pitch/zoom), the auto-spin ANGLE (which is
    // now FROZEN when idle, so the key holds and `frame.current` actually climbs → uN averages → it converges;
    // while active it advances each frame → 1 fresh sample/frame, so a spinning gem stays responsive without
    // smearing), or any live-graded uniform (finish/atmosphere/haze). This was DEAD before: the old key folded in
    // uTime*0.15 every frame, so it reset to 0 every frame and never accumulated past one sample.
    const fkey = `${(m.uIor.value as number).toFixed(3)}|${m.uEmissive.value}|${m.uAbsorbMul.value}|${m.uAtmoAmt.value}|${m.uEnvCubeAmt.value}|${(m.uAberr.value as number).toFixed(3)}|${(m.uReflMul.value as number).toFixed(2)}|${m.uMatte.value}|${m.uLensing.value}|${m.uVolume.value}`
    const key = `${family}|${spin.current.toFixed(4)}|${m.uYaw.value.toFixed(4)}|${m.uPitch.value.toFixed(4)}|${m.uZoom.value.toFixed(4)}|${(ptHaze + atmoHaze).toFixed(3)}|${fkey}`
    const prevClear = gl.getClearColor(new THREE.Color()).getHex()
    if (key !== lastKey.current) {
      lastKey.current = key
      frame.current = 0
      gl.setRenderTarget(accum)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
    }
    const prevAuto = gl.autoClear
    gl.autoClear = false
    // Once paused + fully accumulated, the gem is a finished STILL — SKIP the expensive trace. But ALWAYS run the
    // display blit + the particle composite below, so the motes/sparkles keep drifting fluidly over the converged
    // image. (Cheap when converged: a quad blit + a few hundred sparkle points, no BVH trace.)
    const converged = frame.current >= ACCUM_TARGET && spinSpeed.current < 0.001
    if (!converged) {
      m.uSeed.value = frame.current
      gl.setRenderTarget(accum)
      gl.render(ptScene, ortho)
      frame.current++
      dispMat.uniforms.uN.value = frame.current
    }
    dispMat.uniforms.uTex.value = accum.texture
    gl.setRenderTarget(null)
    gl.render(dispScene, ortho)
    // composite the foreground motes (R3F scene, real camera) over the path-traced image — the sparkle/halo the
    // mesh Stage had. clearDepth so they aren't culled by the fullscreen quad's depth. Runs EVERY frame (even
    // converged) so the particles stay alive.
    gl.clearDepth()
    gl.render(state.scene, state.camera)
    gl.autoClear = prevAuto
    gl.setClearColor(prevClear)

    // keep the loop alive for the live particles — cheap once converged (no trace), so the motes never freeze.
    invalidate()
  }, 1)

  return (
    <>
      <group />
      {/* invisible interaction catcher (colorWrite off → never drawn, but still raycast for pointer events) so a
          plain HOVER wakes the gem out of its converged idle, matching the SDF tracer's display-quad pointer wake.
          OrbitControls' onStart/onChange below cover drag; this covers hover-without-drag. */}
      {controls && (
        <mesh onPointerMove={wake} onPointerDown={wake} renderOrder={-20}>
          <sphereGeometry args={[20, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={THREE.BackSide} />
        </mesh>
      )}
      <Sparkles count={Math.round((36 + rank * 28) * g.sparkle)} scale={[8, 6, 6]} size={2.2 + rank * 0.5} speed={0.18} opacity={0.7} color={scene.stars} />
      {rarityMotes && <Sparkles count={Math.round((16 + rank * 18) * g.sparkle)} scale={[4.5, 4.5, 4.5]} size={3.2 + rank * 0.3} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} />}
      {controls && (
        <OrbitControls makeDefault enablePan={false} enableZoom minDistance={3} maxDistance={9} rotateSpeed={0.9}
          onStart={wake} onChange={wake}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      )}
    </>
  )
}
