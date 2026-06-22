import { useMemo, useRef } from 'react'
import { Sparkles } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '../game/store'
import { atmosphereById, SLOT_ATMOSPHERE, type AtmosphereSpec } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'
import { GroundFog } from './GroundFog'
import { GodRays } from './GodRays'
import { Precipitation } from './Precipitation'
import { Aurora } from './Aurora'
import { SmokePlume } from './SmokePlume'
import { Caustics } from './Caustics'
import { Petals } from './Petals'
import { Meteors } from './Meteors'
import { CloudLayer } from './CloudLayer'

// ── Volumetric field (clouds / nebula) ──────────────────────────────────────────────────────────────────────
// A big backdrop sphere whose interior is ray-marched through animated fbm noise — genuine volumetric depth
// (not a flat texture). Additive over the dark scene, depth-tested so opaque geometry (floor, gems) occludes
// it. Only mounts when a volumetric Atmosphere cosmetic is equipped, and the step count scales with the gfx
// quality, so it costs nothing until bought and stays affordable.
const VOL_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const VOL_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCam, uColA, uColB, uColC;
  uniform float uTime, uDensity, uSpeed, uScale, uRadius;
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
    // ray vs the field sphere (centred at origin) → the [t0, t1] segment to march
    float b = dot(uCam, rd);
    float c = dot(uCam, uCam) - uRadius * uRadius;
    float h = b * b - c;
    if(h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0);
    float t1 = -b + h;
    float seg = t1 - t0;
    if(seg <= 0.0) discard;
    float dt = seg / float(uSteps);
    float jit = hash(rd * 811.0 + fract(uTime)) * dt; // step-banding dither keyed to the WORLD ray dir → continuous across cubemap faces (no seam in refraction)
    vec3 drift = vec3(uTime * uSpeed * 0.10, uTime * uSpeed * 0.04, -uTime * uSpeed * 0.07);
    vec3 col = vec3(0.0);
    float trans = 1.0;
    for(int i = 0; i < 64; i++){
      if(i >= uSteps) break;
      float t = t0 + (float(i) + 0.5) * dt + jit;
      vec3 pos = uCam + rd * t;
      vec3 q = pos * uScale + drift;
      float d = smoothstep(0.45, 0.95, fbm(q)) * uDensity;
      d *= 1.0 - smoothstep(uRadius * 0.55, uRadius, length(pos)); // soft fade at the sphere edge
      if(d > 0.001){
        float m = clamp(fbm(q * 0.5 + 7.3), 0.0, 1.0);
        vec3 cc = mix(uColA, uColB, m);
        cc = mix(cc, uColC, clamp(pos.y * 0.04 + 0.5, 0.0, 1.0) * 0.6);
        float aStep = d * dt * 1.6;
        col += trans * cc * aStep;
        trans *= exp(-aStep);
      }
      if(trans < 0.02) break;
    }
    if(trans > 0.998) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`
const VOL_RADIUS = 22

function VolumetricField({ vol }: { vol: NonNullable<AtmosphereSpec['vol']> }) {
  const g = useGfxPreset()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const steps = Math.max(12, Math.round(g.raySteps * 0.32)) // ~16 (low) → ~36 (high)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColA: { value: new THREE.Color(vol.colorA).convertSRGBToLinear() },
      uColB: { value: new THREE.Color(vol.colorB).convertSRGBToLinear() },
      uColC: { value: new THREE.Color(vol.colorC ?? vol.colorB).convertSRGBToLinear() },
      uDensity: { value: vol.density },
      uSpeed: { value: vol.speed },
      uScale: { value: vol.scale },
      uRadius: { value: VOL_RADIUS },
      uSteps: { value: steps },
    }),
    [vol, steps],
  )
  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    m.uniforms.uCam.value.copy(state.camera.position)
  })
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[VOL_RADIUS, 32, 24]} />
      <shaderMaterial ref={matRef} vertexShader={VOL_VERT} fragmentShader={VOL_FRAG} uniforms={uniforms} transparent depthWrite={false} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
    </mesh>
  )
}

// ── Atmosphere (the equipped cosmetic) ──────────────────────────────────────────────────────────────────────
// Shared volumetric atmosphere, driven by the equipped Atmosphere cosmetic (Shop, slot 8): distance fog +
// a drifting-mote layer + (for cloud/nebula moods) a ray-marched volumetric field. The path-trace haze
// contribution (atmo.haze) is read separately by the hero PT gem.
//
// `defaultFog` is the scene's OWN fog, used when the Clear (id 0) atmosphere is equipped, so each scene keeps
// its native look until the player buys a mood (pass null for no fog when Clear). `fog={false}` renders the
// mote (+ volumetric) layer only. `fogNearMin` pushes the fog start out so a close-up focal gem stays crisp
// (the hero stage). `volumetric={false}` skips the ray-march (tiny compact previews).
//
// `overlay` is the SDF-hero mode: that scene is a single fullscreen HDR quad with NO geometry depth, so the
// depth-occluding effects (self-shadowed clouds, ground fog, floor caustics) can't composite — we render only
// the ADDITIVE sky/particle effects that layer cleanly over the quad, and drop fog (which the quad ignores).
export function Atmosphere({
  defaultFog = null,
  fog = true,
  fogNearMin = 0,
  volumetric = true,
  overlay = false,
  overrideId,
  gemOcclude = 0,
  moteScale = [10, 5, 10],
  motePos = [0, 1.4, 0],
}: {
  defaultFog?: [string, number, number] | null
  fog?: boolean
  fogNearMin?: number
  volumetric?: boolean
  overlay?: boolean
  overrideId?: number // shop hover-preview: show THIS atmosphere instead of the equipped one (not persisted)
  gemOcclude?: number // hero: bounding radius of the gem at origin → clouds can render in front of it (0 = far backdrop)
  moteScale?: [number, number, number]
  motePos?: [number, number, number]
}) {
  const equippedAtmo = useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)
  const atmo = atmosphereById(overrideId ?? equippedAtmo)
  const g = useGfxPreset()
  const clear = atmo.id === 0
  const fogArgs: [string, number, number] | null = clear ? defaultFog : [atmo.fog, Math.max(atmo.fogNear, fogNearMin), atmo.fogFar]
  return (
    <>
      {fog && !overlay && fogArgs && <fog attach="fog" args={fogArgs} />}
      {volumetric && atmo.vol && <VolumetricField vol={atmo.vol} />}
      {volumetric && !overlay && atmo.groundFog && <GroundFog options={atmo.groundFog} />}
      {volumetric && atmo.godRays && <GodRays {...atmo.godRays} />}
      {volumetric && atmo.precip && <Precipitation options={atmo.precip} />}
      {volumetric && atmo.aurora && <Aurora options={atmo.aurora} />}
      {volumetric && atmo.smokePlume && <SmokePlume {...atmo.smokePlume} />}
      {volumetric && !overlay && atmo.caustics && <Caustics options={atmo.caustics} />}
      {volumetric && atmo.petals && <Petals options={atmo.petals} />}
      {volumetric && atmo.meteors && <Meteors options={atmo.meteors} />}
      {volumetric && !overlay && atmo.clouds && <CloudLayer options={atmo.clouds} gemOcclude={gemOcclude} />}
      {!clear && atmo.moteCount > 0 && (
        <Sparkles
          count={Math.max(1, Math.round(atmo.moteCount * g.sparkle))}
          scale={moteScale}
          position={motePos}
          size={atmo.moteSize}
          speed={atmo.moteSpeed}
          opacity={atmo.moteOpacity}
          color={atmo.mote}
          noise={1}
        />
      )}
    </>
  )
}
