"""Prop firm account simulation — day-by-day evaluation pass.

After vectorbt computes the equity curve and trades, this module
walks through each trading day as if executing on a real prop firm
account, enforcing:
  - Daily loss limits (Topstep $1K, Alpha $1K)
  - Trailing drawdown (EOD vs realtime/intraday)
  - Consistency rules (TPT 50%, FFN Express 15%)
  - Profit targets and payout projections

Uses configs from prop_compliance.py and firm_config.py.
"""

from __future__ import annotations

import math
from typing import Optional

from src.engine.config import CONTRACT_SPECS
from src.engine.prop_compliance import FIRM_CONFIGS
from src.engine.firm_config import FIRM_COMMISSIONS


# Daily loss limits per firm (from firm_profiles.py)
# None = no daily limit
DAILY_LOSS_LIMITS: dict[str, Optional[float]] = {
    "topstep_50k": 1000,
    "mffu_50k": None,
    "tpt_50k": None,
    "apex_50k": None,
    "tradeify_50k": None,
    "alpha_50k": 1000,
    "ffn_50k": None,
    "earn2trade_50k": None,
}

# Earn2Trade config (missing from prop_compliance.py FIRM_CONFIGS)
EARN2TRADE_CONFIG = {
    "name": "Earn2Trade 50K",
    "monthly_fee": 150,
    "activation_fee": 0,
    "profit_target": 3000,
    "max_drawdown": 2000,
    "trailing": "eod",
    "locks_at_start": False,
    "consistency_rule": None,
    "overnight_ok": True,
    "payout_split": 0.80,
    "ongoing_fee": 0,
}


def _get_all_firm_configs() -> dict[str, dict]:
    """Get all firm configs including Earn2Trade."""
    configs = dict(FIRM_CONFIGS)
    if "earn2trade_50k" not in configs:
        configs["earn2trade_50k"] = EARN2TRADE_CONFIG
    return configs


