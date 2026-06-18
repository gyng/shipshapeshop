import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshTransmissionMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry } from './geometry'
import type { RarityName } from '../game/store'

// Per-rarity look — the material ladder escalates with rarity (matte → glass → dispersive gem).
export const RARITY_COLOR: Record<RarityName, string> = {
  Common: '#9aa6c2',
  Rare: '#5fe0c6',
  Epic: '#b985ff',
  Ssr: '#ffb86b',
  Ur: '#ff5d8f',
}

const RARITY_RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4 }

/** The hero gem (pull reveal + inspector): real transmission glass, dispersion scaling with rarity. */
export function HeroGem({ family, rarity, spin = 0.4 }: { family: string; rarity: RarityName; spin?: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const rank = RARITY_RANK[rarity]
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.y += dt * spin
      ref.current.rotation.x += dt * spin * 0.35
    }
  })
  return (
    <mesh ref={ref} geometry={getGeometry(family)} scale={1.7}>
      <MeshTransmissionMaterial
        color={RARITY_COLOR[rarity]}
        thickness={1.2}
        roughness={Math.max(0, 0.18 - rank * 0.04)}
        transmission={0.6 + rank * 0.1}
        ior={1.45 + rank * 0.07}
        chromaticAberration={0.04 + rank * 0.06}
        anisotropy={0.2}
        distortion={0.1}
        distortionScale={0.3}
        temporalDistortion={0.1}
        clearcoat={1}
        attenuationColor={RARITY_COLOR[rarity]}
        attenuationDistance={2.5}
        emissive={RARITY_COLOR[rarity]}
        emissiveIntensity={rank >= 3 ? 0.12 : 0.03}
      />
    </mesh>
  )
}

/** Cheap thumbnail material for the collection grid (no transmission → many can render at once). */
export function ThumbGem({ family, rarity, owned }: { family: string; rarity: RarityName; owned: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.6
  })
  return (
    <mesh ref={ref} geometry={getGeometry(family)} scale={1.3}>
      <meshStandardMaterial
        color={owned ? RARITY_COLOR[rarity] : '#2a2c3a'}
        roughness={0.35}
        metalness={0.3}
        emissive={owned ? RARITY_COLOR[rarity] : '#000000'}
        emissiveIntensity={owned ? 0.15 : 0}
        flatShading={false}
      />
    </mesh>
  )
}
