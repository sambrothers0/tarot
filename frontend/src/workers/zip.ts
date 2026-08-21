// A read-only zip reader that never holds the archive in memory.
//
// This replaces JSZip, which has no random-access path at all: `loadAsync`
// pushes the whole Blob through `FileReader.readAsArrayBuffer` before it will
// parse a single byte, so opening a 1.2 GB save pinned 1.2 GB of heap for the
// length of the scan. That was the real ceiling on save size, not the scan.
//
// A `File` is a handle to bytes on disk and `Blob.slice()` is lazy — it
// describes a range without reading it, and bytes only move on `.arrayBuffer()`
// — so the archive can be read the way the format was designed for: the index
// lives at the tail, and every entry in it carries its own absolute offset.
// Resident memory becomes the central directory plus whatever members are
// deliberately in flight, flat in the size of the archive.
//
// Only the subset a Minecraft save needs is implemented: reading stored (0) and
// deflated (8) members, including Zip64. Encrypted members and unsupported
// compression methods are rejected rather than mis-read.

/** One entry from the central directory. Offsets are absolute in the archive. */
export type ZipEntry = {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  /** Offset of the member's *local* header, not of its data. */
  headerOffset: number
  encrypted: boolean
}

/** A member as stored, still compressed. `decompress` turns it into content. */
export type RawMember = {
  // Backed by its own `ArrayBuffer` throughout, so it stays transferable.
  data: Uint8Array<ArrayBuffer>
  method: number
  uncompressedSize: number
}

const EOCD_SIG = 0x06054b50
const EOCD64_SIG = 0x06064b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

const EOCD_FIXED = 22
const EOCD64_LOCATOR_FIXED = 20
const CENTRAL_FIXED = 46
const LOCAL_FIXED = 30
const MAX_COMMENT = 0xffff
// A 32-bit field holding this is a Zip64 sentinel: the real value is in the
// entry's `0x0001` extra field.
const ZIP64_SENTINEL = 0xffffffff

const CORRUPT = 'That zip file is damaged or is not a zip file.'

/**
 * Read exactly `length` bytes at `offset`. This is the only place bytes are
 * pulled off disk; everything above it works in offsets.
 */
async function readAt(blob: Blob, offset: number, length: number): Promise<DataView<ArrayBuffer>> {
  if (length === 0) return new DataView(new ArrayBuffer(0))
  if (offset < 0 || offset + length > blob.size) throw new Error(CORRUPT)
  const buffer = await blob.slice(offset, offset + length).arrayBuffer()
  if (buffer.byteLength !== length) {
    // A short read means the File handle no longer describes what is on disk.
    throw new Error('The save file could not be read. Has it moved or changed since you picked it?')
  }
  return new DataView(buffer)
}

/** A Zip64 64-bit field, narrowed to a JS number. */
function u64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('That zip file is too large to index.')
  return Number(value)
}

type Trailer = {
  cdOffset: number
  cdSize: number
  entryCount: number
  /** Where the trailing records start — i.e. where the directory must end. */
  trailerOffset: number
}

/**
 * Locate the end-of-central-directory record and read the directory's extent
 * from it. One read of at most 64 KB, from the tail.
 */
