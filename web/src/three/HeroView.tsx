import { useState, useEffect, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CubeCamera } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Stage } from './Stage'
import { HeroGem, RARITY_RANK } from './Gem'
import { RaymarchGem, RAYMARCH_SHAPES } from './RaymarchGem'
import { PathTraceGem } from './PathTraceGem'
import { MeshPathTraceGem } from './MeshPathTraceGem'
import { RenderTechBadge, type RenderTech } from './RenderTechBadge'
import { Polytope4D, POLYTOPES_4D } from './Polytope4D'
import { Atmosphere } from './Atmosphere'
import { sceneById, atmosphereById, lightingById, gemFinishById, SLOT_ATMOSPHERE, SLOT_LIGHTING, SLOT_FINISH } from '../content/cosmetics'
import { useGame, type RarityName } from '../game/store'
import { useGfx, useGfxPreset, usePathTraceParams } from '../gfx'
import { useT } from '../i18n'

// SDF families whose distance eval is so heavy (a neural net / deep escape-time or IFS-fold loop) that
// multi-bounce path tracing them hangs or blacks out the GPU. They always render via the single-ray raymarch
// instead (which handles them fine) — so under the 'all' PT scope they still render, just not multi-bounce.
const PT_TOO_HEAVY = new Set(['stanford_bunny', 'mandelbulb', 'sierpinski'])

