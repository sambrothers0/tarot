import { describe, expect, it } from 'vitest'
import { READ_AHEAD_SLACK, runPool } from './pool'
import type { PoolWorker } from './pool'
import type { RegionScanRequest, RegionScanResponse } from './regionScan.worker'
import type { SaveEntry } from './source'

// The pool scheduler, driven by fake workers. The headline property is
// invariant 1: at most `workers + READ_AHEAD_SLACK` region buffers alive at
// once, counting every buffer from the moment its read starts until its result
// has been handed back.

type RegionRequest = Extract<RegionScanRequest, { type: 'region' }>

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Seeded PRNG so "random" scheduling is reproducible. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) >>> 0
    return s / 2 ** 32
  }
}

/**
 * What a region "contains" of block `layer`: that many matches at
 * (index, i, layer). Layer 0 is the single-block case the bulk of these tests
 * run; layer 1 is denser, for the tests of several blocks at once.
 */
const regionCount = (index: number, layer = 0) => (layer === 0 ? (index * 7) % 5 : (index * 3) % 7)

function regionCoords(index: number, limit: number, layer = 0): Int32Array {
  const n = Math.min(regionCount(index, layer), limit)
  const coords = new Int32Array(n * 3)
  for (let i = 0; i < n; i++) coords.set([index, i, layer], i * 3)
  return coords
}

