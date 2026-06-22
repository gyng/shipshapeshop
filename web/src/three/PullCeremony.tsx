import { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { RARITY_COLOR, RARITY_RANK } from './Gem'
import type { PullOutcome, ShapeRow, RarityName } from '../game/store'
import { sfxCharge, sfxClimbTick, sfxReveal } from '../audio'
import { useSparks } from '../juice'
import { useGfxPreset } from '../gfx'
import { useT } from '../i18n'

// ── The 3D pull ceremony: coloured spheres (one per pull, colour = rarity) rain into a glass jar, bounce-settle
// into a pile, then a flash hands off to the existing reveal. ALL presentation — the truth is already resolved
// + persisted in Rust before this plays (see store pull()/tenPull()). The colour IS the rarity-tell (the hype is
// "is one of them gold?"); the gold/top sphere is sized up + lands in the most prominent spot in the pile.

// classic ball-drop bounce — drop, then 1–2 decaying bounces that settle. THE satisfying beat for a capsule drop.
const easeOutBounce = (p: number): number => {
  const n1 = 7.5625
  const d1 = 2.75
  if (p < 1 / d1) return n1 * p * p
  if (p < 2 / d1) { p -= 1.5 / d1; return n1 * p * p + 0.75 }
  if (p < 2.5 / d1) { p -= 2.25 / d1; return n1 * p * p + 0.9375 }
  p -= 2.625 / d1
  return n1 * p * p + 0.984375
}

// beat timings (ms). single ≈ 4.5s · ten-pull ≈ 6.3s — both skippable (tap anywhere) at any frame.
const CHARGE = 1200 // jar glows, energy gathers — before the first sphere drops
const STAGGER = 200 // gap between spheres in a multi-pull (they rain in, not one-by-one ceremonies)
const FALL = 1500 // a sphere's drop + bounce-settle
const HOLD = 1300 // suspense after the last settles ("is it gold?")
const FLASH = 520 // the climax flash that bridges into the reveal

const JAR_R = 1.5
const FLOOR_Y = -1.45
const TOP_Y = 1.7
const START_Y = 3.6 // spawn height, above the jar mouth
const FIRST_IMPACT_P = 1 / 2.75 // easeOutBounce's first cusp ≈ 0.36 — when a sphere first hits the floor

interface SphereDatum {
  hex: string
  color: THREE.Color
  rank: number
  size: number
  rest: THREE.Vector3
  spawn: number // ms after mount
}

const rarityOf = (p: PullOutcome, shapes: ShapeRow[]): RarityName => p.rarity ?? shapes[p.shape_id]?.rarity ?? 'Common'

// Lay out the settled pile (phyllotaxis disc + a gentle mound) and assign the MOST PROMINENT spots (central +
// high) to the HIGHEST-rarity pulls, so the gold one ends up on top of the pile, not buried.
function buildSpheres(pulls: PullOutcome[], shapes: ShapeRow[]): SphereDatum[] {
  const n = pulls.length
  const slots: { pos: THREE.Vector3; prom: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996323 // golden angle
    const rr = (JAR_R - 0.5) * Math.sqrt(i / Math.max(n, 1))
    const layer = Math.floor(i / 7)
    const y = FLOOR_Y + 0.34 + layer * 0.42 + (1 - rr / JAR_R) * 0.24 // central spheres mound up slightly
    slots.push({ pos: new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), prom: (JAR_R - rr) + y * 0.6 })
  }
  slots.sort((p, q) => q.prom - p.prom)
  const order = pulls.map((_, i) => i).sort((a, b) => RARITY_RANK[rarityOf(pulls[b], shapes)] - RARITY_RANK[rarityOf(pulls[a], shapes)])
  const rest: THREE.Vector3[] = new Array(n)
  order.forEach((pullIdx, k) => { rest[pullIdx] = slots[k].pos })
  return pulls.map((p, i) => {
    const rarity = rarityOf(p, shapes)
    const rank = RARITY_RANK[rarity]
    const hex = RARITY_COLOR[rarity]
    return {
      hex,
      color: new THREE.Color(hex),
      rank,
      size: 0.34 * (rank >= 3 ? 1.24 : rank >= 1 ? 1.02 : 0.92), // top-tier spheres read bigger
      rest: rest[i],
      spawn: CHARGE + i * STAGGER,
    }
  })
}

