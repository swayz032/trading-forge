"""Per-firm commission and contract cap data — Topstep + MFFU only.

Per CLAUDE.md §6: Only Topstep (PRIMARY) and MFFU (secondary) are in scope.
Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade, Top One, YRM Prop,
FundingPips) were removed from production scope on 2026-05-10 (DB migration
0097) and stripped from runtime config on 2026-05-19.

Don't use gross P&L for performance gates — use net P&L per firm
(Topstep $0.37/side, MFFU $0.62/side).
Don't ignore firm contract caps in backtests.
"""

from __future__ import annotations

# ─── Per-Firm Commissions (per side, per contract) ───────────────
# Source: each firm's fee schedule for 50K accounts.

FIRM_COMMISSIONS: dict[str, dict[str, float]] = {
    # Wave 27.5 Pass D.2: micro AND mini rates per firm.
    # Micros (MES/MNQ/MCL): active in production today.
    # Minis  (ES/NQ/CL):    Phase 5 only — deferred until single-account funded
    #                       balance ≥ $200K per CLAUDE.md §5.
    # Mini rates = 10× micro rates (10:1 contract ratio, same notional exposure).
    # Verified 2026-05-25 against Topstep + MFFU 2026 published fee schedules.
    "topstep_50k": {
        # Micros
        "MES": 0.37, "MNQ": 0.37, "MCL": 0.37,
        # Minis (Phase 5)
        "ES": 3.70, "NQ": 3.70, "CL": 3.70,
    },
    "mffu_50k": {
        # Micros
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.62,
        # Minis (Phase 5)
        "ES": 6.20, "NQ": 6.20, "CL": 6.20,
    },
}


# ─── Per-Firm Contract Caps (max simultaneous MICRO contracts) ───
# 2026 actual published rules (verified 2026-05-19 against Topstep + MFFU
# help center pages, not stale internal docs):
#
#   Topstep $50K Combine + Funded:  5 minis OR 50 micros (10:1 ratio)
#   MFFU $50K (Core / Flex / Rapid): 5 minis OR 50 micros
#   MFFU $50K Pro:                   6 minis OR 60 micros
#
# We run MICRO contracts (MES/MNQ/MCL) only — the mini equivalents
# (ES/NQ/CL) are deferred until single-account balance ≥ $200K per
# CLAUDE.md §5 Phase 5. So the per-symbol cap is the micro cap.

FIRM_CONTRACT_CAPS: dict[str, dict[str, int]] = {
    "topstep_50k": {"MES": 50, "MNQ": 50, "MCL": 50},
    "mffu_50k":    {"MES": 50, "MNQ": 50, "MCL": 50},
}

# Hard bounds: min 0, max 60 (MFFU Pro). ATR sizing is clamped to this range.
CONTRACT_CAP_MIN = 0
CONTRACT_CAP_MAX = 60


# ─── Scaling Plans (account upgrades after profit milestones) ─────
# new_account_size values represent the upgraded account size AFTER hitting
# profit_threshold on the original 50K. All traders START at 50K.

SCALING_PLANS: dict[str, list[dict]] = {
    # max_contracts at each scaling tier = micro-contract cap (10:1 ratio).
    # Topstep tiers: 50K→100K@$5K profit, 100K→150K@$10K profit.
    # MFFU tiers (Core): 50K→100K@$5K, 100K→200K@$15K.
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
    "topstep_50k": 50,  # 50 micros at $50K Combine + Funded
    "mffu_50k": 50,     # 50 micros at $50K Core/Flex/Rapid
}


# ─── Full Firm Rules (mirrors src/shared/firm-config.ts) ─────────
# Single source of truth for Python code. Keep in sync with TypeScript shared config.
# prop_compliance.py has its own FIRM_CONFIGS dict that duplicates some of these
# rules. Both must stay in sync.

FIRM_RULES: dict[str, dict] = {
    "topstep_50k": {
        "account_size": 50_000,
        "monthly_fee": 49,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 50,  # 50 micros (10:1 mini ratio) at $50K
        "trailing": "eod",
        "payout_split": 0.90,
        "min_payout_days": 5,
        "min_trading_days": 5,
        "consistency_rule": "topstep_50pct",   # 50% best-day cap at Combine pass-request; same threshold as MFFU eval
        "daily_loss_limit": 1000,
        "overnight_ok": False,
        "weekend_ok": False,
        # 2026-compliance (canonical: docs/prop-firm-rules-2026-topstep.md)
        "platform_lockdown_date": "2026-01-12",   # NinjaTrader/Tradovate banned
        "required_platform": "topstepx",           # TopstepX API only
        "allows_vps": False,                        # Personal device only
        "allows_vpn": False,
        "allows_remote_desktop": False,
        "multi_account_within_user_allowed": True,  # Multiple accounts under one user_id
        "copy_trades_within_user_allowed": True,    # Same strategy across own accounts OK
    },
    "mffu_50k": {
        "account_size": 50_000,
        "monthly_fee": 77,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 50,  # 50 micros (10:1 mini ratio) at $50K
        "trailing": "eod",
        "payout_split": 0.80,
        "min_payout_days": 5,
        "min_trading_days": 5,
        "consistency_rule": "mffu_50pct",
        "daily_loss_limit": None,
        "overnight_ok": False,
        "weekend_ok": False,
        # 2026-compliance (canonical: docs/prop-firm-rules-2026-mffu.md)
        "payout_cycle_days": 14,  # Bi-weekly payouts every 14 days
    },
}


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
