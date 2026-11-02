import type { ReactNode } from 'react'
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

/**
 * The scan's title: the name it was given, else the block's English name, else
 * (modded blocks) the ID. The line under it says which block it was. `action`
 * sits right after the title text — the rename control, so it reads as acting
 * on the name.
 */
export function BlockTitle({
  blockType,
  name,
  large,
  action,
}: {
  blockType: string
  name?: string | null
  large?: boolean
  action?: ReactNode
}) {
  const english = blockName(blockType)
  return (
    <span className="grid min-w-0">
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={`truncate font-semibold tracking-tight text-white transition-[font-size,line-height] duration-500 ${
            large ? 'text-xl sm:text-2xl' : 'text-base'
          }`}
        >
          {name || english || blockType}
        </span>
        {action}
      </span>
      {name ? (
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
