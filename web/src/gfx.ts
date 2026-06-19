import { create } from 'zustand'

// Graphics quality — scales the fidelity-affecting costs (DPR, transmission samples/resolution, raymarch
// steps, shadows, particle density, star count). Persisted; surfaced in Settings ▸ Graphics.
export type Quality = 'low' | 'medium' | 'high'

export interface GfxPreset {
  dpr: [number, number]
  transSamples: number
  transRes: number
  raySteps: number
  rayInner: number
  shadows: boolean
  sparkle: number // particle-count multiplier
  stars: number
}

const PRESETS: Record<Quality, GfxPreset> = {
  low: { dpr: [1, 1], transSamples: 2, transRes: 128, raySteps: 48, rayInner: 16, shadows: false, sparkle: 0.35, stars: 500 },
  medium: { dpr: [1, 1.5], transSamples: 4, transRes: 256, raySteps: 80, rayInner: 28, shadows: false, sparkle: 0.8, stars: 1100 },
  high: { dpr: [1, 2], transSamples: 6, transRes: 512, raySteps: 112, rayInner: 40, shadows: true, sparkle: 1.25, stars: 1800 },
}

const KEY = 'shipshape-gfx'
function load(): Quality {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'low' || v === 'high' ? v : 'medium'
  } catch {
    return 'medium'
  }
}

interface GfxStore {
  quality: Quality
  setQuality: (q: Quality) => void
}
export const useGfx = create<GfxStore>((set) => ({
  quality: load(),
  setQuality: (q) => {
    try {
      localStorage.setItem(KEY, q)
    } catch {
      /* ignore */
    }
    set({ quality: q })
  },
}))

export const presetFor = (q: Quality): GfxPreset => PRESETS[q]
export const useGfxPreset = (): GfxPreset => presetFor(useGfx((s) => s.quality))
