import { useEffect } from 'react'
import { create } from 'zustand'
import { detectGpuTier, tierDefaults } from './gfxProbe'

// Graphics quality — scales the fidelity-affecting costs (DPR, transmission samples/resolution, raymarch
// steps, shadows, particle density, star count). Persisted; surfaced in Settings ▸ Graphics. On top of the
// preset, a few INDIVIDUAL overrides let tinkerers dial specifics (shadows, particle/star density) + an FPS meter.
export type Quality = 'low' | 'medium' | 'high'
// Path tracing (three-gpu-pathtracer) — TRUE multi-bounce GI + caustics through the glass, converging while the
// camera is idle. Scope: off · hero (the interactive inspector only) · all (every focused hero view). It takes
// over the render loop, so the gem stops spinning + the sparkle/star layers (Points) drop out — a clean
// product-shot mode. Quality tiers map to bounce depth + render scale (see PT_QUALITY in HeroPathTracer).
export type PathTraceScope = 'off' | 'hero' | 'all'
export type PathTraceQuality = 'low' | 'medium' | 'high' | 'extreme' | 'ultra' | 'max'

// Path-trace presets → the four tunable params. A preset seeds them; each is then individually overridable in
// Settings (null override = follow the preset). bounces = light-path depth · steps = interior march resolution ·
// scale = render-buffer scale (0–1, lower = faster/softer) · spp = Monte-Carlo samples accumulated per frame.
export interface PathTraceParams { bounces: number; steps: number; scale: number; spp: number }
// spp is per-frame now (the auto-spin re-traces each frame), so it doubles as the real-time-quality knob. These
// are tuned for the fast SDF tracer; the mesh BVH tracer is heavier per sample — drop spp there if it dips.
// SANE per-frame budgets. The tracer re-traces EVERY frame (auto-spin resets accumulation), so the per-frame
// cost is spp × bounces × march-steps × the SDF eval — this must stay modest or the GPU hangs / the unrolled
// GLSL-ES-1.00 loop overruns program limits. (An earlier "pump it up" pass set ultra to 80 spp × 32 bounces ×
// 256 steps ≈ a third of a million SDF evals per pixel per frame → instant freeze. Don't do that.)
export const PT_PRESETS: Record<PathTraceQuality, PathTraceParams> = {
  // Premium tiers + a `max` ceiling (2026-06). spp × bounces × steps must stay ≤ 150000 evals/px/frame and
  // bounces × steps ≤ 4000 unrolled iterations (the GPU-freeze + shader-program-size guards in glsl.test.ts;
  // the freeze wall was 655k / 8192). `scale` is free of the eval budget, so every tier from extreme up runs
  // at full render resolution.
  low: { bounces: 4, steps: 56, scale: 0.6, spp: 6 }, //       1,344
  medium: { bounces: 5, steps: 72, scale: 0.8, spp: 10 }, //   3,600
  high: { bounces: 7, steps: 96, scale: 0.9, spp: 20 }, //    13,440
  extreme: { bounces: 8, steps: 128, scale: 1.0, spp: 30 }, // 30,720
  ultra: { bounces: 10, steps: 176, scale: 1.0, spp: 44 }, //  77,440
  max: { bounces: 12, steps: 192, scale: 1.0, spp: 52 }, //   119,808
}

export interface GfxPreset {
  dpr: [number, number]
  transSamples: number
  transRes: number
  raySteps: number
  rayInner: number
  shadows: boolean
  sparkle: number // particle-count multiplier
  stars: number
  bloom: boolean // selective HDR bloom post pass on the hero canvases (off on low — extra mip chain/frame)
  heroBackside: boolean // back-face double-refraction pass on closed-solid hero gems (off on low — 2× transmission)
  sceneGlass: boolean // render the diorama/board gems (Orrery, Lounge, Factory, Forge) as transmission glass
  // (built-in MeshPhysicalMaterial → ONE shared transmission buffer per canvas, ~1 extra scene render/frame)
  // instead of opaque emissive PBR. Off on low.
  dof: boolean // depth-of-field bokeh on the hero (focus the gem, melt the background). Opt-in (off by default
  // on every tier — it's a taste + cost call); a Vignette always rides the hero post chain when bloom is on.
  ssao: boolean // ground-contact ambient occlusion (N8AO, depth-based — no normal pass). The closest thing to
  // "GI" we can afford: darkens crevices/contacts on the opaque diorama floors/decor + Cornell corners. Opt-in
  // (off by default; ~nil effect on a lone floating glass gem, and it can't touch the raymarched SDF heroes).
  hdri: boolean // light the hero gem with a real HDRI environment (rich real-world reflections in the glass)
  // instead of the scene-tinted Lightformer rig. Hero-only, background stays the dark stage. Opt-in.
}

