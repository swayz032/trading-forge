"""Trading Forge — Core Backtest Engine.

Orchestrates: data loading → indicators → signals → vectorbt portfolio.
CLI: python backtester.py --config <json> --backtest-id <uuid> --mode single|walkforward
Output: JSON to stdout, progress/errors to stderr (matches databento.ts bridge pattern).
"""

from __future__ import annotations

import json
import sys
import time
from typing import Optional

import click
import numpy as np
import polars as pl
import vectorbt as vbt

from src.engine.config import (
    BacktestRequest,
    CONTRACT_SPECS,
    IndicatorConfig,
    StrategyConfig,
)
from src.engine.data_loader import load_ohlcv
from src.engine.indicators.core import compute_indicators, compute_atr
from src.engine.signals import generate_signals
from src.engine.sizing import compute_position_sizes
from src.engine.slippage import compute_slippage


def _extract_atr_period(config: StrategyConfig) -> int:
    """Find ATR period from strategy indicators, default 14."""
    for ind in config.indicators:
        if ind.type == "atr":
            return ind.period
    return 14


def _compute_daily_pnls(equity: np.ndarray) -> list[float]:
    """Compute daily P&L from equity curve."""
    if len(equity) < 2:
        return []
    pnls = np.diff(equity)
    return [round(float(p), 2) for p in pnls]


def run_backtest(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    fill_rate: float = 1.0,
) -> dict:
    """Run a single backtest and return metrics dict.

    Args:
        request: Backtest configuration
        data: Optional pre-loaded data (for testing). If None, loads from S3.
        fill_rate: Fraction of entry signals to keep (0.0-1.0). Used for
            crisis stress testing to simulate reduced fill rates.

    Returns:
        dict with metrics, equity_curve, trades, daily_pnls, execution_time_ms
    """
    start_time = time.time()
    config = request.strategy
    spec = CONTRACT_SPECS[config.symbol]
    atr_period = _extract_atr_period(config)

    # ─── Load data ─────────────────────────────────────────────
    if data is None:
        print(f"Loading {config.symbol} {config.timeframe} data...", file=sys.stderr)
        data = load_ohlcv(
            config.symbol, config.timeframe,
            request.start_date, request.end_date,
        )

    # ─── Compute indicators ───────────────────────────────────
    # Ensure ATR is included for sizing/slippage
    indicator_configs = list(config.indicators)
    if not any(ind.type == "atr" for ind in indicator_configs):
        indicator_configs.append(IndicatorConfig(type="atr", period=atr_period))

    df = compute_indicators(data, indicator_configs)

    # ─── Generate signals ─────────────────────────────────────
    df = generate_signals(df, config, fill_rate=fill_rate)

    # ─── Position sizing ──────────────────────────────────────
    sizes = compute_position_sizes(df, config.position_size, spec, atr_period)

    # ─── Slippage ─────────────────────────────────────────────
    slippage_arr = compute_slippage(df, spec, request.slippage_ticks, atr_period)

    # ─── Convert to Pandas at vectorbt boundary (CLAUDE.md rule) ─
    close_pd = df["close"].to_pandas()
    entries_pd = df["entry_long"].to_pandas()
    exits_pd = df["exit_long"].to_pandas()

    # Clean NaN values
    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Run vectorbt Portfolio ───────────────────────────────
    try:
        pf = vbt.Portfolio.from_signals(
            close=close_pd,
            entries=entries_pd,
            exits=exits_pd,
            size=sizes_clean,
            slippage=slippage_clean / close_pd,  # Dollar → fraction
            fees=request.commission_per_side / close_pd,  # Dollar → fraction
            freq="1D",
            init_cash=100_000.0,
        )
    except Exception as e:
        print(f"vectorbt error: {e}", file=sys.stderr)
        return _empty_result(str(e), time.time() - start_time)

    # ─── Extract metrics ──────────────────────────────────────
    equity = pf.value().values
    daily_pnls = _compute_daily_pnls(equity)

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None

    win_rate = 0.0
    profit_factor = 0.0
    avg_trade_pnl = 0.0
    winner_loser_ratio = 0.0
    trades_list: list[dict] = []

    if trades_records is not None:
        # Find PnL column
        pnl_col = next(
            (c for c in ["PnL", "pnl", "P&L"] if c in trades_records.columns),
            None,
        )
        if pnl_col:
            trade_pnls = trades_records[pnl_col].values
            winners = trade_pnls[trade_pnls > 0]
            losers = trade_pnls[trade_pnls < 0]

            win_rate = float(len(winners) / total_trades)
            avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
            avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 1.0
            gross_profit = float(np.sum(winners))
            gross_loss = float(np.abs(np.sum(losers)))
            profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
            avg_trade_pnl = float(np.mean(trade_pnls))
            winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

        # Build serializable trades list
        for _, row in trades_records.iterrows():
            trade: dict = {}
            for col in trades_records.columns:
                val = row[col]
                if hasattr(val, "isoformat"):
                    trade[col] = val.isoformat()
                elif isinstance(val, (np.integer, np.floating)):
                    trade[col] = round(float(val), 4)
                else:
                    trade[col] = val
            trades_list.append(trade)

    # Daily stats
    winning_days = sum(1 for p in daily_pnls if p > 0)
    total_trading_days = len(daily_pnls)
    avg_daily_pnl = float(np.mean(daily_pnls)) if daily_pnls else 0.0

    # Max consecutive losing days
    max_consec_losers = 0
    streak = 0
    for p in daily_pnls:
        if p < 0:
            streak += 1
            max_consec_losers = max(max_consec_losers, streak)
        else:
            streak = 0

    total_return = float(pf.total_return())
    max_dd = float(pf.max_drawdown())
    sharpe_raw = pf.sharpe_ratio()
    sharpe = float(sharpe_raw) if not np.isnan(sharpe_raw) else 0.0

    # Cap infinite values for JSON
    if profit_factor == float("inf"):
        profit_factor = 999.99
    if winner_loser_ratio == float("inf"):
        winner_loser_ratio = 999.99

    elapsed_ms = int((time.time() - start_time) * 1000)

    return {
        "total_return": round(total_return, 6),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2),
        "avg_daily_pnl": round(avg_daily_pnl, 2),
        "winning_days": winning_days,
        "total_trading_days": total_trading_days,
        "max_consecutive_losing_days": max_consec_losers,
        "expectancy_per_trade": round(avg_trade_pnl, 2),
        "avg_winner_to_loser_ratio": round(winner_loser_ratio, 4),
        "equity_curve": [round(float(v), 2) for v in equity],
        "trades": trades_list,
        "daily_pnls": daily_pnls,
        "execution_time_ms": elapsed_ms,
    }


