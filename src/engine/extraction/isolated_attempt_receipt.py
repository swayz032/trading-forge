"""DURABLE ONE-SHOT ATTEMPT RECEIPTS — AR-1249 §5 (D0.1).

WHY THIS EXISTS, AND WHY THE IN-MEMORY LEDGER WAS NOT ENOUGH
    `isolated_fallback_law.record_attempt` enforces one attempt per condition inside a single
    process. AR-1249 F-3 showed that is not the guarantee a retry ban actually needs:

        process A: freeze queue -> record_attempt(ref) -> call disappoints / process crashes
        process B: reload queue -> attempts == {} -> record_attempt(ref) succeeds AGAIN

    A restart was therefore a retry channel, and the committed queue artifact proved it by
    carrying `"attempts": {}`. I had reported that ban as "closed at the ledger"; it was closed
    only in session memory. This module moves the claim onto the filesystem, where the crash it
    must survive cannot erase it.

THE MECHANISM IS CREATE-ONLY, NOT CHECK-THEN-WRITE
    `os.O_CREAT | os.O_EXCL` fails if the path exists, atomically, in the kernel. A
    `if not exists(): write()` sequence has a window between the two halves and would hand back
    the double-attempt on a race. The receipt is written ONCE and never rewritten: there is no
    code path in this module that opens an existing receipt for writing.

FAIL CLOSED ON A CRASH-SHAPED RECEIPT
    A receipt with no result beside it means a call was claimed and its outcome is unknown —
    possibly delivered, possibly not. That is exactly when a retry is most tempting and least
    defensible, so it is refused. An attempt claimed is an attempt spent (§5.7).

Generic by construction: no strategy, instrument, video id or teacher string.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from typing import Any

__all__ = [
    "ATTEMPT_CLAIMED",
    "AttemptRefused",
    "DurableAttemptLedger",
]

ATTEMPT_CLAIMED = "ATTEMPT_CLAIMED_BEFORE_INVOCATION"

# §5.3 — a real run needs concrete identities, not merely a non-empty dict.
_REQUIRED_PINNED = ("transcript_sha256", "extraction_sha256")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class AttemptRefused(RuntimeError):
    """Raised whenever an attempt or a result write is refused. Never caught internally —
    a refusal that this module swallowed would be indistinguishable from a permission."""


def _sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _safe_name(condition_ref: str) -> str:
    """A filesystem-safe, collision-free name for a condition ref.

    The ref is kept readable for a human reading the directory, but the SHA suffix is what makes
    two different refs impossible to collapse onto one receipt — `entry_sequence[1].action` and
    `entry_sequence_1_.action` must not share a budget.
    """
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", condition_ref)[:60]
    return f"{slug}.{hashlib.sha256(condition_ref.encode('utf-8')).hexdigest()[:12]}"


@dataclass(frozen=True)
class DurableAttemptLedger:
    """One-shot attempt accounting bound to ONE committed queue artifact.

    `receipt_dir` holds `<ref>.attempt.json` and `<ref>.raw.json`. Their EXISTENCE is the
    ledger; nothing is ever deleted or rewritten.
    """

    receipt_dir: str
    queue_path: str
    queue: dict
    queue_sha256: str

    # ---- construction -------------------------------------------------- #

    @classmethod
    def load(cls, queue_path: str, receipt_dir: str) -> DurableAttemptLedger:
        """Load the ALREADY-COMMITTED queue artifact. This never derives or regenerates a queue
        (AR-1249 §5.1 / §6: the committed queue is the authority)."""
        with open(queue_path, "rb") as fh:
            raw = fh.read()
        queue = json.loads(raw.decode("utf-8"))
        cls._verify_queue(queue, queue_path)
        os.makedirs(receipt_dir, exist_ok=True)
        return cls(receipt_dir, queue_path, queue, _sha_bytes(raw))

    @staticmethod
    def _verify_queue(queue: dict, path: str) -> None:
        from .isolated_fallback_law import FALLBACK_LAW_VERSION, SUBSTITUTION_RULE

        if queue.get("law_version") != FALLBACK_LAW_VERSION:
            raise AttemptRefused(
                f"queue {path} was frozen under law_version {queue.get('law_version')!r} but this "
                f"runner is {FALLBACK_LAW_VERSION!r}. A queue and a law that disagree cannot both "
                "describe the run about to happen."
            )
        expected_rule = hashlib.sha256(SUBSTITUTION_RULE.encode("utf-8")).hexdigest()
        if queue.get("substitution_rule_sha256") != expected_rule:
            raise AttemptRefused(
                "the substitution rule has CHANGED since this queue was frozen. The rule is "
                "declared before outputs exist precisely so it cannot be edited once answers are "
                "visible; refusing rather than running under a rule the queue never agreed to."
            )
        if not queue.get("input_route_version"):
            raise AttemptRefused(f"queue {path} names no input_route_version.")
        pinned = queue.get("pinned_inputs") or {}
        for key in _REQUIRED_PINNED:
            val = str(pinned.get(key, ""))
            if not _HEX64.match(val):
                raise AttemptRefused(
                    f"queue {path} has no concrete {key} (got {val!r}). A real isolated run must "
                    "be pinned to a 64-hex source identity; an arbitrary non-empty value is not "
                    "identity and would make two different runs look comparable."
                )
        if not queue.get("queue"):
            raise AttemptRefused(f"queue {path} has an empty queue; there is nothing to attempt.")

    # ---- paths --------------------------------------------------------- #

    def _entry(self, condition_ref: str) -> dict:
        for e in self.queue["queue"]:
            if e["condition_ref"] == condition_ref:
                return e
        raise AttemptRefused(
            f"{condition_ref!r} is not in the committed queue {self.queue_path}. Only conditions "
            "the deterministic route selected may be attempted; adding one here would be the "
            "hand-picked list the selection law exists to prevent."
        )

    def attempt_path(self, condition_ref: str) -> str:
        return os.path.join(self.receipt_dir, f"{_safe_name(condition_ref)}.attempt.json")

    def raw_path(self, condition_ref: str) -> str:
        return os.path.join(self.receipt_dir, f"{_safe_name(condition_ref)}.raw.json")

    # ---- the one-shot claim -------------------------------------------- #

    def claim_attempt(
        self,
        condition_ref: str,
        task_input_sha256: str,
        model_identity: str = "opus",
        invocation_path: str = "fresh Claude Code subscription subagent",
    ) -> dict:
        """Atomically claim the single permitted attempt, BEFORE the model is invoked.

        Refuses if a receipt already exists — including one written by a previous process, which
        is the whole point (§5.6). Raises `AttemptRefused` rather than returning a status, so a
        caller that ignores the result cannot proceed to dispatch by accident.
        """
        entry = self._entry(condition_ref)
        if task_input_sha256 != entry["task_input_sha256"]:
            raise AttemptRefused(
                f"task input hash mismatch for {condition_ref!r}: caller offered "
                f"{task_input_sha256!r}, the committed queue pins {entry['task_input_sha256']!r}. "
                "The task would not be the one the queue froze."
            )

        receipt = {
            "status": ATTEMPT_CLAIMED,
            "attempt_number": 1,
            "condition_ref": condition_ref,
            "task_input_sha256": entry["task_input_sha256"],
            "disposition_that_earned_escalation": entry["disposition"],
            "queue_artifact_path": os.path.basename(self.queue_path),
            "queue_artifact_sha256": self.queue_sha256,
            "law_version": self.queue["law_version"],
            "input_route_version": self.queue["input_route_version"],
            "substitution_rule_sha256": self.queue["substitution_rule_sha256"],
            "pinned_inputs": self.queue["pinned_inputs"],
            "requested_model_identity": model_identity,
            "invocation_path": invocation_path,
            "authority": "AR-1249 §5 (durable pre-call one-shot receipt)",
        }
        self._create_only(self.attempt_path(condition_ref), receipt, what="attempt receipt",
                          extra=(
                              f"{condition_ref!r} has already spent its one permitted isolated "
                              "attempt. A process restart is NOT a retry channel: an attempt "
                              "claimed is an attempt spent, and a worse first answer is an "
                              "allowed outcome that leaves the condition RED."
                          ))
        return receipt

    def persist_raw_return(self, condition_ref: str, raw_output: str) -> dict:
        """Store the model's RAW return before anything parses, shortens or scores it (§5.8)."""
        attempt_path = self.attempt_path(condition_ref)
        if not os.path.exists(attempt_path):
            raise AttemptRefused(
                f"no durable attempt receipt exists for {condition_ref!r}, so this answer was "
                "produced by a call that never claimed its budget. The claim is written before "
                "the call so a disappointing answer cannot be discarded and retried."
            )
        record = {
            "condition_ref": condition_ref,
            "raw_output": raw_output,
            "raw_output_sha256": hashlib.sha256((raw_output or "").encode("utf-8")).hexdigest(),
            "queue_artifact_sha256": self.queue_sha256,
            "parsed": False,
            "note": "RAW, PRE-PARSE. Literal verification, relevance, composition and fidelity "
                    "all run downstream of this file and never mutate it.",
        }
        self._create_only(self.raw_path(condition_ref), record, what="raw return",
                          extra=(
                              f"a raw isolated return is already stored for {condition_ref!r}; "
                              "overwriting it would erase the evidence the fallback exists to "
                              "preserve."
                          ))
        return record

    # ---- the atomic primitive ------------------------------------------ #

    @staticmethod
    def _create_only(path: str, payload: dict[str, Any], what: str, extra: str) -> None:
        """Create-or-fail. `O_EXCL` is atomic in the kernel; a check-then-write would leave a
        window in which two processes both believe they are first."""
        data = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise AttemptRefused(f"REFUSED — a {what} already exists at {path}. {extra}") from None
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)

    # ---- read-only introspection --------------------------------------- #

    def claimed_refs(self) -> list[str]:
        return sorted(
            e["condition_ref"] for e in self.queue["queue"]
            if os.path.exists(self.attempt_path(e["condition_ref"]))
        )

    def unclaimed_refs(self) -> list[str]:
        return sorted(
            e["condition_ref"] for e in self.queue["queue"]
            if not os.path.exists(self.attempt_path(e["condition_ref"]))
        )

    def crash_shaped_refs(self) -> list[str]:
        """Claimed, but no raw return stored — a call whose outcome is unknown. Reported, never
        auto-retried: this is precisely the state a retry ban has to survive."""
        return sorted(
            r for r in self.claimed_refs() if not os.path.exists(self.raw_path(r))
        )
