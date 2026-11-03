// The map plots block matches on Minecraft's X/Z plane — the same orientation
// Chunk Base uses: +X is east (right), +Z is south (down), so north sits at the
// top. Y (height) is carried only for the hover readout.

export type BlockMatch = {
  x: number
  y: number
  z: number
  // Which of the scan's block types this is: an index into its `MapLayer[]`.
  // Always 0 for a scan of one block.
  layer: number
}

// One block type in a scan, as the map's legend and the result line show it.
// `count` is the world's true total; `truncated` says the map carries only the
// first MAX_MATCHES of them.
export type MapLayer = {
  blockType: string
  count: number
  truncated: boolean
}

export type View = {
  // World coordinate sitting at the centre of the viewport, plus the current
  // scale in screen-pixels-per-block.
  cx: number
  cz: number
  ppb: number
}

// The canvas' CSS-pixel size. The backing store is this times the DPR.
export type Size = { w: number; h: number }

// A hovered pin resolves to the whole column of matches sharing its X/Z. The
// map drops Y when plotting, so a nether portal's stacked blocks all land on one
// pixel and the tooltip is the only place their separate heights are legible.
// `blocks` is grouped by layer (first layer first), each group highest-first,
// so the tooltip reads top-down the way the column stands. A column can hold
// several of the scan's block types at once — a portal and its obsidian frame
// share every column the portal stands in.
export type ColumnBlock = { y: number; layer: number }
export type Hovered = { x: number; z: number; blocks: ColumnBlock[]; sx: number; sz: number }
