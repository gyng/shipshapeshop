import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Stars, Sparkles } from '@react-three/drei'
import { Suspense, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGame, type RarityName } from '../game/store'
import { sceneById, lightingById, heroCursorById, SLOT_LIGHTING, SLOT_HERO_CURSOR, type LightingSpec } from '../content/cosmetics'
import { RARITY_COLOR } from './Gem'
import { ScenePostFX } from './ScenePostFX'
import { Atmosphere } from './Atmosphere'
import { useGfxPreset } from '../gfx'

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

/**
 * Animated lighting (the "Moving light ✦" moods). The drei <Environment> Lightformers bake to a cubemap and are
 * expensive to re-bake per frame, so instead of animating those we drive a real r3f key+fill PAIR per frame —
 * effectively free — for any mood whose `motion` is set. The static env still provides the base IBL/reflections;
 * these moving lights add the visible motion on top (orbit / drift / pulse / twin counter-spin). Static moods
 * render nothing here. (The SDF heroes can't use r3f lights — they breathe via the gem-shader L.key/L.rim feed.)
 */
function MovingLights({ L, rank, rarity }: { L: LightingSpec; rank: number; rarity: RarityName }) {
  const a = useRef<THREE.PointLight>(null)
  const b = useRef<THREE.PointLight>(null)
  const m = L.motion
  const warmCol = useMemo(() => new THREE.Color('#fff0d0'), [])
  const coolCol = useMemo(() => new THREE.Color(RARITY_COLOR[rarity]), [rarity])
  useFrame((state) => {
    if (!m) return
    const t = state.clock.elapsedTime
    const r = m.orbitRadius ?? 6
    const base = 2.4 + rank * 0.5
    const breath = m.pulseDepth ? 1 + Math.sin(t * (m.pulseRate ?? 0.3) * Math.PI * 2) * m.pulseDepth : 1
    if (a.current) {
      if (m.kind === 'orbit' || m.kind === 'twinspin') {
        const ang = t * (m.orbitSpeed ?? 0.3)
        a.current.position.set(Math.cos(ang) * r, 2.5 + Math.sin(ang * 0.5) * 1.2, Math.sin(ang) * r)
      } else if (m.kind === 'drift') {
        const s = m.driftSpeed ?? 0.5, amp = m.driftAmp ?? 2
        a.current.position.set(Math.sin(t * s) * amp + 3, 4 + Math.cos(t * s * 0.7) * amp * 0.6, 4 + Math.sin(t * s * 0.5) * amp * 0.5)
      } else {
        a.current.position.set(4, 5, 4) // pure pulse — fixed position, breathing intensity
      }
      a.current.intensity = base * (L.key ?? 1) * breath
      // gentle hue drift on the warm key for the moods that ask for it
      if (m.hueShift) { const hsl = { h: 0, s: 0, l: 0 }; warmCol.getHSL(hsl); a.current.color.setHSL((hsl.h + Math.sin(t * (m.pulseRate ?? 0.3)) * m.hueShift + 1) % 1, hsl.s, hsl.l) }
    }
    if (b.current && m.kind === 'twinspin') {
      const ang = -t * (m.orbitSpeed ?? 0.3) + Math.PI // counter-rotating, opposite side
      b.current.position.set(Math.cos(ang) * r, 2.5 + Math.sin(ang * 0.5) * 1.2, Math.sin(ang) * r)
      b.current.intensity = base * (L.rim ?? 1) * breath
    }
  })
  if (!m) return null
  return (
    <>
      <pointLight ref={a} color={warmCol} intensity={(2.4 + rank * 0.5) * (L.key ?? 1)} distance={18} decay={1.3} />
      {m.kind === 'twinspin' && <pointLight ref={b} color={coolCol} intensity={(2.4 + rank * 0.5) * (L.rim ?? 1)} distance={18} decay={1.3} />}
    </>
  )
}

/**
 * The hero cursor light (Shop "Gem Spotlight" cosmetic, slot 9 — default OFF). A soft point light placed each
 * frame at the pointer mapped onto the gem's plane, so a sweep of the cursor pulls a tracking specular/rim across
 * the focused gem. Active ONLY in the interactive inspector (gated by the caller). Shadowless (one cheap light
 * term). id 0 = Off → renders nothing. Disco moods hue-cycle.
 */
