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

/// The outcome of scanning one region file.
///
/// `coords` is a flat run of `x, y, z` triples rather than a list of objects:
/// a dense block yields millions of matches, and building a JS object per
/// match across the wasm boundary costs more than the scan itself.
#[wasm_bindgen]
pub struct ScanResult {
    count: f64,
    truncated: bool,
    coords: Vec<i32>,
}

#[wasm_bindgen]
impl ScanResult {
    /// Every match found, including those past the coordinate limit.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> f64 {
        self.count
    }

    /// True when `count` exceeds the coordinate limit, so `coords` is a prefix.
    #[wasm_bindgen(getter)]
    pub fn truncated(&self) -> bool {
        self.truncated
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

/// Scan one region file (`.mca`) for `block_type`.
///
/// `limit` caps how many coordinates are *retained*; the returned `count` is
/// always the true total. A bare block id is namespaced (`stone` becomes
/// `minecraft:stone`), matching the reference implementation.
#[wasm_bindgen(js_name = scanRegion)]
pub fn scan_region(
    mca: &[u8],
    externals: &ExternalChunks,
    block_type: &str,
    limit: u32,
) -> ScanResult {
    let target = normalize_block_type(block_type);
    let mut sink = MatchSink::new(limit as usize);
    region::scan_region(mca, &externals.inner, target.as_bytes(), &mut sink);

    let count = sink.count();
    let coords = sink.into_coords();
    ScanResult {
        count,
        truncated: count > (coords.len() / 3) as f64,
        coords,
    }
}
