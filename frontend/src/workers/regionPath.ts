// A save keeps each dimension's block data in a directory literally named
// `region`, identified by its parent (`DIM-1` = Nether, `DIM1` = End, anything
// else = Overworld). Everything else in a save — `entities`, `poi`,
// `playerdata`, `level.dat`, … — is irrelevant to a block search and is never
// read. This used to be mirrored by a `_region_dimension` in the Python
// backend; now that the scan runs in the browser, this is the only copy.
//
// `world` is everything above the dimension directory: the save root this file
// belongs to. It exists to catch a selection holding more than one world, which
// would otherwise plot two worlds' overworlds on one map. Picking a folder
// makes that easy to do by accident — `saves/` is one click above the world.
export type RegionPath = { dimension: string; world: string }

export function parseRegionPath(name: string): RegionPath | null {
  if (!name.endsWith('.mca') && !name.endsWith('.mcc')) return null
  const parts = name.split('/').filter(Boolean)
  if (parts.length < 2 || parts[parts.length - 2] !== 'region') return null
  const parent = parts.length >= 3 ? parts[parts.length - 3] : ''
  if (parent === 'DIM-1') return { dimension: 'nether', world: parts.slice(0, -3).join('/') }
  if (parent === 'DIM1') return { dimension: 'end', world: parts.slice(0, -3).join('/') }
  return { dimension: 'overworld', world: parts.slice(0, -2).join('/') }
}
