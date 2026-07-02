"""
Deep-scan #11 Fix Track Q — FIX 4: vwap_with_bands + anchored_vwap in compute_htf_indicators

Tests that compute_htf_indicators() correctly dispatches vwap_with_bands and
anchored_vwap on an HTF DataFrame and emits properly suffixed column names.

PIN: vectorbt transitive imports HANG pytest collection.
     src/engine/indicators/core.py is importable standalone — verified.
     Do NOT import backtester.py or any module that pulls in vectorbt.
"""

from __future__ import annotations

from datetime import datetime, timezone

import polars as pl
import pytest

# Standalone import — no vectorbt transitive dependency
from src.engine.config import IndicatorConfig
from src.engine.indicators.core import compute_htf_indicators


# ─── Minimal OHLCV DataFrame factory ──────────────────────────────────────────

def _make_htf_df(n_bars: int = 50, start_price: float = 4800.0) -> pl.DataFrame:
    """Build a minimal HTF OHLCV DataFrame with a ts_event column."""
    from datetime import timedelta
    # Timestamps: hourly bars starting from 2026-01-02 09:30 ET (= 14:30 UTC)
    base_ts = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
    timestamps = [base_ts + timedelta(hours=i) for i in range(n_bars)]
    close = [start_price + i * 0.5 for i in range(n_bars)]
    high = [c + 2.0 for c in close]
    low = [c - 2.0 for c in close]
    volume = [1000.0] * n_bars

    return pl.DataFrame({
        "ts_event": pl.Series(timestamps).dt.cast_time_unit("us").dt.convert_time_zone("UTC"),
        "open": close,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


# ─── FIX 4: vwap_with_bands HTF ───────────────────────────────────────────────

class TestHtfVwapWithBands:
    """compute_htf_indicators with vwap_with_bands emits all 5 suffixed band columns."""

    def test_vwap_with_bands_emits_five_suffixed_columns(self) -> None:
        df = _make_htf_df()
        cfg = IndicatorConfig(type="vwap_with_bands")
        result = compute_htf_indicators(df, [cfg], suffix="_4h")

        expected_cols = [
            "vwap_4h",
            "vwap_band_1s_upper_4h",
            "vwap_band_1s_lower_4h",
            "vwap_band_2s_upper_4h",
            "vwap_band_2s_lower_4h",
        ]
        for col in expected_cols:
            assert col in result.columns, f"Expected column '{col}' not in result: {result.columns}"

    def test_vwap_with_bands_preserves_existing_columns(self) -> None:
        df = _make_htf_df()
        cfg = IndicatorConfig(type="vwap_with_bands")
        result = compute_htf_indicators(df, [cfg], suffix="_4h")

        # Original OHLCV columns must still be present
        for col in ["open", "high", "low", "close", "volume"]:
            assert col in result.columns

    def test_vwap_with_bands_column_values_finite(self) -> None:
        df = _make_htf_df()
        cfg = IndicatorConfig(type="vwap_with_bands")
        result = compute_htf_indicators(df, [cfg], suffix="_4h")

        vwap_col = result["vwap_4h"]
        # All values should be finite (no NaN or Inf after fill)
        assert vwap_col.drop_nulls().len() > 0, "vwap_4h is all-null"
        non_null = vwap_col.drop_nulls().to_list()
        assert all(v > 0 for v in non_null), f"Expected all vwap_4h > 0, got: {non_null[:5]}"

    def test_vwap_bands_are_symmetric_around_vwap(self) -> None:
        df = _make_htf_df()
        cfg = IndicatorConfig(type="vwap_with_bands")
        result = compute_htf_indicators(df, [cfg], suffix="_4h")

        # 1-sigma bands: upper >= vwap and lower <= vwap
        vwap = result["vwap_4h"].drop_nulls().to_list()
        upper_1s = result["vwap_band_1s_upper_4h"].drop_nulls().to_list()
        lower_1s = result["vwap_band_1s_lower_4h"].drop_nulls().to_list()
        # Use zip up to the length of the shortest list
        n = min(len(vwap), len(upper_1s), len(lower_1s))
        for v, u, lo in zip(vwap[:n], upper_1s[:n], lower_1s[:n]):
            assert u >= v, f"upper_1s ({u}) must be >= vwap ({v})"
            assert lo <= v, f"lower_1s ({lo}) must be <= vwap ({v})"

    def test_vwap_with_bands_suffix_1h(self) -> None:
        """Suffix variation: _1h produces _1h-suffixed columns."""
        df = _make_htf_df()
        cfg = IndicatorConfig(type="vwap_with_bands")
        result = compute_htf_indicators(df, [cfg], suffix="_1h")
        assert "vwap_1h" in result.columns
        assert "vwap_band_2s_upper_1h" in result.columns


# ─── FIX 4: anchored_vwap HTF ─────────────────────────────────────────────────

class TestHtfAnchoredVwap:
    """compute_htf_indicators with anchored_vwap emits a suffixed anchored_vwap column."""

    def test_anchored_vwap_emits_suffixed_column(self) -> None:
        df = _make_htf_df()
        anchor_ts = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
        cfg = IndicatorConfig(type="anchored_vwap", anchor_ts=anchor_ts)
        result = compute_htf_indicators(df, [cfg], suffix="_4h")

        # Column name: anchored_vwap_<anchor_iso>_4h
        iso_raw = anchor_ts.isoformat()
        col_name = "anchored_vwap_" + iso_raw.replace(":", "_").split(".")[0]
        suffixed_col = f"{col_name}_4h"
        assert suffixed_col in result.columns, (
            f"Expected '{suffixed_col}' in result. Got columns: {result.columns}"
        )

    def test_anchored_vwap_no_anchor_ts_is_noop(self) -> None:
        """If anchor_ts is None (not set), anchored_vwap should be a no-op (no column added)."""
        df = _make_htf_df()
        before_cols = set(df.columns)
        cfg = IndicatorConfig(type="anchored_vwap")  # no anchor_ts
        result = compute_htf_indicators(df, [cfg], suffix="_4h")
        after_cols = set(result.columns)
        # No new columns should have been added
        new_cols = after_cols - before_cols
        assert len(new_cols) == 0, f"Expected no new columns, got: {new_cols}"

    def test_anchored_vwap_values_after_anchor_are_non_null(self) -> None:
        df = _make_htf_df()
        anchor_ts = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
        cfg = IndicatorConfig(type="anchored_vwap", anchor_ts=anchor_ts)
        result = compute_htf_indicators(df, [cfg], suffix="_4h")

        iso_raw = anchor_ts.isoformat()
        col_name = "anchored_vwap_" + iso_raw.replace(":", "_").split(".")[0]
        col = result[f"{col_name}_4h"]
        non_null_count = col.drop_nulls().len()
        assert non_null_count > 0, "All anchored_vwap values are null — accumulation not working"

    def test_anchored_vwap_preserves_original_vwap_column_if_present(self) -> None:
        """anchored_vwap must not overwrite an existing 'vwap' column."""
        df = _make_htf_df()
        # First compute plain vwap
        from src.engine.indicators.core import compute_vwap
        df_with_vwap = df.with_columns(compute_vwap(df).alias("vwap"))

        anchor_ts = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
        cfg = IndicatorConfig(type="anchored_vwap", anchor_ts=anchor_ts)
        result = compute_htf_indicators(df_with_vwap, [cfg], suffix="_4h")

        # Original vwap must be intact
        assert "vwap" in result.columns
        original_vwap = df_with_vwap["vwap"].to_list()
        result_vwap = result["vwap"].to_list()
        assert original_vwap == result_vwap, "Existing vwap column was modified by anchored_vwap HTF dispatch"


# ─── suffix empty guard ────────────────────────────────────────────────────────

class TestHtfSuffixGuard:
    def test_empty_suffix_raises(self) -> None:
        df = _make_htf_df()
        cfg = IndicatorConfig(type="vwap_with_bands")
        with pytest.raises(ValueError, match="suffix must be non-empty"):
            compute_htf_indicators(df, [cfg], suffix="")
