"""Tests for indicator library — TDD: written before indicators/core.py."""

import math
from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.core import (
    compute_sma,
    compute_ema,
    compute_rsi,
    compute_atr,
    compute_macd,
    compute_bbands,
    compute_vwap,
    compute_indicators,
)
from src.engine.config import IndicatorConfig


# ─── Helpers ───────────────────────────────────────────────────────

def _make_df(close: list[float], n: int | None = None) -> pl.DataFrame:
    """Create minimal OHLCV DataFrame from close prices."""
    if n is None:
        n = len(close)
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates[:len(close)],
        "open":   [c - 1.0 for c in close],
        "high":   [c + 2.0 for c in close],
        "low":    [c - 2.0 for c in close],
        "close":  close,
        "volume": [10000] * len(close),
    })


def _make_ohlcv_df(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[int] | None = None,
) -> pl.DataFrame:
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


# ─── SMA ───────────────────────────────────────────────────────────

class TestSMA:
    def test_sma_3_known_values(self):
        df = _make_df([1.0, 2.0, 3.0, 4.0, 5.0])
        result = compute_sma(df["close"], 3)
        assert result[0] is None or math.isnan(result[0])
        assert result[1] is None or math.isnan(result[1])
        assert result[2] == pytest.approx(2.0)
        assert result[3] == pytest.approx(3.0)
        assert result[4] == pytest.approx(4.0)

    def test_sma_period_1(self):
        df = _make_df([10.0, 20.0, 30.0])
        result = compute_sma(df["close"], 1)
        assert result[0] == pytest.approx(10.0)
        assert result[1] == pytest.approx(20.0)

    def test_sma_returns_series(self):
        df = _make_df([1.0, 2.0, 3.0, 4.0])
        result = compute_sma(df["close"], 2)
        assert isinstance(result, pl.Series)
        assert len(result) == 4


# ─── EMA ───────────────────────────────────────────────────────────

class TestEMA:
    def test_ema_basic(self):
        df = _make_df([1.0, 2.0, 3.0, 4.0, 5.0])
        result = compute_ema(df["close"], 3)
        assert len(result) == 5
        # EMA should be between min and max
        for v in result.to_list():
            if v is not None and not math.isnan(v):
                assert 1.0 <= v <= 5.0

    def test_ema_converges_to_constant(self):
        df = _make_df([5.0] * 20)
        result = compute_ema(df["close"], 5)
        # After enough periods, EMA of constant = constant
        assert result[-1] == pytest.approx(5.0, abs=0.01)


# ─── RSI ───────────────────────────────────────────────────────────

class TestRSI:
    def test_rsi_all_gains(self):
        # Monotonically increasing → RSI should approach 100
        df = _make_df([float(i) for i in range(1, 22)])
        result = compute_rsi(df["close"], 14)
        last_rsi = result[-1]
        assert last_rsi is not None and not math.isnan(last_rsi)
        assert last_rsi > 90.0

    def test_rsi_all_losses(self):
        # Monotonically decreasing → RSI should approach 0
        df = _make_df([float(i) for i in range(21, 0, -1)])
        result = compute_rsi(df["close"], 14)
        last_rsi = result[-1]
        assert last_rsi is not None and not math.isnan(last_rsi)
        assert last_rsi < 10.0

    def test_rsi_range(self):
        # RSI must always be 0-100
        prices = [100 + (i % 7) * 3 - 10 for i in range(50)]
        df = _make_df([float(p) for p in prices])
        result = compute_rsi(df["close"], 14)
        for v in result.to_list():
            if v is not None and not math.isnan(v):
                assert 0.0 <= v <= 100.0


# ─── ATR ───────────────────────────────────────────────────────────

class TestATR:
    def test_atr_basic(self):
        # With consistent range, ATR should reflect that range
        df = _make_ohlcv_df(
            opens=  [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0],
            highs=  [105.0, 106.0, 107.0, 108.0, 109.0, 110.0, 111.0, 112.0, 113.0, 114.0],
            lows=   [ 95.0,  96.0,  97.0,  98.0,  99.0, 100.0, 101.0, 102.0, 103.0, 104.0],
            closes= [102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0, 110.0, 111.0],
        )
        result = compute_atr(df, 5)
        assert len(result) == 10
        # Consistent 10-point range → ATR around 10
        last_atr = result[-1]
        assert last_atr is not None and not math.isnan(last_atr)
        assert 9.0 <= last_atr <= 11.0

    def test_atr_positive(self):
        df = _make_ohlcv_df(
            opens=  [100.0, 102.0, 98.0, 105.0, 97.0],
            highs=  [108.0, 110.0, 106.0, 112.0, 105.0],
            lows=   [ 95.0,  97.0,  93.0, 100.0,  92.0],
            closes= [103.0, 99.0, 104.0, 98.0, 101.0],
        )
        result = compute_atr(df, 3)
        for v in result.to_list():
            if v is not None and not math.isnan(v):
                assert v > 0


# ─── MACD ──────────────────────────────────────────────────────────

