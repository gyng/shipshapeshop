import { useMemo } from 'react'
import { Effect, BlendFunction } from 'postprocessing'
import * as THREE from 'three'

// ── Heat shimmer / mirage (screen-space refraction) ──────────────────────────────────────────────────────────
// A subtle screen-space heat-haze that wobbles the rendered image, stronger toward the bottom of the screen
// (like rising heat). Implemented as a postprocessing custom Effect: a `void mainUv(inout vec2 uv)` shader that
// offsets the sample uv by animated low-frequency value-noise. Time advances in update() by accumulating dt
// (wrapped to a bounded period so the float never grows large enough to lose precision on a long session), so
// it never touches Date.now()/Math.random() in the render path. Costs nothing unless the cosmetic is equipped
// (the parent only mounts it inside <EffectComposer> when chosen) and the noise is cheap (a few fbm octaves on
// the uv plane — no extra render targets, no per-frame JS↔GPU churn beyond two scalar uniforms).
//
// intensity: peak uv offset in screen-space units (~0.002..0.01 — keep it subtle).
// speed:     animation rate multiplier.

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSpeed;

  // value-noise / fbm on the 2D uv plane (same hash/vnoise/fbm idiom as the volumetric reference)
  float hash(vec2 p){ p = fract(p * vec2(0.3183099, 0.3678794) + 0.1); p *= 17.0; return fract(p.x * p.y * (p.x + p.y)); }
  float vnoise(vec2 x){
    vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p){
    float a = 0.5, s = 0.0;
    for(int i = 0; i < 8; i++){
      if(i >= 3) break;       // bounded loop: constant cap + early break (3 octaves)
      s += a * vnoise(p); p *= 2.03; a *= 0.5;
    }
    return s;
  }

  void mainUv(inout vec2 uv){
    float t = uTime * uSpeed;
    // low-frequency horizontal wobble that rises upward over time (heat climbing the screen)
    vec2 q = vec2(uv.x * 8.0, uv.y * 14.0 - t * 1.7);
    float nx = fbm(q) - 0.5;
    float ny = fbm(q + vec2(31.7, 11.3)) - 0.5;

    // stronger toward the bottom of the screen, fading out near the top (uv.y == 0 is bottom in screen space)
    float rise = clamp(1.0 - uv.y, 0.0, 1.0);
    rise = rise * rise; // bias the shimmer to the lower portion

    vec2 offset = vec2(nx, ny * 0.4) * uIntensity * rise;
    uv = clamp(uv + offset, 0.0, 1.0); // guard against sampling outside the buffer (no NaN, in-range)
  }
`

export interface HeatShimmerOptions {
  intensity: number
  speed: number
}

// Wrap uTime to a bounded period so the accumulated float stays small over a long session — a large value fed
// into the noise hash/coords loses precision and the shimmer would visibly freeze or stutter. The chosen period
// is large relative to the noise frequencies so the wrap is seamless.
const TIME_WRAP = 3600.0

export class HeatShimmerEffect extends Effect {
  constructor({ intensity = 0.006, speed = 1.0 }: Partial<HeatShimmerOptions> = {}) {
    super('HeatShimmerEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uIntensity', new THREE.Uniform(intensity)],
        ['uSpeed', new THREE.Uniform(speed)],
      ]),
    })
  }

  // postprocessing calls this every frame with the frame delta (seconds); accumulate it into uTime so the
  // shimmer animates without any wall-clock / Math.random in the render path. deltaTime is optional in the base
  // signature, so default it; wrap to keep the float small for shader precision.
  override update(_renderer: THREE.WebGLRenderer, _inputBuffer: THREE.WebGLRenderTarget, deltaTime = 0): void {
    const u = this.uniforms.get('uTime')
    if (u) u.value = (u.value + deltaTime) % TIME_WRAP
  }
}

export function HeatShimmer({ intensity = 0.006, speed = 1.0 }: Partial<HeatShimmerOptions> = {}) {
  const effect = useMemo(() => new HeatShimmerEffect({ intensity, speed }), [intensity, speed])
  return <primitive object={effect} dispose={null} />
}
