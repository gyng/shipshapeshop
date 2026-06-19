import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Stars, Sparkles } from '@react-three/drei'
import { Suspense, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGame, type RarityName } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { RARITY_COLOR } from './Gem'
import { useGfxPreset } from '../gfx'

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4 }

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
export function Stage({ children, controls = false, rarity = 'Common' }: { children: ReactNode; controls?: boolean; rarity?: RarityName }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const cornell = scene.special === 'cornell'
  const rank = RANK[rarity]
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 42 }} dpr={g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={[cornell ? '#0a0a0a' : '#0b0a16']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      {cornell ? (
        <Suspense fallback={null}>
          {children}
          <CornellRoom />
        </Suspense>
      ) : (
        <>
          <Stars radius={60} depth={50} count={g.stars} factor={4} saturation={0.7} fade speed={0.3} />
          {/* rarer shapes get markedly more (and bigger) sparkles, plus a rarity-coloured halo of motes */}
          <Sparkles count={Math.round((36 + rank * 28) * g.sparkle)} scale={[8, 6, 6]} size={2.2 + rank * 0.5} speed={0.18} opacity={0.7} color={scene.stars} />
          {rank >= 2 && <Sparkles count={Math.round((20 + rank * 22) * g.sparkle)} scale={[4.5, 4.5, 4.5]} size={3.4} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} />}
          <Suspense fallback={null}>
            {children}
            <Environment resolution={256} background backgroundBlurriness={0.75} backgroundIntensity={0.5} environmentIntensity={1.15}>
              <Lightformer form="rect" intensity={3} position={[0, 0, -10]} scale={[24, 24, 1]} color={backdrop} />
              <Lightformer form="rect" intensity={5} position={[6, 5, 4]} scale={[9, 9, 1]} color={key} />
              <Lightformer form="rect" intensity={3} position={[-7, 2, 3]} scale={[7, 9, 1]} color={cool} />
              <Lightformer form="rect" intensity={2.6} position={[0, -6, 4]} scale={[12, 4, 1]} color={warm} />
              <Lightformer form="ring" intensity={4} position={[-4, 5, -5]} scale={3} color={cool} />
              <Lightformer form="circle" intensity={3} position={[5, -3, -4]} scale={2.4} color={warm} />
            </Environment>
          </Suspense>
        </>
      )}
      {controls && (
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          minDistance={3}
          maxDistance={9}
          rotateSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      )}
    </Canvas>
  )
}
