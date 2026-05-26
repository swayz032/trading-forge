"""
B14 Survival Twin replay-grading harness.

Wave 27 Pass 4 — quantum-challenger sub-track.

Produces independent per-firm survival evidence for each historical backtest
and records it as a challenger-only replay row in quantum_mc_runs.  The
classical-side survival_scorer.py is the system-under-test; this module
never mutates it.

Governance contract
-------------------
All outputs carry governance_labels:
    experimental:    True
    authoritative:   False
    decision_role:   "challenger_only"
    replay_mode:     True
    survival_twin:   True
    firm:            "topstep" | "mffu"
    account_type:    "50K"

Authority boundaries (HARD)
---------------------------
- NO entry/exit authority
- NO position sizing authority
- NO lifecycle promotion authority
- NO mutation of strategy parameters
- Evidence is advisory; downstream critics decide what to do with it.

B14 is classical-only — NO quantum_mc imports, NO Qiskit/PennyLane imports.
Quantum IAE is Pass 1's responsibility.  This module calls survival_scorer
which runs classical Monte Carlo internally.

CLI
---
    # dry-run (default) — prints plan, no DB writes
    python -m src.engine.replay.survival_twin_replay --backtest-id <uuid>

    # write replay rows to quantum_mc_runs
    python -m src.engine.replay.survival_twin_replay --backtest-id <uuid> --apply

    # process up to N backtests (batch mode)
    python -m src.engine.replay.survival_twin_replay --limit 10 --apply

Import note (circular-import workaround from Pass 1)
----------------------------------------------------
Import DIRECTLY from sub-modules, not through the package __init__:
    from src.engine.survival.survival_scorer import survival_score
    from src.engine.replay.db_loader import (
        load_backtest_with_folds,
        load_all_backtests_with_folds,
        write_replay_row,
    )
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from typing import Any, Optional

from pydantic import BaseModel

from src.engine.replay.db_loader import (  # noqa: E402
    load_all_backtests_with_folds,
    load_backtest_with_folds,
    write_replay_row,
)

# ── Direct sub-module imports (circular-import workaround) ────────────────────
# Do NOT import via src.engine.survival or src.engine.replay package __init__
from src.engine.survival.survival_scorer import survival_score  # noqa: E402

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

SCHEMA_VERSION = "v1_challenger"

# Firms supported by the B14 Survival Twin harness
SUPPORTED_FIRMS = ("Topstep", "MFFU")

# Account type used for all replay runs (Plan spec: "50K")
ACCOUNT_TYPE = "50K"

# MC simulations per survival_score call — deterministic via seed=42 inside
# survival_scorer's mc_drawdown_breach (which uses numpy seed internally)
NUM_MC_SIMS = 5000

# Status outcomes
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_PARTIAL_DATA = "partial_data"
STATUS_SKIPPED_NO_PNLS = "skipped_no_pnls"
STATUS_SKIPPED_UNKNOWN_FIRM = "skipped_unknown_firm"

# Method name stamped on quantum_mc_runs rows
METHOD = "survival_twin_classical"
BACKEND = "local_cpu"

# ── Reproducibility Hash ──────────────────────────────────────────────────────


def _get_survival_scorer_git_sha() -> str:
    """Return the git SHA of survival_scorer.py, or 'unavailable' if git is absent."""
    try:
        import subprocess
        result = subprocess.run(
            ["git", "log", "-1", "--format=%H",
             "src/engine/survival/survival_scorer.py"],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(
                os.path.dirname(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                )
            ),
            timeout=5,
        )
        sha = result.stdout.strip()
        return sha if sha else "unavailable"
    except Exception:
        return "unavailable"


def compute_reproducibility_hash(
    strategy_id: str,
    backtest_id: str,
    firm: str,
    account_type: str,
    scorer_git_sha: str,
) -> str:
    """SHA-256 of strategy_id || backtest_id || firm || account_type || scorer_git_sha.

    Deterministic: same inputs → same hash across all runs.
    Changing survival_scorer.py produces a new hash (new git SHA).
    """
    raw = f"{strategy_id}|{backtest_id}|{firm}|{account_type}|{scorer_git_sha}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Disagreement Computation ──────────────────────────────────────────────────


def _load_pass_a_ruin_ci_high(backtest_id: str) -> Optional[float]:
    """Load Pass A's probability_of_ruin_ci.ci_high from monte_carlo_runs.

    This is the independent classical ruin estimate from Pass A (Wave 27.5).
    Returns None if no completed MC run exists or if the ci_high key is absent
    (pre-Wave-27.5 runs won't have it).

    Cross-method disagreement is ONLY computed when this value is available.
    Missing values are not an error — they simply produce disagreement=None.
    """
    try:
        import psycopg2
        import psycopg2.extras

        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            return None

        conn = psycopg2.connect(db_url)
        try:
            sql = """
                SELECT monte_carlo_output
                FROM monte_carlo_runs
                WHERE backtest_id = %s
                  AND status = 'completed'
                ORDER BY created_at DESC
                LIMIT 1
            """
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql, (backtest_id,))
                row = cur.fetchone()

            if row is None:
                return None

            mc_output = row["monte_carlo_output"]
            if mc_output is None:
                return None

            if isinstance(mc_output, str):
                try:
                    mc_output = json.loads(mc_output)
                except json.JSONDecodeError:
                    return None

            if not isinstance(mc_output, dict):
                return None

            # Path: mc_output.probability_of_ruin_ci.ci_high (Wave 27.5 Pass A)
            ruin_ci = mc_output.get("probability_of_ruin_ci")
            if isinstance(ruin_ci, dict):
                ci_high = ruin_ci.get("ci_high")
                if ci_high is not None:
                    return float(ci_high)

            return None
        finally:
            conn.close()
    except Exception as exc:
        logger.debug(
            "survival_twin_replay: could not load Pass A ruin_ci_high "
            "for backtest %s: %s",
            backtest_id, exc,
        )
        return None


def _compute_disagreement(
    survival_breach_prob: float,
    pass_a_ruin_ci_high: Optional[float],
) -> Optional[float]:
    """Absolute difference between survival_twin breach probability and Pass A ruin CI high.

    Both are probabilities in [0, 1].  When they disagree, the delta quantifies
    which method is more conservative.

    Returns None when Pass A value is unavailable.
    """
    if pass_a_ruin_ci_high is None:
        return None
    return abs(survival_breach_prob - pass_a_ruin_ci_high)


# ── Pydantic Result Model ─────────────────────────────────────────────────────


class SurvivalReplayResult(BaseModel):
    """Evidence output from one (backtest, firm) survival twin replay run.

    Advisory-only.  No authority over promotion or execution.
    """

    # Identity
    backtest_id: str
    strategy_id: str
    firm: str                     # "Topstep" | "MFFU"
    account_type: str             # "50K"

    # Status
    status: str                   # completed | failed | partial_data | skipped_no_pnls | skipped_unknown_firm
    failure_reason: Optional[str] = None

    # The 7 survival metrics (scores 0-100 each)
    daily_breach_prob_score: Optional[float] = None
    dd_breach_prob_score: Optional[float] = None
    consistency_score: Optional[float] = None
    recovery_speed_score: Optional[float] = None
    worst_month_score: Optional[float] = None
    commission_drag_score: Optional[float] = None
    eval_speed_score: Optional[float] = None

    # Composite + grade
    survival_score: Optional[float] = None
    grade: Optional[str] = None                # A | B | C | D | F

    # Raw probability values (for disagreement computation)
    mc_dd_breach_probability: Optional[float] = None   # from survival_scorer raw

    # Cross-method disagreement
    pass_a_ruin_ci_high: Optional[float] = None        # from Monte Carlo Pass A
    cross_method_disagreement: Optional[float] = None  # |survival_breach_prob - ci_high|

    # Reproducibility
    reproducibility_hash: str
    scorer_git_sha: str
    schema_version: str = SCHEMA_VERSION

    # Governance
    governance_labels: dict

    # Runtime metadata
    execution_time_ms: int


# ── Single Replay Run ─────────────────────────────────────────────────────────


def _run_single_survival_replay(
    backtest_id: str,
    strategy_id: str,
    daily_pnls: list[float],
    firm: str,
    account_type: str,
    scorer_git_sha: str,
) -> SurvivalReplayResult:
    """Run survival_score for one (backtest, firm) pair and return evidence.

    This function is pure except for the DB lookup of Pass A ruin_ci_high.
    It does NOT write to any table.

    Governance: no entry/exit/sizing authority.  Result is challenger advisory only.
    """
    start_ms = int(time.time() * 1000)

    repro_hash = compute_reproducibility_hash(
        strategy_id, backtest_id, firm, account_type, scorer_git_sha,
    )

    governance: dict = {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
        "replay_mode": True,
        "survival_twin": True,
        "firm": firm.lower(),
        "account_type": account_type,
    }

    # Guard: skip unknown firms before calling survival_scorer
    from src.engine.survival.firm_profiles import get_firm_profile  # noqa: PLC0415
    profile = get_firm_profile(firm, account_type)
    if profile is None:
        elapsed = int(time.time() * 1000) - start_ms
        return SurvivalReplayResult(
            backtest_id=backtest_id,
            strategy_id=strategy_id,
            firm=firm,
            account_type=account_type,
            status=STATUS_SKIPPED_UNKNOWN_FIRM,
            failure_reason=f"Unknown firm/account_type: {firm}/{account_type}",
            reproducibility_hash=repro_hash,
            scorer_git_sha=scorer_git_sha,
            governance_labels=governance,
            execution_time_ms=elapsed,
        )

    # Guard: skip empty/too-short daily_pnls
    if not daily_pnls or len(daily_pnls) < 2:
        elapsed = int(time.time() * 1000) - start_ms
        return SurvivalReplayResult(
            backtest_id=backtest_id,
            strategy_id=strategy_id,
            firm=firm,
            account_type=account_type,
            status=STATUS_SKIPPED_NO_PNLS,
            failure_reason="daily_pnls empty or too short (<2 days)",
            reproducibility_hash=repro_hash,
            scorer_git_sha=scorer_git_sha,
            governance_labels=governance,
            execution_time_ms=elapsed,
        )

    try:
        # Call survival_scorer (system-under-test — read-only)
        result = survival_score(
            daily_pnls=daily_pnls,
            firm=firm,
            account_type=account_type,
            num_mc_sims=NUM_MC_SIMS,
        )

        metrics = result.get("metrics", {})
        raw = result.get("raw", {})

        mc_breach_prob = raw.get("mc_dd_breach_probability")
        if mc_breach_prob is not None:
            mc_breach_prob = float(mc_breach_prob)

        # Load Pass A ruin CI for cross-method disagreement
        pass_a_ci_high = _load_pass_a_ruin_ci_high(backtest_id)
        disagreement = _compute_disagreement(
            survival_breach_prob=float(raw.get("daily_breach_probability", 0.0)),
            pass_a_ruin_ci_high=pass_a_ci_high,
        )

        elapsed = int(time.time() * 1000) - start_ms

        return SurvivalReplayResult(
            backtest_id=backtest_id,
            strategy_id=strategy_id,
            firm=firm,
            account_type=account_type,
            status=STATUS_COMPLETED,

            daily_breach_prob_score=float(metrics.get("daily_breach_prob", 0.0)),
            dd_breach_prob_score=float(metrics.get("dd_breach_prob", 0.0)),
            consistency_score=float(metrics.get("consistency", 0.0)),
            recovery_speed_score=float(metrics.get("recovery_speed", 0.0)),
            worst_month_score=float(metrics.get("worst_month", 0.0)),
            commission_drag_score=float(metrics.get("commission_drag", 0.0)),
            eval_speed_score=float(metrics.get("eval_speed", 0.0)),

            survival_score=float(result.get("survival_score", 0.0)),
            grade=result.get("grade", "F"),

            mc_dd_breach_probability=mc_breach_prob,
            pass_a_ruin_ci_high=pass_a_ci_high,
            cross_method_disagreement=disagreement,

            reproducibility_hash=repro_hash,
            scorer_git_sha=scorer_git_sha,
            governance_labels=governance,
            execution_time_ms=elapsed,
        )

    except Exception as exc:
        elapsed = int(time.time() * 1000) - start_ms
        logger.error(
            "survival_twin_replay: survival_score failed for backtest=%s firm=%s: %s",
            backtest_id, firm, exc,
        )
        return SurvivalReplayResult(
            backtest_id=backtest_id,
            strategy_id=strategy_id,
            firm=firm,
            account_type=account_type,
            status=STATUS_FAILED,
            failure_reason=str(exc),
            reproducibility_hash=repro_hash,
            scorer_git_sha=scorer_git_sha,
            governance_labels=governance,
            execution_time_ms=elapsed,
        )


# ── DB Row Builder ────────────────────────────────────────────────────────────


def _result_to_db_row(result: SurvivalReplayResult) -> dict[str, Any]:
    """Convert SurvivalReplayResult to quantum_mc_runs INSERT-compatible dict.

    Column mapping follows the REPLAY_ROW_SCHEMA contract from db_loader.py.
    The 7 survival metric scores are packed into raw_result JSONB.
    """
    raw_result: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "firm": result.firm,
        "account_type": result.account_type,
        "metrics": {
            "daily_breach_prob_score": result.daily_breach_prob_score,
            "dd_breach_prob_score": result.dd_breach_prob_score,
            "consistency_score": result.consistency_score,
            "recovery_speed_score": result.recovery_speed_score,
            "worst_month_score": result.worst_month_score,
            "commission_drag_score": result.commission_drag_score,
            "eval_speed_score": result.eval_speed_score,
        },
        "survival_score": result.survival_score,
        "grade": result.grade,
        "mc_dd_breach_probability": result.mc_dd_breach_probability,
        "pass_a_ruin_ci_high": result.pass_a_ruin_ci_high,
        "cross_method_disagreement": result.cross_method_disagreement,
        "scorer_git_sha": result.scorer_git_sha,
        "failure_reason": result.failure_reason,
    }

    # estimated_value: use daily_breach_prob (primary breach metric) as the scalar
    # classical_value: use pass_a_ruin_ci_high (independent estimate) for comparison
    # tolerance_delta: cross-method disagreement (absolute)
    estimated_value = None
    if result.mc_dd_breach_probability is not None:
        estimated_value = result.mc_dd_breach_probability
    elif result.survival_score is not None:
        estimated_value = result.survival_score / 100.0  # normalise to [0,1] probability scale

    return {
        "backtest_id": result.backtest_id,
        "status": result.status,
        "method": METHOD,
        "backend": BACKEND,
        "num_qubits": 0,            # B14 is classical — no qubits
        "estimated_value": estimated_value,
        "classical_value": result.pass_a_ruin_ci_high,
        "tolerance_delta": result.cross_method_disagreement,
        "within_tolerance": (
            result.cross_method_disagreement is not None
            and result.cross_method_disagreement <= 0.10
        ),
        "confidence_interval": {
            "ci_low": None,
            "ci_high": None,
            "ci_method": "classical_survival_twin",
        },
        "execution_time_ms": result.execution_time_ms,
        "gpu_accelerated": False,
        "governance_labels": result.governance_labels,
        "raw_result": raw_result,
        "reproducibility_hash": result.reproducibility_hash,
        "cloud_provider": None,
        "cloud_backend_name": None,
        "cloud_job_id": None,
    }


# ── Batch Replay ──────────────────────────────────────────────────────────────


def replay_survival_on_backtest(
    backtest_id: str,
    apply: bool = False,
) -> list[SurvivalReplayResult]:
    """Run B14 Survival Twin replay for all supported firms on one backtest.

    Returns one SurvivalReplayResult per (backtest, firm) pair.
    On apply=True, writes results to quantum_mc_runs.

    Args:
        backtest_id: UUID of the backtest to replay.
        apply: If True, write rows to quantum_mc_runs.  Default: dry-run.

    Returns:
        list of SurvivalReplayResult (one per firm, i.e. len=2 for Topstep+MFFU)
    """
    scorer_git_sha = _get_survival_scorer_git_sha()

    try:
        backtest = load_backtest_with_folds(backtest_id)
    except Exception as exc:
        logger.error(
            "survival_twin_replay: could not load backtest %s: %s",
            backtest_id, exc,
        )
        # Return failed stubs for both firms
        results = []
        for firm in SUPPORTED_FIRMS:
            repro_hash = compute_reproducibility_hash(
                "unknown", backtest_id, firm, ACCOUNT_TYPE, scorer_git_sha,
            )
            results.append(SurvivalReplayResult(
                backtest_id=backtest_id,
                strategy_id="unknown",
                firm=firm,
                account_type=ACCOUNT_TYPE,
                status=STATUS_FAILED,
                failure_reason=f"DB load error: {exc}",
                reproducibility_hash=repro_hash,
                scorer_git_sha=scorer_git_sha,
                governance_labels={
                    "experimental": True,
                    "authoritative": False,
                    "decision_role": "challenger_only",
                    "replay_mode": True,
                    "survival_twin": True,
                    "firm": firm.lower(),
                    "account_type": ACCOUNT_TYPE,
                },
                execution_time_ms=0,
            ))
        return results

    results: list[SurvivalReplayResult] = []

    for firm in SUPPORTED_FIRMS:
        result = _run_single_survival_replay(
            backtest_id=backtest.backtest_id,
            strategy_id=backtest.strategy_id,
            daily_pnls=backtest.daily_pnls,
            firm=firm,
            account_type=ACCOUNT_TYPE,
            scorer_git_sha=scorer_git_sha,
        )
        results.append(result)

        # Write to DB if apply mode and result has a deterministic outcome
        if apply and result.status not in (
            STATUS_SKIPPED_UNKNOWN_FIRM, STATUS_SKIPPED_NO_PNLS
        ):
            db_row = _result_to_db_row(result)
            try:
                row_id = write_replay_row(db_row, apply=True)
                logger.info(
                    "survival_twin_replay: wrote row %s for backtest=%s firm=%s",
                    row_id, backtest_id, firm,
                )
            except Exception as exc:
                logger.error(
                    "survival_twin_replay: write_replay_row failed for "
                    "backtest=%s firm=%s: %s",
                    backtest_id, firm, exc,
                )

    return results


def replay_survival_on_all_backtests(
    limit: Optional[int] = None,
    apply: bool = False,
) -> list[SurvivalReplayResult]:
    """Batch replay across all completed backtests.

    Args:
        limit: Max number of backtests to process.
        apply: Write results to quantum_mc_runs when True.

    Returns:
        Flat list of SurvivalReplayResult (up to limit×2 entries).
    """
    try:
        backtests = load_all_backtests_with_folds(limit=limit)
    except Exception as exc:
        logger.error("survival_twin_replay: batch load failed: %s", exc)
        return []

    all_results: list[SurvivalReplayResult] = []
    scorer_git_sha = _get_survival_scorer_git_sha()

    for backtest in backtests:
        for firm in SUPPORTED_FIRMS:
            result = _run_single_survival_replay(
                backtest_id=backtest.backtest_id,
                strategy_id=backtest.strategy_id,
                daily_pnls=backtest.daily_pnls,
                firm=firm,
                account_type=ACCOUNT_TYPE,
                scorer_git_sha=scorer_git_sha,
            )
            all_results.append(result)

            if apply and result.status not in (
                STATUS_SKIPPED_UNKNOWN_FIRM, STATUS_SKIPPED_NO_PNLS
            ):
                db_row = _result_to_db_row(result)
                try:
                    row_id = write_replay_row(db_row, apply=True)
                    logger.info(
                        "survival_twin_replay: wrote row %s for backtest=%s firm=%s",
                        row_id, backtest.backtest_id, firm,
                    )
                except Exception as exc:
                    logger.error(
                        "survival_twin_replay: write_replay_row failed for "
                        "backtest=%s firm=%s: %s",
                        backtest.backtest_id, firm, exc,
                    )

    return all_results


# ── CLI Entry Point ───────────────────────────────────────────────────────────


def main() -> None:
    """CLI: python -m src.engine.replay.survival_twin_replay [options]"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(
        description="B14 Survival Twin Replay — Wave 27 Pass 4",
    )
    parser.add_argument(
        "--backtest-id",
        help="Single backtest UUID to replay. Mutually exclusive with --limit batch mode.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Write results to quantum_mc_runs. Default: dry-run.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Batch mode: process at most N backtests (ordered by created_at DESC).",
    )
    args = parser.parse_args()

    if args.backtest_id:
        results = replay_survival_on_backtest(
            backtest_id=args.backtest_id,
            apply=args.apply,
        )
    else:
        results = replay_survival_on_all_backtests(
            limit=args.limit,
            apply=args.apply,
        )

    if not args.apply:
        print("[DRY-RUN] No rows written. Pass --apply to write to quantum_mc_runs.")

    print("\n=== B14 Survival Twin Replay — Wave 27 Pass 4 ===")
    print(f"Mode:    {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"Results: {len(results)} (backtest × firm)")
    print()

    by_status: dict[str, int] = {}
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1

    for status, count in sorted(by_status.items()):
        print(f"  {status}: {count}")

    completed = [r for r in results if r.status == STATUS_COMPLETED]
    if completed:
        print()
        print(f"Completed ({len(completed)} results):")
        for r in completed:
            disagreement_str = (
                f"  disagreement={r.cross_method_disagreement:.4f}"
                if r.cross_method_disagreement is not None
                else "  disagreement=n/a (no Pass A ruin_ci)"
            )
            print(
                f"  backtest={r.backtest_id[:8]}... firm={r.firm:<8} "
                f"score={r.survival_score:.1f} grade={r.grade}{disagreement_str}"
            )

    # Exit 1 only on DB error (not on graceful skips)
    db_errors = [r for r in results if r.status == STATUS_FAILED]
    if db_errors:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
