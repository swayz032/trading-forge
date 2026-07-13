"""Per-firm commission and contract cap data — Topstep + MFFU only.

Per CLAUDE.md §6: Only Topstep (PRIMARY) and MFFU (secondary) are in scope.
Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade, Top One, YRM Prop,
FundingPips) were removed from production scope on 2026-05-10 (DB migration
0097) and stripped from runtime config on 2026-05-19.

Don't use gross P&L for performance gates — use net P&L per firm.
Don't ignore firm contract caps in backtests.

VALUES ARE ALL-IN PER-SIDE (commission + exchange + NFA regulatory) = round-turn ÷ 2.
The backtester applies `commission_per_side × size × 2` with NO separate exchange/NFA add —
so these MUST be the full all-in per-side cost, not the commission component alone.
"""

from __future__ import annotations

from src.engine.firm_stage_rules import FIRM_STAGE_RULES, get_stage_rules

# ─── Per-Firm Commissions (ALL-IN per side, per contract) ───────────────
# Source: each firm's official 2026 fee schedule (all-in round-turn ÷ 2).

FIRM_COMMISSIONS: dict[str, dict[str, float]] = {
    # 2026-06-23 CORRECTION: Topstep rates were $0.37/side (too low — under-costed every
    # Topstep backtest). Replaced with the AUTHORITATIVE TopstepX/ProjectX fee schedule
    # (all-in round-turn ÷ 2). Micros (MES/MNQ/MCL) are active. Minis (ES/NQ/CL) are Phase 5
    # (≥$200K, CLAUDE.md §5) — note minis are ~3× micros, NOT 10× (commissions don't scale
    # with notional; the old 10×-micro assumption was wrong).
    # TopstepX round-turn (RT): MES/MNQ $1.24, MCL $1.54, ES/NQ $3.80, CL $4.04.
    "topstep_50k": {
        # Micros (RT ÷ 2)
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.77,
        # Minis (Phase 5) — ES/NQ $3.80 RT, CL $4.04 RT
        "ES": 1.90, "NQ": 1.90, "CL": 2.02,
    },
    "mffu_50k": {
        # 2026-06-23 CORRECTION: MFFU rates were a flat $0.62 (wrong — that's TopstepX's MES
        # value, not MFFU's). Replaced with MFFU's authoritative instrument list (all-in
        # round-turn ÷ 2): MES/MNQ $1.90 RT, MCL $1.16 RT, ES/NQ $4.68 RT, CL $4.92 RT.
        # Note MFFU MES/MNQ ($0.95) are PRICIER than TopstepX ($0.62) but MCL ($0.58) is cheaper.
        # Micros (RT ÷ 2)
        "MES": 0.95, "MNQ": 0.95, "MCL": 0.58,
        # Minis (Phase 5) — ES/NQ $4.68 RT, CL $4.92 RT
        "ES": 2.34, "NQ": 2.34, "CL": 2.46,
    },
}


# ─── Per-Firm Contract Caps (max simultaneous MICRO contracts) ───
# 2026 actual published rules (verified 2026-05-19 against Topstep + MFFU
# help center pages, not stale internal docs):
#
#   Topstep $50K Combine + Funded: 50 micros
#   MFFU $50K Builder:             40 micros
#
# We run MICRO contracts (MES/MNQ/MCL) only — the mini equivalents
# (ES/NQ/CL) are deferred until single-account balance ≥ $200K per
# CLAUDE.md §5 Phase 5. So the per-symbol cap is the micro cap.

FIRM_CONTRACT_CAPS: dict[str, dict[str, int]] = {
    firm_key: {
        "MES": int(get_stage_rules(firm_key, "evaluation")["max_contracts"]),
        "MNQ": int(get_stage_rules(firm_key, "evaluation")["max_contracts"]),
        "MCL": int(get_stage_rules(firm_key, "evaluation")["max_contracts"]),
    }
    for firm_key in ("topstep_50k", "mffu_50k")
}

# Hard bounds: min 0, max 60 for legacy compatibility. ATR sizing is clamped
# further by the active per-firm stage cap.
CONTRACT_CAP_MIN = 0
CONTRACT_CAP_MAX = 60


