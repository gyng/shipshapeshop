import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO, OrbitControls, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { buildBVHData, packMultiBVH } from './bvh'
import type { PartyPtScene } from './geometry'
import { usePathTraceParams, useGfxPreset, useGfx } from '../gfx'
import type { ExpeditionPtEma, ExpeditionPtCaustics } from '../gfx'

// ── Multi-material, MULTI-OBJECT scene path tracer for the Expeditions party (opt-in; default is the raster
// ExpeditionScene3DMesh). Where the hero MeshPathTraceGem traces ONE object, this traces a whole baked scene as a
// small TLAS/BLAS: each object (the static floor/forest/flame set, then each glass gem) keeps its OWN object-space
// BVH, concatenated into shared float textures (bvh.ts packMultiBVH). At trace time the shader transforms the RAY
// into each object's local space and walks that object's BVH — so the gems can SPIN in place (a per-frame uniform
// transform, no BVH rebuild) to show off their facets + the caustics dancing across the floor. Per-triangle a
// materialId (bvh.ts → the tri-texture .w) selects per-material shading from a uniform LUT (glass / diffuse floor /
// emissive flame). A temporal EMA denoises the moving scene; the campfire flickers; the camera gently auto-orbits.

const SPIN_RATE = 0.08 // rad/s — the camera's gentle auto-orbit (kept slow now that the gems also spin)
const GEM_SPIN_RATE = 0.3 // rad/s — each gem spins about its own centre to show off facets + caustics
const CAUSTIC_GAIN = 90 // brightness for a 24k photon batch; scaled by (24000/PHOTONS) so quality changes count, not brightness
// temporal-EMA blend (weight of the NEW frame): off = 1 (sharp per-frame replace, noisier) · low = light average · high = heavy
const EMA_BLEND: Record<ExpeditionPtEma, number> = { off: 1, low: 0.4, high: 0.14 }
// photon-caustic quality → photons traced per frame + the caustic-map resolution (sharper at the top tiers).
const CAUSTIC_PHOTONS: Record<ExpeditionPtCaustics, number> = { off: 0, low: 8000, medium: 16000, high: 24000, extreme: 48000, ultra: 96000 }
const CAUSTIC_RES: Record<ExpeditionPtCaustics, number> = { off: 256, low: 256, medium: 256, high: 256, extreme: 384, ultra: 512 }

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

