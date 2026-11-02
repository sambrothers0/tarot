import { describe, expect, it } from 'vitest'
import { clamp, fitView, MAX_PPB, MIN_PPB, niceStep, projection } from './view'

const size = { w: 800, h: 600 }

describe('projection', () => {
  it('puts the view centre at the middle of the canvas', () => {
    const p = projection({ cx: 100, cz: -50, ppb: 2 }, size)
    expect(p.toSx(100)).toBe(400)
    expect(p.toSz(-50)).toBe(300)
  })

  it('maps +X right and +Z down at ppb pixels per block', () => {
    const p = projection({ cx: 0, cz: 0, ppb: 4 }, size)
    expect(p.toSx(10)).toBe(440)
    expect(p.toSz(10)).toBe(340)
    expect(p.toSx(-10)).toBe(360)
  })

  it('round-trips world ↔ screen', () => {
    const p = projection({ cx: 1234.5, cz: -987.25, ppb: 0.37 }, size)
    for (const w of [-30_000_000, -1, 0, 0.5, 17, 29_999_984]) {
      expect(p.toWx(p.toSx(w))).toBeCloseTo(w, 6)
      expect(p.toWz(p.toSz(w))).toBeCloseTo(w, 6)
    }
  })
})

describe('fitView', () => {
  it('centres on the origin when there is nothing to show', () => {
    expect(fitView([], size)).toEqual({ cx: 0, cz: 0, ppb: 0.5 })
  })

  it('centres on the bounding box of the matches', () => {
    const v = fitView(
      [
        { x: -100, y: 0, z: 20 },
        { x: 300, y: 64, z: 220 },
      ],
      size,
    )
    expect(v.cx).toBe(100)
    expect(v.cz).toBe(120)
  })

  it('keeps every match on screen with some padding', () => {
    const matches = [
      { x: -5000, y: 0, z: -300 },
      { x: 4000, y: 0, z: 7000 },
      { x: 12, y: 0, z: 12 },
    ]
    const v = fitView(matches, size)
    const p = projection(v, size)
    for (const m of matches) {
      expect(p.toSx(m.x)).toBeGreaterThan(0)
      expect(p.toSx(m.x)).toBeLessThan(size.w)
      expect(p.toSz(m.z)).toBeGreaterThan(0)
      expect(p.toSz(m.z)).toBeLessThan(size.h)
    }
  })

  it('frames at least 48 blocks, so a lone pin is not blown up', () => {
    const small = { w: 100, h: 100 }
    const v = fitView([{ x: 7, y: 0, z: 7 }, { x: 9, y: 0, z: 9 }], small)
    expect(v.ppb).toBeCloseTo(100 / (48 * 1.3))
    // On a big canvas that minimum span would exceed the zoom ceiling.
    expect(fitView([{ x: 7, y: 0, z: 7 }], size).ppb).toBe(MAX_PPB)
  })

  it('clamps the zoom for a world-spanning result', () => {
    const v = fitView(
      [
        { x: -30_000_000, y: 0, z: -30_000_000 },
        { x: 30_000_000, y: 0, z: 30_000_000 },
      ],
      size,
    )
    expect(v.ppb).toBe(MIN_PPB)
  })
})

describe('niceStep', () => {
  it('picks a power-of-two step about 100px apart', () => {
    expect(niceStep(1)).toBe(128)
    expect(niceStep(2)).toBe(64)
    expect(niceStep(100)).toBe(1)
    expect(niceStep(MAX_PPB)).toBe(16)
  })

  it('tops out at the largest step when zoomed far out', () => {
    expect(niceStep(MIN_PPB)).toBe(65536)
    expect(niceStep(1e-9)).toBe(65536)
  })

  it('grid lines are never closer than the target spacing', () => {
    // Below ~2·MIN_PPB the largest step is the cap, so spacing may dip under.
    for (let ppb = MIN_PPB * 2; ppb <= MAX_PPB; ppb *= 1.7) {
      expect(niceStep(ppb) * ppb).toBeGreaterThanOrEqual(100)
    }
  })
})

describe('clamp', () => {
  it('bounds a value', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})
