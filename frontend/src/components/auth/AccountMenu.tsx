import { useEffect, useRef, useState } from 'react'
import BookmarkIcon from '../../assets/icons/bookmark.svg?react'
import { accountsEnabled, ApiError, getToken, subscribeToken } from '../../lib/api'
import { deleteAccount, getMe, pingApi, signInWithGoogle, signOut } from '../../lib/auth'
import type { User } from '../../lib/auth'
import { forgetGoogleSelection } from '../../lib/googleIdentity'
import { GoogleSignInButton } from './GoogleSignInButton'

type Status =
  | { kind: 'checking' } // have a stored token, asking the server who it belongs to
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: User }
  | { kind: 'unavailable' } // have a token, but the server can't be reached

// Sign in with Google, log out, delete the account. Self-contained: the page
// only mounts it. Renders nothing when the accounts API isn't configured, so
// the app works the same with or without a backend.
export function AccountMenu() {
  if (!accountsEnabled) return null
  return <AccountMenuInner />
}

function AccountMenuInner() {
  const [status, setStatus] = useState<Status>(() =>
    getToken() ? { kind: 'checking' } : { kind: 'signed-out' },
  )
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close on a press anywhere outside the menu, or on Escape. Listening only
  // while open; the state change happens in the event, not the effect body.
  useEffect(() => {
    if (!open) return
    const close = () => {
      setOpen(false)
      setConfirmingDelete(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Restore a stored session, or just wake the server if there isn't one.
  // State changes only happen in the promise callbacks, never in the body.
  useEffect(() => {
    if (!getToken()) {
      pingApi()
      return
    }
    let cancelled = false
    getMe()
      .then((user) => {
        if (!cancelled) setStatus({ kind: 'signed-in', user })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setStatus(e instanceof ApiError && e.status === 401 ? { kind: 'signed-out' } : { kind: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The session can also start in the save prompt, or end on any 401, so
  // follow the token rather than only our own sign-in and sign-out.
  useEffect(
    () =>
      subscribeToken(() => {
        if (!getToken()) {
          setOpen(false)
          setStatus({ kind: 'signed-out' })
          return
        }
        getMe()
          .then((user) => setStatus({ kind: 'signed-in', user }))
          .catch(() => {})
      }),
    [],
  )

  const handleCredential = async (credential: string) => {
    setBusy(true)
    setError(null)
    try {
      setStatus({ kind: 'signed-in', user: await signInWithGoogle(credential) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  const leave = async (action: () => Promise<void>, failure: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      forgetGoogleSelection()
      setOpen(false)
      setConfirmingDelete(false)
      setStatus({ kind: 'signed-out' })
    } catch (e) {
      setError(e instanceof Error ? e.message : failure)
    } finally {
      setBusy(false)
    }
  }

  const errorLine = error ? <p className="mt-2 max-w-56 text-right text-xs text-red-200">{error}</p> : null

  if (status.kind === 'checking') {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" aria-label="Checking sign-in" />
  }

  if (status.kind === 'unavailable') {
    return <p className="text-xs text-slate-400">Accounts unavailable right now</p>
  }

  if (status.kind === 'signed-out') {
    return (
      <div className="flex flex-col items-end">
        <GoogleSignInButton onCredential={handleCredential} onError={setError} busy={busy} />
        {errorLine}
      </div>
    )
  }

  const { user } = status
  return (
    <div ref={menuRef} className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setConfirmingDelete(false)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account"
        className="flex items-center gap-2 rounded-full border border-violet-300/20 bg-slate-950/60 p-1 pr-3 text-xs text-slate-200 backdrop-blur-xl transition hover:bg-white/10"
      >
        {user.picture_url ? (
          // Google's avatar host rejects requests that carry a Referer.
          <img src={user.picture_url} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/30 text-violet-100">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </span>
        )}
        <span className="hidden sm:inline">{user.name ?? user.email}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-violet-300/20 bg-slate-950/90 p-3 text-left text-sm text-slate-200 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <p className="truncate px-2 text-xs text-slate-400">{user.email}</p>

          {confirmingDelete ? (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 p-3">
              <p className="text-xs text-red-100">
                Delete your account and every reading kept with it? This can't be undone.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => leave(deleteAccount, 'Could not delete the account.')}
                  className="rounded-full bg-red-500/80 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  Delete account
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-full px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col">
              {/* A static entry point like /docs, so a plain same-tab link. */}
              <a
                role="menuitem"
                href={`${import.meta.env.BASE_URL}scans/`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/10"
              >
                <BookmarkIcon className="h-4 w-4 text-violet-200/70" aria-hidden="true" />
                Your readings
              </a>
              <div className="my-1 h-px bg-white/10" />
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => leave(signOut, 'Could not log out.')}
                className="rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10 disabled:opacity-50"
              >
                Log out
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
                className="rounded-lg px-2 py-1.5 text-left text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                Delete account…
              </button>
            </div>
          )}
          {errorLine}
        </div>
      ) : (
        errorLine
      )}
    </div>
  )
}
