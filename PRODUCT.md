# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Minecraft players with a long-running world — the kind played for years — who
have lost track of where they built things. The canonical case is a forgotten
nether portal after hours of searching, but it extends to any build or structure
findable by a block type. The author is user #1; the site is built for any
player in that situation, not just for them.

Their job: pick their save, name a block, and get every location of it plotted
so they can go back to it in-game.

## Product Purpose

Tarot finds every block of a given type in a Minecraft save and plots the
coordinates on an interactive X/Z map. It replaces the hand-kept coordinates
document players otherwise maintain, which is error-prone and goes stale.

Success: a player goes from "where did I put that portal?" to a copied
`x y z` without installing anything or waiting on an upload.

## Positioning

- **Fast, with nothing to install.** A browser tab, a save, a result. The scan
  runs locally on the player's machine with no upload wait, so it scales with
  their hardware rather than a server queue.
- **Free, permanently.** No paid tier. The optional accounts API is deliberately
  engineered to cost $0 (billing kill switch at $1).

## Operating Context

- The player has Minecraft installed and a save on disk: either a zipped world
  or the world folder itself. Saves range from ~1 MB to multiple GB.
- Flow: pick save → block type (defaults to `minecraft:nether_portal`;
  autocomplete from Mojang's registry, free text allowed for modded/newer
  blocks) → dimension (overworld / nether / end) → scan → map.
- On the map: drag to pan, scroll/pinch to zoom, hover a pin for coordinates,
  click to copy `x y z`; bulk copy of all results.
- The world should be closed in Minecraft before scanning a folder.
- Optional Google sign-in lets a player keep scan results ("readings") and revisit them on
  the `/scans/` page.

## Capabilities and Constraints

- The save is never uploaded; the scan runs entirely in the browser
  (Rust → WebAssembly worker pool). This is a hard architectural fact, and the
  privacy policy and docs make claims that depend on it.
- Accounts are optional; the app must be fully usable signed out and with the
  API down. Only an explicitly saved *result* ever reaches the API.
- `count` is always the true total; the plotted/copyable list caps at 100,000.
- Zip scans need `DecompressionStream('deflate-raw')` (Chrome 103+, Safari
  16.4+, Firefox 113+); folder scans don't.
- Low-RAM and mobile clients work but are slower. Accepted trade-off.
- Static site on GitHub Pages; pages: home (scanner), `/docs/`, `/scans/`,
  `/privacy/`, `/terms/`, 404. Privacy and terms URLs are linked from Google's
  OAuth consent screen and must not move.

## Brand Commitments

- **Name:** Tarot.
- **Portal motif is core identity.** The nether portal (default search block,
  `frontend/src/assets/portal-loader.gif` / `PortalLoader.tsx`) is part of the
  brand, not incidental decoration. The purple-on-dark palette is deliberate:
  it is nether-portal colour, not a generic choice. Move away from
  generic-SaaS treatments by leaning further into the portal, not by dropping
  the palette.
- **Voice is not a brand pillar.** The docs' origin story is written in first
  person, but first-person voice is not part of the brand and should not be
  pushed into product copy.

## Evidence on Hand

- Real copy: `frontend/src/content/docs.md` (origin story, how it works,
  limits), `privacy.md`, `terms.md`.
- Assets: `frontend/public/favicon.svg`, `frontend/src/assets/portal-loader.gif`,
  icons in `frontend/src/assets/icons/`.
- Sample saves for demos/verification: `testing/test1.zip` (~1.4 MB),
  `testing/test2.zip` (~1.18 GB).
- No testimonials, user counts, or benchmarks exist. Do not fabricate them.

## Product Principles

1. **Get the player to the coordinate.** Every surface serves the path from
   save to a copied `x y z`; anything else is secondary.
2. **No friction before the result.** No install, no account, no upload, no
   wait that isn't the scan itself.
3. **Free means free.** Never design toward a paywall or upsell.
4. **Honest about the machine.** Speed depends on the player's hardware and
   browser; say so plainly rather than overpromise.
5. **Made for players.** Specific and Minecraft-literate.
