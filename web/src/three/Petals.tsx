import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Petals (falling cherry-blossom petals / leaves) ──────────────────────────────────────────────────────────
// A GPU particle effect: ONE THREE.InstancedMesh of flat unit quads, one quad per petal. Per-instance seeds
// (phase, fall-speed, sway amplitude/frequency, tumble axis + rate, size, colour mix) are baked into instanced
// buffer attributes ONCE (useMemo); the vertex shader then does ALL the motion from a single uTime uniform —
// each petal falls slowly along −Y, sways horizontally (sin of uTime+phase), and TUMBLES in 3D (a per-instance
// rotation built each frame from uTime), wrapping vertically with mod() so the field loops forever. The CPU
// never touches a buffer per frame and it scales to hundreds of petals cheaply. The fragment carves a soft
// teardrop/ellipse alpha out of the quad's uv (not a hard square) and tints with a gentle gradient, mixing the
// base colour toward an optional `secondary`. NormalBlending with alpha (soft, slightly translucent),
// depthWrite off so petals don't occlude each other, depthTested so opaque scene geometry occludes them.
// Count scales with the gfx `sparkle` preset so low-end stays cheap; it costs nothing until the parent mounts
// it (the cosmetic is equipped). Self-contained: the parent passes the resolved cosmetic options; reads no game state.

export interface PetalsOptions {
  color: string
  count: number
  speed: number
  area?: [number, number, number] // [width, height, depth] of the spawn box (default [18, 14, 18])
  secondary?: string // optional second tint petals lerp toward per-instance (e.g. autumn-leaf gradient)
}

// Per-petal data is split across two instanced attributes (vec4 each) so all of it reaches the vertex shader:
//   aSeedA = (phase, fallSpeedJitter, swayAmp, swayFreq)
//   aSeedB = (spinRate, sizeJitter, colorMix, spinAxisAngle)
// plus a baked aOrigin (vec3) for the spawn x/z column + initial y offset.

