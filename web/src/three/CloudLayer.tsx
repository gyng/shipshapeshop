import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGfxPreset } from '../gfx'

// ── CloudLayer ───────────────────────────────────────────────────────────────────────────────────────────────
// Self-shadowed (lit) volumetric clouds: a big BackSide backdrop sphere whose interior is ray-marched through a
// coverage-thresholded fbm, with a SHORT secondary march toward the sun at every dense sample to accumulate a
// Beer's-law LIGHT transmittance — that secondary lookup is the self-shadowing that gives clouds real 3D form
// (bright sunlit tops, dark shadowed undersides), a step up from the flat additive nebula in VolumetricField.
// Composited front-to-back with PREMULTIPLIED-alpha NormalBlending so the clouds OCCLUDE + darken the background
// (not additive glow). The shader emits straight premultiplied color/alpha; the blend func is set to consume it.

export type CloudLayerOptions = {
  colorLight: string
  colorDark: string
  density: number
  coverage: number
  speed: number
  scale?: number
  sunDir?: [number, number, number]
}

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const CLOUD_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCam, uColLight, uColDark, uSunDir;
  uniform float uTime, uDensity, uCoverage, uSpeed, uScale, uRadius, uGemR;
  uniform int uSteps;

  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0.,0.,0.)), hash(i + vec3(1.,0.,0.)), f.x),
                   mix(hash(i + vec3(0.,1.,0.)), hash(i + vec3(1.,1.,0.)), f.x), f.y),
               mix(mix(hash(i + vec3(0.,0.,1.)), hash(i + vec3(1.,0.,1.)), f.x),
                   mix(hash(i + vec3(0.,1.,1.)), hash(i + vec3(1.,1.,1.)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

  // Cloud density at a world position: coverage-thresholded fbm drifting over time. Returns 0 in clear sky so
  // there are genuine GAPS, with a soft shell fade so clouds dissolve at the sphere edge instead of clipping.
  float cloudDensity(vec3 pos, vec3 drift){
    vec3 q = pos * uScale + drift;
    float base = fbm(q);
    // higher uCoverage lowers the threshold → more sky fills with cloud; the smoothstep band keeps soft edges.
    float thr = mix(0.72, 0.30, clamp(uCoverage, 0.0, 1.0));
    float d = smoothstep(thr, thr + 0.28, base);
    d *= 1.0 - smoothstep(uRadius * 0.55, uRadius * 0.98, length(pos));
    return clamp(d, 0.0, 1.0) * max(uDensity, 0.0);
  }

  void main(){
    vec3 rd = normalize(vWorld - uCam);
    // ray vs the cloud sphere (centred at origin) → the [t0,t1] segment to march
    float b = dot(uCam, rd);
    float c = dot(uCam, uCam) - uRadius * uRadius;
    float h = b * b - c;
    if(h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0);
    float t1 = -b + h;
    float seg = t1 - t0;
    if(seg <= 0.0) discard;
    float dt = seg / float(max(uSteps, 1));
    float jit = hash(rd * 811.0 + fract(uTime)) * dt; // step-banding dither keyed to the WORLD ray dir → continuous across cubemap faces (no seam in refraction)

    vec3 drift = vec3(uTime * uSpeed * 0.08, uTime * uSpeed * 0.03, -uTime * uSpeed * 0.05);
    vec3 sun = normalize(uSunDir + vec3(1e-5)); // guard against a zero sun vector
    float lightStep = uRadius * 0.05; // short stride for the secondary (shadow) march

    // forward-scatter boost: a gentle Henyey-Greenstein-ish lobe along the sun direction (constant per fragment)
    float gsc = 0.5;
    float g2 = gsc * gsc;
    float ct = dot(rd, sun);
    float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * gsc * ct, 1e-3), 1.5);
    hg = 1.0 + 0.6 * clamp(hg - 1.0, 0.0, 4.0);

    vec3 col = vec3(0.0); // accumulated PREMULTIPLIED colour
    float trans = 1.0;    // view-ray transmittance (1 = fully clear)

    for(int i = 0; i < 40; i++){
      if(i >= uSteps) break;
      float t = t0 + (float(i) + 0.5) * dt + jit;
      vec3 pos = uCam + rd * t;
      float dens = cloudDensity(pos, drift);
      // Hero (uGemR > 0, depth-test off): keep the gem readable through the clouds. For rays that pass through the
      // gem, DROP clouds behind it (the gem occludes them) and only LIGHTEN clouds in front (a soft veil) — all via
      // smoothstep so there's no hard spherical edge. Rays that miss the gem are untouched (full clouds around it).
      if(uGemR > 0.0){
        float tMid = max(-dot(uCam, rd), 0.0);                                  // closest-approach param to the gem (origin)
        float m = length(uCam + rd * tMid);                                     // perpendicular distance of the ray to the gem
        float central = 1.0 - smoothstep(uGemR * 0.7, uGemR * 1.7, m);          // 1 = ray through the gem, 0 = misses it
        float behind = smoothstep(tMid - uGemR * 0.5, tMid + uGemR * 0.5, t);   // 0 = in front of the gem, 1 = behind it
        dens *= 1.0 - central * mix(0.6, 1.0, behind);                          // front: light veil; behind: fully occluded
      }
      if(dens > 0.002){
        // SECONDARY march toward the sun → optical depth → Beer's-law light transmittance (self-shadowing)
        float ld = 0.0;
        for(int j = 0; j < 6; j++){
          vec3 lp = pos + sun * (float(j) + 0.5) * lightStep;
          ld += cloudDensity(lp, drift) * lightStep;
        }
        float lightTrans = exp(-ld * 3.5);
        vec3 shade = mix(uColDark, uColLight, lightTrans); // shadowed underside → sunlit top
        shade *= hg;                                       // forward-scatter glow toward the sun
        // front-to-back: this step's coverage of the view ray (Beer-Lambert), then composite under what's ahead.
        float aStep = 1.0 - exp(-dens * dt * 2.5);
        col += trans * aStep * shade; // premultiplied contribution, weighted by remaining transmittance
        trans *= 1.0 - aStep;
      }
      if(trans < 0.02) break; // early-out once the ray is essentially opaque
    }

    float alpha = 1.0 - trans;
    if(alpha < 0.003) discard;
    // col is already premultiplied by alpha; the material's premultipliedAlpha flag makes NormalBlending consume
    // it as src + dst*(1-srcA), so the clouds correctly OCCLUDE + darken the scene behind them.
    gl_FragColor = vec4(col, alpha);
  }
`

const CLOUD_RADIUS = 22

// `gemOcclude` > 0 (the hero: a gem of ~that bounding radius sits at the origin) makes the clouds render in
// front of AND around the gem — depth-test off + the march clipped at the gem so it veils the gem yet is
// occluded by it. 0 (orrery/dioramas) keeps the clouds a depth-tested far backdrop.
export function CloudLayer({ options, gemOcclude = 0 }: { options: CloudLayerOptions; gemOcclude?: number }) {
  const g = useGfxPreset()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const steps = Math.min(40, Math.max(12, Math.round(g.raySteps * 0.3))) // ~14 (low) → ~34 (high), clamp 12..40
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColLight: { value: new THREE.Color(options.colorLight).convertSRGBToLinear() },
      uColDark: { value: new THREE.Color(options.colorDark).convertSRGBToLinear() },
      uSunDir: { value: new THREE.Vector3(...(options.sunDir ?? [0.5, 0.8, 0.3])) },
      uDensity: { value: options.density },
      uCoverage: { value: options.coverage },
      uSpeed: { value: options.speed },
      uScale: { value: options.scale ?? 0.5 },
      uRadius: { value: CLOUD_RADIUS },
      uGemR: { value: gemOcclude },
      uSteps: { value: steps },
    }),
    [options, steps, gemOcclude],
  )
  useFrame((state) => {
    const m = matRef.current
    if (!m) return
    // wrap time to a bounded period so the fbm drift never grows unbounded over a long session
    m.uniforms.uTime.value = state.clock.elapsedTime % 3600
    m.uniforms.uCam.value.copy(state.camera.position)
  })
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[CLOUD_RADIUS, 32, 24]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={CLOUD_VERT}
        fragmentShader={CLOUD_FRAG}
        uniforms={uniforms}
        transparent
        premultipliedAlpha
        depthWrite={false}
        depthTest={gemOcclude <= 0}
        side={THREE.BackSide}
        blending={THREE.NormalBlending}
      />
    </mesh>
  )
}
