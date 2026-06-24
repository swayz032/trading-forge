"""Tests for NeMo Scenario Designer — Track 1 (Challenger-Only, Phase 0).

Updated for v2 API (GenerationResult / ScenarioSpec).  The old NeMoScenario
template-based API was removed in the data_designer wiring pass.

Covers:
  1.  Governance labels: GOVERNANCE_LABELS has authoritative=False, challenger_only
  2.  Count validation: count < 0 → ValueError; count > 10000 → ValueError
  3.  Count=0: fallback returns 8 named scenarios (fallback always returns all 8)
  4.  GenerationResult schema: .specs, .path_used, .provenance, .count all present
  5.  GenerationResult.__len__ and iteration work
  6.  Fallback path: path_used='fallback' when no NVIDIA_API_KEY
  7.  Fallback provenance marks path='fallback'
  8.  Determinism: same seed → same run_id
  9.  NeMoScenario dataclass still importable (kept for nemo_a14_bridge backward-compat)
  10. A14 bridge: A14ConditioningVector.to_a14_config() still works
  11. A14 bridge backwards compat: works without NeMo extras
  12. A14 bridge extras completeness
  13. A14 bridge to_a14_config merges base config
  14. Authority boundary: GenerationResult provenance has no lifecycle-decision fields
  15. NeMoScenarioDesigner init with device='auto' or device='cpu' doesn't crash
  16. ScenarioSpec fields present on fallback specs
  17. populate_regime_bank import check (module exists)
"""
from __future__ import annotations

import os
import time
from typing import Any

import pytest

