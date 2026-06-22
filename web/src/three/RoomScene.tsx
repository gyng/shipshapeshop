import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, ContactShadows, OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { OPEN_FAMILIES } from './geometry'
import { shapeGeometry, useRelics } from './relics'
import { RARITY_COLOR, RARITY_RANK, sceneGemMatProps } from './Gem'
import { ScenePostFX } from './ScenePostFX'
import { RenderTechBadge } from './RenderTechBadge'
import { CursorLight } from './CursorLight'
import { useGame, type ShapeRow } from '../game/store'
import { sceneById, decorById, SLOT_DECOR } from '../content/cosmetics'
import { Atmosphere } from './Atmosphere'
import { useGfxPreset } from '../gfx'

// Soft "home" bounds — gems wander inside it and spring back when knocked/thrown beyond it.
const BX = 3.2
const BZ = 1.7
const FLOOR_Y = 0.34
const rx = () => (Math.random() * 2 - 1) * BX
const rz = () => (Math.random() * 2 - 1) * BZ

// One physics body per roomed shape — pos/vel on the floor plane, plus the wander + hop timers. The shared
// loop in RoamGems integrates them all (so they can collide), and the player can grab + throw them.
interface Body {
  pos: THREE.Vector3
  vel: THREE.Vector3
  wander: THREE.Vector3
  wanderT: number
  hopT: number
  tapHopT: number
  radius: number
  scale: number
  yaw: number // current facing (smoothly turns toward heading while moving)
  idleSpin: number // a lazy turn-in-place while idling (re-rolled with the wander target)
}

const _tmp = new THREE.Vector3()

