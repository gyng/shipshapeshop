import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Stars, Sparkles } from '@react-three/drei'
import { Suspense, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGame, type RarityName } from '../game/store'
import { sceneById, lightingById, heroCursorById, dioramaById, SLOT_LIGHTING, SLOT_HERO_CURSOR, SLOT_DIORAMA, type LightingSpec } from '../content/cosmetics'
import { RARITY_COLOR } from './Gem'
import { ScenePostFX } from './ScenePostFX'
import { SceneDiorama } from './SceneDiorama'
import { Atmosphere } from './Atmosphere'
import { useGfxPreset, useGfx } from '../gfx'

// Default hero framing: a gentle 3/4 view (≈18° up, ≈18° around) instead of dead-on the equator — a straight
// [0,0,5] makes flat shapes (a disc, a coin) read edge-on. Shared by every HeroView canvas (SDF/mesh/mesh-PT)
// so the gem is framed identically everywhere; gems auto-spin around Y, so the elevation is what reads as depth.
export const HERO_CAMERA: [number, number, number] = [1.5, 1.5, 4.5]

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

/**
 * Animated lighting (the "Moving light ✦" moods). The drei <Environment> Lightformers bake to a cubemap and are
 * expensive to re-bake per frame, so instead of animating those we drive real r3f lights per frame — effectively
 * free — for any mood whose `motion` is set. The static env still provides the base IBL/reflections; these add the
 * visible motion on top. `MovingLights` dispatches by kind: single/twin point-lights (orbit/drift/pulse/twinspin/
 * flicker), a halo of N point-lights (ring/chase), or a fluorescent-style glowing tube bar (tube). Static moods
 * render nothing. (The SDF heroes can't use r3f lights — they read the L.ambient/key/rim multipliers statically.)
 */
function MovingLights({ L, rank, rarity }: { L: LightingSpec; rank: number; rarity: RarityName }) {
  const m = L.motion
  if (!m) return null
  if (m.kind === 'tube') return <TubeLights L={L} rank={rank} />
  if (m.kind === 'ring' || m.kind === 'chase') return <RingLights L={L} rank={rank} rarity={rarity} />
  return <PointLights L={L} rank={rank} rarity={rarity} />
}

// orbit / drift / pulse / twinspin / flicker — a warm key (+ a cool counter-light for twinspin).
function PointLights({ L, rank, rarity }: { L: LightingSpec; rank: number; rarity: RarityName }) {
  const a = useRef<THREE.PointLight>(null)
  const b = useRef<THREE.PointLight>(null)
  const m = L.motion!
  // flicker moods take their hue from the mood (neon cyan, candle warm); the rest keep the neutral warm key.
  const warmCol = useMemo(() => new THREE.Color(m.kind === 'flicker' ? (L.hues?.[0] ?? '#fff0d0') : '#fff0d0'), [m.kind, L.hues])
  const coolCol = useMemo(() => new THREE.Color(RARITY_COLOR[rarity]), [rarity])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const r = m.orbitRadius ?? 6
    const base = 2.4 + rank * 0.5
    const breath = m.pulseDepth ? 1 + Math.sin(t * (m.pulseRate ?? 0.3) * Math.PI * 2) * m.pulseDepth : 1
    if (a.current) {
      let factor = breath
      if (m.kind === 'orbit' || m.kind === 'twinspin') {
        const ang = t * (m.orbitSpeed ?? 0.3)
        a.current.position.set(Math.cos(ang) * r, 2.5 + Math.sin(ang * 0.5) * 1.2, Math.sin(ang) * r)
      } else if (m.kind === 'drift') {
        const s = m.driftSpeed ?? 0.5, amp = m.driftAmp ?? 2
        a.current.position.set(Math.sin(t * s) * amp + 3, 4 + Math.cos(t * s * 0.7) * amp * 0.6, 4 + Math.sin(t * s * 0.5) * amp * 0.5)
      } else if (m.kind === 'flicker') {
        a.current.position.set(3.5, 4.5, 4)
        const fr = m.flickerRate ?? 11 // layered fast sines → a nervous, never-steady stutter
        factor = Math.max(0.18, 0.66 + 0.18 * Math.sin(t * fr) + 0.1 * Math.sin(t * fr * 2.3 + 1.0) + 0.06 * Math.sin(t * fr * 5.1))
      } else {
        a.current.position.set(4, 5, 4) // pure pulse — fixed position, breathing intensity
      }
      a.current.intensity = base * (L.key ?? 1) * factor
      if (m.hueShift) { const hsl = { h: 0, s: 0, l: 0 }; warmCol.getHSL(hsl); a.current.color.setHSL((hsl.h + Math.sin(t * (m.pulseRate ?? 0.3)) * m.hueShift + 1) % 1, hsl.s, hsl.l) }
    }
    if (b.current && m.kind === 'twinspin') {
      const ang = -t * (m.orbitSpeed ?? 0.3) + Math.PI // counter-rotating, opposite side
      b.current.position.set(Math.cos(ang) * r, 2.5 + Math.sin(ang * 0.5) * 1.2, Math.sin(ang) * r)
      b.current.intensity = base * (L.rim ?? 1) * breath
    }
  })
  return (
    <>
      <pointLight ref={a} color={warmCol} intensity={(2.4 + rank * 0.5) * (L.key ?? 1)} distance={18} decay={1.3} />
      {m.kind === 'twinspin' && <pointLight ref={b} color={coolCol} intensity={(2.4 + rank * 0.5) * (L.rim ?? 1)} distance={18} decay={1.3} />}
    </>
  )
}

