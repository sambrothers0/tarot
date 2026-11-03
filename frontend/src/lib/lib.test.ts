import { describe, expect, it } from 'vitest'
import {
  addBlockType,
  BLOCK_TYPES,
  BLOCKS_VERSION,
  blockName,
  layersTitle,
  resolveBlockInput,
} from './blockTypes'
import { packCoords, unpackCoords } from './coordsCodec'
import { PREVIEW_POINTS, previewPoints } from './savedScans'
import {
  coordinatesJson,
  DEFAULT_BLOCK,
  dimensionLabel,
  DIMENSIONS,
  layerTotals,
  MAX_BLOCK_TYPES,
  normalizeBlockType,
} from './scanOptions'
import { unpack } from './scanWorld'

describe('unpack (invariant 3: the one place triples become objects)', () => {
  it('turns flat x,y,z triples into matches, in order', () => {
    expect(unpack(Int32Array.from([1, 2, 3, -4, -64, 2_000_000]))).toEqual([
      { x: 1, y: 2, z: 3, layer: 0 },
      { x: -4, y: -64, z: 2_000_000, layer: 0 },
    ])
  })

  it('tags each run with its block, runs back to back in block order', () => {
    const coords = Int32Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3])
    expect(unpack(coords, [1, 0, 2]).map((m) => [m.x, m.layer])).toEqual([
      [1, 0],
      [2, 2],
      [3, 2],
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
  const m = (x: number, z: number, y = 64, layer = 0) => ({ x, y, z, layer })

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

  it('tags points with their block when there are several, the first block winning a shared column', () => {
    expect(previewPoints([m(1, 1, 64, 1), m(1, 1, 65, 0), m(2, 2, 64, 1)], 2)).toEqual([
      [1, 1, 0],
      [2, 2, 1],
    ])
  })
})

describe('several block types', () => {
  it('resolves what a player types to the block ID', () => {
    expect(resolveBlockInput('  Nether Portal ')).toBe('minecraft:nether_portal')
    expect(resolveBlockInput('nether portal')).toBe('minecraft:nether_portal')
    expect(resolveBlockInput('Obsidian')).toBe('minecraft:obsidian')
    expect(resolveBlockInput('minecraft:STONE')).toBe('minecraft:stone')
    expect(resolveBlockInput('create:brass_casing')).toBe('create:brass_casing')
    expect(resolveBlockInput('   ')).toBeNull()
  })

  it('adds a block once, and no more than the cap', () => {
    expect(addBlockType([], 'stone')).toEqual({ blockTypes: ['minecraft:stone'], problem: null })
    expect(addBlockType(['minecraft:stone'], 'Stone').problem).toMatch(/already/)
    const full = Array.from({ length: MAX_BLOCK_TYPES }, (_, i) => `mod:b${i}`)
    expect(addBlockType(full, 'stone').problem).toMatch(String(MAX_BLOCK_TYPES))
    const blank = ['minecraft:stone']
    expect(addBlockType(blank, ' ')).toEqual({ blockTypes: blank, problem: null })
  })

  it('totals layers and titles a scan by its blocks', () => {
    const layers = [
      { blockType: 'minecraft:nether_portal', count: 4, truncated: false },
      { blockType: 'minecraft:obsidian', count: 10, truncated: true },
      { blockType: 'create:brass_casing', count: 0, truncated: false },
    ]
    expect(layerTotals(layers)).toEqual({ count: 14, truncated: true })
    expect(layersTitle(layers)).toBe('Nether Portal + 2 more')
    expect(layersTitle(layers.slice(2))).toBe('create:brass_casing')
  })

  it('copies one block as a plain list and several keyed by block', () => {
    const one = { layers: [{ blockType: 'minecraft:stone', count: 1, truncated: false }], matches: [{ x: 1, y: 2, z: 3, layer: 0 }] }
    expect(JSON.parse(coordinatesJson(one))).toEqual([{ x: 1, y: 2, z: 3 }])
    const two = {
      layers: [
        { blockType: 'minecraft:nether_portal', count: 1, truncated: false },
        { blockType: 'minecraft:obsidian', count: 2, truncated: false },
      ],
      matches: [
        { x: 0, y: 64, z: 0, layer: 0 },
        { x: 0, y: 63, z: 0, layer: 1 },
        { x: 0, y: 67, z: 0, layer: 1 },
      ],
    }
    expect(JSON.parse(coordinatesJson(two))).toEqual({
      'minecraft:nether_portal': [{ x: 0, y: 64, z: 0 }],
      'minecraft:obsidian': [
        { x: 0, y: 63, z: 0 },
        { x: 0, y: 67, z: 0 },
      ],
    })
  })
})

describe('coordsCodec', () => {
  const matches = [
    { x: 5, y: 64, z: -3, layer: 0 },
    { x: 5, y: 65, z: -3, layer: 0 },
    { x: -1000, y: -60, z: 20_000, layer: 2 },
    { x: 4, y: 63, z: -3, layer: 1 },
  ]

  it('round-trips several blocks, grouped by block', async () => {
    const out = await unpackCoords(await packCoords(matches, 3))
    expect(out).toEqual([matches[0], matches[1], matches[3], matches[2]])
  })

  it('keeps a trailing block with no matches', async () => {
    const out = await unpackCoords(await packCoords(matches.slice(0, 2), 4))
    expect(out).toEqual(matches.slice(0, 2))
  })

  it('round-trips nothing', async () => {
    expect(await unpackCoords(await packCoords([], 2))).toEqual([])
  })

  it('still reads the v1 format, as all one block', async () => {
    // v1: [n, Δx…, Δy…, Δz…] as zigzagged uint32 byte planes, gzipped.
    const words = Uint32Array.from([2, 10, 2, 128, 2, 6, 1])
    const planes = new Uint8Array(words.length * 4)
    for (let b = 0; b < 4; b++)
      for (let i = 0; i < words.length; i++) planes[b * words.length + i] = (words[i] >>> (b * 8)) & 0xff
    const gz = new Uint8Array(
      await new Response(new Blob([planes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
    )
    const packed = new Uint8Array(1 + gz.length)
    packed[0] = 1
    packed.set(gz, 1)
    expect(await unpackCoords(packed)).toEqual([
      { x: 5, y: 64, z: 3, layer: 0 },
      { x: 6, y: 65, z: 2, layer: 0 },
    ])
  })
})
