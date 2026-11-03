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

// One entry per block type, in the order they were asked for. `coords` holds
// every kept triple grouped by block — block 0's run first — and `kept[i]` is
// how many triples belong to block `i`. `count` is always the true total.
export type ScanTotals = {
  layers: { count: number; truncated: boolean }[]
  kept: number[]
  coords: Int32Array
}

type RegionResult = { counts: ArrayLike<number>; lengths: ArrayLike<number>; coords: Int32Array }

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
 *
 * Every region is scanned once for all `layerCount` block types; `limit` caps
 * the coordinates kept *per type*, so a dense block filling its cap never
 * crowds out a rare one scanned alongside it.
 */
export function runPool(
  workers: PoolWorker[],
  regions: SaveEntry[],
  layerCount: number,
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
    const pending = new Map<number, RegionResult>()

    let nextToRead = 0
    let nextToAggregate = 0
    let resident = 0
    let done = 0
    let settled = false
    let residentWaiter: (() => void) | null = null

    const counts = new Array<number>(layerCount).fill(0)
    const keptTriples = new Array<number>(layerCount).fill(0)
    const kept: Int32Array[][] = Array.from({ length: layerCount }, () => [])

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
        // The worker's runs sit back to back in layer order.
        let offset = 0
        for (let layer = 0; layer < layerCount; layer++) {
          counts[layer] += result.counts[layer] ?? 0
          const run = (result.lengths[layer] ?? 0) * 3
          const room = limit - keptTriples[layer]
          if (room > 0 && run > 0) {
            const take = Math.min(room * 3, run)
            kept[layer].push(result.coords.subarray(offset, offset + take))
            keptTriples[layer] += take / 3
          }
          offset += run
        }
      }
    }

    const finish = () => {
      settled = true
      const coords = new Int32Array(keptTriples.reduce((a, b) => a + b, 0) * 3)
      let offset = 0
      for (const parts of kept) {
        for (const part of parts) {
          coords.set(part, offset)
          offset += part.length
        }
      }
      resolve({
        layers: counts.map((count, layer) => ({ count, truncated: count > keptTriples[layer] })),
        kept: keptTriples,
        coords,
      })
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
          // Never ask for coordinates a cap has no room for. This only ever
          // over-estimates (the caps fill as results aggregate), so nothing is
          // lost — but once one reaches 0 its dense block costs pure counting.
          limits: keptTriples.map((k) => Math.max(0, limit - k)),
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

        pending.set(data.index, { counts: data.counts, lengths: data.lengths, coords: data.coords })
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
