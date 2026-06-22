import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── Caustics ──────────────────────────────────────────────────────────────────────────────────────────────
// The jewel casting dancing refracted light ALL AROUND it. Instead of a single horizontal floor plane (which
// reads edge-on as a thin flat band when the hero camera orbits a FLOATING gem), we wrap the scene in a big
// BackSide sphere centred at the origin — the camera is inside it, so it fills the view from every orbit angle,
// just like VolumetricField / CloudLayer. The fragment shader paints a moving CAUSTIC web — crisp bright veins
// where layered Worley/Voronoi cell edges meet (F2 - F1 → 0), sharpened with smoothstep + pow into thin
// filaments — but PROJECTED onto the dome by the world ray direction via a TRIPLANAR blend (the 2D caustic is
// sampled on d.xy / d.yz / d.zx and blended by d²), so it tiles seamlessly with NO pole seam and PARALLAXES as
// you orbit (real depth, never a flat band). A large-scale low-frequency term focuses some regions brighter
// (like converged refracted light) and a gentle per-channel offset splits the colour for a jewel-like
// chromatic shimmer. ADDITIVE over the dark scene, depthWrite:false, renderOrder=-1, side=BackSide,
// frustumCulled=false — nothing renders unless the parent mounts it (cosmetic equipped). Reads no game state.
const CAUSTICS_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const CAUSTICS_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uColor, uCam;
  uniform float uTime, uIntensity, uScale, uSpeed;

  // 2D hash → a jittered feature point per cell (for Worley/Voronoi).
  vec2 hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // One Worley pass: returns (F1, F2), the distances to the two nearest jittered feature points. Bright caustic
  // filaments live where the two are nearly equal (the cell borders) — surfaced by F2 - F1. Bounded 3x3
  // neighbourhood; feature points drift on little orbits by t so the cells breathe and the web shimmers.
  vec2 worley(vec2 p, float t){
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for(int j = -1; j <= 1; j++){
      for(int i = -1; i <= 1; i++){
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(ip + g);
        o = 0.5 + 0.5 * sin(t + 6.2831 * o);
        vec2 r = g + o - fp;
        float d = dot(r, r);
        if(d < f1){ f2 = f1; f1 = d; }
        else if(d < f2){ f2 = d; }
      }
    }
    return vec2(sqrt(f1), sqrt(f2));
  }

  // The 2D caustic web at one set of plane coordinates. Two warped, differently-scaled/rotated Worley layers
  // interfere so the filaments cross rather than march in lockstep; their edge maps are sharpened to thin crisp
  // veins, plus bright hot-spots where both webs cross (the refracted glints). The 'seed' decorrelates the three
  // triplanar projections so the seams between them never line up into a visible grid.
  float causticWeb(vec2 uv, float t, float seed){
    vec2 w1 = worley(uv + vec2(t * 0.20, t * 0.13) + seed, t * 0.6 + seed);
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    vec2 w2 = worley(rot * uv * 1.7 + vec2(-t * 0.11, t * 0.17) + seed * 1.7, t * 0.9 + 2.0 + seed);

    // Edge response: F2 - F1 → 0 exactly on a cell border. Invert so borders are bright, then sharpen: smoothstep
    // carves the band, pow tightens it into a filament.
    float e1 = 1.0 - smoothstep(0.0, 0.45, w1.y - w1.x);
    float e2 = 1.0 - smoothstep(0.0, 0.45, w2.y - w2.x);
    float veins = pow(e1, 3.0) + 0.7 * pow(e2, 3.0);

    // Sparkle hot-spots where both webs cross, for the bright refracted glints.
    veins += 2.2 * pow(e1 * e2, 4.0);
    return veins;
  }

  void main(){
    // World ray direction from the camera through this dome fragment — the projection axis for the triplanar
    // caustic. Using a normalized direction means the pattern is purely angular, so it stays put on the "sky"
    // and PARALLAXES naturally as the camera orbits (near things shift more than far), reading as depth. The
    // dome (r=20) is far outside the orbit (3..9), so vWorld - uCam is never zero → normalize is safe.
    vec3 d = normalize(vWorld - uCam);
    float t = uTime * uSpeed;
    float s = uScale;

    // TRIPLANAR: sample the 2D caustic web on the three principal planes of the direction, blended by d² so the
    // contribution from each plane dominates where the ray faces that axis. This wraps the web around the whole
    // sphere with NO pole seam (unlike a lat/long mapping) and no axis singularity. Each plane gets its own seed
    // so the three patterns don't resonate into a visible cross. The plane sampled on d.xy is perpendicular to Z,
    // so it is weighted by d.z² (wgt.z) — and likewise yz↔x, zx↔y.
    vec3 dn = d * s;
    vec3 wgt = d * d;                  // already non-negative; d is unit so they sum to 1
    wgt = wgt / max(wgt.x + wgt.y + wgt.z, 1e-3);
    float cz = causticWeb(dn.xy, t, 0.0);   // perpendicular to Z  → wgt.z
    float cx = causticWeb(dn.yz, t, 11.3);  // perpendicular to X  → wgt.x
    float cy = causticWeb(dn.zx, t, 23.7);  // perpendicular to Y  → wgt.y
    float veins = cx * wgt.x + cy * wgt.y + cz * wgt.z;

    // Large-scale, slow low-frequency modulation so it's not uniform: some regions read as focused/converged
    // refracted light (brighter), others fall back. Driven by a coarse worley on the same direction, drifting on
    // its own slow clock so the bright zones wander.
    vec2 lowF = worley(d.xz * (0.9 * s) + vec2(t * 0.05, -t * 0.04), t * 0.2);
    float focus = 0.55 + 0.85 * (1.0 - smoothstep(0.0, 1.2, lowF.x)); // ~0.55..1.4

    // Gently pool the light toward the horizon band rather than straight up/down — converged caustics tend to
    // ring the object rather than blanket the poles. Subtle, so the dome still reads as fully wrapped.
    float band = mix(1.0, 0.62, smoothstep(0.35, 0.95, abs(d.y)));

    float amt = veins * focus * band * uIntensity;
    if(amt < 0.002) discard;          // dark scene stays dark (additive: nothing added)

    // Per-channel chromatic shimmer: caustics split colour where light refracts. Re-sample the primary (xy)
    // triplanar plane at tiny ± offsets and use the difference to push R and B apart, so bright filaments get a
    // faint prismatic fringe instead of reading monochrome-flat. Strongest in the Z-facing band (where the xy
    // plane dominates), subtle elsewhere — cheap (one extra pair of taps), tasteful, and always bounded.
    float disp = 0.012 * s;
    float rC = causticWeb(dn.xy + vec2(disp, 0.0), t, 0.0);
    float bC = causticWeb(dn.xy - vec2(disp, 0.0), t, 0.0);
    vec3 chroma = vec3(1.0 + 0.18 * (rC - cz), 1.0, 1.0 + 0.18 * (bC - cz));

    gl_FragColor = vec4(uColor * chroma * amt, 1.0);
  }
