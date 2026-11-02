/// <reference lib="webworker" />

import { runPool } from './pool'
import type { ScanTotals } from './pool'
import { parseRegionPath } from './regionPath'
import type { RegionScanRequest, RegionScanResponse } from './regionScan.worker'
import { openSave } from './source'
import type { SaveEntry, SaveInput } from './source'
import { decompress } from './zip'

export {}

// Coordinator for a whole-save scan. Opens the save, picks out one dimension's
// region files, and feeds them to a pool of wasm scan workers. Nothing leaves
// the machine — there is no upload and no server.
//
// The save arrives as either a zip or the loose files of a world folder, and
// `./source` flattens that to a list of entries that read their own bytes; from
// here down the two are the same thing. A zip is range-read off disk rather
// than loaded (the note atop `./zip` explains why), so either way this worker
// only ever holds the index plus the members currently in flight — and it hands
// those to the pool *as stored*, because inflating a zip's members here would
// put the whole container through one thread.
//
// There are two separate layers of compression and it is worth keeping them
// straight: the zip deflates each `.mca` member (undone in the scan workers, by
// `DecompressionStream` — a folder scan skips this layer entirely), and *inside*
// every `.mca`, zipped or not, each chunk is separately zlib-compressed (undone
// in Rust, as part of the scan).

export type WorldScanRequest = {
  type: 'scan'
  // The selected save, passed by reference through structured clone so a
  // multi-GB File is never copied across the thread boundary — and then only
  // ever read one region at a time, so it is never copied into the heap either.
  save: SaveInput
  dimension: string
  blockType: string
  // How many coordinates to retain. The reported count is always the true
  // total; this only bounds what the map has to draw.
  limit: number
}

export type WorldScanResponse =
  // The zip is open and we know how much work there is — the progress bar can
  // switch from indeterminate to a real regions-done/total reading.
  | { type: 'opened'; regionCount: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; count: number; coords: Int32Array; truncated: boolean }
  | { type: 'error'; message: string }

// Cap on the pool. Each worker is a wasm instance with its own heap and its own
// region in flight, so this bounds memory as much as it bounds parallelism.
const POOL_LIMIT = 8

const post = (message: WorldScanResponse, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
    message,
    transfer,
  )

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function poolSize(regionCount: number): number {
  const cores = navigator.hardwareConcurrency || 4
  // Leave a core for this thread and the UI. That is less load-bearing than it
  // was when the whole container was inflated here — this thread now only
  // issues range reads — but a spare core still keeps the page responsive.
  return Math.max(1, Math.min(cores - 1, POOL_LIMIT, regionCount))
}

/** Bring every worker up with its own wasm instance and the sidecar table. */
function initWorkers(
  workers: Worker[],
  blockType: string,
  externals: [string, Uint8Array][],
): Promise<unknown[]> {
  return Promise.all(
    workers.map(
      (worker) =>
        new Promise<void>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<RegionScanResponse>) => {
            if (event.data.type === 'ready') resolve()
            else if (event.data.type === 'error') reject(new Error(event.data.message))
          }
          worker.onerror = (event) =>
            reject(new Error(event.message || 'A scan worker failed to start'))
          const message: RegionScanRequest = { type: 'init', blockType, externals }
          // No transfer list: each worker needs its *own* copy of the sidecars.
          // Transferring would move ownership and only the first would get them.
          worker.postMessage(message)
        }),
    ),
  )
}

async function scanWorld(request: WorldScanRequest): Promise<ScanTotals> {
  // Lists the save's files; nothing is read until the pool asks for a region.
  const entries = await openSave(request.save)

  const mca: SaveEntry[] = []
  const mcc: SaveEntry[] = []
  const worlds = new Set<string>()
  for (const entry of entries) {
    const region = parseRegionPath(entry.name)
    if (region?.dimension !== request.dimension) continue
    worlds.add(region.world)
    if (entry.name.endsWith('.mca')) mca.push(entry)
    else mcc.push(entry)
  }

  if (mca.length === 0) {
    throw new Error(
      `No ${request.dimension} region files found in that save. ` +
        'Is this a valid Minecraft save, and has that dimension been visited?',
    )
  }
  if (worlds.size > 1) {
    // Scanning on would silently merge two worlds onto one map. Easy to do by
    // hand with a folder — the saves directory is one level above the world.
    const names = [...worlds].sort().join(', ')
    throw new Error(
      `That selection holds ${worlds.size} worlds (${names}). ` +
        'Pick a single world — the folder that contains level.dat, or a zip of it.',
    )
  }
  // Fixed order, so a truncated result is reproducible across runs.
  mca.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  // `.mcc` oversized-chunk sidecars are rare and small, and any region file in
  // the directory may reference any of them, so they are read up front and
  // every worker keeps the whole table.
  const externals: [string, Uint8Array][] = []
  for (const entry of mcc) {
    externals.push([baseName(entry.name), await decompress(await entry.readRaw())])
  }

  post({ type: 'opened', regionCount: mca.length })

  const workers = Array.from(
    { length: poolSize(mca.length) },
    () => new Worker(new URL('./regionScan.worker.ts', import.meta.url), { type: 'module' }),
  )
  try {
    await initWorkers(workers, request.blockType, externals)
    return await runPool(workers, mca, request.limit, (done, total) =>
      post({ type: 'progress', done, total }),
    )
  } finally {
    for (const worker of workers) worker.terminate()
  }
}

self.addEventListener('message', (event: MessageEvent<WorldScanRequest>) => {
  scanWorld(event.data).then(
    (totals) => post({ type: 'done', ...totals }, [totals.coords.buffer]),
    (error: unknown) =>
      post({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not read that save',
      }),
  )
})
