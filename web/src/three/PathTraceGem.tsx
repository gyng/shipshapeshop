import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { sdfActiveGLSL } from './sdfShapes.glsl'
import { sceneById, atmosphereById, lightingById, gemColorById, SLOT_ATMOSPHERE, SLOT_FINISH, SLOT_LIGHTING, SLOT_GEM_COLOR } from '../content/cosmetics'
import { finishSdf, lightingKey, useMatOverride } from './finishSdf'
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
  uniform float uAberr;    // chromatic dispersion: per-sample wavelength splits the IOR (finish aberrAdd) → rainbow fire
  uniform float uMatte;    // exotic finish: 0 = glass; >0 = opaque DIFFUSE surface (prob. of a diffuse vs refract bounce)
  uniform float uLensing;  // exotic finish: gravitational lensing — pinch the escaping background toward the gem (black hole)
  uniform float uVolume;   // exotic finish: the gem interior is a ray-marched fbm cloud/smoke at this density
  uniform float uTime;     // gentle auto-spin (FREEZES when paused → the gem holds still)
  uniform float uMoteTime; // ambient-mote drift clock — keeps advancing even when paused, so the particles stay fluid
  uniform vec3  uCamPos;       // real R3F camera: rays + gl_FragDepth → cosmos moves on orbit + motes composite in-world
  uniform mat4  uInvViewProj;  // NDC → world ray
  uniform mat4  uViewProj;     // world → clip, for writing real gl_FragDepth at the gem hit (so 3D atmosphere composites WITH the gem)
  uniform vec3  uBackdrop, uKey, uCool, uWarm, uStar;
  uniform vec3  uKeyDir;   // equipped Lighting mood: the key glow's (animated) direction — sweeps for orbit/ring moods
  uniform vec3  uKeyTint;  // the mood's hue (pure-hue, max-channel-1) tinting the key glint; disco cycles the rainbow
  uniform float uKeyPulse; // the mood's key intensity breath/flicker (1 = steady)
  uniform vec3  uAtmoTint;     // equipped Atmosphere's hue, blended into env → the gem's refraction/reflection carries the atmosphere
  uniform float uAtmoAmt;      // 0 = Clear (no tint)
  uniform samplerCube uEnvCube; // a live cubemap of the atmosphere (clouds/nebula/aurora), captured around the gem
  uniform float uEnvCubeAmt;   // 0 = no cube (use procedural env only); >0 = refract/reflect the real atmosphere
  uniform float uEmissive;     // equipped finish inner glow (0 = none)
  uniform float uAbsorbMul;    // equipped finish density (≥1 darkens a low-transmission finish; 1 = default)
  uniform float uReflMul;      // equipped finish env-reflection strength (envMapIntensityMul); 1 = default
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
  // aurora) over the procedural env, so the gem genuinely BENDS the atmosphere in its glass. uEnvCubeAmt = 0 → the
  // procedural env only (the texture is never sampled). The primary-background ray keeps env() (the real atmosphere
  // geometry already composites around the gem by depth).
  vec3 envGem(vec3 d){
    vec3 base = env(d);
    if(uEnvCubeAmt <= 0.0) return base;
    // soft HDR rolloff so a very bright/additive atmosphere (jewel caustics, supernova, fireflies) GLOWS in the
    // glass instead of blowing the whole gem to white: values ≤1 pass through, brighter ones compress toward an
    // asymptote (~1.7). A flat min()-clamp let a uniformly-bright cube saturate the whole refraction.
    vec3 a = texture(uEnvCube, d).rgb;
    vec3 atmo = a / (1.0 + max(a - 1.0, 0.0) * 0.9); // knee at 1.0 → bright cubes asymptote to ~1.1 (was ~1.7); dim/colored atmospheres (≤1) pass through untouched
    return mix(base, base * 0.5 + atmo, uEnvCubeAmt);
  }

