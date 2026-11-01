import { useState } from 'react'
import ArrowRightIcon from '../../assets/icons/arrow-right.svg?react'
import TrashIcon from '../../assets/icons/trash.svg?react'
import { MAX_MATCHES } from '../../lib/scanOptions'
import type { SavedScanSummary } from '../../lib/savedScans'
import { ScanConstellation } from './ScanConstellation'
import { BlockTitle, DimensionBadge, SourceLabel } from './ScanMeta'
import { formatFull, timeAgo } from './when'

type Props = {
  scan: SavedScanSummary
  now: number
  onDelete: (id: string) => Promise<void>
}

// One saved scan: its shape, what was searched for, where, from which save and
// when. Deleting asks once, inline, rather than through a modal.
export function SavedScanCard({ scan, now, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    try {
      await onDelete(scan.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <li
      className={`group flex gap-4 rounded-3xl border border-violet-300/15 bg-slate-950/60 p-4 shadow-xl shadow-black/20 backdrop-blur-xl transition hover:border-violet-300/30 sm:gap-5 sm:p-5 ${
        deleting ? 'opacity-50' : ''
      }`}
    >
      <ScanConstellation points={scan.preview} dimension={scan.dimension} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <BlockTitle blockType={scan.blockType} />
          <time
            dateTime={scan.scannedAt.toISOString()}
            title={`Scanned ${formatFull(scan.scannedAt)}`}
            className="shrink-0 pt-0.5 text-xs text-slate-500"
          >
            {timeAgo(scan.scannedAt, now)}
          </time>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <DimensionBadge dimension={scan.dimension} />
          <span className="text-xs text-slate-300">
            <span className="font-medium text-violet-100">{scan.count.toLocaleString()}</span>{' '}
            {scan.count === 1 ? 'match' : 'matches'}
          </span>
          <SourceLabel source={scan.source} />
        </div>

        <div className="mt-3 flex min-h-8 items-center justify-end gap-2">
          {confirming ? (
            <>
              <span className="mr-auto text-xs text-red-100/80">Delete this scan?</span>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-full px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="rounded-full bg-red-500/80 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              {scan.truncated ? (
                <span className="mr-auto text-[11px] text-amber-200/70">
                  Map holds the first {MAX_MATCHES.toLocaleString()}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Delete scan"
                className="rounded-full p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-200"
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              {/* TODO(wire): the index page reads `?scan=` and loads it onto the map. */}
              <a
                href={`${import.meta.env.BASE_URL}?scan=${encodeURIComponent(scan.id)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/20 bg-violet-500/10 px-3.5 py-1.5 text-xs font-medium text-violet-100 transition hover:bg-violet-400/20"
              >
                Open map
                <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
