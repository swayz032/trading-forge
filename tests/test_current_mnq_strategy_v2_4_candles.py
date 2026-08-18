from __future__ import annotations

import pandas as pd

from research.current_mnq_strategy_v2_4_candles import (
    Interaction,
    classify_patterns,
    evaluate_at_zone,
)


def bars(rows):
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"])


def test_bullish_engulfing_is_recognized_but_has_zero_authority_away_from_zone():
    q = bars([
        (100.0, 100.5, 98.5, 99.0),
        (98.75, 101.0, 98.5, 100.75),
    ])
    ev = classify_patterns(q)
    assert "BULLISH_ENGULFING" in ev.patterns
    d = evaluate_at_zone(q, "S", 90.0, 91.0)
    assert not d.reached_zone
    assert not d.reversal_long_confirmed
    assert d.reason == "NO_ZONE_INTERACTION_PATTERN_HAS_ZERO_AUTHORITY"


def test_support_hammer_rejection_confirms_buyer_control_only_at_support():
    q = bars([
        (102.0, 102.5, 101.5, 101.75),
        (101.5, 102.0, 99.0, 101.75),
    ])
    d = evaluate_at_zone(q, "S", 99.0, 100.0)
    assert d.reached_zone
    assert "HAMMER_GEOMETRY" in d.patterns
    assert d.reversal_long_confirmed
    assert not d.breakout_short_confirmed


def test_resistance_shooting_star_confirms_seller_control_only_at_resistance():
    q = bars([
        (99.0, 99.75, 98.75, 99.5),
        (99.75, 102.5, 99.5, 100.0),
    ])
    d = evaluate_at_zone(q, "R", 101.5, 102.5)
    assert d.reached_zone
    assert "SHOOTING_STAR_GEOMETRY" in d.patterns
    assert d.reversal_short_confirmed


def test_strong_bullish_close_through_resistance_is_breakout_not_rejection():
    q = bars([
        (99.0, 100.0, 98.75, 99.5),
        (99.5, 103.0, 99.25, 102.75),
    ])
    d = evaluate_at_zone(q, "R", 100.0, 101.0)
    assert d.interaction == Interaction.BREAK_CLOSE_UP.value
    assert d.breakout_long_confirmed
    assert not d.reversal_short_confirmed


def test_strong_bearish_close_through_support_is_breakout_not_rejection():
    q = bars([
        (102.0, 102.25, 101.5, 101.75),
        (101.75, 102.0, 98.0, 98.25),
    ])
    d = evaluate_at_zone(q, "S", 100.0, 101.0)
    assert d.interaction == Interaction.BREAK_CLOSE_DOWN.value
    assert d.breakout_short_confirmed
    assert not d.reversal_long_confirmed


def test_sweep_below_support_then_reclaim_counts_as_failed_seller_push():
    q = bars([
        (101.0, 101.5, 100.5, 101.25),
        (100.5, 101.75, 98.75, 100.75),
    ])
    d = evaluate_at_zone(q, "S", 99.5, 100.5)
    assert d.interaction == Interaction.SWEEP_RECLAIM_UP.value
    assert d.bullish_control
    assert d.reversal_long_confirmed


def test_doji_at_zone_without_directional_takeover_waits():
    q = bars([
        (100.0, 100.5, 99.5, 100.25),
        (100.0, 101.0, 99.0, 100.05),
    ])
    d = evaluate_at_zone(q, "S", 99.5, 100.5)
    assert "DOJI" in d.patterns
    assert d.indecision
    assert not d.reversal_long_confirmed
    assert not d.breakout_short_confirmed


def test_morning_star_and_evening_star_are_recognized_as_multi_candle_control():
    morning = bars([
        (103.0, 103.25, 99.5, 100.0),
        (100.0, 100.5, 99.5, 100.1),
        (100.0, 102.75, 99.75, 102.5),
    ])
    mev = classify_patterns(morning)
    assert "MORNING_STAR" in mev.patterns
    assert mev.bullish_reversal

    evening = bars([
        (100.0, 103.25, 99.75, 103.0),
        (103.0, 103.5, 102.5, 103.1),
        (103.0, 103.25, 100.25, 100.5),
    ])
    eev = classify_patterns(evening)
    assert "EVENING_STAR" in eev.patterns
    assert eev.bearish_reversal
