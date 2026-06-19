import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, Float, ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry } from './geometry'
import { RARITY_COLOR } from './Gem'
import type { ShapeRow } from '../game/store'

// A single deployed gem on the floor — jewel material (no transmission → cheap + flicker-free for many at once),
// gently spinning + bobbing, with a column of rising gold "Flux" sparkles.
function FloorGem({ family, rarity, pos }: { family: string; rarity: keyof typeof RARITY_COLOR; pos: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.7
  })
  const col = RARITY_COLOR[rarity]
  return (
    <group position={pos}>
      <Float speed={2.2} rotationIntensity={0} floatIntensity={0.7} floatingRange={[0, 0.16]}>
        <mesh ref={ref} geometry={getGeometry(family)} scale={0.4} castShadow>
          <meshPhysicalMaterial
            color={col}
            metalness={0.35}
            roughness={0.12}
            clearcoat={1}
            clearcoatRoughness={0.1}
            emissive={col}
            emissiveIntensity={0.4}
            envMapIntensity={1.2}
          />
        </mesh>
      </Float>
      {/* Flux rising from the gem */}
      <Sparkles count={9} scale={[0.5, 1.6, 0.5]} position={[0, 0.7, 0]} size={2.4} speed={0.6} noise={0.4} color="#ffcf6b" />
    </group>
  )
}

export function FactoryFloor({ shapes, loadout }: { shapes: ShapeRow[]; loadout: number[] }) {
  const n = loadout.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const spacing = 1.15
  return (
    <Canvas dpr={[1, 1.6]} shadows camera={{ position: [0, 2.8, 5.4], fov: 42 }}>
      <color attach="background" args={['#0a0b12']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={1.2} color="#8a6bff" position={[-4, 3, -4]} scale={6} />
        <Lightformer intensity={1.0} color="#5fe0c6" position={[5, 2, -3]} scale={6} />
        <Lightformer intensity={0.8} color="#ff7ab0" position={[0, -3, 4]} scale={6} />
      </Environment>

      {/* floor + grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color="#0c0d16" metalness={0.55} roughness={0.45} />
      </mesh>
      <gridHelper args={[16, 32, '#34374a', '#1a1c26']} position={[0, -0.41, 0]} />

      {loadout.map((id, i) => {
        const s = shapes[id]
        if (!s) return null
        const c = i % cols
        const r = Math.floor(i / cols)
        const x = (c - (cols - 1) / 2) * spacing
        const z = (r - (rows - 1) / 2) * spacing
        return <FloorGem key={id} family={s.family} rarity={s.rarity} pos={[x, 0, z]} />
      })}

      <ContactShadows position={[0, -0.4, 0]} opacity={0.55} scale={14} blur={2.4} far={4} />
      {/* ambient flux drifting through the whole floor */}
      <Sparkles count={50} scale={[10, 4, 10]} position={[0, 1.4, 0]} size={1.4} speed={0.25} color="#ffcf6b" />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.6}
        maxPolarAngle={1.35}
        autoRotate
        autoRotateSpeed={0.5}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE }}
      />
    </Canvas>
  )
}
