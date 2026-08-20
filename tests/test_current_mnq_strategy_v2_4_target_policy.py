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


def test_tp1_with_valid_room_still_wins():
    p = base.core.Params(stop=17.25, min_room_r=1.0)
    tp1 = _dest("tp1", 120, 124, "LIQUIDITY_CLUSTER", 20, 122)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 50, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 100.0, "L", "REV", p, False,
    )
    assert picked is not None
    assert picked.location.id == "tp1"
    assert reason == "FIRST_REACTION:LIQUIDITY_CLUSTER"


def test_tp1_already_too_close_at_actual_entry_rolls_to_tp2():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    # Same frozen room equation as the strategy: 25.875 points. TP1 is only 10
    # points away by the time the A+ entry becomes actionable, while TP2 still has room.
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 10, 111)
    tp2 = _dest("tp2", 150, 160, "FVG_15M", 50, 155)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 100.0, "L", "REV", p, False,
    )
    assert picked is not None
    assert picked.location.id == "tp2"
    assert picked.raw_price == 155
    assert reason.startswith("FIRST_REACTION_ROLLOVER:")
    assert "->NEXT:FVG_15M" in reason


def test_tp_rollover_is_direction_symmetric_for_short():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 188, 190, "LIQUIDITY_CLUSTER", 10, 189)
    tp2 = _dest("tp2", 140, 150, "FVG_15M", 50, 145)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 200.0, "S", "REV", p, False,
    )
    assert picked is not None
    assert picked.location.id == "tp2"
    assert reason.startswith("FIRST_REACTION_ROLLOVER:")


def test_all_meaningful_targets_too_close_remains_no_trade():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 10, 111)
    tp2 = _dest("tp2", 118, 120, "FVG_15M", 18, 119)
    picked, reason = pol.classify_first_reaction_destination(
        [tp1, tp2], 100.0, "L", "REV", p, False,
    )
    assert picked is None
    assert reason.startswith("ALL_MEANINGFUL_REACTIONS_TOO_CLOSE:")


def test_weak_near_blocker_is_not_promoted_to_tp_ladder():
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


def test_fvg_target_keeps_midpoint_precision_after_rollover():
    p = base.core.Params(stop=17.25, min_room_r=1.5)
    tp1 = _dest("tp1", 110, 112, "LIQUIDITY_CLUSTER", 10, 111)
    # Active 15m FVG midpoint semantics remain inherited from the base builder.
    tp2 = _dest("fvg2", 150, 160, "FVG_15M", 50, 155)
    picked, _ = pol.classify_first_reaction_destination(
        [tp1, tp2], 100.0, "L", "REV", p, False,
    )
    assert picked is not None
    assert picked.raw_price == 155
    assert picked.location.source == base.FVG_SOURCE


def test_historical_and_live_engines_are_wired_to_same_target_policy():
    from research import current_mnq_strategy_v2_4_engine as engine
    from research import current_mnq_strategy_v2_4_signal as signal

    assert engine.build_and_classify is pol.build_and_classify
    assert signal.build_and_classify is pol.build_and_classify
