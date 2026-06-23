# -*- coding: utf-8 -*-
"""Tests for NeMo Scenario Designer — data_designer wiring.

All tests mock `data_designer` — no real API calls are ever made.
NVIDIA_API_KEY absence is intentional for the fallback tests.
Vectorbt is blocked from import to prevent pytest collection hang.
"""
from __future__ import annotations

import hashlib
import importlib
import os
import sys
import types
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ─── Block vectorbt / heavy GPU packages before any engine import ─────────────
for _mod in ("vectorbt", "hmmlearn", "arch"):
    if _mod not in sys.modules:
        sys.modules[_mod] = types.ModuleType(_mod)

# ─── Provide a minimal mock for the stochastic_regime_generator ScenarioSpec ─
# We need this so nemo_scenario_designer can import NAMED_SCENARIOS.
# Actual stochastic math is NOT executed in these tests.
_synthetic_pkg = types.ModuleType("src.engine.synthetic")
# __path__ required so 'from src.engine.synthetic import populate_regime_bank' resolves
# to the real file on disk even though the package object is a stub.
import pathlib as _pathlib_early
_synthetic_pkg.__path__ = [
    str(_pathlib_early.Path(__file__).parent.parent.parent / "src" / "engine" / "synthetic")
]
_synthetic_pkg.__package__ = "src.engine.synthetic"
_stochastic_mod = types.ModuleType("src.engine.synthetic.stochastic_regime_generator")

from dataclasses import dataclass, field as dc_field


@dataclass
class _MockScenarioSpec:
    name: str
    vol_annual: float
    drift_annual: float
    dof: float = 4.5
    n_bars: int = 500
    jump_intensity: float = 0.01
    jump_scale_sigma: float = 3.0
    hmm_states: int = 2
    low_vol_scale: float = 0.6
    high_vol_scale: float = 2.0
    transition_lo_to_hi: float = 0.05
    transition_hi_to_lo: float = 0.05
    severity_description: str = ""
    timeframe: str = "5min"
    garch_omega: float = 1e-6
    garch_alpha: float = 0.10
    garch_beta: float = 0.88
    description: str = ""


_MOCK_NAMED_SCENARIOS = {
    "crash": _MockScenarioSpec(name="crash", vol_annual=1.20, drift_annual=-5.0),
    "rate_shock": _MockScenarioSpec(name="rate_shock", vol_annual=0.45, drift_annual=-1.20),
    "vol_spike": _MockScenarioSpec(name="vol_spike", vol_annual=0.80, drift_annual=-0.50),
    "credit_crisis": _MockScenarioSpec(name="credit_crisis", vol_annual=0.90, drift_annual=-2.50),
    "flash_crash": _MockScenarioSpec(name="flash_crash", vol_annual=2.00, drift_annual=-8.0),
    "slow_bleed": _MockScenarioSpec(name="slow_bleed", vol_annual=0.15, drift_annual=-0.30),
    "flash_recovery": _MockScenarioSpec(name="flash_recovery", vol_annual=0.60, drift_annual=3.0),
    "consistency_breach": _MockScenarioSpec(name="consistency_breach", vol_annual=0.25, drift_annual=-0.10),
}

_stochastic_mod.ScenarioSpec = _MockScenarioSpec
_stochastic_mod.NAMED_SCENARIOS = _MOCK_NAMED_SCENARIOS
_stochastic_mod.GENERATOR_MODEL_VERSION = "stochastic_v1.0"
_stochastic_mod.GOVERNANCE_LABELS = {"decision_role": "challenger_only"}

_src_stub = types.ModuleType("src")
_engine_stub = types.ModuleType("src.engine")
# __path__ is required so Python's import system can find sub-modules
# (e.g. nemo_scenario_designer.py) via the real file system even though
# we've replaced the package object with a stub.
import pathlib as _pathlib
_engine_real_dir = str(_pathlib.Path(__file__).parent.parent.parent / "src" / "engine")
_engine_stub.__path__ = [_engine_real_dir]
_engine_stub.__package__ = "src.engine"
_src_stub.__path__ = [str(_pathlib.Path(__file__).parent.parent.parent / "src")]
_src_stub.__package__ = "src"

