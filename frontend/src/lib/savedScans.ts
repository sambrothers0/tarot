import type { BlockMatch } from '../components/worldmap/types'
import type { Dimension, ScanResult, SourceKind } from './scanOptions'

// Saved scans: the shapes the UI is built against, and — for now — placeholder
// calls behind them. DESIGN ONLY: nothing here talks to the API yet.
//
// The intended split (see the storage notes in the PR): the list is metadata
// plus a tiny preview, small enough to fetch every row of at once; the
// coordinates are a separate compressed blob fetched only when a scan is
// opened. Every function below keeps that split so the wiring drops in.

// How many X/Z points a summary carries for its thumbnail.
export const PREVIEW_POINTS = 48

export type SavedScanSummary = {
  id: string
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

/** Evenly sample up to PREVIEW_POINTS distinct columns from a scan's matches. */
export function previewPoints(matches: BlockMatch[]): [number, number][] {
  const columns = new Map<string, [number, number]>()
  for (const { x, z } of matches) columns.set(`${x},${z}`, [x, z])
  const all = [...columns.values()]
  if (all.length <= PREVIEW_POINTS) return all
  const step = all.length / PREVIEW_POINTS
  return Array.from({ length: PREVIEW_POINTS }, (_, i) => all[Math.floor(i * step)])
}

// TODO(wire): POST /scans (metadata JSON) + PUT the packed coordinates.
export async function saveScan(result: ScanResult): Promise<SavedScanSummary> {
  await new Promise((resolve) => setTimeout(resolve, 700))
  return {
    id: crypto.randomUUID(),
    blockType: result.blockType,
    dimension: result.dimension as Dimension,
    source: result.source,
    scannedAt: result.scannedAt,
    count: result.count,
    truncated: result.truncated,
    preview: previewPoints(result.matches),
  }
}

// TODO(wire): GET /scans, newest scan first (ORDER BY scanned_at DESC).
export async function listSavedScans(): Promise<SavedScanSummary[]> {
  await new Promise((resolve) => setTimeout(resolve, 500))
  return sampleScans().sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())
}

// TODO(wire): DELETE /scans/{id}.
export async function deleteSavedScan(id: string): Promise<void> {
  void id
  await new Promise((resolve) => setTimeout(resolve, 300))
}

// --- Placeholder data, deleted with the stubs above. ---

function sampleScans(): SavedScanSummary[] {
  const now = Date.now()
  const hours = (h: number) => new Date(now - h * 3_600_000)
  return [
    {
      id: 'sample-1',
      blockType: 'minecraft:nether_portal',
      dimension: 'overworld',
      source: { kind: 'zip', name: 'Survival SMP 2024.zip' },
      scannedAt: hours(0.4),
      count: 186,
      truncated: false,
      preview: scatter(1, 9, 1800, 3),
    },
    {
      id: 'sample-2',
      blockType: 'minecraft:ancient_debris',
      dimension: 'nether',
      source: { kind: 'folder', name: 'Survival SMP 2024' },
      scannedAt: hours(3),
      count: 1_204,
      truncated: false,
      preview: scatter(2, 48, 600, 40),
    },
    {
      id: 'sample-3',
      blockType: 'minecraft:end_portal_frame',
      dimension: 'overworld',
      source: { kind: 'zip', name: 'hardcore-attempt-7.zip' },
      scannedAt: hours(27),
      count: 36,
      truncated: false,
      preview: scatter(3, 3, 2400, 2),
    },
    {
      id: 'sample-4',
      blockType: 'minecraft:deepslate_diamond_ore',
      dimension: 'overworld',
      source: { kind: 'folder', name: 'New World (3)' },
      scannedAt: hours(30),
      count: 3_418_552,
      truncated: true,
      preview: scatter(4, 48, 900, 400),
    },
    {
      id: 'sample-5',
      blockType: 'minecraft:end_gateway',
      dimension: 'end',
      source: { kind: 'zip', name: 'Survival SMP 2024.zip' },
      scannedAt: hours(24 * 6),
      count: 20,
      truncated: false,
      preview: ring(20, 1000),
    },
    {
      id: 'sample-6',
      blockType: 'create:brass_casing',
      dimension: 'overworld',
      source: { kind: 'zip', name: 'create-modpack-base.zip' },
      scannedAt: hours(24 * 19),
      count: 640,
      truncated: false,
      preview: scatter(6, 14, 120, 12),
    },
  ]
}

// Deterministic clusters: `clusters` centres across ±`spread`, a few points each.
function scatter(seed: number, clusters: number, spread: number, jitter: number): [number, number][] {
  let s = seed * 9301 + 49297
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 2 - 1
  const points: [number, number][] = []
  for (let c = 0; c < clusters && points.length < PREVIEW_POINTS; c++) {
    const cx = rand() * spread
    const cz = rand() * spread
    const n = Math.max(1, Math.round(PREVIEW_POINTS / clusters))
    for (let i = 0; i < n && points.length < PREVIEW_POINTS; i++) {
      points.push([Math.round(cx + rand() * jitter), Math.round(cz + rand() * jitter)])
    }
  }
  return points
}

function ring(n: number, radius: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [Math.round(Math.cos(a) * radius), Math.round(Math.sin(a) * radius)] as [number, number]
  })
}
