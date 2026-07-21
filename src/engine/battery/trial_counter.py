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
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
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
        dataset_hash: Optional[str] = None,
        config_hash: Optional[str] = None,
    ) -> int:
        """Persist a NEW trial row AT DISPATCH, outcome defaulted to ABORTED, and
        return its dense trial_id. Call this BEFORE executing the backtest. If
        the process dies before `finalize`, the row honestly stays ABORTED — the
        crash was a trial, and it is counted (no leak). `binding_approximation_
        rate` is REQUIRED on every trial (the measured optimistic-bias scope
        travels with the number, R-040 pin 2iii / R-042 pin 3).

        `dataset_hash` (the bar data the trial ran on) and `config_hash` (the
        experiment config: window, embargo, mode, floor) complete the EFFECTIVE-N
        dedup tuple (R-048 §3): `effective_n()` collapses identical deterministic
        replicates on `(spec_hash × engine_sha × dataset_hash × config_hash)` so a
        re-run of the same experiment counts ONCE in the luck-math denominator —
        the double-count is solved by construction, never by deleting a row."""
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
            # EFFECTIVE-N dedup tuple components (R-048 §3); None on legacy rows,
            # which read as a valid (present-but-null) tuple slot.
            "dataset_hash": dataset_hash,
            "config_hash": config_hash,
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
    def annotate_superseded(
        self,
        *,
        wave: str,
        by: str,
        strategy_ref: Optional[str] = None,
        predicate=None,
        backfill_dataset_hash: Optional[str] = None,
        backfill_config_hash: Optional[str] = None,
    ) -> int:
        """R-048 §3: mark the rows of a defective audit as `SUPERSEDED_BY_REMAP`
        WITHOUT deleting them (append-only is absolute). Adds a
        `superseded_by_remap` provenance field ({by, at}) to every matching row;
        never removes a row, never re-ids, never changes an outcome or the trial
        count. Returns the number of rows annotated. Idempotent.

        `predicate(row) -> bool` optionally narrows further; else all rows of
        `wave` (and `strategy_ref` if given) match.

        BACKFILL (R-048 §3 — the double-count solution): rows allocated BEFORE the
        dedup-tuple fields existed carry null `dataset_hash`/`config_hash`, so they
        would NOT collapse with their corrected re-run in `effective_n` — leaving
        the double-count unsolved. When the caller passes the experiment's TRUE
        (disk-derived) `backfill_dataset_hash`/`backfill_config_hash`, they are
        written to matched rows ONLY WHERE CURRENTLY NULL — completing the
        provenance of what the run actually was (the buggy run ran the identical
        spec×engine×data×config), never overwriting a recorded identity. Then the
        buggy row and its corrected replicate share the tuple and collapse to ONE
        by PURE computation — `effective_n` never reads this annotation, so the
        statistic is computed, never curated (R-048: 'no one ever needs to delete
        anything to keep the stats right')."""
        n = 0
        for row in self._doc["runs"]:
            if row["wave"] != wave:
                continue
            if strategy_ref is not None and row["strategy_ref"] != strategy_ref:
                continue
            if predicate is not None and not predicate(row):
                continue
            row["superseded_by_remap"] = {"by": by, "at": _now_iso()}
            if backfill_dataset_hash is not None and row.get("dataset_hash") is None:
                row["dataset_hash"] = backfill_dataset_hash
            if backfill_config_hash is not None and row.get("config_hash") is None:
                row["config_hash"] = backfill_config_hash
            n += 1
        if n:
            self._persist()
        return n

    @staticmethod
    def _dedup_key(row: dict) -> tuple:
        """The EFFECTIVE-N collapse tuple (R-048 §3). Identical deterministic
        replicates share it; genuinely different runs (different data, config,
        engine, or spec) differ on at least one component.

        R-048 grader F-2: a row with an INCOMPLETE tuple (null dataset_hash or
        config_hash — a legacy row that was never backfilled) must NEVER collapse
        with another such row: two null-null rows are NOT provably the same
        experiment, and a false collapse would UNDER-count the luck-math
        denominator (the unsafe direction). So an incomplete row gets a UNIQUE key
        (its trial_id) — it stays its own group, counted conservatively, and
        `effective_n` surfaces the incomplete count so it is never silent. Collapse
        is opt-in: only a fully-stamped tuple may dedup."""
        ds, cfg = row.get("dataset_hash"), row.get("config_hash")
        if ds is None or cfg is None:
            return ("__incomplete_tuple__", row.get("trial_id"))
        return (row.get("spec_hash"), row.get("engine_sha"), ds, cfg)

    def effective_n(self, *, wave: Optional[str] = None) -> Dict[str, Any]:
        """R-048 §3: the denominator the luck-math (DSR/PBO/BIF) actually consumes.
        `raw_n` counts every appended trial (nothing is ever deleted); `effective_n`
        collapses identical deterministic replicates on
        `(spec_hash × engine_sha × dataset_hash × config_hash)` so a re-run of the
        same experiment — the buggy WAVE-1R vs its remap re-run — counts ONCE.
        `groups` lists each tuple with its replicate count (>1 = a collapsed
        re-run). Statistical honesty is COMPUTED here, never curated by deletion.

        A trial is a real statistical draw only if it EXECUTED — ABORTED rows
        (dispatch-time default, crashes) are counted in `raw_n` (no leak) but
        excluded from the effective denominator (a crash is not a draw)."""
        rows = [r for r in self._doc["runs"] if wave is None or r["wave"] == wave]
        raw_n = len(rows)
        executed = [r for r in rows if r["outcome"] != OUTCOME_ABORTED]
        groups: Dict[tuple, int] = {}
        incomplete_n = 0
        for r in executed:
            k = self._dedup_key(r)
            if k[0] == "__incomplete_tuple__":
                incomplete_n += 1  # never collapses (F-2); counted conservatively
            groups[k] = groups.get(k, 0) + 1
        return {
            "raw_n": raw_n,
            "executed_n": len(executed),
            "aborted_n": raw_n - len(executed),
            "effective_n": len(groups),
            "collapsed_replicates": sum(v - 1 for v in groups.values()),
            # R-048 grader F-2: executed rows with a null dedup slot — each stays
            # its own group (no false collapse). Non-zero = a wave entered the
            # denominator without a complete tuple; backfill it before trusting
            # the luck-math on it. Surfaced, never silent.
            "incomplete_tuple_n": incomplete_n,
            "groups": [
                {"spec_hash": k[0], "engine_sha": k[1], "dataset_hash": k[2],
                 "config_hash": k[3], "replicates": v}
                if k[0] != "__incomplete_tuple__"
                else {"incomplete_tuple": True, "trial_id": k[1], "replicates": v}
                for k, v in groups.items()
            ],
            "dedup_tuple": "(spec_hash × engine_sha × dataset_hash × config_hash)",
        }

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
