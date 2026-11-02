import { useCallback, useEffect, useRef, useState } from 'react'
import { columnAt, columnPositions, sameColumn } from './columns'
import { CoordinateReadout, CopyToast, ZoomControls } from './MapHud'
import { MapTooltip } from './MapTooltip'
import { drawMap } from './render'
import type { BlockMatch, Hovered, View } from './types'
import { useCopyToast } from './useCopyToast'
import { useInertia } from './useInertia'
import { clamp, fitView, MAX_PPB, MIN_PPB, projection } from './view'

export type { BlockMatch } from './types'

// The map is one canvas: everything visible is drawn imperatively from refs, and
// React only renders the HTML chrome floating on top of it. Live view and hover
// state stay in refs precisely so `draw` never has to depend on the React state
// that changes most often.

// A press that travels less than this (screen px) is a click on a pin, not a pan.
const CLICK_SLOP = 5
// A pointer paused this long before release shouldn't fling — the stale velocity
// from earlier in the drag isn't what the user meant.
const STALE_RELEASE_MS = 60

type Drag = {
  pointerId: number
  lastX: number
  lastY: number
  lastT: number
  // Total screen distance travelled since pointerdown.
  moved: number
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
  // What the canvas actually plots, derived once per result in the effect below.
  const pinsRef = useRef<Int32Array>(new Int32Array(0))
  const didFitRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<Drag | null>(null)
  // Hover lives in a ref so the imperative draw can read it without making the
  // draw callback depend on React state. The mirrored state only exists to
  // render the HTML tooltip.
  const hoveredRef = useRef<Hovered | null>(null)

  const [hovered, setHovered] = useState<Hovered | null>(null)
  const [readout, setReadout] = useState<{ x: number; z: number } | null>(null)
  const [zoomPct, setZoomPct] = useState(50)

  const { toast, copyColumn } = useCopyToast()

  // The column under a point on the canvas, in the live view.
  const columnHere = useCallback(
    (px: number, py: number) =>
      columnAt(matchesRef.current, viewRef.current, sizeRef.current, px, py),
    [],
  )

  // Frame the view on the current matches. Mutates the view ref and reflects the
  // zoom into state; only ever invoked from event/rAF callbacks, never
  // synchronously inside an effect body.
  const fit = useCallback(() => {
    const size = sizeRef.current
    if (!size.w || !size.h) return
    didFitRef.current = true
    const view = fitView(matchesRef.current, size)
    viewRef.current = view
    setZoomPct(Math.round(view.ppb * 100))
  }, [])

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d')
    const size = sizeRef.current
    if (!ctx || !size.w || !size.h) return
    // Auto-fit on the first frame after the matches change. Done here (inside an
    // rAF/observer callback) rather than in an effect so its setState is allowed.
    if (!didFitRef.current) fit()
    drawMap(ctx, {
      size,
      dpr: dprRef.current,
      view: viewRef.current,
      pins: pinsRef.current,
      hovered: hoveredRef.current,
    })
  }, [fit])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      draw()
    })
  }, [draw])

  const { velRef, stopInertia, startInertia } = useInertia(viewRef, draw)

  // Commit a hover, skipping the state update when nothing about it moved.
  const applyHover = useCallback(
    (next: Hovered | null) => {
      const changed = !sameColumn(hoveredRef.current, next)
      hoveredRef.current = next
      if (changed) {
        setHovered(next)
        scheduleDraw()
      }
    },
    [scheduleDraw],
  )

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
    pinsRef.current = columnPositions(matches)
    hoveredRef.current = null
    didFitRef.current = false
    scheduleDraw()
  }, [matches, scheduleDraw])

  // Cancel any in-flight frame when the map unmounts. We MUST null the ref after
  // cancelling: under StrictMode the component mounts, unmounts, then remounts,
  // and a stale non-null rafRef would make scheduleDraw's
  // `if (rafRef.current != null) return` guard wedge forever — no interactive
  // repaint (zoom, pan-during-drag) would ever fire again.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
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
      const size = sizeRef.current
      const before = projection(view, size)
      const beforeX = before.toWx(px)
      const beforeZ = before.toWz(py)
      // Normalise line-mode wheels (~1 per notch) to pixel-mode (~100) so the
      // step feels the same across devices.
      const delta = event.deltaMode === 1 ? event.deltaY * 100 : event.deltaY
      // A trackpad pinch arrives as ctrl+wheel with much smaller per-event deltas
      // than a mouse notch (but many events per gesture). Give it a higher gain
      // so a pinch zooms at about the same rate as the wheel; both sit between the
      // original speed and the faster pass — quicker than first, gentler than peak.
      const gain = event.ctrlKey ? 0.017 : 0.00425
      const ppb = clamp(view.ppb * Math.exp(-delta * gain), MIN_PPB, MAX_PPB)
      // Keep the world point under the cursor pinned in place.
      view.cx = beforeX - (px - size.w / 2) / ppb
      view.cz = beforeZ - (py - size.h / 2) / ppb
      view.ppb = ppb
      setZoomPct(Math.round(ppb * 100))
      // The tooltip anchors to the pin, not the cursor, so a zoom drags it out
      // of place. Only refresh one that is already open — zooming shouldn't
      // conjure a tooltip under a stationary pointer.
      if (hoveredRef.current) applyHover(columnHere(px, py))
      scheduleDraw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [applyHover, columnHere, scheduleDraw, stopInertia])

  // Pointer position relative to the canvas, in CSS pixels.
  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { px: event.clientX - rect.left, py: event.clientY - rect.top }
  }

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
    const { px, py } = localPoint(event)
    const view = viewRef.current
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
        const vel = velRef.current
        vel.vx = vel.vx * 0.6 + (dxs / dt) * 0.4
        vel.vz = vel.vz * 0.6 + (dys / dt) * 0.4
      }
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      drag.lastT = now
      drag.moved += Math.hypot(dxs, dys)
      applyHover(null)
      scheduleDraw()
    } else {
      // Nearest pin within a small screen radius gets a tooltip.
      applyHover(columnHere(px, py))
    }

    // A drag keeps the world point under the pointer pinned, so most moves land
    // on the same block — keep the old object then, and React skips the render.
    const { toWx, toWz } = projection(view, sizeRef.current)
    const x = Math.round(toWx(px))
    const z = Math.round(toWz(py))
    setReadout((prev) => (prev?.x === x && prev.z === z ? prev : { x, z }))
  }

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    // A press that barely moved is a click: if it landed on a pin, copy it.
    // Hit-tested fresh from the release point so touch works too — there is no
    // hover state to lean on there.
    if (drag.moved < CLICK_SLOP && event.type === 'pointerup') {
      const { px, py } = localPoint(event)
      const column = columnHere(px, py)
      if (column) copyColumn(column)
    }
    if (performance.now() - drag.lastT > STALE_RELEASE_MS) {
      velRef.current.vx = 0
      velRef.current.vz = 0
    }
    dragRef.current = null
    startInertia()
  }

  const onPointerLeave = () => {
    setReadout(null)
    applyHover(null)
  }

  return (
    <div
      ref={containerRef}
      className="relative aspect-square w-full select-none overflow-hidden"
    >
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

      <ZoomControls
        zoomPct={zoomPct}
        onFit={() => {
          fit()
          scheduleDraw()
        }}
      />
      {readout ? <CoordinateReadout x={readout.x} z={readout.z} /> : null}
      {hovered ? <MapTooltip hovered={hovered} /> : null}
      {toast ? <CopyToast toast={toast} /> : null}
    </div>
  )
}
