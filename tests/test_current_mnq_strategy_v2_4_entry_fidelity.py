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
    weak_first_break_print,
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


def test_lone_zone_touching_momentum_cannot_self_confirm_rejection_story():
    p = core.Params()
    q = frame([
        (104.0, 104.5, 103.5, 104.2),
        (103.8, 104.0, 103.0, 103.3),
        (103.1, 103.4, 102.4, 102.7),
        (102.6, 102.9, 101.8, 102.0),
        (99.2, 101.8, 99.0, 101.6),
    ])
    ts = q.index[-1]
    story = reversal_story_v24(q, ts, q.iloc[-1], "L", loc("S", 99.0, 100.0), p, pad=0.10)
    assert momentum_bar(q.iloc[-1], "L", p)
    assert not story.complete


def test_first_break_print_is_setup_then_next_momentum_pushes_past_it():
    p = core.Params()
    q = frame([
        (99.5, 100.5, 99.0, 100.2),
        (100.2, 101.4, 100.0, 101.2),
        (101.1, 103.0, 101.0, 102.8),
    ])
    resistance = loc("R", 100.0, 101.0)
    assert first_break_print(q.iloc[:-1], q.index[-2], q.iloc[-2], "L", resistance)
    assert float(q.iloc[-1].high) > float(q.iloc[-2].high)
    assert breakout_followthrough_after_first_print(
        q, q.index[-1], q.iloc[-1], "L", resistance, p,
    )


def test_second_5m_momentum_cannot_confirm_without_pushing_past_first_print_extreme():
    p = core.Params()
    resistance = loc("R", 100.0, 101.0)
    long_q = frame([
        (99.5, 100.5, 99.0, 100.2),
        (100.2, 103.0, 100.0, 102.4),
        (102.0, 102.9, 101.8, 102.8),
    ])
    assert first_break_print(long_q.iloc[:-1], long_q.index[-2], long_q.iloc[-2], "L", resistance)
    assert momentum_bar(long_q.iloc[-1], "L", p)
    assert not breakout_followthrough_after_first_print(
        long_q, long_q.index[-1], long_q.iloc[-1], "L", resistance, p,
    )

    support = loc("S", 100.0, 101.0)
    short_q = frame([
        (101.5, 102.0, 100.8, 101.4),
        (101.2, 101.4, 98.0, 98.6),
        (99.0, 99.2, 98.1, 98.2),
    ])
    assert first_break_print(short_q.iloc[:-1], short_q.index[-2], short_q.iloc[-2], "S", support)
    assert momentum_bar(short_q.iloc[-1], "S", p)
    assert not breakout_followthrough_after_first_print(
        short_q, short_q.index[-1], short_q.iloc[-1], "S", support, p,
    )


def test_second_5m_short_momentum_confirms_once_it_pushes_below_first_print_low():
    p = core.Params()
    support = loc("S", 100.0, 101.0)
    q = frame([
        (101.5, 102.0, 100.8, 101.4),
        (101.2, 101.4, 98.0, 98.6),
        (98.8, 99.0, 96.5, 96.8),
    ])
    assert first_break_print(q.iloc[:-1], q.index[-2], q.iloc[-2], "S", support)
    assert float(q.iloc[-1].low) < float(q.iloc[-2].low)
    assert breakout_followthrough_after_first_print(
        q, q.index[-1], q.iloc[-1], "S", support, p,
    )


def test_only_non_momentum_first_break_arms_weak_15m_path():
    p = core.Params()
    resistance = loc("R", 100.0, 101.0)
    weak = frame([
        (99.5, 100.5, 99.0, 100.2),
        (101.0, 102.0, 100.8, 101.2),
    ])
    strong = frame([
        (99.5, 100.5, 99.0, 100.2),
        (100.2, 102.5, 100.0, 102.3),
    ])
    assert first_break_print(weak, weak.index[-1], weak.iloc[-1], "L", resistance)
    assert not momentum_bar(weak.iloc[-1], "L", p)
    assert weak_first_break_print(weak, weak.index[-1], weak.iloc[-1], "L", resistance, p)
    assert first_break_print(strong, strong.index[-1], strong.iloc[-1], "L", resistance)
    assert momentum_bar(strong.iloc[-1], "L", p)
    assert not weak_first_break_print(strong, strong.index[-1], strong.iloc[-1], "L", resistance, p)


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


