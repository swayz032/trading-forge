"""H1/H2 battery TRIAL COUNTER (ratify
`docs/designs/h1-wave1-instrumentation-trial-counter-passage-ledger-2026-07-18.md`,
RATIFIED R-042 pin 1).

THE ONE THING: the corpus-wide denominator the luck-correction (DSR / PBO / BIF)
consumes. The anti-luck math dies of LEAKED trials, so EVERY battery run — pass,
fail, re-run, shakedown, crashed-mid-run — is counted. It is ONE ARTIFACT
FOREVER (never re-created; every future wave appends to the same file, the
`wave` field distinguishes), never a memory or a recomputed-on-the-fly number.

R-042 pin 1 — the leak-closing mechanism, both directions:
  * `allocate(...)` PERSISTS a trial_id AT DISPATCH, BEFORE execution, with the
    row's outcome defaulted to ABORTED. A run that never got a persisted id
    never ran (no phantom trials); a crash mid-run leaves the ABORTED row in
    place (the crash WAS a trial — it is counted). This implements the
    resume-dedup invariant mechanically: on resume, the runner re-dispatches
    only rows still ABORTED, each getting a NEW dense id; the crashed row stays.
  * `finalize(trial_id, outcome, ...)` overwrites ONLY that row's outcome after
    execution completes. Never mutates any other row; never re-allocates.

Determinism/replay note: this module reads the wall clock ONLY for the
`dispatched_at`/`finalized_at`/`zero_point` stamps (audit metadata, never an
input to any statistic) — so it is exempt from the no-wall-clock engine
contract, exactly as an audit_log writer is. It performs FILE I/O (that is its
purpose — a persistent artifact) via an atomic write-temp-rename, so a crash
never leaves a half-written counter.

Single-writer contract: the battery runner is the sole writer (1m specs run
SOLO, heterogeneous queues partition by weight — extraction-campaign battery
law). Concurrency beyond that is out of scope; a file lock is NOT provided here
because the ratified ops model is single-writer-per-wave.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# The one artifact, forever (R-042 pin 1). Default path; a caller may override
# for tests. NEVER create a second counter file for a new wave.
DEFAULT_PATH = os.path.join("docs", "replay-results", "h1-battery", "trial-counter.json")

OUTCOME_ABORTED = "ABORTED"  # the DISPATCH-time default; a crash leaves this
_VALID_OUTCOMES = {"PASS", "FAIL", "REJECTED", "INDETERMINATE", OUTCOME_ABORTED}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: str, obj: dict) -> None:
    """Write-temp-rename so a crash never leaves a half-written counter."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)  # atomic on the same filesystem
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


class TrialCounter:
    """Append-only, one-file-forever battery trial counter (R-042 pin 1)."""

    def __init__(self, path: str = DEFAULT_PATH, *, engine_sha_at_zero: Optional[str] = None) -> None:
        self.path = path
        self._doc = self._load_or_create(engine_sha_at_zero)

    # ------------------------------------------------------------------ #
    def _load_or_create(self, engine_sha_at_zero: Optional[str]) -> dict:
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as fh:
                doc = json.load(fh)
            # the file is authoritative; NEVER re-stamp zero_point on load
            # (one artifact forever — re-stamping would erase the from-zero
            # provenance the luck-math depends on).
            return doc
        # First creation only — stamp the zero point ONCE.
        return {
            "artifact": "h1-trial-counter",
            "zero_point": _now_iso(),
            "engine_sha_at_zero": engine_sha_at_zero,
            "total_trials": 0,
            "runs": [],
        }

    def _persist(self) -> None:
        # total_trials is DERIVED from the rows — never tracked separately, so
        # it cannot drift from len(runs) (the invariant is structural).
        self._doc["total_trials"] = len(self._doc["runs"])
        _atomic_write(self.path, self._doc)

    def _next_id(self) -> int:
        # Dense + monotonic: max(existing)+1, robust to any row ordering.
        return (max((r["trial_id"] for r in self._doc["runs"]), default=0)) + 1

    # ------------------------------------------------------------------ #
    def allocate(
        self,
        *,
        wave: str,
        strategy_ref: str,
        spec_hash: str,
        engine_sha: str,
        binding_approximation_rate: float,
        survivor_eligible: bool = False,
        run_epoch: Optional[Dict[str, Any]] = None,
        scope_line: Optional[str] = None,
    ) -> int:
        """Persist a NEW trial row AT DISPATCH, outcome defaulted to ABORTED, and
        return its dense trial_id. Call this BEFORE executing the backtest. If
        the process dies before `finalize`, the row honestly stays ABORTED — the
        crash was a trial, and it is counted (no leak). `binding_approximation_
        rate` is REQUIRED on every trial (the measured optimistic-bias scope
        travels with the number, R-040 pin 2iii / R-042 pin 3)."""
        trial_id = self._next_id()
        # Scope line interpolates the MEASURED per-spec rate (R-042 pin 3), never
        # a blanket ≈0.99, unless the caller supplied its own.
        if scope_line is None:
            scope_line = (
                f"shakedown; binding-approx {binding_approximation_rate}; "
                f"framework-behavior measurement, NOT edge evidence"
            )
        self._doc["runs"].append({
            "trial_id": trial_id,
            "wave": wave,
            "strategy_ref": strategy_ref,
            "spec_hash": spec_hash,
            "engine_sha": engine_sha,
            "outcome": OUTCOME_ABORTED,   # dispatch-time default; a crash leaves this
            "abort_signature": None,
            "binding_approximation_rate": binding_approximation_rate,
            "survivor_eligible": bool(survivor_eligible),
            "scope_line": scope_line,
            "run_epoch": run_epoch or {},
            "dispatched_at": _now_iso(),
            "finalized_at": None,
        })
        self._persist()
        return trial_id

    def finalize(self, trial_id: int, outcome: str, *, abort_signature: Optional[str] = None) -> None:
        """Record the real outcome after execution. Overwrites ONLY this row's
        outcome/abort_signature; never touches another row, never re-allocates."""
        if outcome not in _VALID_OUTCOMES:
            raise ValueError(f"invalid outcome {outcome!r}; must be one of {sorted(_VALID_OUTCOMES)}")
        for row in self._doc["runs"]:
            if row["trial_id"] == trial_id:
                row["outcome"] = outcome
                row["abort_signature"] = abort_signature
                row["finalized_at"] = _now_iso()
                self._persist()
                return
        raise KeyError(f"trial_id {trial_id} not found — finalize without a prior allocate is a leak")

    # ------------------------------------------------------------------ #
    @property
    def total_trials(self) -> int:
        return len(self._doc["runs"])

    def outcomes(self) -> Dict[str, int]:
        hist: Dict[str, int] = {}
        for r in self._doc["runs"]:
            hist[r["outcome"]] = hist.get(r["outcome"], 0) + 1
        return hist

    def unfinalized_ids(self) -> List[int]:
        """Rows still ABORTED with no finalized_at — the resume set (the runner
        re-dispatches these; each gets a NEW id, this crashed row stays)."""
        return [r["trial_id"] for r in self._doc["runs"]
                if r["outcome"] == OUTCOME_ABORTED and r["finalized_at"] is None]
