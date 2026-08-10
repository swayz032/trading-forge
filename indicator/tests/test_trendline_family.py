from dataclasses import FrozenInstanceError

import pytest

from indicator.reference.trendline_family import (
    LineState,
    SwingKind,
    TrendDirection,
    TrendSwing,
    TrendTimeframe,
    TrendlineBoard,
    TrendlineSelectorConfig,
    ViolationConfig,
    build_board,
    build_child_line,
    build_family,
    build_root_line,
    observe_completed_close,
    repair_violated,
)

CFG = TrendlineSelectorConfig(
    root_swing_window=8,
    touch_tolerance=0.25,
    min_parent_separation=0.25,
)
VIO = ViolationConfig(penetration=0.25, required_consecutive_closes=2)


def sw(tf, kind, t, p, confirmed=None):
    return TrendSwing(tf, kind, t, t if confirmed is None else confirmed, p)


def test_root_bullish_uses_extreme_a_and_latest_clean_higher_low():
    pts = [
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 102),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 30, 104),
    ]
    line = build_root_line(pts, TrendDirection.BULLISH, TrendTimeframe.DAILY, 40, CFG)
    assert line.anchor_a.event_time == 10
    assert line.anchor_b.event_time == 30


def test_root_rejects_latest_candidate_when_intermediate_swing_cuts_through_ray():
    pts = [
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 103),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 30, 110),
    ]
    line = build_root_line(pts, TrendDirection.BULLISH, TrendTimeframe.DAILY, 40, CFG)
    assert line.anchor_b.event_time == 20


def test_child_point_a_is_exact_parent_point_b_and_two_points_minimum():
    parent = build_root_line(
        [sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100), sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 104)],
        TrendDirection.BULLISH,
        TrendTimeframe.DAILY,
        30,
        CFG,
    )
    child = build_child_line(
        parent,
        [sw(TrendTimeframe.H4, SwingKind.LOW, 25, 108), sw(TrendTimeframe.H4, SwingKind.LOW, 30, 112)],
        TrendTimeframe.H4,
        35,
        CFG,
    )
    assert child.anchor_a is parent.anchor_b
    assert child.anchor_a.event_time == 20
    assert child.anchor_b.event_time == 30


def test_family_skips_missing_timeframe_without_creating_orphan():
    data = {
        TrendTimeframe.DAILY: [
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 102),
        ],
        TrendTimeframe.H1: [
            sw(TrendTimeframe.H1, SwingKind.LOW, 25, 105),
            sw(TrendTimeframe.H1, SwingKind.LOW, 30, 107),
        ],
    }
    fam = build_family(data, TrendDirection.BULLISH, 40, CFG)
    assert [x.timeframe for x in fam] == [TrendTimeframe.DAILY, TrendTimeframe.H1]
    assert fam[1].parent_line_id == fam[0].line_id
    assert fam[1].anchor_a is fam[0].anchor_b


def test_child_rejects_same_path_duplicate():
    parent = build_root_line(
        [sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100), sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 110)],
        TrendDirection.BULLISH,
        TrendTimeframe.DAILY,
        30,
        CFG,
    )
    child = build_child_line(
        parent,
        [sw(TrendTimeframe.H4, SwingKind.LOW, 25, 115)],
        TrendTimeframe.H4,
        30,
        CFG,
    )
    assert child is None


def test_anchors_are_frozen_dataclasses():
    line = build_root_line(
        [sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100), sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 105)],
        TrendDirection.BULLISH,
        TrendTimeframe.DAILY,
        30,
        CFG,
    )
    with pytest.raises(FrozenInstanceError):
        line.anchor_a.price = 99


def test_violation_requires_two_source_timeframe_closes_and_reclaim_clears_breach():
    line = build_root_line(
        [sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100), sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 102)],
        TrendDirection.BULLISH,
        TrendTimeframe.DAILY,
        30,
        CFG,
    )
    x = observe_completed_close(line, 30, 103.5, VIO)
    assert x.state == LineState.BREACHED and x.breach_streak == 1
    y = observe_completed_close(x, 40, 106.5, VIO)
    assert y.state == LineState.ACTIVE and y.breach_streak == 0
    z1 = observe_completed_close(y, 50, 107.0, VIO)
    z2 = observe_completed_close(z1, 60, 108.0, VIO)
    assert z2.state == LineState.VIOLATED and z2.breach_streak == 2
    z3 = observe_completed_close(z2, 70, 120.0, VIO)
    assert z3.state == LineState.VIOLATED


