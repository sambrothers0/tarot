import { useEffect, useState } from 'react'
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
  normalizeBlockType,
} from '../../lib/scanOptions'
import type { Dimension, Phase, ScanResult, SourceKind } from '../../lib/scanOptions'
import { accountsEnabled } from '../../lib/api'
import { saveScan } from '../../lib/savedScans'
import { scanWorld } from '../../lib/scanWorld'
import { useSignedIn } from '../../lib/useSignedIn'
import type { SaveInput } from '../../workers/source'

// The whole flow: pick a save, scan it in a worker, plot what comes back, and
// optionally keep it. This component owns the `idle → opening → scanning` state
// machine and the save that can follow it — every piece of the page is its own
// component below `components/`.
function App() {
  const [sourceKind, setSourceKind] = useState<SourceKind>('zip')
  const [selectedSave, setSelectedSave] = useState<SaveInput | null>(null)
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

  const busy = phase !== 'idle'

  // Reflect the current phase in the browser tab title so progress is legible
  // even when the tab is backgrounded during a long scan.
  useEffect(() => {
    const suffix = phase === 'opening' ? 'Opening' : phase === 'scanning' ? 'Scanning' : 'Home'
    document.title = `Tarot - ${suffix}`
  }, [phase])

  const handleSubmit = async () => {
    if (!selectedSave) {
      setError('Choose a save first.')
      return
    }

    setPhase('opening')
    setRegionsDone(0)
    setRegionsTotal(0)
    setError(null)
    setResult(null)
    setSaveState('idle')

    try {
      const scan = await scanWorld(selectedSave, dimension, blockType, {
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
      setResult({
        blockType: normalizeBlockType(blockType),
        dimension,
        source: { kind: selectedSave.kind, name: selectedSave.name },
        scannedAt: new Date(),
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

  // DESIGN ONLY: `saveScan` is a placeholder that stores nothing yet.
  const save = async () => {
    if (!result) return
    setSaveState('saving')
    try {
      await saveScan(result)
      setSaveState('saved')
    } catch {
      setSaveState('failed')
    }
  }

  // Signed out, Save opens the sign-in prompt and finishes once it succeeds.
  const handleSave = () => {
    if (signedIn) save()
    else setSignInOpen(true)
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <AmbientBackground />

      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <AccountMenu />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center px-6 pt-14 text-center sm:pt-20">
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

        <section className="mt-10 w-full rounded-[2rem] border border-violet-300/20 bg-slate-950/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
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
            onSubmit={handleSubmit}
          />

          <ScanProgress
            phase={phase}
            dimension={dimension}
            done={regionsDone}
            total={regionsTotal}
          />

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <p>{error}</p>
            </div>
          ) : null}

          {result ? (
            <ScanSummary
              result={result}
              onError={setError}
              save={accountsEnabled ? { state: saveState, onSave: handleSave } : undefined}
            />
          ) : null}
        </section>
      </div>

      <Divider className="relative z-10 mx-auto mt-16 max-w-2xl" />

      <MapPanel matches={result?.matches ?? null} busy={busy} />

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
    </main>
  )
}

export default App