# ─── Scaling Plans (account upgrades after profit milestones) ─────
# new_account_size values represent the upgraded account size AFTER hitting
# profit_threshold on the original 50K. All traders START at 50K.

SCALING_PLANS: dict[str, list[dict]] = {
    # max_contracts at each scaling tier = micro-contract cap (10:1 ratio).
    # Topstep tiers: 50K→100K@$5K profit, 100K→150K@$10K profit.
    # MFFU Builder tiers: 50K→100K@$5K, 100K→200K@$15K.
    "topstep_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 100},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 4500, "max_contracts": 150},
    ],
    "mffu_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 100},
        {"profit_threshold": 15000, "new_account_size": 200000, "new_max_dd": 5000, "max_contracts": 200},
    ],
}


# ─── Initial Contract Caps (starting limits before scaling) ──────
INITIAL_CONTRACT_CAPS: dict[str, int] = {
    firm_key: int(get_stage_rules(firm_key, "evaluation")["max_contracts"])
    for firm_key in ("topstep_50k", "mffu_50k")
}


# ─── Legacy Firm Rule Projection ─────────────────────────────────
# Values are projected from src/shared/firm-stage-rules.json for consumers that
# have not yet migrated to explicit evaluation/funded/payout/live stage access.

_TOPSTEP_EVALUATION = get_stage_rules("topstep_50k", "evaluation")
_TOPSTEP_PAYOUT = get_stage_rules("topstep_50k", "payout")
_TOPSTEP_EXECUTION = get_stage_rules("topstep_50k", "execution")
_MFFU_EVALUATION = get_stage_rules("mffu_50k", "evaluation")
_MFFU_PAYOUT = get_stage_rules("mffu_50k", "payout")

