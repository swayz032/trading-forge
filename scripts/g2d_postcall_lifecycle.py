#!/usr/bin/env python3
"""AR-1315A §5 Lane A -- the F36 lifecycle doorway (async launch ack + true SubagentStop terminal).

WHY THIS IS A SIBLING, NOT AN EXTENSION OF `g2d_postcall_capture.py`
    `g2d_postcall_capture.py` is ONE action: take an already-known final answer and call
    `capture_native_return()`. F36's whole point is that a synchronous `PostToolUse(Agent|Task)`
    return is NOT that -- it is an async launch acknowledgement -- so the SAME entry point cannot
    correctly serve both without the caller first deciding which case it has, which is exactly the
    ambiguity `g2d_postcall_capture.py` had (AR-1314A/AR-1315A: it always calls
    `capture_native_return`, so it would still commit the F36 mistake if pointed at a launch ack).
    This file adds two clearly separate, explicitly-named entry points instead of one ambiguous one.

WHY THIS IS A DOORWAY AND NOT A SECOND IMPLEMENTATION
    Every rule enforced here already exists in `src/engine/extraction/g2d_subagentstop_capture.py`
    (`record_async_launch_ack`, `capture_subagent_stop_event`) and, beneath that, in
    `isolated_bridge.capture_native_return`. This file adds exactly ONE new piece of logic that
    does not exist anywhere else: resolving WHICH frozen queue row a `SubagentStop` event's
    `agent_id` belongs to, by reading the already-recorded `*.launch_ack.json` receipts. That
    resolution does not decide identity or finality -- it only locates the row before handing off
    to the same trusted functions everything else already uses. It never mutates receipt state
    itself and never duplicates `capture_subagent_stop_event`'s or `record_async_launch_ack`'s
    fail-closed rules.

TWO SUBCOMMANDS, TWO DIFFERENT REAL EVENT SHAPES
    launch-ack     -- a `PostToolUse(Agent|Task)` return matching the already-observed real async
                      launch acknowledgement shape (`isAsync: true`, `status: "async_launched"`,
                      an `agentId`). The row is already known by `--condition-ref` (PostToolUse
                      fires synchronously against the exact tool call that dispatched this row).
                      Calls `record_async_launch_ack()` ONLY. Never calls `capture_native_return`
                      on this path -- the row stays `NATIVE_TASK_DISPATCHED`, which is the entire
                      point of F36.
    subagent-stop  -- a real `SubagentStop` hook payload. The row is NOT known in advance (the
                      hook fires once per finishing subagent, not once per queue row), so this
                      resolves it by scanning already-recorded launch-ack receipts for the ONE row
                      whose recorded `agent_id` matches the event's `agent_id`. Zero matches or
                      more than one match REFUSES rather than guessing. The resolved row is then
                      handed unchanged to `capture_subagent_stop_event()`.

UNKNOWN SHAPES FAIL CLOSED
    A `launch-ack` payload missing `isAsync`/`status`/`agentId` in the documented shape is refused,
    never silently treated as a final answer and never silently dropped as a no-op. A
    `subagent-stop` payload that does not resolve to exactly one row is refused. Neither path adds
    a retry, a second dispatch, a polling loop, or a transcript-scraping fallback.

Usage (invoked by the pinned G2 lifecycle hook once wired -- not by hand):
    python scripts/g2d_postcall_lifecycle.py launch-ack --queue Q --receipt-dir D \
        --condition-ref REF --ack-payload-json ACK.json
    python scripts/g2d_postcall_lifecycle.py subagent-stop --queue Q --receipt-dir D \
        --hook-payload-json PAYLOAD.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.engine.extraction.g2d_subagentstop_capture import (  # noqa: E402
    SubagentStopNotTerminal,
    capture_subagent_stop_event,
    record_async_launch_ack,
)
from src.engine.extraction.isolated_attempt_receipt import AttemptRefused, DurableAttemptLedger  # noqa: E402

ASYNC_ACK_REQUIRED_FIELDS = ("isAsync", "status", "agentId")


def _fail(stage: str, message: str) -> int:
    json.dump({"ok": False, "stage": stage, "error": message}, sys.stdout)
    sys.stdout.write("\n")
    return 1


def _load_ledger(queue: str, receipt_dir: str) -> DurableAttemptLedger | None:
    return DurableAttemptLedger.load(queue, receipt_dir)


def _load_json_file(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _is_async_launch_ack_shape(payload: dict) -> bool:
    """The already-observed real PostToolUse(Agent|Task) async-launch shape: `isAsync: true`,
    a `status`, and a nonempty `agentId`. Anything else is an unknown shape and must fail closed
    rather than being guessed into either an ack or a final answer."""
    if payload.get("isAsync") is not True:
        return False
    if not payload.get("status"):
        return False
    if not payload.get("agentId"):
        return False
    return True


def _resolve_row_for_agent_id(ledger: DurableAttemptLedger, agent_id: str) -> str:
    """Scan already-recorded `*.launch_ack.json` receipts for the ONE row whose recorded
    `agent_id` matches. Refuses on zero or on more than one match -- this is a LOCATION step,
    not an identity or finality decision; those remain entirely inside
    `capture_subagent_stop_event()` / `record_async_launch_ack()`.
    """
    pattern = os.path.join(ledger.receipt_dir, "*.launch_ack.json")
    matches: list[str] = []
    for path in sorted(glob.glob(pattern)):
        try:
            receipt = _load_json_file(path)
        except (OSError, json.JSONDecodeError):
            continue
        if receipt.get("agent_id") == agent_id:
            ref = receipt.get("condition_ref")
            if ref:
                matches.append(ref)
    if len(matches) == 0:
        raise AttemptRefused(
            f"no recorded launch ack names agent_id {agent_id!r}: a SubagentStop event cannot "
            "be bound to a row that was never dispatched with this identity."
        )
    if len(matches) > 1:
        raise AttemptRefused(
            f"agent_id {agent_id!r} matches {len(matches)} recorded launch acks "
            f"({matches!r}): a SubagentStop event must resolve to exactly one row; an ambiguous "
            "match is refused rather than guessed."
        )
    return matches[0]


def _cmd_launch_ack(args: argparse.Namespace) -> int:
    try:
        ledger = _load_ledger(args.queue, args.receipt_dir)
    except Exception as exc:  # noqa: BLE001 - any load failure is a refusal, never a pass
        return _fail("load", f"{type(exc).__name__}: {exc}")

    try:
        payload = _load_json_file(args.ack_payload_json)
    except OSError as exc:
        return _fail("read_ack_payload", f"{type(exc).__name__}: {exc}")
    except json.JSONDecodeError as exc:
        return _fail("read_ack_payload", f"ack payload is not valid JSON: {exc}")

    if not _is_async_launch_ack_shape(payload):
        return _fail(
            "shape",
            "PostToolUse response does not match the documented async-launch-ack shape "
            f"({ASYNC_ACK_REQUIRED_FIELDS}); refusing rather than guessing whether this is an "
            "ack or a final answer.",
        )

    try:
        receipt = record_async_launch_ack(
            ledger, args.condition_ref, agent_id=payload["agentId"], raw_ack_payload=payload,
        )
    except AttemptRefused as exc:
        return _fail("capture", str(exc))

    json.dump({
        "ok": True,
        "action": "launch_ack",
        "condition_ref": args.condition_ref,
        "agent_id": receipt["agent_id"],
        "state": receipt["state"],
        "note": "row remains NATIVE_TASK_DISPATCHED; capture_native_return was NOT called",
    }, sys.stdout)
    sys.stdout.write("\n")
    return 0


def _cmd_subagent_stop(args: argparse.Namespace) -> int:
    try:
        ledger = _load_ledger(args.queue, args.receipt_dir)
    except Exception as exc:  # noqa: BLE001
        return _fail("load", f"{type(exc).__name__}: {exc}")

    try:
        hook_payload = _load_json_file(args.hook_payload_json)
    except OSError as exc:
        return _fail("read_hook_payload", f"{type(exc).__name__}: {exc}")
    except json.JSONDecodeError as exc:
        return _fail("read_hook_payload", f"hook payload is not valid JSON: {exc}")

    agent_id = hook_payload.get("agent_id")
    if not agent_id:
        return _fail("shape", "SubagentStop payload carries no agent_id; cannot resolve a row.")

    try:
        ref = _resolve_row_for_agent_id(ledger, agent_id)
    except AttemptRefused as exc:
        return _fail("resolve", str(exc))

    try:
        receipt = capture_subagent_stop_event(ledger, ref, hook_payload)
    except SubagentStopNotTerminal as exc:
        json.dump({
            "ok": True,
            "action": "subagent_stop_nonterminal",
            "condition_ref": ref,
            "agent_id": agent_id,
            "note": str(exc),
        }, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except (AttemptRefused, ValueError) as exc:
        return _fail("capture", str(exc))

    json.dump({
        "ok": True,
        "action": "subagent_stop_final",
        "condition_ref": ref,
        "agent_id": agent_id,
        "state": receipt["state"],
        "raw_output_sha256": receipt["raw_output_sha256"],
    }, sys.stdout)
    sys.stdout.write("\n")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)

    ack = sub.add_parser("launch-ack")
    ack.add_argument("--queue", required=True)
    ack.add_argument("--receipt-dir", required=True)
    ack.add_argument("--condition-ref", required=True)
    ack.add_argument("--ack-payload-json", required=True,
                      help="path to a file holding the exact bytes the PostToolUse(Agent|Task) "
                           "event supplied -- never a worker-authored reconstruction.")
    ack.set_defaults(func=_cmd_launch_ack)

    stop = sub.add_parser("subagent-stop")
    stop.add_argument("--queue", required=True)
    stop.add_argument("--receipt-dir", required=True)
    stop.add_argument("--hook-payload-json", required=True,
                       help="path to a file holding the exact bytes the SubagentStop hook event "
                            "supplied -- never a worker-authored reconstruction.")
    stop.set_defaults(func=_cmd_subagent_stop)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