def simulate_prop_firm(
    daily_pnl_records: list[dict],
    trades: list[dict],
    firm_key: str,
    symbol: str = "ES",
    account_size: float = 50000,
) -> dict:
    """Walk through each trading day simulating a real prop firm account.

    Args:
        daily_pnl_records: list of {"date": "YYYY-MM-DD", "pnl": float}
        trades: list of trade dicts from vectorbt
        firm_key: firm identifier (e.g. "topstep_50k")
        symbol: trading symbol for commission lookup
        account_size: starting account balance

    Returns:
        Full simulation result dict with daily statements, monthly summaries,
        pass/fail verdicts, and payout projections.
    """
    all_configs = _get_all_firm_configs()
    firm = all_configs.get(firm_key)
    if not firm:
        return {"error": f"Unknown firm: {firm_key}", "eval_passed": False}

    # Commission adjustment per day
    comm_per_side = FIRM_COMMISSIONS.get(firm_key, {}).get(symbol, 2.52)
    daily_loss_limit = DAILY_LOSS_LIMITS.get(firm_key)
    # Tradeify uses realtime trailing DD (intraday equity, not EOD).
    # Other firms (Topstep, MFFU, Apex, etc.) use EOD trailing.
    is_realtime = firm["trailing"] == "realtime"

    balance = account_size
    peak_equity = account_size
    starting_balance = account_size
    profit_target = firm["profit_target"]

    daily_statements: list[dict] = []
    daily_loss_breaches: list[str] = []
    trailing_dd_breached = False
    breach_day: Optional[str] = None
    days_to_pass_eval: Optional[int] = None
    eval_passed = False

    # Count trades per day for commission calc
    trades_per_day: dict[str, int] = {}
    # Task 3.3: Track which days have overnight holds (entry day != exit day)
    overnight_days: set[str] = set()
    for t in trades:
        entry_ts = t.get("Entry Timestamp") or t.get("entry_time") or ""
        exit_ts = t.get("Exit Timestamp") or t.get("exit_time") or ""
        if isinstance(entry_ts, str) and len(entry_ts) >= 10:
            day = entry_ts[:10]
            trades_per_day[day] = trades_per_day.get(day, 0) + 1
            # If exit is on a different day, entry day has overnight exposure
            if isinstance(exit_ts, str) and len(exit_ts) >= 10:
                exit_day = exit_ts[:10]
                if exit_day != day:
                    overnight_days.add(day)

    for day_idx, record in enumerate(daily_pnl_records):
        date_str = record.get("date", f"day_{day_idx}")
        gross_pnl = record["pnl"]

        # Apply per-firm commission adjustment
        day_trades = trades_per_day.get(date_str, 0)
        comm_cost = comm_per_side * 2 * day_trades  # round-trip
        net_pnl = gross_pnl - comm_cost

        # Daily loss limit enforcement
        day_halted = False
        if daily_loss_limit is not None and net_pnl < -daily_loss_limit:
            # Cap the loss at the limit — firm would have stopped trading
            net_pnl = -daily_loss_limit
            day_halted = True
            daily_loss_breaches.append(date_str)

        # Compute intraday low BEFORE updating balance (for realtime DD)
        prev_balance = balance
        if is_realtime:
            # Realtime: estimate intraday low from daily PnL
            # If net_pnl is negative, worst point was at least prev_balance + net_pnl
            # (the closing balance). Could be worse intraday but we only have daily data.
            intraday_low = prev_balance + min(0, net_pnl)
        else:
            intraday_low = prev_balance + net_pnl  # EOD: use closing balance

        # Update balance
        balance += net_pnl

        # Task 3.4: Intraday max DD tracking (approximation from daily resolution)
        # NOTE: For full accuracy, bar-level equity would be needed (future enhancement).
        intraday_max_dd_approx = round(peak_equity - intraday_low, 2)

        # Update high water mark (EOD: at end of day)
        peak_equity = max(peak_equity, balance)

        # Compute drawdown from peak
        dd_from_peak = peak_equity - balance

        # Trailing drawdown floor
        dd_limit = firm["max_drawdown"]
        if firm.get("locks_at_start", False):
            # Floor locks at starting_balance - max_dd
            floor = max(peak_equity - dd_limit, starting_balance - dd_limit)
        else:
            floor = peak_equity - dd_limit

        if balance <= floor and not trailing_dd_breached:
            trailing_dd_breached = True
            breach_day = date_str

        # Check if eval passed (hit profit target)
        if not eval_passed and (balance - starting_balance) >= profit_target:
            eval_passed = True
            days_to_pass_eval = day_idx + 1

        daily_statements.append({
            "date": date_str,
            "gross_pnl": round(gross_pnl, 2),
            "commission": round(comm_cost, 2),
            "net_pnl": round(net_pnl, 2),
            "balance": round(balance, 2),
            "drawdown_from_peak": round(dd_from_peak, 2),
            "peak_equity": round(peak_equity, 2),
            "trades": day_trades,
            "halted": day_halted,
            "intraday_max_dd_approx": intraday_max_dd_approx,
            "overnight_gap_risk": date_str in overnight_days,
        })

    # Monthly summary
    monthly: dict[tuple[int, int], dict] = {}
    for stmt in daily_statements:
        date_str = stmt["date"]
        if date_str and "-" in str(date_str):
            parts = str(date_str).split("-")
            year, month = int(parts[0]), int(parts[1])
        else:
            continue
        key = (year, month)
        if key not in monthly:
            monthly[key] = {
                "year": year, "month": month,
                "pnl": 0.0, "win_days": 0, "loss_days": 0,
                "best_day": float("-inf"), "worst_day": float("inf"),
                "trades": 0,
            }
        m = monthly[key]
        m["pnl"] += stmt["net_pnl"]
        m["trades"] += stmt["trades"]
        if stmt["net_pnl"] > 0:
            m["win_days"] += 1
        elif stmt["net_pnl"] < 0:
            m["loss_days"] += 1
        m["best_day"] = max(m["best_day"], stmt["net_pnl"])
        m["worst_day"] = min(m["worst_day"], stmt["net_pnl"])

    monthly_summary = []
    for key in sorted(monthly.keys()):
        m = monthly[key]
        m["pnl"] = round(m["pnl"], 2)
        m["best_day"] = round(m["best_day"], 2) if m["best_day"] != float("-inf") else 0
        m["worst_day"] = round(m["worst_day"], 2) if m["worst_day"] != float("inf") else 0
        monthly_summary.append(m)

    # Worst month
    worst_month = min(monthly_summary, key=lambda x: x["pnl"]) if monthly_summary else None

    # Consistency ratio
    total_profit = sum(s["net_pnl"] for s in daily_statements if s["net_pnl"] > 0)
    best_single_day = max((s["net_pnl"] for s in daily_statements), default=0)
    consistency_ratio = best_single_day / total_profit if total_profit > 0 else 0.0

    # Consistency check
    consistency_passed = True
    consistency_failure = None
    if firm.get("consistency_rule") == "tpt_50pct" and consistency_ratio > 0.50:
        consistency_passed = False
        consistency_failure = f"Best day = {consistency_ratio:.0%} of total profit (limit: 50%)"
    elif firm.get("consistency_rule") == "ffn_15pct":
        daily_limit_pct = profit_target * 0.15
        if best_single_day > daily_limit_pct:
            consistency_passed = False
            consistency_failure = f"Best day ${best_single_day:.0f} > ${daily_limit_pct:.0f} limit"
    elif firm.get("consistency_rule") == "alpha_50pct" and consistency_ratio > 0.50:
        consistency_passed = False
        consistency_failure = f"Best day = {consistency_ratio:.0%} of total profit (limit: 50%)"

    # Max drawdown in dollars
    max_dd_dollars = max((s["drawdown_from_peak"] for s in daily_statements), default=0)

    # Recovery days from max drawdown
    # Count trading days from the point of max DD until balance returns to peak
    recovery_days = 0
    if max_dd_dollars > 0:
        in_recovery = False
        for s in daily_statements:
            if s["drawdown_from_peak"] >= max_dd_dollars * 0.99:
                in_recovery = True
                recovery_days = 0
            elif in_recovery:
                recovery_days += 1
                if s["drawdown_from_peak"] == 0:
                    # Fully recovered — back at peak equity
                    break

    # Payout projection
    total_net_profit = balance - starting_balance
    if total_net_profit > 0 and eval_passed:
        split = firm["payout_split"]
        monthly_fee = firm.get("ongoing_fee", 0)
        total_months = len(monthly_summary) or 1
        monthly_gross = total_net_profit * split / total_months
        payout_projection = round(monthly_gross - monthly_fee, 2)
    else:
        payout_projection = 0

    # Overnight gap risk days count (must compute before violation check)
    overnight_risk_days = sum(1 for s in daily_statements if s.get("overnight_gap_risk", False))

    # Overnight hold violation check
    overnight_violation = False
    if not firm.get("overnight_ok", True) and overnight_risk_days > 0:
        overnight_violation = True

    # Overall verdict
    passed = (
        eval_passed
        and not trailing_dd_breached
        and consistency_passed
        and not overnight_violation
    )

    # ─── Eval cost amortization ──────────────────────────────
    # Conservative 30% pass rate default.
    # TODO(Wave 8): Replace with MC-derived pass probability per strategy.
    pass_probability = 0.30
    net_payout = payout_projection * 12 if payout_projection > 0 else 0
    expected_eval_cost = round(
        firm.get("monthly_fee", 0) / max(0.01, pass_probability), 2
    )
    true_net_payout = round(
        net_payout - expected_eval_cost / 12, 2
    ) if net_payout > 0 else 0

    # ─── Eval/funded phase separation ──────────────────────
    eval_cost = firm.get("monthly_fee", 0) * max(1, (days_to_pass_eval or 60) // 20)

    # Funded phase: count months where account survived (not breached)
    survival_months = 0
    for m in monthly_summary:
        if trailing_dd_breached and breach_day:
            parts = str(breach_day).split("-")
            if len(parts) >= 2:
                breach_year, breach_month = int(parts[0]), int(parts[1])
                if (m["year"], m["month"]) > (breach_year, breach_month):
                    break
        survival_months += 1

    return {
        "firm": firm_key,
        "firm_name": firm["name"],
        "starting_balance": starting_balance,
        "ending_balance": round(balance, 2),
        "peak_equity": round(peak_equity, 2),
        "max_drawdown_dollars": round(max_dd_dollars, 2),
        "max_drawdown_limit": firm["max_drawdown"],
        "daily_loss_limit_breaches": daily_loss_breaches,
        "trailing_dd_breached": trailing_dd_breached,
        "breach_day": breach_day,
        "consistency_ratio": round(consistency_ratio, 4),
        "consistency_passed": consistency_passed,
        "consistency_failure": consistency_failure,
        "days_to_pass_eval": days_to_pass_eval,
        "eval_passed": eval_passed,
        "passed": passed,
        "payout_split": firm["payout_split"],
        "payout_projection_monthly": payout_projection,
        "daily_account_statement": daily_statements,
        "monthly_summary": monthly_summary,
        "worst_month": worst_month,
        "recovery_days_from_max_dd": recovery_days,
        "expected_eval_cost": expected_eval_cost,
        "true_net_payout": true_net_payout,
        "overnight_risk_days": overnight_risk_days,
        "overnight_violation": overnight_violation,
        "eval_phase_result": {
            "profit_target": profit_target,
            "days_to_target": days_to_pass_eval,
            "passed": eval_passed,
            "cost_of_eval": eval_cost,
        },
        "funded_phase_result": {
            "monthly_net_pnl": [round(m["pnl"], 2) for m in monthly_summary],
            "survival_months": survival_months,
            "payout_projection": payout_projection,
        },
    }


def simulate_all_firms(
    daily_pnl_records: list[dict],
    trades: list[dict],
    symbol: str = "ES",
    account_size: float = 50000,
) -> dict[str, dict]:
    """Run prop firm simulation against all 8 firms.

    Returns dict mapping firm_key → simulation result.
    """
    all_configs = _get_all_firm_configs()
    results = {}
    for firm_key in all_configs:
        results[firm_key] = simulate_prop_firm(
            daily_pnl_records, trades, firm_key, symbol, account_size,
        )
    return results