FIRM_RULES: dict[str, dict] = {
    "topstep_50k": {
        "account_size": _TOPSTEP_EVALUATION["account_size"],
        "monthly_fee": _TOPSTEP_EVALUATION["monthly_fee"],
        "activation_fee": _TOPSTEP_EVALUATION["activation_fee"],
        "ongoing_monthly_fee": _TOPSTEP_EVALUATION["ongoing_monthly_fee"],
        "profit_target": _TOPSTEP_EVALUATION["profit_target"],
        "max_drawdown": _TOPSTEP_EVALUATION["max_drawdown"],
        "max_contracts": _TOPSTEP_EVALUATION["max_contracts"],
        "trailing": _TOPSTEP_EVALUATION["trailing"],
        "payout_split": _TOPSTEP_PAYOUT["payout_split"],
        "min_payout_days": _TOPSTEP_PAYOUT["paths"]["standard"]["minimum_winning_days"],
        "min_trading_days": _TOPSTEP_EVALUATION["min_trading_days"],
        "consistency_rule": "topstep_dynamic_target_50pct",
        "daily_loss_limit": _TOPSTEP_EVALUATION["daily_loss_limit"],
        "overnight_ok": _TOPSTEP_EVALUATION["overnight_ok"],
        "weekend_ok": _TOPSTEP_EVALUATION["weekend_ok"],
        # 2026-compliance (canonical: docs/prop-firm-rules-2026-topstep.md)
        "platform_lockdown_date": _TOPSTEP_EXECUTION["platform_lockdown_date"],
        "required_platform": _TOPSTEP_EXECUTION["required_platform"],
        "allows_vps": _TOPSTEP_EXECUTION["allows_vps"],
        "allows_vpn": _TOPSTEP_EXECUTION["allows_vpn"],
        "allows_remote_desktop": _TOPSTEP_EXECUTION["allows_remote_desktop"],
        "multi_account_within_user_allowed": _TOPSTEP_EXECUTION["multi_account_within_user_allowed"],
        "copy_trades_within_user_allowed": _TOPSTEP_EXECUTION["copy_trades_within_user_allowed"],
        "stages": FIRM_STAGE_RULES["firms"]["topstep_50k"],
    },
    "mffu_50k": {
        "account_size": _MFFU_EVALUATION["account_size"],
        "monthly_fee": _MFFU_EVALUATION["monthly_fee"],
        "activation_fee": _MFFU_EVALUATION["activation_fee"],
        "ongoing_monthly_fee": _MFFU_EVALUATION["ongoing_monthly_fee"],
        "profit_target": _MFFU_EVALUATION["profit_target"],
        "max_drawdown": _MFFU_EVALUATION["max_drawdown"],
        # 2026-06-23: operator chose the MFFU BUILDER plan. Builder = EOD trailing + 40 micros
        # (room for our pyramid, unlike Pro's 5) — best fit for the micro bot.
        "max_contracts": _MFFU_EVALUATION["max_contracts"],
        # Builder Sim Funded = EOD trailing drawdown (Max EOD Drawdown / MLL $2,000; eval starting
        # floor $48,000) — matches Topstep basis + our realizedPeakEquity model (NO intraday build).
        # All Builder stages lock the MLL $100 above their starting balance;
        # the live account retains the same EOD trailing mechanics. NEWS TRADING ALLOWED.
        "trailing": _MFFU_EVALUATION["trailing"],
        "starting_floor": _MFFU_EVALUATION["starting_floor"],
        "payout_split": _MFFU_PAYOUT["payout_split"],
        "min_payout_days": _MFFU_PAYOUT["minimum_qualifying_days"],
        "payout_buffer": _MFFU_PAYOUT["payout_buffer"],
        "min_payout": _MFFU_PAYOUT["minimum_request"],
        "min_trading_days": _MFFU_EVALUATION["min_trading_days"],
        "consistency_rule": "mffu_50pct_sim_payout",  # 50% at the SIM-FUNDED payout stage only; NONE eval, NONE live
        "daily_loss_limit": _MFFU_EVALUATION["daily_loss_limit"],
        "daily_loss_behavior": _MFFU_EVALUATION["daily_loss_behavior"],
        "overnight_ok": _MFFU_EVALUATION["overnight_ok"],
        "weekend_ok": _MFFU_EVALUATION["weekend_ok"],
        # Builder: news trading ALLOWED (eval + sim funded) — news-policy MFFU should NOT hard-block.
        # 2026-compliance (canonical: docs/prop-firm-rules-2026-mffu.md)
        "payout_cycle_days": _MFFU_PAYOUT["payout_cycle_days"],
        # Compatibility field only. The authoritative MFFU consistency check is
        # evaluated in the separate sim-funded payout window, never as an eval
        # or account-survival breach.
        "consistency_window_days": None,
        "stages": FIRM_STAGE_RULES["firms"]["mffu_50k"],
    },
}


# ─── Payout Caps (XFA / per-request withdrawal limits) ──────────
#
# Topstep XFA payout caps (effective 2026-06-02 voluntary-DLL promo):
#   Standard Path:    base $2,000 / with-DLL $4,000
#   Consistency Path: base $3,000 / with-DLL $6,000
# Caps apply to the Express Funded Account (XFA) only.
# Live Funded Account (LFA) is uncapped — sentinel value: None.
# MFFU cap: $2,000 (no doubling — promo is Topstep-only).
#
# Conservative default: dll_opted_in=False → base cap (never assume doubled cap).

TOPSTEP_XFA_PAYOUT_CAPS: dict[str, dict[str, int]] = {
    path: {
        "base": int(rules["payout_cap"]["base"]),
        "with_dll": int(rules["payout_cap"]["with_dll"]),
    }
    for path, rules in _TOPSTEP_PAYOUT["paths"].items()
}

# LFA is uncapped; use None as the sentinel for "no cap enforced".
TOPSTEP_LFA_PAYOUT_CAP: None = get_stage_rules("topstep_50k", "live")["payout_cap"]

# MFFU: single flat cap, no promo.
MFFU_PAYOUT_CAP: int = int(_MFFU_PAYOUT["maximum_request"])


