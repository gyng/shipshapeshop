import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── God rays (crepuscular shafts) ────────────────────────────────────────────────────────────────────────────
// Soft light shafts streaming from one corner of the sky, IN-SCENE (no post pass): a large BackSide backdrop
// sphere whose interior shader projects a world `sunDir` to a 2D source on screen, then draws additive RADIAL
// streaks (animated value-noise along the angle around that source) that are brightest near it and fade with
// angular distance + radius. Additive, behind everything, depth-tested so opaque geometry occludes it. A few
// noise taps only — no march — so it's cheap; the tap count scales with the gfx quality, so low-end stays cheap.
//
// The view ray (vWorld − uCam) gives a direction-only backdrop (the sphere is huge): we don't ray-march it, we
// just compare each pixel's direction to the sun direction in a world-stable basis built from the sun vector.

const GR_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const GR_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCam, uColor, uSun;
  uniform float uTime, uIntensity, uSpread, uSpeed;
  uniform int uTaps;

  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0.,0.,0.)), hash(i + vec3(1.,0.,0.)), f.x),
                   mix(hash(i + vec3(0.,1.,0.)), hash(i + vec3(1.,1.,0.)), f.x), f.y),
               mix(mix(hash(i + vec3(0.,0.,1.)), hash(i + vec3(1.,0.,1.)), f.x),
                   mix(hash(i + vec3(0.,1.,1.)), hash(i + vec3(1.,1.,1.)), f.x), f.y), f.z);
  }
  // a few-octave fbm whose octave count is the quality knob (bounded constant cap)
  float fbm(vec3 p){
    float a = 0.6, s = 0.0;
    for(int i = 0; i < 5; i++){
      if(i >= uTaps) break;
      s += a * vnoise(p); p *= 2.07; a *= 0.55;
    }
    return s;
  }

  void main(){
    vec3 rd = normalize(vWorld - uCam);
    vec3 sun = normalize(uSun);

    // Build a world-stable 2D basis around the sun direction (independent of camera roll) so the radial
    // coordinate is steady as the camera turns. up falls back to world-X when the sun is near-vertical
    // (guard the degenerate cross product so the basis never collapses to NaN).
    vec3 up = abs(sun.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 bx = normalize(cross(up, sun));
    vec3 by = normalize(cross(sun, bx));

    // pixel direction in that basis: how far off the sun (depth along sun + the 2D offset that gives angle)
    float along = dot(rd, sun);                 // 1 at the source, falls toward the horizon
    vec2  off   = vec2(dot(rd, bx), dot(rd, by));
    float radius = length(off) + 1e-4;          // angular distance from the source (guarded)
    // nudge off the exact origin: atan(0, 0) is undefined in GLSL and can return NaN at the dead-centre
    // pixel (rd parallel to sun). The bias is tiny vs. the streak frequencies, so it is invisible.
    float ang = atan(off.y + 1e-5, off.x + 1e-5); // angle around the source → the streak coordinate

    // angular streaks: noise sampled along the angle (slowly rotating), so brightness varies around the source
    // like shafts; sampling at two radial bands + drift gives soft, breathing edges (no hard spokes).
    float drift = uTime * uSpeed * 0.12;
    float spread = max(uSpread, 0.05);
    float streak =
        fbm(vec3(ang * 2.4, radius * 1.5 - drift, drift * 0.7)) * 0.65 +
        fbm(vec3(ang * 5.1 + 11.0, radius * 0.8 + drift * 0.6, 3.1)) * 0.35;
    streak = pow(clamp(streak, 0.0, 1.0), 1.6); // tighten into shaft-like lobes

    // brightest near the source, fade with angular distance (scaled by spread) and only on the sun's side
    float falloff = exp(-radius * radius / (spread * spread * 1.3));
    float side = smoothstep(-0.15, 0.85, along);   // kill the hemisphere behind the sun → "from one corner"
    float core = smoothstep(0.0, 0.35, along) * 0.6 + 0.4; // gentle bloom right at the source

    float v = streak * falloff * side * core * uIntensity;
    if(v <= 0.0009) discard;

    gl_FragColor = vec4(uColor * v, 1.0);
  }
`

const GR_RADIUS = 24

export interface GodRaysOptions {
  color: string
  intensity: number
  spread?: number
  speed?: number
  sunDir?: [number, number, number]
}

export function GodRays({
  color,
  intensity,
  spread = 1.0,
  speed = 1.0,
  sunDir = [0.5, 0.8, 0.3],
  radius = GR_RADIUS,
}: GodRaysOptions & { radius?: number }) {
  const g = useGfxPreset()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  // octave count of the streak fbm scales with quality: ~2 (low) → ~4 (high). Bounded by the const cap (5).
  const taps = Math.max(2, Math.min(5, Math.round(g.raySteps / 28)))
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
      uSun: { value: new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]) },
      uIntensity: { value: intensity },
      uSpread: { value: spread },
      uSpeed: { value: speed },
      uTaps: { value: taps },
    }),
    [color, intensity, spread, speed, sunDir, taps],
  )
  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    m.uniforms.uCam.value.copy(state.camera.position)
  })
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 24]} />
      <shaderMaterial ref={matRef} vertexShader={GR_VERT} fragmentShader={GR_FRAG} uniforms={uniforms} transparent depthWrite={false} depthTest side={THREE.BackSide} blending={THREE.AdditiveBlending} />
    </mesh>
  )
}
