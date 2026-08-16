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

🛑 AR-1260 §B — THE CRASH SHAPE THE OLD CODE READ AS SUCCESS, AND IT WAS MINE
    The final transition writes TWO files, and the old `state_of` returned RAW_RETURN_CAPTURED on
    the strength of `.raw` alone. So a process that died between the two writes left a directory
    that read COMPLETE while carrying no completion receipt at all — the exact half-written state
    the durable ledger exists to make visible. Worse, the completion CONTRACT was validated AFTER
    `.raw` was already on disk, so an unrecognised metadata field produced that same half state as
    a matter of routine, not of crashing.

    ⇒ The contract is now checked BEFORE any file is created, and `.raw` without `.completion` is
    its own state, `STRANDED_INCOMPLETE`. It is not RAW_RETURN_CAPTURED, the finalizer refuses it,
    and no retry is automatically granted: the attempt was claimed, and a claimed attempt is spent.

    ★ `A TWO-FILE COMMIT READ THROUGH ONE OF ITS FILES IS NOT A STATE, IT IS AN ASSUMPTION.`

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

import hashlib
import json
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
    "STRANDED_INCOMPLETE",
    "RAW_RETURN_CAPTURED",
    "COMPLETION_FIELDS",
    "APPROVED_MODEL_IDENTITY",
    "record_native_dispatch",
    "capture_native_return",
    "state_of",
    "bridge_report",
]

NOT_EXPOSED = "NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME"

READY = "READY"
CLAIMED = "CLAIMED"
NATIVE_TASK_DISPATCHED = "NATIVE_TASK_DISPATCHED"
STRANDED_INCOMPLETE = "STRANDED_INCOMPLETE"
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

# AR-1259 §8 C / AR-1260 §C — the ONLY model G2-D may request. The dispatch recorder refuses
# anything else rather than recording it, because a receipt that faithfully records an
# unauthorized request is still a receipt for an unauthorized call.
APPROVED_MODEL_IDENTITY = "opus"


def _dispatch_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.dispatch.json")


def _completion_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.completion.json")


def state_of(ledger: DurableAttemptLedger, ref: str) -> str:
    """The condition's position in the handoff, read from the filesystem alone.

    AR-1260 §B: the last transition is a TWO-FILE commit, so it is read through BOTH files.
    Either one alone is `STRANDED_INCOMPLETE` — a half-written terminal state, never a complete
    one. `.completion` without `.raw` cannot be produced by this module and is therefore a
    planted or salvaged artifact; it is reported as stranded rather than silently ignored.
    """
    ledger._entry(ref)                       # refuses an out-of-queue ref
    has_raw = os.path.exists(ledger.raw_path(ref))
    has_completion = os.path.exists(_completion_path(ledger, ref))
    if has_raw and has_completion:
        return RAW_RETURN_CAPTURED
    if has_raw or has_completion:
        return STRANDED_INCOMPLETE
    if os.path.exists(_dispatch_path(ledger, ref)):
        return NATIVE_TASK_DISPATCHED
    if os.path.exists(ledger.attempt_path(ref)):
        return CLAIMED
    return READY


