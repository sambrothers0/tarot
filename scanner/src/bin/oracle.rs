//! Cross-check harness: scan region files on disk and print the result in a
//! form that can be diffed against the Python reference in `backend/`.
//!
//! The Rust scanner is a port, not a rewrite, so "does it agree with the
//! Python one, exactly" is the acceptance test. Both sides walk the same
//! region files in the same order, so the printed match lists should be
//! byte-identical, not merely equal as sets.
//!
//! ```text
//! cargo run --release --bin oracle -- <region-dir> <block_type> [limit]
//! ```
//!
//! Prints `count <n>` followed by one `x y z` line per retained match.

use std::env;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

use tarot_scanner::nbt::MatchSink;
use tarot_scanner::region::{normalize_block_type, scan_region, ExternalChunks};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() < 2 {
        eprintln!("usage: oracle <region-dir> <block_type> [limit]");
        return ExitCode::FAILURE;
    }
    let dir = Path::new(&args[0]);
    let target = normalize_block_type(&args[1]);
    let limit: usize = args
        .get(2)
        .and_then(|v| v.parse().ok())
        .unwrap_or(1_000_000);

    // Sorted so the Rust and Python runs visit region files in the same order.
    let mut mca: Vec<_> = Vec::new();
    let mut externals = ExternalChunks::new();
    let mut entries: Vec<_> = match fs::read_dir(dir) {
        Ok(entries) => entries.filter_map(Result::ok).map(|e| e.path()).collect(),
        Err(err) => {
            eprintln!("cannot read {}: {err}", dir.display());
            return ExitCode::FAILURE;
        }
    };
    entries.sort();
    for path in entries {
        match path.extension().and_then(|e| e.to_str()) {
            Some("mca") => mca.push(path),
            Some("mcc") => {
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                match fs::read(&path) {
                    Ok(data) => externals.insert(name, data),
                    Err(err) => eprintln!("skipping {}: {err}", path.display()),
                }
            }
            _ => {}
        }
    }

    let mut sink = MatchSink::new(limit);
    for path in &mca {
        match fs::read(path) {
            Ok(data) => scan_region(&data, &externals, target.as_bytes(), &mut sink),
            Err(err) => eprintln!("skipping {}: {err}", path.display()),
        }
    }

    let count = sink.count();
    let coords = sink.into_coords();
    let mut out = String::with_capacity(coords.len() * 8);
    out.push_str(&format!("count {count}\n"));
    for triple in coords.chunks_exact(3) {
        out.push_str(&format!("{} {} {}\n", triple[0], triple[1], triple[2]));
    }
    print!("{out}");
    ExitCode::SUCCESS
}
