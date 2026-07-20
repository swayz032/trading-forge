"""★ INTRA-DAY STRADDLE causality proof (R-067 §3 — owed before the structure wire).

The daily cache's causality is proven for DAYS. This proves it for the INTRA-DAY frames
the structure wire reads. The named leak: S3-native 4h/1h bars are OPEN-STAMPED, so a
bar stamped 08:00 covers 08:00–12:00 and is still FORMING at 10:30 — its high/low/close
are computed from the bar-t FUTURE. A naive `stamp <= t` filter admits it. The error is
OPTIMISTIC, so it would make a fidelity gain look like recovered edge.

Every test here carries its anti-vacuity companion (R-069 §2 house pattern): proving the
correct slice behaves right is worthless unless it also DIFFERS from the wrong one.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

import polars as pl
import pytest

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.context.htf_availability import (  # noqa: E402
    completed_htf_slice,
    htf_period,
    naive_leaky_slice,
)

BASE = datetime(2022, 3, 1)


def _frame_4h(n: int = 6) -> pl.DataFrame:
    """4h bars stamped 00:00, 04:00, 08:00, 12:00, ... (OPEN-stamped)."""
    return pl.DataFrame({
        "ts_event": [BASE + timedelta(hours=4 * i) for i in range(n)],
        "close": [100.0 + i for i in range(n)],
    })


def test_straddle_excludes_the_forming_bar():
    """★ THE STRADDLE: exec bar at 10:30 sits INSIDE the 08:00–12:00 bar. That bar must
    NOT be visible — it has not closed."""
    df = _frame_4h()
    t = BASE + timedelta(hours=10, minutes=30)
    got = completed_htf_slice(df, t, "4h")

    latest = got["ts_event"].max()
    assert latest == BASE + timedelta(hours=4), (
        f"expected the 04:00 bar (closes 08:00) to be the newest visible at 10:30, got {latest}"
    )
    assert BASE + timedelta(hours=8) not in got["ts_event"].to_list(), (
        "LOOK-AHEAD: the FORMING 08:00 bar (closes 12:00) was visible at 10:30"
    )


def test_anti_vacuity_the_naive_filter_WOULD_have_leaked():
    """Companion: if the naive filter agreed with the correct one on this straddle, the
    test above would prove nothing."""
    df = _frame_4h()
    t = BASE + timedelta(hours=10, minutes=30)

    correct = completed_htf_slice(df, t, "4h")["ts_event"].to_list()
    leaky = naive_leaky_slice(df, t)["ts_event"].to_list()

    assert leaky != correct, "VACUOUS: naive and correct slices agree — no leak to detect"
    assert BASE + timedelta(hours=8) in leaky, "the naive filter should have admitted the forming bar"
    assert len(leaky) == len(correct) + 1, "the leak should be exactly the one forming bar"


def test_exact_close_boundary_is_inclusive():
    """A bar that closes EXACTLY at t IS complete and therefore visible (close <= t)."""
    df = _frame_4h()
    t = BASE + timedelta(hours=8)  # the 04:00 bar closes exactly here
    got = completed_htf_slice(df, t, "4h")["ts_event"].to_list()
    assert BASE + timedelta(hours=4) in got, "a bar closing exactly at t must be visible"
    assert BASE + timedelta(hours=8) not in got, "the bar OPENING at t has not closed"


def test_start_of_window_sees_nothing():
    """At the very first stamp nothing has closed yet — must be empty, not a silent
    partial bar."""
    assert len(completed_htf_slice(_frame_4h(), BASE, "4h")) == 0


@pytest.mark.parametrize("tf,hours", [("4h", 4), ("1h", 1)])
def test_both_wired_timeframes_respect_their_own_period(tf: str, hours: int):
    """The boundary must move with the PERIOD — a 1h frame completes 4x as often as 4h.
    Using the wrong period silently shifts the availability boundary."""
    df = pl.DataFrame({
        "ts_event": [BASE + timedelta(hours=hours * i) for i in range(6)],
        "close": [100.0 + i for i in range(6)],
    })
    # t sits 30 minutes into the bar starting at 2*hours
    t = BASE + timedelta(hours=2 * hours, minutes=30)
    got = completed_htf_slice(df, t, tf)["ts_event"].to_list()
    assert BASE + timedelta(hours=2 * hours) not in got, "forming bar leaked"
    assert BASE + timedelta(hours=hours) in got, "the last COMPLETED bar should be visible"
    assert htf_period(tf) == timedelta(hours=hours)


def test_unknown_timeframe_raises_rather_than_guessing():
    with pytest.raises(ValueError):
        htf_period("13m")
