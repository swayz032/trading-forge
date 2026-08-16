#!/usr/bin/env python3
"""AR-1267 §5 / §9D — THE TRUSTED `claim -> dispatch` TRANSITION, PERFORMED BEFORE ALLOW.

THE DEFECT THIS CLOSES, IN ONE PARAGRAPH
    The durable law writes `.attempt` BEFORE the model is invoked (`claim_attempt`), and
    `record_native_dispatch` permits `.dispatch` only from CLAIMED. AR-1266's pre-call guard,
    however, treated the existence of ANY `.attempt` as already-spent and denied. So the two
    rules could not both be satisfied: claim first and the guard denied the call; skip the claim
    and the model ran unbudgeted. The contradiction was never in the receipts -- it was in WHO
    CLAIMS. The seam was procedural ("remember to claim, then remember to dispatch"), so the
    repair removes the seam: the trusted PreToolUse path performs the transition itself and only
    then lets the model call through.

WHY THIS IS A DOORWAY AND NOT A SECOND IMPLEMENTATION
    Every rule below already exists in `isolated_attempt_receipt` and `isolated_bridge`. This
    file adds NO receipt law of its own -- it calls theirs. A second implementation of a receipt
    contract is a copy that drifts and stops biting while still reporting PASS, which is the same
    reason `claude_guard_hook.mjs` is a doorway to the pinned toolbox rather than a second guard.

FAIL-CLOSED, AND DELIBERATELY NOT TIDY
    If the claim lands and the dispatch does not, the attempt is SPENT and this exits non-zero.
    It does NOT delete the attempt and it does NOT retry (AR-1267 §5: "Do not clean it up and do
    not retry automatically"). A call that may have been delivered must never become repeatable,
    and a crash-shaped ref is a desk question, not a self-service recovery.

RACE ARBITRATION IS THE FILESYSTEM'S, NOT OURS
    `_create_only` is an exclusive create. Two concurrent invocations for one condition therefore
    produce at most one successful `.attempt`, so at most one ALLOW -- without a lock, a lease or
    any coordination this process would have to be trusted to honour.

Usage (invoked by the pinned G2 pre-call guard, not by hand):
    python scripts/g2d_precall_transition.py --queue Q --receipt-dir D \
        --condition-ref REF --task-input-sha256 SHA
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.engine.extraction.isolated_attempt_receipt import (  # noqa: E402
    AttemptRefused,
    DurableAttemptLedger,
)
from src.engine.extraction.isolated_bridge import record_native_dispatch  # noqa: E402


def _fail(stage: str, message: str) -> int:
    json.dump({"ok": False, "stage": stage, "error": message}, sys.stdout)
    sys.stdout.write("\n")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", required=True)
    ap.add_argument("--receipt-dir", required=True)
    ap.add_argument("--condition-ref", required=True)
    ap.add_argument("--task-input-sha256", required=True)
    ap.add_argument(
        "--native-task-id",
        default=None,
        help="Only if the runtime exposes one BEFORE dispatch. It does not today, so the "
             "dispatch receipt records NOT_EXPOSED rather than a value invented to look complete.",
    )
    args = ap.parse_args()

    try:
        ledger = DurableAttemptLedger.load(args.queue, args.receipt_dir)
    except Exception as exc:  # noqa: BLE001 - any load failure is a refusal, never a pass
        return _fail("load", f"{type(exc).__name__}: {exc}")

    # 1. CLAIM. Create-only, and it refuses a receipt written by any previous process -- which is
    #    exactly how a pre-existing attempt or a crashed prior call is caught here rather than
    #    being silently "resumed" as a fresh invocation.
    try:
        attempt = ledger.claim_attempt(args.condition_ref, args.task_input_sha256)
    except AttemptRefused as exc:
        return _fail("claim", str(exc))
    except Exception as exc:  # noqa: BLE001
        return _fail("claim", f"{type(exc).__name__}: {exc}")

    # 2. DISPATCH. From here the attempt is SPENT whatever happens below. Nothing in this file
    #    removes the receipt written above.
    try:
        dispatch = record_native_dispatch(ledger, args.condition_ref, native_task_id=args.native_task_id)
    except Exception as exc:  # noqa: BLE001
        return _fail(
            "dispatch",
            f"{type(exc).__name__}: {exc}. THE ATTEMPT IS SPENT: {args.condition_ref!r} holds a "
            "durable claim with no dispatch beside it. It is NOT cleaned up and NOT retried — a "
            "crash-shaped condition stops the campaign for desk adjudication.",
        )

    json.dump({
        "ok": True,
        "condition_ref": args.condition_ref,
        "attempt_status": attempt["status"],
        "attempt_number": attempt["attempt_number"],
        "dispatch_state": dispatch["state"],
        "requested_model_identity": dispatch["requested_model_identity"],
        "invocation_path": dispatch["invocation_path"],
        "native_task_id": dispatch["native_task_id"],
        "queue_artifact_sha256": dispatch["queue_artifact_sha256"],
        "task_input_sha256": dispatch["task_input_sha256"],
        "note": "attempt and dispatch were both written BEFORE the model call was allowed",
    }, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
