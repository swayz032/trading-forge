"""Tests for compute_anchored_vwap.

Coverage:
  - Column name includes safe ISO anchor timestamp
  - Bars before anchor_ts are null
  - First anchored bar = typical_price of that bar
  - Cumulative VWAP accumulates correctly after anchor
  - Multiple anchors on same DataFrame (independent columns)
  - Anchor exactly at last bar
  - Anchor before first bar (all bars included)
  - Zero-volume safety
  - Pure function: input DataFrame unchanged
"""
from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.core import compute_anchored_vwap


# ─── Fixtures ────────────────────────────────────────────────────────────────

def _make_bars(
    start_dt: datetime,
    rows: list[dict] | None = None,
    count: int = 0,
    high: float = 5010.0,
    low: float = 5000.0,
    close: float = 5005.0,
    volume: float = 1000.0,
    bar_minutes: int = 5,
) -> pl.DataFrame:
    if rows is not None:
        return pl.DataFrame({
            "ts_event": [r["ts"] for r in rows],
            "open": [r.get("open", r.get("close", 5000.0)) for r in rows],
            "high": [r["high"] for r in rows],
            "low": [r["low"] for r in rows],
            "close": [r["close"] for r in rows],
            "volume": [r["volume"] for r in rows],
        })
    ts = [start_dt + timedelta(minutes=bar_minutes * i) for i in range(count)]
    return pl.DataFrame({
        "ts_event": ts,
        "open": [close] * count,
        "high": [high] * count,
        "low": [low] * count,
        "close": [close] * count,
        "volume": [volume] * count,
    })


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestAnchoredVwapColumnName:
    def test_column_name_format(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=10)
        anchor = datetime(2026, 1, 2, 9, 30)
        result = compute_anchored_vwap(bars, anchor)
        # Expected name: anchored_vwap_2026-01-02T09_30_00
        assert "anchored_vwap_2026-01-02T09_30_00" in result.columns

    def test_column_name_no_colons(self):
        """Colons must be replaced with underscores for safe Polars column names."""
        bars = _make_bars(datetime(2026, 1, 3, 13, 45), count=5)
        anchor = datetime(2026, 1, 3, 13, 45)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        assert ":" not in col, f"Colon in column name: {col}"

    def test_original_columns_preserved(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=10)
        original_cols = set(bars.columns)
        anchor = datetime(2026, 1, 2, 9, 45)
        result = compute_anchored_vwap(bars, anchor)
        assert original_cols.issubset(set(result.columns))

    def test_input_dataframe_unchanged(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=10)
        original_col_count = len(bars.columns)
        anchor = datetime(2026, 1, 2, 9, 40)
        _ = compute_anchored_vwap(bars, anchor)
        assert len(bars.columns) == original_col_count


class TestAnchoredVwapNullBeforeAnchor:
    def test_bars_before_anchor_are_null(self):
        base = datetime(2026, 1, 2, 9, 30)
        bars = _make_bars(base, count=20)
        anchor = datetime(2026, 1, 2, 9, 45)  # bar index 3 (0-based: 9:30,9:35,9:40,9:45)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        avwap = result[col]
        # Bars at 9:30, 9:35, 9:40 (indices 0,1,2) should be null
        assert avwap[0] is None
        assert avwap[1] is None
        assert avwap[2] is None

    def test_anchor_bar_not_null(self):
        base = datetime(2026, 1, 2, 9, 30)
        bars = _make_bars(base, count=10)
        anchor = datetime(2026, 1, 2, 9, 45)   # index 3
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        assert result[col][3] is not None

    def test_all_bars_after_anchor_not_null(self):
        base = datetime(2026, 1, 2, 9, 30)
        bars = _make_bars(base, count=15)
        anchor = datetime(2026, 1, 2, 9, 45)   # index 3
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        avwap = result[col]
        for i in range(3, 15):
            assert avwap[i] is not None, f"Bar {i} after anchor is null"