const PRESETS: Record<Quality, GfxPreset> = {
  low: { dpr: [1, 1], transSamples: 2, transRes: 128, raySteps: 48, rayInner: 16, shadows: false, sparkle: 0.35, stars: 500, bloom: false, heroBackside: false, sceneGlass: false, dof: false, ssao: false, hdri: false },
  medium: { dpr: [1, 1.5], transSamples: 4, transRes: 256, raySteps: 80, rayInner: 28, shadows: false, sparkle: 0.8, stars: 1100, bloom: true, heroBackside: true, sceneGlass: true, dof: false, ssao: false, hdri: false },
  high: { dpr: [1, 2], transSamples: 6, transRes: 512, raySteps: 112, rayInner: 40, shadows: true, sparkle: 1.25, stars: 1800, bloom: true, heroBackside: true, sceneGlass: true, dof: false, ssao: false, hdri: false },
}

// Per-control overrides layered over the quality preset. `shadows: null` = follow the preset; the scales
// multiply the preset's particle/star counts (1 = preset, 0 = off, up to 1.5 = denser).
export interface GfxSettings {
  quality: Quality
  showFps: boolean
  shadows: boolean | null
  particleScale: number
  starScale: number
  bloom: boolean | null // null = follow the quality preset; true/false = explicit user override
  sceneGlass: boolean | null
  heroBackside: boolean | null
  dof: boolean | null
  ssao: boolean | null
  hdri: boolean | null
  pathTrace: PathTraceScope // custom GLSL path tracer scope (off · hero inspector · all hero views)
  pathTraceQuality: PathTraceQuality // the preset that seeds the four params below
  ptBounces: number | null // per-param overrides (null = follow the preset)
  ptSteps: number | null
  ptScale: number | null
  ptSpp: number | null
  ptHaze: number // volumetric single-scatter haze density on the path-traced hero (0 = off; ~0.1–0.4 gentle→smoky)
  ptEnvCube: boolean // refract/reflect the equipped Atmosphere via a live cubemap (skyey moods, path-traced or high gfx)
  ptEnvCubeRes: number // atmosphere-cubemap capture resolution (64 cheap → 256 crisp); the main perf knob
  ptEnvCubeAmt: number // how strongly the gem's refraction/reflection takes the atmosphere (0 = off, 1 = full)
  meshPtCycle: boolean // allow cycling mesh shapes into the BVH path tracer via the render badge (off in the default flow)
}
// Path tracing defaults ON for ALL hero views (the premium refraction look everywhere). The only SDFs heavy
// enough to blow the multi-bounce budget (neural bunny, Mandelbulb) auto-fall-back to the single-ray raymarch
// via PT_TOO_HEAVY in HeroView, so 'all' is safe by construction. (If a future SDF hangs, add it to that set.)
const DEFAULTS: GfxSettings = { quality: 'medium', showFps: false, shadows: null, particleScale: 1, starScale: 1, bloom: null, sceneGlass: null, heroBackside: null, dof: null, ssao: null, hdri: null, pathTrace: 'all', pathTraceQuality: 'high', ptBounces: null, ptSteps: null, ptScale: null, ptSpp: null, ptHaze: 0.05, ptEnvCube: true, ptEnvCubeRes: 128, ptEnvCubeAmt: 0.7, meshPtCycle: true }

// v2: reset persisted gfx once — earlier builds could persist a catastrophic path-trace preset (spp 80 / 32
// bounces) that freezes the GPU on load. Bumping the key drops stale settings so everyone lands on safe defaults.
const KEY = 'shipshape-gfx-v3' // v3: path tracing now defaults ON ('all' views) — drop stale 'off' persists so everyone lands on the new default

