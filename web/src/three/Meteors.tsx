import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Meteors (shooting stars / meteor shower) ──────────────────────────────────────────────────────────────────
// A staggered meteor shower as ONE instanced set of thin elongated quads, high on a large backdrop region so
// scene geometry reads in front (renderOrder=-1, big radius, additive, frustumCulled off). Each instance carries
// a per-meteor SEED (a start point high on one side, a normalized streak direction, and a phase) baked once into
// instanced attributes. The vertex shader derives a per-meteor cycle from mod(uTime*rate + phase): during a short
// "flight" slice the meteor sweeps diagonally across the sky and is visible; the rest of the cycle it is dark — so
// only a few are mid-flight at any instant (a gentle shower, not constant rain). The quad is billboarded in VIEW
// space (so the thin streak always faces the camera and never vanishes edge-on); its local UV runs along the
// streak — a bright hot head fading to a transparent tail. The CPU never touches the buffer per frame; everything
// animates from the single uTime uniform. Self-contained — the parent passes the resolved cosmetic options; reads
// no game state.

export interface MeteorsOptions {
  color: string
  count: number
  speed: number
  area?: [number, number, number] // [width, height, depth] of the backdrop region (default [60, 34, 60])
}

const METEOR_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uLen;
  uniform float uWidth;
  uniform vec3 uArea;
  attribute vec3 aStart;   // spawn point high on one side, in box units (scaled by uArea)
  attribute vec3 aDir;     // normalized streak direction (sweeps down + across)
  attribute vec3 aSeed;    // x = phase, y = rate jitter, z = length jitter
  varying vec2 vUv;        // x = across the streak [-1,1], y = along it [0,1] (0 = tail, 1 = head)
  varying float vAlive;    // 1 while mid-flight, 0 otherwise
  void main(){
    // local quad (a 1x1 plane): position.x across the streak, position.y along it (-0.5..0.5)
    float across = position.x;          // [-0.5, 0.5]
    float along  = position.y + 0.5;    // [0, 1] (0 = tail end, 1 = head end)
    vUv = vec2(across * 2.0, along);

    // per-meteor cycle: a slow recurring launch. mod() keeps it bounded; the visible flight is a short slice
    // of the cycle so most meteors are dark at any moment → a staggered shower, not a constant rain.
    float rate = uSpeed * (0.06 + aSeed.y * 0.06);     // cycles/sec — slow; only a few overlap
    float cyc  = mod(uTime * rate + aSeed.x, 1.0);     // [0,1) phase within this meteor's cycle
    float FLIGHT = 0.32;                                // fraction of the cycle spent streaking (higher → more on screen at once)
    float fly = clamp(cyc / FLIGHT, 0.0, 1.0);          // 0→1 progress across the sky during flight
    vAlive = step(cyc, FLIGHT);                          // 1 only during the flight slice

    float len = uLen * (0.7 + aSeed.z * 0.7);           // streak length in world units (per-meteor jitter)
    vec3 dir = normalize(aDir + vec3(0.0, 0.0, 1e-4));   // guard against a zero dir

    // head descends from the top of the band (fly 0) down through and past the bottom (fly 1), so it crosses the
    // whole visible view rather than clipping an edge.
    vec3 startW = aStart * uArea;
    float travel = uArea.y * 1.7;
    vec3 head = startW + dir * fly * travel;

    // streak centreline point: head at along=1, tail trails back along -dir by len
    vec3 p = head - dir * (1.0 - along) * len;

    // billboard the WIDTH in view space so the thin ribbon always faces the camera (never edge-on/invisible).
    // dir transformed to view space; its screen-plane perpendicular gives the across offset.
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 dirView = normalize((modelViewMatrix * vec4(dir, 0.0)).xyz + vec3(0.0, 0.0, 1e-4));
    vec2 perp = normalize(vec2(-dirView.y, dirView.x) + vec2(1e-4, 0.0));
    mv.xy += perp * across * uWidth;

    gl_Position = projectionMatrix * mv;
  }
`

const METEOR_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlive;
  void main(){
    if(vAlive < 0.5) discard;                    // off-cycle meteors contribute nothing
    // across-streak falloff: bright spine, soft edges
    float w = 1.0 - smoothstep(0.0, 1.0, abs(vUv.x));
    // along-streak: bright head (vUv.y→1), tail fades to transparent (vUv.y→0)
    float along = clamp(vUv.y, 0.0, 1.0);
    float tail = pow(along, 2.2);                            // gradual tail fade
    float head = smoothstep(0.86, 1.0, along) * 1.6;        // hot bright head
    float a = (tail + head) * w * uOpacity;
    if(a < 0.01) discard;
    // lift toward white at the head for a glowing tip
    vec3 col = uColor + vec3(head * 0.5);
    gl_FragColor = vec4(col, a);
  }
`

