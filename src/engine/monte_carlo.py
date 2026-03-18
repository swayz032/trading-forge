"""Monte Carlo simulation engine — GPU-accelerated via cuPy, falls back to NumPy.

Wave 8 overhaul:
  - Block bootstrap (stationary) replaces IID for autocorrelation preservation
  - Stress testing multipliers (3 severity levels)
  - Synthetic catastrophic trade injection
  - Per-firm survival simulation
  - Convergence checking at 1st percentile
  - OOS-only warning gate
  - Fixed "both" method padding bug (separate reporting)

Usage:
    python -m src.engine.monte_carlo --config '{"backtest_id":"...","trades":[...],"daily_pnls":[...]}'
"""

from __future__ import annotations

import json
import sys
import time
from typing import Optional

import numpy as np

try:
    import cupy as cp
    GPU_AVAILABLE = True
except ImportError:
    cp = None
    GPU_AVAILABLE = False

from src.engine.config import MonteCarloRequest

DEFAULT_NUM_SIMULATIONS = 100_000


def get_array_module(use_gpu: bool):
    """Return cupy if GPU requested and available, else numpy."""
    if use_gpu and GPU_AVAILABLE:
        return cp
    return np


def _to_numpy(arr, xp) -> np.ndarray:
    """Convert array to numpy (handles both cupy and numpy)."""
    if xp is np:
        return arr
    return cp.asnumpy(arr)


# ─── Bootstrap Methods ───────────────────────────────────────────


