import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AccountMenu } from '../../components/auth/AccountMenu'
import { SignInDialog } from '../../components/auth/SignInDialog'
import { AmbientBackground } from '../../components/layout/AmbientBackground'
import { Divider } from '../../components/layout/Divider'
import { SiteFooter } from '../../components/layout/SiteFooter'
import { MapPanel } from '../../components/scan/MapPanel'
import { ScanForm } from '../../components/scan/ScanForm'
import { ScanProgress } from '../../components/scan/ScanProgress'
import type { SaveState } from '../../components/scan/SaveScanButton'
import { ScanSummary } from '../../components/scan/ScanSummary'
import {
  DEFAULT_BLOCK,
  DEFAULT_DIMENSION,
  dimensionLabel,
  normalizeBlockType,
} from '../../lib/scanOptions'
import type { Dimension, Phase, ScanResult, SourceKind } from '../../lib/scanOptions'
import { accountsEnabled } from '../../lib/api'
import { reveal } from '../../lib/reveal'
import { loadSampleWorld, SAMPLE_WORLD_DIMENSIONS } from '../../lib/sampleWorld'
import { saveScan } from '../../lib/savedScans'
import { scanWorld } from '../../lib/scanWorld'
import { useSignedIn } from '../../lib/useSignedIn'
import type { SaveInput } from '../../workers/source'

