from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_zone_lifecycle import origin_side, zone_state_at_v24

core = prod.core
TZ = "America/New_York"


def ts(x):
    return pd.Timestamp(x, tz=TZ)


def zone(side="S"):
    state = core.ZoneState.ACTIVE_SUPPORT if side == "S" else core.ZoneState.ACTIVE_RESISTANCE
    return core.Zone(
        id=f"{side}:2026-08-10T10:00:00-04:00:400",
        side=side, lo=99.0, hi=101.0, mid=100.0,
        touches=2, wick_quality=.8, close_away=.8, displacement=1.2,
        compactness=.9, independence=.8, recency=.9, quality=.85,
        created=ts("2026-08-10 10:00"), last_event=ts("2026-08-10 10:00"),
        source="WICK_ZONE", confluence=1, state=state,
    )


def bars(rows):
    idx = [ts(x[0]) for x in rows]
    return pd.DataFrame({
        "open": [x[1] for x in rows], "high": [x[2] for x in rows],
        "low": [x[3] for x in rows], "close": [x[4] for x in rows],
        "atr": [10.0 for _ in rows],
    }, index=idx)


def test_support_break_then_quick_reclaim_restores_support():
    q = bars([
        ("2026-08-10 10:05", 100.0, 100.5, 97.5, 98.0),
        ("2026-08-10 10:10", 98.0, 101.5, 97.75, 100.5),
    ])
    z = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:15"), core.Params())
    assert z.side == "S"
    assert z.state == core.ZoneState.TESTED
    assert z.active


def test_support_break_then_retest_from_below_flips_to_resistance():
    q = bars([
        ("2026-08-10 10:05", 100.0, 100.5, 97.5, 98.0),
        ("2026-08-10 10:10", 98.0, 100.5, 97.75, 99.5),
    ])
    z = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:15"), core.Params())
    assert z.side == "R"
    assert z.state == core.ZoneState.FLIPPED_RETEST
    assert z.active


def test_resistance_break_then_quick_reclaim_restores_resistance():
    q = bars([
        ("2026-08-10 10:05", 100.0, 102.5, 99.5, 102.0),
        ("2026-08-10 10:10", 102.0, 102.25, 98.5, 99.5),
    ])
    z = zone_state_at_v24(zone("R"), q, ts("2026-08-10 10:15"), core.Params())
    assert z.side == "R"
    assert z.state == core.ZoneState.TESTED


def test_resistance_break_then_retest_from_above_flips_to_support():
    q = bars([
        ("2026-08-10 10:05", 100.0, 102.5, 99.5, 102.0),
        ("2026-08-10 10:10", 102.0, 102.25, 99.5, 100.5),
    ])
    z = zone_state_at_v24(zone("R"), q, ts("2026-08-10 10:15"), core.Params())
    assert z.side == "S"
    assert z.state == core.ZoneState.FLIPPED_RETEST


def test_retest_after_asof_is_not_visible_yet():
    q = bars([
        ("2026-08-10 10:05", 100.0, 100.5, 97.5, 98.0),
        ("2026-08-10 10:10", 98.0, 100.5, 97.75, 99.5),
    ])
    z = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:10"), core.Params())
    assert z.side == "S"
    assert z.state == core.ZoneState.BROKEN
    assert not z.active


def test_flipped_resistance_can_later_break_and_flip_back_to_support():
    q = bars([
        ("2026-08-10 10:05", 100.0, 100.5, 97.5, 98.0),
        ("2026-08-10 10:10", 98.0, 100.5, 97.75, 99.5),  # S -> R
        ("2026-08-10 10:15", 99.5, 102.5, 99.0, 102.0),  # break R above
        ("2026-08-10 10:20", 102.0, 102.25, 99.5, 100.5),  # retest above -> S
    ])
    z = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:25"), core.Params())
    assert z.side == "S"
    assert z.state == core.ZoneState.FLIPPED_RETEST


def test_origin_side_is_immutable_even_if_returned_zone_side_has_flipped():
    q = bars([
        ("2026-08-10 10:05", 100.0, 100.5, 97.5, 98.0),
        ("2026-08-10 10:10", 98.0, 100.5, 97.75, 99.5),
    ])
    z = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:15"), core.Params())
    assert z.side == "R"
    assert origin_side(z) == "S"


def test_lifecycle_ignores_unrelated_wide_object_columns():
    """Production replay must not materialize unrelated mixed-type columns."""
    q = bars([
        ("2026-08-10 10:05", 100.0, 100.5, 97.5, 98.0),
        ("2026-08-10 10:10", 98.0, 100.5, 97.75, 99.5),
    ])
    expected = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:15"), core.Params())
    for i in range(64):
        q[f"unused_object_{i}"] = [f"left-{i}", f"right-{i}"]
    actual = zone_state_at_v24(zone("S"), q, ts("2026-08-10 10:15"), core.Params())
    assert (actual.side, actual.state, actual.active) == (
        expected.side, expected.state, expected.active,
    )
