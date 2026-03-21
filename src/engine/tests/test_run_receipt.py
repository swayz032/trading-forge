"""Tests for run receipt / reproducibility (Gap 2)."""

import hashlib

from src.engine.config import StrategyConfig, StopConfig, PositionSizeConfig, RunReceipt


def _make_config(**overrides) -> StrategyConfig:
    """Create a minimal StrategyConfig for testing."""
    defaults = {
        "name": "test_strategy",
        "symbol": "ES",
        "timeframe": "15min",
        "indicators": [],
        "entry_long": "close > sma_20",
        "entry_short": "close < sma_20",
        "exit": "close < sma_20",
        "stop_loss": StopConfig(type="atr", multiplier=2.0),
        "position_size": PositionSizeConfig(type="fixed", fixed_contracts=1),
    }
    defaults.update(overrides)
    return StrategyConfig(**defaults)


class TestRunReceipt:
    def test_receipt_has_all_fields(self):
        """Receipt should contain all required reproducibility fields."""
        from src.engine.backtester import _build_run_receipt

        config = _make_config()
        receipt = _build_run_receipt(config)

        assert "git_commit" in receipt
        assert "config_hash" in receipt
        assert "numpy_version" in receipt
        assert "polars_version" in receipt
        assert "python_version" in receipt
        assert "timestamp_utc" in receipt
        assert "random_seed" in receipt
        assert receipt["random_seed"] == 42

        # Validate the receipt matches the Pydantic model
        model = RunReceipt(**receipt)
        assert model.config_hash == receipt["config_hash"]

    def test_config_hash_deterministic(self):
        """Same config should produce same hash."""
        from src.engine.backtester import _build_run_receipt

        config = _make_config()
        receipt1 = _build_run_receipt(config)
        receipt2 = _build_run_receipt(config)

        assert receipt1["config_hash"] == receipt2["config_hash"]
        assert len(receipt1["config_hash"]) == 64  # SHA-256 hex

    def test_config_hash_changes(self):
        """Different config should produce different hash."""
        from src.engine.backtester import _build_run_receipt

        config1 = _make_config(name="strategy_a")
        config2 = _make_config(name="strategy_b")
        receipt1 = _build_run_receipt(config1)
        receipt2 = _build_run_receipt(config2)

        assert receipt1["config_hash"] != receipt2["config_hash"]
