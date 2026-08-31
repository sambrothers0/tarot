import type { BlockMatch, Size, View } from './types'

export const MIN_PPB = 1 / 1024
export const MAX_PPB = 8

// We aim for grid lines roughly this far apart (in screen px), then snap the
// spacing to a "nice" number of blocks so labels land on round coordinates.
const GRID_TARGET_PX = 100
const GRID_STEPS = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
]

export const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

export function niceStep(ppb: number): number {
  const blocks = GRID_TARGET_PX / ppb
  for (const step of GRID_STEPS) if (step >= blocks) return step
  return GRID_STEPS[GRID_STEPS.length - 1]
}

// World <-> screen, screen in CSS pixels (the drawing context is DPR-scaled
// separately). Every hit test, grid line and pin goes through these, so the
// canvas and the pointer never disagree about where a block sits.
export type Projection = {
  toSx: (wx: number) => number
  toSz: (wz: number) => number
  toWx: (px: number) => number
  toWz: (py: number) => number
}

export function projection(view: View, { w, h }: Size): Projection {
  return {
    toSx: (wx) => w / 2 + (wx - view.cx) * view.ppb,
    toSz: (wz) => h / 2 + (wz - view.cz) * view.ppb,
    toWx: (px) => view.cx + (px - w / 2) / view.ppb,
    toWz: (py) => view.cz + (py - h / 2) / view.ppb,
  }
}

// The view that frames every match (or the origin when there are none).
export function fitView(matches: BlockMatch[], { w, h }: Size): View {
  if (matches.length === 0) return { cx: 0, cz: 0, ppb: 0.5 }

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const m of matches) {
    if (m.x < minX) minX = m.x
    if (m.x > maxX) maxX = m.x
    if (m.z < minZ) minZ = m.z
    if (m.z > maxZ) maxZ = m.z
  }
  const spanX = Math.max(maxX - minX, 48)
  const spanZ = Math.max(maxZ - minZ, 48)
  const pad = 1.3
  const ppb = clamp(Math.min(w / (spanX * pad), h / (spanZ * pad)), MIN_PPB, MAX_PPB)
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, ppb }
}
