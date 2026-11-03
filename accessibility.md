# Accessibility

Tarot targets **WCAG 2.2 level AA**. Every page meets it as far as we know, with
the exceptions listed under [Known gaps](#known-gaps). The biggest of those is
the map: it's a canvas, so a picture of where things are can only be partly
described in words. The sections below say what the UI does, what it relies
on, and what's still open.

Last reviewed: 2 November 2026.

## What the UI does

### Keyboard (2.1.1, 2.1.2, 2.4.3, 2.4.7)

- Every control can be reached with Tab and used from the keyboard. Nothing
  traps focus except the sign-in `<dialog>`, which is modal on purpose and
  closes with Escape.
- **Focus is always visible.** `index.css` sets one site-wide `:focus-visible`
  outline (2px violet-300, about 10:1 on the page background). It sits in
  `@layer base`, so a component that draws its own ring (`outline-none` plus
  `focus-visible:ring-*`) still wins. If it weren't in a layer, it would
  override every utility and those components would draw two rings.
- **Focus never drops to the page** when the control holding it disappears:
  - *Keep this reading*: once it succeeds, the button becomes a "Kept" note
    and focus moves to the "Your readings" link that replaces it.
  - *Account menu*: Escape returns focus to the account button. Opening "Delete
    account…" puts focus on **Cancel**, the safe choice, and cancelling
    returns focus to "Delete account…".
  - *Saved-scan cards*: renaming returns focus to the pencil button. The
    delete question focuses **Keep**, and cancelling returns focus to the bin.
    Closing an open map with × or Escape puts focus back on the card's header.
- The dimension slider is a native radio group underneath (arrow keys move
  the selection, and the `has-[:focus-visible]` ring shows it). Dragging is
  optional: tapping a stop does the same thing (2.5.7).

### The map, from the keyboard

The canvas (`components/worldmap/WorldMap.tsx`) can take focus as
`role="application"`, so screen readers pass keys through to it rather than
using them to move around the page. Once it has focus, a crosshair appears at
the centre. The crosshair stands in for the pointer: hover, the coordinate
readout and copying all work from where it is.

| Key | Does |
|---|---|
| Arrows | Pan a tenth of the map (Shift: half) |
| `+` / `-` | Zoom in / out |
| `0` | Fit every match |
| `N` / `P` | Jump to the next / previous location, in scan order |
| Enter / Space | Copy the lowest block of the location under the crosshair |
| Escape | Dismiss the tooltip (a second Escape closes a saved scan's map) |

A hint listing these keys appears on the map while the keyboard is in use. The
canvas's accessible description says the same thing for screen readers.

### Screen readers (1.1.1, 1.3.1, 4.1.2, 4.1.3)

- **Landmarks.** The index and `/scans/` pages each have one `<main>`, with the
  footer outside it so the footer is its own landmark. Each page has a single
  `<h1>`. On the index, the headline stays in the document as `sr-only` after
  the hero folds away.
- **Status messages** are announced without moving focus:
  - The index has an `sr-only` `role="status"` that speaks each phase
    ("Opening save…", "Scanning the Nether…", "Scan finished: 12 matches.").
    It speaks once per phase, not on every tick of the progress bar.
  - Both progress bars are `role="progressbar"`. The scanning bar reports its
    value, and its `aria-valuetext` gives the number of region files read.
  - Errors are `role="alert"`: scan errors, sign-in and account errors, and a
    saved scan's load, rename and delete failures.
  - "Copied" on the copy buttons and "Kept" on the Keep button are inside live
    regions.
  - Loading placeholders (the saved-scan list, a saved map, the
    sign-in check) are `role="status"` with `sr-only` text, not just a pulse.
  - The map speaks each location as you step to it (*"Location 2 of 5: X 120,
    Z -40, Y 64 to 66, 3 blocks"*), each zoom change, each fit and each copy.
    It does this through two always-mounted `sr-only` status regions, one for
    navigation and one for copies. The tooltip, readout, zoom badge and toast
    are `aria-hidden` because those regions already say the same thing.
- **Names.** Icon-only buttons have labels (rename, delete, close, the
  footer's GitHub and coffee links). The archive/folder icon in a scan's
  source line is `role="img"` with a label. Decorative images (the portal
  loader, logos next to a visible wordmark, the blobs) have `alt=""` or
  `aria-hidden`.
- **Label in name (2.5.3).** The account button's name starts with the
  signed-in user's name, which is what it shows on screens wide enough to show
  any text.
- **The account menu is a disclosure, not an ARIA `menu`.** It holds one
  link and two buttons that Tab reaches in order. `role="menu"` would promise
  arrow-key navigation it doesn't have.

### Colour and contrast (1.4.1, 1.4.3, 1.4.11)

Text was checked against the page background (`#06040d`) and a lighter
worst case where the ambient glow shows through a card (`#1a1030`).

| Use | Colour | Ratio (worst case) |
|---|---|---|
| Body text | slate-300 | 12.2:1 |
| Secondary text, hints, timestamps, placeholders | slate-400 | 7.0:1 |
| Section labels ("SAVE", "BLOCK TYPES") | violet-200 at 70% | 6.9:1 |
| Tooltip footnotes | violet-200 at 80% | 8.6:1 |
| Map grid and axis labels (canvas) | violet-300 at 75–90% | 6.2:1 (on the vignette's brightest point) |
| Text-field and file-picker borders | white at 35% | 3.1:1 (non-text, needs 3:1) |
| Focus outline | violet-300 | ~10:1 |

What changed in this pass: hint text and timestamps moved from slate-500
(3.8:1) and slate-600 (2.4:1) up to slate-400. Field borders went from white
at 10% (1.3:1) to 35%. The canvas's grid labels went from 45% to 75% opacity.

Colour is never the only signal. Selected toggles are `aria-pressed` and
selected radios are checked. Dimension badges show the dimension's name as
text. The dimension slider's icons have the chosen dimension's name written
next to the "Dimension" label.

A scan of several blocks gives each a colour *and* a shape (circle, square,
diamond, triangle, ring, cross), and the same glyph sits beside the block's
written name wherever it's listed: the form's chips, the result line, the
legend under the map and the tooltip. The six colours were validated as a
scatter palette (every pair, not just neighbours) against the map pane:
worst colour-blind separation ΔE 10.2, worst normal-vision ΔE 15.7, each
3:1 or better against the pane (1.4.11). The shapes cover the one weak pair
under tritanopia (blue and rose, ΔE 4.6). The legend's toggles are
`aria-pressed` buttons, and the one that would empty the map is
`aria-disabled`. The map's name says how many block types it holds and how
many are shown, and the keyboard announcements name each block in a column.

### Motion (2.2.2, 2.3.3)

`prefers-reduced-motion: reduce` turns off the drifting background, the
indeterminate progress sweep, the portal-pane fade, the slider glide and the
saved-scan open/close animation. With it on, scrolling to the map or an opened
card happens instantly instead of smoothly.

### Other

- Every page sets `lang="en"` and has a unique `<title>`. The index's title
  also tracks the phase ("Tarot - Scanning"), so progress shows in a
  background tab.
- Content reflows at 320px wide and survives 200% zoom (1.4.4, 1.4.10). The
  map stays square at 90% of the smaller viewport side. This pass fixed a real
  reflow bug: the file input's intrinsic width stretched the form past its
  card on narrow screens. The page's `overflow-x-hidden` hid the overflow
  rather than preventing it, so "Zip file" and the dimension name were cut
  off, and scrolling to the map nudged the page sideways. The form's grids
  are now `grid-cols-1` (`minmax(0, 1fr)`).
- Every touch target is at least 24×24px (2.5.8). The smallest, the pill
  toggles and the Fit button, are about 26px tall.

## Known gaps

These are the places where AA is either not met or only met through an
alternative.

1. **The map is a canvas (1.1.1, 1.3.1).** Its spatial layout (how pins
   cluster, how far apart they are) can't be fully put into words. What we
   offer instead: `N`/`P` step through every location and announce its
   coordinates, Enter copies one, and **Copy coordinates as JSON** exports
   the full list. Grid lines are deliberately faint and count as decoration;
   only their labels are held to the text contrast ratio.
2. **Map hover tooltip (1.4.13).** The tooltip doesn't take the pointer, so
   it can't be hovered itself. It closes with Escape (when the map has focus)
   and doesn't hide any content you'd need to read, but strictly speaking
   it isn't "hoverable".
3. **Background motion without reduced-motion (2.2.2).** The ambient blobs
   drift continuously and there's no on-page control to pause them. They're
   slow (34–50s cycles), blurred and decorative, and the OS reduced-motion
   setting stops them. A pause toggle would close this gap fully.
4. **The portal loader is a GIF** and keeps spinning under reduced motion.
   It only shows while a scan or a saved map is loading, which the loading
   exception in 2.2.2 covers. Swapping in a static frame under reduced motion
   would still be better.
5. **Google's sign-in button** is Google's own iframe, laid over our styled
   pill at zero opacity (GIS only issues a token for a click inside its own
   iframe). Keyboard focus and the accessible name come from Google. Our pill
   shows the focus ring through `group-focus-within`.
6. **Small text.** Some secondary labels are 10–11px (tooltip footnotes, the
   rename hint, the zoom badge). AA sets no minimum size, and they all pass
   contrast, but they're small.
7. **Chrome's folder picker says "upload".** The browser's wording can't be
   changed. The hint under the picker says nothing leaves the computer.

## Checking it

- **Automated:** the e2e suite (`frontend/e2e/scan.spec.ts`) drives the map
  from the keyboard: focus the canvas, press `N`, check the status region,
  press Enter, check the clipboard. There's no axe scan yet. Adding
  `@axe-core/playwright` to `pages.spec.ts` would catch regressions in names,
  roles and contrast across every page.
- **By hand, before a release that touches the UI:**
  - Tab through the index, run the sample scan, Tab into the map, and step
    through it with `N`/`P` with a screen reader on (NVDA or VoiceOver).
  - Keep a reading, then on `/scans/` open, rename and delete one using only
    the keyboard. Focus should never jump to the top of the page.
  - Turn on reduced motion in the OS and reload. Nothing should drift.
  - Zoom the browser to 200% and narrow the window to 320px. Nothing should
    be cut off or need horizontal scrolling, apart from the map, which pans.
