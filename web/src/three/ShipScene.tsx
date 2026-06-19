import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, Float, ContactShadows, Stars, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry, OPEN_FAMILIES } from './geometry'
import { RARITY_COLOR } from './Gem'
import { useGame, type ShapeRow } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

// Both characters share ONE scene (so they read as together). Jewel material (no transmission) keeps two gems
// cheap + flicker-free. The speaker is scaled up, brighter, and leans toward the other.
function SceneGem({ shape, side, speaking }: { shape: ShapeRow; side: -1 | 1; speaking: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.5
  })
  const col = RARITY_COLOR[shape.rarity]
  // symmetric placement (keeps the composition centred); emphasis comes from depth, scale + light, not x.
  // Modest x-spread + only a small forward lean so the active gem never pushes outside the frustum.
  const x = side * 1.3
  const z = speaking ? 0 : -0.3 // keep the speaker on the fit-plane (no forward push) so it never clips
  return (
    <>
      <Float speed={2} rotationIntensity={0} floatIntensity={speaking ? 0.9 : 0.35} floatingRange={[0, 0.16]}>
        <mesh ref={ref} geometry={getGeometry(shape.family)} position={[x, 0, z]} scale={speaking ? 1.0 : 0.62}>
          <meshPhysicalMaterial
            color={col}
            metalness={0.3}
            roughness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.08}
            emissive={col}
            emissiveIntensity={speaking ? 0.65 : 0.18}
            envMapIntensity={speaking ? 1.8 : 1.0}
            side={OPEN_FAMILIES.has(shape.family) ? THREE.DoubleSide : THREE.FrontSide}
          />
        </mesh>
      </Float>
      {/* a soft key light on the speaker that the listener doesn't get */}
      {speaking && <pointLight position={[x, 0.6, 2.2]} color={col} intensity={6} distance={6} decay={1.4} />}
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
  const cornell = scene.special === 'cornell'
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  return (
    <Canvas dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 0, 5], fov: 42 }}>
      <color attach="background" args={[cornell ? '#0a0a0a' : '#0a0a14']} />
      {!cornell && <Stars radius={50} depth={40} count={Math.round(900 * g.sparkle)} factor={3} saturation={0.6} fade speed={0.2} />}
      {!cornell && <Sparkles count={Math.round(30 * g.sparkle)} scale={[9, 5, 5]} size={2} speed={0.25} color={scene.stars} />}
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 5, 4]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
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
    </Canvas>
  )
}
