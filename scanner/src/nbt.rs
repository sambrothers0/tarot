//! A purpose-built, allocation-light NBT reader for the one question this app
//! asks: "where are the blocks of type X in this chunk?" — or of types X, Y and
//! Z at once: one walk of the chunk answers for every target, each into its own
//! [`MatchSink`].
//!
//! Direct port of the reference implementation in `backend/fastnbt.py`. A
//! general NBT library eagerly materializes an object for *every* tag in
//! *every* chunk — block entities, heightmaps, biomes, and the packed block
//! `data` of every section, almost all of which we throw away. Instead this
//! walks the byte stream and skips whole subtrees it doesn't need, reads each
//! section's small palette first, and only decodes a section's expensive
//! packed `data` array when the target block actually appears in that
//! section's palette.
//!
//! Every function returns `Option`: `None` means "this chunk's bytes stopped
//! making sense, give up on it". That mirrors the Python version, where a
//! malformed chunk raises and the caller's `except` skips it — including the
//! detail that coordinates already emitted into the sink are *kept*. Nothing
//! here may panic: a panic in wasm aborts the whole module instance, which
//! would take the worker down instead of skipping one bad chunk.

/// Java-edition NBT is big-endian. Tag ids:
const TAG_END: u8 = 0;
const TAG_BYTE: u8 = 1;
const TAG_SHORT: u8 = 2;
const TAG_INT: u8 = 3;
const TAG_LONG: u8 = 4;
const TAG_FLOAT: u8 = 5;
const TAG_DOUBLE: u8 = 6;
const TAG_BYTE_ARRAY: u8 = 7;
const TAG_STRING: u8 = 8;
const TAG_LIST: u8 = 9;
const TAG_COMPOUND: u8 = 10;
const TAG_INT_ARRAY: u8 = 11;
const TAG_LONG_ARRAY: u8 = 12;

/// Ceiling on NBT nesting depth. CPython caps recursion and turns a runaway
/// `_skip` into a catchable `RecursionError`; wasm has no such backstop and a
/// blown stack traps the module, so crafted input gets a hard depth limit
/// instead. Real chunk NBT nests well under ten levels.
const MAX_DEPTH: u32 = 512;

/// Sanity ceiling on a section's palette. A real palette holds at most a few
/// hundred entries (4096 blocks in a section is the absolute upper bound);
/// anything larger is crafted input trying to make us allocate.
const MAX_PALETTE_ENTRIES: usize = 1 << 16;

/// A section always packs exactly 4096 block indices.
const SECTION_BLOCKS: usize = 4096;

/// Counts matches while retaining at most `limit` coordinates.
///
/// A target block like `stone` can occur tens of millions of times in one
/// save, so the sink keeps the *true* `count` but stops storing coordinates
/// once `limit` is reached. Coordinates are kept as a flat `x, y, z` run
/// rather than a struct per match: the whole point is that this buffer crosses
/// into JS as one `Int32Array` copy instead of a million small objects.
pub struct MatchSink {
    limit: usize,
    count: f64,
    coords: Vec<i32>,
}

impl MatchSink {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            // f64, not u64: a dense block across a whole save comfortably
            // exceeds u32, and the count only ever ends up as a JS number.
            // Integers stay exact to 2^53, far past any real block count.
            count: 0.0,
            coords: Vec::new(),
        }
    }

    #[inline]
    pub fn add(&mut self, x: i32, y: i32, z: i32) {
        self.count += 1.0;
        if self.coords.len() < self.limit * 3 {
            self.coords.push(x);
            self.coords.push(y);
            self.coords.push(z);
        }
    }

    pub fn count(&self) -> f64 {
        self.count
    }

    pub fn into_coords(self) -> Vec<i32> {
        self.coords
    }
}

#[inline]
fn byte_at(buf: &[u8], pos: usize) -> Option<u8> {
    buf.get(pos).copied()
}

#[inline]
fn u16_at(buf: &[u8], pos: usize) -> Option<usize> {
    let end = pos.checked_add(2)?;
    let b = buf.get(pos..end)?;
    Some(u16::from_be_bytes([b[0], b[1]]) as usize)
}

