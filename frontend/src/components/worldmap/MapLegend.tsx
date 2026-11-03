import { blockLabel } from '../../lib/blockTypes'
import { LayerSwatch } from './LayerSwatch'
import type { MapLayer } from './types'

type Props = {
  layers: MapLayer[]
  hidden: ReadonlySet<number>
  onToggle: (layer: number) => void
  className?: string
}

// The key to a map of several block types, and the switch for each: one pill
// per block with its glyph, name and true count. Pressing one takes that block
// off the map (and out of hover, copy and N/P) — the way to see what a dense
// block is sitting on top of. One block always stays on, so the map can't go
// blank by accident. A scan of one block has nothing to tell apart, so this
// renders nothing for it.
export function MapLegend({ layers, hidden, onToggle, className = '' }: Props) {
  if (layers.length <= 1) return null
  const shown = layers.length - hidden.size

  return (
    <div role="group" aria-label="Block types on the map" className={`flex flex-wrap justify-center gap-2 ${className}`}>
      {layers.map((layer, i) => {
        const on = !hidden.has(i)
        const last = on && shown === 1
        const name = blockLabel(layer.blockType)
        return (
          <button
            key={layer.blockType}
            type="button"
            aria-pressed={on}
            aria-disabled={last || undefined}
            onClick={() => {
              if (!last) onToggle(i)
            }}
            title={last ? 'One block type always stays on the map' : `${on ? 'Hide' : 'Show'} ${name}`}
            className={`group inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
              on
                ? 'border-violet-300/30 bg-slate-950/60 text-violet-50 hover:border-violet-200/50'
                : 'border-dashed border-white/20 bg-transparent text-slate-400 hover:border-white/35 hover:text-slate-300'
            } ${last ? 'cursor-default' : ''}`}
          >
            <span className={`transition ${on ? '' : 'opacity-35 grayscale'}`}>
              <LayerSwatch layer={i} layerCount={layers.length} size={12} />
            </span>
            <span className={`truncate font-medium ${on ? '' : 'line-through decoration-slate-500'}`}>
              {name}
            </span>
            <span className={`font-mono tabular-nums ${on ? 'text-violet-200/80' : ''}`}>
              {layer.count.toLocaleString()}
            </span>
          </button>
        )
      })}
    </div>
  )
}
