import { useState } from 'react'
import { dimensionLabel, MAX_MATCHES } from '../../lib/scanOptions'
import type { ScanResult } from '../../lib/scanOptions'

type Props = {
  result: ScanResult
  onError: (message: string) => void
}

// What the scan found, plus the bulk copy. The count is the world's true total;
// `truncated` says the map (and this copy) only carries the first MAX_MATCHES.
export function ScanSummary({ result, onError }: Props) {
  const [copied, setCopied] = useState(false)
  const cap = MAX_MATCHES.toLocaleString()

  const copyCoordinates = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.matches))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onError('Could not copy to the clipboard.')
    }
  }

  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
        <p>
          Found {result.count.toLocaleString()} matching blocks for{' '}
          <span className="text-violet-200">{result.blockType}</span> in the{' '}
          <span className="text-violet-200">{dimensionLabel(result.dimension)}</span>.
        </p>
        {result.truncated ? (
          <p className="mt-2 text-xs text-amber-200/80">
            The world holds more than the map can carry — only the first {cap} are shown. Try a
            rarer block for a complete reading.
          </p>
        ) : null}
        {result.count > 0 ? (
          <button
            type="button"
            onClick={copyCoordinates}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:bg-violet-400/20"
          >
            {copied
              ? 'Copied'
              : result.truncated
                ? `Copy first ${cap} coordinates as JSON`
                : 'Copy coordinates as JSON'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
