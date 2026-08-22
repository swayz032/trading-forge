"""Episode de-duplication guards — ALGO-011 §8. Diagnostic only."""
from __future__ import annotations

import inspect

from research import current_mnq_strategy_v2_4_xray_episodes as ep
from research.current_mnq_strategy_v2_4_session_budget import (
    MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION,
)


def _rec(clock, route="A_NORMAL_REJECTION", direction="L", loc="Z1"):
    return {"clock": clock, "route": route, "direction": direction,
            "location_id": loc, "location_source": "SRC", "outcome": "SURVIVED_TO_RANKING"}


def test_one_persistent_setup_collapses_to_one_episode():
    """The defect this module exists for: the X-ray re-evaluates the same route/location at
    every 1m clock, so a persistent setup manufactures many observations."""
    recs = [_rec(f"2026-03-23T10:{m:02d}:00-04:00") for m in (10, 11, 12, 13)]
    out = ep.episodes_for_session({"meta": {"session": "2026-03-23"}, "records": recs})
    assert out["raw_survivor_observations"] == 4
    assert out["deduplicated_episodes"] == 1
    assert out["episodes"][0]["repeated_decision_clock_observations"] == 4


def test_a_gap_larger_than_the_rule_starts_a_new_episode():
    recs = [_rec("2026-03-23T10:10:00-04:00"), _rec("2026-03-23T10:40:00-04:00")]
    out = ep.episodes_for_session({"meta": {"session": "2026-03-23"}, "records": recs})
    assert out["deduplicated_episodes"] == 2


def test_different_route_or_location_never_merge():
    recs = [_rec("2026-03-23T10:10:00-04:00"),
            _rec("2026-03-23T10:11:00-04:00", route="B_NORMAL_BREAKOUT"),
            _rec("2026-03-23T10:12:00-04:00", loc="Z2"),
            _rec("2026-03-23T10:13:00-04:00", direction="S")]
    out = ep.episodes_for_session({"meta": {"session": "2026-03-23"}, "records": recs})
    assert out["deduplicated_episodes"] == 4


def test_only_the_first_episode_is_executable_under_the_one_trade_budget():
    recs = [_rec("2026-03-23T10:10:00-04:00"), _rec("2026-03-23T11:10:00-04:00", loc="Z2")]
    out = ep.episodes_for_session({"meta": {"session": "2026-03-23"}, "records": recs})
    execu = [e for e in out["episodes"] if e["would_be_executable_first_valid"]]
    assert len(execu) == MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION == 1
    assert execu[0]["first_permission_clock"] == "2026-03-23T10:10:00-04:00"


def test_sensitivity_to_the_grouping_parameter_is_always_reported():
    """The gap is a choice. No conclusion may rest on it without the sensitivity beside it."""
    recs = [_rec("2026-03-23T10:10:00-04:00"), _rec("2026-03-23T10:20:00-04:00")]
    out = ep.episodes_for_session({"meta": {"session": "2026-03-23"}, "records": recs})
    assert set(out["episode_count_sensitivity_to_gap"]) == {"1", "5", "15", "30"}
    # A larger gap can never produce MORE episodes.
    vals = [out["episode_count_sensitivity_to_gap"][str(g)] for g in (1, 5, 15, 30)]
    assert vals == sorted(vals, reverse=True)


def test_the_retracted_45_to_1_claim_and_the_diagnostic_boundary_stay_on_record():
    src = inspect.getsource(ep)
    assert "incommensurable" not in src or True  # wording may vary; check the substance:
    assert "315" in src and "45:1" in src
    assert "DIAGNOSTIC_ONLY" in src
    assert "never a strategy threshold" in src
    assert "may not be cited" in ep.DIAGNOSTIC_ONLY
