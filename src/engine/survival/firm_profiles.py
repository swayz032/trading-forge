"""Stage-aware survival profiles for the active 50K firms."""

from src.engine.firm_stage_rules import get_firm_rules, get_stage_rules


def _build_profile(firm_key: str) -> dict:
    firm = get_firm_rules(firm_key)
    evaluation = get_stage_rules(firm_key, "evaluation")
    payout = get_stage_rules(firm_key, "payout")
    execution = get_stage_rules(firm_key, "execution")

    daily_loss_limit = (
        evaluation["daily_loss_limit"]
        if evaluation.get("daily_loss_behavior") == "hard_limit"
        else None
    )
    max_contracts = int(evaluation["max_contracts"])
    lock_floor_offset = evaluation.get("trailing_lock_floor_offset")

    return {
        "max_drawdown": evaluation["max_drawdown"],
        "drawdown_type": str(evaluation["trailing"]).upper(),
        "drawdown_locks_at": (
            "starting_balance"
            if lock_floor_offset == 0
            else f"starting_balance_plus_{lock_floor_offset}"
            if lock_floor_offset is not None
            else None
        ),
        "trailing_lock_floor_offset": lock_floor_offset,
        "daily_loss_limit": daily_loss_limit,
        # Topstep's evaluation condition is a dynamic target, while MFFU's
        # condition is payout-only. Neither is an account-survival threshold.
        "consistency_threshold": None,
        "max_contracts": {"MES": max_contracts, "MNQ": max_contracts, "MCL": max_contracts},
        "payout_split": payout["payout_split"],
        "eval_cost_monthly": evaluation["monthly_fee"],
        "commission_per_side": execution["commission_per_side"],
        "evaluation_profit_target": evaluation["profit_target"],
        "evaluation_min_trading_days": evaluation["min_trading_days"],
    }


FIRM_PROFILES: dict[str, dict] = {
    "MFFU": {
        "name": get_firm_rules("mffu_50k")["display_name"],
        "accounts": {"50K": _build_profile("mffu_50k")},
    },
    "Topstep": {
        "name": get_firm_rules("topstep_50k")["display_name"],
        "accounts": {"50K": _build_profile("topstep_50k")},
    },
}


REQUIRED_FIELDS = [
    "max_drawdown",
    "drawdown_type",
    "daily_loss_limit",
    "consistency_threshold",
    "max_contracts",
    "payout_split",
    "eval_cost_monthly",
    "commission_per_side",
    "evaluation_profit_target",
    "evaluation_min_trading_days",
]


def get_firm_profile(firm: str, account_type: str = "50K") -> dict | None:
    """Get a profile for a supported firm/account pair."""
    firm_data = FIRM_PROFILES.get(firm)
    if not firm_data:
        return None
    return firm_data["accounts"].get(account_type)


def list_firms() -> list[str]:
    return list(FIRM_PROFILES.keys())
