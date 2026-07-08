import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { sdfActiveGLSL, gemHullGLSL, hasGemHull } from './sdfShapes.glsl'
import { SPECTRAL_GLSL, FRESNEL_GLSL, ENV_DIFFUSE_GLSL, COAT_SHADE_GLSL, DYNAMIC_GLSL } from './ptShared.glsl'
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

const makePT = (BOUNCES: number, STEPS: number, SPP: number, sdfGLSL: string, hullGLSL: string, analytic: boolean) => /* glsl */ `
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
  uniform float uMetal;        // 0 = dielectric glass; 1 = colored metal mirror (F0 = body colour, no transmission)
  uniform float uRetro;        // 0 = normal; >0 = retroreflective (returns light back toward its source)
  uniform float uSpecRough;    // specular-reflection blur (0 = mirror-sharp; higher = brushed/satin)
  uniform float uRipple;       // DYNAMIC: >0 = animated water/heat-haze surface (ripples the normal)
  uniform float uFire;         // DYNAMIC: >0 = animated fire emission on the surface
  uniform float uAnim;         // free-running animation clock (always advances → dynamic materials flow live)
  uniform int   uMotes;    // # of emissive ambient motes to trace (0 when the gfx Particles setting is off)
  uniform float uHaze;     // volumetric single-scatter haze density (0 = off)
  uniform float uSpine;    // >0.5 = deterministic single-path spine (clean while spinning); 0 = Monte-Carlo (the frozen still)

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

${SPECTRAL_GLSL}
${FRESNEL_GLSL}
${ENV_DIFFUSE_GLSL}

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
${COAT_SHADE_GLSL}

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
${hullGLSL}
  // Unified surface hit → (distance, OUTWARD normal). Analytic-hull families intersect in closed form (exact facets,
  // no march); everyone else sphere-traces the SDF then takes the 4-tap gradient normal. Identical result for the
  // marched path, so the ~35 non-hull shapes are byte-for-byte unchanged.
  ${analytic
    ? `float hitGem(vec3 ro, vec3 rd, float sgn, out vec3 nOut){ return intersectGem(ro, rd, sgn, nOut); }`
    : `float hitGem(vec3 ro, vec3 rd, float sgn, out vec3 nOut){ float t = march(ro, rd, sgn); if(t < 0.0){ nOut = vec3(0.0); return -1.0; } nOut = nrm(ro + rd*t); return t; }`}

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
${DYNAMIC_GLSL}

  void main(){
    R = rotY(uTime * 0.15);                              // gem auto-spins in place (world); the CAMERA orbits it (uCamPos)
    vec3 cam = uCamPos;
    // env (cosmos) is sampled with the WORLD ray, so the background pans as you orbit — like the mesh hero.
    vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
    vec4 fw = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 rdC = normalize(fw.xyz/fw.w - cam);             // non-jittered primary ray (for the once/pixel haze march)
    gSeed = 0.0;
    vec3 sum = vec3(0.0);
    float tAccum = 0.0;                                   // sum of per-sample primary gem depths → averaged for the haze tEnd
    float farMiss = length(cam) + 3.0;                    // haze depth on a gem MISS — scales with the orbit distance (3..9)
    for(int s=0;s<${SPP};s++){                           // samples this frame
      vec2 j = (vec2(rnd(), rnd())-0.5) / uRes * 2.0;    // sub-pixel jitter in NDC (intra-frame MSAA)
      vec4 fj = uInvViewProj * vec4(ndc + j, 1.0, 1.0); fj /= fj.w;
      vec3 ro = cam;
      vec3 rd = normalize(fj.xyz - cam);
      // hero-wavelength dispersion: ONE wavelength per sample (Monte-Carlo spectral) → true dispersion at zero extra
      // ray cost. STRATIFIED across the spp loop (one jittered sample per 1/spp bin) so the spectrum is evenly covered
      // instead of clumping — kills the chromatic blotch a random wavelength leaves while spinning. Physically-based
      // CIE weight (ptShared) makes the fire the real prism sequence AND integrates to pure white (no magenta cast).
      float wl = fract((float(s) + rnd()) / float(${SPP}));
      float iorS = uIor + uAberr * (wl - 0.5);
      vec3 spec = spectralWeight(wl);
      vec3 thru = vec3(1.0), rad = vec3(0.0);
      bool inside = false;
      // ── DETERMINISTIC internal-reflection spine (uSpine) — a clean image in ONE frame: no reflect/refract RNG, so
      // the SPINNING gem shows crisp dispersion instead of Monte-Carlo grain. Refract in, then follow the internal
      // reflection path, banking the transmitted-out env at each exit (energy-splitting, TIR-guarded). This is the
      // exact expectation of the stochastic transport for a convex gem; FREEZE drops to the MC accumulate (uSpine=0)
      // for the definitive still. Matte/volumetric finishes force uSpine=0 (they need the stochastic path). ──
      if(uSpine > 0.5){
        vec3 n0h; float t0 = hitGem(ro, rd, 1.0, n0h);
        rad += moteGlow(ro, rd, (t0 < 0.0) ? 1e9 : t0);      // primary-segment motes (through-glass catch dropped in preview)
        if(t0 < 0.0){
          vec3 erd = rd;
          if(uLensing > 0.0){ vec3 perp = -ro - rd*dot(-ro, rd); float bp = length(perp); erd = normalize(rd + normalize(perp + 1e-5) * (uLensing * 0.5 / (bp*bp + 0.35))); }
          rad += env(erd);
        } else {
          vec3 p0 = ro + rd*t0; vec3 n0 = n0h; if(dot(rd, n0) > 0.0) n0 = -n0;
          if(uRipple > 0.0) n0 = rippleNormal(p0, n0, uRipple); // water: shimmer the surface normal (live)
          rad += uFire * fireEmission(p0);                     // fire: live flame emission on the surface
          float tr; rad += coatShade(rd, n0, iorS, tr);      // layered outer BRDF: retro / metal / rough-spec / matte
          vec3 dir = refract(rd, n0, 1.0/iorS);
          vec3 p = p0 + dir*0.003; vec3 thruS = vec3(tr);    // transmitted fraction enters the glass (opaque coat → 0)
          for(int b=0;b<${BOUNCES};b++){
            vec3 nnh; float te = hitGem(p, dir, -1.0, nnh); if(te < 0.0) break;
            vec3 hp = p + dir*te; vec3 nn = nnh; if(dot(dir, nn) > 0.0) nn = -nn;
            thruS *= exp(-(vec3(1.0)-uColor) * min(te,1.4) * 1.1 * uAbsorbMul);   // Beer–Lambert
            rad += thruS * uColor * (min(te,0.9)*min(te,0.9)) * 0.12;             // internal-focus caustic
            rad += thruS * uColor * uEmissive * min(te,0.9) * 1.6;               // participating emission
            float ci = clamp(dot(-dir, nn), 0.0, 1.0);
            vec3 refr = refract(dir, nn, iorS);
            bool tirI = dot(refr,refr) < 1e-5;
            float Fi = tirI ? 1.0 : fresnelFull(ci, iorS);
            if(!tirI) rad += thruS * (1.0 - Fi) * envGem(refr);                   // transmitted light escapes to env
            thruS *= Fi * uReflMul;                                              // TIR: Fi=1 → thruS unchanged; else keep the reflected fraction
            if(max(thruS.r, max(thruS.g, thruS.b)) < 0.02) break;
            dir = reflect(dir, nn); p = hp + dir*0.003;
          }
        }
        sum += max(rad, 0.0) * spec;
        continue;
      }
      for(int b=0;b<${BOUNCES};b++){
        vec3 nHit; float t = hitGem(ro, rd, inside ? -1.0 : 1.0, nHit);
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
        vec3 n = nHit; if(inside) n = -n;                // OUTWARD normal from hitGem, faced toward the incoming ray
        // VOLUMETRIC cloud interior — on ENTERING the gem, ray-march fbm density instead of clear glass: a soft,
        // self-shadowed cloud/smoke/nebula filling the shape (lit by the equipped Lighting key). Consumes the ray.
        if(uVolume > 0.0 && !inside){
          vec3 vp = p + rd*0.02; vec3 acc = vec3(0.0); float vtr = 1.0;
          for(int k=0;k<28;k++){
            if(map(vp) > 0.01) break;                    // marched out of the gem volume
            float rho = clamp(fbmN(vp*3.4 + uAnim*0.10) * uVolume * 1.7 - 0.15, 0.0, 1.0);
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
          // PARTICIPATING (volume) EMISSION — an emissive finish glows from WITHIN, and that glow refracts/bends out
          // through the glass, dimming correctly through each interface (× thru). Path-length weighted. uEmissive 0 = no-op.
          rad += thru * uColor * uEmissive * min(t, 0.9) * 1.6;
          // INTERIOR surface — stochastic Fresnel reflect/refract (the real multi-bounce glass transport + TIR).
          float ci = clamp(dot(-rd, n), 0.0, 1.0);
          vec3 refr = refract(rd, n, iorS);
          bool tir = dot(refr,refr) < 1e-5;
          float F = tir ? 1.0 : fresnelFull(ci, iorS);
          if(tir || rnd() < F){ rd = reflect(rd, n); thru *= uReflMul; }     // TIR / internal specular
          else { rd = refr; inside = false; }                               // refract OUT of the glass
          ro = p + rd*0.003;
        } else {
          if(uRipple > 0.0) n = rippleNormal(p, n, uRipple);   // water: shimmer the surface normal (live)
          rad += thru * uFire * fireEmission(p);               // fire: live flame emission on the surface
          // OUTER surface — the DETERMINISTIC layered coating BRDF (retro / metal / roughness-blurred dielectric
          // specular / matte Lambert), then the transmitted fraction refracts into the glass. No stochastic outer
          // bounce → far less surface noise, and it's identical to the spine's entry so the two paths match.
          float tr; rad += thru * coatShade(rd, n, iorS, tr);
          thru *= tr;
          if(max(thru.r, max(thru.g, thru.b)) < 0.02) break;                // opaque coat (Chalk / metal / retro) → done
          rd = refract(rd, n, 1.0/iorS); inside = true;                     // the transmitted fraction enters the glass
          ro = p + rd*0.003;
        }
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
    fragColor = vec4(max(texture(uTex, uv).rgb / max(uN, 1.0), 0.0), 1.0); // converged average → composer Bloom + ACES (clamp ≥0: CMF spectral weights go negative for out-of-gamut wavelengths, so a near-monochromatic glint can sum slightly negative)
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
  const ptTransport = useGfx((s) => s.ptTransport) // 'deterministic' (clean/live spine, default) vs 'montecarlo' (converged still)
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
  const frag = useMemo(() => makePT(ptp.bounces, ptp.steps, ptp.spp, sdfActiveGLSL(family), gemHullGLSL(family), hasGemHull(family)), [ptp.bounces, ptp.steps, ptp.spp, family])
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
        uMetal: { value: 0 }, uRetro: { value: 0 }, uSpecRough: { value: 0 }, // BRDF: metallic mirror / retroreflective / specular blur
        uRipple: { value: 0 }, uFire: { value: 0 }, uAnim: { value: 0 }, // dynamic materials: water ripple / fire / animation clock
        uMotes: { value: 16 }, uHaze: { value: 0 }, uMoteTime: { value: 0 }, uSpine: { value: 0 },
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
    // Transport routing. The spine renders any finish EXCEPT the volumetric cloud (which needs the stochastic
    // interior march). A DYNAMIC finish (water ripple / fire / volume) is time-animated, so it must render every
    // frame — it forces the LIVE path even in Monte-Carlo mode (a moving material can't converge anyway).
    const spineFinish = fin.volumetric === 0
    const dynamicFinish = fin.volumetric > 0 || fin.ripple > 0 || fin.fire > 0
    const live = ptTransport === 'deterministic' || dynamicFinish // render fresh every frame (no accumulation)
    // Clocks. The gem SPIN (tAccum) always freezes when paused. The mote/light clock (moteAccum) + the animation
    // clock keep advancing in LIVE mode even when paused — so dust motes, moving lights, water, fire and flowing
    // volumes all animate over a still gem. In MONTE-CARLO mode the spin/mote clocks freeze so the still converges.
    if (live || !paused) moteAccum.current += dt
    if (!paused) tAccum.current += dt
    u.uTime.value = tAccum.current
    u.uMoteTime.value = moteAccum.current
    u.uAnim.value = state.clock.elapsedTime // free-running → dynamic materials flow live regardless of spin/pause
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
    u.uMetal.value = fin.metallic; u.uRetro.value = fin.retro; u.uSpecRough.value = fin.specRough
    u.uRipple.value = fin.ripple; u.uFire.value = fin.fire
    u.uSpine.value = (live ? spineFinish : (!paused && spineFinish)) ? 1 : 0 // live → spine unless volumetric; MC → spine only while spinning
    u.uKeyPulse.value = lightingKey(L, moteAccum.current, u.uKeyDir.value, u.uKeyTint.value)

    let uN: number
    let keepRendering: boolean
    if (live) {
      // LIVE: render FRESH every frame (clear → one pass), no accumulation and no freeze — so motes, moving lights,
      // water, fire and flowing volumes all stay live over a still or spinning gem. Non-volumetric finishes use the
      // clean spine (uSpine=1); the volumetric cloud uses the stochastic MC loop (uSpine=0) but is still rendered
      // every frame so it flows. `uSeed` cycles so successive frames temporally-AA the moving detail.
      frame.current = (frame.current + 1) & 4095
      u.uSeed.value = frame.current
      const pc = gl.getClearColor(new THREE.Color()).getHex(); const pa = gl.getClearAlpha()
      const pAuto = gl.autoClear; gl.autoClear = false
      gl.setRenderTarget(accum); gl.setClearColor(0x000000, 0); gl.clear(true, false, false)
      gl.render(ptScene, ortho)
      gl.autoClear = pAuto; gl.setClearColor(pc, pa)
      lastKey.current = '' // so a later switch to Monte-Carlo re-inits the accumulation cleanly
      uN = 1
      // Keep rendering (live motes/lights) only for the INTERACTIVE inspector or a spinning view. A still COMPACT
      // preview (gallery thumbnail) renders one clean spine frame then idles — otherwise a gallery of thumbnails
      // would each path-trace every frame. (The spine is deterministic, so one frame is already the full image.)
      keepRendering = controls || autoRotate || dynamicFinish // dynamic materials keep rendering so they animate
    } else {
      // MONTE-CARLO: accumulate a stochastic still. While spinning the spine (uSpine=1) gives clean frames; on Freeze
      // it converges the real multi-bounce still over ~64 frames, then idles. Reset the accumulation whenever any
      // trace input changes (camera, the frozen spin/mote clocks, a live-graded finish/atmosphere uniform).
      const key = `${family}|${tAccum.current.toFixed(4)}|${moteAccum.current.toFixed(4)}|${cam.position.x.toFixed(3)},${cam.position.y.toFixed(3)},${cam.position.z.toFixed(3)}|${(u.uIor.value as number).toFixed(3)}|${u.uEmissive.value}|${u.uAbsorbMul.value}|${atmo.id}|${u.uAtmoAmt.value}|${u.uEnvCubeAmt.value}|${(u.uAberr.value as number).toFixed(3)}|${(u.uReflMul.value as number).toFixed(2)}|${u.uMatte.value}|${u.uLensing.value}|${u.uVolume.value}|${u.uMetal.value}|${u.uRetro.value}|${(u.uSpecRough.value as number).toFixed(2)}|${(u.uHaze.value as number).toFixed(3)}|${u.uMotes.value}|${u.uSpine.value}`
      if (key !== lastKey.current) {
        lastKey.current = key
        frame.current = 0
        const pc = gl.getClearColor(new THREE.Color()).getHex(); const pa = gl.getClearAlpha()
        gl.setRenderTarget(accum); gl.setClearColor(0x000000, 0); gl.clear(true, false, false); gl.setClearColor(pc, pa)
      }
      const ACCUM_TARGET = 64
      const converged = paused && frame.current >= ACCUM_TARGET
      // Seed the frozen still's FIRST frame with the clean deterministic spine, so hitting Freeze doesn't flash a
      // single noisy Monte-Carlo sample before it converges (the spine ≈ the MC expectation for a convex gem, so as
      // the 64 MC frames pile on it decays to a ~1.5% weight — enough to hide the flash, not bias the still).
      if (paused && spineFinish && frame.current === 0) u.uSpine.value = 1
      if (!converged) {
        u.uSeed.value = frame.current // decorrelate each accumulated frame's samples
        const pAuto = gl.autoClear; gl.autoClear = false // additive — keep the prior frames in `accum`
        gl.setRenderTarget(accum); gl.render(ptScene, ortho)
        gl.autoClear = pAuto
        frame.current++
      }
      uN = frame.current
      keepRendering = !converged
    }
    gl.setRenderTarget(null) // hand the framebuffer back to the EffectComposer
    const d = dispMat.uniforms
    d.uN.value = uN
    d.uTex.value = accum.texture
    state.gl.getDrawingBufferSize(d.uRes.value)
    d.uTime.value = tAccum.current
    d.uCamPos.value.copy(cam.position)
    d.uViewProj.value.copy(u.uViewProj.value)
    d.uInvViewProj.value.copy(u.uInvViewProj.value)
    if (keepRendering) invalidate() // deterministic → always (live motes); MC → while spinning/converging, then idle
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
