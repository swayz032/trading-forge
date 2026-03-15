"""Tests for regime detection."""

import math
from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.regime import classify_regime, should_strategy_trade


def _make_ohlcv(closes, opens=None, highs=None, lows=None):
    n = len(closes)
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    if opens is None:
        opens = [c - 0.5 for c in closes]
    if highs is None:
        highs = [c + 1.5 for c in closes]
    if lows is None:
        lows = [c - 1.5 for c in closes]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [float(x) for x in opens],
        "high": [float(x) for x in highs],
        "low": [float(x) for x in lows],
        "close": [float(x) for x in closes],
        "volume": [10000] * n,
    })


def _make_trending_up(n=60):
    return _make_ohlcv([100.0 + i * 2.0 for i in range(n)])


def _make_trending_down(n=60):
    return _make_ohlcv([200.0 - i * 2.0 for i in range(n)])


def _make_ranging(n=60):
    return _make_ohlcv([100.0 + (i % 4) * 0.5 - 1.0 for i in range(n)])


class TestClassifyRegime:
    def test_returns_dict(self):
        df = _make_trending_up()
        result = classify_regime(df)
        assert isinstance(result, dict)
        assert "regime" in result
        assert "adx" in result
        assert "atr_percentile" in result
        assert "ma_slope" in result
        assert "confidence" in result

    def test_trending_up(self):
        df = _make_trending_up(80)
        result = classify_regime(df)
        assert result["regime"] in {"TRENDING_UP", "TRANSITIONAL"}

    def test_trending_down(self):
        df = _make_trending_down(80)
        result = classify_regime(df)
        assert result["regime"] in {"TRENDING_DOWN", "TRANSITIONAL"}

    def test_valid_regime_label(self):
        df = _make_trending_up()
        result = classify_regime(df)
        valid = {"TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "HIGH_VOL", "LOW_VOL", "TRANSITIONAL"}
        assert result["regime"] in valid

    def test_confidence_0_to_1(self):
        df = _make_trending_up()
        result = classify_regime(df)
        assert 0.0 <= result["confidence"] <= 1.0

    def test_short_data_returns_transitional(self):
        df = _make_trending_up(5)
        result = classify_regime(df)
        assert result["regime"] == "TRANSITIONAL"
        assert result["confidence"] == 0.0

    def test_no_nan_values(self):
        df = _make_ranging()
        result = classify_regime(df)
        for key in ["adx", "atr_percentile", "ma_slope", "confidence"]:
            assert not math.isnan(result[key]), f"{key} is NaN"


class TestShouldStrategyTrade:
    def test_none_preferred_always_true(self):
        assert should_strategy_trade("TRENDING_UP", None) is True
        assert should_strategy_trade("RANGE_BOUND", None) is True

    def test_exact_match(self):
        assert should_strategy_trade("TRENDING_UP", "TRENDING_UP") is True
        assert should_strategy_trade("RANGE_BOUND", "RANGE_BOUND") is True

    def test_incompatible(self):
        assert should_strategy_trade("RANGE_BOUND", "TRENDING_UP") is False

    def test_transitional_preferred_trades_anywhere(self):
        assert should_strategy_trade("TRENDING_UP", "TRANSITIONAL") is True
        assert should_strategy_trade("RANGE_BOUND", "TRANSITIONAL") is True

    def test_compatible_regimes(self):
        assert should_strategy_trade("TRANSITIONAL", "TRENDING_UP") is True
        assert should_strategy_trade("LOW_VOL", "RANGE_BOUND") is True
