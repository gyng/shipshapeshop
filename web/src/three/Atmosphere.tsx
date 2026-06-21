import { Sparkles } from '@react-three/drei'
import { useGame } from '../game/store'
import { atmosphereById, SLOT_ATMOSPHERE } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

// Shared volumetric atmosphere, driven by the equipped Atmosphere cosmetic (Shop, slot 8): distance fog +
// a drifting-mote layer. The path-trace haze contribution (atmo.haze) is read separately by the hero PT gems.
//
// `defaultFog` is the scene's OWN fog, used when the Clear (id 0) atmosphere is equipped, so each scene keeps
// its native look until the player buys a mood (pass null for no fog when Clear). `fog={false}` renders the
// mote layer only — used on the close-up hero stage, where distance fog would just muddy the focal gem (the
// hero instead gets its volumetric depth from the path-traced haze).
export function Atmosphere({
  defaultFog = null,
  fog = true,
  moteScale = [10, 5, 10],
  motePos = [0, 1.4, 0],
}: {
  defaultFog?: [string, number, number] | null
  fog?: boolean
  moteScale?: [number, number, number]
  motePos?: [number, number, number]
}) {
  const atmo = atmosphereById(useGame((s) => s.view?.equipped?.[SLOT_ATMOSPHERE] ?? 0))
  const g = useGfxPreset()
  const clear = atmo.id === 0
  const fogArgs: [string, number, number] | null = clear ? defaultFog : [atmo.fog, atmo.fogNear, atmo.fogFar]
  return (
    <>
      {fog && fogArgs && <fog attach="fog" args={fogArgs} />}
      {!clear && atmo.moteCount > 0 && (
        <Sparkles
          count={Math.max(1, Math.round(atmo.moteCount * g.sparkle))}
          scale={moteScale}
          position={motePos}
          size={atmo.moteSize}
          speed={atmo.moteSpeed}
          opacity={atmo.moteOpacity}
          color={atmo.mote}
          noise={1}
        />
      )}
    </>
  )
}
