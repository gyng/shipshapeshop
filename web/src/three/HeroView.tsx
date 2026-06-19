import { Canvas } from '@react-three/fiber'
import { Stage } from './Stage'
import { HeroGem } from './Gem'
import { RaymarchGem, RAYMARCH_SHAPES } from './RaymarchGem'
import type { RarityName } from '../game/store'

/**
 * The focused/hero gem. Shapes with an exact SDF are **raymarched** (true refraction, exact implicit
 * surfaces, no flicker — a bare Canvas; the shader draws its own cosmos). Everything else falls back to the
 * mesh + transmission Stage.
 */
export function HeroView({
  family,
  rarity,
  controls = true,
  spin = 0.4,
}: {
  family: string
  rarity: RarityName
  controls?: boolean
  spin?: number
}) {
  if (family in RAYMARCH_SHAPES) {
    return (
      <Canvas dpr={[1, 1.6]} gl={{ antialias: true }}>
        <RaymarchGem key={family + rarity} family={family} rarity={rarity} />
      </Canvas>
    )
  }
  return (
    <Stage controls={controls}>
      <HeroGem family={family} rarity={rarity} spin={spin} />
    </Stage>
  )
}