class TestMACD:
    def test_macd_columns(self):
        prices = [100 + i * 0.5 for i in range(40)]
        df = _make_df(prices)
        macd_line, signal_line, histogram = compute_macd(df["close"], 12, 26, 9)
        assert len(macd_line) == 40
        assert len(signal_line) == 40
        assert len(histogram) == 40

    def test_macd_histogram_is_difference(self):
        prices = [100 + i * 0.5 + (i % 5) for i in range(40)]
        df = _make_df(prices)
        macd_line, signal_line, histogram = compute_macd(df["close"], 12, 26, 9)
        # histogram = macd_line - signal_line for non-null values
        for i in range(len(histogram)):
            m = macd_line[i]
            s = signal_line[i]
            h = histogram[i]
            if all(v is not None and not math.isnan(v) for v in [m, s, h]):
                assert h == pytest.approx(m - s, abs=0.001)


# ─── Bollinger Bands ──────────────────────────────────────────────

class TestBollingerBands:
    def test_bbands_structure(self):
        prices = [100 + i * 0.3 for i in range(30)]
        df = _make_df(prices)
        upper, middle, lower = compute_bbands(df["close"], 20, 2.0)
        assert len(upper) == 30
        assert len(middle) == 30
        assert len(lower) == 30

    def test_bbands_ordering(self):
        prices = [100 + i * 0.3 + (i % 3) for i in range(30)]
        df = _make_df(prices)
        upper, middle, lower = compute_bbands(df["close"], 20, 2.0)
        # upper > middle > lower for all computed values
        for i in range(20, 30):
            u, m, l_ = upper[i], middle[i], lower[i]
            if all(v is not None and not math.isnan(v) for v in [u, m, l_]):
                assert u > m > l_

    def test_bbands_width_increases_with_volatility(self):
        # Low vol then high vol
        low_vol = [100.0] * 20
        high_vol = [100 + ((-1)**i) * 10 for i in range(20)]
        df_low = _make_df(low_vol)
        df_high = _make_df(high_vol)
        u_low, _, l_low = compute_bbands(df_low["close"], 10, 2.0)
        u_high, _, l_high = compute_bbands(df_high["close"], 10, 2.0)
        # High vol should have wider bands
        width_low = u_low[-1] - l_low[-1]
        width_high = u_high[-1] - l_high[-1]
        assert width_high > width_low


# ─── VWAP ──────────────────────────────────────────────────────────

class TestVWAP:
    def test_vwap_single_day(self):
        # Single day: VWAP = cumulative(typical * vol) / cumulative(vol)
        df = _make_ohlcv_df(
            opens=  [100.0, 101.0, 102.0],
            highs=  [105.0, 106.0, 107.0],
            lows=   [ 95.0,  96.0,  97.0],
            closes= [102.0, 103.0, 104.0],
            volumes=[1000, 2000, 3000],
        )
        result = compute_vwap(df)
        assert len(result) == 3
        # First bar: typical = (105+95+102)/3 = 100.667
        typical_0 = (105.0 + 95.0 + 102.0) / 3
        assert result[0] == pytest.approx(typical_0, abs=0.01)

    def test_vwap_weighted_towards_volume(self):
        # High volume bar should pull VWAP toward its price
        df = _make_ohlcv_df(
            opens=  [100.0, 200.0],
            highs=  [100.0, 200.0],
            lows=   [100.0, 200.0],
            closes= [100.0, 200.0],
            volumes=[100, 10000],
        )
        result = compute_vwap(df)
        # VWAP should be much closer to 200 than 100
        assert result[-1] > 190.0


# ─── Dispatcher ────────────────────────────────────────────────────

class TestComputeIndicators:
    def test_adds_sma_column(self):
        df = _make_df([float(i) for i in range(1, 31)])
        configs = [IndicatorConfig(type="sma", period=10)]
        result = compute_indicators(df, configs)
        assert "sma_10" in result.columns

    def test_adds_multiple_indicators(self):
        df = _make_df([float(i) for i in range(1, 31)])
        configs = [
            IndicatorConfig(type="sma", period=10),
            IndicatorConfig(type="ema", period=9),
            IndicatorConfig(type="rsi", period=14),
        ]
        result = compute_indicators(df, configs)
        assert "sma_10" in result.columns
        assert "ema_9" in result.columns
        assert "rsi_14" in result.columns

    def test_adds_atr_column(self):
        df = _make_df([100 + i * 0.5 for i in range(30)])
        configs = [IndicatorConfig(type="atr", period=14)]
        result = compute_indicators(df, configs)
        assert "atr_14" in result.columns

    def test_adds_macd_columns(self):
        df = _make_df([100 + i * 0.5 for i in range(40)])
        configs = [IndicatorConfig(type="macd", period=12, fast=12, slow=26, signal=9)]
        result = compute_indicators(df, configs)
        assert "macd_line" in result.columns
        assert "macd_signal" in result.columns
        assert "macd_hist" in result.columns

    def test_adds_bbands_columns(self):
        df = _make_df([100 + i * 0.3 for i in range(30)])
        configs = [IndicatorConfig(type="bbands", period=20)]
        result = compute_indicators(df, configs)
        assert "bb_upper_20" in result.columns
        assert "bb_middle_20" in result.columns
        assert "bb_lower_20" in result.columns

    def test_adds_vwap_column(self):
        df = _make_df([100 + i * 0.3 for i in range(30)])
        configs = [IndicatorConfig(type="vwap", period=1)]
        result = compute_indicators(df, configs)
        assert "vwap" in result.columns

    def test_preserves_original_columns(self):
        df = _make_df([float(i) for i in range(1, 31)])
        configs = [IndicatorConfig(type="sma", period=10)]
        result = compute_indicators(df, configs)
        for col in ["ts_event", "open", "high", "low", "close", "volume"]:
            assert col in result.columns
