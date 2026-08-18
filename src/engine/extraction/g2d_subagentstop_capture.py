"""F36 — the async-launch-ack vs true-final-completion boundary (AR-1311B / AR-1312B / AR-1313A).

THE DEFECT THIS CLOSES
    An Agent/Task dispatch under this harness returns SYNCHRONOUSLY with an async launch
    acknowledgement (`isAsync: true` / `status: "async_launched"` / an `agentId`) -- NOT the
    subagent's final answer. The final answer arrives later, delivered by the harness as a
    separate completion event. `PostToolUse(Agent)` fires on the SYNCHRONOUS return, so a
    capture doorway invoked from PostToolUse alone will only ever see the launch ack. Prior
    receipts (AR-1311/AR-1312 `isolated-receipts-t1/*.raw.json`) captured exactly that ack and
    were nevertheless marked `RAW_RETURN_CAPTURED` -- a real execution-boundary defect, not a
    cosmetic one.

WHAT THIS MODULE DOES, AND WHAT IT DELIBERATELY DOES NOT DO
    It adds exactly two new call boundaries and one new check, all built ON TOP of the existing
    trusted doorway (`isolated_bridge.capture_native_return`), which stays completely unchanged:

        record_async_launch_ack()      -- PostToolUse(Agent) lands here. Launch telemetry ONLY.
                                           Never creates `.raw`/`.completion`. Row stays
                                           NATIVE_TASK_DISPATCHED.
        capture_subagent_stop_final()  -- the terminal subagent-completion event lands here.
                                           Binds by `agent_id` to the launch ack already on
                                           file for this exact row, THEN calls
                                           `capture_native_return()` unchanged -- so duplicate-
                                           finalization protection is inherited for free
                                           (`capture_native_return` already refuses a second
                                           write at RAW_RETURN_CAPTURED), not reimplemented.
        assert_sequential_interlock()  -- every queue row strictly before `ref`, in the queue's
                                           own frozen order, must already be RAW_RETURN_CAPTURED.
                                           A launched-but-unfinalized predecessor blocks every
                                           row after it by construction.

    It does NOT reimplement the durable receipt law, does NOT touch `capture_native_return` or
    `record_native_dispatch`, and does NOT wire into any live `.claude/` hook, the pinned guard
    toolbox, or any file that path currently invokes. This module is inert until a future
    privileged propagation decision wires a live doorway to call it -- that decision is
    explicitly NOT made here (AR-1313A: "NOT AUTHORIZED IN THIS RULING").

UNVERIFIED, DISCLOSED, NOT GUESSED INTO THE CONTRACT
    The exact JSON field names Claude Code's `SubagentStop` hook event actually exposes
    (candidate names from the ruling: `agent_id`, `agent_transcript_path`,
    `last_assistant_message`) were NOT found in any locally available authoritative source
    during this repair pass (searched: this repo's own hook doorway `scripts/claude_guard_hook.mjs`,
    which only reads `hook_event_name`; the installed `@anthropic-ai/claude-code` npm package's
    `README.md` and `sdk-tools.d.ts`, which document tool schemas, not the hook event contract).
    Per AR-1313A ("prove the event/schema from the implementation or authoritative local
    contract before wiring it; do not guess field names"), this module therefore takes
    `agent_id` and `raw_output`/`completion` as OPAQUE CALLER-SUPPLIED ARGUMENTS rather than
    parsing a specific hook JSON shape itself. The state-machine correctness this module exists
    to prove (async ack != final, identity-bound finalization, no duplicate overwrite,
    sequential interlock) is therefore verified independent of that open field-name question.
    A future privileged-propagation packet must supply the real hook-JSON-to-(agent_id,
    raw_output) extraction as a thin, separately-reviewable adapter at the live doorway --
    building that adapter is explicitly out of scope for this off-live packet.
"""
from __future__ import annotations

import json
import os
from typing import Any

from .isolated_attempt_receipt import AttemptRefused, DurableAttemptLedger, _safe_name
from .isolated_bridge import (
    NATIVE_TASK_DISPATCHED,
    RAW_RETURN_CAPTURED,
    capture_native_return,
    state_of,
)

__all__ = [
    "record_async_launch_ack",
    "capture_subagent_stop_final",
    "assert_sequential_interlock",
]


def _launch_ack_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.launch_ack.json")


