"""Cross-validation — statistical tests for backtest significance.

Tests:
1. Walk-Forward Efficiency (WFE)
2. Bootstrap CI for daily P&L
3. Deflated Sharpe Ratio (DSR)
4. Determinism test
5. Parameter perturbation (placeholder — requires optimizer integration)
"""

from __future__ import annotations

import os

import numpy as np
from scipy import stats as scipy_stats

from src.engine.monte_carlo import create_authoritative_rng

# ── WFE floor thresholds (institutional 2026 standard) ───────────────────────
# Hard floor: WFE < WFE_HARD_FLOOR triggers red-flag audit (Pass B.2 blocks at
# PAPER → DEPLOY_READY). Warn floor: WFE below warn but above hard triggers
# yellow advisory.
#
# Env vars (set in .env or per-test override):
#   WFE_HARD_FLOOR  default 0.70
#   WFE_WARN_FLOOR  default 0.50
#
# Institutional reference: Lopez de Prado AFML 2018 §12; QuantForgeAnalytics
# 2026 funded-trader survey — median WFE of top-performing strategies = 0.72.
_WFE_HARD_FLOOR_DEFAULT = 0.70
_WFE_WARN_FLOOR_DEFAULT = 0.50


def get_wfe_hard_floor() -> float:
    """Read WFE hard floor from env (default 0.70)."""
    try:
        return float(os.environ.get("WFE_HARD_FLOOR", str(_WFE_HARD_FLOOR_DEFAULT)))
    except (ValueError, TypeError):
        return _WFE_HARD_FLOOR_DEFAULT


def get_wfe_warn_floor() -> float:
    """Read WFE warn floor from env (default 0.50)."""
    try:
        return float(os.environ.get("WFE_WARN_FLOOR", str(_WFE_WARN_FLOOR_DEFAULT)))
    except (ValueError, TypeError):
        return _WFE_WARN_FLOOR_DEFAULT


def compute_wfe(is_sharpe: float, oos_sharpe: float) -> dict:
    """Walk-Forward Efficiency: OOS Sharpe / IS Sharpe.

    Institutional 2026 standard:
      > WFE_HARD_FLOOR (default 0.70) = pass
      > WFE_WARN_FLOOR (default 0.50) = advisory warning
      <= WFE_WARN_FLOOR = red flag (likely overfit or regime-broken)

    Returns dict with:
      wfe          : float rounded to 4dp
      interpretation: human-readable band label
      hard_floor   : the threshold used for hard-fail flagging
      warn_floor   : the threshold used for yellow-flag
      status       : "pass" | "warn" | "fail" (based on floors)
    """
    hard_floor = get_wfe_hard_floor()
    warn_floor = get_wfe_warn_floor()

    if is_sharpe <= 0 or np.isnan(is_sharpe):
        return {
            "wfe": 0.0,
            "interpretation": "IS Sharpe <= 0 — cannot compute WFE",
            "status": "fail",
            "hard_floor": hard_floor,
            "warn_floor": warn_floor,
        }

    wfe = oos_sharpe / is_sharpe

    # Status against institutional floors
    if wfe >= hard_floor:
        status = "pass"
    elif wfe >= warn_floor:
        status = "warn"
    else:
        status = "fail"

    # Backward-compat human-readable interpretation
    if wfe > 0.5:
        interp = "good"
    elif wfe > 0.3:
        interp = "acceptable"
    elif wfe > 0.1:
        interp = "weak"
    else:
        interp = "likely_overfit"

    return {
        "wfe": round(wfe, 4),
        "interpretation": interp,
        "status": status,
        "hard_floor": hard_floor,
        "warn_floor": warn_floor,
    }


def bootstrap_ci(
    daily_pnls: list[float],
    n_resamples: int = 1000,
    confidence: float = 0.95,
    seed: int = 42,
) -> dict:
    """Bootstrap confidence interval for mean daily P&L.

    Resample daily P&Ls with replacement, compute mean for each sample.
    If 95% CI includes $0, edge is not statistically significant.

    Returns:
        dict with ci_lower, ci_upper, mean, includes_zero, significant
    """
    if len(daily_pnls) < 10:
        return {
            "ci_lower": 0.0,
            "ci_upper": 0.0,
            "mean": 0.0,
            "includes_zero": True,
            "significant": False,
            "n_resamples": 0,
            "detail": "insufficient data (<10 daily P&Ls)",
        }

    # Fix 3: use authoritative PCG64DXSM RNG matching monte_carlo.py for replay determinism.
    rng = create_authoritative_rng(seed)[0]
    arr = np.array(daily_pnls)
    # FINDING-5 fix: vectorize bootstrap resampling — single 2D rng.choice call replaces
    # the Python-level loop (n_resamples calls → 1 call), reducing overhead for large n_resamples.
    # Byte-identical with the loop for the same PCG64DXSM seed: numpy's Generator draws the same
    # random integers in the same sequence whether requested in one 2D batch or n_resamples 1D batches.
    # Proved by test_bootstrap_ci_vectorize.py determinism test.
    means = rng.choice(arr, size=(n_resamples, len(arr)), replace=True).mean(axis=1)

    alpha = 1 - confidence
    ci_lower = float(np.percentile(means, alpha / 2 * 100))
    ci_upper = float(np.percentile(means, (1 - alpha / 2) * 100))
    mean_val = float(np.mean(arr))
    includes_zero = ci_lower <= 0 <= ci_upper

    return {
        "ci_lower": round(ci_lower, 2),
        "ci_upper": round(ci_upper, 2),
        "mean": round(mean_val, 2),
        "includes_zero": includes_zero,
        "significant": not includes_zero,
        "n_resamples": n_resamples,
    }


