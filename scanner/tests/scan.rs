//! End-to-end scans of synthetic region files, through both the native API
//! (`region::scan_region`) and the `wasm_bindgen` surface (`scan_region`).

mod common;

use common::*;
use tarot_scanner::nbt::MatchSink;
use tarot_scanner::region::{self, ExternalChunks};
use tarot_scanner::{scan_region, ExternalChunks as JsExternalChunks};

const STONE: &str = "minecraft:stone";
const AIR: &str = "minecraft:air";
const PORTAL: &str = "minecraft:nether_portal";

/// Scan `region` natively for `target`, returning `(count, triples)`.
fn scan(region: &[u8], externals: &ExternalChunks, target: &str) -> (f64, Vec<[i32; 3]>) {
    let mut sink = MatchSink::new(usize::MAX / 3);
    region::scan_region(region, externals, target.as_bytes(), &mut sink);
    let count = sink.count();
    let coords = sink.into_coords().as_chunks::<3>().0.to_vec();
    (count, coords)
}

fn no_externals() -> ExternalChunks {
    ExternalChunks::new()
}

/// Indices with `palette[1]` at exactly `hits`, `palette[0]` elsewhere.
fn indices_with(hits: &[usize]) -> Vec<usize> {
    let mut indices = vec![0usize; 4096];
    for &i in hits {
        indices[i] = 1;
    }
    indices
}

#[test]
fn packed_section_reports_exact_coordinates_in_index_order() {
    let hits = [0, 1, 15, 16, 255, 256, 4095];
    let nbt = chunk(
        2,
        -1,
        vec![section(3, &[AIR, PORTAL], Some(&indices_with(&hits)))],
    );
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .build();

    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, hits.len() as f64);
    let want: Vec<_> = hits.iter().map(|&i| block_coords(2, -1, 3, i)).collect();
    assert_eq!(coords, want);
    // Spot-check the axis mapping by hand: idx 15 is +15 in X, 16 is +1 in Z,
    // 256 is +1 in Y.
    assert_eq!(coords[2], [47, 48, -16]);
    assert_eq!(coords[3], [32, 48, -15]);
    assert_eq!(coords[5], [32, 49, -16]);
}

#[test]
fn every_index_width_decodes() {
    // Palette sizes straddling each bit-width boundary, including widths where
    // 64 is not a multiple (5, 6, 7 bits) and the top bits of each long go
    // unused.
    for palette_len in [2usize, 16, 17, 32, 33, 64, 65, 128, 129, 300] {
        let names: Vec<String> = (0..palette_len)
            .map(|i| format!("test:block_{i}"))
            .collect();
        let palette: Vec<&str> = names.iter().map(String::as_str).collect();
        let target = palette_len - 1; // the highest index uses every bit
        let indices: Vec<usize> = (0..4096).map(|i| i % palette_len).collect();
        let nbt = chunk(0, 0, vec![section(0, &palette, Some(&indices))]);
        let region = RegionBuilder::new()
            .chunk(0, &nbt, Compression::Zlib)
            .build();

        let (count, coords) = scan(&region, &no_externals(), palette[target]);
        let want: Vec<_> = (0..4096)
            .filter(|i| i % palette_len == target)
            .map(|i| block_coords(0, 0, 0, i))
            .collect();
        assert_eq!(count, want.len() as f64, "palette len {palette_len}");
        assert_eq!(coords, want, "palette len {palette_len}");
    }
}

#[test]
fn uniform_section_matches_only_when_palette_zero_is_the_target() {
    let nbt = chunk(0, 0, vec![section(0, &[STONE, PORTAL], None)]);
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .build();
    assert_eq!(scan(&region, &no_externals(), STONE).0, 4096.0);
    // Present in the palette but with no `data`, palette[1] occurs nowhere.
    assert_eq!(scan(&region, &no_externals(), PORTAL).0, 0.0);
}

