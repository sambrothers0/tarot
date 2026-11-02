import sampleWorldUrl from '../assets/sample-world.zip?url'
import type { SaveInput } from '../workers/source'
import type { Dimension } from './scanOptions'

// The save the page scans when the visitor hasn't picked one of their own, so
// anyone can see the whole flow without a world on hand. It's a small superflat
// test world: two nether portals about 13,500 blocks apart, so the default
// search plots something worth looking at.
//
// The zip holds only `sample-world/region/*.mca`. Nothing else in a save is
// read by a scan, and leaving out level.dat and playerdata means no player's
// UUID or position is shipped with the site.
//
// Once fetched it's an ordinary zip `SaveInput`, so the coordinator, the pool
// and the read-ahead bound treat it like any other save. Fetching it is a
// download from the site's own origin: the "nothing is uploaded" claim holds.

export const SAMPLE_WORLD_NAME = 'Sample world'

// Only the overworld was explored, so the other two dimensions have no region
// files. The page says so up front instead of downloading the sample to find out.
export const SAMPLE_WORLD_DIMENSIONS: readonly Dimension[] = ['overworld']

let pending: Promise<SaveInput> | null = null

/**
 * Fetch the sample world (~1.2 MB) the first time it's scanned and reuse it
 * after that. A failed fetch isn't cached, so pressing Scan again retries.
 */
export function loadSampleWorld(): Promise<SaveInput> {
  pending ??= fetchSampleWorld().catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

async function fetchSampleWorld(): Promise<SaveInput> {
  let response: Response
  try {
    response = await fetch(sampleWorldUrl)
  } catch {
    throw new Error('Could not download the sample world. Check your connection and try again.')
  }
  if (!response.ok) {
    throw new Error(`Could not download the sample world (HTTP ${response.status}).`)
  }
  return { kind: 'zip', name: SAMPLE_WORLD_NAME, file: await response.blob() }
}
