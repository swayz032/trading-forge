from __future__ import annotations

import json
from pathlib import Path


SPEC = Path(__file__).resolve().parents[1] / "research" / "current_mnq_strategy_v2_4_spec.json"


def spec():
    return json.loads(SPEC.read_text())


def test_candlestick_video_pack_is_joint_candle_and_key_level_evidence():
    s = spec()
    assert s["source_model"]["candlestick_video_pack_is_joint_candle_and_key_level_evidence"] is True
    assert s["source_model"]["location_and_pattern_must_be_interpreted_together"] is True


def test_key_level_semantics_require_quality_not_random_chart_lines():
    k = spec()["key_level_semantics"]
    assert "multiple_independent_rejections_or_wick_reactions" in k["primary_quality_evidence"]
    assert "strong_displacement_away_from_swing_high_or_low" in k["secondary_quality_evidence"]
    assert k["active_map_policy"]["avoid_chart_clutter"] is True
    assert k["active_map_policy"]["do_not_delete_farther_meaningful_destination"] is True


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


def test_hard_order_builds_key_level_map_before_candles():
    order = spec()["hard_entry_order"]
    assert order.index("BUILD_CAUSAL_KEY_LEVEL_MAP") < order.index("PRICE_REACHES_AUTHORIZED_ZONE")
    assert order.index("PRICE_REACHES_AUTHORIZED_ZONE") < order.index("READ_CANDLESTICK_PATTERN_AND_MULTI_CANDLE_CONTROL_STORY")
