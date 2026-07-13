"""Topstep XFA payout-path regression tests.

Payout path selection affects only the post-evaluation payout window. It must
not feed back into Combine eligibility, breach reasons, or the ruin mask.
"""
from __future__ import annotations

import numpy as np

from src.engine.monte_carlo import simulate_firm_survival


def _survival(step_pnls: list[float]) -> dict:
    return simulate_firm_survival(
        np.asarray([np.cumsum(step_pnls)], dtype=float),
        "topstep_50k",
        daily_trades_per_day=1,
        backtest_commission_rt=1.24,
    )


def test_standard_path_is_default_and_payout_ineligibility_is_recoverable(monkeypatch) -> None:
    monkeypatch.delenv("TOPSTEP_PAYOUT_LANE", raising=False)
    result = _survival([1500, 1500, 2000])

    assert result["eval_pass_rate"] == 1.0
    assert result["payout_eligibility"]["path"] == "standard"
    assert result["payout_eligibility"]["eligible_rate"] == 0.0
    assert result["payout_eligibility"]["ineligibility_reasons"] == {
        "minimum_winning_days_not_met": 1
    }
    assert result["breach_reasons"]["consistency"] == 0
    assert int(np.sum(result["breach_mask"])) == 0


def test_consistency_path_is_case_insensitive_and_uses_40_percent_payout_rule(monkeypatch) -> None:
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", " CONSISTENCY ")
    result = _survival([1500, 1500, 900, 500, 600])

    assert result["payout_eligibility"]["path"] == "consistency"
    assert result["payout_eligibility"]["eligible_rate"] == 0.0
    assert result["payout_eligibility"]["ineligibility_reasons"] == {
        "consistency_target_not_met": 1
    }
    assert result["eval_pass_rate"] == 1.0
    assert int(np.sum(result["breach_mask"])) == 0


def test_consistency_path_with_balanced_payout_window_is_eligible(monkeypatch) -> None:
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")
    result = _survival([1500, 1500, 500, 500, 500])

    assert result["payout_eligibility"]["eligible_rate"] == 1.0
    assert result["payout_eligibility"]["eligible_paths"] == 1