from src.engine.nemo_scenario_designer import (
    GOVERNANCE_LABELS,
    NEMO_GENERATOR_VERSION,
    NeMoScenario,
    NeMoScenarioDesigner,
    GenerationResult,
)
from src.engine.nemo_a14_bridge import (
    A14ConditioningVector,
    batch_nemo_to_a14,
    nemo_to_a14_conditioning,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def designer() -> NeMoScenarioDesigner:
    return NeMoScenarioDesigner(device="cpu")


@pytest.fixture
def fallback_result(designer: NeMoScenarioDesigner, monkeypatch) -> GenerationResult:
    """A result from the fallback path (no API key)."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    return designer.generate_scenarios(count=8, seed=42)


# ─── Test 1: Governance labels ────────────────────────────────────────────────


def test_governance_labels_correct() -> None:
    """GOVERNANCE_LABELS must have authoritative=False and decision_role=challenger_only."""
    assert GOVERNANCE_LABELS["authoritative"] is False
    assert GOVERNANCE_LABELS["experimental"] is True
    assert GOVERNANCE_LABELS["decision_role"] == "challenger_only"


# ─── Test 2: Count validation ─────────────────────────────────────────────────


def test_fail_closed_negative_count(designer: NeMoScenarioDesigner) -> None:
    """count < 0 must raise ValueError."""
    with pytest.raises(ValueError, match="count must be >= 0"):
        designer.generate_scenarios(count=-1)


def test_fail_closed_excessive_count(designer: NeMoScenarioDesigner) -> None:
    """count > 10000 must raise ValueError."""
    with pytest.raises(ValueError, match="count must be <= 10000"):
        designer.generate_scenarios(count=10001)


# ─── Test 3: count=0 returns fallback specs ───────────────────────────────────


def test_edge_count_zero_returns_fallback(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """count=0 must return fallback (8 named scenarios) without error."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    result = designer.generate_scenarios(count=0, seed=0)
    # Fallback always returns all 8 NAMED_SCENARIOS.
    # Use structural check rather than isinstance() to avoid cross-test-module
    # class-identity issues when run in combined pytest sessions.
    assert hasattr(result, "path_used"), "result lacks path_used attribute"
    assert hasattr(result, "specs"), "result lacks specs attribute"
    assert result.path_used == "fallback"
    assert len(result.specs) == 8


# ─── Test 4: GenerationResult schema ─────────────────────────────────────────


def test_generation_result_has_required_attributes(fallback_result: GenerationResult) -> None:
    """GenerationResult must have .specs, .path_used, .provenance, .count."""
    assert hasattr(fallback_result, "specs")
    assert hasattr(fallback_result, "path_used")
    assert hasattr(fallback_result, "provenance")
    assert hasattr(fallback_result, "count")
    assert fallback_result.count == len(fallback_result.specs)


def test_generation_result_specs_are_scenario_specs(fallback_result: GenerationResult) -> None:
    """Every spec in .specs must have the renderer-required fields."""
    required_fields = [
        "name", "vol_annual", "drift_annual", "dof",
        "n_bars", "jump_intensity", "jump_scale_sigma",
        "hmm_states", "low_vol_scale", "high_vol_scale",
        "transition_lo_to_hi", "transition_hi_to_lo",
        "severity_description",
    ]
    for spec in fallback_result.specs:
        for f in required_fields:
            assert hasattr(spec, f), f"ScenarioSpec missing field: {f}"


# ─── Test 5: GenerationResult iteration ───────────────────────────────────────


def test_generation_result_len(fallback_result: GenerationResult) -> None:
    """len(result) must return the spec count."""
    assert len(fallback_result) == fallback_result.count


def test_generation_result_iteration(fallback_result: GenerationResult) -> None:
    """for spec in result must iterate over .specs."""
    specs_via_iter = list(fallback_result)
    assert specs_via_iter == fallback_result.specs


# ─── Test 6: Fallback path ────────────────────────────────────────────────────


def test_fallback_when_nvidia_key_absent(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """No NVIDIA_API_KEY → path_used='fallback'."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    result = designer.generate_scenarios(count=8, seed=42)
    assert result.path_used == "fallback"
    assert len(result) == 8


def test_fallback_specs_count_is_always_8(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """Fallback always returns 8 named scenarios regardless of count."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    for count in [0, 1, 4, 100]:
        result = designer.generate_scenarios(count=count, seed=0)
        assert len(result.specs) == 8, f"Expected 8 fallback specs for count={count}"


# ─── Test 7: Fallback provenance ──────────────────────────────────────────────


def test_fallback_provenance_marks_path(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """Fallback provenance must mark path='fallback'."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    result = designer.generate_scenarios(count=8, seed=42)
    assert result.provenance.get("path") == "fallback"


def test_fallback_provenance_has_run_id(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """Fallback provenance must include a run_id."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    result = designer.generate_scenarios(count=8, seed=42)
    assert "run_id" in result.provenance
    assert result.provenance["run_id"]  # non-empty


# ─── Test 8: Determinism ──────────────────────────────────────────────────────


def test_same_seed_same_run_id(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """Same seed + count → same run_id (deterministic hash)."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    r1 = designer.generate_scenarios(count=8, seed=42)
    r2 = designer.generate_scenarios(count=8, seed=42)
    assert r1.provenance["run_id"] == r2.provenance["run_id"]


def test_different_seeds_different_run_ids(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """Different seeds → different run_ids."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    r1 = designer.generate_scenarios(count=8, seed=1)
    r2 = designer.generate_scenarios(count=8, seed=2)
    assert r1.provenance["run_id"] != r2.provenance["run_id"]


# ─── Test 9: NeMoScenario backward-compat ────────────────────────────────────


def test_nemo_scenario_still_importable() -> None:
    """NeMoScenario dataclass must remain importable for nemo_a14_bridge compat."""
    from src.engine.nemo_scenario_designer import NeMoScenario
    scenario = NeMoScenario(
        scenario_label="crash",
        severity="extreme",
        duration_days=30,
        target_vol=0.80,
        target_trend=-0.50,
        target_gap_profile={"mean_gap_pct": 0.05, "gap_direction": "down"},
        narrative="Test crash scenario.",
        macro_links={"equity_index": "down"},
        generator_version=NEMO_GENERATOR_VERSION,
        run_id="test123",
        seed=42,
    )
    assert scenario.scenario_label == "crash"
    d = scenario.to_dict()
    assert "scenario_label" in d
    assert "severity" in d


# ─── Test 10: A14 bridge conditioning vector ──────────────────────────────────


def test_a14_conditioning_vector_to_config_has_mode() -> None:
    """A14ConditioningVector.to_a14_config() includes mode='generate' and regime_label."""
    scenario = NeMoScenario(
        scenario_label="vol_spike",
        severity="severe",
        duration_days=5,
        target_vol=0.60,
        target_trend=0.0,
        target_gap_profile={"mean_gap_pct": 0.02, "gap_direction": "neutral"},
        narrative="Vol spike scenario.",
        macro_links={},
        generator_version=NEMO_GENERATOR_VERSION,
        run_id="test-run",
    )
    cv = nemo_to_a14_conditioning(scenario)
    cfg = cv.to_a14_config()
    assert cfg["mode"] == "generate"
    assert cfg["regime_label"] == scenario.scenario_label
    assert "_nemo_extras" in cfg


# ─── Test 11: A14 bridge backwards compat ────────────────────────────────────


def test_backwards_compat_a14_without_nemo() -> None:
    """A14ConditioningVector works without NeMo extras (regime_label-only path)."""
    cv = A14ConditioningVector(
        regime_label="crash",
        target_vol=0.45,
        target_trend=-0.30,
        target_gap_profile={"mean_gap_pct": 0.01, "gap_direction": "down"},
    )
    cfg = cv.to_a14_config()
    assert cfg["regime_label"] == "crash"
    assert cfg["target_vol"] == 0.45
    assert cfg["_nemo_extras"] == {}  # empty extras, not missing


# ─── Test 12: Bridge extras completeness ──────────────────────────────────────


def test_bridge_extras_all_keys() -> None:
    """extras dict must contain narrative, severity, duration_days, macro_links, source."""
    scenario = NeMoScenario(
        scenario_label="rate_shock",
        severity="moderate",
        duration_days=15,
        target_vol=0.40,
        target_trend=-0.20,
        target_gap_profile={"mean_gap_pct": 0.01, "gap_direction": "down"},
        narrative="Rate shock scenario.",
        macro_links={"bonds": "up", "equities": "down"},
        generator_version=NEMO_GENERATOR_VERSION,
        run_id="extras-test",
    )
    cv = nemo_to_a14_conditioning(scenario)
    required_extras = ["narrative", "severity", "duration_days", "macro_links", "source", "generator_version"]
    for key in required_extras:
        assert key in cv.extras, f"extras missing: {key}"
    assert cv.extras["source"] == "nemo"


# ─── Test 13: to_a14_config merges base ───────────────────────────────────────


def test_to_a14_config_merges_base_config() -> None:
    """to_a14_config(base_config) merges and NeMo fields override base."""
    scenario = NeMoScenario(
        scenario_label="flash_crash",
        severity="extreme",
        duration_days=1,
        target_vol=1.20,
        target_trend=-0.80,
        target_gap_profile={"mean_gap_pct": 0.10, "gap_direction": "down"},
        narrative="Flash crash scenario.",
        macro_links={},
        generator_version=NEMO_GENERATOR_VERSION,
        run_id="merge-test",
    )
    cv = nemo_to_a14_conditioning(scenario)
    base = {"symbols": ["MES"], "seq_len": 60, "regime_label": "OVERRIDE_ME"}
    cfg = cv.to_a14_config(base_config=base)
    assert cfg["symbols"] == ["MES"]
    assert cfg["seq_len"] == 60
    assert cfg["regime_label"] == scenario.scenario_label  # NeMo overrides


# ─── Test 14: Authority boundary ─────────────────────────────────────────────


def test_no_lifecycle_authority_in_result(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """GenerationResult provenance must NOT contain lifecycle-decision fields."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    result = designer.generate_scenarios(count=8, seed=0)
    prov = result.provenance
    forbidden = ["authoritative_decision", "promote", "entry_signal", "exit_signal", "lifecycle_action"]
    for key in forbidden:
        assert key not in prov, f"Forbidden lifecycle field found in provenance: {key}"


# ─── Test 15: Initialization doesn't crash ───────────────────────────────────


def test_init_device_auto_no_crash() -> None:
    """NeMoScenarioDesigner init with device='auto' must not raise."""
    try:
        d = NeMoScenarioDesigner(device="auto")
        assert d._device in ("cpu", "lightning.gpu", "default.qubit", "auto")
    except Exception as exc:
        pytest.fail(f"device='auto' init raised: {exc}")


def test_init_device_cpu_no_crash() -> None:
    """NeMoScenarioDesigner init with device='cpu' must not raise."""
    d = NeMoScenarioDesigner(device="cpu")
    assert d._device == "cpu"


# ─── Test 16: Fallback specs have vol_annual > 0 ─────────────────────────────


def test_fallback_specs_vol_annual_positive(designer: NeMoScenarioDesigner, monkeypatch) -> None:
    """All fallback ScenarioSpec objects must have vol_annual > 0."""
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    result = designer.generate_scenarios(count=8, seed=0)
    for spec in result.specs:
        assert spec.vol_annual > 0, f"vol_annual <= 0 for spec {spec.name}"


# ─── Test 17: batch_nemo_to_a14 length ───────────────────────────────────────


def test_batch_nemo_to_a14_length() -> None:
    """batch_nemo_to_a14 must return same number of vectors as input scenarios."""
    scenarios = [
        NeMoScenario(
            scenario_label=f"scenario_{i}",
            severity="moderate",
            duration_days=10,
            target_vol=0.40,
            target_trend=-0.10,
            target_gap_profile={"mean_gap_pct": 0.01, "gap_direction": "down"},
            narrative=f"Scenario {i}.",
            macro_links={},
            generator_version=NEMO_GENERATOR_VERSION,
            run_id=f"batch-test-{i}",
        )
        for i in range(5)
    ]
    vectors = batch_nemo_to_a14(scenarios)
    assert len(vectors) == len(scenarios) == 5
    for v in vectors:
        assert isinstance(v, A14ConditioningVector)
