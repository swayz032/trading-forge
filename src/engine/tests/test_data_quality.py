"""Tests for data quality validation layer (Gap 1)."""

from datetime import datetime

import polars as pl
import pytest

from src.engine.data_loader import compute_dataset_hash, validate_bars


def _make_bars(
    rows: list[dict],
) -> pl.DataFrame:
    """Build a minimal OHLCV DataFrame from a list of row dicts."""
    return pl.DataFrame(rows).with_columns(
        pl.col("ts_event").cast(pl.Datetime("ns")),
    )


# ── Helpers: realistic baseline bar data ──────────────────────────

def _clean_bars() -> pl.DataFrame:
    """Return clean MES-like 5-min bars spanning multiple days (avoids coverage warning)."""
    from datetime import timedelta
    base_ts = datetime(2025, 3, 10, 9, 30, 0)
    rows = []
    # Generate enough bars across 2 days to satisfy coverage threshold (>80%)
    for day_offset in range(2):
        day_base = base_ts + timedelta(days=day_offset)
        for i in range(78):  # ~6.5 hours of 5-min bars per day = full RTH session
            ts = day_base + timedelta(minutes=i * 5)
            rows.append({
                "ts_event": ts,
                "open": 5100.0 + i,
                "high": 5105.0 + i,
                "low": 5098.0 + i,
                "close": 5102.0 + i,
                "volume": 1000 + i * 100,
            })
    return _make_bars(rows)


# ── Tests ─────────────────────────────────────────────────────────

def test_duplicate_timestamps_detected():
    """Bars with duplicate ts_event values should be flagged."""
    ts = datetime(2025, 3, 10, 9, 30, 0)
    rows = [
        {"ts_event": ts, "open": 5100.0, "high": 5105.0, "low": 5098.0, "close": 5102.0, "volume": 1000},
        {"ts_event": ts, "open": 5101.0, "high": 5106.0, "low": 5099.0, "close": 5103.0, "volume": 1100},
        {"ts_event": datetime(2025, 3, 10, 9, 35, 0), "open": 5102.0, "high": 5107.0, "low": 5100.0, "close": 5104.0, "volume": 1200},
    ]
    df = _make_bars(rows)
    report = validate_bars(df, "MES", "5min")

    assert report.duplicate_timestamps > 0
    assert report.passed is False


def test_ohlc_violation_high_below_low():
    """A bar where high < low should be flagged as an OHLC violation."""
    rows = [
        {"ts_event": datetime(2025, 3, 10, 9, 30, 0), "open": 5100.0, "high": 5095.0, "low": 5098.0, "close": 5096.0, "volume": 1000},
        {"ts_event": datetime(2025, 3, 10, 9, 35, 0), "open": 5100.0, "high": 5105.0, "low": 5098.0, "close": 5102.0, "volume": 1100},
    ]
    df = _make_bars(rows)
    report = validate_bars(df, "MES", "5min")

    assert report.ohlc_violations > 0
    assert report.passed is False


def test_zero_volume_flagged():
    """Bars with volume == 0 should be counted."""
    rows = [
        {"ts_event": datetime(2025, 3, 10, 9, 30, 0), "open": 5100.0, "high": 5105.0, "low": 5098.0, "close": 5102.0, "volume": 0},
        {"ts_event": datetime(2025, 3, 10, 9, 35, 0), "open": 5101.0, "high": 5106.0, "low": 5099.0, "close": 5103.0, "volume": 500},
        {"ts_event": datetime(2025, 3, 10, 9, 40, 0), "open": 5102.0, "high": 5107.0, "low": 5100.0, "close": 5104.0, "volume": 0},
    ]
    df = _make_bars(rows)
    report = validate_bars(df, "MES", "5min")

    assert report.zero_volume_bars == 2
    # Zero volume alone does NOT fail; coverage warning is separate concern
    assert "zero-volume" in " ".join(report.warnings).lower()


def test_clean_data_passes():
    """Clean data should pass with all issue counts at zero."""
    df = _clean_bars()
    report = validate_bars(df, "MES", "5min")

    assert report.passed is True
    assert report.duplicate_timestamps == 0
    assert report.duplicate_ohlcv_rows == 0
    assert report.ohlc_violations == 0
    assert report.zero_volume_bars == 0
    assert report.large_gap_bars == 0
    assert report.total_bars == 156  # 78 bars/day × 2 days
    assert len(report.warnings) == 0
    # dataset_hash is computed separately via compute_dataset_hash(), not in validate_bars()
    assert report.dataset_hash == ""


def test_dataset_hash_deterministic():
    """Hashing the same DataFrame twice should produce the same hash."""
    df = _clean_bars()
    h1 = compute_dataset_hash(df)
    h2 = compute_dataset_hash(df)

    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex digest length


def test_dataset_hash_changes_with_data():
    """Modifying one value should change the hash."""
    df = _clean_bars()
    h1 = compute_dataset_hash(df)

    # Change one close value
    df_modified = df.with_columns(
        pl.when(pl.col("ts_event") == df["ts_event"][0])
        .then(pl.lit(9999.0))
        .otherwise(pl.col("close"))
        .alias("close")
    )
    h2 = compute_dataset_hash(df_modified)

    assert h1 != h2
