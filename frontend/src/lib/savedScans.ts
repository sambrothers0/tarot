import type { BlockMatch } from '../components/worldmap/types'
import { apiFetch, apiFetchBytes } from './api'
import { packCoords, toBase64, unpackCoords } from './coordsCodec'
import type { Dimension, ScanResult, SourceKind } from './scanOptions'

// Saved scans, through the accounts API. The split is deliberate: the list is
// metadata plus a tiny preview, small enough to fetch every row of at once;
// the coordinates are a separate compressed blob (`coordsCodec.ts`) fetched
// only when a scan is opened, and cached by the browser after that.

// How many X/Z points a summary carries for its thumbnail.
export const PREVIEW_POINTS = 48

export type SavedScanSummary = {
  id: string
  // The person's own label, or null to title it by its block.
  name: string | null
  blockType: string
  dimension: Dimension
  source: { kind: SourceKind; name: string }
  scannedAt: Date
  count: number
  truncated: boolean
  // A sample of distinct X/Z columns, so the list can sketch each scan's shape
  // without downloading its coordinates.
  preview: [number, number][]
}

type ScanRow = {
  id: string
  name: string | null
  block_type: string
  dimension: Dimension
  source_kind: SourceKind
  source_name: string
  scanned_at: string
  count: number
  truncated: boolean
  preview: [number, number][]
}

const fromRow = (row: ScanRow): SavedScanSummary => ({
  id: row.id,
  name: row.name,
  blockType: row.block_type,
  dimension: row.dimension,
  source: { kind: row.source_kind, name: row.source_name },
  scannedAt: new Date(row.scanned_at),
  count: row.count,
  truncated: row.truncated,
  preview: row.preview,
})

/** Evenly sample up to PREVIEW_POINTS distinct columns from a scan's matches. */
export function previewPoints(matches: BlockMatch[]): [number, number][] {
  const columns = new Map<string, [number, number]>()
  for (const { x, z } of matches) columns.set(`${x},${z}`, [x, z])
  const all = [...columns.values()]
  if (all.length <= PREVIEW_POINTS) return all
  const step = all.length / PREVIEW_POINTS
  return Array.from({ length: PREVIEW_POINTS }, (_, i) => all[Math.floor(i * step)])
}

export async function saveScan(result: ScanResult): Promise<SavedScanSummary> {
  const coords = toBase64(await packCoords(result.matches))
  const row = await apiFetch<ScanRow>('/scans', {
    method: 'POST',
    body: JSON.stringify({
      block_type: result.blockType,
      dimension: result.dimension,
      source_kind: result.source.kind,
      source_name: result.source.name.slice(0, 255),
      scanned_at: result.scannedAt.toISOString(),
      count: result.count,
      truncated: result.truncated,
      preview: previewPoints(result.matches),
      coords,
    }),
  })
  return fromRow(row)
}

/** Newest scan first (by when it was scanned, not when it was saved). */
export async function listSavedScans(): Promise<SavedScanSummary[]> {
  return (await apiFetch<ScanRow[]>('/scans')).map(fromRow)
}

/** A saved scan's coordinates, in the `[{x,y,z}]` form the map takes. */
export async function loadScanMatches(id: string): Promise<BlockMatch[]> {
  return unpackCoords(await apiFetchBytes(`/scans/${encodeURIComponent(id)}/coords`))
}

/** Blank clears the name back to the block's. */
export async function renameSavedScan(id: string, name: string): Promise<SavedScanSummary> {
  const row = await apiFetch<ScanRow>(`/scans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: name.trim() || null }),
  })
  return fromRow(row)
}

export async function deleteSavedScan(id: string): Promise<void> {
  await apiFetch<void>(`/scans/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
