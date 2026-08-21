import { useEffect, useState } from 'react'
import { PortalLoader } from './PortalLoader'
import { WorldMap } from './WorldMap'
import type { BlockMatch } from './WorldMap'
import type { WorldScanRequest, WorldScanResponse } from './workers/worldScan.worker'
import GithubIcon from './assets/github.svg?react'
import CoffeeIcon from './assets/coffee.svg?react'

type ScanResult = {
  blockType: string
  dimension: string
  count: number
  truncated: boolean
  matches: BlockMatch[]
}

const DEFAULT_BLOCK = 'minecraft:nether_portal'

// How many coordinates the map will carry. The scan always reports the true
// count; this only bounds what gets drawn and copied, because a block like
// stone occurs hundreds of millions of times in one save.
const MAX_MATCHES = 100_000

// Which dimension's region files to scan.
const DIMENSIONS = [
  { id: 'overworld', label: 'Overworld' },
  { id: 'nether', label: 'Nether' },
  { id: 'end', label: 'End' },
] as const
type Dimension = (typeof DIMENSIONS)[number]['id']
const DEFAULT_DIMENSION: Dimension = 'overworld'
const dimensionLabel = (id: string) => DIMENSIONS.find((d) => d.id === id)?.label ?? id

// Display-only mirror of the scanner's own namespacing (`stone` →
// `minecraft:stone`), so the result line echoes what was actually searched for.
const normalizeBlockType = (value: string) =>
  value.includes(':') ? value : `minecraft:${value}`

type Phase = 'idle' | 'opening' | 'scanning'

