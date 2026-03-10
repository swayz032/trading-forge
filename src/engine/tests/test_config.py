"""Tests for strategy config schema — TDD: written before config.py."""

import pytest
from src.engine.config import (
    ContractSpec,
    IndicatorConfig,
    StopConfig,
    PositionSizeConfig,
    StrategyConfig,
    BacktestRequest,
    BacktestResult,
    CONTRACT_SPECS,
)


# ─── Contract Specs must match risk.ts exactly ─────────────────────

class TestContractSpecs:
    def test_es_spec(self):
        s = CONTRACT_SPECS["ES"]
        assert s.tick_size == 0.25
        assert s.tick_value == 12.50
        assert s.point_value == 50.00

    def test_nq_spec(self):
        s = CONTRACT_SPECS["NQ"]
        assert s.tick_size == 0.25
        assert s.tick_value == 5.00
        assert s.point_value == 20.00

    def test_cl_spec(self):
        s = CONTRACT_SPECS["CL"]
        assert s.tick_size == 0.01
        assert s.tick_value == 10.00
        assert s.point_value == 1000.00

    def test_ym_spec(self):
        s = CONTRACT_SPECS["YM"]
        assert s.tick_size == 1.00
        assert s.tick_value == 5.00
        assert s.point_value == 5.00

    def test_rty_spec(self):
        s = CONTRACT_SPECS["RTY"]
        assert s.tick_size == 0.10
        assert s.tick_value == 5.00
        assert s.point_value == 50.00

    def test_gc_spec(self):
        s = CONTRACT_SPECS["GC"]
        assert s.tick_size == 0.10
        assert s.tick_value == 10.00
        assert s.point_value == 100.00

    def test_mes_spec(self):
        s = CONTRACT_SPECS["MES"]
        assert s.tick_size == 0.25
        assert s.tick_value == 1.25
        assert s.point_value == 5.00

    def test_mnq_spec(self):
        s = CONTRACT_SPECS["MNQ"]
        assert s.tick_size == 0.25
        assert s.tick_value == 0.50
        assert s.point_value == 2.00

    def test_all_eight_symbols(self):
        expected = {"ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ"}
        assert set(CONTRACT_SPECS.keys()) == expected


# ─── Indicator Config ──────────────────────────────────────────────

class TestIndicatorConfig:
    def test_valid_sma(self):
        ic = IndicatorConfig(type="sma", period=20)
        assert ic.type == "sma"
        assert ic.period == 20

    def test_valid_macd(self):
        ic = IndicatorConfig(type="macd", period=12, fast=12, slow=26, signal=9)
        assert ic.fast == 12

    def test_invalid_type_rejected(self):
        with pytest.raises(ValueError):
            IndicatorConfig(type="fibonacci_retracement", period=14)

    def test_valid_types(self):
        for t in ["sma", "ema", "rsi", "macd", "vwap", "bbands", "atr"]:
            ic = IndicatorConfig(type=t, period=14)
            assert ic.type == t


# ─── Stop Config ───────────────────────────────────────────────────

class TestStopConfig:
    def test_valid_atr_stop(self):
        sc = StopConfig(type="atr", multiplier=2.0)
        assert sc.type == "atr"
        assert sc.multiplier == 2.0

    def test_invalid_stop_type(self):
        with pytest.raises(ValueError):
            StopConfig(type="magic", multiplier=1.0)


# ─── Strategy Config ──────────────────────────────────────────────

class TestStrategyConfig:
    def _valid_config(self, **overrides):
        base = dict(
            name="SMA Cross",
            symbol="ES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=10),
                IndicatorConfig(type="sma", period=30),
            ],
            entry_long="close crosses_above sma_10",
            entry_short="close crosses_below sma_10",
            exit="close crosses_below sma_30",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        base.update(overrides)
        return StrategyConfig(**base)

    def test_valid_config(self):
        cfg = self._valid_config()
        assert cfg.name == "SMA Cross"
        assert cfg.symbol == "ES"

    def test_max_5_indicators(self):
        indicators = [IndicatorConfig(type="sma", period=i) for i in range(6)]
        with pytest.raises(ValueError):
            self._valid_config(indicators=indicators)

    def test_unknown_symbol_rejected(self):
        with pytest.raises(ValueError):
            self._valid_config(symbol="AAPL")

    def test_serialization_roundtrip(self):
        cfg = self._valid_config()
        json_str = cfg.model_dump_json()
        restored = StrategyConfig.model_validate_json(json_str)
        assert restored.name == cfg.name
        assert len(restored.indicators) == len(cfg.indicators)
        assert restored.stop_loss.type == cfg.stop_loss.type


# ─── Backtest Request ──────────────────────────────────────────────

class TestBacktestRequest:
    def test_default_commission(self):
        cfg = StrategyConfig(
            name="Test",
            symbol="ES",
            timeframe="daily",
            indicators=[IndicatorConfig(type="sma", period=20)],
            entry_long="close > sma_20",
            entry_short="close < sma_20",
            exit="close < sma_20",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        req = BacktestRequest(
            strategy=cfg,
            start_date="2023-01-01",
            end_date="2023-06-30",
        )
        assert req.commission_per_side == 4.50
        assert req.slippage_ticks == 1.0
