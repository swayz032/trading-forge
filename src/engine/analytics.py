"""Trading analytics — calendar patterns, session analysis, MAE/MFE, win/loss patterns.

Operates on backtest output (daily_pnl_records, trades_list) to discover
actionable patterns across 10+ years of data.

CONVENTION: When both stop loss AND signal exit trigger on the same bar,
the STOP PRICE is used (worse case). This is conservative and matches
real trading — stop would fire first intraday.
This is enforced in backtester.py's equity friction loop.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from src.engine.economic_calendar import STATIC_EVENTS


# ─── Day-of-Week Names ──────────────────────────────────────────
_DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def compute_calendar_patterns(
    daily_pnl_records: list[dict],
    trades: list[dict] | None = None,
) -> dict:
    """Auto-detect patterns across calendar data (Task 5.4).

    Args:
        daily_pnl_records: list of {"date": "YYYY-MM-DD", "pnl": float}
        trades: optional trade list (for regime_performance, long_short_by_regime)

    Returns:
        dict with day_of_week_pnl, monthly_seasonality, regime_performance,
        long_short_by_regime, auto_suggestions
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

    # Check if recent 2 years underperform historical
    now = datetime.now()
    cutoff_2y = (now - timedelta(days=730)).strftime("%Y-%m-%d")
    recent_pnls = [r["pnl"] for r in daily_pnl_records if r.get("date") and r["date"] >= cutoff_2y]
    all_pnls = [r["pnl"] for r in daily_pnl_records if r.get("pnl") is not None]
    if recent_pnls and all_pnls:
        recent_avg = sum(recent_pnls) / len(recent_pnls)
        all_avg = sum(all_pnls) / len(all_pnls)
        if recent_avg < all_avg * 0.6 and len(recent_pnls) > 100:
            suggestions.append(
                f"Recent 2 years underperform historical ({recent_avg:.0f}/day vs {all_avg:.0f}/day) — edge may be decaying"
            )

    # ─── Regime performance & long/short by regime (Task 5.4) ─
    regime_perf: dict = {}
    ls_by_regime: dict = {}
    if trades:
        regime_result = compute_regime_performance(daily_pnl_records, trades)
        regime_perf = regime_result.get("regime_performance", {})
        ls_by_regime = regime_result.get("long_short_by_regime", {})

        # Regime-based auto_suggestions
        for regime, stats in regime_perf.items():
            if regime == "UNKNOWN":
                continue
            if stats.get("flag"):
                suggestions.append(stats["flag"])
        for regime, stats in ls_by_regime.items():
            if regime == "UNKNOWN":
                continue
            if stats.get("flag"):
                suggestions.append(stats["flag"])

    return {
        "day_of_week_pnl": day_of_week_pnl,
        "monthly_seasonality": month_stats,
        "regime_performance": regime_perf,
        "long_short_by_regime": ls_by_regime,
        "auto_suggestions": suggestions,
    }


def enrich_daily_pnl_records(
    daily_pnl_records: list[dict],
    trades: list[dict],
) -> list[dict]:
    """Add trade_count per day to daily_pnl_records (Task 5.1).

    Also adds fields needed for calendar rendering:
    - trade_count: number of trades that entered on that date

    Mutates records in place and returns the list.
    """
    # Build trade count per date from trade entry timestamps
    trade_counts: dict[str, int] = defaultdict(int)
    for trade in trades:
        entry_ts = trade.get("Entry Timestamp") or trade.get("entry_time")
        if not entry_ts:
            continue
        try:
            if isinstance(entry_ts, str):
                date_str = entry_ts[:10]  # "YYYY-MM-DD"
            else:
                date_str = str(entry_ts)[:10]
            trade_counts[date_str] += 1
        except (ValueError, TypeError):
            continue

    for rec in daily_pnl_records:
        date_str = rec.get("date")
        rec["trade_count"] = trade_counts.get(date_str, 0)

    return daily_pnl_records


def compute_event_markers(daily_pnl_records: list[dict]) -> dict[str, list[str]]:
    """Return event markers per date from the static economic calendar (Task 5.2).

    Returns:
        dict mapping "YYYY-MM-DD" -> list of event type strings (e.g. ["FOMC", "CPI"])
    """
    # Build date -> event type lookup from STATIC_EVENTS
    date_events: dict[str, list[str]] = defaultdict(list)
    for event_type, events in STATIC_EVENTS.items():
        for evt in events:
            date_str = evt["date"]
            date_events[date_str].append(event_type)

    # Filter to only dates that appear in daily_pnl_records
    record_dates = {rec["date"] for rec in daily_pnl_records if rec.get("date")}
    return {d: evts for d, evts in date_events.items() if d in record_dates}


