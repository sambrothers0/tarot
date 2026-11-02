import { useEffect, useRef, useState } from 'react'
import BookmarkIcon from '../../assets/icons/bookmark.svg?react'
import { signInWithGoogle } from '../../lib/auth'
import { GoogleSignInButton } from './GoogleSignInButton'

type Props = {
  open: boolean
  onClose: () => void
  // Called once the session exists, so the caller can finish what it was doing.
  onSignedIn: () => void
}

// The sign-in prompt a signed-out "Save" opens. A native modal <dialog>: focus
// trapping, Escape and the backdrop come with it. The Google button is only
// mounted while open, so GIS isn't loaded for anyone who never asks to save.
export function SignInDialog({ open, onClose, onSignedIn }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = dialog.current
    if (el == null) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  const handleCredential = async (credential: string) => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle(credential)
      onSignedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, never a child.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-labelledby="sign-in-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[2rem] border border-violet-300/20 bg-slate-950/90 p-0 text-white shadow-2xl shadow-black/60 backdrop-blur-xl backdrop:bg-[#06040d]/70 backdrop:backdrop-blur-sm"
    >
      {open ? (
        <div className="flex flex-col items-center px-7 pt-9 pb-7 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-violet-300/25 bg-violet-500/15 text-violet-100 shadow-lg shadow-violet-500/20">
            <BookmarkIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id="sign-in-title" className="mt-5 text-xl font-semibold tracking-tight">
            Sign in to keep this reading
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Readings you keep live with your Google account, so any map can be reopened later — on
            any device, without scanning again.
          </p>

          <ul className="mt-5 grid w-full gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-xs leading-5 text-slate-400">
            <li>
              <span className="text-slate-200">Kept:</span> the block, the dimension, the world's
              name, and the coordinates found.
            </li>
            <li>
              <span className="text-slate-200">Never sent:</span> the world itself. It is still read
              only on this device.
            </li>
          </ul>

          <div className="mt-6">
            <GoogleSignInButton onCredential={handleCredential} onError={setError} busy={busy} />
          </div>
          {error ? <p className="mt-3 text-xs text-red-200">{error}</p> : null}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-full px-4 py-1.5 text-xs text-slate-400 outline-none transition hover:bg-white/10 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-violet-400/40"
          >
            Not now
          </button>
        </div>
      ) : null}
    </dialog>
  )
}
