"""Tests for ADX and ADR indicators."""

import math
from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.core import compute_adx, compute_adr, compute_indicators
from src.engine.config import IndicatorConfig


def _make_ohlcv_df(opens, highs, lows, closes, volumes=None):
    n = len(closes)
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    if volumes is None:
        volumes = [10000] * n
    return pl.DataFrame({
        "ts_event": dates,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    })


def _make_trending_df(n=50, direction="up"):
    """Generate clearly trending OHLCV data."""
    closes = []
    for i in range(n):
        if direction == "up":
            closes.append(100.0 + i * 2.0)
        else:
            closes.append(200.0 - i * 2.0)
    opens = [c - 0.5 for c in closes]
    highs = [c + 1.5 for c in closes]
    lows = [c - 1.5 for c in closes]
    return _make_ohlcv_df(opens, highs, lows, closes)


def _make_ranging_df(n=50):
    """Generate ranging/choppy OHLCV data."""
    closes = [100.0 + (i % 4) * 1.0 - 1.5 for i in range(n)]
    opens = [c - 0.3 for c in closes]
    highs = [c + 0.8 for c in closes]
    lows = [c - 0.8 for c in closes]
    return _make_ohlcv_df(opens, highs, lows, closes)


class TestADX:
    def test_adx_returns_series(self):
        df = _make_trending_df(30)
        result = compute_adx(df, 14)
        assert isinstance(result, pl.Series)
        assert len(result) == 30

    def test_adx_trending_above_25(self):
        df = _make_trending_df(50, direction="up")
        result = compute_adx(df, 14)
        # Last values should indicate strong trend
        last_val = result[-1]
        assert last_val is not None and not math.isnan(last_val)
        assert last_val > 25.0, f"ADX should be > 25 on trending data, got {last_val}"

    def test_adx_ranging_below_25(self):
        df = _make_ranging_df(50)
        result = compute_adx(df, 14)
        last_val = result[-1]
        assert last_val is not None and not math.isnan(last_val)
        assert last_val < 25.0, f"ADX should be < 25 on ranging data, got {last_val}"

    def test_adx_range_0_100(self):
        df = _make_trending_df(50)
        result = compute_adx(df, 14)
        for v in result.to_list():
            if v is not None and not math.isnan(v):
                assert 0.0 <= v <= 100.0, f"ADX out of range: {v}"

    def test_adx_dispatcher(self):
        df = _make_trending_df(30)
        configs = [IndicatorConfig(type="adx", period=14)]
        result = compute_indicators(df, configs)
        assert "adx_14" in result.columns


class TestADR:
    def test_adr_returns_series(self):
        df = _make_trending_df(20)
        result = compute_adr(df, 5)
        assert isinstance(result, pl.Series)
        assert len(result) == 20

    def test_adr_matches_manual(self):
        df = _make_ohlcv_df(
            opens=[100.0, 101.0, 102.0, 103.0, 104.0],
            highs=[105.0, 106.0, 107.0, 108.0, 109.0],
            lows=[95.0, 96.0, 97.0, 98.0, 99.0],
            closes=[102.0, 103.0, 104.0, 105.0, 106.0],
        )
        result = compute_adr(df, 3)
        # Each bar has range = 10.0, so ADR(3) at bar[2] = 10.0
        assert result[2] == pytest.approx(10.0)
        assert result[4] == pytest.approx(10.0)

    def test_adr_positive(self):
        df = _make_trending_df(20)
        result = compute_adr(df, 5)
        for v in result.to_list():
            if v is not None and not math.isnan(v):
                assert v > 0

    def test_adr_dispatcher(self):
        df = _make_trending_df(20)
        configs = [IndicatorConfig(type="adr", period=5)]
        result = compute_indicators(df, configs)
        assert "adr_5" in result.columns
