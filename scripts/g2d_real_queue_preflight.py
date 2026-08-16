"""AR-1260 §D — READ-ONLY preflight on the REAL frozen G2-D artifacts.

WHAT THIS ANSWERS
    Are all eight one-shot Opus calls still unspent, at this pin, right now?

    AR-1259 §10 keeps real G2-D calls LOCKED. The eight attempts are the scarce resource the
    whole D1 provenance chain exists to protect, so the state of that budget is measured from
    the artifacts themselves rather than carried forward as a remembered number
    (`[red-path-decay]`: a number carried across a repair is stale even when the words around it
    are fresh).

WHY IT IS READ-ONLY, AND HOW THAT IS ENFORCED RATHER THAN PROMISED
    Every state in the durable ledger is a FILE, so the honest way to read the budget is to look
    at the directory. This script opens files and creates none. `DurableAttemptLedger.load` calls
    `os.makedirs(receipt_dir, exist_ok=True)`, which would create the directory if it were
    missing — so the directory's prior existence is asserted FIRST, which makes that call a
    proven no-op instead of a trusted one.

THE STOP CONDITION IS PART OF THE INSTRUMENT
    AR-1259 §8 D: "If any real receipt appears unexpectedly, STOP. Do not delete it to regain
    green." So an unexpected receipt exits non-zero and names the file. There is deliberately no
    flag on this script that removes anything: the tool that reports the budget must not also be
    the tool that can silently restore it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.engine.extraction.isolated_attempt_receipt import DurableAttemptLedger  # noqa: E402
from src.engine.extraction.isolated_bridge import (  # noqa: E402
    CLAIMED,
    NATIVE_TASK_DISPATCHED,
    RAW_RETURN_CAPTURED,
    READY,
    STRANDED_INCOMPLETE,
    state_of,
)

DEFAULT_QUEUE = os.path.join(
    "docs", "replay-results", "svkm-extraction-certified", "grade", "opus-v2",
    "isolated_fallback_queue_t1.json",
)
DEFAULT_RECEIPTS = os.path.join(
    "docs", "replay-results", "svkm-extraction-certified", "grade", "opus-v2",
    "isolated-receipts-t1",
)

# The receipt directory ships with a README explaining what it is. Anything else in it is a
# spent or planted attempt and is a STOP.
EXPECTED_NON_RECEIPT_FILES = frozenset({"README.md"})


def preflight(queue_path: str, receipt_dir: str) -> dict:
    if not os.path.isdir(receipt_dir):
        raise SystemExit(
            f"REFUSED: receipt directory {receipt_dir!r} does not exist. This script is read-only "
            "and will not create it; a missing directory is a fact about the pin, not something "
            "to repair on the way past."
        )

    with open(queue_path, "rb") as fh:
        queue_bytes = fh.read()
    queue_sha = hashlib.sha256(queue_bytes).hexdigest()

    ledger = DurableAttemptLedger.load(queue_path, receipt_dir)
    refs = [e["condition_ref"] for e in ledger.queue["queue"]]
    states = {ref: state_of(ledger, ref) for ref in refs}

    def _in(*wanted: str) -> list[str]:
        return sorted(r for r, s in states.items() if s in wanted)

    # `claimed` and `dispatched` are CUMULATIVE — a dispatched ref was also claimed. Reporting
    # them as disjoint buckets would let a spent attempt hide behind a later state.
    claimed = sorted(ledger.claimed_refs())
    dispatched = _in(NATIVE_TASK_DISPATCHED, STRANDED_INCOMPLETE, RAW_RETURN_CAPTURED)
    completed = _in(RAW_RETURN_CAPTURED)

    stray = sorted(
        name for name in os.listdir(receipt_dir)
        if name not in EXPECTED_NON_RECEIPT_FILES
    )

    return {
        "queue_path": queue_path,
        "queue_artifact_sha256": queue_sha,
        "law_version": ledger.queue.get("law_version"),
        "input_route_version": ledger.queue.get("input_route_version"),
        "queue_count": len(refs),
        "claimed": claimed,
        "dispatched": dispatched,
        "completed": completed,
        "crash_shaped": sorted(ledger.crash_shaped_refs()),
        "stranded_incomplete": _in(STRANDED_INCOMPLETE),
        "ready": len(_in(READY)),
        "receipt_dir_non_readme": stray,
        "states": states,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--queue", default=DEFAULT_QUEUE)
    ap.add_argument("--receipts", default=DEFAULT_RECEIPTS)
    args = ap.parse_args(argv)

    rep = preflight(args.queue, args.receipts)

    print(f"queue_path                = {rep['queue_path']}")
    print(f"queue_artifact_sha256     = {rep['queue_artifact_sha256']}")
    print(f"law_version               = {rep['law_version']}")
    print(f"input_route_version       = {rep['input_route_version']}")
    print(f"queue_count               = {rep['queue_count']}")
    print(f"claimed                   = {rep['claimed']}")
    print(f"dispatched                = {rep['dispatched']}")
    print(f"completed                 = {rep['completed']}")
    print(f"crash_shaped              = {rep['crash_shaped']}")
    print(f"stranded_incomplete       = {rep['stranded_incomplete']}")
    print(f"ready                     = {rep['ready']}")
    print(f"receipt directory non-README = {rep['receipt_dir_non_readme']}")

    spent = (rep["claimed"] or rep["dispatched"] or rep["completed"]
             or rep["crash_shaped"] or rep["stranded_incomplete"]
             or rep["receipt_dir_non_readme"])
    if spent:
        print()
        print("STOP — a real receipt exists that this preflight did not expect. AR-1259 §8 D: do "
              "NOT delete it to regain green. Report it.")
        return 2
    if rep["ready"] != rep["queue_count"]:
        print()
        print(f"STOP — ready ({rep['ready']}) != queue_count ({rep['queue_count']}).")
        return 2
    print()
    print(f"ALL {rep['queue_count']} ONE-SHOT ATTEMPTS UNSPENT.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
