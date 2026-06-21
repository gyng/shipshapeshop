import { useRef, useState, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { OPEN_FAMILIES } from './geometry'
import { shapeGeometry, useRelics, relicFace } from './relics'
import { Atmosphere } from './Atmosphere'
import { RARITY_COLOR, sceneGemMatProps } from './Gem'
import { ScenePostFX } from './ScenePostFX'
import { RenderTechBadge } from './RenderTechBadge'
import { CursorLight } from './CursorLight'
import { useGame, type ShapeRow, type FluxEmitter } from '../game/store'
import { useOrreryUi, gemScreens } from '../orreryUi'
import { sceneById, boardSkinById, SLOT_BOARD } from '../content/cosmetics'
import { useGfxPreset } from '../gfx'

const RANK: Record<keyof typeof RARITY_COLOR, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }
const HEX = 0.62 // hex centre-to-corner (world units)
const SQ3 = Math.sqrt(3)
// the six pointy-top axial directions (mirrors orrery::HEX_DIRS / flux::step in the core)
const DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]

// pointy-top axial → world (floor plane y=0)
function axialToWorld(q: number, r: number): [number, number, number] {
  return [HEX * SQ3 * (q + r / 2), 0, HEX * 1.5 * r]
}
// World Y-rotation that points +Z along axial direction `dir` (same convention as EmitIndicator's arrows).
function dirAngleY(dir: number): number {
  const d = ((dir % 6) + 6) % 6
  const [wx, , wz] = axialToWorld(DIRS[d][0], DIRS[d][1])
  return Math.atan2(wx, wz)
}
function worldToAxial(x: number, z: number): [number, number] {
  const qf = ((SQ3 / 3) * x - (1 / 3) * z) / HEX
  const rf = ((2 / 3) * z) / HEX
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

// Scratch vectors for the per-frame WASD pan + screen projection (reused so the hot loop allocates nothing).
const UP = new THREE.Vector3(0, 1, 0)
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _proj = new THREE.Vector3()

// A hex ring marking a shape's home cell — shown on hover and (at the live cell) while dragging.
function AnchorRing({ q, r, color }: { q: number; r: number; color: string }) {
  const [x, , z] = axialToWorld(q, r)
  return (
    <mesh position={[x, -0.32, z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]} raycast={NOOP_RAYCAST}>
      <ringGeometry args={[HEX * 0.5, HEX * 0.74, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

// A faint hex pad marking a placeable cell; brightens when it's on the hovered shape's flux path.
function HexPad({ q, r, lit, pad = '#1a1c28', litCol = '#ffcf6b' }: { q: number; r: number; lit: boolean; pad?: string; litCol?: string }) {
  const [x, , z] = axialToWorld(q, r)
  return (
    // Pointy-top grid (see axialToWorld) → three's 6-gon cylinder already has a vertex at +Z, so NO rotation.
    // Circumradius = HEX tiles edge-to-edge; ×0.97 leaves a thin, even grout.
    <mesh position={[x, -0.38, z]}>
      <cylinderGeometry args={[HEX * 0.97, HEX * 0.97, 0.04, 6]} />
      <meshStandardMaterial
        color={lit ? litCol : pad}
        emissive={lit ? litCol : '#000000'}
        emissiveIntensity={lit ? 0.5 : 0}
        transparent
        opacity={lit ? 0.5 : 0.32}
        metalness={0.2}
        roughness={0.7}
      />
    </mesh>
  )
}

// In-world effect telegraph: each interaction verb gets a colour so the board reads at a glance.
const ACT_COLOR: Record<string, string> = {
  multiply: '#ffcf6b', // gold — scale (×)
  amplify: '#ff9d6b', // coral — flat add (+), distinct from multiply's gold so the additive verb reads apart
  redirect: '#b98cff', // violet — bend
  split: '#5fe0c6', // cyan — fork
  absorb: '#ff6b8a', // red — sink
  pass: '#3a3d4e',
}

// A flat ground ring under a gem, coloured by its interaction verb; brightness scales with effect strength (a
// ×6 UR glows, a ×1.2 common is faint). A thin INNER ring appears when the shape has a second effect (Epic+
// compound kits) — so "this gem does two things" is legible without opening it.
function EffectRing({ act, mult, act2, act2mult }: { act: string; mult: number; act2: string; act2mult: number }) {
  // strength per verb: multiply (mult-1)/5 (a ×6 UR glows, a ×1.2 common is faint); amplify log-compresses the raw
  // flat add (`mult`, µ-units up to ~160k) so a +160k Transcendent reads brighter than a +5k Common without either
  // maxing (D=18: log2(1+160k)≈17.3 → ~0.96; log2(1+5k)≈12.3 → ~0.68); others a flat 0.6.
  const strengthOf = (a: string, m: number) =>
    a === 'multiply' ? Math.min(1, (m - 1) / 5) : a === 'amplify' ? Math.min(1, Math.log2(1 + m) / 18) : 0.6
  const strength = strengthOf(act, mult)
  return (
    <group position={[0, -0.31, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
      {act !== 'pass' && (
        <mesh raycast={NOOP_RAYCAST}>
          <ringGeometry args={[HEX * 0.8, HEX * 0.94, 6]} />
          <meshBasicMaterial color={ACT_COLOR[act] ?? '#3a3d4e'} transparent opacity={0.22 + strength * 0.45} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {act2 !== 'pass' && (
        <mesh raycast={NOOP_RAYCAST}>
          <ringGeometry args={[HEX * 0.6, HEX * 0.72, 6]} />
          {/* inner ring opacity now scales with the SECOND effect's weight (was a flat 0.5) */}
          <meshBasicMaterial color={ACT_COLOR[act2] ?? '#3a3d4e'} transparent opacity={0.18 + strengthOf(act2, act2mult) * 0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

// Flat ground arrows telegraphing a gem's emission. The FACING arrow (the base direction `dir`) is always
// shown faintly so you can read where a beam points / what right-click-rotate is doing; on HOVER it brightens
// and the full pattern fans out: beam/pulse = one arrow, scatter = all six, rotating = all six (the sweep).
function EmitIndicator({ emit, dir, hovered }: { emit: string; dir: number; hovered: boolean }) {
  const op = hovered ? 0.85 : 0.3
  const dirs = hovered && (emit === 'scatter' || emit === 'rotating') ? [0, 1, 2, 3, 4, 5] : [((dir % 6) + 6) % 6]
  return (
    <group position={[0, -0.3, 0]}>
      {dirs.map((d) => {
        const [wx, , wz] = axialToWorld(DIRS[d][0], DIRS[d][1])
        const angle = Math.atan2(wx, wz)
        return (
          <group key={d} rotation={[0, angle, 0]}>
            <mesh position={[0, 0, HEX * 0.66]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
              <coneGeometry args={[HEX * 0.15, HEX * 0.28, 3]} />
              <meshBasicMaterial color="#ffe2a0" transparent opacity={op} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// A stationary gem at its placement cell. It spins/bobs gently in place (no lane motion now) and is draggable
// to re-place it; an enlarged invisible hit-target makes picking forgiving (mouse + touch). Right-click rotates
// its facing.
function StaticGem({
  shape,
  cell,
  emitter,
  hovered,
  dragCell,
  dragging,
  tickSec,
  paused,
  onHover,
  onDragStart,
  onRotate,
}: {
  shape: ShapeRow
  cell: [number, number]
  emitter: FluxEmitter
  hovered: boolean
  dragCell: [number, number] | null
  dragging: boolean
  tickSec: number
  paused: boolean
  onHover: (id: number | null) => void
  onDragStart: (id: number) => void
  onRotate: (id: number) => void
}) {
  const grp = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const rank = RANK[shape.rarity]
  const col = RARITY_COLOR[shape.rarity]
  const g = useGfxPreset()
  useRelics() // real Relic mesh once loaded (so a benchy on the board is a boat, not the box placeholder)
  // emission heartbeat: a quick light flare on each tick (gems all fire in sync with the cycle)
  const clock = useRef(0)
  const lastTick = useRef(-1)
  const flare = useRef(0)
  const baseLight = 1.8 + rank * 0.4
  const draggingRef = useRef(dragging)
  draggingRef.current = dragging
  // ONE stable raycast (no-op mid-drag): toggling the prop between a fn and undefined left r3f unable to
  // restore the default, making gems unpickable after the first drag.
  const hitRaycast = useMemo<THREE.Mesh['raycast']>(
    () =>
      function (this: THREE.Mesh, raycaster, intersects) {
        if (!draggingRef.current) THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
      },
    [],
  )
  const home = useMemo(() => axialToWorld(cell[0], cell[1]), [cell])
  const pop = useRef(0)
  const lastKey = useRef('')
  const facing = relicFace(shape.family)
  // Independent vertical-bob phase, seeded from the id so every gem rises and falls out of step (visual interest).
  const bobPhase = useMemo(() => (shape.id * 2.399963) % (Math.PI * 2), [shape.id])
  useFrame((state, dt) => {
    if (mesh.current) {
      // Shapes whose facing matters (relics with a clear front) point at their flux direction and DON'T spin —
      // right-click-rotate eases them around to the new facing; everything else free-spins gently.
      if (facing !== undefined) {
        const target = dirAngleY(emitter.dir) + facing
        const d = ((target - mesh.current.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
        mesh.current.rotation.y += d * Math.min(1, dt * 8)
      } else {
        mesh.current.rotation.y += dt * 0.6
      }
      // gentle independent bob — on the mesh only, so the ground rings/arrows stay flat on the floor
      mesh.current.position.y = Math.sin(state.clock.elapsedTime * 1.3 + bobPhase) * 0.07
    }
    // tick-synced emission flare
    if (!paused) clock.current += dt / tickSec
    const tk = Math.floor(clock.current)
    if (tk !== lastTick.current) { lastTick.current = tk; flare.current = 1 }
    flare.current = Math.max(0, flare.current - dt * 3) // gentler decay
    if (light.current) light.current.intensity = baseLight * (1 + flare.current * 0.18) // subtler pulse (was 0.6)
    const g = grp.current
    if (!g) return
    const target = dragCell ? axialToWorld(dragCell[0], dragCell[1]) : home
    const key = dragCell ? `${dragCell[0]},${dragCell[1]}` : 'home'
    if (key !== lastKey.current) { lastKey.current = key; if (dragCell) pop.current = 1 }
    const k = Math.min(1, dt * 22) // smooth settle toward the (possibly dragged) cell
    g.position.x += (target[0] - g.position.x) * k
    g.position.z += (target[2] - g.position.z) * k
    g.position.y = dragCell ? 0.25 : 0
    pop.current = Math.max(0, pop.current - dt * 5)
    g.scale.setScalar(1 + pop.current * 0.18)
  })
  return (
    <group ref={grp}>
      <pointLight ref={light} color={col} intensity={baseLight} distance={2.4} decay={1.6} />
      <EffectRing act={emitter.act} mult={emitter.act_mult} act2={emitter.act2} act2mult={emitter.act2_mult} />
      <EmitIndicator emit={emitter.emit} dir={emitter.dir} hovered={hovered} />
      <mesh
        raycast={hitRaycast}
        onPointerOver={(e) => { e.stopPropagation(); onHover(shape.id) }}
        onPointerOut={() => onHover(null)}
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onDragStart(shape.id) }}
        onContextMenu={(e) => { e.stopPropagation(); e.nativeEvent.preventDefault(); onRotate(shape.id) }}
      >
        <sphereGeometry args={[0.52, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* bob handled manually in useFrame (mesh.position.y) so each gem floats independently */}
      <mesh ref={mesh} geometry={shapeGeometry(shape.family)} scale={0.3} raycast={NOOP_RAYCAST}>
        {/* transmission glass (when gfx.sceneGlass) or opaque emissive PBR — shared recipe, see Gem.ts */}
        <meshPhysicalMaterial {...sceneGemMatProps(col, rank, OPEN_FAMILIES.has(shape.family), g.sceneGlass)} />
      </mesh>
    </group>
  )
}

// The flux stream: a pooled GPU-points system that renders production as fine DUST — roughly one mote per unit
// of flux. Emitters shed a continuous trickle (rate ∝ output); round shapes (Pip) emit DIFFUSELY in random
// radial directions, beams are focused. Each mote drifts independently (own speed + spread + float) along the
// path, mirroring flux::trace on the grid (multipliers brighten, redirectors turn + tint, absorbers swallow);
// at the grid EDGE it doesn't pop — it tips over and FALLS into the aether under gravity, fading as it banks.
const POOL = 2400
const TRAVEL = 1.12 // base cells/sec on the grid (slow drift; per-mote speed varies)
const FALL_DUR = 1.5 // seconds to fade once a mote falls off the edge
function FluxStream({ emitters, radius, tickSec, paused, hoverCell }: { emitters: FluxEmitter[]; radius: number; tickSec: number; paused: boolean; hoverCell: [number, number] | null }) {
  const occ = useMemo(() => {
    const m = new Map<string, FluxEmitter>()
    for (const e of emitters) m.set(`${e.cell[0]},${e.cell[1]}`, e)
    return m
  }, [emitters])
  const occRef = useRef(occ)
  occRef.current = occ
  const radiusRef = useRef(radius)
  radiusRef.current = radius
  const emittersRef = useRef(emitters)
  emittersRef.current = emitters
  const hoverRef = useRef(hoverCell)
  hoverRef.current = hoverCell

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL * 3).fill(-999), 3))
    g.setAttribute('aBright', new THREE.BufferAttribute(new Float32Array(POOL), 1))
    g.setAttribute('aHue', new THREE.BufferAttribute(new Float32Array(POOL), 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(POOL), 1))
    return g
  }, [])
  // per-mote state — on-grid motes step by cell; once they fall off they switch to free world physics
  const S = useMemo(
    () => ({
      alive: new Uint8Array(POOL),
      fq: new Int32Array(POOL),
      fr: new Int32Array(POOL),
      dir: new Uint8Array(POOL),
      sub: new Float32Array(POOL),
      steps: new Uint8Array(POOL),
      offx: new Float32Array(POOL),
      offy: new Float32Array(POOL),
      offz: new Float32Array(POOL),
      spd: new Float32Array(POOL),
      bob: new Float32Array(POOL),
      fall: new Uint8Array(POOL), // 0 on-grid, 1 falling off into the aether
      x: new Float32Array(POOL),
      y: new Float32Array(POOL),
      z: new Float32Array(POOL),
      vx: new Float32Array(POOL),
      vy: new Float32Array(POOL),
      vz: new Float32Array(POOL),
      fade: new Float32Array(POOL),
      fb: new Float32Array(POOL), // brightness at the moment of falling (for the fade-out)
      cursor: 0,
    }),
    [],
  )
  const clock = useRef(0)
  const acc = useRef<Float32Array>(new Float32Array(0))

  // `hue` ≥ 0 overrides the spawn tint — so a fork/copy INHERITS its parent mote's hue (carries the cyan
  // hover-trace attribution through split/multiply, instead of resetting to ambient gold and "vanishing").
  const spawn = (q: number, r: number, dir: number, boost = 1, hue = -1) => {
    const i = S.cursor++ % POOL
    S.alive[i] = 1
    S.fall[i] = 0
    S.fq[i] = q
    S.fr[i] = r
    S.dir[i] = ((dir % 6) + 6) % 6
    S.sub[i] = Math.random() * 0.5 // de-sync along the path
    S.steps[i] = 26
    S.offx[i] = (Math.random() - 0.5) * 0.34
    S.offy[i] = (Math.random() - 0.5) * 0.22 // centred on the gem layer (not floating above it)
    S.offz[i] = (Math.random() - 0.5) * 0.34
    S.spd[i] = 0.55 + Math.random() * 0.9 // independent speed
    S.bob[i] = Math.random() * 6.28
    const ba = geo.attributes.aBright.array as Float32Array
    const ha = geo.attributes.aHue.array as Float32Array
    const sa = geo.attributes.aSize.array as Float32Array
    ba[i] = (0.85 + Math.random() * 0.3) * boost // ~uniform: one mote ≈ one flux (boosted when its gem is hovered)
    ha[i] = hue >= 0 ? hue : (boost > 1 ? 0.5 : 0.12) // inherited parent hue, else gold (or cyan when its gem is hovered)
    sa[i] = (0.6 + Math.random() * 0.8) * boost
  }

  useFrame((_, dt) => {
    if (!paused) clock.current += dt / tickSec
    const tnow = clock.current
    const ems = emittersRef.current
    if (acc.current.length !== ems.length) acc.current = new Float32Array(ems.length)
    let spawned = false
    if (!paused) {
      for (let ei = 0; ei < ems.length; ei++) {
        const e = ems[ei]
        // EXACT 1 mote = 1 flux: shed rate (motes/sec) = this shape's flux/sec = amount(flux/hr)/3600. With the
        // core's FLUX_DENSITY scaling, a 0★ Pip's amount is ~3600/hr → ~1 mote/sec. (Capped so a monster can't
        // flood the pool — only the absolute top end is approximate.)
        acc.current[ei] += Math.min(50, e.amount / 3600) * dt
        let n = Math.floor(acc.current[ei])
        if (n > 0) {
          acc.current[ei] -= n
          if (n > 5) n = 5 // clamp per-frame burst
          // hovering a gem flares ITS motes (bigger + brighter) so you can see which stream it sheds
          const hc = hoverRef.current
          const boost = hc && hc[0] === e.cell[0] && hc[1] === e.cell[1] ? 2.0 : 1
          for (let k = 0; k < n; k++) {
            // emit kind sets DIRECTION only (rate is amount/3600 for all): beam/pulse fire along the facing,
            // round bodies (rotating) + scatter spray a diffuse radial cloud. Pulse no longer gates on a tick
            // window (that silently dropped motes and broke the 1 mote = 1 flux count).
            if (e.emit === 'rotating' || e.emit === 'scatter') spawn(e.cell[0], e.cell[1], Math.floor(Math.random() * 6), boost)
            else spawn(e.cell[0], e.cell[1], e.dir, boost)
            spawned = true
          }
        }
      }
    }

    const pos = geo.attributes.position.array as Float32Array
    const ba = geo.attributes.aBright.array as Float32Array
    const ha = geo.attributes.aHue.array as Float32Array
    const occ = occRef.current
    const rad = radiusRef.current
    let any = false
    for (let i = 0; i < POOL; i++) {
      if (!S.alive[i]) continue
      any = true
      const p = i * 3
      if (S.fall[i]) {
        // free physics — arc off the edge and drop into the void, fading
        if (!paused) {
          S.vy[i] -= 4.6 * dt
          S.x[i] += S.vx[i] * dt
          S.y[i] += S.vy[i] * dt
          S.z[i] += S.vz[i] * dt
          S.fade[i] -= dt
          if (S.fade[i] <= 0 || S.y[i] < -3) { S.alive[i] = 0; pos[p + 1] = -999; continue }
        }
        ba[i] = S.fb[i] * Math.max(0, S.fade[i] / FALL_DUR)
        pos[p] = S.x[i]
        pos[p + 1] = S.y[i]
        pos[p + 2] = S.z[i]
        continue
      }
      if (!paused) {
        S.sub[i] += dt * TRAVEL * S.spd[i]
        let guard = 0
        while (S.sub[i] >= 1 && S.alive[i] && !S.fall[i] && guard++ < 8) {
          S.sub[i] -= 1
          S.fq[i] += DIRS[S.dir[i]][0]
          S.fr[i] += DIRS[S.dir[i]][1]
          if (--S.steps[i] === 0) { S.alive[i] = 0; break }
          if (hexDist(S.fq[i], S.fr[i]) > rad) {
            // tipped over the rim → carry its momentum out and let gravity drop it into the void (no fountain)
            const [ex, , ez] = axialToWorld(S.fq[i], S.fr[i])
            const [wx, , wz] = axialToWorld(DIRS[S.dir[i]][0], DIRS[S.dir[i]][1])
            const L = Math.hypot(wx, wz) || 1
            const sp = (0.95 + Math.random() * 0.4) * S.spd[i] // ≈ its grid speed, no boost
            S.fall[i] = 1
            S.x[i] = ex + S.offx[i]; S.y[i] = 0.04 + S.offy[i]; S.z[i] = ez + S.offz[i]
            S.vx[i] = (wx / L) * sp; S.vz[i] = (wz / L) * sp; S.vy[i] = -0.05 // a gentle tip, not an upward pop
            S.fade[i] = FALL_DUR; S.fb[i] = ba[i]
            break
          }
          const e = occ.get(`${S.fq[i]},${S.fr[i]}`)
          if (e) {
            // mirror flux::trace — apply the primary effect then the secondary (act2), in order
            let absorbed = false
            for (let pass = 0; pass < 2 && !absorbed; pass++) {
              const kind = pass === 0 ? e.act : e.act2
              const turn = pass === 0 ? e.act_turn : e.act2_turn
              const mult = pass === 0 ? e.act_mult : e.act2_mult
              if (kind === 'absorb') { S.alive[i] = 0; absorbed = true }
              // multiply SPLITS the mote (×k → k motes) so 1 mote stays = 1 flux; fractional k is probabilistic
              else if (kind === 'multiply') {
                let extra = Math.max(0, mult - 1)
                const ib = (ha[i] > 0.35 && ha[i] < 0.7) ? 2 : 1 // a hovered (cyan) parent → keep its copies cyan + bright
                while (extra >= 1 || (extra > 0 && Math.random() < extra)) { spawn(S.fq[i], S.fr[i], S.dir[i], ib, ha[i]); extra -= 1 }
              } else if (kind === 'redirect') { S.dir[i] = (((S.dir[i] + turn) % 6) + 6) % 6; if (!(ha[i] > 0.35 && ha[i] < 0.7)) ha[i] = 0.92 } // keep the cyan hover-trace; pink-flash only ambient motes
              // split FORKS: a duplicate mote branches off `turn`, the original carries straight on — inheriting the
              // parent's hue/boost so a hovered (cyan) stream's forked branch stays cyan, not fading into ambient gold
              else if (kind === 'split') { spawn(S.fq[i], S.fr[i], (((S.dir[i] + turn) % 6) + 6) % 6, (ha[i] > 0.35 && ha[i] < 0.7) ? 2 : 1, ha[i]) }
              // amplify ADDS flat flux — thicken the stream with a few extra straight motes (capped so a big `add`
              // can't flood the pool), inheriting the parent hue/boost so the cyan hover-trace carries through. `mult`
              // carries the flat `add`; per-mote spawning approximates additive flux (amplify isn't a fork/multiply).
              else if (kind === 'amplify') {
                const ib = (ha[i] > 0.35 && ha[i] < 0.7) ? 2 : 1
                let extra = Math.min(2, Math.max(0, (mult - 1) * 0.25))
                while (extra >= 1 || (extra > 0 && Math.random() < extra)) { spawn(S.fq[i], S.fr[i], S.dir[i], ib, ha[i]); extra -= 1 }
              }
            }
            if (absorbed) break
          }
        }
      }
      if (!S.alive[i]) { pos[p + 1] = -999; continue }
      if (S.fall[i]) { pos[p] = S.x[i]; pos[p + 1] = S.y[i]; pos[p + 2] = S.z[i]; continue }
      const [x0, , z0] = axialToWorld(S.fq[i], S.fr[i])
      const nq = S.fq[i] + DIRS[S.dir[i]][0]
      const nr = S.fr[i] + DIRS[S.dir[i]][1]
      const [x1, , z1] = axialToWorld(nq, nr)
      const s = S.sub[i]
      pos[p] = x0 + (x1 - x0) * s + S.offx[i]
      pos[p + 1] = 0.04 + S.offy[i] + Math.sin(tnow * 1.7 + S.bob[i]) * 0.05
      pos[p + 2] = z0 + (z1 - z0) * s + S.offz[i]
    }
    if (any || spawned) {
      geo.attributes.position.needsUpdate = true
      geo.attributes.aBright.needsUpdate = true
      geo.attributes.aHue.needsUpdate = true
      geo.attributes.aSize.needsUpdate = true
    }
  })

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false, // glow OVER the gems — otherwise small motes get hidden inside/behind them
        blending: THREE.AdditiveBlending,
        uniforms: { uSize: { value: 64 } }, // small — fine dust
        vertexShader: `attribute float aBright; attribute float aHue; attribute float aSize; varying float vB; varying float vH; uniform float uSize;
          void main(){ vB = aBright; vH = aHue;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = max(1.2, uSize * aSize * (0.6 + 0.4 * aBright) / -mv.z); gl_Position = projectionMatrix * mv; }`,
        // soft round mote, warm gold; hue→pink flags a just-redirected mote. Kept dim — additive blending of
        // many motes adds up fast, so a low per-mote alpha reads as fine dust, not blinding glow.
        // hue→ colour: gold (normal) · bright CYAN (its gem is hovered, vH≈0.5) · pink (just-redirected, vH≈0.92).
        // The hovered stream also gets a fuller alpha so it clearly reads out of the ambient gold dust.
        fragmentShader: `varying float vB; varying float vH;
          void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d);
            if (r > 0.5) discard;
            float hov = (vH > 0.35 && vH < 0.7) ? 1.0 : 0.0;
            float a = smoothstep(0.5, 0.0, r) * clamp(vB, 0.0, 1.4);
            vec3 gold = vec3(0.95,0.78,0.42);
            vec3 cyan = vec3(0.35,1.0,0.95);
            vec3 pink = vec3(0.95,0.45,0.8);
            vec3 tint = vH > 0.7 ? pink : (hov > 0.5 ? cyan : gold);
            gl_FragColor = vec4(tint * (0.5 + vB * 0.4), a * (0.5 + hov * 0.5)); }`,
      }),
    [],
  )
  // frustumCulled OFF: motes live in a buffer that starts off-screen, so three's bounding-sphere check would
  // flicker the whole cloud in/out as the camera auto-rotates. Never cull it.
  return <points geometry={geo} material={mat} raycast={NOOP_RAYCAST} frustumCulled={false} />
}

function Scene() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const setAnchor = useGame((s) => s.setAnchor)
  const undeploy = useGame((s) => s.undeploy)
  const scene = sceneById(view?.scene ?? 0)
  const board = boardSkinById(view?.equipped?.[SLOT_BOARD] ?? 0) // equipped Board Skin (Shop cosmetic)
  const [backdrop, key, cool, warm] = scene.env
  const g = useGfxPreset()
  const paused = useOrreryUi((s) => s.paused)
  const hoverId = useOrreryUi((s) => s.hoverId)
  const setHover = useOrreryUi((s) => s.setHover)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragCell, setDragCell] = useState<[number, number] | null>(null)

  // Cursor affordance: grab over a pickable gem, grabbing while moving one.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.domElement.style.cursor = dragId !== null ? 'grabbing' : hoverId !== null ? 'grab' : 'auto'
  }, [gl, hoverId, dragId])

  // WASD pans the camera across the floor (in addition to right/middle-drag rotate + wheel zoom).
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null)
  const keysRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (!(e.target instanceof HTMLInputElement)) keysRef.current[e.key.toLowerCase()] = true }
    const up = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])
  useFrame((state, dt) => {
    const k = keysRef.current
    const fz = (k['w'] ? -1 : 0) + (k['s'] ? 1 : 0)
    const fx = (k['a'] ? -1 : 0) + (k['d'] ? 1 : 0)
    const ctrls = controlsRef.current
    if ((fx === 0 && fz === 0) || !ctrls) return
    const cam = state.camera
    cam.getWorldDirection(_fwd)
    _fwd.y = 0
    _fwd.normalize()
    _right.crossVectors(_fwd, UP).normalize()
    _move.set(0, 0, 0).addScaledVector(_fwd, -fz * dt * 7).addScaledVector(_right, fx * dt * 7)
    cam.position.add(_move)
    ctrls.target.add(_move)
    ctrls.update()
  })

  const emitters = view?.flux_emitters ?? []
  const cells = view?.orrery_cells ?? []
  const radius = view?.orrery_radius ?? 4
  const loadout = view?.loadout ?? []
  const tickSec = (view?.orrery_tick_ms ?? 1000) / 1000

  // project each stationary gem to screen-% so the DOM flux-number overlay pops "+N" over a real shape
  useFrame((state) => {
    const cam = state.camera
    const out: { x: number; y: number }[] = []
    for (const e of emitters) {
      const [x, , z] = axialToWorld(e.cell[0], e.cell[1])
      _proj.set(x, 0.3, z).project(cam)
      if (_proj.z > 1) continue
      out.push({ x: (_proj.x * 0.5 + 0.5) * 100, y: (-_proj.y * 0.5 + 0.5) * 100 })
    }
    gemScreens.current = out
  })

  // Begin a drag and register the commit-on-release listener SYNCHRONOUSLY (a fast click's pointerup can
  // fire before a useEffect would run, leaving dragId stuck and every gem unpickable).
  const dragCellRef = useRef<[number, number] | null>(null)
  dragCellRef.current = dragCell
  const offGridRef = useRef(false) // pointer dragged past the grid edge → release there RECALLS the shape
  const beginDrag = (id: number, anchor: [number, number]) => {
    setHover(null)
    setDragId(id)
    setDragCell(anchor)
    dragCellRef.current = anchor
    offGridRef.current = false
    const up = () => {
      if (offGridRef.current) undeploy(id) // dropped off the board → back to the library
      else {
        const dc = dragCellRef.current
        if (dc) setAnchor(id, dc[0], dc[1])
      }
      setDragId(null)
      setDragCell(null)
      offGridRef.current = false
    }
    window.addEventListener('pointerup', up, { once: true })
  }
  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    if (dragId == null) return
    const [q, r] = worldToAxial(e.point.x, e.point.z)
    if (hexDist(q, r) <= radius) { offGridRef.current = false; setDragCell([q, r]) }
    else offGridRef.current = true // past the rim → marked for recall (gem stays at its last cell until release)
  }

  return (
    <>
      <color attach="background" args={['#0a0b14']} />
      <Atmosphere defaultFog={['#0a0b14', 10, 30]} moteScale={[10, 4, 10]} motePos={[0, 1.4, 0]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cfe0ff', '#181228', 0.7]} />
      <directionalLight position={[3, 7, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <CursorLight planeY={0} />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} color={cool} position={[-4, 3, -4]} scale={7} />
        <Lightformer intensity={2.2} color={warm} position={[5, 2, -3]} scale={7} />
        <Lightformer intensity={1.8} color={backdrop} position={[0, -2, 4]} scale={6} />
        <Lightformer intensity={1.8} color={key} position={[0, 5, 2]} scale={5} />
      </Environment>

      {/* floor plane — receives the drag raycast. Sits well BELOW the pads so it never z-fights the board. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow onPointerMove={onFloorMove}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={board.floor} metalness={0.6} roughness={0.45} />
      </mesh>

      {/* hex pads — lit along the hovered shape's flux path */}
      {cells.map(([q, r]) => (
        <HexPad key={`${q},${r}`} q={q} r={r} lit={false} pad={board.padUnlit} litCol={board.padLit} />
      ))}

      {/* hovered shape: ring on its home cell */}
      {hoverId != null && dragId == null && (() => {
        const slot = loadout.indexOf(hoverId)
        const e = emitters[slot]
        const sh = shapes[hoverId]
        return e && sh ? <AnchorRing q={e.cell[0]} r={e.cell[1]} color={RARITY_COLOR[sh.rarity]} /> : null
      })()}

      {/* dragged shape: ring on the tentative cell */}
      {dragId != null && dragCell && (() => {
        const sh = shapes[dragId]
        return sh ? <AnchorRing q={dragCell[0]} r={dragCell[1]} color={RARITY_COLOR[sh.rarity]} /> : null
      })()}

      {/* stationary gems */}
      {emitters.map((e, i) => {
        const sh = shapes[loadout[i]]
        if (!sh) return null
        return (
          <StaticGem
            key={loadout[i]}
            shape={sh}
            cell={e.cell}
            emitter={e}
            hovered={hoverId === sh.id}
            dragCell={dragId === sh.id ? dragCell : null}
            dragging={dragId !== null}
            tickSec={tickSec}
            paused={paused || dragId !== null}
            onHover={setHover}
            onDragStart={(id) => beginDrag(id, e.cell)}
            onRotate={(id) => useGame.getState().rotateLane(id)}
          />
        )
      })}

      {/* the flux they shed, travelling + interacting across the grid */}
      <FluxStream emitters={emitters} radius={radius} tickSec={tickSec} paused={paused || dragId !== null} hoverCell={hoverId != null ? emitters[loadout.indexOf(hoverId)]?.cell ?? null : null} />

      <ContactShadows position={[0, -0.345, 0]} opacity={0.5} scale={16} blur={2.6} far={4} />
      <Sparkles count={Math.round(50 * g.sparkle)} scale={[10, 4, 10]} position={[0, 1.4, 0]} size={1.5} speed={0.3} color={board.sparkle} />
      {/* Left mouse / one finger pick + drag gems (not the camera). Camera ROTATES on right- or middle-drag;
          wheel + two-finger pinch zoom (and rotate). */}
      <OrbitControls
        ref={controlsRef as never}
        makeDefault
        enabled={dragId === null}
        enablePan={false}
        enableZoom
        minDistance={3}
        maxDistance={16}
        minPolarAngle={0.2}
        maxPolarAngle={1.45}
        autoRotate={dragId === null && hoverId === null}
        autoRotateSpeed={0.4}
        mouseButtons={{ MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ TWO: THREE.TOUCH.DOLLY_ROTATE }}
      />
      {/* shared post chain (optional SSAO + bloom → ACES), glows the emissive gems + flux dust */}
      <ScenePostFX />
    </>
  )
}

export function Orrery3D() {
  const g = useGfxPreset()
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        dpr={g.dpr}
        shadows={g.shadows}
        gl={{ powerPreference: 'high-performance' }}
        camera={{ position: [0, 5, 6.5], fov: 46 }}
        onPointerMissed={() => undefined}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Scene />
      </Canvas>
      <RenderTechBadge tech="mesh" />
    </div>
  )
}
