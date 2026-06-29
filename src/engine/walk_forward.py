"""Walk-forward validation — rolling IS/OOS windows.

Per CLAUDE.md: Walk-forward validation is mandatory.
Aggregate OOS metrics are the ONLY performance numbers that count.

Phase 12 performance fix: OOS windows are now parallelised via
ProcessPoolExecutor (Option B). Each window is an independent
IS-train → OOS-test pair on disjoint data slices. Determinism
is preserved by seeding each worker with (global_seed + window_index).

# FUTURE-WORK: Bagged CPCV / Adaptive CPCV (SSRN 4686376, 2025)
# Optional enhancement for strategies with > 500 trades. Standard CPCV
# remains the canonical 2026 institutional standard per Wave 24 audit.
"""

from __future__ import annotations

# A1 Determinism: import FIRST, before numpy/polars. Sets BLAS env vars at load time.
import os as _os

if _os.environ.get("DETERMINISM_MODE", "").lower() == "true":
    from src.engine.determinism import enable_determinism as _enable_det
    _enable_det()
else:
    import src.engine.determinism  # noqa: F401 — side-effect: sets env vars

import concurrent.futures
import multiprocessing
import os
import sys
import time
from typing import Optional

import numpy as np
import polars as pl

from src.engine.backtester import BARS_PER_DAY, run_backtest, run_class_backtest
from src.engine.config import BacktestRequest
from src.engine.cross_validation import (
    compute_wfe,
    get_wfe_hard_floor,
    get_wfe_warn_floor,
    run_cross_validation,
)
from src.engine.nvtx_markers import range_pop, range_push
from src.engine.optimizer import _apply_params, _build_search_space, optimize_strategy
from src.engine.sanity_checks import run_sanity_checks
from src.engine.strategy_base import BaseStrategy
from src.engine.walk_forward_regime_context import classify_parameter_drift

# ── PBO threshold env var ─────────────────────────────────────────────────────
# Env var: PBO_OVERFIT_THRESHOLD (default 0.5)
# PBO > threshold = strategy more likely overfit than not.
_PBO_OVERFIT_THRESHOLD_DEFAULT = 0.5

# ── F-4: DSR N_total wiring ───────────────────────────────────────────────────
# Env var: DSR_USE_NTOTAL (default "true")
# When true: CPCV DSR uses effective_n_trials = max(n_paths, trial_n_total)
# where trial_n_total is the cumulative mutation proposal count for the strategy
# (from research_trial_counter via BacktestRequest.trial_n_total).
# This prevents 2–5× Sharpe inflation caused by treating each CPCV run as if
# only n_paths (15) trials were ever proposed for the strategy.
# Fail-closed default: true. Override DSR_USE_NTOTAL=false to revert to legacy
# behaviour (n_trials = n_paths only) — for diagnostic use only.
_DSR_USE_NTOTAL: bool = os.getenv("DSR_USE_NTOTAL", "true").lower() != "false"

# ─── OOS Window Minimums ─────────────────────────────────────────
# Below these thresholds, OOS results are statistically unreliable.
MIN_OOS_TRADES = 30
MIN_OOS_DAYS = 60


# ─── Parallel window worker (module-level required for pickling on Windows) ──────────
def _run_wf_window(args: tuple) -> dict:
    """Worker function for a single walk-forward OOS window.

    Must be at module level (not a closure or lambda) for multiprocessing
    pickling to work correctly on Windows (spawn context).

    Args:
        args: (window_index, oos_request, oos_data, is_data, window_seed)

    Returns:
        oos_result dict from run_backtest()
    """
    window_index, oos_request, oos_data, is_data, window_seed = args
    effective_seed = window_seed + window_index
    # Apply per-window seed offset so each worker has deterministic but distinct RNG
    os.environ["BACKTEST_WINDOW_SEED"] = str(effective_seed)
    # F-10 FIX: Call enable_determinism() from the determinism module so that
    # BLAS/LAPACK threadpoolctl limits and per-generator seeds are applied in the
    # worker process, not just the global numpy RNG. This prevents nondeterminism
    # when threadpoolctl or mkl uses internal RNG state.
    # Keep np.random.seed() for backward compat with any code using global RNG.
    try:
        from src.engine.determinism import enable_determinism as _worker_det
        _worker_det(seed=effective_seed)
    except Exception:
        pass  # Never let a determinism helper failure kill a WF window
    np.random.seed(effective_seed)
    result = run_backtest(oos_request, data=oos_data, warmup_data=is_data)
    return result


def split_walk_forward_windows(
    data: pl.DataFrame,
    n_splits: int = 5,
    is_ratio: float = 0.7,
    embargo_bars: int = 20,
) -> list[tuple[pl.DataFrame, pl.DataFrame]]:
    """Split data into anchored walk-forward windows.

    Anchored approach: the first is_ratio of data is the minimum IS warmup.
    The remaining (1 - is_ratio) is divided into n_splits non-overlapping OOS chunks.
    Each window's IS = all data from start up to that OOS chunk (expanding IS).
    OOS chunks are sequential and non-overlapping, covering the full post-warmup range.

    Example with 10yr data, is_ratio=0.7, n_splits=5:
        Warmup: first 7 years (IS minimum)
        OOS chunks: 5 × ~7.2 months each, covering years 7-10
        W1: IS=yr 0-7.6,  OOS=yr 7.0-7.6
        W2: IS=yr 0-8.2,  OOS=yr 7.6-8.2
        ...expanding IS, non-overlapping OOS

    Args:
        data: Full OHLCV DataFrame
        n_splits: Number of walk-forward windows
        is_ratio: Fraction of total data reserved as minimum IS warmup (default 0.7)
        embargo_bars: Bars to skip between IS and OOS to prevent leakage (default 20).
            Changed from 0 to 20 in Wave C hardening so ad-hoc callers don't
            accidentally run with zero embargo. Production callers
            (run_walk_forward, run_walk_forward_class) pass embargo_bars
            explicitly and are unaffected by this default.

    Returns:
        List of (is_data, oos_data) tuples
    """
    n = len(data)
    min_is_bars = int(n * is_ratio)
    oos_total = n - min_is_bars
    oos_chunk_size = oos_total // n_splits

    windows = []
    for i in range(n_splits):
        oos_start = min_is_bars + i * oos_chunk_size
        oos_end = min_is_bars + (i + 1) * oos_chunk_size if i < n_splits - 1 else n

        if oos_start + embargo_bars >= n or oos_end <= oos_start + embargo_bars:
            break

        is_end = oos_start  # IS goes up to OOS start
        is_data = data.slice(0, is_end)
        oos_data = data.slice(oos_start + embargo_bars, oos_end - oos_start - embargo_bars)
        windows.append((is_data, oos_data))

    return windows


def _cpcv_fold_embargo_strips(
    fold_idx: int,
    test_fold_set: set,
    n_splits: int,
    embargo_bars: int,
    is_test_fold: bool,
) -> tuple:
    """Compute (strip_start, strip_end) bar counts for a CPCV fold.

    Pure function — no I/O, no polars, no backtester import — unit-testable
    in isolation without triggering vectorbt JIT loading.

    For OOS (test) folds, strip only at IS-facing boundaries:
      - Strip START  when left  neighbor (fold_idx-1) is an IS fold AND exists
      - Strip END    when right neighbor (fold_idx+1) is an IS fold AND exists
    For IS (training) folds, strip only at OOS-facing boundaries:
      - Strip START  when left  neighbor (fold_idx-1) is an OOS fold AND exists
      - Strip END    when right neighbor (fold_idx+1) is an OOS fold AND exists

    Contiguous OOS↔OOS or IS↔IS boundaries produce zero strip — no leakage
    can cross a same-role boundary.  Data-boundary folds (fold_idx=0 or
    fold_idx=n_splits-1) produce zero strip toward the absent neighbor.

    Args:
        fold_idx:      Index of the fold being examined (0 .. n_splits-1).
        test_fold_set: Set of fold indices designated as OOS for this path.
        n_splits:      Total number of CPCV folds.
        embargo_bars:  Number of bars to strip per IS↔OOS boundary.
        is_test_fold:  True → computing strips for an OOS fold;
                       False → computing strips for an IS fold.

    Returns:
        (strip_start, strip_end) — non-negative integer pair.
    """
    if is_test_fold:
        # OOS fold: strip the edge that faces IS territory
        strip_start = (
            embargo_bars
            if fold_idx > 0 and (fold_idx - 1) not in test_fold_set
            else 0
        )
        strip_end = (
            embargo_bars
            if fold_idx < n_splits - 1 and (fold_idx + 1) not in test_fold_set
            else 0
        )
    else:
        # IS fold: strip the edge that faces OOS territory
        strip_start = (
            embargo_bars
            if fold_idx > 0 and (fold_idx - 1) in test_fold_set
            else 0
        )
        strip_end = (
            embargo_bars
            if fold_idx < n_splits - 1 and (fold_idx + 1) in test_fold_set
            else 0
        )
    return strip_start, strip_end


