import { deflateSync } from 'node:zlib'

// A synthetic Minecraft save, built byte by byte, for tests that run the real
// scan pipeline (unit tests of the save reader, and the end-to-end browser
// test). The layout matches a real Java-edition world closely enough for the
// scanner: zlib-compressed chunks in 4 KiB-sector region files, >= 1.18 chunk
// NBT with `sections[].block_states.{palette,data}`.
//
// Every block placement is explicit, so each dimension's expected match count
// is known exactly — see `EXPECTED`.

const SECTOR = 4096

class Nbt {
  private parts: number[] = []
  u8(v: number) {
    this.parts.push(v & 0xff)
    return this
  }
  u16(v: number) {
    return this.u8(v >>> 8).u8(v)
  }
  i32(v: number) {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff)
  }
  i64(hi: number, lo: number) {
    return this.i32(hi).i32(lo)
  }
  str(s: string) {
    const b = new TextEncoder().encode(s)
    this.u16(b.length)
    for (const x of b) this.parts.push(x)
    return this
  }
  /** A named tag header: id + name. */
  tag(id: number, name: string) {
    return this.u8(id).str(name)
  }
  build() {
    return Uint8Array.from(this.parts)
  }
}

/** Pack 4096 palette indices into longs, modern layout, as [hi, lo] u32 pairs. */
function pack(indices: number[], paletteLen: number): [number, number][] {
  const bits = Math.max(4, Math.ceil(Math.log2(Math.max(paletteLen, 2))))
  const perLong = Math.floor(64 / bits)
  const longs: [number, number][] = []
  for (let i = 0; i < indices.length; i += perLong) {
    let word = 0n
    for (let j = 0; j < perLong && i + j < indices.length; j++) {
      word |= BigInt(indices[i + j]) << BigInt(j * bits)
    }
    longs.push([Number(word >> 32n), Number(word & 0xffffffffn)])
  }
  return longs
}

export type SectionSpec = {
  y: number
  palette: string[]
  /** Block index → palette index; anything absent is palette[0]. Omit for a uniform section. */
  blocks?: Map<number, number>
}

/** One chunk's NBT (uncompressed). */
export function chunkNbt(x: number, z: number, sections: SectionSpec[]): Uint8Array {
  const n = new Nbt()
  n.u8(10).str('') // root compound
  n.tag(3, 'DataVersion').i32(3953)
  n.tag(8, 'Status').str('minecraft:full')
  n.tag(3, 'xPos').i32(x)
  n.tag(3, 'zPos').i32(z)
  n.tag(9, 'sections').u8(10).i32(sections.length)
  for (const s of sections) {
    n.tag(1, 'Y').u8(s.y)
    n.tag(10, 'block_states')
    n.tag(9, 'palette').u8(10).i32(s.palette.length)
    for (const name of s.palette) n.tag(8, 'Name').str(name).u8(0)
    if (s.blocks) {
      const indices = Array.from({ length: 4096 }, (_, i) => s.blocks?.get(i) ?? 0)
      const longs = pack(indices, s.palette.length)
      n.tag(12, 'data').i32(longs.length)
      for (const [hi, lo] of longs) n.i64(hi, lo)
    }
    n.u8(0) // end block_states
    n.u8(0) // end section
  }
  n.u8(0) // end root
  return n.build()
}

/** A region file from `slot → chunk NBT`, zlib-compressed per chunk. */
export function regionFile(chunks: Map<number, Uint8Array>): Uint8Array<ArrayBuffer> {
  const body: number[] = []
  const table = new Uint8Array(2 * SECTOR)
  let sector = 2
  for (const [slot, nbt] of chunks) {
    const payload = deflateSync(nbt)
    const record = new Uint8Array(Math.ceil((payload.length + 5) / SECTOR) * SECTOR)
    new DataView(record.buffer).setUint32(0, payload.length + 1)
    record[4] = 2
    record.set(payload, 5)
    const sectors = record.length / SECTOR
    table[slot * 4] = sector >> 16
    table[slot * 4 + 1] = sector >> 8
    table[slot * 4 + 2] = sector
    table[slot * 4 + 3] = sectors
    for (const b of record) body.push(b)
    sector += sectors
  }
  const out = new Uint8Array(table.length + body.length)
  out.set(table)
  out.set(body, table.length)
  return out
}

/** Block index within a section for local (x, y, z). */
const at = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x

/** A vertical portal-ish column of `height` target blocks at local (x, z). */
function column(x: number, z: number, y0: number, height: number): Map<number, number> {
  const blocks = new Map<number, number>()
  for (let y = y0; y < y0 + height; y++) blocks.set(at(x, y, z), 1)
  return blocks
}

export const TARGET = 'minecraft:nether_portal'
const AIR = 'minecraft:air'
const STONE = 'minecraft:stone'

/**
 * The world: a few region files per dimension, the target scattered through
 * them, plus the clutter a real save has (level.dat, entities/, poi/) that the
 * scan must ignore. Paths are relative to the save root, `/`-separated.
 */
export function buildWorld(root = 'TestWorld'): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()

  // Overworld: r.0.0 holds a 3-tall column and a uniform section of stone;
  // r.-1.-1 holds a 4-tall column in a chunk at negative coordinates.
  files.set(
    `${root}/region/r.0.0.mca`,
    regionFile(
      new Map([
        [0, chunkNbt(0, 0, [{ y: 4, palette: [AIR, TARGET], blocks: column(3, 5, 0, 3) }])],
        [33, chunkNbt(1, 1, [{ y: 0, palette: [STONE] }])],
      ]),
    ),
  )
  files.set(
    `${root}/region/r.-1.-1.mca`,
    regionFile(
      new Map([[1023, chunkNbt(-1, -1, [{ y: -1, palette: [STONE, TARGET], blocks: column(15, 15, 0, 4) }])]]),
    ),
  )
  // Nether: two columns in one chunk, 5 blocks.
  const nether = column(0, 0, 0, 2)
  for (const [k, v] of column(8, 8, 2, 3)) nether.set(k, v)
  files.set(
    `${root}/DIM-1/region/r.0.0.mca`,
    regionFile(new Map([[0, chunkNbt(2, 3, [{ y: 2, palette: [AIR, TARGET], blocks: nether }])]])),
  )
  // End: none of the target at all.
  files.set(
    `${root}/DIM1/region/r.0.0.mca`,
    regionFile(new Map([[0, chunkNbt(0, 0, [{ y: 0, palette: [STONE] }])]])),
  )

  // Noise the scan must not read as region data.
  files.set(`${root}/level.dat`, new Uint8Array([0x1f, 0x8b, 0, 0]))
  files.set(`${root}/entities/r.0.0.mca`, regionFile(new Map([[0, chunkNbt(0, 0, [{ y: 0, palette: [TARGET] }])]])))
  files.set(`${root}/poi/r.0.0.mca`, new Uint8Array(0))
  files.set(`${root}/region/r.5.5.mca`, new Uint8Array(0)) // a zero-byte placeholder region
  return files
}

/** What a scan for `TARGET` must report in each dimension of `buildWorld()`. */
export const EXPECTED = {
  overworld: {
    count: 7,
    // Region files are scanned in sorted name order: r.-1.-1 before r.0.0.
    first: { x: -1, y: -16, z: -1 },
  },
  nether: { count: 5 },
  end: { count: 0 },
} as const
