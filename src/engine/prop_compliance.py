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
from typing import Any, Mapping, Optional

from src.engine.firm_config import FIRM_COMMISSIONS
from src.engine.firm_stage_rules import (
    evaluate_payout_eligibility,
    evaluate_topstep_combine_until_pass,
    get_firm_rules,
    get_stage_rules,
)


# ─── Firm Configurations ──────────────────────────────────────────
# All values project from src/shared/firm-stage-rules.json.

_TOPSTEP = get_firm_rules("topstep_50k")
_TOPSTEP_EVALUATION = get_stage_rules("topstep_50k", "evaluation")
_TOPSTEP_PAYOUT = get_stage_rules("topstep_50k", "payout")
_MFFU = get_firm_rules("mffu_50k")
_MFFU_EVALUATION = get_stage_rules("mffu_50k", "evaluation")
_MFFU_PAYOUT = get_stage_rules("mffu_50k", "payout")

FIRM_CONFIGS = {
    "topstep_50k": {
        "name": _TOPSTEP["name"],
        "monthly_fee": _TOPSTEP_EVALUATION["monthly_fee"],
        "activation_fee": _TOPSTEP_EVALUATION["activation_fee"],
        "profit_target": _TOPSTEP_EVALUATION["profit_target"],
        "max_drawdown": _TOPSTEP_EVALUATION["max_drawdown"],
        "trailing": _TOPSTEP_EVALUATION["trailing"],
        "locks_at_start": _TOPSTEP_EVALUATION["locks_at_start"],
        "trailing_lock_floor_offset": _TOPSTEP_EVALUATION["trailing_lock_floor_offset"],
        "consistency_rule": "topstep_dynamic_target_50pct",
        "overnight_ok": _TOPSTEP_EVALUATION["overnight_ok"],
        "payout_split": _TOPSTEP_PAYOUT["payout_split"],
        "payout_split_tiers": None,
        "ongoing_fee": 0,
        "daily_loss_limit": _TOPSTEP_EVALUATION["daily_loss_limit"],
        "min_payout_days": _TOPSTEP_PAYOUT["paths"]["standard"]["minimum_winning_days"],
        "min_trading_days": _TOPSTEP_EVALUATION["min_trading_days"],
    },
    "mffu_50k": {
        "name": _MFFU["name"],
        "monthly_fee": _MFFU_EVALUATION["monthly_fee"],
        "activation_fee": _MFFU_EVALUATION["activation_fee"],
        "profit_target": _MFFU_EVALUATION["profit_target"],
        "max_drawdown": _MFFU_EVALUATION["max_drawdown"],
        "trailing": _MFFU_EVALUATION["trailing"],
        "locks_at_start": _MFFU_EVALUATION["locks_at_start"],
        "trailing_lock_floor_offset": _MFFU_EVALUATION["trailing_lock_floor_offset"],
        "consistency_rule": "mffu_50pct_sim_payout",
        "overnight_ok": _MFFU_EVALUATION["overnight_ok"],
        "payout_split": _MFFU_PAYOUT["payout_split"],
        "payout_split_tiers": None,
        "ongoing_fee": 0,
        "daily_loss_limit": _MFFU_EVALUATION["daily_loss_limit"],
        "daily_loss_behavior": _MFFU_EVALUATION["daily_loss_behavior"],
        "min_payout_days": _MFFU_PAYOUT["minimum_qualifying_days"],
        "min_trading_days": _MFFU_EVALUATION["min_trading_days"],
    },
    # Legacy firms (TPT, Apex, Tradeify, Alpha, FFN, Earn2Trade) removed
    # 2026-05-19 per CLAUDE.md §6 production scope (Topstep + MFFU only).
}


# ─── Drawdown Simulators ──────────────────────────────────────────

def simulate_trailing_drawdown_eod(
    daily_closing_balances: list[float],
    max_dd: float,
    locks_at_start: bool = True,
    trailing_lock_floor_offset: float | None = None,
) -> tuple[bool, Optional[int], float]:
    """Simulate EOD trailing drawdown.

    Args:
        daily_closing_balances: End-of-day account balances
        max_dd: Maximum allowed drawdown
        locks_at_start: Compatibility fallback: floor stops at the start.
        trailing_lock_floor_offset: Canonical lock offset from the stage
            starting balance. Builder is $100; Topstep is $0.

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

        if trailing_lock_floor_offset is not None:
            floor = min(floor, starting + trailing_lock_floor_offset)
        elif locks_at_start:
            floor = min(floor, starting)

        dd_used = hwm - balance
        max_dd_used = max(max_dd_used, dd_used)

        if balance <= floor:
            return (False, day, dd_used)

    return (True, None, max_dd_used)


def simulate_trailing_drawdown_realtime(
    equity_path: list[float],
    max_dd: float,
    locks_at_start: bool = True,
    trailing_lock_floor_offset: float | None = None,
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

        if trailing_lock_floor_offset is not None:
            floor = min(floor, starting + trailing_lock_floor_offset)
        elif locks_at_start:
            floor = min(floor, starting)

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
    enforce_mffu_consistency: bool = False,
    payout_contexts: Mapping[str, Mapping[str, Any]] | None = None,
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
        enforce_mffu_consistency: Legacy opt-in name for returning MFFU
            sim-funded payout eligibility. It never changes the account's
            ``passed`` verdict. ``payout_contexts`` must provide a separate
            post-evaluation window, trade-day evidence, and account state.
            Topstep Combine is always evaluated against its separate two-day
            dynamic-profit-target rule.
        payout_contexts: Optional post-evaluation contexts keyed by firm. Each
            value contains ``daily_pnls``, ``traded_days``, and
            ``account_state``. Omitting it reports a recoverable, fail-closed
            context requirement rather than reusing evaluation P&L.

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
        payout_eligibility: dict | None = None

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
                net_equity,
                firm["max_drawdown"],
                firm.get("locks_at_start", True),
                firm.get("trailing_lock_floor_offset"),
            )
        else:
            dd_passed, blown_day, dd_used = simulate_trailing_drawdown_eod(
                net_equity,
                firm["max_drawdown"],
                firm.get("locks_at_start", True),
                firm.get("trailing_lock_floor_offset"),
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

        if firm_key == "topstep_50k":
            combine = evaluate_topstep_combine_until_pass(net_pnls)
            if not combine["passed"]:
                passed = False
                failures.append(
                    "Topstep Combine not yet eligible (recoverable): "
                    f"${combine['total_profit']:.0f} of ${combine['effective_profit_target']:.0f} "
                    f"after {combine['trading_days']} trading days"
                )
        elif firm_key == "mffu_50k" and enforce_mffu_consistency:
            payout_context = (payout_contexts or {}).get(firm_key)
            if payout_context is None:
                payout_eligibility = {
                    "eligible": False,
                    "reason": "separate_funded_payout_window_and_account_state_required",
                    "recoverable": True,
                }
            else:
                payout_eligibility = evaluate_payout_eligibility(
                    firm_key,
                    list(payout_context.get("daily_pnls", [])),
                    traded_days=payout_context.get("traded_days"),
                    account_state=payout_context.get("account_state"),
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
            "payout_eligibility": payout_eligibility,
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
        # Topstep's 50% Combine condition raises a recoverable effective target;
        # MFFU's 50% condition belongs only to sim-funded payout eligibility.
        # Neither is an evaluation-ranking disqualifier.

        avg_daily = stats["avg_daily_pnl"]
        days_to_target = max(
            firm["profit_target"] / avg_daily if avg_daily > 0 else 999,
            firm["min_trading_days"],
        )
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
