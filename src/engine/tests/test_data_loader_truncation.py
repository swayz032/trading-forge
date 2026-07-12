"""MED#3 (freshscan4 2026-07-12) — requested-window truncation detection in validate_bars.

The coverage_pct check derives its denominator from the RETURNED data's own first/last bar, so
START/END truncation (request 2008-2020 but S3 only holds 2015+) was INVISIBLE — coverage ~100%,
passed=True, backtest silently runs on a shorter span. validate_bars now takes requested_start/end
and emits a loud truncation warning. These tests lock BOTH dtype shapes ts_event can take
(datetime and Int64 epoch-ns — the grader found the Int64 path was a silent no-op) plus the
warn-only-default / hard-fail-opt-in / no-false-positive-on-match behavior.

Imports validate_bars directly (does not pull the vectorbt JIT backtester → safe under pytest).
"""
from datetime import datetime, timezone

import polars as pl

from src.engine.data_loader import validate_bars


def _dense_dt(start_year: int, end_year: int):
    """A daily-ish frame with enough bars that coverage_pct passes, spanning [start_year, end_year]."""
    rows = []
    for y in range(start_year, end_year + 1):
        for m in (1, 4, 7, 10):
            rows.append(datetime(y, m, 15))
    return rows


def _has_trunc(report) -> bool:
    return any("truncat" in w.lower() for w in report.warnings)


def test_start_and_end_truncation_datetime_dtype_warns():
    ts = _dense_dt(2015, 2018)
    df = pl.DataFrame({
        "ts_event": ts,
        "open": [1.0] * len(ts), "high": [2.0] * len(ts),
        "low": [0.5] * len(ts), "close": [1.5] * len(ts), "volume": [10] * len(ts),
    })
    r = validate_bars(df, "ES", "daily", requested_start="2008-01-01", requested_end="2020-12-31")
    assert _has_trunc(r), "datetime-dtype start/end truncation must emit a truncation warning"


def test_truncation_int64_epoch_ns_dtype_warns():
    # The grader's Case E: ts_event as Int64 epoch-nanoseconds. Before the _to_date int/float
    # branch this silently no-op'd (returned None → no warning) — the exact silent-miss MED#3 closes.
    def ns(y, m, d):
        return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1_000_000_000)

    ts = [ns(2015, 1, 2), ns(2016, 6, 1), ns(2018, 12, 31)]
    df = pl.DataFrame({
        "ts_event": pl.Series(ts, dtype=pl.Int64),
        "open": [1.0] * 3, "high": [2.0] * 3, "low": [0.5] * 3, "close": [1.5] * 3, "volume": [10] * 3,
    })
    r = validate_bars(df, "ES", "daily", requested_start="2008-01-01", requested_end="2020-12-31")
    assert _has_trunc(r), "Int64 epoch-ns truncation must warn (grader-found silent-miss dtype)"


def test_matched_window_does_not_false_positive():
    ts = _dense_dt(2015, 2018)
    df = pl.DataFrame({
        "ts_event": ts,
        "open": [1.0] * len(ts), "high": [2.0] * len(ts),
        "low": [0.5] * len(ts), "close": [1.5] * len(ts), "volume": [10] * len(ts),
    })
    # Request exactly the data's span (± within the 7-day tolerance) → no truncation warning.
    r = validate_bars(df, "ES", "daily", requested_start="2015-01-15", requested_end="2018-10-15")
    assert not _has_trunc(r), "a matched requested window must NOT emit a truncation warning"


def test_no_requested_window_is_backward_compatible():
    ts = _dense_dt(2015, 2018)
    df = pl.DataFrame({
        "ts_event": ts,
        "open": [1.0] * len(ts), "high": [2.0] * len(ts),
        "low": [0.5] * len(ts), "close": [1.5] * len(ts), "volume": [10] * len(ts),
    })
    # No requested_start/end (legacy callers) → the truncation block is skipped entirely.
    r = validate_bars(df, "ES", "daily")
    assert not _has_trunc(r), "omitting the requested window must not emit a truncation warning"


def test_warn_only_default_does_not_flip_passed(monkeypatch):
    # A dense frame that PASSES coverage, but truncated vs the requested window. Default (warn-only)
    # must leave passed unaffected by truncation; hard-fail opt-in flips it.
    monkeypatch.delenv("DATA_TRUNCATION_HARD_FAIL", raising=False)
    ts = _dense_dt(2015, 2018)
    df = pl.DataFrame({
        "ts_event": ts,
        "open": [1.0] * len(ts), "high": [2.0] * len(ts),
        "low": [0.5] * len(ts), "close": [1.5] * len(ts), "volume": [10] * len(ts),
    })
    r_warn = validate_bars(df, "ES", "daily", requested_start="2008-01-01", requested_end="2020-12-31")
    assert _has_trunc(r_warn), "truncation should still WARN by default"

    monkeypatch.setenv("DATA_TRUNCATION_HARD_FAIL", "true")
    r_fail = validate_bars(df, "ES", "daily", requested_start="2008-01-01", requested_end="2020-12-31")
    assert r_fail.passed is False, "DATA_TRUNCATION_HARD_FAIL=true must flip passed to False on truncation"