`

export interface CausticsOptions {
  color: string
  intensity: number
  scale?: number
  speed?: number
  radius?: number
  /** @deprecated floor plane is gone — caustics now wrap the scene on a dome. Kept for back-compat. */
  floor?: number
}

const CAUSTICS_RADIUS = 20 // big BackSide dome centred at origin; camera (orbit 3..9) sits comfortably inside it

// `scale` tunes the caustic cell frequency (higher = finer, busier filaments); `speed` the drift rate. `radius`
// and `floor` are accepted for back-compat but no longer affect layout — the effect is a direction-projected
// dome, not a sized plane.
export function Caustics({
  options,
  position: _position,
}: {
  options: CausticsOptions
  position?: [number, number, number]
}) {
  // Caustics cost is per-fragment (no ray march), but tie quality to the preset: at low quality we nudge the
  // cell scale coarser so there's less aliased high-frequency detail to shimmer on cheap GPUs.
  const g = useGfxPreset()

  const matRef = useRef<THREE.ShaderMaterial>(null)

  const speed = options.speed ?? 1.0
  const lod = g.raySteps >= 112 ? 1.0 : g.raySteps >= 80 ? 0.85 : 0.7 // high / medium / low
  // The pattern is now angular (sampled on a unit direction), so the base frequency is in "cells per radian"
  // territory — pick a multiplier that gives a few filaments across the view at fov 42. ~6 reads well.
  const scale = (options.scale ?? 1.0) * 6.0 * lod

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(options.color).convertSRGBToLinear() },
      uIntensity: { value: options.intensity },
      uScale: { value: scale },
      uSpeed: { value: speed },
    }),
    [options, scale, speed],
  )

  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    // Wrap to a bounded period (matches the 2π feature-point orbits) so float precision never drifts over a long
    // session. All animation flows through uTime·uSpeed, so the loop stays seamless.
    m.uniforms.uTime.value = state.clock.elapsedTime % 600
    m.uniforms.uCam.value.copy(state.camera.position)
  })

  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[CAUSTICS_RADIUS, 32, 24]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={CAUSTICS_VERT}
        fragmentShader={CAUSTICS_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}