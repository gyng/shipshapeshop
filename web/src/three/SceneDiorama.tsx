// Dioramas — a "setting" cosmetic that drops real GEOMETRY around the hero gem (not just a recolour). Mirrors the
// Cornell box (Stage.tsx CornellRoom): a <group> of meshes + lights rendered inside the Stage scene. When a diorama
// is equipped HeroView routes the gem through the mesh-transmission path (like the Cornell scene) so it sits as a
// real object INSIDE the set. The gem floats at the origin (~1.6 units after FIT_SCALE); the camera looks in from
// +z, so dioramas keep the front open and place geometry behind / beside / below (z ≤ ~1, |x| ≲ 3, floor ~y=-2).
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Sparkles, Environment, Lightformer } from '@react-three/drei'

// An organic flicker (campfire / torch): a sum of detuned sines so it never reads as a clean pulse.
function FlickerLight({ color, intensity, position, distance = 12, decay = 1.5, speed = 11, amt = 0.32 }: { color: string; intensity: number; position: [number, number, number]; distance?: number; decay?: number; speed?: number; amt?: number }) {
  const ref = useRef<THREE.PointLight>(null)
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime * speed
    const f = 1 - amt + amt * (0.6 * Math.sin(t) + 0.4 * Math.sin(t * 1.73 + 1.1)) * 0.5 + amt * 0.5
    ref.current.intensity = intensity * Math.max(0.4, f)
  })
  return <pointLight ref={ref} color={color} intensity={intensity} position={position} distance={distance} decay={decay} />
}

// ── 🔥 Campfire ───────────────────────────────────────────────────────────────────────────────────────────────
// Crossed logs + a ring of stones below the gem, rising embers, a warm flickering firelight. Night.
function CampfireDiorama() {
  const logMat = <meshStandardMaterial color="#5a3b27" roughness={0.95} />
  const logs = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI
    return (
      <mesh key={i} position={[Math.cos(a) * 0.18, -1.95, Math.sin(a) * 0.18]} rotation={[Math.PI / 2.4, a, 0]}>
        <cylinderGeometry args={[0.11, 0.13, 1.5, 7]} />
        {logMat}
      </mesh>
    )
  })
  const stones = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2
    return (
      <mesh key={i} position={[Math.cos(a) * 1.15, -2.15, Math.sin(a) * 1.15]} rotation={[a, i, a * 0.5]}>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color="#6b6b73" roughness={1} flatShading />
      </mesh>
    )
  })
  return (
    <group>
      {/* dark ground */}
      <mesh position={[0, -2.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[4.5, 32]} /><meshStandardMaterial color="#1c160f" roughness={1} /></mesh>
      {stones}
      {logs}
      {/* the glowing coals + a warm flickering firelight (the diorama's key light) */}
      <mesh position={[0, -2.0, 0]}><sphereGeometry args={[0.3, 12, 12]} /><meshStandardMaterial color="#ff7a1a" emissive="#ff6a10" emissiveIntensity={3.2} toneMapped={false} /></mesh>
      <FlickerLight color="#ff8a3a" intensity={9} position={[0, -1.6, 0]} distance={11} />
      <pointLight color="#ffd6a0" intensity={1.4} position={[0, 0.4, 0.6]} distance={6} decay={1.6} />
      <ambientLight intensity={0.12} color="#2a3a55" />
      {/* embers rising off the fire */}
      <Sparkles count={26} size={3} scale={[2.2, 3.4, 2.2]} position={[0, -0.4, 0]} speed={0.5} color="#ffb060" noise={1.4} />
    </group>
  )
}

// ── 🏰 Dungeon ────────────────────────────────────────────────────────────────────────────────────────────────
// Stone walls behind & beside, a flickering wall torch, iron bars to one side. Moody.
function DungeonDiorama() {
  const stone = '#3a3a42'
  const bars = [-0.8, -0.3, 0.2, 0.7].map((x) => (
    <mesh key={x} position={[x, 0, 2.0]}><cylinderGeometry args={[0.045, 0.045, 5, 8]} /><meshStandardMaterial color="#15151a" roughness={0.6} metalness={0.7} /></mesh>
  ))
  return (
    <group>
      <mesh position={[0, 0, -3]}><planeGeometry args={[7, 7]} /><meshStandardMaterial color={stone} roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-3.2, 0, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[7, 7]} /><meshStandardMaterial color={stone} roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -2.6, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[7, 7]} /><meshStandardMaterial color={stone} roughness={1} side={THREE.DoubleSide} /></mesh>
      {/* iron bars off to the +x side (out of the camera's central view) */}
      <group position={[3.0, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>{bars}</group>
      {/* wall torch on the left wall: a bracket, a flame, a flickering light */}
      <mesh position={[-2.95, 0.6, -0.4]}><cylinderGeometry args={[0.05, 0.05, 0.7, 6]} /><meshStandardMaterial color="#2a1d12" roughness={1} /></mesh>
      <mesh position={[-2.95, 1.0, -0.4]}><sphereGeometry args={[0.18, 10, 10]} /><meshStandardMaterial color="#ff8a2a" emissive="#ff7414" emissiveIntensity={3} toneMapped={false} /></mesh>
      <FlickerLight color="#ff9a40" intensity={7.5} position={[-2.4, 1.1, -0.2]} distance={9} amt={0.4} />
      <ambientLight intensity={0.16} color="#3a3550" />
    </group>
  )
}

// ── 📐 Blueprint ──────────────────────────────────────────────────────────────────────────────────────────────
// A glowing graph-paper floor + back wall and the XYZ axes through the gem. Math-cute, clean.
function BlueprintDiorama() {
  const grid = '#2f6df0'
  return (
    <group>
      <gridHelper args={[10, 20, '#7fb0ff', grid]} position={[0, -2.0, 0]} />
      <gridHelper args={[10, 20, '#7fb0ff', grid]} position={[0, 0, -3.2]} rotation={[Math.PI / 2, 0, 0]} />
      {/* XYZ axes through the origin (red X, green Y, blue Z), thin glowing rods */}
      <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.012, 0.012, 4, 6]} /><meshStandardMaterial color="#ff5d6c" emissive="#ff5d6c" emissiveIntensity={1.6} toneMapped={false} /></mesh>
      <mesh><cylinderGeometry args={[0.012, 0.012, 4, 6]} /><meshStandardMaterial color="#5fe06a" emissive="#5fe06a" emissiveIntensity={1.6} toneMapped={false} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.012, 0.012, 4, 6]} /><meshStandardMaterial color="#5fb0ff" emissive="#5fb0ff" emissiveIntensity={1.6} toneMapped={false} /></mesh>
      <ambientLight intensity={0.5} color="#9fc0ff" />
      <directionalLight position={[3, 5, 4]} intensity={0.8} color="#dce8ff" />
    </group>
  )
}