export function Meteors({
  options,
  position = [0, 0, 0],
}: {
  options: MeteorsOptions
  position?: [number, number, number]
}) {
  const g = useGfxPreset()
  const { color, count, speed, area } = options
  const [aw, ah, ad] = area ?? [6, 4, 6] // tight enough to cross the hero view (camera sees ~±2–3.5u around origin)

  // Bake per-instance seeds ONCE. Count scales lightly with the sparkle preset so low-end stays cheap. A small
  // deterministic hash (no Math.random at frame time) keeps the field stable across remounts with same options.
  const geometry = useMemo(() => {
    const n = Math.max(1, Math.round(count * (0.6 + g.sparkle * 0.5)))
    const rnd = (i: number, s: number) => {
      const v = Math.sin((i + 1) * 12.9898 + s * 78.233 + s * 311.7) * 43758.5453
      return v - Math.floor(v)
    }
    // base quad: a unit plane in local X (width) / Y (length); the vertex shader orients + stretches it. Clone
    // the attribute arrays into the instanced geometry so disposing the base does NOT free buffers we still use.
    const base = new THREE.PlaneGeometry(1, 1, 1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.setIndex(base.getIndex()!.clone())
    geo.setAttribute('position', (base.getAttribute('position') as THREE.BufferAttribute).clone())
    geo.setAttribute('uv', (base.getAttribute('uv') as THREE.BufferAttribute).clone())
    base.dispose()

    const starts = new Float32Array(n * 3)
    const dirs = new Float32Array(n * 3)
    const seeds = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      // spawn across the TOP of the visible band and streak DOWN through the centre, so each meteor crosses the
      // view for most of its flight (not just clipping an edge). x spread across the width, y at the top.
      starts[i * 3 + 0] = (rnd(i, 2) - 0.5) * 0.9 // across the width [-0.45, 0.45] (× area)
      starts[i * 3 + 1] = 0.5 // start at the top of the band
      starts[i * 3 + 2] = (rnd(i, 4) - 0.5) * 0.4 // a little depth spread

      // direction: mostly straight DOWN with a gentle diagonal lean, so it sweeps top→bottom through the centre
      const dx = (rnd(i, 5) - 0.5) * 0.6
      const dy = -1.0
      const dz = (rnd(i, 7) - 0.5) * 0.25
      const dl = Math.hypot(dx, dy, dz) || 1
      dirs[i * 3 + 0] = dx / dl
      dirs[i * 3 + 1] = dy / dl
      dirs[i * 3 + 2] = dz / dl

      seeds[i * 3 + 0] = rnd(i, 8) // phase — staggers launches
      seeds[i * 3 + 1] = rnd(i, 9) // rate jitter
      seeds[i * 3 + 2] = rnd(i, 10) // length jitter
    }
    geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(starts, 3))
    geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dirs, 3))
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3))
    geo.instanceCount = n
    // streaks roam the whole region; culling is off, but keep an honest, generous bounding sphere regardless.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(aw, ah, ad) * 0.5 + 1)
    return geo
  }, [count, g.sparkle, aw, ah, ad])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: METEOR_VERT,
      fragmentShader: METEOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: Math.max(speed, 0.0001) },
        uLen: { value: Math.max(aw, ah) * 0.2 }, // base streak length in world units (jittered per meteor)
        uWidth: { value: Math.max(0.1, Math.max(aw, ah) * 0.018) }, // view-space ribbon width — floored so it stays visibly thick at hero scale (was ~1px)
        uArea: { value: new THREE.Vector3(aw, ah, ad) },
        uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
        uOpacity: { value: 0.9 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true, // depth-tested: the gem occludes streaks passing behind it (they read in front/around it)
      side: THREE.DoubleSide, // the billboarded quad's winding isn't guaranteed front-facing → without this it gets back-face culled (invisible!)
      blending: THREE.AdditiveBlending,
    })
  }, [color, speed, aw, ah, ad])

  // Dispose-safe: geometry + material are created imperatively, so r3f won't auto-dispose them.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // Drive time only; everything else animates in the shader. Wrap to a bounded period to avoid float-precision
  // drift over a long session (3600s is a multiple of any visible cycle, so the wrap is seamless).
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime % 3600
  })

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
      position={position}
    />
  )
}