def test_bearish_violation_is_mirror_direction():
    line = build_root_line(
        [sw(TrendTimeframe.DAILY, SwingKind.HIGH, 10, 120), sw(TrendTimeframe.DAILY, SwingKind.HIGH, 20, 116)],
        TrendDirection.BEARISH,
        TrendTimeframe.DAILY,
        30,
        CFG,
    )
    a = observe_completed_close(line, 30, 113, VIO)
    b = observe_completed_close(a, 40, 110, VIO)
    assert b.state == LineState.VIOLATED


def test_repair_changes_only_violated_slots_and_preserves_valid_geometry():
    data0 = {
        TrendTimeframe.DAILY: [
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 102),
            sw(TrendTimeframe.DAILY, SwingKind.HIGH, 10, 130),
            sw(TrendTimeframe.DAILY, SwingKind.HIGH, 20, 126),
        ],
        TrendTimeframe.H4: [
            sw(TrendTimeframe.H4, SwingKind.LOW, 25, 106),
            sw(TrendTimeframe.H4, SwingKind.HIGH, 25, 122),
        ],
    }
    board = build_board(data0, 30, CFG)
    green_daily = board.line("G-1D")
    red_daily = board.line("R-1D")
    violated_green = observe_completed_close(
        observe_completed_close(green_daily, 30, 103, VIO), 40, 104, VIO
    )
    lines = tuple(violated_green if x.line_id == "G-1D" else x for x in board.lines)
    broken = TrendlineBoard(lines=lines)

    data1 = dict(data0)
    data1[TrendTimeframe.DAILY] = list(data0[TrendTimeframe.DAILY]) + [
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 50, 108),
    ]
    repaired = repair_violated(broken, data1, 60, CFG)

    assert repaired.line("R-1D") == red_daily
    assert repaired.line("G-1D").revision == green_daily.revision + 1
    assert repaired.line("G-1D").anchor_b.event_time == 50
    assert repaired.line("G-1D").state == LineState.ACTIVE
    assert any(h.line_id == "G-1D" and h.state == LineState.REPLACED for h in repaired.history)


def test_repair_fail_closed_when_no_later_b_exists():
    data = {
        TrendTimeframe.DAILY: [
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 102),
        ]
    }
    board = build_board(data, 30, CFG)
    g = board.line("G-1D")
    g = observe_completed_close(observe_completed_close(g, 30, 103, VIO), 40, 104, VIO)
    broken = TrendlineBoard(lines=(g,))
    repaired = repair_violated(broken, data, 50, CFG)
    assert repaired.line("G-1D") == g
    assert repaired.history == ()


def test_visibility_is_independent_of_geometry_and_can_be_restored():
    data = {
        TrendTimeframe.DAILY: [
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
            sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 102),
        ]
    }
    board = build_board(data, 30, CFG)
    original = board.line("G-1D")
    hidden = board.set_visible("G-1D", False)
    assert hidden.visible_lines() == ()
    restored = hidden.set_visible("G-1D", True)
    assert restored.line("G-1D") == original


def test_no_future_leak_uses_confirmed_time_not_pivot_time():
    pts = [
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100, confirmed=12),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 103, confirmed=25),
    ]
    assert build_root_line(pts, TrendDirection.BULLISH, TrendTimeframe.DAILY, 24, CFG) is None
    assert build_root_line(pts, TrendDirection.BULLISH, TrendTimeframe.DAILY, 25, CFG) is not None


def test_bull_bear_mirror_geometry():
    bull = [
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 10, 100),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 20, 104),
        sw(TrendTimeframe.DAILY, SwingKind.LOW, 30, 108),
    ]
    bear = [
        sw(TrendTimeframe.DAILY, SwingKind.HIGH, p.event_time, 300 - p.price)
        for p in bull
    ]
    g = build_root_line(bull, TrendDirection.BULLISH, TrendTimeframe.DAILY, 40, CFG)
    r = build_root_line(bear, TrendDirection.BEARISH, TrendTimeframe.DAILY, 40, CFG)
    assert g.anchor_a.event_time == r.anchor_a.event_time
    assert g.anchor_b.event_time == r.anchor_b.event_time
    assert r.anchor_a.price == 300 - g.anchor_a.price
    assert r.anchor_b.price == 300 - g.anchor_b.price
