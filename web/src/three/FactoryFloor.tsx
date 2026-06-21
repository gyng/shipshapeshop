import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, Float, ContactShadows, OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { OPEN_FAMILIES } from './geometry'
import { shapeGeometry, useRelics } from './relics'
import { RARITY_COLOR, sceneGemMatProps, sceneGemEmissiveBase } from './Gem'
import { ScenePostFX } from './ScenePostFX'
import { RenderTechBadge } from './RenderTechBadge'
import { useGame, type ShapeRow } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

const RANK: Record<keyof typeof RARITY_COLOR, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

// A deployed gem on the floor: a jewel on a glowing ring, lit by its own coloured light, with rising Flux.
// The ring + emissive "breathe" at a rarity-scaled rate (rarer = livelier), offset per-gem so they don't sync.
function FloorGem({ family, rarity, pos, id, onTap }: { family: string; rarity: keyof typeof RARITY_COLOR; pos: [number, number, number]; id: number; onTap?: (id: number, x: number, y: number) => void }) {
  const ref = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.MeshBasicMaterial>(null)
  const gemRef = useRef<THREE.MeshPhysicalMaterial>(null)
  const rank = RANK[rarity]
  const g = useGfxPreset()
  const freq = 1.2 + rank * 0.3
  const baseEmissive = sceneGemEmissiveBase(rank, g.sceneGlass)
  useRelics() // real Relic mesh once loaded
  useFrame((state, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.7
    const w = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * freq + pos[0] * 1.7)
    if (ringRef.current) ringRef.current.opacity = 0.4 + 0.32 * w
    if (gemRef.current) gemRef.current.emissiveIntensity = baseEmissive * (0.78 + 0.44 * w)
  })
  const col = RARITY_COLOR[rarity]
  return (
    <group position={pos}>
      {/* glow ring on the floor under the gem */}
      <mesh position={[0, -0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.26, 0.42, 40]} />
        <meshBasicMaterial ref={ringRef} color={col} transparent opacity={0.55} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 0.4, 0]} color={col} intensity={2.2 + rank * 0.4} distance={2.6} decay={1.6} />
      <Float speed={2.2} rotationIntensity={0} floatIntensity={0.7} floatingRange={[0, 0.16]}>
        <mesh
          ref={ref}
          geometry={shapeGeometry(family)}
          scale={0.4}
          castShadow
          onClick={(e) => {
            e.stopPropagation()
            onTap?.(id, e.nativeEvent.clientX, e.nativeEvent.clientY)
          }}
          onPointerOver={() => onTap && (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = 'auto')}
        >
          {/* transmission glass (when gfx.sceneGlass) or opaque emissive PBR — shared recipe; the breathing
              animation overrides emissiveIntensity via gemRef each frame (glass-aware base). */}
          <meshPhysicalMaterial ref={gemRef} {...sceneGemMatProps(col, rank, OPEN_FAMILIES.has(family), g.sceneGlass)} emissiveIntensity={baseEmissive} />
        </mesh>
      </Float>
      <Sparkles count={10} scale={[0.5, 1.7, 0.5]} position={[0, 0.8, 0]} size={2.6} speed={0.7} noise={0.5} color="#ffcf6b" />
    </group>
  )
}

// An empty "drop here" slot — a pulsing ring marking room to deploy another shape.
function GhostSlot({ pos }: { pos: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 2) * 0.07)
  })
  return (
    <mesh ref={ref} position={[pos[0], -0.4, pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.24, 0.34, 36]} />
      <meshBasicMaterial color="#6a7099" transparent opacity={0.4} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function FactoryFloor({ shapes, loadout, boardCells = [], boardW = 5, boardH = 5, openSlots = 0, onTap }: { shapes: ShapeRow[]; loadout: number[]; boardCells?: number[]; boardW?: number; boardH?: number; openSlots?: number; onTap?: (id: number, x: number, y: number) => void }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  const spacing = 0.98
  // position a gem by its grid CELL so the 3D floor mirrors the 2D puzzle board
  const cellPos = (cell: number): [number, number, number] => {
    const c = cell % boardW
    const r = Math.floor(cell / boardW)
    return [(c - (boardW - 1) / 2) * spacing, 0, (r - (boardH - 1) / 2) * spacing]
  }
  const used = new Set(boardCells)
  const free: number[] = []
  for (let cell = 0; cell < boardW * boardH && free.length < openSlots; cell++) if (!used.has(cell)) free.push(cell)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 3.6, 6.2], fov: 42 }}>
      <color attach="background" args={['#0a0b14']} />
      <fog attach="fog" args={['#0a0b14', 9, 30]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cfe0ff', '#181228', 0.7]} />
      <directionalLight position={[3, 7, 4]} intensity={1.8} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} color={cool} position={[-4, 3, -4]} scale={7} />
        <Lightformer intensity={2.2} color={warm} position={[5, 2, -3]} scale={7} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 5, 2]} scale={5} />
      </Environment>

      {/* endless floor: a huge plane that fades into the fog at the horizon + an infinite grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#0d0e1a" metalness={0.6} roughness={0.45} />
      </mesh>
      <Grid
        position={[0, -0.41, 0]}
        infiniteGrid
        cellSize={0.6}
        cellThickness={0.6}
        cellColor="#2a2e40"
        sectionSize={3}
        sectionThickness={1}
        sectionColor="#3f4663"
        fadeDistance={30}
        fadeStrength={1.5}
      />

      {loadout.map((id, i) => {
        const s = shapes[id]
        if (!s) return null
        return <FloorGem key={id} id={id} family={s.family} rarity={s.rarity} pos={cellPos(boardCells[i] ?? i)} onTap={onTap} />
      })}
      {free.map((cell, j) => <GhostSlot key={`g${j}`} pos={cellPos(cell)} />)}

      <ContactShadows position={[0, -0.41, 0]} opacity={0.55} scale={16} blur={2.6} far={4} />
      <Sparkles count={Math.round(60 * g.sparkle)} scale={[12, 5, 12]} position={[0, 1.8, 0]} size={1.6} speed={0.3} color="#ffcf6b" />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.5}
        maxPolarAngle={1.35}
        autoRotate
        autoRotateSpeed={0.5}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE }}
      />
      <ScenePostFX />
    </Canvas>
      <RenderTechBadge tech="mesh" />
    </div>
  )
}
