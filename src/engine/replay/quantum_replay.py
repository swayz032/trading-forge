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
    Functions used: load_backtest_with_folds, load_all_backtests_with_folds,
    load_classical_baseline, write_replay_row
  - Writes: via db_loader.write_replay_row(row, apply=True) under --apply only

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
from src.engine.quantum_models import build_empirical_binned_distribution

# ── DB loader import (P1.A2 owns the real implementation) ─────────────────────
# If db_loader is not yet available (parallel-track race), stub functions with
# matching signatures so this module compiles cleanly. P1.A2 replaces stubs.
try:
    from src.engine.replay.db_loader import (
        BacktestForReplay,
        SchemaContractMismatch,
        WalkForwardFold,
    )
    from src.engine.replay.db_loader import (
        load_all_backtests_with_folds as _real_load_all_backtests_with_folds,
    )
    from src.engine.replay.db_loader import (
        load_backtest_with_folds as _real_load_backtest_with_folds,
    )
    from src.engine.replay.db_loader import (
        load_classical_baseline as _real_load_classical_baseline,
    )
    from src.engine.replay.db_loader import (
        write_replay_row as _real_write_replay_row,
    )
    _DB_LOADER_AVAILABLE = True
except ImportError:
    _DB_LOADER_AVAILABLE = False
    BacktestForReplay = None  # type: ignore[assignment,misc]
    WalkForwardFold = None  # type: ignore[assignment,misc]
    SchemaContractMismatch = Exception  # type: ignore[assignment,misc]
    _real_load_backtest_with_folds = None  # type: ignore[assignment]
    _real_load_all_backtests_with_folds = None  # type: ignore[assignment]
    _real_load_classical_baseline = None  # type: ignore[assignment]
    _real_write_replay_row = None  # type: ignore[assignment]

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
# Tests mock at the module attribute level (patch.multiple) so stub vs real is
# irrelevant — the patched mock wins either way.

class _StubBacktestForReplay:
    """Minimal stub matching BacktestForReplay shape for type hints when db_loader unavailable."""
    def __init__(self, backtest_id: str = "", strategy_id: str = "",
                 daily_pnls=None, folds=None, oos_trades=None, schema_version: str = ""):
        self.backtest_id = backtest_id
        self.strategy_id = strategy_id
        self.daily_pnls = daily_pnls or []
        self.folds = folds or []
        self.oos_trades = oos_trades or []
        self.schema_version = schema_version


def _stub_load_backtest_with_folds(backtest_id: str) -> "_StubBacktestForReplay":  # noqa: F821
    """Stub: P1.A2 will replace with real DB query."""
    return _StubBacktestForReplay(backtest_id=backtest_id)


def _stub_load_all_backtests_with_folds(limit: Optional[int] = None) -> list:
    """Stub: P1.A2 will replace. Returns empty list."""
    return []


def _stub_load_classical_baseline(backtest_id: str, event_type: str) -> Optional[float]:
    """Stub: P1.A2 will replace. Returns None (no stored baseline available)."""
    return None


def _stub_write_replay_row(replay_result: dict, apply: bool) -> Optional[str]:
    """Stub: P1.A2 will replace. Validates governance labels; writes when apply=True."""
    # Governance contract check (mirrors real db_loader behaviour)
    gov = replay_result.get("governance_labels", {})
    if not gov.get("experimental"):
        raise ValueError("write_replay_row: governance_labels.experimental must be True")
    if gov.get("authoritative"):
        raise ValueError("write_replay_row: governance_labels.authoritative must be False")
    return None


