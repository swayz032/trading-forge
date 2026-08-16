"""D1.2 / D1.3 — the durable handoff to the real Claude Code subagent (AR-1254 §4, §5).

WHY A STATE MACHINE AND NOT A PYTHON CALLBACK
    `isolated_dispatch.IsolatedDispatcher` proves `claim -> invoke -> persist` **inside a Python
    call boundary**. AR-1254 F-2 is right that this is not the real runtime: the Claude Code
    subagent dispatch is performed by the agent, not by a Python function, so the callback cannot
    literally *be* the live Task invocation. Pretending otherwise would leave a procedural seam —
    "run the claim command, then remember to dispatch, then remember to persist" — and a seam a
    human has to remember is the retry loop with extra steps.

    So the handoff itself is made durable. Each transition is a create-only file; the STATE IS
    THE FILESYSTEM, and it survives the crash it exists to survive.

        READY  ->  CLAIMED  ->  NATIVE_TASK_DISPATCHED  ->  RAW_RETURN_CAPTURED
                 .attempt      .dispatch                   .raw + .completion

    Every transition refuses unless its predecessor exists, so the six facts AR-1254 §4 requires
    are answerable from the directory alone, by anyone, after the fact.

WHAT IS DELIBERATELY *NOT* CLAIMED HERE
    This module does not dispatch a subagent and cannot. It records that one was dispatched, with
    the identity the runtime actually exposed. It is evidence, not execution.

ON TELEMETRY THAT DOES NOT EXIST (AR-1254 §5)
    Where the Claude Code subscription runtime does not expose a field, the receipt records
    `NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME` — never an invented number, and never a
    blocking wait for telemetry that is not on offer. An absent field is a fact about the runtime
    and it is recorded as one.

DETERMINISM FENCE
    Timestamps and token counts live in the COMPLETION receipt, which is evidence. They are kept
    out of the semantic route record, so two identical semantic reruns stay byte-identical
    (AR-1254 §5, final paragraph).
"""
from __future__ import annotations

import os
from typing import Any

from .isolated_attempt_receipt import (
    AttemptRefused,
    DurableAttemptLedger,
    _safe_name,
)

__all__ = [
    "NOT_EXPOSED",
    "READY",
    "CLAIMED",
    "NATIVE_TASK_DISPATCHED",
    "RAW_RETURN_CAPTURED",
    "COMPLETION_FIELDS",
    "record_native_dispatch",
    "capture_native_return",
    "state_of",
    "bridge_report",
]

NOT_EXPOSED = "NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME"

READY = "READY"
CLAIMED = "CLAIMED"
NATIVE_TASK_DISPATCHED = "NATIVE_TASK_DISPATCHED"
RAW_RETURN_CAPTURED = "RAW_RETURN_CAPTURED"

# Every field the completion receipt must carry a value OR the NOT_EXPOSED sentinel for.
COMPLETION_FIELDS = (
    "actual_model_identity",
    "native_task_id",
    "invocation_started_at",
    "invocation_ended_at",
    "input_tokens",
    "output_tokens",
)

APPROVED_INVOCATION_PATH = "fresh Claude Code subscription subagent"


def _dispatch_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.dispatch.json")


def _completion_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.completion.json")


def state_of(ledger: DurableAttemptLedger, ref: str) -> str:
    """The condition's position in the handoff, read from the filesystem alone."""
    ledger._entry(ref)                       # refuses an out-of-queue ref
    if os.path.exists(ledger.raw_path(ref)):
        return RAW_RETURN_CAPTURED
    if os.path.exists(_dispatch_path(ledger, ref)):
        return NATIVE_TASK_DISPATCHED
    if os.path.exists(ledger.attempt_path(ref)):
        return CLAIMED
    return READY


