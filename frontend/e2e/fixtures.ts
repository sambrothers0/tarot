import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildWorld } from '../src/test/world'
import { buildZip } from '../src/test/zipWriter'

// Writes the synthetic save to disk in every shape the picker accepts, so the
// browser can be handed real files. Built fresh per run; nothing is committed.

export type Fixtures = {
  /** The world zipped with its root folder, members deflated. */
  zip: string
  /** The same world zipped *without* a root folder, members stored. */
  flatZip: string
  /** The world as a folder on disk (the directory that holds level.dat). */
  folder: string
  /** A directory holding two worlds, like `saves/`. */
  savesFolder: string
  /** A zip with no region files at all. */
  emptyZip: string
  /** Not a zip. */
  notZip: string
}

function writeTree(root: string, files: Map<string, Uint8Array>) {
  for (const [rel, bytes] of files) {
    const file = path.join(root, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
}

export function writeFixtures(): Fixtures {
  const dir = mkdtempSync(path.join(tmpdir(), 'tarot-e2e-'))
  const world = buildWorld('TestWorld')

  const zip = path.join(dir, 'TestWorld.zip')
  writeFileSync(zip, buildZip([...world].map(([name, data]) => ({ name, data, method: 8 }))))

  const flatZip = path.join(dir, 'flat.zip')
  writeFileSync(
    flatZip,
    buildZip(
      [...world].map(([name, data]) => ({ name: name.slice('TestWorld/'.length), data, method: 0 })),
    ),
  )

  writeTree(path.join(dir, 'folder'), world)
  const saves = path.join(dir, 'saves')
  writeTree(saves, world)
  writeTree(saves, buildWorld('OtherWorld'))

  const emptyZip = path.join(dir, 'empty.zip')
  writeFileSync(emptyZip, buildZip([{ name: 'TestWorld/level.dat', data: new Uint8Array([1, 2, 3]) }]))

  const notZip = path.join(dir, 'notes.zip')
  writeFileSync(notZip, 'definitely not a zip file\n'.repeat(100))

  return {
    zip,
    flatZip,
    folder: path.join(dir, 'folder', 'TestWorld'),
    savesFolder: saves,
    emptyZip,
    notZip,
  }
}