#[test]
fn out_of_range_palette_indices_never_match() {
    // A 2-entry palette packs 4 bits per index, so indices up to 15 are
    // representable but only 0 and 1 are real.
    let mut indices = vec![15usize; 4096];
    indices[7] = 1;
    let mut nbt_section = section(0, &[AIR, PORTAL], None);
    if let Tag::Compound(fields) = &mut nbt_section {
        let bs = fields
            .iter_mut()
            .find(|(k, _)| k == "block_states")
            .unwrap();
        if let Tag::Compound(bs) = &mut bs.1 {
            bs.push(("data".into(), Tag::LongArray(pack(&indices, 16))));
        }
    }
    let region = RegionBuilder::new()
        .chunk(0, &chunk(0, 0, vec![nbt_section]), Compression::Zlib)
        .build();
    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, 1.0);
    assert_eq!(coords, vec![block_coords(0, 0, 0, 7)]);
}

#[test]
fn negative_sections_and_chunks_map_to_negative_world_coordinates() {
    let nbt = chunk(
        -1,
        -32,
        vec![section(-4, &[AIR, PORTAL], Some(&indices_with(&[0])))],
    );
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .build();
    let (_, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(coords, vec![[-16, -64, -512]]);
}

#[test]
fn sections_may_precede_the_position_tags() {
    let nbt = root(vec![
        (
            "sections",
            Tag::list_of_compounds(vec![section(1, &[AIR, PORTAL], Some(&indices_with(&[3])))]),
        ),
        ("zPos", Tag::Int(4)),
        ("xPos", Tag::Int(5)),
    ]);
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .build();
    let (_, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(coords, vec![block_coords(5, 4, 1, 3)]);
}

#[test]
fn every_supported_compression_scans_the_same() {
    let nbt = chunk(
        1,
        1,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[9, 99])))],
    );
    let expected = scan(
        &RegionBuilder::new()
            .chunk(0, &nbt, Compression::Zlib)
            .build(),
        &no_externals(),
        PORTAL,
    );
    assert_eq!(expected.0, 2.0);
    for compression in [Compression::Gzip, Compression::None] {
        let region = RegionBuilder::new().chunk(0, &nbt, compression).build();
        assert_eq!(
            scan(&region, &no_externals(), PORTAL),
            expected,
            "{compression:?}"
        );
    }
}

#[test]
fn unknown_compression_skips_only_that_chunk() {
    let good = chunk(1, 0, vec![section(0, &[PORTAL], None)]);
    let region = RegionBuilder::new()
        .chunk(
            0,
            &chunk(0, 0, vec![section(0, &[PORTAL], None)]),
            Compression::Unknown(4),
        )
        .chunk(1, &good, Compression::Zlib)
        .build();
    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, 4096.0);
    assert_eq!(coords[0], [16, 0, 0]);
}

#[test]
fn chunks_are_visited_in_location_table_order() {
    // Written to the file in reverse slot order: the scan order must follow
    // the table (slot 0 first), not the byte layout.
    let a = chunk(
        0,
        0,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[0])))],
    );
    let b = chunk(
        1,
        0,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[0])))],
    );
    let c = chunk(
        0,
        1,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[0])))],
    );
    let region = RegionBuilder::new()
        .chunk(32, &c, Compression::Zlib)
        .chunk(1, &b, Compression::Zlib)
        .chunk(0, &a, Compression::Zlib)
        .build();
    let (_, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(coords, vec![[0, 0, 0], [16, 0, 0], [0, 0, 16]]);
}

#[test]
fn chunk_spanning_several_sectors_is_read_whole() {
    // Uncompressed and with a 300-entry palette, this chunk is far over 4 KiB.
    let names: Vec<String> = (0..300).map(|i| format!("test:b{i}")).collect();
    let palette: Vec<&str> = names.iter().map(String::as_str).collect();
    let indices: Vec<usize> = (0..4096).map(|i| i % 300).collect();
    let nbt = chunk(0, 0, vec![section(0, &palette, Some(&indices))]);
    assert!(nbt.len() > 3 * SECTOR);
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::None)
        .build();
    assert_eq!(scan(&region, &no_externals(), "test:b299").0, 13.0);
}

