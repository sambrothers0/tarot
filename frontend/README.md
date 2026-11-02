# Tarot — Frontend

React 19 + TypeScript + Vite UI. Opens a Minecraft save — a zip, or the world
folder itself — drives a pool of WebAssembly workers that scan it, and plots the
results on an interactive map. The scan happens on the visitor's machine —
there is no upload and no server in the scan path. The optional accounts API
([`../backend`](../backend/README.md)) only ever sees results a signed-in user
chooses to keep.

## Requirements

- Node.js 20+ (required by Vite 8)
- A [Rust toolchain](https://rustup.rs) with the `wasm32-unknown-unknown` target
  and [`wasm-pack`](https://github.com/wasm-bindgen/wasm-pack), to build
  [`../scanner`](../scanner/README.md)

## Setup

```bash
rustup target add wasm32-unknown-unknown
npm install
npm run build:wasm     # scanner/ -> src/wasm/ (generated, gitignored)
```

`src/wasm/` holds the generated bindings *and their `.d.ts`*, so it must exist
before `npm run dev`, `npm run build`, or `tsc` will work. Re-run `build:wasm`
whenever the Rust changes; `npm run build` does it for you.

## Running

```bash
npm run dev        # http://localhost:5173
```

## Other commands

```bash
npm run build:wasm # rebuild the wasm scanner only
npm run build      # build:wasm, then tsc -b, then vite build -> dist/
npm run preview    # preview the production build locally
npm run lint       # run ESLint
npm run typecheck  # tsc -b: app, config and tests
npm test           # Vitest unit tests
npm run test:e2e   # Playwright, against a prior build
npm run update:blocks  # refresh src/content/blocks.json from Mojang's registry
```

`test:e2e` expects a build *without* accounts (it checks there is no sign-in
UI and no network I/O). If you have a `.env.local` that sets `VITE_API_URL`,
build with those variables blanked first:
`VITE_API_URL= VITE_GOOGLE_CLIENT_ID= npm run build`.

## Deploying to GitHub Pages

The app is a static bundle, redeployed automatically by
[`.github/workflows/deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml)
once [CI](../.github/workflows/ci.yml) passes for a push to `master` (every
layer: scanner, frontend unit and e2e, backend). It installs the wasm target and
a pinned `wasm-pack`, runs `npm ci && npm run build`, and publishes
`frontend/dist`. Live URL:
`https://sambrothers0.github.io/tarot/`. (Trigger it manually any time
from the Actions tab via **Run workflow**.)

**One-time setup:** Settings → Pages → Build and deployment → Source: "GitHub
Actions". (Not the older "Deploy from a branch" mode.) To turn on accounts, also
set the repository variables `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID`; with
either unset the build has no sign-in UI and needs nothing else.

**The one build-time detail that makes Pages work:** a project site is served
from a subpath (`/tarot/`), so every asset URL — including the `.wasm`
and the worker chunks — must be prefixed with it. The workflow sets
`VITE_BASE=/tarot/`, which `vite.config.ts` reads into Vite's `base`.
Local dev and a plain `npm run build` default to `/`, so nothing changes
locally. **If the repo is ever renamed, update `VITE_BASE` in the workflow to
match**, or it 404s on assets.

Pages serves `.wasm` as `application/wasm` already, and Vite emits it as a
hashed asset, so no extra configuration is needed. The module is ~45 KB gzipped.

## How it works

1. **Pick a save + dimension.** A `.zip` or a world folder, passed to the
   coordinator worker by reference, so it is never read on the main thread. A
   folder arrives as its whole file list — handles only, nothing read — and the
   path of each file is captured from `webkitRelativePath` on the main thread,
   because that property does not survive the clone into a worker.
2. **Open** (`src/workers/worldScan.worker.ts` + `src/workers/source.ts`).
   `source.ts` reduces both forms to a list of entries that read their own
   bytes; for a zip that means parsing the central directory — the index at the
   tail of the archive — and for a folder it is the file list as picked. Either
   way the worker takes just the chosen dimension's `region/*.mca` files (plus
   any `.mcc` oversized-chunk sidecars); everything else in a save is irrelevant
   to a block search and is never read. The bytes stay on disk until wanted: zip
   members are fetched by absolute offset with `Blob.slice()`, so opening a
   1.2 GB save costs kilobytes, not 1.2 GB.
3. **Scan** (`src/workers/regionScan.worker.ts` + [`../scanner`](../scanner)).
   Region files go out to a pool of workers, each with its own WebAssembly
   instance. Region files are read **a few ahead of the workers, never all at
   once** — one dimension of a large save is ~1.2 GB, and buffering it would
   take the tab down. Progress is a real regions-done/total bar.
4. **Map** (`src/components/worldmap/`). Matches are plotted on a single canvas
   on Minecraft's X/Z plane — chunk-aligned grid, drag-to-pan, wheel/pinch zoom,
   auto-fit, hover-for-coordinates, click to copy, and a keyboard path (see
   [`../accessibility.md`](../accessibility.md)).

The UI runs three phases — `idle → opening → scanning` — reflected in both the
on-page indicators and the browser tab title.

> Coordinates cross the wasm boundary as a flat `Int32Array` of `x, y, z`
> triples, not as objects — a dense block yields hundreds of millions of
> matches, and per-match marshalling would cost more than the scan. They become
> `[{x, y, z}]` exactly once, in `src/lib/scanWorld.ts`.

Each worker gets its own wasm instance rather than sharing one, so no
`SharedArrayBuffer` and no cross-origin isolation is needed — which matters,
because GitHub Pages cannot set the COOP/COEP headers that would require.

## Notable toolchain

Uses the React Compiler (`babel-plugin-react-compiler`) with strict
`eslint-plugin-react-hooks` v7. Practical consequence in `src/components/worldmap/`: **no
`setState` inside effect bodies** — keep state updates in event / `requestAnimationFrame`
/ `ResizeObserver` callbacks, and read live view/hover state from refs during
the canvas draw.
