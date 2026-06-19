import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, ContactShadows, OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry, OPEN_FAMILIES } from './geometry'
import { RARITY_COLOR } from './Gem'
import { useGame, type ShapeRow } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

// Wander bounds on the floor (render-only — Math.random is fine here; the sim never uses it).
const BX = 3.2
const BZ = 1.7
const rx = () => (Math.random() * 2 - 1) * BX
const rz = () => (Math.random() * 2 - 1) * BZ

// A shape milling about the lobby: wanders to random spots, bobs, spins, and hops now and then. Tap to chat.
function RoamGem({ shape, id, secretary, idx, onTap }: { shape: ShapeRow; id: number; secretary: boolean; idx: number; onTap: (id: number) => void }) {
  const grp = useRef<THREE.Group>(null)
  const gem = useRef<THREE.Mesh>(null)
  const target = useRef<THREE.Vector3 | null>(null)
  const hopT = useRef(2 + idx)
  if (!target.current) target.current = new THREE.Vector3(rx(), 0, rz())
  const col = RARITY_COLOR[shape.rarity]
  const scale = secretary ? 0.5 : 0.34
  const phase = idx * 1.3
  useFrame((state, dt) => {
    const g = grp.current
    if (!g || !target.current) return
    // wander toward the current target; re-pick when reached
    const dx = target.current.x - g.position.x
    const dz = target.current.z - g.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.2) {
      target.current.set(rx(), 0, rz())
    } else {
      const step = Math.min(dt * 0.7, dist)
      g.position.x += (dx / dist) * step
      g.position.z += (dz / dist) * step
      g.rotation.y = Math.atan2(dx, dz) // face the way it's heading
    }
    // occasional hop
    hopT.current -= dt
    let hop = 0
    if (hopT.current < 0.4 && hopT.current > 0) hop = Math.sin(((0.4 - hopT.current) / 0.4) * Math.PI) * 0.38
    if (hopT.current <= 0) hopT.current = 3 + Math.random() * 6
    g.position.y = 0.34 + Math.sin(state.clock.elapsedTime * 2 + phase) * 0.05 + hop
    if (gem.current) gem.current.rotation.y += dt * 0.7
  })
  return (
    <group ref={grp} position={[target.current.x, 0.34, target.current.z]}>
      <mesh
        ref={gem}
        geometry={getGeometry(shape.family)}
        scale={scale}
        castShadow
        onClick={(e) => {
          e.stopPropagation()
          onTap(id)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
      >
        <meshPhysicalMaterial
          color={col}
          metalness={0.3}
          roughness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.1}
          emissive={col}
          emissiveIntensity={0.5}
          side={OPEN_FAMILIES.has(shape.family) ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>
      {/* little glow disc the gem walks on */}
      <mesh position={[0, -0.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.28, 28]} />
        <meshBasicMaterial color={col} transparent opacity={0.4} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {secretary && <Sparkles count={8} scale={[0.6, 1.2, 0.6]} position={[0, 0.55, 0]} size={2.4} speed={0.5} color="#ffd76b" />}
    </group>
  )
}

/** The lobby ("My Room"): your shapes mill about a cozy floor. The selected Shop scene re-palettes it. */
export function RoomScene({ roster, secretaryId, onTap }: { roster: ShapeRow[]; secretaryId: number | null; onTap: (id: number) => void }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  return (
    <Canvas dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 3.1, 5.6], fov: 46 }}>
      <color attach="background" args={['#0a0b14']} />
      <fog attach="fog" args={['#0a0b14', 10, 26]} />
      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#cfe0ff', '#181228', 0.75]} />
      <directionalLight position={[3, 7, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} color={cool} position={[-4, 3, -4]} scale={7} />
        <Lightformer intensity={2.2} color={warm} position={[5, 2, -3]} scale={7} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 5, 2]} scale={5} />
      </Environment>

      {/* cozy endless floor + soft grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#11131f" metalness={0.5} roughness={0.55} />
      </mesh>
      <Grid position={[0, -0.01, 0]} infiniteGrid cellSize={0.7} cellThickness={0.5} cellColor="#262a3c" sectionSize={3.5} sectionThickness={1} sectionColor="#3a4060" fadeDistance={26} fadeStrength={1.6} />

      {roster.map((s, i) => (
        <RoamGem key={s.id} shape={s} id={s.id} secretary={s.id === secretaryId} idx={i} onTap={onTap} />
      ))}

      <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={14} blur={2.6} far={4} />
      <Sparkles count={Math.round(40 * g.sparkle)} scale={[12, 4, 8]} position={[0, 1.6, 0]} size={1.5} speed={0.25} color={scene.stars} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.4}
        maxPolarAngle={1.35}
        rotateSpeed={0.8}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE }}
      />
    </Canvas>
  )
}