// ring — a halo of N point-lights circling the gem (even glamour fill); chase — a bright pulse laps the same ring.
function RingLights({ L, rank, rarity }: { L: LightingSpec; rank: number; rarity: RarityName }) {
  const m = L.motion!
  const group = useRef<THREE.Group>(null)
  const warmCol = useMemo(() => new THREE.Color('#fff0d0'), [])
  const coolCol = useMemo(() => new THREE.Color(RARITY_COLOR[rarity]), [rarity])
  const count = Math.min(8, Math.max(3, m.ringCount ?? 6))
  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    const r = m.orbitRadius ?? 6
    const base = (2.2 + rank * 0.45) * (L.key ?? 1)
    const spin = t * (m.orbitSpeed ?? 0.25)
    const lights = group.current.children as THREE.PointLight[]
    for (let i = 0; i < lights.length; i++) {
      const f = i / lights.length
      const ang = spin + f * Math.PI * 2
      lights[i].position.set(Math.cos(ang) * r, 2.2 + Math.sin(ang * 0.5) * 0.8, Math.sin(ang) * r)
      if (m.kind === 'chase') {
        const ph = ((t * (m.chaseSpeed ?? 0.6) - f) % 1 + 1) % 1 // a single bright pulse running the ring
        const d = Math.min(ph, 1 - ph)
        lights[i].intensity = base * (0.1 + 1.1 * Math.pow(Math.max(0, 1 - 2 * d), 3.0))
      } else {
        lights[i].intensity = base * 0.7 // even ring fill (split across the N lights)
      }
      if (m.hueShift) lights[i].color.setHSL((t * 0.12 * m.hueShift + f + 1) % 1, 0.7, 0.6) // a rotating rainbow ring (Disco Ring)
    }
  })
  return (
    <group ref={group}>
      {Array.from({ length: count }, (_, i) => (
        <pointLight key={i} color={i % 2 ? coolCol : warmCol} intensity={0} distance={16} decay={1.4} />
      ))}
    </group>
  )
}