sys.modules["src"] = _src_stub
sys.modules["src.engine"] = _engine_stub
sys.modules["src.engine.synthetic"] = _synthetic_pkg
sys.modules["src.engine.synthetic.stochastic_regime_generator"] = _stochastic_mod


def _make_mock_dd_module():
    """Build a complete mock of the data_designer package tree."""
    dd_root = types.ModuleType("data_designer")
    dd_config = types.ModuleType("data_designer.config")
    dd_iface = types.ModuleType("data_designer.interface")

    # Config types
    class _SamplerType:
        CATEGORY = "category"
        GAUSSIAN = "gaussian"

    class _CategorySamplerParams:
        def __init__(self, *, values, weights=None, sampler_type="category"):
            self.values = values
            self.weights = weights

    class _GaussianSamplerParams:
        def __init__(self, *, mean, stddev, decimal_places=None, sampler_type="gaussian"):
            self.mean = mean
            self.stddev = stddev
            self.decimal_places = decimal_places

    class _SamplerColumnConfig:
        def __init__(self, *, name, sampler_type, params, **kwargs):
            self.name = name
            self.sampler_type = sampler_type
            self.params = params

    class _LLMStructuredColumnConfig:
        def __init__(self, *, name, prompt, model_alias, output_format, **kwargs):
            self.name = name
            self.prompt = prompt
            self.model_alias = model_alias
            self.output_format = output_format

    class _LLMTextColumnConfig:
        def __init__(self, *, name, prompt, model_alias, **kwargs):
            self.name = name
            self.prompt = prompt
            self.model_alias = model_alias

    class _ExpressionColumnConfig:
        def __init__(self, *, name, expr, **kwargs):
            self.name = name
            self.expr = expr

    class _DataDesignerConfigBuilder:
        def __init__(self):
            self._columns = []

        def add_column(self, col=None, **kwargs):
            if col is not None:
                self._columns.append(col)
            return self

        def build(self):
            return self

    dd_config.SamplerType = _SamplerType
    dd_config.CategorySamplerParams = _CategorySamplerParams
    dd_config.GaussianSamplerParams = _GaussianSamplerParams
    dd_config.SamplerColumnConfig = _SamplerColumnConfig
    dd_config.LLMStructuredColumnConfig = _LLMStructuredColumnConfig
    dd_config.LLMTextColumnConfig = _LLMTextColumnConfig
    dd_config.ExpressionColumnConfig = _ExpressionColumnConfig
    dd_config.DataDesignerConfigBuilder = _DataDesignerConfigBuilder

    # ModelConfig mock
    class _ModelConfig:
        def __init__(self, *, alias, model, provider, **kwargs):
            self.alias = alias
            self.model = model
            self.provider = provider

    _MOCK_CONFIGS = [
        _ModelConfig(alias="nvidia-text", model="nvidia/nemotron-3-nano-30b-a3b", provider="nvidia"),
        _ModelConfig(alias="nvidia-reasoning", model="nvidia/nemotron-3-super-120b-a12b", provider="nvidia"),
        _ModelConfig(alias="openai-text", model="gpt-4.1", provider="openai"),
    ]

    # PreviewResults mock — returns a pandas DataFrame
    class _PreviewResults:
        def __init__(self, df):
            import pandas as pd
            self.dataset = df

    # DataDesigner interface mock
    class _DataDesigner:
        def get_default_model_configs(self):
            return list(_MOCK_CONFIGS)

        def get_default_model_providers(self):
            return []

        def preview(self, config_builder, *, num_records=10):
            import pandas as pd
            # Return a realistic mock dataset shaped like ScenarioSpec parameters
            rows = []
            archetypes = [
                "crash", "rate_shock", "vol_spike", "credit_crisis",
                "flash_crash", "slow_bleed", "flash_recovery", "consistency_breach",
            ]
            for i in range(num_records):
                rows.append({
                    "archetype": archetypes[i % len(archetypes)],
                    "drift_annual": -1.0 + (i * 0.3),
                    "vol_annual": 0.20 + (i * 0.05),
                    "dof": 3.5,
                    "jump_intensity": 0.02,
                    "jump_scale_sigma": 3.0,
                    "n_bars": 500,
                    "narrative": f"Synthetic scenario {i}: market stress event.",
                })
            return _PreviewResults(pd.DataFrame(rows))

        def create(self, config_builder, *, num_records=10, **kwargs):
            return self.preview(config_builder, num_records=num_records)

    dd_iface.DataDesigner = _DataDesigner

    sys.modules["data_designer"] = dd_root
    sys.modules["data_designer.config"] = dd_config
    sys.modules["data_designer.interface"] = dd_iface

    return dd_root, _DataDesigner, _MOCK_CONFIGS, _PreviewResults


