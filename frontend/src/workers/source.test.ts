import { describe, expect, it } from 'vitest'
import { buildWorld } from '../test/world'
import { buildZip } from '../test/zipWriter'
import { openSave } from './source'
import type { FolderFile, SaveEntry } from './source'
import { decompress } from './zip'

// The two ways to pick a save must be indistinguishable downstream: same names,
// same bytes once decompressed. That is what makes "zip and folder report
// identical counts" hold.

const world = buildWorld()

const asFolder = (): FolderFile[] =>
  [...world].map(([path, bytes]) => ({
    path,
    file: new File([bytes as Uint8Array<ArrayBuffer>], path.slice(path.lastIndexOf('/') + 1)),
  }))

const asZip = () =>
  new Blob([
    buildZip([...world].map(([name, data]) => ({ name, data, method: 8 }))) as Uint8Array<ArrayBuffer>,
  ])

async function contents(entries: SaveEntry[]) {
  const out = new Map<string, Uint8Array>()
  for (const entry of entries) out.set(entry.name, await decompress(await entry.readRaw()))
  return out
}

describe('openSave', () => {
  it('lists a folder by the paths captured on the main thread', async () => {
    const entries = await openSave({ kind: 'folder', name: 'TestWorld', files: asFolder() })
    expect(entries.map((e) => e.name)).toEqual([...world.keys()])
  })

  it('reads folder files as stored (method 0) members', async () => {
    const [entry] = await openSave({ kind: 'folder', name: 'TestWorld', files: asFolder() })
    const raw = await entry.readRaw()
    expect(raw.method).toBe(0)
    expect(raw.uncompressedSize).toBe(raw.data.byteLength)
  })

  it('yields the same names and bytes from a zip as from the folder', async () => {
    const fromFolder = await contents(
      await openSave({ kind: 'folder', name: 'TestWorld', files: asFolder() }),
    )
    const fromZip = await contents(await openSave({ kind: 'zip', name: 'TestWorld.zip', file: asZip() }))
    expect([...fromZip.keys()]).toEqual([...fromFolder.keys()])
    for (const [name, bytes] of fromFolder) expect(fromZip.get(name), name).toEqual(bytes)
  })

  it('tells the user to close Minecraft when a folder file cannot be read', async () => {
    const vanished = {
      name: 'r.0.0.mca',
      arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
    } as unknown as File
    const [entry] = await openSave({
      kind: 'folder',
      name: 'w',
      files: [{ path: 'w/region/r.0.0.mca', file: vanished }],
    })
    await expect(entry.readRaw()).rejects.toThrow(/"r.0.0.mca" could not be read.*close it/)
  })

  it('does not need DecompressionStream for a folder', async () => {
    const original = globalThis.DecompressionStream
    // @ts-expect-error simulating an older browser
    delete globalThis.DecompressionStream
    try {
      const entries = await openSave({ kind: 'folder', name: 'TestWorld', files: asFolder() })
      expect(entries.length).toBe(world.size)
      await expect(openSave({ kind: 'zip', name: 'w.zip', file: asZip() })).rejects.toThrow(
        /cannot decompress zip files/,
      )
    } finally {
      globalThis.DecompressionStream = original
    }
  })
})