// tube — one or two long glowing bars overhead, like a fluorescent fixture; flickerRate>0 gives the nervous buzz.
function TubeLights({ L, rank }: { L: LightingSpec; rank: number }) {
  const m = L.motion!
  const group = useRef<THREE.Group>(null)
  const col = useMemo(() => new THREE.Color(L.hues?.[0] ?? '#eaf4ff'), [L.hues])
  const tubes = Math.min(2, Math.max(1, m.tubeCount ?? 1))
  const fr = m.flickerRate ?? 0
  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    let fl = 1
    if (fr > 0) {
      const buzz = 0.9 + 0.06 * Math.sin(t * fr) + 0.04 * Math.sin(t * fr * 3.7 + 1)
      const strike = Math.sin(t * 0.6) > 0.95 ? 0.35 + 0.55 * Math.abs(Math.sin(t * 38)) : 1 // occasional dying-tube strobe
      fl = Math.max(0.25, buzz * strike)
    }
    const base = (2.8 + rank * 0.5) * (L.key ?? 1)
    for (const child of group.current.children) {
      const pl = child as THREE.PointLight
      if (pl.isPointLight) pl.intensity = base * fl
      else { const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial; if (mat?.color) mat.color.copy(col).multiplyScalar(1.5 * fl) }
    }
  })
  const offs = tubes === 2 ? [-0.9, 0.9] : [0]
  return (
    <group ref={group} position={[0, 4.3, 1.6]}>
      {offs.map((z, i) => (
        <mesh key={i} position={[0, 0, z]}><boxGeometry args={[7, 0.16, 0.16]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
      ))}
      <pointLight position={[-2.2, -0.5, 0]} color={col} intensity={0} distance={14} decay={1.4} />
      <pointLight position={[2.2, -0.5, 0]} color={col} intensity={0} distance={14} decay={1.4} />
    </group>
  )
}

/**
 * The hero cursor light (Shop "Gem Spotlight" cosmetic, slot 9 — default OFF). A soft point light placed each
 * frame at the pointer mapped onto the gem's plane, so a sweep of the cursor pulls a tracking specular/rim across
 * the focused gem. Active ONLY in the interactive inspector (gated by the caller). Shadowless (one cheap light
 * term). id 0 = Off → renders nothing. Disco moods hue-cycle.
 */
function HeroCursorLight({ previewCursor }: { previewCursor?: number }) {
  const equippedCursor = useGame((s) => s.view?.equipped?.[SLOT_HERO_CURSOR] ?? 0)
  const fx = heroCursorById(previewCursor ?? equippedCursor)
  const light = useRef<THREE.PointLight>(null)
  const { camera, pointer } = useThree()
  const ray = useMemo(() => new THREE.Raycaster(), [])
  // the gem sits at the origin; track the pointer on a camera-facing plane through it so the light orbits the
  // gem's front hemisphere as the cursor moves (a real, reactive highlight rather than a flat overlay).
  const plane = useMemo(() => new THREE.Plane(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const camDir = useMemo(() => new THREE.Vector3(), [])
  useFrame((state) => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(camDir)
    plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(0, 0, 0)) // plane through the gem, facing the camera
    ray.setFromCamera(pointer, camera)
    if (ray.ray.intersectPlane(plane, hit)) {
      // pull the light a little toward the camera off that plane so it grazes the surface for a crisp highlight
      l.position.copy(hit).addScaledVector(camDir, -1.6)
    }
    if (fx.disco) l.color.setHSL((state.clock.elapsedTime * 0.4) % 1, 0.85, 0.6)
  })
  if (fx.intensity <= 0) return null // "Off" (the default)
  return <pointLight ref={light} color={fx.color} intensity={fx.intensity} distance={fx.distance ?? 7} decay={1.6} />
}

/**
 * The hero stage. The selected Shop scene re-palettes the environment (the glass refracts/reflects it). No animated
 * distortion on the glass — both flicker with transmission.
 */
