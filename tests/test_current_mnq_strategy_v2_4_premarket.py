from __future__ import annotations

from types import SimpleNamespace

from research import current_mnq_strategy_v2_4_premarket as pm
from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core


def loc(q=.8, conf=0):
    return core.Location(
        id="Z", side="S", lo=99, hi=101, mid=100, source="WICK_ZONE",
        quality=q, confluence=conf, entry_authorized=True, zone=None,
    )


def plan(primary):
    return SimpleNamespace(primary=primary)


def test_neutral_and_aligned_plan_do_not_add_an_extra_veto():
    p = core.Params()
    assert pm.plan_allows_v24(plan("NEUTRAL"), "L", "BRK5", None, loc(.1), p)
    assert pm.plan_allows_v24(plan("BULL"), "L", "BRK5", None, loc(.1), p)
    assert pm.plan_allows_v24(plan("BEAR"), "S", "REV", SimpleNamespace(complete=True), loc(.1), p)


def test_counter_plan_reversal_requires_complete_story_at_major_location():
    p = core.Params()
    major = loc(p.high_zone_quality, 0)
    weak = loc(p.high_zone_quality - .01, 1)
    assert pm.plan_allows_v24(plan("BEAR"), "L", "REV", SimpleNamespace(complete=True), major, p)
    assert not pm.plan_allows_v24(plan("BEAR"), "L", "REV", SimpleNamespace(complete=False), major, p)
    assert not pm.plan_allows_v24(plan("BEAR"), "L", "REV", SimpleNamespace(complete=True), weak, p)


def test_two_confluences_can_make_counter_plan_location_major_without_magic_point80():
    p = core.Params()
    z = loc(q=.60, conf=2)
    assert pm.major_location(z, p)
    assert pm.plan_allows_v24(plan("BEAR"), "L", "REV", SimpleNamespace(complete=True), z, p)


def test_counter_plan_strong_breakout_can_invalidate_prior_only_at_major_location():
    p = core.Params()
    assert pm.plan_allows_v24(plan("BEAR"), "L", "BRK5", None, loc(p.high_zone_quality), p)
    assert not pm.plan_allows_v24(plan("BEAR"), "L", "BRK5", None, loc(.60, 0), p)


def test_counter_plan_new_15m_acceptance_can_invalidate_prior_only_at_major_location():
    p = core.Params()
    assert pm.plan_allows_v24(plan("BULL"), "S", "BRK15", None, loc(.60, 2), p)
    assert not pm.plan_allows_v24(plan("BULL"), "S", "BRK15", None, loc(.60, 0), p)


def test_premarket_contract_adds_no_new_numeric_threshold():
    spec = pm.load_premarket_spec()
    assert spec["anti_overfit"]["new_numeric_threshold_added"] is False
    assert spec["anti_overfit"]["uses_existing_frozen_high_zone_quality"] is True
    assert spec["anti_overfit"]["no_PnL_selection"] is True
