"""Regression tests for Wave hardening 2026-06-22 data-layer institutional-grade fixes.

HIGH-1: Rollover-date formula parity (data_loader vs roll_calendar).
HIGH-2: Cache-poison prevention (adjusted-aware cache key + legacy-fallback guard).
MED:    DataQualityReport.duplicate_timestamps reflects SOURCE count (pre-dedup).
"""

from __future__ import annotations

import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import polars as pl
import pytest

from src.engine.data_loader import (
    _cache_path,
    _second_thursday_before_third_friday,
    _verify_ratio_adjusted_source,
    validate_bars,
    CACHE_DIR,
)
from src.engine.roll_calendar import _equity_quarterly_roll_day


# ─── HIGH-1: Rollover formula parity ─────────────────────────────────────────

class TestRolloverDateParity:
    """Verify data_loader._second_thursday_before_third_friday matches
    roll_calendar._equity_quarterly_roll_day for all 4 quarterly expiry
    months across 2023–2029.

    HIGH-1 root cause: old formula was ``3rd Friday − 8 days``, which diverges
    from the CME-correct 2nd Thursday when the 3rd Friday falls on the 15th.
    Proven failure case: 2024-Q1 (March) — 3rd Friday = Mar 15,
    old formula → Mar 7 (WRONG), CME correct → Mar 14.
    """

    QUARTERS = [3, 6, 9, 12]
    YEARS = list(range(2023, 2030))  # 2023..2029 inclusive

    def test_parity_2024_q1_known_failure_case(self):
        """The canonical failure case from the audit: 2024-03."""
        dl_result = _second_thursday_before_third_friday(2024, 3)
        rc_result = _equity_quarterly_roll_day(2024, 3)
        assert dl_result == rc_result, (
            f"2024-Q1: data_loader returned {dl_result}, roll_calendar returned {rc_result}. "
            f"CME correct is 2024-03-14 (2nd Thursday)."
        )
        # Explicitly pin the expected date so this test fails if both functions
        # regress together.
        assert dl_result == date(2024, 3, 14), (
            f"Expected 2024-03-14 (CME 2nd Thursday of March 2024), got {dl_result}"
        )

    @pytest.mark.parametrize("year", YEARS)
    @pytest.mark.parametrize("month", QUARTERS)
    def test_parity_all_quarters_2023_2029(self, year: int, month: int):
        """data_loader formula must match roll_calendar for every quarter, 2023–2029."""
        dl_result = _second_thursday_before_third_friday(year, month)
        rc_result = _equity_quarterly_roll_day(year, month)
        assert dl_result == rc_result, (
            f"{year}-{month:02d}: data_loader={dl_result}, roll_calendar={rc_result}"
        )

    def test_result_is_always_a_thursday(self):
        """The 2nd Thursday formula must always return a Thursday (weekday 3)."""
        for year in self.YEARS:
            for month in self.QUARTERS:
                d = _second_thursday_before_third_friday(year, month)
                assert d.weekday() == 3, (
                    f"{year}-{month:02d}: {d} is weekday {d.weekday()}, expected Thursday (3)"
                )

    def test_old_formula_would_fail_2024_q1(self):
        """Confirm the OLD formula (3rd Friday − 8 days) diverges from CME-correct.

        This test documents the bug that was fixed. It does NOT call the fixed
        function — it replicates the old formula manually and checks the divergence.
        """
        # Manually compute the old (wrong) result
        from datetime import timedelta
        # 3rd Friday of March 2024 = March 15
        third_friday_march_2024 = date(2024, 3, 15)
        old_result = third_friday_march_2024 - timedelta(days=8)  # March 7
        # CME-correct 2nd Thursday of March 2024 = March 14
        cmc_correct = date(2024, 3, 14)
        assert old_result != cmc_correct, (
            "Old formula should differ from CME-correct in the known failure case"
        )
        assert old_result == date(2024, 3, 7), f"Old formula should give 2024-03-07, got {old_result}"


# ─── HIGH-2: Cache-poison prevention ─────────────────────────────────────────

class TestCachePathAdjustedAware:
    """HIGH-2(a): _cache_path must produce separate paths for adjusted vs raw."""

    def test_adjusted_true_contains_ratio_adj_subfolder(self):
        path = _cache_path("ES", "5min", adjusted=True)
        parts = path.parts
        assert "ratio_adj" in parts, f"adjusted=True path should include 'ratio_adj' subfolder: {path}"

    def test_adjusted_false_contains_raw_subfolder(self):
        path = _cache_path("ES", "5min", adjusted=False)
        parts = path.parts
        assert "raw" in parts, f"adjusted=False path should include 'raw' subfolder: {path}"

    def test_adjusted_true_default_backward_compat(self):
        """Default adjusted=True must not break callers that omit the flag."""
        path_default = _cache_path("ES", "5min")
        path_explicit = _cache_path("ES", "5min", adjusted=True)
        assert path_default == path_explicit

    def test_raw_and_ratio_adj_paths_are_different(self):
        path_adj = _cache_path("NQ", "1hour", adjusted=True)
        path_raw = _cache_path("NQ", "1hour", adjusted=False)
        assert path_adj != path_raw, (
            f"adjusted and raw cache paths must differ but both returned {path_adj}"
        )

    def test_paths_share_symbol_and_timeframe_component(self):
        path_adj = _cache_path("MES", "15min", adjusted=True)
        path_raw = _cache_path("MES", "15min", adjusted=False)
        # Both must contain the symbol and timeframe filename
        assert "MES" in str(path_adj)
        assert "MES" in str(path_raw)
        assert "15min.parquet" in str(path_adj)
        assert "15min.parquet" in str(path_raw)


