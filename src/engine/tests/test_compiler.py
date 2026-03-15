"""Tests for the Strategy Compiler — validates DSL, compiles to backtest config, diffs."""

import pytest
from pydantic import ValidationError

from src.engine.compiler.strategy_schema import StrategyDSL
from src.engine.compiler.compiler import validate_dsl, compile_to_backtest, diff_strategies
from src.engine.compiler.pattern_library import validate_entry_params, list_patterns


# ─── Fixtures ────────────────────────────────────────────────────────

def _valid_dsl_dict() -> dict:
    """Minimal valid strategy DSL dict."""
    return {
        "name": "SMA Crossover ES",
        "description": "Go long when fast SMA crosses above slow SMA on ES 15m chart",
        "symbol": "ES",
        "timeframe": "15m",
        "direction": "long",
        "entry_type": "trend_follow",
        "entry_indicator": "sma_crossover",
        "entry_params": {"fast_period": 10, "slow_period": 50},
        "entry_condition": "Fast SMA crosses above slow SMA",
        "exit_type": "atr_multiple",
        "exit_params": {"multiplier": 2.0},
        "stop_loss_atr_multiple": 1.5,
        "take_profit_atr_multiple": 3.0,
        "preferred_regime": "TRENDING_UP",
        "session_filter": "RTH_ONLY",
        "source": "manual",
        "tags": ["trend", "sma"],
    }


# ─── Schema Version ─────────────────────────────────────────────────

class TestSchemaVersion:
    def test_default_schema_version_is_v1(self):
        dsl = StrategyDSL(**_valid_dsl_dict())
        assert dsl.schema_version == "v1"

    def test_explicit_schema_version(self):
        data = _valid_dsl_dict()
        data["schema_version"] = "v1"
        dsl = StrategyDSL(**data)
        assert dsl.schema_version == "v1"


# ─── Valid DSL ───────────────────────────────────────────────────────

class TestValidDSL:
    def test_valid_dsl_validates_successfully(self):
        valid, model, errors = validate_dsl(_valid_dsl_dict())
        assert valid is True
        assert model is not None
        assert errors == []
        assert model.name == "SMA Crossover ES"
        assert model.symbol == "ES"

    def test_valid_dsl_roundtrip(self):
        data = _valid_dsl_dict()
        valid, model, errors = validate_dsl(data)
        assert valid is True
        # All required fields present in the model
        assert model.entry_indicator == "sma_crossover"
        assert model.entry_params == {"fast_period": 10, "slow_period": 50}


# ─── Invalid DSL — Missing Required Fields ───────────────────────────

class TestInvalidDSL:
    def test_missing_name_fails(self):
        data = _valid_dsl_dict()
        del data["name"]
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert model is None
        assert any("name" in e for e in errors)

    def test_missing_symbol_fails(self):
        data = _valid_dsl_dict()
        del data["symbol"]
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("symbol" in e for e in errors)

    def test_missing_entry_indicator_fails(self):
        data = _valid_dsl_dict()
        del data["entry_indicator"]
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("entry_indicator" in e for e in errors)

    def test_extra_field_forbidden(self):
        data = _valid_dsl_dict()
        data["unknown_field"] = "should fail"
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("extra" in e.lower() or "unknown_field" in e for e in errors)


# ─── Entry Params Limits ────────────────────────────────────────────

class TestEntryParamsLimits:
    def test_too_many_entry_params_fails(self):
        data = _valid_dsl_dict()
        data["entry_params"] = {
            "param1": 1,
            "param2": 2,
            "param3": 3,
            "param4": 4,
            "param5": 5,
            "param6": 6,  # 6th param — should fail
        }
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("5" in e or "entry_params" in e for e in errors)

    def test_five_entry_params_is_ok(self):
        data = _valid_dsl_dict()
        data["entry_indicator"] = "sma_crossover"
        data["entry_params"] = {
            "fast_period": 10,
            "slow_period": 50,
            "confirmation_bars": 2,
        }
        valid, model, errors = validate_dsl(data)
        assert valid is True


# ─── Pattern Library Validation ──────────────────────────────────────

class TestPatternLibrary:
    def test_unknown_entry_indicator_fails(self):
        data = _valid_dsl_dict()
        data["entry_indicator"] = "quantum_flux_detector"
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("Unknown" in e or "quantum_flux_detector" in e for e in errors)

    def test_missing_required_param_fails(self):
        data = _valid_dsl_dict()
        data["entry_indicator"] = "rsi_reversal"
        data["entry_params"] = {"period": 14}  # missing oversold, overbought
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("Missing" in e or "required" in e.lower() for e in errors)

    def test_param_out_of_range_fails(self):
        data = _valid_dsl_dict()
        data["entry_indicator"] = "sma_crossover"
        data["entry_params"] = {"fast_period": 1, "slow_period": 50}  # fast_period min is 5
        valid, model, errors = validate_dsl(data)
        assert valid is False
        assert any("out of range" in e.lower() or "range" in e.lower() for e in errors)

    def test_valid_pattern_with_optional_params(self):
        data = _valid_dsl_dict()
        data["entry_indicator"] = "sma_crossover"
        data["entry_params"] = {
            "fast_period": 10,
            "slow_period": 50,
            "confirmation_bars": 3,
        }
        valid, model, errors = validate_dsl(data)
        assert valid is True

    def test_list_patterns_returns_all(self):
        patterns = list_patterns()
        assert len(patterns) == 10
        assert "sma_crossover" in patterns
        assert "rsi_reversal" in patterns
        assert "macd_crossover" in patterns

    def test_validate_entry_params_directly(self):
        valid, errors = validate_entry_params("bollinger_breakout", {"period": 20, "std_dev": 2.0})
        assert valid is True
        assert errors == []