// First-run defaults seeded from a coarse GPU-tier probe (gfxProbe.ts): a weak/mobile device opens on a lighter
// path-trace scope + quality, a strong desktop keeps the full premium look. ONLY the path-trace scope + quality
// are tier-seeded; everything else stays at DEFAULTS. PERSIST always wins — once the user has saved settings
// (any `raw`), the probe is ignored entirely, so this never overrides a returning player's chosen look.
function firstRunDefaults(): GfxSettings {
  try {
    const td = tierDefaults(detectGpuTier())
    return { ...DEFAULTS, pathTrace: td.pathTrace, quality: td.quality }
  } catch {
    return DEFAULTS // probe failed (no WebGL/navigator) → ship the safe shipped defaults
  }
}

function load(): GfxSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return firstRunDefaults() // no persisted setting → seed scope+quality from the GPU tier
    if (raw === 'low' || raw === 'medium' || raw === 'high') return { ...DEFAULTS, quality: raw } // back-compat: bare quality string
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GfxSettings>) }
  } catch {
    return DEFAULTS
  }
}

// ── FPS watchdog (auto-degrade, ratchet DOWN only) ───────────────────────────────────────────────────────────
// A passive safety net: if the smoothed frame rate stays low for a sustained window, step graphics down ONCE
// (quality high→medium→low, then path-trace scope all→hero) and surface a one-line toast — then NEVER touch it
// again this session (it never auto-raises; the player stays in control via Settings). This protects weak
// hardware the boot probe (item 6) under-estimated, without ever fighting a player who deliberately cranked it up.
const WATCHDOG = {
  ewma: 60, // smoothed fps (exponential moving average) — seeded optimistic so we don't trip on the first frame
  lowMs: 0, // accumulated time the smoothed fps has been under the floor (resets the instant fps recovers → hysteresis)
  warmupMs: 0, // skip the first ~second (first-frame shader compiles + tab-switch stalls would false-trigger)
  fired: false, // one-shot latch: the watchdog degrades at most ONCE per session
}
const WD_FPS_FLOOR = 40 // smoothed fps below this is "struggling"
const WD_SUSTAIN_MS = 2000 // must stay low this long before acting (hysteresis — a brief dip won't trip it)
const WD_WARMUP_MS = 1000 // ignore the first second (compile/layout stalls)
const WD_ALPHA = 0.1 // EWMA smoothing factor (≈ last ~10 frames dominate)

interface GfxStore extends GfxSettings {
  watchdogToast: string | null // a transient one-line message when graphics auto-step down (null = none). NOT persisted.
  setQuality: (q: Quality) => void
  update: (patch: Partial<GfxSettings>) => void
  sampleFps: (dtMs: number) => void // per-frame tick: feeds the EWMA + may trip the one-shot auto-degrade
  dismissWatchdog: () => void
}
export const useGfx = create<GfxStore>((set, get) => {
  const persist = (s: GfxSettings) => {
    try {
      // serialize the whole settings object (JSON.stringify drops the store's action fns) so a new GfxSettings
      // field can't silently fail to persist — no hand-kept whitelist to drift out of sync. The transient
      // watchdogToast is stripped first so it never leaks into the saved blob.
      const { watchdogToast: _t, ...rest } = s as GfxSettings & { watchdogToast?: string | null }
      void _t
      localStorage.setItem(KEY, JSON.stringify(rest))
    } catch {
      /* ignore */
    }
  }
  return {
    ...load(),
    watchdogToast: null,
    setQuality: (q) => {
      // Picking a tier re-establishes it as the master: clear every per-feature override so the toggles below
      // follow the new preset again (back to "Auto"), and reset the density multipliers to 1× (= the preset).
      const next: Partial<GfxSettings> = { quality: q, shadows: null, bloom: null, sceneGlass: null, heroBackside: null, dof: null, ssao: null, hdri: null, particleScale: 1, starScale: 1 }
      persist({ ...get(), ...next })
      set(next)
    },
    update: (patch) => {
      persist({ ...get(), ...patch })
      set(patch)
    },
    dismissWatchdog: () => set({ watchdogToast: null }),
    sampleFps: (dtMs) => {
      if (WATCHDOG.fired) return // one-shot: already degraded this session
      if (!(dtMs > 0) || dtMs > 1000) return // ignore zero/negative + huge gaps (tab was backgrounded → not a real stall)
      // warm-up: ignore the first ~second so first-frame shader compiles / layout don't false-trigger.
      if (WATCHDOG.warmupMs < WD_WARMUP_MS) { WATCHDOG.warmupMs += dtMs; return }
      const inst = 1000 / dtMs
      WATCHDOG.ewma = WATCHDOG.ewma + WD_ALPHA * (inst - WATCHDOG.ewma)
      // hysteresis: only count CONTIGUOUS low time — the moment fps recovers above the floor, reset the timer.
      if (WATCHDOG.ewma < WD_FPS_FLOOR) WATCHDOG.lowMs += dtMs
      else { WATCHDOG.lowMs = 0; return }
      if (WATCHDOG.lowMs < WD_SUSTAIN_MS) return
      // sustained low → step DOWN once. quality high→medium→low first; if already at low, drop the PT scope all→hero.
      WATCHDOG.fired = true
      const s = get()
      const patch: Partial<GfxSettings> = {}
      if (s.quality === 'high') patch.quality = 'medium'
      else if (s.quality === 'medium') patch.quality = 'low'
      else if (s.pathTrace === 'all') patch.pathTrace = 'hero'
      else return // already at the floor (low quality + hero scope) — nothing left to drop; stay quiet
      // dropping the quality tier re-establishes it as master (clear per-feature overrides), matching setQuality.
      if (patch.quality) Object.assign(patch, { shadows: null, bloom: null, sceneGlass: null, heroBackside: null, dof: null, ssao: null, hdri: null, particleScale: 1, starScale: 1 })
      persist({ ...s, ...patch })
      set(patch)
      set({ watchdogToast: 'gfx.autoLowered' }) // message-ID; the renderer resolves it via i18n. NOT persisted.
    },
  }
})

