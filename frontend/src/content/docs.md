## What is Tarot

Tarot is a tool for plotting locations of blocks within a Minecraft world. The project fills a gap in the existing tools for visualizing and analyzing MCA files. It's a simple browser site that reads your zipped or raw save folder and instantly maps the locations of a given block throughout the world onto a 2D grid. Unlike other solutions, it's free, requires no install, and works lightning fast.

**Use Tarot to locate forgotten builds, nether portals, and existing structures in the world by searching for a specific block type.**

No world on hand? Until you pick a save, the scanner has a small sample world selected — a superflat test map with two nether portals about 13,500 blocks apart — so pressing Scan shows the whole flow. Picking your own save replaces it. The sample only has an Overworld.

## Why this exists

When you play one specific Minecraft world for 5 years straight, you wind up building a lot of nether portals. After spending a couple hours searching for the location of a previously built, but since-forgotten portal, most players will learn to simply write down the coordinates of each one. This was the system I used for most of my survival world's lifetime. However, the solution isn't good enough. Writing a manual document that you have to constantly update, verify, and backup is extremely error prone and brittle. I needed something better.

Tarot exists to solve this problem by scanning a save for portal blocks (or any other block you specify) and plotting those locations on the fly in an interactive grid, inspired by the [Chunkbase](https://www.chunkbase.com) UI.

## How it works

**Nothing is uploaded.** The scan runs on your own machine, inside the browser
tab. There is no server in the request and no additional copy of your world
saved anywhere.

Signing in with Google is optional. If you do, Tarot stores your Google account
ID, email, name and profile picture, so you can be recognised next time, plus
any readings you choose to keep: a scan's block, dimension, save name and the
coordinates it found. Your save itself is never sent, signed in or not, and
"Delete account" removes everything.

This means that your own machine is performing the computation with no waiting around for a large file upload. It also means the website's performance is dependent on the specs of your computer, likely a benefit to most technical players.

Four things happen when you press scan:

**1. The save is opened, not loaded.** A large save can be multiple GB. If you read everything
into memory to find the parts that matter, you run the risk of killing the tab
on the spot. Tarot reads the archive's index from its tail and then fetches individual entries by
their exact byte offset, the way you'd read a single record out of a database
rather than the whole table. For unzipped save folders, the browser hands over the list of files, 
and Tarot opens them one at a time.

**2. Only the relevant files are pulled out.** A save contains entity data,
points of interest, player data, statistics, and three separate dimensions. A
block search needs none of that - just the `region/*.mca` files for the one
dimension you chose. Everything else is skipped without ever being read.

**3. The regions are scanned in parallel.** Each region file is independent, so
they're handed out to a pool of background workers, each running a scanner
compiled to WebAssembly. Only a few regions are kept in memory at a time — the
reader deliberately stalls when the pool is busy. This keeps large scans from simply crashing the tab.

The scanner itself is careful about what it decodes. Each chunk section stores a
palette of the block types it contains, followed by a tightly packed array
saying which palette entry sits at each position. Reading that packed array is
the expensive part, so Tarot checks the palette first and only unpacks a section
when the block you asked for is actually listed in it. For something sparse like
a nether portal, the vast majority of the world is dismissed after reading a
short list of names.

**4. The results are drawn.** Coordinates come back as a flat run of numbers and
land on a canvas on Minecraft's X/Z plane, with a chunk-aligned grid. Drag to
pan, scroll to zoom, hover to read a coordinate pin, and click to copy
it to the clipboard. The map works from the keyboard too: see below.

## Notes and limits

**Vertically stacked blocks.** If two blocks are stacked directly on top of one another, 
they won't appear visually distinct on the map. You'll have to hover over the pin to see
vertical granularity.

**User dependent performance.** The computation of parsing each region file
happens on your cores. On a desktop this is an advantage because there's no slow file upload. 
On a very lightweight laptop or mobile device, the scan time could be slower.

**A recent browser is required for zipped saves.** Tarot decompresses zip entries
with a built-in browser API that arrived in Chrome 103, Safari 16.4 and Firefox
113. It is not compatible with older browser versions. Scanning a world folder
skips that step entirely and works on older browsers.

**Close the world first.** Minecraft rewrites region files while you play, so
scanning a folder belonging to an open world can fail partway through. Quit to
the title screen and scan again. Scanning a zip is never affected.

**Keyboard and screen readers.** Every control works from the keyboard. Tab to
the map and a crosshair appears: arrow keys pan (Shift for bigger steps), `+`
and `-` zoom, `0` fits every match, `N` and `P` jump to the next and previous
location, and `Enter` copies the one under the crosshair. Screen readers hear
each location as you step to it. The map itself is a picture, so for the full
list use **Copy coordinates as JSON**.

**Java Edition saves only.** Bedrock stores its world in an entirely different
format and is not supported.

## On technical Minecraft

Like many victims of technical Minecraft addiction, I experienced a shift in how I spent my time as I transitioned from the early-late game to the late-late game. Once you've built a fully automatic farm and sorting system for every relevant resource in the game, you start to look for new ways to play the game. I noticed that I spent less time doing manual activities like mining, collecting items, and fighting mobs, and more time researching, testing, and experimenting using tools and quality of life modpacks. This project follows in a similar vein, and it's my contribution to the technical community that has given me so many hours of satisfaction.