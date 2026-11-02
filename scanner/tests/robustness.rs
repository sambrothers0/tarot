//! "Nothing in the scanner may panic." A panic in wasm aborts the module
//! instance and takes the worker down with it, so every malformed input must
//! end in a skipped chunk instead. These tests throw truncations and seeded
//! random corruption at real-shaped data and only ask that the scan returns.
//!
//! Deterministic by construction (fixed seeds, no clock), so a failure here
//! reproduces exactly. Bump `ROUNDS` locally for a longer soak.

mod common;

use common::*;
use tarot_scanner::nbt::{scan_chunk, MatchSink};
use tarot_scanner::region::{scan_region, ExternalChunks};

const ROUNDS: usize = 3_000;
const PORTAL: &[u8] = b"minecraft:nether_portal";

fn sample_chunk() -> Vec<u8> {
    let mut indices = vec![0usize; 4096];
    for i in (0..4096).step_by(37) {
        indices[i] = 1 + i % 18;
    }
    let names: Vec<String> = (0..19)
        .map(|i| {
            if i == 1 {
                "minecraft:nether_portal".into()
            } else {
                format!("test:b{i}")
            }
        })
        .collect();
    let palette: Vec<&str> = names.iter().map(String::as_str).collect();
    chunk(
        -2,
        7,
        vec![
            section(-1, &palette, Some(&indices)),
            section(0, &["minecraft:nether_portal"], None),
        ],
    )
}

fn full_count(nbt: &[u8]) -> f64 {
    let mut sink = MatchSink::new(0);
    scan_chunk(nbt, PORTAL, &mut sink).expect("the sample chunk parses");
    sink.count()
}

#[test]
fn every_truncation_of_a_chunk_is_survivable() {
    let nbt = sample_chunk();
    let full = full_count(&nbt);
    assert!(full > 4096.0);
    for len in 0..nbt.len() {
        let mut sink = MatchSink::new(10);
        let _ = scan_chunk(&nbt[..len], PORTAL, &mut sink);
        // A cut can only lose matches, never invent them.
        assert!(sink.count() <= full, "truncated to {len}");
    }
}

#[test]
fn random_byte_corruption_of_a_chunk_never_panics() {
    let nbt = sample_chunk();
    let mut rng = Rng::new(0x5eed_0001);
    for _ in 0..ROUNDS {
        let mut bytes = nbt.clone();
        for _ in 0..1 + rng.below(8) {
            let at = rng.below(bytes.len());
            bytes[at] = rng.next_u64() as u8;
        }
        let mut sink = MatchSink::new(10);
        let _ = scan_chunk(&bytes, PORTAL, &mut sink);
    }
}

#[test]
fn hostile_length_fields_never_panic() {
    // Overwrite 4-byte windows with extreme values: this is how a crafted file
    // would aim list counts, array lengths and string lengths at overflow.
    let nbt = sample_chunk();
    let extremes: [[u8; 4]; 5] = [
        [0xff, 0xff, 0xff, 0xff],
        [0x7f, 0xff, 0xff, 0xff],
        [0x80, 0x00, 0x00, 0x00],
        [0x00, 0x00, 0xff, 0xff],
        [0x00, 0x01, 0x00, 0x00],
    ];
    for at in 0..nbt.len().saturating_sub(4) {
        for value in &extremes {
            let mut bytes = nbt.clone();
            bytes[at..at + 4].copy_from_slice(value);
            let mut sink = MatchSink::new(10);
            let _ = scan_chunk(&bytes, PORTAL, &mut sink);
        }
    }
}

#[test]
fn arbitrary_bytes_as_a_region_never_panic() {
    let mut rng = Rng::new(0x5eed_0002);
    let externals = ExternalChunks::new();
    for _ in 0..200 {
        let len = rng.below(3 * SECTOR);
        let bytes: Vec<u8> = (0..len).map(|_| rng.next_u64() as u8).collect();
        let mut sink = MatchSink::new(10);
        scan_region(&bytes, &externals, PORTAL, &mut sink);
    }
}

#[test]
fn corrupted_region_files_never_panic() {
    let nbt = sample_chunk();
    let (builder, (name, sidecar)) = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .chunk(1, &nbt, Compression::Gzip)
        .chunk(2, &nbt, Compression::None)
        .external(3, &nbt, Compression::Zlib);
    let region = builder.build();
    let mut externals = ExternalChunks::new();
    externals.insert(name, sidecar);

    let mut sink = MatchSink::new(0);
    scan_region(&region, &externals, PORTAL, &mut sink);
    let full = sink.count();
    assert_eq!(full, 4.0 * full_count(&nbt));

    let mut rng = Rng::new(0x5eed_0003);
    for round in 0..ROUNDS / 10 {
        let mut bytes = region.clone();
        // Bias towards the headers: the location table and each chunk's
        // length/compression bytes are where a bad value does the most.
        for _ in 0..1 + rng.below(6) {
            let at = if round % 2 == 0 {
                rng.below(bytes.len())
            } else {
                rng.below(SECTOR + 16)
            };
            bytes[at] = rng.next_u64() as u8;
        }
        if round % 7 == 0 {
            bytes.truncate(rng.below(bytes.len()));
        }
        let mut sink = MatchSink::new(10);
        scan_region(&bytes, &externals, PORTAL, &mut sink);
    }
}

#[test]
fn extreme_chunk_positions_wrap_instead_of_overflowing() {
    // `xPos * 16` overflows i32 for these; the scanner wraps rather than
    // panicking (a debug build would otherwise trap on the multiply).
    for (x, z) in [(i32::MAX, i32::MIN), (i32::MIN, i32::MAX)] {
        let nbt = chunk(
            x,
            z,
            vec![section(i8::MIN, &["minecraft:nether_portal"], None)],
        );
        let mut sink = MatchSink::new(1);
        scan_chunk(&nbt, PORTAL, &mut sink).unwrap();
        assert_eq!(sink.count(), 4096.0);
    }
}