#[test]
fn oversized_chunks_are_read_from_their_sidecar() {
    let nbt = chunk(
        3,
        2,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[5])))],
    );
    let slot = 3 + 2 * 32;
    let (builder, (name, bytes)) = RegionBuilder::new().external(slot, &nbt, Compression::Zlib);
    let region = builder.build();
    assert_eq!(name, "c.3.2.mcc");

    // Without the sidecar the chunk is skipped, not fatal.
    assert_eq!(scan(&region, &no_externals(), PORTAL).0, 0.0);

    let mut externals = ExternalChunks::new();
    externals.insert("c.9.9.mcc".into(), vec![1, 2, 3]);
    externals.insert(name, bytes);
    let (count, coords) = scan(&region, &externals, PORTAL);
    assert_eq!(count, 1.0);
    assert_eq!(coords, vec![block_coords(3, 2, 0, 5)]);
}

#[test]
fn chunks_without_sections_or_position_are_ignored() {
    let no_sections = root(vec![("xPos", Tag::Int(0)), ("zPos", Tag::Int(0))]);
    let no_position = root(vec![(
        "sections",
        Tag::list_of_compounds(vec![section(0, &[PORTAL], None)]),
    )]);
    let air_only = root(vec![
        ("xPos", Tag::Int(0)),
        ("zPos", Tag::Int(0)),
        // A section with no block_states, like a pure-air section.
        (
            "sections",
            Tag::list_of_compounds(vec![Tag::compound(vec![("Y", Tag::Byte(0))])]),
        ),
    ]);
    let not_a_compound = vec![8u8, 0, 0, 0, 0];
    let region = RegionBuilder::new()
        .chunk(0, &no_sections, Compression::Zlib)
        .chunk(1, &no_position, Compression::Zlib)
        .chunk(2, &air_only, Compression::Zlib)
        .chunk(3, &not_a_compound, Compression::Zlib)
        .chunk(
            4,
            &chunk(4, 0, vec![section(0, &[PORTAL], None)]),
            Compression::Zlib,
        )
        .build();
    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, 4096.0);
    assert_eq!(coords[0], [64, 0, 0]);
}

#[test]
fn a_truncated_chunk_is_skipped_whole_and_the_next_one_still_scans() {
    // The root compound is walked end to end before any section is scanned,
    // so a cut anywhere in it drops the whole chunk.
    let full = chunk(
        0,
        0,
        vec![
            section(0, &[AIR, PORTAL], Some(&indices_with(&[1, 2]))),
            section(1, &[AIR, PORTAL], Some(&indices_with(&[3]))),
        ],
    );
    let truncated = &full[..full.len() - 200];
    let next = chunk(
        1,
        0,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[0])))],
    );
    let region = RegionBuilder::new()
        .chunk(0, truncated, Compression::Zlib)
        .chunk(1, &next, Compression::Zlib)
        .build();
    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, 1.0);
    assert_eq!(coords, vec![[16, 0, 0]]);
}

#[test]
fn a_section_that_fails_midway_keeps_earlier_sections_matches() {
    // Structurally valid NBT (so the root walk succeeds) whose second section
    // has an absurd palette. Like the Python reference, matches the chunk had
    // already emitted stay, and the next chunk is unaffected.
    let bad_section = Tag::compound(vec![
        ("Y", Tag::Byte(1)),
        (
            "block_states",
            Tag::compound(vec![("palette", Tag::List(1, vec![Tag::Byte(0); 70_000]))]),
        ),
    ]);
    let broken = chunk(
        0,
        0,
        vec![
            section(0, &[AIR, PORTAL], Some(&indices_with(&[1, 2]))),
            bad_section,
            section(2, &[AIR, PORTAL], Some(&indices_with(&[3]))),
        ],
    );
    let next = chunk(
        1,
        0,
        vec![section(0, &[AIR, PORTAL], Some(&indices_with(&[0])))],
    );
    let region = RegionBuilder::new()
        .chunk(0, &broken, Compression::Zlib)
        .chunk(1, &next, Compression::Zlib)
        .build();
    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, 3.0);
    assert_eq!(coords, vec![[1, 0, 0], [2, 0, 0], [16, 0, 0]]);
}

