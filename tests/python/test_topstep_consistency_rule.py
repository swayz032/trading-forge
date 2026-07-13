"""Regression tests for Topstep's stage-aware Combine and payout rules."""
from __future__ import annotations


def _run(
    daily_pnls: list[float],
    *,
    enforce_mffu_consistency: bool = False,
    **stat_overrides: object,
) -> dict:
    from src.engine.prop_compliance import run_prop_compliance

    stats = {
        "symbol": "MES",
        "total_trades": len(daily_pnls),
        "total_trading_days": len(daily_pnls),
        "avg_daily_pnl": sum(daily_pnls) / max(len(daily_pnls), 1),
        "trades_overnight": False,
        **stat_overrides,
    }
    return run_prop_compliance(
        daily_pnls,
        stats,
        enforce_mffu_consistency=enforce_mffu_consistency,
    )


def test_legacy_projections_identify_the_correct_rule_stages() -> None:
    from src.engine.firm_config import FIRM_RULES
    from src.engine.prop_compliance import FIRM_CONFIGS

    assert FIRM_RULES["topstep_50k"]["consistency_rule"] == "topstep_dynamic_target_50pct"
    assert FIRM_RULES["mffu_50k"]["consistency_rule"] == "mffu_50pct_sim_payout"
    assert FIRM_CONFIGS["topstep_50k"]["min_trading_days"] == 2
    assert FIRM_CONFIGS["mffu_50k"]["min_payout_days"] == 2


def test_topstep_requires_two_combine_days() -> None:
    result = _run([3000.0])["topstep_50k"]

    assert not result["passed"]
    assert any("not yet eligible" in failure.lower() for failure in result["failures"])


def test_topstep_passes_two_balanced_combine_days() -> None:
    result = _run([1500.0, 1500.0])["topstep_50k"]

    assert result["passed"]
    assert not any("not yet eligible" in failure.lower() for failure in result["failures"])


def test_topstep_spike_raises_target_but_is_recoverable() -> None:
    result = _run([2000.0, 1000.0, 1000.0])["topstep_50k"]

    assert result["passed"]


def test_topstep_loss_does_not_reset_best_day() -> None:
    result = _run([2000.0, -500.0, 500.0, 2000.0])["topstep_50k"]

    assert result["passed"]


def test_mffu_consistency_is_only_checked_when_payout_evaluation_is_requested() -> None:
    daily_pnls = [2200.0, 600.0, 600.0]
    default = _run(daily_pnls)["mffu_50k"]
    payout = _run(daily_pnls, enforce_mffu_consistency=True)["mffu_50k"]

    assert default["passed"]
    assert payout["passed"]
    assert payout["payout_eligibility"]["eligible"] is False
    assert payout["payout_eligibility"]["recoverable"] is True


def test_ranking_does_not_disqualify_recoverable_stage_conditions() -> None:
    from src.engine.prop_compliance import rank_firms_for_strategy

    rankings = rank_firms_for_strategy(
        {
            "max_drawdown": 500.0,
            "avg_daily_pnl": 50.0,
            "consistency_ratio": 0.75,
            "trades_overnight": False,
        }
    )
    firm_keys = {row["firm"] for row in rankings}

    assert {"topstep_50k", "mffu_50k"}.issubset(firm_keys)