def record_native_dispatch(
    ledger: DurableAttemptLedger,
    ref: str,
    native_task_id: str | None = None,
    requested_model_identity: str = "opus",
    invocation_path: str = APPROVED_INVOCATION_PATH,
) -> dict[str, Any]:
    """Record that the ONE authorized native subagent dispatch has been issued.

    Refuses unless the durable claim already exists, and refuses a second dispatch — the claim
    is the budget, and a dispatch without one is an unbudgeted call.
    """
    entry = ledger._entry(ref)
    st = state_of(ledger, ref)
    if st == READY:
        raise AttemptRefused(
            f"cannot record a dispatch for {ref!r}: no durable attempt has been claimed. The "
            "claim is written BEFORE the call precisely so an unbudgeted dispatch is impossible "
            "to record after the fact."
        )
    if st in (NATIVE_TASK_DISPATCHED, RAW_RETURN_CAPTURED):
        raise AttemptRefused(
            f"{ref!r} is already at state {st}. One dispatch per claim; a second is a retry."
        )
    if invocation_path != APPROVED_INVOCATION_PATH:
        raise AttemptRefused(
            f"invocation path {invocation_path!r} is not the approved Claude Code subscription "
            "subagent path. No API-paid path is authorized (AR-1250 §5)."
        )

    receipt = {
        "state": NATIVE_TASK_DISPATCHED,
        "condition_ref": ref,
        "task_input_sha256": entry["task_input_sha256"],
        "queue_artifact_sha256": ledger.queue_sha256,
        "requested_model_identity": requested_model_identity,
        "invocation_path": invocation_path,
        "native_task_id": native_task_id or NOT_EXPOSED,
        "authority": "AR-1254 §4 (durable native handoff)",
        "note": "Records that a dispatch was issued. This module does not and cannot dispatch a "
                "subagent itself; this is evidence, not execution.",
    }
    DurableAttemptLedger._create_only(
        _dispatch_path(ledger, ref), receipt, what="dispatch receipt",
        extra=f"{ref!r} has already had its one native dispatch recorded.")
    return receipt


def capture_native_return(
    ledger: DurableAttemptLedger,
    ref: str,
    raw_output: str,
    completion: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist the RAW return and the immutable invocation-completion receipt (§5).

    Refuses unless a dispatch was recorded, so a raw return can never appear for a call that was
    never issued. The raw store is written first and create-only; the completion receipt carries
    the metadata and is kept out of the semantic record.
    """
    entry = ledger._entry(ref)
    st = state_of(ledger, ref)
    if st in (READY, CLAIMED):
        raise AttemptRefused(
            f"cannot capture a return for {ref!r} at state {st}: no native dispatch was recorded, "
            "so this text is not the answer to an issued call."
        )
    if st == RAW_RETURN_CAPTURED:
        raise AttemptRefused(f"{ref!r} already has a captured raw return; it is never overwritten.")

    raw_record = ledger.persist_raw_return(ref, raw_output)   # create-only, parsed=false

    supplied = dict(completion or {})
    unknown = sorted(set(supplied) - set(COMPLETION_FIELDS))
    if unknown:
        raise AttemptRefused(
            f"completion receipt for {ref!r} carries unrecognised fields {unknown}. Invocation "
            "metadata is a fixed contract so a reader can tell 'absent' from 'not asked for'."
        )
    receipt = {
        "state": RAW_RETURN_CAPTURED,
        "condition_ref": ref,
        "task_input_sha256": entry["task_input_sha256"],
        "queue_artifact_sha256": ledger.queue_sha256,
        "requested_model_identity": "opus",
        "raw_output_sha256": raw_record["raw_output_sha256"],
        "authority": "AR-1254 §5 (invocation completion metadata)",
        "telemetry_policy": (
            f"A field recorded as {NOT_EXPOSED} means the Claude Code subscription runtime does "
            "not surface it. That is a fact about the runtime, recorded as one — never an "
            "invented number, and never a reason to block on telemetry that is not on offer."
        ),
        "determinism_note": (
            "Timestamps and token counts live HERE, in evidence, and are deliberately absent "
            "from the semantic route record so identical semantic reruns stay byte-identical."
        ),
    }
    for field in COMPLETION_FIELDS:
        value = supplied.get(field)
        receipt[field] = NOT_EXPOSED if value in (None, "") else value

    DurableAttemptLedger._create_only(
        _completion_path(ledger, ref), receipt, what="completion receipt",
        extra=f"{ref!r} already has a completion receipt.")
    return receipt


def bridge_report(ledger: DurableAttemptLedger) -> dict[str, Any]:
    """The whole handoff, answerable from the directory alone."""
    states = {e["condition_ref"]: state_of(ledger, e["condition_ref"])
              for e in ledger.queue["queue"]}
    by_state: dict[str, list[str]] = {}
    for ref, st in states.items():
        by_state.setdefault(st, []).append(ref)
    return {
        "queue_artifact_sha256": ledger.queue_sha256,
        "states": states,
        "by_state": {k: sorted(v) for k, v in sorted(by_state.items())},
        "stranded_mid_handoff": sorted(
            r for r, s in states.items() if s in (CLAIMED, NATIVE_TASK_DISPATCHED)
        ),
        "complete": sorted(r for r, s in states.items() if s == RAW_RETURN_CAPTURED),
        "unstarted": sorted(r for r, s in states.items() if s == READY),
    }