export const presetFor = (q: Quality): GfxPreset => PRESETS[q]

/** The effective preset: the quality preset with the individual overrides applied (shadows + particle/star scale). */
export function useGfxPreset(): GfxPreset {
  const quality = useGfx((s) => s.quality)
  const shadows = useGfx((s) => s.shadows)
  const particleScale = useGfx((s) => s.particleScale)
  const starScale = useGfx((s) => s.starScale)
  const bloom = useGfx((s) => s.bloom)
  const sceneGlass = useGfx((s) => s.sceneGlass)
  const heroBackside = useGfx((s) => s.heroBackside)
  const dof = useGfx((s) => s.dof)
  const ssao = useGfx((s) => s.ssao)
  const hdri = useGfx((s) => s.hdri)
  const p = PRESETS[quality]
  return {
    ...p,
    shadows: shadows ?? p.shadows,
    sparkle: p.sparkle * particleScale,
    stars: Math.round(p.stars * starScale),
    bloom: bloom ?? p.bloom,
    sceneGlass: sceneGlass ?? p.sceneGlass,
    heroBackside: heroBackside ?? p.heroBackside,
    dof: dof ?? p.dof,
    ssao: ssao ?? p.ssao,
    hdri: hdri ?? p.hdri,
  }
}

/** The effective path-trace params: the selected preset with any per-param overrides applied. */
export function usePathTraceParams(): PathTraceParams {
  const q = useGfx((s) => s.pathTraceQuality)
  const b = useGfx((s) => s.ptBounces)
  const st = useGfx((s) => s.ptSteps)
  const sc = useGfx((s) => s.ptScale)
  const sp = useGfx((s) => s.ptSpp)
  const p = PT_PRESETS[q]
  return { bounces: b ?? p.bounces, steps: st ?? p.steps, scale: sc ?? p.scale, spp: sp ?? p.spp }
}

/**
 * Mount-once passive FPS watchdog. A standalone requestAnimationFrame loop (independent of any Canvas, like
 * FpsMeter) that feeds each frame's delta into the gfx store's `sampleFps` — which smooths it (EWMA) and, if the
 * frame rate stays low for a sustained window, auto-steps graphics DOWN once. Cheap (just a timestamp diff per
 * frame) and self-disarming after one trip. Mount it ONCE near the app root.
 */
export function useFpsWatchdog(): void {
  const sampleFps = useGfx((s) => s.sampleFps)
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dt = t - last
      last = t
      sampleFps(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sampleFps])
}