// Run the save through the scan worker. The whole scan happens on this
// machine: the coordinator worker opens the zip and hands one region file at a
// time to a pool of WebAssembly workers. Nothing is uploaded.
function scanWorld(
  file: File,
  dimension: Dimension,
  blockType: string,
  onOpened: (regionCount: number) => void,
  onProgress: (done: number, total: number) => void,
): Promise<{ count: number; truncated: boolean; matches: BlockMatch[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/worldScan.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<WorldScanResponse>) => {
      const data = event.data
      // 'opened' and 'progress' keep streaming while the scan runs — report and
      // wait for the terminal 'done'/'error' before tearing the worker down.
      if (data.type === 'opened') {
        onOpened(data.regionCount)
        return
      }
      if (data.type === 'progress') {
        onProgress(data.done, data.total)
        return
      }
      worker.terminate()
      if (data.type === 'done') {
        // The scanner returns a flat run of x,y,z triples — building objects
        // per match inside wasm and marshalling them out is far slower than
        // one Int32Array. Unpack once, here, so nothing downstream has to know.
        const { coords } = data
        const matches: BlockMatch[] = new Array(coords.length / 3)
        for (let i = 0, m = 0; i < coords.length; i += 3, m += 1) {
          matches[m] = { x: coords[i], y: coords[i + 1], z: coords[i + 2] }
        }
        resolve({ count: data.count, truncated: data.truncated, matches })
      } else {
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Failed to scan the save in the browser'))
    }

    const request: WorldScanRequest = {
      type: 'scan',
      file,
      dimension,
      blockType,
      limit: MAX_MATCHES,
    }
    worker.postMessage(request)
  })
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [blockType, setBlockType] = useState(DEFAULT_BLOCK)
  const [dimension, setDimension] = useState<Dimension>(DEFAULT_DIMENSION)
  const [phase, setPhase] = useState<Phase>('idle')
  const [regionsDone, setRegionsDone] = useState(0)
  const [regionsTotal, setRegionsTotal] = useState(0)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const busy = phase !== 'idle'
  const percent = regionsTotal > 0 ? Math.round((regionsDone / regionsTotal) * 100) : 0

  const copyCoordinates = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.matches))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }

  // Reflect the current phase in the browser tab title so progress is legible
  // even when the tab is backgrounded during a long scan.
  useEffect(() => {
    const suffix = phase === 'opening' ? 'Opening' : phase === 'scanning' ? 'Scanning' : 'Home'
    document.title = `Tarot - ${suffix}`
  }, [phase])

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError('Choose a zip file first.')
      return
    }

    setPhase('opening')
    setRegionsDone(0)
    setRegionsTotal(0)
    setError(null)
    setCopied(false)
    setResult(null)

    try {
      const scan = await scanWorld(
        selectedFile,
        dimension,
        blockType,
        (regionCount) => {
          // The zip is open and the region count is known, so the bar can go
          // from indeterminate to real. Phase flips here, in an event callback,
          // to keep setState out of effect bodies.
          setRegionsTotal(regionCount)
          setPhase('scanning')
        },
        (done, total) => {
          setRegionsDone(done)
          setRegionsTotal(total)
        },
      )
      setResult({
        blockType: normalizeBlockType(blockType),
        dimension,
        count: scan.count,
        truncated: scan.truncated,
        matches: scan.matches,
      })
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Something went wrong')
    } finally {
      setPhase('idle')
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <div className="bg-blobs" aria-hidden="true">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
        <div className="blob blob-4" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center px-6 pt-14 text-center sm:pt-20">
        {/* Header */}
        <div className="w-full">
          {/* Tighter size/tracking on phones so the wide letter-spacing doesn't
              overflow the viewport; full drama from sm up. The negative right
              margin cancels the trailing letter-space after the final T, which
              would otherwise throw the centring off by half the tracking. */}
          <p className="mb-10 -mr-[0.4em] inline-block text-4xl uppercase tracking-[0.4em] text-violet-200/70 sm:mb-14 sm:-mr-[1em] sm:text-6xl sm:tracking-[1em]">
            TAROT
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-5xl lg:text-4xl">
            Instantly plot any block type in your Minecraft world
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
            Locate forgotten nether portals, builds, or previously explored areas
          </p>
        </div>

        {/* Input */}
        <section className="mt-10 w-full rounded-[2rem] border border-violet-300/20 bg-slate-950/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
          <div className="grid gap-4">
            <label className="grid gap-2 text-left">
              <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
                Zip file
              </span>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  setError(null)
                  setSelectedFile(event.target.files?.[0] ?? null)
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-violet-400/20 file:px-4 file:py-2 file:text-sm file:font-medium file:text-violet-100 hover:bg-white/7"
              />
              <span className="text-xs text-slate-500">
                Zipped save folder · scanned on your device, never uploaded
              </span>
            </label>

            <label className="grid gap-2 text-left">
              <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
                Block type
              </span>
              <input
                type="text"
                value={blockType}
                onChange={(event) => setBlockType(event.target.value)}
                placeholder="minecraft:nether_portal"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-300/40"
              />
            </label>

            <div className="grid gap-2 text-left">
              <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
                Dimension
              </span>
              <div role="group" aria-label="Dimension" className="grid grid-cols-3 gap-2">
                {DIMENSIONS.map((option) => {
                  const selected = dimension === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() => setDimension(option.id)}
                      className={`rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-violet-300/40 bg-violet-500/20 text-violet-50 shadow-sm shadow-violet-500/20'
                          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="rounded-full border border-violet-300/20 bg-violet-500/10 px-5 py-3 text-sm font-medium text-violet-100 shadow-sm transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'opening' ? 'Opening save...' : phase === 'scanning' ? 'Scanning...' : 'Scan world'}
            </button>
          </div>

          {/* Opening phase — reading the zip's index to find out how many region
              files this dimension has. No total yet, so the bar sweeps. */}
          {phase === 'opening' ? (
            <div className="mt-6 text-left">
              <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
                <span>Opening save</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/5">
                <span className="indeterminate-bar" />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Reading what the world remembers — everything stays on this device.
              </p>
            </div>
          ) : null}

          {/* Scanning phase — one tick per region file, so this is a real
              determinate bar rather than a guess. */}
          {phase === 'scanning' ? (
            <div className="mt-6 text-left">
              <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
                <span>Scanning world</span>
                <span className="tabular-nums text-violet-100">{percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-400 to-indigo-400 shadow-[0_0_12px_rgba(168,85,247,0.6)] transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {regionsDone.toLocaleString()} of {regionsTotal.toLocaleString()}{' '}
                {dimensionLabel(dimension)} region files read.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <p>{error}</p>
            </div>
          ) : null}

          {result ? (
            <div className="mt-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <p>
                  Found {result.count.toLocaleString()} matching blocks for{' '}
                  <span className="text-violet-200">{result.blockType}</span> in the{' '}
                  <span className="text-violet-200">{dimensionLabel(result.dimension)}</span>.
                </p>
                {result.truncated ? (
                  <p className="mt-2 text-xs text-amber-200/80">
                    The world holds more than the map can carry — only the first 100,000 are shown. Try a rarer block for a complete reading.
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
                        ? 'Copy first 100,000 coordinates as JSON'
                        : 'Copy coordinates as JSON'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* Divider between the upload section and the map */}
      <div className="relative z-10 mx-auto mt-16 h-px w-full max-w-2xl bg-gradient-to-r from-transparent via-violet-300/25 to-transparent" />

      {/* Map — square, sized to 90% of the smaller viewport dimension. max-w-full
          + aspect-square keeps it square while never spilling past the page
          padding on narrow portrait phones (where 90vmin == 90vw). */}
      <div className="relative z-10 mx-auto mt-12 flex w-full flex-col items-center px-6">
        <div className="relative aspect-square w-[90vmin] max-w-full overflow-hidden rounded-3xl border border-violet-300/15 bg-slate-950/40 shadow-2xl shadow-black/40 backdrop-blur-sm">
          {result ? (
            <WorldMap matches={result.matches} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {busy ? (
                <PortalLoader />
              ) : (
                <p className="text-xs text-slate-600">Choose a world zip and hit Scan to generate the map</p>
              )}
            </div>
          )}
          {/* While scanning, keep the loader visible even if a previous map is shown */}
          {busy && result ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
              <PortalLoader />
            </div>
          ) : null}
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">
          Drag to pan · scroll to zoom · hover a pin for its coordinates
        </p>
      </div>

      {/* Divider between the map and the footer */}
      <div className="relative z-10 mx-auto mt-16 h-px w-full max-w-2xl bg-gradient-to-r from-transparent via-violet-300/25 to-transparent" />

      {/* Footer */}
      <footer className="relative z-10 pb-16">
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-400 sm:text-base">
          Created by{' '}
          <a
            href="https://sambrothers0.github.io"
            className="text-violet-200 underline underline-offset-4 transition hover:text-violet-100"
            target="_blank"
            rel="noreferrer"
          >
            Sam Brothers
          </a>
        </p>

        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-slate-400 sm:text-base">
          {/* The docs are a second static entry point, not a route, so this is
              a plain same-tab navigation. BASE_URL keeps it right in dev (`/`)
              and under the Pages subpath (`/tarot/`). */}
          <a
            href={`${import.meta.env.BASE_URL}docs/`}
            className="underline underline-offset-4 transition hover:text-slate-200"
          >
            How it works
          </a>
        </p>

        <div className="mx-auto mt-6 flex items-center justify-center gap-3">
          <a
            href="https://github.com/sambrothers0/tarot"
            className="rounded-full p-1.5 text-violet-200/70 transition hover:bg-white/10 hover:text-violet-100"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
          >
            <GithubIcon className="h-4 w-4" aria-hidden="true" />
          </a>
          <div className="h-4 w-px bg-violet-300/20" />
          <a
            href="https://buymeacoffee.com/sambrothers"
            className="rounded-full p-1.5 text-violet-200/70 transition hover:bg-white/10 hover:text-violet-100"
            target="_blank"
            rel="noreferrer"
            aria-label="Buy me a coffee"
          >
            <CoffeeIcon className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-slate-600">
          Tarot is pronounced "TARE-oh"
        </p>
      </footer>
    </main>
  )
}

export default App
