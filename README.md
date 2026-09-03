# Tarot

A web app for finding and visualizing every block of a given type in a Minecraft
world. Pick a save — either a zip or the world folder itself — a dimension, and
a block type (defaults to `minecraft:nether_portal`), and the matching
coordinates are plotted on an interactive map.

**The scan runs entirely in your browser.** Your save is never uploaded, there
is no server, and the whole app is static files.

Live at <https://sambrothers0.github.io/tarot/>.

## Repository layout

| Path | What it is |
|---|---|
| `scanner/` | Rust crate compiled to WebAssembly. Reads region files, walks chunk NBT, finds the blocks. This is the engine. |
| `frontend/` | React 19 + TypeScript + Vite UI. Opens the save, drives a pool of wasm workers, draws the map. |
| `testing/` | (Untracked) Sample save data for manual verification. |

Agent-facing architecture notes and invariants live in
[`CLAUDE.md`](CLAUDE.md).

## Quick start

Needs [Node.js 20+](https://nodejs.org) and a
[Rust toolchain](https://rustup.rs) with
[`wasm-pack`](https://github.com/wasm-bindgen/wasm-pack).

```bash
rustup target add wasm32-unknown-unknown

cd frontend
npm install
npm run build:wasm     # compiles scanner/ -> frontend/src/wasm/ (gitignored)
npm run dev            # http://localhost:5173
```

`build:wasm` only needs re-running when the Rust changes, but it must be run at
least once before `npm run dev`, `npm run build`, or `tsc` — the TypeScript
build reads the bindings it generates.

## All together 

1. **Pick a save + dimension.** Either a `.zip` or the world folder itself; it
   is handed to a coordinator web worker by reference, and nothing is read on
   the main thread.
2. **Open** (`frontend/src/workers/worldScan.worker.ts` +
   `workers/source.ts`). `source.ts` flattens both input forms to one list of
   entries that read their own bytes, and the worker picks out just the chosen
   dimension's `region/*.mca` files (plus any `.mcc` sidecars). Everything else
   in a save — `entities`, `poi`, `playerdata`, `level.dat`, the other two
   dimensions — is irrelevant to a block search and is never read.
3. **Scan** (`frontend/src/workers/regionScan.worker.ts` + `scanner/`). Region
   files stream out to a pool of workers, each with its own WebAssembly
   instance, a few at a time. Every `.mca` is independent, so this parallelises
   across cores cleanly. Progress is a real regions-done/total bar.
4. **Map** (`frontend/src/WorldMap.tsx`). Matches are plotted on a single canvas
   on Minecraft's X/Z plane — chunk-aligned grid, drag-to-pan, wheel/pinch zoom,
   auto-fit, hover-for-coordinates.

The UI runs three phases — `idle → opening → scanning` — reflected in both the
on-page indicators and the browser tab title.

`count` is always the true total; the plotted and copyable coordinate list is
capped at 100,000, because a common block occurs hundreds of millions of times
in one save and no map can draw that.

---

## Scanner

Rust, compiled to `wasm32-unknown-unknown`. `src/nbt.rs` is the selective NBT
walk — it reads each section's block palette first and only decodes the
expensive packed block array when the target actually appears in that palette,
which is what makes a sparse target like portals cheap. `src/region.rs` handles
the `.mca` sector table and per-chunk decompression.

Note there are **two independent layers of compression**: the zip container
deflates each `.mca` member (undone by `DecompressionStream` in the scan
workers — a folder scan skips this layer, since the files are already content),
and inside each `.mca` every chunk is *separately* zlib-compressed (undone in
Rust).

Details, build instructions, and the correctness invariants
(chiefly: nothing may panic, because a wasm panic takes the worker down) are in
[`scanner/README.md`](scanner/README.md).

```bash
cd scanner && cargo test
```

---

## Frontend

React 19 + TypeScript + Vite.

```bash
npm run build:wasm  # rebuild the scanner
npm run build       # build:wasm, then tsc -b, then vite build -> dist/
npm run preview     # preview the production build locally
npm run lint        # ESLint (strict; React Compiler is on)
npm run dev         # dev server on http://localhost:5173
```

### Deployment (GitHub Pages)

[`.github/workflows/deploy-frontend.yml`](.github/workflows/deploy-frontend.yml)
builds the Rust crate to wasm, then the Vite bundle, and publishes
`frontend/dist` on every push to `master` touching `frontend/**` or `scanner/**`.
The only one-time setup is Settings → Pages → Source: "GitHub Actions". There is
no API URL to configure and no backend to host.

---

## Status

Feature-complete for its purpose. Known limits:

- **A modern browser is required to scan a zip.** Zip members are inflated with
  `DecompressionStream('deflate-raw')`, so Chrome 103+, Safari 16.4+ or
  Firefox 113+. Older browsers are told so instead of failing obscurely. A
  folder scan does not inflate anything and has no such floor.
- **There is no explicit cap on save size.** The zip is read in ranges off
  disk rather than loaded, so memory is flat in the size of the archive; what
  is resident is a handful of region files, not the save. A folder is read a
  region at a time and is flat for the same reason.
- **Picking a folder while the world is open in Minecraft is unreliable.** The
  game rewrites region files underneath the scan; the scan says so and asks for
  the world to be closed. Zips do not have this problem.