def get_payout_cap(
    firm_key: str,
    account_stage: str,  # "xfa" | "lfa"
    payout_path: str,    # "standard" | "consistency"
    dll_opted_in: bool = False,
) -> int | None:
    """Return the max payout per withdrawal request for a given account/path combination.

    Args:
        firm_key:      Firm identifier ("topstep_50k" or "mffu_50k").
        account_stage: "xfa" (Express Funded Account) or "lfa" (Live Funded Account).
        payout_path:   "standard" or "consistency" (Topstep XFA paths).
        dll_opted_in:  Whether the account holder opted into the voluntary DLL at
                       checkout. Only affects Topstep XFA. Default False = base cap
                       (conservative — never assume the doubled cap).

    Returns:
        Maximum payout in USD, or None for "uncapped" (Topstep LFA).

    Raises:
        ValueError: Unknown firm_key or account_stage.
    """
    if firm_key == "topstep_50k":
        if account_stage == "lfa":
            return TOPSTEP_LFA_PAYOUT_CAP  # None — uncapped
        if account_stage == "xfa":
            caps = TOPSTEP_XFA_PAYOUT_CAPS.get(payout_path)
            if caps is None:
                raise ValueError(
                    f"Unknown payout_path '{payout_path}' for Topstep XFA. "
                    f"Valid: {sorted(TOPSTEP_XFA_PAYOUT_CAPS.keys())}"
                )
            return caps["with_dll"] if dll_opted_in else caps["base"]
        raise ValueError(
            f"Unknown account_stage '{account_stage}'. Valid: 'xfa', 'lfa'."
        )

    if firm_key == "mffu_50k":
        # MFFU has no voluntary-DLL promo; dll_opted_in is ignored.
        return MFFU_PAYOUT_CAP

    raise ValueError(
        f"Unknown firm_key '{firm_key}'. Valid: 'topstep_50k', 'mffu_50k'."
    )


# ─── Public helpers (consumed by backtester.py and others) ────────

def get_commission_per_side(firm_key: str, symbol: str) -> float:
    """Get per-side commission for a firm and symbol.

    Args:
        firm_key: Firm identifier (e.g., 'topstep_50k', 'mffu_50k')
        symbol: Micro contract symbol (e.g., 'MES', 'MNQ', 'MCL')

    Returns:
        Commission in dollars per side per contract

    Raises:
        ValueError: If firm_key or symbol is not found
    """
    if firm_key not in FIRM_COMMISSIONS:
        raise ValueError(
            f"Unknown firm '{firm_key}'. Valid: {sorted(FIRM_COMMISSIONS.keys())}"
        )
    commissions = FIRM_COMMISSIONS[firm_key]
    if symbol not in commissions:
        raise ValueError(
            f"Unknown symbol '{symbol}' for firm '{firm_key}'. "
            f"Valid: {sorted(commissions.keys())}"
        )
    return commissions[symbol]


def get_contract_cap(firm_key: str, symbol: str) -> int:
    """Get max simultaneous MICRO contracts for a firm and symbol.

    Returns the firm's per-symbol cap, clamped to
    [CONTRACT_CAP_MIN, CONTRACT_CAP_MAX] = [0, 60] (Topstep + MFFU
    micro range — MFFU Pro is the max at 60).

    Args:
        firm_key: Firm identifier (e.g., 'topstep_50k', 'mffu_50k')
        symbol: Micro contract symbol (e.g., 'MES', 'MNQ', 'MCL')

    Returns:
        Max contracts allowed (clamped to CONTRACT_CAP_MIN..CONTRACT_CAP_MAX)

    Raises:
        ValueError: If firm_key not found or no cap data
    """
    if firm_key not in FIRM_CONTRACT_CAPS:
        raise ValueError(
            f"No contract cap data for firm '{firm_key}'. "
            f"Available: {sorted(FIRM_CONTRACT_CAPS.keys())}"
        )
    caps = FIRM_CONTRACT_CAPS[firm_key]
    if symbol not in caps:
        raise ValueError(
            f"No contract cap for symbol '{symbol}' at firm '{firm_key}'. "
            f"Available: {sorted(caps.keys())}"
        )
    raw = caps[symbol]
    return max(CONTRACT_CAP_MIN, min(raw, CONTRACT_CAP_MAX))
