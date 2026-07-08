// ── Shared GLSL for the from-scratch path tracers (PathTraceGem SDF · MeshPathTraceGem mesh · ExpeditionPathTrace)
// One copy of the optics both tracers depend on, so the two can never drift. All GLSL ES 3.00 (THREE.GLSL3),
// no uint/uvec, const-only globals — safe on the strict ANGLE/win32 path.

// ── Physically-based spectral "fire" ──────────────────────────────────────────────────────────────────────────
// Monte-Carlo spectral dispersion: each sample carries ONE hero wavelength; its RGB weight is the CIE 1931
// colour-matching functions (Wyman-Sloan-Shirley 2013 analytic fits) mapped through a white-balanced XYZ→linear
// sRGB matrix. The weight self-integrates to (1,1,1) across 380–700nm, so a Clear gem is exactly neutral white.
// (The old hand-rolled RGB triangle integrated to (1.066, 0.867, 1.066) — a ~13% green deficit that tinted every
// Clear gem faintly magenta.) spectralWeight(wl) can go NEGATIVE per channel (the sRGB gamut is small), which is
// correct as an integration weight — the display passes clamp the accumulated result to ≥0 before tonemapping.
export const SPECTRAL_GLSL = /* glsl */ `
  float cieG(float l, float mu, float s1, float s2){ float t = (l - mu) * (l < mu ? s1 : s2); return exp(-0.5 * t * t); }
  vec3 cieXYZ(float wl){ // wl in nanometres
    float X = 1.056*cieG(wl,599.8,0.0264,0.0323) + 0.362*cieG(wl,442.0,0.0624,0.0374) - 0.065*cieG(wl,501.1,0.0490,0.0382);
    float Y = 0.821*cieG(wl,568.8,0.0213,0.0247) + 0.286*cieG(wl,530.9,0.0613,0.0322);
    float Z = 1.217*cieG(wl,437.0,0.0845,0.0278) + 0.681*cieG(wl,459.0,0.0385,0.0725);
    return vec3(X, Y, Z);
  }
  // XYZ→linear sRGB (D65). The reference's ROW-major matrix, TRANSPOSED into GLSL's column-major mat3() (which fills
  // COLUMNS): under M*v this recovers the intended rows. Do NOT "un-transpose" — that inverts every colour.
  const mat3 XYZ_TO_RGB = mat3( 8.09817, -3.84142, -1.24599,
                               -3.05248,  5.90964,  0.13074,
                                0.18374, -0.67295,  3.48683);
  // = 1 / mean_wl(XYZ_TO_RGB·cieXYZ) over a uniform 380–700nm hero wavelength → forces E[spectralWeight] = (1,1,1),
  // so the spp/frame average of a flat (Clear) spectrum is exactly white regardless of spp or accumulated frame count.
  const vec3 SPEC_WB = vec3(0.57438, 2.13205, 1.26239);
  // Hero-wavelength → RGB weight. wl in [0,1]; to keep dispersion physical (red bends least) wl=0 is RED (700nm, the
  // low-IOR end) and wl=1 is VIOLET (380nm), so it pairs with iorS = uIor + uAberr*(wl - 0.5) unchanged.
  vec3 spectralWeight(float wl){ return (XYZ_TO_RGB * cieXYZ(mix(700.0, 380.0, wl))) * SPEC_WB; }
`

// ── Dynamic (time-animated) surface materials ─────────────────────────────────────────────────────────────────
// Inject AFTER the fbmN value-noise helper (each tracer declares fbmN + uAnim). uAnim is a free-running wall-clock,
// so these animate LIVE regardless of the gem's spin/pause — they only look right on the every-frame render path.
//   • rippleNormal — perturbs the surface normal by the gradient of a scrolling fbm (kept tangential so it ripples
//                    the surface rather than pushing through it): a flowing WATER / heat-haze skin.
//   • fireEmission — a scrolling upward fbm through a black→red→orange→yellow ramp: a live FIRE surface.
export const DYNAMIC_GLSL = /* glsl */ `
  vec3 rippleNormal(vec3 p, vec3 n, float amt){
    float e = 0.05; vec3 q = p * 3.5 + vec3(0.0, 0.0, uAnim * 0.5);
    float f0 = fbmN(q);
    vec3 g = (vec3(fbmN(q + vec3(e,0.0,0.0)), fbmN(q + vec3(0.0,e,0.0)), fbmN(q + vec3(0.0,0.0,e))) - f0) / e;
    g -= dot(g, n) * n;                       // tangential part only — ripple the surface, don't dent through it
    return normalize(n - g * amt);
  }
  vec3 fireEmission(vec3 p){
    float n = fbmN(p * 3.2 + vec3(0.0, -uAnim * 1.3, uAnim * 0.15)); // scroll upward
    n = pow(clamp(n * 1.7, 0.0, 1.0), 1.4);
    vec3 c = mix(vec3(0.03, 0.0, 0.0), vec3(1.0, 0.16, 0.0), smoothstep(0.08, 0.42, n));
    c = mix(c, vec3(1.0, 0.6, 0.08), smoothstep(0.42, 0.72, n));
    c = mix(c, vec3(1.0, 0.95, 0.7), smoothstep(0.72, 0.96, n));
    return c * n * 3.0;
  }
`