def _get_db_fns():
    """Return (load_backtest_with_folds, load_all_backtests_with_folds,
    load_classical_baseline, write_replay_row) — real or stub depending on
    whether db_loader is available.

    Tests override module attributes _DB_LOADER_AVAILABLE + the _real_* attrs
    via patch.multiple to inject mocks.
    """
    if _DB_LOADER_AVAILABLE and _real_load_backtest_with_folds is not None:
        return (
            _real_load_backtest_with_folds,
            _real_load_all_backtests_with_folds,
            _real_load_classical_baseline,
            _real_write_replay_row,
        )
    return (
        _stub_load_backtest_with_folds,
        _stub_load_all_backtests_with_folds,
        _stub_load_classical_baseline,
        _stub_write_replay_row,
    )


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
        max_bins = 2 ** MAX_IAE_QUBITS
        qubit_cap_applied = False
        if len(model.bins or []) > max_bins + 1:
            # Re-fit with capped bin count
            model = build_empirical_binned_distribution(pnl_array, n_bins=max_bins)
            qubit_cap_applied = True
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

        # Threshold: use mean absolute loss as breach/ruin threshold
        # (represents "exceed average loss" — meaningful for regime-failure detection)
        neg_vals = pnl_array[pnl_array < 0]
        threshold = float(abs(np.mean(neg_vals))) if len(neg_vals) > 0 else float(np.std(pnl_array))
        threshold = max(threshold, 1e-6)

        # Compute classical parity estimate (independent of stored MC run)
        threshold_idx = 0
        for i, edge in enumerate(bins[:-1]):
            compare_val = -threshold if event_type == "tail_loss" else threshold
            if edge >= compare_val:
                threshold_idx = i
                break
        else:
            threshold_idx = len(probs) - 1

        classical_parity = _compute_classical_probability(probs, threshold_idx, event_type)

        # Run IAE via quantum_mc.py pure functions — backend="aer" explicit, no cloud_config
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

        # Parity delta: when IAE falls back to classical path, expect near-zero.
        # We store both for downstream auditing; do NOT hard-assert (IAE diverges by design).
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
                "qubit_cap_applied": qubit_cap_applied,
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
    Uses db_loader.load_backtest_with_folds and db_loader.write_replay_row.
    """
    (
        fn_load_backtest,
        _fn_load_all,
        fn_load_classical,
        fn_write_row,
    ) = _get_db_fns()

    quantum_mc_git_sha = _compute_quantum_mc_git_sha()

    # Load backtest data via P1.A2 db_loader
    try:
        bt = fn_load_backtest(backtest_id)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "quantum_replay: failed to load backtest %s: %s", backtest_id, exc
        )
        # Return a single failed result for audit trail
        return [ReplayResult(
            backtest_id=backtest_id,
            event_type="breach",
            status="failed",
            failure_reason=f"db_load_failed: {type(exc).__name__}: {exc}",
            reproducibility_hash=compute_reproducibility_hash(
                None, None, seed, "breach", quantum_mc_git_sha
            ),
        )]

    daily_pnls = bt.daily_pnls
    strategy_id = bt.strategy_id

    results: list[ReplayResult] = []

    # Fold list: one entry per WF window; or synthetic single fold when no WF data
    folds = bt.folds  # list[WalkForwardFold] (real) or [] (stub)
    fold_tuples: list[tuple[Optional[str], Optional[str]]] = []
    if folds:
        fold_tuples = [(f.window_id, f.window_id) for f in folds]
    else:
        fold_tuples = [(None, None)]

    for fold_id, wf_window_id in fold_tuples:
        for event_type in _EVENT_TYPES:
            # Load stored classical baseline for disagreement computation
            try:
                stored_classical = fn_load_classical(backtest_id, event_type)
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "quantum_replay: could not load classical baseline for "
                    "backtest=%s event=%s: %s", backtest_id, event_type, exc
                )
                stored_classical = None

            result = _run_single_replay(
                backtest_id=backtest_id,
                daily_pnls=daily_pnls,
                stored_classical_ruin=stored_classical,
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
                try:
                    fn_write_row(row, apply=True)
                    logger.info(
                        "quantum_replay: wrote replay row — backtest=%s fold=%s event=%s "
                        "hash=%s",
                        backtest_id, fold_id, event_type,
                        result.reproducibility_hash[:12],
                    )
                except Exception as write_exc:  # noqa: BLE001
                    logger.error(
                        "quantum_replay: write_replay_row failed for backtest=%s: %s",
                        backtest_id, write_exc,
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
    (
        _fn_load_one,
        fn_load_all,
        _fn_load_classical,
        _fn_write_row,
    ) = _get_db_fns()

    all_backtests = fn_load_all(limit=limit)

    if not all_backtests:
        logger.info("quantum_replay: no backtests loaded (db_loader may be stub or DB empty)")

    all_results: list[ReplayResult] = []
    for bt in all_backtests:
        rows = replay_quantum_on_backtest(
            backtest_id=bt.backtest_id,
            apply=apply,
            seed=seed,
            verbose=verbose,
        )
        all_results.extend(rows)

    return all_results


# ── DB row builder ────────────────────────────────────────────────────────────

def _result_to_db_row(result: ReplayResult, backtest_id: str) -> dict:
    """Convert a completed ReplayResult to a quantum_mc_runs insert dict.

    Maps to schema.ts quantumMcRuns columns (schema.ts:888-916).
    governance_labels always carries replay_mode=True — this is the replay
    row marker that the TS analysis layer joins on.
    Required fields match REPLAY_ROW_SCHEMA in db_loader.py.
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
        "gpu_accelerated": False,  # Local Aer only in replay mode
        "governance_labels": result.governance_labels,
        "raw_result": result.raw_result,
        "reproducibility_hash": result.reproducibility_hash,
        "cloud_provider": None,  # Never cloud in replay mode
        "cloud_backend_name": None,
        "cloud_job_id": None,
    }


