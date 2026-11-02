# scanner — the block scanner, in Rust

This crate is the engine of the app. It reads Minecraft region files (`.mca`),
walks each chunk's NBT, and reports every coordinate holding a given block. It
compiles to WebAssembly and runs in the visitor's browser, which is why there is
no server in the scan path and nothing gets uploaded.

It is a **port**, not a rewrite: `src/nbt.rs` mirrors `backend/fastnbt.py` and
`src/region.rs` mirrors `backend/parser.py`. That Python original was the
oracle the port was verified against, byte for byte. It has since been removed
from the tree (in `425b514`; today's `backend/` is the unrelated accounts API),
but it is still the check for any change here — recover it from history, as
below.

## Why Rust

The Python scanner was at its limit. Profiling one 1.2 GB overworld scan showed
**84% of the time in CPython interpreter dispatch** and only 16% in native
zlib — `fastnbt._skip` alone was 57%, at ~2.2M calls per region file. A hand
optimised `_skip` (if-chain, inlined `int.from_bytes`, no `struct`) bought
1.07x. The algorithm was already right; the interpreter was the floor.

Compiled, the skip-walk collapses to noise and the scan becomes inflate-bound.
That is what makes an in-browser scan viable at all — and killing the upload
(852 MB for that same save, minutes on a home connection) matters more than the
scan speedup did.

## Layout

| File | Ported from | What it does |
|---|---|---|
| `src/nbt.rs` | `backend/fastnbt.py` | Selective NBT walk. Reads each section's palette first and only decodes the packed block array when the target is actually in that palette. |
| `src/region.rs` | `backend/parser.py` | `.mca` sector table, per-chunk zlib/gzip inflate, `.mcc` sidecars for oversized chunks. |
| `src/lib.rs` | — | `wasm_bindgen` surface: `scanRegion`, `ExternalChunks`, `ScanResult`. |
| `src/bin/oracle.rs` | — | Native CLI used to diff against Python. Not part of the wasm build. |

### Invariants worth knowing

- **Nothing may panic.** A panic in wasm aborts the module instance, which kills
  the worker; the Python version could raise and have the caller skip one chunk.
  So every read is bounds-checked and every function returns `Option`, where
  `None` means "give up on this chunk" — matching Python's behaviour down to the
  detail that coordinates already emitted for that chunk are kept.
- **Coordinates cross the boundary as a flat `Int32Array`** of `x, y, z` triples.
  A dense block yields hundreds of millions of matches; building a JS object per
  match would cost more than the scan.
- **The per-chunk 64 MB decompression cap stays.** It is not anti-abuse
  hangover — it is what stops a malformed file from wedging a tab.
- **Pure-Rust inflate only** (`flate2` with the `rust_backend`/miniz_oxide
  feature). The C backends and `libdeflater` need a C toolchain and do not build
  cleanly for `wasm32-unknown-unknown`.

## Building

The frontend build does this for you (`npm run build` runs `build:wasm` first),
but standalone:

```bash
rustup target add wasm32-unknown-unknown
wasm-pack build --release --target web --out-dir ../frontend/src/wasm --out-name scanner
```

Output lands in `frontend/src/wasm/` and is **not committed** — CI rebuilds it.
TypeScript needs the generated `.d.ts` there, so a fresh clone must build the
crate before `tsc` will pass.

```bash
cargo test          # unit tests: NBT walking, bounds, sink limits, region parsing
```

## Verifying against the Python oracle

The port is only correct if it matches. The Python side is no longer in the
tree, so first check it out of the commit before its removal into a scratch
directory:

```bash
mkdir -p /tmp/oracle && for f in fastnbt.py parser.py crosscheck.py; do
  git show 425b514^:backend/$f > /tmp/oracle/$f
done
```

Then unpack one dimension's `region/` directory from a save, run both sides and
diff:

```bash
cargo run --release --bin oracle -- <region-dir> <block_type> 100000 > rs.txt
python /tmp/oracle/crosscheck.py <region-dir> <block_type> 100000 > py.txt
diff --strip-trailing-cr rs.txt py.txt        # must be empty
```

Both print `count <n>` followed by one `x y z` line per retained match, walking
region files in sorted filename order — so the output is byte-identical, not
merely equal as a set.

Cover three shapes of target: a **sparse** block (the realistic case), a
**dense** one (exercises the packed-decode hot loop, the match cap, and the
`truncated` path), and a **missing** one.

Known-good figures for `minecraft:nether_portal` over `testing/`:

| Save | Dimension | Regions | Count |
|---|---|---|---|
| `test2.zip` | overworld | 478 | 3873 |
| `test2.zip` | nether | 106 | 208 |
| `test2.zip` | end | 82 | 0 |
| `test1.zip` | overworld | 13 | 2 |
