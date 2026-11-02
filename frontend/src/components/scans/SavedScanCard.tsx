import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { KeyboardEvent, TransitionEvent } from 'react'
import { PortalLoader } from '../../assets/PortalLoader'
import CloseIcon from '../../assets/icons/close.svg?react'
import PencilIcon from '../../assets/icons/pencil.svg?react'
import TrashIcon from '../../assets/icons/trash.svg?react'
import { blockName } from '../../lib/blockTypes'
import { MAX_MATCHES } from '../../lib/scanOptions'
import { loadScanMatches } from '../../lib/savedScans'
import type { SavedScanSummary } from '../../lib/savedScans'
import { writeClipboard } from '../worldmap/clipboard'
import type { BlockMatch } from '../worldmap/types'
import { WorldMap } from '../worldmap/WorldMap'
import { ScanConstellation } from './ScanConstellation'
import { BlockTitle, DimensionBadge, SourceLabel } from './ScanMeta'
import { formatFull, timeAgo } from './when'

type Props = {
  scan: SavedScanSummary
  now: number
  // The page keeps one card open at a time; this card only asks.
  expanded: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
}

// The open/close animation's length; keep it in step with `duration-500` below.
const OPEN_MS = 500
// How long the opening scroll may run at most, however the layout moves.
const FOLLOW_MAX_MS = 1200
// The share of the remaining distance scrolled each frame.
const FOLLOW_EASE = 0.2
// Room left between the open card and the edge of the viewport.
const FOLLOW_MARGIN = 24
// Input that means the reader is scrolling for themselves.
const INTERRUPTS = ['wheel', 'touchstart', 'keydown'] as const

type MapState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; matches: BlockMatch[] }
  | { kind: 'failed'; message: string }