// The glass jar: a translucent open cylinder (depthWrite off so the glowing spheres show through), a pedestal,
// and a rim ring at the mouth that glows the HIGHEST rarity in the batch — the "lever glows gold" jackpot tell.
function Jar({ topColor, mountRef }: { topColor: string; mountRef: { current: number } }) {
  const rim = useRef<THREE.MeshStandardMaterial>(null)
  const glow = useMemo(() => new THREE.Color(topColor), [topColor])
  const h = TOP_Y - FLOOR_Y
  useFrame(() => {
    const now = performance.now() - mountRef.current
    const charge = Math.min(now / CHARGE, 1)
    if (rim.current) rim.current.emissiveIntensity = 0.5 + charge * 2.2 + Math.sin(now * 0.006) * 0.35
  })
  return (
    <group>
      {/* pedestal */}
      <mesh position={[0, FLOOR_Y - 0.16, 0]}>
        <cylinderGeometry args={[JAR_R * 1.18, JAR_R * 1.32, 0.28, 48]} />
        <meshStandardMaterial color="#15131f" roughness={0.6} metalness={0.3} emissive={glow} emissiveIntensity={0.25} />
      </mesh>
      {/* floor the spheres rest on */}
      <mesh position={[0, FLOOR_Y, 0]}>
        <cylinderGeometry args={[JAR_R * 0.97, JAR_R * 0.9, 0.1, 48]} />
        <meshStandardMaterial color="#0c0b16" roughness={0.35} metalness={0.2} emissive={glow} emissiveIntensity={0.12} />
      </mesh>
      {/* glass body */}
      <mesh position={[0, (TOP_Y + FLOOR_Y) / 2, 0]} renderOrder={3}>
        <cylinderGeometry args={[JAR_R * 1.04, JAR_R * 0.94, h, 56, 1, true]} />
        <meshPhysicalMaterial color="#cfe8ff" transparent opacity={0.13} roughness={0.06} metalness={0} transmission={0} side={THREE.DoubleSide} depthWrite={false} envMapIntensity={1.4} />
      </mesh>
      {/* glowing mouth rim — the rarity tell */}
      <mesh position={[0, TOP_Y, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={4}>
        <torusGeometry args={[JAR_R * 1.02, 0.05, 16, 64]} />
        <meshStandardMaterial ref={rim} color={glow} emissive={glow} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Spheres({ data, mountRef, onImpact, onSettled }: { data: SphereDatum[]; mountRef: { current: number }; onImpact: (i: number, d: SphereDatum) => void; onSettled: () => void }) {
  const group = useRef<THREE.Group>(null)
  const impacted = useRef<boolean[]>(data.map(() => false))
  const pulse = useRef<number[]>(data.map(() => 0)) // emissive flash on impact, decays
  const settled = useRef(false)
  const lastSettle = useMemo(() => Math.max(0, ...data.map((d) => d.spawn + FALL)), [data])
  useFrame((_, delta) => {
    const now = performance.now() - mountRef.current
    const g = group.current
    if (!g) return
    data.forEach((d, i) => {
      const mesh = g.children[i] as THREE.Mesh | undefined
      if (!mesh) return
      const local = now - d.spawn
      if (local < 0) { mesh.visible = false; return }
      mesh.visible = true
      const p = Math.min(local / FALL, 1)
      const y = THREE.MathUtils.lerp(START_Y, d.rest.y, easeOutBounce(p))
      mesh.position.set(d.rest.x, y, d.rest.z)
      // squash-and-stretch around the first impact cusp: flatten y, bulge x/z
      const sq = 1 - 0.34 * Math.max(0, 1 - Math.abs(p - FIRST_IMPACT_P) / 0.07)
      const bulge = 1 + (1 - sq)
      mesh.scale.set(d.size * bulge, d.size * sq, d.size * bulge)
      if (!impacted.current[i] && p >= FIRST_IMPACT_P) {
        impacted.current[i] = true
        pulse.current[i] = 1
        onImpact(i, d)
      }
      pulse.current[i] = Math.max(0, pulse.current[i] - delta * 3)
      const mat = mesh.material as THREE.MeshStandardMaterial
      // base glow scales with rarity; a bright pulse on impact; settled top-tier spheres keep a gentle shimmer
      const shimmer = p >= 1 && d.rank >= 3 ? 0.3 + Math.sin(now * 0.005 + i) * 0.18 : 0
      // base kept modest so the rarity COLOUR reads (the hype is the colour-tell); top tiers run white-hot
      mat.emissiveIntensity = 0.95 + d.rank * 0.5 + pulse.current[i] * 2.4 + shimmer
    })
    if (!settled.current && now >= lastSettle) { settled.current = true; onSettled() }
  })
  return (
    <group ref={group}>
      {data.map((d, i) => (
        <mesh key={i} visible={false}>
          <sphereGeometry args={[1, 28, 28]} />
          <meshStandardMaterial color={d.color} emissive={d.color} emissiveIntensity={1.6} roughness={0.22} metalness={0.12} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Full-screen 3D pull ceremony. Mounts in the reveal's "charge" phase, runs ~4.5s (single) / ~6.3s (ten-pull),
 * then calls onDone() to hand off to the existing per-gem / summary reveal. Tap anywhere (the parent modal's
 * onClick) skips at any frame; a corner toggle can disable it for future pulls.
 */
export function PullCeremony({ pulls, shapes, onDone, onSkipAll }: { pulls: PullOutcome[]; shapes: ShapeRow[]; onDone: () => void; onSkipAll: () => void }) {
  const tr = useT()
  const g = useGfxPreset()
  const mountRef = useRef(performance.now())
  const [flash, setFlash] = useState(false)
  const data = useMemo(() => buildSpheres(pulls, shapes), [pulls, shapes])
  const bestRank = useMemo(() => Math.max(0, ...pulls.map((p) => RARITY_RANK[rarityOf(p, shapes)])), [pulls, shapes])
  const topColor = useMemo(() => {
    let best = pulls[0]
    for (const p of pulls) if (RARITY_RANK[rarityOf(p, shapes)] > RARITY_RANK[rarityOf(best, shapes)]) best = p
    return RARITY_COLOR[rarityOf(best, shapes)]
  }, [pulls, shapes])

  useEffect(() => {
    sfxCharge(bestRank)
    const lastSettle = CHARGE + (pulls.length - 1) * STAGGER + FALL
    const flashAt = lastSettle + HOLD
    const doneAt = flashAt + FLASH * 0.45 // hand off DURING the flash, so the reveal's first frame is masked
    const t1 = setTimeout(() => { setFlash(true); sfxReveal(bestRank) }, flashAt)
    const t2 = setTimeout(() => onDone(), doneAt)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onImpact = (_i: number, d: SphereDatum) => {
    sfxClimbTick(Math.min(d.rank + 1, 4)) // higher rarity → higher-pitched landing beat
    if (d.rank >= 3) {
      // top-tier landings throw real (DOM) sparks at the jar, in the sphere's own colour
      useSparks.getState().burst(window.innerWidth / 2, window.innerHeight * 0.56, { count: 8 + d.rank * 4, power: 1 + d.rank * 0.3, hues: [d.hex, '#ffffff', '#fff6dc', d.hex] })
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Canvas frameloop="always" resize={{ offsetSize: true }} camera={{ position: [0, 1.7, 6.4], fov: 45 }} dpr={g.dpr} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
        <ambientLight intensity={0.45} />
        <directionalLight position={[3, 6, 4]} intensity={0.7} />
        <pointLight position={[0, 1.2, 3]} intensity={2.4} distance={16} decay={1.5} color={topColor} />
        <Jar topColor={topColor} mountRef={mountRef} />
        <Spheres data={data} mountRef={mountRef} onImpact={onImpact} onSettled={() => {}} />
        {bestRank >= 3 && <Sparkles count={40} scale={[4, 4, 4]} position={[0, 0.2, 0]} size={3} speed={0.4} opacity={0.7} color={topColor} />}
        <EffectComposer multisampling={0}>
          {g.bloom ? <Bloom mipmapBlur luminanceThreshold={0.72} intensity={0.85 + bestRank * 0.3} levels={7} /> : <></>}
          <Vignette offset={0.3} darkness={0.6} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>
      {flash && <div className="ceremony-flash" style={{ background: `radial-gradient(circle at 50% 52%, ${topColor}, transparent 62%)`, ['--flash-ms' as string]: `${FLASH}ms` }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)', textAlign: 'center', color: 'rgba(232,234,242,0.72)', fontSize: 'var(--fs-caption)', letterSpacing: 0.4, pointerEvents: 'none' }}>
        {pulls.length > 1 ? tr('reveal.drawingTen') : tr('reveal.drawing')}{tr('reveal.tapToSkip')}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onSkipAll() }}
        style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 14, padding: '6px 12px', borderRadius: 'var(--r-pill)', border: '1px solid var(--c-border)', background: 'rgba(13,13,22,0.7)', color: 'var(--c-text-secondary)', fontSize: 'var(--fs-caption)', cursor: 'pointer', backdropFilter: 'blur(6px)' }}
      >
        {tr('reveal.skipAnims')}
      </button>
    </div>
  )
}