${sdfGLSL}

  // signed distance to the gem (positive outside). Per-shape field (sdfActiveGLSL) injected as sdfGLSL above.
  float map(vec3 p){
    return sdfActive(R * p);
  }
  // tetrahedral 4-tap gradient (IQ) — 4 map() calls vs the 6-tap central diff; SAME epsilon so silhouettes/Fresnel stay bit-comparable
  vec3 nrm(vec3 p){
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.0016;
    return normalize(
      k.xyy * map(p + k.xyy*e) +
      k.yyx * map(p + k.yyx*e) +
      k.yxy * map(p + k.yxy*e) +
      k.xxx * map(p + k.xxx*e));
  }

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
    float a = fi * 2.39996323 + uMoteTime * 0.18;        // golden-angle spiral, slow orbital drift (own clock → fluid when paused)
    float r = 1.9 + fract(fi * 0.61803398) * 1.3;        // shell radius — outside the gem, in the space it "catches"
    float y = (fract(fi * 0.37139) - 0.5) * 3.0 + sin(uMoteTime * 0.5 + fi) * 0.2;
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
      // an EMISSIVE gem lights the surrounding haze — brightest in the mist right around it (gem sits near tEnd),
      // so a Plasma/Magma gem glows out into a luminous halo of fog. Default uEmissive 0 = no-op.
      float gemProx = t / tEnd;
      Li += uColor * uEmissive * (0.10 + 0.5 * gemProx * gemProx);
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

  // value-noise fbm for the volumetric "cloud gem" interior (uVolume) — cheap, smooth, GLSL ES 1.00.
  float nhash(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(nhash(i),nhash(i+vec3(1,0,0)),f.x), mix(nhash(i+vec3(0,1,0)),nhash(i+vec3(1,1,0)),f.x), f.y),
               mix(mix(nhash(i+vec3(0,0,1)),nhash(i+vec3(1,0,1)),f.x), mix(nhash(i+vec3(0,1,1)),nhash(i+vec3(1,1,1)),f.x), f.y), f.z); }
  float fbmN(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.02; a *= 0.5; } return s; }

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
      // hero-wavelength dispersion: ONE wavelength per sample (Monte-Carlo spectral) → converges to true dispersion
      // at zero extra ray cost. Blue bends more than red; the spectral weight tints the sample, averaging to white.
      float wl = rnd();
      float iorS = uIor + uAberr * (wl - 0.5);
      vec3 spec = vec3(smoothstep(1.0, 0.4, wl), 1.0 - 1.6*abs(wl - 0.5), smoothstep(0.0, 0.6, wl));
      spec = spec / max(spec.x + spec.y + spec.z, 1e-3) * 3.0;   // normalise so the spp-average is ~white (energy-safe)
      vec3 thru = vec3(1.0), rad = vec3(0.0);
      bool inside = false;
      for(int b=0;b<${BOUNCES};b++){
        float t = march(ro, rd, inside ? -1.0 : 1.0);
        if(b == 0) tAccum += (t < 0.0) ? farMiss : t;    // spp-averaged primary depth → smooth haze across the gem silhouette
        float gemD = (t < 0.0) ? 1e9 : t;
        rad += thru * moteGlow(ro, rd, gemD);            // soft additive mote glow up to the gem hit; a refracted/reflected
                                                         // bounce ray catches motes through the glass (dimmed by thru)
        if(t < 0.0){
          vec3 erd = rd;
          if(uLensing > 0.0 && b == 0){                  // black-hole lensing: bend the escaping ray toward the gem centre (origin)
            vec3 perp = -ro - rd*dot(-ro, rd);           // closest-approach offset of the gem centre from the ray
            float bp = length(perp);
            erd = normalize(rd + normalize(perp + 1e-5) * (uLensing * 0.5 / (bp*bp + 0.35)));
          }
          rad += thru * (b == 0 ? env(erd) : envGem(erd)); break;  // escaped: primary→cosmos, bounce→atmosphere cube
        }
        vec3 p = ro + rd*t;
        vec3 n = nrm(p); if(inside) n = -n;              // face the incoming ray
        // VOLUMETRIC cloud interior — on ENTERING the gem, ray-march fbm density instead of clear glass: a soft,
        // self-shadowed cloud/smoke/nebula filling the shape (lit by the equipped Lighting key). Consumes the ray.
        if(uVolume > 0.0 && !inside){
          vec3 vp = p + rd*0.02; vec3 acc = vec3(0.0); float vtr = 1.0;
          for(int k=0;k<28;k++){
            if(map(vp) > 0.01) break;                    // marched out of the gem volume
            float rho = clamp(fbmN(vp*3.4 + uTime*0.04) * uVolume * 1.7 - 0.15, 0.0, 1.0);
            if(rho > 0.001){
              float sh = 1.0; vec3 lp = vp + uKeyDir*0.14;   // cheap self-shadow toward the key
              for(int j=0;j<3;j++){ if(map(lp) > 0.0) break; sh *= 1.0 - clamp(fbmN(lp*3.4)*uVolume, 0.0, 0.7); lp += uKeyDir*0.14; }
              vec3 lit = uColor * (0.25 + 0.95*sh) * mix(vec3(1.0), uKeyTint, 0.4) * uKeyPulse;
              acc += vtr * rho * lit; vtr *= 1.0 - rho;
            }
            vp += rd*0.05;
            if(vtr < 0.02) break;
          }
          rad += thru * (acc + vtr * env(rd) * 0.5);     // wisps let a little background through where thin
          break;
        }
        if(inside){
          thru *= exp(-(vec3(1.0)-uColor) * min(t,1.4) * 1.1 * uAbsorbMul);  // Beer–Lambert (deeper clamp so dense finishes read truly dark)
          rad += thru * uColor * (min(t,0.9)*min(t,0.9)) * 0.12;             // internal focusing: long internal chords gather transmitted light into a richer caustic core
          // PARTICIPATING (volume) EMISSION — the look that sings in a path tracer: the glass body emits along its
          // interior path, so an emissive finish glows from WITHIN and that glow refracts/bends out through the
          // glass and dims correctly through each interface (× thru). Path-length weighted (thicker → brighter).
          // Default uEmissive 0 = exact no-op.
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
          if(b > 1){ float qm = clamp(max(thru.r, max(thru.g, thru.b)), 0.05, 1.0); if(rnd() > qm) break; thru /= qm; }
          continue;
        }
        float ci = clamp(dot(-rd, n), 0.0, 1.0);
        float F = F0 + (1.0-F0)*pow(1.0-ci, 5.0);        // Schlick reflectance
        float eta = inside ? iorS : 1.0/iorS;            // wavelength-split IOR → chromatic dispersion
        vec3 refr = refract(rd, n, eta);
        bool tir = dot(refr,refr) < 1e-5;
        if(tir || rnd() < F){ rd = reflect(rd, n); thru *= uReflMul; }  // reflect (specular) — finish reflectivity
        else { rd = refr; inside = !inside; }            // refract (cross the interface)
        ro = p + rd*0.003;
        // Russian roulette — the survival probability and the divisor MUST match, or throughput inflates → fireflies
        if(b > 2){ float q = clamp(max(thru.r, max(thru.g, thru.b)), 0.05, 1.0); if(rnd() > q) break; thru /= q; }
      }
      sum += max(rad, 0.0) * spec;                       // weight by the sample's spectral response → chromatic dispersion
    }
    vec3 col = sum / float(${SPP});
    // (emission is added inside the bounce loop now — participating volume emission, so it refracts through the gem)
    // volumetric haze along the primary ray — marched ONCE/pixel; tEnd = spp-AVERAGED gem depth, so the haze fades
    // smoothly across the antialiased silhouette (no hard fog rim) and the gem occludes the front haze.
    if(uHaze > 0.0){
      vec3 inscat; float trans; volumetric(cam, rdC, tAccum / float(${SPP}), inscat, trans);
      col = trans * col + inscat;
    }
    fragColor = vec4(col, 1.0);                          // LINEAR HDR per-frame trace → accumulated additively off-screen
  }
