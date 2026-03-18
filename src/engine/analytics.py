"""Trading analytics — calendar patterns, session analysis, MAE/MFE, win/loss patterns.

Operates on backtest output (daily_pnl_records, trades_list) to discover
actionable patterns across 10+ years of data.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Optional


# ─── Day-of-Week Names ──────────────────────────────────────────
_DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def compute_calendar_patterns(daily_pnl_records: list[dict]) -> dict:
    """Auto-detect patterns across calendar data.

    Args:
        daily_pnl_records: list of {"date": "YYYY-MM-DD", "pnl": float}

    Returns:
        dict with day_of_week_pnl, monthly_seasonality, auto_suggestions
    """
    if not daily_pnl_records:
        return {}

    # ─── Day of week analysis ───────────────────────────────
    dow_stats: dict[str, dict] = {name: {"total_pnl": 0.0, "count": 0, "wins": 0} for name in _DOW_NAMES[:5]}

    for rec in daily_pnl_records:
        date_str = rec.get("date")
        if not date_str:
            continue
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue

        dow = dt.weekday()  # 0=Mon, 4=Fri
        if dow > 4:
            continue
        name = _DOW_NAMES[dow]
        dow_stats[name]["total_pnl"] += rec["pnl"]
        dow_stats[name]["count"] += 1
        if rec["pnl"] > 0:
            dow_stats[name]["wins"] += 1

    day_of_week_pnl = {}
    for name, stats in dow_stats.items():
        count = stats["count"]
        if count == 0:
            continue
        day_of_week_pnl[name] = {
            "total_pnl": round(stats["total_pnl"], 2),
            "avg": round(stats["total_pnl"] / count, 2),
            "win_rate": round(stats["wins"] / count, 4),
            "count": count,
        }

    # ─── Monthly seasonality ────────────────────────────────
    month_year: dict[tuple[int, int], float] = defaultdict(float)
    for rec in daily_pnl_records:
        date_str = rec.get("date")
        if not date_str:
            continue
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue
        month_year[(dt.year, dt.month)] += rec["pnl"]

    # Aggregate by month across years
    month_stats: dict[str, dict] = {}
    for month_idx in range(1, 13):
        name = _MONTH_NAMES[month_idx - 1]
        yearly_pnls = [v for (y, m), v in month_year.items() if m == month_idx]
        if not yearly_pnls:
            continue
        win_years = sum(1 for p in yearly_pnls if p > 0)
        loss_years = sum(1 for p in yearly_pnls if p <= 0)
        month_stats[name] = {
            "avg_pnl": round(sum(yearly_pnls) / len(yearly_pnls), 2),
            "win_years": win_years,
            "loss_years": loss_years,
            "total_years": len(yearly_pnls),
        }

    # ─── Auto-suggestions ────────────────────────────────────
    suggestions: list[str] = []

    # Worst day of week
    if day_of_week_pnl:
        worst_day = min(day_of_week_pnl.items(), key=lambda x: x[1]["avg"])
        if worst_day[1]["avg"] < 0 and worst_day[1]["win_rate"] < 0.45:
            suggestions.append(
                f"Skip {worst_day[0]}s — {worst_day[1]['win_rate']:.0%} win rate, "
                f"avg P&L ${worst_day[1]['avg']:.0f}"
            )

    # Weakest quarter
    q_pnls = defaultdict(list)
    for (year, month), pnl in month_year.items():
        q = (month - 1) // 3 + 1
        q_pnls[f"Q{q}"].append(pnl)
    for q, pnls in sorted(q_pnls.items()):
        avg = sum(pnls) / len(pnls)
        if avg < 0:
            suggestions.append(f"{q} is weakest quarter (avg ${avg:.0f}/month) — consider reducing size")

    # Best/worst months
    if month_stats:
        worst_month = min(month_stats.items(), key=lambda x: x[1]["avg_pnl"])
        if worst_month[1]["avg_pnl"] < 0:
            suggestions.append(
                f"{worst_month[0]} is historically weak (avg ${worst_month[1]['avg_pnl']:.0f}, "
                f"loss in {worst_month[1]['loss_years']}/{worst_month[1]['total_years']} years)"
            )

    return {
        "day_of_week_pnl": day_of_week_pnl,
        "monthly_seasonality": month_stats,
        "auto_suggestions": suggestions,
    }


def compute_session_analysis(trades: list[dict]) -> dict:
    """Analyze P&L by entry hour (time-of-day heatmap).

    Tags each trade by entry hour (ET), computes per-hour stats.

    Returns:
        dict with hourly_breakdown and session_summary
    """
    hourly: dict[int, dict] = defaultdict(lambda: {"pnl": 0.0, "trades": 0, "wins": 0})

    for trade in trades:
        entry_ts = trade.get("Entry Timestamp") or trade.get("entry_time")
        pnl = trade.get("PnL") or trade.get("pnl") or 0
        if not isinstance(pnl, (int, float)):
            try:
                pnl = float(pnl)
            except (TypeError, ValueError):
                continue

        if not entry_ts:
            continue

        # Parse hour from timestamp
        try:
            if isinstance(entry_ts, str) and "T" in entry_ts:
                dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
                # Approximate ET (UTC - 5)
                hour = (dt.hour - 5) % 24
            elif isinstance(entry_ts, str) and len(entry_ts) >= 13:
                dt = datetime.fromisoformat(entry_ts[:19])
                hour = (dt.hour - 5) % 24
            else:
                continue
        except (ValueError, TypeError):
            continue

        hourly[hour]["pnl"] += pnl
        hourly[hour]["trades"] += 1
        if pnl > 0:
            hourly[hour]["wins"] += 1

    hourly_breakdown = []
    for hour in range(24):
        stats = hourly.get(hour)
        if not stats or stats["trades"] == 0:
            continue
        hourly_breakdown.append({
            "hour": hour,
            "hour_label": f"{hour}:00",
            "pnl": round(stats["pnl"], 2),
            "trades": stats["trades"],
            "win_rate": round(stats["wins"] / stats["trades"], 4),
            "avg_trade": round(stats["pnl"] / stats["trades"], 2),
        })

    hourly_breakdown.sort(key=lambda x: x["hour"])

    # Session aggregates
    rth_pnl = sum(h["pnl"] for h in hourly_breakdown if 9 <= h["hour"] <= 15)
    eth_pnl = sum(h["pnl"] for h in hourly_breakdown if h["hour"] < 9 or h["hour"] >= 16)

    best_hour = max(hourly_breakdown, key=lambda x: x["pnl"]) if hourly_breakdown else None
    worst_hour = min(hourly_breakdown, key=lambda x: x["pnl"]) if hourly_breakdown else None

    return {
        "hourly_breakdown": hourly_breakdown,
        "rth_total_pnl": round(rth_pnl, 2),
        "eth_total_pnl": round(eth_pnl, 2),
        "best_hour": best_hour,
        "worst_hour": worst_hour,
    }


def compute_mae_mfe_analysis(trades: list[dict]) -> dict:
    """Analyze Maximum Adverse Excursion and Maximum Favorable Excursion.

    Computes optimal stop and target recommendations based on trade data.

    Returns:
        dict with mae_analysis and mfe_analysis
    """
    winners = []
    losers = []

    for trade in trades:
        pnl = trade.get("PnL") or trade.get("pnl") or 0
        mae = trade.get("mae") or trade.get("MAE")
        mfe = trade.get("mfe") or trade.get("MFE")

        if not isinstance(pnl, (int, float)):
            try:
                pnl = float(pnl)
            except (TypeError, ValueError):
                continue

        entry = {
            "pnl": pnl,
            "mae": float(mae) if mae is not None else None,
            "mfe": float(mfe) if mfe is not None else None,
        }

        if pnl > 0:
            winners.append(entry)
        elif pnl < 0:
            losers.append(entry)

    result: dict = {}

    # MAE analysis
    winner_maes = [abs(w["mae"]) for w in winners if w["mae"] is not None]
    loser_maes = [abs(l["mae"]) for l in losers if l["mae"] is not None]

    if winner_maes and loser_maes:
        avg_mae_winners = sum(winner_maes) / len(winner_maes)
        avg_mae_losers = sum(loser_maes) / len(loser_maes)
        # Optimal stop = midpoint between avg winner MAE and avg loser MAE
        optimal_stop = (avg_mae_winners + avg_mae_losers) / 2

        result["mae_analysis"] = {
            "avg_mae_winners": round(avg_mae_winners, 2),
            "avg_mae_losers": round(avg_mae_losers, 2),
            "optimal_stop": round(optimal_stop, 2),
        }

    # MFE analysis
    winner_mfes = [w["mfe"] for w in winners if w["mfe"] is not None]
    if winner_mfes:
        avg_mfe_winners = sum(winner_mfes) / len(winner_mfes)
        result["mfe_analysis"] = {
            "avg_mfe_winners": round(avg_mfe_winners, 2),
        }

    # Win/loss stats
    if winners or losers:
        avg_winner = sum(w["pnl"] for w in winners) / len(winners) if winners else 0
        avg_loser = sum(l["pnl"] for l in losers) / len(losers) if losers else 0
        result["trade_stats"] = {
            "avg_winner": round(avg_winner, 2),
            "avg_loser": round(avg_loser, 2),
            "reward_to_risk": round(abs(avg_winner / avg_loser), 2) if avg_loser != 0 else 0,
            "total_winners": len(winners),
            "total_losers": len(losers),
        }

    return result


def compute_win_loss_patterns(daily_pnl_records: list[dict]) -> dict:
    """Analyze win/loss streak patterns and recovery behavior.

    Returns:
        dict with streak analysis and recovery patterns
    """
    if not daily_pnl_records:
        return {}

    pnls = [r["pnl"] for r in daily_pnl_records]

    # Streak analysis
    max_win_streak = 0
    max_loss_streak = 0
    current_streak = 0
    streak_type: Optional[str] = None
    streaks: list[dict] = []

    for i, pnl in enumerate(pnls):
        if pnl > 0:
            if streak_type == "win":
                current_streak += 1
            else:
                if streak_type == "loss" and current_streak > 0:
                    streaks.append({"type": "loss", "length": current_streak})
                streak_type = "win"
                current_streak = 1
            max_win_streak = max(max_win_streak, current_streak)
        elif pnl < 0:
            if streak_type == "loss":
                current_streak += 1
            else:
                if streak_type == "win" and current_streak > 0:
                    streaks.append({"type": "win", "length": current_streak})
                streak_type = "loss"
                current_streak = 1
            max_loss_streak = max(max_loss_streak, current_streak)
    if current_streak > 0 and streak_type:
        streaks.append({"type": streak_type, "length": current_streak})

    # After-loss recovery: win rate on the trade after N consecutive losses
    after_loss_win_rate = {}
    for n in [1, 2, 3]:
        loss_streak_count = 0
        next_win = 0
        consecutive_losses = 0
        for i, pnl in enumerate(pnls):
            if pnl < 0:
                consecutive_losses += 1
            else:
                if consecutive_losses >= n and i < len(pnls):
                    loss_streak_count += 1
                    if pnl > 0:
                        next_win += 1
                consecutive_losses = 0
        if loss_streak_count > 0:
            after_loss_win_rate[f"after_{n}_losses"] = {
                "win_rate": round(next_win / loss_streak_count, 4),
                "occurrences": loss_streak_count,
            }

    # After-win regression: win rate after N consecutive wins
    after_win_patterns = {}
    for n in [3, 5]:
        win_streak_count = 0
        next_win = 0
        consecutive_wins = 0
        for i, pnl in enumerate(pnls):
            if pnl > 0:
                consecutive_wins += 1
            else:
                if consecutive_wins >= n:
                    win_streak_count += 1
                    # This trade is a loss (we're in the else)
                consecutive_wins = 0
        total_after_win = 0
        wins_after = 0
        consecutive_wins = 0
        for i in range(len(pnls) - 1):
            if pnls[i] > 0:
                consecutive_wins += 1
            else:
                consecutive_wins = 0
            if consecutive_wins >= n:
                total_after_win += 1
                if pnls[i + 1] > 0:
                    wins_after += 1
        if total_after_win > 0:
            after_win_patterns[f"after_{n}_wins"] = {
                "win_rate": round(wins_after / total_after_win, 4),
                "occurrences": total_after_win,
            }

    return {
        "max_consecutive_winners": max_win_streak,
        "max_consecutive_losers": max_loss_streak,
        "after_loss_recovery": after_loss_win_rate,
        "after_win_regression": after_win_patterns,
    }


def compute_full_analytics(
    daily_pnl_records: list[dict],
    trades: list[dict],
) -> dict:
    """Run all analytics and return combined result."""
    return {
        "calendar_patterns": compute_calendar_patterns(daily_pnl_records),
        "session_analysis": compute_session_analysis(trades),
        "mae_mfe_analysis": compute_mae_mfe_analysis(trades),
        "win_loss_patterns": compute_win_loss_patterns(daily_pnl_records),
    }
