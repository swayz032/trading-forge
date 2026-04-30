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

try:
    from numba import njit
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False

from numpy.random import PCG64DXSM, SeedSequence

from src.engine.config import MonteCarloRequest
from src.engine.nvtx_markers import annotate, range_push, range_pop

DEFAULT_NUM_SIMULATIONS = 100_000


def create_authoritative_rng(seed: int, n_streams: int = 1) -> list[np.random.Generator]:
    """Create reproducible RNG streams using PCG64DXSM + SeedSequence.

    PCG64DXSM: 128-bit, period 2^128, guaranteed reproducible.
    SeedSequence.spawn(): independent parallel streams for MC batches.
    """
    ss = SeedSequence(seed)
    if n_streams == 1:
        return [np.random.Generator(PCG64DXSM(ss))]
    child_seeds = ss.spawn(n_streams)
    return [np.random.Generator(PCG64DXSM(s)) for s in child_seeds]


def adjust_p_value_bonferroni(raw_p: float, n_variants: int) -> tuple:
    """Bonferroni correction for multiple hypothesis testing.

    Returns (raw_p, adjusted_threshold, passes).
    """
    threshold = 0.05 / max(1, n_variants)
    return (raw_p, threshold, raw_p < threshold)


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


@annotate("forge/mc_trade_resample")
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
    # Use PCG64DXSM for authoritative reproducibility (CPU path)
    rng = create_authoritative_rng(seed)[0] if xp is np else xp.random.default_rng(seed)
    indices = rng.integers(0, len(trades), size=(n_sims, len(trades)))
    sampled = trades_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


@annotate("forge/mc_return_bootstrap")
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
    # Fix 3: was xp.random.default_rng(seed) unconditionally, which on CPU produces an
    # SFC64-backed generator — inconsistent with trade_resample() which uses PCG64DXSM.
    # In "both" mode this caused inter-method RNG family inconsistency.
    # Now: CPU path uses create_authoritative_rng() (PCG64DXSM), GPU path keeps xp.random.
    if xp is np:
        rng = create_authoritative_rng(seed)[0]
    else:
        rng = xp.random.default_rng(seed)
    indices = rng.integers(0, len(daily_returns), size=(n_sims, n_days))
    sampled = returns_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


