from __future__ import annotations

import numpy as np

from src.engine.monte_carlo import simulate_firm_survival


def _survival(paths: list[list[float]]) -> dict:
    return simulate_firm_survival(
        np.asarray(paths, dtype=float),
        "topstep_50k",
        daily_trades_per_day=1,
        backtest_commission_rt=1.24,
    )


def test_topstep_one_day_profit_target_hit_does_not_pass_evaluation() -> None:
    result = _survival([[3000.0]])

    assert result["eval_pass_rate"] == 0.0


def test_topstep_two_balanced_days_pass_evaluation() -> None:
    result = _survival([[1500.0, 3000.0]])

    assert result["eval_pass_rate"] == 1.0
    assert result["avg_days_to_pass"] == 2.0


def test_topstep_spike_day_raises_target_in_monte_carlo() -> None:
    result = _survival([[2000.0, 3000.0]])

    assert result["eval_pass_rate"] == 0.0


def test_topstep_payout_ineligibility_does_not_change_funded_survival() -> None:
    result = _survival([[1500.0, 3000.0, 3150.0]])

    assert result["eval_pass_rate"] == 1.0
    assert result["breach_reasons"]["consistency"] == 0
    assert result["payout_eligibility"]["eligible_rate"] == 0.0


def test_funded_breach_does_not_erase_a_completed_topstep_evaluation() -> None:
    result = _survival([[1500.0, 3000.0, 2000.0, 1000.0]])

    assert result["eval_pass_rate"] == 1.0
    assert result["avg_days_to_pass"] == 2.0
    assert result["funded_survival_6mo"] == 0.0
    assert result["breach_mask"].tolist() == [1]


def test_mffu_funded_lock_breaches_at_100_above_zero_start() -> None:
    result = simulate_firm_survival(
        np.asarray([[3000.0, 5100.0, 3050.0]], dtype=float),
        "mffu_50k",
        daily_trades_per_day=1,
        backtest_commission_rt=1.90,
    )

    assert result["eval_pass_rate"] == 1.0
    assert result["breach_mask"].tolist() == [1]
    assert result["breach_reasons"]["trailing_dd"] == 1
