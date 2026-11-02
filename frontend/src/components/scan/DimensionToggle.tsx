import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
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

// The dimension picker: a three-stop slider. A raised thumb carries the chosen
// dimension's block; the other stops show theirs faintly, so the choices read
// as places the thumb can go. Tap a stop, drag the thumb, or arrow-key through
// it — underneath it is a native radio group, which is what gives it keyboard
// and screen-reader behaviour for free.
export function DimensionToggle({ dimension, onDimension, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<{ id: number; startX: number; dragging: boolean } | null>(null)
  // Thumb offset in px while being dragged; null when it sits on a stop.
  const [dragX, setDragX] = useState<number | null>(null)

  const index = DIMENSIONS.findIndex((d) => d.id === dimension)
  const tone = DIMENSION_TONES[dimension]

  // Where the thumb would sit for a pointer at `clientX`, and the stop nearest it.
  const locate = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const thumb = (rect.width - PAD * 2) / DIMENSIONS.length
    const max = thumb * (DIMENSIONS.length - 1)
    const x = Math.min(max, Math.max(0, clientX - rect.left - PAD - thumb / 2))
    return { x, stop: Math.round(x / thumb) }
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
    const { x, stop } = locate(event.clientX)
    setDragX(x)
    // The icon follows the nearest stop mid-drag, so it crossfades under the finger.
    select(stop)
  }

  const endPress = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const press = pressRef.current
    if (press == null || press.id !== event.pointerId) return
    pressRef.current = null
    setDragX(null)
    if (commit) select(locate(event.clientX).stop)
  }

  const dragging = dragX != null

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
      className={`relative grid h-16 touch-pan-y select-none grid-cols-3 rounded-2xl border border-white/10 bg-black/20 p-1 shadow-inner shadow-black/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-300 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-slate-950 ${
        disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      {/* The thumb. Glides between stops on a plain ease-out (no overshoot),
          or tracks the pointer 1:1 while dragged. Holds every block stacked,
          crossfading to the chosen one, so the icon changes as it travels. */}
      <div
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl border bg-white/[0.07] backdrop-blur-sm transition-[border-color,box-shadow] duration-[260ms] ${
          dragging
            ? ''
            : 'motion-safe:transition-[transform,border-color,box-shadow] motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.25,1,0.5,1)]'
        } ${tone.ring} ${disabled ? '' : 'cursor-grab'}`}
        style={{
          transform: dragging ? `translateX(${dragX}px)` : `translateX(${index * 100}%)`,
          boxShadow: `0 6px 18px -6px rgb(0 0 0 / 0.7), 0 0 22px -8px ${tone.dot}, inset 0 1px 0 rgb(255 255 255 / 0.08)`,
        }}
      >
        {DIMENSIONS.map((d) => {
          const Block = BLOCKS[d.id]
          const active = d.id === dimension
          return (
            <Block
              key={d.id}
              className={`absolute inset-0 m-auto size-8 rounded-[3px] shadow-md shadow-black/50 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
                active ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )
        })}
      </div>

      {/* The stops. Each is a real radio, visually hidden; the faint block is
          what shows where the thumb can go. The chosen stop's ghost hides so
          the thumb's own icon is the only one there. */}
      {DIMENSIONS.map((d) => {
        const Block = BLOCKS[d.id]
        const active = d.id === dimension
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
              checked={active}
              disabled={disabled}
              onChange={() => onDimension(d.id)}
              aria-label={d.label}
              className="sr-only"
            />
            <Block
              aria-hidden="true"
              className={`size-6 rounded-[2px] saturate-[0.35] transition-[opacity,filter] duration-200 ease-out motion-reduce:transition-none ${
                active
                  ? 'opacity-0'
                  : `opacity-40 ${disabled ? '' : 'group-hover:opacity-70 group-hover:saturate-100'}`
              }`}
            />
          </label>
        )
      })}
    </div>
  )
}
