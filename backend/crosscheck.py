"""Python side of the Rust/Python scanner cross-check.

`scanner/` is a port of `parser.py` + `fastnbt.py`, so the acceptance test is
that the two agree *exactly*. This script and `scanner`'s `oracle` binary print
the same format over the same region directory, so a plain `diff` is the whole
test:

    python backend/crosscheck.py <region-dir> <block_type> [limit]
    cargo run --release --bin oracle -- <region-dir> <block_type> [limit]

Both walk region files in sorted filename order and emit matches in scan order,
so the outputs should be byte-identical (modulo line endings on Windows — use
`diff --strip-trailing-cr`), not merely equal as sets.

`<region-dir>` is one dimension's `region/` directory, unpacked from a save:
`<world>/region`, `<world>/DIM-1/region`, or `<world>/DIM1/region`.
"""
from __future__ import annotations

import os
import sys
import time

import fastnbt
from parser import _walk_region, normalize_block_type


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    directory, block_type = argv[0], argv[1]
    limit = int(argv[2]) if len(argv) > 2 else 1_000_000

    paths = sorted(os.path.join(directory, name) for name in os.listdir(directory))
    mca = [p for p in paths if p.endswith('.mca')]
    mcc = {}
    for path in paths:
        if path.endswith('.mcc'):
            with open(path, 'rb') as handle:
                mcc[os.path.basename(path)] = handle.read()

    target = normalize_block_type(block_type)
    sink = fastnbt.MatchSink(limit)

    def read_external(chunk_x: int, chunk_z: int) -> bytes | None:
        return mcc.get(f'c.{chunk_x}.{chunk_z}.mcc')

    started = time.perf_counter()
    for path in mca:
        with open(path, 'rb') as handle:
            data = handle.read()
        for chunk in _walk_region(data, read_external):
            try:
                fastnbt.scan_chunk(chunk, target, sink)
            except Exception:
                continue
    elapsed = time.perf_counter() - started

    lines = [f'count {sink.count}']
    lines += [f"{m['x']} {m['y']} {m['z']}" for m in sink.matches]
    sys.stdout.write('\n'.join(lines) + '\n')
    # Timing goes to stderr so it never pollutes the diff.
    print(f'# {elapsed:.1f}s single-core over {len(mca)} region files', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
