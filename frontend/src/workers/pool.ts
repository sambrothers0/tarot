import type { RegionScanRequest, RegionScanResponse } from './regionScan.worker'
import type { SaveEntry } from './source'
import type { RawMember } from './zip'

// The scan pool's scheduler, apart from the worker that hosts it so it can be
// driven by fake workers in tests. Invariant 1 in CLAUDE.md lives here.

// How many region files may be read ahead of the workers. Keeping a couple in
// hand means a worker never waits on the reader, without buffering the world.
export const READ_AHEAD_SLACK = 2

/** The slice of `Worker` the pool uses. A real `Worker` satisfies it. */
export interface PoolWorker {
  postMessage(message: RegionScanRequest, transfer: Transferable[]): void
  onmessage: ((event: MessageEvent<RegionScanResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export type ScanTotals = { count: number; coords: Int32Array; truncated: boolean }

/**
 * Read region files and scan them across the pool.
 *
 * The read-ahead bound is the load-bearing detail here: one dimension of a
 * large save is ~1.2 GB across a few hundred region files, so only a handful
 * may be resident at any moment. `resident` counts every region buffer alive
 * anywhere — being read, queued, in a worker, or waiting its turn to be
 * aggregated — and the reader blocks once it hits the bound. What it counts is
 * the member *as stored*: out of a zip that is the compressed form, and each is
 * inflated inside the worker that holds it, so peak usage is this bound plus
 * one inflated region per worker. Out of a folder the stored form is already
 * the inflated one and nothing is duplicated, which makes that case the
 * cheaper of the two despite the larger buffers.
 */
export function runPool(
  workers: PoolWorker[],
  regions: SaveEntry[],
  limit: number,
  onProgress: (done: number, total: number) => void,
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
        const worker = idle.pop() as PoolWorker
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
        onProgress(done, total)
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
        const member = await regions[index].readRaw()
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
