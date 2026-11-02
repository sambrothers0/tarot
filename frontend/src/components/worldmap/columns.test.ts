import { describe, expect, it } from 'vitest'
import { columnAt, columnCoords, describeColumn, sameColumn } from './columns'
import { projection } from './view'

const size = { w: 400, h: 400 }
const view = { cx: 0, cz: 0, ppb: 2 }
const { toSx, toSz } = projection(view, size)

const portal = [
  { x: 10, y: 64, z: 20 },
  { x: 10, y: 66, z: 20 },
  { x: 10, y: 65, z: 20 },
]
const matches = [...portal, { x: 11, y: 70, z: 20 }, { x: -50, y: 3, z: -50 }]

describe('columnAt', () => {
  it('resolves a point on a pin to its whole column, highest first', () => {
    const hit = columnAt(matches, view, size, toSx(10), toSz(20))
    expect(hit).toEqual({ x: 10, z: 20, ys: [66, 65, 64], sx: toSx(10), sz: toSz(20) })
  })

  it('picks the nearest pin when two are within reach', () => {
    // Slightly right of x=11: nearer that pin than x=10.
    const hit = columnAt(matches, view, size, toSx(11) + 1, toSz(20))
    expect(hit?.x).toBe(11)
    expect(hit?.ys).toEqual([70])
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

describe('describeColumn', () => {
  it('reads a single block', () => {
    expect(describeColumn({ x: 3, z: -7, ys: [64], sx: 0, sz: 0 })).toBe('X 3, Z -7, Y 64, 1 block')
  })

  it('reads a stack low to high', () => {
    // `ys` is highest-first, as columnAt builds it.
    expect(describeColumn({ x: 0, z: 0, ys: [70, 69, 68], sx: 0, sz: 0 })).toBe(
      'X 0, Z 0, Y 68 to 70, 3 blocks',
    )
  })
})
