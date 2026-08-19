from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_entries import (
    breakout_followthrough_after_first_print,
    displacement_bar,
    displacement_sequence_prebreak,
    fifteen_minute_three_bar_continuation,
    first_break_print,
    momentum_bar,
    repeat_test_momentum_prebreak,
    reversal_story_v24,
)
from research.current_mnq_strategy_v2_4_levels import _range_room_authorization

core = prod.core


def frame(rows, start="2026-08-18 09:30", freq="5min"):
    idx = pd.date_range(start, periods=len(rows), freq=freq, tz=core.TZ)
    return pd.DataFrame(rows, index=idx, columns=["open", "high", "low", "close"])


def loc(side: str, lo: float, hi: float, ident: str = "L1"):
    return core.Location(
        id=ident, side=side, lo=lo, hi=hi, mid=(lo + hi) / 2.0,
        source="TEST", quality=0.9, confluence=2, entry_authorized=True, zone=None,
    )


def test_momentum_is_not_automatically_displacement():
    p = core.Params()
    ordinary = pd.Series({"open": 100.0, "high": 110.0, "low": 99.5, "close": 109.0})
    expanded = pd.Series({"open": 100.0, "high": 114.0, "low": 99.5, "close": 113.0})
    assert momentum_bar(ordinary, "L", p)
    assert not displacement_bar(ordinary, "L", p, reference_range=10.0)
    assert displacement_bar(expanded, "L", p, reference_range=10.0)


def test_doji_rejection_then_non_displacement_momentum_can_confirm_reversal():
    p = core.Params()
    q = frame([
        (103.0, 103.5, 102.0, 102.5),
        (102.5, 103.0, 101.0, 101.5),
        (101.5, 102.0, 100.5, 100.8),
        (100.2, 100.8, 99.0, 100.25),
        (100.7, 102.7, 100.7, 102.5),
    ])
    ts = q.index[-1]
    story = reversal_story_v24(q, ts, q.iloc[-1], "L", loc("S", 99.0, 100.0), p, pad=0.25)
    assert story.complete
    assert story.takeover
    assert story.decision
    assert not story.displacement


def test_first_break_print_is_setup_then_next_momentum_confirms():
    p = core.Params()
    q = frame([
        (99.5, 100.5, 99.0, 100.2),
        (100.2, 101.4, 100.0, 101.2),
        (101.1, 103.0, 101.0, 102.8),
    ])
    resistance = loc("R", 100.0, 101.0)
    assert first_break_print(q.iloc[:-1], q.index[-2], q.iloc[-2], "L", resistance)
    assert breakout_followthrough_after_first_print(
        q, q.index[-1], q.iloc[-1], "L", resistance, p,
    )


def test_repeat_test_momentum_is_allowed_prebreak_but_first_approach_is_not():
    p = core.Params()
    resistance = loc("R", 100.0, 101.0)
    prior_test = frame([
        (98.5, 99.0, 98.0, 98.8),
        (98.8, 100.8, 98.5, 100.2),
        (99.0, 99.4, 98.6, 99.1),
        (99.1, 99.5, 98.9, 99.3),
        (99.3, 99.6, 99.0, 99.4),
        (99.6, 100.95, 99.5, 100.8),
    ])
    ts = prior_test.index[-1]
    assert repeat_test_momentum_prebreak(
        prior_test, ts, prior_test.iloc[-1], "L", resistance, p, pad=0.10,
    )

    first_approach = frame([
        (97.0, 97.5, 96.8, 97.2),
        (97.2, 97.8, 97.0, 97.5),
        (97.5, 98.0, 97.3, 97.8),
        (97.8, 98.4, 97.7, 98.2),
        (98.2, 98.8, 98.0, 98.6),
        (99.6, 100.95, 99.5, 100.8),
    ])
    ts2 = first_approach.index[-1]
    assert not repeat_test_momentum_prebreak(
        first_approach, ts2, first_approach.iloc[-1], "L", resistance, p, pad=0.10,
    )


def test_displacement_prebreak_requires_two_expanded_bars_and_third_momentum():
    p = core.Params()
    resistance = loc("R", 105.0, 106.0)
    q = frame([
        (100.0, 100.8, 99.8, 100.5),
        (100.5, 101.3, 100.3, 101.0),
        (101.0, 101.9, 100.8, 101.5),
        (101.5, 103.6, 101.4, 103.3),
        (103.3, 104.7, 103.2, 104.5),
        (104.4, 104.95, 104.35, 104.9),
    ])
    ts = q.index[-1]
    assert displacement_sequence_prebreak(q, ts, q.iloc[-1], "L", resistance, p, pad=0.10)

    reversed_third = q.copy()
    reversed_third.iloc[-1] = (104.9, 104.95, 104.1, 104.2)
    assert not displacement_sequence_prebreak(
        reversed_third, ts, reversed_third.iloc[-1], "L", resistance, p, pad=0.10,
    )


def test_weak_break_pullback_15m_three_bar_continuation():
    p = core.Params()
    h15 = frame([
        (100.5, 101.8, 100.2, 101.5),
        (101.5, 101.6, 100.4, 101.0),
        (101.0, 103.0, 100.9, 102.8),
    ], start="2026-08-18 10:00", freq="15min")
    pending = core.PendingBreakout("L", "R1", pd.Timestamp("2026-08-18 10:05", tz=core.TZ), 100.0, 101.0)
    confirmed = fifteen_minute_three_bar_continuation(
        h15, pending, pd.Timestamp("2026-08-18 10:45", tz=core.TZ), p,
    )
    assert confirmed == pd.Timestamp("2026-08-18 10:45", tz=core.TZ)


def test_range_day_near_zone_loses_entry_authority_but_is_preserved(monkeypatch):
    p = core.Params()
    pm = frame(
        [(105.0, 110.0, 100.0, 105.0)] * 12,
        start="2026-08-18 04:00", freq="25min",
    )
    env = {"full5": pm, "pdm": {}, "pwm": {}, "pcm": {}}
    monkeypatch.setattr(core, "premarket_plan", lambda *args, **kwargs: SimpleNamespace(pm_structure="MIXED"))
    near = loc("R", 115.0, 116.0, "NEAR")
    far = loc("R", 140.0, 141.0, "FAR")
    out = _range_room_authorization(
        [near, far], env, pd.Timestamp("2026-08-18").date(),
        pd.Timestamp("2026-08-18 09:30", tz=core.TZ), p,
    )
    assert [x.id for x in out] == ["NEAR", "FAR"]
    assert out[0].entry_authorized is False
    assert out[1].entry_authorized is True


def test_range_room_reconstructs_optional_previous_close_context(monkeypatch):
    p = core.Params()
    pm = frame(
        [(105.0, 110.0, 100.0, 105.0)] * 12,
        start="2026-08-18 04:00", freq="25min",
    )
    env = {"full5": pm, "pdm": {}, "pwm": {}}
    seen = {}
    monkeypatch.setattr(core, "prev_maps", lambda *args, **kwargs: ({}, {}, {"2026-08-18": 104.0}))

    def fake_plan(full5, dte, pdm, pwm, pcm):
        seen["pcm"] = pcm
        return SimpleNamespace(pm_structure="TREND")

    monkeypatch.setattr(core, "premarket_plan", fake_plan)
    out = _range_room_authorization(
        [loc("R", 140.0, 141.0, "FAR")], env,
        pd.Timestamp("2026-08-18").date(),
        pd.Timestamp("2026-08-18 09:30", tz=core.TZ), p,
    )
    assert seen["pcm"] == {"2026-08-18": 104.0}
    assert out[0].entry_authorized is True
