//! The `oracle` CLI: the harness that diffs this crate against the Python
//! reference. Its output format is what that diff reads, so it is pinned here.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use common::*;

const PORTAL: &str = "minecraft:nether_portal";

/// A fresh, empty directory under the target dir, unique per test.
fn scratch_dir(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn oracle(args: &[&str]) -> (bool, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_oracle"))
        .args(args)
        .output()
        .expect("run oracle");
    (
        out.status.success(),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
    )
}

fn one_portal(chunk_x: i32, chunk_z: i32, idx: usize) -> Vec<u8> {
    let mut indices = vec![0usize; 4096];
    indices[idx] = 1;
    chunk(
        chunk_x,
        chunk_z,
        vec![section(4, &["minecraft:air", PORTAL], Some(&indices))],
    )
}

#[test]
fn prints_count_then_matches_in_sorted_file_order() {
    let dir = scratch_dir("oracle_order");
    // Created out of order; `r.-1.0` sorts before `r.0.0`.
    fs::write(
        dir.join("r.0.0.mca"),
        RegionBuilder::new()
            .chunk(0, &one_portal(0, 0, 1), Compression::Zlib)
            .build(),
    )
    .unwrap();
    let (builder, (name, sidecar)) =
        RegionBuilder::new().external(31, &one_portal(-1, 0, 2), Compression::Zlib);
    fs::write(dir.join("r.-1.0.mca"), builder.build()).unwrap();
    fs::write(dir.join(name), sidecar).unwrap();
    fs::write(dir.join("notes.txt"), "not a region").unwrap();

    let (ok, stdout, _) = oracle(&[dir.to_str().unwrap(), "nether_portal"]);
    assert!(ok);
    assert_eq!(stdout, "count 2\n-14 64 0\n1 64 0\n");
}

#[test]
fn limit_caps_the_list_but_not_the_count() {
    let dir = scratch_dir("oracle_limit");
    fs::write(
        dir.join("r.0.0.mca"),
        RegionBuilder::new()
            .chunk(0, &one_portal(0, 0, 0), Compression::Zlib)
            .chunk(1, &one_portal(1, 0, 0), Compression::Zlib)
            .build(),
    )
    .unwrap();
    let (ok, stdout, _) = oracle(&[dir.to_str().unwrap(), PORTAL, "1"]);
    assert!(ok);
    assert_eq!(stdout, "count 2\n0 64 0\n");
}

#[test]
fn bad_arguments_fail_with_a_message() {
    let (ok, _, stderr) = oracle(&[]);
    assert!(!ok);
    assert!(stderr.contains("usage"));

    let missing = scratch_dir("oracle_missing").join("nope");
    let (ok, _, stderr) = oracle(&[missing.to_str().unwrap(), PORTAL]);
    assert!(!ok);
    assert!(stderr.contains("cannot read"));
}
