"""Per-firm commission and contract cap data.

Per CLAUDE.md: Don't use gross P&L for performance gates — use net P&L
per firm (commissions differ: Topstep $0.37/side, Alpha $0.00, Tradeify $1.29, others $0.62).
Don't ignore firm contract caps in backtests.
"""

from __future__ import annotations


# ─── Per-Firm Commissions (per side, per contract) ───────────────
# Source: each firm's fee schedule for 50K accounts

FIRM_COMMISSIONS: dict[str, dict[str, float]] = {
    "topstep_50k": {
        "MES": 0.37, "MNQ": 0.37, "MCL": 0.37,
    },
    "mffu_50k": {
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.62,
    },
    "tpt_50k": {
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.62,
    },
    "apex_50k": {
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.62,
    },
    "tradeify_50k": {
        "MES": 1.29, "MNQ": 1.29, "MCL": 1.29,
    },
    "alpha_50k": {
        "MES": 0.00, "MNQ": 0.00, "MCL": 0.00,
    },
    "ffn_50k": {
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.62,
    },
    "earn2trade_50k": {
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.62,
    },
}


# ─── Per-Firm Contract Caps (max simultaneous contracts) ─────────

# Contract caps: 10 min / 15 default / 20 max for all micro contracts, all firms.
FIRM_CONTRACT_CAPS: dict[str, dict[str, int]] = {
    "topstep_50k":    {"MES": 15, "MNQ": 15, "MCL": 15},
    "mffu_50k":       {"MES": 15, "MNQ": 15, "MCL": 15},
    "tpt_50k":        {"MES": 15, "MNQ": 15, "MCL": 15},
    "apex_50k":       {"MES": 15, "MNQ": 15, "MCL": 15},
    "tradeify_50k":   {"MES": 15, "MNQ": 15, "MCL": 15},
    "alpha_50k":      {"MES": 15, "MNQ": 15, "MCL": 15},
    "ffn_50k":        {"MES": 15, "MNQ": 15, "MCL": 15},
    "earn2trade_50k": {"MES": 15, "MNQ": 15, "MCL": 15},
}

# Hard bounds: min 10, max 20. ATR sizing is clamped to this range.
CONTRACT_CAP_MIN = 10
CONTRACT_CAP_MAX = 20


# ─── Scaling Plans (account upgrades after profit milestones) ─────
# NOTE: new_account_size values (100K, 150K, 200K) are NOT starting accounts.
# They represent the upgraded account size AFTER the trader hits profit_threshold
# on their original 50K account. All traders START at 50K.

SCALING_PLANS: dict[str, list[dict]] = {
    "topstep_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 4500, "max_contracts": 20},
    ],
    "mffu_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 15},
        {"profit_threshold": 15000, "new_account_size": 200000, "new_max_dd": 5000, "max_contracts": 20},
    ],
    "tpt_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3500, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 5000, "max_contracts": 20},
    ],
    "apex_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3500, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 5000, "max_contracts": 20},
    ],
    "tradeify_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 5000, "max_contracts": 20},
    ],
    "alpha_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 5000, "max_contracts": 20},
    ],
    "ffn_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3500, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 5000, "max_contracts": 20},
    ],
    "earn2trade_50k": [
        {"profit_threshold": 5000,  "new_account_size": 100000, "new_max_dd": 3000, "max_contracts": 15},
        {"profit_threshold": 10000, "new_account_size": 150000, "new_max_dd": 5000, "max_contracts": 20},
    ],
}


# ─── Initial Contract Caps (starting limits before scaling) ──────
INITIAL_CONTRACT_CAPS: dict[str, int] = {
    "topstep_50k": 15,
    "mffu_50k": 15,
    "tpt_50k": 15,
    "apex_50k": 15,
    "tradeify_50k": 15,
    "alpha_50k": 15,
    "ffn_50k": 15,
    "earn2trade_50k": 15,
}


# ─── Full Firm Rules (mirrors src/shared/firm-config.ts) ─────────
# Single source of truth for Python code. Keep in sync with TypeScript shared config.
# NOTE: prop_compliance.py has its own FIRM_CONFIGS dict that duplicates some of these
# rules. Both must stay in sync. Do NOT delete either without full regression testing.