// The whole flow: pick a save, scan it in a worker, plot what comes back, and
// optionally keep it. This component owns the `idle → opening → scanning` state
// machine and the save that can follow it — every piece of the page is its own
// component below `components/`.
function App() {
  const [sourceKind, setSourceKind] = useState<SourceKind>('folder')
  // The visitor's own save. Until they pick one (or after they switch format
  // or cancel the picker), the sample world is what Scan uses.
  const [selectedSave, setSelectedSave] = useState<SaveInput | null>(null)
  const usingSample = selectedSave === null
  const [blockType, setBlockType] = useState(DEFAULT_BLOCK)
  const [dimension, setDimension] = useState<Dimension>(DEFAULT_DIMENSION)
  const [phase, setPhase] = useState<Phase>('idle')
  const [regionsDone, setRegionsDone] = useState(0)
  const [regionsTotal, setRegionsTotal] = useState(0)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [signInOpen, setSignInOpen] = useState(false)
  const signedIn = useSignedIn()
  const mapRef = useRef<HTMLElement>(null)

  const busy = phase !== 'idle'
  // Once a scan is running or has landed, the map is the point of the page, so
  // the hero folds down to the wordmark. The layout itself never changes: one
  // column, form above map, at every width and in every phase.
  const workspace = busy || result !== null

  // Reflect the current phase in the browser tab title so progress is legible
  // even when the tab is backgrounded during a long scan.
  useEffect(() => {
    const suffix = phase === 'opening' ? 'Opening' : phase === 'scanning' ? 'Scanning' : 'Home'
    document.title = `Tarot - ${suffix}`
  }, [phase])

  const handleSubmit = async () => {
    // Don't download the sample to find a dimension it doesn't have.
    if (usingSample && !SAMPLE_WORLD_DIMENSIONS.includes(dimension)) {
      setError(
        `The sample world has no ${dimensionLabel(dimension)} to scan. Try the Overworld, or choose your own save.`,
      )
      return
    }

    setPhase('opening')
    setRegionsDone(0)
    setRegionsTotal(0)
    setError(null)
    setResult(null)
    setSaveState('idle')

    try {
      // The sample is fetched here, on first use, inside the opening phase, so
      // its download is covered by the same indeterminate bar as a save's index.
      const save = selectedSave ?? (await loadSampleWorld())
      const scan = await scanWorld(save, dimension, blockType, {
        onOpened: (regionCount) => {
          // The save is open and the region count is known, so the bar can go
          // from indeterminate to real. Phase flips here, in an event callback,
          // to keep setState out of effect bodies.
          setRegionsTotal(regionCount)
          setPhase('scanning')
        },
        onProgress: (done, total) => {
          setRegionsDone(done)
          setRegionsTotal(total)
        },
      })
      // Commit synchronously so the map is in the DOM, at its final size, before
      // scrolling to it — this is the event that earns the scroll, not an effect.
      flushSync(() => {
        setResult({
          blockType: normalizeBlockType(blockType),
          dimension,
          source: { kind: save.kind, name: save.name },
          scannedAt: new Date(),
          count: scan.count,
          truncated: scan.truncated,
          matches: scan.matches,
        })
        setPhase('idle')
      })
      reveal(mapRef.current)
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Something went wrong')
    } finally {
      setPhase('idle')
    }
  }

  const save = async () => {
    if (!result) return
    setSaveState('saving')
    setError(null)
    try {
      await saveScan(result)
      setSaveState('saved')
    } catch (saveError) {
      // The button says it failed; the reason (e.g. a full quota) goes here.
      setSaveState('failed')
      setError(saveError instanceof Error ? saveError.message : 'Could not keep this reading.')
    }
  }

  // Signed out, Save opens the sign-in prompt and finishes once it succeeds.
  const handleSave = () => {
    if (signedIn) save()
    else setSignInOpen(true)
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <AmbientBackground />

      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <AccountMenu />
      </div>

      {/* The footer sits outside <main> so it stays its own landmark. */}
      <main>
        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center px-6 pt-14 text-center sm:pt-20">
          <div className="w-full">
            {workspace ? (
              // Folded hero: the wordmark alone, sitting on the form like a
              // title bar. The headline stays in the document for screen readers.
              <>
                <p className="mb-6 text-2xl uppercase tracking-[0.6em] text-violet-200/70">
                  TAROT
                </p>
                <h1 className="sr-only">Instantly plot any block type in your Minecraft world</h1>
              </>
            ) : (
              <>
                {/* Tighter size/tracking on phones so the wide letter-spacing doesn't
                    overflow the viewport; full drama from sm up. The negative right
                    margin cancels the trailing letter-space after the final T, which
                    would otherwise throw the centring off by half the tracking. */}
                <p className="mb-10 -mr-[0.4em] inline-block text-4xl uppercase tracking-[0.4em] text-violet-200/70 sm:mb-14 sm:-mr-[1em] sm:text-6xl sm:tracking-[1em]">
                  TAROT
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-5xl lg:text-4xl">
                  Instantly plot any block type in your Minecraft world
                </h1>
                <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                  Locate forgotten nether portals, builds, or previously explored areas
                </p>
              </>
            )}

            <section
              className={`w-full rounded-[2rem] border border-violet-300/20 bg-slate-950/60 p-6 text-center shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8 ${
                workspace ? '' : 'mt-10'
              }`}
            >
              <ScanForm
                sourceKind={sourceKind}
                onSourceKind={(kind) => {
                  setSourceKind(kind)
                  setSelectedSave(null)
                  setError(null)
                }}
                onSave={(save) => {
                  setError(null)
                  setSelectedSave(save)
                }}
                blockType={blockType}
                onBlockType={setBlockType}
                dimension={dimension}
                onDimension={setDimension}
                phase={phase}
                usingSample={usingSample}
                onSubmit={handleSubmit}
              />

              <ScanProgress
                phase={phase}
                dimension={dimension}
                done={regionsDone}
                total={regionsTotal}
              />

              {/* Spoken as the scan moves through its phases; the bars and the
                  summary are what sighted users read instead. */}
              <p role="status" className="sr-only">
                {statusMessage(phase, dimension, result)}
              </p>

              {error ? (
                <div role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  <p>{error}</p>
                </div>
              ) : null}

              {result ? (
                <ScanSummary
                  result={result}
                  onError={setError}
                  save={accountsEnabled ? { state: saveState, onSave: handleSave } : undefined}
                  onShowMap={() => reveal(mapRef.current, { focus: true })}
                />
              ) : null}
            </section>
          </div>

        </div>

        <Divider className="relative z-10 mx-auto mt-16 max-w-2xl" />
        <div className="mt-12 px-6">
          <MapPanel ref={mapRef} matches={result?.matches ?? null} busy={busy} />
        </div>
      </main>

      <Divider className="relative z-10 mx-auto mt-16 max-w-2xl" />

      <SiteFooter />

      {accountsEnabled ? (
        <SignInDialog
          open={signInOpen}
          onClose={() => setSignInOpen(false)}
          onSignedIn={() => {
            setSignInOpen(false)
            save()
          }}
        />
      ) : null}
    </div>
  )
}

// What the status region says. Only phase changes speak, not every tick of the
// bar, so a long scan doesn't talk over the reader. Deliberately not worded like
// the visible summary: the result line is the place to read the detail.
function statusMessage(phase: Phase, dimension: Dimension, result: ScanResult | null): string {
  if (phase === 'opening') return 'Opening save…'
  if (phase === 'scanning') return `Scanning the ${dimensionLabel(dimension)}…`
  if (result == null) return ''
  const n = result.count
  return `Scan finished: ${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}.`
}

export default App
