//! Region-file (`.mca`) sector-table walk and chunk decompression.
//!
//! Direct port of `backend/parser.py::_walk_region`. Region files layout: a
//! 4 KiB location table (1024 chunks, 4 bytes each) followed by a 4 KiB
//! timestamp table, then chunk payloads aligned to 4 KiB "sectors". Each
//! location entry is a 3-byte big-endian sector offset plus a 1-byte sector
//! count; `(0, 0)` means the chunk has not been generated.
//!
//! Note there are *two* layers of compression in play and they are unrelated:
//! the zip container deflates each `.mca` member (handled in JS, before these
//! bytes arrive), and separately each chunk inside the `.mca` is individually
//! zlib-compressed. This module handles only the second.

use std::io::Read;

use flate2::read::{GzDecoder, ZlibDecoder};

use crate::nbt::{scan_chunk, MatchSink};

const SECTOR_BYTES: usize = 4096;
const LOCATION_TABLE_BYTES: usize = SECTOR_BYTES;

// Compression ids stored in the 5th byte of a chunk payload. The high bit
// (0x80) flags an "oversized" chunk whose payload lives in an external
// c.<x>.<z>.mcc file; the low bits then give the real compression id.
const COMPRESSION_GZIP: u8 = 1;
const COMPRESSION_ZLIB: u8 = 2;
const COMPRESSION_NONE: u8 = 3;
const EXTERNAL_FLAG: u8 = 0x80;

/// Hard ceiling on a single chunk's decompressed NBT. A real chunk is a few
/// hundred KB; this generous cap stops a crafted "compression bomb" chunk from
/// inflating to gigabytes. Over-large chunks are skipped like any other
/// unreadable chunk. This is the one anti-abuse cap worth keeping now that the
/// scan runs client-side — it is what stops a malformed file wedging a tab.
const MAX_CHUNK_DECOMPRESSED: usize = 64 * 1024 * 1024;

/// The `c.<x>.<z>.mcc` sidecars that hold oversized chunks' payloads.
///
/// Sidecars are shared by every region file in a dimension's `region/`
/// directory and are usually absent entirely, so the table is built once and
/// handed to every scan.
#[derive(Default)]
pub struct ExternalChunks {
    entries: Vec<(String, Vec<u8>)>,
}

impl ExternalChunks {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, name: String, data: Vec<u8>) {
        self.entries.push((name, data));
    }

    fn get(&self, chunk_x: usize, chunk_z: usize) -> Option<&[u8]> {
        if self.entries.is_empty() {
            return None;
        }
        let name = format!("c.{chunk_x}.{chunk_z}.mcc");
        self.entries
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, data)| data.as_slice())
    }
}

/// Inflate `payload` into `out`, refusing anything past the per-chunk ceiling.
///
/// `Read::take` bounds the work *while* inflating rather than after, so a
/// compression bomb never gets to allocate its full expansion.
fn decompress_into(compression: u8, payload: &[u8], out: &mut Vec<u8>) -> bool {
    out.clear();
    // Read one byte past the cap so an exactly-at-the-cap chunk still passes
    // while an over-cap one is detectable.
    let budget = (MAX_CHUNK_DECOMPRESSED + 1) as u64;
    let read = match compression {
        // Uncompressed: already bounded by the region member's own size.
        COMPRESSION_NONE => {
            out.extend_from_slice(payload);
            Ok(out.len())
        }
        COMPRESSION_ZLIB => ZlibDecoder::new(payload).take(budget).read_to_end(out),
        COMPRESSION_GZIP => GzDecoder::new(payload).take(budget).read_to_end(out),
        _ => return false,
    };
    read.is_ok() && out.len() <= MAX_CHUNK_DECOMPRESSED
}

