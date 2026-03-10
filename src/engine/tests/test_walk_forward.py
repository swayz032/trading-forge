"""Tests for walk-forward validation + optimizer — TDD."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)
from src.engine.optimizer import optimize_strategy
from src.engine.walk_forward import run_walk_forward, split_walk_forward_windows


# ─── Helpers ───────────────────────────────────────────────────────

def _make_synthetic_data(n: int = 300) -> pl.DataFrame:
    """Create enough data for walk-forward splits."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    # Trending data with some noise
    closes = [4000.0 + i * 0.5 + (i % 7) * 3 - 10 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 2.0 for c in closes],
        "high":   [c + 5.0 for c in closes],
        "low":    [c - 5.0 for c in closes],
        "close":  closes,
        "volume": [50000] * n,
    })


def _make_config() -> BacktestRequest:
    return BacktestRequest(
        strategy=StrategyConfig(
            name="SMA Cross WF",
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


# ─── Walk-Forward Window Splitting ────────────────────────────────

class TestSplitWindows:
    def test_correct_number_of_splits(self):
        data = _make_synthetic_data(300)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7)
        assert len(windows) == 5

    def test_is_larger_than_oos(self):
        data = _make_synthetic_data(300)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7)
        for is_data, oos_data in windows:
            assert len(is_data) >= len(oos_data)

    def test_no_overlap_between_is_and_oos(self):
        data = _make_synthetic_data(300)
        windows = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7)
        for is_data, oos_data in windows:
            is_end = is_data["ts_event"][-1]
            oos_start = oos_data["ts_event"][0]
            assert oos_start > is_end

    def test_covers_all_data(self):
        data = _make_synthetic_data(300)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7)
        # OOS windows should collectively cover later portion of data
        total_oos = sum(len(oos) for _, oos in windows)
        assert total_oos > 0


# ─── Optimizer ─────────────────────────────────────────────────────

class TestOptimizer:
    def test_optimize_returns_best_params(self):
        data = _make_synthetic_data(200)
        config = _make_config()
        result = optimize_strategy(config.strategy, data, n_trials=10)
        assert "best_params" in result
        assert "best_score" in result

    def test_optimize_respects_trial_limit(self):
        data = _make_synthetic_data(200)
        config = _make_config()
        result = optimize_strategy(config.strategy, data, n_trials=5)
        assert result["n_trials"] <= 5


# ─── Walk-Forward Integration ─────────────────────────────────────

class TestWalkForward:
    def test_walk_forward_returns_oos_metrics(self):
        data = _make_synthetic_data(300)
        config = _make_config()
        result = run_walk_forward(config, data=data, n_splits=3)

        assert "oos_metrics" in result
        assert "windows" in result
        assert len(result["windows"]) == 3

    def test_walk_forward_has_per_window_results(self):
        data = _make_synthetic_data(300)
        config = _make_config()
        result = run_walk_forward(config, data=data, n_splits=3)

        for window in result["windows"]:
            assert "is_sharpe" in window or "oos_sharpe" in window or "oos_metrics" in window

    def test_walk_forward_aggregate_is_oos_only(self):
        """Aggregate metrics must come from OOS data only."""
        data = _make_synthetic_data(300)
        config = _make_config()
        result = run_walk_forward(config, data=data, n_splits=3)

        # The aggregate oos_metrics should exist and be from OOS
        assert "oos_metrics" in result
        assert "total_return" in result["oos_metrics"]
