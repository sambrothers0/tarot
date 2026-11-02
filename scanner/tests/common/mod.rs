//! Builders for synthetic saves: NBT, chunks, and region files.
//!
//! The scanner is tested against bytes built here rather than checked-in
//! fixtures, so every test states the exact world it scans and the exact
//! coordinates it expects. The encoding follows the Java-edition formats the
//! scanner reads (big-endian NBT, 4 KiB-sector region files, >= 1.18 chunk
//! layout with `sections[].block_states.{palette,data}`).

#![allow(dead_code)] // Each test binary uses a different subset.

use std::io::Write;

use flate2::write::{GzEncoder, ZlibEncoder};
use flate2::Compression as Level;

pub const SECTOR: usize = 4096;

/// An NBT value. Only what the tests need to describe a chunk.
#[derive(Clone, Debug)]
pub enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    String(String),
    /// Element type id plus the elements (which must all be that type).
    List(u8, Vec<Tag>),
    Compound(Vec<(String, Tag)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Tag {
    pub fn id(&self) -> u8 {
        match self {
            Tag::Byte(_) => 1,
            Tag::Short(_) => 2,
            Tag::Int(_) => 3,
            Tag::Long(_) => 4,
            Tag::Float(_) => 5,
            Tag::Double(_) => 6,
            Tag::ByteArray(_) => 7,
            Tag::String(_) => 8,
            Tag::List(..) => 9,
            Tag::Compound(_) => 10,
            Tag::IntArray(_) => 11,
            Tag::LongArray(_) => 12,
        }
    }

    pub fn compound(fields: Vec<(&str, Tag)>) -> Tag {
        Tag::Compound(
            fields
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        )
    }

    pub fn list_of_compounds(items: Vec<Tag>) -> Tag {
        Tag::List(10, items)
    }

    fn write_payload(&self, out: &mut Vec<u8>) {
        match self {
            Tag::Byte(v) => out.push(*v as u8),
            Tag::Short(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Long(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Double(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::ByteArray(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                out.extend(v.iter().map(|b| *b as u8));
            }
            Tag::String(s) => write_str(out, s),
            Tag::List(elem, items) => {
                out.push(*elem);
                out.extend_from_slice(&(items.len() as i32).to_be_bytes());
                for item in items {
                    assert_eq!(item.id(), *elem, "list element of the wrong type");
                    item.write_payload(out);
                }
            }
            Tag::Compound(fields) => {
                for (name, value) in fields {
                    out.push(value.id());
                    write_str(out, name);
                    value.write_payload(out);
                }
                out.push(0);
            }
            Tag::IntArray(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for x in v {
                    out.extend_from_slice(&x.to_be_bytes());
                }
            }
            Tag::LongArray(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for x in v {
                    out.extend_from_slice(&x.to_be_bytes());
                }
            }
        }
    }
}

fn write_str(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u16).to_be_bytes());
    out.extend_from_slice(s.as_bytes());
}

/// Serialise a root compound (named `""`, as in a region file).
pub fn root(fields: Vec<(&str, Tag)>) -> Vec<u8> {
    let mut out = vec![10];
    write_str(&mut out, "");
    Tag::compound(fields).write_payload(&mut out);
    out
}

/// Bits per packed palette index, as the game computes it.
pub fn index_bits(palette_len: usize) -> usize {
    let top = palette_len.saturating_sub(1);
    let bits = (usize::BITS - top.leading_zeros()) as usize;
    bits.max(4)
}

/// Pack 4096 palette indices the modern (>= 1.16) way: whole indices per long,
/// low bits first, leftover high bits zero.
pub fn pack(indices: &[usize], palette_len: usize) -> Vec<i64> {
    assert_eq!(indices.len(), 4096);
    let bits = index_bits(palette_len);
    let per_long = 64 / bits;
    indices
        .chunks(per_long)
        .map(|group| {
            let mut word = 0u64;
            for (i, idx) in group.iter().enumerate() {
                word |= (*idx as u64) << (i * bits);
            }
            word as i64
        })
        .collect()
}

/// A section. `indices` = `None` writes no `data`, i.e. uniformly palette[0].
pub fn section(y: i8, palette: &[&str], indices: Option<&[usize]>) -> Tag {
    let entries = palette
        .iter()
        .map(|name| {
            Tag::compound(vec![
                ("Name", Tag::String(name.to_string())),
                // Real palettes carry block-state properties; the scanner must
                // skip them without confusing them for `Name`.
                (
                    "Properties",
                    Tag::compound(vec![("axis", Tag::String("y".into()))]),
                ),
            ])
        })
        .collect();
    let mut block_states = vec![("palette", Tag::list_of_compounds(entries))];
    if let Some(indices) = indices {
        block_states.push(("data", Tag::LongArray(pack(indices, palette.len()))));
    }
    Tag::compound(vec![
        ("Y", Tag::Byte(y)),
        ("block_states", Tag::compound(block_states)),
        // Every real section has these; the scanner should skip them.
        (
            "biomes",
            Tag::compound(vec![(
                "palette",
                Tag::List(8, vec![Tag::String("minecraft:plains".into())]),
            )]),
        ),
        ("BlockLight", Tag::ByteArray(vec![0; 2048])),
        ("SkyLight", Tag::ByteArray(vec![-1; 2048])),
    ])
}

/// A chunk's NBT: position, sections, and the usual noise around them, so the
/// skip paths for every tag type get walked.
pub fn chunk(x: i32, z: i32, sections: Vec<Tag>) -> Vec<u8> {
    root(vec![
        ("DataVersion", Tag::Int(3953)),
        ("Status", Tag::String("minecraft:full".into())),
        ("InhabitedTime", Tag::Long(12345)),
        ("LastUpdate", Tag::Long(-1)),
        (
            "Heightmaps",
            Tag::compound(vec![("WORLD_SURFACE", Tag::LongArray(vec![7; 37]))]),
        ),
        ("isLightOn", Tag::Byte(1)),
        ("xPos", Tag::Int(x)),
        ("yPos", Tag::Int(-4)),
        ("zPos", Tag::Int(z)),
        ("block_entities", Tag::List(0, vec![])),
        (
            "PostProcessing",
            Tag::List(9, vec![Tag::List(2, vec![Tag::Short(1), Tag::Short(2)]); 3]),
        ),
        (
            "structures",
            Tag::compound(vec![
                ("References", Tag::compound(vec![])),
                ("starts", Tag::compound(vec![])),
            ]),
        ),
        (
            "fluid_ticks",
            Tag::list_of_compounds(vec![Tag::compound(vec![
                ("x", Tag::Int(1)),
                ("p", Tag::Float(0.5)),
                ("t", Tag::Double(2.0)),
                ("i", Tag::IntArray(vec![1, 2, 3])),
            ])]),
        ),
        ("sections", Tag::list_of_compounds(sections)),
    ])
}

/// World coordinates of block `idx` within a section, the scanner's order.
pub fn block_coords(chunk_x: i32, chunk_z: i32, section_y: i32, idx: usize) -> [i32; 3] {
    [
        chunk_x * 16 + (idx & 15) as i32,
        section_y * 16 + (idx >> 8) as i32,
        chunk_z * 16 + ((idx >> 4) & 15) as i32,
    ]
}

#[derive(Clone, Copy, Debug)]
pub enum Compression {
    Gzip,
    Zlib,
    None,
    /// An id the scanner does not know.
    Unknown(u8),
}

impl Compression {
    fn id(self) -> u8 {
        match self {
            Compression::Gzip => 1,
            Compression::Zlib => 2,
            Compression::None => 3,
            Compression::Unknown(id) => id,
        }
    }

    pub fn encode(self, bytes: &[u8]) -> Vec<u8> {
        match self {
            Compression::Gzip => {
                let mut e = GzEncoder::new(Vec::new(), Level::fast());
                e.write_all(bytes).unwrap();
                e.finish().unwrap()
            }
            Compression::Zlib => zlib(bytes),
            Compression::None | Compression::Unknown(_) => bytes.to_vec(),
        }
    }
}

pub fn zlib(bytes: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Level::fast());
    e.write_all(bytes).unwrap();
    e.finish().unwrap()
}

/// One chunk slot in a region under construction.
enum Slot {
    Inline { compression: u8, payload: Vec<u8> },
    External { compression: u8 },
}

/// Builds a `.mca` file. Slots are `local_x + local_z * 32`, as in the game.
#[derive(Default)]
pub struct RegionBuilder {
    slots: Vec<(usize, Slot)>,
}

impl RegionBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// A chunk stored in the region file itself.
    pub fn chunk(mut self, slot: usize, nbt: &[u8], compression: Compression) -> Self {
        self.slots.push((
            slot,
            Slot::Inline {
                compression: compression.id(),
                payload: compression.encode(nbt),
            },
        ));
        self
    }

    /// Raw payload bytes, written as-is behind the given compression id.
    pub fn raw_chunk(mut self, slot: usize, compression: u8, payload: Vec<u8>) -> Self {
        self.slots.push((
            slot,
            Slot::Inline {
                compression,
                payload,
            },
        ));
        self
    }

    /// An oversized chunk whose payload lives in `c.<x>.<z>.mcc`. Returns the
    /// sidecar alongside, keyed the way the scanner looks it up.
    pub fn external(
        mut self,
        slot: usize,
        nbt: &[u8],
        compression: Compression,
    ) -> (Self, (String, Vec<u8>)) {
        self.slots.push((
            slot,
            Slot::External {
                compression: compression.id(),
            },
        ));
        let name = format!("c.{}.{}.mcc", slot % 32, slot / 32);
        (self, (name, compression.encode(nbt)))
    }

    pub fn build(self) -> Vec<u8> {
        // Location table + timestamp table.
        let mut data = vec![0u8; 2 * SECTOR];
        for (slot, content) in self.slots {
            let start = data.len();
            let mut body = Vec::new();
            match content {
                Slot::Inline {
                    compression,
                    payload,
                } => {
                    body.extend_from_slice(&((payload.len() + 1) as u32).to_be_bytes());
                    body.push(compression);
                    body.extend_from_slice(&payload);
                }
                Slot::External { compression } => {
                    body.extend_from_slice(&1u32.to_be_bytes());
                    body.push(compression | 0x80);
                }
            }
            let sectors = body.len().div_ceil(SECTOR);
            body.resize(sectors * SECTOR, 0);
            data.extend_from_slice(&body);

            let offset = start / SECTOR;
            let loc = slot * 4;
            data[loc] = (offset >> 16) as u8;
            data[loc + 1] = (offset >> 8) as u8;
            data[loc + 2] = offset as u8;
            data[loc + 3] = sectors.min(255) as u8;
        }
        data
    }
}

/// A tiny deterministic PRNG (xorshift64*), so robustness tests are
/// reproducible without pulling in a dependency.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}
