"""Prop firm compliance simulation — 7 firms from docs/prop-firm-rules.md.

Per CLAUDE.md: Agents MUST load prop-firm-rules.md when simulating.
risk.ts has 6 firms (missing FFN) — Python has all 7.
"""

from __future__ import annotations

import math
from typing import Optional

from src.engine.firm_config import FIRM_COMMISSIONS


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

def _compute_net_daily_pnls(
    daily_pnls: list[float],
    firm_key: str,
    symbol: str = "ES",
    avg_trades_per_day: float = 2.0,
) -> list[float]:
    """Adjust daily PnLs for firm-specific commissions.

    Args:
        daily_pnls: Gross daily PnLs
        firm_key: Firm identifier
        symbol: Trading symbol
        avg_trades_per_day: Average round-trip trades per day

    Returns:
        Net daily PnLs after per-firm commissions
    """
    if firm_key not in FIRM_COMMISSIONS:
        return daily_pnls

    comm_per_side = FIRM_COMMISSIONS[firm_key].get(symbol, 2.52)
    # Round-trip = 2 sides per trade
    daily_comm = comm_per_side * 2 * avg_trades_per_day
    return [pnl - daily_comm for pnl in daily_pnls]


def run_prop_compliance(
    daily_pnls: list[float],
    stats: dict,
) -> dict[str, dict]:
    """Simulate strategy against all 7 prop firms.

    Uses per-firm net P&L (after firm-specific commissions) when symbol
    and trade count data are available in stats. Also uses gap-adjusted
    drawdown when available for overnight strategies.

    Args:
        daily_pnls: Array of daily P&L values
        stats: Strategy statistics including max_drawdown, trades_overnight,
            symbol, total_trades, total_trading_days, gap_adjusted_drawdown

    Returns:
        dict mapping firm_key → compliance result
    """
    symbol = stats.get("symbol", "ES")
    total_trades = stats.get("total_trades", 0)
    total_days = stats.get("total_trading_days", len(daily_pnls))
    avg_trades_per_day = total_trades / total_days if total_days > 0 else 2.0
    gap_dd = stats.get("gap_adjusted_drawdown")

    # Build equity curve from daily PnLs
    starting_balance = 50000.0
    equity = [starting_balance]
    for pnl in daily_pnls:
        equity.append(equity[-1] + pnl)

    results = {}

    for firm_key, firm in FIRM_CONFIGS.items():
        passed = True
        failures: list[str] = []

        # Compute net daily PnLs for this firm
        net_pnls = _compute_net_daily_pnls(
            daily_pnls, firm_key, symbol, avg_trades_per_day,
        )

        # Build net equity curve for this firm
        net_equity = [starting_balance]
        for pnl in net_pnls:
            net_equity.append(net_equity[-1] + pnl)

        # Check overnight positions
        if not firm["overnight_ok"] and stats.get("trades_overnight", False):
            passed = False
            failures.append("Strategy holds overnight positions — not allowed")

        # Check drawdown (using net equity)
        if firm["trailing"] == "realtime":
            dd_passed, blown_day, dd_used = simulate_trailing_drawdown_realtime(
                net_equity, firm["max_drawdown"], firm.get("locks_at_start", True)
            )
        else:
            dd_passed, blown_day, dd_used = simulate_trailing_drawdown_eod(
                net_equity, firm["max_drawdown"], firm.get("locks_at_start", True)
            )

        if not dd_passed:
            passed = False
            failures.append(
                f"Drawdown breach on day {blown_day}: "
                f"used ${dd_used:.0f} vs ${firm['max_drawdown']} limit"
            )

        # Check gap-adjusted drawdown if available (overnight strategies)
        if gap_dd is not None and gap_dd > firm["max_drawdown"]:
            passed = False
            failures.append(
                f"Gap-adjusted drawdown ${gap_dd:.0f} exceeds "
                f"${firm['max_drawdown']} limit (overnight risk)"
            )

        # Check consistency rules (using net PnLs)
        if firm["consistency_rule"] == "tpt_50pct":
            cons_passed, worst_pct = check_tpt_consistency(net_pnls)
            if not cons_passed:
                passed = False
                failures.append(
                    f"TPT 50% consistency violation: "
                    f"best day = {worst_pct:.0%} of total profit"
                )

        elif firm["consistency_rule"] == "ffn_15pct":
            cons_passed, max_day, limit = check_ffn_express_consistency(
                net_pnls, firm["profit_target"]
            )
            if not cons_passed:
                passed = False
                failures.append(
                    f"FFN 15% consistency violation: "
                    f"max day ${max_day:.0f} > ${limit:.0f} limit"
                )

        elif firm["consistency_rule"] == "alpha_50pct":
            # Alpha uses same 50% rule as TPT during eval
            cons_passed, worst_pct = check_tpt_consistency(net_pnls)
            if not cons_passed:
                passed = False
                failures.append(
                    f"Alpha 50% consistency violation: "
                    f"best day = {worst_pct:.0%} of total profit"
                )

        # Calculate ROI estimates
        avg_daily = stats.get("avg_daily_pnl", 0)
        mc_pass_probability = stats.get("mc_pass_probability", 0.30)
        if avg_daily > 0:
            days_to_target = firm["profit_target"] / avg_daily
            months_to_pass = days_to_target / 21
            single_eval_cost = firm["monthly_fee"] * max(1, math.ceil(months_to_pass)) + firm["activation_fee"]
        else:
            months_to_pass = None
            single_eval_cost = firm["monthly_fee"] + firm["activation_fee"]  # At least 1 month

        # Expected eval cost: amortize over pass probability
        expected_eval_cost = round(
            single_eval_cost / max(0.01, mc_pass_probability), 2
        )

        results[firm_key] = {
            "name": firm["name"],
            "passed": passed,
            "failures": failures,
            "max_drawdown_limit": firm["max_drawdown"],
            "drawdown_used": round(dd_used, 2),
            "single_eval_cost": round(single_eval_cost, 2),
            "expected_eval_cost": expected_eval_cost,
            "months_to_pass": round(months_to_pass, 1) if months_to_pass is not None and months_to_pass != float("inf") else None,
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

        single_eval_cost = firm["monthly_fee"] * max(1, math.ceil(months_to_pass)) + firm["activation_fee"]
        # Expected eval cost: amortize over pass probability (default 30%)
        mc_pass_probability = stats.get("mc_pass_probability", 0.30)
        expected_eval_cost = single_eval_cost / max(0.01, mc_pass_probability)
        annual_ongoing = firm["ongoing_fee"] * 12
        annual_gross = avg_daily * 252 * firm["payout_split"]
        annual_net = annual_gross - annual_ongoing - expected_eval_cost
        roi = annual_net / expected_eval_cost if expected_eval_cost > 0 else float("inf")

        rankings.append({
            "firm": firm_key,
            "name": firm["name"],
            "single_eval_cost": round(single_eval_cost, 2),
            "expected_eval_cost": round(expected_eval_cost, 2),
            "months_to_pass": round(months_to_pass, 1),
            "payout_split": firm["payout_split"],
            "ongoing_fee_annual": round(annual_ongoing, 2),
            "annual_net_estimate": round(annual_net, 2),
            "roi": round(roi, 2),
        })

    return sorted(rankings, key=lambda x: x["roi"], reverse=True)