// The BVH traversal (Möller–Trumbore + stack walk), shared by the camera trace AND the photon-caustic pass. The
// scene is MULTI-OBJECT: `intersect` loops the objects, transforms the ray into each one's local space (via its
// inverse transform), walks that object's BVH from its node/tri base, keeps the nearest hit across all objects,
// and maps the winning local normal back to world. Reads uTriTex/uNodeTex/uTexW (declared per-shader).
const BVH_GLSL = /* glsl */ `
  const int N_OBJ = 6;
  uniform mat4 uObjInvM[N_OBJ];     // world → object-local, per object
  uniform mat3 uObjNrm[N_OBJ];      // object-local → world normal matrix, per object
  uniform int  uObjNodeBase[N_OBJ]; // first node (root) of object k in the shared node texture
  uniform int  uObjCount;           // (child + triStart indices are pre-offset to GLOBAL by packMultiBVH)
  vec4 ftri(int i){ return texelFetch(uTriTex, ivec2(i % uTexW, i / uTexW), 0); }
  vec4 fnode(int i){ return texelFetch(uNodeTex, ivec2(i % uTexW, i / uTexW), 0); }
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
  // walk ONE object's BVH (rooted at nodeBase, triangles offset by triBase) in its LOCAL space. Updates the shared
  // tHit — which stays in WORLD units because the caller does NOT normalise the transformed ray direction (so the
  // local t is directly comparable across objects). Returns the local-space smooth normal + the materialId.
  bool intersectObj(int nodeBase, vec3 ro, vec3 rd, inout float tHit, out vec3 nLocal, out int matOut){
    vec3 invRd = 1.0/rd;
    int stack[40];
    int sp = 0; stack[sp++] = nodeBase;          // root of this object; node children + leaf triStart are GLOBAL indices
    bool hit = false;
    vec3 nGeo = vec3(0.0, 0.0, 1.0);
    vec2 bary = vec2(0.0);
    int hitBase = -1;
    int guard = 0;
    while(sp > 0 && guard < 8192){
      guard++;
      int ni = stack[--sp];
      vec4 a = fnode(ni*2);
      vec4 b = fnode(ni*2+1);
      if(!hitAABB(ro, invRd, a.xyz, b.xyz, tHit)) continue;
      if(b.w < 0.0){
        int start = int(a.w + 0.5);              // already global (packMultiBVH folded in triBase at pack time)
        int cnt = int(-b.w + 0.5);
        for(int k=0;k<cnt;k++){
          int ti = (start+k)*6;
          vec3 v0 = ftri(ti).xyz, v1 = ftri(ti+1).xyz, v2 = ftri(ti+2).xyz;
          if(hitTri(ro, rd, v0, v1, v2, tHit, nGeo, bary)){ hit = true; hitBase = ti; }
        }
      } else if(sp < 38){
        stack[sp++] = int(a.w + 0.5);            // already global (packMultiBVH folded in nodeBase at pack time)
        stack[sp++] = int(b.w + 0.5);
      }
    }
    nLocal = vec3(0.0, 0.0, 1.0); matOut = 0;
    if(hit){
      vec3 n0 = ftri(hitBase + 3).xyz, n1 = ftri(hitBase + 4).xyz, n2 = ftri(hitBase + 5).xyz;
      float u = bary.x, v = bary.y;
      vec3 ns = n0 * (1.0 - u - v) + n1 * u + n2 * v;
      nLocal = dot(ns, ns) > 1e-10 ? normalize(ns) : nGeo;
      matOut = int(ftri(hitBase).w + 0.5);
    }
    return hit;
  }
  bool intersect(vec3 ro, vec3 rd, out float tHit, out vec3 nHit, out int matId){
    tHit = 1e9; bool any = false;
    vec3 winN = vec3(0.0, 0.0, 1.0); int winObj = 0; int winMat = 0;
    for(int k=0;k<N_OBJ;k++){
      if(k >= uObjCount) break;
      vec3 roL = (uObjInvM[k] * vec4(ro, 1.0)).xyz;
      vec3 rdL = mat3(uObjInvM[k]) * rd;                 // NOT normalised → tHit stays in world units (cross-object comparable)
      float prev = tHit;
      vec3 nL; int mId;
      if(intersectObj(uObjNodeBase[k], roL, rdL, tHit, nL, mId) && tHit < prev){
        any = true; winN = nL; winObj = k; winMat = mId;
      }
    }
    matId = 0;
    if(any){
      nHit = normalize(uObjNrm[winObj] * winN);          // local normal → world via the winning object's normal matrix
      matId = winMat;
    }
    return any;
  }
`

