import type { BlockMatch, MapLayer } from '../components/worldmap/types'

// The choices the scan form offers, and the small amount of vocabulary shared
// between the form, the progress bars and the result line.

// How many coordinates the map will carry *per block type*. The scan always
// reports the true count; this only bounds what gets drawn and copied, because
// a block like stone occurs hundreds of millions of times in one save. Per
// type, so a dense block scanned alongside a rare one can't crowd it out.
export const MAX_MATCHES = 100_000

// How many block types one scan can look for. The scan itself would take more
// in the same single pass; the cap is the map's. Past six, no set of pin
// colours stays tellable apart on the pane even with a shape each (see
// `worldmap/layers.ts`), and six full caps is already 600,000 pins.
export const MAX_BLOCK_TYPES = 6

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
  { id: 'folder', label: 'Save folder' },
  { id: 'zip', label: 'Zip file' },
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
  // The block types scanned for, in the order the player listed them, each with
  // its own true count. `matches[i].layer` indexes into this.
  layers: MapLayer[]
  dimension: string
  // What was scanned, as the person would recognise it: the zip's file name or
  // the world folder's name. Shown on the result and kept when it is saved.
  source: { kind: SourceKind; name: string }
  // When the scan finished. Saved scans are ordered by this, not by save time.
  scannedAt: Date
  // Across every block type: the true total, and whether any type hit its cap.
  count: number
  truncated: boolean
  matches: BlockMatch[]
}

/** The totals a result reports across its layers. */
export const layerTotals = (layers: MapLayer[]) => ({
  count: layers.reduce((n, layer) => n + layer.count, 0),
  truncated: layers.some((layer) => layer.truncated),
})

/**
 * A result's coordinates as the JSON that "Copy coordinates" puts on the
 * clipboard. One block: the plain `[{x,y,z}]` list it has always been. Several:
 * an object of those lists keyed by block ID, in scan order, so each block's
 * coordinates stay labelled.
 */
export function coordinatesJson(result: Pick<ScanResult, 'layers' | 'matches'>): string {
  const strip = ({ x, y, z }: BlockMatch) => ({ x, y, z })
  if (result.layers.length <= 1) return JSON.stringify(result.matches.map(strip))
  const byBlock: Record<string, { x: number; y: number; z: number }[]> = {}
  for (const layer of result.layers) byBlock[layer.blockType] = []
  for (const m of result.matches) byBlock[result.layers[m.layer].blockType]?.push(strip(m))
  return JSON.stringify(byBlock)
}
