import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Flux beams (volumetric light shafts) ─────────────────────────────────────────────────────────────────────
// Glowing additive light shafts for the Orrery's flux emitters. The parent computes one descriptor per emitter
// (floor position + the beam's heading as a yaw about Y + a tint); this component just draws each as a soft cone
// of light emanating FROM the emitter origin along that heading, brightest at the origin and fading down the
// shaft with a smooth radial falloff across the width. Each beam is one instance of a SHARED instanced cone
// (per-beam transform via instanceMatrix, per-beam tint via instanceColor) so 7–19 beams cost a single draw
// call. Additive + depthWrite off, so they layer like real light and never z-fight. Ray-march-free: the soft
// edge is analytic, so it's essentially free regardless of gfx tier — we only lean on the preset to gate the
// cone's radial-segment count down on low-end. No global state: the parent passes the resolved beams.

export interface FluxBeamsOptions {
  beams: { pos: [number, number, number]; angleY: number; color: string }[]
  intensity: number
  length?: number
}

// The cone is authored with its APEX at the local origin (the emitter `pos`) and its BASE at +X = BASE_LEN, so
// local x runs 0 (origin) → BASE_LEN (far tip) and the cone's local radius grows linearly 0 → BASE_R with x.
// Per beam we yaw by angleY about Y, translate to pos, and stretch only along +X by `length`.
const BASE_LEN = 1
const BASE_R = 0.22
const SEG_HI = 24
const SEG_LO = 12
// Fixed instance capacity: keeps `count` OUT of the <instancedMesh args> so the mesh never remounts (and the
// instance buffers never overflow) as the beam set grows/shrinks — we just set mesh.count. Spec caps beams at
// ~7–19; 64 is a comfortable ceiling.
const CAPACITY = 64

const BEAM_VERT = /* glsl */ `
  // three binds the InstancedMesh's instanceColor buffer to a shader attribute literally named "instanceColor"
  // (special-cased in WebGLBindingStates) even on a raw ShaderMaterial — but the attribute must be declared here,
  // since a raw ShaderMaterial doesn't pull in three's instanced-color chunk. instanceMatrix is injected by three.
  attribute vec3 instanceColor;
  varying float vAlong;   // 0 at the apex (origin), 1 at the base (far tip)
  varying float vRadial;  // 0 on the axis, 1 at the cone surface
  varying vec3 vTint;
  void main() {
    vTint = instanceColor;
    // local space: +X is the shaft axis (length BASE_LEN); the cone widens 0 → BASE_R as x goes 0 → BASE_LEN.
    vAlong = clamp(position.x / ${BASE_LEN.toFixed(1)}, 0.0, 1.0);
    // radial distance in the YZ plane, normalised by the cone's local radius at this slice (guard the apex ~0).
    float ringR = max(${BASE_R.toFixed(4)} * vAlong, 1e-4);
    vRadial = clamp(length(position.yz) / ringR, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying float vAlong;
  varying float vRadial;
  varying vec3 vTint;

  void main() {
    // Soft radial falloff across the shaft width — bright core, feathered edge (squared for a glow look).
    float radial = 1.0 - smoothstep(0.0, 1.0, vRadial);
    radial *= radial;
    // Length fade: brightest at the origin, easing out toward the tip.
    float lengthFade = 1.0 - smoothstep(0.0, 1.0, vAlong);
    // Tiny ramp-in so the apex point isn't a hard dot.
    float head = smoothstep(0.0, 0.12, vAlong);
    // Gentle flow pulse travelling down the shaft (cosmetic; varies by uTime — never Math.random/Date.now).
    float flow = 0.85 + 0.15 * sin(vAlong * 6.2831853 - uTime * 1.6);
    float a = clamp(radial * lengthFade * head * flow, 0.0, 1.0);
    if (a <= 0.001) discard;
    vec3 col = vTint * (uIntensity * a);
    gl_FragColor = vec4(col, 1.0);
  }
`

export function FluxBeams({ beams, intensity, length = 4 }: FluxBeamsOptions) {
  const g = useGfxPreset()
  const segments = g.raySteps >= 80 ? SEG_HI : SEG_LO
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const count = Math.min(beams.length, CAPACITY)

  const geometry = useMemo(() => {
    // ConeGeometry is +Y with apex at +height/2, base at -height/2. Move the apex to the origin, then rotate the
    // axis +Y → +X so the apex sits at x=0 and the base at x=BASE_LEN (apex = the emitter origin).
    const geo = new THREE.ConeGeometry(BASE_R, BASE_LEN, segments, 1, true)
    geo.translate(0, -BASE_LEN / 2, 0) // apex now at y=0, base at y=-BASE_LEN
    geo.rotateZ(Math.PI / 2) // +Y → +X: apex at x=0, base at x=+BASE_LEN
    return geo
  }, [segments])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: intensity },
    }),
    // built once; uIntensity is kept live in useFrame so prop changes apply without recreating the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Write per-beam transforms + tints whenever the beam set / length changes. Outside the frame loop and
  // side-effect-free w.r.t. subscriptions/timers, so it's StrictMode-safe.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const col = new THREE.Color()
    const len = Math.max(0.001, length)
    for (let i = 0; i < count; i++) {
      const b = beams[i]
      pos.set(b.pos[0], b.pos[1], b.pos[2])
      q.setFromAxisAngle(up, b.angleY)
      scl.set(len, 1, 1) // stretch only along the shaft axis (+X); keep the cone width unscaled
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, col.set(b.color).convertSRGBToLinear())
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [beams, count, length])

  useFrame((state) => {
    const mat = matRef.current
    if (!mat) return
    mat.uniforms.uTime.value = state.clock.elapsedTime
    mat.uniforms.uIntensity.value = intensity
  })

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, CAPACITY]}
      frustumCulled={false}
      renderOrder={-1}
    >
      <shaderMaterial
        ref={matRef}
        vertexShader={BEAM_VERT}
        fragmentShader={BEAM_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  )
}
