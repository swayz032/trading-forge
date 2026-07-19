"""
Prop firm survival profiles — Topstep (PRIMARY) + MFFU (secondary).

Per CLAUDE.md §6: only these two firms are in production scope.
Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) removed
2026-05-19.

Each profile encodes the firm's specific drawdown mechanics, consistency
requirements, payout structure, and micro contract caps as actually
published (verified 2026-05-19 against Topstep + MFFU help center pages).
"""

FIRM_PROFILES: dict[str, dict] = {
    "MFFU": {
        "name": "My Funded Futures",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": "starting_balance",
                "daily_loss_limit": None,
                "consistency_threshold": 0.50,
                # 5 minis × 10:1 ratio = 50 micros (Core/Flex/Rapid plans).
                # Pro plan is 60 micros; conservative default uses Core.
                "max_contracts": {"MES": 50, "MNQ": 50, "MCL": 50},
                "payout_split": 0.80,
                "eval_cost_monthly": 77,
                "commission_per_side": 0.62,
            },
        },
    },
    "Topstep": {
        "name": "Topstep",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": 1000,
                "consistency_threshold": None,
                # 5 minis × 10:1 ratio = 50 micros at $50K Combine + Funded.
                # TopstepX scaling plan ramps up to this max as balance grows.
                "max_contracts": {"MES": 50, "MNQ": 50, "MCL": 50},
                "payout_split": 0.90,
                "eval_cost_monthly": 85,  # R-054 fix-the-class: Combine fee $49→$85 (5th sibling copy; inert survival field, synced for correctness)
                "commission_per_side": 0.37,  # WATCH-ITEM: $1.22-vs-$1.24 RT two-path-insufficient; commission scope-locked, not changed here
            },
        },
    },
}

# Required fields every account profile must have
REQUIRED_FIELDS = [
    "max_drawdown",
    "drawdown_type",
    "daily_loss_limit",
    "consistency_threshold",
    "max_contracts",
    "payout_split",
    "eval_cost_monthly",
    "commission_per_side",
]


def get_firm_profile(firm: str, account_type: str = "50K") -> dict | None:
    """Get firm profile for a specific account type."""
    firm_data = FIRM_PROFILES.get(firm)
    if not firm_data:
        return None
    return firm_data["accounts"].get(account_type)


def list_firms() -> list[str]:
    return list(FIRM_PROFILES.keys())
