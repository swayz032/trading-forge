from __future__ import annotations

from research import current_mnq_strategy_v2_4_target_policy as pol
from research import current_mnq_strategy_v2_4_targets as base


def _loc(name, lo, hi, source="WICK_ZONE", quality=0.8):
    return base.core.Location(name, "B", lo, hi, (lo + hi) / 2, source, quality, 0, False, None)


def _dest(name, lo, hi, kind, contact, raw, meaningful=True, quality=0.8):
    return base.ReactionDestination(
        _loc(name, lo, hi, base.FVG_SOURCE if kind == "FVG_15M" else "WICK_ZONE", quality),
        kind, contact, raw, quality, meaningful, kind == "FVG_15M",
    )


def test_tp_display_gap_uses_planned_target_price_not_first_contact_edge():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    # The reaction band starts only 5 points away, but the trader's actual planned
    # TP line is 13.5 points away. At 15 MNQ this displays $405 and is allowed.
    tp1 = _dest("tp1", 105, 114, "LIQUIDITY_CLUSTER", 5, 113.5)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1], 100.0, "L", "REV", p, False,
    )
    assert picked is not None
    assert picked.location.id == "tp1"
    assert picked.executable_price == 113.5
    assert picked.reference_tp_reward_usd == 405.0
    assert reason == "FIRST_REACTION:LIQUIDITY_CLUSTER"


def test_first_tick_below_400_reference_reward_blocks_immediate_entry():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    # 13.25 MNQ points * $2 * 15 = $397.50, so it is under the trader's $400 floor.
    tp1 = _dest("tp1", 110, 114, "LIQUIDITY_CLUSTER", 10, 113.25)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1], 100.0, "L", "REV", p, False,
    )
    assert picked is None
    assert reason.startswith("TP1_REFERENCE_REWARD_UNDER_400:397.50:")


def test_untouched_close_tp1_cannot_be_blindly_leapfrogged_for_farther_tp2():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 114, "LIQUIDITY_CLUSTER", 10, 113.25)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 50, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 100.0, "L", "REV", p, False,
    )
    assert picked is None
    assert reason.startswith("TP1_REFERENCE_REWARD_UNDER_400:")


def test_under_400_rule_is_direction_symmetric_for_short():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 186, 190, "LIQUIDITY_CLUSTER", 10, 186.75)
    tp2 = _dest("tp2", 140, 150, "FVG_15M", 50, 145)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 200.0, "S", "REV", p, False,
    )
    assert picked is None
    assert reason.startswith("TP1_REFERENCE_REWARD_UNDER_400:397.50:")


def test_repeat_test_momentum_at_same_tp1_area_can_promote_tp2():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 1, 111)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 41, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 109.0, "L", "BRK5", p, True,
        entry_location=_loc("attack_tp1", 110, 112),
        candidate_reason="PREBREAK_REPEAT_TEST_INTRA5_FORCE",
    )
    assert picked is not None
    assert picked.location.id == "tp2"
    assert picked.raw_price == 155
    assert reason.startswith("PROCESSED_REACTION_ROLLOVER:")
    assert "->NEXT:FVG_15M" in reason


def test_completed_break_followthrough_at_same_tp1_area_can_promote_tp2():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 1, 111)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 41, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 109.0, "L", "BRK5", p, True,
        entry_location=_loc("attack_tp1", 110, 112),
        candidate_reason="FIRST_BREAK_PRINT_THEN_INTRA5_FORCE",
    )
    assert picked is not None
    assert picked.location.id == "tp2"
    assert reason.startswith("PROCESSED_REACTION_ROLLOVER:")


def test_true_displacement_prebreak_alone_does_not_process_under_400_tp1():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 1, 111)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 41, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 109.0, "L", "BRK5", p, True,
        entry_location=_loc("attack_tp1", 110, 112),
        candidate_reason="PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE",
    )
    assert picked is None
    assert reason.startswith("TP1_REFERENCE_REWARD_UNDER_400:")


def test_repeat_test_elsewhere_cannot_claim_tp1_was_processed():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 10, 111)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 50, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 100.0, "L", "BRK5", p, True,
        entry_location=_loc("unrelated", 90, 92),
        candidate_reason="PREBREAK_REPEAT_TEST_INTRA5_FORCE",
    )
    assert picked is None
    assert reason.startswith("TP1_REFERENCE_REWARD_UNDER_400:")


def test_weak_near_blocker_keeps_inherited_structural_room_contract():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    weak = _dest(
        "weak", 110, 112, "LIQUIDITY_CLUSTER", 10, 111,
        meaningful=False, quality=max(float(p.weak_blocker_quality) + 0.01, 0.8),
    )
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 50, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [weak, tp2], 100.0, "L", "REV", p, False,
    )
    assert picked is None
    assert reason.startswith("WEAK_NEAR_BLOCKER:")


def test_fvg_target_keeps_midpoint_precision_after_processed_reaction():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 1, 111)
    tp2 = _dest("fvg2", 150, 160, "FVG_15M", 41, 155)
    picked, _ = pol.classify_first_reaction_destination(
        [tp1, tp2], 109.0, "L", "BRK5", p, True,
        entry_location=_loc("attack_tp1", 110, 112),
        candidate_reason="PREBREAK_REPEAT_TEST_INTRA5_FORCE",
    )
    assert picked is not None
    assert picked.raw_price == 155
    assert picked.location.source == base.FVG_SOURCE


def test_400_reference_rule_is_signal_semantics_not_runtime_position_size():
    # The threshold is deliberately pinned to the trader's 15-MNQ reference display.
    assert pol.TP_GAP_REFERENCE_USD == 400.0
    assert pol.TP_GAP_REFERENCE_CONTRACTS == 15
    assert pol.reference_tp_reward_usd(13.25) == 397.5
    assert pol.reference_tp_reward_usd(13.5) == 405.0


def test_historical_and_live_engines_are_wired_to_same_target_policy():
    from research import current_mnq_strategy_v2_4_engine as engine
    from research import current_mnq_strategy_v2_4_signal as signal

    assert engine.build_and_classify is pol.build_and_classify
    assert signal.build_and_classify is pol.build_and_classify