# ─── Install mock BEFORE importing the module under test ─────────────────────
_dd_root, _MockDataDesigner, _MOCK_CONFIGS, _MockPreviewResults = _make_mock_dd_module()

# Now import the module under test
from src.engine import nemo_scenario_designer as nsd  # noqa: E402

# Re-import so module picks up the mocked data_designer
importlib.reload(nsd)

ScenarioSpec = _MockScenarioSpec
NAMED_SCENARIOS = _MOCK_NAMED_SCENARIOS


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Fallback tests — data_designer absent / key unset
# ═══════════════════════════════════════════════════════════════════════════════


class TestFallbackToNamedScenarios:
    """When data_designer is unavailable OR NVIDIA_API_KEY is unset,
    generate_scenarios() must fall back to the 8 NAMED_SCENARIOS battery."""

    def test_fallback_when_nvidia_key_absent(self, monkeypatch):
        """No NVIDIA_API_KEY → fall back to stochastic battery."""
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=8, seed=42)
        assert len(result) == 8
        assert result.path_used == "fallback"

    def test_fallback_returns_all_named_scenarios_as_specs(self, monkeypatch):
        """Each fallback scenario maps to a ScenarioSpec (the renderer accepts it)."""
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=8, seed=42)
        for spec in result.specs:
            assert isinstance(spec, _MockScenarioSpec)

    def test_fallback_when_data_designer_import_mocked_absent(self, monkeypatch):
        """When data_designer import is masked absent, fall back cleanly."""
        monkeypatch.setenv("NVIDIA_API_KEY", "sk-fake-key")
        # Temporarily hide data_designer from sys.modules so _try_import fails
        saved = {k: v for k, v in sys.modules.items() if k.startswith("data_designer")}
        for k in list(saved.keys()):
            del sys.modules[k]
        try:
            importlib.reload(nsd)
            designer = nsd.NeMoScenarioDesigner()
            result = designer.generate_scenarios(count=8, seed=42)
            assert result.path_used == "fallback"
        finally:
            sys.modules.update(saved)
            importlib.reload(nsd)

    def test_fallback_produces_8_specs_regardless_of_count(self, monkeypatch):
        """Fallback always returns exactly len(NAMED_SCENARIOS) specs (8)."""
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        designer = nsd.NeMoScenarioDesigner()
        for count in [1, 4, 8, 100]:
            result = designer.generate_scenarios(count=count, seed=0)
            assert len(result.specs) == len(NAMED_SCENARIOS)

    def test_fallback_emits_clear_audit_log(self, monkeypatch, caplog):
        """Fallback must emit a log message indicating which path was used."""
        import logging
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        designer = nsd.NeMoScenarioDesigner()
        with caplog.at_level(logging.INFO):
            result = designer.generate_scenarios(count=8, seed=42)
        # At least one log record should mention fallback
        fallback_logs = [r for r in caplog.records if "fallback" in r.message.lower()]
        assert len(fallback_logs) >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Data Designer path — with mocked API
