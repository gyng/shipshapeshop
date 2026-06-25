import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useCubeCamera, Sparkles } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Stage, HERO_CAMERA } from './Stage'
import { HeroGem, RARITY_RANK, RARITY_COLOR } from './Gem'
import { RaymarchGem, RAYMARCH_SHAPES } from './RaymarchGem'
import { buildDioramaPtScene } from './geometry'
import { ExpeditionPathTrace } from './ExpeditionPathTrace'
import { PathTraceGem } from './PathTraceGem'
import { MeshPathTraceGem } from './MeshPathTraceGem'
import { RenderTechBadge, type RenderTech } from './RenderTechBadge'
import { Polytope4D, POLYTOPES_4D, type Poly4DControls } from './Polytope4D'
import { Atmosphere } from './Atmosphere'
import { sceneById, atmosphereById, lightingById, gemFinishById, heroCursorById, dioramaById, gemColorById, SLOT_ATMOSPHERE, SLOT_LIGHTING, SLOT_FINISH, SLOT_HERO_CURSOR, SLOT_POSTFX, SLOT_DIORAMA, SLOT_GEM_COLOR } from '../content/cosmetics'
import { postFxPasses } from './ScenePostFX'
import { useGame, type RarityName } from '../game/store'
import { useGfx, useGfxPreset, usePathTraceParams, PT_PRESETS, type PathTraceParams } from '../gfx'
import { useT } from '../i18n'

// SDF families whose distance eval is so heavy (a neural net / deep escape-time or IFS-fold loop, or a
// high-degree polynomial that finite-differences inside its own distance estimator) that multi-bounce path
// tracing them hangs or blacks out the GPU. The deg-6 Barth sextic / deg-8 Endrass octic are ~140× costlier per
// eval than a primitive, so multiplied by the per-frame spp × bounces × march-steps they overrun the budget.
// They always render via the single-ray raymarch instead (which handles them fine, and looks nearly identical) —
// so under the 'all' PT scope they still render, just not multi-bounce.
const PT_TOO_HEAVY = new Set(['stanford_bunny', 'mandelbulb', 'sierpinski', 'barth_sextic', 'endrass_octic'])

// How often the live atmosphere cubemap re-captures. drei's <CubeCamera frames={Infinity}> re-renders the cube
// (6 full atmosphere renders) EVERY frame — the single biggest cheap cost on the SDF hero. The atmosphere drifts
// slowly (clouds/nebula/aurora over seconds), so refreshing only every Nth frame is imperceptible while cutting
// that cost ~6×. The gem still refracts/reflects the atmosphere from the most-recent capture.
const ENV_CUBE_EVERY = 6

