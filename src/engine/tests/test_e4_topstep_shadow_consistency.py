"""Regression coverage for replacing the obsolete Topstep shadow metric.

The old shadow treated a payout rule as a hypothetical evaluation breach. The
stage-aware output now reports the selected payout path directly and never
changes evaluation or ruin metrics when the path changes.
"""
from __future__ import annotations

import numpy as np

from src.engine.monte_carlo import simulate_firm_survival


def _simulate() -> dict:
    # Combine passes on days one and two. The remaining three funded days meet
    # the XFA Consistency path but not Standard's five-winning-day requirement.
    steps = [1500, 1500, 700, 700, 700]
    return simulate_firm_survival(
        np.asarray([np.cumsum(steps)], dtype=float),
        "topstep_50k",
        account_size=50_000,
        daily_trades_per_day=1,
        granularity="day",
        backtest_commission_rt=1.24,
    )


def test_payout_path_changes_only_payout_telemetry(monkeypatch) -> None:
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
    standard = _simulate()
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")
    consistency = _simulate()

    assert standard["eval_pass_rate"] == consistency["eval_pass_rate"] == 1.0
    assert np.array_equal(standard["breach_mask"], consistency["breach_mask"])
    assert standard["breach_reasons"]["consistency"] == 0
    assert consistency["breach_reasons"]["consistency"] == 0
    assert standard["payout_eligibility"]["path"] == "standard"
    assert standard["payout_eligibility"]["eligible_rate"] == 0.0
    assert consistency["payout_eligibility"]["path"] == "consistency"
    assert consistency["payout_eligibility"]["eligible_rate"] == 1.0


def test_obsolete_shadow_field_is_explicitly_non_applicable(monkeypatch) -> None:
    monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
    result = _simulate()

    assert result["topstep_consistency_lane_shadow"] is None