// ── 🪐 Orrery ─────────────────────────────────────────────────────────────────────────────────────────────────
// Slow concentric brass rings tilted on different axes, a couple of orbiting beads. Cosmic, ties to the Orrery mode.
function OrreryDiorama() {
  const g = useRef<THREE.Group>(null)
  const g2 = useRef<THREE.Group>(null)
  const g3 = useRef<THREE.Group>(null)
  useFrame((_s, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.18
    if (g2.current) g2.current.rotation.x += dt * 0.12
    if (g3.current) g3.current.rotation.z += dt * 0.15
  })
  const ringMat = <meshStandardMaterial color="#e8b75a" emissive="#7a5418" emissiveIntensity={0.5} roughness={0.3} metalness={0.9} />
  return (
    <group>
      <group ref={g}><mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.5, 0.025, 8, 80]} />{ringMat}</mesh><mesh position={[2.5, 0, 0]}><sphereGeometry args={[0.1, 12, 12]} /><meshStandardMaterial color="#ffd27a" emissive="#ffb74a" emissiveIntensity={1.2} toneMapped={false} /></mesh></group>
      <group ref={g2}><mesh rotation={[0, 0, Math.PI / 2.4]}><torusGeometry args={[2.05, 0.022, 8, 80]} /><meshStandardMaterial color="#cf9a44" emissive="#5a3e12" emissiveIntensity={0.5} roughness={0.3} metalness={0.9} /></mesh></group>
      <group ref={g3}><mesh rotation={[Math.PI / 3, 0, 0]}><torusGeometry args={[2.85, 0.02, 8, 90]} /><meshStandardMaterial color="#b9863a" emissive="#4a3210" emissiveIntensity={0.5} roughness={0.3} metalness={0.9} /></mesh></group>
      <ambientLight intensity={0.28} color="#3a3658" />
      <pointLight position={[3, 3, 4]} intensity={2.2} color="#fff0d8" distance={20} decay={1.2} />
    </group>
  )
}

// ── 💎 Crystal cave ───────────────────────────────────────────────────────────────────────────────────────────
// A cluster of jagged glowing crystals erupting from below/behind the gem. Cool, refractive.
function CrystalCaveDiorama() {
  const crystals = [
    { p: [-1.7, -1.6, -1.2], s: 1.3, r: 0.3, c: '#7aa0ff' },
    { p: [1.6, -1.9, -0.8], s: 1.7, r: -0.4, c: '#9a7aff' },
    { p: [0.4, -2.1, -1.8], s: 1.1, r: 0.1, c: '#6ad0ff' },
    { p: [-0.9, -2.1, -2.0], s: 0.9, r: 0.6, c: '#8a8aff' },
    { p: [2.1, -1.5, -1.8], s: 1.0, r: -0.2, c: '#7af0e0' },
    { p: [-2.2, -1.7, -1.9], s: 1.2, r: 0.25, c: '#b07aff' },
  ] as const
  return (
    <group>
      <mesh position={[0, -2.4, -0.5]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[5, 32]} /><meshStandardMaterial color="#15131f" roughness={1} /></mesh>
      {crystals.map((c, i) => (
        <mesh key={i} position={c.p as unknown as [number, number, number]} rotation={[c.r, i, c.r * 1.5]} scale={[0.5, c.s, 0.5]}>
          <coneGeometry args={[0.4, 1.6, 5]} />
          <meshPhysicalMaterial color={c.c} emissive={c.c} emissiveIntensity={0.55} roughness={0.12} metalness={0.05} transmission={0.5} thickness={0.6} clearcoat={1} />
        </mesh>
      ))}
      <ambientLight intensity={0.22} color="#2a2c4a" />
      <pointLight position={[0, 1.5, 1.5]} intensity={2.4} color="#bcd6ff" distance={12} decay={1.3} />
      <pointLight position={[-2, -1, -1.5]} intensity={1.6} color="#9a7aff" distance={8} decay={1.4} />
      <Sparkles count={18} size={2.5} scale={[5, 4, 4]} position={[0, -0.5, -1]} speed={0.25} color="#bcd6ff" />
    </group>
  )
}

