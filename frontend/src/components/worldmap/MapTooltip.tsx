import type { Hovered } from './types'

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

// Anchored to the pin's own screen position rather than the cursor, and listing
// every block in the column: X and Z repeat down the stack so only Y changes,
// the way the blocks actually sit. A tall stack hanging above a pin near the top
// edge would be cut off by the map's overflow-hidden, so there it flips below.
export function MapTooltip({ hovered }: { hovered: Hovered }) {
  const rows = stackRows(hovered.ys)
  const below = hovered.sz < rows.length * 19 + 44

  return (
    <div
      className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-violet-300/20 bg-slate-950/85 px-2.5 py-1.5 font-mono text-xs leading-snug tabular-nums text-violet-50 shadow-lg shadow-black/40 backdrop-blur ${
        below ? '' : '-translate-y-full'
      }`}
      style={{ left: hovered.sx, top: below ? hovered.sz + 12 : hovered.sz - 10 }}
    >
      {rows.map((y, i) =>
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
        click to copy lowest
      </span>
    </div>
  )
}
