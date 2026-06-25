import * as THREE from 'three'
import { create } from 'zustand'
import { gemFinishById, type GemFinishSpec, type LightingSpec } from '../content/cosmetics'

// Map an equipped Gem Finish (the Shop cosmetic, authored as PBR `mat` overrides for the mesh transmission gem)
// onto the SDF gems' shader uniforms (RaymarchGem / PathTraceGem), so finishes show on SDF/path-traced shapes
// too — not just the mesh path. It's an APPROXIMATION (the SDF gems don't have full clearcoat/roughness PBR), but
// it carries the finish's identity: body tint, refractive index, dispersion, density, inner glow, reflectivity.
// The default finish (Prism, mat = {}) maps to a perfect no-op, so un-finished gems are pixel-identical.
export interface FinishSdf {
  tint: THREE.Vector3 | null // body/attenuation colour (linear); null = keep the rarity colour
  iorAdd: number // added to the base index of refraction
  aberrAdd: number // added to the chromatic dispersion (raymarch only)
  emissive: number // inner-glow strength (0 = none)
  absorbMul: number // ≥1: denser/darker body from a low transmission (Obsidian, Smoky Quartz); 1 = default
  reflMul: number // env reflection strength multiplier
  matte: number // 0 = clear glass; >0 = opaque DIFFUSE surface (probability of a diffuse vs refract bounce) — true matte
  lensing: number // 0 = none; >0 = gravitational lensing, pinch the escaping background toward the gem (black hole)
  volumetric: number // 0 = none; >0 = the gem interior is a ray-marched fbm cloud/smoke at this density (cloud gem)
}

// ── Live material override (the Viewer's "Material" panel) ────────────────────────────────────────────────────
// A global, viewer-only override of the four optical params. The game never activates it (`active` stays false),
// so finishes there are untouched. When active these REPLACE whatever the equipped finish set — letting you dial
// any reflectivity/refractivity on top of a finish's colour/character. Routed through `withMatOverride` below so
// every gem path (raster Gem / SDF PathTrace + Raymarch / mesh MeshPathTrace) reads identical optics.
export interface MatOverride {
  active: boolean
  iorAdd: number // refraction bend, added to the base IOR
  transmissionMul: number // glassiness: 0 opaque → ~1.2 ultra-clear
  envMapIntensityMul: number // reflection / mirror strength
  roughness: number // polished → frosted
  set: (p: Partial<MatOverride>) => void
}
export const useMatOverride = create<MatOverride>((set) => ({
  active: false,
  iorAdd: 0,
  transmissionMul: 1,
  envMapIntensityMul: 1,
  roughness: 0.1,
  set: (p) => set(p),
}))

/** Merge the live override onto a finish's PBR `mat` (a no-op unless active). The one chokepoint every gem routes
 * its material through, so the Material sliders read identically across raster / SDF-PT / mesh-PT. */
export function withMatOverride(mat: GemFinishSpec['mat'], o: MatOverride | null): GemFinishSpec['mat'] {
  return o?.active
    ? { ...mat, iorAdd: o.iorAdd, transmissionMul: o.transmissionMul, envMapIntensityMul: o.envMapIntensityMul, roughness: o.roughness }
    : mat
}

const lin = (hex: string) => {
  const c = new THREE.Color(hex).convertSRGBToLinear()
  return new THREE.Vector3(c.r, c.g, c.b)
}