def _run_walk_forward_cpcv(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    n_splits: int = 6,
    k_test_groups: int = 2,
    embargo_bars: int = 20,
) -> dict:
    """Combinatorial Purged Cross-Validation (CPCV) walk-forward.

    Wave 24 Pass 1 — Item 10. Implements Lopez de Prado CPCV spec:
      - N=6 splits, k=2 test groups → C(N, k) = C(6, 2) = 15 combinatorial paths.
      - Each combination of k splits is the OOS test set; remaining N-k are IS.
      - Purge window applied between IS and OOS to prevent label overlap.
      - PSR (Probabilistic Sharpe Ratio) and DSR aggregated across 15 paths.

    This eliminates the "multiple testing" bias of plain WF where the IS windows
    reuse test periods across splits. CPCV distributes each data point across
    multiple IS/OOS roles — the resulting 15 paths sample the full return
    distribution without repeating test data in any single path.

    Args:
        request:        Backtest configuration.
        data:           Optional pre-loaded OHLCV DataFrame.
        n_splits:       Number of folds (N=6 per spec).
        k_test_groups:  Number of test folds per combination (k=2 per spec).
        embargo_bars:   Purge/embargo bars between IS and each OOS fold.

    Returns:
        dict with oos_metrics, windows, wf_metadata (mode="cpcv", n_paths=15).
    """
    from itertools import combinations as _combos

    start_time = time.time()
    config = request.strategy

    if data is None:
        from src.engine.data_loader import load_ohlcv
        data = load_ohlcv(
            config.symbol, config.timeframe,
            request.start_date, request.end_date,
        )

    n = len(data)
    _base_seed = int(os.environ.get("BACKTEST_SEED", "42"))

    # ── Partition data into N equal-ish folds ────────────────────────────────
    fold_size = n // n_splits
    folds: list[pl.DataFrame] = []
    for fi in range(n_splits):
        fold_start = fi * fold_size
        fold_end = (fi + 1) * fold_size if fi < n_splits - 1 else n
        folds.append(data.slice(fold_start, fold_end - fold_start))

    # ── Generate C(N, k) = 15 combinatorial paths ───────────────────────────
    n_paths = 0
    path_sharpes: list[float] = []
    path_returns: list[float] = []
    all_oos_trades: list[dict] = []
    all_oos_pnls: list[float] = []
    all_oos_pnl_records: list[dict] = []
    all_oos_equity: list[float] = []
    # Multi-model WRC/SPA: each path's daily P&L series tracked separately so
    # whites_reality_check_multi / hansens_spa_multi can build the (L, T) matrix.
    per_path_oos_pnls: list[list[float]] = []

    _shared_req = BacktestRequest(
        strategy=config,
        start_date=request.start_date,
        end_date=request.end_date,
        slippage_ticks=request.slippage_ticks,
        commission_per_side=request.commission_per_side,
        firm_key=request.firm_key,
        max_trades_per_day=request.max_trades_per_day,
        event_calendar=request.event_calendar,
        fill_model=request.fill_model,
    )

    for test_fold_indices in _combos(range(n_splits), k_test_groups):
        is_fold_indices = [fi for fi in range(n_splits) if fi not in test_fold_indices]
        test_fold_set = set(test_fold_indices)

        # IS data — bilateral IS-side purge (Wave C hardening).
        # López de Prado AFML Ch.7: IS bars temporally adjacent to an OOS fold
        # boundary carry forward label information from the OOS window (Style C
        # runners can hold across the fold edge, option expiry / roll effects can
        # propagate backwards).  Purge those bars from each IS fold on the side(s)
        # that face an OOS fold, using _cpcv_fold_embargo_strips() for the math.
        #
        # Previous behaviour (pre-Wave C): no IS-side strip — is_data included ALL
        # embargo-adjacent IS bars, making WFE and PBO mildly optimistic.
        is_fold_dfs_purged: list[pl.DataFrame] = []
        for fi in sorted(is_fold_indices):
            fold_df = folds[fi]
            strip_start, strip_end = _cpcv_fold_embargo_strips(
                fold_idx=fi,
                test_fold_set=test_fold_set,
                n_splits=n_splits,
                embargo_bars=embargo_bars,
                is_test_fold=False,
            )
            effective_len = len(fold_df) - strip_start - strip_end
            if effective_len > 0:
                is_fold_dfs_purged.append(fold_df.slice(strip_start, effective_len))
            else:
                print(
                    f"  CPCV: IS fold {fi} too small ({len(fold_df)} bars <= "
                    f"purge start={strip_start}+end={strip_end}) — skipping.",
                    file=sys.stderr,
                )
        if is_fold_dfs_purged:
            is_data = pl.concat(is_fold_dfs_purged)
        else:
            continue  # No usable IS data after purge — skip this path

        # OOS data — bilateral embargo strip (Wave C hardening: adds OOS-end strip).
        # - Strip START: bars adjacent to the preceding IS fold (was already present).
        # - Strip END  : bars adjacent to the following IS fold (NEW — was missing).
        # Contiguous OOS↔OOS boundaries receive zero strip — no IS contamination
        # crosses that edge.  _cpcv_fold_embargo_strips() encodes the adjacency rule.
        #
        # Previous behaviour (pre-Wave C): only the START was stripped.
        # fold_df.slice(embargo_bars, len(fold_df) - embargo_bars) kept the last
        # embargo_bars rows intact, leaving IS→OOS leakage at the OOS-end boundary.
        oos_parts: list[pl.DataFrame] = []
        for ti in sorted(test_fold_indices):
            fold_df = folds[ti]
            strip_start, strip_end = _cpcv_fold_embargo_strips(
                fold_idx=ti,
                test_fold_set=test_fold_set,
                n_splits=n_splits,
                embargo_bars=embargo_bars,
                is_test_fold=True,
            )
            effective_len = len(fold_df) - strip_start - strip_end
            if effective_len > 0:
                oos_parts.append(fold_df.slice(strip_start, effective_len))
            else:
                # FIX 6 (2026-06-22) extended: bilateral check — fold too small after
                # full bilateral embargo strip — skip entirely.
                # Pre-Wave C: only tested start-strip (len > embargo_bars).
                # Now: len must exceed start_strip + end_strip (stricter, correct).
                print(
                    f"  CPCV: fold {ti} too small ({len(fold_df)} bars <= "
                    f"purge start={strip_start}+end={strip_end}) "
                    f"— skipping to preserve embargo integrity.",
                    file=sys.stderr,
                )

        if not oos_parts:
            continue
        oos_data = pl.concat(oos_parts)

        if len(oos_data) == 0:
            continue

        # Seed: base + path index for determinism
        path_seed = _base_seed + n_paths
        os.environ["BACKTEST_WINDOW_SEED"] = str(path_seed)
        np.random.seed(path_seed)

        try:
            path_result = run_backtest(_shared_req, data=oos_data, warmup_data=is_data)
        except Exception as _path_exc:
            # FIX 3 (2026-06-22): do NOT increment n_paths on failure — failed paths
            # were being counted in the denominator, diluting the PBO overfit signal.
            # n_paths counts successfully appended paths only (incremented below after append).
            print(
                f"CPCV path failed: {_path_exc!r}. Skipping (not counting in n_paths).",
                file=sys.stderr,
            )
            continue

        path_sharpes.append(float(path_result.get("sharpe_ratio", 0.0)))
        path_returns.append(float(path_result.get("total_return", 0.0)))
        all_oos_trades.extend(path_result.get("trades", []))
        _path_daily_pnls = list(path_result.get("daily_pnls", []))
        all_oos_pnls.extend(_path_daily_pnls)
        # Track per-path series for multi-model WRC/SPA (White 2000 / Hansen 2005)
        per_path_oos_pnls.append(_path_daily_pnls)
        all_oos_pnl_records.extend(path_result.get("daily_pnl_records", []))
        # equity_bars is raw float[] equity per bar; equity_curve is list[dict] (daily agg).
        # Use equity_bars for drawdown math to avoid dict → float cast error.
        _raw_eq = path_result.get("equity_bars", [])
        if not _raw_eq:
            # Fallback: extract value from equity_curve dicts when equity_bars absent
            _raw_eq = [
                float(rec.get("equity", rec.get("value", 0)))
                for rec in path_result.get("equity_curve", [])
                if isinstance(rec, dict)
            ]
        all_oos_equity.extend(_raw_eq)
        n_paths += 1

    if not path_sharpes:
        return {
            "confidence": "LOW",
            "low_confidence_windows": 0,
            "oos_metrics": {"total_return": 0, "sharpe_ratio": 0, "max_drawdown": 0,
                            "win_rate": 0, "profit_factor": 0, "total_trades": 0,
                            "avg_trade_pnl": 0, "avg_daily_pnl": 0},
            "wf_metadata": {
                "mode": "cpcv", "n_folds": n_splits, "embargo_pct": 0.01,
                "purge_window": embargo_bars, "n_paths": 0,
                "psr": None, "dsr": None,
            },
            "trades": [],
            "daily_pnls": [],
            "windows": [],
            # Wave 3 Track 3A: BIF absent on empty-path early return.
            "bif": None,
            "k_eff": 0,
            # WRC/SPA: no paths completed → unavailable.
            "wrc_result": {"available": False, "reason": "no CPCV paths completed"},
            "spa_result": {"available": False, "reason": "no CPCV paths completed"},
            "execution_time_ms": int((time.time() - start_time) * 1000),
        }

    # ── Aggregate from all paths ─────────────────────────────────────────────
    total_trades = len(all_oos_trades)
    total_return = sum(path_returns)

    if all_oos_pnls:
        pnl_arr = np.array(all_oos_pnls)
        agg_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if np.std(pnl_arr, ddof=1) > 0 else 0.0
    else:
        agg_sharpe = 0.0

    # Max drawdown from concatenated equity
    if all_oos_equity:
        eq_arr = np.array(all_oos_equity, dtype=float)
        running_peak = np.maximum.accumulate(eq_arr)
        max_dd = float(np.max(running_peak - eq_arr))
    else:
        max_dd = 0.0

    gross_wins = sum(float(t.get("PnL", t.get("pnl", 0))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
    gross_losses = sum(abs(float(t.get("PnL", t.get("pnl", 0)))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) < 0)
    agg_pf = float(gross_wins / gross_losses) if gross_losses > 0 else 999.99
    agg_win_rate = float(sum(1 for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0) / max(total_trades, 1))
    avg_daily = float(np.mean(all_oos_pnls)) if all_oos_pnls else 0.0

    # ── PSR / DSR across CPCV paths ──────────────────────────────────────────
    # PSR = fraction of paths where path Sharpe > Sharpe* (the expected max under null).
    # F-4 DSR n_trials: use effective_n_trials = max(n_paths, trial_n_total) when
    # DSR_USE_NTOTAL=true (default). trial_n_total is the cumulative mutation count for
    # this strategy across all evolution cycles — using it as the denominator prevents
    # the 2–5× Sharpe inflation that occurs when treating each run as if only n_paths
    # (15 CPCV paths) trials were ever proposed. Fail-safe: trial_n_total < 1 → treated
    # as 1, so effective_n_trials never drops below n_paths.
    _trial_n_total: int = max(1, getattr(request, "trial_n_total", 1))
    _effective_n_trials: int = (
        max(n_paths, _trial_n_total) if _DSR_USE_NTOTAL else n_paths
    )
    try:
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio as _cpcv_dsr

        _n_obs = len(all_oos_pnls)
        _dsr_result = _cpcv_dsr(
            observed_sharpe=agg_sharpe,
            n_trials=_effective_n_trials,
            n_observations=max(_n_obs, 2),
        )
        _psr = float(sum(1 for s in path_sharpes if s > 0) / max(len(path_sharpes), 1))
        _dsr_val = _dsr_result.get("dsr")
    except Exception as _dsr_exc:
        # FIX 7 (2026-06-22): emit walk_forward.dsr_computation_failed audit signal
        # and set dsr_pass=False so TS consumer can block instead of silently proceeding.
        # Previous code swallowed the exception and returned dsr=None which TS treats
        # as pass-through (None → no gate applied → overfitted strategy proceeds).
        print(
            f"  DSR (CPCV): computation failed ({_dsr_exc!r}) — "
            f"emitting walk_forward.dsr_computation_failed, dsr_pass=False.",
            file=sys.stderr,
        )
        _dsr_result = {
            "dsr": None,
            "dsr_pass": False,
            "dsr_unavailable": True,
            "error": str(_dsr_exc),
            "error_type": type(_dsr_exc).__name__,
        }
        _psr = None
        _dsr_val = None

    elapsed_ms = int((time.time() - start_time) * 1000)

    # ── Wave 3 Track 3A: BIF computation (CPCV mode) ─────────────────────────
    # K_eff = n_paths (C(6,2)=15 combinatorial paths per default CPCV config).
    # IS Sharpe proxy = mean(path_OOS_sharpes) — uses the same OOS series as
    # agg_sharpe (M1 limitation: BIF ≈ 1.0, block gate never fires in default
    # CPCV mode).  The result dict carries bif_proxy_basis="oos_mean_not_is" so
    # the TS BIF gate can emit a non-blocking audit warn.
    # Per-path IS Sharpes (using true IS fold data) are a Wave 30 carry-forward
    # per the comment at the top of the CPCV combinations loop.
    _cpcv_bif_result: dict = {}
    try:
        from src.engine.statistics.backtest_inflation_factor import (
            compute_bif as _cpcv_compute_bif,
        )
        # B4 fix: use mean of path OOS Sharpes as the IS-Sharpe proxy, not max.
        # max(path_sharpes) overstates IS performance because it cherry-picks the
        # best CPCV path — this deflates BIF (IS/OOS gap appears small) when the
        # true per-path IS Sharpe is unknown (pooled across folds).
        # WAVE 30 carry-forward: derive true per-path IS Sharpe from IS fold data.
        _cpcv_bif_is_sharpe = float(np.mean(path_sharpes)) if path_sharpes else 0.0
        _cpcv_bif_k_eff = float(max(n_paths, 1))
        _cpcv_bif_result = _cpcv_compute_bif(
            is_sharpe=_cpcv_bif_is_sharpe,
            wf_sharpe=agg_sharpe,
            k_eff=_cpcv_bif_k_eff,
        )
        # M1 fix 2026-06-28: tag the BIF result so the TS BIF gate can emit a
        # non-blocking audit warn. In CPCV mode both is_sharpe and wf_sharpe
        # derive from the same OOS series → BIF ≈ 1.0 (near-no-op).
        # TS gate reads bif_proxy_basis from wf_metadata.bif_proxy_basis.
        _cpcv_bif_result["bif_proxy_basis"] = "oos_mean_not_is"
        # BYPASS 3 EXPLICIT AUDIT (2026-06-28 hardening): IS Sharpe is unavailable
        # in CPCV mode without running a separate IS backtest per path (Wave 30
        # carry-forward). bif_reliable=False surfaces this fact explicitly so the
        # TS BIF gate logs a documented audit-warn rather than treating BIF≈1.0 as
        # a genuine clean-gate pass. The gate must NOT block on an unreliable BIF.
        _cpcv_bif_result["bif_reliable"] = False
        print(
            f"  BIF (CPCV): {_cpcv_bif_result.get('bif', 'N/A'):.4f} "
            f"(IS_proxy={_cpcv_bif_is_sharpe:.4f}, WF={agg_sharpe:.4f}, "
            f"K_eff={_cpcv_bif_k_eff:.0f}) "
            f"→ {_cpcv_bif_result.get('verdict', 'N/A')}",
            file=sys.stderr,
        )
    except Exception as _cpcv_bif_exc:
        print(
            f"  BIF (CPCV): computation failed ({_cpcv_bif_exc!r}) — "
            f"skipping (non-blocking, bif=None in output).",
            file=sys.stderr,
        )

    # ── Wave 29 Pass A.2: compute pbo_overall from CPCV paths ────────────────
    # In CPCV mode, path_sharpes ARE the per-path OOS Sharpes.
    # We treat each path's OOS Sharpe as both is_sharpe and oos_sharpe when
    # we don't have per-path IS Sharpes (the IS data is pooled across folds).
    # This is conservative — a more accurate implementation would track per-path
    # IS Sharpes during the combinations loop above (Wave 30 carry-forward).
    _cpcv_pbo_overall: Optional[float] = None
    _cpcv_pbo_p_value: Optional[float] = None
    _cpcv_pbo_audit_actions: list[str] = []
    # BYPASS 2 EXPLICIT AUDIT (2026-06-28 hardening): track the degenerate reason
    # so the TS lifecycle gate receives a distinct "cpcv_is_sharpe_unavailable"
    # label rather than the generic legacy-null grandfather-PASS path.
    # (Merge 2026-06-29: adopted over the deepscan-wiring BLOCK approach — CPCV is the
    # default WF_MODE, so BLOCK-on-degenerate would strangle the whole pipeline.)
    _cpcv_pbo_degenerate_reason: Optional[str] = None
    try:
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths as _cpcv_pbo_fn
        _cpcv_path_dicts = [
            {"is_sharpe": s, "oos_sharpe": s, "is_returns": [], "oos_returns": []}
            for s in path_sharpes
        ]
        _cpcv_gate = _cpcv_pbo_fn(_cpcv_path_dicts)
        # Override the generic degenerate reason with a CPCV-specific auditable
        # label so the TS lifecycle gate can distinguish this case from other
        # degenerate-PBO paths (e.g., a genuine IS==OOS backtest outcome).
        # The generic pbo_gate message correctly explains WHY is==oos, but the
        # "cpcv_is_sharpe_unavailable" label is more actionable for gate routing.
        if _cpcv_gate.get("degenerate"):
            _cpcv_gate["degenerate_reason"] = "cpcv_is_sharpe_unavailable"
        _cpcv_pbo_degenerate_reason = _cpcv_gate.get("degenerate_reason")
        _cpcv_pbo_val = _cpcv_gate.get("pbo")
        if _cpcv_pbo_val is not None and not (
            isinstance(_cpcv_pbo_val, float) and (_cpcv_pbo_val != _cpcv_pbo_val)
        ):
            _cpcv_pbo_overall = _cpcv_pbo_val
            _cpcv_pbo_p_value = _cpcv_gate.get("p_value")
            _pbo_threshold_cpcv = float(os.environ.get(
                "PBO_OVERFIT_THRESHOLD", str(_PBO_OVERFIT_THRESHOLD_DEFAULT)
            ))
            _cpcv_pbo_audit_actions.append("walk_forward.pbo_computed")
            if _cpcv_pbo_val > _pbo_threshold_cpcv:
                _cpcv_pbo_audit_actions.append("walk_forward.pbo_high_overfit_risk")
        elif _cpcv_gate.get("degenerate"):
            # CPCV mode uses is_sharpe == oos_sharpe (no per-path IS data) → pbo_gate.py
            # fires the degenerate guard → pbo=None. The degenerate_reason
            # ("cpcv_is_sharpe_unavailable") is already set at line 583-585; the TS
            # lifecycle gate PROCEEDS with an explicit cpcv_exempt audit (NOT a silent
            # grandfather-pass, and NOT a BLOCK — CPCV is the default WF_MODE, so blocking
            # would strangle the whole pipeline; Wave 30 per-path IS Sharpe is the real fix).
            _cpcv_pbo_audit_actions.append("walk_forward.pbo_cpcv_degenerate")
            print(
                "  PBO (cpcv gate): degenerate — IS==OOS for all paths "
                "(per-path IS unavailable in CPCV mode); emitting "
                "pbo_degenerate_reason='cpcv_is_sharpe_unavailable' "
                "→ TS gate PROCEEDS with cpcv_exempt audit "
                "(walk_forward.pbo_cpcv_degenerate)",
                file=sys.stderr,
            )
    except Exception as _cpcv_pbo_exc:
        print(f"  PBO (cpcv gate): computation failed ({_cpcv_pbo_exc}).", file=sys.stderr)

    # ── WRC + SPA — multi-model data-snooping guard (White 2000 / Hansen 2005) ─
    # Upgraded from single-series to proper multiple-comparison construction:
    #   Model universe: the L = n_paths CPCV OOS series (each path is one "model")
    #   Observed stat:  max_k(mean(excess_k)) — max mean excess return across paths
    #   Bootstrap null: shared time-index resample applied to ALL L series jointly,
    #                   preserving cross-path correlation
    #   Šidák:          if n_total_trials > n_paths, inflate p for additional snooping
    #
    # This is the correct institutional construction: a single-series test is
    # mathematically equivalent to a t-test on the mean and is blind to having
    # selected the winner from L path candidates.  The multi-model null builds
    # the distribution of the MAX statistic — not one series' mean — so a path
    # that was lucky best-of-L gets a higher p-value than one with genuine
    # positive edge on every fold.
    #
    # Fail-soft: emit {available: false, reason} when insufficient data.
    # NEVER emit a fake-passing p-value on insufficient data.
    # Key contract: p_value and spa_consistent_p are preserved for TS gate.
    _WRC_MIN_OBS = 20  # floor below which stationary bootstrap is unreliable
    _cpcv_wrc_result: dict = {}
    _cpcv_spa_result: dict = {}
    _rng_seed_cpcv = int(os.environ.get("BACKTEST_SEED", "42"))
    # Paths with sufficient data to participate in the multi-model bootstrap
    _eligible_paths = [p for p in per_path_oos_pnls if len(p) >= _WRC_MIN_OBS]
    if len(_eligible_paths) >= 2:
        try:
            from src.engine.statistics.hansens_spa import (
                hansens_spa_multi as _spa_multi,
            )
            from src.engine.statistics.whites_reality_check import (
                whites_reality_check_multi as _wrc_multi,
            )
            # Truncate all paths to minimum length so the matrix is rectangular.
            # Using min-length avoids padding artifacts; shorter paths typically
            # arise from CPCV embargo stripping at fold boundaries (small loss).
            _min_path_len = min(len(p) for p in _eligible_paths)
            _perf_matrix = np.array(
                [p[:_min_path_len] for p in _eligible_paths], dtype=float
            )  # (L, T)
            _bench_matrix = np.zeros_like(_perf_matrix)
            _cpcv_wrc_result = _wrc_multi(
                performance_matrix=_perf_matrix,
                benchmark_matrix=_bench_matrix,
                n_total_trials=_trial_n_total,
                k_eff=n_paths,
                rng_seed=_rng_seed_cpcv,
            )
            _cpcv_spa_result = _spa_multi(
                performance_matrix=_perf_matrix,
                benchmark_matrix=_bench_matrix,
                n_total_trials=_trial_n_total,
                k_eff=n_paths,
                rng_seed=_rng_seed_cpcv + 1,
            )
            print(
                f"  WRC multi (CPCV): p={_cpcv_wrc_result.get('p_value', 'N/A'):.4f} "
                f"{'PASS' if _cpcv_wrc_result.get('passed') else 'FAIL'} | "
                f"SPA consistent_p={_cpcv_spa_result.get('spa_consistent_p', 'N/A'):.4f} "
                f"{'PASS' if _cpcv_spa_result.get('passed') else 'FAIL'} "
                f"(n_models={len(_eligible_paths)}, T={_min_path_len}, "
                f"n_total={_trial_n_total}, sidak={_cpcv_wrc_result.get('sidak_adjusted')})",
                file=sys.stderr,
            )
        except Exception as _cpcv_wrc_exc:
            print(
                f"  WRC/SPA multi (CPCV): computation failed ({_cpcv_wrc_exc!r}) — "
                f"emitting available=false (non-blocking).",
                file=sys.stderr,
            )
            _cpcv_wrc_result = {"available": False, "reason": str(_cpcv_wrc_exc)}
            _cpcv_spa_result = {"available": False, "reason": str(_cpcv_wrc_exc)}
    elif len(all_oos_pnls) >= _WRC_MIN_OBS:
        # Fallback: < 2 eligible paths but concatenated series is long enough.
        # Use single-series (backward-compat); no multi-model correction possible.
        try:
            from src.engine.statistics.hansens_spa import hansens_spa as _spa_fn
            from src.engine.statistics.whites_reality_check import (
                whites_reality_check as _wrc_fn,
            )
            _benchmark_zeros = [0.0] * len(all_oos_pnls)
            _cpcv_wrc_result = _wrc_fn(
                strategy_returns=all_oos_pnls,
                benchmark_returns=_benchmark_zeros,
                rng_seed=_rng_seed_cpcv,
            )
            _cpcv_spa_result = _spa_fn(
                strategy_returns=all_oos_pnls,
                benchmark_returns=_benchmark_zeros,
                rng_seed=_rng_seed_cpcv + 1,
            )
            print(
                f"  WRC single (CPCV fallback, <2 eligible paths): "
                f"p={_cpcv_wrc_result.get('p_value', 'N/A'):.4f} "
                f"{'PASS' if _cpcv_wrc_result.get('passed') else 'FAIL'} | "
                f"SPA consistent_p={_cpcv_spa_result.get('spa_consistent_p', 'N/A'):.4f} "
                f"(n_obs={len(all_oos_pnls)})",
                file=sys.stderr,
            )
        except Exception as _cpcv_wrc_exc2:
            print(
                f"  WRC/SPA single (CPCV fallback): computation failed ({_cpcv_wrc_exc2!r}) — "
                f"emitting available=false (non-blocking).",
                file=sys.stderr,
            )
            _cpcv_wrc_result = {"available": False, "reason": str(_cpcv_wrc_exc2)}
            _cpcv_spa_result = {"available": False, "reason": str(_cpcv_wrc_exc2)}
    else:
        _insufficient_reason = (
            f"insufficient OOS observations: {len(all_oos_pnls)} < {_WRC_MIN_OBS} minimum"
        )
        _cpcv_wrc_result = {"available": False, "reason": _insufficient_reason}
        _cpcv_spa_result = {"available": False, "reason": _insufficient_reason}
        print(
            f"  WRC/SPA (CPCV): skipped — {_insufficient_reason}",
            file=sys.stderr,
        )

    return {
        "confidence": "OK" if total_trades >= MIN_OOS_TRADES else "LOW",
        "low_confidence_windows": 0,
        "oos_metrics": {
            "total_return": round(total_return, 2),
            "sharpe_ratio": round(agg_sharpe, 4),
            "max_drawdown": round(max_dd, 2),
            "win_rate": round(agg_win_rate, 4),
            "profit_factor": round(agg_pf, 4),
            "total_trades": total_trades,
            "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
            "avg_daily_pnl": round(avg_daily, 2),
        },
        "trades": all_oos_trades,
        "daily_pnls": all_oos_pnls,
        "daily_pnl_records": all_oos_pnl_records,
        "equity_curve": all_oos_equity,
        "windows": [],
        "n_splits": n_splits,
        "is_ratio": 1.0 - (k_test_groups / n_splits),
        "execution_time_ms": elapsed_ms,
        # BYPASS 1 EXPLICIT AUDIT (2026-06-28 hardening): WFE is mathematically
        # undefined in CPCV mode because there is no single pooled IS Sharpe to
        # divide against the OOS aggregate. The plain-WF path produces wfe_overall
        # from _combined_is_sharpe; CPCV has no such value without extra IS backtests.
        # Emitting wfe_overall=None + wfe_status="cpcv_not_applicable" lets the TS
        # wfe-gate.ts emit a documented exemption audit action instead of routing
        # through the legacy_null grandfather-PASS path silently.
        "wfe_overall": None,
        "wfe_status": "cpcv_not_applicable",
        "wf_metadata": {
            "mode": "cpcv",
            "n_folds": n_splits,
            "embargo_pct": 0.01,
            "purge_window": embargo_bars,
            "n_paths": n_paths,
            "psr": _psr,
            "dsr": _dsr_val,
            # FIX 7: surface dsr_pass and dsr_unavailable so TS consumer can block.
            # When DSR computation succeeds, these keys come from _dsr_result.
            # When DSR computation fails, _dsr_result has dsr_pass=False, dsr_unavailable=True.
            "dsr_pass": _dsr_result.get("dsr_pass"),
            "dsr_unavailable": _dsr_result.get("dsr_unavailable", False),
            # M1 fix 2026-06-28: surface bif_proxy_basis so the TS BIF gate can
            # emit a non-blocking audit warn.  "oos_mean_not_is" signals that both
            # is_sharpe and wf_sharpe derive from the same OOS series → BIF ≈ 1.0.
            "bif_proxy_basis": _cpcv_bif_result.get("bif_proxy_basis"),
            # BYPASS 3 EXPLICIT AUDIT: bif_reliable=False when IS Sharpe unavailable.
            # TS BIF gate must not block on an unreliable BIF≈1.0 value.
            "bif_reliable": _cpcv_bif_result.get("bif_reliable", True),
            # BYPASS 2 EXPLICIT AUDIT (merge 2026-06-29): surface the CPCV-specific
            # degenerate reason INSIDE wf_metadata so it survives backtest-service
            # persistence (which stores the wf_metadata sub-dict wholesale) and is read
            # by lifecycle-service at wf_metadata.pbo_degenerate_reason. Placing it at
            # the top level would NOT be persisted (backtest-service cherry-picks only
            # pbo_overall/pbo_overall_p_value there) → the cpcv_exempt path would never
            # fire and the gate would silently grandfather-PASS. "cpcv_is_sharpe_unavailable"
            # is distinguishable from the generic legacy_null grandfather-PASS.
            "pbo_degenerate_reason": _cpcv_pbo_degenerate_reason,
        },
        # Wave 29 Pass A.2 — pbo_overall for TESTING → SHADOW/PAPER lifecycle gate.
        "pbo_overall": _cpcv_pbo_overall,
        "pbo_overall_p_value": _cpcv_pbo_p_value,
        "pbo_audit_actions": _cpcv_pbo_audit_actions,
        # Wave 3 Track 3A — BIF (Backtest Inflation Factor): selection-bias ratio.
        # In CPCV mode IS Sharpe tracking is a Wave 30 carry-forward; we use
        # max(path_sharpes) as a documented proxy for the best-looking path.
        # K_eff = n_paths (C(6,2)=15 default combinatorial paths).
        # TS gate contract: reads "bif" and "k_eff" from this dict.
        "bif": _cpcv_bif_result.get("bif"),
        "k_eff": _cpcv_bif_result.get("k_eff"),
        "bif_detail": _cpcv_bif_result,
        # WRC / SPA — data-snooping guard on concatenated CPCV OOS P&L series.
        # TS gate contract: reads wrc_result.p_value / spa_result.spa_consistent_p.
        # When available=False the TS gate treats these as null → fail-CLOSED
        # (unless PROMOTION_GRANDFATHER_PRE_PASS_E=true is explicitly set).
        "wrc_result": _cpcv_wrc_result,
        "spa_result": _cpcv_spa_result,
    }


def run_walk_forward(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    n_splits: int = 5,
    is_ratio: float = 0.7,
    optimize: bool = False,
    n_trials: int = 800,
    embargo_bars: int = 20,
    wf_mode: Optional[str] = None,
) -> dict:
    """Run walk-forward validation.

    For each window:
    1. Optionally optimize on IS data with Optuna
    2. Run backtest on OOS data with best params
    3. Aggregate OOS metrics = the only numbers that count

    Args:
        request: Backtest configuration
        data: Optional pre-loaded data
        n_splits: Number of walk-forward windows (default 5)
        is_ratio: IS fraction per window (default 0.7)
        optimize: Whether to run Optuna optimization per window
        n_trials: Optuna trials per window if optimizing
        wf_mode: Walk-forward mode — "plain" (default, backward compat),
            "purged_embargo" (Lopez de Prado AFML Ch.7 purge + embargo),
            "cpcv" (combinatorial purged CV, N=6 splits k=2 test groups → 15 paths).
            Overrides WF_MODE env var. Env default is "plain".

    Returns:
        dict with oos_metrics (aggregate), windows (per-window detail),
        wf_metadata (mode, n_folds, embargo_pct, purge_window, n_paths for cpcv)
    """
    # ── Walk-forward mode resolution ─────────────────────────────────────────
    # FIX 3 (2026-06-22): Default changed from "plain" to "cpcv".
    # 2026 institutional standard is CPCV-by-default (combinatorial purged CV,
    # C(6,2)=15 paths with purge+embargo). "plain" is now the explicit opt-out.
    #
    # Priority: explicit wf_mode param > WF_MODE env > "cpcv" (new default)
    #
    # Auto-fallback: when default/cpcv is requested but data is insufficient
    # for 6 splits (each fold < MIN_CPCV_FOLD_BARS bars), we fall back to "plain"
    # automatically with a logged reason. This prevents hard-breaking low-data
    # backtests (e.g. short strategy histories, intraday with few days).
    _VALID_WF_MODES = ("plain", "purged_embargo", "cpcv")
    _resolved_mode = (
        wf_mode
        or os.environ.get("WF_MODE", "cpcv")  # FIX 3: default changed plain→cpcv
    ).lower()
    if _resolved_mode not in _VALID_WF_MODES:
        print(
            f"Walk-forward: unknown WF_MODE={_resolved_mode!r}; defaulting to 'cpcv'.",
            file=sys.stderr,
        )
        _resolved_mode = "cpcv"

    # FIX 3: CPCV auto-fallback check.
    # CPCV requires at least 6 folds with meaningful data per fold.
    # Minimum fold size = MIN_CPCV_FOLD_BARS bars (default: 60 bars = 3 RTH days at 15min).
    # When data is too short, fall back to plain and emit a structured audit reason.
    _CPCV_N_SPLITS = 6
    _MIN_CPCV_FOLD_BARS = int(os.environ.get("MIN_CPCV_FOLD_BARS", "60"))
    if _resolved_mode == "cpcv":
        # Check if data is sufficient for CPCV
        _check_data = data
        if _check_data is None:
            try:
                from src.engine.data_loader import load_ohlcv as _load_ohlcv_check
                _check_data = _load_ohlcv_check(
                    request.strategy.symbol, request.strategy.timeframe,
                    request.start_date, request.end_date,
                )
            except Exception:
                _check_data = None

        _cpcv_feasible = True
        if _check_data is not None:
            _fold_size = len(_check_data) // _CPCV_N_SPLITS
            if _fold_size < _MIN_CPCV_FOLD_BARS:
                _cpcv_feasible = False

        if not _cpcv_feasible:
            print(
                f"[walk_forward] CPCV auto-fallback: data has insufficient bars for "
                f"{_CPCV_N_SPLITS} folds × {_MIN_CPCV_FOLD_BARS} min bars/fold "
                f"(fold_size={_fold_size}). Falling back to 'plain'. "
                f"Set WF_MODE=plain explicitly to suppress this message, or extend "
                f"the backtest date range. Audit: walk_forward.cpcv_insufficient_data_fallback",
                file=sys.stderr,
            )
            try:
                from src.engine.audit_writer import write_audit_row_sync as _audit
                _audit(
                    action="walk_forward.cpcv_insufficient_data_fallback",
                    entity_type="walk_forward",
                    entity_id=getattr(request.strategy, "name", "unknown"),
                    severity="warn",
                    payload={
                        "requested_mode": "cpcv",
                        "fallback_mode": "plain",
                        "fold_size": _fold_size if _check_data is not None else None,
                        "min_fold_bars": _MIN_CPCV_FOLD_BARS,
                        "n_splits": _CPCV_N_SPLITS,
                        "reason": "Insufficient data for CPCV; auto-falling back to plain",
                    },
                )
            except Exception:
                pass  # Audit write must never block WF execution
            _resolved_mode = "plain"

    # Dispatch CPCV to dedicated implementation (Item 10, Wave 24 Pass 1).
    if _resolved_mode == "cpcv":
        return _run_walk_forward_cpcv(
            request=request,
            data=data,
            embargo_bars=embargo_bars,
        )

    # purged_embargo and plain share the same windowing engine but with
    # a purge window applied in the purged_embargo case.
    _embargo_pct = float(os.environ.get("WF_EMBARGO_PCT", "0.01"))
    _purge_window = int(os.environ.get("WF_PURGE_WINDOW", "0"))
    if _resolved_mode == "purged_embargo" and _purge_window == 0:
        # Default purge window = 20 bars (covers typical multi-bar Style C runner holds)
        _purge_window = int(os.environ.get("WF_PURGE_WINDOW", "20"))

    start_time = time.time()
    config = request.strategy

    # Load data if not provided
    if data is None:
        from src.engine.data_loader import load_ohlcv
        data = load_ohlcv(
            config.symbol, config.timeframe,
            request.start_date, request.end_date,
        )

    # F-2 FIX: Auto-reduce n_splits using timeframe-aware bar count.
    # Previous formula used MIN_OOS_DAYS bare (60 bars) which is correct for daily
    # data but massively undershoots for intraday: 60 bars of 15min = ~1 day, not 60.
    # Fix: multiply MIN_OOS_DAYS by BARS_PER_DAY[timeframe] to get the true minimum
    # bar count required per OOS window. BARS_PER_DAY uses Globex figures from
    # backtester.py (5min=172, 15min=92, 1hour=23, daily=1, etc.).
    total_bars = len(data)
    oos_fraction = 1.0 - is_ratio
    bars_per_day = BARS_PER_DAY.get(config.timeframe, 1)
    min_oos_bars = MIN_OOS_DAYS * bars_per_day  # true bar count for MIN_OOS_DAYS of data
    required_bars_per_split = int(min_oos_bars / oos_fraction)

    original_splits = n_splits
    while n_splits > 1 and (total_bars // n_splits) < required_bars_per_split:
        n_splits -= 1

    if n_splits < original_splits:
        print(
            f"Walk-forward: auto-reduced n_splits from {original_splits} to {n_splits} "
            f"(data too short for {original_splits} meaningful OOS windows; "
            f"need {required_bars_per_split} bars/split for {MIN_OOS_DAYS}d OOS "
            f"at {config.timeframe}={bars_per_day} bars/day)",
            file=sys.stderr,
        )

    # For purged_embargo mode, add the purge window to the embargo_bars so that
    # IS training samples whose label window overlaps the OOS test window are excluded.
    # This implements Lopez de Prado AFML Ch. 7 purging logic:
    # The purge window = max expected bars-per-trade-holding (Style C runner default: 20).
    # The embargo % is an additional gap after OOS to prevent leakage into next IS slice.
    _effective_embargo = embargo_bars
    if _resolved_mode == "purged_embargo" and _purge_window > 0:
        _effective_embargo = embargo_bars + _purge_window
        print(
            f"Walk-forward (purged_embargo): purge_window={_purge_window} bars added to embargo. "
            f"Total embargo = {_effective_embargo} bars.",
            file=sys.stderr,
        )

    windows = split_walk_forward_windows(data, n_splits, is_ratio, embargo_bars=_effective_embargo)
    print(f"Walk-forward: {len(windows)} windows, IS ratio={is_ratio}", file=sys.stderr)

    window_results = []
    all_oos_pnls: list[float] = []
    all_oos_pnl_records: list[dict] = []
    all_oos_equity: list[float] = []
    # WF Fix 1: bar-level equity accumulator for intraday max DD computation.
    all_oos_equity_bars: list[float] = []
    all_oos_trades: list[dict] = []
    # Multi-model WRC/SPA: per-window deduplicated P&L series (same dedup applied
    # in accumulation below) so the (L, T) matrix reflects what was actually added.
    per_window_oos_pnls: list[list[float]] = []
    # WFE accumulators — collect IS daily P&Ls for combined-fold IS Sharpe.
    # We run a lightweight IS backtest (no optimization, fixed config) so we
    # can compute WFE = combined_OOS_Sharpe / combined_IS_Sharpe.
    all_is_pnls: list[float] = []
    # Regime per window — populated from the IS backtest result's bias context
    # or from config.preferred_regime as a static fallback.
    _per_window_regimes: list[Optional[str]] = []

    # ─── Phase 12: Parallel OOS window dispatch ─────────────────────────────
    # When not optimizing (Optuna uses SQLite which is single-writer), dispatch
    # all windows in parallel via ProcessPoolExecutor.
    #
    # Worker cap: min(n_windows, cpu_count-1, WF_MAX_WORKERS env) so at least
    # 1 core stays free for the OS and the Node parent process.
    # DETERMINISM: each worker is seeded with (base_seed + window_index) so
    # identical inputs always produce identical outputs per window. The base seed
    # comes from BACKTEST_SEED env (default 42).
    #
    # Fallback: if parallelism fails for any reason (Windows fork issues,
    # memory pressure, etc.) we fall back to serial execution — no data loss.
    _use_parallel = (
        not optimize
        and os.environ.get("WF_PARALLEL", "1") == "1"
        and len(windows) > 1
    )
    # Phase 14 concurrency fix: default WF_MAX_WORKERS=2 (was 4).
    # Under 6 concurrent backtests: 6 × 4 workers = 24 simultaneous Python
    # subprocesses → OOM → server crash. At 2 workers: 6 × 2 = 12 subprocesses,
    # which fits within the 8-core tower's memory budget (~400 MB per worker for
    # 10yr Parquet load + vectorbt).
    # Override with WF_MAX_WORKERS=4 for dedicated promotion-gate runs where only
    # 1 backtest is in flight at a time.
    _max_workers_env = int(os.environ.get("WF_MAX_WORKERS", "2"))
    # Leave 1 CPU for OS + Node parent; cap at env override
    _n_workers = min(len(windows), max(1, (os.cpu_count() or 2) - 1), _max_workers_env)
    _base_seed = int(os.environ.get("BACKTEST_SEED", "42"))

    # Build the shared OOS request template (config is the same for all windows when
    # not optimizing — each worker uses the same request but different data slices)
    _shared_oos_request = BacktestRequest(
        strategy=config,
        start_date=request.start_date,
        end_date=request.end_date,
        slippage_ticks=request.slippage_ticks,
        commission_per_side=request.commission_per_side,
        firm_key=request.firm_key,
        max_trades_per_day=request.max_trades_per_day,
        event_calendar=request.event_calendar,
        fill_model=request.fill_model,
    )

    if _use_parallel and _n_workers > 1:
        print(
            f"Walk-forward: launching {len(windows)} windows with {_n_workers} parallel workers",
            file=sys.stderr,
        )
        _worker_args = [
            (i, _shared_oos_request, oos_data, is_data, _base_seed)
            for i, (is_data, oos_data) in enumerate(windows)
        ]
        try:
            # 'spawn' is the safe context on Windows — avoids inheriting the DuckDB
            # singleton connection (which is not fork-safe) and numpy global state.
            _mp_ctx = concurrent.futures.ProcessPoolExecutor(
                max_workers=_n_workers,
                mp_context=multiprocessing.get_context("spawn"),
            )
            with _mp_ctx as executor:
                _futures = {executor.submit(_run_wf_window, arg): arg[0] for arg in _worker_args}
                # Collect results in window order (not submission order)
                _oos_results_by_idx: dict[int, dict] = {}
                for future in concurrent.futures.as_completed(_futures):
                    win_idx = _futures[future]
                    try:
                        _oos_results_by_idx[win_idx] = future.result()
                    except Exception as _wf_exc:
                        print(
                            f"  Walk-forward window {win_idx+1} parallel execution failed: {_wf_exc}. "
                            f"Falling back to serial for this window.",
                            file=sys.stderr,
                        )
                        # Fall back to serial execution for this window
                        _fb_is, _fb_oos = windows[win_idx]
                        _oos_results_by_idx[win_idx] = run_backtest(
                            _shared_oos_request, data=_fb_oos, warmup_data=_fb_is
                        )
            _oos_results_ordered = [_oos_results_by_idx[i] for i in range(len(windows))]
            print(f"Walk-forward: all {len(windows)} windows completed (parallel)", file=sys.stderr)
        except Exception as _parallel_exc:
            print(
                f"Walk-forward: parallel dispatch failed ({_parallel_exc}), falling back to serial",
                file=sys.stderr,
            )
            # Full serial fallback
            _oos_results_ordered = [
                run_backtest(_shared_oos_request, data=oos_d, warmup_data=is_d)
                for is_d, oos_d in windows
            ]
    else:
        # Serial path: used when optimize=True or WF_PARALLEL=0 or single window
        print(
            f"Walk-forward: running {len(windows)} windows serially"
            f"{' (optimize=True)' if optimize else ''}",
            file=sys.stderr,
        )
        _oos_results_ordered = []
        for i, (is_data, oos_data) in enumerate(windows):
            range_push(f"forge/wf_window_{i}")
            print(f"  Window {i+1}/{len(windows)}: IS={len(is_data)} bars, OOS={len(oos_data)} bars", file=sys.stderr)

            best_config = config
            opt_result_serial = None
            if optimize and len(is_data) > 50:
                opt_result_serial = optimize_strategy(config, is_data, n_trials=n_trials)
                if opt_result_serial["best_params"]:
                    space = _build_search_space(config)
                    best_config = _apply_params(config, opt_result_serial["best_params"], space)
                    print(f"    Optimized: applied {opt_result_serial['best_params']} (IS Sharpe={opt_result_serial['best_score']:.4f})", file=sys.stderr)

            _opt_req = BacktestRequest(
                strategy=best_config,
                start_date=request.start_date,
                end_date=request.end_date,
                slippage_ticks=request.slippage_ticks,
                commission_per_side=request.commission_per_side,
                firm_key=request.firm_key,
                max_trades_per_day=request.max_trades_per_day,
                event_calendar=request.event_calendar,
                fill_model=request.fill_model,
            )
            _window_res = run_backtest(_opt_req, data=oos_data, warmup_data=is_data)
            # Stash opt_result for later annotation (keyed by index)
            _window_res["_opt_result_serial"] = opt_result_serial  # type: ignore[assignment]
            _oos_results_ordered.append(_window_res)
            range_pop()

    # ─── Run IS backtests for WFE computation ────────────────────────────────
    # WFE = combined_OOS_Sharpe / combined_IS_Sharpe.
    # We run a lightweight IS backtest with the base config (no optimization) so
    # the IS Sharpe represents the unoptimized strategy performance on training data.
    # When optimize=True the IS Sharpe from the optimizer's best_score is used
    # directly (it already ran the IS backtest — we avoid a second pass).
    #
    # Failure is soft: if IS backtest errors, we skip WFE for that window and
    # fall back to wfe_overall=None at aggregation (no crash, no silent wrong value).
    _is_results_for_wfe: list[dict] = []
    _wfe_is_request = BacktestRequest(
        strategy=config,
        start_date=request.start_date,
        end_date=request.end_date,
        slippage_ticks=request.slippage_ticks,
        commission_per_side=request.commission_per_side,
        firm_key=request.firm_key,
        max_trades_per_day=request.max_trades_per_day,
        event_calendar=request.event_calendar,
        fill_model=request.fill_model,
    )
    for i, (is_data_wfe, _oos_data_wfe) in enumerate(windows):
        # Re-use optimizer IS Sharpe when available (serial optimize=True path).
        # For parallel path and non-optimize serial: run a fresh IS backtest.
        _opt_res_i = _oos_results_ordered[i].get("_opt_result_serial")
        if _opt_res_i and _opt_res_i.get("best_score") is not None:
            # Optimizer already ran IS — use its score directly (no extra backtest).
            _is_results_for_wfe.append({"daily_pnls": [], "_is_sharpe_from_opt": float(_opt_res_i["best_score"])})
        else:
            try:
                _is_res = run_backtest(_wfe_is_request, data=is_data_wfe)
                _is_results_for_wfe.append(_is_res)
            except Exception as _is_exc:
                print(
                    f"Walk-forward WFE: IS backtest window {i+1} failed ({_is_exc}). "
                    f"WFE will be skipped for this window.",
                    file=sys.stderr,
                )
                _is_results_for_wfe.append({})

    # ─── Assemble window_results from ordered OOS results ────────────────────
    def _ts_col(df: pl.DataFrame) -> str:
        for col in ("ts_event", "ts_et"):
            if col in df.columns:
                return col
        return ""

    for i, (is_data, oos_data) in enumerate(windows):
        oos_result = _oos_results_ordered[i]
        opt_result = oos_result.pop("_opt_result_serial", None)

        oos_trade_count = oos_result["total_trades"]
        oos_trading_days = oos_result.get("total_trading_days", 0)

        _is_ts = _ts_col(is_data)
        _oos_ts = _ts_col(oos_data)
        is_start_dt = str(is_data[_is_ts][0])[:10] if (len(is_data) > 0 and _is_ts) else ""
        is_end_dt = str(is_data[_is_ts][-1])[:10] if (len(is_data) > 0 and _is_ts) else ""
        oos_start_dt = str(oos_data[_oos_ts][0])[:10] if (len(oos_data) > 0 and _oos_ts) else ""
        oos_end_dt = str(oos_data[_oos_ts][-1])[:10] if (len(oos_data) > 0 and _oos_ts) else ""

        window_detail = {
            "window": i + 1,
            "is_bars": len(is_data),
            "oos_bars": len(oos_data),
            "is_start": is_start_dt,
            "is_end": is_end_dt,
            "oos_start": oos_start_dt,
            "oos_end": oos_end_dt,
            "oos_metrics": {
                "total_return": oos_result["total_return"],
                "sharpe_ratio": oos_result["sharpe_ratio"],
                "max_drawdown": oos_result["max_drawdown"],
                "win_rate": oos_result["win_rate"],
                "profit_factor": oos_result["profit_factor"],
                "total_trades": oos_trade_count,
                "total_trading_days": oos_trading_days,
                # P2-H fix: prefer the actual computed mean from the engine if present,
                # fall back to total_return/trades only when avg_trade_pnl is absent.
                "avg_trade_pnl": round(
                    oos_result.get("avg_trade_pnl", oos_result["total_return"] / max(oos_trade_count, 1)),
                    2,
                ),
                "avg_daily_pnl": round(float(sum(oos_result.get("daily_pnls", [])) / max(len(oos_result.get("daily_pnls", [])), 1)), 2),
            },
            "confidence": "OK",
        }

        # Flag statistically unreliable OOS windows
        warnings = []
        if oos_trade_count < MIN_OOS_TRADES:
            warnings.append(
                f"Only {oos_trade_count} OOS trades (min {MIN_OOS_TRADES}) — statistically unreliable"
            )
            window_detail["confidence"] = "LOW"
        if oos_trading_days < MIN_OOS_DAYS:
            warnings.append(
                f"Only {oos_trading_days} OOS days (min {MIN_OOS_DAYS}) — insufficient sample"
            )
            window_detail["confidence"] = "LOW"

        if warnings:
            window_detail["warning"] = "; ".join(warnings)
            print(f"  Walk-forward window {i+1}: {'; '.join(warnings)}", file=sys.stderr)

        if opt_result:
            window_detail["optimization"] = {
                "best_params": opt_result["best_params"],
                "best_sharpe": opt_result["best_score"],
                "trials_used": opt_result.get("trials_used", opt_result.get("n_trials", 0)),
            }

        window_results.append(window_detail)
        # P2-I fix: adjacent windows with embargo=0 can share a boundary trading date.
        # Deduplicate daily_pnl_records by date before extending to avoid double-counting.
        # daily_pnl_records are dicts with a "date" key (str "YYYY-MM-DD").
        _new_records = oos_result.get("daily_pnl_records", [])
        _existing_dates = {r.get("date") for r in all_oos_pnl_records if r.get("date")}
        _deduped_records = [r for r in _new_records if r.get("date") not in _existing_dates]
        _dupes = len(_new_records) - len(_deduped_records)
        if _dupes > 0:
            print(
                f"  Walk-forward dedup: dropped {_dupes} duplicate boundary-day P&L record(s) "
                f"at window {i+1} boundary (embargo=0 overlap).",
                file=sys.stderr,
            )
        all_oos_pnl_records.extend(_deduped_records)

        # For daily_pnls (scalar list), rebuild from deduplicated records to stay consistent.
        # FIX 5 (2026-06-22): previous logic `_deduped_pnls if _deduped_records else raw`
        # would fall through to UN-DEDUPED raw data when _deduped_records was empty (all dupes).
        # An empty _deduped_records means ALL records were duplicates — the correct
        # result is to add nothing (empty list), not to re-add the raw un-deduped data.
        _deduped_pnls = [r.get("pnl", 0.0) for r in _deduped_records]
        all_oos_pnls.extend(_deduped_pnls if len(_deduped_pnls) > 0 else [])
        # Track per-window deduplicated series for multi-model WRC/SPA.
        per_window_oos_pnls.append(list(_deduped_pnls))
        all_oos_equity.extend(oos_result.get("equity_curve", []))
        # WF Fix 1: collect raw bar-level equity for accurate intraday max DD.
        # equity_bars is a list[float] of bar-level equity values from the backtest result.
        # C-3 FIX: adjacent windows with embargo=0 share a boundary bar. Dedup by
        # dropping the last bar of window N when it equals the first bar of window N+1
        # (comparison by value). This mirrors the daily_pnl_records dedup above and
        # prevents the max-drawdown calculation from double-counting the boundary equity
        # level, which can artificially inflate or suppress the measured drawdown.
        _new_equity_bars = oos_result.get("equity_bars", [])
        if all_oos_equity_bars and _new_equity_bars:
            # Drop the overlapping boundary bar from the EXISTING tail if the new
            # window's first bar has the same value (same equity state at boundary).
            if abs(all_oos_equity_bars[-1] - _new_equity_bars[0]) < 1e-6:
                all_oos_equity_bars.pop()
                print(
                    f"  Walk-forward dedup: dropped duplicate boundary equity bar "
                    f"at window {i+1} boundary (value={_new_equity_bars[0]:.2f}).",
                    file=sys.stderr,
                )
        all_oos_equity_bars.extend(_new_equity_bars)
        all_oos_trades.extend(oos_result.get("trades", []))

        # ── Collect IS daily P&Ls for WFE computation ────────────────────────
        _is_res_i = _is_results_for_wfe[i] if i < len(_is_results_for_wfe) else {}
        if "_is_sharpe_from_opt" in _is_res_i:
            # Optimizer provided IS Sharpe directly — no daily_pnls to accumulate.
            # We stash this on window_detail for per-window WFE reporting.
            window_results[i]["_is_sharpe_opt"] = _is_res_i["_is_sharpe_from_opt"]
        else:
            _is_pnls_i = _is_res_i.get("daily_pnls", [])
            all_is_pnls.extend(_is_pnls_i)

        # ── Collect per-window regime for parameter stability regime-context ─
        # Strategy's preferred_regime field is the lightweight fallback when
        # the IS backtest does not emit a dominant_regime (most strategies
        # don't unless they run the bias engine explicitly).
        _window_regime: Optional[str] = (
            _is_res_i.get("dominant_regime")
            or oos_result.get("dominant_regime")
            or getattr(config, "preferred_regime", None)
        )
        _per_window_regimes.append(_window_regime)

    # Aggregate OOS metrics — recompute from ALL trades, never average per-window rates
    total_trades = len(all_oos_trades)
    total_return = float(sum(w["oos_metrics"]["total_return"] for w in window_results))  # Sum dollar P&L

    # Continuous max DD: prefer bar-level equity (captures intraday peaks), fall back to daily P&Ls.
    # Bar-level is critical for prop firm risk: a strategy with -$1800 close-to-close DD may have
    # -$2200 intraday, which breaches Topstep's $2,000 trailing limit live.
    if all_oos_equity_bars:
        eq_arr = np.array(all_oos_equity_bars, dtype=float)
        running_peak = np.maximum.accumulate(eq_arr)
        max_dd = float(np.max(running_peak - eq_arr))
    elif all_oos_pnls:
        cum_pnl = np.cumsum(all_oos_pnls)
        running_peak = np.maximum.accumulate(cum_pnl)
        max_dd = float(np.max(running_peak - cum_pnl))
    else:
        max_dd = 0.0

    # Win rate: count wins across ALL trades (not averaged per-window)
    if all_oos_trades:
        total_wins = sum(1 for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
        agg_win_rate = float(total_wins / len(all_oos_trades))
    else:
        agg_win_rate = 0.0

    # Profit factor: sum(gross wins) / sum(gross losses) across ALL trades
    gross_wins = sum(float(t.get("PnL", t.get("pnl", 0))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
    gross_losses = sum(abs(float(t.get("PnL", t.get("pnl", 0)))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) < 0)
    agg_pf = float(gross_wins / gross_losses) if gross_losses > 0 else 999.99

    # Sharpe: recompute from all daily P&Ls (not averaged per-window)
    if len(all_oos_pnls) > 1:
        pnl_arr = np.array(all_oos_pnls)
        agg_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if np.std(pnl_arr, ddof=1) > 0 else 0.0
    else:
        agg_sharpe = 0.0

    # Daily stats from aggregated OOS
    winning_days = sum(1 for p in all_oos_pnls if p > 0)
    total_days = len(all_oos_pnls)
    avg_daily = float(np.mean(all_oos_pnls)) if all_oos_pnls else 0.0

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Overall confidence: LOW if any window is LOW
    low_confidence_windows = [w for w in window_results if w.get("confidence") == "LOW"]
    overall_confidence = "LOW" if low_confidence_windows else "OK"

    # Param stability check across optimization windows — HIGH #2 enhancement
    # Now uses 4-class regime-context classification instead of binary FRAGILE flag.
    # Backward compat: is_fragile is still set (True = overfit_drift | indeterminate).
    param_stability = None
    if optimize:
        opt_windows = [w for w in window_results if w.get("optimization")]
        if len(opt_windows) >= 2:
            # Collect param values per window
            all_param_names = set()
            for w in opt_windows:
                all_param_names.update(w["optimization"]["best_params"].keys())

            stability = {}
            fragile = False
            per_window_params_for_rc: list[dict] = []
            for w in opt_windows:
                per_window_params_for_rc.append(w["optimization"]["best_params"])

            for pname in all_param_names:
                vals = [w["optimization"]["best_params"].get(pname) for w in opt_windows if pname in w["optimization"]["best_params"]]
                if len(vals) >= 2:
                    mean_val = float(np.mean(vals))
                    std_val = float(np.std(vals))
                    cv = std_val / abs(mean_val) if mean_val != 0 else 0
                    stability[pname] = {
                        "mean": round(mean_val, 2),
                        "std": round(std_val, 2),
                        "cv": round(cv, 4),
                        "values": vals,
                    }
                    if cv > 0.30:
                        fragile = True

            # ── Regime-context classification (HIGH #2) ───────────────────────
            # Align regimes to opt_windows (which are a subset when some windows
            # had no optimization result). Use the global _per_window_regimes and
            # map by window index.
            _opt_window_indices = [
                i for i, w in enumerate(window_results) if w.get("optimization")
            ]
            _opt_window_regimes: list[Optional[str]] = [
                _per_window_regimes[i] if i < len(_per_window_regimes) else None
                for i in _opt_window_indices
            ]

            try:
                _drift_classification = classify_parameter_drift(
                    per_window_params_for_rc,
                    _opt_window_regimes,
                )
                _rc_classification = _drift_classification.classification
                _rc_confidence = _drift_classification.confidence
                _rc_evidence = _drift_classification.evidence
                _rc_warning = _drift_classification.warning
                # Backward compat: override fragile from regime-context
                fragile = _drift_classification.fragile
                print(
                    f"  Param stability: {_rc_classification.upper()} "
                    f"(confidence={_rc_confidence:.2f}, rho={_rc_evidence.get('spearman_rho')})",
                    file=sys.stderr,
                )
            except Exception as _rc_exc:
                # Wave hardening 2026-06-22 (G2b): classifier CRASH must NOT silently
                # map to "indeterminate" (warn-and-allow).  A crash on a real strategy is
                # indistinguishable from a crash on an overfit one, so the institutional-safe
                # default is to BLOCK.  The TS gate maps "classifier_error" → BLOCK with a
                # distinct audit action (lifecycle.parameter_drift_classifier_error_block).
                # "indeterminate" is preserved for genuine ambiguity (no crash); "stable"
                # is preserved for the non-fragile post-crash fallback.
                print(
                    f"  Param stability: regime-context classification EXCEPTION ({_rc_exc}). "
                    f"Emitting classifier_error — TS gate will BLOCK.",
                    file=sys.stderr,
                )
                _rc_classification = "classifier_error"
                _rc_confidence = None
                _rc_evidence = {"reason": "classifier_exception", "error": str(_rc_exc)}
                _rc_warning = "Classifier raised an exception; institutional default is to block promotion."

            param_stability = {
                "params": stability,
                "is_fragile": fragile,
                "warning": _rc_warning or ("Param variance > 30% across windows — likely overfitting" if fragile else None),
                # HIGH #2: regime-context classification (additive; backward compat)
                "drift_classification": _rc_classification,
                "drift_confidence": _rc_confidence,
                "drift_evidence": _rc_evidence,
            }
            if fragile:
                overall_confidence = "LOW"
                print("  Param stability: FRAGILE — variance > 30% across windows", file=sys.stderr)

    # ── PBO computation — HIGH #3 auto-wire ──────────────────────────────────
    # PBO (Probability of Backtest Overfitting) per Bailey et al. is now wired
    # into the aggregation block so it is always computed when >= 4 windows exist.
    # Previously it had to be called explicitly by the caller — fixed here.
    #
    # Wave 29 Pass A.2: also calls compute_pbo_from_cpcv_paths() from pbo_gate.py
    # to populate pbo_overall (the canonical CPCV-path-based PBO used by the
    # TESTING → SHADOW lifecycle gate). Two separate results:
    #   pbo_result      — from risk_metrics.compute_pbo (existing W27.5 path)
    #   pbo_gate_result — from pbo_gate.compute_pbo_from_cpcv_paths (new W29 gate)
    # pbo_overall = pbo_gate_result.pbo (preferred) or pbo_result.pbo (fallback).
    # pbo_audit_actions — list of audit action names for the TS layer to write.
    pbo_result: Optional[dict] = None
    pbo_gate_result: Optional[dict] = None
    pbo_audit_actions: list[str] = []
    _pbo_threshold = float(os.environ.get("PBO_OVERFIT_THRESHOLD", str(_PBO_OVERFIT_THRESHOLD_DEFAULT)))
    if len(window_results) >= 4:
        try:
            from src.engine.risk_metrics import compute_pbo as _compute_pbo
            pbo_result = _compute_pbo(window_results)
            _pbo_val = pbo_result.get("pbo")
            _pbo_pass = (_pbo_val is None) or (_pbo_val <= _pbo_threshold)
            pbo_result["pbo_pass"] = _pbo_pass
            pbo_result["pbo_threshold"] = _pbo_threshold
            # pbo_p_value is now populated by compute_pbo() (Wave 27.5 Pass D.4).
            # compute_pbo uses scipy.stats.binomtest on the IS/OOS rank-pair count.
            # Result is already present in pbo_result — no override needed.
            # Fall back to None only when compute_pbo didn't include the key
            # (e.g. scipy not installed, or compute_pbo pre-dates this version).
            if "pbo_p_value" not in pbo_result:
                pbo_result["pbo_p_value"] = None

            if _pbo_val is not None:
                if _pbo_val > _pbo_threshold:
                    print(
                        f"  PBO: {_pbo_val:.4f} > threshold {_pbo_threshold} — "
                        f"HIGH OVERFIT RISK (walk_forward.pbo_high_overfit_risk)",
                        file=sys.stderr,
                    )
                else:
                    print(
                        f"  PBO: {_pbo_val:.4f} <= threshold {_pbo_threshold} — pass "
                        f"(walk_forward.pbo_computed)",
                        file=sys.stderr,
                    )
        except Exception as _pbo_exc:
            # FIX 2 (2026-06-22): fail-CLOSED on exception — previous code set
            # pbo_pass: True (fail-open), allowing overfitted strategies to pass B14.
            # Conservative-on-error contract: pbo_pass=False, pbo_overall=1.0 (worst case).
            # The TS pbo-gate.ts treats pbo_pass=False as a hard block; it distinguishes
            # this from the None/missing legacy case (pbo_unavailable_legacy → proceed).
            print(
                f"  PBO: computation failed ({_pbo_exc}) — emitting walk_forward.pbo_computation_failed "
                f"and setting pbo_pass=False (conservative-on-error).",
                file=sys.stderr,
            )
            pbo_audit_actions.append("walk_forward.pbo_computation_failed")
            pbo_result = {
                "pbo": 1.0,        # worst-case: assume fully overfit
                "pbo_pass": False,  # hard block at TS gate
                "pbo_threshold": _pbo_threshold,
                "error": str(_pbo_exc),
                "error_type": type(_pbo_exc).__name__,
            }

        # ── Wave 29 Pass A.2: pbo_gate.py CPCV-path-based PBO ────────────────
        # Builds CPCV-style path dicts from plain-mode window_results and
        # computes the institutional-grade PBO via compute_pbo_from_cpcv_paths.
        # This value feeds the TESTING → SHADOW/PAPER lifecycle gate in pbo-gate.ts.
        # pbo_overall is additive to the existing pbo/pbo_pass/pbo_p_value keys —
        # downstream consumers that read the old keys are unaffected.
        #
        # FIX-1 (2026-06-29): track degenerate reason for wf_metadata injection.
        # When IS==OOS in plain-WF (per-window IS Sharpe unavailable), the TS gate
        # must BLOCK on the EXACT string "plain_wf_is_unavailable" — distinct from
        # "cpcv_is_sharpe_unavailable" (CPCV exempt path) and distinct from the
        # legacy-null grandfather-PROCEED path.  Placing the reason inside
        # wf_metadata ensures backtest-service persists it (it stores wf_metadata
        # wholesale) and lifecycle-service reads it at wf_metadata.pbo_degenerate_reason.
        _plain_wf_pbo_degenerate_reason: Optional[str] = None
        try:
            from src.engine.pbo_gate import (
                _build_cpcv_paths_from_window_results as _build_paths,
            )
            from src.engine.pbo_gate import (
                compute_pbo_from_cpcv_paths as _cpcv_pbo,
            )
            _cpcv_paths = _build_paths(window_results)
            pbo_gate_result = _cpcv_pbo(_cpcv_paths)
            _pbo_overall_val = pbo_gate_result.get("pbo")

            if _pbo_overall_val is not None and not (
                isinstance(_pbo_overall_val, float) and (_pbo_overall_val != _pbo_overall_val)
            ):
                # Emit appropriate audit action names for TS layer
                pbo_audit_actions.append("walk_forward.pbo_computed")
                if _pbo_overall_val > _pbo_threshold:
                    pbo_audit_actions.append("walk_forward.pbo_high_overfit_risk")
                    print(
                        f"  PBO (gate): {_pbo_overall_val:.4f} > warn threshold {_pbo_threshold} — "
                        f"HIGH OVERFIT RISK (walk_forward.pbo_high_overfit_risk)",
                        file=sys.stderr,
                    )
                else:
                    print(
                        f"  PBO (gate): {_pbo_overall_val:.4f} — pass (walk_forward.pbo_computed)",
                        file=sys.stderr,
                    )
            else:
                # pbo_overall_val is None (degenerate) or NaN (sample-size guard).
                if _pbo_overall_val is None and pbo_gate_result.get("degenerate"):
                    # FINDING-1 fix: degenerate IS==OOS case (plain-mode fallback also uses
                    # is_sharpe=oos_sharpe when per-window IS unavailable). Emit audit action;
                    # pbo_degenerate=True propagated to TS via the result dict below.
                    # FIX-1 (2026-06-29): set degenerate reason for wf_metadata injection.
                    # The EXACT string "plain_wf_is_unavailable" is the TS pbo-gate.ts
                    # contract to route to BLOCK (distinct from cpcv_is_sharpe_unavailable).
                    _plain_wf_pbo_degenerate_reason = "plain_wf_is_unavailable"
                    pbo_audit_actions.append("walk_forward.pbo_cpcv_degenerate")
                    print(
                        "  PBO (gate): degenerate — IS==OOS for all paths "
                        "(per-window IS Sharpe unavailable); emitting pbo_degenerate=True "
                        "and pbo_degenerate_reason='plain_wf_is_unavailable' "
                        "→ TS will BLOCK (walk_forward.pbo_cpcv_degenerate)",
                        file=sys.stderr,
                    )
                else:
                    # NaN = sample-size guard fired
                    print(
                        f"  PBO (gate): NaN — sample-size guard fired "
                        f"(n_paths={pbo_gate_result.get('n_paths', 0)} < "
                        f"{pbo_gate_result.get('sample_size_guard_threshold', 4)})",
                        file=sys.stderr,
                    )
        except Exception as _gate_pbo_exc:
            print(f"  PBO (gate): computation failed ({_gate_pbo_exc}).", file=sys.stderr)
            pbo_gate_result = None
    else:
        print(
            f"  PBO: skipped (need >= 4 windows, have {len(window_results)})",
            file=sys.stderr,
        )

    # ── WFE overall computation — HIGH #1 ────────────────────────────────────
    # wfe_overall = combined_OOS_Sharpe / combined_IS_Sharpe (not per-window average).
    # This is the standard institutional metric: treat the full concatenated OOS
    # as the evaluation set and the full concatenated IS as the reference.
    wfe_overall: Optional[float] = None
    wfe_status: Optional[str] = None
    wfe_per_window: list[dict] = []
    _wfe_hard_floor = get_wfe_hard_floor()
    _wfe_warn_floor = get_wfe_warn_floor()

    # Compute combined IS Sharpe from accumulated IS daily P&Ls.
    # When optimizer IS Sharpe was used directly (_is_sharpe_opt on window_detail),
    # we skip the accumulated path and use the opt score as combined IS Sharpe.
    _combined_is_sharpe: Optional[float] = None

    # FINDING-3 fix: track WFE IS Sharpe basis to surface inflation visibility.
    # optimizer_best_score_mean = IS is the cherry-picked optimizer best score (inflated vs base config)
    # base_config_daily_pnls    = IS is from base-config backtests (unoptimized, correct denominator)
    # unavailable               = IS Sharpe could not be computed (wfe_overall will be None)
    _wfe_is_basis: str = "unavailable"

    # Check if all windows used optimizer IS scores (no raw IS daily P&Ls accumulated)
    _opt_is_sharpes = [
        w.get("_is_sharpe_opt")
        for w in window_results
        if w.get("_is_sharpe_opt") is not None
    ]
    # Clean up _is_sharpe_opt from window_results (internal field, not schema output)
    for w in window_results:
        w.pop("_is_sharpe_opt", None)

    if _opt_is_sharpes:
        # When optimizer IS scores are available, use their mean as the combined IS Sharpe.
        # FINDING-3 note: optimizer.best_score is the cherry-picked maximum across parameter
        # trials — higher than base-config IS Sharpe. WFE = OOS/IS is therefore deflated
        # (conservative but misleading). wfe_is_basis="optimizer_best_score_mean" exposes
        # this so operators know the WFE denominator is inflated.
        _combined_is_sharpe = float(np.mean(_opt_is_sharpes))
        _wfe_is_basis = "optimizer_best_score_mean"  # FINDING-3 fix
        print(
            f"  WFE IS-basis: optimizer_best_score_mean "
            f"({len(_opt_is_sharpes)} windows; mean={_combined_is_sharpe:.4f}) — "
            f"IS Sharpe is optimizer-selected (cherry-picked max); "
            f"WFE may be deflated vs base-config denominator. "
            f"(walk_forward.wfe_is_basis_optimizer)",
            file=sys.stderr,
        )
    elif len(all_is_pnls) > 1:
        _is_pnl_arr = np.array(all_is_pnls)
        _is_std = float(np.std(_is_pnl_arr, ddof=1))
        _combined_is_sharpe = float(np.mean(_is_pnl_arr) / _is_std * np.sqrt(252)) if _is_std > 0 else 0.0
        _wfe_is_basis = "base_config_daily_pnls"  # FINDING-3 fix

    if _combined_is_sharpe is not None and _combined_is_sharpe > 0:
        _wfe_dict = compute_wfe(is_sharpe=_combined_is_sharpe, oos_sharpe=agg_sharpe)
        wfe_overall = _wfe_dict["wfe"]
        wfe_status = _wfe_dict["status"]

        if wfe_status == "fail":
            print(
                f"  WFE: {wfe_overall:.4f} < warn_floor {_wfe_warn_floor} — "
                f"RED FLAG (walk_forward.wfe_below_hard_floor)",
                file=sys.stderr,
            )
            overall_confidence = "LOW"
        elif wfe_status == "warn":
            print(
                f"  WFE: {wfe_overall:.4f} is between warn_floor {_wfe_warn_floor} "
                f"and hard_floor {_wfe_hard_floor} — YELLOW FLAG "
                f"(walk_forward.wfe_below_warn_floor)",
                file=sys.stderr,
            )
        else:
            print(
                f"  WFE: {wfe_overall:.4f} >= hard_floor {_wfe_hard_floor} — pass",
                file=sys.stderr,
            )
    else:
        # Wave hardening 2026-06-22 (G2a): WF ran but IS Sharpe is non-positive or absent.
        # We distinguish this from a true legacy backtest (key absent) by emitting an
        # explicit signal so the TS gate can BLOCK rather than silently grandfather-pass.
        # Contract:
        #   wfe_overall = 0.0          → the gate's < WFE_HARD_FLOOR check BLOCKS it
        #   wfe_status  = "degenerate_is" → TS gate recognises this is NOT a legacy null
        #
        # The genuine pre-W27.5 legacy path (key truly absent) keeps wfe_overall=None,
        # and the TS gate reads key-absent (undefined) as the grandfather pass.
        wfe_overall = 0.0
        wfe_status = "degenerate_is"
        overall_confidence = "LOW"
        print(
            "  WFE: IS Sharpe <= 0 or no IS P&Ls collected — emitting wfe_overall=0.0 "
            "(degenerate_is); TS gate will BLOCK (walk_forward.wfe_degenerate_is_block)",
            file=sys.stderr,
        )

    # ── Wave 3 Track 3A: BIF computation (plain/purged_embargo mode) ─────────────
    # IS Sharpe  = _combined_is_sharpe — same value already computed for WFE;
    #              no additional IS backtests required.
    # OOS Sharpe = agg_sharpe (combined-fold OOS, not per-window average).
    # K_eff      = len(windows) — each WF window is an independent IS/OOS draw.
    # Reuses the same Sharpe pair as the WFE gate; pure derivation, no I/O.
    _bif_result: dict = {}
    try:
        from src.engine.statistics.backtest_inflation_factor import (
            compute_bif as _compute_bif,
        )
        _bif_is_sharpe = _combined_is_sharpe if _combined_is_sharpe is not None else 0.0
        # B7 fix: k_eff counts only non-LOW-confidence windows (floored at 1).
        # LOW-confidence windows have too few OOS trades to be reliable IS/OOS draws;
        # counting them inflates k_eff which artificially reduces BIF.
        _bif_k_eff = float(max(len([w for w in window_results if w.get("confidence") != "LOW"]), 1))
        _bif_result = _compute_bif(
            is_sharpe=_bif_is_sharpe,
            wf_sharpe=agg_sharpe,
            k_eff=_bif_k_eff,
        )
        print(
            f"  BIF: {_bif_result.get('bif', 'N/A'):.4f} "
            f"(IS={_bif_is_sharpe:.4f}, WF={agg_sharpe:.4f}, "
            f"K_eff={_bif_k_eff:.0f}) "
            f"→ {_bif_result.get('verdict', 'N/A')}",
            file=sys.stderr,
        )
    except Exception as _bif_exc:
        print(
            f"  BIF: computation failed ({_bif_exc!r}) — "
            f"skipping (non-blocking, bif=None in output).",
            file=sys.stderr,
        )

    # ── WRC + SPA — multi-model data-snooping guard (plain/purged_embargo WF) ─
    # Upgraded to proper multiple-comparison construction (White 2000 / Hansen 2005).
    # Model universe: each WF window is one "model" (its OOS P&L series).
    # k_eff = len(windows) — each window is an independent IS/OOS draw.
    # n_total_trials from request.trial_n_total applies Šidák for scout snooping.
    # Fail-soft on insufficient data — NEVER a fake passing p-value.
    _WRC_MIN_OBS_PLAIN = 20
    _plain_wrc_result: dict = {}
    _plain_spa_result: dict = {}
    _rng_seed_plain = int(os.environ.get("BACKTEST_SEED", "42"))
    _trial_n_total_plain: int = max(1, getattr(request, "trial_n_total", 1))
    _k_eff_plain: int = max(len(windows), 1)
    # Windows with sufficient deduplicated OOS P&L series
    _eligible_windows = [p for p in per_window_oos_pnls if len(p) >= _WRC_MIN_OBS_PLAIN]
    if len(_eligible_windows) >= 2:
        try:
            from src.engine.statistics.hansens_spa import (
                hansens_spa_multi as _spa_multi_plain,
            )
            from src.engine.statistics.whites_reality_check import (
                whites_reality_check_multi as _wrc_multi_plain,
            )
            _min_window_len = min(len(w) for w in _eligible_windows)
            _perf_matrix_plain = np.array(
                [w[:_min_window_len] for w in _eligible_windows], dtype=float
            )  # (L, T)
            _bench_matrix_plain = np.zeros_like(_perf_matrix_plain)
            _plain_wrc_result = _wrc_multi_plain(
                performance_matrix=_perf_matrix_plain,
                benchmark_matrix=_bench_matrix_plain,
                n_total_trials=_trial_n_total_plain,
                k_eff=_k_eff_plain,
                rng_seed=_rng_seed_plain,
            )
            _plain_spa_result = _spa_multi_plain(
                performance_matrix=_perf_matrix_plain,
                benchmark_matrix=_bench_matrix_plain,
                n_total_trials=_trial_n_total_plain,
                k_eff=_k_eff_plain,
                rng_seed=_rng_seed_plain + 1,
            )
            print(
                f"  WRC multi (plain): p={_plain_wrc_result.get('p_value', 'N/A'):.4f} "
                f"{'PASS' if _plain_wrc_result.get('passed') else 'FAIL'} | "
                f"SPA consistent_p={_plain_spa_result.get('spa_consistent_p', 'N/A'):.4f} "
                f"{'PASS' if _plain_spa_result.get('passed') else 'FAIL'} "
                f"(n_models={len(_eligible_windows)}, T={_min_window_len}, "
                f"n_total={_trial_n_total_plain}, sidak={_plain_wrc_result.get('sidak_adjusted')})",
                file=sys.stderr,
            )
        except Exception as _plain_wrc_exc:
            print(
                f"  WRC/SPA multi (plain): computation failed ({_plain_wrc_exc!r}) — "
                f"emitting available=false (non-blocking).",
                file=sys.stderr,
            )
            _plain_wrc_result = {"available": False, "reason": str(_plain_wrc_exc)}
            _plain_spa_result = {"available": False, "reason": str(_plain_wrc_exc)}
    elif len(all_oos_pnls) >= _WRC_MIN_OBS_PLAIN:
        # Fallback: < 2 eligible windows but concatenated series is long enough.
        try:
            from src.engine.statistics.hansens_spa import hansens_spa as _spa_fn_plain
            from src.engine.statistics.whites_reality_check import (
                whites_reality_check as _wrc_fn_plain,
            )
            _bm_zeros_plain = [0.0] * len(all_oos_pnls)
            _plain_wrc_result = _wrc_fn_plain(
                strategy_returns=all_oos_pnls,
                benchmark_returns=_bm_zeros_plain,
                rng_seed=_rng_seed_plain,
            )
            _plain_spa_result = _spa_fn_plain(
                strategy_returns=all_oos_pnls,
                benchmark_returns=_bm_zeros_plain,
                rng_seed=_rng_seed_plain + 1,
            )
            print(
                f"  WRC single (plain fallback, <2 eligible windows): "
                f"p={_plain_wrc_result.get('p_value', 'N/A'):.4f} "
                f"{'PASS' if _plain_wrc_result.get('passed') else 'FAIL'} "
                f"(n_obs={len(all_oos_pnls)})",
                file=sys.stderr,
            )
        except Exception as _plain_wrc_exc2:
            print(
                f"  WRC/SPA single (plain fallback): computation failed ({_plain_wrc_exc2!r}) — "
                f"emitting available=false (non-blocking).",
                file=sys.stderr,
            )
            _plain_wrc_result = {"available": False, "reason": str(_plain_wrc_exc2)}
            _plain_spa_result = {"available": False, "reason": str(_plain_wrc_exc2)}
    else:
        _plain_insufficient = (
            f"insufficient OOS observations: {len(all_oos_pnls)} < {_WRC_MIN_OBS_PLAIN} minimum"
        )
        _plain_wrc_result = {"available": False, "reason": _plain_insufficient}
        _plain_spa_result = {"available": False, "reason": _plain_insufficient}
        print(
            f"  WRC/SPA (plain): skipped — {_plain_insufficient}",
            file=sys.stderr,
        )

    # ─── Prop firm compliance on aggregated OOS results ─────
    prop_compliance = None
    if all_oos_pnl_records and all_oos_trades:
        from src.engine.prop_sim import simulate_all_firms
        symbol = request.strategy.symbol if hasattr(request.strategy, "symbol") else request.strategy.get("symbol", "MES")
        _overnight_hold = getattr(getattr(request, "strategy", None), "overnight_hold", False)
        prop_compliance = simulate_all_firms(
            all_oos_pnl_records, all_oos_trades,
            symbol=symbol, account_size=50_000,
            overnight_hold=_overnight_hold,
        )

    # ─── FIX-2 (2026-06-29): DSR for plain-WF path ──────────────────────────
    # CPCV path computes DSR via n_paths (15 combinations as proxy for n_trials).
    # Plain-WF path had no DSR computation, so wf_metadata.dsr_pass was always
    # absent → TS consumer saw undefined → silent legacy-null path (no gate).
    #
    # Wire compute_deflated_sharpe_ratio using:
    #   observed_sharpe = agg_sharpe (combined OOS aggregate)
    #   n_trials        = max(n_splits, trial_n_total) — n_splits as the floor
    #                     (each fold is an independent IS/OOS evaluation;
    #                      trial_n_total from request when optimization is active)
    #   n_observations  = len(all_oos_pnls) (total OOS daily PnL count)
    # On any failure: emit dsr_unavailable=True so it is auditable, not silent.
    _plain_wf_dsr_result: dict = {}
    _plain_wf_n_trials: int = max(
        len(windows),
        max(1, getattr(request, "trial_n_total", 1)),
    )
    # _plain_wf_dsr_pass: bool|None — read separately because compute_deflated_sharpe_ratio
    # returns the gate under key "passes" (not "dsr_pass").  We normalise to "dsr_pass"
    # in wf_metadata to match the CPCV path contract consumed by lifecycle-service.ts.
    _plain_wf_dsr_pass: Optional[bool] = None
    _plain_wf_dsr_unavailable: bool = False
    try:
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio as _plain_dsr_fn
        _plain_wf_dsr_result = _plain_dsr_fn(
            observed_sharpe=agg_sharpe,
            n_trials=_plain_wf_n_trials,
            n_observations=max(len(all_oos_pnls), 2),
        )
        # compute_deflated_sharpe_ratio returns "passes" (bool); map to dsr_pass for wf_metadata.
        _plain_wf_dsr_pass_raw = _plain_wf_dsr_result.get("passes")
        _plain_wf_dsr_pass = bool(_plain_wf_dsr_pass_raw) if _plain_wf_dsr_pass_raw is not None else None
        print(
            f"  DSR (plain WF): dsr={_plain_wf_dsr_result.get('dsr')} "
            f"passes={_plain_wf_dsr_pass} "
            f"(n_trials={_plain_wf_n_trials}, n_obs={len(all_oos_pnls)})",
            file=sys.stderr,
        )
    except Exception as _plain_wf_dsr_exc:
        print(
            f"  DSR (plain WF): computation failed ({_plain_wf_dsr_exc!r}) — "
            f"emitting dsr_unavailable=True (auditable, not silent).",
            file=sys.stderr,
        )
        _plain_wf_dsr_result = {
            "dsr": None,
            "passes": None,
            "error": str(_plain_wf_dsr_exc),
            "error_type": type(_plain_wf_dsr_exc).__name__,
        }
        _plain_wf_dsr_pass = False
        _plain_wf_dsr_unavailable = True

    return {
        "confidence": overall_confidence,
        "low_confidence_windows": len(low_confidence_windows),
        "oos_metrics": {
            "total_return": round(total_return, 2),
            "sharpe_ratio": round(agg_sharpe, 4),
            "max_drawdown": round(max_dd, 2),
            "win_rate": round(agg_win_rate, 4),
            "profit_factor": round(agg_pf, 4),
            "total_trades": total_trades,
            "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
            "avg_daily_pnl": round(avg_daily, 2),
            "winning_days": winning_days,
            "total_trading_days": total_days,
        },
        "trades": all_oos_trades,
        "daily_pnls": all_oos_pnls,
        "daily_pnl_records": all_oos_pnl_records,
        "equity_curve": all_oos_equity,
        "windows": window_results,
        "n_splits": len(windows),
        "is_ratio": is_ratio,
        "param_stability": param_stability,
        "prop_compliance": prop_compliance,
        "execution_time_ms": elapsed_ms,
        # Wave 24 Pass 1 — Item 10: wf_metadata for downstream promotion gate.
        # mode: "plain" | "purged_embargo" | "cpcv"
        # purge_window: bars excluded between IS and OOS (purged_embargo mode)
        # embargo_pct: % of dataset embargoed after each OOS fold (approx)
        #
        # FIX-1 (2026-06-29): pbo_degenerate_reason — contract with pbo-gate.ts.
        #   "plain_wf_is_unavailable" → TS pbo-gate.ts routes to BLOCK.
        #   None → no degenerate case; standard pbo_overall logic applies.
        #
        # FIX-2 (2026-06-29): dsr_pass / dsr_unavailable — mirrors CPCV wf_metadata
        #   contract (FIX 7, 2026-06-22).  dsr_pass=None = missing (legacy null);
        #   dsr_pass=False = failed or unavailable; dsr_pass=True = passed.
        #   dsr_unavailable=True signals computation failure (auditable, not silent).
        "wf_metadata": {
            "mode": _resolved_mode,
            "n_folds": len(windows),
            "embargo_pct": _embargo_pct if _resolved_mode == "purged_embargo" else 0.0,
            "purge_window": _purge_window if _resolved_mode == "purged_embargo" else 0,
            "pbo_degenerate_reason": _plain_wf_pbo_degenerate_reason,
            "dsr": _plain_wf_dsr_result.get("dsr"),
            # dsr_pass: normalised from compute_deflated_sharpe_ratio's "passes" key.
            # None = computation skipped / result absent; False = gate failed or unavailable.
            "dsr_pass": _plain_wf_dsr_pass,
            "dsr_unavailable": _plain_wf_dsr_unavailable,
        },
        # Wave 27.5 Pass B HIGH #1 — WFE fields (all optional; additive; backward compat)
        "wfe_overall": wfe_overall,
        "wfe_status": wfe_status,
        "wfe_hard_floor": _wfe_hard_floor,
        "wfe_warn_floor": _wfe_warn_floor,
        "wfe_per_window": wfe_per_window,
        # FINDING-3 fix: WFE IS-Sharpe basis tag.
        # "optimizer_best_score_mean" = IS is cherry-picked optimizer max (deflates WFE vs base).
        # "base_config_daily_pnls"    = IS is honest base-config IS run.
        # "unavailable"               = IS Sharpe could not be computed (wfe_overall absent).
        "wfe_is_basis": _wfe_is_basis,
        # Wave 27.5 Pass B HIGH #3 — PBO auto-wire (additive; None when < 4 windows)
        "pbo": pbo_result.get("pbo") if pbo_result else None,
        "pbo_pass": pbo_result.get("pbo_pass") if pbo_result else None,
        # Wave 27.5 Pass D.4: pbo_p_value now populated by compute_pbo() via
        # scipy.stats.binomtest — no longer hardcoded None.
        # Falls back to None when compute_pbo unavailable or < 10 combinations.
        "pbo_p_value": pbo_result.get("pbo_p_value") if pbo_result else None,
        "pbo_detail": pbo_result,
        # Wave 29 Pass A.2 — CPCV-path-based PBO for TESTING → SHADOW/PAPER gate.
        # pbo_overall = canonical lifecycle-gate PBO from pbo_gate.py
        # pbo_p_value is already above; reuse the same field (pbo_gate_result's
        # p_value overwrites when available — more accurate than risk_metrics path).
        # Two separate thresholds:
        #   PBO_OVERFIT_THRESHOLD     (0.5)  — W27.5 warn threshold (above)
        #   PBO_OVERFIT_THRESHOLD_PCT (0.15) — W29 lifecycle gate (pbo-gate.ts)
        "pbo_overall": (
            pbo_gate_result.get("pbo")
            if pbo_gate_result
            else (pbo_result.get("pbo") if pbo_result else None)
        ),
        "pbo_overall_p_value": (
            pbo_gate_result.get("p_value")
            if pbo_gate_result
            else None
        ),
        # FINDING-1 fix: discriminator flag so pbo-gate.ts can distinguish
        # plain-mode CPCV-style degenerate (BLOCK via pbo_cpcv_degenerate_block) from
        # genuine legacy-null (PROCEED via pbo_unavailable_legacy).
        "pbo_degenerate": (
            pbo_gate_result.get("degenerate", False)
            if pbo_gate_result
            else False
        ),
        # Audit action names for the TS backtest-service to write to audit_log.
        # Contains: "walk_forward.pbo_computed" and optionally
        #           "walk_forward.pbo_high_overfit_risk" or "walk_forward.pbo_cpcv_degenerate"
        "pbo_audit_actions": pbo_audit_actions,
        # Wave 3 Track 3A — BIF (Backtest Inflation Factor): IS/OOS Sharpe ratio.
        # is_sharpe = _combined_is_sharpe (same as WFE input; no extra backtests).
        # wf_sharpe = agg_sharpe (combined-fold OOS aggregate).
        # k_eff     = n_splits (WF windows = independent IS/OOS draws).
        # TS gate contract: reads "bif" (float) and "k_eff" (float) from this dict.
        "bif": _bif_result.get("bif"),
        "k_eff": _bif_result.get("k_eff"),
        "bif_detail": _bif_result,
        # WRC / SPA — data-snooping guard on concatenated plain/purged_embargo OOS P&L.
        # TS gate contract: reads wrc_result.p_value / spa_result.spa_consistent_p.
        # When available=False the TS gate treats these as null → fail-CLOSED
        # (unless PROMOTION_GRANDFATHER_PRE_PASS_E=true is explicitly set).
        "wrc_result": _plain_wrc_result,
        "spa_result": _plain_spa_result,
    }


def run_walk_forward_class(
    strategy: BaseStrategy,
    start_date: str,
    end_date: str,
    slippage_ticks: float = 1.0,
    commission_per_side: float = 0.62,
    firm_key: Optional[str] = None,
    n_splits: int = 8,
    is_ratio: float = 0.5,
    embargo_bars: int = 20,
    optimize: bool = False,
) -> dict:
    """Walk-forward validation for class-based (BaseStrategy) strategies.

    Same windowing logic as run_walk_forward(), but each OOS window calls
    run_class_backtest() instead of run_backtest().

    Args:
        optimize: If True, raise NotImplementedError (Wave 24 carry-forward).
            Class-based strategies do not yet support per-window Optuna tuning.
            Callers must not silently fall through to fixed-param OOS — fail loudly.
    """
    # F-12 FIX: Fail loudly if caller requests optimization on class strategies.
    # Previously the function ran silently with fixed params when optimize was not even
    # a parameter — callers who expected optimization got unreproduced results.
    if optimize:
        raise NotImplementedError(
            "Class strategy Optuna optimization not yet supported — Wave 24 carry-forward. "
            "Use run_walk_forward() with a DSL config for optimization, or set optimize=False."
        )

    start_time = time.time()
    symbol = strategy.symbol
    timeframe = strategy.timeframe

    # Load data
    from src.engine.data_loader import load_ohlcv
    data = load_ohlcv(symbol, timeframe, start_date, end_date)

    # Load daily data once for HTF context (shared across all OOS windows)
    daily_data = None
    htf_cache = None
    try:
        daily_data = load_ohlcv(symbol, "daily", start_date, end_date)
        print(f"Walk-forward: loaded {len(daily_data)} daily bars for HTF context", file=sys.stderr)
    except Exception as e:
        print(f"Walk-forward: could not load daily data for HTF gate: {e}", file=sys.stderr)

    if daily_data is not None and len(daily_data) >= 200:
        from src.engine.context.htf_context import compute_htf_context
        htf_cache = {}
        # Use ts_et for day keys to avoid UTC/ET date mismatch at midnight boundary
        _htf_ts_col = "ts_et" if "ts_et" in daily_data.columns else "ts_event"
        for day_idx in range(200, len(daily_data)):
            bar_date = daily_data[_htf_ts_col][day_idx]
            day_key = str(bar_date)[:10]
            htf_cache[day_key] = compute_htf_context(
                daily_df=daily_data.slice(0, day_idx),
                four_h_df=None,
                one_h_df=None,
                current_price=float(daily_data["close"][day_idx - 1]),
                bar_date=bar_date,
            )
        print(f"Walk-forward: built HTF cache with {len(htf_cache)} days", file=sys.stderr)

    # F-2 FIX: Auto-reduce splits using timeframe-aware bar count (class path).
    # Same fix as run_walk_forward — MIN_OOS_DAYS bare is wrong for intraday.
    total_bars = len(data)
    oos_fraction = 1.0 - is_ratio
    bars_per_day_cls = BARS_PER_DAY.get(timeframe, 1)
    min_oos_bars = MIN_OOS_DAYS * bars_per_day_cls
    required_bars_per_split = int(min_oos_bars / oos_fraction)

    original_splits = n_splits
    while n_splits > 1 and (total_bars // n_splits) < required_bars_per_split:
        n_splits -= 1

    if n_splits < original_splits:
        print(
            f"Walk-forward (class): auto-reduced n_splits from {original_splits} to {n_splits} "
            f"(need {required_bars_per_split} bars/split for {MIN_OOS_DAYS}d OOS "
            f"at {timeframe}={bars_per_day_cls} bars/day)",
            file=sys.stderr,
        )

    windows = split_walk_forward_windows(data, n_splits, is_ratio, embargo_bars=embargo_bars)
    print(f"Walk-forward (class): {len(windows)} windows, IS ratio={is_ratio}", file=sys.stderr)

    window_results = []
    all_oos_pnls: list[float] = []
    all_oos_pnl_records: list[dict] = []
    all_oos_trades: list[dict] = []
    # H5 FIX: Accumulate bar-level equity for intraday DD computation.
    # The config-based WF path already does this; the class-based path was
    # computing DD from EOD daily P&Ls only — hiding intraday breaches that
    # would blow Topstep's trailing DD floor live.
    all_oos_equity_bars_cls: list[float] = []

    for i, (is_data, oos_data) in enumerate(windows):
        print(f"  Window {i+1}/{len(windows)}: IS={len(is_data)} bars, OOS={len(oos_data)} bars", file=sys.stderr)

        # Run class-based backtest on OOS data.
        # P1-A fix: pass is_data as warmup_data so strategy.compute() runs on IS+OOS
        # context — indicators are correctly initialized at the OOS boundary.
        # IS rows are stripped inside run_class_backtest() after compute(), before
        # signal execution. This mirrors the run_backtest() E7.2 warmup fix.
        # Eligibility gate OFF for backtesting — test the STRATEGY, not the gate.
        # The gate is a live-trading filter (kill zones, bias, sweeps). Applying it
        # in backtests kills 90%+ of signals, producing statistically meaningless
        # results (4-122 trades over 2 years). Gate will be re-enabled when
        # the bias engine and context layer are properly calibrated.
        # F-5 FIX: Derive OOS window date boundaries from oos_data timestamps so that
        # run_class_backtest's bar-count validation and any internal date-range logic
        # reference the WINDOW range, not the full backtest range.
        # Previously start_date/end_date (full range) were passed — causing
        # _validate_bar_count to expect 2-year worth of bars for a 7-month OOS window.
        def _ts_col_wf(df: pl.DataFrame) -> str:
            for col in ("ts_event", "ts_et"):
                if col in df.columns:
                    return col
            return ""

        _oos_ts_c = _ts_col_wf(oos_data)
        if _oos_ts_c and len(oos_data) > 0:
            oos_start_dt_wf = str(oos_data[_oos_ts_c][0])[:10]
            oos_end_dt_wf = str(oos_data[_oos_ts_c][-1])[:10]
        else:
            oos_start_dt_wf = start_date
            oos_end_dt_wf = end_date

        oos_result = run_class_backtest(
            strategy=strategy,
            start_date=oos_start_dt_wf,
            end_date=oos_end_dt_wf,
            slippage_ticks=slippage_ticks,
            commission_per_side=commission_per_side,
            firm_key=firm_key,
            data=oos_data,
            htf_cache=htf_cache,
            daily_data=daily_data,
            skip_eligibility_gate=True,
            warmup_data=is_data,
        )

        oos_trade_count = oos_result.get("total_trades", 0)
        oos_trading_days = oos_result.get("total_trading_days", 0)

        # Extract date boundaries for persistence.
        # Guard: ts_event column may be absent on synthetic test data — use ts_et as
        # a fallback, then fall back to "" rather than raising KeyError.
        def _ts_col_cls(df: pl.DataFrame) -> str:
            for col in ("ts_event", "ts_et"):
                if col in df.columns:
                    return col
            return ""

        _is_ts_cls = _ts_col_cls(is_data)
        _oos_ts_cls = _ts_col_cls(oos_data)
        is_start_dt = str(is_data[_is_ts_cls][0])[:10] if (len(is_data) > 0 and _is_ts_cls) else ""
        is_end_dt = str(is_data[_is_ts_cls][-1])[:10] if (len(is_data) > 0 and _is_ts_cls) else ""
        oos_start_dt = str(oos_data[_oos_ts_cls][0])[:10] if (len(oos_data) > 0 and _oos_ts_cls) else ""
        oos_end_dt = str(oos_data[_oos_ts_cls][-1])[:10] if (len(oos_data) > 0 and _oos_ts_cls) else ""

        window_detail = {
            "window": i + 1,
            "is_bars": len(is_data),
            "oos_bars": len(oos_data),
            "is_start": is_start_dt,
            "is_end": is_end_dt,
            "oos_start": oos_start_dt,
            "oos_end": oos_end_dt,
            "oos_metrics": {
                "total_return": oos_result.get("total_return", 0),
                "sharpe_ratio": oos_result.get("sharpe_ratio", 0),
                "max_drawdown": oos_result.get("max_drawdown", 0),
                "win_rate": oos_result.get("win_rate", 0),
                "profit_factor": oos_result.get("profit_factor", 0),
                "total_trades": oos_trade_count,
                "total_trading_days": oos_trading_days,
                # P2-H fix: prefer actual computed mean from the engine if present.
                "avg_trade_pnl": round(
                    oos_result.get("avg_trade_pnl", oos_result.get("total_return", 0) / max(oos_trade_count, 1)),
                    2,
                ),
                "avg_daily_pnl": round(float(sum(oos_result.get("daily_pnls", [])) / max(len(oos_result.get("daily_pnls", [])), 1)), 2),
            },
            "avg_rr": oos_result.get("avg_rr", 0),
            "avg_winner_rr": oos_result.get("avg_winner_rr", 0),
            "avg_loser_rr": oos_result.get("avg_loser_rr", 0),
            "confidence": "OK",
        }

        warnings = []
        if oos_trade_count < MIN_OOS_TRADES:
            warnings.append(f"Only {oos_trade_count} OOS trades (min {MIN_OOS_TRADES})")
            window_detail["confidence"] = "LOW"
        if oos_trading_days < MIN_OOS_DAYS:
            warnings.append(f"Only {oos_trading_days} OOS days (min {MIN_OOS_DAYS})")
            window_detail["confidence"] = "LOW"
        if warnings:
            window_detail["warning"] = "; ".join(warnings)

        window_results.append(window_detail)
        # P2-I fix (class WF): deduplicate boundary-day P&L records across adjacent windows.
        _new_records_cls = oos_result.get("daily_pnl_records", [])
        _existing_dates_cls = {r.get("date") for r in all_oos_pnl_records if r.get("date")}
        _deduped_cls = [r for r in _new_records_cls if r.get("date") not in _existing_dates_cls]
        all_oos_pnl_records.extend(_deduped_cls)
        _deduped_pnls_cls = [r.get("pnl", 0.0) for r in _deduped_cls]
        all_oos_pnls.extend(_deduped_pnls_cls if _deduped_cls else oos_result.get("daily_pnls", []))
        all_oos_trades.extend(oos_result.get("trades", []))
        # H5 FIX: collect bar-level equity from class backtest result
        all_oos_equity_bars_cls.extend(oos_result.get("equity_bars", []))

    # Aggregate OOS metrics — recompute from ALL trades, never average per-window rates
    total_trades = len(all_oos_trades)
    total_return = float(sum(w["oos_metrics"]["total_return"] for w in window_results))  # Sum of dollar P&L across windows

    # H5 FIX: Prefer bar-level equity for max DD (captures intraday peaks).
    # EOD daily P&L aggregation hides intraday breaches that blow Topstep
    # trailing DD floor live — a strategy passes backtest but fails funded.
    if all_oos_equity_bars_cls:
        eq_arr = np.array(all_oos_equity_bars_cls, dtype=float)
        running_peak = np.maximum.accumulate(eq_arr)
        max_dd = float(np.max(running_peak - eq_arr))
    elif all_oos_pnls:
        # Fallback: compute from EOD daily P&Ls when no bar-level data available
        cum_pnl = np.cumsum(all_oos_pnls)
        running_peak = np.maximum.accumulate(cum_pnl)
        max_dd = float(np.max(running_peak - cum_pnl))
    else:
        max_dd = 0.0

    # Win rate: count wins across ALL trades (not averaged per-window)
    if all_oos_trades:
        total_wins = sum(1 for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
        agg_win_rate = float(total_wins / len(all_oos_trades))
    else:
        agg_win_rate = 0.0

    # Profit factor: sum(wins) / sum(losses) across ALL trades (not averaged per-window)
    gross_wins = sum(float(t.get("PnL", t.get("pnl", 0))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
    gross_losses = sum(abs(float(t.get("PnL", t.get("pnl", 0)))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) < 0)
    agg_pf = float(gross_wins / gross_losses) if gross_losses > 0 else 999.99

    # Sharpe: recompute from all daily P&Ls (not averaged per-window)
    if len(all_oos_pnls) > 1:
        pnl_arr = np.array(all_oos_pnls)
        agg_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if np.std(pnl_arr, ddof=1) > 0 else 0.0
    else:
        agg_sharpe = 0.0

    winning_days = sum(1 for p in all_oos_pnls if p > 0)
    total_days = len(all_oos_pnls)
    avg_daily = float(np.mean(all_oos_pnls)) if all_oos_pnls else 0.0

    elapsed_ms = int((time.time() - start_time) * 1000)

    low_confidence_windows = [w for w in window_results if w.get("confidence") == "LOW"]

    # Run sanity checks and cross-validation on aggregated OOS data
    _oos_aggregate = {
        "total_return": round(total_return, 2),
        "sharpe_ratio": round(agg_sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(agg_win_rate, 4),
        "profit_factor": round(agg_pf, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
        "avg_daily_pnl": round(avg_daily, 2),
        "winning_days": winning_days,
        "total_trading_days": total_days,
        "daily_pnls": all_oos_pnls,
        "equity_curve": [],
        "trades": all_oos_trades,
    }
    sanity = run_sanity_checks(_oos_aggregate, is_walk_forward_aggregate=True, symbol=symbol, timeframe=strategy.timeframe)

    # Compute average IS Sharpe across optimization windows for WFE
    # run_walk_forward_class does not support Optuna optimization — avg_is_sharpe is None.
    avg_is_sharpe = None

    cross_val = run_cross_validation(_oos_aggregate, is_sharpe=avg_is_sharpe)

    # ─── Prop firm compliance on aggregated OOS results ─────
    prop_compliance = None
    if all_oos_pnl_records and all_oos_trades:
        from src.engine.prop_sim import simulate_all_firms
        _overnight_hold = getattr(strategy, "overnight_hold", False)
        prop_compliance = simulate_all_firms(
            all_oos_pnl_records, all_oos_trades,
            symbol=symbol, account_size=50_000,
            overnight_hold=_overnight_hold,
        )

    return {
        "confidence": "LOW" if low_confidence_windows else "OK",
        "low_confidence_windows": len(low_confidence_windows),
        "oos_metrics": {
            "total_return": round(total_return, 2),
            "sharpe_ratio": round(agg_sharpe, 4),
            "max_drawdown": round(max_dd, 2),
            "win_rate": round(agg_win_rate, 4),
            "profit_factor": round(agg_pf, 4),
            "total_trades": total_trades,
            "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
            "avg_daily_pnl": round(avg_daily, 2),
            "winning_days": winning_days,
            "total_trading_days": total_days,
        },
        "daily_pnls": all_oos_pnls,
        "daily_pnl_records": all_oos_pnl_records,
        "trades": all_oos_trades,
        "windows": window_results,
        "n_splits": len(windows),
        "is_ratio": is_ratio,
        "execution_time_ms": elapsed_ms,
        "sanity_checks": sanity,
        "cross_validation": cross_val,
        "prop_compliance": prop_compliance,
    }
