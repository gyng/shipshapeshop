import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Stage } from './Stage'
import { HeroGem, RARITY_RANK } from './Gem'
import { RaymarchGem, RAYMARCH_SHAPES } from './RaymarchGem'
import { PathTraceGem } from './PathTraceGem'
import { RenderTechBadge, type RenderTech } from './RenderTechBadge'
import { Polytope4D, POLYTOPES_4D } from './Polytope4D'
import { sceneById } from '../content/cosmetics'
import { useGame, type RarityName } from '../game/store'
import { useGfx, useGfxPreset, usePathTraceParams } from '../gfx'

// SDF families whose distance eval is so heavy (a neural net / deep escape-time loop) that multi-bounce path
// tracing them hangs the GPU. They always render via the single-ray raymarch instead (which handles them fine).
const PT_TOO_HEAVY = new Set(['stanford_bunny', 'mandelbulb'])

/**
 * The focused/hero gem. SDF shapes are **raymarched** (true refraction) in every scene except the Cornell box
 * (whose physical room only exists in the mesh path); the raymarch cosmos is re-tinted from the equipped
 * scene's palette so the same gem reads consistently everywhere. Everything else (incl. the Relic meshes, now
 * loaded via the shared relics layer in HeroGem) goes through the mesh + transmission path. Both paths share
 * ONE post chain — selective Bloom in HDR, then ACES tone mapping — so the renderers grade identically.
 */
export function HeroView({
  family,
  rarity,
  controls = true,
  autoRotate = false,
  spin = 0.4,
  motes = true,
  compact = false,
  frameloop,
  materialize = false,
}: {
  family: string
  rarity: RarityName
  controls?: boolean
  autoRotate?: boolean // slowly orbit the camera (showcase previews like the pull screen) — pauses on drag
  spin?: number
  motes?: boolean
  compact?: boolean // small embedded previews: skip stars/bloom + low-res env (gem material unchanged)
  frameloop?: 'always' | 'demand' | 'never' // 'never' pauses the canvas (persistent-but-hidden previews)
  materialize?: boolean // reveal-only: the gem/polytope refracts into existence (form-in) on mount
}) {
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(sceneId)
  const g = useGfxPreset()
  const rank = RARITY_RANK[rarity]
  const ptScope = useGfx((s) => s.pathTrace)
  const ptParams = usePathTraceParams()
  let content: ReactNode
  let tech: RenderTech
  if (family in RAYMARCH_SHAPES && scene.special !== 'cornell') {
    // PT + single-ray raymarch both render ONE HDR fullscreen quad and share ONE post chain (Bloom in HDR →
    // ACES) — the SAME grade the mesh hero gets. A few SDFs are per-eval catastrophic for multi-bounce tracing
    // (the neural-net bunny, the Mandelbulb) → always raymarched. PT lowers the canvas dpr by its render-scale.
    const pathTraced = !compact && (ptScope === 'all' || (ptScope === 'hero' && controls)) && !PT_TOO_HEAVY.has(family)
    const ptDpr = (g.dpr as [number, number]).map((d) => d * ptParams.scale) as [number, number]
    tech = pathTraced ? 'pathtraced' : 'raymarched'
    content = (
      <Canvas frameloop={frameloop} resize={{ offsetSize: true }} className={controls ? 'orbit-canvas' : undefined} camera={{ position: [0, 0, 5], fov: 42 }} dpr={pathTraced ? ptDpr : g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        {pathTraced
          ? <PathTraceGem key={family + rarity} family={family} rarity={rarity} controls={controls} autoRotate={autoRotate} />
          : <RaymarchGem key={family + rarity} family={family} rarity={rarity} controls={controls} autoRotate={autoRotate} materialize={materialize} />}
        <EffectComposer multisampling={0}>
          {[
            ...(g.bloom && !compact ? [<Bloom key="bloom" mipmapBlur luminanceThreshold={0.8} intensity={0.5 + rank * 0.22} levels={7} />] : []),
            ...(compact ? [] : [<Vignette key="vig" offset={0.32} darkness={0.5} />]),
            <ToneMapping key="tonemap" mode={ToneMappingMode.ACES_FILMIC} />,
          ]}
        </EffectComposer>
      </Canvas>
    )
  } else if (POLYTOPES_4D.has(family)) {
    // 4D polytopes: the REAL ℝ⁴ projection (glowing glass-tube edges), inside the Stage for env + bloom + orbit.
    tech = 'polytope4d'
    content = (
      <Stage controls={controls} autoRotate={autoRotate} rarity={rarity} motes={motes} compact={compact} frameloop={frameloop}>
        <Polytope4D family={family} rarity={rarity} materialize={materialize} />
      </Stage>
    )
  } else {
    // Everything else → mesh + MeshTransmissionMaterial (the mesh BVH path tracer was too slow, so it's gone).
    tech = 'mesh'
    content = (
      <Stage controls={controls} autoRotate={autoRotate} rarity={rarity} motes={motes} compact={compact} frameloop={frameloop}>
        <HeroGem family={family} rarity={rarity} spin={spin} materialize={materialize} />
      </Stage>
    )
  }
  // Render-tech badge: a flat DOM overlay (a sibling of the canvas in a relative wrapper, NOT inside the 3D
  // scene) — only in the interactive inspector, not compact previews.
  if (!controls || compact) return content
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {content}
      <RenderTechBadge tech={tech} />
    </div>
  )
}