def trade_resample(
    trades: np.ndarray,
    n_sims: int,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Resample trade P&Ls with replacement, compute equity paths.

    Shuffles the trade sequence n_sims times to test: "If these same trades
    happened in a different order, what would the drawdown look like?"

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot resample empty trades array")

    if xp is None:
        xp = np

    trades_xp = xp.asarray(trades)
    rng = xp.random.default_rng(seed)
    indices = rng.integers(0, len(trades), size=(n_sims, len(trades)))
    sampled = trades_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


def return_bootstrap(
    daily_returns: np.ndarray,
    n_sims: int,
    n_days: int,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Bootstrap daily returns to generate simulated equity paths.

    Returns:
        2D array of shape (n_sims, n_days) — cumulative equity paths
    """
    if len(daily_returns) == 0:
        raise ValueError("Cannot bootstrap empty daily returns array")

    if xp is None:
        xp = np

    returns_xp = xp.asarray(daily_returns)
    rng = xp.random.default_rng(seed)
    indices = rng.integers(0, len(daily_returns), size=(n_sims, n_days))
    sampled = returns_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


def optimal_block_length(trades: np.ndarray) -> int:
    """Data-driven block length: n^(1/3) adjusted for autocorrelation.

    Uses the cube-root rule as a base, then scales up by 1.5x if first-order
    autocorrelation exceeds 0.15 (indicating meaningful serial dependence).

    Args:
        trades: 1D array of trade P&Ls

    Returns:
        Block length clamped to [3, n//10]
    """
    n = len(trades)
    base = int(np.ceil(n ** (1 / 3)))
    if n > 1:
        autocorr = np.corrcoef(trades[:-1], trades[1:])[0, 1]
        if not np.isnan(autocorr) and autocorr > 0.15:
            base = int(base * 1.5)
    return max(3, min(base, n // 10))


def block_bootstrap(
    trades: np.ndarray,
    n_sims: int,
    expected_block_length: int = 8,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Stationary bootstrap — random block lengths preserve autocorrelation.

    Uses circular wrapping and geometric distribution for block boundaries.
    IID bootstrap destroys consecutive loss streaks (underestimates risk by
    40-60%). Block bootstrap preserves serial dependence in trade sequences.

    Args:
        trades: 1D array of trade P&Ls
        n_sims: Number of simulation paths
        expected_block_length: Mean block length (geometric distribution)
        seed: RNG seed for reproducibility
        xp: Array module (ignored — block bootstrap is CPU-only)

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot bootstrap empty trades array")

    # Block bootstrap is CPU-only (control flow per-sim)
    rng = np.random.default_rng(seed)
    n_trades = len(trades)
    p = 1.0 / expected_block_length

    paths = np.zeros((n_sims, n_trades))
    for sim in range(n_sims):
        idx = 0
        pos = rng.integers(0, n_trades)
        while idx < n_trades:
            paths[sim, idx] = trades[pos % n_trades]
            idx += 1
            if rng.random() < p:
                pos = rng.integers(0, n_trades)
            else:
                pos += 1

    return np.cumsum(paths, axis=1)


# ─── Stress Testing ─────────────────────────────────────────────


def stress_test_trades(
    trades: np.ndarray,
    loss_multiplier: float = 1.5,
    win_reduction: float = 1.0,
    win_rate_reduction: float = 0.0,
) -> np.ndarray:
    """Amplify losses and/or reduce wins for stress testing.

    Levels:
      Level 1 (moderate): loss_multiplier=1.5
      Level 2 (severe): loss_multiplier=2.0, win_reduction=0.75
      Level 3 (extreme): loss_multiplier=2.5, win_reduction=0.5, wr_reduction=0.10

    Args:
        trades: 1D array of trade P&Ls
        loss_multiplier: Factor to multiply losing trades by (>1 = worse losses)
        win_reduction: Factor to multiply winning trades by (<1 = smaller wins)
        win_rate_reduction: Fraction of winning trades to flip to losses (0-1)

    Returns:
        Stressed trade array (copy, original unchanged)
    """
    stressed = trades.copy()

    # Amplify losses
    losses_mask = stressed < 0
    stressed[losses_mask] *= loss_multiplier

    # Reduce wins
    wins_mask = stressed > 0
    stressed[wins_mask] *= win_reduction

    # Flip some wins to losses (simulate reduced win rate)
    if win_rate_reduction > 0:
        win_indices = np.where(wins_mask)[0]
        n_flip = int(len(win_indices) * win_rate_reduction)
        if n_flip > 0:
            rng = np.random.default_rng(123)
            flip_indices = rng.choice(win_indices, size=n_flip, replace=False)
            # Flip to a loss equal to the median loss
            median_loss = np.median(trades[losses_mask]) if np.any(losses_mask) else -100.0
            stressed[flip_indices] = median_loss

    return stressed


def inject_synthetic_stress(
    trades: np.ndarray,
    frequency: float = 2.0 / 250,
) -> np.ndarray:
    """Inject synthetic catastrophic trades (5x worst normal loss) at realistic frequency.

    Simulates flash crashes, fat-tail events, and liquidity gaps that don't appear
    in historical data but occur in live trading. Injected at random positions.

    Args:
        trades: 1D array of trade P&Ls
        frequency: Probability of catastrophic event per trade (default: ~2 per year)

    Returns:
        Trade array with injected catastrophic events (copy, original unchanged)
    """
    injected = trades.copy()
    n_trades = len(injected)

    # Compute catastrophic loss magnitude: 5x the worst normal loss
    losses = trades[trades < 0]
    if len(losses) == 0:
        # No losses in history — use 5% of mean absolute trade size
        catastrophic_loss = -5.0 * np.mean(np.abs(trades))
    else:
        catastrophic_loss = 5.0 * np.min(losses)  # min is most negative, *5 makes it worse

    # Determine injection points
    rng = np.random.default_rng(456)
    n_events = rng.binomial(n_trades, frequency)
    if n_events > 0:
        injection_indices = rng.choice(n_trades, size=n_events, replace=False)
        injected[injection_indices] = catastrophic_loss

    return injected


def _get_stress_params(level: int) -> dict:
    """Get stress testing parameters for a given severity level.

    Args:
        level: 0=none, 1=moderate, 2=severe, 3=extreme

    Returns:
        Dict with loss_multiplier, win_reduction, win_rate_reduction
    """
    if level == 1:
        return {"loss_multiplier": 1.5, "win_reduction": 1.0, "win_rate_reduction": 0.0}
    elif level == 2:
        return {"loss_multiplier": 2.0, "win_reduction": 0.75, "win_rate_reduction": 0.0}
    elif level == 3:
        return {"loss_multiplier": 2.5, "win_reduction": 0.5, "win_rate_reduction": 0.10}
    return {"loss_multiplier": 1.0, "win_reduction": 1.0, "win_rate_reduction": 0.0}


# ─── Per-Firm Survival Simulation ────────────────────────────────


def simulate_firm_survival(
    paths: np.ndarray,
    firm_key: str,
    account_size: float = 50000,
    daily_trades_per_day: int = 3,
    granularity: str = "day",
    symbol: str = "ES",
) -> dict:
    """Per-firm Monte Carlo survival simulation.

    Walks each MC path through firm rules (daily loss limits, trailing DD,
    consistency, commissions). Returns pass rates, survival rates, breach
    reasons, and drawdown percentiles.

    Args:
        paths: 2D array (n_sims, n_steps) of cumulative P&L
        firm_key: Firm identifier (e.g. "topstep_50k")
        account_size: Starting account balance
        daily_trades_per_day: Assumed trades per day for commission calc
        granularity: "day" or "trade". When "trade", daily loss limit
            enforcement is skipped (each row is a trade, not a day).
        symbol: Contract symbol for commission lookup

    Returns:
        Dict with eval_pass_rate, funded_survival_6mo, breach_reasons,
        drawdown_percentiles, consistency_fail_rate
    """
    from src.engine.prop_compliance import FIRM_CONFIGS
    from src.engine.prop_sim import DAILY_LOSS_LIMITS
    from src.engine.firm_config import FIRM_COMMISSIONS

    # Handle earn2trade specially
    if firm_key == "earn2trade_50k":
        from src.engine.prop_sim import EARN2TRADE_CONFIG
        firm = EARN2TRADE_CONFIG
    else:
        firm = FIRM_CONFIGS.get(firm_key)

    if firm is None:
        return {"error": f"Unknown firm: {firm_key}"}

    daily_loss_limit = DAILY_LOSS_LIMITS.get(firm_key)
    max_dd = firm["max_drawdown"]
    profit_target = firm["profit_target"]
    is_realtime = firm["trailing"] == "realtime"
    locks_at_start = firm.get("locks_at_start", True)
    # Map consistency rule to max single-day ratio
    _consistency_map = {
        "tpt_50pct": 0.50,
        "alpha_50pct": 0.50,
        "ffn_15pct": 0.15,
    }
    consistency_ratio = _consistency_map.get(firm.get("consistency_rule"), None)

    # Per-firm commission per round trip per contract
    firm_comms = FIRM_COMMISSIONS.get(firm_key, {})
    comm_per_side = firm_comms.get(symbol, 2.52)  # default $2.52/side
    # Daily commission cost: trades_per_day × 2 sides × commission_per_side
    daily_commission = daily_trades_per_day * 2 * comm_per_side

    n_sims = paths.shape[0]
    n_steps = paths.shape[1]

    # Convert cumulative P&L paths to step-level P&L
    step_pnl = np.diff(paths, axis=1, prepend=0)

    eval_passed_count = 0
    survived_6mo_count = 0
    consistency_fail_count = 0
    breach_reasons: dict[str, int] = {
        "trailing_dd": 0,
        "daily_loss_limit": 0,
        "never_hit_target": 0,
        "consistency": 0,
    }
    max_drawdowns_all = np.zeros(n_sims)

    six_months_bars = min(126, n_steps)  # ~6 months of trading days

    for sim in range(n_sims):
        balance = account_size
        peak_equity = account_size
        breached = False
        passed_eval = False
        breach_reason: Optional[str] = None
        best_day_pnl = 0.0

        for step in range(n_steps):
            day_pnl = float(step_pnl[sim, step])

            # Deduct per-firm commissions (per day or per trade based on granularity)
            if granularity == "day":
                day_pnl -= daily_commission
            else:
                # Per-trade: deduct one round-trip commission
                day_pnl -= 2 * comm_per_side

            # Daily loss limit enforcement — only when granularity is "day"
            if granularity == "day" and daily_loss_limit is not None and day_pnl < -daily_loss_limit:
                day_pnl = -daily_loss_limit

            # Track best day for consistency check
            if day_pnl > best_day_pnl:
                best_day_pnl = day_pnl

            balance += day_pnl
            peak_equity = max(peak_equity, balance)

            # Trailing drawdown check
            if locks_at_start:
                floor = max(peak_equity - max_dd, account_size - max_dd)
            else:
                floor = peak_equity - max_dd

            dd_from_peak = peak_equity - balance
            max_drawdowns_all[sim] = max(max_drawdowns_all[sim], dd_from_peak)

            if balance <= floor and not breached:
                breached = True
                breach_reason = "trailing_dd"
                if granularity == "day" and daily_loss_limit is not None and day_pnl <= -daily_loss_limit:
                    breach_reason = "daily_loss_limit"
                break

            # Check if eval passed
            if not passed_eval and (balance - account_size) >= profit_target:
                passed_eval = True

        if not breached and not passed_eval:
            breach_reason = "never_hit_target"

        # Consistency check: best single day cannot exceed X% of total profit
        total_profit = balance - account_size
        if passed_eval and not breached and consistency_ratio is not None and total_profit > 0:
            if best_day_pnl / total_profit > consistency_ratio:
                passed_eval = False
                breached = True
                breach_reason = "consistency"
                consistency_fail_count += 1

        if passed_eval and not breached:
            eval_passed_count += 1

        # 6-month funded survival: passed eval AND survived 6mo without breach
        if passed_eval and not breached and n_steps >= six_months_bars:
            survived_6mo_count += 1

        if breach_reason:
            breach_reasons[breach_reason] = breach_reasons.get(breach_reason, 0) + 1

    # Drawdown percentiles
    dd_percentiles = {
        "p50": float(np.percentile(max_drawdowns_all, 50)),
        "p75": float(np.percentile(max_drawdowns_all, 75)),
        "p90": float(np.percentile(max_drawdowns_all, 90)),
        "p95": float(np.percentile(max_drawdowns_all, 95)),
        "p99": float(np.percentile(max_drawdowns_all, 99)),
    }

    return {
        "firm": firm_key,
        "firm_name": firm["name"],
        "account_size": account_size,
        "num_simulations": n_sims,
        "eval_pass_rate": round(eval_passed_count / n_sims, 4),
        "funded_survival_6mo": round(survived_6mo_count / n_sims, 4),
        "breach_reasons": breach_reasons,
        "drawdown_percentiles": dd_percentiles,
        "consistency_fail_rate": round(consistency_fail_count / n_sims, 4),
        "granularity": granularity,
        "commission_per_side": comm_per_side,
    }


# ─── Convergence Check ──────────────────────────────────────────


def check_convergence(values: np.ndarray, percentile: float = 1.0) -> bool:
    """Check if percentile estimate has stabilized (within 5% between halves).

    Splits the value array in half and compares the target percentile computed
    on the first half vs the full array. If relative difference < 5%, the
    estimate has converged.

    Args:
        values: 1D array of metric values (e.g. max drawdowns from each sim)
        percentile: Percentile to check (default 1.0 = 1st percentile)

    Returns:
        True if converged (stable estimate)
    """
    half = len(values) // 2
    if half == 0:
        return False
    first_half = np.percentile(values[:half], percentile)
    full = np.percentile(values, percentile)
    relative_diff = abs(full - first_half) / (abs(full) + 1e-10)
    return relative_diff < 0.05


# ─── Helper Functions ────────────────────────────────────────────


def _compute_max_drawdowns(paths: np.ndarray, initial_capital: float) -> np.ndarray:
    """Compute max drawdown for each equity path."""
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    drawdowns = running_max - equity
    return np.max(drawdowns, axis=1)


def _compute_sharpe_ratios(paths: np.ndarray) -> np.ndarray:
    """Compute annualized Sharpe ratio for each path's daily returns."""
    daily = np.diff(paths, axis=1)
    means = np.mean(daily, axis=1)
    stds = np.std(daily, axis=1, ddof=1)
    stds = np.where(stds == 0, 1e-10, stds)
    return means / stds * np.sqrt(252)


def _compute_percentiles(values: np.ndarray, levels: list[float]) -> dict:
    """Compute named percentiles from an array."""
    result = {}
    for level in levels:
        pct = level * 100
        key = f"p{int(pct)}"
        result[key] = float(np.percentile(values, pct))
    return result


def _sample_paths(
    paths: np.ndarray,
    max_store: int,
    initial_capital: float,
) -> list[list[float]]:
    """Sample representative equity paths for storage/visualization."""
    n_sims = paths.shape[0]
    if n_sims <= max_store:
        indices = list(range(n_sims))
    else:
        final_values = paths[:, -1]
        sorted_idx = np.argsort(final_values)
        step = max(1, n_sims // max_store)
        indices = sorted_idx[::step][:max_store]

    sampled = []
    for i in indices:
        path = [initial_capital] + (paths[i] + initial_capital).tolist()
        sampled.append(path)
    return sampled


def _compute_risk_metrics(
    paths: np.ndarray,
    initial_capital: float,
    ruin_threshold: float,
) -> dict:
    """Compute all risk metrics from simulated equity paths."""
    from src.engine.risk_metrics import compute_all_risk_metrics
    return compute_all_risk_metrics(paths, initial_capital, ruin_threshold)


# ─── Main Orchestrator ──────────────────────────────────────────


def run_monte_carlo(
    request: MonteCarloRequest,
    trades: list[float],
    daily_pnls: list[float],
    equity_curve: list[float],
) -> dict:
    """Run full Monte Carlo simulation.

    Supports block bootstrap, stress testing, synthetic catastrophic injection,
    per-firm survival simulation, convergence checking, and OOS warnings.

    Returns:
        Dict with confidence_intervals, risk_metrics, paths, metadata,
        warnings, convergence, firm_survival (optional), stress_applied
    """
    start_time = time.perf_counter()

    xp = get_array_module(request.use_gpu)
    gpu_used = xp is not np

    trades_arr = np.array(trades, dtype=np.float64)
    daily_arr = np.array(daily_pnls, dtype=np.float64)

    warnings: list[str] = []

    # 8.7 — OOS gate warning
    if not request.is_oos_trades:
        warnings.append(
            "MC running on non-OOS trades — results may be overfit. "
            "Use walk-forward OOS trades."
        )

    # 8.2 — Apply stress testing if requested
    stress_applied: Optional[str] = None
    if request.stress_level > 0:
        params = _get_stress_params(request.stress_level)
        trades_arr = stress_test_trades(trades_arr, **params)
        daily_arr = stress_test_trades(daily_arr, **params)
        stress_applied = f"level_{request.stress_level}"

    # 8.3 — Inject synthetic catastrophic events if requested
    if request.inject_synthetic_stress:
        trades_arr = inject_synthetic_stress(trades_arr)
        daily_arr = inject_synthetic_stress(daily_arr)

    # Generate paths based on method
    both_metrics: Optional[dict] = None

    if request.method == "trade_resample":
        paths = trade_resample(trades_arr, request.num_simulations, seed=42, xp=xp)

    elif request.method == "return_bootstrap":
        n_days = len(daily_pnls)
        paths = return_bootstrap(daily_arr, request.num_simulations, n_days, seed=42, xp=xp)

    elif request.method == "block_bootstrap":
        # 8.1 — Auto-compute optimal block length
        block_len = optimal_block_length(trades_arr)
        paths = block_bootstrap(
            trades_arr, request.num_simulations,
            expected_block_length=block_len, seed=42,
        )

    else:  # "both"
        # 8.8 — Fixed padding bug: separate reporting instead of padding
        half = request.num_simulations // 2
        other_half = request.num_simulations - half
        trade_paths = trade_resample(trades_arr, half, seed=42, xp=xp)
        n_days = len(daily_pnls)
        return_paths = return_bootstrap(daily_arr, other_half, n_days, seed=43, xp=xp)

        # Report metrics separately for each method (no padding)
        both_metrics = {
            "trade_resample": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(trade_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(trade_paths),
                    request.confidence_levels,
                ),
            },
            "return_bootstrap": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(return_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(return_paths),
                    request.confidence_levels,
                ),
            },
        }

        # Use trade_paths for main metrics (more conservative for prop firm sim)
        paths = trade_paths

    # Compute main metrics
    max_drawdowns = _compute_max_drawdowns(paths, request.initial_capital)
    sharpe_ratios = _compute_sharpe_ratios(paths)

    confidence_intervals = {
        "max_drawdown": _compute_percentiles(max_drawdowns, request.confidence_levels),
        "sharpe_ratio": _compute_percentiles(sharpe_ratios, request.confidence_levels),
    }

    risk_metrics = _compute_risk_metrics(
        paths, request.initial_capital, request.ruin_threshold,
    )

    sampled_paths = _sample_paths(paths, request.max_paths_to_store, request.initial_capital)

    # 8.6 — Convergence check at 1st percentile
    dd_converged = check_convergence(max_drawdowns, percentile=1.0)
    sharpe_converged = check_convergence(sharpe_ratios, percentile=1.0)
    convergence = {
        "max_drawdown_p1_converged": dd_converged,
        "sharpe_p1_converged": sharpe_converged,
        "convergence_stable": dd_converged and sharpe_converged,
    }

    # 8.4 — Per-firm survival simulation
    firm_survival: Optional[dict[str, dict]] = None
    if request.firms:
        # Determine granularity: trade_resample produces trade-level paths,
        # return_bootstrap / block_bootstrap produce day-level paths
        granularity = "trade" if request.method == "trade_resample" else "day"
        firm_survival = {}
        for firm_key in request.firms:
            firm_survival[firm_key] = simulate_firm_survival(
                paths, firm_key,
                account_size=request.initial_capital,
                granularity=granularity,
            )

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)

    result: dict = {
        "num_simulations": request.num_simulations,
        "method": request.method,
        "confidence_intervals": confidence_intervals,
        "risk_metrics": risk_metrics,
        "paths": sampled_paths,
        "execution_time_ms": elapsed_ms,
        "gpu_accelerated": gpu_used,
        "convergence": convergence,
        "warnings": warnings,
    }

    if stress_applied:
        result["stress_applied"] = stress_applied

    if request.inject_synthetic_stress:
        result["synthetic_stress_injected"] = True

    if both_metrics:
        result["both_method_breakdown"] = both_metrics

    if firm_survival:
        result["firm_survival"] = firm_survival

    if request.method == "block_bootstrap":
        result["block_length"] = optimal_block_length(np.array(trades, dtype=np.float64))

    return result


# ─── CLI Entry Point ─────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.monte_carlo --config <json> [--mc-id <uuid>]"""
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Monte Carlo Simulation Engine")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    parser.add_argument("--mc-id", default=None, help="Monte Carlo run ID")
    args = parser.parse_args()

    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    request = MonteCarloRequest(
        backtest_id=config.get("backtest_id", "cli"),
        num_simulations=config.get("num_simulations", DEFAULT_NUM_SIMULATIONS),
        method=config.get("method", "both"),
        use_gpu=config.get("use_gpu", True),
        initial_capital=config.get("initial_capital", 100_000.0),
        max_paths_to_store=config.get("max_paths_to_store", 100),
        ruin_threshold=config.get("ruin_threshold", 0.0),
        is_oos_trades=config.get("is_oos_trades", False),
        stress_level=config.get("stress_level", 0),
        inject_synthetic_stress=config.get("inject_synthetic_stress", False),
        firms=config.get("firms", []),
    )

    result = run_monte_carlo(
        request,
        trades=config["trades"],
        daily_pnls=config["daily_pnls"],
        equity_curve=config.get("equity_curve", []),
    )

    if args.mc_id:
        result["mc_id"] = args.mc_id

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