// All the roaming gems + the hand-rolled physics that lets you drag, throw, and knock them around. Lives inside
// the Canvas so it can use the camera/raycaster. The bodies array is stable per roster (the HUD's 1s ticks
// never reset it), so positions persist; gems are positioned imperatively each frame (never via a React prop).
function RoamGems({
  roster,
  secretaryId,
  onTap,
  controls,
}: {
  roster: ShapeRow[]
  secretaryId: number | null
  onTap: (id: number) => void
  controls: React.RefObject<{ enabled: boolean } | null>
}) {
  const { camera, gl } = useThree()
  const gfx = useGfxPreset()
  const bodies = useMemo<Body[]>(
    () =>
      roster.map((s, i) => {
        const p = new THREE.Vector3(rx(), FLOOR_Y, rz())
        return { pos: p, vel: new THREE.Vector3(), wander: new THREE.Vector3(p.x, 0, p.z), wanderT: 1 + i, hopT: 2 + i, tapHopT: 0, radius: s.id === secretaryId ? 0.42 : 0.3, scale: s.id === secretaryId ? 0.5 : 0.34, yaw: Math.random() * Math.PI * 2, idleSpin: 0 }
      }),
    // bodies persist for the life of this roster (RoomView memoises roster per 30-min window / shuffle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster],
  )
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const grabbed = useRef<number | null>(null)
  const grabPrev = useRef(new THREE.Vector3()) // last grab point — for throw velocity
  const grabVel = useRef(new THREE.Vector3())
  const moved = useRef(false) // distinguish a tap from a drag

  // pointer → floor-plane intersection (y = FLOOR_Y), reusing scratch objects
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y), [])
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const projectFloor = (e: ThreeEvent<PointerEvent>, out: THREE.Vector3): boolean => {
    const r = gl.domElement.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1
    ray.setFromCamera({ x: nx, y: ny } as THREE.Vector2, camera)
    return ray.ray.intersectPlane(plane, out) != null
  }

  const release = () => {
    const G = grabbed.current
    if (G != null) {
      bodies[G].vel.copy(grabVel.current) // launch with the tracked drag velocity (throw!)
      grabbed.current = null
      grabVel.current.set(0, 0, 0)
      if (controls.current) controls.current.enabled = true
      document.body.style.cursor = 'auto'
    }
  }

  const onGemDown = (i: number, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    grabbed.current = i
    moved.current = false
    grabVel.current.set(0, 0, 0)
    if (projectFloor(e, _tmp)) grabPrev.current.copy(_tmp)
    if (controls.current) controls.current.enabled = false // don't orbit the camera while dragging a gem
    document.body.style.cursor = 'grabbing'
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  // floor receives the move/up so a fast drag that slips off the gem still tracks
  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    const G = grabbed.current
    if (G == null) return
    if (!projectFloor(e, _tmp)) return
    const b = bodies[G]
    grabVel.current.set((_tmp.x - grabPrev.current.x) / 0.016, 0, (_tmp.z - grabPrev.current.z) / 0.016) // ~per-frame → per-sec
    if (_tmp.distanceTo(grabPrev.current) > 0.04) moved.current = true
    b.pos.x = _tmp.x
    b.pos.z = _tmp.z
    b.vel.set(0, 0, 0)
    grabPrev.current.copy(_tmp)
  }

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const G = grabbed.current
    // integrate the free bodies
    for (let i = 0; i < bodies.length; i++) {
      if (i === G) continue
      const b = bodies[i]
      // gentle wander toward a roaming target
      b.wanderT -= dt
      if (b.wanderT <= 0 || (b.pos.x - b.wander.x) ** 2 + (b.pos.z - b.wander.z) ** 2 < 0.09) {
        b.wander.set(rx(), 0, rz())
        b.wanderT = 3 + Math.random() * 4
        b.idleSpin = (Math.random() - 0.5) * 1.1 // sometimes a lazy turn-in-place, sometimes near-still
      }
      _tmp.set(b.wander.x - b.pos.x, 0, b.wander.z - b.pos.z)
      const wl = _tmp.length()
      if (wl > 0.001) b.vel.addScaledVector(_tmp.multiplyScalar(1 / wl), 0.5 * dt) // stroll
      // soft spring back inside the home bounds (knock/throw a gem out and it drifts home)
      const ex = Math.abs(b.pos.x) - BX
      const ez = Math.abs(b.pos.z) - BZ
      if (ex > 0) b.vel.x -= Math.sign(b.pos.x) * ex * 7 * dt
      if (ez > 0) b.vel.z -= Math.sign(b.pos.z) * ez * 7 * dt
      // damping + speed clamp
      b.vel.multiplyScalar(Math.pow(0.84, dt * 60))
      const sp = Math.hypot(b.vel.x, b.vel.z)
      if (sp > 9) b.vel.multiplyScalar(9 / sp)
      b.pos.x += b.vel.x * dt
      b.pos.z += b.vel.z * dt
    }
    // pairwise collisions — separate overlaps + bounce (so you can knock gems into each other)
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]
        const c = bodies[j]
        const dx = c.pos.x - a.pos.x
        const dz = c.pos.z - a.pos.z
        const d = Math.hypot(dx, dz)
        const min = a.radius + c.radius
        if (d > 1e-4 && d < min) {
          const nx = dx / d
          const nz = dz / d
          const overlap = min - d
          if (i !== G) {
            a.pos.x -= nx * overlap * (j === G ? 1 : 0.5)
            a.pos.z -= nz * overlap * (j === G ? 1 : 0.5)
          }
          if (j !== G) {
            c.pos.x += nx * overlap * (i === G ? 1 : 0.5)
            c.pos.z += nz * overlap * (i === G ? 1 : 0.5)
          }
          const approaching = a.vel.x * nx + a.vel.z * nz - (c.vel.x * nx + c.vel.z * nz)
          if (approaching > 0) {
            const imp = approaching * 0.9
            if (i !== G) { a.vel.x -= imp * nx; a.vel.z -= imp * nz }
            if (j !== G) { c.vel.x += imp * nx; c.vel.z += imp * nz }
            // a held gem shoves the other with its drag speed
            if (i === G || j === G) {
              const other = i === G ? c : a
              other.vel.x += grabVel.current.x * 0.4 * (i === G ? 1 : -1) * 0 + nx * Math.abs(grabVel.current.length()) * 0.3
              other.vel.z += nz * Math.abs(grabVel.current.length()) * 0.3
            }
          }
        }
      }
    }
    // write positions to the gem groups (+ bob, hop, tap-hop, lift-while-held, face heading)
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]
      const g = groupRefs.current[i]
      if (!g) continue
      b.hopT -= dt
      let hop = 0
      if (b.hopT < 0.4 && b.hopT > 0) hop = Math.sin(((0.4 - b.hopT) / 0.4) * Math.PI) * 0.34
      if (b.hopT <= 0) b.hopT = 3 + Math.random() * 6
      b.tapHopT = Math.max(0, b.tapHopT - dt)
      const tapHop = b.tapHopT > 0 ? Math.sin((1 - b.tapHopT / 0.45) * Math.PI) * 0.5 : 0
      const lift = i === G ? 0.45 : 0
      g.position.set(b.pos.x, FLOOR_Y + Math.sin(state.clock.elapsedTime * 2 + i * 1.3) * 0.05 + hop + tapHop + lift, b.pos.z)
      // face where it's heading (smoothly turn) · held → a happy spin · idling → a lazy turn now and then
      const sp2 = b.vel.x * b.vel.x + b.vel.z * b.vel.z
      if (i === G) {
        b.yaw += dt * 1.4
      } else if (sp2 > 0.05) {
        let d = Math.atan2(b.vel.x, b.vel.z) - b.yaw
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        b.yaw += d * Math.min(1, dt * 5)
      } else {
        b.yaw += b.idleSpin * dt
      }
      g.rotation.y = b.yaw
    }
  })

  useRelics() // real Relic meshes once loaded (the roster shows the real famous shapes, not stand-ins)
  return (
    <>
      {roster.map((s, i) => {
        const col = RARITY_COLOR[s.rarity]
        const body = bodies[i]
        return (
          <group key={s.id} ref={(el) => { groupRefs.current[i] = el }}>
            <mesh
              geometry={shapeGeometry(s.family)}
              scale={body.scale}
              castShadow
              onPointerDown={(e) => onGemDown(i, e)}
              onPointerMove={onFloorMove}
              onPointerUp={(e) => {
                e.stopPropagation()
                if (!moved.current) {
                  body.tapHopT = 0.45 // a tap (not a drag) → happy hop + chat
                  onTap(s.id)
                }
                release()
              }}
              onPointerOver={() => (document.body.style.cursor = grabbed.current == null ? 'grab' : 'grabbing')}
              onPointerOut={() => grabbed.current == null && (document.body.style.cursor = 'auto')}
            >
              {/* transmission glass (when gfx.sceneGlass) or opaque emissive PBR — shared recipe, see Gem.ts */}
              <meshPhysicalMaterial {...sceneGemMatProps(col, RARITY_RANK[s.rarity], OPEN_FAMILIES.has(s.family), gfx.sceneGlass)} />
            </mesh>
            {/* little glow disc it sits on */}
            <mesh position={[0, -0.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.16, 0.28, 28]} />
              <meshBasicMaterial color={col} transparent opacity={0.4} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            {s.id === secretaryId && <Sparkles count={8} scale={[0.6, 1.2, 0.6]} position={[0, 0.55, 0]} size={2.4} speed={0.5} color="#ffd76b" />}
          </group>
        )
      })}
    </>
  )
}

