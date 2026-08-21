"""Emit the UNSTAMPED certified-receipt identity for one process, for the seed matrix.

AR-1398 section 7.1.1. Run as a FRESH SUBPROCESS under a chosen `PYTHONHASHSEED`; the caller
compares the output across seeds. It must be a subprocess and not a loop inside one process,
because `PYTHONHASHSEED` is consumed by the interpreter at startup -- setting `os.environ` from
inside a running process changes nothing, so an in-process "seed matrix" is a control that cannot
fail. That is the exact shape of a test that always passes.

Prints two lines:

    BLOB_SHA256 <sha256 of the canonical JSON serialisation of the unstamped receipt>
    CANONICAL   <the receipt's canonical hash, as `stamp_receipt` would compute it>

The two are the same function today. Both are printed anyway so that a future change which makes
the stamp something other than "sha256 of the canonical blob" cannot silently collapse this probe
into a single fact -- byte-identity of the receipt and identity of its stamp are two claims, and a
probe that can only report one of them cannot tell which one broke.

Usage:  PYTHONHASHSEED=0 python scripts/receipt_seed_matrix_probe.py
Exit codes: 0 = printed. Non-zero = the projection itself failed (a real error, never a hash).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

sys.path.insert(0, os.getcwd())

# The projection layer only. Without the stub, importing the engine drags in the real vectorbt
# JIT, which is a documented multi-minute hang on this tower and has nothing to do with what this
# probe measures.
os.environ.setdefault("TF_MOCK_VBT", "1")


def main() -> int:
    from src.engine.extraction import source_graph_projection_spec as sgps
    from src.engine.extraction.source_graph_projection import run_projection
    from src.engine.extraction.svkm_v2_1_compile import _SPEC_PATH, _bench

    bench = _bench()
    transcript, extraction_record = bench._load_pinned()

    spec = sgps.load_spec_json(_SPEC_PATH)
    inputs = sgps.build_projection_run_inputs(
        spec, transcript, verify_pins=True, extraction_record=extraction_record,
    )

    # UNSTAMPED on purpose: the stamp is computed over the record without it, so stamping first
    # and removing the field afterwards would measure the same bytes by a longer route and would
    # additionally hide a producer that stamped something other than what it hashed.
    record = run_projection(**inputs.run_kwargs())

    blob = json.dumps(record, sort_keys=True, ensure_ascii=False)
    sys.stdout.write(f"BLOB_SHA256 {hashlib.sha256(blob.encode('utf-8')).hexdigest()}\n")

    from src.engine.extraction.svkm_v2_1_compile import stamp_receipt

    sys.stdout.write(f"CANONICAL   {stamp_receipt(dict(record))}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