async function readTrailer(blob: Blob): Promise<Trailer> {
  const tailLength = Math.min(blob.size, EOCD_FIXED + MAX_COMMENT)
  if (tailLength < EOCD_FIXED) throw new Error(CORRUPT)
  const tailStart = blob.size - tailLength
  const tail = await readAt(blob, tailStart, tailLength)

  // Scan backwards for the signature. A zip comment may contain the signature
  // by chance, so a candidate only counts if its declared comment length
  // reaches exactly the end of the file.
  let eocd = -1
  for (let i = tailLength - EOCD_FIXED; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) !== EOCD_SIG) continue
    if (tail.getUint16(i + 20, true) === tailLength - i - EOCD_FIXED) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(CORRUPT)

  const trailer: Trailer = {
    entryCount: tail.getUint16(eocd + 10, true),
    cdSize: tail.getUint32(eocd + 12, true),
    cdOffset: tail.getUint32(eocd + 16, true),
    trailerOffset: tailStart + eocd,
  }

  // Above 4 GB or 65535 entries the 32-bit fields above are sentinels and the
  // real record sits behind a locator immediately before the EOCD. Detecting it
  // by the locator rather than by the sentinels is what makes an archive that
  // is *just* over the line read correctly.
  const locator = eocd - EOCD64_LOCATOR_FIXED
  if (locator >= 0 && tail.getUint32(locator, true) === EOCD64_LOCATOR_SIG) {
    const recordOffset = u64(tail, locator + 8)
    const record = await readAt(blob, recordOffset, 56)
    if (record.getUint32(0, true) !== EOCD64_SIG) throw new Error(CORRUPT)
    trailer.entryCount = u64(record, 32)
    trailer.cdSize = u64(record, 40)
    trailer.cdOffset = u64(record, 48)
    trailer.trailerOffset = recordOffset
  }

  return trailer
}

/** Pull the Zip64 sizes/offset out of an entry's `0x0001` extra field. */
function applyZip64Extra(
  view: DataView,
  start: number,
  end: number,
  entry: { compressedSize: number; uncompressedSize: number; headerOffset: number },
): void {
  for (let at = start; at + 4 <= end; ) {
    const id = view.getUint16(at, true)
    const size = view.getUint16(at + 2, true)
    const body = at + 4
    if (id !== 0x0001) {
      at = body + size
      continue
    }
    // The 64-bit fields are present only for the values that overflowed, in
    // this order and with nothing in between.
    let field = body
    const next = () => {
      if (field + 8 > Math.min(body + size, end)) throw new Error(CORRUPT)
      const value = u64(view, field)
      field += 8
      return value
    }
    if (entry.uncompressedSize === ZIP64_SENTINEL) entry.uncompressedSize = next()
    if (entry.compressedSize === ZIP64_SENTINEL) entry.compressedSize = next()
    if (entry.headerOffset === ZIP64_SENTINEL) entry.headerOffset = next()
    return
  }
  throw new Error(CORRUPT)
}

/**
 * Read and parse the central directory. This is the only whole-structure read:
 * a few hundred KB for a save with thousands of entries, against an archive
 * that may be many GB.
 */
