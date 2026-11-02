import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import BookmarkIcon from '../../assets/icons/bookmark.svg?react'
import { AccountMenu } from '../../components/auth/AccountMenu'
import { GoogleSignInButton } from '../../components/auth/GoogleSignInButton'
import { AmbientBackground } from '../../components/layout/AmbientBackground'
import { SiteFooter } from '../../components/layout/SiteFooter'
import { SavedScanCard } from '../../components/scans/SavedScanCard'
import { dayHeading } from '../../components/scans/when'
import { accountsEnabled } from '../../lib/api'
import { signInWithGoogle } from '../../lib/auth'
import { deleteSavedScan, listSavedScans, renameSavedScan } from '../../lib/savedScans'
import type { SavedScanSummary } from '../../lib/savedScans'
import { useSignedIn } from '../../lib/useSignedIn'

type List =
  | { kind: 'loading' }
  | { kind: 'ready'; scans: SavedScanSummary[]; now: number }
  | { kind: 'failed'; message: string }

// The `/scans/` page: every scan the signed-in account has kept, newest scan
// first, filed under the day it was scanned. A static entry point like /docs.
// Opening a scan expands its card into the map in place — one at a time, so
// the page never holds more than one scan's coordinates.
export function SavedScans() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <AmbientBackground />

      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <AccountMenu />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-2xl px-6 pt-14 pb-16 sm:pt-20">
        <a
          href={import.meta.env.BASE_URL}
          className="text-sm text-violet-200/70 underline underline-offset-4 transition hover:text-violet-100"
        >
          &larr; Back to Tarot
        </a>

        <h1 className="mt-10 text-3xl font-semibold tracking-tight sm:text-4xl">Your readings</h1>

        <div className="mt-10">{accountsEnabled ? <Body /> : <AccountsOff />}</div>
      </div>

      <SiteFooter />
    </main>
  )
}

function Body() {
  const signedIn = useSignedIn()
  return signedIn ? <ScanList /> : <SignedOut />
}

function ScanList() {
  const [list, setList] = useState<List>({ kind: 'loading' })
  const [openId, setOpenId] = useState<string | null>(null)

  // Escape closes the open map. The listener lives only while one is open.
  useEffect(() => {
    if (openId == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openId])

  useEffect(() => {
    let cancelled = false
    listSavedScans()
      .then((scans) => {
        if (!cancelled) setList({ kind: 'ready', scans, now: Date.now() })
      })
      .catch((e: unknown) => {
        if (!cancelled) setList({ kind: 'failed', message: e instanceof Error ? e.message : 'Could not load your scans.' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const remove = async (id: string) => {
    await deleteSavedScan(id)
    setList((current) =>
      current.kind === 'ready' ? { ...current, scans: current.scans.filter((s) => s.id !== id) } : current,
    )
  }

  const rename = async (id: string, name: string) => {
    const renamed = await renameSavedScan(id, name)
    setList((current) =>
      current.kind === 'ready'
        ? { ...current, scans: current.scans.map((s) => (s.id === id ? renamed : s)) }
        : current,
    )
  }

  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id))

  if (list.kind === 'loading') {
    return (
      <ul className="grid gap-3" aria-label="Loading readings">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-[9.5rem] animate-pulse rounded-3xl border border-violet-300/10 bg-slate-950/50" />
        ))}
      </ul>
    )
  }

  if (list.kind === 'failed') {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
        {list.message}
      </div>
    )
  }

  if (list.scans.length === 0) {
    return (
      <Panel title="No readings yet">
        <a
          href={import.meta.env.BASE_URL}
          className="rounded-full border border-violet-300/20 bg-violet-500/10 px-5 py-2.5 text-sm font-medium text-violet-100 transition hover:bg-violet-400/20"
        >
          Scan a world
        </a>
      </Panel>
    )
  }

  // Already newest-first, so consecutive runs of the same heading are the days.
  const days: { heading: string; scans: SavedScanSummary[] }[] = []
  for (const scan of list.scans) {
    const heading = dayHeading(scan.scannedAt, list.now)
    if (days.at(-1)?.heading === heading) days.at(-1)!.scans.push(scan)
    else days.push({ heading, scans: [scan] })
  }

  return (
    <>
      <p className="-mt-6 mb-8 text-sm text-slate-400">
        {list.scans.length} {list.scans.length === 1 ? 'reading' : 'readings'}
      </p>
      <div className="grid gap-10">
        {days.map((day) => (
          <section key={day.heading} aria-label={day.heading}>
            <h2 className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
              {day.heading}
              <span className="h-px flex-1 bg-gradient-to-r from-violet-300/15 to-transparent" />
            </h2>
            <ul className="grid gap-3">
              {day.scans.map((scan) => (
                <SavedScanCard
                  key={scan.id}
                  scan={scan}
                  now={list.now}
                  expanded={openId === scan.id}
                  onToggle={toggle}
                  onDelete={remove}
                  onRename={rename}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}

function SignedOut() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCredential = async (credential: string) => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle(credential)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Sign in to see your readings"
      body="Readings you keep follow your Google account. Your worlds never leave your device — only the coordinates that were found."
    >
      <GoogleSignInButton onCredential={handleCredential} onError={setError} busy={busy} />
      {error ? <p className="mt-3 text-xs text-red-200">{error}</p> : null}
    </Panel>
  )
}

function AccountsOff() {
  return (
    <Panel
      title="Readings aren't available here"
      body="This copy of Tarot runs without the accounts server, so readings can't be kept. Scanning still works exactly the same."
    />
  )
}

function Panel({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col items-center rounded-[2rem] border border-violet-300/20 bg-slate-950/60 px-6 py-12 text-center shadow-2xl shadow-black/30 backdrop-blur-xl">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-violet-300/25 bg-violet-500/15 text-violet-100">
        <BookmarkIcon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
      {body ? <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">{body}</p> : null}
      {children ? <div className="mt-7 flex flex-col items-center">{children}</div> : null}
    </section>
  )
}

export default SavedScans