// A throttled drop-in for drei's <CubeCamera> (whose `frames` prop is total-frames-to-render, NOT periodic, so
// it can't express "every Nth frame"). Mirrors drei's component exactly — hides its children during capture so
// the cube records the sibling <Atmosphere> — but gates the actual `update()` to every ENV_CUBE_EVERY frames.
function ThrottledCubeCamera({ resolution, every, children }: { resolution: number; every: number; children: (tex: import('three').Texture) => ReactNode }) {
  const { fbo, camera, update } = useCubeCamera({ resolution })
  const groupRef = useRef<import('three').Group>(null)
  const count = useRef(0)
  useFrame(() => {
    if (!groupRef.current) return
    // refresh on the first frame, then once every `every` frames (the rest reuse the last capture)
    if (count.current % every === 0) {
      groupRef.current.visible = false // hide the gem so the cube captures only the surrounding atmosphere
      update()
      groupRef.current.visible = true
    }
    count.current++
  })
  return (
    <group>
      <primitive object={camera} />
      <group ref={groupRef}>{children(fbo.texture)}</group>
    </group>
  )
}

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
 * The focused/hero gem. SDF shapes are **raymarched** (true refraction) unless an equipped Diorama puts the gem
 * inside a physical set (that geometry only exists in the mesh path); the raymarch cosmos is re-tinted from the
 * equipped scene's palette so the same gem reads consistently everywhere. Everything else (incl. the Relic meshes, now
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
  previewLighting,
  previewCursor,
  previewPostfx,
  previewFinish,
  previewDiorama,
  previewGemColor,
  poly4d,
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
  previewLighting?: number // shop/viewer preview: light with this (unequipped) Lighting mood
  previewCursor?: number // shop/viewer preview: this (unequipped) hero-cursor follow-light
  previewPostfx?: number // shop/viewer preview: grade with this (unequipped) Film Look post-FX
  previewFinish?: number // shop hover-preview: show this (unequipped) gem finish (mesh hero only)
  previewDiorama?: number // shop/viewer preview: place the gem in this (unequipped) diorama set
  previewGemColor?: number // shop/viewer preview: tint the gem body with this (unequipped) Gem Colour
  poly4d?: Poly4DControls // viewer-only: manual 4D rotation (6 planes) + projection distance for polytopes
}) {
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(sceneId)
  const g = useGfxPreset()
  const rank = RARITY_RANK[rarity]
  const ptScope = useGfx((s) => s.pathTrace)
  const rarityMotes = useGfx((s) => s.rarityMotes) // rarity now reads as floating motes around the gem, not a body tint
  const ptParams = usePathTraceParams()
  const tr = useT()
  const quality = useGfx((s) => s.quality)
  const ptEnvCube = useGfx((s) => s.ptEnvCube)
  const ptEnvCubeRes = useGfx((s) => s.ptEnvCubeRes)
  const meshPtCycle = useGfx((s) => s.meshPtCycle)
  // The cosmetic/render layers shaping this hero view — surfaced in the render-tech badge tooltip.
  const equippedAtmoId = useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0)
  const equippedPostfxId = useGame((s) => s.view?.equipped?.[SLOT_POSTFX] ?? 0) // Film Look cosmetic on the hero composer
  const atmo = atmosphereById(previewAtmosphere ?? equippedAtmoId)
  const atmoName = atmo.name
  const equippedLightingId = useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)
  const lightName = lightingById(previewLighting ?? equippedLightingId).name
  const finishName = gemFinishById(useGame((s) => s.view?.equipped?.[SLOT_FINISH] ?? 0)).name
  const equippedCursorId = useGame((s) => s.view?.equipped?.[SLOT_HERO_CURSOR] ?? 0)
  const heroCursor = heroCursorById(previewCursor ?? equippedCursorId)
  const equippedDioramaId = useGame((s) => s.view?.equipped?.[SLOT_DIORAMA] ?? 0)
  const diorama = dioramaById(previewDiorama ?? equippedDioramaId) // a "setting" of geometry around the gem (slot 11)
  const dioramaActive = diorama.kind !== 'none' // an active diorama routes the gem through the mesh-transmission path
  const layers = [
    { label: tr('render.layer.scene'), value: scene.name },
    { label: tr('render.layer.atmosphere'), value: atmoName },
    { label: tr('render.layer.lighting'), value: lightName },
    { label: tr('render.layer.finish'), value: finishName },
    // surface the cursor follow-light only when one is equipped (id 0 = Off → omit, keep the tooltip uncluttered)
    ...(heroCursor.intensity > 0 ? [{ label: tr('render.layer.spotlight'), value: heroCursor.name }] : []),
    ...(dioramaActive ? [{ label: tr('render.layer.diorama'), value: diorama.name }] : []),
  ]
  // per-view renderer override: clicking the render badge cycles an SDF gem between raymarch ↔ path-traced,
  // independent of the global gfx setting (null = follow that setting).
  const [renderMode, setRenderMode] = useState<'raymarched' | 'pathtraced' | 'meshpt' | 'mesh' | null>(null)
  // pause the path-traced hero's auto-spin so the image settles + converges (and the demand loop idles the GPU).
  // Resets to spinning whenever the inspected gem changes, so each new gem opens alive.
  const [paused, setPaused] = useState(false)
  useEffect(() => { setPaused(false) }, [family, rarity])
  // Path-traced dioramas: when a set is equipped + path tracing is on (the non-compact inspector), bake the SET +
  // the gem into one multi-object PT scene and trace it all (real GI — the Cornell box bleeds colour, the campfire
  // lights the glass). Kinds without a PT recipe → null → fall through to the rasterised mesh-transmission set.
  const equippedGemColorId = useGame((s) => s.view?.equipped?.[SLOT_GEM_COLOR] ?? 0)
  const gemColorHex = gemColorById(previewGemColor ?? equippedGemColorId).color
  const dioramaPtScene = useMemo(
    () => (dioramaActive && ptScope !== 'off' && !compact && controls) ? buildDioramaPtScene(family, gemColorHex, rank, diorama.kind) : null,
    [dioramaActive, ptScope, compact, controls, family, gemColorHex, rank, diorama.kind],
  )
  let content: ReactNode
  let tech: RenderTech
  let cycleRenderer: (() => void) | undefined // set for SDF gems where the badge can toggle the renderer
  if (dioramaPtScene) {
    tech = 'meshpt'
    content = (
      <Canvas frameloop={frameloop} resize={{ offsetSize: true }} className={controls ? 'orbit-canvas' : undefined} camera={{ position: HERO_CAMERA, fov: 42 }} dpr={g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <ExpeditionPathTrace scene={dioramaPtScene} backdrop="#1c1c2a" keyCol="#54586c" controls={false} orbit={false} converge particles={false} />
      </Canvas>
    )
  } else if (family in RAYMARCH_SHAPES && !dioramaActive) {
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
    // COMPACT previews (mascots, reveal, shop hover) under 'all' scope path-trace at the SAME cost as the inspector
    // by default — wasteful since they're tiny and often several at once. Drop them to the cheap `low` PT preset
    // (fewer spp/bounces/steps + lower render-scale); the interactive inspector keeps the user's live (Beautiful) params.
    const effPtParams: PathTraceParams = compact ? PT_PRESETS.low : ptParams
    const ptDpr = (g.dpr as [number, number]).map((d) => d * effPtParams.scale) as [number, number]
    tech = pathTraced ? 'pathtraced' : 'raymarched'
    // The gem REFRACTS/REFLECTS the real atmosphere via a live cubemap captured around it (drei CubeCamera hides
    // its children during capture, so the cube records the sibling <Atmosphere> — clouds, nebula, AND particles
    // like petals/meteors/motes). So a gem occludes what's directly behind it (depth) yet still shows it THROUGH
    // the glass (refraction) — a real glass interaction, not a flat overlay. It's 6 extra renders/frame, so it's
    // gated to any non-Clear mood on a setup that already opted into cost: path-tracing OR High gfx. (gfx
    // `quality` tops out at 'high' and is independent of the path-trace toggle, which defaults gfx to medium.)
    const captureEnv = !compact && ptEnvCube && atmo.id !== 0 && (pathTraced || quality === 'high')
    // NOTE — Gem Spotlight (hero cursor light, slot 9): the single-ray RaymarchGem reads the pointer and adds a
    // tracking specular/rim in its shader (uCursor* uniforms). The multi-bounce PathTraceGem is DEFERRED: its
    // lighting is a closed env() sampled over many stochastic bounces with temporal accumulation, so injecting a
    // moving cursor light would force a buffer reset every pointer move (perpetual non-convergence) — a real
    // follow-up. So when an SDF hero is path-traced, the cursor light simply doesn't apply (the mesh/4D + raymarch
    // paths cover it). The mesh/transmission + 4D heroes get a true r3f follow-light via <HeroCursorLight/> in Stage.
    const gem = (envMap: import('three').Texture | null) =>
      pathTraced
        ? <PathTraceGem key={family + rarity} family={family} rarity={rarity} controls={controls} autoRotate={autoRotate && !paused} paused={paused} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewLighting={previewLighting} previewFinish={previewFinish} previewGemColor={previewGemColor} envMap={envMap} />
        : <RaymarchGem key={family + rarity} family={family} rarity={rarity} controls={controls} autoRotate={autoRotate} materialize={materialize} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewLighting={previewLighting} previewCursor={previewCursor} previewFinish={previewFinish} previewGemColor={previewGemColor} envMap={envMap} />
    const gemEl = captureEnv
      ? <ThrottledCubeCamera resolution={ptEnvCubeRes} every={ENV_CUBE_EVERY}>{(tex) => gem(tex)}</ThrottledCubeCamera>
      : gem(null)
    // Equipped Atmosphere on the SDF hero — real gl_FragDepth means it depth-composites WITH the gem (clouds veil
    // it, occluded behind it) + its haze/hue feed the refraction; on HIGH gfx + skyey moods the gem refracts it.
    const atmoEl = <Atmosphere defaultFog={null} fog fogNearMin={6} overrideId={previewAtmosphere} gemOcclude={1.3} moteScale={[8, 6, 6]} motePos={[0, 0, 0]} />
    // rarity now reads as floating rarity-coloured motes around the gem (not a body tint). On the full hero only.
    const rarityMoteEl = !compact && rarityMotes ? <Sparkles count={Math.round((16 + rank * 18) * g.sparkle)} scale={[4.6, 4.4, 4.6]} size={3.2 + rank * 0.3} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} /> : null
    const sceneBody = <>{gemEl}{atmoEl}{rarityMoteEl}</>
    // Both the path-traced + raymarch SDF heroes auto-spin via uTime, so they run on the continuous loop. An
    // explicit `frameloop` prop (e.g. 'never' for hidden previews) always wins. (Temporal accumulation — a
    // demand-loop converge-then-idle pass — was reverted: its off-screen FBO render never reached the composer.)
    const ptFrameloop = frameloop // SDF keeps rendering even when paused so its ambient motes keep drifting (gem spin freezes via the clock split, not by stopping the loop)
    content = (
      <Canvas frameloop={ptFrameloop} resize={{ offsetSize: true }} className={controls ? 'orbit-canvas' : undefined} camera={{ position: HERO_CAMERA, fov: 42 }} dpr={pathTraced ? ptDpr : g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        {/* previews (hover/mascot/compact): compile the gem + atmosphere shaders OFF-SCREEN and reveal once linked,
            so settling on a new preview never freezes a frame compiling. The interactive inspector renders directly. */}
        {(!controls || compact) ? <ShaderGate key={family + rarity}>{sceneBody}</ShaderGate> : sceneBody}
        <EffectComposer multisampling={0}>
          {[
            ...(g.bloom && !compact ? [<Bloom key="bloom" mipmapBlur luminanceThreshold={0.8} intensity={0.5 + rank * 0.22} levels={7} />] : []),
            ...(compact ? [] : [<Vignette key="vig" offset={0.32} darkness={0.5} />]),
            <ToneMapping key="tonemap" mode={ToneMappingMode.ACES_FILMIC} />,
            ...postFxPasses(previewPostfx ?? equippedPostfxId, compact), // equipped/previewed Film Look cosmetic (grain/chroma/scanlines/grade)
          ]}
        </EffectComposer>
      </Canvas>
    )
  } else if (POLYTOPES_4D.has(family)) {
    // 4D polytopes: the REAL ℝ⁴ projection (glowing glass-tube edges), inside the Stage for env + bloom + orbit.
    tech = 'polytope4d'
    content = (
      <Stage controls={controls} autoRotate={autoRotate} rarity={rarity} motes={motes} compact={compact} frameloop={frameloop} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewLighting={previewLighting} previewCursor={previewCursor} previewPostfx={previewPostfx} previewDiorama={previewDiorama}>
        <Polytope4D family={family} rarity={rarity} materialize={materialize} poly4d={poly4d} previewGemColor={previewGemColor} />
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
    // a Diorama needs the gem inside the Stage scene (its own Canvas/FBO has no Stage), so force mesh-transmission
    const meshPt = (renderMode === 'meshpt' || meshPtDefault) && !dioramaActive
    // the badge cycles mesh-transmission ↔ mesh-PT. From the default-on state, the first toggle drops to
    // transmission ('mesh'); otherwise it toggles meshpt ↔ null (= follow the default).
    if (controls && !compact && meshPtCycle) cycleRenderer = () => setRenderMode(meshPt ? 'mesh' : 'meshpt')
    if (meshPt) {
      tech = 'meshpt'
      // Scale the mesh-PT canvas dpr by the path-trace render-scale, same as the SDF tracer (ptDpr above). The BVH
      // tracer is HEAVIER per sample than the SDF tracer, so it must not run its display/composite passes at a
      // HIGHER buffer resolution than the lighter path. (The trace FBO itself already scales by ptp.scale off the
      // CSS size, independent of dpr — so this only lowers the blit/sparkle-composite res, never double-scales the trace.)
      const meshPtDpr = (g.dpr as [number, number]).map((d) => d * ptParams.scale) as [number, number]
      // demand frameloop: the BVH tracer now temporally ACCUMULATES (converge-then-idle), self-invalidating while
      // converging / the spin settles, then going quiet. An explicit `frameloop` prop (e.g. 'never') still wins.
      content = (
        <Canvas frameloop={frameloop ?? 'demand'} resize={{ offsetSize: true }} className="orbit-canvas" camera={{ position: HERO_CAMERA, fov: 42 }} dpr={meshPtDpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <MeshPathTraceGem family={family} rarity={rarity} controls={controls} paused={paused} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewLighting={previewLighting} previewFinish={previewFinish} previewGemColor={previewGemColor} envMap={null} />
        </Canvas>
      )
    } else {
      tech = 'mesh'
      content = (
        <Stage controls={controls} autoRotate={autoRotate} rarity={rarity} motes={motes} compact={compact} frameloop={frameloop} previewScene={previewScene} previewAtmosphere={previewAtmosphere} previewLighting={previewLighting} previewCursor={previewCursor} previewPostfx={previewPostfx} previewDiorama={previewDiorama}>
          <HeroGem family={family} rarity={rarity} spin={spin} materialize={materialize} finishOverride={previewFinish} previewGemColor={previewGemColor} />
        </Stage>
      )
    }
  }
  // Render-tech badge: a flat DOM overlay (a sibling of the canvas in a relative wrapper, NOT inside the 3D
  // scene) — only in the interactive inspector, not compact previews.
  if (!controls || compact) return content
  // a path-traced hero spins forever (SDF) or converge-then-idles (mesh) — let the viewer FREEZE the spin so the
  // image settles to a clean still (and the demand loop idles the GPU). Only for the two path-traced techs.
  const canPause = tech === 'pathtraced' || tech === 'meshpt'
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {content}
      <RenderTechBadge tech={tech} layers={layers} onCycle={cycleRenderer} />
      {canPause && (
        <button
          onClick={() => setPaused((p) => !p)}
          title={tr('render.pauseSpinTip')}
          style={{
            position: 'absolute', left: 8, bottom: 8, zIndex: 5, padding: '4px 10px', borderRadius: 999, fontSize: 12,
            lineHeight: 1.4, background: paused ? 'rgba(120,150,210,0.28)' : 'rgba(10,12,20,0.55)', color: '#d4e2ff',
            border: '1px solid rgba(140,165,220,0.34)', cursor: 'pointer', backdropFilter: 'blur(6px)', userSelect: 'none',
          }}
        >
          {paused ? tr('render.resumeSpin') : tr('render.pauseSpin')}
        </button>
      )}
    </div>
  )
}
