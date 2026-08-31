import { DIMENSIONS } from '../../lib/scanOptions'
import type { Dimension, Phase, SourceKind } from '../../lib/scanOptions'
import type { SaveInput } from '../../workers/source'
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
  onSubmit: () => void
}

const submitLabel = (phase: Phase) =>
  phase === 'opening' ? 'Opening save...' : phase === 'scanning' ? 'Scanning...' : 'Scan world'

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
  onSubmit,
}: Props) {
  const busy = phase !== 'idle'

  return (
    <div className="grid gap-4">
      <SavePicker
        sourceKind={sourceKind}
        onSourceKind={onSourceKind}
        onSave={onSave}
        disabled={busy}
      />

      <label className="grid gap-2 text-left">
        <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
          Block type
        </span>
        <input
          type="text"
          value={blockType}
          onChange={(event) => onBlockType(event.target.value)}
          placeholder="minecraft:nether_portal"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-300/40"
        />
      </label>

      <div className="grid gap-2 text-left">
        <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
          Dimension
        </span>
        <div role="group" aria-label="Dimension" className="grid grid-cols-3 gap-2">
          {DIMENSIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={dimension === option.id}
              disabled={busy}
              onClick={() => onDimension(option.id)}
              className={`rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                dimension === option.id
                  ? 'border-violet-300/40 bg-violet-500/20 text-violet-50 shadow-sm shadow-violet-500/20'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="rounded-full border border-violet-300/20 bg-violet-500/10 px-5 py-3 text-sm font-medium text-violet-100 shadow-sm transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitLabel(phase)}
      </button>
    </div>
  )
}