// ── Room decor (Shop slot 5) — themed prop sets that dress the floor. All primitives (no external assets), no
// pointer handlers (so they never intercept a gem drag), placed around the periphery so the roam area stays open.
function Rug({ color, r = 2.4 }: { color: string; r?: number }) {
  return (
    <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[r, 48]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  )
}
function Lamp({ pos, color = '#ffd9a0' }: { pos: [number, number, number]; color?: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.22, 0.26, 0.04, 16]} /><meshStandardMaterial color="#2a2d38" metalness={0.5} roughness={0.5} /></mesh>
      <mesh position={[0, 0.62, 0]}><cylinderGeometry args={[0.03, 0.04, 1.2, 8]} /><meshStandardMaterial color="#3a3d4e" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0, 1.32, 0]}><sphereGeometry args={[0.17, 18, 18]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} toneMapped={false} /></mesh>
      <pointLight position={[0, 1.32, 0]} color={color} intensity={3.2} distance={4.2} decay={1.6} />
    </group>
  )
}
function Plant({ pos, foliage = '#4a8f4a' }: { pos: [number, number, number]; foliage?: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.13, 0]}><cylinderGeometry args={[0.15, 0.2, 0.26, 14]} /><meshStandardMaterial color="#8a5a3a" roughness={0.85} /></mesh>
      <mesh position={[0, 0.46, 0]}><icosahedronGeometry args={[0.27, 0]} /><meshStandardMaterial color={foliage} roughness={0.7} flatShading /></mesh>
      <mesh position={[0.14, 0.34, 0.06]}><icosahedronGeometry args={[0.16, 0]} /><meshStandardMaterial color={foliage} roughness={0.7} flatShading /></mesh>
    </group>
  )
}
function Rock({ pos, s = 0.3 }: { pos: [number, number, number]; s?: number }) {
  return (
    <mesh position={pos} scale={s} rotation={[0.4, 0.7, 0.15]} castShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#6a6e7e" roughness={0.92} flatShading />
    </mesh>
  )
}
function NeonRing({ pos, color, rot = 0 }: { pos: [number, number, number]; color: string; rot?: number }) {
  return (
    <mesh position={pos} rotation={[0, rot, 0]}>
      <torusGeometry args={[0.5, 0.06, 12, 40]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} toneMapped={false} />
    </mesh>
  )
}
function Lantern({ pos, color, phase }: { pos: [number, number, number]; color: string; phase: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => {
    if (ref.current) ref.current.position.y = pos[1] + Math.sin(s.clock.elapsedTime * 0.8 + phase) * 0.18
  })
  return (
    <group ref={ref} position={pos}>
      <mesh><sphereGeometry args={[0.16, 16, 16]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} toneMapped={false} /></mesh>
      <pointLight color={color} intensity={1.4} distance={2.8} decay={1.6} />
    </group>
  )
}

