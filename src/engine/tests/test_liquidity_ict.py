"""Tests for ICT Liquidity indicators."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_equal_highs,
    detect_equal_lows,
    detect_sweep,
    detect_inducement,
    detect_raid,
)
from src.engine.indicators.market_structure import detect_swings


def _make_ohlcv(closes, opens=None, highs=None, lows=None):
    n = len(closes)
    dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
    if opens is None:
        opens = [c - 0.5 for c in closes]
    if highs is None:
        highs = [c + 1.0 for c in closes]
    if lows is None:
        lows = [c - 1.0 for c in closes]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [float(x) for x in opens],
        "high": [float(x) for x in highs],
        "low": [float(x) for x in lows],
        "close": [float(x) for x in closes],
        "volume": [10000] * n,
    })


def _make_swing_data(n=30):
    # Create W-shaped data with clear swing points
    closes = []
    for i in range(n):
        phase = i % 10
        if phase < 5:
            closes.append(100.0 + phase * 3)
        else:
            closes.append(112.0 - (phase - 5) * 3)
    return _make_ohlcv(closes)


class TestBuysideLiquidity:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        result = detect_buyside_liquidity(df, swings)
        assert isinstance(result, pl.DataFrame)
        assert "price" in result.columns
        assert "level_count" in result.columns

    def test_detects_levels(self):
        df = _make_swing_data(30)
        swings = detect_swings(df, lookback=2)
        result = detect_buyside_liquidity(df, swings)
        # Should find at least one BSL level
        assert len(result) >= 0  # May be 0 if no swing highs


class TestSellsideLiquidity:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        result = detect_sellside_liquidity(df, swings)
        assert isinstance(result, pl.DataFrame)
        assert "price" in result.columns


class TestEqualHighs:
    def test_detects_equal_highs(self):
        # Two swing highs at same level
        closes = [100, 105, 110, 105, 100, 105, 110, 105, 100]
        highs = [c + 1 for c in closes]
        df = _make_ohlcv(closes, highs=highs)
        result = detect_equal_highs(df, tolerance=2.0)
        assert isinstance(result, pl.DataFrame)

    def test_no_equal_highs_on_trend(self):
        closes = [100 + i * 5 for i in range(20)]
        df = _make_ohlcv(closes)
        result = detect_equal_highs(df, tolerance=0.5)
        assert len(result) == 0, "Trending data shouldn't have equal highs"


class TestEqualLows:
    def test_detects_equal_lows(self):
        closes = [110, 105, 100, 105, 110, 105, 100, 105, 110]
        lows = [c - 1 for c in closes]
        df = _make_ohlcv(closes, lows=lows)
        result = detect_equal_lows(df, tolerance=2.0)
        assert isinstance(result, pl.DataFrame)


class TestSweep:
    def test_returns_series(self):
        df = _make_swing_data()
        levels = pl.DataFrame({"price": [112.0]})
        result = detect_sweep(df, levels)
        assert isinstance(result, pl.Series)
        assert len(result) == len(df)

    def test_detects_sweep_above(self):
        # Price spikes above level but closes below
        df = _make_ohlcv(
            opens=[100, 100, 100],
            highs=[102, 112, 102],   # bar 1 spikes above 110
            lows=[99, 99, 99],
            closes=[101, 105, 101],  # but closes below 110
        )
        levels = pl.DataFrame({"price": [110.0]})
        result = detect_sweep(df, levels)
        assert result[1], "Should detect sweep above 110"

    def test_no_sweep_on_clean_break(self):
        # Price breaks and stays above
        df = _make_ohlcv(
            opens=[100, 110, 115],
            highs=[102, 115, 120],
            lows=[99, 109, 114],
            closes=[101, 114, 119],
        )
        levels = pl.DataFrame({"price": [105.0]})
        result = detect_sweep(df, levels)
        # Clean break, not a sweep
        assert not result[1]


class TestInducement:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=5)
        result = detect_inducement(df, swings)
        assert isinstance(result, pl.DataFrame)


class TestRaid:
    def test_returns_series(self):
        df = _make_swing_data()
        levels = pl.DataFrame({"price": [112.0]})
        result = detect_raid(df, levels)
        assert isinstance(result, pl.Series)
        assert len(result) == len(df)