def deflated_sharpe_ratio(
    observed_sharpe: float,
    n_trials: int,
    n_observations: int,
    skewness: float = 0.0,
    kurtosis: float = 3.0,
) -> dict:
    """Deflated Sharpe Ratio (Bailey & Lopez de Prado).

    Adjusts for multiple testing: if you tried n_trials strategy variants,
    what's the probability the observed Sharpe is due to chance?

    DSR = P(SR* < observed_SR) where SR* is the expected max SR under null.

    Args:
        observed_sharpe: The backtest Sharpe ratio
        n_trials: Number of strategy variants tested
        skewness: Skewness of returns (0 for normal)
        kurtosis: Kurtosis of returns (3 for normal)
        n_observations: Number of return observations (trading days)

    Returns:
        dict with dsr, expected_max_sr, significant (DSR > 1.0)

    RECONCILIATION (deepscan18 A-C1, 2026-07-05): this function used to carry its
    OWN independent re-derivation of the Bailey & Lopez de Prado DSR math,
    parallel to (and diverged from) the canonical implementation in
    risk_metrics.py::compute_deflated_sharpe_ratio(). Two bugs had crept into
    this copy that the canonical one already had fixed (deepscan17 B-2/B-7):
      1. Kurtosis term used the pre-fix `(kurtosis - 3) / 4`, which is a no-op
         at normal kurtosis=3 — Mertens (2002)'s correct term is
         `(kurtosis - 1) / 4` (contributes 0.5*SR^2 at kurtosis=3, matching
         Lo (2002)'s baseline Var(SR_hat) ~= (1 + SR^2/2)/n). The stale term
         silently understated se_sr for every normal-ish return series.
      2. `expected_max_sr` was subtracted from `observed_sharpe` on a mismatched
         scale (a raw z-units order statistic treated as if it were already on
         the Sharpe scale), instead of being scaled by the Sharpe standard error
         first (Bailey & Lopez de Prado 2014 §4; sr_benchmark = z_n * sharpe_std).
    This function's output flows: run_cross_validation() -> backtester.py
    resultExtras.deflated_sharpe (lines ~5665, ~7477) -> picker-metrics.ts
    (25% weight of the LIVE strategy-selection composite score) and the Office
    deploy-approvals card — while lifecycle-service.ts promotion gates read
    risk_metrics.py's compute_deflated_sharpe_ratio() output directly. Left
    unreconciled, the strategy PICKED to trade was ranked on the WRONG
    (unfixed) DSR math while promotion gated on the fixed one — two different
    "honesty-adjusted skill scores" for the same strategy.

    FIX: delegate the corrected z-score math to risk_metrics.py's single
    canonical implementation (single source of truth — no more parallel
    formula to drift), then convert its z-score to the [0,1] CDF probability
    this function's callers contractually expect at `deflated_sharpe.dsr`
    (picker-metrics.ts and deploy-approvals.ts both read `.dsr` directly as an
    already-CDF value — see picker-metrics.ts module docstring). The
    `n_observations < 10`/`n_trials < 1` and `n_trials == 1` short-circuits
    below are UNCHANGED (they never used the buggy kurtosis/scaling terms —
    only the multi-trial branch below is being reconciled).
    See test_dsr_reconciliation.py for the cross-implementation parity test.
    """
    if n_observations < 10 or n_trials < 1:
        return {
            "dsr": 0.0,
            "expected_max_sr": 0.0,
            "significant": False,
            "detail": "insufficient data",
        }
    # With only 1 trial, no multiple testing adjustment needed
    if n_trials == 1:
        return {
            "dsr": round(float(scipy_stats.norm.cdf(observed_sharpe * np.sqrt(n_observations))), 4),
            "expected_max_sr": 0.0,
            "significant": observed_sharpe > 0,
            "n_trials": 1,
            "n_observations": n_observations,
            "detail": "single trial — no multiple testing adjustment",
        }

    # RECONCILED: delegate to the canonical risk_metrics implementation instead
    # of re-deriving z_n / se_sr independently (see docstring above). Import is
    # local to avoid any module-load-order coupling between the two engine
    # statistics modules.
    from src.engine.risk_metrics import compute_deflated_sharpe_ratio as _canonical_dsr

    canonical = _canonical_dsr(
        observed_sharpe=observed_sharpe,
        n_trials=n_trials,
        n_observations=n_observations,
        skewness=skewness,
        kurtosis=kurtosis,
    )
    dsr_z = canonical["dsr"]  # raw z-score, ~N(0,1) under H0 — NOT a probability
    dsr_value = float(scipy_stats.norm.cdf(dsr_z))

    return {
        "dsr": round(dsr_value, 4),  # CONTRACT: [0,1] CDF — picker-metrics.ts / deploy-approvals.ts read this directly
        "expected_max_sr": round(canonical["sr_expected_max"], 4),  # z-units Bailey-LdP order-statistic bracket term
        "significant": dsr_value > 0.95,  # > 95th percentile
        "n_trials": n_trials,
        "n_observations": n_observations,
        "dsr_z": round(dsr_z, 4),  # diagnostic only — the canonical (non-CDF) z-score scale
        "p_value": canonical["p_value"],
        "passes": canonical["passes"],
    }


