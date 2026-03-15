"""Tests for ICT Order Flow indicators."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.order_flow import (
    detect_bullish_ob,
    detect_bearish_ob,
    detect_breaker,
    detect_mitigation,
    detect_rejection,
    detect_propulsion,
)
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.price_delivery import detect_fvg


def _make_ohlcv(opens, highs, lows, closes):
    n = len(closes)
    dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [float(x) for x in opens],
        "high": [float(x) for x in highs],
        "low": [float(x) for x in lows],
        "close": [float(x) for x in closes],
        "volume": [10000] * n,
    })


def _make_swing_data():
    """Create data with clear swing high and swing low."""
    # Down, swing low at ~index 5, then up, swing high at ~index 10
    closes = [110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110, 108, 106]
    opens = [c + 0.5 for c in closes]
    highs = [c + 2 for c in closes]
    lows = [c - 2 for c in closes]
    return _make_ohlcv(opens, highs, lows, closes)


class TestBullishOB:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        result = detect_bullish_ob(df, swings)
        assert isinstance(result, pl.DataFrame)
        assert "index" in result.columns
        assert "top" in result.columns
        assert "type" in result.columns

    def test_type_is_bullish(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        result = detect_bullish_ob(df, swings)
        if len(result) > 0:
            assert all(t == "bullish" for t in result["type"].to_list())

    def test_ob_before_swing_low(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        swing_lows = swings.filter(pl.col("type") == "low")
        result = detect_bullish_ob(df, swings)
        if len(result) > 0 and len(swing_lows) > 0:
            # OB index should be <= swing low index
            assert result["index"][0] <= swing_lows["index"][0]


class TestBearishOB:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        result = detect_bearish_ob(df, swings)
        assert isinstance(result, pl.DataFrame)

    def test_type_is_bearish(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        result = detect_bearish_ob(df, swings)
        if len(result) > 0:
            assert all(t == "bearish" for t in result["type"].to_list())


class TestBreaker:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        obs = detect_bullish_ob(df, swings)
        result = detect_breaker(df, obs)
        assert isinstance(result, pl.DataFrame)

    def test_empty_on_no_obs(self):
        df = _make_swing_data()
        empty_obs = pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })
        result = detect_breaker(df, empty_obs)
        assert len(result) == 0


class TestMitigation:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        obs = detect_bullish_ob(df, swings)
        result = detect_mitigation(df, obs)
        assert isinstance(result, pl.DataFrame)


class TestRejection:
    def test_detects_bearish_rejection(self):
        # Long upper wick, small body
        df = _make_ohlcv(
            opens=[100, 100, 100],
            highs=[100, 115, 100],  # huge upper wick
            lows=[99, 99, 99],
            closes=[100, 101, 100],  # small body
        )
        result = detect_rejection(df)
        bearish = result.filter(pl.col("type") == "bearish")
        assert len(bearish) > 0, "Should detect bearish rejection with long upper wick"

    def test_detects_bullish_rejection(self):
        # Long lower wick, small body
        df = _make_ohlcv(
            opens=[100, 100, 100],
            highs=[101, 101, 101],
            lows=[100, 85, 100],  # huge lower wick
            closes=[100, 99, 100],  # small body
        )
        result = detect_rejection(df)
        bullish = result.filter(pl.col("type") == "bullish")
        assert len(bullish) > 0, "Should detect bullish rejection with long lower wick"

    def test_no_rejection_on_normal_candles(self):
        df = _make_ohlcv(
            opens=[100, 101, 102],
            highs=[102, 103, 104],
            lows=[99, 100, 101],
            closes=[101, 102, 103],
        )
        result = detect_rejection(df)
        assert len(result) == 0


class TestPropulsion:
    def test_returns_dataframe(self):
        df = _make_swing_data()
        swings = detect_swings(df, lookback=2)
        obs = detect_bullish_ob(df, swings)
        fvgs = detect_fvg(df)
        result = detect_propulsion(df, obs, fvgs)
        assert isinstance(result, pl.DataFrame)

    def test_empty_on_no_overlap(self):
        empty_obs = pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })
        empty_fvgs = pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8, "top": pl.Float64,
            "bottom": pl.Float64, "midpoint": pl.Float64, "filled": pl.Boolean,
        })
        df = _make_swing_data()
        result = detect_propulsion(df, empty_obs, empty_fvgs)
        assert len(result) == 0
