// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parser } from '@shaderfrog/glsl-parser'
import { sdfActiveGLSL, SDF_FAMILIES, hasGemHull, gemHullGLSL } from './sdfShapes.glsl'
import { SPECTRAL_GLSL, FRESNEL_GLSL, ENV_DIFFUSE_GLSL, COAT_SHADE_GLSL, DYNAMIC_GLSL } from './ptShared.glsl'
import { PT_PRESETS } from '../gfx'

// GLSL validation gate. `tsc` / `vite build` only catch JS-level breakage (e.g. a backtick closing the shader
// template literal — which has bitten us twice). A genuine GLSL *syntax* error in a hand-authored SDF shape (a
// missing `;`, a malformed declaration) slips through and only fails at GPU shader-compile time in the browser.
// Here we assemble + parse EACH shape's per-shape shader (exactly as RaymarchGem/PathTraceGem inject it), so any
// such error fails CI. (Full semantic/limit validation needs a GPU; this catches the common authoring mistakes.)
function frag(family: string): string {
  return `precision highp float;
${sdfActiveGLSL(family)}
void main(){ gl_FragColor = vec4(vec3(sdfActive(vec3(gl_FragCoord.xy * 0.01, 0.1))), 1.0); }`
}

describe('GLSL validation', () => {
  it.each(SDF_FAMILIES)('%s — per-shape SDF shader is syntactically valid GLSL', (family) => {
    expect(() => parser.parse(frag(family), { quiet: true })).not.toThrow()
  })

  // The shared PT optics (CIE spectral weight + full dielectric Fresnel) is injected verbatim into all three
  // path-trace shader templates, so parse it once here — a typo in the shared string would otherwise only surface
  // as a GPU shader-compile failure (a black gem) in the browser.
  it('shared PT optics (ptShared: spectral + Fresnel) is syntactically valid GLSL', () => {
    const src = `precision highp float;
uniform vec3 uBackdrop, uKey, uCool, uWarm, uKeyDir, uKeyTint, uAtmoTint, uColor; uniform float uKeyPulse, uAtmoAmt, uReflMul, uMetal, uRetro, uSpecRough, uEnvCubeAmt;
uniform samplerCube uEnvCube; uniform float uAnim;
vec3 envGem(vec3 d){ return uBackdrop + texture(uEnvCube, d).rgb * uEnvCubeAmt; }
float nhash(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float fbmN(vec3 p){ return nhash(p); }
${SPECTRAL_GLSL}
${FRESNEL_GLSL}
${ENV_DIFFUSE_GLSL}
${COAT_SHADE_GLSL}
${DYNAMIC_GLSL}
void main(){ float tr; vec3 c = coatShade(vec3(0.0,0.0,-1.0), vec3(0.0,1.0,0.0), 1.5, tr); vec3 n = rippleNormal(vec3(0.0), vec3(0.0,1.0,0.0), 0.3) + fireEmission(vec3(0.0)); gl_FragColor = vec4(spectralWeight(0.5) * fresnelFull(0.7, 1.5) + envDiffuse(vec3(0.0, 1.0, 0.0)) + c + n, tr); }`
    expect(() => parser.parse(src, { quiet: true })).not.toThrow()
  })

  // Analytic convex-hull intersectors (the SDF tracer's exact fast path for the sharp platonics) — parse each hull
  // family's injected GLSL (wrapped with the tracer's `mat3 R` global it references) so a bad axis literal fails CI.
  it.each(SDF_FAMILIES.filter(hasGemHull))('%s — analytic gem-hull GLSL is syntactically valid', (family) => {
    const src = `precision highp float;
mat3 R;
${gemHullGLSL(family)}
void main(){ vec3 n; float t = intersectGem(vec3(0.0,0.0,3.0), vec3(0.0,0.0,-1.0), 1.0, n); gl_FragColor = vec4(n, t); }`
    expect(() => parser.parse(src, { quiet: true })).not.toThrow()
  })

  // The tracer re-traces EVERY frame (auto-spin resets accumulation), so spp × bounces × march-steps SDF evals
  // per pixel must stay bounded — or the GPU hangs. The known freeze was 80·32·256 ≈ 655k evals/pixel; the cap
  // here (150k, ~23% of that) is the agreed quality/safety ceiling — premium but still well clear of the wall.
  const PT_EVAL_BUDGET = 150_000
  it('every path-trace preset stays within the per-frame cost budget', () => {
    for (const [name, p] of Object.entries(PT_PRESETS)) {
      const evalsPerPixel = p.spp * p.bounces * p.steps
      expect(evalsPerPixel, `${name}: ${evalsPerPixel} SDF evals/pixel/frame is too high`).toBeLessThanOrEqual(PT_EVAL_BUDGET)
      // the unrolled GLSL-ES-1.00 path loop (bounces × steps) must also stay well under the program-size wall
      // that the 32·256 = 8192 freeze hit — keep it modest so the shader always compiles.
      expect(p.bounces * p.steps, `${name}: ${p.bounces * p.steps} unrolled path iterations is too high`).toBeLessThanOrEqual(4000)
    }
  })
})