def record_async_launch_ack(
    ledger: DurableAttemptLedger, ref: str, agent_id: str, raw_ack_payload: Any = None,
) -> dict:
    """F36 point 1. An async launch acknowledgement is launch-only telemetry.

    Refuses unless a dispatch was already recorded (state must be exactly
    NATIVE_TASK_DISPATCHED) -- an ack for a call that was never dispatched, or for a row already
    finalized, is refused rather than silently accepted. Never creates `.raw`/`.completion`:
    that is the entire point of separating this from `capture_native_return`.
    """
    st = state_of(ledger, ref)
    if st != NATIVE_TASK_DISPATCHED:
        raise AttemptRefused(
            f"cannot record a launch ack for {ref!r} at state {st}: a launch ack is only valid "
            f"immediately after a recorded dispatch ({NATIVE_TASK_DISPATCHED}), before any final "
            "capture — recording one at any other state would misrepresent what happened."
        )
    if not agent_id:
        raise AttemptRefused(
            f"cannot record a launch ack for {ref!r} with no agent_id: an unidentified launch "
            "can never later be matched by a terminal completion event, so it could never be "
            "finalized honestly."
        )
    path = _launch_ack_path(ledger, ref)
    if os.path.exists(path):
        raise AttemptRefused(
            f"{ref!r} already has a recorded launch ack. The one authorized dispatch's launch is "
            "recorded exactly once; a second ack describes a call this row never made."
        )
    receipt = {
        "state": "ASYNC_LAUNCH_ACK_RECORDED",
        "condition_ref": ref,
        "agent_id": agent_id,
        "raw_ack_payload": raw_ack_payload,
        "authority": "F36 (AR-1311B / AR-1312B / AR-1313A)",
        "note": (
            "This receipt proves a subagent was launched. It does NOT satisfy final-answer "
            "capture. Only a matching SubagentStop event through capture_subagent_stop_final() "
            "may finalize this row."
        ),
    }
    DurableAttemptLedger._create_only(
        path, receipt, what="launch ack receipt",
        extra=f"{ref!r} already has a launch ack recorded.")
    return receipt


def _read_launch_ack(ledger: DurableAttemptLedger, ref: str) -> dict | None:
    path = _launch_ack_path(ledger, ref)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def capture_subagent_stop_final(
    ledger: DurableAttemptLedger,
    ref: str,
    agent_id: str,
    raw_output: str,
    completion: dict[str, Any] | None = None,
) -> dict:
    """F36 point 2. The real finalization boundary.

    Binds by `agent_id` to the launch ack already recorded for this EXACT frozen row, then
    reuses `capture_native_return()` completely unchanged. Duplicate-finalization protection is
    therefore inherited, not reimplemented: `capture_native_return` already refuses a second
    write once a row reaches RAW_RETURN_CAPTURED, and this function adds no exception to that.
    """
    ack = _read_launch_ack(ledger, ref)
    if ack is None:
        raise AttemptRefused(
            f"cannot finalize {ref!r}: no launch ack was ever recorded for it, so this "
            "completion event cannot be bound to an authorized, already-launched dispatch."
        )
    if ack["agent_id"] != agent_id:
        raise AttemptRefused(
            f"cannot finalize {ref!r}: this completion event names agent_id {agent_id!r}, but "
            f"the recorded launch for this row was agent_id {ack['agent_id']!r}. A mismatched "
            "identity is never trusted to close a different row's dispatch — fail closed."
        )
    return capture_native_return(ledger, ref, raw_output, completion)


def assert_sequential_interlock(ledger: DurableAttemptLedger, ref: str) -> None:
    """F36 point 3. Row N+1 stays denied until row N has a durable final capture.

    Every queue row strictly BEFORE `ref`, in the queue's own frozen order, must already be
    RAW_RETURN_CAPTURED. A launched-but-unfinalized predecessor blocks every later row by
    construction — there is no separate index to keep in sync and no way to skip ahead.
    """
    order = [e["condition_ref"] for e in ledger.queue["queue"]]
    if ref not in order:
        raise AttemptRefused(f"{ref!r} is not in the committed queue order.")
    for earlier in order[: order.index(ref)]:
        st = state_of(ledger, earlier)
        if st != RAW_RETURN_CAPTURED:
            raise AttemptRefused(
                f"sequential interlock: {ref!r} is blocked because {earlier!r} is at state "
                f"{st!r}, not {RAW_RETURN_CAPTURED!r}. Row N+1 may not be claimed until row N "
                "has a durable final capture."
            )
