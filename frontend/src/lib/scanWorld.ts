import type { BlockMatch } from '../components/worldmap/types'
import type { SaveInput } from '../workers/source'
import type { WorldScanRequest, WorldScanResponse } from '../workers/worldScan.worker'
import { MAX_MATCHES } from './scanOptions'
import type { Dimension } from './scanOptions'

export type ScanProgress = {
  // The save is open and the region count is known, so the caller can swap an
  // indeterminate bar for a real one.
  onOpened: (regionCount: number) => void
  onProgress: (done: number, total: number) => void
}

// Run the save through the scan worker. The whole scan happens on this machine:
// the coordinator worker opens the save and hands one region file at a time to a
// pool of WebAssembly workers. Nothing is uploaded.
export function scanWorld(
  save: SaveInput,
  dimension: Dimension,
  blockType: string,
  { onOpened, onProgress }: ScanProgress,
): Promise<{ count: number; truncated: boolean; matches: BlockMatch[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/worldScan.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<WorldScanResponse>) => {
      const data = event.data
      // 'opened' and 'progress' keep streaming while the scan runs — report and
      // wait for the terminal 'done'/'error' before tearing the worker down.
      if (data.type === 'opened') {
        onOpened(data.regionCount)
        return
      }
      if (data.type === 'progress') {
        onProgress(data.done, data.total)
        return
      }
      worker.terminate()
      if (data.type === 'done') {
        resolve({ count: data.count, truncated: data.truncated, matches: unpack(data.coords) })
      } else {
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Failed to scan the save in the browser'))
    }

    const request: WorldScanRequest = {
      type: 'scan',
      save,
      dimension,
      blockType,
      limit: MAX_MATCHES,
    }
    worker.postMessage(request)
  })
}

// The scanner returns a flat run of x,y,z triples — building objects per match
// inside wasm and marshalling them out is far slower than one Int32Array. Unpack
// once, here, so nothing downstream has to know about the packed form.
function unpack(coords: Int32Array): BlockMatch[] {
  const matches: BlockMatch[] = new Array(coords.length / 3)
  for (let i = 0, m = 0; i < coords.length; i += 3, m += 1) {
    matches[m] = { x: coords[i], y: coords[i + 1], z: coords[i + 2] }
  }
  return matches
}
