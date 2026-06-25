import { useEffect, useRef, useMemo } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Float, ContactShadows, Stars, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { HeroGem, RARITY_COLOR } from './Gem'
import { ScenePostFX } from './ScenePostFX'
import { ExpeditionPathTrace } from './ExpeditionPathTrace'
import { buildCutscenePtScene } from './geometry'
import { useGame, type ShapeRow, type RarityName } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset, useGfx } from '../gfx'

const CUT_RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }
const ptGem = (s: ShapeRow): { family: string; colorLinear: [number, number, number]; rank: number } => {
  const c = new THREE.Color(RARITY_COLOR[s.rarity]).convertSRGBToLinear()
  return { family: s.family, colorLinear: [c.r, c.g, c.b], rank: CUT_RANK[s.rarity] }
}

// Both characters share ONE scene (so they read as together), each rendered with the SAME hero transmission
// glass as the Pull/Inspector (HeroGem) so a shape looks identical everywhere. The speaker is scaled up,
// brighter (its own key light), and leans toward the other.
function SceneGem({ shape, side, speaking }: { shape: ShapeRow; side: -1 | 1; speaking: boolean }) {
  const col = RARITY_COLOR[shape.rarity]
  const keyRef = useRef<THREE.PointLight>(null)
  // symmetric placement (keeps the composition centred); emphasis comes from depth, scale + light, not x.
  // Modest x-spread + only a small forward lean so the active gem never pushes outside the frustum.
  const x = side * 1.3
  const z = speaking ? 0 : -0.3 // keep the speaker on the fit-plane (no forward push) so it never clips
  // HeroGem renders at an internal ×1.55, so these group scales land at ≈1.0 (speaker) / ≈0.62 (listener).
  const scale = speaking ? 0.66 : 0.4
  // A gentle "presence" pulse on the speaker's key — the talking gem breathes a little (not speech-synced; we
  // don't get audio amplitude here, so it stays subtle) so the cutscene reads as alive, not a frozen diorama.
  useFrame((state) => {
    if (keyRef.current) keyRef.current.intensity = speaking ? 6.5 + Math.sin(state.clock.elapsedTime * 3.1) * 1.1 : 0
  })
  return (
    <>
      <Float speed={2} rotationIntensity={0} floatIntensity={speaking ? 0.9 : 0.35} floatingRange={[0, 0.16]}>
        <group position={[x, 0, z]} scale={scale}>
          <HeroGem family={shape.family} rarity={shape.rarity} spin={0.5} />
        </group>
      </Float>
      {/* front KEY — only the speaker (the listener sits in soft shadow, so the eye goes to who's talking) */}
      <pointLight ref={keyRef} position={[x, 0.6, 2.2]} color={col} intensity={speaking ? 6.5 : 0} distance={6} decay={1.4} />
      {/* back/RIM — every gem gets one so the glass silhouette glows against the dark backdrop (with bloom this
          reads as a halo); the speaker's is brighter to push it forward. */}
      <pointLight position={[x * 1.35, 1.5, -2.4]} color={col} intensity={speaking ? 5 : 2.2} distance={11} decay={1.5} />
    </>
  )
}

// Dolly the camera so the composition (half-width × half-height around the origin) FILLS the panel for the
// current aspect — centred, edge-to-edge with a little breathing room, never clipping at any width.
function FitView({ halfW, halfH }: { halfW: number; halfH: number }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const tanV = Math.tan((cam.fov * Math.PI) / 360)
    const aspect = size.width / Math.max(1, size.height)
    const dist = Math.max(halfH / tanV, halfW / (tanV * aspect)) * 1.05
    cam.position.setLength(Math.max(dist, 1))
    cam.updateProjectionMatrix()
  }, [camera, size, halfW, halfH])
  return null
}

export function ShipScene({ a, b, speakerA }: { a?: ShapeRow; b?: ShapeRow; speakerA: boolean }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  const pt = useGfx((s) => s.expeditionPt) // share the party-PT opt-in: when on, cutscenes path-trace too
  const ptScene = useMemo(() => (pt && (a || b) ? buildCutscenePtScene(a ? ptGem(a) : null, b ? ptGem(b) : null, speakerA) : null), [pt, a, b, speakerA])
  return (
    <Canvas resize={{ offsetSize: true }} dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 0, 5], fov: 42 }}>
      <color attach="background" args={['#0a0a14']} />
      {pt && ptScene ? (
        <>
          <Stars radius={50} depth={40} count={Math.round(700 * g.sparkle)} factor={3} saturation={0.6} fade speed={0.2} />
          <ExpeditionPathTrace scene={ptScene} backdrop={backdrop} keyCol={key} controls={false} orbit={false} forceEma particles={false} />
        </>
      ) : (
        <>
      <Stars radius={50} depth={40} count={Math.round(900 * g.sparkle)} factor={3} saturation={0.6} fade speed={0.2} />
      <Sparkles count={Math.round(30 * g.sparkle)} scale={[9, 5, 5]} size={2} speed={0.25} color={scene.stars} />
      {/* lower, moodier ambient than a flat fill — the env + per-gem key/rim carry the shaping, so the gems read
          dimensional and the dark stage stays cinematic instead of washed out. */}
      <ambientLight intensity={0.32} />
      <directionalLight position={[2, 5, 4]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      {/* soft cool fill from the opposite side so shadow sides aren't crushed to black */}
      <pointLight position={[0, -1.5, 3]} color={cool} intensity={1.4} distance={9} decay={1.6} />
      <Environment resolution={128}>
        <Lightformer intensity={2.6} color={cool} position={[-4, 2, -3]} scale={6} />
        <Lightformer intensity={2.4} color={warm} position={[4, 2, -3]} scale={6} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 4, 2]} scale={5} />
      </Environment>
      <FitView halfW={2.45} halfH={1.3} />
      {a && <SceneGem shape={a} side={-1} speaking={speakerA} />}
      {b && <SceneGem shape={b} side={1} speaking={!speakerA} />}
      <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={8} blur={2.4} far={3} />
      {/* shared post chain (optional SSAO + bloom → ACES), matching the inspector grade */}
      <ScenePostFX />
        </>
      )}
    </Canvas>
  )
}
