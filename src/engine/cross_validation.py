"""Cross-validation — statistical tests for backtest significance.

Tests:
1. Walk-Forward Efficiency (WFE)
2. Bootstrap CI for daily P&L
3. Deflated Sharpe Ratio (DSR)
4. Determinism test
5. Parameter perturbation (placeholder — requires optimizer integration)
"""

from __future__ import annotations

import hashlib
import json
import numpy as np
from scipy import stats as scipy_stats


def compute_wfe(is_sharpe: float, oos_sharpe: float) -> dict:
    """Walk-Forward Efficiency: OOS Sharpe / IS Sharpe.

    > 0.3 acceptable, > 0.5 good, < 0.1 likely overfit.
    """
    if is_sharpe <= 0 or np.isnan(is_sharpe):
        return {"wfe": 0.0, "interpretation": "IS Sharpe <= 0 — cannot compute WFE"}

    wfe = oos_sharpe / is_sharpe
    if wfe > 0.5:
        interp = "good"
    elif wfe > 0.3:
        interp = "acceptable"
    elif wfe > 0.1:
        interp = "weak"
    else:
        interp = "likely_overfit"

    return {"wfe": round(wfe, 4), "interpretation": interp}


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

    rng = np.random.RandomState(seed)
    arr = np.array(daily_pnls)
    means = np.array([
        rng.choice(arr, size=len(arr), replace=True).mean()
        for _ in range(n_resamples)
    ])

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

    # Expected maximum Sharpe ratio under null hypothesis (Euler-Mascheroni approximation)
    euler_mascheroni = 0.5772156649
    z_n = (1 - euler_mascheroni) * scipy_stats.norm.ppf(1 - 1.0 / n_trials) + \
          euler_mascheroni * scipy_stats.norm.ppf(1 - 1.0 / (n_trials * np.e))

    expected_max_sr = z_n * np.sqrt(1.0 / n_observations)

    # Standard error of the Sharpe ratio (Lo 2002, extended for non-normal)
    se_sr = np.sqrt(
        (1 + 0.5 * observed_sharpe ** 2 - skewness * observed_sharpe +
         ((kurtosis - 3) / 4) * observed_sharpe ** 2) / n_observations
    )

    if se_sr <= 0:
        return {
            "dsr": 0.0,
            "expected_max_sr": round(expected_max_sr, 4),
            "significant": False,
            "detail": "SE(SR) <= 0",
        }

    # DSR = CDF((observed - expected_max) / SE)
    dsr_value = float(scipy_stats.norm.cdf((observed_sharpe - expected_max_sr) / se_sr))

    return {
        "dsr": round(dsr_value, 4),
        "expected_max_sr": round(expected_max_sr, 4),
        "significant": dsr_value > 0.95,  # > 95th percentile
        "n_trials": n_trials,
        "n_observations": n_observations,
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
    """Sortino ratio: annualized return / downside deviation."""
    if len(daily_pnls) < 2:
        return 0.0
    arr = np.array(daily_pnls)
    mean_return = np.mean(arr)
    downside = arr[arr < 0]
    if len(downside) == 0:
        return 999.99
    downside_std = np.std(downside, ddof=1)
    if downside_std <= 0:
        return 999.99
    return round(float(mean_return / downside_std * np.sqrt(252)), 4)


def run_cross_validation(
    result: dict,
    n_trials: int = 1,
) -> dict:
    """Run all cross-validation tests on a backtest result.

    Args:
        result: Backtest result dict
        n_trials: Number of strategy variants tested (for DSR)

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

    output = {
        "bootstrap_ci_95": [bootstrap["ci_lower"], bootstrap["ci_upper"]],
        "bootstrap_significant": bootstrap["significant"],
        "deflated_sharpe": dsr,
        "sortino_ratio": sortino,
        "daily_pnl_skewness": round(skew, 4),
        "daily_pnl_kurtosis": round(kurt, 4),
        "metric_verification": verification,
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