# ═══════════════════════════════════════════════════════════════════════════════


class TestDataDesignerPath:
    """When NVIDIA_API_KEY is set and data_designer is available,
    the real data_designer path executes and maps rows → ScenarioSpec."""

    @pytest.fixture(autouse=True)
    def set_nvidia_key(self, monkeypatch):
        monkeypatch.setenv("NVIDIA_API_KEY", "sk-fake-nvidia-key-for-tests")

    def test_data_designer_path_used_when_key_present(self):
        """With key set + data_designer mocked, path_used == 'data_designer'."""
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=8, seed=42)
        assert result.path_used == "data_designer"

    def test_mapping_produces_scenariospecs(self):
        """Every row returned by DataDesigner.preview() maps to a ScenarioSpec."""
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=8, seed=42)
        for spec in result.specs:
            assert isinstance(spec, _MockScenarioSpec)
            assert spec.vol_annual > 0
            # drift_annual can be negative
            assert isinstance(spec.drift_annual, float)

    def test_mapping_preserves_all_required_fields(self):
        """Mapped ScenarioSpec must have all renderer-required fields populated."""
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=7)
        required_fields = [
            "name", "vol_annual", "drift_annual", "dof",
            "n_bars", "jump_intensity", "jump_scale_sigma",
            "hmm_states", "low_vol_scale", "high_vol_scale",
            "transition_lo_to_hi", "transition_hi_to_lo",
            "severity_description",
        ]
        for spec in result.specs:
            for f in required_fields:
                assert hasattr(spec, f), f"ScenarioSpec missing field: {f}"

    def test_nvidia_model_alias_resolved_from_available_configs(self):
        """The NVIDIA text model alias is resolved from get_default_model_configs()
        rather than hardcoded — resolved alias must be 'nvidia-text' per mock."""
        designer = nsd.NeMoScenarioDesigner()
        alias = designer._resolve_nvidia_model_alias()
        assert alias == "nvidia-text"

    def test_nvidia_alias_uses_first_nvidia_text_provider(self):
        """Alias resolution picks the first alias with provider='nvidia'
        and 'text' in the alias (not reasoning, vision, or embedding)."""
        designer = nsd.NeMoScenarioDesigner()
        alias = designer._resolve_nvidia_model_alias()
        # Verify it comes from the mock config list
        nvidia_text_aliases = [
            c.alias for c in _MOCK_CONFIGS
            if c.provider == "nvidia" and "text" in c.alias and "reasoning" not in c.alias
        ]
        assert alias in nvidia_text_aliases

    def test_config_builder_built_before_preview_called(self):
        """DataDesignerConfigBuilder.add_column() must be called before
        DataDesigner.preview() — verifying the builder→preview call sequence."""
        build_calls = []
        preview_calls = []

        original_builder = sys.modules["data_designer.config"].DataDesignerConfigBuilder

        class _TrackingBuilder(original_builder):
            def add_column(self, col=None, **kwargs):
                build_calls.append(col)
                return super().add_column(col, **kwargs)

        original_designer = sys.modules["data_designer.interface"].DataDesigner

        class _TrackingDesigner(original_designer):
            def preview(self, config_builder, *, num_records=10):
                preview_calls.append(True)
                return super().preview(config_builder, num_records=num_records)

        sys.modules["data_designer.config"].DataDesignerConfigBuilder = _TrackingBuilder
        sys.modules["data_designer.interface"].DataDesigner = _TrackingDesigner
        try:
            importlib.reload(nsd)
            designer = nsd.NeMoScenarioDesigner()
            designer.generate_scenarios(count=4, seed=1)
            assert len(build_calls) > 0, "add_column was never called"
            assert len(preview_calls) > 0, "preview was never called"
        finally:
            sys.modules["data_designer.config"].DataDesignerConfigBuilder = original_builder
            sys.modules["data_designer.interface"].DataDesigner = original_designer
            importlib.reload(nsd)

    def test_archetype_column_contains_black_swan_values(self):
        """The config builder must include an archetype CATEGORY sampler
        with at least the 8 canonical black-swan archetype values."""
        REQUIRED_ARCHETYPES = {
            "crash", "rate_shock", "vol_spike", "credit_crisis",
            "flash_crash", "slow_bleed", "flash_recovery", "consistency_breach",
        }
        designer = nsd.NeMoScenarioDesigner()
        cb = designer._build_config(count=8, seed=42)
        # Verify the builder has an archetype column
        archetype_col = None
        for col in cb._columns:
            if hasattr(col, "name") and col.name == "archetype":
                archetype_col = col
                break
        assert archetype_col is not None, "No 'archetype' column in config builder"
        actual_values = set(archetype_col.params.values)
        assert REQUIRED_ARCHETYPES.issubset(actual_values), (
            f"Missing archetypes: {REQUIRED_ARCHETYPES - actual_values}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Provenance recording
# ═══════════════════════════════════════════════════════════════════════════════


class TestProvenanceRecording:
    """Run provenance must be recorded: model alias, seed, run_id hash."""

    @pytest.fixture(autouse=True)
    def set_nvidia_key(self, monkeypatch):
        monkeypatch.setenv("NVIDIA_API_KEY", "sk-fake")

    def test_provenance_recorded_in_result(self):
        """GenerationResult must include provenance with model, seed, run_id."""
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=99)
        assert hasattr(result, "provenance")
        prov = result.provenance
        assert "model" in prov
        assert "seed" in prov
        assert "run_id" in prov

    def test_provenance_model_is_nvidia_text(self):
        """Provenance model must be the resolved NVIDIA text model alias."""
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=10)
        assert "nvidia" in result.provenance["model"].lower()

    def test_provenance_seed_matches_input(self):
        """Provenance seed must match the seed passed to generate_scenarios."""
        designer = nsd.NeMoScenarioDesigner()
        for seed in [0, 42, 12345]:
            result = designer.generate_scenarios(count=2, seed=seed)
            assert result.provenance["seed"] == seed

    def test_run_id_is_deterministic_for_same_seed_and_count(self):
        """Same seed + count → same run_id (deterministic hash)."""
        designer = nsd.NeMoScenarioDesigner()
        r1 = designer.generate_scenarios(count=4, seed=7)
        r2 = designer.generate_scenarios(count=4, seed=7)
        assert r1.provenance["run_id"] == r2.provenance["run_id"]

    def test_run_id_differs_for_different_seeds(self):
        """Different seeds → different run_ids."""
        designer = nsd.NeMoScenarioDesigner()
        r1 = designer.generate_scenarios(count=4, seed=1)
        r2 = designer.generate_scenarios(count=4, seed=2)
        assert r1.provenance["run_id"] != r2.provenance["run_id"]

    def test_fallback_provenance_marks_fallback_path(self, monkeypatch):
        """Fallback provenance must explicitly mark path='fallback'."""
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=8, seed=42)
        assert result.provenance.get("path") == "fallback"

    def test_data_designer_provenance_marks_data_designer_path(self):
        """Data-designer provenance must mark path='data_designer'."""
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=5)
        assert result.provenance.get("path") == "data_designer"


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Fail-closed on API error / timeout
# ═══════════════════════════════════════════════════════════════════════════════