// ── Deterministic diffuse irradiance (for matte finishes) ─────────────────────────────────────────────────────
// A closed-form Lambert shading of the environment: the smooth low-frequency part (hemispherical gradient + broad
// directional glows), with NO sharp specular core. Matte finishes (Chalk, Clay, Pitch, Frosted) use this instead of
// a stochastic diffuse bounce — which at 1 sample/frame reads as pure noise while the gem spins. A convex gem's
// surface mostly sees the open environment, so direct env irradiance is a clean, noise-free approximation. Both
// tracers declare the uBackdrop/uKey/uCool/uWarm/uKeyDir/uKeyTint/uKeyPulse/uAtmoTint/uAtmoAmt uniforms this reads.
export const ENV_DIFFUSE_GLSL = /* glsl */ `
  vec3 envDiffuse(vec3 n){
    float up = clamp(n.y*0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBackdrop*0.5, uBackdrop*1.0, up);                        // hemispherical ambient (sky ↔ ground)
    vec3 kcol = uKey * mix(vec3(1.0), uKeyTint, 0.6) * uKeyPulse;
    col += kcol * 0.55 * max(dot(n, uKeyDir), 0.0);                          // Lambert response to the key glow
    col += uCool * 0.28 * max(dot(n, normalize(vec3(-0.6, 0.25, 0.55))), 0.0);
    col += uWarm * 0.28 * max(dot(n, normalize(vec3(0.3, -0.45, -0.55))), 0.0);
    col += uAtmoTint * uAtmoAmt * (0.3 + 0.4 * up);                          // the equipped atmosphere tints the diffuse fill
    return col;
  }
`

// ── Layered outer-surface BRDF ────────────────────────────────────────────────────────────────────────────────
// The material model at the gem's OUTER surface, evaluated deterministically (no stochastic bounce → no noise; the
// same lobes in the spine and the Monte-Carlo path). Inject AFTER env/envGem/envDiffuse/fresnelFull — it calls them.
// rd = incoming ray dir, n = outward normal, both WORLD-space (the mesh tracer passes R*rd, R*n). It accumulates the
// surface's outgoing radiance into the return value and writes `transmit` = the fraction of energy entering the glass
// interior (0 for an opaque coat). Lobes, in order:
//   • RETRO  (uRetro)     — returns the environment back along -rd. NORMAL-INDEPENDENT → the road-sign / cat's-eye
//                           look: every facet glows the same way toward wherever the ray came from.
//   • METAL  (uMetal)     — a colored mirror (F0 = body colour), no transmission — real metal, not tinted glass.
//   • DIELECTRIC          — Fresnel specular reflection + MATTE Lambert diffuse (uMatte) + glass transmission.
// All reflections are roughness-blurred (sharp mirror → hemispherical) by uSpecRough — brushed/satin looks.
export const COAT_SHADE_GLSL = /* glsl */ `
  vec3 coatShade(vec3 rd, vec3 n, float iorS, out float transmit){
    float ci = clamp(dot(-rd, n), 0.0, 1.0);
    vec3 refl = mix(envGem(reflect(rd, n)), envDiffuse(n), uSpecRough * uSpecRough); // roughness-blurred reflection
    vec3 acc = uRetro * uColor * envGem(-rd);           // retroreflection (returns light toward the source)
    float w = 1.0 - uRetro;
    acc += w * uMetal * uColor * refl;                  // metallic: colored mirror (F0 = body colour), no transmission
    w *= (1.0 - uMetal);
    float F = fresnelFull(ci, 1.0 / iorS);              // dielectric Fresnel
    acc += w * F * uReflMul * refl;                     // dielectric specular reflection
    float wt = w * (1.0 - F);
    acc += wt * uMatte * uColor * envDiffuse(n);        // matte Lambert diffuse
    transmit = wt * (1.0 - uMatte);                     // remaining fraction enters the glass (Chalk/metal/retro → 0)
    return acc;
  }
`

// ── Full dielectric Fresnel (both polarizations) ──────────────────────────────────────────────────────────────
// Replaces Schlick in the stochastic reflect/refract split. eta = n1/n2 (the SAME eta passed to refract()).
// Returns exactly 1.0 at total internal reflection (sinT2 ≥ 1) — bit-identical to GLSL refract() returning 0 — so
// it removes the hard reflect-probability seam Schlick leaves at the critical angle (Schlick stays ≈F0 across the
// whole internal range, then our TIR test snaps to 1.0; true Fresnel ramps ≈F0→1 smoothly over the last few degrees).
// Unbiased: F is a branch probability, not a shading term, so making it physically exact only re-weights the split.
export const FRESNEL_GLSL = /* glsl */ `
  // Single return path (no early return) + a max()-guarded sqrt, so the D3D/ANGLE HLSL backend doesn't flag a
  // "potentially uninitialized" temp and stays off its slow retry path. At TIR (sinT2≥1) cosT→0 makes R→1 anyway;
  // the ternary pins it exactly.
  float fresnelFull(float cosI, float eta){
    cosI = clamp(cosI, 0.0, 1.0);
    float sinT2 = eta * eta * (1.0 - cosI * cosI);
    float cosT = sqrt(max(1.0 - sinT2, 0.0));
    float rs = (eta*cosI - cosT) / (eta*cosI + cosT);
    float rp = (eta*cosT - cosI) / (eta*cosT + cosI);
    float R = 0.5 * (rs*rs + rp*rp);
    return sinT2 >= 1.0 ? 1.0 : clamp(R, 0.0, 1.0); // TIR (sinT2≥1) → 1.0, matching refract()'s k<0
  }
`
