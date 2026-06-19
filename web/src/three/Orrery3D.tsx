import { useRef, useState, useMemo, useEffect } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, Float, ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { getGeometry, OPEN_FAMILIES } from './geometry'
import { RARITY_COLOR } from './Gem'
import { useGame, type ShapeRow, type OrbitView } from '../game/store'
import { useOrreryUi } from '../orreryUi'
import { sceneById } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

const RANK: Record<keyof typeof RARITY_COLOR, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4 }
const HEX = 0.62 // hex centre-to-corner (world units)
const SQ3 = Math.sqrt(3)

// pointy-top axial → world (floor plane y=0)
function axialToWorld(q: number, r: number): [number, number, number] {
  return [HEX * SQ3 * (q + r / 2), 0, HEX * 1.5 * r]
}
function worldToAxial(x: number, z: number): [number, number] {
  const qf = ((SQ3 / 3) * x - (1 / 3) * z) / HEX
  const rf = ((2 / 3) * z) / HEX
  // cube round
  let rx = Math.round(qf)
  let ry = Math.round(-qf - rf)
  let rz = Math.round(rf)
  const dx = Math.abs(rx - qf)
  const dy = Math.abs(ry - (-qf - rf))
  const dz = Math.abs(rz - rf)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return [rx, rz]
}
const hexDist = (q: number, r: number) => (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2
// While dragging, gems stop catching the ray so the floor keeps receiving pointer-move (no stall over a gem).
const NOOP_RAYCAST: THREE.Object3D['raycast'] = () => {}

// A faint hex pad marking an anchorable cell; brightens when it's on the hovered shape's path.
function HexPad({ q, r, lit }: { q: number; r: number; lit: boolean }) {
  const [x, , z] = axialToWorld(q, r)
  return (
    <mesh position={[x, -0.38, z]} rotation={[0, Math.PI / 6, 0]}>
      <cylinderGeometry args={[HEX * 0.92, HEX * 0.92, 0.04, 6]} />
      <meshStandardMaterial
        color={lit ? '#ffcf6b' : '#1a1c28'}
        emissive={lit ? '#ffcf6b' : '#000000'}
        emissiveIntensity={lit ? 0.5 : 0}
        transparent
        opacity={lit ? 0.5 : 0.32}
        metalness={0.2}
        roughness={0.7}
      />
    </mesh>
  )
}

// A gem that walks its lane (straight tween between consecutive cells), or sits at the drag-preview cell.
function OrbitGem({
  shape,
  orbit,
  timeRef,
  frozen,
  dragCell,
  dragging,
  onHover,
  onDragStart,
}: {
  shape: ShapeRow
  orbit: OrbitView
  timeRef: { current: number }
  frozen: boolean
  dragCell: [number, number] | null
  dragging: boolean
  onHover: (id: number | null) => void
  onDragStart: (id: number) => void
}) {
  const grp = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const rank = RANK[shape.rarity]
  const col = RARITY_COLOR[shape.rarity]
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * 0.7
    const g = grp.current
    if (!g) return
    if (dragCell) {
      const [x, , z] = axialToWorld(dragCell[0], dragCell[1])
      g.position.set(x, 0.25, z)
      return
    }
    if (orbit.period === 0 || orbit.path.length === 0) return
    const t = frozen ? 0 : timeRef.current
    const base = Math.floor(t)
    const frac = t - base
    const f = frac * frac * (3 - 2 * frac)
    const c0 = orbit.path[(orbit.phase + base) % orbit.period]
    const c1 = orbit.path[(orbit.phase + base + 1) % orbit.period]
    if (!c0 || !c1) return
    const [x0, , z0] = axialToWorld(c0[0], c0[1])
    const [x1, , z1] = axialToWorld(c1[0], c1[1])
    g.position.set(x0 + (x1 - x0) * f, 0, z0 + (z1 - z0) * f)
  })
  return (
    <group ref={grp}>
      <pointLight color={col} intensity={1.8 + rank * 0.4} distance={2.4} decay={1.6} />
      <Float speed={2.2} rotationIntensity={0} floatIntensity={0.55} floatingRange={[0, 0.12]}>
        <mesh
          ref={mesh}
          geometry={getGeometry(shape.family)}
          scale={0.3}
          raycast={dragging ? NOOP_RAYCAST : undefined}
          onPointerOver={(e) => { e.stopPropagation(); onHover(shape.id) }}
          onPointerOut={() => onHover(null)}
          onPointerDown={(e) => { e.stopPropagation(); onDragStart(shape.id) }}
        >
          <meshPhysicalMaterial
            color={col}
            metalness={0.3 + rank * 0.06}
            roughness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.08}
            emissive={col}
            emissiveIntensity={0.5 + rank * 0.12}
            envMapIntensity={1.6}
            side={OPEN_FAMILIES.has(shape.family) ? THREE.DoubleSide : THREE.FrontSide}
          />
        </mesh>
      </Float>
    </group>
  )
}

// A shape's full lane as a line through its path cells. Solid (hovered) or, with byTime, a subtle gradient
// that walks teal→violet→gold around the cycle so you can read the *timing* of every lane at a glance.
function PathLine({ orbit, color, byTime, opacity }: { orbit: OrbitView; color?: string; byTime?: boolean; opacity?: number }) {
  const obj = useMemo(() => {
    if (orbit.path.length < 2) return null
    const pts = orbit.path.map((c) => { const [x, , z] = axialToWorld(c[0], c[1]); return new THREE.Vector3(x, -0.3, z) })
    pts.push(pts[0].clone())
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    if (byTime) {
      const cols: number[] = []
      const c = new THREE.Color()
      pts.forEach((_, i) => {
        c.setHSL((0.5 + (i / pts.length) * 0.62) % 1, 0.72, 0.6)
        cols.push(c.r, c.g, c.b)
      })
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: opacity ?? 0.4 }))
    }
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color ?? '#ffffff', transparent: true, opacity: opacity ?? 0.9 }))
  }, [orbit.path, color, byTime, opacity])
  if (!obj) return null
  return <primitive object={obj} />
}