# ─── Stop Loss / Take Profit Ranges ─────────────────────────────────

class TestRiskParams:
    def test_stop_loss_below_min_fails(self):
        data = _valid_dsl_dict()
        data["stop_loss_atr_multiple"] = 0.1  # min is 0.5
        valid, model, errors = validate_dsl(data)
        assert valid is False

    def test_stop_loss_above_max_fails(self):
        data = _valid_dsl_dict()
        data["stop_loss_atr_multiple"] = 6.0  # max is 5.0
        valid, model, errors = validate_dsl(data)
        assert valid is False

    def test_take_profit_below_min_fails(self):
        data = _valid_dsl_dict()
        data["take_profit_atr_multiple"] = 0.5  # min is 1.0
        valid, model, errors = validate_dsl(data)
        assert valid is False


# ─── Compile to Backtest Config ──────────────────────────────────────

class TestCompileToBacktest:
    def test_compile_produces_valid_config(self):
        data = _valid_dsl_dict()
        valid, model, errors = validate_dsl(data)
        assert valid is True

        config = compile_to_backtest(model)

        # Must have strategy key with required backtest fields
        assert "strategy" in config
        strat = config["strategy"]
        assert strat["name"] == "SMA Crossover ES"
        assert strat["symbol"] == "ES"
        assert strat["timeframe"] == "15m"
        assert "indicators" in strat
        assert "stop_loss" in strat
        assert strat["stop_loss"]["type"] == "atr"
        assert strat["stop_loss"]["multiplier"] == 1.5

    def test_compile_includes_regime_gate(self):
        data = _valid_dsl_dict()
        data["preferred_regime"] = "TRENDING_UP"
        _, model, _ = validate_dsl(data)
        config = compile_to_backtest(model)
        assert config["regime_gate"]["enabled"] is True
        assert config["regime_gate"]["preferred_regime"] == "TRENDING_UP"

    def test_compile_includes_session_filter(self):
        data = _valid_dsl_dict()
        data["session_filter"] = "RTH_ONLY"
        _, model, _ = validate_dsl(data)
        config = compile_to_backtest(model)
        assert config["session_filter"]["enabled"] is True
        assert config["session_filter"]["session"] == "RTH_ONLY"

    def test_compile_includes_take_profit(self):
        data = _valid_dsl_dict()
        data["take_profit_atr_multiple"] = 3.0
        _, model, _ = validate_dsl(data)
        config = compile_to_backtest(model)
        assert config["take_profit"]["multiplier"] == 3.0

    def test_compile_includes_metadata(self):
        data = _valid_dsl_dict()
        _, model, _ = validate_dsl(data)
        config = compile_to_backtest(model)
        assert config["metadata"]["schema_version"] == "v1"
        assert config["metadata"]["source"] == "manual"

    def test_compile_no_regime_when_none(self):
        data = _valid_dsl_dict()
        data["preferred_regime"] = None
        _, model, _ = validate_dsl(data)
        config = compile_to_backtest(model)
        assert "regime_gate" not in config

    def test_compile_max_contracts_cap(self):
        data = _valid_dsl_dict()
        data["max_contracts"] = 5
        _, model, _ = validate_dsl(data)
        config = compile_to_backtest(model)
        assert config["strategy"]["position_size"]["max_contracts"] == 5


# ─── Diff ────────────────────────────────────────────────────────────

class TestDiffStrategies:
    def test_diff_detects_changed_field(self):
        a = _valid_dsl_dict()
        b = _valid_dsl_dict()
        b["stop_loss_atr_multiple"] = 2.5
        result = diff_strategies(a, b)
        assert "stop_loss_atr_multiple" in result["changed"]
        assert result["changed"]["stop_loss_atr_multiple"]["old"] == 1.5
        assert result["changed"]["stop_loss_atr_multiple"]["new"] == 2.5

    def test_diff_detects_added_field(self):
        a = {"name": "A"}
        b = {"name": "A", "new_field": "value"}
        result = diff_strategies(a, b)
        assert "new_field" in result["added"]

    def test_diff_detects_removed_field(self):
        a = {"name": "A", "old_field": "value"}
        b = {"name": "A"}
        result = diff_strategies(a, b)
        assert "old_field" in result["removed"]

    def test_diff_identical_returns_empty(self):
        a = _valid_dsl_dict()
        result = diff_strategies(a, a.copy())
        assert result["added"] == {}
        assert result["removed"] == {}
        assert result["changed"] == {}

    def test_diff_multiple_changes(self):
        a = _valid_dsl_dict()
        b = _valid_dsl_dict()
        b["symbol"] = "NQ"
        b["timeframe"] = "5m"
        result = diff_strategies(a, b)
        assert "symbol" in result["changed"]
        assert "timeframe" in result["changed"]
