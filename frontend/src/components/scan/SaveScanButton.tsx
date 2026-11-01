import BookmarkIcon from '../../assets/icons/bookmark.svg?react'
import CheckIcon from '../../assets/icons/check.svg?react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

type Props = {
  state: SaveState
  onSave: () => void
}

// Keep the current result in the account. Signed out, the page answers the
// click with the sign-in prompt rather than this button changing — so "Save"
// always means the same thing, and signing in is just a step on the way.
export function SaveScanButton({ state, onSave }: Props) {
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 font-medium text-emerald-200">
          <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Saved
        </span>
        <a
          href={`${import.meta.env.BASE_URL}scans/`}
          className="text-violet-200/80 underline underline-offset-4 transition hover:text-violet-100"
        >
          View saved scans
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
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition disabled:cursor-wait ${
        state === 'failed'
          ? 'border-red-300/30 bg-red-500/10 text-red-100 hover:bg-red-500/20'
          : 'border-violet-300/40 bg-violet-500/25 text-violet-50 shadow-sm shadow-violet-500/20 hover:bg-violet-400/35'
      }`}
    >
      <BookmarkIcon className={`h-3.5 w-3.5 ${saving ? 'animate-pulse' : ''}`} aria-hidden="true" />
      {saving ? 'Saving…' : state === 'failed' ? "Couldn't save · retry" : 'Save scan'}
    </button>
  )
}