def compute_streak_overlay(daily_pnl_records: list[dict]) -> list[dict]:
    """Compute per-day streak tracking for calendar overlay (Task 5.2).

    Returns list of dicts aligned with daily_pnl_records:
        [{"date": "...", "streak": +3, "streak_type": "win"}, ...]
    Positive streak = consecutive wins, negative = consecutive losses.
    """
    result = []
    current_streak = 0
    for rec in daily_pnl_records:
        pnl = rec.get("pnl", 0)
        if pnl > 0:
            current_streak = current_streak + 1 if current_streak > 0 else 1
        elif pnl < 0:
            current_streak = current_streak - 1 if current_streak < 0 else -1
        else:
            current_streak = 0

        result.append({
            "date": rec.get("date"),
            "streak": current_streak,
            "streak_type": "win" if current_streak > 0 else ("loss" if current_streak < 0 else "flat"),
        })
    return result


def compute_firm_limit_markers(
    daily_pnl_records: list[dict],
    firm_daily_limits: dict[str, float | None] | None = None,
) -> dict[str, list[str]]:
    """Identify days where a prop firm would have halted trading (Task 5.2).

    Uses daily loss limits per firm. If a day's P&L exceeds the firm's
    daily loss limit (negative), that day is flagged.

    Args:
        daily_pnl_records: list of {"date", "pnl"} dicts
        firm_daily_limits: {firm_key: daily_loss_limit} — None means no limit

    Returns:
        dict mapping "YYYY-MM-DD" -> list of firm keys that would halt
    """
    if firm_daily_limits is None:
        # Only FFN has a daily loss limit ($1,250 on 50K).
        # Topstep, MFFU, TPT, Apex, Alpha, Tradeify, Earn2Trade = NO daily loss limit.
        firm_daily_limits = {
            "ffn_50k": 1250,
        }

    halt_markers: dict[str, list[str]] = {}
    for rec in daily_pnl_records:
        date_str = rec.get("date")
        pnl = rec.get("pnl", 0)
        if pnl >= 0 or not date_str:
            continue

        halted_firms = []
        for firm, limit in firm_daily_limits.items():
            if limit is not None and abs(pnl) >= limit:
                halted_firms.append(firm)

        if halted_firms:
            halt_markers[date_str] = halted_firms

    return halt_markers


def tag_trade_session_fields(trades: list[dict]) -> list[dict]:
    """Add entry_hour and session_type to each trade record (Task 5.3).

    Session definitions (ET):
        - London:    03:00 - 08:29
        - NY_AM:     08:30 - 11:59
        - NY_PM:     12:00 - 15:59
        - Overnight: 16:00 - 02:59

    Mutates trades in place and returns the list.
    """
    for trade in trades:
        entry_ts = trade.get("Entry Timestamp") or trade.get("entry_time")
        if not entry_ts:
            continue

        try:
            if isinstance(entry_ts, str) and "T" in entry_ts:
                dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
                hour = (dt.hour - 5) % 24  # Approximate ET
            elif isinstance(entry_ts, str) and len(entry_ts) >= 13:
                dt = datetime.fromisoformat(entry_ts[:19])
                hour = (dt.hour - 5) % 24
            else:
                continue
        except (ValueError, TypeError):
            continue

        trade["entry_hour"] = hour

        if 3 <= hour < 8:
            trade["session_type"] = "London"
        elif 8 <= hour < 12:
            trade["session_type"] = "NY_AM"
        elif 12 <= hour < 16:
            trade["session_type"] = "NY_PM"
        else:
            trade["session_type"] = "Overnight"

    return trades


def _parse_entry_hour_et(entry_ts) -> int | None:
    """Parse entry timestamp to hour in ET (0-23). Returns None on failure."""
    try:
        if isinstance(entry_ts, str) and "T" in entry_ts:
            dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
            return (dt.hour - 5) % 24
        elif isinstance(entry_ts, str) and len(entry_ts) >= 13:
            dt = datetime.fromisoformat(entry_ts[:19])
            return (dt.hour - 5) % 24
    except (ValueError, TypeError):
        pass
    return None


def _classify_session_extended(hour: int) -> str:
    """Classify hour into RTH / ETH / Asian session (ET hours).

    RTH:   09:30-16:00 ET  (hours 9-15)
    Asian: 20:00-02:00 ET  (hours 20-23, 0-1)
    ETH:   everything else (pre-market 02:00-09:29, post-market 16:00-19:59)
    """
    if 9 <= hour <= 15:
        return "RTH"
    elif hour >= 20 or hour <= 1:
        return "Asian"
    else:
        return "ETH"


