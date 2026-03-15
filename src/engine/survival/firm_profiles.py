"""
Prop firm survival profiles — the rules that kill accounts.
Each profile encodes the firm's specific drawdown mechanics,
consistency requirements, and payout structure.
"""

FIRM_PROFILES: dict[str, dict] = {
    "MFFU": {
        "name": "My Funded Futures",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "trailing",  # trailing | EOD | intraday
                "drawdown_locks_at": "starting_balance",  # trailing DD locks once account hits starting balance
                "daily_loss_limit": None,  # MFFU has no daily loss limit
                "consistency_threshold": None,  # No consistency rule
                "max_contracts": {"ES": 5, "NQ": 5, "CL": 5, "YM": 5, "RTY": 10, "GC": 5, "MES": 50, "MNQ": 50},
                "payout_split": 0.90,  # 90% to trader after first $10K
                "eval_cost_monthly": 77,
                "commission_per_side": 1.58,
            },
            "100K": {
                "max_drawdown": 3000,
                "drawdown_type": "trailing",
                "drawdown_locks_at": "starting_balance",
                "daily_loss_limit": None,
                "consistency_threshold": None,
                "max_contracts": {"ES": 10, "NQ": 10, "CL": 10, "YM": 10, "RTY": 20, "GC": 10},
                "payout_split": 0.90,
                "eval_cost_monthly": 137,
                "commission_per_side": 1.58,
            },
        },
    },
    "Topstep": {
        "name": "Topstep",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",  # End-of-day trailing
                "drawdown_locks_at": None,
                "daily_loss_limit": 1000,
                "consistency_threshold": None,
                "max_contracts": {"ES": 5, "NQ": 5, "CL": 5, "YM": 5, "RTY": 10, "GC": 5},
                "payout_split": 0.90,
                "eval_cost_monthly": 49,
                "commission_per_side": 2.02,
            },
        },
    },
    "TPT": {
        "name": "Take Profit Trader",
        "accounts": {
            "50K": {
                "max_drawdown": 2500,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": 0.50,  # No single day > 50% of total profit
                "max_contracts": {"ES": 5, "NQ": 5, "CL": 5},
                "payout_split": 0.80,
                "eval_cost_monthly": 150,
                "commission_per_side": 2.34,
                "automation_banned": True,  # PRO account bans bots
            },
        },
    },
    "Apex": {
        "name": "Apex Trader Funding",
        "accounts": {
            "50K": {
                "max_drawdown": 2500,
                "drawdown_type": "trailing",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": None,
                "max_contracts": {"ES": 10, "NQ": 10, "CL": 10},
                "payout_split": 1.00,  # 100% of first $25K, then 90%
                "eval_cost_monthly": 167,
                "commission_per_side": 2.64,
            },
        },
    },
    "FFN": {
        "name": "Fast Fund Now",
        "accounts": {
            "50K": {
                "max_drawdown": 2500,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": None,
                "max_contracts": {"ES": 5, "NQ": 5, "CL": 5},
                "payout_split": 0.80,
                "eval_cost_monthly": 99,
                "commission_per_side": 2.00,
            },
            "Express": {
                "max_drawdown": 2500,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": 0.15,  # No single day > 15% of total profit
                "max_contracts": {"ES": 5},
                "payout_split": 0.80,
                "eval_cost_monthly": 99,
                "commission_per_side": 2.00,
                "data_fee_monthly": 126,
            },
        },
    },
    "Alpha": {
        "name": "Alpha Futures",
        "accounts": {
            "50K": {
                "max_drawdown": 2500,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": 1000,
                "consistency_threshold": None,
                "must_flatten_before_close": True,
                "max_contracts": {"ES": 5, "NQ": 5, "CL": 5},
                "payout_split": 0.80,
                "eval_cost_monthly": 99,
                "commission_per_side": 2.10,
            },
        },
    },
    "Tradeify": {
        "name": "Tradeify",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "intraday",  # Real-time trailing, not EOD
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": None,
                "max_contracts": {"ES": 5, "NQ": 5, "CL": 5},
                "payout_split": 0.80,
                "eval_cost_monthly": 99,
                "commission_per_side": 2.00,
            },
        },
    },
    "Earn2Trade": {
        "name": "Earn2Trade",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": None,
                "max_contracts": {"ES": 5, "NQ": 5},
                "payout_split": 0.80,
                "eval_cost_monthly": 150,
                "commission_per_side": 2.50,
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
