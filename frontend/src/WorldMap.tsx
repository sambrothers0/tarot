import { useCallback, useEffect, useRef, useState } from 'react'

export type BlockMatch = {
  x: number
  y: number
  z: number
}

// The map plots block matches on Minecraft's X/Z plane — the same orientation
// Chunk Base uses: +X is east (right), +Z is south (down), so north sits at the
// top. Y (height) is carried only for the hover readout. The whole thing is one
// canvas: a chunk-aligned grid with signed axis numbers and a white dot per
// match, pannable by drag and zoomable by wheel.

type View = {
  // World coordinate sitting at the centre of the viewport, plus the current
  // scale in screen-pixels-per-block.
  cx: number
  cz: number
  ppb: number
}

// A hovered pin resolves to the whole column of matches sharing its X/Z. The
// map drops Y when plotting, so a nether portal's stacked blocks all land on one
// pixel and the tooltip is the only place their separate heights are legible.
// `ys` is highest-first, so the tooltip reads top-down the way the column stands.
type Hovered = { x: number; z: number; ys: number[]; sx: number; sz: number }

const MIN_PPB = 1 / 1024
const MAX_PPB = 8
// We aim for grid lines roughly this far apart (in screen px), then snap the
// spacing to a "nice" number of blocks so labels land on round coordinates.
const GRID_TARGET_PX = 100
const GRID_STEPS = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
]

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

function niceStep(ppb: number): number {
  const blocks = GRID_TARGET_PX / ppb
  for (const step of GRID_STEPS) if (step >= blocks) return step
  return GRID_STEPS[GRID_STEPS.length - 1]
}

// A dense block type (stone, deepslate) can put hundreds of matches in a single
// column, which would make an unreadable tooltip. Long stacks collapse in the
// middle: the ends are what matter, and the lowest block is what a click copies.
const STACK_HEAD = 4
const STACK_TAIL = 4
const STACK_MAX = STACK_HEAD + STACK_TAIL + 1

// The rows to render for a column, `null` standing in for the elided middle.
function stackRows(ys: number[]): (number | null)[] {
  if (ys.length <= STACK_MAX) return ys
  return [...ys.slice(0, STACK_HEAD), null, ...ys.slice(ys.length - STACK_TAIL)]
}


// Async clipboard first; the hidden-textarea route is the fallback for the
// contexts where it is unavailable or blocked. Resolves to whether it stuck.
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const scratch = document.createElement('textarea')
      scratch.value = text
      scratch.setAttribute('readonly', '')
      scratch.style.position = 'fixed'
      scratch.style.top = '-1000px'
      scratch.style.opacity = '0'
      document.body.appendChild(scratch)
      scratch.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(scratch)
      return ok
    } catch {
      return false
    }
  }
}

type Props = {
  matches: BlockMatch[]
}

