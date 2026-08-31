import type { BlockMatch, Hovered, Size, View } from './types'
import { projection } from './view'

// How close (in screen px) the pointer has to be to a pin to pick it up.
const HIT_RADIUS = 9

// The column under a screen point: the nearest pin within the hit radius, plus
// every other match standing in the same X/Z, and that pin's screen position so
// the tooltip can anchor to the map instead of the cursor. Null if nothing is
// close enough. Linear scan is fine for the match counts a single dimension
// realistically produces, and it backs both hover and click-to-copy.
export function columnAt(
  matches: BlockMatch[],
  view: View,
  size: Size,
  px: number,
  py: number,
): Hovered | null {
  const { toSx, toSz, toWx, toWz } = projection(view, size)
  const wx = toWx(px)
  const wz = toWz(py)
  let best: BlockMatch | null = null
  let bestD = HIT_RADIUS * HIT_RADIUS
  for (const m of matches) {
    const dx = (wx - m.x) * view.ppb
    const dz = (wz - m.z) * view.ppb
    const d = dx * dx + dz * dz
    if (d <= bestD) {
      bestD = d
      best = m
    }
  }
  if (!best) return null

  const ys: number[] = []
  for (const m of matches) {
    if (m.x === best.x && m.z === best.z) ys.push(m.y)
  }
  // Scan order is bottom-up, but a column can span sections, so don't assume.
  ys.sort((a, b) => b - a)
  return { x: best.x, z: best.z, ys, sx: toSx(best.x), sz: toSz(best.z) }
}

// Whether two hovers would render identically. The anchor is derived from the
// pin's world position, so sliding the pointer around inside one pin's hit
// radius compares equal and the tooltip stays put.
export function sameColumn(a: Hovered | null, b: Hovered | null): boolean {
  if (a == null || b == null) return a === b
  return a.x === b.x && a.z === b.z && a.ys.length === b.ys.length && a.sx === b.sx && a.sz === b.sz
}

// The lowest block of a column, formatted the way Minecraft's /tp takes it.
// Lowest, because for a nether portal the bottom block is the one you want to
// stand in; the top is head height.
export const columnCoords = (column: Hovered) =>
  `${column.x} ${column.ys[column.ys.length - 1]} ${column.z}`