def record_native_dispatch(
    ledger: DurableAttemptLedger,
    ref: str,
    native_task_id: str | None = None,
    requested_model_identity: str = APPROVED_MODEL_IDENTITY,
    invocation_path: str = APPROVED_INVOCATION_PATH,
) -> dict[str, Any]:
    """Record that the ONE authorized native subagent dispatch has been issued.

    Refuses unless the durable claim already exists, and refuses a second dispatch — the claim
    is the budget, and a dispatch without one is an unbudgeted call.

    AR-1260 §C: also refuses a requested model that is not Opus. The old version accepted any
    string and wrote it into the receipt faithfully, which made the receipt an accurate record of
    an unauthorized call rather than a guard against one. Recording a violation is not preventing
    it, and the one place that can still prevent it is before the dispatch is issued.
    """
    entry = ledger._entry(ref)
    st = state_of(ledger, ref)
    if st == READY:
        raise AttemptRefused(
            f"cannot record a dispatch for {ref!r}: no durable attempt has been claimed. The "
            "claim is written BEFORE the call precisely so an unbudgeted dispatch is impossible "
            "to record after the fact."
        )
    if st in (NATIVE_TASK_DISPATCHED, RAW_RETURN_CAPTURED, STRANDED_INCOMPLETE):
        raise AttemptRefused(
            f"{ref!r} is already at state {st}. One dispatch per claim; a second is a retry."
        )
    if invocation_path != APPROVED_INVOCATION_PATH:
        raise AttemptRefused(
            f"invocation path {invocation_path!r} is not the approved Claude Code subscription "
            "subagent path. No API-paid path is authorized (AR-1250 §5)."
        )
    if requested_model_identity != APPROVED_MODEL_IDENTITY:
        raise AttemptRefused(
            f"requested model {requested_model_identity!r} is not "
            f"{APPROVED_MODEL_IDENTITY!r}. G2-D authorizes exactly one model, and a dispatch "
            "recorded for any other one is an unauthorized call with a tidy receipt beside it."
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
    never issued.

    AR-1260 §B — ORDER OF OPERATIONS IS THE WHOLE GUARD. The completion contract is validated and
    the receipt is fully built BEFORE `.raw` is created. Any refusal therefore leaves the
    directory exactly as it found it, instead of leaving a raw file with no completion beside it
    and a state that reads COMPLETE.

    AR-1260 §C — the completion receipt JOINS the dispatch receipt; it never restates Opus on its
    own authority. The old version hard-coded `"requested_model_identity": "opus"`, so a
    completion could assert a model the dispatch beside it never requested and nothing compared
    them.
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
    if st == STRANDED_INCOMPLETE:
        raise AttemptRefused(
            f"{ref!r} is STRANDED_INCOMPLETE: half of the final two-file commit is already on "
            "disk. The attempt was claimed and is spent, so this is a retry, not a resumption — "
            "no retry is automatically granted (AR-1260 §B)."
        )

    supplied = dict(completion or {})
    unknown = sorted(set(supplied) - set(COMPLETION_FIELDS))
    if unknown:
        raise AttemptRefused(
            f"completion receipt for {ref!r} carries unrecognised fields {unknown}. Invocation "
            "metadata is a fixed contract so a reader can tell 'absent' from 'not asked for'."
        )

    # §C — read back what the dispatch actually requested. This is the join, not a restatement.
    with open(_dispatch_path(ledger, ref), encoding="utf-8") as fh:
        dispatch = json.load(fh)
    dispatched_model = dispatch.get("requested_model_identity")
    dispatched_task_id = dispatch.get("native_task_id")
    completion_task_id = supplied.get("native_task_id")
    if (
        completion_task_id not in (None, "", NOT_EXPOSED)
        and dispatched_task_id not in (None, "", NOT_EXPOSED)
        and completion_task_id != dispatched_task_id
    ):
        raise AttemptRefused(
            f"native task id mismatch for {ref!r}: the dispatch recorded "
            f"{dispatched_task_id!r} and the completion claims {completion_task_id!r}. Two "
            "exposed identities that disagree describe two different calls."
        )

    raw_sha = hashlib.sha256((raw_output or "").encode("utf-8")).hexdigest()
    receipt = {
        "state": RAW_RETURN_CAPTURED,
        "condition_ref": ref,
        "task_input_sha256": entry["task_input_sha256"],
        "queue_artifact_sha256": ledger.queue_sha256,
        "requested_model_identity": dispatched_model,
        "dispatch_native_task_id": dispatched_task_id,
        "raw_output_sha256": raw_sha,
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

    # Only now, with nothing left that can refuse, is the two-file commit begun.
    raw_record = ledger.persist_raw_return(ref, raw_output)   # create-only, parsed=false
    if raw_record["raw_output_sha256"] != raw_sha:            # positive witness, not decoration
        raise AttemptRefused(
            f"the persisted raw return for {ref!r} does not hash to the value written into the "
            "completion receipt; the two halves of the commit describe different text."
        )
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
        # AR-1260 §B — reported as its OWN bucket. Folding it into either neighbour would hide
        # the distinction the state exists to draw: this one has an answer on disk and no
        # receipt proving the call it answers, which is neither "still running" nor "done".
        "stranded_incomplete": sorted(
            r for r, s in states.items() if s == STRANDED_INCOMPLETE
        ),
        "complete": sorted(r for r, s in states.items() if s == RAW_RETURN_CAPTURED),
        "unstarted": sorted(r for r, s in states.items() if s == READY),
    }
