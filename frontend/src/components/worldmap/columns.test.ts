import { describe, expect, it } from 'vitest'
import {
  columnAt,
  columnCoords,
  columnPositions,
  copyTarget,
  describeColumn,
  layerPins,
  sameColumn,
} from './columns'
import type { BlockMatch } from './types'
import { projection } from './view'

const size = { w: 400, h: 400 }
const view = { cx: 0, cz: 0, ppb: 2 }
const { toSx, toSz } = projection(view, size)

const at = (x: number, y: number, z: number, layer = 0): BlockMatch => ({ x, y, z, layer })
const portal = [at(10, 64, 20), at(10, 66, 20), at(10, 65, 20)]
const matches = [...portal, at(11, 70, 20), at(-50, 3, -50)]

describe('columnAt', () => {
  it('resolves a point on a pin to its whole column, highest first', () => {
    const hit = columnAt(matches, view, size, toSx(10), toSz(20))
    expect(hit).toEqual({
      x: 10,
      z: 20,
      blocks: [
        { y: 66, layer: 0 },
        { y: 65, layer: 0 },
        { y: 64, layer: 0 },
      ],
      sx: toSx(10),
      sz: toSz(20),
    })
  })

  it('picks the nearest pin when two are within reach', () => {
    // Slightly right of x=11: nearer that pin than x=10.
    const hit = columnAt(matches, view, size, toSx(11) + 1, toSz(20))
    expect(hit?.x).toBe(11)
    expect(hit?.blocks).toEqual([{ y: 70, layer: 0 }])
  })

  it('anchors to the pin, not the pointer', () => {
    const hit = columnAt(matches, view, size, toSx(-50) + 3, toSz(-50) - 4)
    expect(hit).toMatchObject({ x: -50, z: -50, sx: toSx(-50), sz: toSz(-50) })
  })

  it('misses beyond the hit radius', () => {
    expect(columnAt(matches, view, size, toSx(-50) + 10, toSz(-50))).toBeNull()
    expect(columnAt([], view, size, 200, 200)).toBeNull()
  })

  it('measures the radius in screen pixels at any zoom', () => {
    const far = { cx: 0, cz: 0, ppb: 1 / 512 }
    const p = projection(far, size)
    // 8px off at 1/512 px per block is ~4000 blocks away, still a hit.
    expect(columnAt(matches, far, size, p.toSx(-50) + 8, p.toSz(-50))).not.toBeNull()
  })

  it('groups a column of several blocks by block, first block first', () => {
    const framed = [at(0, 63, 0, 1), at(0, 64, 0, 0), at(0, 65, 0, 0), at(0, 67, 0, 1)]
    const hit = columnAt(framed, view, size, toSx(0), toSz(0))!
    expect(hit.blocks).toEqual([
      { y: 65, layer: 0 },
      { y: 64, layer: 0 },
      { y: 67, layer: 1 },
      { y: 63, layer: 1 },
    ])
    // The click takes the portal's floor, not the frame's.
    expect(copyTarget(hit)).toEqual({ y: 64, layer: 0 })
    expect(columnCoords(hit)).toBe('0 64 0')
  })
})

describe('sameColumn', () => {
  const a = columnAt(matches, view, size, toSx(10), toSz(20))
  const nudged = columnAt(matches, view, size, toSx(10) - 1, toSz(20) + 1)
  const other = columnAt(matches, view, size, toSx(-50), toSz(-50))

  it('treats pointer jitter within one pin as the same hover', () => {
    expect(sameColumn(a, nudged)).toBe(true)
  })

  it('distinguishes different columns and null', () => {
    expect(sameColumn(a, other)).toBe(false)
    expect(sameColumn(a, null)).toBe(false)
    expect(sameColumn(null, a)).toBe(false)
    expect(sameColumn(null, null)).toBe(true)
  })
})

describe('columnCoords', () => {
  it('formats the lowest block for /tp', () => {
    const hit = columnAt(matches, view, size, toSx(10), toSz(20))!
    expect(columnCoords(hit)).toBe('10 64 20')
  })
})

describe('pins', () => {
  const mixed = [at(0, 1, 0, 0), at(0, 2, 0, 1), at(0, 3, 0, 1), at(5, 1, 5, 1)]

  it('gives each column one stop for N/P, whatever it holds', () => {
    expect([...columnPositions(mixed)]).toEqual([0, 0, 5, 5])
  })

  it('gives each layer its own pin per column it reaches', () => {
    expect(layerPins(mixed, 3).map((run) => [...run])).toEqual([[0, 0], [0, 0, 5, 5], []])
  })
})

describe('describeColumn', () => {
  const column = (blocks: { y: number; layer: number }[]) => ({ x: 3, z: -7, blocks, sx: 0, sz: 0 })

  it('reads a single block', () => {
    expect(describeColumn(column([{ y: 64, layer: 0 }]))).toBe('X 3, Z -7, Y 64, 1 block')
  })

  it('reads a stack low to high', () => {
    // Highest-first, as columnAt builds it.
    const ys = [70, 69, 68].map((y) => ({ y, layer: 0 }))
    expect(describeColumn(column(ys))).toBe('X 3, Z -7, Y 68 to 70, 3 blocks')
  })

  it('names each block when the scan holds several', () => {
    const layers = [
      { blockType: 'minecraft:nether_portal', count: 2, truncated: false },
      { blockType: 'minecraft:obsidian', count: 1, truncated: false },
    ]
    const blocks = [
      { y: 65, layer: 0 },
      { y: 64, layer: 0 },
      { y: 63, layer: 1 },
    ]
    expect(describeColumn(column(blocks), layers)).toBe(
      'X 3, Z -7, Nether Portal Y 64 to 65, 2 blocks; Obsidian Y 63, 1 block',
    )
  })
})