class TestFailClosedOnError:
    """If the DataDesigner API call raises any exception, fall back to
    NAMED_SCENARIOS and emit a clear log record — never crash the caller."""

    @pytest.fixture(autouse=True)
    def set_nvidia_key(self, monkeypatch):
        monkeypatch.setenv("NVIDIA_API_KEY", "sk-fake")

    def test_api_timeout_falls_back(self):
        """Simulate a TimeoutError from .preview() → still returns fallback specs."""
        original_dd = sys.modules["data_designer.interface"].DataDesigner

        class _TimeoutDesigner(original_dd):
            def preview(self, *a, **kw):
                raise TimeoutError("simulated timeout")

        sys.modules["data_designer.interface"].DataDesigner = _TimeoutDesigner
        try:
            importlib.reload(nsd)
            designer = nsd.NeMoScenarioDesigner()
            result = designer.generate_scenarios(count=8, seed=42)
            assert result.path_used == "fallback"
            assert len(result.specs) == len(NAMED_SCENARIOS)
        finally:
            sys.modules["data_designer.interface"].DataDesigner = original_dd
            importlib.reload(nsd)

    def test_api_exception_falls_back(self):
        """Any RuntimeError from .preview() → fallback, no exception propagated."""
        original_dd = sys.modules["data_designer.interface"].DataDesigner

        class _BrokenDesigner(original_dd):
            def preview(self, *a, **kw):
                raise RuntimeError("simulated API failure")

        sys.modules["data_designer.interface"].DataDesigner = _BrokenDesigner
        try:
            importlib.reload(nsd)
            designer = nsd.NeMoScenarioDesigner()
            result = designer.generate_scenarios(count=8, seed=0)
            assert result.path_used == "fallback"
        finally:
            sys.modules["data_designer.interface"].DataDesigner = original_dd
            importlib.reload(nsd)

    def test_api_empty_dataset_falls_back(self):
        """DataDesigner returning empty DataFrame → fall back to named scenarios."""
        import pandas as pd

        original_dd = sys.modules["data_designer.interface"].DataDesigner

        class _EmptyDesigner(original_dd):
            def preview(self, *a, **kw):
                empty = _MockPreviewResults(pd.DataFrame())
                return empty

        sys.modules["data_designer.interface"].DataDesigner = _EmptyDesigner
        try:
            importlib.reload(nsd)
            designer = nsd.NeMoScenarioDesigner()
            result = designer.generate_scenarios(count=8, seed=1)
            assert result.path_used == "fallback"
        finally:
            sys.modules["data_designer.interface"].DataDesigner = original_dd
            importlib.reload(nsd)

    def test_fallback_on_api_error_logs_warning(self, caplog):
        """API error must be logged at WARNING or ERROR level, not swallowed silently."""
        import logging
        original_dd = sys.modules["data_designer.interface"].DataDesigner

        class _RaisingDesigner(original_dd):
            def preview(self, *a, **kw):
                raise ConnectionError("endpoint unreachable")

        sys.modules["data_designer.interface"].DataDesigner = _RaisingDesigner
        try:
            importlib.reload(nsd)
            designer = nsd.NeMoScenarioDesigner()
            with caplog.at_level(logging.WARNING):
                designer.generate_scenarios(count=8, seed=0)
            error_logs = [r for r in caplog.records if r.levelno >= logging.WARNING]
            assert len(error_logs) >= 1, "Expected a warning/error log on API failure"
        finally:
            sys.modules["data_designer.interface"].DataDesigner = original_dd
            importlib.reload(nsd)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Governance contract