// Renders the equipped decor theme's prop set into the room (or nothing for "Bare Floor").
function RoomDecor() {
  const kind = decorById(useGame((s) => s.view?.equipped?.[SLOT_DECOR] ?? 0)).kind
  if (kind === 'cozy')
    return (
      <group>
        <Rug color="#5a3a4a" r={2.5} />
        <Lamp pos={[-2.7, 0, -1.2]} />
        <Plant pos={[2.6, 0, -1.3]} />
        <Plant pos={[-2.8, 0, 1.2]} foliage="#5aa05a" />
      </group>
    )
  if (kind === 'zen')
    return (
      <group>
        <Rug color="#cabf9a" r={2.7} />
        <Rock pos={[-2.4, 0.18, -1.0]} s={0.42} />
        <Rock pos={[2.3, 0.14, -1.2]} s={0.3} />
        <Rock pos={[2.6, 0.1, 0.9]} s={0.2} />
        <Plant pos={[-2.7, 0, 1.2]} foliage="#3a7f4a" />
      </group>
    )
  if (kind === 'arcade')
    return (
      <group>
        <Rug color="#15111f" r={2.6} />
        <NeonRing pos={[-2.6, 0.6, -1.2]} color="#ff5d8f" rot={0.4} />
        <NeonRing pos={[2.5, 0.7, -1.3]} color="#5fe0c6" rot={-0.5} />
        <NeonRing pos={[2.7, 0.5, 1.0]} color="#b985ff" rot={0.2} />
        <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 1.9, 48]} />
          <meshStandardMaterial color="#5fe0c6" emissive="#5fe0c6" emissiveIntensity={1.2} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    )
  if (kind === 'starlit')
    return (
      <group>
        <Lantern pos={[-2.6, 1.4, -1.2]} color="#ffcf6b" phase={0} />
        <Lantern pos={[2.5, 1.7, -1.3]} color="#ffae3a" phase={1.7} />
        <Lantern pos={[2.7, 1.2, 1.0]} color="#fff3b0" phase={3.1} />
        <Lantern pos={[-2.8, 1.9, 1.1]} color="#ffcf6b" phase={4.4} />
      </group>
    )
  return null
}

/** The lobby ("My Room"): your shapes roam a cozy floor with light physics — drag to pick one up, fling it,
 *  knock it into the others; they drift back home. Camera controls match the Orrery (rotate + zoom). */
export function RoomScene({ roster, secretaryId, onTap }: { roster: ShapeRow[]; secretaryId: number | null; onTap: (id: number) => void }) {
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas resize={{ offsetSize: true }} dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 3.1, 5.6], fov: 46 }}>
      <color attach="background" args={['#0a0b14']} />
      <Atmosphere defaultFog={['#0a0b14', 10, 26]} moteScale={[12, 4, 8]} motePos={[0, 1.6, 0]} />
      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#cfe0ff', '#181228', 0.75]} />
      <directionalLight position={[3, 7, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <CursorLight planeY={0.25} />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} color={cool} position={[-4, 3, -4]} scale={7} />
        <Lightformer intensity={2.2} color={warm} position={[5, 2, -3]} scale={7} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 5, 2]} scale={5} />
      </Environment>

      {/* cozy endless floor + soft grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#11131f" metalness={0.5} roughness={0.55} />
      </mesh>
      <Grid position={[0, -0.01, 0]} infiniteGrid cellSize={0.7} cellThickness={0.5} cellColor="#262a3c" sectionSize={3.5} sectionThickness={1} sectionColor="#3a4060" fadeDistance={26} fadeStrength={1.6} />

      <RoomDecor />
      <RoamGems roster={roster} secretaryId={secretaryId} onTap={onTap} controls={controls} />

      <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={14} blur={2.6} far={4} />
      <Sparkles count={Math.round(40 * g.sparkle)} scale={[12, 4, 8]} position={[0, 1.6, 0]} size={1.5} speed={0.25} color={scene.stars} />
      {/* same scheme as the Orrery: rotate + zoom (pan off), gentle limits */}
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        enableZoom
        minDistance={3.5}
        maxDistance={10}
        minPolarAngle={0.35}
        maxPolarAngle={1.4}
        rotateSpeed={0.8}
        zoomSpeed={0.7}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
      {/* shared post chain (optional SSAO + bloom → ACES) */}
      <ScenePostFX />
    </Canvas>
      <RenderTechBadge tech="mesh" />
    </div>
  )
}