/// Scan every generated chunk of one region file, feeding matches to `out`.
///
/// Chunks that are absent, truncated, or fail to decompress are skipped rather
/// than aborting the whole region, mirroring how a corrupt chunk should not
/// sink an otherwise-readable save.
pub fn scan_region(data: &[u8], externals: &ExternalChunks, target: &[u8], out: &mut MatchSink) {
    // A valid region file always carries the full 4 KiB location table; a
    // shorter file (e.g. a 0-byte placeholder) holds no chunks.
    if data.len() < LOCATION_TABLE_BYTES {
        return;
    }

    // One scratch buffer reused across all 1024 chunks — the inflated NBT is
    // consumed immediately, so there is no reason to reallocate per chunk.
    let mut chunk = Vec::with_capacity(1 << 20);

    for entry in 0..1024usize {
        let loc = entry * 4;
        let sector_offset = ((data[loc] as usize) << 16)
            | ((data[loc + 1] as usize) << 8)
            | (data[loc + 2] as usize);
        if sector_offset == 0 {
            continue;
        }

        let start = match sector_offset.checked_mul(SECTOR_BYTES) {
            Some(start) => start,
            None => continue,
        };
        if start.checked_add(5).is_none_or(|end| end > data.len()) {
            continue;
        }

        let length = u32::from_be_bytes([
            data[start],
            data[start + 1],
            data[start + 2],
            data[start + 3],
        ]) as usize;
        if length < 1 {
            continue;
        }
        let mut compression = data[start + 4];

        let payload: &[u8] = if compression & EXTERNAL_FLAG != 0 {
            // Oversized chunk: payload lives in a sibling c.<x>.<z>.mcc file.
            compression &= !EXTERNAL_FLAG;
            match externals.get(entry % 32, entry / 32) {
                Some(bytes) => bytes,
                None => continue,
            }
        } else {
            // The stored length counts the compression byte plus the payload.
            let lo = start + 5;
            let hi = start
                .saturating_add(4)
                .saturating_add(length)
                .min(data.len());
            if hi <= lo {
                continue;
            }
            &data[lo..hi]
        };

        if !decompress_into(compression, payload, &mut chunk) {
            continue;
        }
        // `None` means the chunk's NBT stopped parsing partway; whatever it had
        // already emitted stays, and the next chunk is unaffected.
        let _ = scan_chunk(&chunk, target, out);
    }
}

