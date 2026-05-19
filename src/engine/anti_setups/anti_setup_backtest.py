"""Backtest P&L impact of applying anti-setup filters."""

from __future__ import annotations

import math
import statistics
from typing import Any

from .filter_gate import should_filter


def backtest_with_filters(
    trades: list[dict],
    anti_setups: list[dict],
    confidence_threshold: float = 0.80,
) -> dict:
    """
    Replay trades with anti-setup filters applied.

    Returns:
        {
            "original": {"pnl": float, "trades": int, "win_rate": float, "sharpe": float},
            "filtered": {"pnl": float, "trades": int, "win_rate": float, "sharpe": float},
            "improvement": {
                "pnl_delta": float,
                "pnl_pct_change": float,
                "trades_removed": int,
                "win_rate_change": float,
                "sharpe_change": float,
            },
            "filter_breakdown": [
                {"condition": str, "trades_removed": int, "pnl_saved": float},
            ],
        }
    """
    if not trades:
        empty_stats = {"pnl": 0.0, "trades": 0, "win_rate": 0.0, "sharpe": 0.0}
        return {
            "original": empty_stats,
            "filtered": empty_stats.copy(),
            "improvement": {
                "pnl_delta": 0.0,
                "pnl_pct_change": 0.0,
                "trades_removed": 0,
                "win_rate_change": 0.0,
                "sharpe_change": 0.0,
            },
            "filter_breakdown": [],
        }

    # Original stats
    original_stats = _compute_stats(trades)

    # Filter trades
    kept_trades: list[dict] = []
    removed_trades: list[dict] = []
    removal_reasons: dict[str, list[dict]] = {}

    for trade in trades:
        context = _trade_to_context(trade)
        result = should_filter(context, anti_setups, confidence_threshold)

        if result["filter"]:
            removed_trades.append(trade)
            # Track which condition removed it
            if result["strongest_match"]:
                cond = result["strongest_match"]["condition"]
                removal_reasons.setdefault(cond, []).append(trade)
        else:
            kept_trades.append(trade)

    # Filtered stats
    filtered_stats = _compute_stats(kept_trades)

    # Filter breakdown
    breakdown = []
    for cond, cond_trades in removal_reasons.items():
        pnl_of_removed = sum(t.get("pnl", 0) for t in cond_trades)
        breakdown.append({
            "condition": cond,
            "trades_removed": len(cond_trades),
            "pnl_saved": round(-pnl_of_removed, 2) if pnl_of_removed < 0 else 0.0,
        })
    breakdown.sort(key=lambda x: x["pnl_saved"], reverse=True)

    pnl_delta = filtered_stats["pnl"] - original_stats["pnl"]
    orig_pnl = original_stats["pnl"]
    pnl_pct = (pnl_delta / abs(orig_pnl) * 100) if orig_pnl != 0 else 0.0

    return {
        "original": original_stats,
        "filtered": filtered_stats,
        "improvement": {
            "pnl_delta": round(pnl_delta, 2),
            "pnl_pct_change": round(pnl_pct, 2),
            "trades_removed": len(removed_trades),
            "win_rate_change": round(filtered_stats["win_rate"] - original_stats["win_rate"], 4),
            "sharpe_change": round(filtered_stats["sharpe"] - original_stats["sharpe"], 4),
        },
        "filter_breakdown": breakdown,
    }


def _compute_stats(trades: list[dict]) -> dict:
    """Compute basic trade stats."""
    if not trades:
        return {"pnl": 0.0, "trades": 0, "win_rate": 0.0, "sharpe": 0.0}

    pnls = [t.get("pnl", 0) for t in trades]
    total_pnl = sum(pnls)
    winners = sum(1 for p in pnls if p > 0)
    win_rate = winners / len(pnls) if pnls else 0.0

    # Sharpe: mean / stdev (annualize not needed for comparison)
    if len(pnls) > 1:
        mean_pnl = statistics.mean(pnls)
        std_pnl = statistics.stdev(pnls)
        sharpe = (mean_pnl / std_pnl) if std_pnl > 0 else 0.0
    else:
        sharpe = 0.0

    return {
        "pnl": round(total_pnl, 2),
        "trades": len(trades),
        "win_rate": round(win_rate, 4),
        "sharpe": round(sharpe, 4),
    }


def _trade_to_context(trade: dict) -> dict:
    """Convert a trade dict to a context dict for the filter gate."""
    context: dict[str, Any] = {}

    # Time
    entry_time = trade.get("entry_time", "")
    if entry_time:
        context["time"] = entry_time
        try:
            if "T" in str(entry_time):
                context["hour"] = int(str(entry_time).split("T")[1].split(":")[0])
        except (ValueError, IndexError):
            pass

    # Copy over context fields directly
    for field in ("atr", "volume", "regime", "archetype", "day_of_week",
                   "days_to_event", "streak", "streak_type", "hour"):
        if field in trade and field not in context:
            context[field] = trade[field]

    return context