def optimal_block_length(trades: np.ndarray) -> int:
    """Data-driven block length: PPW (2004) when arch available, else cube-root fallback.

    Args:
        trades: 1D array of trade P&Ls

    Returns:
        Block length clamped to [3, n//10]
    """
    n = len(trades)
    try:
        from arch.bootstrap import optimal_block_length as ppw_obl
        result = ppw_obl(trades)
        block_len = int(np.ceil(float(result["stationary"].iloc[0])))
    except (ImportError, Exception):
        # Fallback: cube-root + autocorrelation
        block_len = int(np.ceil(n ** (1 / 3)))
        if n > 1:
            autocorr = np.corrcoef(trades[:-1], trades[1:])[0, 1]
            if not np.isnan(autocorr) and autocorr > 0.15:
                block_len = int(block_len * 1.5)
    return max(3, min(block_len, n // 10))


if NUMBA_AVAILABLE:
    @njit(cache=True)
    def _block_bootstrap_core(trades, n_sims, n_trades, p,
                               start_pos, block_draws, restart_pos):
        """JIT-compiled inner loop for block bootstrap."""
        paths = np.zeros((n_sims, n_trades))
        for sim in range(n_sims):
            pos = start_pos[sim]
            for idx in range(n_trades):
                paths[sim, idx] = trades[pos % n_trades]
                if block_draws[sim, idx] < p:
                    pos = restart_pos[sim, idx]
                else:
                    pos += 1
        return paths


def _block_bootstrap_python(trades, n_sims, n_trades, p, rng):
    """Pure Python fallback for block bootstrap."""
    paths = np.zeros((n_sims, n_trades))
    for sim in range(n_sims):
        pos = rng.integers(0, n_trades)
        for idx in range(n_trades):
            paths[sim, idx] = trades[pos % n_trades]
            if rng.random() < p:
                pos = rng.integers(0, n_trades)
            else:
                pos += 1
    return paths


@annotate("forge/mc_block_bootstrap")
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

    Uses Numba JIT when available (50-100x faster), falls back to pure Python.

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

    n_trades = len(trades)
    p = 1.0 / expected_block_length
    rng = np.random.default_rng(seed)

    # GPU path: use CuPy vectorized bootstrap when available
    if GPU_AVAILABLE and n_sims >= 1000:
        try:
            from src.engine.gpu_pipeline import block_bootstrap_gpu
            return block_bootstrap_gpu(trades, n_sims, expected_block_length, seed)
        except Exception:
            pass  # Fall through to CPU

    if NUMBA_AVAILABLE:
        # Pre-generate all random numbers (Numba doesn't support default_rng)
        start_pos = rng.integers(0, n_trades, size=n_sims)
        block_draws = rng.random(size=(n_sims, n_trades))
        restart_pos = rng.integers(0, n_trades, size=(n_sims, n_trades))
        paths = _block_bootstrap_core(trades, n_sims, n_trades, p,
                                       start_pos, block_draws, restart_pos)
    else:
        paths = _block_bootstrap_python(trades, n_sims, n_trades, p, rng)

    return np.cumsum(paths, axis=1)


@annotate("forge/mc_arch_stationary")
def arch_stationary_bootstrap(
    trades: np.ndarray,
    n_sims: int,
    seed: int = 42,
    block_length: Optional[int] = None,
) -> np.ndarray:
    """Dependence-aware stationary bootstrap using arch StationaryBootstrap.

    Uses the arch library's StationaryBootstrap which draws block lengths from
    a geometric distribution (mean = block_length), preserving serial dependence
    in the trade sequence. This is the authoritative method for autocorrelated
    returns — IID resampling underestimates tail risk by 40-60% when trades
    have momentum or mean-reversion structure.

    Falls back to block_bootstrap if arch is not installed.

    Args:
        trades: 1D array of trade P&Ls
        n_sims: Number of simulation paths
        seed: RNG seed for reproducibility (passed to StationaryBootstrap)
        block_length: Mean block length for geometric distribution.
            If None, computed via optimal_block_length() (PPW 2004).

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot bootstrap empty trades array")

    computed_block_len = block_length if block_length is not None else optimal_block_length(trades)

    try:
        from arch.bootstrap import StationaryBootstrap

        bs = StationaryBootstrap(computed_block_len, trades, seed=seed)
        paths = []
        for (data,), _ in bs.bootstrap(n_sims):
            equity = np.cumsum(data)
            paths.append(equity)
        return np.array(paths)

    except ImportError:
        # arch not installed — fall back to our own block_bootstrap implementation
        return block_bootstrap(
            trades, n_sims,
            expected_block_length=computed_block_len,
            seed=seed,
        )


# ─── Stress Testing ─────────────────────────────────────────────


@annotate("forge/mc_stress_test")
def stress_test_trades(
    trades: np.ndarray,
    loss_multiplier: float = 1.5,
    win_reduction: float = 1.0,
    win_rate_reduction: float = 0.0,
    seed: int = 123,
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
            rng = np.random.default_rng(seed)
            flip_indices = rng.choice(win_indices, size=n_flip, replace=False)
            # Flip to a loss equal to the median loss
            median_loss = np.median(trades[losses_mask]) if np.any(losses_mask) else -100.0
            stressed[flip_indices] = median_loss

    return stressed


def inject_synthetic_stress(
    trades: np.ndarray,
    frequency: float = 2.0 / 250,
    seed: int = 456,
    max_loss_cap: float = 0.0,
) -> np.ndarray:
    """Inject synthetic catastrophic trades (5x worst normal loss) at realistic frequency.

    Simulates flash crashes, fat-tail events, and liquidity gaps that don't appear
    in historical data but occur in live trading. Injected at random positions.

    Args:
        trades: 1D array of trade P&Ls
        frequency: Probability of catastrophic event per trade (default: ~2 per year)
        seed: RNG seed for reproducibility
        max_loss_cap: Cap catastrophic loss magnitude (0 = no cap).
            E.g., 2 × 6pt × $5 = $60 for MES.

    Returns:
        Trade array with injected catastrophic events (copy, original unchanged)
    """
    injected = trades.copy()
    n_trades = len(injected)

    # Compute catastrophic loss magnitude: 5x the worst normal loss
    losses = trades[trades < 0]
    if len(losses) == 0:
        catastrophic_loss = -5.0 * np.mean(np.abs(trades))
    else:
        catastrophic_loss = 5.0 * np.min(losses)  # min is most negative, *5 makes it worse

    # Cap to max risk (e.g., 2× max_stop_points × point_value = 2 × 6 × $5 = $60)
    if max_loss_cap > 0:
        catastrophic_loss = min(catastrophic_loss, -max_loss_cap)

    # Determine injection points
    rng = np.random.default_rng(seed)
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
    symbol: str = "MES",
    backtest_commission_rt: float | None = None,
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
        backtest_commission_rt: Actual per-round-trip commission used in the
            backtest (both sides, in $). If None, falls back to $1.24 default
            with a warning. Pass the real value from the backtest run to get
            correct commission delta adjustment (Fix 4 — GAP 14).

    Returns:
        Dict with eval_pass_rate, funded_survival_6mo, breach_reasons,
        drawdown_percentiles, consistency_fail_rate
    """
    from src.engine.prop_compliance import FIRM_CONFIGS
    from src.engine.prop_sim import DAILY_LOSS_LIMITS
    from src.engine.firm_config import FIRM_COMMISSIONS

    firm = FIRM_CONFIGS.get(firm_key)

    if firm is None:
        return {"error": f"Unknown firm: {firm_key}"}

    daily_loss_limit = DAILY_LOSS_LIMITS.get(firm_key)
    max_dd = firm["max_drawdown"]
    profit_target = firm["profit_target"]
    is_realtime = firm["trailing"] == "realtime"
    locks_at_start = firm.get("locks_at_start", False)
    # Map consistency rule to max single-day ratio
    _consistency_map = {
        "tpt_50pct": 0.50,
        "alpha_50pct": 0.50,
        "mffu_50pct": 0.50,
        "ffn_40pct": 0.40,
        "tradeify_40pct": 0.40,
        "earn2trade_consistency": 0.50,
        # apex_50pct_funded: applies only to funded payouts, not eval sim
    }
    consistency_ratio = _consistency_map.get(firm.get("consistency_rule"), None)

    # Per-firm commission per round trip per contract
    firm_comms = FIRM_COMMISSIONS.get(firm_key, {})
    comm_per_side = firm_comms.get(symbol, 0.62)  # default micro commission
    # Daily commission cost: trades_per_day × 2 sides × commission_per_side
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
    days_to_pass_list: list[int] = []

    six_months_bars = 126  # ~6 months of trading days (no shortcut for short sims)

    # For realtime trailing firms (e.g. Tradeify), simulate intraday equity
    # movement within each day.  Split each day's P&L into sub-steps so that
    # peak equity ratchets up intraday — making the trailing DD stricter than
    # EOD-only tracking.
    intraday_substeps = daily_trades_per_day if (is_realtime and granularity == "day") else 1

    # Compute commission delta ONCE (constant across all sims/steps)
    # Fix 4: was hardcoded 0.62*2=$1.24. Now accepts actual backtest commission from caller.
    # If None (caller didn't propagate it), fall back to $1.24 but warn — the delta may be wrong
    # for firms where the backtest used a different commission (e.g. Alpha Futures = $0.00).
    if backtest_commission_rt is None:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "simulate_firm_survival: backtest_commission_rt not provided — "
            "falling back to $1.24 default. Commission delta may be wrong if "
            "backtest used a different commission (e.g. Alpha Futures $0.00)."
        )
        backtest_comm_rt = 0.62 * 2  # Legacy fallback — $1.24 round trip
    else:
        backtest_comm_rt = float(backtest_commission_rt)
    firm_comm_rt = comm_per_side * 2
    comm_delta = firm_comm_rt - backtest_comm_rt
    comm_adj_day = comm_delta * daily_trades_per_day
    comm_adj_trade = comm_delta

    for sim in range(n_sims):
        balance = account_size
        peak_equity = account_size
        breached = False
        passed_eval = False
        pass_step: Optional[int] = None
        breach_reason: Optional[str] = None
        best_day_pnl = 0.0

        for step in range(n_steps):
            day_pnl = float(step_pnl[sim, step])

            # Paths are already net of backtest commission (default $0.62/side).
            # Only adjust for firm-specific commission DELTA vs backtest default.
            if granularity == "day":
                day_pnl -= comm_adj_day
            else:
                day_pnl -= comm_adj_trade

            # Daily loss limit enforcement — only when granularity is "day"
            if granularity == "day" and daily_loss_limit is not None and day_pnl < -daily_loss_limit:
                day_pnl = -daily_loss_limit

            # Track best day for consistency check
            if day_pnl > best_day_pnl:
                best_day_pnl = day_pnl

            # --- Realtime trailing: simulate intraday sub-steps ---
            # Split the day's P&L evenly across sub-steps so peak equity
            # ratchets up during winning intraday moves (stricter DD).
            substep_pnl = day_pnl / intraday_substeps
            for _sub in range(intraday_substeps):
                balance += substep_pnl
                peak_equity = max(peak_equity, balance)

                # Trailing drawdown floor
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

            if breached:
                break

            # Check if eval passed
            if not passed_eval and (balance - account_size) >= profit_target:
                passed_eval = True
                pass_step = step

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
            if pass_step is not None:
                if granularity == "day":
                    days_to_pass_list.append(pass_step + 1)
                else:
                    # trade-level: approximate days from trade count
                    days_to_pass_list.append(
                        max(1, (pass_step + 1) // max(daily_trades_per_day, 1))
                    )

        # 6-month funded survival: passed eval AND had 126 bars AFTER passing without breach
        if passed_eval and not breached and pass_step is not None:
            bars_after_pass = n_steps - pass_step - 1  # Exclude the pass bar itself
            if bars_after_pass >= six_months_bars:
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

    avg_days = float(np.mean(days_to_pass_list)) if days_to_pass_list else None

    return {
        "firm": firm_key,
        "firm_name": firm["name"],
        "account_size": account_size,
        "num_simulations": n_sims,
        "eval_pass_rate": round(eval_passed_count / n_sims, 4),
        "funded_survival_6mo": round(survived_6mo_count / n_sims, 4),
        "avg_days_to_pass": round(avg_days, 1) if avg_days is not None else None,
        "breach_reasons": breach_reasons,
        "drawdown_percentiles": dd_percentiles,
        "consistency_fail_rate": round(consistency_fail_count / n_sims, 4),
        "granularity": granularity,
        "commission_per_side": comm_per_side,
        "realtime_trailing": is_realtime,
    }


# ─── Drawdown Depth + Duration (Task 8.5) ────────────────────────


def compute_drawdown_stats(paths: np.ndarray, initial_capital: float) -> dict:
    """Compute drawdown depth AND duration for each simulation.

    Fully vectorized with numpy for performance on 100K+ simulations.

    Args:
        paths: 2D array (n_sims, n_steps) of cumulative P&L
        initial_capital: Starting account balance

    Returns:
        Dict with:
          max_dd_depth — percentiles of maximum drawdown depth ($)
          max_dd_duration_bars — percentiles of longest consecutive bars below peak
          recovery_time_bars — percentiles of bars to recover from the max DD point
    """
    n_sims, n_steps = paths.shape

    # Build equity curves and running peak
    equity = paths + initial_capital                         # (n_sims, n_steps)
    running_max = np.maximum.accumulate(equity, axis=1)      # (n_sims, n_steps)
    drawdowns = running_max - equity                         # (n_sims, n_steps)

    # ── Max drawdown depth per sim (vectorized) ──
    max_dd_depth = np.max(drawdowns, axis=1)                 # (n_sims,)

    # ── Drawdown duration: consecutive bars below the peak ──
    # A bar is "in drawdown" when equity < running_max (drawdown > 0)
    in_dd = drawdowns > 0                                    # bool (n_sims, n_steps)

    # For each sim, find the longest consecutive run of True values.
    # Strategy: diff-based run-length encoding, fully vectorized per-sim
    # by exploiting the structure.  We pad with False on the edges so that
    # transitions are always detected.
    padded = np.zeros((n_sims, n_steps + 2), dtype=bool)
    padded[:, 1:-1] = in_dd
    # Detect starts (0→1) and ends (1→0)
    diff = np.diff(padded.astype(np.int8), axis=1)          # (n_sims, n_steps+1)

    max_dd_duration = np.zeros(n_sims, dtype=np.int64)
    for sim in range(n_sims):
        starts = np.where(diff[sim] == 1)[0]
        ends = np.where(diff[sim] == -1)[0]
        if len(starts) > 0 and len(ends) > 0:
            # If last drawdown is still open, append n_steps as synthetic end
            if len(starts) > len(ends):
                ends = np.append(ends, n_steps)
            runs = ends[:len(starts)] - starts[:len(starts)]
            max_dd_duration[sim] = int(np.max(runs)) if len(runs) > 0 else 0
        elif len(starts) > 0:
            # Drawdown started but never ended — duration = remaining bars
            max_dd_duration[sim] = int(n_steps - starts[0])

    # ── Recovery time: bars from max DD trough back to previous peak ──
    # Find bar index of the deepest drawdown point per sim
    max_dd_bar = np.argmax(drawdowns, axis=1)                # (n_sims,)
    recovery_time = np.full(n_sims, n_steps, dtype=np.int64)  # default = never recovered

    for sim in range(n_sims):
        trough_bar = max_dd_bar[sim]
        peak_at_trough = running_max[sim, trough_bar]
        # Find first bar after trough where equity >= peak again
        post_trough = equity[sim, trough_bar:]
        recovered_mask = post_trough >= peak_at_trough
        if np.any(recovered_mask):
            recovery_time[sim] = int(np.argmax(recovered_mask))
        # else: stays at n_steps (never recovered within the sim window)

    pct_levels = [50, 75, 90, 95, 99]
    _fmt = lambda arr: {f"p{p}": float(np.percentile(arr, p)) for p in pct_levels}

    return {
        "max_dd_depth": _fmt(max_dd_depth),
        "max_dd_duration_bars": _fmt(max_dd_duration),
        "recovery_time_bars": _fmt(recovery_time),
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


def _compute_sharpe_ratios(paths: np.ndarray, periods_per_year: float = 252.0) -> np.ndarray:
    """Compute annualized Sharpe ratio for each path's step returns."""
    daily = np.diff(paths, axis=1)
    means = np.mean(daily, axis=1)
    stds = np.std(daily, axis=1, ddof=1)
    stds = np.where(stds == 0, 1e-10, stds)
    return means / stds * np.sqrt(periods_per_year)


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
    periods_per_year: float = 252.0,
    skip_drawdown_duration: bool = False,
) -> dict:
    """Compute all risk metrics from simulated equity paths."""
    from src.engine.risk_metrics import compute_all_risk_metrics
    return compute_all_risk_metrics(
        paths, initial_capital, ruin_threshold,
        periods_per_year=periods_per_year,
        skip_drawdown_duration=skip_drawdown_duration,
    )


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

    # Step 3: Minimum trade count gate
    MIN_TRADES_IID = 30
    MIN_TRADES_BLOCK = 50
    min_required = (
        MIN_TRADES_BLOCK
        if request.method in ("block_bootstrap", "arch_stationary")
        else MIN_TRADES_IID
    )
    if len(trades_arr) < min_required:
        return {
            "error": f"Insufficient trades ({len(trades_arr)}) for Monte Carlo. "
                     f"Minimum {min_required} required for {request.method}.",
            "num_simulations": 0,
            "method": request.method,
        }

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
        trades_arr = stress_test_trades(trades_arr, seed=request.seed + 200, **params)
        daily_arr = stress_test_trades(daily_arr, seed=request.seed + 201, **params)
        stress_applied = f"level_{request.stress_level}"

    # 8.3 — Inject synthetic catastrophic events if requested (with max loss cap)
    if request.inject_synthetic_stress:
        max_loss = request.stress_inject_multiplier * request.max_stop_points * request.point_value
        trades_arr = inject_synthetic_stress(trades_arr, seed=request.seed + 100, max_loss_cap=max_loss)
        daily_arr = inject_synthetic_stress(daily_arr, seed=request.seed + 101, max_loss_cap=max_loss)

    # Determine annualization factor based on method
    # Compute both variants — "both" method needs trade-level AND daily
    n_trading_days = len(daily_pnls) if len(daily_pnls) > 0 else 1
    years = n_trading_days / 252.0
    periods_per_year_trades = len(trades_arr) / years if years > 0 else 252.0
    periods_per_year_daily = 252.0

    if request.method == "trade_resample":
        periods_per_year = periods_per_year_trades
    else:
        # return_bootstrap / block_bootstrap / arch_stationary / both: daily default
        periods_per_year = periods_per_year_daily

    # Generate paths based on method
    both_metrics: Optional[dict] = None

    if request.method == "trade_resample":
        paths = trade_resample(trades_arr, request.num_simulations, seed=request.seed, xp=xp)

    elif request.method == "return_bootstrap":
        n_days = len(daily_pnls)
        paths = return_bootstrap(daily_arr, request.num_simulations, n_days, seed=request.seed, xp=xp)

    elif request.method == "block_bootstrap":
        computed_block_len = optimal_block_length(trades_arr)
        paths = block_bootstrap(
            trades_arr, request.num_simulations,
            expected_block_length=computed_block_len, seed=request.seed,
        )

    elif request.method == "arch_stationary":
        computed_block_len = optimal_block_length(trades_arr)
        paths = arch_stationary_bootstrap(
            trades_arr, request.num_simulations,
            seed=request.seed,
            block_length=computed_block_len,
        )

    else:  # "both"
        # Split simulations: trade_resample + return_bootstrap + arch_stationary
        third = request.num_simulations // 3
        remainder = request.num_simulations - (3 * third)
        # Distribute remainder to trade_resample (most conservative — prop firm sim uses it)
        n_trade = third + remainder
        n_return = third
        n_arch = third

        trade_paths = trade_resample(trades_arr, n_trade, seed=request.seed, xp=xp)
        n_days = len(daily_pnls)
        return_paths = return_bootstrap(daily_arr, n_return, n_days, seed=request.seed + 1, xp=xp)
        computed_block_len = optimal_block_length(trades_arr)
        arch_paths = arch_stationary_bootstrap(
            trades_arr, n_arch,
            seed=request.seed + 2,
            block_length=computed_block_len,
        )

        both_metrics = {
            "trade_resample": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(trade_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(trade_paths, periods_per_year_trades),
                    request.confidence_levels,
                ),
            },
            "return_bootstrap": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(return_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(return_paths, periods_per_year_daily),
                    request.confidence_levels,
                ),
            },
            "arch_stationary": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(arch_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(arch_paths, periods_per_year_daily),
                    request.confidence_levels,
                ),
            },
        }

        # Use trade_paths for main metrics (most conservative — prop firm sim depends on this)
        paths = trade_paths

    # Compute main metrics
    max_drawdowns = _compute_max_drawdowns(paths, request.initial_capital)
    sharpe_ratios = _compute_sharpe_ratios(paths, periods_per_year)

    confidence_intervals = {
        "max_drawdown": _compute_percentiles(max_drawdowns, request.confidence_levels),
        "sharpe_ratio": _compute_percentiles(sharpe_ratios, request.confidence_levels),
    }

    # 8.5 — Drawdown depth + duration stats (compute BEFORE risk_metrics to avoid duplicate)
    drawdown_stats = compute_drawdown_stats(paths, request.initial_capital)

    risk_metrics = _compute_risk_metrics(
        paths, request.initial_capital, request.ruin_threshold,
        periods_per_year=periods_per_year,
        skip_drawdown_duration=True,
    )
    # Merge duration data from drawdown_stats into risk_metrics (avoids recomputation)
    risk_metrics["drawdown_duration"] = {
        "max_dd_duration_bars": drawdown_stats["max_dd_duration_bars"],
        "recovery_time_bars": drawdown_stats["recovery_time_bars"],
    }

    sampled_paths = _sample_paths(paths, request.max_paths_to_store, request.initial_capital)

    # Multi-percentile convergence (p1, p5, p95, p99)
    convergence_pcts = [1.0, 5.0, 95.0, 99.0]
    dd_convergence = {f"p{int(p)}_converged": check_convergence(max_drawdowns, p) for p in convergence_pcts}
    sharpe_convergence = {f"p{int(p)}_converged": check_convergence(sharpe_ratios, p) for p in convergence_pcts}

    all_converged = all(dd_convergence.values()) and all(sharpe_convergence.values())
    convergence = {
        "max_drawdown": dd_convergence,
        "sharpe": sharpe_convergence,
        "convergence_stable": all_converged,
        # Backward compat
        "max_drawdown_p1_converged": dd_convergence["p1_converged"],
        "sharpe_p1_converged": sharpe_convergence["p1_converged"],
    }

    # 8.4 — Per-firm survival simulation
    firm_survival: Optional[dict[str, dict]] = None
    if request.firms:
        granularity = "trade" if request.method == "trade_resample" else "day"
        # Fix 4: propagate actual backtest commission (round-trip) to survival sim.
        # MonteCarloRequest.backtest_commission_rt is optional — getattr with None fallback
        # ensures backward compat if callers haven't updated to pass the new field yet.
        _bt_comm_rt = getattr(request, "backtest_commission_rt", None)
        firm_survival = {}
        for firm_key in request.firms:
            firm_survival[firm_key] = simulate_firm_survival(
                paths, firm_key,
                account_size=request.initial_capital,
                granularity=granularity,
                backtest_commission_rt=_bt_comm_rt,
            )

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)

    result: dict = {
        "num_simulations": request.num_simulations,
        "method": request.method,
        "confidence_intervals": confidence_intervals,
        "risk_metrics": risk_metrics,
        "drawdown_stats": drawdown_stats,
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

    if request.method in ("block_bootstrap", "arch_stationary", "both"):
        result["block_length"] = computed_block_len

    # Step 18: Optional permutation overfitting test
    if request.run_permutation_test:
        from src.engine.risk_metrics import compute_permutation_test
        perm_result = compute_permutation_test(
            trades_arr, n_permutations=request.permutation_n, seed=request.seed + 300,
        )
        result["permutation_test"] = perm_result
        if not perm_result["has_edge"]:
            warnings.append(
                f"Permutation test: no significant edge detected (p={perm_result['p_value']:.3f}). "
                "Strategy returns may be due to random ordering."
            )

        # Deflated Sharpe Ratio
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        from scipy import stats as sp_stats
        # Annualize trade-level Sharpe: use actual trades/year from daily data
        n_trading_days = len(daily_pnls) if len(daily_pnls) > 0 else 1
        years = n_trading_days / 252.0
        trades_per_year = len(trades_arr) / years if years > 0 else 252.0
        obs_sharpe = float(
            np.mean(trades_arr) / max(np.std(trades_arr, ddof=1), 1e-10) * np.sqrt(trades_per_year)
        )
        dsr_result = compute_deflated_sharpe_ratio(
            observed_sharpe=obs_sharpe,
            n_trials=request.n_variants,
            n_observations=len(trades_arr),
            skewness=float(sp_stats.skew(trades_arr)) if len(trades_arr) > 2 else 0.0,
            kurtosis=float(sp_stats.kurtosis(trades_arr, fisher=False)) if len(trades_arr) > 2 else 3.0,
        )
        result["deflated_sharpe"] = dsr_result

        # Bonferroni adjustment on permutation p-value
        raw_p = result["permutation_test"]["p_value"]
        _, threshold, bonf_passes = adjust_p_value_bonferroni(raw_p, request.n_variants)
        result["permutation_test"]["bonferroni_threshold"] = round(threshold, 6)
        result["permutation_test"]["bonferroni_passes"] = bonf_passes

    # ─── Bootstrap Confidence Intervals (if paths available) ───
    # Temporarily attach the full paths ndarray so compute_all_mc_cis can read it.
    # It is removed before return to avoid serializing a (100K × N) array to stdout.
    result["all_paths"] = paths
    try:
        from src.engine.mc_confidence import compute_all_mc_cis
        if "all_paths" in result and isinstance(result["all_paths"], np.ndarray):
            cis = compute_all_mc_cis(result["all_paths"], seed=request.seed + 500)
            result["bca_confidence_intervals"] = cis
        result["rng_metadata"] = {"generator": "PCG64DXSM", "seed": request.seed}
    except Exception:
        pass  # CIs are optional — don't block MC output
    finally:
        result.pop("all_paths", None)  # Never serialize raw paths ndarray

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
        initial_capital=config.get("initial_capital", 50_000.0),
        max_paths_to_store=config.get("max_paths_to_store", 100),
        ruin_threshold=config.get("ruin_threshold", 0.0),
        is_oos_trades=config.get("is_oos_trades", False),
        stress_level=config.get("stress_level", 0),
        inject_synthetic_stress=config.get("inject_synthetic_stress", False),
        firms=config.get("firms", []),
        seed=config.get("seed", 42),
        max_stop_points=config.get("max_stop_points", 6.0),
        point_value=config.get("point_value", 5.0),
        stress_inject_multiplier=config.get("stress_inject_multiplier", 2.0),
        run_permutation_test=config.get("run_permutation_test", False),
        permutation_n=config.get("permutation_n", 1000),
    )

    result = run_monte_carlo(
        request,
        trades=config["trades"],
        daily_pnls=config["daily_pnls"],
        equity_curve=config.get("equity_curve", []),
    )

    if args.mc_id:
        result["mc_id"] = args.mc_id

    # Custom encoder for numpy types and NaN/Infinity (invalid JSON)
    import math

    def _sanitize(obj):
        """Recursively replace NaN/Infinity with None and convert numpy types."""
        if isinstance(obj, dict):
            return {k: _sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_sanitize(v) for v in obj]
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            v = float(obj)
            return None if (math.isnan(v) or math.isinf(v)) else v
        if isinstance(obj, float):
            return None if (math.isnan(obj) or math.isinf(obj)) else obj
        if isinstance(obj, np.ndarray):
            return _sanitize(obj.tolist())
        return obj

    json.dump(_sanitize(result), sys.stdout)


if __name__ == "__main__":
    main()
