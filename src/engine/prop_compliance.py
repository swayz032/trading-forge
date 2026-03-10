"""Prop firm compliance simulation — 7 firms from docs/prop-firm-rules.md.

Per CLAUDE.md: Agents MUST load prop-firm-rules.md when simulating.
risk.ts has 6 firms (missing FFN) — Python has all 7.
"""

from __future__ import annotations

import math
from typing import Optional


# ─── Firm Configurations ──────────────────────────────────────────
# All from docs/prop-firm-rules.md, exact 50K account specs

FIRM_CONFIGS = {
    "topstep_50k": {
        "name": "Topstep 50K",
        "monthly_fee": 49,
        "activation_fee": 149,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": None,
        "overnight_ok": True,
        "payout_split": 0.90,
        "ongoing_fee": 0,
    },
    "mffu_50k": {
        "name": "MFFU 50K",
        "monthly_fee": 77,
        "activation_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2500,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": None,
        "overnight_ok": True,
        "payout_split": 0.90,
        "ongoing_fee": 0,
    },
    "tpt_50k": {
        "name": "TPT 50K",
        "monthly_fee": 150,
        "activation_fee": 130,
        "profit_target": 3000,
        "max_drawdown": 3000,
        "trailing": "eod",
        "locks_at_start": False,
        "consistency_rule": "tpt_50pct",
        "overnight_ok": True,
        "payout_split": 0.80,  # PRO phase
        "ongoing_fee": 0,
    },
    "apex_50k": {
        "name": "Apex 50K",
        "monthly_fee": 167,
        "activation_fee": 85,
        "profit_target": 3000,
        "max_drawdown": 2500,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": None,
        "overnight_ok": True,
        "payout_split": 1.00,  # First $25K at 100%
        "ongoing_fee": 85,
    },
    "tradeify_50k": {
        "name": "Tradeify 50K",
        "monthly_fee": 99,
        "activation_fee": 0,
        "profit_target": 2500,
        "max_drawdown": 2500,
        "trailing": "realtime",
        "locks_at_start": True,
        "consistency_rule": None,
        "overnight_ok": True,
        "payout_split": 1.00,  # First $15K at 100%
        "ongoing_fee": 0,
    },
    "alpha_50k": {
        "name": "Alpha Futures 50K (Standard)",
        "monthly_fee": 99,
        "activation_fee": 149,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": "alpha_50pct",  # Eval only
        "overnight_ok": False,  # Must flatten before close
        "payout_split": 0.70,  # Standard first payout
        "ongoing_fee": 0,
    },
    "ffn_50k": {
        "name": "FFN 50K (Express)",
        "monthly_fee": 200,
        "activation_fee": 120,  # Exhibition phase
        "profit_target": 3000,
        "max_drawdown": 2500,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": "ffn_15pct",
        "overnight_ok": False,
        "payout_split": 0.80,  # First $5K
        "ongoing_fee": 126,  # Monthly data fee
    },
}


# ─── Drawdown Simulators ──────────────────────────────────────────

def simulate_trailing_drawdown_eod(
    daily_closing_balances: list[float],
    max_dd: float,
    locks_at_start: bool = True,
) -> tuple[bool, Optional[int], float]:
    """Simulate EOD trailing drawdown.

    Args:
        daily_closing_balances: End-of-day account balances
        max_dd: Maximum allowed drawdown
        locks_at_start: If True, floor stops trailing at starting balance

    Returns:
        (passed, blown_on_day, max_drawdown_used)
    """
    if not daily_closing_balances:
        return (True, None, 0.0)

    starting = daily_closing_balances[0]
    hwm = starting
    max_dd_used = 0.0

    for day, balance in enumerate(daily_closing_balances):
        hwm = max(hwm, balance)
        floor = hwm - max_dd

        if locks_at_start:
            floor = max(floor, starting - max_dd)

        dd_used = hwm - balance
        max_dd_used = max(max_dd_used, dd_used)

        if balance <= floor:
            return (False, day, dd_used)

    return (True, None, max_dd_used)


def simulate_trailing_drawdown_realtime(
    equity_path: list[float],
    max_dd: float,
    locks_at_start: bool = True,
) -> tuple[bool, Optional[int], float]:
    """Simulate real-time trailing drawdown (intraday).

    Unlike EOD, this checks every price point, catching intraday dips.
    """
    if not equity_path:
        return (True, None, 0.0)

    starting = equity_path[0]
    hwm = starting
    max_dd_used = 0.0

    for tick, value in enumerate(equity_path):
        hwm = max(hwm, value)
        floor = hwm - max_dd

        if locks_at_start:
            floor = max(floor, starting - max_dd)

        dd_used = hwm - value
        max_dd_used = max(max_dd_used, dd_used)

        if value <= floor:
            return (False, tick, dd_used)

    return (True, None, max_dd_used)


# ─── Consistency Rules ────────────────────────────────────────────

def check_tpt_consistency(daily_pnls: list[float]) -> tuple[bool, float]:
    """TPT 50% rule: no single day > 50% of total profit.

    Returns:
        (passed, worst_day_percent)
    """
    total_profit = sum(p for p in daily_pnls if p > 0)
    if total_profit <= 0:
        return (True, 0.0)

    worst_pct = 0.0
    for pnl in daily_pnls:
        if pnl > 0:
            pct = pnl / total_profit
            worst_pct = max(worst_pct, pct)
            if pct > 0.50:
                return (False, pct)

    return (True, worst_pct)


