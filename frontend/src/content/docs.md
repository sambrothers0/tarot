## Why this exists

I had a Minecraft world I'd played for years and a nether portal I could not
find. It was out there — somewhere past a few thousand blocks of terrain I'd
stopped recognising — and no amount of flying around was going to turn it up.

The information was already sitting on my disk. A save file records every block
in every chunk you have ever loaded. There was no reason to search the world by
walking through it when the answer was in a folder.

So Tarot reads the save directly and plots the answer on a map. Point it at a
zipped world, name a block, pick a dimension, and it gives you every coordinate
where that block occurs.

It is useful for more than lost portals. Anything you built out of a
distinctive block is findable — beacons, end portal frames, spawners, a
particular kind of ore — and the shape of the results doubles as a map of where
you have actually explored.

## How it works

**Nothing is uploaded.** The scan runs on your own machine, inside the browser
tab. There is no server in the request path, no account, and no copy of your
world anywhere but where it already was.

That was a deliberate rewrite. The first version of Tarot did have a backend,
and uploading a gigabyte-plus save to it was by a wide margin the slowest part
of using the app — slower than the actual search. Removing the upload removed
the reason for the server to exist at all.

Four things happen when you press scan:

**1. The zip is opened, not loaded.** A large save is well over a gigabyte, and
reading all of it into memory to find the parts that matter would end the tab
right there. Instead Tarot reads the archive's index from its tail and then
fetches individual entries by their exact byte offset, the way you'd read a
single record out of a database rather than the whole table.

**2. Only the relevant files are pulled out.** A save contains entity data,
points of interest, player data, statistics, and three separate dimensions. A
block search needs none of that — just the `region/*.mca` files for the one
dimension you chose. Everything else is skipped without ever being read.

**3. The regions are scanned in parallel.** Each region file is independent, so
they're handed out to a pool of background workers, each running a scanner
compiled to WebAssembly. Only a few regions are kept in memory at a time — the
reader deliberately stalls when the pool is busy, which is what keeps a 1.2 GB
world from becoming a crashed tab.

The scanner itself is careful about what it decodes. Each chunk section stores a
palette of the block types it contains, followed by a tightly packed array
saying which palette entry sits at each position. Reading that packed array is
the expensive part, so Tarot checks the palette first and only unpacks a section
when the block you asked for is actually listed in it. For something sparse like
a nether portal, the vast majority of the world is dismissed after reading a
short list of names.

**4. The results are drawn.** Coordinates come back as a flat run of numbers and
land on a canvas on Minecraft's X/Z plane, with a chunk-aligned grid. Drag to
pan, scroll to zoom, hover to read a coordinate, click a marker to copy it
straight to the clipboard.

## Notes and limits

**The count is always true; the map is capped.** If you search for something
common like stone, the total you're shown is the real total, but only the first
100,000 coordinates are plotted. No map can meaningfully draw hundreds of
millions of points, and no browser can hold them.

**Speed depends on your machine.** The work that used to happen on a server now
happens on your cores. On a desktop this is a large net win, because the upload
is gone. On an old phone it is slower — that's the accepted trade for never
having to hand your save to anyone.

**A recent browser is required.** Tarot decompresses zip entries with a built-in
browser API that arrived in Chrome 103, Safari 16.4 and Firefox 113. On anything
older the app will say so up front rather than failing partway through a scan.

**Java Edition saves only.** Bedrock stores its world in an entirely different
format and is not supported.
