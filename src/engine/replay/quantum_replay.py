"""Quantum IAE replay-grading harness — Python compute leaf.

Runs quantum Iterative Amplitude Estimation (IAE) against historical backtest
daily_pnls from monte_carlo_runs, producing per-(backtest, fold, event_type)
challenger evidence rows in quantum_mc_runs with replay_mode=True.

Challenger governance contract:
  - ALL outputs carry experimental=True, authoritative=False
  - NO direct write authority; writes only when --apply is passed
  - NO cloud QPU invocation (backend hardcoded to "aer" for local Aer simulator)
  - IAE circuit capped at 10 qubits (plan risk #2)
  - Disagreement is logged, never suppressed

DB access:
  - Reads: delegated to src.engine.replay.db_loader (P1.A2 owns)
  - Writes: via db_loader.write_replay_row() under --apply only

Usage:
    python -m src.engine.replay.quantum_replay --backtest-id <uuid> [--apply] [--seed 42]
    python -m src.engine.replay.quantum_replay --all [--apply] [--limit 10] [--seed 42] [--verbose]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import subprocess
import sys
import time
from typing import Optional

from pydantic import BaseModel, Field

from src.engine.quantum_mc import (
    _compute_classical_probability,
    run_quantum_breach_estimation,
    run_quantum_ruin_estimation,
)
from src.engine.quantum_models import UncertaintyModel, build_empirical_binned_distribution

# ── DB loader import (P1.A2 owns the real implementation) ─────────────────────
# If db_loader is not yet available (parallel-track race), stub functions with
# matching signatures so this module compiles cleanly. P1.A2 replaces stubs.
try:
    from src.engine.replay import db_loader as _db_loader  # type: ignore[import]
    _DB_LOADER_AVAILABLE = True
except ImportError:
    _DB_LOADER_AVAILABLE = False
    _db_loader = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
SCHEMA_VERSION = "v1_challenger"
DEFAULT_SEED = 42
MAX_IAE_QUBITS = 10  # Plan risk #2: cap at 10 qubits for Aer local runs
_BACKEND = "aer"  # Explicit: never default to IBM cloud in replay mode
_EVENT_TYPES = ("breach", "ruin")  # Replay runs both; extend in Pass 2 if needed

# Disagreement threshold for flag: |quantum - classical| / max(classical, 1e-6)
_DISAGREEMENT_FLAG_THRESHOLD = 0.10


# ── Stubs for db_loader when P1.A2 has not landed yet ─────────────────────────
# These stubs have identical signatures to P1.A2's real implementation.
# They allow tests to mock at module level without import errors.

def _stub_load_backtest_ids(limit: Optional[int] = None) -> list[str]:  # noqa: ARG001
    """Stub: P1.A2 will replace with real DB query."""
    return []


def _stub_load_daily_pnls(backtest_id: str) -> Optional[list[float]]:  # noqa: ARG001
    """Stub: P1.A2 will replace. Returns daily_pnls list or None if missing."""
    return None


def _stub_load_classical_ruin(backtest_id: str) -> Optional[float]:  # noqa: ARG001
    """Stub: P1.A2 will replace. Returns stored probability_of_ruin or None."""
    return None


def _stub_load_walk_forward_windows(backtest_id: str) -> list[dict]:  # noqa: ARG001
    """Stub: P1.A2 will replace. Returns list of {id, window_index, is_start, is_end}."""
    return []


def _stub_write_replay_row(row: dict) -> None:  # noqa: ARG001
    """Stub: P1.A2 will replace. Inserts row into quantum_mc_runs."""
    return None


def _stub_load_strategy_id(backtest_id: str) -> Optional[str]:  # noqa: ARG001
    """Stub: P1.A2 will replace. Returns strategy_id for a given backtest."""
    return None


def _get_db_fn(fn_name: str):
    """Return db_loader function if available, else the stub with same name."""
    if _DB_LOADER_AVAILABLE and hasattr(_db_loader, fn_name):
        return getattr(_db_loader, fn_name)
    stub_name = f"_stub_{fn_name}"
    g = globals()
    if stub_name in g:
        return g[stub_name]
    raise AttributeError(f"No stub found for db_loader.{fn_name}")


# ── Output Model ──────────────────────────────────────────────────────────────

class ReplayResult(BaseModel):
    """Challenger evidence row produced by one IAE replay run.

    schema_version is always "v1_challenger" (no authoritative variant exists).
    governance_labels always carry experimental=True, authoritative=False.
    """
    backtest_id: str
    fold_id: Optional[str] = None  # walk_forward_windows.id; None = no WF windows
    event_type: str  # breach | ruin
    quantum_estimate: Optional[float] = None  # None when status=failed
    classical_estimate: Optional[float] = None  # From _compute_classical_probability
    stored_classical_ruin: Optional[float] = None  # From monte_carlo_runs.probability_of_ruin
    disagreement: Optional[float] = None  # |quantum - stored_classical_ruin| / max(stored, 1e-6)
    disagreement_flagged: bool = False  # True when disagreement >= _DISAGREEMENT_FLAG_THRESHOLD
    reproducibility_hash: str = ""
    schema_version: str = SCHEMA_VERSION
    governance_labels: dict = Field(default_factory=lambda: {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
        "replay_mode": True,
        "cpcv_fold": None,
        "fold_phase": "is",
    })
    status: str = "completed"  # completed | failed | skipped_no_data | skipped_no_model
    failure_reason: Optional[str] = None
    backend_used: str = _BACKEND
    execution_time_ms: int = 0
    num_qubits: int = 0
    raw_result: dict = Field(default_factory=dict)


# ── Reproducibility hash ───────────────────────────────────────────────────────

def _compute_quantum_mc_git_sha() -> str:
    """Return git SHA of quantum_mc.py for reproducibility hash inclusion.

    If git is unavailable, returns 'unknown' — callers must note this degrades
    cross-run hash comparability but does not break correctness.
    """
    try:
        quantum_mc_path = os.path.join(
            os.path.dirname(__file__), "..", "quantum_mc.py"
        )
        result = subprocess.run(
            ["git", "hash-object", os.path.abspath(quantum_mc_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    return "unknown"


def compute_reproducibility_hash(
    strategy_id: Optional[str],
    fold_id: Optional[str],
    seed: int,
    event_type: str,
    quantum_mc_git_sha: str,
) -> str:
    """SHA-256 hash of run identity for cross-run comparison.

    Changing quantum_mc.py changes the hash — replay rows are then clearly
    attributable to a different code version. Same inputs + same SHA = same hash.
    """
    payload = json.dumps({
        "strategy_id": strategy_id or "",
        "fold_id": fold_id or "",
        "seed": seed,
        "event_type": event_type,
        "quantum_mc_git_sha": quantum_mc_git_sha,
    }, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


# ── Core replay logic ─────────────────────────────────────────────────────────

def _run_single_replay(
    backtest_id: str,
    daily_pnls: list[float],
    stored_classical_ruin: Optional[float],
    strategy_id: Optional[str],
    fold_id: Optional[str],
    wf_window_id: Optional[str],
    event_type: str,
    seed: int,
    quantum_mc_git_sha: str,
) -> ReplayResult:
    """Run one IAE replay for a single (backtest, fold, event_type) tuple.

    Authority boundary: this function calls quantum_mc.py pure functions only.
    It NEVER writes to the database — that is the caller's responsibility.

    IAE is capped at MAX_IAE_QUBITS (10) per plan risk #2.
    Backend is always "aer" (local Aer simulator) — no cloud invocation.
    Failure is caught and returned as status="failed" — never raises to caller.
    """
    repro_hash = compute_reproducibility_hash(
        strategy_id, fold_id, seed, event_type, quantum_mc_git_sha
    )

    governance: dict = {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
        "replay_mode": True,
        "cpcv_fold": wf_window_id,
        "fold_phase": "is",
    }

    start_ms = int(time.time() * 1000)

    if not daily_pnls or len(daily_pnls) < 2:
        return ReplayResult(
            backtest_id=backtest_id,
            fold_id=fold_id,
            event_type=event_type,
            reproducibility_hash=repro_hash,
            governance_labels=governance,
            status="skipped_no_data",
            failure_reason="daily_pnls empty or too short for model fitting",
        )

    try:
        import numpy as np  # noqa: PLC0415

        pnl_array = np.array(daily_pnls, dtype=float)

        # Build UncertaintyModel from daily P&L
        model = build_empirical_binned_distribution(pnl_array)

        # Enforce qubit cap: clip n_bins so log2(n_bins) <= MAX_IAE_QUBITS
        import math  # noqa: PLC0415
        max_bins = 2 ** MAX_IAE_QUBITS
        if len(model.bins or []) > max_bins + 1:
            # Re-fit with capped bin count
            model = build_empirical_binned_distribution(pnl_array, n_bins=max_bins)
            logger.debug(
                "quantum_replay: capped bins to %d (qubit limit %d) for backtest=%s",
                max_bins, MAX_IAE_QUBITS, backtest_id,
            )

        probs = model.probabilities or []
        bins = model.bins or []

        if not probs or not bins:
            return ReplayResult(
                backtest_id=backtest_id,
                fold_id=fold_id,
                event_type=event_type,
                reproducibility_hash=repro_hash,
                governance_labels=governance,
                status="skipped_no_model",
                failure_reason="UncertaintyModel produced empty bins/probs",
            )

        # Threshold: use mean loss as breach/ruin threshold
        # (represents "exceed average loss" — meaningful for regime-failure detection)
        threshold = float(abs(np.mean(pnl_array[pnl_array < 0]))) if np.any(pnl_array < 0) else float(np.std(pnl_array))
        threshold = max(threshold, 1e-6)

        # Compute classical parity estimate (independent of stored MC run)
        # This is used to verify model reconstruction, not for scoring
        threshold_idx = 0
        for i, edge in enumerate(bins[:-1]):
            if edge >= -threshold if event_type == "tail_loss" else edge >= threshold:
                threshold_idx = i
                break
        else:
            threshold_idx = len(probs) - 1

        classical_parity = _compute_classical_probability(probs, threshold_idx, event_type)

        # Run IAE via quantum_mc.py pure functions — backend="aer" explicit
        if event_type == "breach":
            qresult = run_quantum_breach_estimation(
                model, threshold, backend=_BACKEND, seed=seed
            )
        elif event_type == "ruin":
            qresult = run_quantum_ruin_estimation(
                model, threshold, backend=_BACKEND, seed=seed
            )
        else:
            return ReplayResult(
                backtest_id=backtest_id,
                fold_id=fold_id,
                event_type=event_type,
                reproducibility_hash=repro_hash,
                governance_labels=governance,
                status="failed",
                failure_reason=f"unsupported event_type={event_type!r}",
            )

        quantum_estimate = qresult.estimated_value
        execution_time_ms = int(time.time() * 1000) - start_ms

        # Parity assertion: quantum_mc model reconstruction check
        # |quantum_estimate - classical_parity| should be < 1e-6 when using
        # classical_fallback path; when IAE runs successfully it may differ.
        # We store both for downstream auditing but do NOT assert hard (IAE diverges by design).
        parity_delta = abs(quantum_estimate - classical_parity)
        if qresult.raw_result.get("method") == "classical_fallback" and parity_delta > 1e-6:
            logger.warning(
                "quantum_replay: parity check FAILED on classical_fallback path — "
                "backtest=%s fold=%s event=%s delta=%.8f (expected < 1e-6)",
                backtest_id, fold_id, event_type, parity_delta,
            )

        # Disagreement vs stored classical MC ruin
        disagreement: Optional[float] = None
        disagreement_flagged = False
        if stored_classical_ruin is not None:
            disagreement = abs(quantum_estimate - stored_classical_ruin) / max(
                abs(stored_classical_ruin), 1e-6
            )
            disagreement_flagged = disagreement >= _DISAGREEMENT_FLAG_THRESHOLD
            if disagreement_flagged:
                logger.info(
                    "quantum_replay: DISAGREEMENT flagged — backtest=%s fold=%s "
                    "event=%s quantum=%.4f classical_stored=%.4f disagreement=%.4f",
                    backtest_id, fold_id, event_type,
                    quantum_estimate, stored_classical_ruin, disagreement,
                )

        return ReplayResult(
            backtest_id=backtest_id,
            fold_id=fold_id,
            event_type=event_type,
            quantum_estimate=quantum_estimate,
            classical_estimate=classical_parity,
            stored_classical_ruin=stored_classical_ruin,
            disagreement=disagreement,
            disagreement_flagged=disagreement_flagged,
            reproducibility_hash=repro_hash,
            governance_labels=governance,
            status="completed",
            backend_used=qresult.backend_used or _BACKEND,
            execution_time_ms=execution_time_ms,
            num_qubits=qresult.num_qubits,
            raw_result={
                "schema_version": SCHEMA_VERSION,
                "method": qresult.raw_result.get("method", "iae"),
                "classical_fallback": qresult.raw_result.get("classical_fallback", False),
                "parity_delta": parity_delta,
                "threshold_used": threshold,
                "threshold_idx": threshold_idx,
                "n_bins": len(probs),
                "num_oracle_calls": qresult.num_oracle_calls,
                "confidence_interval": qresult.confidence_interval,
                "seed": seed,
                "backend_explicit": _BACKEND,
                "qubit_cap_applied": len(bins) - 1 > max_bins,
            },
        )

    except Exception as exc:  # noqa: BLE001
        execution_time_ms = int(time.time() * 1000) - start_ms
        failure_reason = f"{type(exc).__name__}: {exc}"
        logger.warning(
            "quantum_replay: IAE run failed — backtest=%s fold=%s event=%s reason=%s",
            backtest_id, fold_id, event_type, failure_reason,
        )
        return ReplayResult(
            backtest_id=backtest_id,
            fold_id=fold_id,
            event_type=event_type,
            reproducibility_hash=repro_hash,
            governance_labels=governance,
            status="failed",
            failure_reason=failure_reason,
            execution_time_ms=execution_time_ms,
        )


# ── Public API ────────────────────────────────────────────────────────────────

def replay_quantum_on_backtest(
    backtest_id: str,
    apply: bool = False,
    seed: int = DEFAULT_SEED,
    verbose: bool = False,
) -> list[ReplayResult]:
    """Run quantum IAE replay for all (fold, event_type) tuples of one backtest.

    Returns one ReplayResult per (fold x event_type) tuple.
    If apply=True, writes each completed row to quantum_mc_runs via db_loader.
    Dry-run (apply=False) prints a summary and returns results without writing.

    Authority boundary: does NOT write to DB unless apply=True.
    """
    load_daily_pnls = _get_db_fn("load_daily_pnls")
    load_classical_ruin = _get_db_fn("load_classical_ruin")
    load_walk_forward_windows = _get_db_fn("load_walk_forward_windows")
    load_strategy_id = _get_db_fn("load_strategy_id")
    write_replay_row = _get_db_fn("write_replay_row")

    daily_pnls = load_daily_pnls(backtest_id)
    stored_classical_ruin = load_classical_ruin(backtest_id)
    wf_windows = load_walk_forward_windows(backtest_id)
    strategy_id = load_strategy_id(backtest_id)

    quantum_mc_git_sha = _compute_quantum_mc_git_sha()

    results: list[ReplayResult] = []

    # Fold list: one entry per WF window; or synthetic single fold when no WF data
    folds: list[tuple[Optional[str], Optional[str]]] = []
    if wf_windows:
        folds = [(w.get("id"), w.get("id")) for w in wf_windows]
    else:
        folds = [(None, None)]

    for fold_id, wf_window_id in folds:
        for event_type in _EVENT_TYPES:
            result = _run_single_replay(
                backtest_id=backtest_id,
                daily_pnls=daily_pnls or [],
                stored_classical_ruin=stored_classical_ruin,
                strategy_id=strategy_id,
                fold_id=fold_id,
                wf_window_id=wf_window_id,
                event_type=event_type,
                seed=seed,
                quantum_mc_git_sha=quantum_mc_git_sha,
            )
            results.append(result)

            if verbose:
                _print_result(result)

            if apply and result.status == "completed":
                row = _result_to_db_row(result, backtest_id)
                write_replay_row(row)
                logger.info(
                    "quantum_replay: wrote replay row — backtest=%s fold=%s event=%s "
                    "hash=%s",
                    backtest_id, fold_id, event_type, result.reproducibility_hash[:12],
                )

    return results


def replay_quantum_on_all_backtests(
    apply: bool = False,
    seed: int = DEFAULT_SEED,
    limit: Optional[int] = None,
    verbose: bool = False,
) -> list[ReplayResult]:
    """Run quantum IAE replay across all available backtest rows.

    Delegates DB loading to db_loader (P1.A2 owns).
    apply=False (default): dry-run, print summary, no DB writes.
    apply=True: writes completed rows to quantum_mc_runs.
    limit: process at most N backtest IDs (smoke-testing).

    Authority boundary: writes only when apply=True, only to quantum_mc_runs,
    only rows with status="completed" and governance_labels.replay_mode=True.
    """
    load_backtest_ids = _get_db_fn("load_backtest_ids")
    backtest_ids = load_backtest_ids(limit=limit)

    if not backtest_ids:
        logger.info("quantum_replay: no backtest IDs found (db_loader may be stub)")

    all_results: list[ReplayResult] = []
    for bid in backtest_ids:
        rows = replay_quantum_on_backtest(
            backtest_id=bid,
            apply=apply,
            seed=seed,
            verbose=verbose,
        )
        all_results.extend(rows)

    return all_results


# ── DB row builder ────────────────────────────────────────────────────────────

def _result_to_db_row(result: ReplayResult, backtest_id: str) -> dict:
    """Convert a completed ReplayResult to a quantum_mc_runs insert dict.

    Maps to schema.ts quantumMcRuns columns.
    governance_labels always carries replay_mode=True — this is the replay
    row marker that the TS analysis layer joins on.
    """
    return {
        "backtest_id": backtest_id,
        "status": result.status,
        "method": "iae",
        "backend": result.backend_used,
        "num_qubits": result.num_qubits,
        "estimated_value": result.quantum_estimate,
        "classical_value": result.classical_estimate,
        "tolerance_delta": (
            abs(result.quantum_estimate - result.classical_estimate)
            if result.quantum_estimate is not None and result.classical_estimate is not None
            else None
        ),
        "within_tolerance": (
            abs(result.quantum_estimate - result.classical_estimate) < 0.05
            if result.quantum_estimate is not None and result.classical_estimate is not None
            else None
        ),
        "confidence_interval": result.raw_result.get("confidence_interval"),
        "execution_time_ms": result.execution_time_ms,
        "governance_labels": result.governance_labels,
        "raw_result": result.raw_result,
        "reproducibility_hash": result.reproducibility_hash,
    }


# ── CLI output helpers ────────────────────────────────────────────────────────

def _print_result(result: ReplayResult) -> None:
    print(
        f"  [{result.status}] backtest={result.backtest_id[:8]} "
        f"fold={str(result.fold_id)[:8] if result.fold_id else 'None'} "
        f"event={result.event_type} "
        f"quantum={result.quantum_estimate:.4f if result.quantum_estimate is not None else 'N/A'} "
        f"classical={result.classical_estimate:.4f if result.classical_estimate is not None else 'N/A'} "
        f"disagreement={result.disagreement:.4f if result.disagreement is not None else 'N/A'} "
        f"{'[FLAGGED]' if result.disagreement_flagged else ''}"
        f"hash={result.reproducibility_hash[:12]}"
    )


def _print_summary(results: list[ReplayResult], apply: bool) -> None:
    completed = [r for r in results if r.status == "completed"]
    failed = [r for r in results if r.status == "failed"]
    skipped = [r for r in results if r.status.startswith("skipped")]
    flagged = [r for r in results if r.disagreement_flagged]

    print(f"\n--- Quantum Replay Summary ---")
    print(f"  Total rows:   {len(results)}")
    print(f"  Completed:    {len(completed)}")
    print(f"  Failed:       {len(failed)}")
    print(f"  Skipped:      {len(skipped)}")
    print(f"  Flagged:      {len(flagged)} disagreement >= {_DISAGREEMENT_FLAG_THRESHOLD}")
    print(f"  Mode:         {'--apply (DB writes)' if apply else 'dry-run (no writes)'}")
    if completed:
        sample = completed[0]
        print(f"\n  Sample row:")
        print(f"    backtest_id:          {sample.backtest_id}")
        print(f"    event_type:           {sample.event_type}")
        print(f"    quantum_estimate:     {sample.quantum_estimate}")
        print(f"    classical_estimate:   {sample.classical_estimate}")
        print(f"    disagreement:         {sample.disagreement}")
        print(f"    reproducibility_hash: {sample.reproducibility_hash}")
        print(f"    schema_version:       {sample.schema_version}")
        print(f"    governance_labels:    {json.dumps(sample.governance_labels)}")
    print()


# ── CLI entry point ───────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Quantum IAE replay-grading harness — challenger-only advisory layer.\n"
            "Dry-run by default. Pass --apply to write to DB."
        )
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--backtest-id", help="UUID of a single backtest to replay")
    group.add_argument("--all", action="store_true", help="Replay all available backtests")
    parser.add_argument("--apply", action="store_true", default=False,
                        help="Write replay rows to quantum_mc_runs (default: dry-run)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED,
                        help=f"RNG seed for deterministic IAE (default: {DEFAULT_SEED})")
    parser.add_argument("--limit", type=int, default=None,
                        help="Process at most N backtests (smoke testing; --all only)")
    parser.add_argument("--verbose", action="store_true", default=False,
                        help="Print per-row output")
    return parser


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    parser = _build_parser()
    args = parser.parse_args()

    if args.backtest_id:
        results = replay_quantum_on_backtest(
            backtest_id=args.backtest_id,
            apply=args.apply,
            seed=args.seed,
            verbose=args.verbose,
        )
    else:
        results = replay_quantum_on_all_backtests(
            apply=args.apply,
            seed=args.seed,
            limit=args.limit,
            verbose=args.verbose,
        )

    _print_summary(results, args.apply)

    if not results:
        print("No results produced (db_loader may be stub or no backtests found).")
        sys.exit(0)

    # Exit non-zero if any row failed (not skipped — skipped is expected)
    failed = [r for r in results if r.status == "failed"]
    if failed:
        print(f"WARNING: {len(failed)} replay row(s) failed — check logs")
        sys.exit(1)
    sys.exit(0)
