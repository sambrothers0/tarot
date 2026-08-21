"""Reference implementation of the block scan, kept as the Rust scanner's oracle.

This is **not deployed**. The app scans saves in the browser (see `scanner/`),
so nothing here sits in a request path any more. What it still earns its keep
for is correctness: `scanner/` is a *port* of `parser.py` + `fastnbt.py`, and
the acceptance test is that the two agree exactly — same count, same match list,
in the same order — over the saves in `testing/`. See `backend/README.md` for
how to run that comparison.

Because it only ever runs locally against files you already have, the
anti-abuse machinery a public endpoint needed (tiered upload ceilings, access
codes, a total decompressed-bytes cap, a scan concurrency gate) is gone. The
per-chunk decompression cap in `parser.py` stays — that one guards against a
malformed file, not against a hostile caller, and the Rust port keeps it too.
"""
from __future__ import annotations

import asyncio
import os
import zipfile
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from pathlib import PurePosixPath

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from parser import normalize_block_type, scan_region_bytes

DEFAULT_BLOCK_TYPE = 'minecraft:nether_portal'
DEFAULT_DIMENSION = 'overworld'
MAX_MATCHES = 100_000

# A save keeps each dimension's block data in its own ``region`` directory. The
# dimension is identified by the directory that *contains* that ``region`` dir:
# the Nether lives under ``DIM-1``, the End under ``DIM1``, and the Overworld's
# ``region`` sits directly in the world root (no special parent).
#
# The frontend's ``regionDimension()`` (in ``worldScan.worker.ts``) is now the
# only copy that ships; this one exists so the oracle sees the same files.
_DIMENSION_BY_PARENT = {'DIM-1': 'nether', 'DIM1': 'end'}
VALID_DIMENSIONS = {'overworld', 'nether', 'end'}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One pool reused for the life of the process. Region-file parsing is
    # CPU-bound pure Python, so we spread it across every core; a process pool
    # (not threads) is what actually sidesteps the GIL.
    executor = ProcessPoolExecutor(max_workers=os.cpu_count() or 1)
    app.state.executor = executor
    try:
        yield
    finally:
        executor.shutdown(cancel_futures=True)


app = FastAPI(lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


def _region_dimension(name: str) -> str | None:
    """Return which dimension a region-file member belongs to, or ``None``.

    A save keeps block data in directories literally named ``region`` (the
    Overworld at ``<world>/region``, the Nether at ``<world>/DIM-1/region``,
    the End at ``<world>/DIM1/region``). Everything else in the archive
    (``entities``, ``poi``, ``playerdata``, ``level.dat``, ...) is irrelevant to
    a block search and can be gigabytes, so it is never extracted.
    """
    if not (name.endswith('.mca') or name.endswith('.mcc')):
        return None
    parts = PurePosixPath(name).parts
    if len(parts) < 2 or parts[-2] != 'region':
        return None
    parent = parts[-3] if len(parts) >= 3 else ''
    return _DIMENSION_BY_PARENT.get(parent, 'overworld')


def _read_region_work(spooled_file, dimension: str) -> list[tuple[bytes, dict[str, bytes]]]:
    """Read one dimension's region files straight from the zip into memory.

    Returns a work unit ``(mca_bytes, mcc_map)`` per ``.mca`` member, ready to
    fan across the process pool. ``.mcc`` oversized-chunk sidecars share the
    dimension's single ``region`` directory and are keyed by basename; the same
    (usually empty) map is handed to every worker, since a sidecar is only
    consulted when a chunk references it.
    """
    spooled_file.seek(0)
    with zipfile.ZipFile(spooled_file) as archive:
        mca_members = []
        mcc_members: dict[str, zipfile.ZipInfo] = {}
        for info in archive.infolist():
            if _region_dimension(info.filename) != dimension:
                continue
            name = PurePosixPath(info.filename).name
            if name.endswith('.mca'):
                mca_members.append(info)
            else:  # .mcc sidecar
                mcc_members[name] = info

        if not mca_members:
            raise FileNotFoundError(
                f'No region files found for the {dimension}. '
                'Is this a valid Minecraft save, and has that dimension been visited?'
            )

        mcc_map = {name: archive.read(info) for name, info in mcc_members.items()}
        return [(archive.read(info), mcc_map) for info in mca_members]


@app.post('/parse-blocks')
async def parse_blocks(
    request: Request,
    file: UploadFile = File(...),
    block_type: str = Form(default=DEFAULT_BLOCK_TYPE),
    dimension: str = Form(default=DEFAULT_DIMENSION),
):
    if not file.filename or not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail='Upload must be a .zip of the save folder')

    if dimension not in VALID_DIMENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f'dimension must be one of {sorted(VALID_DIMENSIONS)}',
        )

    loop = asyncio.get_running_loop()
    executor: ProcessPoolExecutor = request.app.state.executor

    # Reading the region members out of the zip is blocking disk/zlib work; run
    # it off the event loop. The bytes go straight to the pool — no temp dir.
    try:
        work = await loop.run_in_executor(None, _read_region_work, file.file, dimension)
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail='File is not a valid zip archive') from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Fan every region file out across the pool and await them together. Each
    # worker caps its own coordinate list at MAX_MATCHES (so no single region
    # can build a huge list) and returns the true per-file count alongside.
    scans = [
        loop.run_in_executor(executor, scan_region_bytes, mca_bytes, mcc_map, block_type, MAX_MATCHES)
        for mca_bytes, mcc_map in work
    ]
    per_file = await asyncio.gather(*scans)

    # Sum the true totals, but stop accumulating coordinates at the cap.
    count = 0
    matches: list[dict[str, int]] = []
    for file_count, file_matches in per_file:
        count += file_count
        if len(matches) < MAX_MATCHES:
            matches.extend(file_matches[: MAX_MATCHES - len(matches)])

    return {
        'block_type': normalize_block_type(block_type),
        'dimension': dimension,
        'count': count,
        'truncated': count > len(matches),
        'matches': matches,
    }
