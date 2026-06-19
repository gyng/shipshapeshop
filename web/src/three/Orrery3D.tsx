import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, Float, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry, OPEN_FAMILIES } from './geometry'
import { RARITY_COLOR } from './Gem'
import { useGame, type ShapeRow } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

const RANK: Record<keyof typeof RARITY_COLOR, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4 }
const RAD = 3.1 // orbit-ring radius

type Orbit = { path: number[]; phase: number; period: number }

// A gem that rides the clock ring: its angular position is the tweened orbit cell (shortest-arc), it spins +
// floats like a factory gem. Motion is cosmetic (the orbit path/period/phase come from WASM truth).
function OrbitGem({ shape, orbit, ring, tickSec }: { shape: ShapeRow; orbit: Orbit; ring: number; tickSec: number }) {
  const grp = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const rank = RANK[shape.rarity]
  const col = RARITY_COLOR[shape.rarity]
  const cellAngle = (cell: number) => (cell / ring) * Math.PI * 2
  useFrame((state, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * 0.7
    const g = grp.current
    if (!g || orbit.period === 0) return
    const t = state.clock.elapsedTime / tickSec
    const base = Math.floor(t)
    const frac = t - base
    const f = frac * frac * (3 - 2 * frac) // smoothstep: settle into each cell
    const a0 = cellAngle(orbit.path[(orbit.phase + base) % orbit.period])
    let d = cellAngle(orbit.path[(orbit.phase + base + 1) % orbit.period]) - a0
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    const a = a0 + d * f
    g.position.set(Math.cos(a) * RAD, 0, Math.sin(a) * RAD)
  })
  return (
    <group ref={grp}>
      <pointLight color={col} intensity={1.8 + rank * 0.4} distance={2.4} decay={1.6} />
      <Float speed={2.2} rotationIntensity={0} floatIntensity={0.6} floatingRange={[0, 0.14]}>
        <mesh ref={mesh} geometry={getGeometry(shape.family)} scale={0.32}>
          <meshPhysicalMaterial
            color={col}
            metalness={0.3 + rank * 0.06}
            roughness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.08}
            emissive={col}
            emissiveIntensity={0.5 + rank * 0.12}
            envMapIntensity={1.6}
            side={OPEN_FAMILIES.has(shape.family) ? THREE.DoubleSide : THREE.FrontSide}
          />
        </mesh>
      </Float>
    </group>
  )
}

// The orbit ring track + the cell markers (faint studs the gems step between).
function RingTrack({ ring }: { ring: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RAD, 0.012, 8, 96]} />
        <meshBasicMaterial color="#ffcf6b" transparent opacity={0.28} toneMapped={false} />
      </mesh>
      {Array.from({ length: ring }, (_, i) => {
        const a = (i / ring) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * RAD, 0, Math.sin(a) * RAD]}>
            <sphereGeometry args={[0.05, 10, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.25} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

// The central hub — a slow-spinning brass core the orrery turns around.
function Hub() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.25
  })
  return (
    <group>
      <pointLight color="#ffcf6b" intensity={2.2} distance={3} decay={1.5} />
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.34, 0]} />
        <meshPhysicalMaterial color="#ffcf6b" metalness={0.9} roughness={0.25} emissive="#ffcf6b" emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

export function Orrery3D() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const scene = sceneById(view?.scene ?? 0)
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  const orbits = view?.orrery_orbits ?? []
  const ring = view?.orrery_ring ?? 12
  const tickSec = (view?.orrery_tick_ms ?? 1000) / 1000
  const loadout = view?.loadout ?? []
  return (
    <Canvas dpr={g.dpr} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 4.2, 5.6], fov: 44 }}>
      <color attach="background" args={['#0a0b14']} />
      <fog attach="fog" args={['#0a0b14', 10, 26]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cfe0ff', '#181228', 0.7]} />
      <directionalLight position={[3, 7, 4]} intensity={1.5} />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} color={cool} position={[-4, 3, -4]} scale={7} />
        <Lightformer intensity={2.2} color={warm} position={[5, 2, -3]} scale={7} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 5, 2]} scale={5} />
      </Environment>

      <Hub />
      <RingTrack ring={ring} />
      {orbits.map((orb, i) => {
        const s = shapes[loadout[i]]
        if (!s) return null
        return <OrbitGem key={loadout[i]} shape={s} orbit={orb} ring={ring} tickSec={tickSec} />
      })}

      <Sparkles count={Math.round(50 * g.sparkle)} scale={[10, 4, 10]} position={[0, 1.4, 0]} size={1.5} speed={0.3} color="#ffcf6b" />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.4}
        maxPolarAngle={1.35}
        autoRotate
        autoRotateSpeed={0.45}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE }}
      />
    </Canvas>
  )
}
