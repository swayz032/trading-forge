"""Tests for core backtest engine — TDD: written before implementation."""

import json
import math
from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.sizing import compute_position_sizes
from src.engine.slippage import compute_slippage
from src.engine.config import (
    ContractSpec,
    IndicatorConfig,
    StopConfig,
    PositionSizeConfig,
    StrategyConfig,
    BacktestRequest,
    CONTRACT_SPECS,
)


# ─── Helpers ───────────────────────────────────────────────────────

def _make_ohlcv(n: int = 50, base: float = 4000.0, trend: float = 1.0) -> pl.DataFrame:
    """Create synthetic OHLCV data with controlled trend."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [base + i * trend + (i % 5) * 2 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 2.0 for c in closes],
        "high":   [c + 5.0 for c in closes],
        "low":    [c - 5.0 for c in closes],
        "close":  closes,
        "volume": [50000] * n,
    })


# ─── Position Sizing ──────────────────────────────────────────────

class TestPositionSizing:
    def test_dynamic_atr_sizing(self):
        df = _make_ohlcv(30)
        config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500)
        spec = CONTRACT_SPECS["ES"]

        # Add ATR column
        from src.engine.indicators.core import compute_atr
        atr = compute_atr(df, 14)
        df_with_atr = df.with_columns(atr.alias("atr_14"))

        sizes, over_risk = compute_position_sizes(df_with_atr, config, spec, atr_period=14)
        assert len(sizes) == 30
        # All sizes should be >= 1 (clamped min) or NaN
        for s in sizes:
            if not math.isnan(s):
                assert s >= 1

    def test_dynamic_atr_formula(self):
        """contracts = floor(target_risk / (ATR * tick_value))"""
        df = _make_ohlcv(20)
        config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500)
        spec = ContractSpec(tick_size=0.25, tick_value=12.50, point_value=50.0)

        from src.engine.indicators.core import compute_atr
        atr = compute_atr(df, 14)
        df_with_atr = df.with_columns(atr.alias("atr_14"))

        sizes, over_risk = compute_position_sizes(df_with_atr, config, spec, atr_period=14)

        # Verify last bar: floor(500 / (ATR * point_value))
        # Production uses point_value (not tick_value) for dollar risk per contract
        last_atr = atr[-1]
        if not math.isnan(last_atr):
            expected = max(1, int(500 / (last_atr * spec.point_value)))
            assert sizes[-1] == expected

    def test_fixed_sizing(self):
        df = _make_ohlcv(10)
        config = PositionSizeConfig(type="fixed", fixed_contracts=3)
        spec = CONTRACT_SPECS["ES"]

        sizes, over_risk = compute_position_sizes(df, config, spec, atr_period=14)
        assert all(s == 3 for s in sizes)


# ─── Slippage Model ───────────────────────────────────────────────

class TestSlippage:
    def test_variable_slippage(self):
        df = _make_ohlcv(30)
        spec = CONTRACT_SPECS["ES"]

        from src.engine.indicators.core import compute_atr
        atr = compute_atr(df, 14)
        df_with_atr = df.with_columns(atr.alias("atr_14"))

        slippage = compute_slippage(df_with_atr, spec, base_ticks=1.0, atr_period=14)
        assert len(slippage) == 30
        # Slippage should be positive
        for s in slippage:
            if not math.isnan(s):
                assert s >= 0

    def test_slippage_scales_with_volatility(self):
        """Bars with higher ATR get higher slippage within same dataset."""
        from src.engine.indicators.core import compute_atr
        spec = CONTRACT_SPECS["ES"]

        # Mixed vol: first 15 bars tight, next 15 bars wide
        n = 30
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        highs = [4002.0] * 15 + [4050.0] * 15  # Tight then wide
        lows = [3998.0] * 15 + [3950.0] * 15
        df = pl.DataFrame({
            "ts_event": dates,
            "open":   [4000.0] * n,
            "high":   highs,
            "low":    lows,
            "close":  [4001.0] * n,
            "volume": [50000] * n,
        })

        atr = compute_atr(df, 14)
        df_with_atr = df.with_columns(atr.alias("atr_14"))
        slippage = compute_slippage(df_with_atr, spec, atr_period=14)

        # Last bars (high vol) should have higher slippage than first bars (low vol)
        avg_first = np.nanmean(slippage[:10])
        avg_last = np.nanmean(slippage[20:])
        assert avg_last > avg_first

    def test_slippage_in_dollars(self):
        """Slippage output should be in dollar terms."""
        df = _make_ohlcv(30)
        spec = CONTRACT_SPECS["ES"]  # tick_value = $12.50

        from src.engine.indicators.core import compute_atr
        atr = compute_atr(df, 14)
        df_with_atr = df.with_columns(atr.alias("atr_14"))

        slippage = compute_slippage(df_with_atr, spec, base_ticks=1.0, atr_period=14)
        # 1 tick of ES = $12.50, so min slippage should be around that
        non_nan = [s for s in slippage if not math.isnan(s)]
        assert len(non_nan) > 0
        # Should be reasonable dollar amounts
        for s in non_nan:
            assert s > 0
            assert s < 500  # Sanity check


# ─── Backtester Output Schema ─────────────────────────────────────

class TestBacktesterOutput:
    def test_run_backtest_returns_result(self):
        """Integration test: run a simple backtest and verify output shape."""
        from src.engine.backtester import run_backtest

        config = BacktestRequest(
            strategy=StrategyConfig(
                name="SMA Cross",
                symbol="ES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=5),
                    IndicatorConfig(type="sma", period=15),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_15",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(
                    type="dynamic_atr", target_risk_dollars=500
                ),
            ),
            start_date="2023-01-01",
            end_date="2023-12-31",
            commission_per_side=4.50,
        )

        df = _make_ohlcv(200, base=4000.0, trend=0.5)
        result = run_backtest(config, data=df)

        # Verify result has required fields
        assert "total_return" in result
        assert "sharpe_ratio" in result
        assert "max_drawdown" in result
        assert "win_rate" in result
        assert "profit_factor" in result
        assert "total_trades" in result
        assert "equity_curve" in result
        assert "trades" in result
        assert "daily_pnls" in result
        assert "execution_time_ms" in result

    def test_result_is_json_serializable(self):
        """Output must be JSON-serializable for stdout bridge."""
        from src.engine.backtester import run_backtest

        config = BacktestRequest(
            strategy=StrategyConfig(
                name="Test",
                symbol="ES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=5),
                    IndicatorConfig(type="sma", period=15),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_15",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2023-01-01",
            end_date="2023-12-31",
        )

        df = _make_ohlcv(200)
        result = run_backtest(config, data=df)

        # Must serialize without error
        json_str = json.dumps(result)
        parsed = json.loads(json_str)
        assert parsed["total_trades"] == result["total_trades"]

    def test_metrics_are_reasonable(self):
        """Sanity check that metrics are within reasonable bounds."""
        from src.engine.backtester import run_backtest

        config = BacktestRequest(
            strategy=StrategyConfig(
                name="Test",
                symbol="ES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=5),
                    IndicatorConfig(type="sma", period=15),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_15",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2023-01-01",
            end_date="2023-12-31",
        )

        df = _make_ohlcv(200)
        result = run_backtest(config, data=df)

        assert 0.0 <= result["win_rate"] <= 1.0
        assert result["max_drawdown"] >= 0  # Drawdown is a positive dollar amount
        assert result["total_trades"] >= 0
        assert isinstance(result["equity_curve"], list)
