# backend — the reference implementation

**This is not deployed and is not part of the app.** The scan runs in the
browser now (see `scanner/`), so there is no server in the request path and
nothing gets uploaded.

What lives here is the original Python scanner, kept for one reason: `scanner/`
is a *port* of it, and a port is only correct if it agrees with the original.
This is the oracle that proves it does.

- `fastnbt.py` — selective NBT walk. Reads each section's block palette first
  and only decodes the packed block array when the target actually appears in
  that palette. Pure standard library; no third-party NBT dependency.
- `parser.py` — region-file (`.mca`) sector-table walk and per-chunk
  decompression, including the 64 MB per-chunk cap that the Rust port keeps.
- `crosscheck.py` — prints a scan in the same format as `scanner`'s `oracle`
  binary, so the two can be compared with `diff`.
- `main.py` — the old FastAPI service, kept runnable for spot checks against a
  whole zip. The public-endpoint hardening it used to carry (tiered upload
  ceilings, access codes, a total decompressed-bytes cap, a scan concurrency
  gate) is gone with the deployment it existed for.

## Running the cross-check

This is the acceptance test for any change to either scanner. Unpack one
dimension's `region/` directory out of a save first — `<world>/region`,
`<world>/DIM-1/region`, or `<world>/DIM1/region`.

```bash
python backend/crosscheck.py <region-dir> <block_type> 100000 > py.txt
cd scanner && cargo run --release --bin oracle -- <region-dir> <block_type> 100000 > rs.txt
diff --strip-trailing-cr py.txt rs.txt        # must be empty
```

Both sides walk region files in sorted filename order and emit matches in scan
order, so the outputs are byte-identical rather than merely equal as sets.
Cover a sparse block, a dense one (which exercises the match cap and the
`truncated` path), and one that is absent. See `scanner/README.md` for the
known-good counts over `testing/`.

## Running the old service

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

`POST /parse-blocks` takes a multipart form: `file` (a zipped save), plus
optional `block_type` (default `minecraft:nether_portal`; a bare id like
`stone` is namespaced to `minecraft:stone`) and `dimension` (`overworld`,
`nether`, or `end`). It responds with

```json
{
  "block_type": "minecraft:nether_portal",
  "dimension": "nether",
  "count": 3,
  "truncated": false,
  "matches": [{ "x": 128, "y": 64, "z": -512 }]
}
```

Coordinates are absolute world coordinates. Errors are `{ "detail": "..." }`
with `400` (not a zip / bad dimension) or `422` (no region files for that
dimension).

Because it now only ever runs locally against files you already trust, CORS is
open and there are no upload limits. Do not put it back on the public internet
without restoring the hardening — check the git history for what it had.
