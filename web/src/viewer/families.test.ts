import { describe, it, expect } from 'vitest'
import { FAMILY_CATEGORIES, ALL_FAMILIES, KNOWN_FAMILIES, pathOf } from './families'

describe('viewer family registry', () => {
  it('covers every renderable family the engine knows about', () => {
    const inRegistry = new Set(ALL_FAMILIES.map((e) => e.family))
    const missing = [...KNOWN_FAMILIES].filter((f) => !inRegistry.has(f))
    expect(missing).toEqual([])
  })

  it('has no uncategorised families (the self-healing "Other" bucket is empty)', () => {
    // If this fails, a new SDF/4D/relic family was added but not placed in a category in families.ts.
    expect(FAMILY_CATEGORIES.find((c) => c.name === 'Other')).toBeUndefined()
  })

  it('lists no family twice', () => {
    const all = ALL_FAMILIES.map((e) => e.family)
    expect(all.length).toBe(new Set(all).size)
  })

  it('labels every family by its render path', () => {
    expect(pathOf('sphere')).toBe('sdf')
    expect(pathOf('tesseract')).toBe('4d')
    expect(pathOf('utah_teapot')).toBe('mesh') // mesh-only (TeapotGeometry, no relic file)
    expect(pathOf('suzanne')).toBe('relic')
    expect(pathOf('klein_bottle')).toBe('sdf')
    // every entry carries a glyph + a label
    for (const e of ALL_FAMILIES) { expect(e.glyph.length).toBeGreaterThan(0); expect(e.label.length).toBeGreaterThan(0) }
  })
})
