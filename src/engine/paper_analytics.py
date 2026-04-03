"""Post-trade analytics for paper sessions.

Computes Sharpe, Sortino, Calmar, max drawdown, rolling metrics.
Optional QuantStats HTML tear sheet generation.
"""
from __future__ import annotations

import json
import sys

import numpy as np

try:
    import quantstats as qs
    import pandas as pd
    QS_AVAILABLE = True
except ImportError:
    QS_AVAILABLE = False
    pd = None


def generate_session_report(
    daily_returns: list[float],
    benchmark_returns: list[float] | None = None,
    output_path: str | None = None,
    title: str = "Paper Session Report",
) -> dict:
    """Generate metrics dict + optional HTML tear sheet for a paper session.

    Args:
        daily_returns: List of daily P&L values (dollars)
        benchmark_returns: Optional benchmark for comparison
        output_path: If provided and QuantStats available, generate HTML report
        title: Report title

    Returns:
        Dict of performance metrics
    """
    returns = np.array(daily_returns, dtype=np.float64)
    returns = returns[np.isfinite(returns)]

    if len(returns) < 2:
        return {"error": "insufficient_data", "n_days": len(returns)}

    # Generate HTML if QuantStats available.
    if QS_AVAILABLE and output_path and pd is not None:
        try:
            ret_series = pd.Series(returns, name="Strategy")
            bench = pd.Series(benchmark_returns) if benchmark_returns else None
            qs.reports.html(ret_series, benchmark=bench, output=output_path, title=title)
        except Exception as exc:
            # Non-critical: metrics dict is the primary output.
            print(f"[paper_analytics] QuantStats report generation failed: {exc}", file=sys.stderr)

    # Compute metrics
    mean_ret = float(np.mean(returns))
    std_ret = float(np.std(returns, ddof=1)) if len(returns) > 1 else 1e-10
    std_ret = max(std_ret, 1e-10)

    # Sharpe (annualized)
    sharpe = (mean_ret / std_ret) * np.sqrt(252) if std_ret > 0 else 0.0

    # Sortino (downside deviation)
    downside = returns[returns < 0]
    downside_std = float(np.std(downside, ddof=1)) if len(downside) > 1 else std_ret
    downside_std = max(downside_std, 1e-10)
    sortino = (mean_ret / downside_std) * np.sqrt(252)

    # Max drawdown
    equity = np.cumsum(returns)
    peak = np.maximum.accumulate(equity)
    drawdown = equity - peak
    max_dd = float(np.min(drawdown))

    # Calmar
    calmar = (mean_ret * 252) / abs(max_dd) if max_dd != 0 else 0.0

    # Rolling max drawdown (30-day window)
    rolling_dd = []
    window = min(30, len(returns))
    for i in range(window, len(returns) + 1):
        chunk = returns[i - window:i]
        chunk_equity = np.cumsum(chunk)
        chunk_peak = np.maximum.accumulate(chunk_equity)
        rolling_dd.append(float(np.min(chunk_equity - chunk_peak)))

    # Win rate
    win_rate = float(np.mean(returns > 0)) if len(returns) > 0 else 0.0

    # Profit factor
    gross_profit = float(np.sum(returns[returns > 0]))
    gross_loss = abs(float(np.sum(returns[returns < 0])))
    profit_factor = gross_profit / max(gross_loss, 1e-10)

    # Average win/loss
    wins = returns[returns > 0]
    losses = returns[returns < 0]
    avg_win = float(np.mean(wins)) if len(wins) > 0 else 0.0
    avg_loss = float(np.mean(losses)) if len(losses) > 0 else 0.0

    return {
        "sharpe": round(float(sharpe), 4),
        "sortino": round(float(sortino), 4),
        "calmar": round(float(calmar), 4),
        "max_drawdown": round(float(max_dd), 2),
        "rolling_max_drawdown_30d": rolling_dd[-1] if rolling_dd else max_dd,
        "win_rate": round(win_rate, 4),
        "profit_factor": round(float(profit_factor), 4),
        "best_day": round(float(np.max(returns)), 2),
        "worst_day": round(float(np.min(returns)), 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "total_pnl": round(float(np.sum(returns)), 2),
        "n_days": len(returns),
        "quantstats_available": QS_AVAILABLE,
    }


if __name__ == "__main__":
    config_raw = sys.stdin.read() if not sys.argv[1:] else sys.argv[1]
    try:
        config = json.loads(config_raw)
    except Exception:
        config = json.load(sys.stdin)

    result = generate_session_report(
        daily_returns=config["daily_returns"],
        output_path=config.get("output_path"),
        title=config.get("title", "Paper Session Report"),
    )
    print(json.dumps(result, indent=2))
