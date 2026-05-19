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
                "drawdown_type": "EOD",
                "drawdown_locks_at": "starting_balance",
                "daily_loss_limit": None,
                "consistency_threshold": 0.50,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
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
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 0.90,
                "eval_cost_monthly": 49,
                "commission_per_side": 0.37,
            },
        },
    },
    "TPT": {
        "name": "Take Profit Trader",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": 0.50,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 0.80,
                "eval_cost_monthly": 170,
                "commission_per_side": 0.62,
                "automation_banned": True,
            },
        },
    },
    "Apex": {
        "name": "Apex Trader Funding",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": 1000,
                "consistency_threshold": 0.50,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 1.00,
                "eval_cost_monthly": 99,
                "commission_per_side": 0.62,
            },
        },
    },
    "FFN": {
        "name": "Funded Futures Network",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": 0.40,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 0.80,
                "eval_cost_monthly": 150,
                "commission_per_side": 0.62,
                "data_fee_monthly": 126,
            },
        },
    },
    "Alpha": {
        "name": "Alpha Futures",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": 0.50,
                "must_flatten_before_close": True,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 0.70,
                "eval_cost_monthly": 99,
                "commission_per_side": 0.00,
            },
        },
    },
    "Tradeify": {
        "name": "Tradeify",
        "accounts": {
            "50K": {
                "max_drawdown": 2000,
                "drawdown_type": "EOD",
                "drawdown_locks_at": None,
                "daily_loss_limit": None,
                "consistency_threshold": 0.40,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 0.90,
                "eval_cost_monthly": 159,
                "commission_per_side": 1.29,
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
                "daily_loss_limit": 1100,
                "consistency_threshold": 0.50,
                "max_contracts": {"MES": 15, "MNQ": 15, "MCL": 15},
                "payout_split": 0.80,
                "eval_cost_monthly": 170,
                "commission_per_side": 0.62,
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