class TestLegacyFallbackGuard:
    """HIGH-2(b): _verify_ratio_adjusted_source must be called on legacy fallback path.

    We verify that a legacy glob path that looks like 'raw/...' raises ValueError
    when adjusted=True and ALLOW_RAW_DATA is not set.  This tests the same guard
    that is now applied to the fallback source before it can be used or cached.
    """

    def test_raw_legacy_glob_raises_when_adjusted_true(self, monkeypatch):
        """A raw-path legacy glob must raise ValueError when adjusted=True."""
        monkeypatch.delenv("ALLOW_RAW_DATA", raising=False)
        raw_legacy = "s3://trading-forge-data/futures/ES/raw/5min/*/*/*.parquet"
        with pytest.raises(ValueError, match="does not appear to be ratio-adjusted"):
            _verify_ratio_adjusted_source(raw_legacy, adjusted=True, from_cache=False)

    def test_ratio_adj_legacy_glob_passes(self):
        """A ratio_adj legacy glob must pass the guard."""
        ratio_adj_legacy = "s3://trading-forge-data/futures/ES/ratio_adj/5min/*/*/*.parquet"
        # Should not raise
        _verify_ratio_adjusted_source(ratio_adj_legacy, adjusted=True, from_cache=False)

    def test_allow_raw_data_env_downgrades_raw_fallback_to_warning(self, monkeypatch):
        """ALLOW_RAW_DATA=true downgrades the raw-fallback raise to a warning."""
        import warnings
        monkeypatch.setenv("ALLOW_RAW_DATA", "true")
        raw_legacy = "s3://trading-forge-data/futures/ES/raw/5min/*/*/*.parquet"
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            _verify_ratio_adjusted_source(raw_legacy, adjusted=True, from_cache=False)
        assert len(w) == 1
        assert "ALLOW_RAW_DATA=true override" in str(w[0].message)

    def test_adjusted_false_never_raises_on_raw_fallback(self):
        """adjusted=False bypasses the guard — no raise regardless of path."""
        raw_legacy = "s3://trading-forge-data/futures/ES/raw/5min/*/*/*.parquet"
        # Should not raise
        _verify_ratio_adjusted_source(raw_legacy, adjusted=False, from_cache=False)


# ─── MED: DataQualityReport.duplicate_timestamps reflects SOURCE count ────────

class TestSourceDuplicateTimestampsReported:
    """MED fix: validate_bars(source_duplicate_timestamps=N) must surface N in the
    report even though the DataFrame passed to validate_bars has already been
    deduped (so df-level dup check would return 0).
    """

    def _clean_df(self) -> pl.DataFrame:
        """Return a small, clean OHLCV DataFrame with no duplicates."""
        return pl.DataFrame({
            "ts_event": [
                datetime(2024, 1, 2, 9, 30),
                datetime(2024, 1, 3, 9, 30),
                datetime(2024, 1, 4, 9, 30),
            ],
            "open":   [4900.0, 4910.0, 4920.0],
            "high":   [4920.0, 4930.0, 4940.0],
            "low":    [4880.0, 4890.0, 4900.0],
            "close":  [4910.0, 4920.0, 4930.0],
            "volume": [100000, 110000, 105000],
        })

    def test_zero_source_dups_reports_zero(self):
        """When source has no duplicates, report.duplicate_timestamps == 0."""
        df = self._clean_df()
        report = validate_bars(df, "ES", "daily", source_duplicate_timestamps=0)
        assert report.duplicate_timestamps == 0

    def test_nonzero_source_dups_reported_truthfully(self):
        """When source had 3 duplicate timestamps (deduped before call), report shows 3."""
        df = self._clean_df()
        report = validate_bars(df, "ES", "daily", source_duplicate_timestamps=3)
        assert report.duplicate_timestamps == 3

    def test_nonzero_source_dups_sets_passed_false(self):
        """Source duplicates make passed=False — truthful hard-gate."""
        df = self._clean_df()
        report = validate_bars(df, "ES", "daily", source_duplicate_timestamps=5)
        assert report.passed is False

    def test_zero_source_dups_does_not_affect_pass(self):
        """Zero source dups: passed depends only on OHLC / coverage / zero-prices."""
        df = self._clean_df()
        report = validate_bars(df, "ES", "daily", source_duplicate_timestamps=0)
        # Clean data with no other violations should pass
        assert report.passed is True

    def test_source_dup_warning_message_appears(self):
        """Source dup count must appear in the warnings list."""
        df = self._clean_df()
        report = validate_bars(df, "ES", "daily", source_duplicate_timestamps=2)
        assert any("duplicate" in w.lower() for w in report.warnings), (
            f"Expected a duplicate-timestamps warning, got: {report.warnings}"
        )

    def test_df_level_check_would_return_zero(self):
        """Confirm that the df passed after dedup has no duplicates — proving that
        the old code (checking df directly) would always report 0."""
        df = self._clean_df()
        # df has no duplicates — df-level check returns 0
        dup_in_df = df.filter(pl.col("ts_event").is_duplicated()).height
        assert dup_in_df == 0
        # But source_duplicate_timestamps=4 is honoured in the report
        report = validate_bars(df, "ES", "daily", source_duplicate_timestamps=4)
        assert report.duplicate_timestamps == 4
