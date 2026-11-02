import { deflateRawSync } from 'node:zlib'

// A minimal zip *writer* for tests, so the reader in `workers/zip.ts` can be
// exercised against archives whose every byte the test controls — including
// the awkward shapes real zippers produce (streamed sizes, Zip64, a stub glued
// on the front, a comment that contains the EOCD signature).

export type ZipMemberSpec = {
  name: string
  data?: Uint8Array
  /** 0 = stored, 8 = deflated (default). Anything else is written as-is. */
  method?: number
  encrypted?: boolean
  /** Extra bytes in the *local* header only, so its length differs from the central one. */
  localExtra?: Uint8Array
}

export type ZipOptions = {
  comment?: string | Uint8Array
  /** Bytes before the archive, with offsets *not* adjusted (a self-extracting stub). */
  prefix?: Uint8Array
  /** Write every entry with Zip64 sizes/offsets plus the Zip64 end records. */
  zip64?: boolean
  /** Zero sizes in local headers and a data descriptor after each payload. */
  streamed?: boolean
}

class Bytes {
  private parts: number[] = []
  get length() {
    return this.parts.length
  }
  u8(v: number) {
    this.parts.push(v & 0xff)
    return this
  }
  u16(v: number) {
    return this.u8(v).u8(v >>> 8)
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16(v >>> 16)
  }
  u64(v: number) {
    return this.u32(v % 2 ** 32).u32(Math.floor(v / 2 ** 32))
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.parts.push(x)
    return this
  }
  build() {
    return Uint8Array.from(this.parts)
  }
}

const encoder = new TextEncoder()

// CRC-32, needed only so the archives are valid for other tools too.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function buildZip(members: ZipMemberSpec[], options: ZipOptions = {}): Uint8Array {
  const out = new Bytes()
  const central = new Bytes()
  const SENTINEL = 0xffffffff

  for (const member of members) {
    const data = member.data ?? new Uint8Array(0)
    const method = member.method ?? 8
    const payload = method === 8 ? new Uint8Array(deflateRawSync(data)) : data
    const name = encoder.encode(member.name)
    const crc = crc32(data)
    const offset = out.length
    let flags = member.encrypted ? 0x1 : 0
    if (options.streamed) flags |= 0x8
    const localExtra = member.localExtra ?? new Uint8Array(0)

    // Local header.
    out.u32(0x04034b50).u16(20).u16(flags).u16(method).u16(0).u16(0)
    if (options.streamed) out.u32(0).u32(0).u32(0)
    else out.u32(crc).u32(payload.length).u32(data.length)
    out.u16(name.length).u16(localExtra.length).bytes(name).bytes(localExtra)
    out.bytes(payload)
    if (options.streamed) out.u32(0x08074b50).u32(crc).u32(payload.length).u32(data.length)

    // Central directory entry.
    const zip64Extra = options.zip64
      ? new Bytes().u16(0x0001).u16(24).u64(data.length).u64(payload.length).u64(offset).build()
      : new Uint8Array(0)
    central
      .u32(0x02014b50)
      .u16(45)
      .u16(options.zip64 ? 45 : 20)
      .u16(flags)
      .u16(method)
      .u16(0)
      .u16(0)
      .u32(crc)
      .u32(options.zip64 ? SENTINEL : payload.length)
      .u32(options.zip64 ? SENTINEL : data.length)
      .u16(name.length)
      .u16(zip64Extra.length)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(options.zip64 ? SENTINEL : offset)
      .bytes(name)
      .bytes(zip64Extra)
  }

  const cdOffset = out.length
  const cd = central.build()
  out.bytes(cd)

  if (options.zip64) {
    const recordOffset = out.length
    out
      .u32(0x06064b50)
      .u64(44)
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(members.length)
      .u64(members.length)
      .u64(cd.length)
      .u64(cdOffset)
    out.u32(0x07064b50).u32(0).u64(recordOffset).u32(1)
  }

  const comment =
    typeof options.comment === 'string' ? encoder.encode(options.comment) : (options.comment ?? new Uint8Array(0))
  out
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(options.zip64 ? 0xffff : members.length)
    .u16(options.zip64 ? 0xffff : members.length)
    .u32(options.zip64 ? SENTINEL : cd.length)
    .u32(options.zip64 ? SENTINEL : cdOffset)
    .u16(comment.length)
    .bytes(comment)

  const archive = out.build()
  if (!options.prefix) return archive
  const joined = new Uint8Array(options.prefix.length + archive.length)
  joined.set(options.prefix)
  joined.set(archive, options.prefix.length)
  return joined
}