class FakeWorker implements PoolWorker {
  onmessage: ((event: MessageEvent<RegionScanResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  received: { message: RegionRequest; transfer: Transferable[] }[] = []
  busy = false

  // How the worker responds; tests swap this out.
  private respond: (worker: FakeWorker, message: RegionRequest) => void
  constructor(respond: (worker: FakeWorker, message: RegionRequest) => void) {
    this.respond = respond
  }

  postMessage(message: RegionScanRequest, transfer: Transferable[]) {
    if (message.type !== 'region') throw new Error('pool only sends regions')
    if (this.busy) throw new Error('pool double-booked a worker')
    this.busy = true
    this.received.push({ message, transfer })
    this.respond(this, message)
  }

  reply(data: RegionScanResponse) {
    if (data.type === 'result') this.busy = false
    this.onmessage?.({ data } as MessageEvent<RegionScanResponse>)
  }

  /** Answer with this region's matches per block, honouring the limits the pool sent. */
  replyResult(message: RegionRequest) {
    const runs = message.limits.map((limit, layer) => regionCoords(message.index, limit, layer))
    const coords = new Int32Array(runs.reduce((n, run) => n + run.length, 0))
    let offset = 0
    for (const run of runs) {
      coords.set(run, offset)
      offset += run.length
    }
    this.reply({
      type: 'result',
      index: message.index,
      counts: Float64Array.from(message.limits, (_, layer) => regionCount(message.index, layer)),
      lengths: Uint32Array.from(runs, (run) => run.length / 3),
      coords,
    })
  }
}

/** Regions whose reads take a random few ticks, tracking how many are alive. */
function trackedRegions(total: number, random: () => number) {
  const stats = { alive: 0, peak: 0, reads: 0 }
  const regions: SaveEntry[] = Array.from({ length: total }, (_, index) => ({
    name: `world/region/r.${index}.0.mca`,
    async readRaw() {
      stats.alive += 1
      stats.reads += 1
      stats.peak = Math.max(stats.peak, stats.alive)
      for (let t = Math.floor(random() * 3); t > 0; t--) await tick()
      const data = new Uint8Array(new ArrayBuffer(16))
      data[0] = index
      return { data, method: 0, uncompressedSize: 16 }
    },
  }))
  return { regions, stats }
}

/** Workers that answer after a random few ticks, freeing a buffer each time. */
function randomWorkers(n: number, random: () => number, stats: { alive: number }) {
  return Array.from(
    { length: n },
    () =>
      new FakeWorker((worker, message) => {
        const delay = Math.floor(random() * 6)
        void (async () => {
          for (let t = delay; t > 0; t--) await tick()
          stats.alive -= 1
          worker.replyResult(message)
        })()
      }),
  )
}

/** Every region's matches of one block, concatenated in region order, capped at `limit`. */
function expectedCoords(total: number, limit: number, layer = 0): number[] {
  const all: number[] = []
  for (let i = 0; i < total; i++) all.push(...regionCoords(i, Infinity, layer))
  return all.slice(0, limit * 3)
}

const expectedCount = (total: number, layer = 0) =>
  Array.from({ length: total }, (_, i) => regionCount(i, layer)).reduce((a, b) => a + b, 0)

describe('runPool', () => {
  it.each([
    [1, 1],
    [1, 20],
    [3, 2],
    [3, 50],
    [8, 200],
  ])('with %i workers and %i regions, never holds more than workers + slack buffers', async (n, total) => {
    for (const seed of [1, 2, 3]) {
      const random = rng(seed * 1000 + n * 10 + total)
      const { regions, stats } = trackedRegions(total, random)
      const workers = randomWorkers(n, random, stats)
      const totals = await runPool(workers, regions, 1, 1_000_000, () => {})

      expect(stats.peak).toBeLessThanOrEqual(n + READ_AHEAD_SLACK)
      expect(stats.reads).toBe(total)
      expect(stats.alive).toBe(0)
      expect(totals.layers[0].count).toBe(expectedCount(total))
      expect(totals.layers[0].truncated).toBe(false)
      expect([...totals.coords]).toEqual(expectedCoords(total, Infinity))
    }
  })

  it('parks the reader at the bound when every worker stalls', async () => {
    const stalled: { worker: FakeWorker; message: RegionRequest }[] = []
    const workers = [0, 1].map(() => new FakeWorker((worker, message) => stalled.push({ worker, message })))
    const { regions, stats } = trackedRegions(10, () => 0)
    const done = runPool(workers, regions, 1, 100, () => {})

    for (let i = 0; i < 20; i++) await tick()
    // Two in workers, two read ahead — and nothing more, however long we wait.
    expect(stats.reads).toBe(2 + READ_AHEAD_SLACK)

    // Each freed slot lets exactly one more read start.
    const first = stalled.shift()!
    stats.alive -= 1
    first.worker.replyResult(first.message)
    for (let i = 0; i < 20; i++) await tick()
    expect(stats.reads).toBe(3 + READ_AHEAD_SLACK)

    // Drain the rest.
    while (stats.reads < 10 || stalled.length > 0) {
      const next = stalled.shift()
      if (next) {
        stats.alive -= 1
        next.worker.replyResult(next.message)
      }
      await tick()
    }
    expect((await done).layers[0].count).toBe(expectedCount(10))
  })

  it('aggregates in region order however the workers finish, so truncation is stable', async () => {
    const total = 40
    const limit = 9
    const results: number[][] = []
    for (const seed of [11, 12, 13, 14]) {
      const random = rng(seed)
      const { regions, stats } = trackedRegions(total, random)
      const totals = await runPool(randomWorkers(4, random, stats), regions, 1, limit, () => {})
      expect(totals.layers[0].count).toBe(expectedCount(total))
      expect(totals.layers[0].truncated).toBe(true)
      expect(totals.coords.length).toBe(limit * 3)
      results.push([...totals.coords])
    }
    expect(results[0]).toEqual(expectedCoords(total, limit))
    for (const r of results) expect(r).toEqual(results[0])
  })

  it('never asks a worker for more coordinates than the cap still has room for', async () => {
    const workers = [new FakeWorker((worker, message) => worker.replyResult(message))]
    const { regions } = trackedRegions(12, () => 0)
    const totals = await runPool(workers, regions, 1, 5, () => {})
    const limits = workers[0].received.map((r) => r.message.limits[0])
    expect(limits[0]).toBe(5)
    // Monotonically shrinking, reaching zero once the cap is full.
    for (let i = 1; i < limits.length; i++) expect(limits[i]).toBeLessThanOrEqual(limits[i - 1])
    expect(limits[limits.length - 1]).toBe(0)
    expect(totals.coords.length).toBe(15)
  })

  it('reports not truncated when the cap is met exactly', async () => {
    const { regions, stats } = trackedRegions(5, () => 0)
    const exact = expectedCount(5)
    const totals = await runPool(randomWorkers(2, rng(5), stats), regions, 1, exact, () => {})
    expect(totals.layers[0].truncated).toBe(false)
    expect(totals.coords.length).toBe(exact * 3)
  })

  it('transfers each region buffer to its worker rather than copying', async () => {
    const workers = [new FakeWorker((worker, message) => worker.replyResult(message))]
    const { regions } = trackedRegions(3, () => 0)
    await runPool(workers, regions, 1, 100, () => {})
    for (const { message, transfer } of workers[0].received) {
      expect(transfer).toEqual([message.data.buffer])
      expect(message.method).toBe(0)
      expect(message.size).toBe(16)
      expect(message.data[0]).toBe(message.index)
    }
  })

  it('reports progress once per region, ending at total', async () => {
    const progress: [number, number][] = []
    const { regions, stats } = trackedRegions(7, rng(7))
    await runPool(randomWorkers(3, rng(8), stats), regions, 1, 100, (done, total) =>
      progress.push([done, total]),
    )
    expect(progress).toEqual(Array.from({ length: 7 }, (_, i) => [i + 1, 7]))
  })

  it('fails with the worker’s message when a scan errors', async () => {
    const workers = [
      new FakeWorker((worker, message) => {
        if (message.index === 2) worker.reply({ type: 'error', message: 'wasm trapped' })
        else worker.replyResult(message)
      }),
    ]
    const { regions } = trackedRegions(5, () => 0)
    await expect(runPool(workers, regions, 1, 100, () => {})).rejects.toThrow('wasm trapped')
  })

  it('fails when a worker crashes', async () => {
    const workers = [
      new FakeWorker((worker) => worker.onerror?.({ message: 'out of memory' } as ErrorEvent)),
    ]
    const { regions } = trackedRegions(3, () => 0)
    await expect(runPool(workers, regions, 1, 100, () => {})).rejects.toThrow('out of memory')
  })

  it('fails when a region cannot be read, and stops reading', async () => {
    let reads = 0
    const regions: SaveEntry[] = Array.from({ length: 20 }, (_, index) => ({
      name: `r.${index}.0.mca`,
      async readRaw() {
        reads += 1
        if (index === 1) throw new Error('"r.1.0.mca" could not be read.')
        return { data: new Uint8Array(new ArrayBuffer(4)), method: 0, uncompressedSize: 4 }
      },
    }))
    const workers = [new FakeWorker(() => {})] // never answers
    await expect(runPool(workers, regions, 1, 100, () => {})).rejects.toThrow('could not be read')
    for (let i = 0; i < 10; i++) await tick()
    expect(reads).toBe(2)
  })

  it('ignores results that arrive after it has failed', async () => {
    const pending: { worker: FakeWorker; message: RegionRequest }[] = []
    const workers = [0, 1].map(() => new FakeWorker((worker, message) => pending.push({ worker, message })))
    const { regions } = trackedRegions(4, () => 0)
    const run = runPool(workers, regions, 1, 100, () => {})
    await tick()
    pending[0].worker.reply({ type: 'error', message: 'boom' })
    await expect(run).rejects.toThrow('boom')
    // A straggler must not throw or resolve anything.
    expect(() => pending[1].worker.replyResult(pending[1].message)).not.toThrow()
  })

  it('scans several blocks in one pass, each with its own cap, grouped by block', async () => {
    const total = 30
    const limit = 12
    const results: number[][] = []
    for (const seed of [21, 22, 23]) {
      const random = rng(seed)
      const { regions, stats } = trackedRegions(total, random)
      const totals = await runPool(randomWorkers(3, random, stats), regions, 2, limit, () => {})
      expect(stats.reads).toBe(total)
      expect(totals.layers).toEqual([
        { count: expectedCount(total, 0), truncated: true },
        { count: expectedCount(total, 1), truncated: true },
      ])
      // Each block filled its own cap; the dense one didn't eat the other's.
      expect(totals.kept).toEqual([limit, limit])
      expect([...totals.coords]).toEqual([
        ...expectedCoords(total, limit, 0),
        ...expectedCoords(total, limit, 1),
      ])
      results.push([...totals.coords])
    }
    for (const r of results) expect(r).toEqual(results[0])
  })

  it('shrinks each block\'s limit on its own as that block fills', async () => {
    const workers = [new FakeWorker((worker, message) => worker.replyResult(message))]
    const { regions } = trackedRegions(12, () => 0)
    // Layer 1 is denser: its cap fills first while layer 0 still has room.
    const totals = await runPool(workers, regions, 2, 8, () => {})
    const limits = workers[0].received.map((r) => r.message.limits)
    expect(limits[0]).toEqual([8, 8])
    const full = limits.findIndex(([, dense]) => dense === 0)
    expect(full).toBeGreaterThan(0)
    expect(limits[full][0]).toBeGreaterThan(0)
    expect(totals.kept).toEqual([8, 8])
  })

  it('reports a block that never occurs as zero, untruncated', async () => {
    const workers = [
      new FakeWorker((worker, message) =>
        worker.reply({
          type: 'result',
          index: message.index,
          counts: Float64Array.from([regionCount(message.index), 0]),
          lengths: Uint32Array.from([regionCount(message.index), 0]),
          coords: regionCoords(message.index, Infinity),
        }),
      ),
    ]
    const { regions } = trackedRegions(6, () => 0)
    const totals = await runPool(workers, regions, 2, 100, () => {})
    expect(totals.layers[1]).toEqual({ count: 0, truncated: false })
    expect(totals.kept[1]).toBe(0)
    expect([...totals.coords]).toEqual(expectedCoords(6, 100))
  })
})
