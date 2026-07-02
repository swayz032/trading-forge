"""Tests for data loading layer — TDD: written before data_loader.py."""

import os
import tempfile
from datetime import datetime, date

import polars as pl
import pytest

from src.engine.data_loader import (
    load_ohlcv,
    build_s3_glob,
    compute_rollover_dates,
    _crude_oil_rollover_dates,
    _equity_index_rollover_dates,
    _verify_ratio_adjusted_source,
)


# ─── Fixture: create a local Parquet file for testing ──────────────

@pytest.fixture
def parquet_fixture(tmp_path):
    """Create a local Parquet file mimicking S3 structure.

    All rows pass OHLC sanity check: low <= open/close <= high.
    (F-3 fix: fixture data was previously invalid — close=3855 < low=3860 on row 3.)
    """
    df = pl.DataFrame({
        "ts_event": [
            datetime(2023, 1, 3, 9, 30),
            datetime(2023, 1, 4, 9, 30),
            datetime(2023, 1, 5, 9, 30),
            datetime(2023, 1, 6, 9, 30),
            datetime(2023, 1, 9, 9, 30),
        ],
        "open":   [3850.0, 3860.0, 3865.0, 3855.0, 3880.0],
        "high":   [3870.0, 3880.0, 3890.0, 3875.0, 3900.0],
        "low":    [3840.0, 3850.0, 3860.0, 3845.0, 3870.0],
        "close":  [3860.0, 3870.0, 3875.0, 3870.0, 3890.0],  # row 3: was 3855 < low=3860, fixed to 3875
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
    """Tests using local synthetic fixture data.

    Fixture data is not ratio-adjusted (it's synthetic), so we pass adjusted=False
    to be explicit. This is correct — test fixtures are not production S3 data.
    The F-6 fix makes the ratio-check a hard-fail, so all local tests must be honest
    about data provenance.
    """

    def test_load_local_parquet(self, parquet_fixture):
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-01",
            end="2023-12-31",
            local_path=parquet_fixture,
            adjusted=False,  # Synthetic fixture — not ratio-adjusted
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
            adjusted=False,  # Synthetic fixture
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
                adjusted=False,  # Synthetic fixture
            )

    def test_date_filtering(self, parquet_fixture):
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-04",
            end="2023-01-07",
            local_path=parquet_fixture,
            adjusted=False,  # Synthetic fixture
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
            adjusted=False,  # Synthetic fixture
        )
        timestamps = df["ts_event"].to_list()
        assert timestamps == sorted(timestamps)


# ─── F-1: Crude Oil Rollover Formula ─────────────────────────────

class TestCrudeOilRolloverDates:
    def test_2024_produces_12_dates(self):
        """CL rolls every month — should produce exactly 12 dates for 2024."""
        dates = _crude_oil_rollover_dates(2024, 2024)
        assert len(dates) == 12

    def test_dates_are_business_days(self):
        """Every rollover date must be a weekday (Mon-Fri)."""
        dates = _crude_oil_rollover_dates(2024, 2025)
        for d in dates:
            assert d.weekday() < 5, f"Rollover date {d} is a weekend"

    def test_dates_clustered_around_24th(self):
        """Rollover dates must be before the 25th of each month (typically 23rd or 24th)."""
        dates = _crude_oil_rollover_dates(2024, 2024)
        for d in dates:
            assert d.day <= 24, f"Date {d} is on or after the 25th — violates CL roll formula"

    def test_compute_rollover_dates_dispatches_cl(self):
        """compute_rollover_dates('CL') uses crude oil formula, not equity formula."""
        cl_dates = compute_rollover_dates("CL", 2024, 2024)
        mcl_dates = compute_rollover_dates("MCL", 2024, 2024)
        equity_dates = compute_rollover_dates("ES", 2024, 2024)
        # Crude oil rolls monthly (12 dates), equity index rolls quarterly (4 dates)
        assert len(cl_dates) == 12
        assert len(mcl_dates) == 12
        assert len(equity_dates) == 4

    def test_equity_index_still_quarterly(self):
        """ES/MES/NQ/MNQ should still produce 4 dates per year (quarterly)."""
        for sym in ("ES", "MES", "NQ", "MNQ"):
            dates = compute_rollover_dates(sym, 2024, 2024)
            assert len(dates) == 4, f"{sym} should have 4 quarterly rollover dates, got {len(dates)}"

    def test_multi_year_range(self):
        """compute_rollover_dates(CL, 2023, 2025) should return 36 dates (3 years × 12)."""
        dates = compute_rollover_dates("CL", 2023, 2025)
        assert len(dates) == 36

    def test_dates_are_sorted(self):
        """Rollover dates must be sorted ascending."""
        dates = compute_rollover_dates("CL", 2024, 2025)
        assert dates == sorted(dates)


# ─── F-3: ignore_quality_gate parameter ──────────────────────────

class TestIgnoreQualityGate:
    def test_ignore_quality_gate_is_accepted(self, parquet_fixture):
        """ignore_quality_gate=True is a valid parameter and loads the data normally."""
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-01",
            end="2023-12-31",
            local_path=parquet_fixture,
            adjusted=False,  # Synthetic fixture
            ignore_quality_gate=True,
        )
        assert len(df) == 5

    def test_default_does_not_bypass_gate(self, parquet_fixture):
        """ignore_quality_gate defaults to False — normal behavior is gate-enforced."""
        # Normal valid data still loads fine with gate enforced
        df = load_ohlcv(
            symbol="ES",
            timeframe="daily",
            start="2023-01-01",
            end="2023-12-31",
            local_path=parquet_fixture,
            adjusted=False,  # Synthetic fixture
            ignore_quality_gate=False,
        )
        assert len(df) > 0


# ─── F-6: _verify_ratio_adjusted_source hard-fail ────────────────

class TestVerifyRatioAdjustedSource:
    def test_ratio_adj_path_passes(self):
        """ratio_adj path does not raise."""
        # Should not raise — no-op
        _verify_ratio_adjusted_source("s3://bucket/futures/ES/ratio_adj/daily.parquet", True)

    def test_consolidated_path_passes(self):
        """consolidated path is treated as adjusted and does not raise."""
        _verify_ratio_adjusted_source("s3://bucket/futures/ES/consolidated/daily.parquet", True)

    def test_raw_path_raises_by_default(self):
        """Raw (unadjusted) path raises ValueError when adjusted=True and no ALLOW_RAW_DATA env var."""
        env_backup = os.environ.pop("ALLOW_RAW_DATA", None)
        try:
            with pytest.raises(ValueError, match="does not appear to be ratio-adjusted"):
                _verify_ratio_adjusted_source("/local/raw/data.parquet", True)
        finally:
            if env_backup is not None:
                os.environ["ALLOW_RAW_DATA"] = env_backup

    def test_adjusted_false_never_raises(self):
        """adjusted=False bypasses the check entirely (no raise for any path)."""
        # Should not raise regardless of path content
        _verify_ratio_adjusted_source("/local/raw/unadjusted/data.parquet", False)

    def test_allow_raw_data_env_downgrades_to_warning(self, monkeypatch):
        """ALLOW_RAW_DATA=true changes raise to warning (test/research override)."""
        import warnings
        monkeypatch.setenv("ALLOW_RAW_DATA", "true")
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            _verify_ratio_adjusted_source("/local/raw/data.parquet", True)
        assert len(w) == 1
        assert "ALLOW_RAW_DATA=true override" in str(w[0].message)
