"""Prop firm account simulation — day-by-day evaluation pass.

After vectorbt computes the equity curve and trades, this module
walks through each trading day as if executing on a real prop firm
account, enforcing:
  - Daily loss limits (Topstep $1K, Alpha $1K)
  - Trailing drawdown (EOD vs realtime/intraday)
  - Consistency rules (TPT 50%, FFN 40%)
  - Profit targets and payout projections

Uses configs from prop_compliance.py and firm_config.py.
"""

from __future__ import annotations

from typing import Optional

from src.engine.config import CONTRACT_SPECS
from src.engine.firm_config import FIRM_COMMISSIONS, FIRM_RULES
from src.engine.prop_compliance import FIRM_CONFIGS

DAILY_LOSS_LIMITS: dict[str, Optional[float]] = {
    key: rules.get("daily_loss_limit") for key, rules in FIRM_RULES.items()
}


def _get_all_firm_configs() -> dict[str, dict]:
    """Get all firm configs. All 8 firms are in FIRM_CONFIGS."""
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
        if daily_loss_limit is not None and net_pnl < -daily_loss_limit:
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

        # Trailing drawdown floor
        dd_limit = firm["max_drawdown"]
        if firm.get("locks_at_start", False):
            # MED#8 (fresh-scan 2026-07-12): Topstep EOD trailing DD trails the peak by max_dd but the
            # floor LOCKS at the STARTING BALANCE once the account is up by max_dd (peak-max_dd reaches
            # starting_balance) — it does NOT keep trailing above starting_balance. So floor =
            # min(peak-max_dd, starting_balance). The old `max(peak-dd, starting-dd)` never locked at
            # starting balance (it kept trailing to peak-dd), producing FALSE breach verdicts on any
            # profitable-then-pullback account (peak 54k → pullback to 52k, still +2k healthy, real
            # floor 50k → survives, but old code floored at 52k → false breach). This is the CMP-1 twin.
            floor = min(peak_equity - dd_limit, starting_balance)
        else:
            floor = peak_equity - dd_limit

        # For realtime DD, check intraday low against floor (not just EOD balance).
        # This is what makes realtime trailing stricter than EOD trailing:
        # same trades can breach realtime but survive EOD.
        check_value = intraday_low if is_realtime else balance
        if check_value <= floor and not trailing_dd_breached:
            trailing_dd_breached = True
            breach_day = date_str

        # Check if eval passed (hit profit target + min trading days)
        min_days = firm.get("min_trading_days", 1)
        if not eval_passed and (balance - starting_balance) >= profit_target and (day_idx + 1) >= min_days:
            eval_passed = True
            days_to_pass_eval = day_idx + 1

        # H3 FIX: gross_pnl was reconstructing "net + display_commission" where
        # net_pnl already has the backtester's commission deducted, and display_comm
        # uses the prop firm's commission rate — a different number.  The result
        # was neither true gross nor true net, just a misleading in-between.
        # Fix: emit true net_pnl only. Omit gross_pnl from the daily statement
        # so callers don't rely on a number that's neither gross nor net.
        # The "commission" field remains for display-only context.
        daily_statements.append({
            "date": date_str,
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

    # Consistency check. deepscan5 2026-06-29: recognize the FULL canonical rule-name vocabulary
    # (must mirror monte_carlo.simulate_firm_survival `_consistency_map` keys) so real configured
    # rules don't trip the "unknown rule" warning on every backtest. firm_config currently uses
    # `topstep_50pct` (Combine pass-request) + `mffu_50pct_sim_payout` (Builder sim-payout stage) —
    # both were previously unrecognized here, spamming the warning. A genuinely typo'd rule (not in
    # this set) still warns. NOTE: this legacy daily-statement sim does NOT enforce these rules —
    # B14 `simulate_firm_survival` is the authoritative consistency model (Topstep standard-lane and
    # MFFU sim-payout are both intentionally skipped there). Enforcement below stays narrow.
    _KNOWN_CONSISTENCY_RULES = {
        "topstep_50pct", "tpt_50pct", "alpha_50pct", "mffu_50pct", "mffu_50pct_sim_payout",
        "ffn_40pct", "tradeify_40pct", "earn2trade_consistency",
    }
    rule = firm.get("consistency_rule")
    if rule and rule not in _KNOWN_CONSISTENCY_RULES:
        import warnings
        warnings.warn(f"Unknown consistency rule '{rule}' — check for typos")

    consistency_passed = True
    consistency_failure = None
    if firm.get("consistency_rule") == "mffu_50pct" and consistency_ratio > 0.50:
        consistency_passed = False
        consistency_failure = f"Best day = {consistency_ratio:.0%} of total profit (MFFU limit: 50%)"

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

    # Payout projection
    total_net_profit = balance - starting_balance
    if total_net_profit > 0 and eval_passed:
        # Alpha uses payout-count tiers (1st payout=70%, 2nd=80%, 3rd+=90%)
        # Other firms use dollar-threshold tiers (e.g. TPT: <$5K=80%, >$5K=90%)
        count_tiers = firm.get("payout_count_tiers")
        dollar_tiers = firm.get("payout_split_tiers")

        if count_tiers:
            # Payout-count based: split depends on which payout number this is.
            # In simulation we model the FIRST payout — use payout_number=1.
            first_tier = next((t for t in count_tiers if t["payout_number"] == 1), None)
            split = first_tier["split"] if first_tier else firm["payout_split"]
            payout_amount = total_net_profit * split
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
                if total_net_profit < prev_threshold:
                    break
                taxable = min(total_net_profit, tier_threshold) - prev_threshold
                if taxable > 0:
                    payout_amount += taxable * current_split
                current_split = tier["split"]
                prev_threshold = tier_threshold
            # Remaining profit above the last tier threshold
            if total_net_profit > prev_threshold:
                payout_amount += (total_net_profit - prev_threshold) * current_split
        else:
            payout_amount = total_net_profit * firm["payout_split"]

        monthly_fee = firm.get("ongoing_fee", 0)
        total_months = len(monthly_summary) or 1
        monthly_gross = payout_amount / total_months
        payout_projection = round(monthly_gross - monthly_fee, 2)
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
        and consistency_passed
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

    # Annual net payout after all deductions
    # NOTE: payout_projection already has ongoing_fee subtracted (line 370),
    # so do NOT subtract annual_ongoing_fees again here.
    annual_gross_payout = payout_projection * 12 if payout_projection > 0 else 0
    # Amortize expected eval cost over first year
    true_net_annual_payout = round(
        annual_gross_payout - expected_eval_cost, 2
    ) if annual_gross_payout > 0 else 0
    true_net_monthly_payout = round(
        true_net_annual_payout / 12, 2
    ) if true_net_annual_payout > 0 else 0

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
        "payout_projection_monthly": payout_projection,
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
