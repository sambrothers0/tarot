import { describe, expect, it } from 'vitest'
import { buildZip } from '../test/zipWriter'
import type { ZipMemberSpec, ZipOptions } from '../test/zipWriter'
import { assertDecompressionSupported, decompress, readCentralDirectory, readRaw } from './zip'

const text = (s: string) => new TextEncoder().encode(s)
const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>])

/** A deterministic, poorly-compressible payload of `n` bytes. */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    out[i] = s >>> 24
  }
  return out
}

/** Open an archive and read every member back to its content, by name. */
async function readAll(members: ZipMemberSpec[], options?: ZipOptions) {
  const archive = blob(buildZip(members, options))
  const entries = await readCentralDirectory(archive)
  const contents = new Map<string, Uint8Array>()
  for (const entry of entries) {
    contents.set(entry.name, await decompress(await readRaw(archive, entry)))
  }
  return { entries, contents }
}

const SAMPLE: ZipMemberSpec[] = [
  { name: 'world/level.dat', data: text('level'), method: 0 },
  { name: 'world/region/', method: 0 },
  { name: 'world/region/r.0.0.mca', data: noise(10_000), method: 8 },
  { name: 'world/region/r.-1.0.mca', data: new Uint8Array(20_000), method: 8 },
  { name: 'world/region/r.5.5.mca', data: new Uint8Array(0), method: 8 },
  { name: 'world/DIM-1/region/r.0.0.mca', data: noise(5000, 2), method: 0 },
]

function expectSampleContents(contents: Map<string, Uint8Array>) {
  expect([...contents.keys()]).toEqual([
    'world/level.dat',
    'world/region/r.0.0.mca',
    'world/region/r.-1.0.mca',
    'world/region/r.5.5.mca',
    'world/DIM-1/region/r.0.0.mca',
  ])
  expect(contents.get('world/level.dat')).toEqual(text('level'))
  expect(contents.get('world/region/r.0.0.mca')).toEqual(noise(10_000))
  expect(contents.get('world/region/r.-1.0.mca')).toEqual(new Uint8Array(20_000))
  expect(contents.get('world/region/r.5.5.mca')).toEqual(new Uint8Array(0))
  expect(contents.get('world/DIM-1/region/r.0.0.mca')).toEqual(noise(5000, 2))
}

describe('readCentralDirectory + readRaw', () => {
  it('reads stored and deflated members, skipping directory entries', async () => {
    const { entries, contents } = await readAll(SAMPLE)
    expectSampleContents(contents)
    const r00 = entries.find((e) => e.name === 'world/region/r.0.0.mca')
    expect(r00).toMatchObject({ method: 8, uncompressedSize: 10_000, encrypted: false })
  })

  it('takes sizes from the central directory when local headers were streamed', async () => {
    const { contents } = await readAll(SAMPLE, { streamed: true })
    expectSampleContents(contents)
  })

  it('reads Zip64 sizes, offsets and end records', async () => {
    const { entries, contents } = await readAll(SAMPLE, { zip64: true })
    expectSampleContents(contents)
    expect(entries.every((e) => e.headerOffset < 2 ** 32 - 1)).toBe(true)
  })

  it('recovers offsets when bytes are prepended (self-extracting stub)', async () => {
    const { contents } = await readAll(SAMPLE, { prefix: noise(777, 3) })
    expectSampleContents(contents)
  })

  it('finds the real EOCD behind a comment that contains its signature', async () => {
    const fakeEocd = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Uint8Array(30)])
    const { contents } = await readAll(SAMPLE, { comment: fakeEocd })
    expectSampleContents(contents)
  })

  it('locates data past a local extra field that differs from the central one', async () => {
    const { contents } = await readAll([
      { name: 'a.bin', data: noise(300), method: 0, localExtra: noise(37, 9) },
      { name: 'b.bin', data: noise(300, 4), method: 8, localExtra: noise(5, 8) },
    ])
    expect(contents.get('a.bin')).toEqual(noise(300))
    expect(contents.get('b.bin')).toEqual(noise(300, 4))
  })

  it('decodes UTF-8 member names', async () => {
    const { entries } = await readAll([{ name: 'Mondé ✨/region/r.0.0.mca', data: text('x'), method: 0 }])
    expect(entries[0].name).toBe('Mondé ✨/region/r.0.0.mca')
  })

  it('returns no entries for an empty archive', async () => {
    expect(await readCentralDirectory(blob(buildZip([])))).toEqual([])
  })

  it('hands back a transferable buffer that is exactly the payload', async () => {
    const archive = blob(buildZip(SAMPLE))
    const [entry] = (await readCentralDirectory(archive)).filter((e) => e.name.endsWith('r.0.0.mca'))
    const raw = await readRaw(archive, entry)
    expect(raw.data.byteOffset).toBe(0)
    expect(raw.data.buffer.byteLength).toBe(entry.compressedSize)
  })
})

