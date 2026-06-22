import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshTransmissionMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { glassThickness, OPEN_FAMILIES } from './geometry'
import { shapeGeometry, useRelics } from './relics'
import { useGfxPreset } from '../gfx'
import { useGame, type RarityName } from '../game/store'
import { gemFinishById, SLOT_FINISH } from '../content/cosmetics'

// Per-rarity look — the material ladder escalates with rarity (matte → glass → dispersive gem).
export const RARITY_COLOR: Record<RarityName, string> = {
  Common: '#9aa6c2',
  Rare: '#5fe0c6',
  Epic: '#b985ff',
  Ssr: '#ffb86b',
  Ur: '#ff5d8f',
  Relic: '#ffd76b',
  Meta: '#5ad1ff', // NG+ metashapes — electric hyper-cyan
  Transcendent: '#f5b8ff', // the capstone — radiant orchid
}

export const RARITY_RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

// Shared material recipe for the "world" gems (Orrery board, Lounge, Factory, Forge). Returns plain props to
// spread onto a <meshPhysicalMaterial>. When `glass` (gfx.sceneGlass) it's transmission glass that refracts the
// scene env via the renderer's ONE shared transmission target per camera — so for closed (FrontSide) gems the
// cost doesn't scale with gem count (≈1 extra opaque-scene render/frame). CAVEAT: open/non-orientable families
// render DoubleSide, and three's transmission pass then redraws each such object once more as BackSide — so a
// board of OPEN glass gems pays ~1 extra backside draw per open gem (not flat). Otherwise it's cheaper opaque
// emissive PBR. Both shapes share the SAME keys so toggling the tier is a clean prop diff. Scenes that animate
// the emissive "breathe" override emissiveIntensity via a ref afterward (pass a glass-aware base).
export function sceneGemMatProps(color: string, rank: number, open: boolean, glass: boolean) {
  return {
    color: glass ? '#ffffff' : color,
    transmission: glass ? 1 : 0,
    thickness: 0.6,
    ior: 1.5,
    metalness: glass ? 0 : 0.3 + rank * 0.06,
    roughness: glass ? 0.07 : 0.08,
    clearcoat: 1,
    clearcoatRoughness: glass ? 0.1 : 0.08,
    attenuationColor: glass ? color : '#ffffff',
    attenuationDistance: glass ? 1.4 : 10,
    emissive: color,
    emissiveIntensity: glass ? 0.22 + rank * 0.08 : 0.5 + rank * 0.12,
    envMapIntensity: 1.6,
    side: open ? THREE.DoubleSide : THREE.FrontSide,
  }
}

// The emissive base a scene's "breathe" animation should pulse around (matches sceneGemMatProps), glass-aware.
export const sceneGemEmissiveBase = (rank: number, glass: boolean): number => (glass ? 0.22 + rank * 0.08 : 0.5 + rank * 0.12)