class TestAnchoredVwapMath:
    def test_first_anchored_bar_equals_typical_price(self):
        """AVWAP at anchor bar = typical price of that bar."""
        rows = [
            {"ts": datetime(2026, 1, 2, 9, 30), "high": 5002.0, "low": 4998.0, "close": 5000.0, "volume": 500.0},
            {"ts": datetime(2026, 1, 2, 9, 35), "high": 5010.0, "low": 5006.0, "close": 5008.0, "volume": 1000.0},
            {"ts": datetime(2026, 1, 2, 9, 40), "high": 5012.0, "low": 5008.0, "close": 5010.0, "volume": 800.0},
        ]
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), rows=rows)
        anchor = datetime(2026, 1, 2, 9, 35)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]

        # First anchored bar is index 1 (9:35)
        # typical_price = (5010+5006+5008)/3 = 5008.0
        expected_tp = (5010.0 + 5006.0 + 5008.0) / 3.0
        assert result[col][1] == pytest.approx(expected_tp, abs=1e-6)

    def test_cumulative_vwap_after_two_bars(self):
        """Manual AVWAP calculation across two bars."""
        rows = [
            # bar 0: pre-anchor, null
            {"ts": datetime(2026, 1, 2, 9, 30), "high": 5002.0, "low": 4998.0, "close": 5000.0, "volume": 100.0},
            # bar 1: anchor
            {"ts": datetime(2026, 1, 2, 9, 35), "high": 5012.0, "low": 5008.0, "close": 5010.0, "volume": 200.0},
            # bar 2: post-anchor
            {"ts": datetime(2026, 1, 2, 9, 40), "high": 5022.0, "low": 5018.0, "close": 5020.0, "volume": 300.0},
        ]
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), rows=rows)
        anchor = datetime(2026, 1, 2, 9, 35)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]

        tp1 = (5012.0 + 5008.0 + 5010.0) / 3.0  # = 5010.0
        tp2 = (5022.0 + 5018.0 + 5020.0) / 3.0  # = 5020.0
        vol1, vol2 = 200.0, 300.0
        # AVWAP at bar 1 = tp1 (single bar)
        assert result[col][1] == pytest.approx(tp1, abs=1e-6)
        # AVWAP at bar 2 = (tp1*vol1 + tp2*vol2) / (vol1 + vol2)
        expected_avwap2 = (tp1 * vol1 + tp2 * vol2) / (vol1 + vol2)
        assert result[col][2] == pytest.approx(expected_avwap2, abs=1e-6)

    def test_anchor_before_first_bar_all_included(self):
        """If anchor_ts < first bar ts, all bars participate."""
        base = datetime(2026, 1, 2, 9, 30)
        bars = _make_bars(base, count=10, high=5010.0, low=5000.0, close=5005.0, volume=1000.0)
        # Anchor before the data starts
        anchor = datetime(2026, 1, 1, 0, 0)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        avwap = result[col]
        # All bars should be non-null
        null_count = sum(1 for v in avwap.to_list() if v is None)
        assert null_count == 0, f"Expected 0 nulls but got {null_count}"

    def test_anchor_at_last_bar(self):
        """Anchor on the final bar: only that bar is non-null, equals its typical price."""
        base = datetime(2026, 1, 2, 9, 30)
        bars = _make_bars(base, count=5, high=5010.0, low=5000.0, close=5005.0, volume=1000.0)
        anchor = base + timedelta(minutes=5 * 4)   # last bar (index 4)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        avwap = result[col]
        for i in range(4):
            assert avwap[i] is None
        expected_tp = (5010.0 + 5000.0 + 5005.0) / 3.0
        assert avwap[4] == pytest.approx(expected_tp, abs=1e-6)


class TestAnchoredVwapMultipleAnchors:
    def test_two_independent_anchors(self):
        """Two calls produce independent columns without mutual interference."""
        base = datetime(2026, 1, 2, 9, 30)
        bars = _make_bars(base, count=15)
        anchor1 = datetime(2026, 1, 2, 9, 35)
        anchor2 = datetime(2026, 1, 2, 9, 55)
        result = compute_anchored_vwap(bars, anchor1)
        result = compute_anchored_vwap(result, anchor2)

        col1 = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        col2 = [c for c in result.columns if c.startswith("anchored_vwap_")][1]
        assert col1 != col2

        # col1 is non-null starting at index 1; col2 is non-null starting at index 5
        assert result[col1][0] is None
        assert result[col1][1] is not None
        assert result[col2][0] is None
        assert result[col2][4] is None
        assert result[col2][5] is not None


class TestAnchoredVwapZeroVolume:
    def test_zero_volume_bars_no_nan(self):
        """Zero-volume bars after anchor must not produce NaN or inf."""
        rows = [
            {"ts": datetime(2026, 1, 2, 9, 30), "high": 5002.0, "low": 4998.0, "close": 5000.0, "volume": 1000.0},
            {"ts": datetime(2026, 1, 2, 9, 35), "high": 5003.0, "low": 4999.0, "close": 5001.0, "volume": 0.0},
            {"ts": datetime(2026, 1, 2, 9, 40), "high": 5004.0, "low": 5000.0, "close": 5002.0, "volume": 0.0},
        ]
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), rows=rows)
        anchor = datetime(2026, 1, 2, 9, 30)
        result = compute_anchored_vwap(bars, anchor)
        col = [c for c in result.columns if c.startswith("anchored_vwap_")][0]
        avwap = result[col]
        for i, v in enumerate(avwap.to_list()):
            if v is not None:
                import math
                assert not math.isnan(v), f"NaN at bar {i}"
                assert not math.isinf(v), f"Inf at bar {i}"
