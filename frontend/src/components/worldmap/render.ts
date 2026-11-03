import { glyph } from './layers'
import type { LayerStyle } from './layers'
import type { Hovered, Size, View } from './types'
import { niceStep, projection } from './view'
import type { Projection } from './view'

// Everything the canvas draws: a chunk-aligned grid with signed axis numbers, a
// pin per column per block type, and a ring around whatever the pointer is
// over. Pure in the sense that matters — it reads its whole world from the
// argument and never touches React state.

// Pins keep a constant screen radius regardless of zoom. A scan of several
// blocks draws them a touch larger, so their shapes stay legible.
const POINT_R = 2.5
const SHAPED_R = 3.25
// The pane's own colour, as the hairline that keeps overlapping pins apart.
const PANE = 'rgba(8, 5, 15, 0.9)'
const LABEL_FONT = '11px "Segoe UI", system-ui, sans-serif'

export type Scene = {
  size: Size
  dpr: number
  view: View
  // Per layer, its distinct columns as flat `x, z` pairs (see `layerPins`).
  // A hidden layer's run is simply empty.
  pins: Int32Array[]
  // How each layer's pins look, by layer index.
  styles: readonly LayerStyle[]
  hovered: Hovered | null
}

export function drawMap(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { size, dpr, view, pins, styles, hovered } = scene
  const { w, h } = size
  const proj = projection(view, size)

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  drawVignette(ctx, size)
  drawGrid(ctx, size, proj, niceStep(view.ppb))
  const shaped = styles.length > 1
  const r = shaped ? SHAPED_R : POINT_R
  // Last layer first, so the first block type — the one the player put first —
  // sits on top where two share a column.
  // With several, each layer goes down in two passes — every pin's hairline
  // of pane, then every pin's glyph — so a dense layer reads as one solid
  // field (its fills cover its own hairlines) while still standing apart
  // from the layer beneath it.
  for (let layer = pins.length - 1; layer >= 0; layer--) {
    const style = styles[layer]
    if (!style) continue
    if (shaped) drawPins(ctx, size, spriteFor(style, r, 'outline', dpr), dpr, proj, pins[layer])
    drawPins(ctx, size, spriteFor(style, r, 'glyph', dpr), dpr, proj, pins[layer])
  }
  if (hovered) drawHoverRing(ctx, proj, hovered, r)
  drawAxisChips(ctx, size)

  ctx.restore()
}

// Subtle vignette so the plane reads as a lit surface, not a flat fill.
function drawVignette(ctx: CanvasRenderingContext2D, { w, h }: Size) {
  const vign = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
  vign.addColorStop(0, 'rgba(76, 50, 128, 0.16)')
  vign.addColorStop(1, 'rgba(6, 4, 13, 0.0)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, w, h)
}

// Vertical lines are constant X and labelled along the top edge; horizontal
// lines are constant Z and labelled down the left. The axes themselves (X=0,
// Z=0) get a brighter stroke.
function drawGrid(ctx: CanvasRenderingContext2D, { w, h }: Size, proj: Projection, step: number) {
  const left = proj.toWx(0)
  const right = proj.toWx(w)
  const top = proj.toWz(0)
  const bottom = proj.toWz(h)

  // Labels are text, so they hold AA contrast (4.5:1) against the pane even
  // where the grid lines themselves stay faint.
  ctx.lineWidth = 1
  ctx.font = LABEL_FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const stroke = (isAxis: boolean) => {
    ctx.strokeStyle = isAxis ? 'rgba(196, 181, 253, 0.5)' : 'rgba(148, 130, 210, 0.1)'
    ctx.fillStyle = isAxis ? 'rgba(216, 199, 255, 0.9)' : 'rgba(196, 181, 253, 0.75)'
  }

  for (let wx = Math.floor(left / step) * step; wx <= right; wx += step) {
    const px = Math.round(proj.toSx(wx)) + 0.5
    stroke(wx === 0)
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
    ctx.stroke()
    ctx.fillText(String(wx), px + 4, 6)
  }

  for (let wz = Math.floor(top / step) * step; wz <= bottom; wz += step) {
    const py = Math.round(proj.toSz(wz)) + 0.5
    stroke(wz === 0)
    ctx.beginPath()
    ctx.moveTo(0, py)
    ctx.lineTo(w, py)
    ctx.stroke()
    ctx.fillText(String(wz), 6, py + 4)
  }
}

// One pin per style, rasterised once per DPR and stamped per column. Filling
// thousands of paths every frame makes the canvas tessellate each one and
// resolve their overlaps; a `drawImage` of a cached bitmap is a blit the GPU
// batches.
const sprites = new Map<string, HTMLCanvasElement>()

function spriteFor(
  style: LayerStyle,
  r: number,
  part: 'glyph' | 'outline',
  dpr: number,
): HTMLCanvasElement {
  const key = `${style.shape}|${style.color}|${r}|${part}|${dpr}`
  const cached = sprites.get(key)
  if (cached) return cached
  // Room for the largest shape (the diamond's points reach 1.25r), its outline,
  // and a device pixel of margin so the anti-aliased edge isn't clipped.
  // Both parts share one size, so they stamp onto the same centre.
  const reach = r * 1.35 + 1.5
  const side = Math.ceil(reach * 2 * dpr) + 2
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const sctx = canvas.getContext('2d')
  if (sctx) {
    const c = side / 2
    const { d, stroke } = glyph(style.shape, c, c, r * dpr)
    const path = new Path2D(d)
    sctx.lineCap = 'round'
    sctx.lineJoin = 'round'
    // The outline part: a hairline of the pane around the glyph, which keeps a
    // pin readable where it sits on another block's pin.
    if (part === 'outline') {
      sctx.strokeStyle = PANE
      sctx.lineWidth = ((stroke ?? 0) + 2) * dpr
      sctx.stroke(path)
      if (!stroke) {
        sctx.fillStyle = PANE
        sctx.fill(path)
      }
    } else if (stroke) {
      sctx.strokeStyle = style.color
      sctx.lineWidth = stroke * dpr
      sctx.stroke(path)
    } else {
      sctx.fillStyle = style.color
      sctx.fill(path)
    }
  }
  sprites.set(key, canvas)
  return canvas
}

function drawPins(
  ctx: CanvasRenderingContext2D,
  { w, h }: Size,
  sprite: HTMLCanvasElement,
  dpr: number,
  proj: Projection,
  pins: Int32Array,
) {
  // The context is DPR-scaled, so the sprite is placed in CSS pixels.
  const side = sprite.width / dpr
  const half = side / 2
  for (let i = 0; i < pins.length; i += 2) {
    const px = proj.toSx(pins[i])
    const py = proj.toSz(pins[i + 1])
    if (px < -half || px > w + half || py < -half || py > h + half) continue
    ctx.drawImage(sprite, px - half, py - half, side, side)
  }
}

function drawHoverRing(ctx: CanvasRenderingContext2D, proj: Projection, hovered: Hovered, r: number) {
  ctx.strokeStyle = 'rgba(233, 224, 255, 0.9)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(proj.toSx(hovered.x), proj.toSz(hovered.z), r + 4.5, 0, Math.PI * 2)
  ctx.stroke()
}

// Axis direction chips, anchored to the corners of the plane.
function drawAxisChips(ctx: CanvasRenderingContext2D, { w, h }: Size) {
  ctx.font = LABEL_FONT
  ctx.fillStyle = 'rgba(196, 181, 253, 0.8)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText('X →', w - 10, 8)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('Z ↓', 10, h - 8)
}
