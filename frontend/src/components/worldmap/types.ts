// The map plots block matches on Minecraft's X/Z plane — the same orientation
// Chunk Base uses: +X is east (right), +Z is south (down), so north sits at the
// top. Y (height) is carried only for the hover readout.

export type BlockMatch = {
  x: number
  y: number
  z: number
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
// `ys` is highest-first, so the tooltip reads top-down the way the column stands.
export type Hovered = { x: number; z: number; ys: number[]; sx: number; sz: number }