export function finishSdf(finishId: number, o: MatOverride | null = null): FinishSdf {
  const m = withMatOverride(gemFinishById(finishId).mat, o)
  const tintHex = m.attenuationColor ?? m.colorTint // the finish's body colour, if it overrides one
  return {
    tint: tintHex ? lin(tintHex) : null,
    iorAdd: m.iorAdd ?? 0,
    aberrAdd: (m.chromaticAdd ?? 0) + (m.iridescence ?? 0) * 0.12, // fold thin-film shimmer into dispersion
    emissive: m.emissiveIntensity ?? 0,
    // transmissionMul < 1 → more opaque/dense → stronger Beer absorption (clamped so it never goes pitch-black)
    absorbMul: m.transmissionMul != null ? THREE.MathUtils.clamp(1 / Math.max(m.transmissionMul, 0.22), 1, 4) : 1,
    reflMul: m.envMapIntensityMul ?? 1,
    // matte from roughness, but only ABOVE 0.35 so GLASS finishes that set a mild roughness for the mesh path stay
    // clear glass on the traced heroes too (Diamond/Chrome/Obsidian ~0.02–0.12, and the borderline Smoky Quartz 0.22,
    // Magma 0.30, Moon Pearl 0.32 → 0). Only the authored-rough finishes (Frosted 0.4, Matte Clay, Pitch, Chalk) go
    // diffuse. (Inferring matte from the mesh `roughness` is convenient but coupled — an explicit `mat.matte` would
    // fully decouple it; revisit if more glass finishes creep over the knee.)
    matte: THREE.MathUtils.clamp(((m.roughness ?? 0) - 0.35) / 0.6, 0, 1),
    lensing: m.lensing ?? 0,
    volumetric: m.volumetric ?? 0,
  }
}

// ── Lighting mood → the path tracer's env() key glow ──────────────────────────────────────────────────────────
// The visible "Moving light ✦" rigs (orbiting/ring/disco/tube…) only render as real r3f lights on the mesh/4D
// Stage. A PATH-TRACED hero has no r3f lights — it's lit by a closed env(). So the equipped Lighting mood was
// nearly invisible on PT heroes (only its ambient/key/rim multipliers applied). This animates the env()'s KEY
// glow from the mood so PT heroes SHOW it: the glint sweeps (orbit/ring/twinspin/chase), breathes (pulse),
// stutters (flicker/tube), takes the mood's hue, and cycles the rainbow for disco (ring + hueShift).
const BASE_KEY = new THREE.Vector3(0.35, 0.75, 0.40).normalize()
const _kc = new THREE.Color()
/** Write the animated key DIRECTION + linear hue TINT (normalized to a pure hue) into the given vectors; return the
 * key INTENSITY pulse. `t` is a free-running seconds clock (keeps animating even when the gem spin is paused). */
export function lightingKey(L: LightingSpec, t: number, dir: THREE.Vector3, tint: THREE.Vector3): number {
  const m = L.motion
  dir.copy(BASE_KEY)
  let pulse = 1
  if (m) {
    if (m.kind === 'orbit' || m.kind === 'twinspin' || m.kind === 'ring' || m.kind === 'chase') {
      const a = t * (m.orbitSpeed ?? 0.3) // the key glint sweeps around the gem
      dir.set(Math.cos(a) * 0.72, 0.5, Math.sin(a) * 0.72).normalize()
    } else if (m.kind === 'drift') {
      const s = m.driftSpeed ?? 0.5
      dir.set(0.35 + Math.sin(t * s) * 0.45, 0.72, 0.4 + Math.cos(t * s * 0.8) * 0.35).normalize()
    }
    if (m.pulseDepth) pulse = 1 + Math.sin(t * (m.pulseRate ?? 0.3) * Math.PI * 2) * m.pulseDepth
    if (m.kind === 'flicker' || (m.kind === 'tube' && (m.flickerRate ?? 0) > 0)) {
      const fr = m.flickerRate ?? 11
      pulse *= 0.72 + 0.2 * Math.sin(t * fr) + 0.12 * Math.sin(t * fr * 2.3 + 1)
    }
  }
  // tint: the mood's hue (disco cycles the rainbow). Convert to LINEAR, then normalize to max-channel-1 so it
  // recolours the glint without adding brightness (a neutral white mood → no visible change).
  if (m?.hueShift && (m.kind === 'ring' || m.kind === 'chase')) _kc.setHSL((t * 0.12 * m.hueShift) % 1, 0.72, 0.58)
  else _kc.set(L.hues[0] ?? '#ffffff')
  _kc.convertSRGBToLinear()
  const mx = Math.max(_kc.r, _kc.g, _kc.b, 0.001)
  tint.set(_kc.r / mx, _kc.g / mx, _kc.b / mx)
  return Math.max(0.15, pulse)
}
