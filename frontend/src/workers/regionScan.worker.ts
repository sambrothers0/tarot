/// <reference lib="webworker" />

import init, { ExternalChunks, scanRegion } from '../wasm/scanner'
import { decompress } from './zip'

export {}

// One member of the scan pool: owns its own WebAssembly instance and scans
// whole region files handed to it by the coordinator. A region file is the
// natural unit of work — every `.mca` is independent, which is why the old
// Python backend also fanned out one region per process.
//
// Region files arrive as the coordinator read them — still deflated, exactly as
// stored in the zip — and are inflated here. That keeps container inflation off
// the coordinator, where it would be a single thread against the whole pool.
//
// Each worker gets its own wasm instance rather than sharing one across
// threads, so there is no need for SharedArrayBuffer or cross-origin isolation
// (GitHub Pages cannot set the COOP/COEP headers those require).

export type RegionScanRequest =
  // Sent once, before any region. `externals` is the dimension's `.mcc`
  // oversized-chunk sidecars, which are shared by every region file in the
  // directory — so they are cloned into each worker and kept for the run.
  | { type: 'init'; blockType: string; externals: [string, Uint8Array][] }
  // `data` is the region file as stored in the zip: `method` is the zip
  // compression method (0 stored, 8 deflated) and `size` its inflated length,
  // both taken from the archive's central directory.
  //
  // `limit` is how many coordinates this region may still contribute; it
  // shrinks as the overall cap fills, so a dense block stops paying to
  // marshal coordinates nobody will keep.
  | {
      type: 'region'
      index: number
      data: Uint8Array<ArrayBuffer>
      method: number
      size: number
      limit: number
    }

export type RegionScanResponse =
  | { type: 'ready' }
  | { type: 'result'; index: number; count: number; coords: Int32Array }
  | { type: 'error'; message: string }

let externals: ExternalChunks | null = null
let blockType = ''

const post = (message: RegionScanResponse, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
    message,
    transfer,
  )

self.addEventListener('message', async (event: MessageEvent<RegionScanRequest>) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      await init()
      const table = new ExternalChunks()
      for (const [name, bytes] of message.externals) table.insert(name, bytes)
      externals = table
      blockType = message.blockType
      post({ type: 'ready' })
      return
    }

    if (!externals) throw new Error('Scan worker received a region before it was initialised')

    const region = await decompress({
      data: message.data,
      method: message.method,
      uncompressedSize: message.size,
    })
    const result = scanRegion(region, externals, blockType, message.limit)
    const count = result.count
    // Take the coordinates before freeing: `takeCoords` moves the buffer out of
    // wasm memory rather than copying it a second time.
    const coords = result.takeCoords()
    result.free()
    // Transfer, don't clone — the coordinate buffer belongs to the coordinator now.
    post({ type: 'result', index: message.index, count, coords }, [coords.buffer])
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'Scan failed' })
  }
})