export function Stage({ children, controls = false, autoRotate = false, rarity = 'Common', compact = false, frameloop, previewScene, previewAtmosphere, previewLighting, previewCursor, previewPostfx, previewDiorama }: { children: ReactNode; controls?: boolean; autoRotate?: boolean; rarity?: RarityName; motes?: boolean; compact?: boolean; frameloop?: 'always' | 'demand' | 'never'; previewScene?: number; previewAtmosphere?: number; previewLighting?: number; previewCursor?: number; previewPostfx?: number; previewDiorama?: number }) {
  const storeScene = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(previewScene ?? storeScene) // shop hover-preview: show a scene without equipping it
  const equippedLighting = useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)
  const L = lightingById(previewLighting ?? equippedLighting) // equipped/previewed Lighting mood (Shop cosmetic)
  // equipped/previewed Diorama (slot 11) — a built set of geometry around the gem; supersedes the plain scene backdrop
  const equippedDiorama = useGame((s) => s.view?.equipped?.[SLOT_DIORAMA] ?? 0)
  const diorama = dioramaById(previewDiorama ?? equippedDiorama)
  const dioramaActive = diorama.kind !== 'none'
  const enclosedDiorama = dioramaActive && !!diorama.enclosed // walled set → keep the camera in the open front
  const rarityMotes = useGfx((s) => s.rarityMotes) // rarity reads as floating motes around the gem (not a body tint)
  const rank = RANK[rarity]
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  return (
    // `offsetSize` measures the un-transformed layout size — without it the canvas is sized while its modal is
    // mid `pop-in` scale animation and stays too small, leaving a black gap on the right/bottom edges.
    <Canvas frameloop={frameloop} resize={{ offsetSize: true }} className={controls ? 'orbit-canvas' : undefined} camera={{ position: HERO_CAMERA, fov: 42 }} dpr={g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={[dioramaActive ? '#0a0a0a' : '#0b0a16']} />
      <ambientLight intensity={0.45 * L.ambient} />
      {/* dioramas bring their OWN key light (firelight, torch, ceiling lamp…), so dim the stage's base key out of their way */}
      <directionalLight position={[4, 6, 5]} intensity={(dioramaActive ? 0.35 : 1.1) * L.key} />
      {/* rarity-hued rim/back light so the hero reads as a luminous jewel (stronger for rarer shapes) */}
      {!dioramaActive && <pointLight position={[-3.5, 2.5, -2]} intensity={(2.2 + rank) * L.rim} distance={16} decay={1.4} color={RARITY_COLOR[rarity]} />}
      {/* equipped "Moving light ✦" mood: animated key/fill lights that orbit, drift or breathe (static moods → null) */}
      {L.motion && <MovingLights L={L} rank={rank} rarity={rarity} />}
      {/* hero cursor light (Gem Spotlight, slot 9 — default OFF): a follow-light only in the interactive inspector */}
      {controls && !compact && <HeroCursorLight previewCursor={previewCursor} />}
      {dioramaActive ? (
        // A Diorama (slot 11): a built SET around the gem replaces the cosmos backdrop. The equipped Atmosphere still
        // drifts its motes/fog through the set (so atmosphere keeps interacting); the diorama brings its own geometry
        // + mood lights, and a neutral studio env gives the glass something to glint. (Renders on the mesh path only —
        // the gem refracts the set via transmission; the SDF/mesh path tracers can't see Stage geometry.)
        <>
          {!compact && <Sparkles count={Math.round((20 + rank * 18) * g.sparkle)} scale={[8, 6, 6]} size={2.2 + rank * 0.5} speed={0.18} opacity={0.6} color={scene.stars} />}
          {rarityMotes && <Sparkles count={Math.round((16 + rank * 18) * g.sparkle)} scale={[4.6, 4.4, 4.6]} size={3.2 + rank * 0.3} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} />}
          <Atmosphere defaultFog={null} fog fogNearMin={7} overrideId={previewAtmosphere} gemOcclude={1.3} moteScale={[8, 6, 6]} motePos={[0, 0, 0]} />
          <Suspense fallback={null}>
            {children}
            <SceneDiorama kind={diorama.kind} />
            <Environment resolution={compact ? 64 : 128} environmentIntensity={0.7}>
              <Lightformer form="rect" intensity={2.4} position={[4, 5, 4]} scale={[8, 8, 1]} color="#ffffff" />
              <Lightformer form="rect" intensity={1.2} position={[-5, 2, 3]} scale={[6, 8, 1]} color="#cfe0ff" />
            </Environment>
          </Suspense>
        </>
      ) : (
        <>
          {/* compact (small embedded previews): skip the star field entirely — invisible at preview size, pure cost */}
          {!compact && <Stars radius={60} depth={50} count={g.stars} factor={4} saturation={0.7} fade speed={0.3} />}
          {/* motes always render now (the per-view toggle is gone); the gfx particle setting (g.sparkle) still scales/disables them */}
          <Sparkles count={Math.round((36 + rank * 28) * g.sparkle)} scale={[8, 6, 6]} size={2.2 + rank * 0.5} speed={0.18} opacity={0.7} color={scene.stars} />
          {rarityMotes && <Sparkles count={Math.round((16 + rank * 18) * g.sparkle)} scale={[4.5, 4.5, 4.5]} size={3.2 + rank * 0.3} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} />}
          {/* equipped Atmosphere cosmetic: drifting motes + (full hero only) a backdrop fog whose start is pushed
              past the gem so the focal jewel stays crisp; compact previews stay fog-free to read cleanly */}
          <Atmosphere defaultFog={null} fog fogNearMin={6} overrideId={previewAtmosphere} gemOcclude={1.3} moteScale={[8, 6, 6]} motePos={[0, 0, 0]} />{/* gemOcclude → clouds veil the hero gem; overrideId = shop hover-preview */}
          <Suspense fallback={null}>
            {children}
            {g.hdri ? (
              // Real-world reflections in the glass via a studio HDRI (loaded by drei). background={false} keeps
              // the dark focused stage; the scene palette still tints the rim light + sparkles. To ship offline,
              // swap preset="studio" for files="/hdri/<your>.hdr".
              <Environment preset="studio" background={false} environmentIntensity={1.1} />
            ) : (
              <Environment resolution={compact ? 64 : 256} background backgroundBlurriness={0.75} backgroundIntensity={0.58} environmentIntensity={1.3}>
                <Lightformer form="rect" intensity={3} position={[0, 0, -10]} scale={[24, 24, 1]} color={backdrop} />
                <Lightformer form="rect" intensity={6 * L.key} position={[6, 5, 4]} scale={[9, 9, 1]} color={key} />
                <Lightformer form="rect" intensity={3} position={[-7, 2, 3]} scale={[7, 9, 1]} color={cool} />
                <Lightformer form="rect" intensity={2.6} position={[0, -6, 4]} scale={[12, 4, 1]} color={warm} />
                <Lightformer form="ring" intensity={4} position={[-4, 5, -5]} scale={3} color={cool} />
                <Lightformer form="circle" intensity={3} position={[5, -3, -4]} scale={2.4} color={warm} />
              </Environment>
            )}
          </Suspense>
        </>
      )}
      {controls && (
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          // enclosed (walled) dioramas: stop auto-orbit + fence the camera to a front cone so it can't swing
          // behind the opaque walls (which would fill the frame with a flat wall). Open sets orbit freely.
          autoRotate={autoRotate && !enclosedDiorama}
          autoRotateSpeed={0.6}
          minDistance={3}
          maxDistance={enclosedDiorama ? 6 : 9}
          minAzimuthAngle={enclosedDiorama ? -Math.PI / 2.6 : -Infinity}
          maxAzimuthAngle={enclosedDiorama ? Math.PI / 2.6 : Infinity}
          minPolarAngle={enclosedDiorama ? Math.PI * 0.26 : 0}
          maxPolarAngle={enclosedDiorama ? Math.PI * 0.62 : Math.PI}
          rotateSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      )}
      {/* Shared hero post chain: optional SSAO + DoF, rank-scaled Bloom, Vignette, ACES (see ScenePostFX). On
          `low` (nothing enabled) it self-disables and the renderer's own ACES grades the frame. */}
      <ScenePostFX dof vignette bloomIntensity={0.5 + rank * 0.22} bloomThreshold={0.8} bloomLevels={7} compact={compact} previewPostfx={previewPostfx} />
    </Canvas>
  )
}
