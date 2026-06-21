import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '../game/store'
import { cursorFxById, SLOT_CURSOR } from '../content/cosmetics'

// A soft point light that follows the cursor across the floor — a little pool that picks out whichever gems
// you sweep past. The equipped Cursor cosmetic (Shop) sets its colour/intensity (incl. a hue-cycling "disco").
// Deliberately SHADOWLESS: a shadow-casting follow-light would re-render a full shadow map every frame (the one
// thing that *would* tank perf). A single shadowless point light is just one extra light term — effectively free.
export function CursorLight({ height = 1.3, planeY = 0 }: { height?: number; planeY?: number }) {
  const fx = cursorFxById(useGame((s) => s.view?.equipped?.[SLOT_CURSOR] ?? 0))
  const light = useRef<THREE.PointLight>(null)
  const { camera, pointer } = useThree()
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), [planeY])
  const hit = useMemo(() => new THREE.Vector3(), [])
  useFrame((state) => {
    const l = light.current
    if (!l) return
    ray.setFromCamera(pointer, camera)
    if (ray.ray.intersectPlane(plane, hit)) l.position.set(hit.x, planeY + height, hit.z)
    if (fx.disco) l.color.setHSL((state.clock.elapsedTime * 0.45) % 1, 0.9, 0.6) // rainbow cycle
  })
  if (fx.intensity <= 0) return null // "Off"
  return <pointLight ref={light} color={fx.color} intensity={fx.intensity} distance={fx.distance ?? 4.5} decay={1.5} />
}
