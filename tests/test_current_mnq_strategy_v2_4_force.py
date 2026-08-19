from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_force import (
    decision_times,
    first_force_confirmation,
    force_snapshot,
)

TZ = "America/New_York"
P = prod.Params()


def ts(x: str) -> pd.Timestamp:
    return pd.Timestamp(x, tz=TZ)


def one(rows):
    return pd.DataFrame(
        {
            "open": [r[1] for r in rows],
            "high": [r[2] for r in rows],
            "low": [r[3] for r in rows],
            "close": [r[4] for r in rows],
        },
        index=[ts(r[0]) for r in rows],
    )


def test_clean_sustained_bull_force_confirms_before_5m_close():
    q = one([
        ("2026-08-19 10:00", 100.00, 102.25, 99.75, 102.00),
        ("2026-08-19 10:01", 102.00, 104.25, 101.75, 104.00),
        ("2026-08-19 10:02", 104.00, 105.50, 103.75, 105.25),
        ("2026-08-19 10:03", 105.25, 106.25, 105.00, 106.00),
        ("2026-08-19 10:04", 106.00, 106.50, 105.75, 106.25),
    ])
    snap = force_snapshot(q, ts("2026-08-19 10:00"), 5, "L", ts("2026-08-19 10:02"), P)
    assert snap.confirmed
    assert snap.completed_1m == 2
    assert snap.path_efficiency >= P.body_frac
    assert snap.latest_close_at_directional_extreme
    assert snap.decision_time == ts("2026-08-19 10:02")


def test_tug_of_war_bull_path_fails_even_when_price_is_green():
    q = one([
        ("2026-08-19 10:00", 100.00, 104.25, 99.75, 104.00),
        ("2026-08-19 10:01", 104.00, 104.25, 100.75, 101.00),
        ("2026-08-19 10:02", 101.00, 104.50, 100.75, 104.25),
    ])
    snap = force_snapshot(q, ts("2026-08-19 10:00"), 5, "L", ts("2026-08-19 10:03"), P)
    assert not snap.confirmed
    assert snap.directional_progress > 0
    assert snap.path_efficiency < P.body_frac
    assert snap.reason == "TUG_OF_WAR_PATH_TOO_INEFFICIENT"


def test_pullback_must_be_reconquered_before_force_can_trigger():
    q = one([
        ("2026-08-19 10:00", 100.00, 103.00, 99.75, 102.75),
        ("2026-08-19 10:01", 102.75, 103.00, 101.75, 102.00),
        ("2026-08-19 10:02", 102.00, 104.25, 101.75, 104.00),
    ])
    early = force_snapshot(q, ts("2026-08-19 10:00"), 5, "L", ts("2026-08-19 10:02"), P)
    assert not early.confirmed
    assert not early.latest_close_at_directional_extreme
    later = force_snapshot(q, ts("2026-08-19 10:00"), 5, "L", ts("2026-08-19 10:03"), P)
    assert later.latest_close_at_directional_extreme


def test_parent_close_is_not_an_intra_candle_entry_clock():
    q = one([
        ("2026-08-19 10:00", 100.00, 100.50, 99.75, 100.25),
        ("2026-08-19 10:01", 100.25, 100.75, 100.00, 100.50),
        ("2026-08-19 10:02", 100.50, 101.00, 100.25, 100.75),
        ("2026-08-19 10:03", 100.75, 101.25, 100.50, 101.00),
        ("2026-08-19 10:04", 101.00, 105.25, 100.75, 105.00),
    ])
    clocks = decision_times(q, ts("2026-08-19 10:00"), 5)
    assert ts("2026-08-19 10:05") not in clocks
    assert first_force_confirmation(q, ts("2026-08-19 10:00"), 5, "L", P) is None
    closed = force_snapshot(q, ts("2026-08-19 10:00"), 5, "L", ts("2026-08-19 10:05"), P)
    assert not closed.confirmed
    assert closed.reason == "PARENT_CANDLE_ALREADY_CLOSED"


def test_short_force_is_exact_mirror_of_long_force():
    q = one([
        ("2026-08-19 10:00", 100.00, 100.25, 97.75, 98.00),
        ("2026-08-19 10:01", 98.00, 98.25, 95.75, 96.00),
    ])
    snap = force_snapshot(q, ts("2026-08-19 10:00"), 5, "S", ts("2026-08-19 10:02"), P)
    assert snap.confirmed
    assert snap.directional_progress > 0
    assert snap.latest_close_at_directional_extreme


def test_15m_bar3_can_confirm_intra_bar_without_waiting_15m_close():
    q = one([
        ("2026-08-19 10:30", 100.00, 102.25, 99.75, 102.00),
        ("2026-08-19 10:31", 102.00, 104.25, 101.75, 104.00),
    ])
    snap = force_snapshot(q, ts("2026-08-19 10:30"), 15, "L", ts("2026-08-19 10:32"), P)
    assert snap.confirmed
    assert snap.decision_time == ts("2026-08-19 10:32")
    assert snap.decision_time < ts("2026-08-19 10:45")
