import type { BlockMatch, Hovered, Size, View } from './types'
import { niceStep, projection } from './view'
import type { Projection } from './view'

// Everything the canvas draws: a chunk-aligned grid with signed axis numbers, a
// white dot per match, and a ring around whatever the pointer is over. Pure in
// the sense that matters — it reads its whole world from the argument and never
// touches React state.

// Pins keep a constant screen radius regardless of zoom.
const POINT_R = 2.5
const LABEL_FONT = '11px "Segoe UI", system-ui, sans-serif'

export type Scene = {
  size: Size
  dpr: number
  view: View
  matches: BlockMatch[]
  hovered: Hovered | null
}

export function drawMap(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { size, dpr, view, matches, hovered } = scene
  const { w, h } = size
  const proj = projection(view, size)

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  drawVignette(ctx, size)
  drawGrid(ctx, size, proj, niceStep(view.ppb))
  drawPins(ctx, size, proj, matches)
  if (hovered) drawHoverRing(ctx, proj, hovered)
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

  ctx.lineWidth = 1
  ctx.font = LABEL_FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const stroke = (isAxis: boolean) => {
    ctx.strokeStyle = isAxis ? 'rgba(196, 181, 253, 0.5)' : 'rgba(148, 130, 210, 0.1)'
    ctx.fillStyle = isAxis ? 'rgba(216, 199, 255, 0.85)' : 'rgba(196, 181, 253, 0.45)'
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

// Every visible match in one path — a hundred thousand separate fills would not
// hold a frame budget.
function drawPins(
  ctx: CanvasRenderingContext2D,
  { w, h }: Size,
  proj: Projection,
  matches: BlockMatch[],
) {
  ctx.fillStyle = 'white'
  ctx.beginPath()
  for (const m of matches) {
    const px = proj.toSx(m.x)
    const py = proj.toSz(m.z)
    if (px < -POINT_R || px > w + POINT_R || py < -POINT_R || py > h + POINT_R) continue
    ctx.moveTo(px + POINT_R, py)
    ctx.arc(px, py, POINT_R, 0, Math.PI * 2)
  }
  ctx.fill()
}

function drawHoverRing(ctx: CanvasRenderingContext2D, proj: Projection, hovered: Hovered) {
  ctx.strokeStyle = 'rgba(233, 224, 255, 0.9)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(proj.toSx(hovered.x), proj.toSz(hovered.z), POINT_R + 4, 0, Math.PI * 2)
  ctx.stroke()
}

// Axis direction chips, anchored to the corners of the plane.
function drawAxisChips(ctx: CanvasRenderingContext2D, { w, h }: Size) {
  ctx.font = LABEL_FONT
  ctx.fillStyle = 'rgba(196, 181, 253, 0.6)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText('X →', w - 10, 8)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('Z ↓', 10, h - 8)
}
