import { BLOCK_TYPES } from '../../lib/blockTypes'
import { dimensionLabel } from '../../lib/scanOptions'
import type { Dimension, Phase, SourceKind } from '../../lib/scanOptions'
import type { SaveInput } from '../../workers/source'
import { DimensionToggle } from './DimensionToggle'
import { SavePicker } from './SavePicker'

type Props = {
  sourceKind: SourceKind
  onSourceKind: (kind: SourceKind) => void
  onSave: (save: SaveInput | null) => void
  blockType: string
  onBlockType: (value: string) => void
  dimension: Dimension
  onDimension: (dimension: Dimension) => void
  phase: Phase
  // No save of the visitor's own is picked, so Scan uses the sample world.
  usingSample: boolean
  onSubmit: () => void
}

// The label names what will be scanned, so nobody runs the sample by accident
// when they meant to pick their own world first.
const submitLabel = (phase: Phase, usingSample: boolean) =>
  phase === 'opening'
    ? 'Opening save…'
    : phase === 'scanning'
      ? 'Scanning…'
      : usingSample
        ? 'Scan the sample world'
        : 'Scan world'

// What to scan and where: the save, the block type, the dimension, and the
// button that starts it. All of it is controlled by the page — the form holds no
// state of its own.
export function ScanForm({
  sourceKind,
  onSourceKind,
  onSave,
  blockType,
  onBlockType,
  dimension,
  onDimension,
  phase,
  usingSample,
  onSubmit,
}: Props) {
  const busy = phase !== 'idle'

  return (
    // `grid-cols-1` is minmax(0, 1fr): without it the file input's intrinsic
    // width sets the track, and on a 320px screen the form overflows its card.
    <div className="grid grid-cols-1 gap-6">
      <SavePicker
        sourceKind={sourceKind}
        onSourceKind={onSourceKind}
        onSave={onSave}
        usingSample={usingSample}
        disabled={busy}
      />

      <label className="grid grid-cols-1 gap-2 text-left">
        <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
          Block type
        </span>
        {/* The border is the field's only boundary, so it holds 3:1 against the
            card (WCAG 1.4.11); white/35 is the faintest that does. */}
        <input
          type="text"
          value={blockType}
          onChange={(event) => onBlockType(event.target.value)}
          placeholder="minecraft:nether_portal"
          list="block-types"
          autoComplete="off"
          spellCheck={false}
          className="rounded-2xl border border-white/35 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-400 focus-visible:border-violet-300/60 focus-visible:ring-2 focus-visible:ring-violet-300"
        />
        <datalist id="block-types">
          {BLOCK_TYPES.map((block) => (
            <option key={block.id} value={block.id}>
              {block.name}
            </option>
          ))}
        </datalist>
      </label>

      <div className="grid grid-cols-1 gap-2 text-left">
        {/* The stops are icons, so the chosen one is also named in words. The
            radios already tell a screen reader, hence aria-hidden. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
            Dimension
          </span>
          <span aria-hidden="true" className="text-xs font-medium text-violet-100">
            {dimensionLabel(dimension)}
          </span>
        </div>
        <DimensionToggle dimension={dimension} onDimension={onDimension} disabled={busy} />
      </div>

      {/* The one filled element in the card: everything else is outline or
          field, so the action outranks the choices that feed it. There is
          always something to scan, since the sample world stands in until a
          save is picked. */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="rounded-full bg-violet-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/60 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:translate-y-px disabled:cursor-wait disabled:bg-violet-600/70 disabled:text-violet-100"
      >
        {submitLabel(phase, usingSample)}
      </button>
    </div>
  )
}
