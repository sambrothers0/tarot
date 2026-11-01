import { assertDecompressionSupported, readCentralDirectory, readRaw } from './zip'
import type { RawMember } from './zip'

// Where a save's bytes come from. A save can be picked two ways — as a zip, or
// as the world folder itself — and this is the whole of the difference between
// them. Everything downstream (which files matter, the read-ahead bound, the
// scan pool) is written against `SaveEntry` and never learns which it got.
//
// The two are closer than they look. A zip member is `{ bytes, method }` where
// method 8 means deflated; a file on disk is the same thing with method 0,
// which `decompress()` already passes straight through. So a loose region file
// *is* a stored member, and the pool needs no special case for it.

/**
 * One file from a picked directory, paired with its path under that directory.
 *
 * The pairing is the point. `File.webkitRelativePath` is the only place that
 * path exists, and it does not survive the structured clone into this worker —
 * a `File` crosses as its bytes, name and mtime, and the relative path is not
 * part of that. So the path is read on the main thread, where the `File` still
 * has it, and travels alongside. Reading `webkitRelativePath` in here would
 * silently see `''` for every file and find no region files at all.
 */
export type FolderFile = { path: string; file: File }

/**
 * A save as picked in the UI. Both variants carry only handles — a multi-GB
 * save crosses to the coordinator worker by structured clone without a byte of
 * it being read, let alone copied.
 */
export type SaveInput =
  | { kind: 'zip'; name: string; file: Blob }
  | { kind: 'folder'; name: string; files: FolderFile[] }

/**
 * One file inside a save, whichever form the save took. `name` is its path
 * relative to the save root, `/`-separated, which is what `parseRegionPath()`
 * reads. `readRaw` yields the bytes *as stored* — deflated out of a zip, plain
 * off disk — because inflation belongs in the scan workers, not here.
 */
export type SaveEntry = {
  name: string
  readRaw(): Promise<RawMember>
}

/** List a save's files without reading any of them. */
export function openSave(input: SaveInput): Promise<SaveEntry[]> {
  return input.kind === 'zip' ? openZip(input.file) : Promise.resolve(openFolder(input.files))
}

async function openZip(blob: Blob): Promise<SaveEntry[]> {
  // Only this path inflates anything, so this is the only path that needs a
  // browser with raw-deflate support. A folder scan works without it.
  assertDecompressionSupported()
  // Reads the archive's index and nothing else; members stay on disk until the
  // pool asks for one.
  const entries = await readCentralDirectory(blob)
  return entries.map((entry) => ({ name: entry.name, readRaw: () => readRaw(blob, entry) }))
}

function openFolder(files: FolderFile[]): SaveEntry[] {
  return files.map(({ path, file }) => ({
    // Captured from `webkitRelativePath` on the main thread — see `FolderFile`.
    // It is '/'-separated on every platform, Windows included, so it parses
    // exactly like a zip member's name.
    name: path,
    async readRaw() {
      let buffer: ArrayBuffer
      try {
        buffer = await file.arrayBuffer()
      } catch {
        // A File is a snapshot of a path, size and mtime; the bytes are read
        // later. If Minecraft rewrote the region in between, this is where it
        // surfaces — a failure the zip path cannot have.
        throw new Error(
          `"${file.name}" could not be read. If that world is open in Minecraft, close it and scan again.`,
        )
      }
      return { data: new Uint8Array(buffer), method: 0, uncompressedSize: buffer.byteLength }
    },
  }))
}
