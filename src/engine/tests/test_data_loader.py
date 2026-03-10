"""Tests for data loading layer — TDD: written before data_loader.py."""

import os
import tempfile
from datetime import datetime

import polars as pl
import pytest

from src.engine.data_loader import load_ohlcv, build_s3_glob


# ─── Fixture: create a local Parquet file for testing ──────────────

@pytest.fixture
def parquet_fixture(tmp_path):
    """Create a local Parquet file mimicking S3 structure."""
    df = pl.DataFrame({
        "ts_event": [
            datetime(2023, 1, 3, 9, 30),
            datetime(2023, 1, 4, 9, 30),
            datetime(2023, 1, 5, 9, 30),
            datetime(2023, 1, 6, 9, 30),
            datetime(2023, 1, 9, 9, 30),
        ],
        "open":   [3850.0, 3860.0, 3870.0, 3855.0, 3880.0],
        "high":   [3870.0, 3880.0, 3890.0, 3875.0, 3900.0],
        "low":    [3840.0, 3850.0, 3860.0, 3845.0, 3870.0],
        "close":  [3860.0, 3870.0, 3855.0, 3870.0, 3890.0],
        "volume": [100000, 110000, 105000, 95000, 120000],
    })
    path = tmp_path / "test_data.parquet"
    df.write_parquet(str(path))
    return str(path)


# ─── S3 Glob Path Building ────────────────────────────────────────

class TestBuildS3Glob:
    def test_same_month(self):
        path = build_s3_glob("ES", "daily", "2023-01-01", "2023-01-31", bucket="trading-forge-data")
        assert path == "s3://trading-forge-data/futures/ES/ratio_adj/daily/2023/01/*.parquet"

    def test_same_year_different_months(self):
        path = build_s3_glob("NQ", "1min", "2023-01-01", "2023-06-30", bucket="trading-forge-data")
        assert path == "s3://trading-forge-data/futures/NQ/ratio_adj/1min/2023/*/*.parquet"

    def test_cross_year(self):
        path = build_s3_glob("CL", "daily", "2022-06-01", "2023-06-30", bucket="trading-forge-data")
        assert path == "s3://trading-forge-data/futures/CL/ratio_adj/daily/*/*/*.parquet"

    def test_always_ratio_adj(self):
        path = build_s3_glob("ES", "daily", "2023-01-01", "2023-01-31")
        assert "/ratio_adj/" in path


# ─── Load from Local Parquet ───────────────────────────────────────

class TestLoadOhlcvLocal:
    def test_load_local_parquet(self, parquet_fixture):
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-01",
            end="2023-12-31",
            local_path=parquet_fixture,
        )
        assert isinstance(df, pl.DataFrame)
        assert set(df.columns) == {"ts_event", "open", "high", "low", "close", "volume"}
        assert len(df) == 5

    def test_correct_dtypes(self, parquet_fixture):
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-01",
            end="2023-12-31",
            local_path=parquet_fixture,
        )
        assert df["open"].dtype == pl.Float64
        assert df["volume"].dtype == pl.Int64
        # ts_event should be datetime
        assert df["ts_event"].dtype == pl.Datetime

    def test_empty_data_raises(self, parquet_fixture):
        with pytest.raises(ValueError, match="No data found"):
            load_ohlcv(
                symbol="ES",
                timeframe="daily",
                start="2025-01-01",
                end="2025-12-31",
                local_path=parquet_fixture,
            )

    def test_date_filtering(self, parquet_fixture):
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-04",
            end="2023-01-07",
            local_path=parquet_fixture,
        )
        # Jan 4, 5, 6 are in range (Jan 9 is out)
        assert len(df) == 3

    def test_sorted_by_ts_event(self, parquet_fixture):
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-01",
            end="2023-12-31",
            local_path=parquet_fixture,
        )
        timestamps = df["ts_event"].to_list()
        assert timestamps == sorted(timestamps)