#[test]
fn corrupt_compressed_payload_skips_only_that_chunk() {
    let region = RegionBuilder::new()
        .raw_chunk(0, 2, vec![0xde, 0xad, 0xbe, 0xef])
        .chunk(
            1,
            &chunk(1, 0, vec![section(0, &[PORTAL], None)]),
            Compression::Zlib,
        )
        .build();
    assert_eq!(scan(&region, &no_externals(), PORTAL).0, 4096.0);
}

#[test]
fn compression_bomb_is_refused() {
    // A valid chunk, padded with a trailing 65 MB of zero bytes inside the
    // root compound's payload (after TAG_End, so a parser would never see it).
    // It inflates past the 64 MiB per-chunk cap and must be skipped whole.
    let mut nbt = chunk(0, 0, vec![section(0, &[PORTAL], None)]);
    nbt.resize(nbt.len() + 65 * 1024 * 1024, 0);
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .chunk(
            1,
            &chunk(1, 0, vec![section(0, &[PORTAL], None)]),
            Compression::Zlib,
        )
        .build();
    let (count, coords) = scan(&region, &no_externals(), PORTAL);
    assert_eq!(count, 4096.0, "only the second chunk counts");
    assert_eq!(coords[0], [16, 0, 0]);
}

#[test]
fn block_names_must_match_exactly() {
    let nbt = chunk(0, 0, vec![section(0, &[STONE], None)]);
    let region = RegionBuilder::new()
        .chunk(0, &nbt, Compression::Zlib)
        .build();
    for miss in [
        "minecraft:ston",
        "minecraft:stone ",
        "minecraft:Stone",
        "stone",
    ] {
        assert_eq!(scan(&region, &no_externals(), miss).0, 0.0, "{miss:?}");
    }
}

// --- The wasm_bindgen surface -------------------------------------------------

fn portal_region() -> Vec<u8> {
    RegionBuilder::new()
        .chunk(
            0,
            &chunk(
                0,
                0,
                vec![section(
                    0,
                    &[AIR, PORTAL],
                    Some(&indices_with(&[0, 1, 2, 3])),
                )],
            ),
            Compression::Zlib,
        )
        .build()
}

#[test]
fn js_api_namespaces_bare_block_ids() {
    let externals = JsExternalChunks::new();
    let bare = scan_region(&portal_region(), &externals, "nether_portal", 100);
    let full = scan_region(&portal_region(), &externals, PORTAL, 100);
    assert_eq!(bare.count(), 4.0);
    assert_eq!(full.count(), 4.0);
}

#[test]
fn js_api_truncates_coordinates_but_not_the_count() {
    let externals = JsExternalChunks::new();
    let mut result = scan_region(&portal_region(), &externals, PORTAL, 2);
    assert_eq!(result.count(), 4.0);
    assert!(result.truncated());
    assert_eq!(result.take_coords(), vec![0, 0, 0, 1, 0, 0]);
    // The buffer is moved out, not copied: a second take is empty.
    assert!(result.take_coords().is_empty());

    let mut exact = scan_region(&portal_region(), &externals, PORTAL, 4);
    assert!(!exact.truncated());
    assert_eq!(exact.take_coords().len(), 12);

    let mut none = scan_region(&portal_region(), &externals, PORTAL, 0);
    assert_eq!(none.count(), 4.0);
    assert!(none.truncated());
    assert!(none.take_coords().is_empty());
}

#[test]
fn js_api_reads_sidecars_inserted_by_name() {
    let nbt = chunk(0, 0, vec![section(0, &[PORTAL], None)]);
    let (builder, (name, bytes)) = RegionBuilder::new().external(0, &nbt, Compression::Gzip);
    let mut externals = JsExternalChunks::new();
    externals.insert(name, &bytes);
    let result = scan_region(&builder.build(), &externals, PORTAL, 0);
    assert_eq!(result.count(), 4096.0);
}

#[test]
fn js_api_handles_empty_and_tiny_inputs() {
    let externals = JsExternalChunks::default();
    for bytes in [
        &[][..],
        &[0u8; 100][..],
        &[0u8; SECTOR][..],
        &[0u8; 2 * SECTOR][..],
    ] {
        let mut result = scan_region(bytes, &externals, PORTAL, 10);
        assert_eq!(result.count(), 0.0);
        assert!(!result.truncated());
        assert!(result.take_coords().is_empty());
    }
}
