import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Smoke plume (localized rising column) ─────────────────────────────────────────────────────────────────────
// A bounded volumetric ray-march inside a small vertical box centred at `pos` (radius wide, height tall). The
// camera ray is clipped to that box (slab method), then marched through animated fbm whose sampling point drifts
// DOWNWARD over time (`vec3(0, -uTime*speed, 0)`) so the visible noise rises. Density is concentrated near the
// base and along the central axis (radial + vertical falloff) and thins/widens as it climbs — a soft rising
// plume of smoke/steam. Additive over the dark scene, depth-tested so opaque geometry occludes it. Step count
// scales with the gfx quality, so it costs nothing until equipped and stays cheap on low-end.
const PLUME_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const PLUME_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCam, uColor, uPos, uHalf;
  uniform float uTime, uDensity, uSpeed, uScale;
  uniform int uSteps;

  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0.,0.,0.)), hash(i + vec3(1.,0.,0.)), f.x),
                   mix(hash(i + vec3(0.,1.,0.)), hash(i + vec3(1.,1.,0.)), f.x), f.y),
               mix(mix(hash(i + vec3(0.,0.,1.)), hash(i + vec3(1.,0.,1.)), f.x),
                   mix(hash(i + vec3(0.,1.,1.)), hash(i + vec3(1.,1.,1.)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

  void main(){
    vec3 rd = normalize(vWorld - uCam);
    // ray vs the axis-aligned plume box (centre uPos, half-extents uHalf) via the slab method → [t0, t1].
    // Guarded reciprocal of rd: any near-zero component is nudged off zero so 1/rd stays finite (no NaN/Inf).
    vec3 sgn = vec3(rd.x < 0.0 ? -1.0 : 1.0, rd.y < 0.0 ? -1.0 : 1.0, rd.z < 0.0 ? -1.0 : 1.0);
    vec3 inv = sgn / max(abs(rd), vec3(1e-5));
    vec3 lo = (uPos - uHalf - uCam) * inv;
    vec3 hi = (uPos + uHalf - uCam) * inv;
    vec3 tmin = min(lo, hi);
    vec3 tmax = max(lo, hi);
    float t0 = max(max(tmin.x, tmin.y), tmin.z);
    float t1 = min(min(tmax.x, tmax.y), tmax.z);
    t0 = max(t0, 0.0);
    float seg = t1 - t0;
    if(seg <= 0.0) discard; // ray misses the box (or it's entirely behind the camera)

    float dt = seg / float(uSteps);
    float jit = hash(rd * 811.0 + fract(uTime)) * dt; // step-banding dither keyed to the WORLD ray dir → continuous across cubemap faces (no seam)
    vec3 drift = vec3(0.0, -uTime * uSpeed, 0.0);        // noise origin sinks → smoke appears to rise
    float invH = 1.0 / max(uHalf.y * 2.0, 1e-3);
    float invR = 1.0 / max(uHalf.x, 1e-3);

    vec3 col = vec3(0.0);
    float trans = 1.0;
    for(int i = 0; i < 96; i++){
      if(i >= uSteps) break;
      float t = t0 + (float(i) + 0.5) * dt + jit;
      vec3 pos = uCam + rd * t;
      vec3 rel = pos - uPos;

      // height in 0..1 from the base of the column
      float hy = clamp((rel.y + uHalf.y) * invH, 0.0, 1.0);
      // the column widens slightly as it rises; radius shrinks the effective falloff
      float widen = mix(0.55, 1.0, hy);
      float rad = length(rel.xz) * invR / widen;

      // radial falloff (soft toward the centre axis) × vertical falloff (dense at base, thinning upward)
      float radial = 1.0 - smoothstep(0.35, 1.0, rad);
      float vert = (1.0 - smoothstep(0.15, 1.0, hy)) * smoothstep(0.0, 0.12, hy); // fade in just above the base
      float shape = radial * vert;
      if(shape <= 0.001) continue;

      vec3 q = pos * uScale + drift;
      float n = fbm(q);
      n = smoothstep(0.35, 0.95, n);
      float d = n * shape * uDensity;
      if(d > 0.001){
        float aStep = d * dt * 2.2;
        // warmer/brighter toward the base, cooler/dimmer as it dissipates
        vec3 cc = uColor * mix(1.2, 0.6, hy);
        col += trans * cc * aStep;
        trans *= exp(-aStep);
      }
      if(trans < 0.02) break;
    }
    if(trans > 0.998) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`

export interface SmokePlumeOptions {
  color: string
  density: number
  speed: number
  height?: number
  radius?: number
  pos?: [number, number, number]
}

export function SmokePlume({ color, density, speed, height = 4, radius = 0.7, pos = [0, 0, 0] }: SmokePlumeOptions) {
  const g = useGfxPreset()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const steps = Math.max(10, Math.round(g.raySteps * 0.5)) // ~24 (low) → ~56 (high), capped at 96 in GLSL

  // The box geometry is a unit cube scaled to the plume's footprint; the shader clips the ray to the same AABB.
  const half = useMemo<[number, number, number]>(() => [radius, height * 0.5, radius], [radius, height])
  const center = useMemo<[number, number, number]>(() => [pos[0], pos[1] + height * 0.5, pos[2]], [pos, height])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
      uPos: { value: new THREE.Vector3(center[0], center[1], center[2]) },
      uHalf: { value: new THREE.Vector3(half[0], half[1], half[2]) },
      uDensity: { value: density },
      uSpeed: { value: speed },
      uScale: { value: 1.1 },
      uSteps: { value: steps },
    }),
    [color, center, half, density, speed, steps],
  )

  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    m.uniforms.uCam.value.copy(state.camera.position)
  })

  return (
    <mesh position={center} frustumCulled={false}>
      {/* a touch of padding so the box surface never clips inside the visible plume */}
      <boxGeometry args={[half[0] * 2 + 0.1, half[1] * 2 + 0.1, half[2] * 2 + 0.1]} />
      <shaderMaterial ref={matRef} vertexShader={PLUME_VERT} fragmentShader={PLUME_FRAG} uniforms={uniforms} transparent depthWrite={false} depthTest blending={THREE.AdditiveBlending} side={THREE.BackSide} />
    </mesh>
  )
}
