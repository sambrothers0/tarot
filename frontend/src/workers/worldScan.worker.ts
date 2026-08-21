/// <reference lib="webworker" />

import type { RegionScanRequest, RegionScanResponse } from './regionScan.worker'
import { assertDecompressionSupported, readCentralDirectory, readMember, readRaw } from './zip'
import type { RawMember, ZipEntry } from './zip'

export {}

// Coordinator for a whole-save scan. Opens the save zip, picks out one
// dimension's region files, and feeds them to a pool of wasm scan workers.
// Nothing leaves the machine — there is no upload and no server.
//
// The zip is read through `./zip`, which range-reads the archive off disk
// instead of loading it; the note at the top of that file explains why. This
// worker therefore only ever holds the central directory plus the members
// currently in flight, and it hands those to the pool *still compressed* —
// inflating them here would put the whole container through one thread.
//
// There are two separate layers of compression and it is worth keeping them
// straight: the zip deflates each `.mca` member (undone in the scan workers,
// by `DecompressionStream`), and *inside* each `.mca` every chunk is separately
// zlib-compressed (undone in Rust, as part of the scan).

export type WorldScanRequest = {
  type: 'scan'
  // The selected save, passed by reference through structured clone so a
  // multi-GB File is never copied across the thread boundary — and then only
  // ever read in ranges, so it is never copied into the heap either.
  file: Blob
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
// How many region files may be read ahead of the workers. Keeping a couple in
// hand means a worker never waits on the reader, without buffering the world.
const READ_AHEAD_SLACK = 2

const post = (message: WorldScanResponse, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
    message,
    transfer,
  )

// A save keeps each dimension's block data in a directory literally named
// `region`, identified by its parent (`DIM-1` = Nether, `DIM1` = End, anything
// else = Overworld). Everything else in the archive — `entities`, `poi`,
// `playerdata`, `level.dat`, … — is irrelevant to a block search and is never
// read. This used to be mirrored by a `_region_dimension` in the Python
// backend; now that the scan runs here, this is the only copy.
function regionDimension(name: string): string | null {
  if (!name.endsWith('.mca') && !name.endsWith('.mcc')) return null
  const parts = name.split('/').filter(Boolean)
  if (parts.length < 2 || parts[parts.length - 2] !== 'region') return null
  const parent = parts.length >= 3 ? parts[parts.length - 3] : ''
  if (parent === 'DIM-1') return 'nether'
  if (parent === 'DIM1') return 'end'
  return 'overworld'
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function poolSize(regionCount: number): number {
  const cores = navigator.hardwareConcurrency || 4
  // Leave a core for this thread and the UI. That is less load-bearing than it
  // was when the whole container was inflated here — this thread now only
  // issues range reads — but a spare core still keeps the page responsive.
  return Math.max(1, Math.min(cores - 1, POOL_LIMIT, regionCount))
}

type ScanTotals = { count: number; coords: Int32Array; truncated: boolean }

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

/**
 * Read region files and scan them across the pool.
 *
 * The read-ahead bound is the load-bearing detail here: one dimension of a
 * large save is ~1.2 GB across a few hundred region files, so only a handful
 * may be resident at any moment. `resident` counts every region buffer alive
 * anywhere — being read, queued, in a worker, or waiting its turn to be
 * aggregated — and the reader blocks once it hits the bound. What it counts is
 * the *compressed* member; each is inflated inside the worker that holds it, so
 * peak usage is this bound plus one inflated region per worker.
 */
function runPool(
  workers: Worker[],
  file: Blob,
  regions: ZipEntry[],
  limit: number,
): Promise<ScanTotals> {
  return new Promise<ScanTotals>((resolve, reject) => {
    const total = regions.length
    const maxResident = workers.length + READ_AHEAD_SLACK

    const idle = [...workers]
    const queued: { index: number; member: RawMember }[] = []
    // Results that arrived before their turn. Bounded by the pool size, since
    // only that many scans can be in flight.
    const pending = new Map<number, { count: number; coords: Int32Array }>()

    let nextToRead = 0
    let nextToAggregate = 0
    let resident = 0
    let done = 0
    let settled = false
    let residentWaiter: (() => void) | null = null

    let count = 0
    let keptTriples = 0
    const kept: Int32Array[] = []

    // The reader parks on this when the read-ahead bound is reached; every
    // completed scan (and any failure) wakes it.
    const wakeReader = () => {
      const waiter = residentWaiter
      residentWaiter = null
      waiter?.()
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      wakeReader()
      reject(error)
    }

    // Aggregate strictly in region order, so a truncated result is the same
    // set of coordinates every run regardless of which worker finished first.
    const drain = () => {
      for (;;) {
        const result = pending.get(nextToAggregate)
        if (!result) return
        pending.delete(nextToAggregate)
        nextToAggregate += 1
        count += result.count
        const room = limit - keptTriples
        if (room > 0 && result.coords.length > 0) {
          const take = Math.min(room * 3, result.coords.length)
          kept.push(take === result.coords.length ? result.coords : result.coords.subarray(0, take))
          keptTriples += take / 3
        }
      }
    }

    const finish = () => {
      settled = true
      const coords = new Int32Array(keptTriples * 3)
      let offset = 0
      for (const part of kept) {
        coords.set(part, offset)
        offset += part.length
      }
      resolve({ count, coords, truncated: count > keptTriples })
    }

    const pump = () => {
      while (queued.length > 0 && idle.length > 0) {
        const worker = idle.pop() as Worker
        const task = queued.shift() as { index: number; member: RawMember }
        const message: RegionScanRequest = {
          type: 'region',
          index: task.index,
          data: task.member.data,
          method: task.member.method,
          size: task.member.uncompressedSize,
          // Never ask for coordinates the cap has no room for. This only ever
          // over-estimates (the cap fills as results aggregate), so nothing is
          // lost — but once it reaches 0 a dense block costs pure counting.
          limit: Math.max(0, limit - keptTriples),
        }
        // Transfer: the region bytes are the worker's now, no copy.
        worker.postMessage(message, [task.member.data.buffer])
      }
    }

    for (const worker of workers) {
      worker.onmessage = (event: MessageEvent<RegionScanResponse>) => {
        const data = event.data
        if (data.type === 'error') {
          fail(new Error(data.message))
          return
        }
        if (data.type !== 'result' || settled) return

        pending.set(data.index, { count: data.count, coords: data.coords })
        idle.push(worker)
        resident -= 1
        done += 1
        drain()
        post({ type: 'progress', done, total })
        wakeReader()
        pump()
        if (done === total) finish()
      }
      worker.onerror = (event) => fail(new Error(event.message || 'A scan worker crashed'))
    }

    const read = async () => {
      while (nextToRead < total && !settled) {
        if (resident >= maxResident) {
          await new Promise<void>((wake) => {
            residentWaiter = wake
          })
          continue
        }
        const index = nextToRead
        nextToRead += 1
        resident += 1
        const member = await readRaw(file, regions[index])
        if (settled) return
        queued.push({ index, member })
        pump()
      }
    }
    read().catch((error: unknown) =>
      fail(error instanceof Error ? error : new Error('Could not read a region file')),
    )
  })
}

async function scanWorld(request: WorldScanRequest): Promise<ScanTotals> {
  assertDecompressionSupported()
  // Reads the archive's index and nothing else; the members stay on disk until
  // the pool asks for them.
  const entries = await readCentralDirectory(request.file)

  const mca: ZipEntry[] = []
  const mcc: ZipEntry[] = []
  for (const entry of entries) {
    if (regionDimension(entry.name) !== request.dimension) continue
    if (entry.name.endsWith('.mca')) mca.push(entry)
    else mcc.push(entry)
  }

  if (mca.length === 0) {
    throw new Error(
      `No ${request.dimension} region files found in that save. ` +
        'Is this a valid Minecraft save, and has that dimension been visited?',
    )
  }
  // Fixed order, so a truncated result is reproducible across runs.
  mca.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  // `.mcc` oversized-chunk sidecars are rare and small, and any region file in
  // the directory may reference any of them, so they are read up front and
  // every worker keeps the whole table.
  const externals: [string, Uint8Array][] = []
  for (const entry of mcc) {
    externals.push([baseName(entry.name), await readMember(request.file, entry)])
  }

  post({ type: 'opened', regionCount: mca.length })

  const workers = Array.from(
    { length: poolSize(mca.length) },
    () => new Worker(new URL('./regionScan.worker.ts', import.meta.url), { type: 'module' }),
  )
  try {
    await initWorkers(workers, request.blockType, externals)
    return await runPool(workers, request.file, mca, request.limit)
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
        message: error instanceof Error ? error.message : 'Could not read that zip file',
      }),
  )
})
