// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { lightingKey } from './finishSdf'
import { lightingById } from '../content/cosmetics'

// lightingKey drives the path-traced hero's env() key glow from the equipped Lighting mood — so moving/coloured
// moods (orbit/ring/disco/pulse/tube) are VISIBLE on PT heroes, not just on the mesh Stage. Pure + GPU-free → unit-testable.
describe('lightingKey (Lighting mood → PT env key glow)', () => {
  const dir = new THREE.Vector3()
  const tint = new THREE.Vector3()

  it('default mood (Gallery) is a no-op: base key direction, white tint, steady pulse', () => {
    const pulse = lightingKey(lightingById(0), 1.23, dir, tint)
    expect(dir.length()).toBeCloseTo(1, 4) // normalized
    expect(dir.y).toBeGreaterThan(dir.x) // base key (0.35,0.75,0.40) leans up
    expect(Math.max(tint.x, tint.y, tint.z)).toBeCloseTo(1, 2) // white hue → max channel 1
    expect(tint.x).toBeCloseTo(tint.y, 2) // ~neutral
    expect(pulse).toBeCloseTo(1, 5) // steady
  })

  it('orbiting mood sweeps the key direction over time', () => {
    const L = lightingById(410) // Orbiting ✦
    const d0 = new THREE.Vector3(); lightingKey(L, 0, d0, tint)
    const d1 = new THREE.Vector3(); lightingKey(L, 3.0, d1, tint)
    expect(d0.distanceTo(d1)).toBeGreaterThan(0.1) // the glint moved
    expect(d0.length()).toBeCloseTo(1, 4)
  })

  it('disco (ring + hueShift) cycles the tint hue over time', () => {
    const L = lightingById(419) // Disco Ring ✦
    const c0 = new THREE.Vector3(); lightingKey(L, 0, dir, c0)
    const c1 = new THREE.Vector3(); lightingKey(L, 2.5, dir, c1)
    expect(c0.distanceTo(c1)).toBeGreaterThan(0.05) // the colour shifted
  })

  it('pulsing mood breathes the key intensity', () => {
    const L = lightingById(412) // Pulsing ✦
    const p0 = lightingKey(L, 0, dir, tint)
    const p1 = lightingKey(L, 1.5, dir, tint)
    expect(Math.abs(p0 - p1)).toBeGreaterThan(0.02) // intensity changed
  })

  it('a coloured static mood tints the glint without animating', () => {
    const L = lightingById(405) // Candlelit (warm, no motion)
    const p = lightingKey(L, 5.0, dir, tint)
    expect(p).toBeCloseTo(1, 5) // no pulse
    expect(tint.x).toBeGreaterThan(tint.z) // warm: red channel > blue
  })
})
