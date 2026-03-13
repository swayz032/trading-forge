"""Tests for crisis stress testing engine — TDD: written before implementation."""

import numpy as np
import polars as pl
import pytest

from src.engine.stress_test import (
    get_default_scenarios,
    run_stress_test,
)
from src.engine.signals import generate_signals
from src.engine.config import (
    StrategyConfig,
    IndicatorConfig,
    StopConfig,
    PositionSizeConfig,
    StressTestRequest,
    CrisisScenario,
)


# ─── Helpers ──────────────────────────────────────────────────────

def _make_ohlcv(n: int = 200, base: float = 4000.0, seed: int = 42) -> pl.DataFrame:
    """Create synthetic OHLCV data for testing."""
    rng = np.random.default_rng(seed)
    close = base + np.cumsum(rng.normal(0, 10, size=n))
    high = close + rng.uniform(5, 20, size=n)
    low = close - rng.uniform(5, 20, size=n)
    opn = close + rng.normal(0, 5, size=n)
    volume = rng.integers(1000, 50000, size=n)

    dates = pl.date_range(
        pl.date(2023, 1, 1),
        pl.date(2023, 1, 1) + pl.duration(days=n - 1),
        eager=True,
    )

    return pl.DataFrame({
        "ts_event": dates,
        "open": opn,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume.astype(np.int64),
    })


def _simple_strategy():
    return StrategyConfig(
        name="Test SMA Cross",
        symbol="ES",
        timeframe="daily",
        indicators=[
            IndicatorConfig(type="sma", period=10),
            IndicatorConfig(type="sma", period=30),
        ],
        entry_long="sma_10 > sma_30",
        entry_short="sma_10 < sma_30",
        exit="sma_10 < sma_30",
        stop_loss=StopConfig(type="atr", multiplier=2.0),
        position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
    )


# ─── Default Scenarios ────────────────────────────────────────────

class TestDefaultScenarios:
    def test_returns_8_scenarios(self):
        scenarios = get_default_scenarios()
        assert len(scenarios) == 8

    def test_scenario_names_present(self):
        scenarios = get_default_scenarios()
        names = [s.name for s in scenarios]
        assert "2008 Financial Crisis" in names
        assert "COVID Crash" in names
        assert "2022 Rate Shock" in names

    def test_all_have_stress_params(self):
        for s in get_default_scenarios():
            assert s.spread_multiplier >= 1.0
            assert 0.0 < s.fill_rate <= 1.0
            assert s.slippage_multiplier >= 1.0


# ─── Fill Rate in Signals ────────────────────────────────────────

class TestFillRate:
    def test_fill_rate_1_no_change(self):
        """fill_rate=1.0 should not reduce signals."""
        df = _make_ohlcv(100)
        # Add SMA columns manually for the expression evaluator
        df = df.with_columns([
            df["close"].rolling_mean(10).alias("sma_10"),
            df["close"].rolling_mean(30).alias("sma_30"),
        ])
        config = _simple_strategy()
        result_full = generate_signals(df, config, fill_rate=1.0)
        result_default = generate_signals(df, config)
        # Same number of entry signals
        assert result_full["entry_long"].sum() == result_default["entry_long"].sum()

    def test_fill_rate_reduces_entries(self):
        """fill_rate=0.5 should reduce entries by roughly 50%."""
        df = _make_ohlcv(500, seed=99)
        df = df.with_columns([
            df["close"].rolling_mean(10).alias("sma_10"),
            df["close"].rolling_mean(30).alias("sma_30"),
        ])
        config = _simple_strategy()
        result_full = generate_signals(df, config, fill_rate=1.0)
        result_half = generate_signals(df, config, fill_rate=0.5, fill_rate_seed=42)

        full_entries = result_full["entry_long"].sum() + result_full["entry_short"].sum()
        half_entries = result_half["entry_long"].sum() + result_half["entry_short"].sum()

        # Should be roughly half (allow 30% tolerance for randomness)
        if full_entries > 10:  # Only meaningful if enough signals
            ratio = half_entries / full_entries
            assert 0.2 < ratio < 0.8, f"fill_rate=0.5 gave ratio {ratio:.2f}"

    def test_fill_rate_zero_no_entries(self):
        """fill_rate=0.0 should produce no entries."""
        df = _make_ohlcv(100)
        df = df.with_columns([
            df["close"].rolling_mean(10).alias("sma_10"),
            df["close"].rolling_mean(30).alias("sma_30"),
        ])
        config = _simple_strategy()
        result = generate_signals(df, config, fill_rate=0.0, fill_rate_seed=42)
        assert result["entry_long"].sum() == 0
        assert result["entry_short"].sum() == 0


# ─── Stress Test Engine ──────────────────────────────────────────

class TestRunStressTest:
    def test_returns_required_keys(self):
        """Stress test result has passed, scenarios, execution_time_ms."""
        request = StressTestRequest(
            backtest_id="test-123",
            strategy=_simple_strategy(),
            scenarios=[
                CrisisScenario(
                    name="Test Crisis",
                    start_date="2023-01-01",
                    end_date="2023-03-01",
                ),
            ],
            prop_firm_max_dd=2000.0,
        )
        # Pass synthetic data loader to avoid S3 dependency
        data = _make_ohlcv(60)
        result = run_stress_test(request, data_override=data)

        assert "passed" in result
        assert "scenarios" in result
        assert "execution_time_ms" in result
        assert isinstance(result["passed"], bool)

    def test_scenario_results_structure(self):
        request = StressTestRequest(
            backtest_id="test-123",
            strategy=_simple_strategy(),
            scenarios=[
                CrisisScenario(name="C1", start_date="2023-01-01", end_date="2023-02-01"),
                CrisisScenario(name="C2", start_date="2023-02-01", end_date="2023-03-01"),
            ],
        )
        data = _make_ohlcv(60)
        result = run_stress_test(request, data_override=data)

        assert len(result["scenarios"]) == 2
        for s in result["scenarios"]:
            assert "name" in s
            assert "passed" in s
            assert "max_drawdown" in s