FIRM_RULES: dict[str, dict] = {
    "topstep_50k": {
        "account_size": 50_000,
        "monthly_fee": 49,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.90,
        "min_payout_days": 5,
        "min_trading_days": 5,
        "consistency_rule": None,
        "daily_loss_limit": 1000,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "mffu_50k": {
        "account_size": 50_000,
        "monthly_fee": 77,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.80,
        "min_payout_days": 5,
        "min_trading_days": 5,
        "consistency_rule": "mffu_50pct",
        "daily_loss_limit": None,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "tpt_50k": {
        "account_size": 50_000,
        "monthly_fee": 170,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.80,
        "payout_split_tiers": [{"threshold": 5000, "split": 0.90}],
        "min_payout_days": 5,
        "min_trading_days": 5,
        "consistency_rule": "tpt_50pct",
        "daily_loss_limit": None,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "apex_50k": {
        "account_size": 50_000,
        "monthly_fee": 99,
        "activation_fee": 0,
        "ongoing_monthly_fee": 85,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 1.00,
        "payout_split_tiers": [{"threshold": 25000, "split": 0.90}],
        "min_payout_days": 1,
        "min_trading_days": 1,
        "consistency_rule": "apex_50pct_funded",
        "daily_loss_limit": 1000,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "ffn_50k": {
        "account_size": 50_000,
        "monthly_fee": 150,
        "activation_fee": 0,
        "ongoing_monthly_fee": 126,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.80,
        "payout_split_tiers": [{"threshold": 5000, "split": 0.90}],
        "min_payout_days": 3,
        "min_trading_days": 3,
        "consistency_rule": "ffn_40pct",
        "daily_loss_limit": None,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "alpha_50k": {
        "account_size": 50_000,
        "monthly_fee": 99,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.70,
        # Alpha tiers are payout-count based (1st=70%, 2nd=80%, 3rd+=90%), NOT dollar thresholds.
        "payout_split_tiers": None,
        "payout_count_tiers": [
            {"payout_number": 1, "split": 0.70},
            {"payout_number": 2, "split": 0.80},
            {"payout_number": 3, "split": 0.90},
        ],
        "min_payout_days": 2,
        "min_trading_days": 2,
        "consistency_rule": "alpha_50pct",
        "daily_loss_limit": None,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "tradeify_50k": {
        "account_size": 50_000,
        "monthly_fee": 159,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 2500,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.90,
        "min_payout_days": 3,
        "min_trading_days": 3,
        "consistency_rule": "tradeify_40pct",
        "daily_loss_limit": None,
        "overnight_ok": False,
        "weekend_ok": False,
    },
    "earn2trade_50k": {
        "account_size": 50_000,
        "monthly_fee": 170,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 15,
        "trailing": "eod",
        "payout_split": 0.80,
        "min_payout_days": 10,
        "min_trading_days": 10,
        "consistency_rule": "earn2trade_consistency",
        "daily_loss_limit": 1100,
        "overnight_ok": False,
        "weekend_ok": False,
    },
}


def get_firm_rules(firm_key: str) -> dict:
    """Get full rules for a firm. Raises ValueError if not found."""
    if firm_key not in FIRM_RULES:
        raise ValueError(f"Unknown firm '{firm_key}'. Valid: {sorted(FIRM_RULES.keys())}")
    return FIRM_RULES[firm_key]


def get_max_drawdown(firm_key: str) -> float:
    """Get max drawdown for a firm."""
    return get_firm_rules(firm_key)["max_drawdown"]


def get_buffer_amount(firm_key: str) -> float:
    """Buffer = maxDrawdown. Must build this before any payouts."""
    return get_firm_rules(firm_key)["max_drawdown"]


def get_total_hurdle(firm_key: str) -> float:
    """Total profit needed before first payout = profitTarget + buffer."""
    rules = get_firm_rules(firm_key)
    return rules["profit_target"] + rules["max_drawdown"]


def get_scaling_plan(firm_key: str) -> list[dict]:
    """Get scaling plan steps for a firm."""
    return SCALING_PLANS.get(firm_key, [])


def get_commission_per_side(firm_key: str, symbol: str) -> float:
    """Get per-side commission for a firm and symbol.

    Args:
        firm_key: Firm identifier (e.g., 'mffu_50k')
        symbol: Contract symbol (e.g., 'MES')

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
    """Get maximum simultaneous contracts for a firm and symbol.

    Returns the firm's per-symbol cap, clamped to [CONTRACT_CAP_MIN, CONTRACT_CAP_MAX].

    Args:
        firm_key: Firm identifier (e.g., 'topstep_50k')
        symbol: Contract symbol (e.g., 'MES')

    Returns:
        Max contracts allowed (clamped to 10-20 range)

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
