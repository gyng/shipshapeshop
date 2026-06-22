import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Aurora curtains ───────────────────────────────────────────────────────────────────────────────────────
// Polar-light sheets: a tall open-ended CYLINDER (BackSide, large radius) wrapped around the scene. The
// fragment shader paints vertical streaks whose intensity is fbm noise over (horizontal angle, time) so the
// curtains ripple and travel sideways; the colour ramps bottom→top from colorA to colorB, brightest in a mid
// band and fading hard at the top / softly at the bottom, with a gentle flicker. Additive over the dark scene,
// depthWrite off, renderOrder −1 so it sits behind opaque geometry. Fragment-driven (no ray-march), so the
// only quality knob is the fbm octave count — it costs nothing until the cosmetic is equipped and stays cheap.
const AURORA_VERT = /* glsl */ `
  varying float vH;
  varying vec3 vWorld;
  void main() {
    vH = uv.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
// uOct is consumed by a bounded loop (constant 6 cap + `if(i>=uOct) break;`).
const AURORA_FRAG = /* glsl */ `
  varying float vH;
  varying vec3 vWorld;
  uniform vec3 uColA, uColB;
  uniform float uTime, uIntensity, uSpeed;
  uniform int uOct;

  float hash(vec2 p){ p = fract(p * vec2(0.3183099, 0.3678794)); p += dot(p, p + 27.13); return fract(p.x * p.y); }
  float vnoise(vec2 x){
    vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p){
    float a = 0.5, s = 0.0;
    for(int i = 0; i < 6; i++){
      if(i >= uOct) break;
      s += a * vnoise(p); p = p * 2.02 + 7.3; a *= 0.5;
    }
    return s;
  }

  void main(){
    // Horizontal coordinate from WORLD angle (NOT vUv.x): the cylinder's UV wraps 0→1 with a hard seam at the
    // join, so fbm over vUv.x would show a visible vertical crack. Sampling noise on the unit circle (cos/sin
    // of the angle) is inherently periodic → seamless all the way round. vH runs bottom(0)→top(1).
    float ang = atan(vWorld.z, vWorld.x);   // -PI..PI (the seam is hidden because we feed cos/sin below)
    float hgt = clamp(vH, 0.0, 1.0);
    float t = uTime * max(uSpeed, 0.0);

    // Sideways travel: rotate the sampling angle over time so the curtains drift around the ring.
    float travel = t * 0.18;
    float aw = ang + travel;

    // Low-freq wobble so the sheets wave up the height rather than sitting as straight bars.
    vec2 cw = vec2(cos(ang * 6.0 - travel * 0.6), sin(ang * 6.0 - travel * 0.6));
    float wob = (fbm(cw * 2.4 + vec2(0.0, hgt * 1.4 + t * 0.05)) - 0.5) * 0.6;

    // Two seam-free streak scales (sampled on the circle) beat together for the layered-sheet look.
    float a1 = aw * 22.0 + wob;
    float a2 = aw * 41.0 - wob;
    float streakA = fbm(vec2(cos(a1), sin(a1)) * 3.0 + vec2(0.0, hgt * 2.0 + t * 0.07));
    float streakB = fbm(vec2(cos(a2), sin(a2)) * 3.0 + vec2(0.0, hgt * 3.5 - t * 0.04));
    float streak = streakA * 0.65 + streakB * 0.35;
    // Sharpen into discrete curtain sheets (bright cores, dark gaps).
    streak = smoothstep(0.42, 0.86, streak);

    // Brightest in a mid band; hard fade at the very top, softer fade toward the bottom.
    float midBand = exp(-pow((hgt - 0.52) / 0.34, 2.0));
    float topFade = 1.0 - smoothstep(0.82, 1.0, hgt);    // hard cutoff up top
    float botFade = smoothstep(0.0, 0.28, hgt);          // soft rise off the floor
    float band = midBand * topFade * botFade;

    // Gentle overall flicker (varies by angle + time; never Math.random in the render path).
    vec2 cf = vec2(cos(ang * 3.0), sin(ang * 3.0));
    float flicker = 0.82 + 0.18 * fbm(cf * 1.5 + vec2(t * 0.6, 0.0));

    float glow = max(streak * band * flicker, 0.0);
    if(glow < 0.002) discard;

    // Colour ramps bottom→top A→B, with a touch of the upper colour pushed into the streak peaks.
    vec3 col = mix(uColA, uColB, clamp(hgt * 1.1 - 0.05, 0.0, 1.0));
    col = mix(col, uColB, streak * 0.25);

    gl_FragColor = vec4(col * glow * max(uIntensity, 0.0), 1.0);
  }
`

const AURORA_RADIUS = 18
const AURORA_HEIGHT = 24

export interface AuroraOptions {
  colorA: string
  colorB: string
  intensity: number
  speed: number
}

export function Aurora({
  options,
  radius = AURORA_RADIUS,
  height = AURORA_HEIGHT,
  position = [0, 0, 0],
}: {
  options: AuroraOptions
  radius?: number
  height?: number
  position?: [number, number, number]
}) {
  const g = useGfxPreset()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  // fbm octaves scale with quality: ~3 (low) → ~4 (med) → ~6 (high) from the preset raySteps (48/80/112).
  const oct = Math.max(2, Math.min(6, Math.round(g.raySteps / 18)))
  // Stable uniforms object, created ONCE (empty deps). Re-creating it when options change would not reliably
  // swap the live material's uniforms in r3f; instead we mutate the existing uniform .value below each render.
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
      uIntensity: { value: 1 },
      uSpeed: { value: 1 },
      uOct: { value: 4 },
    }),
    [],
  )
  // Keep colour/scalar uniforms in sync with props on render (cheap, allocation-free — not in useFrame).
  uniforms.uColA.value.set(options.colorA).convertSRGBToLinear()
  uniforms.uColB.value.set(options.colorB).convertSRGBToLinear()
  uniforms.uIntensity.value = options.intensity
  uniforms.uSpeed.value = options.speed
  uniforms.uOct.value = oct

  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
  })
  return (
    <mesh renderOrder={-1} frustumCulled={false} position={position}>
      {/* open-ended cylinder (last arg true) → no caps, BackSide so we see the inner wall from the scene */}
      <cylinderGeometry args={[radius, radius, height, 96, 1, true]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={AURORA_VERT}
        fragmentShader={AURORA_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
