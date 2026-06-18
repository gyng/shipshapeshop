import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Suspense, type ReactNode } from 'react'

/**
 * A reusable 3D stage. Uses a procedural Lightformer environment (zero network, per RENDERING_PLAN) so the
 * transmission/gem materials get something to refract without shipping an HDRI.
 */
export function Stage({ children, controls = false }: { children: ReactNode; controls?: boolean }) {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#0d0d16']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 5]} intensity={1.2} />
      <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#88aaff" />
      <Suspense fallback={null}>
        {children}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={2} position={[3, 3, 2]} scale={4} color="#ffffff" />
          <Lightformer form="rect" intensity={1.2} position={[-4, 1, 2]} scale={3} color="#9ad7ff" />
          <Lightformer form="circle" intensity={1.5} position={[0, -3, 3]} scale={3} color="#ffd6a8" />
        </Environment>
      </Suspense>
      {controls && <OrbitControls enablePan={false} enableZoom={false} />}
    </Canvas>
  )
}
