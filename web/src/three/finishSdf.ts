import * as THREE from 'three'
import { gemFinishById } from '../content/cosmetics'

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
}

const lin = (hex: string) => {
  const c = new THREE.Color(hex).convertSRGBToLinear()
  return new THREE.Vector3(c.r, c.g, c.b)
}

export function finishSdf(finishId: number): FinishSdf {
  const m = gemFinishById(finishId).mat
  const tintHex = m.attenuationColor ?? m.colorTint // the finish's body colour, if it overrides one
  return {
    tint: tintHex ? lin(tintHex) : null,
    iorAdd: m.iorAdd ?? 0,
    aberrAdd: (m.chromaticAdd ?? 0) + (m.iridescence ?? 0) * 0.12, // fold thin-film shimmer into dispersion
    emissive: m.emissiveIntensity ?? 0,
    // transmissionMul < 1 → more opaque/dense → stronger Beer absorption (clamped so it never goes pitch-black)
    absorbMul: m.transmissionMul != null ? THREE.MathUtils.clamp(1 / Math.max(m.transmissionMul, 0.22), 1, 4) : 1,
    reflMul: m.envMapIntensityMul ?? 1,
  }
}
