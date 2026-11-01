import type { BlockMatch } from '../components/worldmap/types'

// The choices the scan form offers, and the small amount of vocabulary shared
// between the form, the progress bars and the result line.

// How many coordinates the map will carry. The scan always reports the true
// count; this only bounds what gets drawn and copied, because a block like
// stone occurs hundreds of millions of times in one save.
export const MAX_MATCHES = 100_000

export const DEFAULT_BLOCK = 'minecraft:nether_portal'

// Which dimension's region files to scan.
export const DIMENSIONS = [
  { id: 'overworld', label: 'Overworld' },
  { id: 'nether', label: 'Nether' },
  { id: 'end', label: 'End' },
] as const
export type Dimension = (typeof DIMENSIONS)[number]['id']
export const DEFAULT_DIMENSION: Dimension = 'overworld'
export const dimensionLabel = (id: string) => DIMENSIONS.find((d) => d.id === id)?.label ?? id

// How the save is picked. A zip is one file; a folder is the world directory
// itself, arriving as the flat list of every file under it. Either way the
// browser hands over handles, not bytes.
export const SOURCES = [
  { id: 'zip', label: 'Zip file' },
  { id: 'folder', label: 'Save folder' },
] as const
export type SourceKind = (typeof SOURCES)[number]['id']

// Display-only mirror of the scanner's own namespacing (`stone` →
// `minecraft:stone`), so the result line echoes what was actually searched for.
export const normalizeBlockType = (value: string) =>
  value.includes(':') ? value : `minecraft:${value}`

// Where the top-level flow is: `idle` until a scan starts, `opening` while the
// save's index is read, `scanning` once the region count is known.
export type Phase = 'idle' | 'opening' | 'scanning'

export type ScanResult = {
  blockType: string
  dimension: string
  // What was scanned, as the person would recognise it: the zip's file name or
  // the world folder's name. Shown on the result and kept when it is saved.
  source: { kind: SourceKind; name: string }
  // When the scan finished. Saved scans are ordered by this, not by save time.
  scannedAt: Date
  count: number
  truncated: boolean
  matches: BlockMatch[]
}
