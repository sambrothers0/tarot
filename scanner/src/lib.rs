//! Minecraft block scanner, compiled to WebAssembly.
//!
//! This is the whole engine of the app: the browser opens the save zip, hands
//! one region file's bytes at a time to a pool of workers, and each worker
//! calls [`scan_region`] here. Nothing is uploaded and there is no server.
//!
//! `backend/` keeps the original Python implementation as the reference
//! oracle — the two must agree on counts and on the exact match set for any
//! given save. See `scanner/README.md` for how to run that comparison.

pub mod nbt;
pub mod region;

use wasm_bindgen::prelude::*;

pub use nbt::MatchSink;
pub use region::{normalize_block_type, ExternalChunks as ExternalChunkTable};

/// The `c.<x>.<z>.mcc` sidecars for one dimension's `region/` directory.
///
/// Built once per worker and reused for every region file it scans, because
/// sidecars are shared across the whole directory (and are usually absent).
#[wasm_bindgen]
pub struct ExternalChunks {
    inner: region::ExternalChunks,
}

#[wasm_bindgen]
impl ExternalChunks {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: region::ExternalChunks::new(),
        }
    }

    /// Add one sidecar, keyed by its bare file name (`c.3.17.mcc`).
    pub fn insert(&mut self, name: String, data: &[u8]) {
        self.inner.insert(name, data.to_vec());
    }
}

impl Default for ExternalChunks {
    fn default() -> Self {
        Self::new()
    }
}

/// The outcome of scanning one region file for one or more blocks.
///
/// `coords` is a flat run of `x, y, z` triples rather than a list of objects:
/// a dense block yields millions of matches, and building a JS object per
/// match across the wasm boundary costs more than the scan itself. The runs
/// for each target sit back to back, in target order; `lengths[i]` says how
/// many triples belong to target `i`.
#[wasm_bindgen]
pub struct ScanResult {
    counts: Vec<f64>,
    lengths: Vec<u32>,
    coords: Vec<i32>,
}

#[wasm_bindgen]
impl ScanResult {
    /// Every match found per target, including those past its coordinate limit.
    #[wasm_bindgen(getter)]
    pub fn counts(&self) -> Vec<f64> {
        self.counts.clone()
    }

    /// How many coordinate triples each target retained, in target order.
    /// Where this is less than the target's count, its coordinates are a prefix.
    #[wasm_bindgen(getter)]
    pub fn lengths(&self) -> Vec<u32> {
        self.lengths.clone()
    }

    /// Move the coordinates out into a JS `Int32Array`.
    ///
    /// Takes `&mut self` so the buffer is handed over rather than cloned —
    /// crossing the boundary already copies once, and once is enough. Calling
    /// it twice returns an empty array.
    #[wasm_bindgen(js_name = takeCoords)]
    pub fn take_coords(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.coords)
    }
}

/// Scan one region file (`.mca`) for every block in `block_types` at once.
///
/// `limits[i]` caps how many coordinates are *retained* for `block_types[i]`
/// (a missing limit means 0); the returned counts are always the true totals.
/// A bare block id is namespaced (`stone` becomes `minecraft:stone`), matching
/// the reference implementation. Each chunk is inflated once however many
/// blocks are asked for. Targets past [`nbt::MAX_TARGETS`] are ignored, and
/// a duplicated target only ever matches under its first index.
#[wasm_bindgen(js_name = scanRegion)]
pub fn scan_region(
    mca: &[u8],
    externals: &ExternalChunks,
    block_types: Vec<String>,
    limits: &[u32],
) -> ScanResult {
    let targets: Vec<String> = block_types
        .iter()
        .take(nbt::MAX_TARGETS)
        .map(|b| normalize_block_type(b))
        .collect();
    let target_bytes: Vec<&[u8]> = targets.iter().map(|t| t.as_bytes()).collect();
    let mut sinks: Vec<MatchSink> = (0..targets.len())
        .map(|i| MatchSink::new(limits.get(i).copied().unwrap_or(0) as usize))
        .collect();
    region::scan_region_multi(mca, &externals.inner, &target_bytes, &mut sinks);

    let counts = sinks.iter().map(MatchSink::count).collect();
    let mut lengths = Vec::with_capacity(sinks.len());
    let mut coords = Vec::new();
    for sink in sinks {
        let run = sink.into_coords();
        lengths.push((run.len() / 3) as u32);
        if coords.is_empty() {
            // The common single-target case moves its buffer, no copy.
            coords = run;
        } else {
            coords.extend_from_slice(&run);
        }
    }
    ScanResult {
        counts,
        lengths,
        coords,
    }
}