export function WorldMap({ matches }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const viewRef = useRef<View>({ cx: 0, cz: 0, ppb: 0.5 })
  const sizeRef = useRef({ w: 0, h: 0 })
  const dprRef = useRef(1)
  const matchesRef = useRef<BlockMatch[]>(matches)
  const didFitRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<{
    pointerId: number
    lastX: number
    lastY: number
    lastT: number
    // Total screen distance travelled since pointerdown. A press that never
    // really moves is a click on a pin, not a pan.
    moved: number
  } | null>(null)
  // Recent pan velocity (screen px / ms) for the release-glide, and the handle
  // to the inertia animation that decays it.
  const panVelRef = useRef({ vx: 0, vz: 0 })
  const inertiaRef = useRef<number | null>(null)
  // Hover lives in a ref so the imperative draw can read it without making the
  // draw callback depend on React state (which would churn the effects below).
  // The mirrored state only exists to render the HTML tooltip.
  const hoveredRef = useRef<Hovered | null>(null)

  // Transient "copied" confirmation, cleared by a timer we own so it can be
  // cancelled on unmount (and restarted when pins are clicked back to back).
  const copyTimerRef = useRef<number | null>(null)

  const [hovered, setHovered] = useState<Hovered | null>(null)
  const [readout, setReadout] = useState<{ x: number; z: number } | null>(null)
  const [zoomPct, setZoomPct] = useState(50)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)

  // The column under a screen point: the nearest pin within the hit radius, plus
  // every other match standing in the same X/Z, and that pin's screen position
  // so the tooltip can anchor to the map instead of the cursor. Null if nothing
  // is close enough. Linear scan is fine for the match counts a single dimension
  // realistically produces, and it backs both hover and click-to-copy.
  const columnAt = useCallback((px: number, py: number): Hovered | null => {
    const view = viewRef.current
    const { w, h } = sizeRef.current
    const wx = view.cx + (px - w / 2) / view.ppb
    const wz = view.cz + (py - h / 2) / view.ppb
    const hitR = 9
    let best: BlockMatch | null = null
    let bestD = hitR * hitR
    for (const m of matchesRef.current) {
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
    for (const m of matchesRef.current) {
      if (m.x === best.x && m.z === best.z) ys.push(m.y)
    }
    // Scan order is bottom-up, but a column can span sections, so don't assume.
    ys.sort((a, b) => b - a)
    return {
      x: best.x,
      z: best.z,
      ys,
      sx: w / 2 + (best.x - view.cx) * view.ppb,
      sz: h / 2 + (best.z - view.cz) * view.ppb,
    }
  }, [])

  // Copy the *lowest* block of the column as `x y z` — the form Minecraft's /tp
  // takes, so the clipboard can go straight into the game. Lowest, because for a
  // nether portal the bottom block is the one you want to stand in; the top is
  // head height. The confirmation toast is set from the promise callback, never
  // an effect body.
  const copyColumn = useCallback((column: Hovered) => {
    const text = `${column.x} ${column.ys[column.ys.length - 1]} ${column.z}`
    void writeClipboard(text).then((ok) => {
      if (copyTimerRef.current != null) clearTimeout(copyTimerRef.current)
      setToast(ok ? { text: `Copied ${text}`, ok: true } : { text: "Couldn't copy", ok: false })
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setToast(null)
      }, 1800)
    })
  }, [])

  // Frame the view on the current matches (or the origin when there are none).
  // Mutates the view ref and reflects the zoom into state; only ever invoked
  // from event/rAF callbacks, never synchronously inside an effect body.
  const fit = useCallback(() => {
    const { w, h } = sizeRef.current
    if (!w || !h) return
    const ms = matchesRef.current
    didFitRef.current = true
    if (ms.length === 0) {
      viewRef.current = { cx: 0, cz: 0, ppb: 0.5 }
      setZoomPct(50)
      return
    }
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const m of ms) {
      if (m.x < minX) minX = m.x
      if (m.x > maxX) maxX = m.x
      if (m.z < minZ) minZ = m.z
      if (m.z > maxZ) maxZ = m.z
    }
    const spanX = Math.max(maxX - minX, 48)
    const spanZ = Math.max(maxZ - minZ, 48)
    const pad = 1.3
    const ppb = clamp(Math.min(w / (spanX * pad), h / (spanZ * pad)), MIN_PPB, MAX_PPB)
    viewRef.current = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, ppb }
    setZoomPct(Math.round(ppb * 100))
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = sizeRef.current
    if (!w || !h) return
    // Auto-fit on the first frame after the matches change. Done here (inside an
    // rAF/observer callback) rather than in an effect so its setState is allowed.
    if (!didFitRef.current) fit()

    const dpr = dprRef.current
    const view = viewRef.current

    // World <-> screen helpers (screen in CSS pixels; ctx is dpr-scaled below).
    const toSx = (wx: number) => w / 2 + (wx - view.cx) * view.ppb
    const toSz = (wz: number) => h / 2 + (wz - view.cz) * view.ppb
    const toWx = (px: number) => view.cx + (px - w / 2) / view.ppb
    const toWz = (py: number) => view.cz + (py - h / 2) / view.ppb

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    // Subtle vignette so the plane reads as a lit surface, not a flat fill.
    const vign = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
    vign.addColorStop(0, 'rgba(76, 50, 128, 0.16)')
    vign.addColorStop(1, 'rgba(6, 4, 13, 0.0)')
    ctx.fillStyle = vign
    ctx.fillRect(0, 0, w, h)

    const step = niceStep(view.ppb)
    const left = toWx(0)
    const right = toWx(w)
    const top = toWz(0)
    const bottom = toWz(h)

    ctx.lineWidth = 1
    ctx.font = '11px "Segoe UI", system-ui, sans-serif'

    // Vertical grid lines — constant X. Labelled along the top edge.
    const firstX = Math.floor(left / step) * step
    for (let wx = firstX; wx <= right; wx += step) {
      const px = Math.round(toSx(wx)) + 0.5
      const isAxis = wx === 0
      ctx.strokeStyle = isAxis ? 'rgba(196, 181, 253, 0.5)' : 'rgba(148, 130, 210, 0.1)'
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
      ctx.stroke()
      ctx.fillStyle = isAxis ? 'rgba(216, 199, 255, 0.85)' : 'rgba(196, 181, 253, 0.45)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(String(wx), px + 4, 6)
    }

    // Horizontal grid lines — constant Z. Labelled along the left edge.
    const firstZ = Math.floor(top / step) * step
    for (let wz = firstZ; wz <= bottom; wz += step) {
      const py = Math.round(toSz(wz)) + 0.5
      const isAxis = wz === 0
      ctx.strokeStyle = isAxis ? 'rgba(196, 181, 253, 0.5)' : 'rgba(148, 130, 210, 0.1)'
      ctx.beginPath()
      ctx.moveTo(0, py)
      ctx.lineTo(w, py)
      ctx.stroke()
      ctx.fillStyle = isAxis ? 'rgba(216, 199, 255, 0.85)' : 'rgba(196, 181, 253, 0.45)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(String(wz), 6, py + 4)
    }

    // Pins — constant 2.5 px radius regardless of zoom, all batched in one path.
    const POINT_R = 2.5
    const ms = matchesRef.current
    ctx.fillStyle = 'white'
    ctx.beginPath()
    for (const m of ms) {
      const px = toSx(m.x)
      const py = toSz(m.z)
      if (px < -POINT_R || px > w + POINT_R || py < -POINT_R || py > h + POINT_R) continue
      ctx.moveTo(px + POINT_R, py)
      ctx.arc(px, py, POINT_R, 0, Math.PI * 2)
    }
    ctx.fill()

    // Highlight the hovered pin with a ring.
    const hov = hoveredRef.current
    if (hov) {
      ctx.strokeStyle = 'rgba(233, 224, 255, 0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(toSx(hov.x), toSz(hov.z), POINT_R + 4, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Axis direction chips, anchored to the corners of the plane.
    ctx.fillStyle = 'rgba(196, 181, 253, 0.6)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('X →', w - 10, 8)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText('Z ↓', 10, h - 8)

    ctx.restore()
  }, [fit])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      draw()
    })
  }, [draw])

  // Commit a hover, skipping the state update when nothing about it moved. The
  // anchor is derived from the pin's world position, so sliding the pointer
  // around inside one pin's hit radius is a no-op and the tooltip stays put.
  const applyHover = useCallback(
    (next: Hovered | null) => {
      const prev = hoveredRef.current
      const same =
        next == null
          ? prev == null
          : prev != null &&
            next.x === prev.x &&
            next.z === prev.z &&
            next.ys.length === prev.ys.length &&
            next.sx === prev.sx &&
            next.sz === prev.sz
      hoveredRef.current = next
      if (!same) {
        setHovered(next)
        scheduleDraw()
      }
    },
    [scheduleDraw],
  )

  const stopInertia = useCallback(() => {
    if (inertiaRef.current != null) {
      cancelAnimationFrame(inertiaRef.current)
      inertiaRef.current = null
    }
    panVelRef.current.vx = 0
    panVelRef.current.vz = 0
  }, [])

  // After a drag releases, keep panning in the same direction and ease to a
  // stop — the momentum-scroll feel you get from flicking a touch surface.
  const startInertia = useCallback(() => {
    const speed = Math.hypot(panVelRef.current.vx, panVelRef.current.vz)
    if (speed < 0.02) return // a near-still release shouldn't drift
    let last = performance.now()
    const FRICTION = 0.004 // per-ms exponential decay; higher = stops sooner
    const step = () => {
      const now = performance.now()
      const dt = now - last
      last = now
      const v = panVelRef.current
      const view = viewRef.current
      view.cx -= (v.vx * dt) / view.ppb
      view.cz -= (v.vz * dt) / view.ppb
      const decay = Math.exp(-FRICTION * dt)
      v.vx *= decay
      v.vz *= decay
      draw()
      if (Math.hypot(v.vx, v.vz) < 0.01) {
        inertiaRef.current = null
        return
      }
      inertiaRef.current = requestAnimationFrame(step)
    }
    inertiaRef.current = requestAnimationFrame(step)
  }, [draw])

  // Size the canvas to its container and keep the backing store DPR-crisp.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      sizeRef.current = { w: rect.width, h: rect.height }
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
      draw()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [draw])

  // Re-fit whenever a fresh set of matches arrives. Effect body only touches
  // refs and schedules a frame — the fit (and its setState) runs inside draw.
  useEffect(() => {
    matchesRef.current = matches
    hoveredRef.current = null
    didFitRef.current = false
    scheduleDraw()
  }, [matches, scheduleDraw])

  // Cancel any in-flight animation frames when the map unmounts. We MUST null
  // the refs after cancelling: under StrictMode the component mounts, unmounts,
  // then remounts, and a stale non-null rafRef would make scheduleDraw's
  // `if (rafRef.current != null) return` guard wedge forever — no interactive
  // repaint (zoom, pan-during-drag) would ever fire again.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (inertiaRef.current != null) {
        cancelAnimationFrame(inertiaRef.current)
        inertiaRef.current = null
      }
      if (copyTimerRef.current != null) {
        clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
    }
  }, [])

  // Zoom toward the cursor. Registered natively so we can preventDefault the
  // page scroll (React's onWheel is passive and can't).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      stopInertia()
      const rect = canvas.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const view = viewRef.current
      const { w, h } = sizeRef.current
      const beforeX = view.cx + (px - w / 2) / view.ppb
      const beforeZ = view.cz + (py - h / 2) / view.ppb
      // Normalise line-mode wheels (≈1 per notch) to pixel-mode (≈100) so the
      // step feels the same across devices.
      const delta = event.deltaMode === 1 ? event.deltaY * 100 : event.deltaY
      // A trackpad pinch arrives as ctrl+wheel with much smaller per-event deltas
      // than a mouse notch (but many events per gesture). Give it a higher gain
      // so a pinch zooms at about the same rate as the wheel; both sit between the
      // original speed and the faster pass — quicker than first, gentler than peak.
      const gain = event.ctrlKey ? 0.017 : 0.00425
      const factor = Math.exp(-delta * gain)
      const ppb = clamp(view.ppb * factor, MIN_PPB, MAX_PPB)
      // Keep the world point under the cursor pinned in place.
      view.cx = beforeX - (px - w / 2) / ppb
      view.cz = beforeZ - (py - h / 2) / ppb
      view.ppb = ppb
      setZoomPct(Math.round(ppb * 100))
      // The tooltip anchors to the pin, not the cursor, so a zoom drags it out
      // of place. Only refresh one that is already open — zooming shouldn't
      // conjure a tooltip under a stationary pointer.
      if (hoveredRef.current) applyHover(columnAt(px, py))
      scheduleDraw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [applyHover, columnAt, scheduleDraw, stopInertia])

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    stopInertia() // grabbing again catches any ongoing glide
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: 0,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const view = viewRef.current
    const { w, h } = sizeRef.current

    const drag = dragRef.current
    if (drag) {
      const dxs = event.clientX - drag.lastX
      const dys = event.clientY - drag.lastY
      view.cx -= dxs / view.ppb
      view.cz -= dys / view.ppb
      // Track a smoothed pointer velocity (screen px/ms) to seed the glide.
      const now = performance.now()
      const dt = now - drag.lastT
      if (dt > 0) {
        const vel = panVelRef.current
        vel.vx = vel.vx * 0.6 + (dxs / dt) * 0.4
        vel.vz = vel.vz * 0.6 + (dys / dt) * 0.4
      }
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      drag.lastT = now
      drag.moved += Math.hypot(dxs, dys)
      applyHover(null)
      setReadout({ x: Math.round(view.cx + (px - w / 2) / view.ppb), z: Math.round(view.cz + (py - h / 2) / view.ppb) })
      scheduleDraw()
      return
    }

    const wx = view.cx + (px - w / 2) / view.ppb
    const wz = view.cz + (py - h / 2) / view.ppb
    setReadout({ x: Math.round(wx), z: Math.round(wz) })

    // Nearest pin within a small screen radius gets a tooltip.
    applyHover(columnAt(px, py))
  }

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      // A press that barely moved is a click: if it landed on a pin, copy it.
      // Hit-tested fresh from the release point so touch works too — there is
      // no hover state to lean on there.
      if (drag.moved < 5 && event.type === 'pointerup') {
        const rect = event.currentTarget.getBoundingClientRect()
        const column = columnAt(event.clientX - rect.left, event.clientY - rect.top)
        if (column) copyColumn(column)
      }
      // If the pointer was paused at the moment of release, don't fling — the
      // stale velocity from earlier in the drag isn't what the user meant.
      if (performance.now() - drag.lastT > 60) {
        panVelRef.current.vx = 0
        panVelRef.current.vz = 0
      }
      dragRef.current = null
      startInertia()
    }
  }

  const onPointerLeave = () => {
    setReadout(null)
    applyHover(null)
  }

  // Tooltip layout, derived from the hovered column. A tall stack hanging above
  // a pin near the top edge would be cut off by the container's overflow-hidden,
  // so in that case the tooltip flips to below the pin.
  const hoveredRows = hovered ? stackRows(hovered.ys) : []
  const tooltipBelow = hovered != null && hovered.sz < hoveredRows.length * 19 + 44

  return (
    <div ref={containerRef} className="relative aspect-square w-full select-none overflow-hidden rounded-2xl">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none active:cursor-grabbing ${
          hovered ? 'cursor-pointer' : 'cursor-grab'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
      />

      {/* Cursor coordinate readout */}
      {readout ? (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-violet-300/15 bg-slate-950/70 px-2.5 py-1 font-mono text-xs tabular-nums text-violet-100 backdrop-blur-sm">
          X {readout.x} · Z {readout.z}
        </div>
      ) : null}

      {/* Zoom + fit controls — kept top-left so they don't cover the "X →" axis
          chip the canvas draws in the top-right corner. */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span className="pointer-events-none rounded-lg border border-violet-300/15 bg-slate-950/70 px-2 py-1 font-mono text-[11px] tabular-nums text-violet-200/80 backdrop-blur-sm">
          {zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => {
            fit()
            scheduleDraw()
          }}
          className="rounded-lg border border-violet-300/20 bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium text-violet-100 backdrop-blur-sm transition hover:bg-violet-500/20"
        >
          Fit
        </button>
      </div>

      {/* Hovered-pin tooltip. Anchored to the pin's own screen position rather
          than the cursor, and listing every block in the column: X and Z repeat
          down the stack so only Y changes, the way the blocks actually sit. */}
      {hovered ? (
        <div
          className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-violet-300/20 bg-slate-950/85 px-2.5 py-1.5 font-mono text-xs leading-snug tabular-nums text-violet-50 shadow-lg shadow-black/40 backdrop-blur ${
            tooltipBelow ? '' : '-translate-y-full'
          }`}
          style={{ left: hovered.sx, top: tooltipBelow ? hovered.sz + 12 : hovered.sz - 10 }}
        >
          {hoveredRows.map((y, i) =>
            y == null ? (
              <div key="elided" className="text-center text-[10px] text-violet-300/60">
                ⋯ {hovered.ys.length - STACK_HEAD - STACK_TAIL} more ⋯
              </div>
            ) : (
              <div key={`${y}-${i}`} className="whitespace-nowrap">
                X: {hovered.x}, Y: {y}, Z: {hovered.z}
              </div>
            ),
          )}
          <span className="mt-1 block font-sans text-[10px] font-medium tracking-wide text-violet-300/70">
            {hovered.ys.length > 1 ? 'click to copy the lowest' : 'click to copy'}
          </span>
        </div>
      ) : null}

      {/* Copy confirmation. Anchored to the map rather than the cursor so it
          survives the pointer moving off the pin right after the click. */}
      {toast ? (
        <div
          className={`pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border px-3 py-1.5 font-mono text-xs tabular-nums shadow-lg shadow-black/40 backdrop-blur ${
            toast.ok
              ? 'border-violet-300/25 bg-slate-950/85 text-violet-50'
              : 'border-rose-400/30 bg-rose-950/80 text-rose-100'
          }`}
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  )
}