def check_ffn_express_consistency(
    daily_pnls: list[float],
    profit_target: float,
) -> tuple[bool, float, float]:
    """FFN Express 15% rule: no single day > 15% of profit target.

    Returns:
        (passed, max_day_pnl, daily_limit)
    """
    daily_limit = profit_target * 0.15
    max_day = max(daily_pnls) if daily_pnls else 0
    return (max_day <= daily_limit, max_day, daily_limit)


# ─── Full Compliance Run ──────────────────────────────────────────

def run_prop_compliance(
    daily_pnls: list[float],
    stats: dict,
) -> dict[str, dict]:
    """Simulate strategy against all 7 prop firms.

    Args:
        daily_pnls: Array of daily P&L values
        stats: Strategy statistics including max_drawdown, trades_overnight

    Returns:
        dict mapping firm_key → compliance result
    """
    # Build equity curve from daily PnLs
    starting_balance = 50000.0
    equity = [starting_balance]
    for pnl in daily_pnls:
        equity.append(equity[-1] + pnl)

    results = {}

    for firm_key, firm in FIRM_CONFIGS.items():
        passed = True
        failures: list[str] = []

        # Check overnight positions
        if not firm["overnight_ok"] and stats.get("trades_overnight", False):
            passed = False
            failures.append("Strategy holds overnight positions — not allowed")

        # Check drawdown
        if firm["trailing"] == "realtime":
            dd_passed, blown_day, dd_used = simulate_trailing_drawdown_realtime(
                equity, firm["max_drawdown"], firm.get("locks_at_start", True)
            )
        else:
            dd_passed, blown_day, dd_used = simulate_trailing_drawdown_eod(
                equity, firm["max_drawdown"], firm.get("locks_at_start", True)
            )

        if not dd_passed:
            passed = False
            failures.append(
                f"Drawdown breach on day {blown_day}: "
                f"used ${dd_used:.0f} vs ${firm['max_drawdown']} limit"
            )

        # Check consistency rules
        if firm["consistency_rule"] == "tpt_50pct":
            cons_passed, worst_pct = check_tpt_consistency(daily_pnls)
            if not cons_passed:
                passed = False
                failures.append(
                    f"TPT 50% consistency violation: "
                    f"best day = {worst_pct:.0%} of total profit"
                )

        elif firm["consistency_rule"] == "ffn_15pct":
            cons_passed, max_day, limit = check_ffn_express_consistency(
                daily_pnls, firm["profit_target"]
            )
            if not cons_passed:
                passed = False
                failures.append(
                    f"FFN 15% consistency violation: "
                    f"max day ${max_day:.0f} > ${limit:.0f} limit"
                )

        elif firm["consistency_rule"] == "alpha_50pct":
            # Alpha uses same 50% rule as TPT during eval
            cons_passed, worst_pct = check_tpt_consistency(daily_pnls)
            if not cons_passed:
                passed = False
                failures.append(
                    f"Alpha 50% consistency violation: "
                    f"best day = {worst_pct:.0%} of total profit"
                )

        # Calculate ROI estimates
        avg_daily = stats.get("avg_daily_pnl", 0)
        if avg_daily > 0:
            days_to_target = firm["profit_target"] / avg_daily
            months_to_pass = days_to_target / 21
            eval_cost = firm["monthly_fee"] * max(1, math.ceil(months_to_pass)) + firm["activation_fee"]
        else:
            months_to_pass = None
            eval_cost = firm["monthly_fee"] + firm["activation_fee"]  # At least 1 month

        results[firm_key] = {
            "name": firm["name"],
            "passed": passed,
            "failures": failures,
            "max_drawdown_limit": firm["max_drawdown"],
            "drawdown_used": round(dd_used, 2),
            "eval_cost": round(eval_cost, 2),
            "months_to_pass": round(months_to_pass, 1) if months_to_pass != float("inf") else None,
            "payout_split": firm["payout_split"],
            "ongoing_fee": firm["ongoing_fee"],
        }

    return results


# ─── Firm Ranking ─────────────────────────────────────────────────

def rank_firms_for_strategy(stats: dict) -> list[dict]:
    """Rank firms by expected ROI given strategy profile.

    Considers: eval cost, split, time to pass, ongoing fees.
    """
    rankings = []

    for firm_key, firm in FIRM_CONFIGS.items():
        # Hard disqualifiers
        if stats["max_drawdown"] >= firm["max_drawdown"]:
            continue
        if not firm["overnight_ok"] and stats.get("trades_overnight", False):
            continue
        if firm["consistency_rule"] == "tpt_50pct" and stats.get("consistency_ratio", 0) > 0.50:
            continue
        if firm["consistency_rule"] == "ffn_15pct" and stats.get("consistency_ratio", 0) > 0.15:
            continue

        avg_daily = stats["avg_daily_pnl"]
        days_to_target = firm["profit_target"] / avg_daily if avg_daily > 0 else 999
        months_to_pass = days_to_target / 21

        eval_cost = firm["monthly_fee"] * max(1, math.ceil(months_to_pass)) + firm["activation_fee"]
        annual_ongoing = firm["ongoing_fee"] * 12
        annual_gross = avg_daily * 252 * firm["payout_split"]
        annual_net = annual_gross - annual_ongoing - eval_cost
        roi = annual_net / eval_cost if eval_cost > 0 else float("inf")

        rankings.append({
            "firm": firm_key,
            "name": firm["name"],
            "eval_cost": round(eval_cost, 2),
            "months_to_pass": round(months_to_pass, 1),
            "payout_split": firm["payout_split"],
            "annual_net_estimate": round(annual_net, 2),
            "roi": round(roi, 2),
        })

    return sorted(rankings, key=lambda x: x["roi"], reverse=True)