// ── 🧪 Cornell box ────────────────────────────────────────────────────────────────────────────────────────────
// The classic radiosity test room (red/green walls, ceiling area light) — a wink for the graphics nerds. The glass
// gem refracts the coloured walls. (Mirrors the legacy `scene.special==='cornell'` room, now a selectable diorama.)
function CornellDiorama() {
  const white = '#e8e8e8'
  return (
    <group>
      <mesh position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color={white} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 3, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color={white} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0, -3]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color={white} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-3, 0, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color="#c43838" roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[3, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color="#2fa83f" roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 2.96, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[2.2, 2.2]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.2} toneMapped={false} /></mesh>
      <pointLight position={[0, 2.6, 0.4]} intensity={7} distance={12} decay={1.3} color="#fff5e8" />
      <ambientLight intensity={0.4} />
      {/* a small coloured env so the clear glass picks up the red/green bounce → contrast against the white walls */}
      <Environment resolution={64} environmentIntensity={0.85}>
        <Lightformer form="rect" intensity={2} color="#ffffff" position={[0, 3, 0]} scale={[3, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#c43838" position={[-3, 0, 0]} scale={[5, 5, 1]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={1.4} color="#2fa83f" position={[3, 0, 0]} scale={[5, 5, 1]} rotation={[0, -Math.PI / 2, 0]} />
      </Environment>
    </group>
  )
}

// ── ⛩️ Altar ──────────────────────────────────────────────────────────────────────────────────────────────────
// A stepped stone altar between two pillars, a shaft of god-light on the jewel. Enshrined.
function AltarDiorama() {
  return (
    <group>
      <mesh position={[0, -2.4, 0]}><boxGeometry args={[3, 0.5, 2.2]} /><meshStandardMaterial color="#8a8474" roughness={0.9} /></mesh>
      <mesh position={[0, -2.0, 0]}><boxGeometry args={[2.2, 0.4, 1.6]} /><meshStandardMaterial color="#9a9382" roughness={0.9} /></mesh>
      <mesh position={[0, -1.7, 0]}><boxGeometry args={[1.5, 0.3, 1.1]} /><meshStandardMaterial color="#a8a290" roughness={0.85} /></mesh>
      {[-1.9, 1.9].map((x) => (
        <group key={x} position={[x, -0.4, -1.3]}>
          <mesh><cylinderGeometry args={[0.3, 0.34, 4.4, 16]} /><meshStandardMaterial color="#c9c2ad" roughness={0.8} /></mesh>
          <mesh position={[0, 2.35, 0]}><boxGeometry args={[0.85, 0.3, 0.85]} /><meshStandardMaterial color="#d8d2bd" roughness={0.8} /></mesh>
        </group>
      ))}
      <spotLight position={[0.4, 5.5, 2]} angle={0.42} penumbra={0.6} intensity={22} distance={15} decay={1.1} color="#fff2d0" />
      <ambientLight intensity={0.2} color="#3a3550" />
      <pointLight position={[0, 0.4, 2.6]} intensity={1.1} color="#ffe8c0" distance={7} decay={1.5} />
    </group>
  )
}

// ── 🏛️ Museum plinth ──────────────────────────────────────────────────────────────────────────────────────────
// A marble pedestal under one gallery spotlight, a little brass placard. The gem as Exhibit A.
function PlinthDiorama() {
  return (
    <group>
      <mesh position={[0, -2.5, 0]}><boxGeometry args={[2, 0.3, 2]} /><meshStandardMaterial color="#e8e2d4" roughness={0.6} metalness={0.05} /></mesh>
      <mesh position={[0, -1.85, 0]}><cylinderGeometry args={[0.7, 0.8, 1.1, 24]} /><meshStandardMaterial color="#f2ece0" roughness={0.5} metalness={0.05} /></mesh>
      <mesh position={[0, -1.28, 0]}><boxGeometry args={[1.5, 0.16, 1.5]} /><meshStandardMaterial color="#e8e2d4" roughness={0.6} /></mesh>
      <mesh position={[0, -1.95, 0.84]} rotation={[-0.5, 0, 0]}><boxGeometry args={[0.7, 0.28, 0.03]} /><meshStandardMaterial color="#c9a24a" roughness={0.35} metalness={0.85} emissive="#5a4418" emissiveIntensity={0.2} /></mesh>
      <spotLight position={[1, 5.5, 3]} angle={0.35} penumbra={0.7} intensity={24} distance={15} decay={1.1} color="#fff6ea" />
      <ambientLight intensity={0.1} color="#2a2c3a" />
      <pointLight position={[-2, 1, 2]} intensity={0.5} color="#cfe0ff" distance={8} decay={1.5} />
    </group>
  )
}

// ── ❄️ Snow globe ─────────────────────────────────────────────────────────────────────────────────────────────
// A glass dome on a turned base, snow drifting forever inside (the gem refracts through two layers of glass).
function SnowGlobeDiorama() {
  return (
    <group>
      <mesh position={[0, -2.55, 0]}><cylinderGeometry args={[1.7, 1.9, 0.5, 32]} /><meshStandardMaterial color="#6a4a32" roughness={0.7} /></mesh>
      <mesh position={[0, -2.2, 0]}><cylinderGeometry args={[1.5, 1.7, 0.3, 32]} /><meshStandardMaterial color="#c9a24a" roughness={0.3} metalness={0.85} /></mesh>
      <mesh position={[0, 0, 0]}><sphereGeometry args={[2.4, 40, 32]} /><meshPhysicalMaterial color="#eaf2ff" roughness={0.04} transmission={0.9} thickness={0.3} ior={1.46} clearcoat={1} transparent opacity={0.45} side={THREE.DoubleSide} /></mesh>
      <Sparkles count={42} size={3.5} scale={[3.4, 3.4, 3.4]} position={[0, 0, 0]} speed={0.45} color="#ffffff" noise={1.6} opacity={0.9} />
      <ambientLight intensity={0.5} color="#dceaff" />
      <directionalLight position={[3, 5, 4]} intensity={1.2} color="#ffffff" />
      <pointLight position={[-2, 0, 3]} intensity={0.8} color="#bcd6ff" distance={9} decay={1.4} />
    </group>
  )
}

// ── 🪨 Rock garden ────────────────────────────────────────────────────────────────────────────────────────────
// Raked sand, a few quiet stones, a low wooden frame — a karesansui. Pure ASMR calm.
function RockGardenDiorama() {
  const rocks: { p: [number, number, number]; s: [number, number, number] }[] = [
    { p: [-1.4, -1.9, 0.3], s: [0.7, 0.5, 0.6] },
    { p: [1.2, -1.95, -0.4], s: [0.5, 0.4, 0.5] },
    { p: [0.2, -2.0, 1.0], s: [0.4, 0.3, 0.4] },
    { p: [1.9, -1.88, 0.8], s: [0.35, 0.45, 0.35] },
  ]
  return (
    <group>
      <mesh position={[0, -2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[3.6, 48]} /><meshStandardMaterial color="#d8cba0" roughness={1} /></mesh>
      {[1.0, 1.7, 2.4, 3.1].map((r) => (
        <mesh key={r} position={[0, -2.16, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[r - 0.04, r, 64]} /><meshStandardMaterial color="#b8ab82" roughness={1} side={THREE.DoubleSide} /></mesh>
      ))}
      {rocks.map((rk, i) => (
        <mesh key={i} position={rk.p} rotation={[i, i * 1.3, i * 0.7]} scale={rk.s}>
          <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#5a564e" roughness={1} flatShading />
        </mesh>
      ))}
      <mesh position={[0, -2.05, 3.5]}><boxGeometry args={[7.2, 0.3, 0.2]} /><meshStandardMaterial color="#6a4a32" roughness={0.85} /></mesh>
      <mesh position={[0, -2.05, -3.5]}><boxGeometry args={[7.2, 0.3, 0.2]} /><meshStandardMaterial color="#6a4a32" roughness={0.85} /></mesh>
      <mesh position={[3.5, -2.05, 0]}><boxGeometry args={[0.2, 0.3, 7.2]} /><meshStandardMaterial color="#6a4a32" roughness={0.85} /></mesh>
      <mesh position={[-3.5, -2.05, 0]}><boxGeometry args={[0.2, 0.3, 7.2]} /><meshStandardMaterial color="#6a4a32" roughness={0.85} /></mesh>
      <ambientLight intensity={0.5} color="#fff0d8" />
      <directionalLight position={[3, 6, 2]} intensity={1.0} color="#fff4e0" />
    </group>
  )
}

// ── 🔥 Blacksmith's Forge ─────────────────────────────────────────────────────────────────────────────────────
// An anvil + a brick firepot of molten coals (the warm key light), drifting sparks. Nods to the Forge mechanic.
function ForgeDiorama() {
  const spark = useRef<THREE.Group>(null)
  useFrame((_s, dt) => { if (spark.current) spark.current.rotation.y += dt * 0.06 })
  return (
    <group>
      <mesh position={[0, -2.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[4.6, 32]} /><meshStandardMaterial color="#564f47" roughness={1} /></mesh>
      <mesh position={[0, 0.2, -3]}><planeGeometry args={[7, 5.4]} /><meshStandardMaterial color="#564f47" roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 1.9, -2.95]}><boxGeometry args={[3.4, 1.4, 0.5]} /><meshStandardMaterial color="#564f47" roughness={1} /></mesh>
      {/* iron anvil just behind + below the gem */}
      <mesh position={[0, -1.62, -0.55]}><boxGeometry args={[1.5, 0.42, 0.78]} /><meshStandardMaterial color="#26242a" roughness={0.5} metalness={0.6} /></mesh>
      <mesh position={[0, -2.0, -0.55]}><boxGeometry args={[0.52, 0.5, 0.5]} /><meshStandardMaterial color="#26242a" roughness={0.5} metalness={0.6} /></mesh>
      <mesh position={[0, -2.32, -0.55]}><boxGeometry args={[1.1, 0.34, 0.62]} /><meshStandardMaterial color="#26242a" roughness={0.5} metalness={0.6} /></mesh>
      <mesh position={[0.98, -1.55, -0.55]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.3, 0.7, 12]} /><meshStandardMaterial color="#26242a" roughness={0.5} metalness={0.6} /></mesh>
      {/* firepot: brick wall + dark soot bowl recessing the molten coals (the key light) */}
      <mesh position={[0, -2.12, 0.42]}><cylinderGeometry args={[0.66, 0.74, 0.5, 16]} /><meshStandardMaterial color="#6e3d2c" roughness={0.95} /></mesh>
      <mesh position={[0, -2.0, 0.42]}><cylinderGeometry args={[0.5, 0.56, 0.4, 16]} /><meshStandardMaterial color="#1a1814" roughness={0.9} /></mesh>
      <mesh position={[0, -1.95, 0.42]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.5, 24]} /><meshStandardMaterial color="#ff7a1a" emissive="#ff6a10" emissiveIntensity={3.0} toneMapped={false} /></mesh>
      <mesh position={[0, -1.9, 0.42]}><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color="#ffb050" emissive="#ff8a20" emissiveIntensity={2.6} toneMapped={false} /></mesh>
      {/* quench bucket to the -x side */}
      <mesh position={[-2.4, -1.95, 0.5]}><cylinderGeometry args={[0.34, 0.3, 0.66, 12]} /><meshStandardMaterial color="#1a1814" roughness={0.9} /></mesh>
      <mesh position={[-2.4, -1.62, 0.5]}><cylinderGeometry args={[0.36, 0.36, 0.08, 12]} /><meshStandardMaterial color="#4a3322" roughness={0.95} /></mesh>
      {/* iron tongs leaning against the firepot, +x side */}
      <mesh position={[1.0, -1.7, 0.7]} rotation={[Math.PI / 5, 0, 0.35]}><cylinderGeometry args={[0.04, 0.04, 1.5, 6]} /><meshStandardMaterial color="#26242a" roughness={0.5} metalness={0.6} /></mesh>
      <mesh position={[1.12, -1.7, 0.62]} rotation={[Math.PI / 5, 0, 0.5]}><cylinderGeometry args={[0.04, 0.04, 1.5, 6]} /><meshStandardMaterial color="#26242a" roughness={0.5} metalness={0.6} /></mesh>
      <FlickerLight color="#ff8a3a" intensity={9} position={[0, -1.7, 0.42]} distance={11} amt={0.4} />
      <pointLight color="#ffd6a0" intensity={1.0} position={[0, 0.2, 0.8]} distance={6} decay={1.6} />
      <ambientLight intensity={0.13} color="#2a3550" />
      <group ref={spark}>
        <Sparkles count={24} size={2.6} scale={[1.8, 3.0, 1.8]} position={[0, -0.6, 0.42]} speed={0.6} color="#ffb060" noise={1.5} />
      </group>
    </group>
  )
}