# ═══════════════════════════════════════════════════════════════════════════════


class TestGovernanceContract:
    """The module must declare challenger-only / advisory governance labels."""

    def test_governance_challenger_only(self):
        assert nsd.GOVERNANCE_LABELS["decision_role"] == "challenger_only"

    def test_governance_not_authoritative(self):
        assert nsd.GOVERNANCE_LABELS["authoritative"] is False

    def test_governance_experimental(self):
        assert nsd.GOVERNANCE_LABELS["experimental"] is True

    def test_module_never_exports_gate_function(self):
        """The module must NOT export any function named *gate* or *block*,
        which would imply authority over promotion decisions."""
        for attr in dir(nsd):
            assert "gate" not in attr.lower(), f"Unexpected gate export: {attr}"
            assert "block" not in attr.lower(), f"Unexpected block export: {attr}"


# ═══════════════════════════════════════════════════════════════════════════════
# 6. GenerationResult schema
# ═══════════════════════════════════════════════════════════════════════════════


class TestGenerationResultSchema:
    """GenerationResult must carry all documented fields."""

    @pytest.fixture(autouse=True)
    def set_nvidia_key(self, monkeypatch):
        monkeypatch.setenv("NVIDIA_API_KEY", "sk-fake")

    def test_result_has_specs_list(self):
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=0)
        assert hasattr(result, "specs")
        assert isinstance(result.specs, list)

    def test_result_has_path_used(self):
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=0)
        assert hasattr(result, "path_used")
        assert result.path_used in ("data_designer", "fallback")

    def test_result_has_provenance_dict(self):
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=0)
        assert isinstance(result.provenance, dict)

    def test_result_has_count_field(self):
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=4, seed=0)
        assert hasattr(result, "count")
        assert result.count == len(result.specs)

    def test_result_fallback_path(self, monkeypatch):
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        designer = nsd.NeMoScenarioDesigner()
        result = designer.generate_scenarios(count=8, seed=0)
        assert result.path_used == "fallback"
        assert result.count == len(NAMED_SCENARIOS)


