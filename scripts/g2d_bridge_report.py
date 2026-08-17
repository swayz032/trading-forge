#!/usr/bin/env python3
"""AR-1305A F33/F34 -- READ-ONLY DOORWAY TO THE EXISTING DURABLE STATE LAW.

WHY THIS EXISTS
    F33/F34 both require a global, cross-row view of the durable handoff state (is any OTHER
    row stuck at CLAIMED/NATIVE_TASK_DISPATCHED/STRANDED_INCOMPLETE? which rows have reached
    RAW_RETURN_CAPTURED, in queue order?) so the guard can enforce the one-shot global interlock
    and the frozen row order.

    `isolated_bridge.bridge_report()` already answers exactly this question, correctly, by
    calling the existing `state_of()` for every row. AR-1305A is explicit: "use the EXISTING
    durable state law as authority (do not invent a competing state machine)." So this file adds
    NO state logic of its own -- it is a read-only CLI wrapper around `bridge_report`, the same
    doorway pattern as `g2d_precall_transition.py` and `g2d_postcall_capture.py`, except this one
    performs no write at all.

Usage (invoked by the pinned G2 guard for the global interlock check, not by hand):
    python scripts/g2d_bridge_report.py --queue Q --receipt-dir D
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.engine.extraction.isolated_attempt_receipt import DurableAttemptLedger  # noqa: E402
from src.engine.extraction.isolated_bridge import bridge_report  # noqa: E402


def _fail(stage: str, message: str) -> int:
    json.dump({"ok": False, "stage": stage, "error": message}, sys.stdout)
    sys.stdout.write("\n")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", required=True)
    ap.add_argument("--receipt-dir", required=True)
    args = ap.parse_args()

    try:
        ledger = DurableAttemptLedger.load(args.queue, args.receipt_dir)
    except Exception as exc:  # noqa: BLE001 - any load failure is a refusal, never a pass
        return _fail("load", f"{type(exc).__name__}: {exc}")

    try:
        report = bridge_report(ledger)
    except Exception as exc:  # noqa: BLE001
        return _fail("report", f"{type(exc).__name__}: {exc}")

    # Queue order is load-bearing for F34 (row-order enforcement) and is not part of
    # bridge_report()'s own return value, so it is added here, read straight from the same
    # ledger object bridge_report() itself used -- never re-derived or reordered.
    ordered_refs = [entry["condition_ref"] for entry in ledger.queue["queue"]]

    json.dump({"ok": True, "queue_order": ordered_refs, **report}, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