def compute_session_analysis(
    trades: list[dict],
    backtest_slippage_assumption: float | None = None,
) -> dict:
    """Analyze P&L by entry hour (time-of-day heatmap) -- Task 5.5.

    Tags each trade by entry hour (0-23 ET), computes per-hour:
    P&L, trades, win%, avg trade, avg slippage.
    Also: RTH vs ETH vs Asian session breakdown.
    Flags sessions where actual slippage exceeds backtest assumptions.

    Args:
        trades: List of trade dicts with entry timestamps, PnL, slippage
        backtest_slippage_assumption: Expected per-trade slippage ($).
            If provided, hours where avg slippage exceeds 125% of this are flagged.

    Returns:
        dict with hourly_breakdown, session_breakdown (RTH/ETH/Asian),
        slippage_flags, best/worst hour
    """
    hourly: dict[int, dict] = defaultdict(
        lambda: {"pnl": 0.0, "trades": 0, "wins": 0, "total_slippage": 0.0}
    )

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

        hour = _parse_entry_hour_et(entry_ts)
        if hour is None:
            continue

        slip = trade.get("slippage") or trade.get("Slippage") or 0
        if not isinstance(slip, (int, float)):
            try:
                slip = float(slip)
            except (TypeError, ValueError):
                slip = 0

        hourly[hour]["pnl"] += pnl
        hourly[hour]["trades"] += 1
        hourly[hour]["total_slippage"] += abs(slip)
        if pnl > 0:
            hourly[hour]["wins"] += 1

    hourly_breakdown = []
    for hour in range(24):
        stats = hourly.get(hour)
        if not stats or stats["trades"] == 0:
            continue
        n = stats["trades"]
        avg_slip = stats["total_slippage"] / n
        hourly_breakdown.append({
            "hour": hour,
            "hour_label": f"{hour:02d}:00",
            "pnl": round(stats["pnl"], 2),
            "trades": n,
            "win_rate": round(stats["wins"] / n, 4),
            "avg_trade": round(stats["pnl"] / n, 2),
            "avg_slippage": round(avg_slip, 2),
        })

    hourly_breakdown.sort(key=lambda x: x["hour"])

    # ─── RTH / ETH / Asian session breakdown ───────────────────
    session_agg: dict[str, dict] = {
        s: {"pnl": 0.0, "trades": 0, "wins": 0, "total_slippage": 0.0}
        for s in ("RTH", "ETH", "Asian")
    }
    for h in hourly_breakdown:
        sess = _classify_session_extended(h["hour"])
        session_agg[sess]["pnl"] += h["pnl"]
        session_agg[sess]["trades"] += h["trades"]
        raw = hourly.get(h["hour"])
        if raw:
            session_agg[sess]["wins"] += raw["wins"]
            session_agg[sess]["total_slippage"] += raw["total_slippage"]

    session_breakdown = {}
    for sess, stats in session_agg.items():
        n = stats["trades"]
        session_breakdown[sess] = {
            "total_pnl": round(stats["pnl"], 2),
            "trades": n,
            "win_rate": round(stats["wins"] / n, 4) if n > 0 else 0,
            "avg_trade": round(stats["pnl"] / n, 2) if n > 0 else 0,
            "avg_slippage": round(stats["total_slippage"] / n, 2) if n > 0 else 0,
        }

    # ─── Slippage flags -- alert when actual > assumption ──────
    slippage_flags: list[str] = []
    if backtest_slippage_assumption is not None and backtest_slippage_assumption > 0:
        for h in hourly_breakdown:
            if h["avg_slippage"] > backtest_slippage_assumption * 1.25:
                slippage_flags.append(
                    f"Hour {h['hour_label']} avg slippage ${h['avg_slippage']:.2f} "
                    f"exceeds assumption ${backtest_slippage_assumption:.2f} by "
                    f"{h['avg_slippage'] / backtest_slippage_assumption:.0%}"
                )
        for sess, stats in session_breakdown.items():
            if stats["avg_slippage"] > backtest_slippage_assumption * 1.25:
                slippage_flags.append(
                    f"{sess} session avg slippage ${stats['avg_slippage']:.2f} "
                    f"exceeds backtest assumption ${backtest_slippage_assumption:.2f}"
                )

    best_hour = max(hourly_breakdown, key=lambda x: x["pnl"]) if hourly_breakdown else None
    worst_hour = min(hourly_breakdown, key=lambda x: x["pnl"]) if hourly_breakdown else None

    return {
        "hourly_breakdown": hourly_breakdown,
        "session_breakdown": session_breakdown,
        "rth_total_pnl": round(session_agg["RTH"]["pnl"], 2),
        "eth_total_pnl": round(session_agg["ETH"]["pnl"], 2),
        "asian_total_pnl": round(session_agg["Asian"]["pnl"], 2),
        "slippage_flags": slippage_flags,
        "best_hour": best_hour,
        "worst_hour": worst_hour,
    }