def _empty_result(error: str, elapsed: float) -> dict:
    """Return an empty result dict on failure."""
    return {
        "total_return": 0.0,
        "sharpe_ratio": 0.0,
        "max_drawdown": 0.0,
        "win_rate": 0.0,
        "profit_factor": 0.0,
        "total_trades": 0,
        "avg_trade_pnl": 0.0,
        "avg_daily_pnl": 0.0,
        "winning_days": 0,
        "total_trading_days": 0,
        "max_consecutive_losing_days": 0,
        "expectancy_per_trade": 0.0,
        "avg_winner_to_loser_ratio": 0.0,
        "equity_curve": [],
        "trades": [],
        "daily_pnls": [],
        "execution_time_ms": int(elapsed * 1000),
        "error": error,
    }


# ─── CLI Entry Point ──────────────────────────────────────────────

@click.command()
@click.option("--config", "config_json", required=True, help="JSON config string")
@click.option("--backtest-id", default=None, help="UUID for this backtest run")
@click.option("--mode", default="single", type=click.Choice(["single", "walkforward"]))
def main(config_json: str, backtest_id: Optional[str], mode: str):
    """Run backtest engine. Outputs JSON to stdout, errors to stderr."""
    try:
        request = BacktestRequest.model_validate_json(config_json)
    except Exception as e:
        print(json.dumps({"error": f"Invalid config: {e}"}))
        sys.exit(1)

    if mode == "walkforward":
        from src.engine.walk_forward import run_walk_forward
        result = run_walk_forward(request)
    else:
        result = run_backtest(request)

    if backtest_id:
        result["backtest_id"] = backtest_id

    print(json.dumps(result))


if __name__ == "__main__":
    main()
