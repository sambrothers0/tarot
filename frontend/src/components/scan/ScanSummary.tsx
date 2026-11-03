import { useState } from 'react'
import { blockLabel } from '../../lib/blockTypes'
import { coordinatesJson, dimensionLabel, MAX_MATCHES } from '../../lib/scanOptions'
import type { ScanResult } from '../../lib/scanOptions'
import { LayerSwatch } from '../worldmap/LayerSwatch'
import { MAP_ID } from './MapPanel'
import { SourceLabel } from '../scans/ScanMeta'
import { SaveScanButton } from './SaveScanButton'
import type { SaveState } from './SaveScanButton'

type Props = {
  result: ScanResult
  onError: (message: string) => void
  // Absent when accounts aren't configured: no save button at all.
  save?: { state: SaveState; onSave: () => void }
  // Scroll to and focus the map; the count links there.
  onShowMap: () => void
}

// What the scan found, plus the bulk copy and the save. The count is the
// world's true total; `truncated` says the map (and this copy) only carries the
// first MAX_MATCHES of some block. A scan of several blocks adds a line per
// block, each wearing its map glyph, so the result already reads as the key.
export function ScanSummary({ result, onError, save, onShowMap }: Props) {
  const [copied, setCopied] = useState(false)
  const cap = MAX_MATCHES.toLocaleString()
  const multi = result.layers.length > 1
  const anyTruncated = result.truncated
  const truncatedNames = listNames(
    result.layers.filter((layer) => layer.truncated).map((layer) => blockLabel(layer.blockType)),
  )

  const copyCoordinates = async () => {
    try {
      await navigator.clipboard.writeText(coordinatesJson(result))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onError('Could not copy to the clipboard.')
    }
  }

  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-200">
        <p>
          Found{' '}
          {result.count > 0 ? (
            <a
              href={`#${MAP_ID}`}
              onClick={(event) => {
                event.preventDefault()
                onShowMap()
              }}
              className="font-medium text-white underline decoration-violet-300/50 underline-offset-4 transition hover:decoration-violet-200"
            >
              {result.count.toLocaleString()} matching blocks
            </a>
          ) : (
            'no matching blocks'
          )}{' '}
          {multi ? (
            <>across {result.layers.length} block types</>
          ) : (
            <>
              for <span className="text-violet-200">{result.layers[0]?.blockType}</span>
            </>
          )}{' '}
          in the <span className="text-violet-200">{dimensionLabel(result.dimension)}</span>.
        </p>
        {multi ? (
          <ul className="mt-2.5 grid gap-1">
            {result.layers.map((layer, i) => (
              <li key={layer.blockType} className="flex min-w-0 items-center gap-2" title={layer.blockType}>
                <LayerSwatch layer={i} layerCount={result.layers.length} size={12} />
                <span className="min-w-0 truncate text-slate-100">{blockLabel(layer.blockType)}</span>
                <span
                  aria-hidden="true"
                  className="min-w-4 flex-1 translate-y-[0.3em] self-start border-b border-dotted border-white/15"
                />
                <span className="font-mono text-xs tabular-nums text-violet-100">
                  {layer.count.toLocaleString()}
                  {/* A fixed slot, so a marked count lines up with the rest. */}
                  {anyTruncated ? (
                    <span className="inline-block w-2 text-right text-amber-200/90">
                      {layer.truncated ? '*' : ''}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1.5">
          <SourceLabel source={result.source} />
        </div>
        {result.truncated ? (
          <p className="mt-2 text-xs text-amber-200/80">
            {multi ? (
              <>
                * The world holds more of {truncatedNames} than the map can carry — only the first{' '}
                {cap} of each are shown.
              </>
            ) : (
              <>
                The world holds more than the map can carry — only the first {cap} are shown. Try a
                rarer block for a complete reading.
              </>
            )}
          </p>
        ) : null}
        {result.count > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
            <button
              type="button"
              onClick={copyCoordinates}
              // So the switch to "Copied" is spoken, not just shown.
              aria-live="polite"
              className="inline-flex items-center gap-2 rounded-full border border-violet-300/40 px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:border-violet-200/60 hover:bg-white/5"
            >
              {copied
                ? 'Copied'
                : result.truncated && !multi
                  ? `Copy first ${cap} coordinates as JSON`
                  : 'Copy coordinates as JSON'}
            </button>
            {save ? (
              <div className="ml-auto">
                <SaveScanButton state={save.state} onSave={save.onSave} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// "A", "A and B", "A, B and C".
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