// ── ⛩️ Dusk Shrine Gate ───────────────────────────────────────────────────────────────────────────────────────
// A vermilion torii behind the gem, two stone lanterns with small flames, a warm offering flame below. Serene.
function ShrineDiorama() {
  const vermilion = '#c2403a'
  const stone = '#7a7975'
  return (
    <group>
      <mesh position={[0, -2.0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[11, 9]} /><meshStandardMaterial color="#39455f" roughness={1} /></mesh>
      {[-1.7, 1.7].map((x) => (
        <mesh key={x} position={[x, -0.3, -2.3]}><cylinderGeometry args={[0.17, 0.21, 3.4, 16]} /><meshStandardMaterial color={vermilion} roughness={0.85} /></mesh>
      ))}
      <mesh position={[0, 1.5, -2.3]}><boxGeometry args={[4.6, 0.32, 0.34]} /><meshStandardMaterial color={vermilion} roughness={0.85} /></mesh>
      <mesh position={[0, 1.16, -2.3]}><boxGeometry args={[4.0, 0.2, 0.3]} /><meshStandardMaterial color={vermilion} roughness={0.85} /></mesh>
      {[-2.15, 2.15].map((x) => (
        <mesh key={x} position={[x, 1.62, -2.3]} rotation={[0, 0, Math.PI / 2.6]}><cylinderGeometry args={[0.12, 0.12, 0.5, 12]} /><meshStandardMaterial color={vermilion} roughness={0.85} /></mesh>
      ))}
      <mesh position={[0, 0.55, -2.3]}><boxGeometry args={[3.7, 0.22, 0.26]} /><meshStandardMaterial color={vermilion} roughness={0.85} /></mesh>
      <mesh position={[0, 0.86, -2.3]}><boxGeometry args={[0.34, 0.5, 0.34]} /><meshStandardMaterial color={vermilion} roughness={0.85} /></mesh>
      {[-2.55, 2.55].map((x) => (
        <group key={x}>
          <mesh position={[x, -1.78, -1.1]}><cylinderGeometry args={[0.34, 0.42, 0.34, 16]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
          <mesh position={[x, -1.36, -1.1]}><cylinderGeometry args={[0.12, 0.12, 0.7, 12]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
          <mesh position={[x, -0.96, -1.1]}><cylinderGeometry args={[0.46, 0.34, 0.2, 16]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
          <mesh position={[x, -0.66, -1.1]}><sphereGeometry args={[0.16, 12, 12]} /><meshStandardMaterial color="#ffb35a" emissive="#ff8a2a" emissiveIntensity={2.6} toneMapped={false} /></mesh>
          <FlickerLight color="#ffae54" intensity={4.5} position={[x, -0.66, -0.7]} distance={5.5} decay={1.6} amt={0.35} />
          <mesh position={[x, -0.27, -1.1]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.5, 0.34, 6]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
          <mesh position={[x, -0.06, -1.1]}><sphereGeometry args={[0.1, 10, 10]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
        </group>
      ))}
      <mesh position={[0, -1.86, 0]}><cylinderGeometry args={[0.55, 0.62, 0.36, 20]} /><meshStandardMaterial color={stone} roughness={1} /></mesh>
      <mesh position={[0, -1.78, 0]}><cylinderGeometry args={[0.4, 0.44, 0.4, 20]} /><meshStandardMaterial color="#241f1b" roughness={0.9} /></mesh>
      <mesh position={[0, -1.86, 0]}><sphereGeometry args={[0.16, 12, 12]} /><meshStandardMaterial color="#ffb766" emissive="#ff8e30" emissiveIntensity={2.8} toneMapped={false} /></mesh>
      <FlickerLight color="#ffb060" intensity={7} position={[0, -1.7, 0]} distance={7} decay={1.5} amt={0.3} />
      <Sparkles count={18} size={2.6} scale={[3.2, 2.6, 2.0]} position={[0, -0.6, 0]} speed={0.3} color="#ffb060" noise={1.3} opacity={0.8} />
      <ambientLight intensity={0.22} color="#46506a" />
      <directionalLight position={[2.5, 4, 3]} intensity={0.35} color="#8a7fa0" />
    </group>
  )
}

// ── 🐠 Sunken Reef ────────────────────────────────────────────────────────────────────────────────────────────
// A coral seabed with glowing cyan anemone keys, rising bubbles, drifting caustic light. Cool, calm. No glass.
function AquariumDiorama() {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime
    ref.current.position.x = Math.sin(t * 0.4) * 0.5
    ref.current.position.z = Math.cos(t * 0.3) * 0.4
  })
  const boulders = [
    { p: [-2.2, -2.0, -1.2] as [number, number, number], r: 0.85 },
    { p: [2.3, -2.05, -1.4] as [number, number, number], r: 0.7 },
    { p: [1.3, -2.15, -2.3] as [number, number, number], r: 0.55 },
  ].map((b, i) => (
    <mesh key={i} position={b.p}><sphereGeometry args={[b.r, 16, 14]} /><meshStandardMaterial color="#2f5560" roughness={1} /></mesh>
  ))
  const pinkCoral = [0, 1, 2, 3].map((i) => {
    const a = -0.9 + i * 0.5
    return (
      <mesh key={`p${i}`} position={[-1.4 + 0.3 * i, -1.9 + 0.55 * a, -2.1 - 0.2 * Math.cos(a)]} rotation={[a, 0, Math.PI + 0.18 * Math.sin(i)]}>
        <coneGeometry args={[0.12, 1.4 - i * 0.12, 6]} />
        <meshStandardMaterial color="#d98aa0" roughness={0.95} />
      </mesh>
    )
  })
  const tealCoral = [0, 1, 2].map((i) => {
    const a = 0.4 + i * 0.45
    return (
      <mesh key={`t${i}`} position={[2.0, -1.5 + 0.3 * i, -1.7 - 0.2 * i]} rotation={[a * 0.7, 0, Math.PI - 0.2 * i]}>
        <coneGeometry args={[0.1, 1.1 - i * 0.1, 6]} />
        <meshStandardMaterial color="#3fb8a8" roughness={0.95} />
      </mesh>
    )
  })
  return (
    <group>
      <mesh position={[0, -2.0, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[5, 40]} /><meshStandardMaterial color="#9fb0a6" roughness={1} /></mesh>
      <mesh position={[0, 0.6, -3]}><planeGeometry args={[7, 6]} /><meshStandardMaterial color="#2f5560" roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-3.2, 0.6, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[7, 6]} /><meshStandardMaterial color="#2f5560" roughness={1} side={THREE.DoubleSide} /></mesh>
      {boulders}
      {pinkCoral}
      {tealCoral}
      <mesh position={[-2.0, -1.3, -1.7]} rotation={[Math.PI / 2.2, 0.4, 0]}><torusGeometry args={[0.55, 0.07, 8, 40]} /><meshStandardMaterial color="#3fb8a8" roughness={0.95} /></mesh>
      {/* glowing cyan anemone polyps recessed in dark sockets, low + central under the gem */}
      <mesh position={[0, -2.04, 0.1]}><cylinderGeometry args={[0.34, 0.4, 0.34, 12]} /><meshStandardMaterial color="#10262c" roughness={0.9} /></mesh>
      <mesh position={[0, -1.98, 0.1]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.26, 24]} /><meshStandardMaterial color="#3fffe8" emissive="#2fffe0" emissiveIntensity={2.6} toneMapped={false} /></mesh>
      <mesh position={[0, -1.94, 0.1]}><sphereGeometry args={[0.1, 12, 12]} /><meshStandardMaterial color="#3fffe8" emissive="#2fffe0" emissiveIntensity={2.6} toneMapped={false} /></mesh>
      <mesh position={[-0.5, -2.06, -0.35]}><cylinderGeometry args={[0.24, 0.3, 0.3, 12]} /><meshStandardMaterial color="#10262c" roughness={0.9} /></mesh>
      <mesh position={[-0.5, -1.97, -0.35]}><sphereGeometry args={[0.09, 12, 12]} /><meshStandardMaterial color="#3fffe8" emissive="#2fffe0" emissiveIntensity={2.6} toneMapped={false} /></mesh>
      <pointLight color="#3fe8d8" intensity={4.5} position={[0, -1.8, 0.05]} distance={5} decay={1.6} />
      <group ref={ref} position={[0, 3, 0]}>
        <pointLight color="#bfeaff" intensity={3.2} position={[0, 0, 0.5]} distance={10} decay={1.4} />
      </group>
      <ambientLight intensity={0.28} color="#1f5a6a" />
      <Sparkles count={30} size={2.2} scale={[3.2, 4.2, 2.6]} position={[0, -0.3, 0]} speed={0.35} color="#cfeefc" noise={1.2} opacity={0.7} />
    </group>
  )
}

// ── 🍄 Glimmercap Grove ───────────────────────────────────────────────────────────────────────────────────────
// A bioluminescent fairy-ring: glowing teal/violet mushroom caps around the gem, drifting spores. Whimsical.
function MushroomGroveDiorama() {
  const ring: [number, number, number, boolean][] = [
    [-1.5, -1.6, -0.4, false], [1.5, -1.55, -0.5, true], [-0.9, -1.6, -1.5, false],
    [0.9, -1.65, -1.6, true], [0.2, -1.6, -1.9, false], [-2.0, -1.7, 0.3, true], [2.0, -1.7, 0.2, false],
  ]
  const teal = '#5ef0d2'
  const violet = '#9a6bff'
  return (
    <group>
      <mesh position={[0, -2.0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[9, 7]} /><meshStandardMaterial color="#1e3326" roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -2.05, 0]}><cylinderGeometry args={[1.05, 1.25, 0.5, 16]} /><meshStandardMaterial color="#2a4030" roughness={1} /></mesh>
      <mesh position={[-1.7, -1.78, -1.3]} rotation={[Math.PI / 2, 0.5, 0]}><cylinderGeometry args={[0.22, 0.24, 2.6, 10]} /><meshStandardMaterial color="#4a3a2c" roughness={0.95} /></mesh>
      <mesh position={[1.9, -1.82, -1.0]} rotation={[Math.PI / 2, -0.4, 0]}><cylinderGeometry args={[0.18, 0.2, 2.0, 10]} /><meshStandardMaterial color="#4a3a2c" roughness={0.95} /></mesh>
      {/* the key: dark socket + a small up-facing glow-cap deep inside, central + low under the gem */}
      <mesh position={[0, -1.88, 0]}><cylinderGeometry args={[0.42, 0.48, 0.42, 12]} /><meshStandardMaterial color="#16241b" roughness={0.95} /></mesh>
      <mesh position={[0, -1.95, 0]} scale={[1, 0.5, 1]}><sphereGeometry args={[0.34, 16, 16]} /><meshStandardMaterial color={teal} emissive={teal} emissiveIntensity={2.4} toneMapped={false} /></mesh>
      <pointLight color={teal} intensity={3.2} position={[0, -1.7, 0]} distance={3.2} decay={1.8} />
      {ring.map(([x, y, z, isV], i) => {
        const c = isV ? violet : teal
        return (
          <group key={i}>
            <mesh position={[x, y - 0.28, z]}><cylinderGeometry args={[0.05, 0.07, 0.5, 8]} /><meshStandardMaterial color="#cdbfae" roughness={0.9} /></mesh>
            <mesh position={[x, y, z]} scale={[1.2, 0.7, 1.2]}><sphereGeometry args={[0.14, 14, 14]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={2.6} toneMapped={false} /></mesh>
            <pointLight color={c} intensity={1.1} position={[x, y + 0.15, z]} distance={2.4} decay={2} />
          </group>
        )
      })}
      <ambientLight intensity={0.14} color="#1f3a4a" />
      <pointLight color="#3a6a7a" intensity={0.5} position={[0, 1.2, 1.0]} distance={7} decay={1.6} />
      <Sparkles count={30} size={2.4} scale={[4, 2.6, 3.4]} position={[0, -0.6, -0.2]} speed={0.35} color="#8ff0e0" noise={1.2} />
    </group>
  )
}

// ── 🌙 Moonlit Shore ──────────────────────────────────────────────────────────────────────────────────────────
// A mirror-still dark sea + pale sand under a low dim moon, a cool moon-glint pooling below the gem. Melancholy.
function ShoreDiorama() {
  const moteRef = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (moteRef.current) moteRef.current.rotation.y += dt * 0.04
  })
  return (
    <group>
      <mesh position={[0, -2.02, -4.0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 9]} />
        <meshStandardMaterial color="#1b2336" roughness={0.16} metalness={0.5} />
      </mesh>
      <mesh position={[0, -2.0, 1.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 4.4]} />
        <meshStandardMaterial color="#94a0ac" roughness={0.92} />
      </mesh>
      <mesh position={[0, -0.55, -6.4]}>
        <circleGeometry args={[1.5, 40]} />
        <meshStandardMaterial color="#aebcd6" emissive="#aebcd6" emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      {[
        { p: [-2.0, -1.86, 0.5], s: 0.36, r: 0.0 },
        { p: [2.1, -1.88, 0.2], s: 0.27, r: 1.0 },
        { p: [1.5, -1.92, 1.1], s: 0.2, r: 2.0 },
        { p: [-1.5, -1.9, -1.0], s: 0.3, r: 3.0 },
      ].map((st, i) => (
        <mesh key={i} position={st.p as unknown as [number, number, number]} rotation={[0, st.r, 0]}>
          <icosahedronGeometry args={[st.s, 0]} />
          <meshStandardMaterial color="#8e8a80" roughness={0.95} />
        </mesh>
      ))}
      {[[-2.4, 0.4], [-2.15, 0.9], [2.5, 0.6], [2.25, 1.1]].map(([x, z], i) => (
        <group key={i}>
          <mesh position={[x, -1.7, z]} rotation={[0, 0, 0.18]}>
            <coneGeometry args={[0.12, 0.7, 5]} />
            <meshStandardMaterial color="#56604e" roughness={1} />
          </mesh>
          <mesh position={[x + 0.18, -1.74, z + 0.1]} rotation={[0, 0, -0.22]}>
            <coneGeometry args={[0.1, 0.6, 5]} />
            <meshStandardMaterial color="#56604e" roughness={1} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -1.86, 0.05]}>
        <cylinderGeometry args={[0.5, 0.56, 0.3, 16]} />
        <meshStandardMaterial color="#23282f" roughness={0.9} />
      </mesh>
      <mesh position={[0, -1.95, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.4, 32]} />
        <meshStandardMaterial color="#cfe0ff" emissive="#cfe0ff" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      <pointLight position={[0, -1.7, 0.05]} intensity={3.4} color="#bcd6ff" distance={9} decay={1.5} />
      <pointLight position={[0, 1.0, -3.0]} intensity={1.2} color="#9fb3d6" distance={12} decay={1.6} />
      <ambientLight intensity={0.2} color="#26304a" />
      <group ref={moteRef}>
        <Sparkles count={20} size={2.2} scale={[6, 2.5, 5]} position={[0, -1.0, -1.5]} speed={0.18} color="#bcd6ff" opacity={0.6} />
      </group>
    </group>
  )
}

// ── 🏪 The Curator's Shop ─────────────────────────────────────────────────────────────────────────────────────
// A cozy warm wooden interior: shelves of jars/books, a counter, a teacup, a warm desk lamp (the key). On-brand.
function ShopDiorama() {
  return (
    <group>
      <mesh position={[0, -2.4, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[8, 6]} /><meshStandardMaterial color="#7a5230" roughness={0.85} /></mesh>
      <mesh position={[0, 0.4, -3.0]}><planeGeometry args={[8, 6]} /><meshStandardMaterial color="#3a2614" roughness={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-3.1, 0.4, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[6, 6]} /><meshStandardMaterial color="#3a2614" roughness={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-1.7, 1.7, -2.96]}><planeGeometry args={[1.1, 1.5]} /><meshStandardMaterial color="#ffe2ac" emissive="#ffcf8a" emissiveIntensity={0.6} toneMapped={false} /></mesh>
      <mesh position={[-1.7, 1.7, -2.9]}><boxGeometry args={[1.3, 1.6, 0.12]} /><meshStandardMaterial color="#3a2614" roughness={0.9} /></mesh>
      <mesh position={[-0.8, 1.3, -2.55]}><boxGeometry args={[3.4, 0.14, 0.5]} /><meshStandardMaterial color="#7a5230" roughness={0.85} /></mesh>
      <mesh position={[-0.8, 0.4, -2.55]}><boxGeometry args={[3.4, 0.14, 0.5]} /><meshStandardMaterial color="#7a5230" roughness={0.85} /></mesh>
      <mesh position={[-1.9, 1.58, -2.55]}><cylinderGeometry args={[0.18, 0.2, 0.42, 12]} /><meshStandardMaterial color="#c08a5a" roughness={0.85} /></mesh>
      <mesh position={[-1.4, 1.55, -2.55]}><cylinderGeometry args={[0.16, 0.18, 0.36, 12]} /><meshStandardMaterial color="#5a7a5c" roughness={0.85} /></mesh>
      <mesh position={[-0.7, 1.61, -2.55]}><boxGeometry args={[0.16, 0.5, 0.34]} /><meshStandardMaterial color="#a85c4a" roughness={0.8} /></mesh>
      <mesh position={[-0.5, 1.58, -2.55]}><boxGeometry args={[0.16, 0.44, 0.34]} /><meshStandardMaterial color="#5a7a5c" roughness={0.8} /></mesh>
      <mesh position={[-0.3, 1.6, -2.55]}><boxGeometry args={[0.16, 0.48, 0.34]} /><meshStandardMaterial color="#c08a5a" roughness={0.85} /></mesh>
      <mesh position={[0.4, 1.52, -2.55]} rotation={[0, 0.5, 0]}><icosahedronGeometry args={[0.16, 0]} /><meshStandardMaterial color="#a85c4a" roughness={0.8} flatShading /></mesh>
      <mesh position={[1.9, 0.69, -2.55]}><boxGeometry args={[0.6, 0.14, 0.34]} /><meshStandardMaterial color="#a85c4a" roughness={0.8} /></mesh>
      <mesh position={[1.9, 0.55, -2.55]}><boxGeometry args={[0.56, 0.14, 0.34]} /><meshStandardMaterial color="#5a7a5c" roughness={0.8} /></mesh>
      <mesh position={[-2.0, 0.68, -2.55]}><cylinderGeometry args={[0.17, 0.19, 0.4, 12]} /><meshStandardMaterial color="#c08a5a" roughness={0.85} /></mesh>
      <mesh position={[-1.3, 0.62, -2.55]} rotation={[0, 1.0, 0]}><icosahedronGeometry args={[0.15, 0]} /><meshStandardMaterial color="#5a7a5c" roughness={0.8} flatShading /></mesh>
      <mesh position={[0, -2.1, 0]}><boxGeometry args={[2.6, 0.5, 1.4]} /><meshStandardMaterial color="#7a5230" roughness={0.85} /></mesh>
      <mesh position={[0, -1.7, 0]}><cylinderGeometry args={[0.5, 0.62, 0.3, 16]} /><meshStandardMaterial color="#3a2614" roughness={0.9} /></mesh>
      <mesh position={[1.5, -1.65, 0.7]}><cylinderGeometry args={[0.18, 0.15, 0.22, 14]} /><meshStandardMaterial color="#c08a5a" roughness={0.85} /></mesh>
      <mesh position={[1.68, -1.62, 0.7]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.1, 0.025, 6, 20]} /><meshStandardMaterial color="#c08a5a" roughness={0.85} /></mesh>
      <mesh position={[2.0, 1.4, -1.8]}><boxGeometry args={[0.7, 0.32, 0.06]} /><meshStandardMaterial color="#a85c4a" roughness={0.8} /></mesh>
      <mesh position={[2.0, 1.78, -1.8]}><cylinderGeometry args={[0.02, 0.02, 0.5, 8]} /><meshStandardMaterial color="#3a2614" roughness={0.9} /></mesh>
      <mesh position={[0, -2.3, 0]}><cylinderGeometry args={[0.04, 0.04, 0.7, 8]} /><meshStandardMaterial color="#3a2614" roughness={0.9} /></mesh>
      <mesh position={[0, -1.78, 0]}><cylinderGeometry args={[0.44, 0.3, 0.4, 20]} /><meshStandardMaterial color="#3a2614" roughness={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -1.95, 0]}><sphereGeometry args={[0.3, 16, 16]} /><meshStandardMaterial color="#ffd9a0" emissive="#ffb24a" emissiveIntensity={2.4} toneMapped={false} /></mesh>
      <FlickerLight color="#ff9a40" intensity={7.5} position={[0, -1.7, 0]} distance={9} decay={1.6} amt={0.18} />
      <pointLight color="#ffd6a0" intensity={1.0} position={[1.2, 0.6, 1.4]} distance={7} decay={1.6} />
      <ambientLight intensity={0.16} color="#3a2c20" />
      <Sparkles count={18} size={1.6} scale={[4, 3, 3]} position={[0, 0, -0.5]} speed={0.12} color="#ffd9a0" opacity={0.4} noise={1.2} />
    </group>
  )
}