#[inline]
fn i32_at(buf: &[u8], pos: usize) -> Option<i32> {
    let end = pos.checked_add(4)?;
    let b = buf.get(pos..end)?;
    Some(i32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// Advance past a `name` field (2-byte length + bytes), returning the new
/// position and the name's byte range.
#[inline]
fn read_name(buf: &[u8], pos: usize) -> Option<(usize, &[u8])> {
    let len = u16_at(buf, pos)?;
    let start = pos + 2;
    let end = start.checked_add(len)?;
    Some((end, buf.get(start..end)?))
}

#[inline]
fn fixed_size(tag: u8) -> Option<usize> {
    match tag {
        TAG_BYTE => Some(1),
        TAG_SHORT => Some(2),
        TAG_INT => Some(4),
        TAG_LONG => Some(8),
        TAG_FLOAT => Some(4),
        TAG_DOUBLE => Some(8),
        _ => None,
    }
}

/// Advance `pos` past an array payload: a 4-byte count followed by
/// `count * stride` bytes. A negative count is malformed (Python would walk
/// backwards into garbage; here it just ends the chunk).
#[inline]
fn skip_array(buf: &[u8], pos: usize, stride: usize) -> Option<usize> {
    let count = i32_at(buf, pos)?;
    if count < 0 {
        return None;
    }
    pos.checked_add(4)?
        .checked_add((count as usize).checked_mul(stride)?)
}

/// Advance `pos` past one tag *payload* (no leading id/name) of type `tag`.
fn skip(buf: &[u8], pos: usize, tag: u8, depth: u32) -> Option<usize> {
    if depth > MAX_DEPTH {
        return None;
    }
    if let Some(size) = fixed_size(tag) {
        return pos.checked_add(size);
    }
    match tag {
        TAG_STRING => pos.checked_add(2)?.checked_add(u16_at(buf, pos)?),
        TAG_BYTE_ARRAY => skip_array(buf, pos, 1),
        TAG_INT_ARRAY => skip_array(buf, pos, 4),
        TAG_LONG_ARRAY => skip_array(buf, pos, 8),
        TAG_LIST => {
            let elem = byte_at(buf, pos)?;
            let count = i32_at(buf, pos + 1)?;
            let mut pos = pos.checked_add(5)?;
            // An empty list is conventionally written with element type
            // TAG_End; either way there is nothing to walk past.
            if count <= 0 {
                return Some(pos);
            }
            let count = count as usize;
            if let Some(size) = fixed_size(elem) {
                return pos.checked_add(size.checked_mul(count)?);
            }
            for _ in 0..count {
                pos = skip(buf, pos, elem, depth + 1)?;
            }
            Some(pos)
        }
        TAG_COMPOUND => {
            let mut pos = pos;
            loop {
                let child = byte_at(buf, pos)?;
                pos += 1;
                if child == TAG_END {
                    return Some(pos);
                }
                pos = read_name(buf, pos)?.0;
                pos = skip(buf, pos, child, depth + 1)?;
            }
        }
        _ => None,
    }
}

/// The most targets one scan can carry: a palette entry records its target as
/// a `u8` (0 for none), so target indices run 1..=255. The app asks for far
/// fewer; extra targets past this are ignored rather than panicking.
pub const MAX_TARGETS: usize = u8::MAX as usize;

/// Which palette entries name a target block, and which one.
struct Palette {
    /// Number of entries — this sets the packed index width.
    len: usize,
    /// For each palette index, 0 if it names no target, else the target's
    /// index plus one. A `u8` rather than an `Option<usize>` keeps the flag
    /// vector as small as the single-target `bool` one it replaced.
    target: Vec<u8>,
    any: bool,
}

/// Read a section's `palette` list, tagging each entry whose `Name` is one of
/// the targets with that target's index plus one.
///
/// The reference implementation decodes every name into a string and then
/// builds a set of matching indices; here the names are compared as raw bytes,
/// so a section whose palette holds no match costs zero allocations beyond the
/// tag vector. Block ids are ASCII, so byte equality and string equality agree.
/// The first target that equals a name wins, so a duplicated target gets
/// nothing — the caller is expected to pass distinct ones.
fn read_palette(buf: &[u8], pos: usize, targets: &[&[u8]]) -> Option<Palette> {
    // List header: element type (compound) + entry count.
    let count = i32_at(buf, pos + 1)?;
    let mut pos = pos.checked_add(5)?;
    if count < 0 || count as usize > MAX_PALETTE_ENTRIES {
        return None;
    }
    let count = count as usize;

    let mut target = Vec::with_capacity(count);
    let mut any = false;
    for _ in 0..count {
        let mut hit = 0u8;
        loop {
            let child = byte_at(buf, pos)?;
            pos += 1;
            if child == TAG_END {
                break;
            }
            let (next, key) = read_name(buf, pos)?;
            pos = next;
            if child == TAG_STRING && key == b"Name" {
                let (next, name) = read_name(buf, pos)?;
                pos = next;
                hit = targets
                    .iter()
                    .take(MAX_TARGETS)
                    .position(|t| *t == name)
                    .map_or(0, |i| i as u8 + 1);
            } else {
                pos = skip(buf, pos, child, 1)?;
            }
        }
        any |= hit != 0;
        target.push(hit);
    }
    Some(Palette {
        len: count,
        target,
        any,
    })
}

/// Number of bits each packed palette index occupies.
///
/// Mirrors Python's `max((len(names) - 1).bit_length(), 4)`.
#[inline]
fn index_bits(palette_len: usize) -> usize {
    let top = palette_len.saturating_sub(1) as u64;
    let bits = (u64::BITS - top.leading_zeros()) as usize;
    bits.max(4)
}

/// The sink a palette tag points at: none for 0, else `out[tag - 1]`. Checked,
/// so a caller that passes fewer sinks than targets loses matches rather than
/// panicking.
#[inline]
fn sink_for(out: &mut [MatchSink], tag: u8) -> Option<&mut MatchSink> {
    if tag == 0 {
        None
    } else {
        out.get_mut(tag as usize - 1)
    }
}

/// Scan one section's `block_states` compound for the target blocks.
fn emit_block_states(
    buf: &[u8],
    pos: usize,
    targets: &[&[u8]],
    base_x: i32,
    base_y: i32,
    base_z: i32,
    out: &mut [MatchSink],
) -> Option<()> {
    let mut palette_pos: Option<usize> = None;
    let mut data_pos: Option<usize> = None;
    let mut pos = pos;
    loop {
        let child = byte_at(buf, pos)?;
        pos += 1;
        if child == TAG_END {
            break;
        }
        let (next, key) = read_name(buf, pos)?;
        pos = next;
        if child == TAG_LIST && key == b"palette" {
            palette_pos = Some(pos);
        } else if child == TAG_LONG_ARRAY && key == b"data" {
            data_pos = Some(pos);
        }
        pos = skip(buf, pos, child, 1)?;
    }

    let palette_pos = match palette_pos {
        Some(p) => p,
        None => return Some(()),
    };
    let palette = read_palette(buf, palette_pos, targets)?;
    if !palette.any {
        // The expensive decode below only happens for matching sections.
        return Some(());
    }

    // A section with no packed `data` is uniformly palette[0].
    let data_pos = match data_pos {
        Some(p) => p,
        None => {
            let tag = palette.target.first().copied().unwrap_or(0);
            if let Some(sink) = sink_for(out, tag) {
                for idx in 0..SECTION_BLOCKS {
                    sink.add(
                        base_x + (idx & 15) as i32,
                        base_y + (idx >> 8) as i32,
                        base_z + ((idx >> 4) & 15) as i32,
                    );
                }
            }
            return Some(());
        }
    };

    // A section packs exactly 4096 indices, so the long array is small and
    // fixed-ish (<=1024 longs). Reject absurd counts from crafted input before
    // reading past the buffer.
    let long_count = i32_at(buf, data_pos)?;
    if long_count < 0 || long_count as usize > SECTION_BLOCKS {
        return Some(());
    }
    let start = data_pos + 4;
    let end = start.checked_add((long_count as usize).checked_mul(8)?)?;
    let longs = buf.get(start..end)?;

    // Modern (>= 1.16) packing keeps every palette index whole within a 64-bit
    // long, so each long holds `64 / bits` indices.
    let bits = index_bits(palette.len);
    let per_long = 64 / bits;
    let mask = if bits >= 64 {
        u64::MAX
    } else {
        (1u64 << bits) - 1
    };
    let tags = &palette.target;

    let mut idx = 0usize;
    // `as_chunks` yields whole `[u8; 8]` words; a trailing partial word (which
    // `long_count * 8` rules out anyway) would land in the ignored remainder.
    'outer: for word in longs.as_chunks::<8>().0 {
        let mut value = u64::from_be_bytes(*word);
        for _ in 0..per_long {
            if idx >= SECTION_BLOCKS {
                break 'outer;
            }
            let entry = (value & mask) as usize;
            // Indices past the palette can't match; the reference does the same
            // by testing membership in a set of real indices.
            let tag = tags.get(entry).copied().unwrap_or(0);
            if let Some(sink) = sink_for(out, tag) {
                sink.add(
                    base_x + (idx & 15) as i32,
                    base_y + (idx >> 8) as i32,
                    base_z + ((idx >> 4) & 15) as i32,
                );
            }
            value >>= bits;
            idx += 1;
        }
    }
    Some(())
}

/// Walk the `sections` list, scanning each section's block states.
fn scan_sections(
    buf: &[u8],
    pos: usize,
    targets: &[&[u8]],
    chunk_x: i32,
    chunk_z: i32,
    out: &mut [MatchSink],
) -> Option<()> {
    let elem = byte_at(buf, pos)?;
    let count = i32_at(buf, pos + 1)?;
    let mut pos = pos.checked_add(5)?;
    if elem != TAG_COMPOUND || count <= 0 {
        return Some(());
    }

    // wrapping_mul, not `*`: chunk coordinates come straight out of the file,
    // and a crafted xPos near i32::MAX must not panic in a debug build.
    let base_x = chunk_x.wrapping_mul(16);
    let base_z = chunk_z.wrapping_mul(16);

    for _ in 0..count {
        let mut section_y: Option<i32> = None;
        let mut block_states_pos: Option<usize> = None;
        loop {
            let child = byte_at(buf, pos)?;
            pos += 1;
            if child == TAG_END {
                break;
            }
            let (next, key) = read_name(buf, pos)?;
            pos = next;
            if child == TAG_BYTE && key == b"Y" {
                // Y is a signed byte.
                section_y = Some(byte_at(buf, pos)? as i8 as i32);
            } else if child == TAG_COMPOUND && key == b"block_states" {
                block_states_pos = Some(pos);
            }
            pos = skip(buf, pos, child, 1)?;
        }

        // Sections that are pure air carry only biomes/lighting (no block_states).
        if let (Some(bs), Some(y)) = (block_states_pos, section_y) {
            emit_block_states(buf, bs, targets, base_x, y.wrapping_mul(16), base_z, out)?;
        }
    }
    Some(())
}

/// Feed every `target`-block coordinate found in one decompressed chunk to `out`.
///
/// The single-target form of [`scan_chunk_multi`], kept for the oracle and the
/// tests that compare against it.
pub fn scan_chunk(buf: &[u8], target: &[u8], out: &mut MatchSink) -> Option<()> {
    scan_chunk_multi(buf, &[target], std::slice::from_mut(out))
}

/// Feed every coordinate of `targets[i]` found in one decompressed chunk to
/// `out[i]`, in one walk of the chunk.
///
/// Silently ignores chunks that are still generating (no `sections`) or lack
/// their position tags, mirroring the "a bad chunk shouldn't sink the save"
/// tolerance of the region reader.
pub fn scan_chunk_multi(buf: &[u8], targets: &[&[u8]], out: &mut [MatchSink]) -> Option<()> {
    // Root is a named TAG_Compound: id byte, name length, name, then payload.
    if byte_at(buf, 0)? != TAG_COMPOUND {
        return Some(());
    }
    let mut pos = read_name(buf, 1)?.0;

    let mut chunk_x: Option<i32> = None;
    let mut chunk_z: Option<i32> = None;
    let mut sections_pos: Option<usize> = None;
    // `sections` may appear before xPos/zPos in tag order, so locate all three
    // first, then scan once both coordinates are known.
    loop {
        let child = byte_at(buf, pos)?;
        pos += 1;
        if child == TAG_END {
            break;
        }
        let (next, key) = read_name(buf, pos)?;
        pos = next;
        if child == TAG_INT && key == b"xPos" {
            chunk_x = Some(i32_at(buf, pos)?);
        } else if child == TAG_INT && key == b"zPos" {
            chunk_z = Some(i32_at(buf, pos)?);
        } else if child == TAG_LIST && key == b"sections" {
            sections_pos = Some(pos);
        }
        pos = skip(buf, pos, child, 1)?;
    }

    match (chunk_x, chunk_z, sections_pos) {
        (Some(cx), Some(cz), Some(sp)) => scan_sections(buf, sp, targets, cx, cz, out),
        _ => Some(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_bits_matches_reference() {
        // Python: max((n - 1).bit_length(), 4)
        for (len, want) in [
            (0, 4),
            (1, 4),
            (2, 4),
            (16, 4),
            (17, 5),
            (32, 5),
            (33, 6),
            (256, 8),
            (257, 9),
        ] {
            assert_eq!(index_bits(len), want, "palette len {len}");
        }
    }

    #[test]
    fn skip_walks_primitives_and_containers() {
        // TAG_String "hi"
        assert_eq!(skip(&[0, 2, b'h', b'i'], 0, TAG_STRING, 0), Some(4));
        // TAG_Long_Array of 2 longs
        let mut buf = vec![0, 0, 0, 2];
        buf.extend(std::iter::repeat_n(0u8, 16));
        assert_eq!(skip(&buf, 0, TAG_LONG_ARRAY, 0), Some(20));
        // TAG_List of 3 ints
        let list = [TAG_INT, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3];
        assert_eq!(skip(&list, 0, TAG_LIST, 0), Some(17));
        // Empty TAG_Compound
        assert_eq!(skip(&[TAG_END], 0, TAG_COMPOUND, 0), Some(1));
    }

    #[test]
    fn truncated_input_gives_up_instead_of_panicking() {
        // Like the reference, `skip` only computes the next position — running
        // past the end is caught by whatever reads there next, not here.
        assert_eq!(skip(&[0, 9], 0, TAG_STRING, 0), Some(11));
        // A length field that is itself truncated fails immediately, though.
        assert_eq!(skip(&[0], 0, TAG_STRING, 0), None);
        assert_eq!(skip(&[], 0, TAG_COMPOUND, 0), None);
        assert_eq!(skip(&[0xff, 0xff, 0xff, 0xff], 0, TAG_INT_ARRAY, 0), None);
        let mut sink = MatchSink::new(10);
        assert_eq!(scan_chunk(&[], b"minecraft:stone", &mut sink), None);
    }

    #[test]
    fn deep_nesting_is_bounded() {
        // A compound that opens a nested compound forever, never closing.
        let mut buf = Vec::new();
        for _ in 0..(MAX_DEPTH as usize + 10) {
            buf.extend_from_slice(&[TAG_COMPOUND, 0, 0]);
        }
        assert_eq!(skip(&buf, 0, TAG_COMPOUND, 0), None);
    }

    #[test]
    fn sink_counts_past_its_coordinate_limit() {
        let mut sink = MatchSink::new(2);
        for i in 0..5 {
            sink.add(i, i, i);
        }
        assert_eq!(sink.count(), 5.0);
        assert_eq!(sink.into_coords(), vec![0, 0, 0, 1, 1, 1]);
    }
}
