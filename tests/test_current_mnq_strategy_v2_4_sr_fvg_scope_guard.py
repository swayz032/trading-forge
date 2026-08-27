from __future__ import annotations

from types import SimpleNamespace

from research import current_mnq_strategy_v2_4_levels as levels
from research import current_mnq_strategy_v2_4_target_policy as target_policy


def test_entry_location_builder_source_does_not_call_named_daily_weekly_key_builder():
    source = open(levels.__file__, encoding="utf-8").read()
    assert "core.make_key_locations" not in source
    assert 'env["pdm"]' not in source
    assert 'env["pwm"]' not in source
    assert "V24_LEGACY_PRIOR_DAY_WEEK_REFERENCE_FORBIDDEN" in source


def test_target_policy_discards_legacy_daily_weekly_maps_before_reaction_builder(monkeypatch):
    seen = {}

    def fake(piv5, full5, h15, asof, p, pdm, pwm, dte, entry, direction, piv15=None):
        seen["pdm"] = pdm
        seen["pwm"] = pwm
        return []

    monkeypatch.setattr(target_policy.base, "build_reaction_destinations", fake)
    target, reason = target_policy.build_and_classify(
        None, None, None, None, SimpleNamespace(),
        {"date": (999.0, 1.0)}, {"week": (999.0, 1.0)}, None,
        100.0, "L", "REV", False,
    )
    assert target is None
    assert reason == "NO_DESTINATION"
    assert seen["pdm"] == {}
    assert seen["pwm"] == {}


def test_only_declared_market_map_and_tp_families_are_allowed_by_contracts():
    k = levels.load_key_level_spec()
    assert set(k["forbidden_location_families"]) == {"PDH", "PDL", "PWH", "PWL"}
    assert k["fvg_relationship"]["fvg_may_itself_be_SR_interaction_when_it_appears_before_regular_SR"] is True

    f = target_policy.base.json if False else None  # keep this guard runtime-free
    from research.current_mnq_strategy_v2_4_policy import load_fvg_spec
    t = load_fvg_spec()["trader_target_rule"]
    assert set(t["forbidden_destination_families"]) == {"PDH", "PDL", "PWH", "PWL"}
    assert t["fvg_take_profit"].startswith("middle of the selected active 15m FVG")
