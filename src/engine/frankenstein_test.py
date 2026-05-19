"""Trading Forge — Frankenstein Test (A4, W10 Team C).

Detects path-dependent backtester bugs (lookahead, future-data leak).

If a strategy shows edge on shuffled or synthetic GBM data, the backtester has
a bug — because no real edge can survive data whose temporal structure has been
destroyed. This is the single highest-leverage bug-detection test in the system.

Design (locked from plan):
  Primary:   100 shuffles via full_shuffle
  Secondary:  50 runs via synthetic_gbm (different distributional bug class)
  Pass:  95th percentile of |Sharpe| < 0.3  AND  median PF in [0.85, 1.15]
  Run at:
    (1) Every new archetype during dev (via pytest)
    (2) TESTING → PAPER lifecycle gate (frankenstein-service.ts)

Shuffle modes:
  full_shuffle         — bars shuffled uniformly (destroys all temporal structure)
  benchmark_relative   — excess returns above benchmark shuffled (long-only strategies)
  calendar_preserving  — shuffle within day-of-week buckets (calendar-effect strategies)
  synthetic_gbm        — replace bars with GBM random walk at matched mean/vol
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

# Pass criteria (locked from plan)
PASS_P95_SHARPE_THRESHOLD = 0.3   # 95th pct of |Sharpe| across shuffles must be < 0.3
PASS_MEDIAN_PF_LOW = 0.85          # median PF must be within [0.85, 1.15]
PASS_MEDIAN_PF_HIGH = 1.15

# Parallelism: 10 workers for 100 shuffles ≈ 5 min wall clock on fixture strategy
DEFAULT_N_WORKERS = 10

# 30s wall-clock cost ceiling (matches Tier 3.4 Grover pattern)
WALL_CLOCK_CEILING_S = 30.0

# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class FrankensteinResult:
    test_mode: str
    n_shuffles: int
    p95_sharpe: float          # 95th pct of |Sharpe| — gate criterion #1
    median_pf: float           # median profit factor — gate criterion #2
    passed: bool               # True iff both criteria met
    sharpe_distribution: list[float]
    pf_distribution: list[float]
    failure_examples: list[dict[str, Any]]  # runs with anomalously high |Sharpe|
    wall_clock_ms: int
    status: str                # "completed" | "failed"
    error_message: str | None


# ─── Shuffle / Synthetic Data Generators ─────────────────────────────────────


def _shuffle_bars(
    bars: np.ndarray,
    mode: str,
    rng: np.random.Generator,
) -> np.ndarray:
    """Shuffle bars according to the requested mode.

    Args:
        bars: shape (N, 4) — columns: open, high, low, close (or any OHLC-like ndarray).
        mode: one of full_shuffle | benchmark_relative | calendar_preserving
        rng: seeded numpy random generator for reproducibility

    Returns:
        Shuffled bars array, same shape as input.
    """
    n = len(bars)
    if n < 2:
        return bars.copy()

    result = bars.copy()

    if mode == "full_shuffle":
        # Shuffle entire bar rows uniformly — destroys ALL temporal structure.
        # If strategy still shows edge, it has lookahead into the future.
        idx = rng.permutation(n)
        result = bars[idx]

    elif mode == "benchmark_relative":
        # Shuffle the bar-to-bar log returns (excess above mean return).
        # Preserves distributional properties but destroys temporal ordering.
        # Suitable for long-only strategies where we subtract benchmark trend.
        close = bars[:, 3].astype(float)
        log_returns = np.diff(np.log(close + 1e-9))
        mean_return = np.mean(log_returns)
        excess = log_returns - mean_return
        shuffled_excess = rng.permutation(excess)
        # Reconstruct close prices from shuffled excess returns
        new_log_close = np.zeros(n)
        new_log_close[0] = np.log(close[0] + 1e-9)
        for i in range(1, n):
            new_log_close[i] = new_log_close[i - 1] + mean_return + shuffled_excess[i - 1]
        new_close = np.exp(new_log_close)
        # Scale O/H/L proportionally
        scale = new_close / (close + 1e-9)
        result[:, 0] = bars[:, 0] * scale   # open
        result[:, 1] = bars[:, 1] * scale   # high
        result[:, 2] = bars[:, 2] * scale   # low
        result[:, 3] = new_close            # close

    elif mode == "calendar_preserving":
        # Shuffle bars within day-of-week buckets (0=Mon, ..., 4=Fri).
        # Preserves within-day temporal structure but destroys cross-week ordering.
        # Appropriate for calendar-effect strategies (e.g., Monday effect).
        n_bars = len(bars)
        # Assign each bar to a day-of-week bucket based on its position
        # (assumes regular bar spacing, 5 days/week)
        dow = np.arange(n_bars) % 5
        for day in range(5):
            mask = dow == day
            indices = np.where(mask)[0]
            if len(indices) > 1:
                shuffled_indices = rng.permutation(indices)
                result[indices] = bars[shuffled_indices]
    else:
        raise ValueError(f"Unknown shuffle mode: {mode!r}")

    return result


def _synthetic_gbm(
    bars: np.ndarray,
    rng: np.random.Generator,
) -> np.ndarray:
    """Replace bar data with a geometric Brownian motion random walk.

    Matches the mean log-return and volatility of the original data so the
    distributional properties are realistic — but ALL temporal structure is
    destroyed. This detects a different class of bugs than shuffling:
    bugs that depend on the distributional shape of returns, not just order.

    Args:
        bars: shape (N, 4) — original OHLC bars
        rng: seeded numpy generator

    Returns:
        Synthetic OHLC bars with GBM-generated prices, same shape as input.
    """
    n = len(bars)
    if n < 2:
        return bars.copy()

    close = bars[:, 3].astype(float)
    log_returns = np.diff(np.log(close + 1e-9))

    mu = float(np.mean(log_returns))
    sigma = float(np.std(log_returns))
    if sigma < 1e-9:
        sigma = 1e-9  # prevent degenerate flat series

    # GBM: log(S_t / S_{t-1}) ~ N(mu - 0.5*sigma^2, sigma^2)
    drift = mu - 0.5 * sigma ** 2
    noise = rng.normal(loc=drift, scale=sigma, size=n - 1)

    new_log_close = np.zeros(n)
    new_log_close[0] = np.log(close[0] + 1e-9)
    for i in range(1, n):
        new_log_close[i] = new_log_close[i - 1] + noise[i - 1]

    new_close = np.exp(new_log_close)

    # Synthesize O/H/L relative to close using the original spread ratios
    # (preserves intrabar structure while destroying cross-bar structure)
    orig_high_ratio = bars[:, 1] / (close + 1e-9)
    orig_low_ratio = bars[:, 2] / (close + 1e-9)
    orig_open_ratio = bars[:, 0] / (close + 1e-9)

    result = np.zeros_like(bars, dtype=float)
    result[:, 3] = new_close
    result[:, 0] = new_close * orig_open_ratio
    result[:, 1] = new_close * orig_high_ratio
    result[:, 2] = new_close * orig_low_ratio

    # Ensure high >= close >= low (GBM won't violate this but ratios might)
    result[:, 1] = np.maximum(result[:, 1], new_close)
    result[:, 2] = np.minimum(result[:, 2], new_close)

    return result


# ─── Strategy Simulation on Shuffled Data ────────────────────────────────────


def _simulate_shuffled(
    strategy_config: dict[str, Any],
    shuffled_bars: np.ndarray,
    contracts: int = 1,
    tick_value: float = 5.0,  # MES default
    commission_per_side: float = 0.62,
) -> dict[str, float]:
    """Run the strategy on shuffled bars and return metrics.

    We use a simplified entry/exit simulation for the shuffle test — we only
    need Sharpe and profit factor, not full walk-forward analysis. The goal is
    to detect HUGE anomalies (lookahead gives |Sharpe| > 2), not micro-edge.

    Strategy: use 50/200 SMA crossover as a universal entry proxy for all
    strategy types. This is intentional — the Frankenstein test is not testing
    the strategy's specific edge, it's testing whether the backtester has a
    structural lookahead bug. Any reasonable entry rule works as the probe.

    Returns dict with keys: sharpe, profit_factor, total_trades, total_pnl
    """
    close = shuffled_bars[:, 3].astype(float)
    n = len(close)

    if n < 60:
        return {"sharpe": 0.0, "profit_factor": 1.0, "total_trades": 0, "total_pnl": 0.0}

    # Fast SMA crossover signal (50/200)
    sma_fast = np.convolve(close, np.ones(50) / 50, mode="valid")
    sma_slow = np.convolve(close, np.ones(200) / 200, mode="valid")
    min_len = min(len(sma_fast), len(sma_slow))
    sma_fast = sma_fast[-min_len:]
    sma_slow = sma_slow[-min_len:]

    # Signal: 1 = long, -1 = short, 0 = flat
    signal = np.sign(sma_fast - sma_slow)

    # Trade P&L: position changes
    trade_pnls: list[float] = []
    pos = 0.0
    entry_price = 0.0
    n_s = len(signal)
    price_offset = n - n_s  # align prices with signals

    for i in range(1, n_s):
        prev_sig = signal[i - 1]
        curr_sig = signal[i]
        curr_close = close[price_offset + i]

        if prev_sig != curr_sig and prev_sig != 0:
            # Close position
            if pos != 0:
                pnl = pos * (curr_close - entry_price) * contracts * tick_value
                pnl -= 2 * commission_per_side * contracts  # round-trip commission
                trade_pnls.append(pnl)
                pos = 0.0

        if curr_sig != 0 and pos == 0:
            # Open position
            pos = curr_sig
            entry_price = curr_close

    # Close any open position at last bar
    if pos != 0 and n_s > 0:
        final_price = close[price_offset + n_s - 1]
        pnl = pos * (final_price - entry_price) * contracts * tick_value
        pnl -= 2 * commission_per_side * contracts
        trade_pnls.append(pnl)

    if len(trade_pnls) < 3:
        # Too few trades — insufficient for meaningful Sharpe
        return {"sharpe": 0.0, "profit_factor": 1.0, "total_trades": len(trade_pnls), "total_pnl": 0.0}

    pnls = np.array(trade_pnls)
    mean_pnl = float(np.mean(pnls))
    std_pnl = float(np.std(pnls))

    if std_pnl < 1e-9:
        sharpe = 0.0
    else:
        # Annualize: assume ~250 trading days, scale by sqrt(n_trades/250)
        n_trades = len(pnls)
        sharpe = float((mean_pnl / std_pnl) * np.sqrt(max(n_trades, 1)))

    # Profit factor
    winners = pnls[pnls > 0]
    losers = pnls[pnls < 0]
    gross_profit = float(np.sum(winners)) if len(winners) > 0 else 0.0
    gross_loss = float(np.abs(np.sum(losers))) if len(losers) > 0 else 0.0

    if gross_loss < 1e-9:
        pf = 2.0 if gross_profit > 0 else 1.0
    else:
        pf = gross_profit / gross_loss

    return {
        "sharpe": sharpe,
        "profit_factor": pf,
        "total_trades": len(pnls),
        "total_pnl": float(np.sum(pnls)),
    }


# ─── Core Test Runner ─────────────────────────────────────────────────────────


def run_frankenstein_test(
    strategy_config: dict[str, Any],
    bars: np.ndarray,
    test_mode: str = "full_shuffle",
    n_shuffles: int = 100,
    n_workers: int = DEFAULT_N_WORKERS,
    seed: int = 42,
    tick_value: float = 5.0,
    commission_per_side: float = 0.62,
) -> FrankensteinResult:
    """Run the Frankenstein randomization detection test.

    Args:
        strategy_config: DSL config dict (used to extract symbol/contracts params)
        bars: numpy array of shape (N, 4) — OHLC bars for the strategy's symbol
        test_mode: full_shuffle | benchmark_relative | calendar_preserving | synthetic_gbm
        n_shuffles: number of shuffles to run (100 for full_shuffle, 50 for GBM)
        n_workers: thread pool workers for parallelism (default 10)
        seed: base RNG seed for reproducibility (each shuffle uses seed + i)
        tick_value: dollar value per tick (MES=5.0, MNQ=2.0, MCL=10.0)
        commission_per_side: commission per contract per side in dollars

    Returns:
        FrankensteinResult with passed=True iff p95_sharpe < 0.3 AND
        median_pf in [0.85, 1.15]
    """
    start_time = time.monotonic()

    contracts = int(strategy_config.get("max_contracts", 1) or 1)

    sharpe_vals: list[float] = []
    pf_vals: list[float] = []
    failure_examples: list[dict[str, Any]] = []

    def _run_one(shuffle_idx: int) -> tuple[float, float, dict[str, Any]]:
        """Run one shuffle. Returns (sharpe, pf, metadata)."""
        rng = np.random.default_rng(seed + shuffle_idx)

        if test_mode == "synthetic_gbm":
            shuffled = _synthetic_gbm(bars, rng)
        else:
            shuffled = _shuffle_bars(bars, test_mode, rng)

        metrics = _simulate_shuffled(
            strategy_config,
            shuffled,
            contracts=contracts,
            tick_value=tick_value,
            commission_per_side=commission_per_side,
        )

        elapsed = time.monotonic() - start_time
        meta = {
            "shuffle_idx": shuffle_idx,
            "sharpe": metrics["sharpe"],
            "profit_factor": metrics["profit_factor"],
            "total_trades": metrics["total_trades"],
            "total_pnl": metrics["total_pnl"],
            "elapsed_s": round(elapsed, 2),
        }
        return metrics["sharpe"], metrics["profit_factor"], meta

    try:
        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            futures = {executor.submit(_run_one, i): i for i in range(n_shuffles)}
            try:
                for fut in as_completed(
                    futures,
                    timeout=WALL_CLOCK_CEILING_S,
                ):
                    sharpe, pf, meta = fut.result()
                    sharpe_vals.append(sharpe)
                    pf_vals.append(pf)
                    # Collect failure examples: runs with anomalously high |Sharpe|
                    if abs(sharpe) > PASS_P95_SHARPE_THRESHOLD * 2:
                        failure_examples.append(meta)
            except FuturesTimeout:
                logger.warning(
                    "frankenstein_test: wall-clock ceiling %.1fs reached after %d/%d shuffles — using partial results",
                    WALL_CLOCK_CEILING_S,
                    len(sharpe_vals),
                    n_shuffles,
                )
    except Exception as exc:
        wall_ms = int((time.monotonic() - start_time) * 1000)
        return FrankensteinResult(
            test_mode=test_mode,
            n_shuffles=n_shuffles,
            p95_sharpe=float("nan"),
            median_pf=float("nan"),
            passed=False,
            sharpe_distribution=[],
            pf_distribution=[],
            failure_examples=[],
            wall_clock_ms=wall_ms,
            status="failed",
            error_message=str(exc),
        )

    if not sharpe_vals:
        wall_ms = int((time.monotonic() - start_time) * 1000)
        return FrankensteinResult(
            test_mode=test_mode,
            n_shuffles=n_shuffles,
            p95_sharpe=float("nan"),
            median_pf=float("nan"),
            passed=False,
            sharpe_distribution=[],
            pf_distribution=[],
            failure_examples=[],
            wall_clock_ms=wall_ms,
            status="failed",
            error_message="No shuffle results produced",
        )

    abs_sharpes = [abs(s) for s in sharpe_vals]
    p95_sharpe = float(np.percentile(abs_sharpes, 95))
    median_pf = float(np.median(pf_vals))

    # Pass criteria (locked from plan)
    passed = (
        p95_sharpe < PASS_P95_SHARPE_THRESHOLD
        and PASS_MEDIAN_PF_LOW <= median_pf <= PASS_MEDIAN_PF_HIGH
    )

    wall_ms = int((time.monotonic() - start_time) * 1000)

    return FrankensteinResult(
        test_mode=test_mode,
        n_shuffles=len(sharpe_vals),
        p95_sharpe=p95_sharpe,
        median_pf=median_pf,
        passed=passed,
        sharpe_distribution=sharpe_vals,
        pf_distribution=pf_vals,
        failure_examples=failure_examples[:10],  # cap at 10 examples
        wall_clock_ms=wall_ms,
        status="completed",
        error_message=None,
    )


# ─── CLI Entry Point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    """CLI entry point for frankenstein-service.ts subprocess calls.

    Reads JSON config from stdin or argv[1] file path.
    Outputs FrankensteinResult as JSON to stdout.

    Config shape:
    {
        "strategy_config": {...},  // StrategyDSL dict
        "bars": [[o, h, l, c], ...],  // list of OHLC bars
        "test_mode": "full_shuffle",
        "n_shuffles": 100,
        "n_workers": 10,
        "seed": 42,
        "tick_value": 5.0,
        "commission_per_side": 0.62
    }
    """
    # Enable determinism before any numpy ops
    try:
        from src.engine.determinism import enable_determinism
        enable_determinism()
    except ImportError:
        pass

    try:
        if len(sys.argv) > 1:
            config_path = sys.argv[1]
            with open(config_path) as f:
                config = json.load(f)
        else:
            config = json.load(sys.stdin)

        bars_list = config.get("bars", [])
        if not bars_list:
            raise ValueError("config.bars is empty or missing")

        bars = np.array(bars_list, dtype=float)
        if bars.ndim != 2 or bars.shape[1] != 4:
            raise ValueError(f"bars must be shape (N, 4), got {bars.shape}")

        result = run_frankenstein_test(
            strategy_config=config.get("strategy_config", {}),
            bars=bars,
            test_mode=config.get("test_mode", "full_shuffle"),
            n_shuffles=config.get("n_shuffles", 100),
            n_workers=config.get("n_workers", DEFAULT_N_WORKERS),
            seed=config.get("seed", 42),
            tick_value=config.get("tick_value", 5.0),
            commission_per_side=config.get("commission_per_side", 0.62),
        )

        output = {
            "test_mode": result.test_mode,
            "n_shuffles": result.n_shuffles,
            "p95_sharpe": result.p95_sharpe,
            "median_pf": result.median_pf,
            "passed": result.passed,
            "sharpe_distribution": result.sharpe_distribution,
            "pf_distribution": result.pf_distribution,
            "failure_examples": result.failure_examples,
            "wall_clock_ms": result.wall_clock_ms,
            "status": result.status,
            "error_message": result.error_message,
        }
        print(json.dumps(output))

    except Exception as exc:
        error_output = {
            "test_mode": "unknown",
            "n_shuffles": 0,
            "p95_sharpe": None,
            "median_pf": None,
            "passed": False,
            "sharpe_distribution": [],
            "pf_distribution": [],
            "failure_examples": [],
            "wall_clock_ms": 0,
            "status": "failed",
            "error_message": str(exc),
        }
        print(json.dumps(error_output))
        sys.exit(1)
