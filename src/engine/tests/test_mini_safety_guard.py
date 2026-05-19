"""Track 1 — Mini Safety Guard tests.

6 tests covering the contract_class validation that prevents silent 10x risk
inflation when a strategy symbol is flipped from MES/MNQ/MCL to ES/NQ/CL.

config.py lines 32-34 alias ES/NQ/CL to MICRO point values (ES=$5/pt, NQ=$2/pt,
CL=$100/pt), not full-size mini values (ES=$50/pt, NQ=$20/pt, CL=$1000/pt).
Without this guard an operator changing symbol="MES" -> symbol="ES" in the DSL
would get micro P&L math on full-size notional — 10x silent risk inflation.

Mini support is DEFERRED until $200K+ funded balance and full mini specs migration.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.engine.compiler.strategy_schema import StrategyDSL
from src.engine.compiler.pattern_library import validate_mini_guard


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _base_dsl(**overrides) -> dict:
    """Minimal valid DSL dict using MES (micro, default)."""
    base = {
        "name": "Test Strategy MES",
        "description": "Go long when fast SMA crosses above slow SMA on MES 15m chart",
        "symbol": "MES",
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
        "source": "manual",
        "tags": [],
    }
    base.update(overrides)
    return base


# ─── Test 1: Valid micro DSL with default contract_class ──────────────────────

class TestValidMicroDefault:
    def test_mes_accepts_default_contract_class_micro(self):
        """symbol='MES' with default contract_class='micro' is fully valid.

        This is the happy path for all 19 existing ICT strategies. Adding the
        contract_class field with default='micro' must not break any existing strategy.
        """
        dsl = StrategyDSL(**_base_dsl(symbol="MES"))
        assert dsl.symbol == "MES"
        assert dsl.contract_class == "micro"

    def test_mnq_accepts_default_contract_class_micro(self):
        """symbol='MNQ' with default contract_class='micro' is fully valid."""
        dsl = StrategyDSL(**_base_dsl(symbol="MNQ"))
        assert dsl.symbol == "MNQ"
        assert dsl.contract_class == "micro"

    def test_mcl_accepts_default_contract_class_micro(self):
        """symbol='MCL' with default contract_class='micro' is fully valid."""
        dsl = StrategyDSL(**_base_dsl(symbol="MCL"))
        assert dsl.symbol == "MCL"
        assert dsl.contract_class == "micro"

    def test_mes_explicit_micro_class_valid(self):
        """symbol='MES' with explicit contract_class='micro' is valid."""
        dsl = StrategyDSL(**_base_dsl(symbol="MES", contract_class="micro"))
        assert dsl.contract_class == "micro"


# ─── Test 2: Micro symbol with no contract_class (legacy compat) ──────────────

class TestLegacyCompatibility:
    def test_dsl_without_contract_class_field_defaults_to_micro(self):
        """Omitting contract_class entirely defaults to 'micro'.

        All 19 existing ICT strategies omit this field. They must still compile.
        """
        raw = _base_dsl()
        assert "contract_class" not in raw  # field intentionally absent
        dsl = StrategyDSL(**raw)
        assert dsl.contract_class == "micro"

    def test_all_three_micro_symbols_compile_without_contract_class(self):
        """MES, MNQ, MCL all compile when contract_class is omitted."""
        for symbol in ["MES", "MNQ", "MCL"]:
            raw = _base_dsl(symbol=symbol)
            dsl = StrategyDSL(**raw)
            assert dsl.contract_class == "micro"
            assert dsl.symbol == symbol


# ─── Test 3: Micro symbol with contract_class='mini' is rejected ──────────────

class TestMicroSymbolWithMiniClassRejected:
    def test_mes_with_mini_class_rejected(self):
        """symbol='MES' + contract_class='mini' must be rejected.

        MES is a micro symbol. Declaring it as 'mini' is a mismatched pairing
        that indicates operator confusion about symbol semantics.
        """
        with pytest.raises(ValidationError) as exc_info:
            StrategyDSL(**_base_dsl(symbol="MES", contract_class="mini"))
        errors_text = str(exc_info.value)
        assert "Micro symbol" in errors_text or "cannot be paired" in errors_text

    def test_mnq_with_mini_class_rejected(self):
        """symbol='MNQ' + contract_class='mini' is rejected."""
        with pytest.raises(ValidationError) as exc_info:
            StrategyDSL(**_base_dsl(symbol="MNQ", contract_class="mini"))
        errors_text = str(exc_info.value)
        assert "Micro symbol" in errors_text or "cannot be paired" in errors_text

    def test_mcl_with_mini_class_rejected(self):
        """symbol='MCL' + contract_class='mini' is rejected."""
        with pytest.raises(ValidationError) as exc_info:
            StrategyDSL(**_base_dsl(symbol="MCL", contract_class="mini"))
        errors_text = str(exc_info.value)
        assert "Micro symbol" in errors_text or "cannot be paired" in errors_text


# ─── Test 4/5: Pattern library validate_mini_guard standalone ─────────────────

class TestValidateMiniGuardFunction:
    """validate_mini_guard() is the standalone gate called by the compiler path.

    Tests 4 and 5 per the specification:
    - Test 4: ES + missing/wrong contract_class -> rejects with clear error
    - Test 5: NQ and CL follow same pattern (parameterized)
    """

    def test_es_with_micro_class_rejected(self):
        """Test 4: ES + contract_class='micro' is rejected (mini symbol needs mini class)."""
        valid, errors = validate_mini_guard("ES", "micro")
        assert valid is False
        assert len(errors) == 1
        assert "Mini contracts" in errors[0] or "mini symbol" in errors[0].lower() or "require explicit" in errors[0]

    @pytest.mark.parametrize("symbol", ["NQ", "CL"])
    def test_mini_symbols_with_micro_class_rejected(self, symbol: str):
        """Test 5: NQ and CL with contract_class='micro' follow same rejection pattern."""
        valid, errors = validate_mini_guard(symbol, "micro")
        assert valid is False
        assert len(errors) == 1

    @pytest.mark.parametrize("symbol", ["ES", "NQ", "CL"])
    def test_mini_symbols_with_mini_class_rejected_as_unimplemented(self, symbol: str):
        """Mini symbol + contract_class='mini' is correct pairing but NOT YET IMPLEMENTED.

        Correct pairing: es + mini class. But mini support is deferred.
        Error message must mention 'not yet implemented' or similar.
        """
        valid, errors = validate_mini_guard(symbol, "mini")
        assert valid is False
        assert len(errors) == 1
        assert "not yet" in errors[0].lower() or "deferred" in errors[0].lower() or "not yet implemented" in errors[0].lower()

    @pytest.mark.parametrize("symbol", ["MES", "MNQ", "MCL"])
    def test_micro_symbols_with_micro_class_accepted(self, symbol: str):
        """Micro symbol + micro class is the only accepted combination."""
        valid, errors = validate_mini_guard(symbol, "micro")
        assert valid is True
        assert errors == []

    def test_micro_symbol_with_mini_class_rejected(self):
        """Test 6: MES + contract_class='mini' is rejected (micro symbol with mini class is mismatched)."""
        valid, errors = validate_mini_guard("MES", "mini")
        assert valid is False
        assert len(errors) == 1
        assert "Micro symbol" in errors[0] or "cannot be paired" in errors[0]


# ─── Regression: existing 19 ICT strategies still compile ─────────────────────

class TestExistingStrategiesUnaffected:
    """All 19 ICT strategies must still compile after Track 1 changes.

    They all use MES/MNQ/MCL and omit contract_class (defaults to 'micro').
    This test constructs representative DSLs for each symbol to verify.
    """

    def test_mes_strategy_compiles(self):
        dsl = StrategyDSL(**_base_dsl(symbol="MES"))
        assert dsl.contract_class == "micro"

    def test_mnq_strategy_compiles(self):
        dsl = StrategyDSL(**_base_dsl(
            symbol="MNQ",
            name="Trend MNQ Strategy",
            description="Go long when fast EMA crosses above slow EMA on MNQ 15m chart",
            entry_indicator="ema_crossover",
        ))
        assert dsl.contract_class == "micro"

    def test_mcl_strategy_compiles(self):
        dsl = StrategyDSL(**_base_dsl(
            symbol="MCL",
            name="MCL Keltner Strategy",
            description="Enter long when Keltner squeeze fires on MCL crude oil 15m chart",
            entry_indicator="keltner_squeeze",
            entry_params={"bb_period": 20, "kc_period": 20, "kc_multiplier": 1.5},
        ))
        assert dsl.contract_class == "micro"