export async function readCentralDirectory(blob: Blob): Promise<ZipEntry[]> {
  const trailer = await readTrailer(blob)
  if (trailer.cdSize === 0) return []

  let view = await readAt(blob, trailer.cdOffset, trailer.cdSize)
  let offsetDelta = 0
  if (view.getUint32(0, true) !== CENTRAL_SIG) {
    // Bytes glued onto the front of an archive (a self-extracting stub, say)
    // shift every recorded offset by a constant. The directory has to end where
    // the trailing records begin, so the shift is recoverable — and the
    // signature check below is what confirms the guess.
    const start = trailer.trailerOffset - trailer.cdSize
    offsetDelta = start - trailer.cdOffset
    view = await readAt(blob, start, trailer.cdSize)
    if (view.getUint32(0, true) !== CENTRAL_SIG) throw new Error(CORRUPT)
  }

  // Names are decoded as UTF-8 whether or not the entry claims it. The
  // alternative the format allows is CP437, which agrees with UTF-8 across
  // ASCII — and region file names (`r.-1.4.mca`) are ASCII.
  const decoder = new TextDecoder()
  const bytes = new Uint8Array(view.buffer)
  const entries: ZipEntry[] = []

  for (let at = 0; at + CENTRAL_FIXED <= view.byteLength && entries.length < trailer.entryCount; ) {
    if (view.getUint32(at, true) !== CENTRAL_SIG) throw new Error(CORRUPT)
    const flags = view.getUint16(at + 8, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const nameStart = at + CENTRAL_FIXED
    const extraStart = nameStart + nameLength
    if (extraStart + extraLength + commentLength > view.byteLength) throw new Error(CORRUPT)

    const entry: ZipEntry = {
      name: decoder.decode(bytes.subarray(nameStart, extraStart)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      headerOffset: view.getUint32(at + 42, true),
      // Bit 0 of the general purpose flags.
      encrypted: (flags & 0x1) !== 0,
    }
    if (
      entry.compressedSize === ZIP64_SENTINEL ||
      entry.uncompressedSize === ZIP64_SENTINEL ||
      entry.headerOffset === ZIP64_SENTINEL
    ) {
      applyZip64Extra(view, extraStart, extraStart + extraLength, entry)
    }
    entry.headerOffset += offsetDelta

    // Directories are entries too, and carry no data worth listing.
    if (!entry.name.endsWith('/')) entries.push(entry)
    at = extraStart + extraLength + commentLength
  }

  return entries
}

/**
 * Read one member's bytes as stored, still compressed. Two range reads: the
 * local header, then the payload.
 */
export async function readRaw(blob: Blob, entry: ZipEntry): Promise<RawMember> {
  if (entry.encrypted) throw new Error(`"${entry.name}" is encrypted, so it cannot be read.`)
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`"${entry.name}" uses compression method ${entry.method}, which is not supported.`)
  }

  const header = await readAt(blob, entry.headerOffset, LOCAL_FIXED)
  if (header.getUint32(0, true) !== LOCAL_SIG) throw new Error(CORRUPT)
  // The data offset has to come from the local header, whose name/extra lengths
  // may differ from the central directory's. Its *sizes* must not be used: a
  // zipper that streamed its output leaves them zero and writes the real values
  // to a data descriptor after the payload. The central directory is always
  // correct, which is why sizes are taken from `entry`.
  const dataOffset =
    entry.headerOffset + LOCAL_FIXED + header.getUint16(26, true) + header.getUint16(28, true)

  const payload = await readAt(blob, dataOffset, entry.compressedSize)
  return {
    // The DataView owns the slice's buffer exactly, so this is transferable
    // to a scan worker with no copy.
    data: new Uint8Array(payload.buffer),
    method: entry.method,
    uncompressedSize: entry.uncompressedSize,
  }
}

/**
 * Inflate a raw deflate stream — which is exactly what a zip member holds — into
 * a buffer of known size.
 */
async function inflateRaw(
  data: Uint8Array<ArrayBuffer>,
  expectedSize: number,
): Promise<Uint8Array<ArrayBuffer>> {
  // `BufferSource`, not `Uint8Array`: that is what `DecompressionStream`
  // declares as its writable side, and `pipeThrough` insists the two agree.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()

  // The size is known from the directory, so the output is allocated once
  // rather than grown and concatenated.
  const out = new Uint8Array(expectedSize)
  let written = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (written + value.length > out.length) throw new Error(CORRUPT)
    out.set(value, written)
    written += value.length
  }
  if (written !== expectedSize) throw new Error(CORRUPT)
  return out
}

/** Turn a stored member into its content. Stored members are already content. */
export function decompress(member: RawMember): Promise<Uint8Array<ArrayBuffer>> {
  // An empty member is answered without touching the decompressor: a save can
  // hold a zero-byte region file, and zippers disagree about whether such an
  // entry is stored or is a deflate stream of nothing.
  if (member.method === 0 || member.uncompressedSize === 0) {
    return Promise.resolve(member.uncompressedSize === 0 ? new Uint8Array(0) : member.data)
  }
  return inflateRaw(member.data, member.uncompressedSize)
}

/** Read one member and decompress it. For small members read up front. */
export async function readMember(blob: Blob, entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  return decompress(await readRaw(blob, entry))
}

/**
 * Fail early, and with a real explanation, on a browser without raw-deflate
 * decompression (pre-103 Chrome, pre-16.4 Safari, pre-113 Firefox) rather than
 * on an opaque constructor throw partway into a scan.
 */
export function assertDecompressionSupported(): void {
  try {
    new DecompressionStream('deflate-raw')
  } catch {
    throw new Error(
      'This browser cannot decompress zip files. Try Chrome 103+, Safari 16.4+, or Firefox 113+.',
    )
  }
}
