import type { BlockMatch } from '../components/worldmap/types'

// How a saved scan's coordinates are stored: packed in the browser, kept by
// the API as an opaque blob, unpacked here again when the map opens. Small on
// purpose — the database and the egress both sit on free tiers.
//
//   byte 0      format version
//   bytes 1..   gzip of the byte planes of
//      v2:      [n, k, n₀…nₖ₋₁, Δx₁…Δxₙ, Δy₁…Δyₙ, Δz₁…Δzₙ]
//      v1:      [n, Δx₁…Δxₙ, Δy₁…Δyₙ, Δz₁…Δzₙ]          (uint32, Δs zigzagged)
//
// v2 is what's written: the matches of k block types, grouped by type with
// nᵢ matches of type i, so the layer travels as k run lengths rather than a
// word per match. v1, from before scans held several blocks, still reads, as
// all layer 0.
//
// Matches arrive in scan order (region, chunk, section), so neighbours sit
// close together and the deltas are tiny; zigzag keeps a small negative delta
// small; splitting the words into byte planes puts all the (mostly zero) high
// bytes in long runs that deflate flattens. Order is preserved exactly.

const VERSION = 2

const zigzag = (n: number) => ((n << 1) ^ (n >> 31)) >>> 0
const unzigzag = (n: number) => (n >>> 1) ^ -(n & 1)

export async function packCoords(
  matches: BlockMatch[],
  layerCount = 1,
): Promise<Uint8Array<ArrayBuffer>> {
  // Grouped by layer, keeping scan order within each — the scan already
  // delivers them that way, so this is normally a no-op copy.
  const ordered = [...matches].sort((a, b) => a.layer - b.layer)
  // A loop, not Math.max(...spread): 100k+ arguments overflow the stack.
  let k = layerCount
  for (const m of ordered) if (m.layer + 1 > k) k = m.layer + 1
  const n = ordered.length
  const head = 2 + k
  const words = new Uint32Array(head + 3 * n)
  words[0] = n
  words[1] = k
  for (const m of ordered) words[2 + m.layer] += 1
  let px = 0
  let py = 0
  let pz = 0
  for (let i = 0; i < n; i++) {
    const { x, y, z } = ordered[i]
    words[head + i] = zigzag(x - px)
    words[head + n + i] = zigzag(y - py)
    words[head + 2 * n + i] = zigzag(z - pz)
    px = x
    py = y
    pz = z
  }

  const planes = new Uint8Array(words.length * 4)
  for (let b = 0; b < 4; b++) {
    const shift = b * 8
    const base = b * words.length
    for (let i = 0; i < words.length; i++) planes[base + i] = (words[i] >>> shift) & 0xff
  }

  const compressed = await pipe(planes, new CompressionStream('gzip'))
  const out = new Uint8Array(1 + compressed.length)
  out[0] = VERSION
  out.set(compressed, 1)
  return out
}

export async function unpackCoords(packed: Uint8Array<ArrayBuffer>): Promise<BlockMatch[]> {
  const version = packed[0]
  if (version !== 1 && version !== 2)
    throw new Error('This scan was saved in a format this page cannot read.')
  const planes = await pipe(packed.subarray(1), new DecompressionStream('gzip'))
  if (planes.length % 4 !== 0) throw new Error('Saved coordinates are damaged.')

  const count = planes.length / 4
  const words = new Uint32Array(count)
  for (let b = 0; b < 4; b++) {
    const shift = b * 8
    const base = b * count
    for (let i = 0; i < count; i++) words[i] |= planes[base + i] << shift
  }
  const n = words[0]
  const k = version === 1 ? 1 : words[1]
  const head = version === 1 ? 1 : 2 + k
  const runs = version === 1 ? [n] : Array.from(words.subarray(2, 2 + k))
  if (words.length !== head + 3 * n || runs.reduce((a, b) => a + b, 0) !== n)
    throw new Error('Saved coordinates are damaged.')

  const matches: BlockMatch[] = new Array(n)
  let x = 0
  let y = 0
  let z = 0
  let layer = 0
  let left = runs[0] ?? 0
  for (let i = 0; i < n; i++) {
    while (left === 0) left = runs[++layer]
    left -= 1
    x += unzigzag(words[head + i])
    y += unzigzag(words[head + n + i])
    z += unzigzag(words[head + 2 * n + i])
    matches[i] = { x, y, z, layer }
  }
  return matches
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// The API takes the blob inside a JSON body, so it travels as base64.
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
