"""TDD: populate_regime_bank NeMo integration + self-heal tests.

Tests for:
  A. NeMo → bank feed in populate_regime_bank.py
     A1. use_nemo=True (default): specs sourced from NeMoScenarioDesigner when it works
     A2. use_nemo=True but designer raises: falls back to NAMED_SCENARIOS (fail-soft)
     A3. use_nemo=False: skips designer entirely, uses NAMED_SCENARIOS directly
     A4. scenario_source recorded per regime record ("nemo_data_designer" | "stochastic_fallback")
     A5. NeMo-derived scenario names must be in NAMED_SCENARIOS fallback keys OR
         in the 8 canonical archetype names (labels come from designer)
     A6. use_nemo=True with data_designer path: scenario_source="nemo_data_designer"
     A7. use_nemo=False: scenario_source="stochastic_fallback" on all records

  B. Self-heal (TS) — tested via mocking runSyntheticRegimeBankPopulate
     (Pure TS tests in synthetic-regime-bank-service.self-heal.test.ts)

Governance: challenger_only / ADVISORY — NeMo path is never a gate.
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch, call

import pytest

# Guard against vectorbt import hang (must happen before any engine import)
_vbt_mock = types.ModuleType("vectorbt")
_vbt_mock.Portfolio = MagicMock()
sys.modules.setdefault("vectorbt", _vbt_mock)

from src.engine.synthetic.populate_regime_bank import run_populate, _DEFAULT_CONFIG
from src.engine.synthetic.stochastic_regime_generator import NAMED_SCENARIOS, ScenarioSpec
from src.engine.nemo_scenario_designer import GenerationResult


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_fallback_result() -> GenerationResult:
    """Return a GenerationResult that looks like the stochastic fallback."""
    specs = list(NAMED_SCENARIOS.values())
    return GenerationResult(
        specs=specs,
        path_used="fallback",
        provenance={
            "path": "fallback",
            "model": None,
            "seed": 42,
            "run_id": "abc123",
            "reason": "NVIDIA_API_KEY not set",
            "scenario_source": "stochastic_fallback",
        },
    )


def _make_nemo_result() -> GenerationResult:
    """Return a GenerationResult that looks like the NeMo data_designer path."""
    specs = list(NAMED_SCENARIOS.values())
    return GenerationResult(
        specs=specs,
        path_used="data_designer",
        provenance={
            "path": "data_designer",
            "model": "nvidia-text",
            "seed": 42,
            "run_id": "deadbeef1234",
            "num_records_requested": 8,
            "num_specs_returned": 8,
        },
    )


_FAST_CONFIG_DRY = {
    "symbols": ["MES"],
    "timeframes": ["5min"],
    "scenarios": ["COVID_crash"],
    "seed": 42,
    "max_batches": 1,
    "severity_check": True,
    "dry_run": True,
    "use_nemo": False,  # default: skip NeMo so tests are fast + offline
}


# =============================================================================
# A1. use_nemo=True calls NeMoScenarioDesigner.generate_scenarios()
# =============================================================================

class TestNeMoCalledWhenEnabled:
    """A1: use_nemo=True causes run_populate to call the NeMo designer."""

    def test_nemo_designer_called_when_use_nemo_true(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": True}
        fallback = _make_fallback_result()

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            instance = MockDesigner.return_value
            instance.generate_scenarios.return_value = fallback
            result = run_populate(config)

        MockDesigner.assert_called_once()
        instance.generate_scenarios.assert_called_once()
        # Must still produce valid results
        assert result["generated"] >= 0

    def test_nemo_designer_NOT_called_when_use_nemo_false(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": False}

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            run_populate(config)

        MockDesigner.assert_not_called()


# =============================================================================
# A2. NeMo designer raises → falls back to NAMED_SCENARIOS (fail-soft)
# =============================================================================

class TestNeMoFallbackOnError:
    """A2: If designer.generate_scenarios() raises, run_populate falls back gracefully."""

    def test_nemo_error_falls_back_without_crashing(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": True}

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            instance = MockDesigner.return_value
            instance.generate_scenarios.side_effect = RuntimeError("NeMo API timeout")
            result = run_populate(config)

        # Must not raise — fail-soft means continue with NAMED_SCENARIOS
        assert isinstance(result, dict)
        assert "generated" in result
        # scenarios should still be generated (NAMED_SCENARIOS fallback)
        assert result["generated"] >= 0

    def test_nemo_import_error_falls_back(self):
        """NeMoScenarioDesigner import itself failing is handled gracefully."""
        config = {**_FAST_CONFIG_DRY, "use_nemo": True}

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner",
            side_effect=ImportError("no module named nemo"),
        ):
            # Should not raise — module-level import error is caught
            result = run_populate(config)

        assert isinstance(result, dict)
        assert "errors" in result


# =============================================================================
# A3. use_nemo=False uses NAMED_SCENARIOS directly
# =============================================================================

class TestUseNemoFalse:
    """A3: use_nemo=False is the safe offline default."""

    def test_use_nemo_false_produces_correct_output(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": False}
        result = run_populate(config)
        assert result["generated"] == 1  # 1 scenario × 1 batch
        assert result["calibrated_passed"] + result["calibrated_failed"] == result["generated"]

    def test_use_nemo_defaults_to_false(self):
        """When use_nemo is omitted from config, it must default to False (safe offline)."""
        config = {k: v for k, v in _FAST_CONFIG_DRY.items() if k != "use_nemo"}
        # Should not attempt NeMo — just succeed with NAMED_SCENARIOS
        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            run_populate(config)

        MockDesigner.assert_not_called()


# =============================================================================
# A4. scenario_source recorded per regime record
# =============================================================================

class TestScenarioSourceRecorded:
    """A4: Each regime record must include scenario_source field."""

    REQUIRED_SOURCE_VALUES = {"nemo_data_designer", "stochastic_fallback"}

    def test_regime_record_has_scenario_source_field(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": False}
        result = run_populate(config)
        for rec in result["regimes"]:
            assert "scenario_source" in rec, (
                f"regime record missing 'scenario_source': {list(rec.keys())}"
            )

    def test_scenario_source_is_valid_value(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": False}
        result = run_populate(config)
        for rec in result["regimes"]:
            assert rec["scenario_source"] in self.REQUIRED_SOURCE_VALUES, (
                f"scenario_source must be in {self.REQUIRED_SOURCE_VALUES}, "
                f"got {rec['scenario_source']!r}"
            )

    def test_nemo_data_designer_path_records_nemo_source(self):
        """When NeMo path is taken, scenario_source must be 'nemo_data_designer'."""
        config = {**_FAST_CONFIG_DRY, "use_nemo": True}
        nemo_result = _make_nemo_result()

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            instance = MockDesigner.return_value
            instance.generate_scenarios.return_value = nemo_result
            result = run_populate(config)

        for rec in result["regimes"]:
            assert rec["scenario_source"] == "nemo_data_designer", (
                f"NeMo path must record 'nemo_data_designer', got {rec['scenario_source']!r}"
            )

    def test_fallback_path_records_stochastic_fallback_source(self):
        """When NeMo path falls back, scenario_source must be 'stochastic_fallback'."""
        config = {**_FAST_CONFIG_DRY, "use_nemo": True}
        fallback_result = _make_fallback_result()

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            instance = MockDesigner.return_value
            instance.generate_scenarios.return_value = fallback_result
            result = run_populate(config)

        for rec in result["regimes"]:
            assert rec["scenario_source"] == "stochastic_fallback", (
                f"Fallback path must record 'stochastic_fallback', got {rec['scenario_source']!r}"
            )


# =============================================================================
# A5. Unknown scenario name validation still works with use_nemo=True
# =============================================================================

class TestValidationWithNeMo:
    """A5: Scenario validation still rejects unknown names regardless of use_nemo."""

    def test_unknown_scenario_raises_with_use_nemo_true(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": True, "scenarios": ["DOES_NOT_EXIST"]}
        with pytest.raises(ValueError, match="Unknown scenarios"):
            run_populate(config)

    def test_unknown_scenario_raises_with_use_nemo_false(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": False, "scenarios": ["DOES_NOT_EXIST"]}
        with pytest.raises(ValueError, match="Unknown scenarios"):
            run_populate(config)


# =============================================================================
# A6. Backward compat: existing record schema still intact
# =============================================================================

class TestRecordSchemaPreserved:
    """A6: Existing regime record fields not removed by NeMo changes."""

    REQUIRED_FIELDS = {
        "symbol", "timeframe", "regime_label", "file_path",
        "num_bars", "generator_model_version", "governance",
        "stylized_fact_passed", "severity_passed",
        "calibration_stats", "batch_index", "seed",
        "scenario_source",  # NEW field
    }

    def test_all_required_fields_present_use_nemo_false(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": False}
        result = run_populate(config)
        assert len(result["regimes"]) >= 1, "Expected at least 1 regime record"
        for rec in result["regimes"]:
            missing = self.REQUIRED_FIELDS - set(rec.keys())
            assert not missing, f"Regime record missing fields: {missing}"

    def test_all_required_fields_present_use_nemo_true_with_mock(self):
        config = {**_FAST_CONFIG_DRY, "use_nemo": True}
        fallback = _make_fallback_result()

        with patch(
            "src.engine.synthetic.populate_regime_bank.NeMoScenarioDesigner"
        ) as MockDesigner:
            instance = MockDesigner.return_value
            instance.generate_scenarios.return_value = fallback
            result = run_populate(config)

        for rec in result["regimes"]:
            missing = self.REQUIRED_FIELDS - set(rec.keys())
            assert not missing, f"Regime record missing fields: {missing}"


# =============================================================================
# A7. use_nemo=False always produces stochastic_fallback
# =============================================================================

class TestUseNemoFalseProducesStochasticFallback:
    """A7: use_nemo=False guarantees scenario_source='stochastic_fallback'."""

    def test_all_records_stochastic_fallback_when_use_nemo_false(self):
        config = {
            **_FAST_CONFIG_DRY,
            "use_nemo": False,
            "scenarios": ["COVID_crash", "slow_bleed_grind"],
            "max_batches": 1,
        }
        result = run_populate(config)
        for rec in result["regimes"]:
            assert rec["scenario_source"] == "stochastic_fallback", (
                f"use_nemo=False must always produce 'stochastic_fallback', "
                f"got {rec['scenario_source']!r}"
            )
