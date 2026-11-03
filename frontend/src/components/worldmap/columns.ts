import { blockLabel } from '../../lib/blockTypes'
import type { BlockMatch, ColumnBlock, Hovered, MapLayer, Size, View } from './types'
import { projection } from './view'

// How close (in screen px) the pointer has to be to a pin to pick it up.
const HIT_RADIUS = 9

// The column under a screen point: the nearest pin within the hit radius, plus
// every other match standing in the same X/Z — of any block type — and that
// pin's screen position so the tooltip can anchor to the map instead of the
// cursor. Null if nothing is close enough. Linear scan is fine for the match
// counts a single dimension realistically produces, and it backs both hover
// and click-to-copy.
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

  const blocks: ColumnBlock[] = []
  for (const m of matches) {
    if (m.x === best.x && m.z === best.z) blocks.push({ y: m.y, layer: m.layer })
  }
  // Scan order is bottom-up, but a column can span sections, so don't assume.
  blocks.sort((a, b) => a.layer - b.layer || b.y - a.y)
  return { x: best.x, z: best.z, blocks, sx: toSx(best.x), sz: toSz(best.z) }
}

// One `x, z` pair per distinct column, packed flat, in scan order. N and P step
// through these, so a column holding two block types is still one stop.
// Built once per result (and per legend toggle), not per frame.
export function columnPositions(matches: BlockMatch[]): Int32Array {
  const seen = new Set<number>()
  const out = new Int32Array(matches.length * 2)
  let n = 0
  for (const m of matches) {
    const key = columnKey(m.x, m.z)
    if (seen.has(key)) continue
    seen.add(key)
    out[n++] = m.x
    out[n++] = m.z
  }
  return out.subarray(0, n)
}

// What the canvas stamps: per layer, one `x, z` pair per distinct column that
// layer reaches. The map drops Y, so a stack of matches lands on one pixel —
// drawing it once per match is wasted fill. A column with two block types gets
// one pin of each, drawn on top of each other in layer order.
export function layerPins(matches: BlockMatch[], layerCount: number): Int32Array[] {
  const seen = Array.from({ length: layerCount }, () => new Set<number>())
  const runs = Array.from({ length: layerCount }, () => [] as number[])
  for (const m of matches) {
    const key = columnKey(m.x, m.z)
    const layerSeen = seen[m.layer]
    if (!layerSeen || layerSeen.has(key)) continue
    layerSeen.add(key)
    runs[m.layer].push(m.x, m.z)
  }
  return runs.map((run) => Int32Array.from(run))
}

// World coordinates stay within ±2^25, so this key is exact.
const columnKey = (x: number, z: number) => (x + 2 ** 25) * 2 ** 26 + (z + 2 ** 25)

// Whether two hovers would render identically. The anchor is derived from the
// pin's world position, so sliding the pointer around inside one pin's hit
// radius compares equal and the tooltip stays put.
export function sameColumn(a: Hovered | null, b: Hovered | null): boolean {
  if (a == null || b == null) return a === b
  return (
    a.x === b.x &&
    a.z === b.z &&
    a.blocks.length === b.blocks.length &&
    a.sx === b.sx &&
    a.sz === b.sz
  )
}

// The block a click copies: the lowest of the column's first block type, the
// way Minecraft's /tp takes it. Lowest, because for a nether portal the bottom
// block is the one you want to stand in; the top is head height. The first
// type, because that's the one the player put first — when a portal and its
// frame share a column, copying the frame's bottom would put them in the floor.
export function copyTarget(column: Hovered): ColumnBlock {
  const layer = column.blocks[0].layer
  let target = column.blocks[0]
  for (const block of column.blocks) if (block.layer === layer) target = block
  return target
}

export const columnCoords = (column: Hovered) =>
  `${column.x} ${copyTarget(column).y} ${column.z}`

// A column read out in words, for the screen-reader announcements the keyboard
// drives. Heights run low to high, the way a player climbs them; with several
// block types in the scan, each one present is named with its own range.
export function describeColumn(column: Hovered, layers: MapLayer[] = []): string {
  const groups = groupByLayer(column.blocks)
  const parts = groups.map(({ layer, ys }) => {
    const n = ys.length
    const low = ys[n - 1]
    const high = ys[0]
    const y = n === 1 ? `Y ${low}` : `Y ${low} to ${high}`
    const what = `${n} ${n === 1 ? 'block' : 'blocks'}`
    return layers.length > 1 && layers[layer]
      ? `${blockLabel(layers[layer].blockType)} ${y}, ${what}`
      : `${y}, ${what}`
  })
  return `X ${column.x}, Z ${column.z}, ${parts.join('; ')}`
}

// A column's blocks as runs per layer, keeping the column's order.
export function groupByLayer(blocks: ColumnBlock[]): { layer: number; ys: number[] }[] {
  const groups: { layer: number; ys: number[] }[] = []
  for (const { y, layer } of blocks) {
    const last = groups[groups.length - 1]
    if (last?.layer === layer) last.ys.push(y)
    else groups.push({ layer, ys: [y] })
  }
  return groups
}