def determinism_test(result1: dict, result2: dict) -> dict:
    """Verify two backtest runs produce identical results.

    Compares key metrics and trade count. If any differ, the engine
    is non-deterministic (likely due to random seeds or race conditions).
    """
    keys_to_check = [
        "total_trades", "total_return", "sharpe_ratio", "max_drawdown",
        "win_rate", "profit_factor", "avg_trade_pnl",
    ]

    mismatches = []
    for key in keys_to_check:
        v1 = result1.get(key)
        v2 = result2.get(key)
        if v1 != v2:
            mismatches.append({
                "key": key,
                "run1": v1,
                "run2": v2,
            })

    # Also check trade count matches exactly
    trades1 = len(result1.get("trades", []))
    trades2 = len(result2.get("trades", []))
    if trades1 != trades2:
        mismatches.append({
            "key": "trade_list_length",
            "run1": trades1,
            "run2": trades2,
        })

    return {
        "deterministic": len(mismatches) == 0,
        "mismatches": mismatches,
    }


def compute_sortino_ratio(daily_pnls: list[float]) -> float:
    """Sortino ratio: annualized return / downside deviation.

    Downside deviation = sqrt(mean(min(r, 0)^2)) using ALL returns
    (zeros for positive days). This is the standard Sortino denominator.
    """
    if len(daily_pnls) < 2:
        return 0.0
    arr = np.array(daily_pnls)
    mean_return = np.mean(arr)
    downside_returns = np.minimum(arr, 0)
    downside_dev = np.sqrt(np.mean(downside_returns ** 2))
    if downside_dev <= 0:
        return 99.99  # No downside risk — capped to avoid distorting aggregations
    return round(float(mean_return / downside_dev * np.sqrt(252)), 4)


def run_cross_validation(
    result: dict,
    n_trials: int = 1,
    is_sharpe: float | None = None,
) -> dict:
    """Run all cross-validation tests on a backtest result.

    Args:
        result: Backtest result dict
        n_trials: Number of strategy variants tested (for DSR)
        is_sharpe: In-sample Sharpe from walk-forward optimization (for WFE)

    Returns:
        dict with all cross-validation results
    """
    daily_pnls = result.get("daily_pnls", [])
    sharpe = result.get("sharpe_ratio", 0.0)
    total_trading_days = result.get("total_trading_days", 0)

    # Bootstrap CI
    bootstrap = bootstrap_ci(daily_pnls)

    # Deflated Sharpe Ratio
    skew = float(scipy_stats.skew(daily_pnls)) if len(daily_pnls) > 2 else 0.0
    kurt = float(scipy_stats.kurtosis(daily_pnls, fisher=False)) if len(daily_pnls) > 2 else 3.0
    dsr = deflated_sharpe_ratio(
        observed_sharpe=sharpe,
        n_trials=max(n_trials, 1),
        n_observations=total_trading_days,
        skewness=skew,
        kurtosis=kurt,
    )

    # Sortino
    sortino = compute_sortino_ratio(daily_pnls)

    # Self-verification: independently recompute key metrics from trade data
    # and flag any mismatch. This catches bugs in upstream aggregation.
    trades = result.get("trades", [])
    verification = _verify_metrics(result, trades, daily_pnls)

    # WFE (when IS Sharpe available from walk-forward optimization)
    wfe = None
    if is_sharpe is not None:
        wfe = compute_wfe(is_sharpe, sharpe)

    output = {
        "bootstrap_ci_95": [bootstrap["ci_lower"], bootstrap["ci_upper"]],
        "bootstrap_significant": bootstrap["significant"],
        "deflated_sharpe": dsr,
        "sortino_ratio": sortino,
        "daily_pnl_skewness": round(skew, 4),
        "daily_pnl_kurtosis": round(kurt, 4),
        "metric_verification": verification,
        "wfe": wfe,
    }
    return output


