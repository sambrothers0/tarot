import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import EndStone from '../../assets/blocks/end-stone.svg?react'
import Grass from '../../assets/blocks/grass.svg?react'
import Netherrack from '../../assets/blocks/netherrack.svg?react'
import { DIMENSIONS } from '../../lib/scanOptions'
import type { Dimension } from '../../lib/scanOptions'
import { DIMENSION_TONES } from '../scans/dimensionTones'

type Props = {
  dimension: Dimension
  onDimension: (dimension: Dimension) => void
  disabled: boolean
}

// Each dimension is shown by its ground, not its name.
const BLOCKS: Record<Dimension, typeof Grass> = {
  overworld: Grass,
  nether: Netherrack,
  end: EndStone,
}

// Track padding (Tailwind `p-1`), which the thumb's geometry has to match.
const PAD = 4
// Pointer travel before a press becomes a drag rather than a tap.
const DRAG_SLOP = 4

// How far the thumb is from stop `i`, as 1 (on it) falling to 0 one stop away.
// Plain CSS on the inherited `--dim-pos` (see index.css), so the browser works
// it out every frame of the glide without React re-rendering. `max(a-b, b-a)`
// rather than `abs()`, which older browsers lack.
const nearness = (i: number) =>
  `max(0, 1 - max(var(--dim-pos) - ${i}, ${i} - var(--dim-pos)))`

// A stop's block, scaled by how near the thumb is. At 1 it's the selected
// look (32px, opaque, full colour, shadow-md in black/50); at 0 it's the faint
// marker (24px, 40%, desaturated, no shadow). Hover lifts a marker partway.
const blockStyle = (i: number): CSSProperties => {
  const n = nearness(i)
  const shadow = `rgb(0 0 0 / calc(0.5 * ${n}))`
  return {
    opacity: `calc(0.4 + 0.6 * ${n} + 0.3 * var(--dim-hover) * (1 - ${n}))`,
    transform: `scale(calc(0.75 + 0.25 * ${n}))`,
    filter: `saturate(calc(0.35 + 0.65 * max(${n}, var(--dim-hover))))`,
    boxShadow: `0 4px 6px -1px ${shadow}, 0 2px 4px -2px ${shadow}`,
  }
}

// The dimension picker: a three-stop slider. The thumb is an empty glass frame,
// and the blocks stay on the track: each one grows into full size and colour
// as the thumb arrives over it and fades back to a faint marker as it leaves.
// Tap a stop, drag the thumb, or arrow-key through it. Underneath it's a native
// radio group, which is what gives it keyboard and screen-reader behaviour for
// free.
export function DimensionToggle({ dimension, onDimension, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<{ id: number; startX: number; dragging: boolean } | null>(null)
  // Thumb position in stops while being dragged; null when it sits on a stop.
  const [dragPos, setDragPos] = useState<number | null>(null)

  const index = DIMENSIONS.findIndex((d) => d.id === dimension)
  const tone = DIMENSION_TONES[dimension]

  // Where the thumb would sit for a pointer at `clientX`, and the stop nearest it.
  const locate = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const thumb = (rect.width - PAD * 2) / DIMENSIONS.length
    const max = thumb * (DIMENSIONS.length - 1)
    const x = Math.min(max, Math.max(0, clientX - rect.left - PAD - thumb / 2))
    return { pos: x / thumb, stop: Math.round(x / thumb) }
  }

  const select = (stop: number) => {
    const next = DIMENSIONS[stop].id
    if (next !== dimension) onDimension(next)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pressRef.current = { id: event.pointerId, startX: event.clientX, dragging: false }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (press == null || press.id !== event.pointerId) return
    if (!press.dragging && Math.abs(event.clientX - press.startX) < DRAG_SLOP) return
    press.dragging = true
    const { pos, stop } = locate(event.clientX)
    setDragPos(pos)
    // The selection follows the nearest stop mid-drag, so the thumb's tint
    // changes under the finger.
    select(stop)
  }

  const endPress = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const press = pressRef.current
    if (press == null || press.id !== event.pointerId) return
    pressRef.current = null
    setDragPos(null)
    if (commit) select(locate(event.clientX).stop)
  }

  const dragging = dragPos != null

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label="Dimension"
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endPress(event, true)}
      onPointerCancel={(event) => endPress(event, false)}
      data-dragging={dragging || undefined}
      // Glides to the chosen stop (the transition is in index.css) or tracks
      // the pointer 1:1 while dragged.
      style={{ '--dim-pos': dragPos ?? index } as CSSProperties}
      className={`dim-track relative grid h-16 touch-pan-y select-none grid-cols-3 rounded-2xl border border-white/10 bg-black/20 p-1 shadow-inner shadow-black/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-300 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-slate-950 ${
        disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      {/* The thumb: glass and glow, no block. It rides on `--dim-pos`, so it
          and the blocks under it can never disagree about where it is. */}
      <div
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl border bg-white/[0.07] backdrop-blur-sm transition-[border-color,box-shadow] duration-[260ms] ${tone.ring} ${disabled ? '' : 'cursor-grab'}`}
        style={{
          transform: 'translateX(calc(var(--dim-pos) * 100%))',
          boxShadow: `0 6px 18px -6px rgb(0 0 0 / 0.7), 0 0 22px -8px ${tone.dot}, inset 0 1px 0 rgb(255 255 255 / 0.08)`,
        }}
      />

      {/* The stops. Each is a real radio, visually hidden, with its block
          drawn above the thumb. How big and how vivid the block is depends
          on how close the thumb is (`blockStyle`). */}
      {DIMENSIONS.map((d, i) => {
        const Block = BLOCKS[d.id]
        return (
          <label
            key={d.id}
            title={d.label}
            className="group relative flex items-center justify-center"
          >
            <input
              type="radio"
              name="dimension"
              value={d.id}
              checked={d.id === dimension}
              disabled={disabled}
              onChange={() => onDimension(d.id)}
              aria-label={d.label}
              className="sr-only"
            />
            <Block
              aria-hidden="true"
              style={blockStyle(i)}
              className={`dim-block size-8 rounded-[3px] ${disabled ? '' : 'group-hover:[--dim-hover:1]'}`}
            />
          </label>
        )
      })}
    </div>
  )
}
