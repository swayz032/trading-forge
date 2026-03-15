"""Tests for ICT SMT Divergence indicators."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.smt import (
    smt_divergence,
    custom_smt,
    es_nq_smt,
    dxy_eurusd_smt,
)


def _make_ohlcv(closes, highs=None, lows=None):
    n = len(closes)
    dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
    if highs is None:
        highs = [c + 1.0 for c in closes]
    if lows is None:
        lows = [c - 1.0 for c in closes]
    opens = [c - 0.5 for c in closes]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [float(x) for x in opens],
        "high": [float(x) for x in highs],
        "low": [float(x) for x in lows],
        "close": [float(x) for x in closes],
        "volume": [10000] * n,
    })


class TestSMTDivergence:
    def test_returns_dataframe(self):
        df_a = _make_ohlcv([100 + i for i in range(30)])
        df_b = _make_ohlcv([200 + i for i in range(30)])
        result = smt_divergence(df_a, df_b, lookback=5)
        assert isinstance(result, pl.DataFrame)
        assert "type" in result.columns
        assert "price_a" in result.columns
        assert "divergence_size" in result.columns

    def test_detects_bearish_smt(self):
        # A makes new highs, B doesn't
        closes_a = [100 + i for i in range(25)] + [130, 132, 135, 138, 140]
        closes_b = [200 + i for i in range(25)] + [224, 223, 222, 221, 220]
        highs_a = [c + 1 for c in closes_a]
        highs_b = [c + 1 for c in closes_b]
        df_a = _make_ohlcv(closes_a, highs=highs_a)
        df_b = _make_ohlcv(closes_b, highs=highs_b)
        result = smt_divergence(df_a, df_b, lookback=10)
        bearish = result.filter(pl.col("type") == "bearish")
        assert len(bearish) > 0, "Should detect bearish SMT when A makes new highs but B doesn't"

    def test_detects_bullish_smt(self):
        # A makes new lows, B doesn't
        closes_a = [200 - i for i in range(25)] + [170, 168, 165, 162, 160]
        closes_b = [100 - i * 0.2 for i in range(25)] + [96, 96.5, 97, 97.5, 98]
        lows_a = [c - 1 for c in closes_a]
        lows_b = [c - 0.5 for c in closes_b]
        df_a = _make_ohlcv(closes_a, lows=lows_a)
        df_b = _make_ohlcv(closes_b, lows=lows_b)
        result = smt_divergence(df_a, df_b, lookback=10)
        bullish = result.filter(pl.col("type") == "bullish")
        assert len(bullish) > 0, "Should detect bullish SMT when A makes new lows but B doesn't"

    def test_no_divergence_on_correlated(self):
        # Both move together → no divergence
        closes_a = [100 + i for i in range(30)]
        closes_b = [200 + i for i in range(30)]
        df_a = _make_ohlcv(closes_a)
        df_b = _make_ohlcv(closes_b)
        result = smt_divergence(df_a, df_b, lookback=5)
        assert len(result) == 0, "Perfectly correlated should have no divergence"

    def test_length_mismatch_raises(self):
        df_a = _make_ohlcv([100] * 20)
        df_b = _make_ohlcv([100] * 25)
        with pytest.raises(ValueError, match="same length"):
            smt_divergence(df_a, df_b)

    def test_divergence_size_positive(self):
        closes_a = [100 + i for i in range(25)] + [130, 132, 135, 138, 140]
        closes_b = [200 + i for i in range(25)] + [224, 223, 222, 221, 220]
        highs_a = [c + 1 for c in closes_a]
        highs_b = [c + 1 for c in closes_b]
        df_a = _make_ohlcv(closes_a, highs=highs_a)
        df_b = _make_ohlcv(closes_b, highs=highs_b)
        result = smt_divergence(df_a, df_b, lookback=10)
        for size in result["divergence_size"].to_list():
            assert size >= 0


class TestCustomSMT:
    def test_positive_correlation(self):
        df_a = _make_ohlcv([100 + i for i in range(30)])
        df_b = _make_ohlcv([200 + i for i in range(30)])
        result = custom_smt(df_a, df_b, "positive", lookback=5)
        assert isinstance(result, pl.DataFrame)

    def test_negative_correlation(self):
        # Both go up → divergence for negative correlation pair
        closes_a = [100 + i for i in range(30)]
        closes_b = [200 + i for i in range(30)]
        df_a = _make_ohlcv(closes_a)
        df_b = _make_ohlcv(closes_b)
        result = custom_smt(df_a, df_b, "negative", lookback=5)
        assert isinstance(result, pl.DataFrame)
        # Both trending up should create divergence for neg corr
        assert len(result) > 0


class TestConvenienceFunctions:
    def test_es_nq_smt(self):
        df_es = _make_ohlcv([100 + i for i in range(30)])
        df_nq = _make_ohlcv([200 + i for i in range(30)])
        result = es_nq_smt(df_es, df_nq, lookback=5)
        assert isinstance(result, pl.DataFrame)

    def test_dxy_eurusd_smt(self):
        df_dxy = _make_ohlcv([100 + i for i in range(30)])
        df_eur = _make_ohlcv([1.1 - i * 0.001 for i in range(30)])
        result = dxy_eurusd_smt(df_dxy, df_eur, lookback=5)
        assert isinstance(result, pl.DataFrame)
