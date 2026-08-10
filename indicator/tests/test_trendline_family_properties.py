import random

from indicator.reference.trendline_family import (
    LineState,
    SwingKind,
    TrendDirection,
    TrendSwing,
    TrendTimeframe,
    TrendlineBoard,
    TrendlineSelectorConfig,
    ViolationConfig,
    build_family,
    observe_completed_close,
    repair_violated,
)

CFG = TrendlineSelectorConfig(root_swing_window=8, touch_tolerance=0.25, min_parent_separation=0.25)
VIO = ViolationConfig(penetration=0.25, required_consecutive_closes=2)


def _mk(tf, kind, t, p):
    return TrendSwing(tf, kind, t, t + 1, p)


def _synthetic_family(seed: int, direction: TrendDirection):
    rng = random.Random(seed)
    kind = SwingKind.LOW if direction == TrendDirection.BULLISH else SwingKind.HIGH
    sign = 1.0 if direction == TrendDirection.BULLISH else -1.0
    data = {}
    parent_t = 10
    parent_p = 100.0 if direction == TrendDirection.BULLISH else 200.0
    for idx, tf in enumerate((TrendTimeframe.DAILY, TrendTimeframe.H4, TrendTimeframe.H1, TrendTimeframe.M15, TrendTimeframe.M5)):
        pts = []
        if idx == 0:
            for j in range(4):
                t = 10 + j * 10
                p = parent_p + sign * (2.0 + rng.uniform(0.5, 1.5)) * j
                pts.append(_mk(tf, kind, t, p))
            parent_t, parent_p = pts[-1].event_time, pts[-1].price
        else:
            for j in range(1, 4):
                t = parent_t + j * (idx + 2)
                p = parent_p + sign * (3.0 * j + rng.uniform(0.5, 1.0))
                pts.append(_mk(tf, kind, t, p))
            parent_t, parent_p = pts[-1].event_time, pts[-1].price
        data[tf] = pts
    return data


def test_randomized_family_lineage_and_frozen_geometry_1000_paths():
    for seed in range(500):
        for direction in (TrendDirection.BULLISH, TrendDirection.BEARISH):
            fam = build_family(_synthetic_family(seed, direction), direction, 10_000, CFG)
            assert fam
            for line in fam:
                before = line.signature
                _ = line.price_at(line.anchor_b.event_time + 100)
                assert line.signature == before
            for parent, child in zip(fam, fam[1:]):
                assert child.anchor_a == parent.anchor_b
                assert child.parent_line_id == parent.line_id
                assert child.parent_revision == parent.revision


def test_randomized_repair_never_changes_nonviolated_slots_500_paths():
    for seed in range(500):
        data = _synthetic_family(seed, TrendDirection.BULLISH)
        fam = build_family(data, TrendDirection.BULLISH, 10_000, CFG)
        if len(fam) < 2:
            continue
        victim = fam[-1]
        projected1 = victim.price_at(20_000)
        projected2 = victim.price_at(20_100)
        adverse1 = projected1 - 1.0 if victim.direction == TrendDirection.BULLISH else projected1 + 1.0
        adverse2 = projected2 - 1.0 if victim.direction == TrendDirection.BULLISH else projected2 + 1.0
        broken = observe_completed_close(victim, 20_000, adverse1, VIO)
        broken = observe_completed_close(broken, 20_100, adverse2, VIO)
        assert broken.state == LineState.VIOLATED

        original = tuple(broken if x.line_id == victim.line_id else x for x in fam)
        board = TrendlineBoard(lines=original)
        before = {x.line_id: x for x in board.lines if x.line_id != victim.line_id}
        repaired = repair_violated(board, data, 30_000, CFG)
        after = {x.line_id: x for x in repaired.lines if x.line_id != victim.line_id}
        assert after == before


def test_duplicate_and_out_of_order_close_events_do_not_double_count():
    data = _synthetic_family(7, TrendDirection.BULLISH)
    line = build_family(data, TrendDirection.BULLISH, 10_000, CFG)[0]
    t = 20_000
    adverse = line.price_at(t) - 1.0
    one = observe_completed_close(line, t, adverse, VIO)
    assert one.breach_streak == 1
    duplicate = observe_completed_close(one, t, adverse - 1.0, VIO)
    older = observe_completed_close(duplicate, t - 1, adverse - 2.0, VIO)
    assert duplicate == one
    assert older == one


def test_repair_preserves_hidden_visibility_ids():
    data = _synthetic_family(9, TrendDirection.BULLISH)
    fam = build_family(data, TrendDirection.BULLISH, 10_000, CFG)
    board = TrendlineBoard(lines=fam, hidden_line_ids=(fam[0].line_id,))
    repaired = repair_violated(board, data, 20_000, CFG)
    assert repaired.hidden_line_ids == board.hidden_line_ids
