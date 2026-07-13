"""Stage separation regression tests for the firm survival model.

Topstep's Combine best-day rule is a dynamic evaluation target with a two-day
minimum. Topstep XFA and MFFU Builder payout rules are recoverable payout
eligibility conditions; none may alter account breach/ruin metrics.
"""
from __future__ import annotations

import numpy as np

from src.engine.monte_carlo import simulate_firm_survival


def _paths(step_pnls: list[float], n_sims: int = 1) -> np.ndarray:
    cumulative = np.cumsum(np.asarray(step_pnls, dtype=float))
    return np.tile(cumulative, (n_sims, 1))


def _topstep(step_pnls: list[float]) -> dict:
    return simulate_firm_survival(
        _paths(step_pnls),
        "topstep_50k",
        account_size=50_000,
        daily_trades_per_day=1,
        backtest_commission_rt=1.24,
    )


def test_topstep_one_day_base_target_hit_is_not_a_pass() -> None:
    result = _topstep([3000])

    assert result["eval_pass_rate"] == 0.0
    assert result["breach_reasons"]["consistency"] == 0
    assert int(np.sum(result["breach_mask"])) == 0
    assert result["evaluation_target"]["effective_p50"] == 6000.0


def test_topstep_two_balanced_days_pass() -> None:
    result = _topstep([1500, 1500])

    assert result["eval_pass_rate"] == 1.0
    assert result["avg_days_to_pass"] == 2.0
    assert result["evaluation_target"]["effective_p50"] == 3000.0


def test_topstep_spike_is_recoverable_after_effective_target_is_met() -> None:
    result = _topstep([2000, 1000, 1000])

    assert result["eval_pass_rate"] == 1.0
    assert result["evaluation_target"]["effective_p50"] == 4000.0
    assert int(np.sum(result["breach_mask"])) == 0


def test_topstep_consistency_payout_ineligibility_is_not_survival_failure(monkeypatch) -> None:
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")
    # Pass Combine on the first two days, then produce a 3-day payout window
    # whose $1,000 best day is >40% of its $1,200 net profit.
    result = _topstep([1500, 1500, 1000, 100, 100])

    assert result["eval_pass_rate"] == 1.0
    assert result["breach_reasons"]["consistency"] == 0
    assert int(np.sum(result["breach_mask"])) == 0
    assert result["payout_eligibility"]["path"] == "consistency"
    assert result["payout_eligibility"]["eligible_rate"] == 0.0
    assert result["payout_eligibility"]["ineligibility_reasons"] == {
        "consistency_target_not_met": 1
    }


def test_topstep_standard_payout_is_evaluated_in_its_own_window(monkeypatch) -> None:
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
    result = _topstep([1500, 1500, 150, 150, 150, 150, 150])

    assert result["payout_eligibility"]["path"] == "standard"
    assert result["payout_eligibility"]["eligible_rate"] == 1.0
    assert result["payout_eligibility"]["eligible_paths"] == 1


def test_mffu_builder_payout_is_separate_from_eval_and_ruin() -> None:
    result = simulate_firm_survival(
        _paths([3000, 1300, 1300]),
        "mffu_50k",
        account_size=50_000,
        daily_trades_per_day=1,
        backtest_commission_rt=1.90,
    )

    assert result["eval_pass_rate"] == 1.0
    assert result["payout_eligibility"]["path"] == "sim_funded"
    assert result["payout_eligibility"]["eligible_rate"] == 1.0
    assert int(np.sum(result["breach_mask"])) == 0


def test_account_closing_drawdown_still_sets_ruin_mask() -> None:
    result = _topstep([-300] * 10 + [200] * 10)

    assert result["breach_reasons"]["trailing_dd"] == 1
    assert int(np.sum(result["breach_mask"])) == 1


def test_survival_model_remains_deterministic() -> None:
    paths = _paths([1500, 1500, 1000, 100, 100], n_sims=25)
    first = simulate_firm_survival(paths, "topstep_50k", backtest_commission_rt=1.24)
    second = simulate_firm_survival(paths, "topstep_50k", backtest_commission_rt=1.24)

    assert first["eval_pass_rate"] == second["eval_pass_rate"]
    assert first["payout_eligibility"] == second["payout_eligibility"]
    assert np.array_equal(first["breach_mask"], second["breach_mask"])
