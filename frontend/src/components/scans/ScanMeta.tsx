import type { ReactNode } from 'react'
import ArchiveIcon from '../../assets/icons/archive.svg?react'
import FolderIcon from '../../assets/icons/folder.svg?react'
import { blockLabel, blockName, layersTitle } from '../../lib/blockTypes'
import { dimensionLabel } from '../../lib/scanOptions'
import { LayerSwatch } from '../worldmap/LayerSwatch'
import type { MapLayer } from '../worldmap/types'
import { DIMENSION_TONES } from './dimensionTones'
import type { Dimension, SourceKind } from '../../lib/scanOptions'

// The small pieces every place that describes a scan shares — the result line
// under the form and each saved-scan card — so a scan reads the same in both.

export function DimensionBadge({ dimension }: { dimension: Dimension }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${DIMENSION_TONES[dimension].badge}`}
    >
      {dimensionLabel(dimension)}
    </span>
  )
}

/**
 * The scan's title: the name it was given, else the block's English name, else
 * (modded blocks) the ID — or, for several blocks, the first and how many
 * more. The line under it says which blocks it was: the ID for one, and for
 * several each block with the glyph its pins wear. `action` sits right after
 * the title text — the rename control, so it reads as acting on the name.
 */
export function BlockTitle({
  layers,
  name,
  large,
  action,
}: {
  layers: MapLayer[]
  name?: string | null
  large?: boolean
  action?: ReactNode
}) {
  const blockType = layers[0]?.blockType ?? ''
  const english = blockName(blockType)
  const multi = layers.length > 1
  return (
    <span className="grid min-w-0">
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={`truncate font-semibold tracking-tight text-white transition-[font-size,line-height] duration-500 ${
            large ? 'text-xl sm:text-2xl' : 'text-base'
          }`}
        >
          {name || layersTitle(layers)}
        </span>
        {action}
      </span>
      {multi ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-400">
          {layers.map((layer, i) => (
            <span key={layer.blockType} className="inline-flex min-w-0 items-center gap-1" title={layer.blockType}>
              <LayerSwatch layer={i} layerCount={layers.length} size={10} />
              <span className="truncate">{blockLabel(layer.blockType)}</span>
            </span>
          ))}
        </span>
      ) : name ? (
        <span className="truncate text-xs text-slate-400">{english ?? blockType}</span>
      ) : english ? (
        <span className="truncate font-mono text-[11px] text-slate-400">{blockType}</span>
      ) : null}
    </span>
  )
}

export function SourceLabel({ source }: { source: { kind: SourceKind; name: string } }) {
  const Icon = source.kind === 'zip' ? ArchiveIcon : FolderIcon
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-400" title={source.name}>
      <Icon
        role="img"
        className="h-3.5 w-3.5 shrink-0 text-violet-200/60"
        aria-label={source.kind === 'zip' ? 'Zip file' : 'Save folder'}
      />
      <span className="truncate">{source.name}</span>
    </span>
  )
}