// Compile the SDF preview gem's shader OFF-SCREEN (gl.compileAsync → KHR_parallel_shader_compile, non-blocking)
// and only reveal it once linked — so settling on a new preview shape doesn't freeze a frame compiling. The gem
// is kept invisible until then (compile() still compiles invisible materials; the render loop skips them, so no
// blocking sync compile happens). A timeout fallback reveals it regardless, so it can never get stuck if the
// extension is missing or behaves oddly. Keyed by family at the call site, so it re-gates per shape.
function ShaderGate({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const reveal = () => { if (!cancelled) { cancelled = true; setReady(true) } }
    // Off-screen pre-compile, but START it on a short delay so a RAPID hover-switch CANCELS it (the cleanup
    // clearTimeout fires before compileAsync begins). That race — three's compileAsync polling a gem that the
    // next hover unmounts+disposes — is what threw "Cannot read properties of undefined (reading 'isReady')"
    // from inside three's internal poll (un-catchable once started). The 450ms fallback still guarantees reveal.
    const start = window.setTimeout(() => {
      try {
        const p = (gl as unknown as { compileAsync?: (s: typeof scene, c: typeof camera) => Promise<unknown> }).compileAsync?.(scene, camera)
        if (p && typeof p.then === 'function') p.then(reveal, reveal)
        else reveal()
      } catch {
        reveal()
      }
    }, 60)
    const fallback = window.setTimeout(reveal, 450)
    return () => { cancelled = true; window.clearTimeout(start); window.clearTimeout(fallback) }
  }, [gl, scene, camera])
  return <group visible={ready}>{children}</group>
}

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
  previewScene,
  previewAtmosphere,
  previewFinish,
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
  previewScene?: number // shop hover-preview: render the gem in this (unequipped) scene instead of the equipped one
  previewAtmosphere?: number // shop hover-preview: show this (unequipped) atmosphere
  previewFinish?: number // shop hover-preview: show this (unequipped) gem finish (mesh hero only)
}) {
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(sceneId)
  const g = useGfxPreset()
  const rank = RARITY_RANK[rarity]
  const ptScope = useGfx((s) => s.pathTrace)
  const ptParams = usePathTraceParams()
  const tr = useT()
  const quality = useGfx((s) => s.quality)
  const ptEnvCube = useGfx((s) => s.ptEnvCube)
  const ptEnvCubeRes = useGfx((s) => s.ptEnvCubeRes)
  const meshPtCycle = useGfx((s) => s.meshPtCycle)
  // The cosmetic/render layers shaping this hero view — surfaced in the render-tech badge tooltip.
  const equippedAtmoId = useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)
  const atmo = atmosphereById(previewAtmosphere ?? equippedAtmoId)
  const atmoName = atmo.name
  const lightName = lightingById(useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)).name
  const finishName = gemFinishById(useGame((s) => s.view?.equipped?.[SLOT_FINISH] ?? 0)).name
  const layers = [
    { label: tr('render.layer.scene'), value: scene.name },
    { label: tr('render.layer.atmosphere'), value: atmoName },
    { label: tr('render.layer.lighting'), value: lightName },
    { label: tr('render.layer.finish'), value: finishName },
  ]
  // per-view renderer override: clicking the render badge cycles an SDF gem between raymarch ↔ path-traced,
  // independent of the global gfx setting (null = follow that setting).
  const [renderMode, setRenderMode] = useState<'raymarched' | 'pathtraced' | 'meshpt' | 'mesh' | null>(null)
  let content: ReactNode
  let tech: RenderTech
  let cycleRenderer: (() => void) | undefined // set for SDF gems where the badge can toggle the renderer
  if (family in RAYMARCH_SHAPES && scene.special !== 'cornell') {
    // PT + single-ray raymarch both render ONE HDR fullscreen quad and share ONE post chain (Bloom in HDR →
    // ACES) — the SAME grade the mesh hero gets. A few SDFs are per-eval catastrophic for multi-bounce tracing
    // (the neural-net bunny, the Mandelbulb) → always raymarched. PT lowers the canvas dpr by its render-scale.
    // 'all' scope path-traces EVERY hero view — including compact previews (mascots, shop/popup previews) so
    // they match the inspector; 'hero' is the interactive inspector only (not compact). Heavy SDFs stay raymarched.
    const autoPathTraced = (ptScope === 'all' || (ptScope === 'hero' && controls && !compact)) && !PT_TOO_HEAVY.has(family)
    const pathTraced = renderMode === 'pathtraced' ? true : renderMode === 'raymarched' ? false : autoPathTraced
    // the badge can toggle PT ↔ raymarch in the interactive inspector for SDFs that can path-trace
    if (controls && !compact && !PT_TOO_HEAVY.has(family)) {
      cycleRenderer = () => setRenderMode(pathTraced ? 'raymarched' : 'pathtraced')
    }
    const ptDpr = (g.dpr as [number, number]).map((d) => d * ptParams.scale) as [number, number]
    tech = pathTraced ? 'pathtraced' : 'raymarched'
    // The gem REFRACTS/REFLECTS the real atmosphere via a live cubemap captured around it (drei CubeCamera hides
    // its children during capture, so the cube records the sibling <Atmosphere> — clouds, nebula, AND particles
    // like petals/meteors/motes). So a gem occludes what's directly behind it (depth) yet still shows it THROUGH
    // the glass (refraction) — a real glass interaction, not a flat overlay. It's 6 extra renders/frame, so it's
    // gated to any non-Clear mood on a setup that already opted into cost: path-tracing OR High gfx. (gfx
    // `quality` tops out at 'high' and is independent of the path-trace toggle, which defaults gfx to medium.)
    const captureEnv = !compact && ptEnvCube && atmo.id !== 0 && (pathTraced || quality === 'high')
    const gem = (envMap: import('three').Texture | null) =>
      pathTraced
        ? <PathTraceGem key={family + rarity} family={family} rarity={rarity} controls={controls} autoRotate={autoRotate} previewScene={previewScene} previewFinish={previewFinish} envMap={envMap} />
        : <RaymarchGem key={family + rarity} family={family} rarity={rarity} controls={controls} autoRotate={autoRotate} materialize={materialize} previewScene={previewScene} previewFinish={previewFinish} envMap={envMap} />
    const gemEl = captureEnv
      ? <CubeCamera resolution={ptEnvCubeRes} frames={Infinity} position={[0, 0, 0]}>{(tex) => gem(tex)}</CubeCamera>
      : gem(null)
    // Equipped Atmosphere on the SDF hero — real gl_FragDepth means it depth-composites WITH the gem (clouds veil
    // it, occluded behind it) + its haze/hue feed the refraction; on HIGH gfx + skyey moods the gem refracts it.
    const atmoEl = <Atmosphere defaultFog={null} fog fogNearMin={6} overrideId={previewAtmosphere} gemOcclude={1.3} moteScale={[8, 6, 6]} motePos={[0, 0, 0]} />
    const sceneBody = <>{gemEl}{atmoEl}</>
    content = (
      <Canvas frameloop={frameloop} resize={{ offsetSize: true }} className={controls ? 'orbit-canvas' : undefined} camera={{ position: [0, 0, 5], fov: 42 }} dpr={pathTraced ? ptDpr : g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        {/* previews (hover/mascot/compact): compile the gem + atmosphere shaders OFF-SCREEN and reveal once linked,
            so settling on a new preview never freezes a frame compiling. The interactive inspector renders directly. */}
        {(!controls || compact) ? <ShaderGate key={family + rarity}>{sceneBody}</ShaderGate> : sceneBody}
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
      <Stage controls={controls} autoRotate={autoRotate} rarity={rarity} motes={motes} compact={compact} frameloop={frameloop} previewScene={previewScene} previewAtmosphere={previewAtmosphere}>
        <Polytope4D family={family} rarity={rarity} materialize={materialize} />
      </Stage>
    )
  } else {
    // Mesh shapes default to MeshTransmissionMaterial (fast, pretty), BUT under the 'all' path-trace scope the
    // BVH PATH TRACER becomes the default for the interactive inspector / non-compact hero — so mesh-only shapes
    // (csaszar, hopf, knots, Klein…) get the premium traced look that grades identically to the SDF path tracer,
    // without manually toggling the badge. The badge still cycles mesh-transmission ↔ mesh-PT.
    //
    // PERF: the BVH tracer is heavy (a full stack-walk per ray, no shared post chain). We default it ON only for
    // `controls && !compact` (the inspector + the big hero). COMPACT previews (gallery thumbnails, mascots) — where
    // many render at once — keep the cheap MeshTransmissionMaterial; a BVH tracer per thumbnail would tank perf.
    // (This is a deliberate slight inconsistency vs SDF compact previews, which DO path-trace under 'all' because
    // a single analytic-SDF fullscreen quad is far cheaper than walking a BVH per thumbnail.)
    const meshPtDefault = renderMode === null && ptScope === 'all' && meshPtCycle && controls && !compact
    const meshPt = renderMode === 'meshpt' || meshPtDefault
    // the badge cycles mesh-transmission ↔ mesh-PT. From the default-on state, the first toggle drops to
    // transmission ('mesh'); otherwise it toggles meshpt ↔ null (= follow the default).
    if (controls && !compact && meshPtCycle) cycleRenderer = () => setRenderMode(meshPt ? 'mesh' : 'meshpt')
    if (meshPt) {
      tech = 'meshpt'
      content = (
        <Canvas frameloop={frameloop} resize={{ offsetSize: true }} className="orbit-canvas" camera={{ position: [0, 0, 5], fov: 42 }} dpr={g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <MeshPathTraceGem family={family} rarity={rarity} controls={controls} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewFinish={previewFinish} envMap={null} />
        </Canvas>
      )
    } else {
      tech = 'mesh'
      content = (
        <Stage controls={controls} autoRotate={autoRotate} rarity={rarity} motes={motes} compact={compact} frameloop={frameloop} previewScene={previewScene} previewAtmosphere={previewAtmosphere}>
          <HeroGem family={family} rarity={rarity} spin={spin} materialize={materialize} finishOverride={previewFinish} />
        </Stage>
      )
    }
  }
  // Render-tech badge: a flat DOM overlay (a sibling of the canvas in a relative wrapper, NOT inside the 3D
  // scene) — only in the interactive inspector, not compact previews.
  if (!controls || compact) return content
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {content}
      <RenderTechBadge tech={tech} layers={layers} onCycle={cycleRenderer} />
    </div>
  )
}
