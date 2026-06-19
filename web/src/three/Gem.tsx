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
        // Clear refractive glass. NO temporal/animated distortion and NO backside double-pass — both
        // flicker with transmission. The bright nebula env behind makes the body refract colour (not
        // black); rarity shows as subtle internal attenuation + dispersion, not a solid tint.
        color="#ffffff"
        transmission={1}
        thickness={1.2}
        roughness={Math.max(0.0, 0.06 - rank * 0.015)}
        ior={1.5 + rank * 0.06}
        chromaticAberration={0.05 + rank * 0.07}
        clearcoat={1}
        clearcoatRoughness={0.12}
        attenuationColor={RARITY_COLOR[rarity]}
        attenuationDistance={rank >= 3 ? 2.5 : 6}
        samples={6}
        resolution={512}
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