def test_adjacent_bars_sitting_on_level_do_not_fake_a_repeat_test():
    p = core.Params()
    resistance = loc("R", 100.0, 101.0)
    q = frame([
        (98.0, 98.6, 97.8, 98.4),
        (98.4, 99.2, 98.2, 99.0),
        (99.4, 100.4, 99.2, 100.1),
        (100.0, 100.7, 99.7, 100.4),
        (100.2, 100.8, 99.9, 100.5),
        (99.7, 100.95, 99.6, 100.8),
    ])
    ts = q.index[-1]
    assert momentum_bar(q.iloc[-1], "L", p)
    assert not repeat_test_momentum_prebreak(
        q, ts, q.iloc[-1], "L", resistance, p, pad=0.10,
    )


def test_displacement_prebreak_is_about_third_candle_momentum_not_fvg():
    p = core.Params()
    resistance = loc("R", 105.0, 106.0)
    q = frame([
        (100.0, 100.8, 99.8, 100.5),
        (100.5, 101.3, 100.3, 101.0),
        (101.0, 101.9, 100.8, 101.5),
        (101.5, 103.6, 101.4, 103.3),
        (103.3, 104.2, 103.2, 104.1),
        (103.8, 105.0, 103.5, 104.9),
    ])
    ts = q.index[-1]
    # Candle 1 of the drive is true displacement. Candle 2 is strong momentum
    # but not displacement. Candle 3 retains momentum into the key level.
    assert displacement_bar(q.iloc[-3], "L", p, reference_range=1.0)
    assert momentum_bar(q.iloc[-2], "L", p)
    assert not displacement_bar(q.iloc[-2], "L", p, reference_range=1.0)
    assert momentum_bar(q.iloc[-1], "L", p)
    # Deliberately no classic bullish 3-candle FVG between drive candle 1 and
    # candle 3. The entry must still qualify because FVG is not the trigger.
    assert float(q.iloc[-1].low) <= float(q.iloc[-3].high)
    assert displacement_sequence_prebreak(q, ts, q.iloc[-1], "L", resistance, p, pad=0.10)

    reversed_third = q.copy()
    reversed_third.iloc[-1] = (104.9, 105.0, 104.1, 104.2)
    assert not displacement_sequence_prebreak(
        reversed_third, ts, reversed_third.iloc[-1], "L", resistance, p, pad=0.10,
    )

    no_displacement = q.copy()
    no_displacement.iloc[-3] = (102.3, 103.3, 102.2, 103.1)
    assert momentum_bar(no_displacement.iloc[-3], "L", p)
    assert not displacement_bar(no_displacement.iloc[-3], "L", p, reference_range=1.0)
    assert not displacement_sequence_prebreak(
        no_displacement, ts, no_displacement.iloc[-1], "L", resistance, p, pad=0.10,
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


def test_range_room_premarket_prior_stays_structure_only_and_never_rebuilds_prior_maps(monkeypatch):
    """RETIREMENT, with its warrant.

    This replaces test_range_room_reconstructs_optional_previous_close_context, which
    asserted the OPPOSITE: that `_range_room_authorization` must reconstruct a previous-close
    map via `core.prev_maps` and pass it into `core.premarket_plan`.

    The two commits, in order:
      39b44442  2026-08-18 22:28 -0400  test(mnq-v2.4): cover optional range-room premarket context
      36e60654  2026-08-20 23:45 -0400  fix(mnq-v2.4): remove prior-day/week inputs from active premarket prior

    The trader correction landed TWO DAYS AFTER the test and orphaned it. `build_premarket_plan_v24`
    now calls `core.premarket_plan(full5, dte, {}, {}, {})` with deliberately empty maps, and
    `tests/test_current_mnq_strategy_v2_4_premarket.py` asserts `seen["pcm"] == {}` — the exact
    inverse of the retired assertion, and it passes. Two tests demanded contradictory behaviour
    from one call; the newer one carries the operator's correction, which outranks every older
    interpretation. The operator restated it directly on 2026-08-21: "i dont use pdh."

    Greening the old test would have meant IMPLEMENTING the previous-close context flow that the
    PR body ("previous-close gap scoring are disabled"), the premarket docstring ("cannot
    contribute to score or location state"), and the evidence registry ("PDH/PDL/PWH/PWL are
    forbidden") all prohibit. "Fix the source, not the assertion" does not apply when the
    assertion IS the stale artifact.

    THE STRONGEST WARRANT, found after the retirement was already committed. I had argued
    from the PR body's phrase "previous-close gap scoring are disabled", and flagged as my own
    weakest joint that banning previous-close GAP SCORING is not the same as banning previous
    close as an INPUT. The frozen contract closes that distinction directly.
    `research/current_mnq_strategy_v2_4_premarket_semantics.json`, verbatim:

        "this strategy does not use PDH/PDL/PWH/PWL or prior-close/gap reference levels.
         The prior is built only from causal premarket net movement, candle control and
         higher/lower structure and is never a standalone signal."

    "or prior-close/gap REFERENCE LEVELS" bans the reference itself, not merely a scoring use
    of it. The trader fidelity addendum agrees - it carries the key
    `premarket_prior_must_not_use_named_daily_weekly_levels_or_prior_close_gap_score` and
    lists as SUPERSEDED: "Any older contract using previous-close gap scoring as part of this
    strategy's premarket prior." The retired test was such an older contract.

    Do not confuse this with the other "gap" in the addendum: the trader's $400 TP-display gap
    is distance-to-target, an entirely separate concept, and it is very much live.

    Measured, not inherited from a docstring: `core.premarket_plan` reads the maps as
    `if dte in pdm`, `pwm.get(dte)` and `prev_close = pcm.get(dte)`, so passing `{}` returns
    None and the gap scoring genuinely fail-closes.
    """
    p = core.Params()
    pm = frame(
        [(105.0, 110.0, 100.0, 105.0)] * 12,
        start="2026-08-18 04:00", freq="25min",
    )
    env = {"full5": pm, "pdm": {}, "pwm": {}}
    seen = {}
    called = {"prev_maps": 0}

    def spy_prev_maps(*args, **kwargs):
        called["prev_maps"] += 1
        return ({}, {}, {"2026-08-18": 104.0})

    def spy_plan(full5, dte, pdm, pwm, pcm):
        seen.update(pdm=pdm, pwm=pwm, pcm=pcm)
        return SimpleNamespace(pm_structure="TREND")

    monkeypatch.setattr(core, "prev_maps", spy_prev_maps)
    monkeypatch.setattr(core, "premarket_plan", spy_plan)

    out = _range_room_authorization(
        [loc("R", 140.0, 141.0, "FAR")], env,
        pd.Timestamp("2026-08-18").date(),
        pd.Timestamp("2026-08-18 09:30", tz=core.TZ), p,
    )

    # The prior is STRUCTURE-ONLY: every named daily/weekly/close map arrives empty.
    assert seen["pcm"] == {}, (
        "a previous-close map reached the premarket prior; v2.4 forbids previous-close "
        "gap scoring"
    )
    assert seen["pdm"] == {} and seen["pwm"] == {}, (
        "a prior-day or prior-week map reached the premarket prior; PDH/PDL/PWH/PWL are "
        "forbidden inputs"
    )
    # Positive witness that the path actually ran, so the two assertions above are not
    # vacuously true on a call that never happened.
    assert seen, "premarket_plan was never called - the assertions above proved nothing"
    # And the forbidden reconstruction must not be attempted at all, not merely discarded.
    assert called["prev_maps"] == 0, (
        "_range_room_authorization called prev_maps to rebuild prior-day/close context. "
        "The OFF branch must refuse, not fetch and discard."
    )
    # Non-MIXED structure leaves authorization untouched, as before.
    assert out[0].entry_authorized is True
