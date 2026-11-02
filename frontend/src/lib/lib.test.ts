import { describe, expect, it } from 'vitest'
import { BLOCK_TYPES, BLOCKS_VERSION, blockName } from './blockTypes'
import { PREVIEW_POINTS, previewPoints } from './savedScans'
import { DEFAULT_BLOCK, dimensionLabel, DIMENSIONS, normalizeBlockType } from './scanOptions'
import { unpack } from './scanWorld'

describe('unpack (invariant 3: the one place triples become objects)', () => {
  it('turns flat x,y,z triples into matches, in order', () => {
    expect(unpack(Int32Array.from([1, 2, 3, -4, -64, 2_000_000]))).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: -4, y: -64, z: 2_000_000 },
    ])
  })

  it('handles an empty result', () => {
    expect(unpack(new Int32Array(0))).toEqual([])
  })
})

describe('scanOptions', () => {
  it('namespaces bare ids the way the scanner does', () => {
    expect(normalizeBlockType('stone')).toBe('minecraft:stone')
    expect(normalizeBlockType('minecraft:stone')).toBe('minecraft:stone')
    expect(normalizeBlockType('create:brass_casing')).toBe('create:brass_casing')
  })

  it('labels dimensions, passing unknown ids through', () => {
    expect(dimensionLabel('nether')).toBe('Nether')
    expect(dimensionLabel('aether')).toBe('aether')
  })

  it('offers exactly the dimensions parseRegionPath can report', () => {
    expect(DIMENSIONS.map((d) => d.id)).toEqual(['overworld', 'nether', 'end'])
  })
})

describe('blockTypes (the committed autocomplete snapshot)', () => {
  it('has a version and a substantial, namespaced, unique list', () => {
    expect(BLOCKS_VERSION).toMatch(/^\d/)
    expect(BLOCK_TYPES.length).toBeGreaterThan(500)
    const ids = BLOCK_TYPES.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const { id, name } of BLOCK_TYPES) {
      expect(id).toMatch(/^minecraft:[a-z0-9_]+$/)
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('includes the default block and names it', () => {
    expect(blockName(DEFAULT_BLOCK)).toBe('Nether Portal')
    expect(blockName('minecraft:stone')).toBe('Stone')
    expect(blockName('create:brass_casing')).toBeNull()
  })
})

describe('previewPoints', () => {
  const m = (x: number, z: number, y = 64) => ({ x, y, z })

  it('keeps distinct X/Z columns only', () => {
    expect(previewPoints([m(1, 1, 64), m(1, 1, 65), m(2, 3)])).toEqual([
      [1, 1],
      [2, 3],
    ])
  })

  it('samples evenly down to PREVIEW_POINTS', () => {
    const matches = Array.from({ length: 1000 }, (_, i) => m(i, i))
    const points = previewPoints(matches)
    expect(points).toHaveLength(PREVIEW_POINTS)
    expect(points[0]).toEqual([0, 0])
    expect(new Set(points.map(([x]) => x)).size).toBe(PREVIEW_POINTS)
    // Spread across the whole range, not bunched at the start.
    expect(points[PREVIEW_POINTS - 1][0]).toBeGreaterThan(900)
  })

  it('returns nothing for no matches', () => {
    expect(previewPoints([])).toEqual([])
  })
})
