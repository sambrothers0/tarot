import ArchiveIcon from '../../assets/icons/archive.svg?react'
import FolderIcon from '../../assets/icons/folder.svg?react'
import { blockName } from '../../lib/blockTypes'
import { dimensionLabel } from '../../lib/scanOptions'
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

/** The block's English name over its ID; modded blocks show the ID alone. */
export function BlockTitle({ blockType }: { blockType: string }) {
  const name = blockName(blockType)
  return (
    <span className="grid min-w-0">
      <span className="truncate text-base font-semibold tracking-tight text-white">
        {name ?? blockType}
      </span>
      {name ? <span className="truncate font-mono text-[11px] text-slate-500">{blockType}</span> : null}
    </span>
  )
}

export function SourceLabel({ source }: { source: { kind: SourceKind; name: string } }) {
  const Icon = source.kind === 'zip' ? ArchiveIcon : FolderIcon
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-400" title={source.name}>
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-violet-200/60"
        aria-label={source.kind === 'zip' ? 'Zip file' : 'Save folder'}
      />
      <span className="truncate">{source.name}</span>
    </span>
  )
}
