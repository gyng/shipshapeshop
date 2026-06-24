// A cheap ambient backdrop for the Expeditions screen — a slowly drifting field of motes (the "deep Manifold"
// behind the panels). Render-only atmosphere; no game truth touches this. Mounted absolutely BEHIND the screen
// content (z-index −1 inside an isolated stacking context) so it never overlays the nav or the panels.
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function Motes() {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const N = 360
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 3
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
  // free the GPU buffer when the tab unmounts (the codebase convention for by-reference geometries)
  useEffect(() => () => geo.dispose(), [geo])
  useFrame((state, dt) => {
    const p = ref.current
    if (!p) return
    p.rotation.y += dt * 0.018
    p.position.y = Math.sin(state.clock.elapsedTime * 0.13) * 0.5
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.05} color="#9b8cff" transparent opacity={0.5} sizeAttenuation depthWrite={false} />
    </points>
  )
}

export function ExpeditionStage({ paused }: { paused?: boolean }) {
  // pause (don't unmount) while a watch overlay is open, so this ambient backdrop isn't a second always-on
  // WebGL context competing with the engineered-peak combat scene.
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }} aria-hidden>
      <Canvas frameloop={paused ? 'never' : 'always'} camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 1.5]} gl={{ alpha: true }} style={{ width: '100%', height: '100%' }}>
        <Motes />
      </Canvas>
    </div>
  )
}