function HeroCursorLight() {
  const fx = heroCursorById(useGame((s) => s.view?.equipped?.[SLOT_HERO_CURSOR] ?? 0))
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

/** The classic Cornell box: red left wall, green right wall, white others, a bright area light on the ceiling.
 *  The glass gem inside refracts the coloured walls (transmission samples the scene). */
function CornellRoom() {
  const white = '#e8e8e8'
  return (
    <group>
      <mesh position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[6, 6]} /><meshStandardMaterial color={white} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 3, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color={white} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0, -3]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color={white} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-3, 0, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color="#c43838" roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[3, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color="#2fa83f" roughness={0.95} side={THREE.DoubleSide} /></mesh>
      {/* ceiling area light */}
      <mesh position={[0, 2.96, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[2.2, 2.2]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.2} toneMapped={false} /></mesh>
      <pointLight position={[0, 2.6, 0.4]} intensity={7} distance={12} decay={1.3} color="#fff5e8" />
      <ambientLight intensity={0.35} />
      {/* small env so the glass has something to reflect */}
      <Environment resolution={64} environmentIntensity={0.7}>
        <Lightformer form="rect" intensity={2} color="#ffffff" position={[0, 3, 0]} scale={[3, 3, 1]} />
        <Lightformer form="rect" intensity={1} color="#c43838" position={[-3, 0, 0]} scale={[5, 5, 1]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={1} color="#2fa83f" position={[3, 0, 0]} scale={[5, 5, 1]} rotation={[0, -Math.PI / 2, 0]} />
      </Environment>
    </group>
  )
}

/**
 * The hero stage. The selected Shop scene re-palettes the environment (the glass refracts/reflects it). The
 * Cornell-box scene swaps the nebula dome for the famous test room. No EffectComposer/Bloom and no animated
 * distortion on the glass — both flicker with transmission.
 */
export function Stage({ children, controls = false, autoRotate = false, rarity = 'Common', compact = false, frameloop, previewScene, previewAtmosphere }: { children: ReactNode; controls?: boolean; autoRotate?: boolean; rarity?: RarityName; motes?: boolean; compact?: boolean; frameloop?: 'always' | 'demand' | 'never'; previewScene?: number; previewAtmosphere?: number }) {
  const storeScene = useGame((s) => s.view?.scene ?? 0)
  const scene = sceneById(previewScene ?? storeScene) // shop hover-preview: show a scene without equipping it
  const L = lightingById(useGame((s) => s.view?.equipped?.[SLOT_LIGHTING] ?? 0)) // equipped Lighting mood (Shop cosmetic)
  const cornell = scene.special === 'cornell'
  const rank = RANK[rarity]
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  return (
    // `offsetSize` measures the un-transformed layout size — without it the canvas is sized while its modal is
    // mid `pop-in` scale animation and stays too small, leaving a black gap on the right/bottom edges.
    <Canvas frameloop={frameloop} resize={{ offsetSize: true }} className={controls ? 'orbit-canvas' : undefined} camera={{ position: [0, 0, 5], fov: 42 }} dpr={g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={[cornell ? '#0a0a0a' : '#0b0a16']} />
      <ambientLight intensity={0.45 * L.ambient} />
      <directionalLight position={[4, 6, 5]} intensity={1.1 * L.key} />
      {/* rarity-hued rim/back light so the hero reads as a luminous jewel (stronger for rarer shapes) */}
      {!cornell && <pointLight position={[-3.5, 2.5, -2]} intensity={(2.2 + rank) * L.rim} distance={16} decay={1.4} color={RARITY_COLOR[rarity]} />}
      {/* equipped "Moving light ✦" mood: animated key/fill lights that orbit, drift or breathe (static moods → null) */}
      {L.motion && <MovingLights L={L} rank={rank} rarity={rarity} />}
      {/* hero cursor light (Gem Spotlight, slot 9 — default OFF): a follow-light only in the interactive inspector */}
      {controls && !compact && <HeroCursorLight />}
      {cornell ? (
        <Suspense fallback={null}>
          {children}
          <CornellRoom />
        </Suspense>
      ) : (
        <>
          {/* compact (small embedded previews): skip the star field entirely — invisible at preview size, pure cost */}
          {!compact && <Stars radius={60} depth={50} count={g.stars} factor={4} saturation={0.7} fade speed={0.3} />}
          {/* motes always render now (the per-view toggle is gone); the gfx particle setting (g.sparkle) still scales/disables them */}
          <Sparkles count={Math.round((36 + rank * 28) * g.sparkle)} scale={[8, 6, 6]} size={2.2 + rank * 0.5} speed={0.18} opacity={0.7} color={scene.stars} />
          {rank >= 2 && <Sparkles count={Math.round((20 + rank * 22) * g.sparkle)} scale={[4.5, 4.5, 4.5]} size={3.4} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} />}
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
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
          minDistance={3}
          maxDistance={9}
          rotateSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      )}
      {/* Shared hero post chain: optional SSAO + DoF, rank-scaled Bloom, Vignette, ACES (see ScenePostFX). On
          `low` (nothing enabled) it self-disables and the renderer's own ACES grades the frame. */}
      <ScenePostFX dof vignette bloomIntensity={0.4 + rank * 0.22} compact={compact} />
    </Canvas>
  )
}
