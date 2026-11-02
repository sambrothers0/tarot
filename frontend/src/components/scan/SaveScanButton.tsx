import BookmarkIcon from '../../assets/icons/bookmark.svg?react'
import CheckIcon from '../../assets/icons/check.svg?react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

type Props = {
  state: SaveState
  onSave: () => void
}

// Keep the current result in the account as a "reading". The UI never says
// "save" for this: a save is the Minecraft world being scanned, and the two
// collided. Signed out, the page answers the click with the sign-in prompt
// rather than this button changing — so the button always means the same
// thing, and signing in is just a step on the way.
//
// Both states render inside one persistent live region, so "Kept" is announced
// when the button gives way to it. Focus moves to the link that replaces the
// button, rather than falling back to the page when the button unmounts.
export function SaveScanButton({ state, onSave }: Props) {
  return (
    <span aria-live="polite" className="inline-flex">
      <SaveScanControl state={state} onSave={onSave} />
    </span>
  )
}

function SaveScanControl({ state, onSave }: Props) {
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 font-medium text-emerald-200">
          <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Kept
        </span>
        <a
          autoFocus
          href={`${import.meta.env.BASE_URL}scans/`}
          className="text-violet-200/80 underline underline-offset-4 transition hover:text-violet-100"
        >
          Your readings
        </a>
      </span>
    )
  }

  const saving = state === 'saving'
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saving}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition disabled:cursor-wait ${
        state === 'failed'
          ? 'border-red-300/30 bg-red-500/10 text-red-100 hover:bg-red-500/20'
          : 'border-violet-300/40 text-violet-50 hover:border-violet-200/60 hover:bg-white/5'
      }`}
    >
      <BookmarkIcon className={`h-3.5 w-3.5 ${saving ? 'animate-pulse' : ''}`} aria-hidden="true" />
      {saving ? 'Keeping…' : state === 'failed' ? "Couldn't keep · retry" : 'Keep this reading'}
    </button>
  )
}
