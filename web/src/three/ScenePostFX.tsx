import { useMemo, type ReactElement } from 'react'
import * as THREE from 'three'
import { EffectComposer, Bloom, ToneMapping, Vignette, DepthOfField, N8AO, Noise, ChromaticAberration, Scanline, HueSaturation, BrightnessContrast } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useGfxPreset } from '../gfx'
import { useGame } from '../game/store'
import { atmosphereById, postFxById, SLOT_ATMOSPHERE, SLOT_POSTFX } from '../content/cosmetics'
import { HeatShimmer } from './HeatShimmer'

// build the equipped Postprocessing cosmetic's passes (film grain / chroma / scanlines / colour grade). Shared by
// the scene composer (ScenePostFX) AND the hero composer (HeroView) so the look matches. Runs AFTER tone mapping —
// these grade the final image. id 0 = None → []. Compact previews skip it (return []).
export function postFxPasses(slotPostfx: number, compact: boolean): ReactElement[] {
  const p = postFxById(slotPostfx)
  if (p.id === 0 || compact) return []
  const out: ReactElement[] = []
  if (p.grade && ((p.grade.brightness ?? 0) !== 0 || (p.grade.contrast ?? 0) !== 0)) out.push(<BrightnessContrast key="pf-bc" brightness={p.grade.brightness ?? 0} contrast={p.grade.contrast ?? 0} />)
  if (p.grade && ((p.grade.saturation ?? 0) !== 0 || (p.grade.hue ?? 0) !== 0)) out.push(<HueSaturation key="pf-hs" hue={p.grade.hue ?? 0} saturation={p.grade.saturation ?? 0} />)
  if (p.chroma) out.push(<ChromaticAberration key="pf-ca" offset={new THREE.Vector2(p.chroma.offset, p.chroma.offset)} />)
  if (p.scanlines) out.push(<Scanline key="pf-sl" density={p.scanlines.density} opacity={p.scanlines.opacity} />)
  if (p.grain) out.push(<Noise key="pf-gr" premultiply opacity={p.grain.intensity} />)
  return out
}

/**
 * The shared post chain for the real-geometry scenes (the hero Stage + the diorama boards): ONE definition of
 * the SSAO → DoF → Bloom → Vignette → ACES order, gated by the gfx settings. Centralising it means a new effect
 * (or a tweak) is a single edit, not six copies. Returns null when nothing is enabled — then the renderer's own
 * ACES grades the frame (the `low` tier path), so the look matches across tiers.
 *
 * The raymarched SDF hero keeps its OWN inline composer (HeroView): it's a fullscreen distance-field quad with
 * no scene depth buffer, so the depth-based effects here (SSAO, DoF) can't apply to it.
 */
export function ScenePostFX({
  bloomIntensity = 0.5,
  bloomThreshold = 0.9,
  bloomLevels = 6,
  dof = false,
  vignette = false,
  compact = false,
  previewPostfx,
}: {
  bloomIntensity?: number
  bloomThreshold?: number
  bloomLevels?: number
  dof?: boolean // does THIS scene allow DoF (hero only) — still gated by the gfx.dof setting
  vignette?: boolean
  compact?: boolean // small embedded previews drop bloom/dof/vignette (keep only ACES)
  previewPostfx?: number // viewer/shop preview: grade with an UNequipped Film Look without equipping it
}) {
  const g = useGfxPreset()
  // DoF focus point MUST be a Vector3 (the effect reads .distanceTo each frame); a plain [0,0,0] array → NaN
  // focus distance → a runaway bokeh gather that hangs the GPU. Memoised so it's not reallocated per render.
  const dofTarget = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  const shimmer = atmosphereById(useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)).shimmer
  const equippedPostfx = useGame((s) => s.view?.equipped?.[SLOT_POSTFX] ?? 0)
  const pfPasses = postFxPasses(previewPostfx ?? equippedPostfx, compact) // equipped/previewed Film Look cosmetic
  const useAo = g.ssao
  const useDof = g.dof && dof && !compact
  const useBloom = g.bloom && !compact
  const useVig = vignette && !compact
  const useShimmer = !!shimmer && !compact // equipped Atmosphere's heat-haze (screen-space)
  if (!useAo && !useDof && !useBloom && !useShimmer && pfPasses.length === 0) return null // nothing enabled → renderer ACES grades the frame

  const fx: ReactElement[] = []
  // heat-haze first: a uv distortion the later effects then sample through
  if (useShimmer && shimmer) fx.push(<HeatShimmer key="shimmer" intensity={shimmer.intensity} speed={shimmer.speed} />)
  // AO first — darken contacts/crevices before the glow + tonemap. N8AO is depth-based (no normal pass).
  if (useAo) fx.push(<N8AO key="ao" halfRes aoRadius={0.6} distanceFalloff={1} intensity={2.2} />)
  // focus the centred gem (Vector3 target → tracks through orbit/zoom), in-focus band in WORLD units, and the
  // bokeh gather at 0.6× res so it stays cheap on top of the transmission passes.
  if (useDof) fx.push(<DepthOfField key="dof" target={dofTarget} worldFocusRange={3} bokehScale={2.4} resolutionScale={0.6} />)
  if (useBloom) fx.push(<Bloom key="bloom" mipmapBlur luminanceThreshold={bloomThreshold} intensity={bloomIntensity} levels={bloomLevels} />)
  if (useVig) fx.push(<Vignette key="vig" offset={0.32} darkness={0.5} />)
  fx.push(<ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />)
  for (const p of pfPasses) fx.push(p) // the equipped Film Look grades/grains the final tonemapped image
  return <EffectComposer multisampling={4}>{fx}</EffectComposer>
}
