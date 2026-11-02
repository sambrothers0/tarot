import type { BlockMatch } from '../components/worldmap/types'

// How a saved scan's coordinates are stored: packed in the browser, kept by
// the API as an opaque blob, unpacked here again when the map opens. Small on
// purpose — the database and the egress both sit on free tiers.
//
//   byte 0      format version
//   bytes 1..   gzip of the byte planes of
//               [n, Δx₁…Δxₙ, Δy₁…Δyₙ, Δz₁…Δzₙ]   (uint32, zigzagged)
//
// Matches arrive in scan order (region, chunk, section), so neighbours sit
// close together and the deltas are tiny; zigzag keeps a small negative delta
// small; splitting the words into byte planes puts all the (mostly zero) high
// bytes in long runs that deflate flattens. Order is preserved exactly.

const VERSION = 1

const zigzag = (n: number) => ((n << 1) ^ (n >> 31)) >>> 0
const unzigzag = (n: number) => (n >>> 1) ^ -(n & 1)

export async function packCoords(matches: BlockMatch[]): Promise<Uint8Array<ArrayBuffer>> {
  const n = matches.length
  const words = new Uint32Array(1 + 3 * n)
  words[0] = n
  let px = 0
  let py = 0
  let pz = 0
  for (let i = 0; i < n; i++) {
    const { x, y, z } = matches[i]
    words[1 + i] = zigzag(x - px)
    words[1 + n + i] = zigzag(y - py)
    words[1 + 2 * n + i] = zigzag(z - pz)
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
  if (packed[0] !== VERSION) throw new Error('This scan was saved in a format this page cannot read.')
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
  if (words.length !== 1 + 3 * n) throw new Error('Saved coordinates are damaged.')

  const matches: BlockMatch[] = new Array(n)
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < n; i++) {
    x += unzigzag(words[1 + i])
    y += unzigzag(words[1 + n + i])
    z += unzigzag(words[1 + 2 * n + i])
    matches[i] = { x, y, z }
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
