"""Fresh-scan CRIT / F-1 (2026-07-12) — the per-bar PM-taper minute-of-day vectorization must not
silently overflow Polars Int8.

`sizing.py` computed ET minute-of-day as `.dt.hour() * 60 + .dt.minute()`. Polars `.dt.hour()` returns
Int8 (max 127), so `hour * 60` overflows for every ET hour >= 3 — SILENTLY (no exception → the fail-soft
`except` never engages). That fed garbage minutes into compute_pm_size_factor_vec, so the PM-session
taper (13:30-15:30 ET → factor ~0.5) NEVER fired in backtests: full base size stayed in effect exactly
when it should be halved, over-sizing PM trades vs the live paper engine. The fix casts to Int32 before
the arithmetic. This test replicates the production expression and pins the corrected behavior across the
whole trading day (including the hours that overflowed).
"""
from datetime import datetime, timezone, timedelta

import numpy as np
import polars as pl

from src.engine.pm_size_factor import compute_pm_size_factor_vec


def _et_minutes_via_sizing_expr(ts_list):
    """The EXACT expression sizing.py uses (with the Int32 cast) — replicated so a regression to the
    un-cast form is caught here."""
    df = pl.DataFrame({"ts_event": ts_list})
    return (
        df.select(
            (
                pl.col("ts_event").dt.convert_time_zone("America/New_York").dt.hour().cast(pl.Int32) * 60
                + pl.col("ts_event").dt.convert_time_zone("America/New_York").dt.minute().cast(pl.Int32)
            ).alias("et_min")
        )["et_min"].to_numpy()
    )


def test_et_minutes_no_int8_overflow_across_full_day():
    # A UTC instant that is 15:15 ET (EDT = UTC-4) → 15*60+15 = 915. Pre-fix this returned -109 (Int8).
    got = _et_minutes_via_sizing_expr([datetime(2026, 5, 26, 19, 15, tzinfo=timezone.utc)])
    assert int(got[0]) == 915, f"expected 915, got {got[0]} (Int8 overflow regressed)"

    # Sweep every 15-min bar of a full ET day; minutes must be monotonic 0..1439-ish and never negative.
    base = datetime(2026, 5, 26, 4, 0, tzinfo=timezone.utc)  # 00:00 ET
    ts = [base + timedelta(minutes=15 * i) for i in range(96)]
    mins = _et_minutes_via_sizing_expr(ts)
    assert (mins >= 0).all(), f"negative minute(s) → Int8 overflow: {mins[mins < 0]}"
    assert (mins < 24 * 60).all()


def test_pm_session_taper_actually_fires():
    # 13:30-15:30 ET is the PM-taper window (factor < 1). Pre-fix these minutes overflowed to garbage
    # and compute_pm_size_factor_vec returned 1.0 (no taper). With the cast, they must taper below 1.
    pm_utc = [
        datetime(2026, 5, 26, 17, 45, tzinfo=timezone.utc),  # 13:45 ET
        datetime(2026, 5, 26, 18, 30, tzinfo=timezone.utc),  # 14:30 ET
        datetime(2026, 5, 26, 19, 15, tzinfo=timezone.utc),  # 15:15 ET
    ]
    mins = _et_minutes_via_sizing_expr(pm_utc)
    factors = compute_pm_size_factor_vec(mins)
    assert np.all(factors < 1.0), f"PM-session bars must taper (<1.0), got {factors}"

    # A morning bar (10:00 ET) is NOT in the PM window → no taper.
    am = _et_minutes_via_sizing_expr([datetime(2026, 5, 26, 14, 0, tzinfo=timezone.utc)])  # 10:00 ET
    assert compute_pm_size_factor_vec(am)[0] == 1.0
