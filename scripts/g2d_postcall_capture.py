#!/usr/bin/env python3
"""AR-1303A §3 / §6, AR-1304 §6 — THE TRUSTED POST-AGENT RETURN-CAPTURE DOORWAY (F30).

THE DEFECT THIS CLOSES, IN ONE PARAGRAPH
    The durable bridge already defines the correct terminal law:
    READY -> CLAIMED -> NATIVE_TASK_DISPATCHED -> RAW_RETURN_CAPTURED, with the final state
    requiring the create-only `.raw` + `.completion` pair (`capture_native_return` in
    `isolated_bridge.py`). But nothing trusted ever calls it: the live Worker guard registers
    only SessionStart and PreToolUse, so a real Agent dispatch would reach NATIVE_TASK_DISPATCHED
    and then strand there forever, because ordinary Worker prose asking the model to "copy the
    answer into a receipt afterward" is both procedurally lossy and forbidden by the same
    self-protection that fences the receipt namespace from every other Worker write.

WHY THIS IS A DOORWAY AND NOT A SECOND IMPLEMENTATION
    Every rule below already exists in `isolated_bridge.capture_native_return`. This file adds NO
    receipt law of its own -- it calls that one function. A second implementation of a receipt
    contract is a copy that drifts and stops biting while still reporting PASS, the same reason
    `g2d_precall_transition.py` is a doorway to `record_native_dispatch` rather than a
    reimplementation of it.

WHY THE RAW TEXT AND COMPLETION METADATA ARRIVE AS FILES, NOT ARGV
    A real subagent return can be arbitrarily large and can contain any byte a shell would mangle
    (quotes, newlines, encoding). Argv is exactly the layer `[i-measured]` and
    `[stated-price-not-prohibition]`-class defects have already been caught living in -- a shell
    that mangles a value before the program ever sees it convicts the wrong layer. Passing both as
    file paths keeps the boundary a single `open()` + `read()`, nothing else.

FAIL-CLOSED, AND DELIBERATELY NOT TIDY
    Every refusal path here is `capture_native_return` refusing on its own terms (already
    dispatched? already captured? malformed completion fields?) -- this file does not add a
    second guard in front of that one, because a second guard is a second place to drift.

Usage (invoked by the pinned G2 post-call hook, not by hand):
    python scripts/g2d_postcall_capture.py --queue Q --receipt-dir D \
        --condition-ref REF --raw-output-file RAW.txt [--completion-json COMPLETION.json]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.engine.extraction.isolated_attempt_receipt import AttemptRefused, DurableAttemptLedger  # noqa: E402
from src.engine.extraction.isolated_bridge import capture_native_return  # noqa: E402


def _fail(stage: str, message: str) -> int:
    json.dump({"ok": False, "stage": stage, "error": message}, sys.stdout)
    sys.stdout.write("\n")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", required=True)
    ap.add_argument("--receipt-dir", required=True)
    ap.add_argument("--condition-ref", required=True)
    ap.add_argument("--raw-output-file", required=True,
                     help="path to a file holding the exact bytes the hook/runtime event supplied "
                          "as the tool response -- never a worker-authored reconstruction.")
    ap.add_argument("--completion-json", default=None,
                     help="path to a JSON file with the COMPLETION_FIELDS subset actually known; "
                          "omitted means an empty completion (every field becomes NOT_EXPOSED).")
    args = ap.parse_args()

    try:
        ledger = DurableAttemptLedger.load(args.queue, args.receipt_dir)
    except Exception as exc:  # noqa: BLE001 - any load failure is a refusal, never a pass
        return _fail("load", f"{type(exc).__name__}: {exc}")

    try:
        with open(args.raw_output_file, "r", encoding="utf-8") as fh:
            raw_output = fh.read()
    except OSError as exc:
        return _fail("read_raw", f"{type(exc).__name__}: {exc}")

    completion: dict | None = None
    if args.completion_json:
        try:
            with open(args.completion_json, "r", encoding="utf-8") as fh:
                completion = json.load(fh)
        except OSError as exc:
            return _fail("read_completion", f"{type(exc).__name__}: {exc}")
        except json.JSONDecodeError as exc:
            return _fail("read_completion", f"completion JSON is not valid JSON: {exc}")
        if not isinstance(completion, dict):
            return _fail("read_completion", "completion JSON must decode to an object")

    try:
        receipt = capture_native_return(ledger, args.condition_ref, raw_output, completion)
    except AttemptRefused as exc:
        return _fail("capture", str(exc))
    except Exception as exc:  # noqa: BLE001
        return _fail("capture", f"{type(exc).__name__}: {exc}")

    json.dump({
        "ok": True,
        "condition_ref": args.condition_ref,
        "state": receipt["state"],
        "raw_output_sha256": receipt["raw_output_sha256"],
        "requested_model_identity": receipt["requested_model_identity"],
        "dispatch_native_task_id": receipt["dispatch_native_task_id"],
        "note": "raw return and completion receipt were both written by the existing durable law; "
                "this doorway performed no receipt logic of its own",
    }, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