`

// Display + depth pass: the composer-rendered fullscreen quad. It samples the accumulation buffer (Σ frames),
// divides by the frame count for the converged average, and RE-MARCHES the center ray to write gl_FragDepth so
// the 3D Atmosphere still depth-composites WITH the gem (the trace itself now lives in an off-screen pre-pass).
const makeDisp = (sdfGLSL: string) => /* glsl */ `
  precision highp float;
  out vec4 fragColor;
  uniform sampler2D uTex;       // accumulation buffer (Σ per-frame traces)
  uniform float uN;             // frames accumulated → divide for the average
  uniform vec2  uRes;           // full drawing-buffer size
  uniform float uTime;          // gem spin angle (so the depth march matches the traced pose)
  uniform vec3  uCamPos;
  uniform mat4  uInvViewProj, uViewProj;
  mat3 R;
  mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
  mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
${sdfGLSL}
  float map(vec3 p){ return sdfActive(R * p); }
  float march(vec3 ro, vec3 rd){
    float t = 0.002;
    for(int i=0;i<128;i++){ float d = map(ro+rd*t); if(d < 0.0006) return t; t += max(d*0.8, 0.001); if(t > 20.0) break; }
    return -1.0;
  }
  void main(){
    R = rotY(uTime * 0.15);
    vec2 uv = gl_FragCoord.xy / uRes;
    fragColor = vec4(texture(uTex, uv).rgb / max(uN, 1.0), 1.0); // converged average → composer Bloom + ACES
    vec2 ndc = uv * 2.0 - 1.0;
    vec4 fw = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 rd = normalize(fw.xyz/fw.w - uCamPos);
    float t = march(uCamPos, rd);
    if(t < 0.0){ gl_FragDepth = 1.0; }
    else { vec4 clip = uViewProj * vec4(uCamPos + rd*t, 1.0); gl_FragDepth = clamp((clip.z/clip.w)*0.5 + 0.5, 0.0, 1.0); }
  }
