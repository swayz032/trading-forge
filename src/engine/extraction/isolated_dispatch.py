"""D1 — the smallest dispatch-side adapter: claim -> dispatch -> raw persist (AR-1252 §5).

WHAT THIS IS NOT
    Not another orchestration framework (AR-1252 §5.6: *"do not build another orchestration
    framework"*). It owns exactly one thing: the ORDER. The durable claim, the queue identity
    and the create-only raw store all already live in `isolated_attempt_receipt`; this module
    makes it impossible to reach the model without having spent the claim first.

WHY THE ORDER NEEDS ITS OWN OBJECT
    Every piece of the guarantee already existed and could still be assembled wrongly by a
    caller that invoked first and recorded afterwards — which is the retry loop with extra
    steps, because a call whose claim was never written can be repeated. So the invocation is
    not something a caller performs and then reports; it is something this adapter performs,
    strictly after the claim returns.

THE MODEL CALL IS INJECTED, NOT PERFORMED HERE
    `invoke` is supplied by the caller. That keeps this module runnable and testable with no
    model, no network and no subagent — and it is why D1 is deterministic work that can be
    finished and proven while the live-session dispatch authorization is still outstanding.
    The real invoker is wired in at the driver, where the subagent actually exists.

FAIL CLOSED IN BOTH DIRECTIONS
    A refused claim never reaches `invoke`. An invocation that raises still leaves the attempt
    SPENT — the receipt is already on disk and this module does not remove it — because a call
    that may have been delivered must not be repeatable (AR-1249 §5.7).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .isolated_attempt_receipt import DurableAttemptLedger

__all__ = ["DispatchOutcome", "IsolatedDispatcher", "preflight_real_queue"]


class Invoker(Protocol):
    """The real implementation dispatches ONE fresh Claude Code Opus subagent and returns its
    raw text. It is given only the frozen condition contract — never the batch answer, never a
    prior winning quote, never an expected answer."""

    def __call__(self, condition_ref: str, condition_text: str, task_input_sha256: str) -> str:
        ...


@dataclass(frozen=True)
class DispatchOutcome:
    condition_ref: str
    claimed: bool
    invoked: bool
    persisted: bool
    raw_output_sha256: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class IsolatedDispatcher:
    ledger: DurableAttemptLedger
    invoke: Invoker

    def run_one(self, condition_ref: str) -> DispatchOutcome:
        """claim -> dispatch -> raw persist, in that order, with no way around it."""
        entry = self.ledger._entry(condition_ref)   # raises for an out-of-queue ref

        # 1. CLAIM. If this raises, `self.invoke` is never reached — that is the property D1
        #    exists to make mechanical rather than conventional.
        self.ledger.claim_attempt(condition_ref, entry["task_input_sha256"])

        # 2. DISPATCH. From here the attempt is SPENT whatever happens.
        try:
            raw = self.invoke(
                condition_ref=condition_ref,
                condition_text=entry["condition_text"],
                task_input_sha256=entry["task_input_sha256"],
            )
        except Exception as exc:                     # noqa: BLE001 - re-raising would hide the spend
            return DispatchOutcome(
                condition_ref, claimed=True, invoked=True, persisted=False,
                error=(
                    f"{type(exc).__name__}: {exc}. The attempt is SPENT — the receipt is on disk "
                    "and is not removed, because a call that may have been delivered must not be "
                    "repeatable. This condition stays unresolved."
                ),
            )

        if raw is None or not str(raw).strip():
            return DispatchOutcome(
                condition_ref, claimed=True, invoked=True, persisted=False,
                error=(
                    "the isolated invoker returned nothing. An empty return is not evidence and "
                    "is not a reason to retry; the attempt is spent and the condition stays "
                    "unresolved."
                ),
            )

        # 3. PERSIST RAW, create-only, before anything parses or scores it.
        rec = self.ledger.persist_raw_return(condition_ref, raw)
        return DispatchOutcome(
            condition_ref, claimed=True, invoked=True, persisted=True,
            raw_output_sha256=rec["raw_output_sha256"],
        )


def preflight_real_queue(queue_path: str, receipt_dir: str) -> dict:
    """AR-1252 §5 D1.1-D1.5 — READ ONLY. Claims nothing.

    Answers, against the REAL committed artifact and the REAL receipt directory the run will
    use: does the queue still verify, is it still 8 unresolved / 4 excluded, is every ref still
    unclaimed, and are there any crash-shaped receipts left over from an earlier run?
    """
    ledger = DurableAttemptLedger.load(queue_path, receipt_dir)   # raises on identity drift
    queued = [e["condition_ref"] for e in ledger.queue["queue"]]
    excluded = [e["condition_ref"] for e in ledger.queue.get("excluded", [])]
    claimed = ledger.claimed_refs()
    report = {
        "queue_path": queue_path,
        "receipt_dir": receipt_dir,
        "queue_artifact_sha256": ledger.queue_sha256,
        "law_version": ledger.queue["law_version"],
        "input_route_version": ledger.queue["input_route_version"],
        "pinned_inputs": ledger.queue["pinned_inputs"],
        "queued_count": len(queued),
        "excluded_count": len(excluded),
        "queued_refs": queued,
        "excluded_refs": excluded,
        "claimed_refs": claimed,
        "unclaimed_refs": ledger.unclaimed_refs(),
        "crash_shaped_refs": ledger.crash_shaped_refs(),
        "ready_for_dispatch": (
            len(queued) == 8 and len(excluded) == 4 and not claimed
        ),
        "attempts_claimed_by_this_preflight": 0,
    }
    return report