def compute_mae_mfe_analysis(
    trades: list[dict],
    current_stop: float | None = None,
    current_target: float | None = None,
) -> dict:
    """Analyze Maximum Adverse Excursion and Maximum Favorable Excursion -- Task 5.6.

    Computes optimal stop and target recommendations based on trade MAE/MFE data.
    Optimal stop: smallest stop that catches 85% of winners while cutting 70% of losers.
    Optimal target: MFE level reached by 70% of winners (conservative capture point).

    Args:
        trades: List of trade dicts with PnL, MAE, MFE fields
        current_stop: The strategy's current stop distance ($) for comparison
        current_target: The strategy's current target distance ($) for comparison

    Returns:
        dict with mae_analysis, mfe_analysis, trade_stats, recommendations
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

    # ─── MAE analysis ──────────────────────────────────────────
    winner_maes = sorted([abs(w["mae"]) for w in winners if w["mae"] is not None])
    loser_maes = sorted([abs(l["mae"]) for l in losers if l["mae"] is not None])

    if winner_maes and loser_maes:
        avg_mae_winners = sum(winner_maes) / len(winner_maes)
        avg_mae_losers = sum(loser_maes) / len(loser_maes)

        # Optimal stop: the stop level that catches 85% of winners
        # (i.e., 85th percentile of winner MAEs -- only 15% of winners
        # would have been stopped out) while also cutting at least 70% of losers
        # (i.e., 70% of loser MAEs exceed this stop level).
        p85_winner_mae = winner_maes[int(len(winner_maes) * 0.85)] if len(winner_maes) > 1 else winner_maes[0]

        # What fraction of losers would this stop cut?
        losers_cut = sum(1 for m in loser_maes if m >= p85_winner_mae) / len(loser_maes)

        # Also compute the stop that cuts 70% of losers
        p30_loser_mae = loser_maes[int(len(loser_maes) * 0.30)] if len(loser_maes) > 1 else loser_maes[0]

        # Winners preserved at that loser-cut stop
        winners_preserved = sum(1 for m in winner_maes if m <= p30_loser_mae) / len(winner_maes)

        # Use the tighter of the two as optimal_stop
        optimal_stop = min(p85_winner_mae, p30_loser_mae)

        mae_dict: dict = {
            "avg_mae_winners": round(avg_mae_winners, 2),
            "avg_mae_losers": round(avg_mae_losers, 2),
            "optimal_stop": round(optimal_stop, 2),
            "p85_winner_mae": round(p85_winner_mae, 2),
            "losers_cut_at_p85": round(losers_cut, 4),
            "p30_loser_mae": round(p30_loser_mae, 2),
            "winners_preserved_at_p30": round(winners_preserved, 4),
        }
        if current_stop is not None:
            mae_dict["current_stop"] = round(current_stop, 2)
            diff = current_stop - optimal_stop
            if abs(diff) > optimal_stop * 0.15:
                if diff > 0:
                    mae_dict["recommendation"] = (
                        f"Current stop (${current_stop:.2f}) is wider than optimal "
                        f"(${optimal_stop:.2f}) -- tighten by ${diff:.2f} to reduce losses"
                    )
                else:
                    mae_dict["recommendation"] = (
                        f"Current stop (${current_stop:.2f}) is tighter than optimal "
                        f"(${optimal_stop:.2f}) -- you may be stopping out winners prematurely"
                    )
            else:
                mae_dict["recommendation"] = "Current stop is within 15% of optimal -- no change needed"

        result["mae_analysis"] = mae_dict

    # ─── MFE analysis ──────────────────────────────────────────
    winner_mfes = sorted([w["mfe"] for w in winners if w["mfe"] is not None])
    if winner_mfes:
        avg_mfe_winners = sum(winner_mfes) / len(winner_mfes)
        # Optimal target: the MFE reached by 70% of winners (30th percentile)
        # Conservative: most winners reach this level, so set target here.
        p70_idx = int(len(winner_mfes) * 0.30)  # 30th percentile = bottom 30% reach this
        optimal_target = winner_mfes[p70_idx] if len(winner_mfes) > 1 else winner_mfes[0]

        mfe_dict: dict = {
            "avg_mfe_winners": round(avg_mfe_winners, 2),
            "optimal_target": round(optimal_target, 2),
        }
        if current_target is not None:
            mfe_dict["current_target"] = round(current_target, 2)
            diff = current_target - optimal_target
            if diff > optimal_target * 0.20:
                mfe_dict["recommendation"] = (
                    f"Current target (${current_target:.2f}) exceeds what 70% of winners "
                    f"reach (${optimal_target:.2f}) -- consider taking partial profits earlier"
                )
            elif diff < -optimal_target * 0.20:
                mfe_dict["recommendation"] = (
                    f"Current target (${current_target:.2f}) leaves money on the table -- "
                    f"70% of winners reach ${optimal_target:.2f}"
                )
            else:
                mfe_dict["recommendation"] = "Current target is well-calibrated to winner MFE distribution"

        result["mfe_analysis"] = mfe_dict

    # ─── Win/loss stats ────────────────────────────────────────
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


def compute_win_loss_patterns(
    daily_pnl_records: list[dict],
    trades: list[dict] | None = None,
) -> dict:
    """Analyze win/loss streak patterns, recovery behavior, and trade stats -- Task 5.7.

    Computes:
    - avg_winner, avg_loser, reward_to_risk
    - avg_hold_winners, avg_hold_losers (bar count)
    - max_consecutive_winners, max_consecutive_losers
    - loss_recovery pattern (after N losses, what is the win rate?)
    - autocorrelation_lag1, autocorrelation_lag2 (feeds MC block length)
    - loss_cluster_score

    Args:
        daily_pnl_records: Daily P&L records for streak/autocorrelation analysis
        trades: Optional trade-level records for per-trade stats (avg_winner, hold times)

    Returns:
        dict with comprehensive win/loss pattern analysis
    """
    if not daily_pnl_records:
        return {}

    pnls = [r["pnl"] for r in daily_pnl_records]

    # ─── Per-trade stats (avg_winner, avg_loser, hold times) ───
    trade_stats: dict = {}
    if trades:
        winner_pnls = []
        loser_pnls = []
        winner_holds = []
        loser_holds = []

        for trade in trades:
            pnl_val = trade.get("PnL") or trade.get("pnl") or 0
            if not isinstance(pnl_val, (int, float)):
                try:
                    pnl_val = float(pnl_val)
                except (TypeError, ValueError):
                    continue

            # Hold time in bars (Entry Idx / Exit Idx from vectorbt)
            entry_idx = trade.get("Entry Idx") or trade.get("entry_idx")
            exit_idx = trade.get("Exit Idx") or trade.get("exit_idx")
            hold_bars: int | None = None
            if entry_idx is not None and exit_idx is not None:
                try:
                    hold_bars = int(exit_idx) - int(entry_idx)
                except (TypeError, ValueError):
                    pass

            if pnl_val > 0:
                winner_pnls.append(pnl_val)
                if hold_bars is not None:
                    winner_holds.append(hold_bars)
            elif pnl_val < 0:
                loser_pnls.append(pnl_val)
                if hold_bars is not None:
                    loser_holds.append(hold_bars)

        avg_winner = sum(winner_pnls) / len(winner_pnls) if winner_pnls else 0
        avg_loser = sum(loser_pnls) / len(loser_pnls) if loser_pnls else 0
        trade_stats = {
            "avg_winner": round(avg_winner, 2),
            "avg_loser": round(avg_loser, 2),
            "reward_to_risk": round(abs(avg_winner / avg_loser), 2) if avg_loser != 0 else 0,
            "avg_hold_winners": round(sum(winner_holds) / len(winner_holds), 1) if winner_holds else None,
            "avg_hold_losers": round(sum(loser_holds) / len(loser_holds), 1) if loser_holds else None,
        }

    # ─── Streak analysis ──────────────────────────────────────
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

    # ─── After-loss recovery ──────────────────────────────────
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

    # ─── After-win regression ─────────────────────────────────
    after_win_patterns = {}
    for n in [3, 5]:
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

    # ─── Autocorrelation + loss clustering (feeds MC block length) ─
    autocorrelation: dict = {}
    if len(pnls) >= 30:
        import numpy as np
        arr = np.array(pnls)

        lag1 = float(np.corrcoef(arr[:-1], arr[1:])[0, 1]) if len(arr) > 1 else 0.0
        lag2 = float(np.corrcoef(arr[:-2], arr[2:])[0, 1]) if len(arr) > 2 else 0.0
        if np.isnan(lag1):
            lag1 = 0.0
        if np.isnan(lag2):
            lag2 = 0.0

        # Loss clustering score
        losses = arr < 0
        actual_runs = 1
        for i in range(1, len(losses)):
            if losses[i] != losses[i - 1]:
                actual_runs += 1
        n_total = len(losses)
        n1 = int(np.sum(losses))
        n0 = n_total - n1
        if n1 > 0 and n0 > 0:
            expected_runs = 1 + 2 * n0 * n1 / n_total
            loss_cluster_score = round(1 - actual_runs / expected_runs, 4) if expected_runs > 0 else 0
        else:
            loss_cluster_score = 0

        autocorrelation = {
            "autocorrelation_lag1": round(lag1, 4),
            "autocorrelation_lag2": round(lag2, 4),
            "loss_cluster_score": loss_cluster_score,
        }

    return {
        "max_consecutive_winners": max_win_streak,
        "max_consecutive_losers": max_loss_streak,
        "after_loss_recovery": after_loss_win_rate,
        "after_win_regression": after_win_patterns,
        **trade_stats,
        **autocorrelation,
    }


def compute_regime_performance(daily_pnl_records: list[dict], trades: list[dict]) -> dict:
    """Analyze performance by macro regime.

    Requires trades to have a 'macro_regime' field (from macro_tagger.py).
    If not present, returns empty dict.

    Returns:
        regime_performance: {regime: {win_rate, avg_pnl, trades, flag}}
        long_short_by_regime: {regime: {long_wr, short_wr, flag}}
    """
    regime_stats: dict[str, dict] = {}
    long_short_regime: dict[str, dict] = {}

    for trade in trades:
        regime = trade.get("macro_regime") or trade.get("macroRegime") or "UNKNOWN"
        pnl = float(trade.get("PnL", trade.get("pnl", 0)))
        direction = str(trade.get("Direction", trade.get("direction", ""))).lower()

        if regime not in regime_stats:
            regime_stats[regime] = {"pnl": 0.0, "trades": 0, "wins": 0}
        regime_stats[regime]["pnl"] += pnl
        regime_stats[regime]["trades"] += 1
        if pnl > 0:
            regime_stats[regime]["wins"] += 1

        if regime not in long_short_regime:
            long_short_regime[regime] = {
                "long_trades": 0, "long_wins": 0,
                "short_trades": 0, "short_wins": 0,
            }
        if "long" in direction:
            long_short_regime[regime]["long_trades"] += 1
            if pnl > 0:
                long_short_regime[regime]["long_wins"] += 1
        elif "short" in direction:
            long_short_regime[regime]["short_trades"] += 1
            if pnl > 0:
                long_short_regime[regime]["short_wins"] += 1

    # Format results
    regime_performance: dict[str, dict] = {}
    for regime, stats in regime_stats.items():
        n_trades = stats["trades"]
        if n_trades == 0:
            regime_performance[regime] = {
                "win_rate": 0.0,
                "avg_pnl": 0.0,
                "trades": 0,
                "total_pnl": 0.0,
                "flag": None,
            }
            continue
        wr = stats["wins"] / n_trades
        flag: str | None = None
        if wr < 0.40 and n_trades >= 20:
            flag = f"Strategy fails in {regime} regime ({wr:.0%} win rate)"
        regime_performance[regime] = {
            "win_rate": round(wr, 4),
            "avg_pnl": round(stats["pnl"] / n_trades, 2),
            "trades": n_trades,
            "total_pnl": round(stats["pnl"], 2),
            "flag": flag,
        }

    ls_by_regime: dict[str, dict] = {}
    for regime, stats in long_short_regime.items():
        long_wr = stats["long_wins"] / stats["long_trades"] if stats["long_trades"] > 0 else 0
        short_wr = stats["short_wins"] / stats["short_trades"] if stats["short_trades"] > 0 else 0
        flag = None
        if stats["long_trades"] >= 10 and long_wr < 0.35:
            flag = f"Longs destroyed in {regime} — only short"
        if stats["short_trades"] >= 10 and short_wr < 0.35:
            flag = f"Shorts destroyed in {regime} — only long"
        ls_by_regime[regime] = {
            "long_wr": round(long_wr, 4),
            "long_trades": stats["long_trades"],
            "short_wr": round(short_wr, 4),
            "short_trades": stats["short_trades"],
            "flag": flag,
        }

    return {
        "regime_performance": regime_performance,
        "long_short_by_regime": ls_by_regime,
    }


def compute_trade_autocorrelation(daily_pnl_records: list[dict]) -> dict:
    """Compute autocorrelation of daily P&Ls.

    If autocorrelation > 0.1, simple IID Monte Carlo is wrong —
    must use block bootstrap. This feeds MC block length selection.

    Returns:
        lag1_autocorrelation, lag2_autocorrelation, loss_cluster_score,
        mc_recommendation
    """
    import numpy as np

    pnls = [r["pnl"] for r in daily_pnl_records if r.get("pnl") is not None]
    if len(pnls) < 30:
        return {"insufficient_data": True}

    arr = np.array(pnls)

    # Lag-1 autocorrelation
    if len(arr) > 1:
        lag1 = float(np.corrcoef(arr[:-1], arr[1:])[0, 1])
    else:
        lag1 = 0.0

    # Lag-2 autocorrelation
    if len(arr) > 2:
        lag2 = float(np.corrcoef(arr[:-2], arr[2:])[0, 1])
    else:
        lag2 = 0.0

    # Loss clustering score: ratio of actual loss streaks to expected under independence
    losses = arr < 0
    actual_runs = 1
    for i in range(1, len(losses)):
        if losses[i] != losses[i - 1]:
            actual_runs += 1

    n = len(losses)
    n1 = int(np.sum(losses))
    n0 = n - n1
    if n1 > 0 and n0 > 0:
        expected_runs = 1 + 2 * n0 * n1 / n
        loss_cluster_score = round(1 - actual_runs / expected_runs, 4) if expected_runs > 0 else 0
    else:
        loss_cluster_score = 0

    # Handle NaN
    if np.isnan(lag1):
        lag1 = 0.0
    if np.isnan(lag2):
        lag2 = 0.0

    # MC recommendation
    if abs(lag1) > 0.15:
        mc_rec = "BLOCK_BOOTSTRAP (significant autocorrelation — IID MC underestimates streaks)"
    elif abs(lag1) > 0.10:
        mc_rec = "BLOCK_BOOTSTRAP_RECOMMENDED (moderate autocorrelation detected)"
    else:
        mc_rec = "IID_OK (low autocorrelation — standard MC acceptable)"

    return {
        "lag1_autocorrelation": round(lag1, 4),
        "lag2_autocorrelation": round(lag2, 4),
        "loss_cluster_score": loss_cluster_score,
        "mc_recommendation": mc_rec,
    }


def compute_playbook_analytics(
    trades: list[dict],
    decisions: list[dict],
) -> dict:
    """Analyze P&L broken down by playbook assignment.

    Requires each decision to have a 'playbook' field (from eligibility gate)
    and each trade to be linkable to a decision via index or timestamp.

    Args:
        trades: List of trade dicts with PnL
        decisions: List of EligibilityDecision-like dicts with 'playbook', 'action'

    Returns:
        dict keyed by playbook name with {trades, wins, total_pnl, avg_pnl, win_rate}
    """
    if not decisions:
        return {"_status": "no_decisions_available", "_note": "Enable eligibility gate to populate"}

    playbook_stats: dict[str, dict] = {}

    for i, trade in enumerate(trades):
        if i >= len(decisions):
            break
        decision = decisions[i]
        playbook = decision.get("playbook", "UNKNOWN")
        pnl = float(trade.get("PnL", trade.get("pnl", 0)))

        if playbook not in playbook_stats:
            playbook_stats[playbook] = {"trades": 0, "wins": 0, "total_pnl": 0.0}

        playbook_stats[playbook]["trades"] += 1
        playbook_stats[playbook]["total_pnl"] += pnl
        if pnl > 0:
            playbook_stats[playbook]["wins"] += 1

    result = {}
    for playbook, stats in playbook_stats.items():
        n = stats["trades"]
        result[playbook] = {
            "trades": n,
            "wins": stats["wins"],
            "total_pnl": round(stats["total_pnl"], 2),
            "avg_pnl": round(stats["total_pnl"] / n, 2) if n > 0 else 0,
            "win_rate": round(stats["wins"] / n, 4) if n > 0 else 0,
        }
    return result


def compute_named_session_analytics(trades: list[dict]) -> dict:
    """Analyze P&L by named trading session (NY AM, NY PM, London, Overnight).

    Session definitions (ET):
        - London:    03:00 - 08:29
        - NY AM:     08:30 - 11:59
        - NY PM:     12:00 - 15:59
        - Overnight: 16:00 - 02:59

    Args:
        trades: List of trade dicts with entry_time/Entry Timestamp and PnL

    Returns:
        dict keyed by session name with {trades, wins, total_pnl, avg_pnl, win_rate}
    """
    sessions = {
        "London":    (3, 8),     # 03:00-08:29 ET
        "NY_AM":     (8, 12),    # 08:30-11:59 ET (using 8 as start hour)
        "NY_PM":     (12, 16),   # 12:00-15:59 ET
        "Overnight": (16, 3),    # 16:00-02:59 ET (wraps midnight)
    }
    session_stats: dict[str, dict] = {
        name: {"trades": 0, "wins": 0, "total_pnl": 0.0} for name in sessions
    }

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

        try:
            if isinstance(entry_ts, str) and "T" in entry_ts:
                dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
                hour = (dt.hour - 5) % 24  # Approximate ET
            elif isinstance(entry_ts, str) and len(entry_ts) >= 13:
                dt = datetime.fromisoformat(entry_ts[:19])
                hour = (dt.hour - 5) % 24
            else:
                continue
        except (ValueError, TypeError):
            continue

        # Classify into session
        session_name = "Overnight"  # default
        if 3 <= hour < 8:
            session_name = "London"
        elif 8 <= hour < 12:
            session_name = "NY_AM"
        elif 12 <= hour < 16:
            session_name = "NY_PM"

        session_stats[session_name]["trades"] += 1
        session_stats[session_name]["total_pnl"] += pnl
        if pnl > 0:
            session_stats[session_name]["wins"] += 1

    result = {}
    for name, stats in session_stats.items():
        n = stats["trades"]
        result[name] = {
            "trades": n,
            "wins": stats["wins"],
            "total_pnl": round(stats["total_pnl"], 2),
            "avg_pnl": round(stats["total_pnl"] / n, 2) if n > 0 else 0,
            "win_rate": round(stats["wins"] / n, 4) if n > 0 else 0,
        }
    return result


def compute_bias_regime_analytics(
    trades: list[dict],
    decisions: list[dict],
) -> dict:
    """Analyze P&L by bias confidence band.

    Bins trades by the bias_confidence at the time of signal into bands:
        - Strong (>=0.7), Moderate (0.5-0.7), Weak (0.3-0.5), Very Weak (<0.3)

    Args:
        trades: List of trade dicts with PnL
        decisions: List of EligibilityDecision-like dicts with bias_state info

    Returns:
        dict keyed by confidence band with {trades, wins, total_pnl, avg_pnl, win_rate}
    """
    if not decisions:
        return {"_status": "no_decisions_available", "_note": "Enable eligibility gate to populate"}

    bands = {
        "strong_>=0.7": {"trades": 0, "wins": 0, "total_pnl": 0.0},
        "moderate_0.5-0.7": {"trades": 0, "wins": 0, "total_pnl": 0.0},
        "weak_0.3-0.5": {"trades": 0, "wins": 0, "total_pnl": 0.0},
        "very_weak_<0.3": {"trades": 0, "wins": 0, "total_pnl": 0.0},
    }

    for i, trade in enumerate(trades):
        if i >= len(decisions):
            break
        decision = decisions[i]
        bias_state = decision.get("bias_state")
        if not bias_state:
            continue
        confidence = bias_state.get("bias_confidence", 0) if isinstance(bias_state, dict) else getattr(bias_state, "bias_confidence", 0)
        pnl = float(trade.get("PnL", trade.get("pnl", 0)))

        if confidence >= 0.7:
            band = "strong_>=0.7"
        elif confidence >= 0.5:
            band = "moderate_0.5-0.7"
        elif confidence >= 0.3:
            band = "weak_0.3-0.5"
        else:
            band = "very_weak_<0.3"

        bands[band]["trades"] += 1
        bands[band]["total_pnl"] += pnl
        if pnl > 0:
            bands[band]["wins"] += 1

    result = {}
    for band, stats in bands.items():
        n = stats["trades"]
        result[band] = {
            "trades": n,
            "wins": stats["wins"],
            "total_pnl": round(stats["total_pnl"], 2),
            "avg_pnl": round(stats["total_pnl"] / n, 2) if n > 0 else 0,
            "win_rate": round(stats["wins"] / n, 4) if n > 0 else 0,
        }
    return result


def compute_rejection_quality(
    rejections: list[dict],
    market_outcomes: list[dict],
) -> dict:
    """Evaluate whether SKIP decisions successfully avoided losers.

    For each SKIP decision, looks at what would have happened if the trade
    was taken (using market_outcomes which contain hypothetical P&L).

    Args:
        rejections: List of dicts with {timestamp, direction, strategy, reasoning, ...}
        market_outcomes: List of dicts with {timestamp, hypothetical_pnl, direction}
            representing what would have happened if the signal was taken.

    Returns:
        dict with:
            - total_skipped: Number of signals skipped
            - would_have_lost: Count of skips where hypothetical P&L was negative
            - would_have_won: Count of skips where hypothetical P&L was positive
            - skip_accuracy: Fraction of skips that avoided losers
            - pnl_saved: Total hypothetical losses avoided
            - pnl_missed: Total hypothetical wins missed
            - net_value: pnl_saved - pnl_missed (positive = gate adds value)
    """
    if not rejections or not market_outcomes:
        return {
            "_status": "no_rejection_data",
            "_note": "Enable eligibility gate to populate. Requires hypothetical outcome tracking.",
        }

    # Match rejections to outcomes by timestamp
    outcome_map = {}
    for outcome in market_outcomes:
        ts = outcome.get("timestamp")
        if ts:
            outcome_map[ts] = outcome

    would_have_lost = 0
    would_have_won = 0
    pnl_saved = 0.0
    pnl_missed = 0.0

    for rejection in rejections:
        ts = rejection.get("timestamp")
        outcome = outcome_map.get(ts)
        if not outcome:
            continue

        hyp_pnl = float(outcome.get("hypothetical_pnl", 0))
        if hyp_pnl < 0:
            would_have_lost += 1
            pnl_saved += abs(hyp_pnl)
        elif hyp_pnl > 0:
            would_have_won += 1
            pnl_missed += hyp_pnl

    total = would_have_lost + would_have_won
    return {
        "total_skipped": len(rejections),
        "matched_outcomes": total,
        "would_have_lost": would_have_lost,
        "would_have_won": would_have_won,
        "skip_accuracy": round(would_have_lost / total, 4) if total > 0 else 0,
        "pnl_saved": round(pnl_saved, 2),
        "pnl_missed": round(pnl_missed, 2),
        "net_value": round(pnl_saved - pnl_missed, 2),
    }


def compute_full_analytics(
    daily_pnl_records: list[dict],
    trades: list[dict],
    decisions: list[dict] | None = None,
    rejections: list[dict] | None = None,
    market_outcomes: list[dict] | None = None,
) -> dict:
    """Run all analytics and return combined result.

    Args:
        daily_pnl_records: Daily P&L records
        trades: Trade records
        decisions: Optional eligibility gate decisions (for layer analytics)
        rejections: Optional SKIP decisions (for rejection quality analysis)
        market_outcomes: Optional hypothetical outcomes for skipped signals
    """
    # ─── Task 5.1: Enrich daily records with trade_count ───
    enrich_daily_pnl_records(daily_pnl_records, trades)

    # ─── Task 5.3: Tag trades with entry_hour + session_type ─
    tag_trade_session_fields(trades)

    result = {
        "calendar_patterns": compute_calendar_patterns(daily_pnl_records, trades),
        "session_analysis": compute_session_analysis(trades),
        "named_session_analysis": compute_named_session_analytics(trades),
        "mae_mfe_analysis": compute_mae_mfe_analysis(trades),
        "win_loss_patterns": compute_win_loss_patterns(daily_pnl_records, trades),
        "regime_performance": compute_regime_performance(daily_pnl_records, trades),
        "autocorrelation": compute_trade_autocorrelation(daily_pnl_records),
        # ─── Task 5.2: Intelligence overlays for calendar ────
        "event_markers": compute_event_markers(daily_pnl_records),
        "streak_overlay": compute_streak_overlay(daily_pnl_records),
        "firm_limit_markers": compute_firm_limit_markers(daily_pnl_records),
    }

    # Per-layer analytics (populated when eligibility gate is active)
    if decisions is not None:
        result["playbook_analytics"] = compute_playbook_analytics(trades, decisions)
        result["bias_regime_analytics"] = compute_bias_regime_analytics(trades, decisions)

    if rejections is not None:
        result["rejection_quality"] = compute_rejection_quality(
            rejections, market_outcomes or []
        )

    return result
