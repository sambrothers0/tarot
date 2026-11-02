import { SOURCES } from '../../lib/scanOptions'
import type { SourceKind } from '../../lib/scanOptions'
import type { SaveInput } from '../../workers/source'

type Props = {
  sourceKind: SourceKind
  onSourceKind: (kind: SourceKind) => void
  onSave: (save: SaveInput | null) => void
  // Nothing of the visitor's own is picked, so Scan will use the sample world.
  usingSample: boolean
  disabled: boolean
}

// Picking the save: the zip/folder toggle and the file input it drives. The
// browser hands over handles here; nothing is read until the scan starts.
export function SavePicker({ sourceKind, onSourceKind, onSave, usingSample, disabled }: Props) {
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
                  ? 'border-violet-300/60 text-violet-50'
                  : 'border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/5'
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
        aria-describedby={usingSample ? `${SAMPLE_ID} ${HINT_ID}` : HINT_ID}
        onChange={(event) => onSave(readSelection(sourceKind, event.target.files))}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border file:border-solid file:border-violet-300/40 file:bg-transparent file:px-4 file:py-2 file:text-sm file:font-medium file:text-violet-100 hover:bg-white/7"
      />
      {/* The input can't display a selection it didn't make, so it reads "No
          file chosen". This line says what is selected: the sample world,
          until the visitor picks a save. It goes away once they do. */}
      {usingSample ? (
        <p id={SAMPLE_ID} className="text-xs leading-5 text-slate-300">
          <span className="font-medium text-violet-100">Sample world</span> selected until you
          choose your own.
        </p>
      ) : null}
      <SaveHint id={HINT_ID} sourceKind={sourceKind} />
    </div>
  )
}

const HINT_ID = 'save-hint'
const SAMPLE_ID = 'save-sample'

// What a player wants to know before picking: where the thing is, whether it
// leaves the machine, and what could go wrong. Folder mode has the most to say —
// Chrome's own picker calls it an "upload", which is exactly the fear to answer.
function SaveHint({ id, sourceKind }: { id: string; sourceKind: SourceKind }) {
  if (sourceKind === 'zip') {
    return (
      <p id={id} className="text-xs leading-5 text-slate-400">
        Read on this device, never uploaded. A save of several GB can take a few minutes,
        depending on your computer.
      </p>
    )
  }
  return (
    <ul id={id} className="grid gap-1 text-xs leading-5 text-slate-400">
      <li>
        Pick the world’s own folder, inside{' '}
        <span className="font-mono text-[0.6875rem] text-violet-100/90">.minecraft/saves</span>.
      </li>
      <li>Your browser may call it an “upload”. Nothing leaves this computer.</li>
      <li>Close the world in Minecraft first, so its files hold still during the scan.</li>
    </ul>
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
  if (sourceKind === 'zip') return { kind: 'zip', name: files[0].name, file: files[0] }
  const paths = Array.from(files, (file) => file.webkitRelativePath || file.name)
  return {
    kind: 'folder',
    // The picked directory is the first segment of every relative path.
    name: paths[0].split('/')[0],
    files: Array.from(files, (file, i) => ({ path: paths[i], file })),
  }
}