// ── 🍵 Lantern Tearoom ────────────────────────────────────────────────────────────────────────────────────────
// Warm dusk tatami interior: a low table, a paper andon lantern (soft glow), a shoji screen + scroll. Cozy, anime DNA.
function TearoomDiorama() {
  const posts = [-0.36, 0.36].flatMap((dx) => [-0.36, 0.36].map((dz) => (
    <mesh key={`p${dx}${dz}`} position={[-2.2 + dx, -0.95, -0.7 + dz]}>
      <cylinderGeometry args={[0.045, 0.045, 1.9, 6]} />
      <meshStandardMaterial color="#5a4632" roughness={0.85} />
    </mesh>
  )))
  const legs = [-0.6, 0.6].flatMap((dx) => [-0.35, 0.35].map((dz) => (
    <mesh key={`l${dx}${dz}`} position={[1.9 + dx, -1.8, -0.6 + dz]}>
      <cylinderGeometry args={[0.07, 0.07, 0.5, 8]} />
      <meshStandardMaterial color="#5a4632" roughness={0.85} />
    </mesh>
  )))
  const hRails = [-0.6, 0.6, 1.8].map((y) => (
    <mesh key={`h${y}`} position={[0, y, -2.96]}><boxGeometry args={[8, 0.05, 0.05]} /><meshStandardMaterial color="#5a4632" roughness={0.85} /></mesh>
  ))
  const vStiles = [-2.4, -0.8, 0.8, 2.4].map((x) => (
    <mesh key={`v${x}`} position={[x, 0.8, -2.96]}><boxGeometry args={[0.05, 6, 0.05]} /><meshStandardMaterial color="#5a4632" roughness={0.85} /></mesh>
  ))
  return (
    <group>
      <mesh position={[0, -2.0, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[6, 40]} /><meshStandardMaterial color="#bdb487" roughness={1} /></mesh>
      <mesh position={[0, 0.8, -3.0]}><planeGeometry args={[8, 6]} /><meshStandardMaterial color="#e6ddc8" roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[-3.2, 0.8, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[7, 6]} /><meshStandardMaterial color="#e6ddc8" roughness={1} side={THREE.DoubleSide} /></mesh>
      {hRails}{vStiles}
      <mesh position={[-1.9, 0.7, -2.93]}><boxGeometry args={[0.9, 2.0, 0.04]} /><meshStandardMaterial color="#e6ddc8" roughness={1} /></mesh>
      {[1.74, -0.34].map((y) => (
        <mesh key={`r${y}`} position={[-1.9, y, -2.92]}><boxGeometry args={[1.0, 0.1, 0.08]} /><meshStandardMaterial color="#5a4632" roughness={0.85} /></mesh>
      ))}
      <mesh position={[1.9, -1.5, -0.6]}><boxGeometry args={[1.5, 0.1, 0.9]} /><meshStandardMaterial color="#5a4632" roughness={0.85} /></mesh>
      {legs}
      <mesh position={[-2.2, -1.92, -0.7]}><boxGeometry args={[0.78, 0.1, 0.78]} /><meshStandardMaterial color="#5a4632" roughness={0.85} /></mesh>
      <mesh position={[-2.2, 0.0, -0.7]}><boxGeometry args={[0.86, 0.1, 0.86]} /><meshStandardMaterial color="#5a4632" roughness={0.85} /></mesh>
      {posts}
      <mesh position={[-2.2, -0.95, -0.31]}><planeGeometry args={[0.62, 1.7]} /><meshStandardMaterial color="#e8c07a" emissive="#e8a24a" emissiveIntensity={0.9} roughness={1} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      <mesh position={[-1.81, -0.95, -0.7]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[0.62, 1.7]} /><meshStandardMaterial color="#e8c07a" emissive="#e8a24a" emissiveIntensity={0.9} roughness={1} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      <mesh position={[-2.59, -0.95, -0.7]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[0.62, 1.7]} /><meshStandardMaterial color="#e8c07a" emissive="#e8a24a" emissiveIntensity={0.9} roughness={1} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      <mesh position={[-2.2, -1.2, -0.7]}><sphereGeometry args={[0.16, 10, 10]} /><meshStandardMaterial color="#ffb060" emissive="#ff8a3a" emissiveIntensity={2.4} toneMapped={false} /></mesh>
      <FlickerLight color="#ffb066" intensity={4.2} position={[-2.2, -0.9, -0.7]} distance={6} decay={1.7} amt={0.22} />
      <mesh position={[0, -1.8, 0]}><cylinderGeometry args={[0.42, 0.46, 0.42, 12]} /><meshStandardMaterial color="#241d16" roughness={0.9} /></mesh>
      <mesh position={[0, -1.94, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.34, 28]} /><meshStandardMaterial color="#ffb060" emissive="#ff9a40" emissiveIntensity={3.0} toneMapped={false} /></mesh>
      <FlickerLight color="#ffc080" intensity={6.5} position={[0, -1.4, 0]} distance={6} decay={1.6} amt={0.18} />
      <ambientLight intensity={0.18} color="#3a4258" />
      <pointLight color="#ffd6a8" intensity={0.9} position={[0, 1.2, 0.8]} distance={7} decay={1.6} />
      <Sparkles count={14} size={2} scale={[3.0, 2.0, 1.6]} position={[-1.2, -0.6, -0.3]} speed={0.25} color="#ffcf9a" noise={1.2} />
    </group>
  )
}

// ── 🌼 Sunlit Meadow ──────────────────────────────────────────────────────────────────────────────────────────
// The BRIGHT daytime scene: lifted-green grass, wildflowers, a soft sky + sun, drifting pollen. Airy and warm.
function MeadowDiorama() {
  const flowers: [number, number, number, 0 | 1][] = [
    [-2.2, -2.0, 0.6, 0], [2.1, -2.0, 0.3, 1], [-1.5, -2.0, -1.4, 0],
    [1.7, -2.0, -1.6, 1], [0.4, -2.0, -2.3, 0], [-2.7, -2.0, -0.8, 1],
    [2.6, -2.0, -1.0, 0], [-0.9, -2.0, 1.6, 1], [1.2, -2.0, 1.4, 0],
  ]
  return (
    <group>
      <mesh position={[0, -2.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color="#7fbf52" roughness={1} />
      </mesh>
      <mesh position={[0, 1.4, -5]}>
        <planeGeometry args={[16, 9]} />
        <meshBasicMaterial color="#cfe6f2" />
      </mesh>
      <mesh position={[-2.4, 0.2, -4.85]}>
        <circleGeometry args={[0.7, 32]} />
        <meshBasicMaterial color="#fff2d4" toneMapped={false} />
      </mesh>
      <mesh position={[0, -2.02, 0]}>
        <cylinderGeometry args={[0.5, 0.56, 0.18, 16]} />
        <meshStandardMaterial color="#4f7d34" roughness={1} />
      </mesh>
      <mesh position={[0, -1.95, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.4, 28]} />
        <meshStandardMaterial color="#ffdca0" emissive="#ffb866" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      {flowers.map((f, i) => (
        <group key={i} position={[f[0], f[1], f[2]]}>
          <mesh position={[0, 0.25, 0]}>
            <coneGeometry args={[0.03, 0.5, 5]} />
            <meshStandardMaterial color="#4f7d34" roughness={1} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <sphereGeometry args={[0.12, 10, 10]} />
            <meshStandardMaterial color={f[3] === 0 ? '#ffe07a' : '#fbf2f5'} roughness={0.9} emissive={f[3] === 0 ? '#ffd24a' : '#ffe0ec'} emissiveIntensity={0.25} />
          </mesh>
        </group>
      ))}
      <hemisphereLight args={['#bfe4f5', '#6f9a4a', 1.1]} />
      <directionalLight position={[-2.4, 3.5, -3]} intensity={1.6} color="#fff0d2" />
      <pointLight color="#ffcf90" intensity={1.3} position={[0, -1.6, 0]} distance={5} decay={1.6} />
      <ambientLight intensity={0.25} color="#e8f4ff" />
      <Sparkles count={32} size={2.4} scale={[6, 3.5, 5]} position={[0, 0.2, 0]} speed={0.3} color="#fff2c4" noise={1} />
    </group>
  )
}

// ── ⛪ Stained-Glass Chapel ───────────────────────────────────────────────────────────────────────────────────
// Gothic columns + tall stained-glass windows casting ruby/sapphire/gold pools; the clear gem drinks the colour.
function ChapelDiorama() {
  return (
    <group>
      <mesh position={[0, -2.0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[9, 7]} /><meshStandardMaterial color="#9a9082" roughness={0.95} /></mesh>
      <mesh position={[0, 0.6, -3.0]}><planeGeometry args={[7, 6.5]} /><meshStandardMaterial color="#9a9082" roughness={0.95} side={THREE.DoubleSide} /></mesh>
      {[
        { p: [-1.6, 1.4, -2.85] as [number, number, number], ry: 0, col: '#2a44c8', light: '#3a5cff' },
        { p: [1.6, 1.4, -2.85] as [number, number, number], ry: 0, col: '#d83040', light: '#ff4858' },
        { p: [-3.0, 1.2, -0.4] as [number, number, number], ry: Math.PI / 2, col: '#e0a428', light: '#ffc850' },
      ].map((w, i) => (
        <group key={i} position={w.p} rotation={[0, w.ry, 0]}>
          <mesh position={[0, 0, -0.06]}><planeGeometry args={[2.0, 3.2]} /><meshStandardMaterial color="#2c2824" roughness={0.9} side={THREE.DoubleSide} /></mesh>
          <mesh position={[0, 1.85, -0.04]}><coneGeometry args={[1.05, 1.0, 5]} /><meshStandardMaterial color="#2c2824" roughness={0.9} /></mesh>
          <mesh position={[0, 0, 0]}><planeGeometry args={[1.7, 2.9]} /><meshStandardMaterial color={w.col} emissive={w.col} emissiveIntensity={1.6} roughness={1} toneMapped={false} side={THREE.DoubleSide} /></mesh>
          <mesh position={[0, 0, 0.01]}><boxGeometry args={[0.05, 2.9, 0.04]} /><meshStandardMaterial color="#2c2824" roughness={0.9} /></mesh>
          {[-0.95, 0.95].map((dy) => (
            <mesh key={dy} position={[0, dy, 0.01]}><boxGeometry args={[1.7, 0.1, 0.04]} /><meshStandardMaterial color="#2c2824" roughness={0.9} /></mesh>
          ))}
          <pointLight position={[0, 0, 0.6]} color={w.light} intensity={3.4} distance={8} decay={1.6} />
        </group>
      ))}
      {[-2.2, 2.2].map((x) => (
        <group key={x} position={[x, 0, -1.1]}>
          <mesh position={[0, -0.3, 0]}><cylinderGeometry args={[0.26, 0.3, 4.6, 16]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
          <mesh position={[0, -1.95, 0]}><cylinderGeometry args={[0.4, 0.34, 0.3, 16]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
          <mesh position={[0, 2.05, 0]}><boxGeometry args={[0.7, 0.34, 0.7]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
        </group>
      ))}
      <mesh position={[0, 2.0, -1.1]}><torusGeometry args={[1.9, 0.18, 6, 24, Math.PI]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
      <mesh position={[0, -1.8, 0]}><boxGeometry args={[1.5, 0.4, 1.1]} /><meshStandardMaterial color="#b4aa98" roughness={0.85} /></mesh>
      <mesh position={[0, -1.84, 0]}><cylinderGeometry args={[0.5, 0.56, 0.46, 20]} /><meshStandardMaterial color="#2c2824" roughness={0.9} /></mesh>
      <mesh position={[0, -1.96, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.4, 28]} /><meshStandardMaterial color="#ffb050" emissive="#ff8a20" emissiveIntensity={3.0} toneMapped={false} /></mesh>
      <mesh position={[0.16, -1.9, 0.0]}><icosahedronGeometry args={[0.11, 0]} /><meshStandardMaterial color="#ffb050" emissive="#ff8a20" emissiveIntensity={2.6} toneMapped={false} /></mesh>
      <mesh position={[-0.17, -1.92, 0.13]}><icosahedronGeometry args={[0.1, 0]} /><meshStandardMaterial color="#ffb050" emissive="#ff8a20" emissiveIntensity={2.6} toneMapped={false} /></mesh>
      <FlickerLight color="#ffb060" intensity={7} position={[0, -1.7, 0]} distance={9} amt={0.3} />
      <pointLight color="#ffe2b0" intensity={0.8} position={[0, 0.2, 1.2]} distance={7} decay={1.6} />
      <ambientLight intensity={0.22} color="#4a4a66" />
      <Sparkles count={18} size={2.4} scale={[3.0, 3.2, 2.4]} position={[0, 0.2, -0.4]} speed={0.25} color="#ffe6c0" noise={1.2} opacity={0.5} />
    </group>
  )
}

// ── dispatcher ────────────────────────────────────────────────────────────────────────────────────────────────
// `kind` comes from the equipped/previewed DioramaSpec (content/cosmetics.ts). id 0 / 'none' → null (plain scene).
export function SceneDiorama({ kind }: { kind: string }) {
  switch (kind) {
    case 'cornell': return <CornellDiorama />
    case 'campfire': return <CampfireDiorama />
    case 'dungeon': return <DungeonDiorama />
    case 'blueprint': return <BlueprintDiorama />
    case 'orrery': return <OrreryDiorama />
    case 'crystal': return <CrystalCaveDiorama />
    case 'altar': return <AltarDiorama />
    case 'plinth': return <PlinthDiorama />
    case 'snowglobe': return <SnowGlobeDiorama />
    case 'rockgarden': return <RockGardenDiorama />
    case 'forge': return <ForgeDiorama />
    case 'shrine': return <ShrineDiorama />
    case 'aquarium': return <AquariumDiorama />
    case 'mushroom': return <MushroomGroveDiorama />
    case 'shore': return <ShoreDiorama />
    case 'shop': return <ShopDiorama />
    case 'tearoom': return <TearoomDiorama />
    case 'meadow': return <MeadowDiorama />
    case 'chapel': return <ChapelDiorama />
    default: return null
  }
}