// One saved scan. Collapsed it is a summary row; pressing it opens the map in
// place, the same WorldMap the index page draws, under a larger header. The
// coordinates are fetched on open and dropped again once it has closed, so
// only the open card holds a map's worth of matches.
export function SavedScanCard({ scan, now, expanded, onToggle, onDelete, onRename }: Props) {
  const cardRef = useRef<HTMLLIElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  // Set just before a control is swapped out (the rename field, the delete
  // question), so the control that comes back takes focus as it mounts rather
  // than focus falling to the page.
  const refocusRef = useRef<'rename' | 'delete' | null>(null)
  const refocus = (which: 'rename' | 'delete') => (el: HTMLButtonElement | null) => {
    if (el && refocusRef.current === which) {
      refocusRef.current = null
      el.focus()
    }
  }
  // Cancels the scroll that follows an opening map, while one is running.
  const stopFollowRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopFollowRef.current?.(), [])
  // Bumped whenever a load is superseded, so a late response can't land on a
  // card that has since closed.
  const loadRef = useRef(0)
  const [map, setMap] = useState<MapState>({ kind: 'idle' })
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = () => {
    const ticket = ++loadRef.current
    setMap({ kind: 'loading' })
    loadScanMatches(scan.id)
      .then((matches) => {
        if (loadRef.current === ticket) setMap({ kind: 'ready', matches })
      })
      .catch((e: unknown) => {
        if (loadRef.current === ticket) {
          setMap({ kind: 'failed', message: e instanceof Error ? e.message : 'Could not load this map.' })
        }
      })
  }

  // Bring the whole map into view while it opens, not after: every frame, work
  // out where the card will end once the body is full height, and ease the
  // page a step toward showing it. Measuring live rather than once at the
  // click keeps it right while another card above is closing at the same time.
  const followOpen = () => {
    stopFollowRef.current?.()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let frame = 0
    const stopFollow = () => {
      cancelAnimationFrame(frame)
      for (const type of INTERRUPTS) window.removeEventListener(type, stopFollow)
      if (stopFollowRef.current === stopFollow) stopFollowRef.current = null
    }
    const step = (time: number) => {
      const card = cardRef.current
      const body = bodyRef.current
      const content = contentRef.current
      // Closed again before it finished opening.
      if (!card || !body || !content || body.inert) return stopFollow()
      const rect = card.getBoundingClientRect()
      const finalBottom = rect.bottom + content.offsetHeight - body.clientHeight
      const delta =
        rect.top < FOLLOW_MARGIN
          ? rect.top - FOLLOW_MARGIN
          : Math.max(0, Math.min(finalBottom - (window.innerHeight - FOLLOW_MARGIN), rect.top - FOLLOW_MARGIN))
      // Reduced motion has no height animation to follow: one jump does it.
      if (reduced) {
        window.scrollBy({ top: delta, behavior: 'instant' })
        return stopFollow()
      }
      if (Math.abs(delta) >= 1) window.scrollBy({ top: delta * FOLLOW_EASE, behavior: 'instant' })
      const elapsed = time - start
      if ((elapsed > OPEN_MS && Math.abs(delta) < 1) || elapsed > FOLLOW_MAX_MS) return stopFollow()
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    stopFollowRef.current = stopFollow
    // Any scroll of the reader's own wins over ours.
    for (const type of INTERRUPTS) window.addEventListener(type, stopFollow, { passive: true })
  }

  const toggle = () => {
    if (!expanded && map.kind !== 'ready') load()
    if (!expanded) followOpen()
    onToggle(scan.id)
  }

  // Close the map. If focus was inside the card, park it on the header button,
  // since whatever held it is about to go inert.
  const close = () => {
    if (cardRef.current?.contains(document.activeElement)) toggleRef.current?.focus()
    onToggle(scan.id)
  }

  // Escape closes the open map. The listener lives only while this one is open.
  const onEscape = useEffectEvent(close)
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  // Fires when the open/close height animation settles.
  const onBodyTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-rows') return
    if (!expanded) {
      loadRef.current++
      setMap({ kind: 'idle' })
    }
  }

  const remove = async () => {
    setDeleting(true)
    setActionError(null)
    try {
      await onDelete(scan.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete this reading.')
      setDeleting(false)
      setConfirming(false)
    }
  }

  const startRename = () => {
    setDraft(scan.name ?? '')
    setActionError(null)
    setEditing(true)
  }

  const commitRename = async () => {
    if (renaming) return
    if (draft.trim() === (scan.name ?? '')) {
      refocusRef.current = 'rename'
      setEditing(false)
      return
    }
    setRenaming(true)
    try {
      await onRename(scan.id, draft)
      refocusRef.current = 'rename'
      setEditing(false)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not rename this reading.')
    } finally {
      setRenaming(false)
    }
  }

  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitRename()
    if (event.key === 'Escape') {
      // Cancel the edit, not the open map behind it.
      event.stopPropagation()
      refocusRef.current = 'rename'
      setEditing(false)
    }
  }

  const copyCoordinates = async () => {
    if (map.kind !== 'ready') return
    if (await writeClipboard(JSON.stringify(map.matches))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const title = scan.name || blockName(scan.blockType) || scan.blockType

  return (
    <li
      ref={cardRef}
      className={`rounded-3xl border bg-slate-950/60 backdrop-blur-xl transition-[border-color,background-color,box-shadow,opacity] duration-500 ${
        expanded
          ? 'border-violet-300/30 shadow-2xl shadow-violet-950/50'
          : 'border-violet-300/15 shadow-xl shadow-black/20 hover:border-violet-300/30 hover:bg-slate-900/60'
      } ${deleting ? 'opacity-50' : ''}`}
    >
      {/* The header. One button under the whole of it opens and closes the
          map; the controls inside sit above that button. */}
      <div className="relative flex p-4 sm:p-5">
        <button
          ref={toggleRef}
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Close the map of ${title}` : `Open the map of ${title}`}
          className="absolute inset-0 cursor-pointer rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
        />

        <div
          className={`pointer-events-none shrink-0 overflow-hidden transition-[width,margin,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            expanded ? 'mr-0 w-0 opacity-0' : 'mr-4 w-20 opacity-100 sm:mr-5 sm:w-24'
          }`}
        >
          <ScanConstellation points={scan.preview} dimension={scan.dimension} />
        </div>

        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            {editing ? (
              <span className="grid min-w-0 flex-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onRenameKey}
                  onBlur={commitRename}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={renaming}
                  maxLength={100}
                  placeholder={blockName(scan.blockType) ?? scan.blockType}
                  aria-label="Reading name"
                  aria-describedby={`rename-hint-${scan.id}`}
                  className={`pointer-events-auto -mx-2 rounded-lg border border-violet-300/30 bg-white/5 px-2 font-semibold tracking-tight text-white outline-none placeholder:text-slate-400 focus:border-violet-300/60 focus:ring-2 focus:ring-violet-300/60 disabled:opacity-60 ${
                    expanded ? 'py-0.5 text-xl sm:text-2xl' : 'py-0 text-base'
                  }`}
                />
                <span id={`rename-hint-${scan.id}`} className="mt-1 text-[11px] text-slate-400">
                  Enter to rename · Esc to cancel · leave blank for the block&rsquo;s name
                </span>
              </span>
            ) : (
              <BlockTitle
                blockType={scan.blockType}
                name={scan.name}
                large={expanded}
                action={
                  <button
                    ref={refocus('rename')}
                    type="button"
                    onClick={startRename}
                    aria-label="Rename reading"
                    title="Rename"
                    className="pointer-events-auto shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-violet-100 focus-visible:text-violet-100"
                  >
                    <PencilIcon className={expanded ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden="true" />
                  </button>
                }
              />
            )}

            {expanded ? (
              <button
                type="button"
                onClick={close}
                aria-label="Close map"
                className="pointer-events-auto -mr-1.5 -mt-1.5 shrink-0 rounded-full border border-violet-300/20 bg-slate-950/60 p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <CloseIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <time
                dateTime={scan.scannedAt.toISOString()}
                title={`Scanned ${formatFull(scan.scannedAt)}`}
                className="shrink-0 pt-0.5 text-xs text-slate-400"
              >
                {timeAgo(scan.scannedAt, now)}
              </time>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <DimensionBadge dimension={scan.dimension} />
            <span className={`text-slate-300 ${expanded ? 'text-sm' : 'text-xs'}`}>
              <span className="font-medium text-violet-100">{scan.count.toLocaleString()}</span>{' '}
              {scan.count === 1 ? 'match' : 'matches'}
            </span>
            <SourceLabel source={scan.source} />
            {expanded ? (
              <time dateTime={scan.scannedAt.toISOString()} className="text-xs text-slate-400">
                Scanned {formatFull(scan.scannedAt)}
              </time>
            ) : null}

            {/* Delete lives at the end of this row; confirming swaps the bin
                for the question in place. */}
            <span className="ml-auto flex items-center gap-1">
              {confirming ? (
                <>
                  <span id={`delete-q-${scan.id}`} className="mr-1 text-xs text-red-100/80">
                    Delete this reading?
                  </span>
                  {/* Focus lands on the safe choice, and both answers carry
                      the question so it is heard with them. */}
                  <button
                    type="button"
                    autoFocus
                    aria-describedby={`delete-q-${scan.id}`}
                    onClick={() => {
                      refocusRef.current = 'delete'
                      setConfirming(false)
                    }}
                    disabled={deleting}
                    className="pointer-events-auto rounded-full px-3 py-1 text-xs text-slate-300 transition hover:bg-white/10"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    aria-describedby={`delete-q-${scan.id}`}
                    disabled={deleting}
                    className="pointer-events-auto rounded-full bg-red-500/80 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </>
              ) : (
                <button
                  ref={refocus('delete')}
                  type="button"
                  onClick={() => setConfirming(true)}
                  aria-label="Delete reading"
                  title="Delete"
                  className="pointer-events-auto -my-1 -mr-1.5 rounded-full p-1.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-200"
                >
                  <TrashIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </span>
          </div>

          {actionError ? (
            <p role="alert" className="mt-2 text-[11px] text-red-200">
              {actionError}
            </p>
          ) : scan.truncated ? (
            <p className="mt-2 text-[11px] text-amber-200/70">
              Map holds the first {MAX_MATCHES.toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>

      {/* The map. Height animates 0fr → 1fr, which needs no measuring. */}
      <div
        ref={bodyRef}
        onTransitionEnd={onBodyTransitionEnd}
        inert={!expanded}
        className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={contentRef}
            className={`px-4 pb-4 transition duration-500 sm:px-5 sm:pb-5 ${
              expanded ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
            }`}
          >
            <div className="overflow-hidden rounded-2xl border border-violet-300/10 bg-slate-950/50">
              {map.kind === 'ready' ? (
                <WorldMap matches={map.matches} />
              ) : (
                <div className="flex aspect-square items-center justify-center p-6 text-center">
                  {map.kind === 'failed' ? (
                    <div role="alert" className="grid justify-items-center gap-3">
                      <p className="text-sm text-red-100/90">{map.message}</p>
                      <button
                        type="button"
                        onClick={load}
                        className="rounded-full border border-violet-300/20 bg-violet-500/10 px-3.5 py-1.5 text-xs font-medium text-violet-100 transition hover:bg-violet-400/20"
                      >
                        Try again
                      </button>
                    </div>
                  ) : (
                    <div role="status">
                      <PortalLoader />
                      <span className="sr-only">Loading the map…</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {map.kind === 'ready' && map.matches.length > 0 ? (
                <button
                  type="button"
                  onClick={copyCoordinates}
                  className="rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:bg-violet-400/20"
                >
                  {copied ? 'Copied' : 'Copy coordinates as JSON'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
