import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Ground / height fog ───────────────────────────────────────────────────────────────────────────────────
// Low-lying volumetric mist that pools on the floor and rolls between objects. A large flat plane sits at the
// TOP of the slab (y = floor + thickness), facing up; the fragment shader marches the view ray through a thin
// slab y∈[floor, floor+thickness] (entry→exit found analytically from uCam + rd), sampling animated fbm with
// density concentrated low in the slab (vertical falloff) and faded toward the slab's outer radius. Additive
// over the dark scene, depth-tested so opaque geometry (floor, decor, gems) occludes it. It renders in the
// default transparent pass (renderOrder 0) — NOT as a far backdrop — so it composites OVER the already-drawn
// opaque scene instead of being painted over by it. The step count scales with the gfx quality, so it stays
// affordable on low-end and costs nothing until the cosmetic is equipped (the parent mounts it only when
// resolved).
const FOG_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const FOG_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCam, uColor, uCenter;
  uniform float uTime, uDensity, uSpeed, uScale, uFloor, uThickness, uRadius;
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
    float top = uFloor + uThickness;          // plane sits here, facing up
    // Analytic crossing of the slab y∈[uFloor, top]. Guard the near-horizontal ray (rd.y≈0) so the divide
    // never blows up — a grazing ray gets a finite (huge) t, then the seg cap below tames it.
    float ry = rd.y;
    float safeY = (abs(ry) < 1e-4) ? (ry < 0.0 ? -1e-4 : 1e-4) : ry;
    float tTop = (top - uCam.y) / safeY;
    float tBot = (uFloor - uCam.y) / safeY;
    float t0 = max(min(tTop, tBot), 0.0);     // enter slab (clamped to in front of camera)
    float t1 = max(tTop, tBot);               // exit slab
    float seg = t1 - t0;
    if(seg <= 0.0) discard;                    // slab is behind the camera / never crossed
    seg = min(seg, uRadius * 2.5);             // cap march length for grazing rays

    float dt = seg / float(uSteps);
    float jit = hash(rd * 811.0 + fract(uTime)) * dt;   // step-banding dither keyed to the WORLD ray dir → continuous across cubemap faces (no seam)
    vec3 drift = vec3(uTime * uSpeed * 0.12, 0.0, -uTime * uSpeed * 0.09);
    float invThick = 1.0 / max(uThickness, 1e-3);
    float invRad = 1.0 / max(uRadius, 1e-3);

    vec3 col = vec3(0.0);
    float trans = 1.0;
    for(int i = 0; i < 20; i++){
      if(i >= uSteps) break;
      float t = t0 + (float(i) + 0.5) * dt + jit;
      vec3 pos = uCam + rd * t;
      // vertical falloff: dense near the floor, thinning to the top of the slab
      float hgt = clamp((pos.y - uFloor) * invThick, 0.0, 1.0);
      float vfall = 1.0 - smoothstep(0.0, 1.0, hgt);
      // radial fade toward the slab edge (centred on the mesh) so it dissolves rather than cutting off
      float r = length(pos.xz - uCenter.xz) * invRad;
      float rfall = 1.0 - smoothstep(0.7, 1.0, r);
      float shape = vfall * rfall;
      if(shape > 0.002){
        vec3 q = pos * uScale + drift;
        float d = smoothstep(0.40, 0.95, fbm(q)) * uDensity * shape;
        if(d > 0.001){
          float aStep = d * dt * 2.2;
          col += trans * uColor * aStep;
          trans *= exp(-aStep);
        }
      }
      if(trans < 0.02) break;
    }
    if(trans > 0.998) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`

export interface GroundFogOptions {
  color: string
  density: number
  speed: number
  thickness?: number
  floor?: number
  radius?: number
}

// Layout defaults: the plane sits at the TOP of the slab (floor + thickness), sized to the slab radius so the
// ray always enters the volume from the visible quad. `scale` tunes the noise frequency (higher = finer wisps).
export function GroundFog({
  options,
  scale = 0.35,
  position,
}: {
  options: GroundFogOptions
  scale?: number
  position?: [number, number, number]
}) {
  const g = useGfxPreset()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const steps = Math.max(10, Math.min(20, Math.round(g.raySteps * 0.16))) // ~10 (low) → ~18 (high)

  const floor = options.floor ?? 0
  const thickness = options.thickness ?? 1.0
  const radius = options.radius ?? 7 // sized for the tight hero view (a 16u plane sat mostly off-screen); fits the orrery board too

  // Plane at the top of the slab, facing up (rotate -90° about X so +Z normal points to +Y).
  const top = floor + thickness
  const pos: [number, number, number] = position ?? [0, top, 0]

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3(pos[0], pos[1], pos[2]) },
      uColor: { value: new THREE.Color(options.color).convertSRGBToLinear() },
      uDensity: { value: options.density },
      uSpeed: { value: options.speed },
      uScale: { value: scale },
      uFloor: { value: floor },
      uThickness: { value: thickness },
      uRadius: { value: radius },
      uSteps: { value: steps },
    }),
    // pos is derived from the same primitives in the deps; spreading them keeps the memo stable.
    [options, scale, floor, thickness, radius, steps, pos[0], pos[1], pos[2]],
  )

  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    m.uniforms.uCam.value.copy(state.camera.position)
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={pos} frustumCulled={false}>
      <planeGeometry args={[radius * 2, radius * 2, 1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={FOG_VERT}
        fragmentShader={FOG_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