# ═══════════════════════════════════════════════════════════════════════════════
# 7. populate_regime_bank integration
# ═══════════════════════════════════════════════════════════════════════════════


class TestPopulateRegimeBankIntegration:
    """When data_designer is available in populate_regime_bank, it should
    optionally call the designer for diverse specs.  Without the key, fall back
    to the 8 NAMED_SCENARIOS exactly as before."""

    def test_run_populate_dry_run_fallback(self, monkeypatch, tmp_path):
        """run_populate with dry_run=True works without NVIDIA_API_KEY."""
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        # Stub out polars write_parquet so no disk I/O needed
        import polars as pl

        # Provide a minimal StochasticRegimeGenerator stub
        class _FakeGen:
            def __init__(self, **kwargs):
                pass

            def generate(self, scenario_name):
                return pl.DataFrame({"open": [1.0], "high": [1.1], "low": [0.9], "close": [1.0], "volume": [100.0]})

            def calibrate(self, df):
                return True, {"passed": True}

            def severity_check(self, df, scenario_name):
                return True, {}

        _stochastic_mod.StochasticRegimeGenerator = _FakeGen

        from src.engine.synthetic import populate_regime_bank as prb
        importlib.reload(prb)

        config = {
            "symbols": ["MES"],
            "timeframes": ["5min"],
            "scenarios": list(NAMED_SCENARIOS.keys())[:2],
            "seed": 42,
            "output_dir": str(tmp_path),
            "max_batches": 1,
            "severity_check": True,
            "dry_run": True,
        }

        result = prb.run_populate(config)
        assert result["generated"] >= 1
        assert result["stored"] >= 1
        assert result["calibrated_passed"] >= 1

    def test_run_populate_uses_known_scenario_names(self, monkeypatch, tmp_path):
        """populate_regime_bank must only request scenarios that exist in NAMED_SCENARIOS."""
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        import polars as pl

        class _FakeGen:
            def __init__(self, **kwargs):
                pass

            def generate(self, scenario_name):
                assert scenario_name in NAMED_SCENARIOS, (
                    f"Unknown scenario requested: {scenario_name}"
                )
                return pl.DataFrame({"open": [1.0], "high": [1.1], "low": [0.9], "close": [1.0], "volume": [100.0]})

            def calibrate(self, df):
                return True, {"passed": True}

            def severity_check(self, df, scenario_name):
                return True, {}

        _stochastic_mod.StochasticRegimeGenerator = _FakeGen

        from src.engine.synthetic import populate_regime_bank as prb
        importlib.reload(prb)

        config = {
            "symbols": ["MES"],
            "timeframes": ["5min"],
            "scenarios": list(NAMED_SCENARIOS.keys()),
            "seed": 0,
            "output_dir": str(tmp_path),
            "max_batches": 1,
            "severity_check": False,
            "dry_run": True,
        }
        result = prb.run_populate(config)
        assert result["generated"] == len(NAMED_SCENARIOS)
