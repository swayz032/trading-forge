from __future__ import annotations

import json
from pathlib import Path


SPEC = Path(__file__).resolve().parents[1] / "research" / "current_mnq_strategy_v2_4_spec.json"


def spec():
    return json.loads(SPEC.read_text())


def test_candlestick_video_pack_is_joint_candle_and_support_resistance_evidence():
    s = spec()
    assert s["source_model"]["candlestick_video_pack_is_joint_candle_and_support_resistance_evidence"] is True
    assert s["source_model"]["location_and_pattern_must_be_interpreted_together"] is True


def test_location_semantics_require_structural_quality_not_random_chart_lines():
    k = spec()["key_level_semantics"]
    assert k["allowed_regular_level_family"] == "STRUCTURAL_SUPPORT_RESISTANCE_ONLY"
    assert set(k["forbidden_named_reference_levels"]) == {"PDH", "PDL", "PWH", "PWL"}
    assert "multiple_independent_rejections_or_wick_reactions" in k["primary_quality_evidence"]
    assert "strong_displacement_away_from_swing_high_or_low" in k["secondary_quality_evidence"]
    assert k["active_map_policy"]["avoid_chart_clutter"] is True
    assert k["active_map_policy"]["do_not_delete_farther_meaningful_destination"] is True
    assert k["active_map_policy"]["no_hindsight_full_day_range_label"] is True


def test_active_fvg_can_be_interaction_band_but_not_standalone_signal():
    f = spec()["key_level_semantics"]["fvg_as_location"]
    assert f["active_15m_FVG_may_be_support_or_resistance_interaction_band"] is True
    assert f["when_FVG_appears_before_regular_SR_it_is_not_ignored"] is True
    assert f["FVG_alone_never_creates_trade"] is True
    assert f["rejection_or_breakout_story_plus_force_still_required"] is True


def test_role_flip_and_reclaim_require_evidence():
    k = spec()["key_level_semantics"]
    assert k["role_flip"]["transient_wick_breach_is_not_role_flip"] is True
    assert k["role_flip"]["durable_acceptance_required"] is True
    assert k["reclaim"]["hold_or_defense_required"] is True
    assert k["reclaim"]["directional_control_required"] is True
    assert k["reclaim"]["doji_reclaim_alone_is_not_A_plus"] is True


def test_break_retest_still_requires_candle_control():
    b = spec()["key_level_semantics"]["break_retest"]
    assert b["valid_zone_interaction"] is True
    assert b["candle_control_still_required"] is True


def test_hard_order_builds_range_aware_sr_fvg_map_before_candle_story_and_force():
    order = spec()["hard_entry_order"]
    build = "BUILD_CAUSAL_SUPPORT_RESISTANCE_AND_ACTIVE_FVG_INTERACTION_MAP"
    reach = "PRICE_REACHES_AUTHORIZED_SR_OR_FVG_OR_MATCHES_ONE_OF_TWO_FROZEN_PREBREAK_EXCEPTIONS"
    story = "READ_5M_CANDLESTICK_GEOMETRY_AND_MULTI_CANDLE_CONTROL_STORY"
    force = "REQUIRE_SUSTAINED_INTRA_CANDLE_DIRECTIONAL_FORCE_FROM_CAUSAL_1M_RECONSTRUCTION"
    assert order.index(build) < order.index(reach)
    assert order.index(reach) < order.index(story)
    assert order.index(story) < order.index(force)
