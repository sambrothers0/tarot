import { dimensionLabel } from '../../lib/scanOptions'
import type { Dimension, Phase, SourceKind } from '../../lib/scanOptions'
import type { SaveInput } from '../../workers/source'
import { BlockTypePicker } from './BlockTypePicker'
import { DimensionToggle } from './DimensionToggle'
import { SavePicker } from './SavePicker'

type Props = {
  sourceKind: SourceKind
  onSourceKind: (kind: SourceKind) => void
  onSave: (save: SaveInput | null) => void
  blockTypes: string[]
  onBlockTypes: (blockTypes: string[]) => void
  blockDraft: string
  onBlockDraft: (draft: string) => void
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

// What to scan and where: the save, the block types, the dimension, and the
// button that starts it. All of it is controlled by the page — the form holds no
// state of its own.
export function ScanForm({
  sourceKind,
  onSourceKind,
  onSave,
  blockTypes,
  onBlockTypes,
  blockDraft,
  onBlockDraft,
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

      <BlockTypePicker
        blockTypes={blockTypes}
        onBlockTypes={onBlockTypes}
        draft={blockDraft}
        onDraft={onBlockDraft}
        disabled={busy}
      />

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