`

const lin = (hex: string) => { const k = new THREE.Color(hex).convertSRGBToLinear(); return new THREE.Vector3(k.r, k.g, k.b) }

export function PathTraceGem({ family, rarity, controls = true, autoRotate = false, paused = false, previewScene, previewAtmosphere, previewLighting, previewFinish, previewGemColor, envMap }: { family: string; rarity: RarityName; controls?: boolean; autoRotate?: boolean; paused?: boolean; previewScene?: number; previewAtmosphere?: number; previewLighting?: number; previewFinish?: number; previewGemColor?: number; envMap?: THREE.Texture | null }) {
  // `previewScene`/`previewAtmosphere` (shop/viewer preview) render an UNequipped cosmetic without touching the
  // equipped one — so the gem refracts the *previewed* atmosphere's tint (and it keys the accumulation reset).
  const storeScene = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(previewScene ?? storeScene)
  const ptp = usePathTraceParams()
  const g = useGfxPreset()
  const ptHaze = useGfx((s) => s.ptHaze)
  const ptEnvCubeAmt = useGfx((s) => s.ptEnvCubeAmt) // user-tunable atmosphere-refraction strength
  const equippedAtmo = useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)
  const atmo = atmosphereById(previewAtmosphere ?? equippedAtmo) // equipped/previewed Atmosphere: deepens haze + tints refraction
  const atmoHaze = atmo.haze
  // a representative hue for the equipped atmosphere → blended into env() so the gem's refraction/reflection carries it
  const atmoTint = useMemo(() => lin(atmo.vol?.colorB ?? atmo.clouds?.colorLight ?? atmo.godRays?.color ?? atmo.aurora?.colorA ?? atmo.mote), [atmo])
  const atmoAmt = atmo.id === 0 ? 0 : 0.32
  // Equipped gem finish (Shop cosmetic) mapped onto the path tracer — `previewFinish` lets the shop hover-preview one.
  const equippedFinish = useGame((s) => s.view?.equipped?.[SLOT_FINISH] ?? 0)
  const matOv = useMatOverride()
  const fin = finishSdf(previewFinish ?? equippedFinish, matOv)
  const equippedLighting = useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)
  const L = lightingById(previewLighting ?? equippedLighting) // equipped/previewed Lighting mood — scales the env the gem is lit by
  const rank = RANK[rarity]
  // gem BODY hue from the equipped/previewed Gem Colour cosmetic (Clear → neutral white = no absorption → pristine
  // glass). Rarity no longer tints the gem; it now reads via the rarity-coloured motes (gfx `rarityMotes`).
  const equippedGemColor = useGame((s) => s.view?.equipped?.[SLOT_GEM_COLOR] ?? 0)
  const gcHex = gemColorById(previewGemColor ?? equippedGemColor).color
  const gemBodyCol = useMemo(() => (gcHex ? lin(gcHex) : new THREE.Vector3(1, 1, 1)), [gcHex])

  // Inject ONLY this shape's SDF (sdfActiveGLSL) → small program. Rebuilds when the shape/params change.
  const frag = useMemo(() => makePT(ptp.bounces, ptp.steps, ptp.spp, sdfActiveGLSL(family)), [ptp.bounces, ptp.steps, ptp.spp, family])
  const dispFrag = useMemo(() => makeDisp(sdfActiveGLSL(family)), [family])

  const { gl, size } = useThree()
  const invalidate = useThree((s) => s.invalidate)
  // accumulate at the canvas drawing-buffer resolution (the canvas dpr already folds in the path-trace render
  // scale via HeroView's ptDpr), so the converged still is exactly as sharp as the old direct render.
  const dpr = gl.getPixelRatio()
  const w = Math.max(2, Math.round(size.width * dpr))
  const h = Math.max(2, Math.round(size.height * dpr))
  // HDR buffer the per-frame traces accumulate INTO (additive). A STILL gem averages many frames into a clean
  // converged still; a spinning/changing gem resets every frame → 1 fresh sample (exactly the old behaviour).
  const accum = useFBO(w, h, { type: THREE.FloatType, depthBuffer: false })

  const ptMat = useMemo(() => {
    const [backdrop, key, cool, warm] = scene.env
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      uniforms: {
        uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) },
        uColor: { value: new THREE.Vector3(1, 1, 1) }, uIor: { value: 1.45 + rank * 0.05 },
        uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uInvViewProj: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
        uBackdrop: { value: lin(backdrop).multiplyScalar(L.ambient) }, uKey: { value: lin(key).multiplyScalar(L.key) }, uCool: { value: lin(cool).multiplyScalar(L.ambient) }, uWarm: { value: lin(warm).multiplyScalar(L.ambient) }, uStar: { value: lin(scene.stars) },
        uAtmoTint: { value: new THREE.Vector3() }, uAtmoAmt: { value: 0 },
        uKeyDir: { value: new THREE.Vector3(0.35, 0.75, 0.40).normalize() }, uKeyTint: { value: new THREE.Vector3(1, 1, 1) }, uKeyPulse: { value: 1 },
        uEnvCube: { value: null as THREE.Texture | null }, uEnvCubeAmt: { value: 0 },
        uEmissive: { value: 0 }, uAbsorbMul: { value: 1 }, uAberr: { value: 0 }, uReflMul: { value: 1 }, // (finish-driven; set live in useFrame)
        uMatte: { value: 0 }, uLensing: { value: 0 }, uVolume: { value: 0 }, // exotic finishes (matte / black-hole lensing / cloud)
        uMotes: { value: 16 }, uHaze: { value: 0 }, uMoteTime: { value: 0 },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rarity, scene, L, frag, w, h])

  // the composer-rendered quad: averages the accumulation and re-marches depth for the atmosphere composite.
  const dispMat = useMemo(() => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: dispFrag,
    uniforms: { uTex: { value: accum.texture }, uN: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uInvViewProj: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() } },
  }), [dispFrag, accum])

  const quad = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
  const ptScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, ptMat)); return s }, [quad, ptMat])
  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])

  const frame = useRef(0)
  const lastKey = useRef('')
  const tAccum = useRef(0)
  const moteAccum = useRef(0)
  const lastNow = useRef(performance.now())
  // on pause/resume, kick one render so the (now accumulating) frame restarts
  useEffect(() => { invalidate() }, [paused, invalidate])
  // Live-edit while idle: a look change (material override / atmosphere / finish / colour…) must repaint even when
  // the gem has converged to a still — the accumulation reset lives in useFrame, which won't tick otherwise. The
  // reset key (below) then clears `accum`; this only ensures useFrame RUNS. (A spinning gem already invalidates.)
  useEffect(() => { invalidate() }, [previewScene, previewAtmosphere, previewLighting, previewFinish, previewGemColor, envMap, matOv, invalidate])

  // PRE-PASS (priority 0, before HeroView's EffectComposer at priority 1): trace one sample-set into `accum`,
  // accumulating while the gem holds still — paused freezes the spin AND the motes, so the whole image is static
  // and the running average converges to a clean still over ~64 frames; then the trace is skipped (idle).
  useFrame((state) => {
    const u = ptMat.uniforms
    const now = performance.now()
    const dt = (now - lastNow.current) / 1000
    lastNow.current = now
    // FREEZE both clocks when paused: a non-static image (drifting motes / spinning gem) can't converge — it smears.
    if (!paused) { tAccum.current += dt; moteAccum.current += dt }
    u.uTime.value = tAccum.current
    u.uMoteTime.value = moteAccum.current
    u.uRes.value.set(w, h)
    const cam = state.camera
    u.uCamPos.value.copy(cam.position)
    u.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    u.uInvViewProj.value.copy(u.uViewProj.value).invert()
    u.uAtmoTint.value.copy(atmoTint)
    u.uAtmoAmt.value = atmoAmt
    u.uEnvCube.value = envMap ?? null
    u.uEnvCubeAmt.value = envMap ? ptEnvCubeAmt : 0
    u.uMotes.value = Math.max(0, Math.min(6, Math.round(6 * g.sparkle)))
    u.uHaze.value = ptHaze + atmoHaze
    u.uColor.value.copy(fin.tint ?? gemBodyCol)
    u.uIor.value = 1.45 + rank * 0.05 + fin.iorAdd
    u.uEmissive.value = fin.emissive
    u.uAbsorbMul.value = fin.absorbMul
    u.uAberr.value = 0.02 + rank * 0.02 + fin.aberrAdd
    u.uReflMul.value = THREE.MathUtils.clamp(fin.reflMul, 0.6, 1.6)
    u.uMatte.value = fin.matte; u.uLensing.value = fin.lensing; u.uVolume.value = fin.volumetric
    u.uKeyPulse.value = lightingKey(L, moteAccum.current, u.uKeyDir.value, u.uKeyTint.value)

    // Reset accumulation when ANYTHING the trace depends on changes (camera, the frozen spin/mote clocks, a
    // live-graded finish/atmosphere uniform). Spinning → clocks advance every frame → resets every frame → 1
    // fresh sample. Still → the key holds → `frame` climbs → the running average converges.
    const key = `${family}|${tAccum.current.toFixed(4)}|${moteAccum.current.toFixed(4)}|${cam.position.x.toFixed(3)},${cam.position.y.toFixed(3)},${cam.position.z.toFixed(3)}|${(u.uIor.value as number).toFixed(3)}|${u.uEmissive.value}|${u.uAbsorbMul.value}|${atmo.id}|${u.uAtmoAmt.value}|${u.uEnvCubeAmt.value}|${(u.uAberr.value as number).toFixed(3)}|${(u.uReflMul.value as number).toFixed(2)}|${u.uMatte.value}|${u.uLensing.value}|${u.uVolume.value}|${(u.uHaze.value as number).toFixed(3)}|${u.uMotes.value}`
    if (key !== lastKey.current) {
      lastKey.current = key
      frame.current = 0
      const pc = gl.getClearColor(new THREE.Color()).getHex(); const pa = gl.getClearAlpha()
      gl.setRenderTarget(accum); gl.setClearColor(0x000000, 0); gl.clear(true, false, false); gl.setClearColor(pc, pa)
    }
    const ACCUM_TARGET = 64
    const converged = paused && frame.current >= ACCUM_TARGET
    if (!converged) {
      u.uSeed.value = frame.current // decorrelate each accumulated frame's samples
      const pAuto = gl.autoClear; gl.autoClear = false // additive — keep the prior frames in `accum`
      gl.setRenderTarget(accum); gl.render(ptScene, ortho)
      gl.autoClear = pAuto
      frame.current++
    }
    gl.setRenderTarget(null) // hand the framebuffer back to the EffectComposer
    const d = dispMat.uniforms
    d.uN.value = frame.current
    d.uTex.value = accum.texture
    state.gl.getDrawingBufferSize(d.uRes.value)
    d.uTime.value = tAccum.current
    d.uCamPos.value.copy(cam.position)
    d.uViewProj.value.copy(u.uViewProj.value)
    d.uInvViewProj.value.copy(u.uInvViewProj.value)
    if (!converged) invalidate() // keep tracing while spinning / converging; converged + paused → idle (cheap)
  })

  return (
    <>
      {/* the composer-rendered display quad: shows the accumulated/averaged trace and writes the gem's depth
          (re-marched), so the equipped Atmosphere still depth-composites WITH the gem. The trace runs off-screen. */}
      <mesh frustumCulled={false} renderOrder={-10}>
        <planeGeometry args={[2, 2]} />
        <primitive object={dispMat} attach="material" />
      </mesh>
      {controls && (
        <OrbitControls makeDefault enablePan={false} enableZoom autoRotate={autoRotate} autoRotateSpeed={0.6} minDistance={3} maxDistance={9} rotateSpeed={0.9}
          onChange={() => invalidate()} // keep the gem interactive while paused (drag re-renders, resets accumulation)
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      )}
    </>
  )
}
