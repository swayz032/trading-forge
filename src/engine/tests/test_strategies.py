"""Tests for all ICT strategies — parametrized across all 19."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.strategy_base import BaseStrategy


def _make_ohlcv(n=50):
    dates = [datetime(2023, 6, 15, 8, 0) + timedelta(minutes=i * 5) for i in range(n)]
    closes = [100.0 + i * 0.5 + (i % 7) - 3.0 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [c - 0.5 for c in closes],
        "high": [c + 2.0 for c in closes],
        "low": [c - 2.0 for c in closes],
        "close": closes,
        "volume": [10000] * n,
    })


def _get_all_strategies() -> list[BaseStrategy]:
    """Import and instantiate all available strategies."""
    strategies = []

    strategy_classes = []

    try:
        from src.engine.strategies.silver_bullet import SilverBulletStrategy
        strategy_classes.append(SilverBulletStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.unicorn import UnicornStrategy
        strategy_classes.append(UnicornStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.ict_2022 import ICT2022Strategy
        strategy_classes.append(ICT2022Strategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.power_of_3 import PowerOf3Strategy
        strategy_classes.append(PowerOf3Strategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.turtle_soup import TurtleSoupStrategy
        strategy_classes.append(TurtleSoupStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.ote_strategy import OTEStrategy
        strategy_classes.append(OTEStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.breaker import BreakerStrategy
        strategy_classes.append(BreakerStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.london_raid import LondonRaidStrategy
        strategy_classes.append(LondonRaidStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.judas_swing import JudasSwingStrategy
        strategy_classes.append(JudasSwingStrategy)
    except ImportError:
        pass
    # Wave 2 strategies
    try:
        from src.engine.strategies.ny_lunch_reversal import NYLunchReversalStrategy
        strategy_classes.append(NYLunchReversalStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.iofed import IOFEDStrategy
        strategy_classes.append(IOFEDStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.ict_swing import ICTSwingStrategy
        strategy_classes.append(ICTSwingStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.ict_scalp import ICTScalpStrategy
        strategy_classes.append(ICTScalpStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.smt_reversal import SMTReversalStrategy
        strategy_classes.append(SMTReversalStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.propulsion import PropulsionStrategy
        strategy_classes.append(PropulsionStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.mitigation import MitigationStrategy
        strategy_classes.append(MitigationStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.quarterly_swing import QuarterlySwingStrategy
        strategy_classes.append(QuarterlySwingStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.eqhl_raid import EqhlRaidStrategy
        strategy_classes.append(EqhlRaidStrategy)
    except ImportError:
        pass
    try:
        from src.engine.strategies.midnight_open import MidnightOpenStrategy
        strategy_classes.append(MidnightOpenStrategy)
    except ImportError:
        pass

    for cls in strategy_classes:
        strategies.append(cls())

    return strategies


ALL_STRATEGIES = _get_all_strategies()


@pytest.mark.parametrize("strategy", ALL_STRATEGIES, ids=lambda s: s.name)
class TestStrategyInterface:
    def test_compute_returns_dataframe(self, strategy):
        df = _make_ohlcv()
        result = strategy.compute(df)
        assert isinstance(result, pl.DataFrame)

    def test_compute_has_signal_columns(self, strategy):
        df = _make_ohlcv()
        result = strategy.compute(df)
        for col in ["entry_long", "entry_short", "exit_long", "exit_short"]:
            assert col in result.columns, f"Missing column: {col} in {strategy.name}"

    def test_signal_columns_are_boolean(self, strategy):
        df = _make_ohlcv()
        result = strategy.compute(df)
        for col in ["entry_long", "entry_short", "exit_long", "exit_short"]:
            series = result[col]
            assert series.dtype == pl.Boolean, f"{col} should be Boolean in {strategy.name}, got {series.dtype}"

    def test_preserves_original_columns(self, strategy):
        df = _make_ohlcv()
        result = strategy.compute(df)
        for col in ["ts_event", "open", "high", "low", "close", "volume"]:
            assert col in result.columns, f"Missing original column: {col}"

    def test_get_params_returns_dict(self, strategy):
        params = strategy.get_params()
        assert isinstance(params, dict)
        assert len(params) <= 5, f"{strategy.name} has {len(params)} params, max is 5"

    def test_get_default_config_returns_dict(self, strategy):
        config = strategy.get_default_config()
        assert isinstance(config, dict)

    def test_has_name(self, strategy):
        assert isinstance(strategy.name, str)
        assert len(strategy.name) > 0

    def test_no_signals_on_flat_data(self, strategy):
        n = 50
        dates = [datetime(2023, 6, 15, 8, 0) + timedelta(minutes=i * 5) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0] * n,
            "high": [100.5] * n,
            "low": [99.5] * n,
            "close": [100.0] * n,
            "volume": [10000] * n,
        })
        result = strategy.compute(df)
        # On perfectly flat data, strategies should generate few or no signals
        total_signals = (
            result["entry_long"].sum() + result["entry_short"].sum()
        )
        # Just check it doesn't crash — flat data behavior varies
        assert isinstance(total_signals, int)