/// Namespace a bare block id, e.g. `stone` -> `minecraft:stone`.
pub fn normalize_block_type(block_type: &str) -> String {
    if block_type.contains(':') {
        block_type.to_string()
    } else {
        format!("minecraft:{block_type}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn zlib(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    /// A region file holding one chunk whose NBT is `nbt`, at sector 2.
    fn region_with_chunk(nbt: &[u8]) -> Vec<u8> {
        let compressed = zlib(nbt);
        let mut data = vec![0u8; SECTOR_BYTES * 3];
        // Location entry 0: sector offset 2, one sector long.
        data[0] = 0;
        data[1] = 0;
        data[2] = 2;
        data[3] = 1;
        let start = 2 * SECTOR_BYTES;
        let length = (compressed.len() + 1) as u32;
        data[start..start + 4].copy_from_slice(&length.to_be_bytes());
        data[start + 4] = COMPRESSION_ZLIB;
        data[start + 5..start + 5 + compressed.len()].copy_from_slice(&compressed);
        data
    }

    /// Minimal chunk NBT: xPos/zPos plus one section that is uniformly
    /// palette[0] (no packed `data`), so all 4096 blocks match.
    fn one_section_chunk(chunk_x: i32, chunk_z: i32, section_y: i8, name: &str) -> Vec<u8> {
        let mut b = Vec::new();
        let tag_string = |b: &mut Vec<u8>, s: &str| {
            b.extend_from_slice(&(s.len() as u16).to_be_bytes());
            b.extend_from_slice(s.as_bytes());
        };
        // Root: TAG_Compound with an empty name.
        b.push(10);
        b.extend_from_slice(&0u16.to_be_bytes());
        // xPos / zPos
        b.push(3);
        tag_string(&mut b, "xPos");
        b.extend_from_slice(&chunk_x.to_be_bytes());
        b.push(3);
        tag_string(&mut b, "zPos");
        b.extend_from_slice(&chunk_z.to_be_bytes());
        // sections: TAG_List of 1 compound
        b.push(9);
        tag_string(&mut b, "sections");
        b.push(10);
        b.extend_from_slice(&1i32.to_be_bytes());
        {
            // Y
            b.push(1);
            tag_string(&mut b, "Y");
            b.push(section_y as u8);
            // block_states: compound { palette: list[ { Name: string } ] }
            b.push(10);
            tag_string(&mut b, "block_states");
            {
                b.push(9);
                tag_string(&mut b, "palette");
                b.push(10);
                b.extend_from_slice(&1i32.to_be_bytes());
                {
                    b.push(8);
                    tag_string(&mut b, "Name");
                    tag_string(&mut b, name);
                    b.push(0); // end of palette entry
                }
                b.push(0); // end of block_states
            }
            b.push(0); // end of section
        }
        b.push(0); // end of root
        b
    }

    #[test]
    fn finds_every_block_of_a_uniform_section() {
        let region = region_with_chunk(&one_section_chunk(0, 0, 4, "minecraft:stone"));
        let mut sink = MatchSink::new(10);
        scan_region(
            &region,
            &ExternalChunks::new(),
            b"minecraft:stone",
            &mut sink,
        );
        assert_eq!(sink.count(), 4096.0);
        // Section Y=4 puts the first block at y = 64.
        assert_eq!(&sink.into_coords()[..3], &[0, 64, 0]);
    }

    #[test]
    fn offsets_by_chunk_position() {
        let region = region_with_chunk(&one_section_chunk(-3, 5, 0, "minecraft:nether_portal"));
        let mut sink = MatchSink::new(1);
        scan_region(
            &region,
            &ExternalChunks::new(),
            b"minecraft:nether_portal",
            &mut sink,
        );
        assert_eq!(sink.count(), 4096.0);
        assert_eq!(sink.into_coords(), vec![-48, 0, 80]);
    }

    #[test]
    fn ignores_non_matching_blocks() {
        let region = region_with_chunk(&one_section_chunk(0, 0, 0, "minecraft:dirt"));
        let mut sink = MatchSink::new(10);
        scan_region(
            &region,
            &ExternalChunks::new(),
            b"minecraft:stone",
            &mut sink,
        );
        assert_eq!(sink.count(), 0.0);
    }

    #[test]
    fn survives_garbage_without_panicking() {
        let mut sink = MatchSink::new(10);
        // Too short to hold a location table.
        scan_region(
            &[1, 2, 3],
            &ExternalChunks::new(),
            b"minecraft:stone",
            &mut sink,
        );
        // Full-size table pointing at sectors that do not exist.
        let mut data = vec![0u8; SECTOR_BYTES];
        data[0..3].copy_from_slice(&[0xff, 0xff, 0xff]);
        scan_region(&data, &ExternalChunks::new(), b"minecraft:stone", &mut sink);
        // Valid table, garbage payload.
        let mut data = vec![0u8; SECTOR_BYTES * 3];
        data[2] = 2;
        data[3] = 1;
        data[2 * SECTOR_BYTES + 3] = 200;
        data[2 * SECTOR_BYTES + 4] = COMPRESSION_ZLIB;
        scan_region(&data, &ExternalChunks::new(), b"minecraft:stone", &mut sink);
        assert_eq!(sink.count(), 0.0);
    }

    #[test]
    fn normalizes_bare_block_ids() {
        assert_eq!(normalize_block_type("stone"), "minecraft:stone");
        assert_eq!(normalize_block_type("mod:thing"), "mod:thing");
    }
}
