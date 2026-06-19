import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, Float } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry } from './geometry'
import { RARITY_COLOR } from './Gem'
import type { ShapeRow } from '../game/store'

function AltarGem({ shape, pos, scale, show }: { shape?: ShapeRow; pos: [number, number, number]; scale: number; show: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.8
  })
  const known = show && !!shape
  const col = known ? RARITY_COLOR[shape!.rarity] : '#3a3d4f'
  const geom = getGeometry(known ? shape!.family : 'icosahedron')
  return (
    <Float speed={2} rotationIntensity={0} floatIntensity={0.5} floatingRange={[0, 0.14]}>
      <mesh ref={ref} geometry={geom} position={pos} scale={scale}>
        <meshPhysicalMaterial
          color={col}
          metalness={0.35}
          roughness={0.12}
          clearcoat={1}
          clearcoatRoughness={0.1}
          emissive={col}
          emissiveIntensity={known ? 0.45 : 0.08}
          envMapIntensity={1.2}
        />
      </mesh>
    </Float>
  )
}

/** A 3D "fusion altar": two input gems flanking a (larger) result, with forge sparks. */
export function ForgeAltar({ a, b, out, discovered }: { a?: ShapeRow; b?: ShapeRow; out?: ShapeRow; discovered: boolean }) {
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 1.3, 5], fov: 42 }}>
      <color attach="background" args={['#0a0b12']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[2, 5, 4]} intensity={1.1} />
      <Environment resolution={128}>
        <Lightformer intensity={1.3} color="#ffce5c" position={[0, 3, -3]} scale={6} />
        <Lightformer intensity={1.0} color="#8a6bff" position={[-4, 1, -2]} scale={5} />
        <Lightformer intensity={0.9} color="#5fe0c6" position={[4, 1, -2]} scale={5} />
      </Environment>
      <AltarGem shape={a} pos={[-1.7, 0, 0]} scale={0.4} show />
      <AltarGem shape={b} pos={[1.7, 0, 0]} scale={0.4} show />
      <AltarGem shape={out} pos={[0, 0.3, -0.6]} scale={0.6} show={discovered} />
      {/* forge sparks streaming toward the centre result */}
      <Sparkles count={44} scale={[5, 2.6, 2.6]} position={[0, 0.5, 0]} size={2.2} speed={0.6} color="#ffce5c" />
    </Canvas>
  )
}
