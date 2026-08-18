from __future__ import annotations

import pandas as pd

from research.current_mnq_strategy_v2_4_gate import gate_candidate


def bars(rows):
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"])


def test_famous_pattern_midrange_is_still_no_trade():
    q = bars([
        (100.0, 100.5, 98.5, 99.0),
        (98.75, 101.0, 98.5, 100.75),
    ])
    g = gate_candidate(
        bars=q, zone_side="S", zone_lo=90, zone_hi=91,
        direction="L", setup="REV",
    )
    assert not g.allowed
    assert g.reason == "NO_ZONE_NO_TRADE"


def test_support_rejection_plus_bullish_control_allows_reversal_long():
    q = bars([
        (102.0, 102.5, 101.5, 101.75),
        (101.5, 102.0, 99.0, 101.75),
    ])
    g = gate_candidate(
        bars=q, zone_side="S", zone_lo=99, zone_hi=100,
        direction="L", setup="REV",
    )
    assert g.allowed


def test_weak_breakout_requires_new_15m_acceptance_even_after_zone_break():
    q = bars([
        (99.0, 100.0, 98.75, 99.5),
        (99.5, 102.0, 99.25, 101.25),
    ])
    waiting = gate_candidate(
        bars=q, zone_side="R", zone_lo=100, zone_hi=101,
        direction="L", setup="BRK15", fifteen_minute_acceptance=False,
    )
    assert not waiting.allowed
    assert waiting.reason == "WAIT_FOR_NEW_COMPLETED_15M_ACCEPTANCE"
    confirmed = gate_candidate(
        bars=q, zone_side="R", zone_lo=100, zone_hi=101,
        direction="L", setup="BRK15", fifteen_minute_acceptance=True,
    )
    assert confirmed.allowed


def test_touch_without_control_does_not_become_trade():
    q = bars([
        (100.0, 100.5, 99.5, 100.25),
        (100.0, 101.0, 99.0, 100.05),
    ])
    g = gate_candidate(
        bars=q, zone_side="S", zone_lo=99.5, zone_hi=100.5,
        direction="L", setup="REV",
    )
    assert not g.allowed
    assert g.reason == "ZONE_REACHED_REVERSAL_NOT_CONFIRMED"


def test_real_user_range_on_key_level_waits_for_momentum_breakout():
    """User gold NT01: chop on the key level is WAIT, not breakout authority."""
    ranging = bars([
        (100.8, 101.2, 99.4, 100.2),
        (100.2, 100.9, 99.2, 100.5),
        (100.5, 101.1, 99.5, 100.1),
        (100.1, 100.8, 99.3, 100.3),
    ])
    waiting = gate_candidate(
        bars=ranging, zone_side="S", zone_lo=99.0, zone_hi=101.0,
        direction="S", setup="BRK5",
    )
    assert not waiting.allowed
    assert waiting.reason == "ZONE_REACHED_5M_BREAKOUT_NOT_CONFIRMED"

    breakout = pd.concat([
        ranging,
        bars([(100.0, 100.3, 97.0, 97.4)]),
    ], ignore_index=True)
    confirmed = gate_candidate(
        bars=breakout, zone_side="S", zone_lo=99.0, zone_hi=101.0,
        direction="S", setup="BRK5",
    )
    assert confirmed.allowed
    assert confirmed.reason == "SUPPORT_BREAK_BEARISH_ACCEPTANCE"
