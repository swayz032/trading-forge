"""Prop firm compliance simulation — Topstep (PRIMARY) + MFFU (secondary).

Per CLAUDE.md §6: only Topstep + MFFU are active prop firms. The 6 legacy
firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) were removed from
production scope on 2026-05-10 (migration 0097) and stripped from runtime
config on 2026-05-19. Their configs no longer ship.

The remaining firm-specific rules (consistency, drawdown trailing mode,
payout splits, monthly fees) are the only differentiators applied per
firm today; per-firm CONTRACT-CAP-AWARE re-sizing of the trade list is a
Wave 23 carry-forward (today every firm runs the same trade list at the
same sizes — only pass/fail flags differ between Topstep and MFFU).

TODO (Wave 24): per-firm-resize — prop_sim does NOT re-size trades per firm.
  Currently both Topstep and MFFU simulate the SAME trade list at the SAME
  contract sizes. Topstep trailing-DD (EOD) and MFFU rules differ only in
  pass/fail flag computation. Correct behavior would resize the trade list
  per firm's contract caps and 2% max-risk rule before walking the sim.
  Deferred to Wave 24 (carry-forward from 2026-05-19 audit).
  Impact: Topstep cap = per-tier, MFFU cap = 2% of account per trade.
  Tracking: search for TODO:per-firm-resize in codebase.
"""

from __future__ import annotations  # noqa: I001

import math
from typing import Optional

from src.engine.firm_config import FIRM_COMMISSIONS


# ─── Firm Configurations ──────────────────────────────────────────
# All from docs/prop-firm-rules.md, exact 50K account specs

FIRM_CONFIGS = {
    "topstep_50k": {
        "name": "Topstep 50K",
        "monthly_fee": 49,
        "activation_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": None,
        "overnight_ok": False,
        "payout_split": 0.90,
        "payout_split_tiers": None,
        "ongoing_fee": 0,
        "daily_loss_limit": 1000,
        "min_payout_days": 5,
        "min_trading_days": 5,
    },
    "mffu_50k": {
        "name": "MFFU 50K (Core)",
        "monthly_fee": 77,
        "activation_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "trailing": "eod",
        "locks_at_start": True,
        "consistency_rule": "mffu_50pct",
        "overnight_ok": False,
        "payout_split": 0.80,
        "payout_split_tiers": None,
        "ongoing_fee": 0,
        "daily_loss_limit": None,
        "min_payout_days": 5,
        "min_trading_days": 5,
    },
    # Legacy firms (TPT, Apex, Tradeify, Alpha, FFN, Earn2Trade) removed
    # 2026-05-19 per CLAUDE.md §6 production scope (Topstep + MFFU only).
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
    symbol: str = "MES",
    avg_trades_per_day: float = 2.0,
    backtester_commission_per_side: float = 0.62,
) -> list[float]:
    """Adjust daily PnLs for the DELTA between backtester and firm-specific commissions.

    H4 FIX: The daily_pnls from the backtester are ALREADY net of commission
    (the backtester deducts commission_per_side when computing each trade's net P&L).
    The old implementation re-deducted the FULL firm commission again, causing double
    deduction and making every firm look worse than reality.

    The correct adjustment is:
        delta = firm_commission_per_side - backtester_commission_per_side
        If delta > 0 → firm charges more than backtester assumed → further deduct.
        If delta <= 0 → firm charges same or less → no adjustment needed.

    Args:
        daily_pnls: Net daily PnLs (already net of backtester's commission).
        firm_key: Firm identifier.
        symbol: Trading symbol.
        avg_trades_per_day: Average round-trip trades per day.
        backtester_commission_per_side: Commission rate already baked into daily_pnls.

    Returns:
        Daily PnLs adjusted for commission delta between backtester and firm rate.
    """
    if firm_key not in FIRM_COMMISSIONS:
        return daily_pnls

    firm_comm_per_side = FIRM_COMMISSIONS[firm_key].get(symbol, backtester_commission_per_side)
    # Only apply the DELTA — avoid double deduction
    delta_per_side = firm_comm_per_side - backtester_commission_per_side
    if delta_per_side <= 0:
        # Firm is cheaper or equal — no adjustment needed
        return daily_pnls

    # Round-trip = 2 sides per trade; multiply by avg daily trade count
    daily_delta = delta_per_side * 2 * avg_trades_per_day
    return [pnl - daily_delta for pnl in daily_pnls]


def run_prop_compliance(
    daily_pnls: list[float],
    stats: dict,
    backtester_commission_per_side: float = 0.62,
) -> dict[str, dict]:
    """Simulate strategy against all prop firms.

    Uses per-firm net P&L delta-adjusted from backtester commission when symbol
    and trade count data are available in stats. Also uses gap-adjusted
    drawdown when available for overnight strategies.

    Args:
        daily_pnls: Net daily P&L values (already net of backtester commission).
        stats: Strategy statistics including max_drawdown, trades_overnight,
            symbol, total_trades, total_trading_days, gap_adjusted_drawdown.
        backtester_commission_per_side: The per-side commission the backtester
            already deducted (default $0.62 = MES/micro baseline). Used to
            compute only the DELTA when adjusting for per-firm rates (H4 fix).

    Returns:
        dict mapping firm_key → compliance result
    """
    symbol = stats.get("symbol", "MES")
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

        # Compute firm-adjusted daily PnLs (delta-adjusted from backtester commission).
        # H4 FIX: pass backtester_commission_per_side so only the delta is applied.
        net_pnls = _compute_net_daily_pnls(
            daily_pnls, firm_key, symbol, avg_trades_per_day,
            backtester_commission_per_side=backtester_commission_per_side,
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

        # Check consistency rules (using net PnLs).
        # Active rules: MFFU 50%. Topstep has no consistency rule.
        if firm["consistency_rule"] == "mffu_50pct":
            cons_passed, worst_pct = check_tpt_consistency(net_pnls)
            if not cons_passed:
                passed = False
                failures.append(
                    f"MFFU 50% consistency violation: "
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
        if firm["consistency_rule"] == "mffu_50pct" and stats.get("consistency_ratio", 0) > 0.50:
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