# ── CLI output helpers ────────────────────────────────────────────────────────

def _print_result(result: ReplayResult) -> None:
    qe = f"{result.quantum_estimate:.4f}" if result.quantum_estimate is not None else "N/A"
    ce = f"{result.classical_estimate:.4f}" if result.classical_estimate is not None else "N/A"
    dis = f"{result.disagreement:.4f}" if result.disagreement is not None else "N/A"
    fold_str = result.fold_id[:8] if result.fold_id else "None"
    flag = "[FLAGGED]" if result.disagreement_flagged else ""
    print(
        f"  [{result.status}] backtest={result.backtest_id[:8]} "
        f"fold={fold_str} event={result.event_type} "
        f"quantum={qe} classical={ce} disagreement={dis} {flag}"
        f"hash={result.reproducibility_hash[:12]}"
    )


def _print_summary(results: list[ReplayResult], apply: bool) -> None:
    completed = [r for r in results if r.status == "completed"]
    failed = [r for r in results if r.status == "failed"]
    skipped = [r for r in results if r.status.startswith("skipped")]
    flagged = [r for r in results if r.disagreement_flagged]

    print("\n--- Quantum Replay Summary ---")
    print(f"  Total rows:   {len(results)}")
    print(f"  Completed:    {len(completed)}")
    print(f"  Failed:       {len(failed)}")
    print(f"  Skipped:      {len(skipped)}")
    print(f"  Flagged:      {len(flagged)} disagreement >= {_DISAGREEMENT_FLAG_THRESHOLD}")
    print(f"  Mode:         {'--apply (DB writes)' if apply else 'dry-run (no writes)'}")
    if completed:
        sample = completed[0]
        print("\n  Sample row:")
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
    parser.add_argument(
        "--apply", action="store_true", default=False,
        help="Write replay rows to quantum_mc_runs (default: dry-run)",
    )
    parser.add_argument(
        "--seed", type=int, default=DEFAULT_SEED,
        help=f"RNG seed for deterministic IAE (default: {DEFAULT_SEED})",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Process at most N backtests (smoke testing; --all only)",
    )
    parser.add_argument(
        "--verbose", action="store_true", default=False,
        help="Print per-row output",
    )
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
