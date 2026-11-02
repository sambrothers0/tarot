import { dimensionLabel } from '../../lib/scanOptions'
import type { Phase } from '../../lib/scanOptions'

type Props = {
  phase: Phase
  dimension: string
  done: number
  total: number
}

// Both bars the scan can show. `opening` is reading the save's index to find out
// how many region files this dimension has — no total yet, so the bar sweeps.
// `scanning` ticks once per region file, so it is a real determinate bar rather
// than a guess.
export function ScanProgress({ phase, dimension, done, total }: Props) {
  if (phase === 'idle') return null

  if (phase === 'opening') {
    return (
      <Frame label="Opening save">
        {/* No aria-valuenow: an indeterminate progressbar. */}
        <div
          role="progressbar"
          aria-label="Opening save"
          className="relative h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/5"
        >
          <span className="indeterminate-bar" />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Reading what the world remembers — everything stays on this device.
        </p>
      </Frame>
    )
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <Frame label="Scanning world" trailing={`${percent}%`}>
      <div
        role="progressbar"
        aria-label="Scanning world"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${done.toLocaleString()} of ${total.toLocaleString()} region files`}
        className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/5"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-400 to-indigo-400 shadow-[0_0_12px_rgba(168,85,247,0.6)] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {done.toLocaleString()} of {total.toLocaleString()} {dimensionLabel(dimension)} region files
        read.
      </p>
    </Frame>
  )
}

function Frame({
  label,
  trailing,
  children,
}: {
  label: string
  trailing?: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-6 text-left">
      <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
        <span>{label}</span>
        {trailing ? <span className="tabular-nums text-violet-100">{trailing}</span> : null}
      </div>
      {children}
    </div>
  )
}
