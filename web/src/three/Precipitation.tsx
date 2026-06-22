import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Precipitation (rain / snow) ───────────────────────────────────────────────────────────────────────────
// A GPU particle backdrop: ONE THREE.Points whose per-point start positions + random seeds are baked into the
// BufferGeometry once (useMemo), then the vertex shader animates each point falling along −Y over uTime and
// wraps it with mod() into the box height — so the CPU never touches the buffer per frame and it scales to
// thousands of points cheaply. `kind:'rain'` → fast, near-vertical, thin/elongated streaks at lower opacity
// (alpha-blended); `kind:'snow'` → slow drifting flakes with a soft round alpha (gl_PointCoord) and a gentle
// sway, blended additively for a glint. Count scales with the gfx `sparkle` preset so low-end stays cheap.
// The component is self-contained: the parent passes the resolved cosmetic options; it reads no game state.

export interface PrecipitationOptions {
  kind: 'rain' | 'snow'
  color: string
  count: number
  speed: number
  area?: [number, number, number] // [width, height, depth] of the spawn box (default [20, 16, 20])
}

const RAIN_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uHeight;
  uniform float uPixel;
  uniform float uWind;
  attribute vec3 aSeed; // per-point randoms in [0,1): x = phase, y = fall-speed jitter, z = wind/size jitter
  varying float vFade;
  void main(){
    vec3 p = position;
    float fall = uSpeed * (0.7 + aSeed.y * 0.6);
    // continuous downward travel, wrapped into [0, uHeight) so points recycle from the top
    float drop = mod(aSeed.x * uHeight + uTime * fall, uHeight);
    p.y = (uHeight * 0.5) - drop;
    // slight slanting wind drift (rain leans), varied per point so streaks don't move in lockstep
    p.x += sin(uTime * 0.6 + aSeed.x * 6.2831) * uWind * (0.4 + aSeed.z * 0.6);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // perspective-scaled, clamped point size; rain reads thin/small. Guard the divide so it never blows up.
    float sz = (0.9 + aSeed.z * 0.7) * uPixel;
    gl_PointSize = clamp(sz / max(-mv.z, 0.001), 1.0, 6.0);
    vFade = 0.55 + aSeed.y * 0.45; // per-streak opacity variance
  }
`
const RAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main(){
    // vertical streak: bright down the centre column, fading to the sides → an elongated thin look
    vec2 c = gl_PointCoord - 0.5;
    float a = (1.0 - smoothstep(0.0, 0.5, abs(c.x))) * (1.0 - smoothstep(0.0, 0.5, abs(c.y) * 0.6));
    a *= uOpacity * vFade;
    if(a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

const SNOW_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uHeight;
  uniform float uPixel;
  uniform float uWind;
  attribute vec3 aSeed;
  varying float vFade;
  void main(){
    vec3 p = position;
    float fall = uSpeed * (0.6 + aSeed.y * 0.5);
    float drop = mod(aSeed.x * uHeight + uTime * fall, uHeight);
    p.y = (uHeight * 0.5) - drop;
    // gentle two-axis sway so flakes drift rather than fall straight
    float ph = aSeed.z * 6.2831;
    p.x += sin(uTime * 0.5 + ph) * uWind * (0.4 + aSeed.z * 0.4);
    p.z += cos(uTime * 0.4 + ph * 1.3) * uWind * (0.3 + aSeed.z * 0.3);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float sz = (2.2 + aSeed.z * 2.4) * uPixel; // flakes are bigger + softer than rain
    gl_PointSize = clamp(sz / max(-mv.z, 0.001), 2.0, 14.0);
    vFade = 0.6 + aSeed.y * 0.4;
  }
`
const SNOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main(){
    // soft round flake: radial falloff via gl_PointCoord
    float d = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.18, 0.5, d)) * uOpacity * vFade;
    if(a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export function Precipitation({
  options,
  position = [0, 0, 0],
}: {
  options: PrecipitationOptions
  position?: [number, number, number]
}) {
  const g = useGfxPreset()
  const { kind, color, count, speed, area } = options
  const [aw, ah, ad] = area ?? [9, 13, 9] // sized for the tight hero view (narrower footprint, tall enough to fall through)
  const isSnow = kind === 'snow'

  // Bake positions + per-point seeds ONCE. Count scales with the particle preset so low-end stays cheap; vary
  // by index-driven hashing — never Math.random at frame time, but build-time determinism in useMemo is fine.
  const geometry = useMemo(() => {
    const n = Math.max(1, Math.round(count * g.sparkle))
    const positions = new Float32Array(n * 3)
    const seeds = new Float32Array(n * 3)
    // small deterministic hash so a remount with the same options gives a stable field. Mix two sines and add an
    // index offset per channel to break the row-banding the bare sin-hash shows at large indices.
    const rnd = (i: number, s: number) => {
      const v = Math.sin((i + 1) * 12.9898 + s * 78.233 + s * 311.7) * 43758.5453
      return v - Math.floor(v)
    }
    for (let i = 0; i < n; i++) {
      positions[i * 3 + 0] = (rnd(i, 1) - 0.5) * aw
      positions[i * 3 + 1] = (rnd(i, 2) - 0.5) * ah
      positions[i * 3 + 2] = (rnd(i, 3) - 0.5) * ad
      seeds[i * 3 + 0] = rnd(i, 4) // phase
      seeds[i * 3 + 1] = rnd(i, 5) // speed jitter
      seeds[i * 3 + 2] = rnd(i, 6) // wind / size jitter
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    // sway can nudge points slightly outside the spawn box; pad the bounding sphere a touch. (frustumCulled is
    // off anyway, but keep the sphere honest so any future culling won't clip the field.)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(aw, ah, ad) * 0.5 + 1)
    return geo
  }, [count, g.sparkle, aw, ah, ad])

  // Build the material in useMemo keyed on `kind` so flipping rain↔snow yields a fresh shader program (mutating
  // .vertexShader on an existing ShaderMaterial would NOT recompile). New identity → r3f swaps it cleanly.
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: isSnow ? SNOW_VERT : RAIN_VERT,
      fragmentShader: isSnow ? SNOW_FRAG : RAIN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: speed * (isSnow ? 1.6 : 9.0) }, // base fall rate; rain is much faster
        uHeight: { value: Math.max(ah, 0.001) }, // guard the mod() divisor
        uPixel: { value: isSnow ? 220 : 120 }, // point-size scalar (perspective-divided in the shader)
        uWind: { value: isSnow ? 1.0 : 0.45 }, // horizontal drift amplitude (units)
        uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
        uOpacity: { value: isSnow ? 0.85 : 0.45 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true, // gem occludes drops directly behind it; they reappear through the glass via the cubemap
      blending: isSnow ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
     
  }, [isSnow, speed, ah, color])

  // Dispose-safe: geometry + material are created imperatively (not via declarative children), so r3f won't
  // auto-dispose them. Free GPU resources when they're replaced or the component unmounts.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // Drive time from the clock; no per-frame allocation, no JS↔WASM crossing. Snow/rain animate purely in the
  // vertex shader from this single uniform. Write straight to the memoized material (no ref dance needed).
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
      position={position}
    />
  )
}
