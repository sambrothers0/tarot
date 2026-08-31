import { SOURCES } from '../../lib/scanOptions'
import type { SourceKind } from '../../lib/scanOptions'
import type { SaveInput } from '../../workers/source'

type Props = {
  sourceKind: SourceKind
  onSourceKind: (kind: SourceKind) => void
  onSave: (save: SaveInput | null) => void
  disabled: boolean
}

// Picking the save: the zip/folder toggle and the file input it drives. The
// browser hands over handles here; nothing is read until the scan starts.
export function SavePicker({ sourceKind, onSourceKind, onSave, disabled }: Props) {
  return (
    <div className="grid gap-2 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.35em] text-violet-200/70">
          Save
        </span>
        {/* Deliberately not inside a <label>: a button in there would also trip
            the file input the label wraps. */}
        <div role="group" aria-label="Save format" className="flex gap-1">
          {SOURCES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sourceKind === option.id}
              disabled={disabled}
              onClick={() => onSourceKind(option.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                sourceKind === option.id
                  ? 'border-violet-300/40 bg-violet-500/20 text-violet-50'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Remounted per mode (`key`) — `webkitdirectory` is unreliable to toggle
          on a live input, and a fresh element also drops the previous pick,
          which is what we want when the mode changes. */}
      <input
        key={sourceKind}
        type="file"
        aria-label={sourceKind === 'zip' ? 'Zip file' : 'Save folder'}
        accept={sourceKind === 'zip' ? '.zip,application/zip' : undefined}
        webkitdirectory={sourceKind === 'folder' ? '' : undefined}
        onChange={(event) => onSave(readSelection(sourceKind, event.target.files))}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-violet-400/20 file:px-4 file:py-2 file:text-sm file:font-medium file:text-violet-100 hover:bg-white/7"
      />
      <span className="text-xs text-slate-500">
        {sourceKind === 'zip'
          ? 'Zipped save folder · scanned locally on your device'
          : 'The save folder itself · scanned locally on your device'}
      </span>
    </div>
  )
}

// Folder mode hands over every file under the directory — thousands of handles,
// none of them read. The coordinator picks out the region files it needs.
//
// `webkitRelativePath` has to be read *here*, on the main thread: it is the only
// record of where in the save a file sits, and it does not survive the
// structured clone into the worker. Pairing it with the File is what
// `FolderFile` is for.
function readSelection(sourceKind: SourceKind, files: FileList | null): SaveInput | null {
  if (!files || files.length === 0) return null
  if (sourceKind === 'zip') return { kind: 'zip', file: files[0] }
  return {
    kind: 'folder',
    files: Array.from(files).map((file) => ({
      path: file.webkitRelativePath || file.name,
      file,
    })),
  }
}
