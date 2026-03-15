"""Tests for ICT Fibonacci indicators."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.fibonacci import (
    fib_retracement,
    ote_zone,
    fib_extensions,
    auto_swing_fib,
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


class TestFibRetracement:
    def test_known_levels(self):
        result = fib_retracement(200.0, 100.0)
        assert result["0.0"] == pytest.approx(200.0)
        assert result["0.5"] == pytest.approx(150.0)
        assert result["1.0"] == pytest.approx(100.0)

    def test_618_level(self):
        result = fib_retracement(200.0, 100.0)
        assert result["0.618"] == pytest.approx(138.2)

    def test_786_level(self):
        result = fib_retracement(200.0, 100.0)
        assert result["0.786"] == pytest.approx(121.4)

    def test_all_levels_between_high_and_low(self):
        result = fib_retracement(150.0, 100.0)
        for name, price in result.items():
            assert 100.0 <= price <= 150.0, f"Level {name}={price} outside range"

    def test_returns_dict(self):
        result = fib_retracement(200.0, 100.0)
        assert isinstance(result, dict)
        assert len(result) == 8  # 8 standard levels


class TestOTEZone:
    def test_ote_values(self):
        upper, lower = ote_zone(200.0, 100.0)
        # OTE = 0.618-0.786 retracement
        assert upper == pytest.approx(138.2)
        assert lower == pytest.approx(121.4)

    def test_ote_upper_above_lower(self):
        upper, lower = ote_zone(500.0, 400.0)
        assert upper > lower

    def test_ote_within_range(self):
        upper, lower = ote_zone(200.0, 100.0)
        assert 100.0 <= lower <= upper <= 200.0

    def test_narrow_range(self):
        upper, lower = ote_zone(101.0, 100.0)
        assert upper > lower
        assert 100.0 <= lower
        assert upper <= 101.0


class TestFibExtensions:
    def test_returns_dict(self):
        result = fib_extensions(200.0, 100.0, 138.0)
        assert isinstance(result, dict)
        assert len(result) == 5  # 5 extension levels

    def test_extensions_beyond_range(self):
        # Extensions should project beyond the original range
        result = fib_extensions(200.0, 100.0, 100.0)
        # -1.0 extension from low = low + range = 200
        assert result["-1.0"] == pytest.approx(200.0)
        # -1.618 extension from low = low + 1.618 * range = 261.8
        assert result["-1.618"] == pytest.approx(261.8)


class TestAutoSwingFib:
    def test_returns_dataframe(self):
        closes = [100, 105, 110, 105, 100, 95, 100, 105, 110, 115, 110, 105]
        df = _make_ohlcv(closes)
        swings = detect_swings(df, lookback=2)
        result = auto_swing_fib(df, swings)
        assert isinstance(result, pl.DataFrame)
        assert "level_name" in result.columns
        assert "price" in result.columns
        assert "type" in result.columns

    def test_contains_retracement_and_ote(self):
        closes = [100, 105, 110, 105, 100, 95, 100, 105, 110, 115, 110, 105]
        df = _make_ohlcv(closes)
        swings = detect_swings(df, lookback=2)
        result = auto_swing_fib(df, swings)
        if len(result) > 0:
            types = result["type"].to_list()
            assert "retracement" in types
            assert "ote" in types

    def test_empty_on_no_swings(self):
        closes = [100.0] * 10
        df = _make_ohlcv(closes)
        swings = detect_swings(df, lookback=5)
        # Filter to empty
        empty_swings = swings.filter(pl.col("price") < 0)
        result = auto_swing_fib(df, empty_swings)
        assert len(result) == 0
