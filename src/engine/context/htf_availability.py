"""COMPLETED-BAR availability for intra-day HTF frames (R-067 §3 / R-068 §4).

THE ONE THING: which higher-timeframe bars an exec bar at time `t` is allowed to see.

The daily cache's causality (strictly-prior days) does NOT extend to 4h/1h frames. Those
frames arrive whole, and slicing them by `stamp <= t` LEAKS: S3-native 4h/1h bars are
**OPEN-STAMPED** (established two-path — code `data_loader.py:1237` label="left", and
empirically: exec-resampled vs S3-native match 0.0000 across 67/67 4h bars and 253/253
1h bars; receipt `docs/replay-results/h1-battery/s3-htf-stamp-convention-receipt.json`).
So a bar stamped 08:00 COVERS 08:00–12:00: at 10:30 it is still FORMING, and its
high/low/close are computed from the bar-`t` FUTURE. Admitting it is silent look-ahead
whose error direction is OPTIMISTIC — it would make a fidelity gain look like recovered
edge.

THE RULE (stamping-convention-agnostic): an HTF bar is available to exec bar `t` IFF its
CLOSE time <= t. For open-stamped frames that is **`stamp + period <= t`**.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Optional

import polars as pl

# Period per timeframe label. Open-stamped bar covers [stamp, stamp + period).
TF_PERIOD: dict[str, timedelta] = {
    "1h": timedelta(hours=1),
    "1H": timedelta(hours=1),
    "60min": timedelta(hours=1),
    "4h": timedelta(hours=4),
    "4H": timedelta(hours=4),
    "240min": timedelta(hours=4),
}


def htf_period(tf: str) -> timedelta:
    """Bar duration for a timeframe label. Raises on unknown labels rather than
    guessing — a wrong period silently shifts the availability boundary, which is
    exactly the leak this module exists to prevent."""
    if tf not in TF_PERIOD:
        raise ValueError(
            f"htf_period: unknown timeframe {tf!r}; known={sorted(TF_PERIOD)}. "
            f"Refusing to guess — a wrong period moves the completed-bar boundary."
        )
    return TF_PERIOD[tf]


def ts_col_of(df: pl.DataFrame) -> Optional[str]:
    for c in ("ts_event", "ts_et", "ts", "timestamp"):
        if c in df.columns:
            return c
    return None


def completed_htf_slice(htf_df: pl.DataFrame, t, tf: str) -> pl.DataFrame:
    """The HTF bars COMPLETED as of exec time `t` — i.e. safe for bar `t` to read.

    Open-stamped: a bar stamped `T` covers `[T, T + period)`, so it is available IFF
    `T + period <= t`. The FORMING bar (the one straddling `t`) is excluded.

    NOTE the deliberate asymmetry vs a naive `stamp <= t`: at t=10:30 with 4h bars, the
    08:00 bar is EXCLUDED (it closes 12:00, in the future). Only bars closing at or
    before 10:30 are visible.
    """
    ts = ts_col_of(htf_df)
    if ts is None:
        raise ValueError("completed_htf_slice: no recognizable timestamp column")
    period = htf_period(tf)
    return htf_df.filter(pl.col(ts) + period <= t)


def naive_leaky_slice(htf_df: pl.DataFrame, t) -> pl.DataFrame:
    """The WRONG filter (`stamp <= t`), provided ONLY so tests can prove the correct
    slice differs from it on a straddle. Never call this in production — it admits the
    forming bar. Its existence is the anti-vacuity companion for the availability rule
    (R-069 §2 house pattern: a test proving branch X must show X differs from Y)."""
    ts = ts_col_of(htf_df)
    if ts is None:
        raise ValueError("naive_leaky_slice: no recognizable timestamp column")
    return htf_df.filter(pl.col(ts) <= t)
