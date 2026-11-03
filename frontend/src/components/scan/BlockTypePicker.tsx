import { useId, useRef, useState } from 'react'
import CloseIcon from '../../assets/icons/close.svg?react'
import { addBlockType, BLOCK_TYPES, blockLabel, blockName } from '../../lib/blockTypes'
import { MAX_BLOCK_TYPES } from '../../lib/scanOptions'
import { LayerSwatch } from '../worldmap/LayerSwatch'

type Props = {
  blockTypes: string[]
  onBlockTypes: (blockTypes: string[]) => void
  // What's typed but not yet added. The page owns it so Scan can take a block
  // that was typed and never confirmed, which is what anyone would expect.
  draft: string
  onDraft: (draft: string) => void
  disabled: boolean
}

// The block types to scan for, as a token field: each chosen block is a chip
// wearing the glyph its pins will wear on the map, and the input at the end
// adds another. Picking a suggestion adds it straight away; typing adds on
// Enter. Backspace in an empty input takes the last chip back. The input stays
// free-text, so modded and newer blocks still scan.
export function BlockTypePicker({ blockTypes, onBlockTypes, draft, onDraft, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const labelId = useId()
  const hintId = useId()
  const listId = useId()
  const full = blockTypes.length >= MAX_BLOCK_TYPES

  const commit = (text: string) => {
    const next = addBlockType(blockTypes, text)
    setProblem(next.problem)
    if (next.problem == null) {
      onBlockTypes(next.blockTypes)
      onDraft('')
    }
  }

  const remove = (index: number) => {
    onBlockTypes(blockTypes.filter((_, i) => i !== index))
    setProblem(null)
    // The chip and its button are gone; keep the keyboard in the field.
    inputRef.current?.focus()
  }

  return (
    <div className="grid grid-cols-1 gap-2 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
          Block types
        </span>
        <span className="text-xs tabular-nums text-slate-400">
          {blockTypes.length} of {MAX_BLOCK_TYPES}
        </span>
      </div>

      {/* The field's border is its only boundary, so it holds 3:1 against the
          card (WCAG 1.4.11); white/35 is the faintest that does. Clicking
          anywhere in it that isn't a chip's button lands in the input. */}
      <div
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
        className={`flex min-h-12 flex-wrap items-center gap-1.5 rounded-2xl border border-white/35 bg-white/5 p-1.5 transition focus-within:border-violet-300/60 focus-within:ring-2 focus-within:ring-violet-300 ${
          disabled ? 'opacity-70' : 'cursor-text'
        }`}
      >
        <ul aria-labelledby={labelId} className="contents">
          {blockTypes.map((id, i) => {
            const label = blockLabel(id)
            return (
              <li
                key={id}
                title={id}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] py-1 pl-2.5 pr-1 text-sm text-slate-100"
              >
                <LayerSwatch layer={i} layerCount={blockTypes.length} size={12} />
                <span className="truncate">{label}</span>
                {/* A modded or unknown block has no English name; its ID is
                    the label, so there's nothing more to add. */}
                {blockName(id) == null ? null : <span className="sr-only">({id})</span>}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove ${label}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none"
                >
                  <CloseIcon className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>

        {full ? (
          <span className="px-2 py-1.5 text-xs text-slate-400">Remove one to add another</span>
        ) : (
          // The hint is our own overlay, not a native placeholder: Chrome was
          // seen leaving the placeholder painted under typed text here. This
          // one exists only while the draft is empty, so it can't linger.
          <div className="relative min-w-40 flex-1">
            {draft === '' ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 truncate px-2 py-1.5 text-sm text-slate-400"
              >
                {blockTypes.length === 0 ? 'minecraft:nether_portal' : 'Add another block'}
              </span>
            ) : null}
            <input
              ref={inputRef}
              type="text"
              value={draft}
              disabled={disabled}
              aria-labelledby={labelId}
              aria-describedby={hintId}
              onChange={(event) => {
                const value = event.target.value
                setProblem(null)
                // A suggestion picked from the list arrives as one replacement
                // rather than typing, so it can be added on the spot. Typing
                // `minecraft:stone` must not, or `stone_bricks` could never be
                // reached.
                const native = event.nativeEvent as InputEvent
                const picked =
                  native.inputType === 'insertReplacementText' || native.inputType === undefined
                if (picked && BLOCK_IDS.has(value)) commit(value)
                else onDraft(value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commit(draft)
                } else if (event.key === 'Backspace' && draft === '' && blockTypes.length > 0) {
                  event.preventDefault()
                  remove(blockTypes.length - 1)
                }
              }}
              list={listId}
              autoComplete="off"
              spellCheck={false}
              className="relative w-full bg-transparent px-2 py-1.5 text-sm text-slate-100 outline-none focus-visible:outline-none"
            />
          </div>
        )}
        <datalist id={listId}>
          {BLOCK_TYPES.map((block) => (
            <option key={block.id} value={block.id}>
              {block.name}
            </option>
          ))}
        </datalist>
      </div>

      {/* Why an add didn't happen, and nothing otherwise. Always mounted and
          polite, so a refused add is spoken without stealing focus. */}
      <p id={hintId} aria-live="polite" className="text-xs text-amber-200 empty:hidden">
        {problem}
      </p>
    </div>
  )
}

const BLOCK_IDS = new Set(BLOCK_TYPES.map((block) => block.id))