// ── PHOTON-CAUSTIC pass: trace N photons FROM the fire, through the glass gems, onto the floor; splat each landing
// into a top-down caustic map. The gems SPIN, so the caustic changes every frame — a fresh batch is splatted each
// frame (no accumulation freeze) and the camera trace's EMA averages them into a soft dancing caustic the floor
// reads. Each photon = one GL_POINTS vertex; the vertex shader does the light trace through the multi-object scene. ──
const PHOTON_VERT = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform float uSeed;
  uniform vec3 uFirePos;
  uniform float uCausticHalf; // half-extent (world XZ) the caustic map covers, centred on the origin
  uniform float uFloorY;
  uniform sampler2D uTriTex;
  uniform sampler2D uNodeTex;
  uniform int uTexW;
  uniform vec3 uMatColor[8];
  uniform float uMatIor[8];
  uniform int uMatKind[8];
  out vec3 vTint;
  float gSeed;
  float rnd(){ gSeed += 1.0; vec3 p3 = fract(vec3(float(gl_VertexID)) * 0.1031 + gSeed * 0.0973 + uSeed * 0.0411); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  ${BVH_GLSL}
  void main(){
    gSeed = float(gl_VertexID) * 0.017 + uSeed;
    // the gems now RING the fire, so emit photons in a full horizontal circle with a downward bias — they pass
    // through the surrounding gems and the refracted light reaches the floor below.
    float az = rnd() * 6.2831853;
    float down = mix(0.08, 0.7, rnd());
    vec3 rd = normalize(vec3(cos(az), -down, sin(az)));
    vec3 ro = uFirePos, tint = vec3(1.0);
    bool inside = false, throughGlass = false, landed = false;
    vec3 landP = vec3(0.0);
    for(int b=0; b<6; b++){
      float t; vec3 n; int mat;
      if(!intersect(ro, rd, t, n, mat)) break;
      vec3 p = ro + rd*t;
      if(dot(rd, n) > 0.0) n = -n;
      int kind = uMatKind[mat];
      if(kind == 0){ landed = true; landP = p; break; }          // floor (or tree) — landed
      if(kind == 2){                                              // glass — refract (caustic forming)
        throughGlass = true; tint *= uMatColor[mat];
        float ior = uMatIor[mat];
        float eta = inside ? ior : 1.0/ior;
        vec3 refr = refract(rd, n, eta);
        if(dot(refr,refr) < 1e-6){ rd = reflect(rd, n); } else { rd = refr; inside = !inside; }
        ro = p + rd*0.002; continue;
      }
      break;                                                      // flame/other — stop
    }
    bool ok = landed && throughGlass && abs(landP.y - uFloorY) < 0.4;
    vTint = ok ? tint : vec3(0.0);
    vec2 cuv = landP.xz / uCausticHalf;                           // → [-1,1] clip
    gl_Position = ok ? vec4(cuv, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0); // off-screen if not a caustic
    gl_PointSize = 2.5;
  }
`
const PHOTON_FRAG = /* glsl */ `
  precision highp float;
  in vec3 vTint;
  out vec4 fragColor;
  uniform vec3 uFireCol;
  void main(){
    vec2 d = gl_PointCoord - 0.5;
    float fall = exp(-dot(d, d) * 7.0);                           // a soft round splat
    fragColor = vec4(vTint * uFireCol * fall, 1.0);
  }
`

const makeScenePT = (BOUNCES: number, SPP: number) => /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec2 vUv;
  out vec4 fragColor;
  uniform float uSeed;
  uniform vec2  uRes;
  uniform float uYaw, uPitch, uZoom;
  uniform vec3  uBackdrop, uKey;
  const int N_MAT = 8;
  uniform vec3  uMatColor[N_MAT];
  uniform float uMatIor[N_MAT];
  uniform float uMatRough[N_MAT];
  uniform float uMatEmis[N_MAT];
  uniform int   uMatKind[N_MAT];   // 0 diffuse, 1 emissive, 2 glass
  uniform vec3  uFirePos;
  uniform float uFireOn;
  uniform float uTime;             // for the campfire flicker (the scene renders every frame now)
  uniform float uFog;              // atmospheric distance-fog density
  uniform float uBlend;            // temporal EMA weight: out = mix(prevFrame, thisFrame, uBlend) — denoises while rotating
  uniform sampler2D uCausticTex;   // top-down caustic map (light focused through the gems onto the floor)
  uniform float uCausticHalf;      // world-XZ half-extent the caustic map covers
  uniform float uCausticGain;      // strength (0 = off)
  uniform sampler2D uTriTex;       // 6 texels/tri: a,b,c then na,nb,nc; the a-texel .w carries the materialId
  uniform sampler2D uNodeTex;      // 2 texels/node
  uniform int uTexW;

  float gSeed;
  float rnd(){ gSeed += 1.0; vec3 p3 = fract(vec3(gl_FragCoord.xyx) * 0.1031 + gSeed * 0.137 + uSeed * 0.0411); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  // a soft env: a vertical backdrop gradient + a broad key glow (matches the chapter mood the gems refract). Lifted
  // brighter than the hero's cosmetic env because the chapter fog/key are dark — the glass gems are env-LIT only, so
  // a dark env reads as black glass; this gives them something to refract + catch.
  vec3 env(vec3 d){
    float up = clamp(d.y*0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBackdrop*0.18, uBackdrop*0.62, up*up);          // very dim night sky — the campfire carries the lighting
    vec3 kd = normalize(vec3(0.35,0.75,0.40));
    col += uKey * 0.12;                                             // a faint ambient key fill (kept low so the fire + caustics pop)
    col += uKey * 0.8 * pow(max(dot(d, kd), 0.0), 3.0);
    col += uKey * 2.0 * pow(max(dot(d, kd), 0.0), 24.0);           // a hot core → a gentle glint across the glass
    float horizon = exp(-abs(d.y) * 5.0);                          // a hazy atmospheric band at the horizon
    col += uBackdrop * horizon * 0.8;
    col += vec3(0.55,0.34,0.18) * horizon * 0.45 * uFireOn;        // the campfire's warm glow bleeding into the low sky
    return col;
  }

  ${BVH_GLSL}

  void main(){
    gSeed = 0.0;
    // world-space orbit camera (the BVH objects are traced via per-object ray transforms; the camera stays world)
    vec3 target = vec3(0.0, 0.0, 0.2);
    float r = 4.4 * uZoom;                                          // zoomed in a touch on the campfire
    vec3 eye = target + r * vec3(sin(uYaw)*cos(uPitch), sin(uPitch)+0.10, cos(uYaw)*cos(uPitch)); // lower, more level angle
    vec3 fw = normalize(target - eye), rt = normalize(cross(fw, vec3(0.0,1.0,0.0))), up = cross(rt, fw);
    // campfire flicker — the scene renders every frame, so a live time term works (modulates the flame + its light)
    float flick = uFireOn > 0.5 ? (0.82 + 0.13*sin(uTime*11.0) + 0.07*sin(uTime*23.0) + 0.05*sin(uTime*41.0)) : 1.0;
    float farMiss = 14.0;

    vec3 sum = vec3(0.0);
    for(int s=0;s<${SPP};s++){
      vec2 j = (vec2(rnd(), rnd())-0.5);
      vec2 uv = ((vUv*uRes + j)/uRes * 2.0 - 1.0);
      uv.x *= uRes.x/uRes.y;
      vec3 ro = eye;
      vec3 rd = normalize(fw*2.2 + rt*uv.x + up*uv.y);
      vec3 thru = vec3(1.0), rad = vec3(0.0);
      bool inside = false;
      float primaryT = farMiss;
      for(int b=0;b<${BOUNCES};b++){
        float t; vec3 n; int mat;
        bool didHit = intersect(ro, rd, t, n, mat);
        if(b == 0) primaryT = didHit ? t : farMiss;
        if(!didHit){ rad += thru * env(rd); break; }
        vec3 p = ro + rd*t;
        if(dot(rd, n) > 0.0) n = -n;                 // face the ray — UNCONDITIONAL for all kinds (glass enter/exit needs it)
        int kind = uMatKind[mat];

        if(kind == 1){                               // EMISSIVE flame: bounded emit-and-break, flickering
          rad += thru * uMatColor[mat] * (1.0 + uMatEmis[mat]) * flick;
          break;
        }
        if(kind == 0){                               // DIFFUSE floor: clamped (flickering) fire light + ambient env + a GI bounce
          vec3 L = uFirePos - p; float d2 = dot(L,L); L = normalize(L);
          float fireLit = uFireOn * flick * max(dot(n, L), 0.0) * 12.0 / max(d2, 0.25);
          vec3 caustic = vec3(0.0);
          if(uCausticGain > 0.0){ vec2 cuv = p.xz / uCausticHalf * 0.5 + 0.5; if(cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) caustic = texture(uCausticTex, cuv).rgb * uCausticGain * flick; }
          rad += thru * uMatColor[mat] * (vec3(0.95,0.58,0.26)*fireLit + env(n)*0.2 + caustic);
          vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0,1.0,0.0)) : cross(n, vec3(1.0,0.0,0.0)));
          vec3 t2 = cross(n, t1); float u1 = rnd(), u2 = rnd(), rr = sqrt(u1), ph = 6.2831853*u2;
          rd = normalize(t1*rr*cos(ph) + t2*rr*sin(ph) + n*sqrt(1.0-u1));
          thru *= uMatColor[mat];
          ro = p + n*0.0015;
          if(b > 1){ float q = max(thru.r, max(thru.g, thru.b)); if(rnd() > q) break; thru /= max(q, 0.05); }
          continue;
        }
        // kind == 2 GLASS gem — the hero transport, reading this material's IOR/color/emissive
        if(inside){
          thru *= exp(-(vec3(1.0)-uMatColor[mat]) * min(t,0.9) * 1.1);
          rad  += thru * uMatColor[mat] * uMatEmis[mat] * min(t,0.9) * 1.6;
        }
        float ior = uMatIor[mat];
        float F0 = pow((1.0-ior)/(1.0+ior), 2.0);
        float ci = clamp(dot(-rd, n), 0.0, 1.0);
        float F = F0 + (1.0-F0)*pow(1.0-ci, 5.0);
        float eta = inside ? ior : 1.0/ior;
        vec3 refr = refract(rd, n, eta);
        if(dot(refr,refr) < 1e-6 || rnd() < F){ rd = reflect(rd, n); }
        else { rd = refr; inside = !inside; }
        ro = p + rd*0.0015;
        if(b > 2){ float q = max(thru.r, max(thru.g, thru.b)); if(rnd() > q) break; thru /= max(q, 0.05); }
      }
      rad = min(rad, vec3(8.0));                     // per-sample firefly clamp
      // atmospheric distance fog — the far trees fade into the sky/haze, giving the scene depth
      float fogAmt = clamp(1.0 - exp(-uFog * max(0.0, primaryT - 3.5)), 0.0, 0.7);
      rad = mix(rad, uBackdrop * 2.4 + uKey * 0.35, fogAmt);
      sum += max(rad, 0.0);
    }
    fragColor = vec4(sum / float(${SPP}), uBlend);   // alpha = the temporal-EMA blend weight (denoises the rotating scene)
  }
`

const DISP = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTex;
  uniform float uN;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  void main(){
    vec3 c = texture(uTex, vUv).rgb / max(uN, 1.0);
    c = aces(c * 2.4);   // exposure lift — env-lit glass reads dark raw; the party portrait wants the gems to glow
    c = pow(c, vec3(1.0/2.2));
    fragColor = vec4(c, 1.0);
  }
`

const lin = (hex: string) => { const k = new THREE.Color(hex).convertSRGBToLinear(); return new THREE.Vector3(k.r, k.g, k.b) }
// per-object transform uniform arrays (GLSL N_OBJ = 6). Built fresh per material so each scene owns its matrices.
const objMat4Array = () => Array.from({ length: 6 }, () => new THREE.Matrix4())
const objMat3Array = () => Array.from({ length: 6 }, () => new THREE.Matrix3())

export function ExpeditionPathTrace({ scene, backdrop, keyCol, controls = true, orbit = true, forceEma = false, particles = true, converge = false }: { scene: PartyPtScene; backdrop: string; keyCol: string; controls?: boolean; orbit?: boolean; forceEma?: boolean; particles?: boolean; converge?: boolean }) {
  const { gl, size, invalidate } = useThree()
  const ptp = usePathTraceParams()
  const particleScale = useGfxPreset().sparkle
  const gemCount = scene.materials.filter((m) => m.kind === 2).length
  const gemsSpin = orbit && gemCount > 0 // the party's gems spin in place; the cutscene (orbit=false) stays a framed shot
  // temporal EMA — user setting (default off = sharp per-frame). The static cutscene forces a heavy blend so it
  // converges to a clean still; otherwise the spinning party respects the chosen off/low/high.
  const emaMode = useGfx((s) => s.expeditionPtEma)
  const emaBlend = forceEma ? 0.12 : EMA_BLEND[emaMode]
  const causticQ = useGfx((s) => s.expeditionPtCaustics)
  // pack each object's BVH into shared textures + record per-object {nodeBase, triBase}; the ray is transformed
  // per-object at trace time, so the gems rotate via uniform updates with NO per-frame BVH rebuild.
  const multi = useMemo(() => packMultiBVH(scene.objects.map((o) => buildBVHData(o.geo))), [scene])
  const w = Math.max(2, Math.round(size.width * ptp.scale))
  const h = Math.max(2, Math.round(size.height * ptp.scale))
  const accum = useFBO(w, h, { type: THREE.FloatType, depthBuffer: false })
  const causticRes = CAUSTIC_RES[causticQ]
  const caustic = useFBO(causticRes, causticRes, { type: THREE.FloatType, depthBuffer: false }) // top-down caustic map (refreshed each frame)
  // more gems = more variance → more samples per frame to hold quality while the camera + gems move.
  const spp = Math.min(20, Math.min(ptp.spp, 12) + gemCount * 2)
  const PHOTONS = CAUSTIC_PHOTONS[causticQ] // photons traced per frame (quality setting)
  const causticsOn = causticQ !== 'off' && scene.fireOn && gemCount > 0 // light through the gems onto the floor needs a fire + gems
  const causticGain = PHOTONS > 0 ? (CAUSTIC_GAIN * 24000) / PHOTONS : 0 // normalise brightness across photon counts

  // per-object node-base array (root of each object) — padded to N_OBJ = 6, gated by uObjCount. Child + triStart
  // indices are pre-offset to global by packMultiBVH, so only the per-object ROOT base is needed at trace time.
  const objBaseN = useMemo(() => Array.from({ length: 6 }, (_, i) => multi.objs[i]?.nodeBase ?? 0), [multi])

  const ptMat = useMemo(() => {
    const matColor = Array.from({ length: 8 }, (_, i) => { const m = scene.materials[i]; return m ? new THREE.Vector3(m.color[0], m.color[1], m.color[2]) : new THREE.Vector3() })
    const matIor = Array.from({ length: 8 }, (_, i) => scene.materials[i]?.ior ?? 1)
    const matRough = Array.from({ length: 8 }, (_, i) => scene.materials[i]?.rough ?? 1)
    const matEmis = Array.from({ length: 8 }, (_, i) => scene.materials[i]?.emissive ?? 0)
    const matKind = Array.from({ length: 8 }, (_, i) => scene.materials[i]?.kind ?? 0)
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: makeScenePT(Math.min(ptp.bounces, 4), spp),
      // temporal EMA: dst = thisFrame*uBlend + prevFrame*(1-uBlend) — averages recent frames so the moving scene
      // denoises (without freezing). Standard alpha blending with the shader writing alpha = uBlend.
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) },
        uYaw: { value: 0 }, uPitch: { value: 0.05 }, uZoom: { value: 1 },
        uBackdrop: { value: lin(backdrop) }, uKey: { value: lin(keyCol) },
        uMatColor: { value: matColor }, uMatIor: { value: matIor }, uMatRough: { value: matRough }, uMatEmis: { value: matEmis }, uMatKind: { value: matKind },
        uFirePos: { value: new THREE.Vector3(scene.firePos[0], scene.firePos[1], scene.firePos[2]) }, uFireOn: { value: scene.fireOn ? 1 : 0 },
        uTime: { value: 0 }, uFog: { value: 0.16 }, uBlend: { value: 1 },
        uCausticTex: { value: null as THREE.Texture | null }, uCausticHalf: { value: 3.5 }, uCausticGain: { value: 0 },
        uTriTex: { value: multi.triTex }, uNodeTex: { value: multi.nodeTex }, uTexW: { value: multi.texW },
        uObjInvM: { value: objMat4Array() }, uObjNrm: { value: objMat3Array() },
        uObjNodeBase: { value: objBaseN }, uObjCount: { value: scene.objects.length },
      },
    })
  }, [scene, backdrop, keyCol, multi, objBaseN, ptp.bounces, spp, w, h])

  const dispMat = useMemo(() => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DISP, depthTest: false, depthWrite: false, uniforms: { uTex: { value: accum.texture }, uN: { value: 1 } } }), [accum])
  const quad = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
  const ptScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, ptMat)); return s }, [quad, ptMat])
  const dispScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, dispMat)); return s }, [quad, dispMat])
  // ── caustics: a point cloud of photons traced from the fire through the gems, splatted into the caustic FBO ──
  const photonMat = useMemo(() => {
    const matColor = Array.from({ length: 8 }, (_, i) => { const m = scene.materials[i]; return m ? new THREE.Vector3(m.color[0], m.color[1], m.color[2]) : new THREE.Vector3() })
    const matIor = Array.from({ length: 8 }, (_, i) => scene.materials[i]?.ior ?? 1)
    const matKind = Array.from({ length: 8 }, (_, i) => scene.materials[i]?.kind ?? 0)
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: PHOTON_VERT, fragmentShader: PHOTON_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      uniforms: {
        uSeed: { value: 0 }, uFirePos: { value: new THREE.Vector3(scene.firePos[0], scene.firePos[1], scene.firePos[2]) },
        uCausticHalf: { value: 3.5 }, uFloorY: { value: -0.62 }, uFireCol: { value: new THREE.Vector3(1.0, 0.62, 0.32) },
        uMatColor: { value: matColor }, uMatIor: { value: matIor }, uMatKind: { value: matKind },
        uTriTex: { value: multi.triTex }, uNodeTex: { value: multi.nodeTex }, uTexW: { value: multi.texW },
        uObjInvM: { value: objMat4Array() }, uObjNrm: { value: objMat3Array() },
        uObjNodeBase: { value: objBaseN }, uObjCount: { value: scene.objects.length },
      },
    })
  }, [scene, multi, objBaseN])
  const photonGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, PHOTONS) * 3), 3)); return g }, [PHOTONS])
  const photonScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Points(photonGeo, photonMat)); return s }, [photonGeo, photonMat])
  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
  const scratchM = useMemo(() => new THREE.Matrix4(), [])
  const scratchN = useMemo(() => new THREE.Matrix3(), [])
  const frame = useRef(0)
  const lastKey = useRef('')
  const spin = useRef(0) // camera auto-orbit angle
  const gemSpin = useRef(0) // shared gem spin angle (each gem adds its baseYaw phase)
  const lastT = useRef(performance.now())
  const wake = () => invalidate()

  useFrame((state) => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - lastT.current) / 1000)
    lastT.current = now
    if (orbit) spin.current += dt * SPIN_RATE
    if (gemsSpin) gemSpin.current += dt * GEM_SPIN_RATE

    const m = ptMat.uniforms
    const pm = photonMat.uniforms
    const cam = state.camera
    const dist = cam.position.length() || 5
    m.uZoom.value = THREE.MathUtils.clamp(dist / 5.4, 0.5, 2.2)
    m.uYaw.value = Math.atan2(cam.position.x, cam.position.z) + spin.current
    const polar = Math.acos(THREE.MathUtils.clamp(cam.position.y / dist, -1, 1))
    m.uPitch.value = THREE.MathUtils.clamp(Math.PI / 2 - polar, -1.2, 1.2)
    m.uTime.value = state.clock.elapsedTime

    // per-object transforms: M = T(pos) · Ry(baseYaw + spin?). Rebuilt on CPU each frame (≤6 tiny matrices) and
    // pushed to both the camera + photon materials — the gems spin via these uniforms, NO BVH rebuild.
    // INVARIANT: M must stay RIGID (rotation + translation, NO scale) — scale is baked into the gem geometry, not
    // here — because the shader leaves the transformed ray direction un-normalised so its hit t stays in world units.
    for (let k = 0; k < scene.objects.length && k < 6; k++) {
      const o = scene.objects[k]
      const angle = o.baseYaw + (o.spin ? gemSpin.current : 0)
      scratchM.makeRotationY(angle)
      scratchM.setPosition(o.pos[0], o.pos[1], o.pos[2]) // → T·Ry (rotate about own centre, then place)
      ;(m.uObjInvM.value as THREE.Matrix4[])[k].copy(scratchM).invert()
      scratchN.getNormalMatrix(scratchM)
      ;(m.uObjNrm.value as THREE.Matrix3[])[k].copy(scratchN)
      ;(pm.uObjInvM.value as THREE.Matrix4[])[k].copy((m.uObjInvM.value as THREE.Matrix4[])[k])
      ;(pm.uObjNrm.value as THREE.Matrix3[])[k].copy(scratchN)
    }

    const prevClear = gl.getClearColor(new THREE.Color()).getHex()
    const prevAlpha = gl.getClearAlpha() // restore alpha too (getHex drops it) so the shared GL state is left faithful
    const prevAuto = gl.autoClear
    gl.autoClear = false
    // On a new COMPOSITION (party/chapter) clear the EMA buffer + seed the first frame at full weight; otherwise the
    // shader blends this frame into the running average (uBlend). The camera orbit + gem spin are absorbed by the EMA.
    if (scene.hash !== lastKey.current) {
      lastKey.current = scene.hash
      frame.current = 0
      gl.setRenderTarget(accum)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
    }
    // CAUSTIC pass: the gems spin, so re-splat a FRESH batch of photons each frame (fire → through the gems →
    // floor) into a cleared caustic map. The camera trace's EMA averages successive frames into a soft, dancing
    // caustic — denser + smoother than any single sparse frame.
    if (causticsOn) {
      pm.uSeed.value = frame.current % 1024
      gl.setRenderTarget(caustic)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
      gl.render(photonScene, ortho)
    }
    m.uCausticTex.value = caustic.texture
    m.uCausticGain.value = causticsOn ? causticGain : 0
    m.uSeed.value = frame.current
    // `converge` (static dioramas): a TRUE running mean (1/N) instead of the fixed-window EMA — it averages ALL
    // frames since the last reset, so heavy diffuse GI converges to a clean still over time (the EMA plateaus noisy).
    m.uBlend.value = frame.current < 1 ? 1 : (converge ? 1 / (frame.current + 1) : emaBlend)
    gl.setRenderTarget(accum)
    gl.render(ptScene, ortho)
    frame.current++
    dispMat.uniforms.uTex.value = accum.texture
    dispMat.uniforms.uN.value = 1 // the EMA buffer already holds the averaged color (no divide)
    gl.setRenderTarget(null)
    gl.render(dispScene, ortho)
    // composite the foreground particles (the R3F scene, real camera) over the path-traced portrait
    gl.clearDepth()
    gl.render(state.scene, state.camera)
    gl.autoClear = prevAuto
    gl.setClearColor(prevClear, prevAlpha)
    // moving (orbit/spin) → render every frame; static → keep accumulating until converged then go quiet (the
    // true-mean `converge` path needs many more frames than the EMA to fully clean up heavy diffuse GI).
    if (orbit || gemsSpin || frame.current < (converge ? 360 : 90)) invalidate()
  }, 1)

  return (
    <>
      {/* a hover/tap catcher (never drawn, still raycast) so hovering re-wakes the auto-orbit out of its converged rest */}
      {controls && (
        <mesh onPointerMove={wake} onPointerDown={wake} renderOrder={-20}>
          <sphereGeometry args={[20, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={THREE.BackSide} />
        </mesh>
      )}
      {/* foreground particles composited over the portrait — drifting embers + ambient motes (the campfire scene's life) */}
      {particles && <Sparkles count={Math.round(26 * particleScale)} scale={[7, 4.5, 5]} position={[0, 0.4, 0]} size={2.4} speed={0.16} opacity={0.55} color="#bfe0ff" />}
      {particles && <Sparkles count={Math.round(18 * particleScale)} scale={[1.6, 1.6, 1.6]} position={[0, 0, 1.6]} size={3.0} speed={0.6} opacity={0.85} color="#ffcf6b" />}
      {controls && (
        <OrbitControls makeDefault enablePan={false} enableZoom target={[0, 0, 0.2]} minDistance={3.4} maxDistance={9} rotateSpeed={0.8}
          onStart={wake} onChange={wake}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      )}
    </>
  )
}
