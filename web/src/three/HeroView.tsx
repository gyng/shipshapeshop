import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stage } from './Stage'
import { HeroGem } from './Gem'
import { RaymarchGem, RAYMARCH_SHAPES } from './RaymarchGem'
import { ModelGem, MODEL_FILES } from './ModelGem'
import { useGame, type RarityName } from '../game/store'
import { useGfxPreset } from '../gfx'

/**
 * The focused/hero gem. With the default scene, SDF shapes are **raymarched** (true refraction). When a Shop
 * scene is equipped, raymarchable shapes route to the mesh + transmission Stage instead, so the chosen
 * environment (incl. the Cornell box) applies to every shape.
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
  const sceneId = useGame((s) => s.view?.scene ?? 0)
  const g = useGfxPreset()
  if (sceneId === 0 && family in RAYMARCH_SHAPES) {
    return (
      <Canvas dpr={g.dpr} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <RaymarchGem key={family + rarity} family={family} rarity={rarity} />
      </Canvas>
    )
  }
  if (family in MODEL_FILES) {
    return (
      <Stage controls={controls} rarity={rarity}>
        <Suspense fallback={null}>
          <ModelGem family={family} rarity={rarity} spin={spin} />
        </Suspense>
      </Stage>
    )
  }
  return (
    <Stage controls={controls} rarity={rarity}>
      <HeroGem family={family} rarity={rarity} spin={spin} />
    </Stage>
  )
}