const PETAL_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uHeight;
  attribute vec3 aOrigin;   // spawn column: x, initial-y phase (0..1 of height), z
  attribute vec4 aSeedA;    // phase, fallSpeedJitter, swayAmp, swayFreq
  attribute vec4 aSeedB;    // spinRate, sizeJitter, colorMix, spinAxisAngle
  varying vec2 vUv;
  varying float vColorMix;
  varying float vShade;

  // Rodrigues rotation of a vector about a (unit) axis by angle a.
  vec3 rotAxis(vec3 v, vec3 axis, float a){
    float c = cos(a), s = sin(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main(){
    vUv = uv;
    vColorMix = aSeedB.z;

    // size of this petal's quad (the base geometry is a unit quad centred on origin)
    float size = 0.16 + aSeedB.y * 0.34;

    // ── tumble: rotate the flat quad about a per-instance tilted axis, spinning over time ──
    float spinAng = aSeedB.w; // azimuth of the tumble axis
    vec3 axis = normalize(vec3(cos(spinAng) * 0.6, 0.35, sin(spinAng) * 0.6));
    float spin = uTime * (0.5 + aSeedB.x * 1.6) + aSeedA.x * 6.2831;
    vec3 local = position * size;
    local = rotAxis(local, axis, spin);

    // ── fall: continuous downward travel wrapped into [0,uHeight) so petals recycle from the top ──
    float fall = uSpeed * (0.6 + aSeedA.y * 0.8);
    float drop = mod(aOrigin.y * uHeight + uTime * fall, uHeight);
    float py = (uHeight * 0.5) - drop;

    // ── sway: gentle horizontal drift, varied per petal so they don't move in lockstep ──
    float ph = aSeedA.x * 6.2831;
    float swayX = sin(uTime * aSeedA.w + ph) * aSeedA.z;
    float swayZ = cos(uTime * aSeedA.w * 0.8 + ph * 1.3) * aSeedA.z * 0.7;

    vec3 worldOffset = vec3(aOrigin.x + swayX, py, aOrigin.z + swayZ);

    // Build the instance position in view space: camera-independent fall + a billboard-ish tumble. We add the
    // rotated quad corner to the instanced translation in MODEL space (the quad already tumbles in 3D above).
    vec3 modelPos = worldOffset + local;
    vec4 mv = modelViewMatrix * vec4(modelPos, 1.0);
    gl_Position = projectionMatrix * mv;

    // cheap shading: the quad's tumble face brightness via the rotated normal's z (fakes light catching the petal)
    vec3 nrm = rotAxis(vec3(0.0, 0.0, 1.0), axis, spin);
    vShade = 0.7 + 0.3 * abs(nrm.z);
  }
`

const PETAL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vShade;

  void main(){
    // uv is [0,1] across the quad; centre it. Carve a soft teardrop/ellipse: an ellipse that pinches at one end.
    vec2 c = vUv - 0.5;
    // pinch the top (v→+) so a round bottom tapers to a point → petal/teardrop silhouette
    float taper = mix(1.0, 0.35, smoothstep(0.0, 0.55, c.y + 0.5));
    float ex = c.x / max(taper * 0.5, 1e-3);
    float ey = c.y / 0.62;
    float d = sqrt(ex * ex + ey * ey);     // 0 centre → ~1 at the petal edge
    float a = (1.0 - smoothstep(0.78, 1.0, d)) * uOpacity;
    if(a < 0.01) discard;

    // gentle gradient down the petal + per-instance colour mix toward the secondary tint, then fake shading
    vec3 col = mix(uColor, uColor2, clamp(vColorMix, 0.0, 1.0));
    col *= (0.85 + 0.25 * (vUv.y)) * vShade;   // brighter toward the rounded base
    gl_FragColor = vec4(col, a);
  }
`

export function Petals({
  options,
  position = [0, 0, 0],
}: {
  options: PetalsOptions
  position?: [number, number, number]
}) {
  const g = useGfxPreset()
  const { color, count, speed, area, secondary } = options
  const [aw, ah, ad] = area ?? [8, 7, 8] // sized for the tight hero view; still fills a small orrery board

  // Bake the base unit quad + per-instance attributes ONCE. Count scales with the particle preset. Vary by an
  // index-driven hash — never Math.random at frame time; build-time determinism in useMemo is fine (a remount
  // with the same options reproduces the same field).
  const geometry = useMemo(() => {
    const n = Math.max(1, Math.round(count * g.sparkle))
    const geo = new THREE.InstancedBufferGeometry()

    // unit quad centred on origin, with uv — the petal silhouette is carved in the fragment from uv.
    const quadPos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
    const quadUv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    const quadIdx = new Uint16Array([0, 1, 2, 0, 2, 3])
    geo.setAttribute('position', new THREE.BufferAttribute(quadPos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(quadUv, 2))
    geo.setIndex(new THREE.BufferAttribute(quadIdx, 1))
    geo.instanceCount = n

    const origin = new Float32Array(n * 3)
    const seedA = new Float32Array(n * 4)
    const seedB = new Float32Array(n * 4)
    // small deterministic hash; mix two sines + an index offset per channel to break row-banding at large indices.
    const rnd = (i: number, s: number) => {
      const v = Math.sin((i + 1) * 12.9898 + s * 78.233 + s * 311.7) * 43758.5453
      return v - Math.floor(v)
    }
    for (let i = 0; i < n; i++) {
      origin[i * 3 + 0] = (rnd(i, 1) - 0.5) * aw
      origin[i * 3 + 1] = rnd(i, 2) // initial y phase (0..1 of height)
      origin[i * 3 + 2] = (rnd(i, 3) - 0.5) * ad
      seedA[i * 4 + 0] = rnd(i, 4) // phase
      seedA[i * 4 + 1] = rnd(i, 5) // fall-speed jitter
      seedA[i * 4 + 2] = 0.4 + rnd(i, 6) * 1.1 // sway amplitude (units)
      seedA[i * 4 + 3] = 0.3 + rnd(i, 7) * 0.6 // sway frequency
      seedB[i * 4 + 0] = rnd(i, 8) // spin rate jitter
      seedB[i * 4 + 1] = rnd(i, 9) // size jitter
      seedB[i * 4 + 2] = rnd(i, 10) // colour mix
      seedB[i * 4 + 3] = rnd(i, 11) * 6.2831 // tumble-axis azimuth
    }
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3))
    geo.setAttribute('aSeedA', new THREE.InstancedBufferAttribute(seedA, 4))
    geo.setAttribute('aSeedB', new THREE.InstancedBufferAttribute(seedB, 4))

    // sway + tumble nudge petals slightly outside the spawn box; pad the bounding sphere. (frustumCulled is off
    // anyway, but keep the sphere honest so any future culling won't clip the field.)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(aw, ah, ad) * 0.5 + 2)
    return geo
  }, [count, g.sparkle, aw, ah, ad])

  // Material in useMemo so a colour/secondary change rebuilds it cleanly (new identity → r3f swaps it). The
  // secondary tint defaults to the base colour (so single-colour petals get no gradient shift).
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT,
      fragmentShader: PETAL_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: speed * 1.4 }, // base fall rate; petals drift slowly
        uHeight: { value: Math.max(ah, 0.001) }, // guard the mod() divisor
        uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
        uColor2: { value: new THREE.Color(secondary ?? color).convertSRGBToLinear() },
        uOpacity: { value: 0.9 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true, // the gem occludes petals directly behind it (depth) — but they reappear THROUGH the glass
                       // via the atmosphere cubemap refraction, so they read as part of the scene, not a flat overlay
      side: THREE.DoubleSide, // petals are flat + tumble → both faces show
      blending: THREE.NormalBlending,
    })
  }, [speed, ah, color, secondary])

  // Dispose-safe: geometry + material are created imperatively (not via declarative children), so r3f won't
  // auto-dispose them. Free GPU resources when they're replaced or the component unmounts.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // Drive time from the clock; wrap to a bounded period so float precision stays clean over a long session
  // (all motion is mod/sin of uTime, so any multiple of the sway/fall periods is seamless — 600s is ample).
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime % 600
  })

  return (
    <mesh
      geometry={geometry}
      material={material}
      frustumCulled={false}
      position={position}
    />
  )
}