function Scene() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const setAnchor = useGame((s) => s.setAnchor)
  const scene = sceneById(view?.scene ?? 0)
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  const paused = useOrreryUi((s) => s.paused)
  const hoverId = useOrreryUi((s) => s.hoverId)
  const setHover = useOrreryUi((s) => s.setHover)
  const showAllLines = useOrreryUi((s) => s.showAllLines)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragCell, setDragCell] = useState<[number, number] | null>(null)

  const orbits = view?.orrery_orbits ?? []
  const cells = view?.orrery_cells ?? []
  const radius = view?.orrery_radius ?? 4
  const loadout = view?.loadout ?? []
  const tickSec = (view?.orrery_tick_ms ?? 1000) / 1000

  // shared clock in tick units; advances unless paused. A drag freezes everyone at t=0 so you can read the layout.
  const timeRef = useRef(0)
  const frozen = dragId !== null
  useFrame((_, dt) => {
    if (!paused && dragId === null) timeRef.current += dt / tickSec
  })

  // the hovered shape's path cells (packed) → lit pads
  const litCells = useMemo(() => {
    const set = new Set<string>()
    if (hoverId == null) return set
    const slot = loadout.indexOf(hoverId)
    const orb = orbits[slot]
    orb?.path.forEach((c) => set.add(`${c[0]},${c[1]}`))
    return set
  }, [hoverId, loadout, orbits])

  // Commit the drag on ANY pointer release (window-level) so letting go over a gem / off-canvas still places it.
  const dragCellRef = useRef<[number, number] | null>(null)
  dragCellRef.current = dragCell
  useEffect(() => {
    if (dragId == null) return
    const up = () => {
      const dc = dragCellRef.current
      if (dc) setAnchor(dragId, dc[0], dc[1])
      setDragId(null)
      setDragCell(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [dragId, setAnchor])
  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    if (dragId == null) return
    const [q, r] = worldToAxial(e.point.x, e.point.z)
    if (hexDist(q, r) <= radius) setDragCell([q, r])
  }

  return (
    <>
      <color attach="background" args={['#0a0b14']} />
      <fog attach="fog" args={['#0a0b14', 10, 30]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cfe0ff', '#181228', 0.7]} />
      <directionalLight position={[3, 7, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} color={cool} position={[-4, 3, -4]} scale={7} />
        <Lightformer intensity={2.2} color={warm} position={[5, 2, -3]} scale={7} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 5, 2]} scale={5} />
      </Environment>

      {/* floor plane — receives the drag raycast */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.4, 0]}
        receiveShadow
        onPointerMove={onFloorMove}
      >
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#0d0e1a" metalness={0.6} roughness={0.45} />
      </mesh>

      {/* hex pads */}
      {cells.map(([q, r]) => (
        <HexPad key={`${q},${r}`} q={q} r={r} lit={litCells.has(`${q},${r}`)} />
      ))}

      {/* all lanes (subtle, coloured by time) when toggled on */}
      {showAllLines && orbits.map((orb, i) => (orb.path.length > 1 ? <PathLine key={`all${loadout[i]}`} orbit={orb} byTime opacity={0.3} /> : null))}

      {/* hovered shape's lane (bright) */}
      {hoverId != null && (() => {
        const slot = loadout.indexOf(hoverId)
        const orb = orbits[slot]
        const sh = shapes[hoverId]
        return orb && sh ? <PathLine orbit={orb} color={RARITY_COLOR[sh.rarity]} opacity={0.95} /> : null
      })()}

      {/* gems */}
      {orbits.map((orb, i) => {
        const sh = shapes[loadout[i]]
        if (!sh) return null
        return (
          <OrbitGem
            key={loadout[i]}
            shape={sh}
            orbit={orb}
            timeRef={timeRef}
            frozen={frozen}
            dragCell={dragId === sh.id ? dragCell : null}
            dragging={dragId !== null}
            onHover={setHover}
            onDragStart={(id) => { setDragId(id); setDragCell(orb.anchor) }}
          />
        )
      })}

      <ContactShadows position={[0, -0.39, 0]} opacity={0.5} scale={16} blur={2.6} far={4} />
      <Sparkles count={Math.round(50 * g.sparkle)} scale={[10, 4, 10]} position={[0, 1.4, 0]} size={1.5} speed={0.3} color="#ffcf6b" />
      <OrbitControls
        makeDefault
        enabled={dragId === null}
        enablePan
        enableZoom
        minDistance={3}
        maxDistance={16}
        minPolarAngle={0.2}
        maxPolarAngle={1.45}
        autoRotate={dragId === null && hoverId === null && !showAllLines}
        autoRotateSpeed={0.4}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  )
}

export function Orrery3D() {
  const g = useGfxPreset()
  return (
    <Canvas dpr={g.dpr} shadows={g.shadows} gl={{ powerPreference: 'high-performance' }} camera={{ position: [0, 5, 6.5], fov: 46 }} onPointerMissed={() => undefined}>
      <Scene />
    </Canvas>
  )
}