/** The hero gem (pull reveal + inspector): real transmission glass, dispersion scaling with rarity. */
export function HeroGem({ family, rarity, spin = 0.4, materialize = false, finishOverride }: { family: string; rarity: RarityName; spin?: number; materialize?: boolean; finishOverride?: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null)
  const formT = useRef(0)
  const rank = RARITY_RANK[rarity]
  const g = useGfxPreset()
  // Equipped gem finish (Shop cosmetic) — its overrides merge over the rarity-derived base, so rarity still
  // reads through (a finish changes the *surface*, never the gem's identity). `finishOverride` lets the shop
  // hover-preview a finish without equipping it.
  const equippedFinish = useGame((s) => s.view?.equipped?.[SLOT_FINISH] ?? 0)
  const finish = gemFinishById(finishOverride ?? equippedFinish).mat
  useRelics() // swap in the real Relic mesh once it loads (benchy/armadillo/… are real meshes, not placeholders)
  const geometry = shapeGeometry(family)
  const open = OPEN_FAMILIES.has(family)
  // Absorption + the back-face refraction depth track the shape's *actual* glass path, not a constant — a
  // thin tube-knot would otherwise over-tint like a fat solid (see glassThickness: min bbox extent).
  const thickness = useMemo(() => glassThickness(geometry), [geometry])
  // Target material values (the settled gem). When `materialize`, the reveal animates UP to these from a glowing
  // forming state; the JSX seeds frame 0 at the forming state so there's no fully-formed flash on mount.
  const baseTransmission = 1 * (finish.transmissionMul ?? 1)
  const baseCA = Math.max(0, 0.05 + rank * 0.07 + (finish.chromaticAdd ?? 0))
  const baseEmissive = finish.emissiveIntensity ?? (rank >= 3 ? 0.12 + (rank - 3) * 0.1 : 0)
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.y += dt * spin
      ref.current.rotation.x += dt * spin * 0.35
    }
    // "Materialize": the gem refracts into existence — transmission + thickness rise 0→target while a bright
    // rarity-hued core and over-cranked dispersion flare then settle, and the body pops to scale. Reveal-only.
    // `formT < 1` so it settles ONCE and then leaves the material alone (matches RaymarchGem/Polytope4D).
    if (materialize && formT.current < 1 && matRef.current) {
      formT.current = Math.min(1, formT.current + dt / 0.75)
      const e = 1 - Math.pow(1 - formT.current, 3) // easeOutCubic
      const m = matRef.current
      m.transmission = baseTransmission * e
      m.thickness = thickness * e
      m.emissiveIntensity = baseEmissive + (1 - e) * 1.8 // a glowing seed that fades as the glass clears
      ;(m as unknown as { chromaticAberration: number }).chromaticAberration = baseCA * (1 + (1 - e) * 4)
      if (ref.current) ref.current.scale.setScalar(1.55 * (0.84 + 0.16 * e))
    }
  })
  return (
    <mesh ref={ref} geometry={geometry} scale={materialize ? 1.55 * 0.84 : 1.55}>
      <MeshTransmissionMaterial
        ref={matRef as never}
        // Refractive glass. Bloom + ACES now live in a post pass (HeroView/Stage), so HDR emissive/rim read
        // as glow; double refraction (backside) is back ON for closed solids so the jewel sees *into* itself.
        // The bright env behind makes the body refract colour (not black).
        color={finish.colorTint ?? '#ffffff'}
        transmission={materialize ? 0 : baseTransmission}
        thickness={materialize ? 0.001 : thickness}
        // Entry + exit refraction on closed solids; open sheets (Möbius/Klein/TPMS) stay single-pass, where a
        // second refraction event through a non-manifold surface is undefined and flickers. Off on `low`
        // (the back-face pass doubles transmission cost — see gfx.heroBackside).
        backside={!open && g.heroBackside}
        backsideThickness={thickness * 0.6}
        roughness={finish.roughness ?? Math.max(0.02, 0.06 - rank * 0.015)}
        ior={1.5 + rank * 0.06 + (finish.iorAdd ?? 0)}
        // screen-space per-channel "fire" — climbs with rarity. (drei's MTM overrides the standard transmission
        // chunk, so the physical `dispersion` uniform is inert here; chromaticAberration IS the dispersion lever.)
        chromaticAberration={materialize ? baseCA * 5 : baseCA}
        clearcoat={finish.clearcoat ?? 1}
        clearcoatRoughness={finish.clearcoatRoughness ?? 0.12}
        // thin-film iridescence + brighter env sampling are the SR/SSR escalation tells (oil-slick + sparkle)
        iridescence={finish.iridescence ?? (rank >= 2 ? 0.15 + (rank - 2) * 0.22 : 0)}
        iridescenceIOR={1.3}
        iridescenceThicknessRange={[100, 400]}
        envMapIntensity={(1.2 + rank * 0.35) * (finish.envMapIntensityMul ?? 1)}
        // a faint rarity-hued inner core (HDR-ish via bloom) — off for commons/rares; a bright seed while forming
        emissive={RARITY_COLOR[rarity]}
        emissiveIntensity={materialize ? baseEmissive + 1.8 : baseEmissive}
        attenuationColor={finish.attenuationColor ?? RARITY_COLOR[rarity]}
        attenuationDistance={finish.attenuationDistance ?? (rank >= 3 ? 2.5 : 6)}
        samples={g.transSamples}
        resolution={g.transRes}
        side={open ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  )
}

/** Cheap thumbnail material for the collection grid (no transmission → many can render at once). */
export function ThumbGem({ family, rarity, owned }: { family: string; rarity: RarityName; owned: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const rank = RARITY_RANK[rarity]
  useRelics() // real Relic mesh once loaded (the grid no longer shows box/icosahedron stand-ins)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.6
  })
  // Rarity reads in HOW the gem catches light, not just its hue: rarer = glossier, more metallic, more lit.
  return (
    <mesh ref={ref} geometry={shapeGeometry(family)} scale={1.3}>
      <meshStandardMaterial
        color={owned ? RARITY_COLOR[rarity] : '#2a2c3a'}
        roughness={owned ? Math.max(0.16, 0.42 - rank * 0.06) : 0.5}
        metalness={owned ? 0.32 + rank * 0.08 : 0.1}
        emissive={owned ? RARITY_COLOR[rarity] : '#000000'}
        emissiveIntensity={owned ? 0.12 + rank * 0.07 : 0}
        flatShading={false}
      />
    </mesh>
  )
}
