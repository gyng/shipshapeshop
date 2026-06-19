import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Stars, Sparkles } from '@react-three/drei'
import { Suspense, type ReactNode } from 'react'
import * as THREE from 'three'

/**
 * The "planetarium between dimensions" stage (procedural → offline-PWA-safe).
 *
 * The glass REFRACTS whatever is drawn behind it and REFLECTS the environment map, so we make a soft,
 * colourful Lightformer "nebula dome" the actual scene background (`Environment background`, blurred into a
 * gradient): the gems refract bright colour (not black) and reflect the dome; a starfield + sparkles sit in
 * front for depth.
 *
 * No EffectComposer/Bloom and no temporal/animated distortion on the glass — both flicker badly with
 * transmission (the composer feeds back through the transmission buffer); the bright env + clearcoat carry
 * the glow stably instead.
 */
export function Stage({ children, controls = false }: { children: ReactNode; controls?: boolean }) {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#0b0a16']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      <Stars radius={60} depth={50} count={1800} factor={4} saturation={0.7} fade speed={0.3} />
      <Sparkles count={40} scale={[8, 6, 6]} size={2.4} speed={0.15} opacity={0.6} color="#cfe0ff" />
      <Suspense fallback={null}>
        {children}
        <Environment
          resolution={256}
          background
          backgroundBlurriness={0.75}
          backgroundIntensity={0.5}
          environmentIntensity={1.15}
        >
          <Lightformer form="rect" intensity={3} position={[0, 0, -10]} scale={[24, 24, 1]} color="#2a1d4d" />
          <Lightformer form="rect" intensity={5} position={[6, 5, 4]} scale={[9, 9, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={3} position={[-7, 2, 3]} scale={[7, 9, 1]} color="#5aa6ff" />
          <Lightformer form="rect" intensity={2.6} position={[0, -6, 4]} scale={[12, 4, 1]} color="#ffae66" />
          <Lightformer form="ring" intensity={4} position={[-4, 5, -5]} scale={3} color="#ff5db0" />
          <Lightformer form="circle" intensity={3} position={[5, -3, -4]} scale={2.4} color="#5ff0c8" />
        </Environment>
      </Suspense>
      {controls && (
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          minDistance={3}
          maxDistance={9}
          rotateSpeed={0.9}
          // left OR right drag orbits; one finger orbits, two fingers pinch-zoom
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      )}
    </Canvas>
  )
}
