"""★ CAUSALITY PROOF for the WIRE-1 materialized-column seam (R-066 §2, mandatory).

Materialized columns are the classic silent LOOK-AHEAD vector, and the error
direction is OPTIMISTIC: a bar-t value computed from bars > t fake-improves every
backtest and would make the 0.99 binding-approximation's fall look like recovered
edge when it is time-travel. R-066 requires the column values be PROVABLY
functions of the past.

The proof used here is a FUTURE-PERTURBATION replay, which is strictly stronger
than re-running the same code on a truncated frame (that would pass vacuously if
the builder read day D's own bar):

    build cache on the real frame                -> v1 = cache[D]
    CORRUPT every row from day D onward, rebuild -> v2 = cache[D]
    assert v1 == v2, field by field

If `build_htf_cache` touched day D's own daily bar (the "same-day context stamped
onto that day's intraday bars" case R-066 names) or ANY later bar, v2 would move
and this test fails. Passing means cache[D] is a function of strictly-prior days.
"""
from __future__ import annotations

import os
import sys

import polars as pl
import pytest

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.context.htf_cache_builder import (  # noqa: E402
    MIN_DAILY_BARS,
    build_htf_cache,
    day_key_of,
)

N_DAYS = 260  # > MIN_DAILY_BARS so the cache has entries


def _daily_frame(n: int = N_DAYS) -> pl.DataFrame:
    """Deterministic synthetic daily bars (no wall clock, no RNG)."""
    close = [100.0 + i * 0.5 + (i % 7) for i in range(n)]
    return pl.DataFrame({
        "ts_et": [f"20{20 + i // 365:02d}-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n)],
        "open": [c - 0.5 for c in close],
        "high": [c + 1.0 for c in close],
        "low": [c - 1.0 for c in close],
        "close": close,
        "volume": [1000.0 + i for i in range(n)],
    })


def _corrupt_from(df: pl.DataFrame, idx: int) -> pl.DataFrame:
    """Violently alter every row from `idx` onward — leaves rows < idx untouched."""
    n = len(df)
    factor = [1.0 if i < idx else 9.0 for i in range(n)]
    return df.with_columns([
        (pl.col("open") * pl.Series("f", factor)).alias("open"),
        (pl.col("high") * pl.Series("f", factor)).alias("high"),
        (pl.col("low") * pl.Series("f", factor)).alias("low"),
        (pl.col("close") * pl.Series("f", factor)).alias("close"),
    ])


def _ctx_fields(ctx) -> dict:
    return {
        "daily_trend": ctx.daily_trend,
        "weekly_trend": ctx.weekly_trend,
        "four_h_trend": ctx.four_h_trend,
        "pd_location": ctx.pd_location,
        "prev_day_high": ctx.prev_day_high,
        "prev_day_low": ctx.prev_day_low,
        "prev_day_close": ctx.prev_day_close,
        "adr": ctx.adr,
        "atr_percentile": ctx.atr_percentile,
    }


@pytest.mark.parametrize("probe_idx", [MIN_DAILY_BARS, MIN_DAILY_BARS + 17, N_DAYS - 2])
def test_cache_entry_is_a_function_of_strictly_prior_days(probe_idx: int):
    """★ THE CAUSALITY PIN: corrupting day D and every later day must NOT move cache[D]."""
    df = _daily_frame()
    key = day_key_of(df["ts_et"][probe_idx])

    v1 = build_htf_cache(df)[key]
    v2 = build_htf_cache(_corrupt_from(df, probe_idx))[key]

    assert _ctx_fields(v1) == _ctx_fields(v2), (
        f"LOOK-AHEAD: cache[{key}] changed when day {probe_idx} and later were corrupted "
        f"— the value is not a function of strictly-prior days."
    )


def test_corrupting_the_PAST_does_move_the_value():
    """Anti-vacuity: the probe must be capable of detecting a change at all. If
    corrupting PRIOR days did not move the value, the test above would pass for a
    trivial reason (e.g. a constant) and prove nothing."""
    df = _daily_frame()
    probe_idx = N_DAYS - 2
    key = day_key_of(df["ts_et"][probe_idx])

    v1 = build_htf_cache(df)[key]
    v_past = build_htf_cache(_corrupt_from(df, probe_idx - 40))[key]

    assert _ctx_fields(v1) != _ctx_fields(v_past), (
        "VACUOUS PROBE: corrupting prior days did not change the context, so the "
        "future-perturbation test cannot be trusted to detect look-ahead."
    )


def test_below_warmup_returns_none_not_a_fabricated_cache():
    assert build_htf_cache(_daily_frame(MIN_DAILY_BARS - 1)) is None
    assert build_htf_cache(None) is None