describe('rejections', () => {
  const corrupt = /damaged or is not a zip/

  it('rejects things that are not zips', async () => {
    await expect(readCentralDirectory(blob(new Uint8Array(0)))).rejects.toThrow(corrupt)
    await expect(readCentralDirectory(blob(new Uint8Array(10)))).rejects.toThrow(corrupt)
    await expect(readCentralDirectory(blob(noise(100_000)))).rejects.toThrow(corrupt)
  })

  it('rejects a truncated archive', async () => {
    const archive = buildZip(SAMPLE)
    // Lose the head: the directory now sits past where the EOCD says it is.
    await expect(readCentralDirectory(blob(archive.subarray(200)))).rejects.toThrow(corrupt)
    // Lose the tail: no EOCD at all.
    await expect(readCentralDirectory(blob(archive.subarray(0, archive.length - 10)))).rejects.toThrow(
      corrupt,
    )
  })

  it('rejects a corrupted central directory signature', async () => {
    const archive = buildZip(SAMPLE)
    const view = new DataView(archive.buffer)
    const cdOffset = view.getUint32(archive.length - 6, true)
    archive[cdOffset] ^= 0xff
    await expect(readCentralDirectory(blob(archive))).rejects.toThrow(corrupt)
  })

  it('rejects a member whose local header is gone', async () => {
    const archive = buildZip(SAMPLE)
    const entries = await readCentralDirectory(blob(archive))
    archive[entries[0].headerOffset] ^= 0xff
    await expect(readRaw(blob(archive), entries[0])).rejects.toThrow(corrupt)
  })

  it('refuses encrypted members and unsupported methods by name', async () => {
    const archive = blob(
      buildZip([
        { name: 'secret.mca', data: text('x'), method: 0, encrypted: true },
        { name: 'bzip.mca', data: text('x'), method: 12 },
      ]),
    )
    const [secret, bzip] = await readCentralDirectory(archive)
    await expect(readRaw(archive, secret)).rejects.toThrow('"secret.mca" is encrypted')
    await expect(readRaw(archive, bzip)).rejects.toThrow('compression method 12')
  })

  it('notices when the file shrinks under it', async () => {
    const archive = buildZip(SAMPLE)
    const entries = await readCentralDirectory(blob(archive))
    const last = entries[entries.length - 1]
    // A Blob whose slice() comes back short, as a File does after the file on
    // disk changed.
    const shrinking = {
      size: archive.length,
      slice: (start: number, end: number) => blob(archive.subarray(start, Math.max(start, end - 1))),
    } as unknown as Blob
    await expect(readRaw(shrinking, last)).rejects.toThrow(/moved or changed/)
  })
})

describe('decompress', () => {
  it('passes stored members through untouched', async () => {
    const data = noise(64) as Uint8Array<ArrayBuffer>
    expect(await decompress({ data, method: 0, uncompressedSize: 64 })).toBe(data)
  })

  it('answers empty members without touching the inflater', async () => {
    // Not a valid deflate stream: an empty member must never reach it.
    const data = new Uint8Array([0xff, 0xff])
    expect(await decompress({ data, method: 8, uncompressedSize: 0 })).toEqual(new Uint8Array(0))
  })

  it('rejects a deflate stream whose size disagrees with the directory', async () => {
    const archive = blob(buildZip([{ name: 'r.mca', data: noise(1000), method: 8 }]))
    const [entry] = await readCentralDirectory(archive)
    const raw = await readRaw(archive, entry)
    await expect(decompress({ ...raw, uncompressedSize: 999 })).rejects.toThrow()
    await expect(decompress({ ...raw, uncompressedSize: 1001 })).rejects.toThrow()
  })

  it('rejects garbage claiming to be deflated', async () => {
    await expect(
      decompress({ data: noise(100) as Uint8Array<ArrayBuffer>, method: 8, uncompressedSize: 100 }),
    ).rejects.toThrow()
  })
})

describe('assertDecompressionSupported', () => {
  it('passes where DecompressionStream supports deflate-raw', () => {
    expect(() => assertDecompressionSupported()).not.toThrow()
  })

  it('explains itself where it does not', () => {
    const original = globalThis.DecompressionStream
    globalThis.DecompressionStream = class {
      constructor() {
        throw new TypeError('Unsupported compression format')
      }
    } as unknown as typeof DecompressionStream
    try {
      expect(() => assertDecompressionSupported()).toThrow(/Chrome 103\+/)
    } finally {
      globalThis.DecompressionStream = original
    }
  })
})
