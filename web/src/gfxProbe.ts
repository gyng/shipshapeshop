// One-time boot GPU-tier probe. There is no per-device perf telemetry, so on FIRST RUN (no persisted gfx
// settings) we make a coarse low/mid/high guess from cheap signals and seed the path-trace scope + quality from
// it — so a weak phone doesn't open on the full 'all' + 'high' path tracer and stutter, while a strong desktop
// still gets the premium look. PERSIST always wins: this only changes first-run defaults (see gfx.ts load()).
//
// Signals (all heuristic, all cheap, none authoritative):
//   • WebGL UNMASKED_RENDERER_WEBGL — the GPU string (e.g. "Apple M2", "NVIDIA RTX 3080", "Mali-G57", "Adreno 640").
//   • navigator.hardwareConcurrency — logical CPU cores (rough proxy for device class).
//   • navigator.deviceMemory — RAM in GB (Chromium only; undefined elsewhere).
//   • a mobile user-agent check — phones/tablets are GPU-bound and should never default to the heaviest path.
//
// Robustness: the renderer string is frequently masked (Safari, privacy modes) or generic ("ANGLE (...)",
// "WebKit WebGL"). When the signals are unreliable/unknown we deliberately fall back to a SAFE MID tier rather
// than guessing high. So the worst case is "a strong machine briefly opens on mid until the user bumps it",
// never "a weak machine opens on the heaviest preset and stutters".

export type GpuTier = 'low' | 'mid' | 'high'

// Marker substrings (lower-cased) for clearly low-end / mobile GPUs → force the low tier regardless of CPU/RAM.
const LOW_GPU_MARKERS = ['mali', 'adreno', 'powervr', 'videocore', 'apple gpu', 'swiftshader', 'llvmpipe', 'software']
// Marker substrings for clearly high-end discrete GPUs → allow the high tier (if CPU/RAM don't contradict).
const HIGH_GPU_MARKERS = [
  'rtx', 'radeon rx', 'geforce', 'nvidia', 'quadro',
  'apple m1', 'apple m2', 'apple m3', 'apple m4', // Apple Silicon desktops/laptops are strong
  'arc a', 'radeon pro',
]

function isMobileUA(): boolean {
  try {
    const ua = navigator.userAgent || ''
    return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua)
  } catch {
    return false
  }
}

/** Read the unmasked GPU renderer string via WebGL, lower-cased. Returns '' if unavailable/masked. */
function readRenderer(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    // UNMASKED_RENDERER_WEBGL = 0x9246; ext is null when the browser masks it (Safari, privacy modes).
    const renderer = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : ''
    // best-effort context cleanup so the throwaway canvas doesn't linger
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return (renderer || '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Classify the device into a coarse GPU tier from cheap heuristics. Pure given its inputs (the renderer string +
 * navigator fields) — defaults to a SAFE MID when the signals are unreliable (masked renderer, ANGLE wrapper,
 * Safari) so we never open a weak device on the heaviest preset.
 */
export function classifyTier(opts?: { renderer?: string; cores?: number; memory?: number; mobile?: boolean }): GpuTier {
  const renderer = (opts?.renderer ?? readRenderer())
  const cores = opts?.cores ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) ?? 0
  // deviceMemory is Chromium-only and undefined elsewhere → treat undefined as "unknown", not "low".
  const memory = opts?.memory ?? (typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined)
  const mobile = opts?.mobile ?? isMobileUA()

  // 1) Mobile is GPU-bound → never default above LOW (the user can still bump it in Settings).
  if (mobile) return 'low'

  // 2) An explicit low-end / software GPU marker forces LOW.
  if (renderer && LOW_GPU_MARKERS.some((m) => renderer.includes(m))) return 'low'

  // 3) A clear high-end GPU marker → HIGH, but only if the CPU/RAM don't contradict it (≥8 cores, and ≥8GB when
  //    deviceMemory is reported at all; unknown memory is allowed through since most non-Chromium browsers hide it).
  if (renderer && HIGH_GPU_MARKERS.some((m) => renderer.includes(m))) {
    const ramOk = memory === undefined || memory >= 8
    if (cores >= 8 && ramOk) return 'high'
    return 'mid'
  }

  // 4) Unknown/masked renderer (Safari, ANGLE generic, privacy modes): lean on CPU/RAM, but cap at MID — we don't
  //    trust an unknown GPU enough to open on the heaviest path. Very weak boxes (≤2 cores or ≤2GB) drop to LOW.
  if ((cores > 0 && cores <= 2) || (memory !== undefined && memory <= 2)) return 'low'
  return 'mid'
}

export interface TierDefaults {
  pathTrace: 'hero' | 'all'
  quality: 'low' | 'medium' | 'high'
}

// First-run path-trace scope + quality seeded per tier. Low keeps the path tracer to the interactive inspector
// only ('hero') so the gallery/mascots/popups stay on the cheap mesh/raymarch path; mid matches the shipped
// 'all' + 'medium'; high keeps the full premium 'all' + 'high'. (Per spec — PERSIST still overrides all of this.)
export function tierDefaults(tier: GpuTier): TierDefaults {
  switch (tier) {
    case 'low':
      return { pathTrace: 'hero', quality: 'medium' }
    case 'high':
      return { pathTrace: 'all', quality: 'high' }
    case 'mid':
    default:
      return { pathTrace: 'all', quality: 'medium' }
  }
}

// Memoize the probe so we only touch WebGL/UA once per session.
let cached: GpuTier | null = null
export function detectGpuTier(): GpuTier {
  if (cached) return cached
  cached = classifyTier()
  return cached
}