def _verify_metrics(result: dict, trades: list, daily_pnls: list) -> dict:
    """Independently recompute metrics from trade data and flag mismatches.

    This is the system checking itself — catches aggregation bugs, averaging
    errors, or silent data corruption.
    """
    checks = []
    reported_win_rate = result.get("win_rate", 0)
    reported_pf = result.get("profit_factor", 0)
    reported_total_trades = result.get("total_trades", 0)
    reported_sharpe = result.get("sharpe_ratio", 0)

    # 1. Trade count — does the trades list match reported total?
    actual_trade_count = len(trades)
    count_match = actual_trade_count == reported_total_trades
    checks.append({
        "name": "trade_count_consistency",
        "status": "PASS" if count_match else "FAIL",
        "detail": f"reported={reported_total_trades}, actual_list={actual_trade_count}",
    })

    if not trades:
        return {"status": "SKIP", "detail": "no trades to verify", "checks": checks}

    # 2. Win rate — recompute from trade P&Ls
    trade_pnls = [float(t.get("PnL", t.get("pnl", 0))) for t in trades]
    actual_wins = sum(1 for p in trade_pnls if p > 0)
    actual_win_rate = actual_wins / len(trades) if trades else 0.0
    wr_error = abs(actual_win_rate - reported_win_rate)
    wr_ok = wr_error < 0.01  # 1% tolerance
    checks.append({
        "name": "win_rate_recomputed",
        "status": "PASS" if wr_ok else "FAIL",
        "detail": f"reported={reported_win_rate:.4f}, recomputed={actual_win_rate:.4f}, error={wr_error:.4f}",
    })

    # 3. Profit factor — recompute from trade P&Ls
    wins_total = sum(p for p in trade_pnls if p > 0)
    losses_total = sum(abs(p) for p in trade_pnls if p < 0)
    actual_pf = wins_total / losses_total if losses_total > 0 else 999.99
    pf_error = abs(actual_pf - reported_pf)
    pf_ok = pf_error < 0.05 or (reported_pf > 100 and actual_pf > 100)  # 0.05 tolerance
    checks.append({
        "name": "profit_factor_recomputed",
        "status": "PASS" if pf_ok else "FAIL",
        "detail": f"reported={reported_pf:.4f}, recomputed={actual_pf:.4f}, error={pf_error:.4f}",
    })

    # 4. Sharpe — recompute from daily P&Ls
    if len(daily_pnls) > 1:
        pnl_arr = np.array(daily_pnls)
        std = float(np.std(pnl_arr, ddof=1))
        actual_sharpe = float(np.mean(pnl_arr) / std * np.sqrt(252)) if std > 0 else 0.0
        sharpe_error = abs(actual_sharpe - reported_sharpe)
        sharpe_ok = sharpe_error < 0.1  # 0.1 tolerance
        checks.append({
            "name": "sharpe_recomputed",
            "status": "PASS" if sharpe_ok else "FAIL",
            "detail": f"reported={reported_sharpe:.4f}, recomputed={actual_sharpe:.4f}, error={sharpe_error:.4f}",
        })

    # 5. P&L direction check — if total_return is negative, majority of trades should be losers
    total_pnl = sum(trade_pnls)
    if total_pnl < 0:
        loss_trades = sum(1 for p in trade_pnls if p < 0)
        direction_ok = loss_trades > actual_wins  # More losers than winners
        checks.append({
            "name": "pnl_direction_consistency",
            "status": "PASS" if direction_ok else "FAIL",
            "detail": f"total_pnl=${total_pnl:.2f}, wins={actual_wins}, losses={loss_trades}",
        })
    elif total_pnl > 0:
        direction_ok = actual_wins > 0
        checks.append({
            "name": "pnl_direction_consistency",
            "status": "PASS" if direction_ok else "FAIL",
            "detail": f"total_pnl=${total_pnl:.2f}, wins={actual_wins}",
        })

    passed = sum(1 for c in checks if c["status"] == "PASS")
    failed = sum(1 for c in checks if c["status"] == "FAIL")

    return {
        "status": "PASS" if failed == 0 else "FAIL",
        "checks_passed": passed,
        "checks_total": len(checks),
        "checks": checks,
    }
