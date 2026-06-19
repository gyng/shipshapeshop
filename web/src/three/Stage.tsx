import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Stars, Sparkles } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { Suspense, type ReactNode } from 'react'

/**
 * The "planetarium between dimensions" stage. Everything here is procedural (zero network → safe for the
 * offline PWA): an indigo gradient + starfield backdrop gives the transmission gems something rich to
 * refract; a Lightformer studio rig (key / fill / rim / warm "moon") supplies crisp glints + coloured
 * internal refraction; Bloom makes the bright bits glow. See RENDERING_PLAN.md.
 */
export function Stage({ children, controls = false }: { children: ReactNode; controls?: boolean }) {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#07070e']} />
      <fog attach="fog" args={['#07070e', 9, 22]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[4, 6, 5]} intensity={1.0} />
      {/* starfield: depth + colour for the glass to bend */}
      <Stars radius={50} depth={40} count={1400} factor={3.2} saturation={0.5} fade speed={0.4} />
      <Sparkles count={36} scale={[7, 5, 5]} size={2.2} speed={0.18} opacity={0.55} color="#bcd2ff" />
      <Suspense fallback={null}>
        {children}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3.6} position={[3, 3, 3]} scale={[6, 6, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={1.6} position={[-5, 1, 2]} scale={[5, 5, 1]} color="#8fc7ff" />
          <Lightformer form="rect" intensity={1.4} position={[0, -4, 3]} scale={[7, 2.5, 1]} color="#ffd2a0" />
          <Lightformer form="ring" intensity={2.6} position={[-2.5, 3.5, -5]} scale={2.4} color="#ff9ecf" />
        </Environment>
      </Suspense>
      <EffectComposer enableNormalPass={false}>
        <Bloom mipmapBlur luminanceThreshold={0.55} intensity={0.7} radius={0.7} />
      </EffectComposer>
      {controls && <OrbitControls enablePan={false} enableZoom={false} />}
    </Canvas>
  )
}
