import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, Float, ContactShadows, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry, OPEN_FAMILIES } from './geometry'
import { RARITY_COLOR } from './Gem'
import { useGame, type ShapeRow } from '../game/store'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

// A lit pedestal: dark metal plinth + glowing rim + a coloured point light that illuminates the gem above it.
function Pedestal({ pos, color, intensity = 3 }: { pos: [number, number, number]; color: string; intensity?: number }) {
  return (
    <group position={pos}>
      <mesh position={[0, -0.62, 0]} receiveShadow>
        <cylinderGeometry args={[0.44, 0.52, 0.2, 36]} />
        <meshStandardMaterial color="#171822" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.51, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.04, 36]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0.5, 0.2]} color={color} intensity={intensity} distance={4} decay={1.6} />
    </group>
  )
}

function AltarGem({ shape, pos, scale, show }: { shape?: ShapeRow; pos: [number, number, number]; scale: number; show: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null)
  const known = show && !!shape
  const baseE = known ? 0.55 : 0.3
  useFrame((state, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.8
    if (matRef.current) {
      const w = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.8 + pos[0])
      matRef.current.emissiveIntensity = baseE * (0.82 + 0.36 * w)
    }
  })
  const col = known ? RARITY_COLOR[shape!.rarity] : '#a98bff'
  const geom = getGeometry(known ? shape!.family : 'icosahedron')
  return (
    <Float speed={2} rotationIntensity={0} floatIntensity={0.5} floatingRange={[0, 0.14]}>
      <mesh ref={ref} geometry={geom} position={pos} scale={scale} castShadow>
        <meshPhysicalMaterial
          ref={matRef}
          color={col}
          metalness={0.3}
          roughness={0.08}
          clearcoat={1}
          clearcoatRoughness={0.08}
          emissive={col}
          emissiveIntensity={baseE}
          envMapIntensity={1.6}
          side={known && OPEN_FAMILIES.has(shape!.family) ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>
    </Float>
  )
}

// The forge core: a pulsing molten disc + light beneath the result — makes the altar feel like it's working.
function ForgeCore() {
  const lightRef = useRef<THREE.PointLight>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((state) => {
    const w = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 2.4)
    if (lightRef.current) lightRef.current.intensity = 5.5 + 3 * w
    if (matRef.current) matRef.current.emissiveIntensity = 1.8 + 1.4 * w
  })
  return (
    <>
      <pointLight ref={lightRef} position={[0, 0.3, -0.6]} color="#ffce5c" intensity={7} distance={6} decay={1.5} />
      <mesh position={[0, -0.46, -0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.7, 40]} />
        <meshStandardMaterial ref={matRef} color="#ff9d3c" emissive="#ffb74d" emissiveIntensity={2.4} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </>
  )
}

/** A 3D "fusion altar": two input gems on lit pedestals flanking a larger result, with a glowing forge core. */
export function ForgeAltar({ a, b, out, discovered }: { a?: ShapeRow; b?: ShapeRow; out?: ShapeRow; discovered: boolean }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  const aCol = a ? RARITY_COLOR[a.rarity] : '#5fe0c6'
  const bCol = b ? RARITY_COLOR[b.rarity] : '#b985ff'
  const outCol = discovered && out ? RARITY_COLOR[out.rarity] : '#a98bff'
  return (
    <Canvas dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 1.5, 5], fov: 42 }}>
      <color attach="background" args={['#0b0c16']} />
      <fog attach="fog" args={['#0b0c16', 8, 28]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#cfd6ff', '#1a1530', 0.6]} />
      <directionalLight position={[3, 6, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={3} color={warm} position={[0, 3, -3]} scale={7} />
        <Lightformer intensity={2.2} color={backdrop} position={[-5, 1.5, -2]} scale={6} />
        <Lightformer intensity={2} color={cool} position={[5, 1.5, -2]} scale={6} />
        <Lightformer intensity={1.6} color={key} position={[0, 4, 3]} scale={5} />
      </Environment>

      {/* endless reflective forge floor fading into the fog horizon + an infinite grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.84, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#0d0e1a" metalness={0.7} roughness={0.4} />
      </mesh>
      <Grid
        position={[0, -0.83, 0]}
        infiniteGrid
        cellSize={0.6}
        cellThickness={0.6}
        cellColor="#2a2e40"
        sectionSize={3}
        sectionThickness={1}
        sectionColor="#4a4063"
        fadeDistance={28}
        fadeStrength={1.5}
      />

      <Pedestal pos={[-1.8, 0, 0]} color={aCol} />
      <AltarGem shape={a} pos={[-1.8, 0, 0]} scale={0.4} show />
      <Pedestal pos={[1.8, 0, 0]} color={bCol} />
      <AltarGem shape={b} pos={[1.8, 0, 0]} scale={0.4} show />
      <Pedestal pos={[0, 0.25, -0.6]} color={outCol} intensity={5} />
      <AltarGem shape={out} pos={[0, 0.25, -0.6]} scale={0.62} show={discovered} />

      {/* glowing forge core beneath the result — pulses like a working forge */}
      <ForgeCore />

      <Sparkles count={Math.round(50 * g.sparkle)} scale={[5, 2.6, 2.6]} position={[0, 0.5, -0.2]} size={2.6} speed={0.7} color="#ffce5c" />
      <ContactShadows position={[0, -0.83, 0]} opacity={0.5} scale={12} blur={2.4} far={3} />
    </Canvas>
  )
}
