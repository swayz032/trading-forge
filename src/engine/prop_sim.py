"""Prop firm account simulation — day-by-day evaluation pass.

After vectorbt computes the equity curve and trades, this module
walks through each trading day as if executing on a real prop firm
account, enforcing:
  - Daily loss limits (Topstep $1K, Alpha $1K)
  - Trailing drawdown (EOD vs realtime/intraday)
  - Stage-specific evaluation rules and payout projections

Uses configs from prop_compliance.py and firm_config.py.
"""

from __future__ import annotations

from typing import Optional

from src.engine.config import CONTRACT_SPECS
from src.engine.firm_config import FIRM_COMMISSIONS
from src.engine.firm_stage_rules import (
    evaluate_payout_eligibility,
    evaluate_topstep_combine,
    get_stage_rules,
    trailing_drawdown_floor,
)
from src.engine.prop_compliance import FIRM_CONFIGS

def _get_all_firm_configs() -> dict[str, dict]:
    """Get active firm projections from the canonical stage rule book."""
    return dict(FIRM_CONFIGS)


def simulate_prop_firm(
    daily_pnl_records: list[dict],
    trades: list[dict],
    firm_key: str,
    symbol: str = "MES",
    account_size: float = 50000,
    overnight_hold: bool = False,
    avg_contracts: float = 1.0,
    mc_eval_pass_rate: Optional[float] = None,
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
    evaluation_rules = get_stage_rules(firm_key, "evaluation")
    funded_rules = get_stage_rules(firm_key, "funded")

    balance = account_size
    peak_equity = account_size
    starting_balance = account_size
    active_starting_balance = starting_balance
    funded_starting_balance = float(funded_rules.get("starting_balance", 0.0))
    funded_transition_pending = False
    profit_target = float(evaluation_rules["profit_target"])

    daily_statements: list[dict] = []
    evaluation_pnls: list[float] = []
    funded_pnls: list[float] = []
    funded_pnl_records: list[tuple[str, float]] = []
    daily_loss_breaches: list[str] = []
    gap_breaches: list[str] = []  # Task 7.11: Days where overnight gap exceeded daily loss limit
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

    # Track DLL cap simulation artifact: difference between true strategy P&L
    # and DLL-capped P&L. Each time the firm's DLL would have halted trading,
    # we cap that day's loss at the DLL — but the strategy's trade list is NOT
    # re-filtered (per-firm-resize is a Wave 24 carry-forward). So the capped
    # ending_balance reflects "if the firm halted you and you stopped trading
    # the rest of the day, but the strategy still took all subsequent days'
    # trades unchanged." Operator needs visibility into this artifact, hence
    # ending_balance_uncapped + dll_capped_losses_total below.
    uncapped_balance = account_size  # Mirror balance computation w/o DLL cap
    dll_capped_losses_total = 0.0    # Sum of (true_loss - capped_loss) per breach day

    for day_idx, record in enumerate(daily_pnl_records):
        if funded_transition_pending:
            balance = funded_starting_balance
            peak_equity = funded_starting_balance
            active_starting_balance = funded_starting_balance
            uncapped_balance = funded_starting_balance
            dll_capped_losses_total = 0.0
            funded_transition_pending = False

        current_stage = "funded" if eval_passed else "evaluation"
        active_rules = funded_rules if eval_passed else evaluation_rules
        active_daily_loss_limit = active_rules.get("daily_loss_limit")
        is_realtime = active_rules["trailing"] == "realtime"
        date_str = record.get("date", f"day_{day_idx}")
        # P&L from backtester is already net of commission — do NOT deduct again.
        net_pnl = record["pnl"]
        true_net_pnl = net_pnl  # Capture pre-cap value for uncapped tracking

        # Commission cost kept for display-only in daily statements
        day_trades = trades_per_day.get(date_str, 0)
        comm_cost = comm_per_side * 2 * day_trades  # round-trip (display only)

        # Overnight margin cost: if strategy holds overnight, check that
        # account can cover overnight margin requirements (much higher than
        # intraday). Overnight margin reduces available capital for drawdown.
        overnight_margin_warning = False
        if overnight_hold and date_str in overnight_days:
            spec = CONTRACT_SPECS.get(symbol)
            if spec and spec.overnight_margin > 0:
                required_margin = spec.overnight_margin * avg_contracts
                if required_margin > balance * 0.80:
                    # Account cannot safely cover overnight margin
                    overnight_margin_warning = True

        # Daily loss limit enforcement.
        #
        # PHASE21-PART3 FIX: do NOT cap net_pnl. The previous behavior capped
        # the day's loss at the firm DLL to simulate "the firm halted you" —
        # but daily_pnl_records comes from EOD equity diffs (_compute_daily_pnls
        # in backtester.py), which captures MARK-TO-MARKET swings on
        # overnight-held positions, not just realized trade P&L. So the cap
        # was firing on days with no trades at all (held-position drift) and
        # accumulating tens of thousands in fake "saved losses" — making
        # Topstep ending_balance LOOK profitable on losing strategies.
        #
        # Real Topstep monitors live tick-by-tick equity, not EOD MTM diffs.
        # Until per-firm-resize lands (Wave 24 carry-forward) and we have
        # tick-level equity, the honest behavior is: report TRUE strategy
        # P&L in ending_balance, and surface daily_loss_limit_breaches as
        # an INFORMATIONAL risk indicator (days where EOD MTM swung past
        # the firm DLL — real-firm halt likely on at least these days).
        day_halted = False
        gap_breached = False
        original_net_pnl = net_pnl  # Preserved for downstream realtime-DD heuristic
        if (
            active_daily_loss_limit is not None
            and net_pnl < -float(active_daily_loss_limit)
        ):
            # Record the breach for operator awareness — do NOT cap the P&L.
            daily_loss_breaches.append(date_str)
            day_halted = True
            if date_str in overnight_days:
                gap_breached = True
                gap_breaches.append(date_str)
            # NO net_pnl mutation — true loss flows through to balance.

        # Compute intraday low BEFORE updating balance (for realtime DD)
        # Use original_net_pnl (uncapped) for intraday low estimate — the actual
        # intraday low occurred BEFORE the firm halted trading at the daily limit.
        prev_balance = balance
        if is_realtime:
            # Realtime trailing DD checks equity at EVERY tick, not just EOD.
            # With only daily data, we must estimate the intraday low.
            #
            # Conservative heuristic: intraday low is worse than the closing PnL
            # by a factor proportional to daily range. For losing days, the worst
            # point was likely 20-40% worse than the close (market recovered some).
            # For winning days, the worst point was likely a dip before recovery.
            #
            # Factor: on losing days, assume intraday low was 1.3x the closing loss.
            # On winning days, assume a brief dip of 30% of the day's gain.
            if original_net_pnl < 0:
                # Losing day: intraday low was worse than close
                # Use uncapped loss — actual intraday low occurred before halt
                intraday_low = prev_balance + original_net_pnl * 1.3
            else:
                # Winning day: assume a brief dip before recovery
                intraday_low = prev_balance - abs(original_net_pnl) * 0.3
        else:
            intraday_low = prev_balance + net_pnl  # EOD: use closing balance

        # A passed Combine day remains in the evaluation window. Only later
        # days form the separate funded payout window.
        if not eval_passed:
            evaluation_pnls.append(net_pnl)
        else:
            funded_pnls.append(net_pnl)
            funded_pnl_records.append((str(date_str), net_pnl))

        # Update balance (DLL-capped — represents firm-halt simulation)
        balance += net_pnl

        # Update uncapped balance + accumulate DLL-cap artifact for transparency.
        # When net_pnl was capped (DLL intraday breach branch above), the
        # difference between true loss and capped loss is the "free win"
        # Topstep simulation gives the strategy. We surface this so the
        # operator isn't misled by ending_balance > starting_balance on
        # losing strategies. See per-firm-resize TODO for the real fix.
        uncapped_balance += true_net_pnl
        if true_net_pnl != net_pnl:
            dll_capped_losses_total += (net_pnl - true_net_pnl)  # positive number

        # Task 3.4: Intraday max DD tracking (approximation from daily resolution)
        # NOTE: For full accuracy, bar-level equity would be needed (future enhancement).
        intraday_max_dd_approx = round(peak_equity - intraday_low, 2)

        # Update high water mark (EOD: at end of day)
        peak_equity = max(peak_equity, balance)

        # Compute drawdown from peak
        dd_from_peak = peak_equity - balance

        # The canonical stage rule owns its lock threshold: Topstep locks at
        # the stage start (offset $0), Builder at $100 above it.
        floor = trailing_drawdown_floor(
            active_rules, peak_equity, active_starting_balance
        )

        # For realtime DD, check intraday low against floor (not just EOD balance).
        # This is what makes realtime trailing stricter than EOD trailing:
        # same trades can breach realtime but survive EOD.
        check_value = intraday_low if is_realtime else balance
        if check_value <= floor and not trailing_dd_breached:
            trailing_dd_breached = True
            breach_day = date_str

        if not eval_passed:
            if firm_key == "topstep_50k":
                combine = evaluate_topstep_combine(evaluation_pnls)
                if combine["passed"] and not trailing_dd_breached:
                    eval_passed = True
                    days_to_pass_eval = day_idx + 1
                    funded_transition_pending = True
            else:
                min_days = int(evaluation_rules.get("min_trading_days", 1))
                if (
                    (balance - starting_balance) >= profit_target
                    and (day_idx + 1) >= min_days
                    and not trailing_dd_breached
                ):
                    eval_passed = True
                    days_to_pass_eval = day_idx + 1
                    funded_transition_pending = True

        # H3 FIX: gross_pnl was reconstructing "net + display_commission" where
        # net_pnl already has the backtester's commission deducted, and display_comm
        # uses the prop firm's commission rate — a different number.  The result
        # was neither true gross nor true net, just a misleading in-between.
        # Fix: emit true net_pnl only. Omit gross_pnl from the daily statement
        # so callers don't rely on a number that's neither gross nor net.
        # The "commission" field remains for display-only context.
        daily_statements.append({
            "date": date_str,
            "stage": current_stage,
            "commission": round(comm_cost, 2),
            "net_pnl": round(net_pnl, 2),
            "balance": round(balance, 2),
            "drawdown_from_peak": round(dd_from_peak, 2),
            "peak_equity": round(peak_equity, 2),
            "trades": day_trades,
            "halted": day_halted,
            "gap_breached": gap_breached,
            "intraday_max_dd_approx": intraday_max_dd_approx,
            "overnight_gap_risk": date_str in overnight_days,
            "overnight_margin_warning": overnight_margin_warning,
        })

    topstep_evaluation = (
        evaluate_topstep_combine(evaluation_pnls)
        if firm_key == "topstep_50k"
        else None
    )

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

    # Payout requirements are evaluated only after the account passes its
    # evaluation window. They are recoverable and must not affect the account
    # verdict, drawdown breach, or evaluation pass state.
    payout_eligibility = {
        "eligible": None,
        "reason": "separate_funded_payout_window_required",
        "recoverable": True,
    }
    if eval_passed and not trailing_dd_breached and funded_pnls:
        payout_kwargs = (
            {
                "payout_path": str(
                    get_stage_rules(firm_key, "payout")["default_path"]
                )
            }
            if firm_key == "topstep_50k"
            else {}
        )
        payout_eligibility = evaluate_payout_eligibility(
            firm_key,
            funded_pnls,
            traded_days=[
                trades_per_day.get(date, 0) > 0
                for date, _pnl in funded_pnl_records
            ],
            account_state={
                "account_balance": balance,
                "balance_after_last_payout": None,
                "approved_payout_count": 0,
                "account_stage": "funded",
                "cycle_elapsed_hours": len(funded_pnls) * 24.0,
            },
            **payout_kwargs,
        )

    # Deprecated compatibility fields: payout consistency is exposed in
    # funded_phase_result.payout_eligibility, never as an account failure.
    consistency_passed = True
    consistency_failure = None

    # Max drawdown in dollars (EOD and intraday tracked separately)
    max_dd_dollars = max((s["drawdown_from_peak"] for s in daily_statements), default=0)
    max_dd_eod = max_dd_dollars  # EOD drawdown = peak - EOD balance
    max_dd_intraday = max((s["intraday_max_dd_approx"] for s in daily_statements), default=0)

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

    # Best day as pct of total profit
    best_day_pct_of_total = round(consistency_ratio * 100, 2)

    # Long/short split from trades
    long_trades = [t for t in trades if str(t.get("Direction", t.get("direction", ""))).lower().startswith("long")]
    short_trades = [t for t in trades if str(t.get("Direction", t.get("direction", ""))).lower().startswith("short")]
    long_pnl = sum(float(t.get("PnL", t.get("pnl", 0))) for t in long_trades)
    short_pnl = sum(float(t.get("PnL", t.get("pnl", 0))) for t in short_trades)
    long_short_split = {
        "long": {"trades": len(long_trades), "pnl": round(long_pnl, 2)},
        "short": {"trades": len(short_trades), "pnl": round(short_pnl, 2)},
    }

    # Payouts are funded-stage economics only. Evaluation P&L earns passage,
    # never a payout; ineligible funded windows remain recoverable but show no
    # withdrawable projection.
    payout_request_amount = payout_eligibility.get("permitted_request_max")
    funded_month_keys = {
        (date[:7] if len(date) >= 7 else date)
        for date, _pnl in funded_pnl_records
    }
    if (
        isinstance(payout_request_amount, (int, float))
        and payout_eligibility.get("eligible") is True
    ):
        # Alpha uses payout-count tiers (1st payout=70%, 2nd=80%, 3rd+=90%)
        # Other firms use dollar-threshold tiers (e.g. TPT: <$5K=80%, >$5K=90%)
        count_tiers = firm.get("payout_count_tiers")
        dollar_tiers = firm.get("payout_split_tiers")

        if count_tiers:
            # Payout-count based: split depends on which payout number this is.
            # In simulation we model the FIRST payout — use payout_number=1.
            first_tier = next((t for t in count_tiers if t["payout_number"] == 1), None)
            split = first_tier["split"] if first_tier else firm["payout_split"]
            payout_amount = float(payout_request_amount) * split
        elif dollar_tiers:
            # Dollar-threshold tiers: progressive split rates by profit amount.
            # Base split applies below first threshold, then each tier's split
            # applies to profit above that tier's threshold.
            sorted_tiers = sorted(dollar_tiers, key=lambda t: t["threshold"])
            payout_amount = 0.0
            prev_threshold = 0.0
            base_split = firm["payout_split"]
            current_split = base_split
            for tier in sorted_tiers:
                tier_threshold = tier["threshold"]
                if float(payout_request_amount) < prev_threshold:
                    break
                taxable = min(float(payout_request_amount), tier_threshold) - prev_threshold
                if taxable > 0:
                    payout_amount += taxable * current_split
                current_split = tier["split"]
                prev_threshold = tier_threshold
            # Remaining profit above the last tier threshold
            if float(payout_request_amount) > prev_threshold:
                payout_amount += (float(payout_request_amount) - prev_threshold) * current_split
        else:
            payout_amount = float(payout_request_amount) * firm["payout_split"]

        monthly_fee = firm.get("ongoing_fee", 0)
        payout_projection = round(payout_amount - monthly_fee, 2)
    else:
        payout_projection = 0

    # Overnight gap risk days count (must compute before violation check)
    overnight_risk_days = sum(1 for s in daily_statements if s.get("overnight_gap_risk", False))

    # Overnight hold violation check
    overnight_violation = False
    if not firm.get("overnight_ok", False) and overnight_risk_days > 0:
        overnight_violation = True

    # Overall verdict
    passed = (
        eval_passed
        and not trailing_dd_breached
        and not overnight_violation
    )

    # ─── Eval cost amortization ──────────────────────────────
    # Use MC-derived pass probability when available, else conservative 30%.
    mc_pass_probability = mc_eval_pass_rate if mc_eval_pass_rate is not None else 0.30

    # Eval cost = months of eval fees + activation fee for a single attempt
    months_in_eval = max(1, (days_to_pass_eval or 60) // 20)
    single_eval_cost = (
        firm.get("monthly_fee", 0) * months_in_eval
        + firm.get("activation_fee", 0)
    )

    # Expected eval cost accounting for failed attempts:
    # eval_fee / mc_pass_probability = expected total spend before passing
    expected_eval_cost = round(
        single_eval_cost / max(0.01, mc_pass_probability), 2
    )

    # This is one current payout request, not a payout history or schedule.
    # Do not turn it into fictional monthly or annual economics.
    true_net_annual_payout = None
    true_net_monthly_payout = None

    # ─── Eval/funded phase separation ──────────────────────
    eval_cost = single_eval_cost

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
        "funded_starting_balance": funded_starting_balance,
        # ending_balance reflects the DLL-cap SIMULATION (firm halts on DLL day).
        # ending_balance_uncapped is what the strategy would actually have produced
        # without per-firm halting — matches the raw backtest total_return.
        # dll_capped_losses_total = sum of (capped_loss - true_loss) per breach day.
        # When > 0, ending_balance is artificially HIGHER than the strategy's real
        # P&L. Operators MUST read ending_balance_uncapped for real-economics view.
        # Wave 24 carry-forward (per-firm-resize) will fix this by removing the
        # post-halt trades entirely instead of just capping the day's loss.
        "ending_balance": round(balance, 2),
        "ending_balance_uncapped": round(uncapped_balance, 2),
        "dll_capped_losses_total": round(dll_capped_losses_total, 2),
        "peak_equity": round(peak_equity, 2),
        "max_drawdown_dollars": round(max_dd_dollars, 2),
        "max_drawdown_eod": round(max_dd_eod, 2),
        "max_drawdown_intraday": round(max_dd_intraday, 2),
        "max_drawdown_limit": firm["max_drawdown"],
        "daily_loss_limit_breaches": daily_loss_breaches,
        "gap_breaches": gap_breaches,
        "trailing_dd_breached": trailing_dd_breached,
        "breach_day": breach_day,
        "consistency_ratio": round(consistency_ratio, 4),
        "best_day_pct_of_total": best_day_pct_of_total,
        "consistency_passed": consistency_passed,
        "consistency_failure": consistency_failure,
        "days_to_pass_eval": days_to_pass_eval,
        "eval_passed": eval_passed,
        "passed": passed,
        "payout_split": firm["payout_split"],
        "payout_projection": payout_projection,
        "payout_projection_monthly": None,
        "payout_projection_basis": "single_current_permitted_request",
        "daily_account_statement": daily_statements,
        "monthly_summary": monthly_summary,
        "worst_month": worst_month,
        "recovery_days_from_max_dd": recovery_days,
        "single_eval_cost": single_eval_cost,
        "expected_eval_cost": expected_eval_cost,
        "mc_pass_probability": mc_pass_probability,
        "true_net_annual_payout": true_net_annual_payout,
        "true_net_monthly_payout": true_net_monthly_payout,
        "overnight_risk_days": overnight_risk_days,
        "overnight_violation": overnight_violation,
        "strategy_type": "SWING" if overnight_hold else "DAY_ONLY",
        "overnight_margin_warnings": sum(
            1 for s in daily_statements if s.get("overnight_margin_warning", False)
        ),
        "long_short_split": long_short_split,
        "eval_phase_result": {
            "profit_target": profit_target,
            "effective_profit_target": (
                topstep_evaluation["effective_profit_target"]
                if topstep_evaluation is not None
                else profit_target
            ),
            "best_day_profit": (
                topstep_evaluation["best_day_profit"]
                if topstep_evaluation is not None
                else best_single_day
            ),
            "days_to_target": days_to_pass_eval,
            "passed": eval_passed,
            "reason": (
                topstep_evaluation["reason"]
                if topstep_evaluation is not None
                else ("eligible" if eval_passed else "profit_target_not_met")
            ),
            "cost_of_eval": eval_cost,
        },
        "funded_phase_result": {
            "monthly_net_pnl": [
                round(
                    sum(
                        pnl
                        for date, pnl in funded_pnl_records
                        if (date[:7] if len(date) >= 7 else date) == month_key
                    ),
                    2,
                )
                for month_key in sorted(funded_month_keys)
            ],
            "survival_months": survival_months,
            "payout_projection": payout_projection,
            "payout_projection_basis": "single_current_permitted_request",
            "payout_eligibility": payout_eligibility,
            "payout_cycle_time_evidence": "synthetic_daily_bar_assumption",
        },
    }


def simulate_all_firms(
    daily_pnl_records: list[dict],
    trades: list[dict],
    symbol: str = "MES",
    account_size: float = 50000,
    overnight_hold: bool = False,
    avg_contracts: float = 1.0,
    mc_pass_rates: Optional[dict[str, float]] = None,
) -> dict[str, dict]:
    """Run prop firm simulation against all active firms (Topstep + MFFU).

    Returns dict mapping firm_key → simulation result.

    TODO (Wave 24 — carry-forward): per-firm-resize not implemented.
    Both Topstep and MFFU receive the SAME trade list at the SAME contract
    sizes. Correct behavior would re-size positions per firm's contract caps
    (Topstep tier-based, MFFU 2%-of-account per trade) before simulation.
    Currently only pass/fail flags differ between firms; P&L metrics are
    identical. See prop_compliance.py docstring for full context.
    Tracking: TODO:per-firm-resize
    """
    all_configs = _get_all_firm_configs()
    results = {}
    for firm_key in all_configs:
        rate = mc_pass_rates.get(firm_key) if mc_pass_rates else None
        results[firm_key] = simulate_prop_firm(
            daily_pnl_records, trades, firm_key, symbol, account_size,
            overnight_hold=overnight_hold, avg_contracts=avg_contracts,
            mc_eval_pass_rate=rate,
        )
    return results
