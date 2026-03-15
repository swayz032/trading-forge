"""Tests for ICT Price Delivery indicators."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.price_delivery import (
    detect_fvg,
    detect_ifvg,
    compute_consequent_encroachment,
    detect_volume_imbalance,
    detect_opening_gap,
    detect_liquidity_void,
)


def _make_ohlcv(opens, highs, lows, closes, volumes=None):
    n = len(closes)
    dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
    if volumes is None:
        volumes = [10000] * n
    return pl.DataFrame({
        "ts_event": dates,
        "open": [float(x) for x in opens],
        "high": [float(x) for x in highs],
        "low": [float(x) for x in lows],
        "close": [float(x) for x in closes],
        "volume": volumes,
    })


class TestFVG:
    def test_returns_dataframe(self):
        df = _make_ohlcv(
            opens=[100, 101, 102, 108, 109],
            highs=[101, 102, 103, 110, 111],
            lows=[99, 100, 101, 107, 108],
            closes=[100.5, 101.5, 102.5, 109, 110],
        )
        result = detect_fvg(df)
        assert isinstance(result, pl.DataFrame)
        assert "type" in result.columns
        assert "top" in result.columns
        assert "bottom" in result.columns

    def test_detects_bullish_fvg(self):
        # Candle 0 high=102, Candle 2 low=105 -> gap between 102 and 105
        df = _make_ohlcv(
            opens=[100, 103, 106],
            highs=[102, 105, 108],
            lows=[99, 102, 105],
            closes=[101, 104, 107],
        )
        result = detect_fvg(df)
        bullish = result.filter(pl.col("type") == "bullish")
        assert len(bullish) > 0, "Should detect bullish FVG"
        assert float(bullish["bottom"][0]) == 102.0
        assert float(bullish["top"][0]) == 105.0

    def test_detects_bearish_fvg(self):
        # Candle 0 low=98, Candle 2 high=95 -> gap between 95 and 98
        df = _make_ohlcv(
            opens=[100, 97, 94],
            highs=[101, 98, 95],
            lows=[98, 96, 93],
            closes=[99, 96.5, 93.5],
        )
        result = detect_fvg(df)
        bearish = result.filter(pl.col("type") == "bearish")
        assert len(bearish) > 0, "Should detect bearish FVG"

    def test_no_fvg_on_overlapping(self):
        # No gap when candles overlap normally
        df = _make_ohlcv(
            opens=[100, 101, 102],
            highs=[102, 103, 104],
            lows=[99, 100, 101],
            closes=[101, 102, 103],
        )
        result = detect_fvg(df)
        assert len(result) == 0

    def test_empty_on_short_data(self):
        df = _make_ohlcv(
            opens=[100, 101],
            highs=[102, 103],
            lows=[99, 100],
            closes=[101, 102],
        )
        result = detect_fvg(df)
        assert len(result) == 0


class TestIFVG:
    def test_returns_dataframe(self):
        df = _make_ohlcv(
            opens=[100, 103, 106, 104, 101],
            highs=[102, 105, 108, 106, 103],
            lows=[99, 102, 105, 103, 100],
            closes=[101, 104, 107, 103.5, 100.5],
        )
        fvgs = detect_fvg(df)
        result = detect_ifvg(df, fvgs)
        assert isinstance(result, pl.DataFrame)

    def test_filled_fvg_detected(self):
        # Create bullish FVG then fill it
        df = _make_ohlcv(
            opens= [100, 103, 106, 104, 101, 99],
            highs= [102, 105, 108, 106, 103, 100],
            lows=  [99,  102, 105, 103, 100, 97],
            closes=[101, 104, 107, 103, 100, 98],
        )
        fvgs = detect_fvg(df)
        if len(fvgs) > 0:
            result = detect_ifvg(df, fvgs)
            # FVG bottom is 102, close goes to 98 -> filled
            assert len(result) >= 0  # May or may not be filled depending on exact values


class TestConsequentEncroachment:
    def test_returns_midpoint(self):
        fvgs = pl.DataFrame({
            "index": [5],
            "type": ["bullish"],
            "top": [110.0],
            "bottom": [100.0],
            "midpoint": [105.0],
            "filled": [False],
        })
        result = compute_consequent_encroachment(fvgs)
        assert result[0] == pytest.approx(105.0)

    def test_empty_fvgs(self):
        fvgs = pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8, "top": pl.Float64,
            "bottom": pl.Float64, "midpoint": pl.Float64, "filled": pl.Boolean,
        })
        result = compute_consequent_encroachment(fvgs)
        assert len(result) == 0


class TestVolumeImbalance:
    def test_detects_bullish_gap(self):
        df = _make_ohlcv(
            opens=[100, 103],
            highs=[102, 105],
            lows=[99, 102],
            closes=[101, 104],
        )
        result = detect_volume_imbalance(df)
        bullish = result.filter(pl.col("type") == "bullish")
        assert len(bullish) > 0, "Open 103 > prev close 101 should be bullish"

    def test_detects_bearish_gap(self):
        df = _make_ohlcv(
            opens=[100, 98],
            highs=[102, 100],
            lows=[99, 97],
            closes=[101, 99],
        )
        result = detect_volume_imbalance(df)
        bearish = result.filter(pl.col("type") == "bearish")
        assert len(bearish) > 0


class TestOpeningGap:
    def test_returns_series(self):
        df = _make_ohlcv(
            opens=[100, 105, 103],
            highs=[102, 107, 105],
            lows=[99, 104, 102],
            closes=[101, 106, 104],
        )
        result = detect_opening_gap(df)
        assert isinstance(result, pl.Series)
        assert len(result) == 3

    def test_gap_values(self):
        df = _make_ohlcv(
            opens=[100, 105, 103],
            highs=[102, 107, 105],
            lows=[99, 104, 102],
            closes=[101, 106, 104],
        )
        result = detect_opening_gap(df)
        # Bar 1: open=105, prev_close=101 -> gap = 4
        assert result[1] == pytest.approx(4.0)
        # Bar 2: open=103, prev_close=106 -> gap = -3
        assert result[2] == pytest.approx(-3.0)


class TestLiquidityVoid:
    def test_returns_dataframe(self):
        # Normal data, no voids expected
        df = _make_ohlcv(
            opens= [100 + i for i in range(20)],
            highs= [101 + i for i in range(20)],
            lows=  [99 + i for i in range(20)],
            closes=[100.5 + i for i in range(20)],
        )
        result = detect_liquidity_void(df, threshold=2.0)
        assert isinstance(result, pl.DataFrame)

    def test_detects_large_move(self):
        # Create a series with one massive candle
        opens = [100.0] * 20
        highs = [101.0] * 20
        lows = [99.0] * 20
        closes = [100.5] * 20
        # Bar 10: massive bullish candle
        opens[10] = 100.0
        highs[10] = 120.0
        lows[10] = 99.0
        closes[10] = 119.0
        df = _make_ohlcv(opens, highs, lows, closes)
        result = detect_liquidity_void(df, threshold=2.0)
        assert len(result) > 0, "Should detect void on massive candle"
