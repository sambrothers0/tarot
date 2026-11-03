import { blockLabel } from '../../lib/blockTypes'
import { copyTarget, groupByLayer } from './columns'
import { LayerSwatch } from './LayerSwatch'
import type { Hovered, MapLayer } from './types'

// A dense block type (stone, deepslate) can put hundreds of matches in a single
// column, which would make an unreadable tooltip. Long stacks collapse in the
// middle: the ends are what matter, and the lowest block is what a click copies.
// With several block types in one column each gets its own, tighter, budget.
const STACK_HEAD = 4
const STACK_TAIL = 4
const GROUP_HEAD = 2
const GROUP_TAIL = 2

// The rows to render for one run of heights, `null` standing in for the elided
// middle.
function stackRows(ys: number[], head: number, tail: number): (number | null)[] {
  if (ys.length <= head + tail + 1) return ys
  return [...ys.slice(0, head), null, ...ys.slice(ys.length - tail)]
}

// Anchored to the pin's own screen position rather than the cursor, and listing
// every block in the column: X and Z repeat down the stack so only Y changes,
// the way the blocks actually sit. In a scan of several blocks the column is
// split by type, each run headed by its glyph and name, and the copy hint
// names the one a click takes. A tall stack hanging above a pin near the top
// edge would be cut off by the map's overflow-hidden, so there it flips below.
// Hidden from screen readers: the map announces the same column in words.
export function MapTooltip({
  hovered,
  layers,
  keyboard = false,
}: {
  hovered: Hovered
  layers: MapLayer[]
  keyboard?: boolean
}) {
  const multi = layers.length > 1
  const groups = groupByLayer(hovered.blocks).map((group) => ({
    ...group,
    rows: multi
      ? stackRows(group.ys, GROUP_HEAD, GROUP_TAIL)
      : stackRows(group.ys, STACK_HEAD, STACK_TAIL),
  }))
  const lineCount = groups.reduce((n, g) => n + g.rows.length + (multi ? 1 : 0), 0)
  const below = hovered.sz < lineCount * 19 + 44
  const copied = copyTarget(hovered)
  const action = keyboard ? 'Enter to copy lowest' : 'click to copy lowest'

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-violet-300/20 bg-slate-950/85 px-2.5 py-1.5 font-mono text-xs leading-snug tabular-nums text-violet-50 shadow-lg shadow-black/40 backdrop-blur ${
        below ? '' : '-translate-y-full'
      }`}
      style={{ left: hovered.sx, top: below ? hovered.sz + 12 : hovered.sz - 10 }}
    >
      {groups.map((group, g) => (
        <div key={group.layer} className={g > 0 ? 'mt-1.5 border-t border-white/10 pt-1.5' : ''}>
          {multi ? (
            <div className="mb-0.5 flex items-center gap-1.5 font-sans text-[11px] font-medium text-violet-100">
              <LayerSwatch layer={group.layer} layerCount={layers.length} size={10} />
              <span className="max-w-48 truncate">{blockLabel(layers[group.layer]?.blockType ?? '')}</span>
            </div>
          ) : null}
          {group.rows.map((y, i) =>
            y == null ? (
              <div key="elided" className="text-center text-[10px] text-violet-200/80">
                ⋯ {group.ys.length - group.rows.length + 1} more ⋯
              </div>
            ) : (
              <div key={`${y}-${i}`} className="whitespace-nowrap">
                X: {hovered.x}, Y: {y}, Z: {hovered.z}
              </div>
            ),
          )}
        </div>
      ))}
      <span className="mt-1 block font-sans text-[10px] font-medium tracking-wide text-violet-200/80">
        {multi && groups.length > 1
          ? `${action} ${blockLabel(layers[copied.layer]?.blockType ?? '')}`
          : action}
      </span>
    </div>
  )
}
