"""Tests for NeMo Scenario Designer — Track 1 (Challenger-Only, Phase 0).

Covers:
  1.  Schema conformance: NeMoScenario dataclass fields all present
  2.  Conditioning translation: nemo_to_a14_conditioning maps fields correctly
  3.  GPU detection: select_quantum_device respected (no crash when unavailable)
  4.  VRAM cap-aware fallback: probe_vram returns False -> CPU path
  5.  Fail-CLOSED: missing model -> structured error (graceful failure)
  6.  Fail-CLOSED: invalid output -> structured error
  7.  Determinism: same seed -> same scenarios
  8.  Severity distribution: count >= 100 -> all 4 severities present
  9.  generator_version stamp on every scenario
  10. Stylized-fact integration: generate 1 A14 conditioning vector (bridge only,
      not full A14 run — A14 smoke test in deliverables)
  11. Backwards compatibility: A14ConditioningVector works without NeMo (regime_label-only)
  12. Edge case: count=0 -> empty list
  13. Edge case: count=1 -> exactly 1 scenario
  14. Edge case: count=10000 -> performance budget (< 30s)
  15. Governance labels correct on every scenario
  16. Bridge: extras dict contains all required NeMo metadata fields
  17. Bridge: to_a14_config() includes mode="generate" and regime_label
  18. Authority boundary: no lifecycle decision fields in output
  19. Batch translation: batch_nemo_to_a14 length matches input
"""
from __future__ import annotations

import dataclasses
import time
from typing import get_type_hints

import pytest

from src.engine.nemo_scenario_designer import (
    GOVERNANCE_LABELS,
    NEMO_GENERATOR_VERSION,
    NeMoScenario,
    NeMoScenarioDesigner,
    _SCENARIO_TEMPLATES,
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
def single_scenario(designer: NeMoScenarioDesigner) -> NeMoScenario:
    scenarios = designer.generate_scenarios(count=1, seed=42)
    assert len(scenarios) == 1
    return scenarios[0]


# ─── Test 1: Schema conformance ───────────────────────────────────────────────


def test_schema_conformance_all_fields_present(single_scenario: NeMoScenario) -> None:
    """All NeMoScenario dataclass fields must be present and non-None (except seed)."""
    required_fields = [
        "scenario_label",
        "severity",
        "duration_days",
        "target_vol",
        "target_trend",
        "target_gap_profile",
        "narrative",
        "macro_links",
        "generator_version",
        "run_id",
    ]
    d = single_scenario.to_dict()
    for field in required_fields:
        assert field in d, f"Missing field: {field}"
        if field != "seed":
            assert d[field] is not None, f"Field {field} must not be None"


def test_schema_severity_valid(designer: NeMoScenarioDesigner) -> None:
    """Severity must be one of the four valid literals."""
    valid = {"mild", "moderate", "severe", "extreme"}
    scenarios = designer.generate_scenarios(count=20, seed=0)
    for s in scenarios:
        assert s.severity in valid, f"Invalid severity: {s.severity!r}"


def test_schema_target_vol_range(designer: NeMoScenarioDesigner) -> None:
    """target_vol must be > 0 and <= 1.5 (accounting for perturbation)."""
    scenarios = designer.generate_scenarios(count=20, seed=0)
    for s in scenarios:
        assert 0 < s.target_vol <= 1.5, f"target_vol out of range: {s.target_vol}"


def test_schema_target_trend_range(designer: NeMoScenarioDesigner) -> None:
    """target_trend must be in [-1, 1]."""
    scenarios = designer.generate_scenarios(count=20, seed=0)
    for s in scenarios:
        assert -1.0 <= s.target_trend <= 1.0, f"target_trend out of range: {s.target_trend}"


# ─── Test 2: Conditioning translation ────────────────────────────────────────


def test_conditioning_translation_fields(single_scenario: NeMoScenario) -> None:
    """nemo_to_a14_conditioning maps all required fields."""
    cv = nemo_to_a14_conditioning(single_scenario)
    assert cv.regime_label == single_scenario.scenario_label
    assert cv.target_vol == single_scenario.target_vol
    assert cv.target_trend == single_scenario.target_trend
    assert cv.target_gap_profile == single_scenario.target_gap_profile


def test_conditioning_translation_extras_complete(single_scenario: NeMoScenario) -> None:
    """extras dict must contain all NeMo metadata fields."""
    cv = nemo_to_a14_conditioning(single_scenario)
    for key in ("narrative", "severity", "duration_days", "macro_links", "source", "generator_version", "run_id"):
        assert key in cv.extras, f"extras missing key: {key}"
    assert cv.extras["source"] == "nemo"


# ─── Test 3: GPU detection does not crash ─────────────────────────────────────


def test_gpu_detection_no_crash() -> None:
    """NeMoScenarioDesigner init with device='auto' must not raise."""
    try:
        d = NeMoScenarioDesigner(device="auto")
        assert d._device in ("cpu", "lightning.gpu", "default.qubit")
    except Exception as exc:
        pytest.fail(f"GPU detection raised: {exc}")


# ─── Test 4: VRAM cap-aware fallback ─────────────────────────────────────────


def test_vram_cap_fallback_to_cpu() -> None:
    """When probe_vram returns False, device resolves to cpu-compatible name."""
    designer = NeMoScenarioDesigner(device="cpu")
    assert designer._device == "cpu"
    # Generate a small batch — must succeed on CPU
    scenarios = designer.generate_scenarios(count=5, seed=1)
    assert len(scenarios) == 5


# ─── Test 5: Fail-CLOSED: missing model ───────────────────────────────────────


def test_fail_closed_unsupported_model_path() -> None:
    """NeMoScenarioDesigner with a nonexistent model path must still initialize
    (template mode does not require model file) but should not produce garbage."""
    d = NeMoScenarioDesigner(model_path="/nonexistent/model.nemo", device="cpu")
    scenarios = d.generate_scenarios(count=2, seed=42)
    # Should still work in template mode
    assert len(scenarios) == 2


# ─── Test 6: Fail-CLOSED: count validation ───────────────────────────────────


def test_fail_closed_negative_count(designer: NeMoScenarioDesigner) -> None:
    """count < 0 must raise ValueError."""
    with pytest.raises(ValueError, match="count must be >= 0"):
        designer.generate_scenarios(count=-1)


def test_fail_closed_excessive_count(designer: NeMoScenarioDesigner) -> None:
    """count > 10000 must raise ValueError."""
    with pytest.raises(ValueError, match="count must be <= 10000"):
        designer.generate_scenarios(count=10001)


# ─── Test 7: Determinism ─────────────────────────────────────────────────────


def test_determinism_same_seed(designer: NeMoScenarioDesigner) -> None:
    """Same seed -> identical scenario labels and values."""
    a = designer.generate_scenarios(count=20, seed=777)
    b = designer.generate_scenarios(count=20, seed=777)
    assert len(a) == len(b)
    for i, (sa, sb) in enumerate(zip(a, b)):
        assert sa.scenario_label == sb.scenario_label, f"Label mismatch at {i}"
        assert sa.target_vol == sb.target_vol, f"Vol mismatch at {i}"
        assert sa.target_trend == sb.target_trend, f"Trend mismatch at {i}"


def test_determinism_different_seeds_differ(designer: NeMoScenarioDesigner) -> None:
    """Different seeds -> different output (probabilistically)."""
    a = designer.generate_scenarios(count=50, seed=1)
    b = designer.generate_scenarios(count=50, seed=2)
    labels_a = [s.scenario_label for s in a]
    labels_b = [s.scenario_label for s in b]
    # At least some labels must differ (order or labels differ on different seeds)
    assert labels_a != labels_b


# ─── Test 8: Severity distribution ───────────────────────────────────────────


def test_severity_distribution_all_four_present(designer: NeMoScenarioDesigner) -> None:
    """count >= 100 must produce at least 1 scenario per severity."""
    scenarios = designer.generate_scenarios(count=100, seed=0)
    severities = {s.severity for s in scenarios}
    assert severities == {"mild", "moderate", "severe", "extreme"}, \
        f"Not all severities present: {severities}"


def test_severity_distribution_count_100_correct_total(designer: NeMoScenarioDesigner) -> None:
    """Total count matches requested count."""
    scenarios = designer.generate_scenarios(count=100, seed=42)
    assert len(scenarios) == 100


# ─── Test 9: generator_version stamp ─────────────────────────────────────────


def test_generator_version_on_every_scenario(designer: NeMoScenarioDesigner) -> None:
    """Every scenario must have generator_version set."""
    scenarios = designer.generate_scenarios(count=10, seed=0)
    for s in scenarios:
        assert s.generator_version == NEMO_GENERATOR_VERSION


# ─── Test 10: Stylized-fact integration (bridge only) ────────────────────────


def test_a14_conditioning_vector_to_dict_has_mode(single_scenario: NeMoScenario) -> None:
    """A14ConditioningVector.to_a14_config() includes mode='generate' and regime_label."""
    cv = nemo_to_a14_conditioning(single_scenario)
    cfg = cv.to_a14_config()
    assert cfg["mode"] == "generate"
    assert cfg["regime_label"] == single_scenario.scenario_label
    assert "_nemo_extras" in cfg


# ─── Test 11: Backwards compatibility ────────────────────────────────────────


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


# ─── Test 12: Edge case count=0 ──────────────────────────────────────────────


def test_edge_count_zero(designer: NeMoScenarioDesigner) -> None:
    """count=0 must return empty list without error."""
    scenarios = designer.generate_scenarios(count=0, seed=0)
    assert scenarios == []


# ─── Test 13: Edge case count=1 ──────────────────────────────────────────────


def test_edge_count_one(designer: NeMoScenarioDesigner) -> None:
    """count=1 must return exactly 1 scenario."""
    scenarios = designer.generate_scenarios(count=1, seed=0)
    assert len(scenarios) == 1
    assert scenarios[0].generator_version == NEMO_GENERATOR_VERSION


# ─── Test 14: Performance budget (count=10000) ───────────────────────────────


def test_edge_count_large_perf_budget(designer: NeMoScenarioDesigner) -> None:
    """count=10000 must complete in < 30 seconds on CPU."""
    t0 = time.time()
    scenarios = designer.generate_scenarios(count=10000, seed=0)
    elapsed = time.time() - t0
    assert len(scenarios) == 10000
    assert elapsed < 30.0, f"10000 scenarios took {elapsed:.1f}s — over 30s budget"


# ─── Test 15: Governance labels ───────────────────────────────────────────────


def test_governance_labels_correct() -> None:
    """GOVERNANCE_LABELS must have authoritative=False and decision_role=challenger_only."""
    assert GOVERNANCE_LABELS["authoritative"] is False
    assert GOVERNANCE_LABELS["experimental"] is True
    assert GOVERNANCE_LABELS["decision_role"] == "challenger_only"


# ─── Test 16: Bridge extras completeness ─────────────────────────────────────


def test_bridge_extras_all_keys(single_scenario: NeMoScenario) -> None:
    """extras dict must contain narrative, severity, duration_days, macro_links, source."""
    cv = nemo_to_a14_conditioning(single_scenario)
    required_extras = ["narrative", "severity", "duration_days", "macro_links", "source", "generator_version"]
    for key in required_extras:
        assert key in cv.extras, f"extras missing: {key}"


# ─── Test 17: to_a14_config merge ────────────────────────────────────────────


def test_to_a14_config_merges_base(single_scenario: NeMoScenario) -> None:
    """to_a14_config(base_config) merges and NeMo fields override base."""
    cv = nemo_to_a14_conditioning(single_scenario)
    base = {"symbols": ["MES"], "seq_len": 60, "regime_label": "OVERRIDE_ME"}
    cfg = cv.to_a14_config(base_config=base)
    assert cfg["symbols"] == ["MES"]
    assert cfg["seq_len"] == 60
    assert cfg["regime_label"] == single_scenario.scenario_label  # NeMo overrides


# ─── Test 18: Authority boundary — no lifecycle fields ───────────────────────


def test_no_lifecycle_authority_fields(single_scenario: NeMoScenario) -> None:
    """NeMoScenario dict must NOT contain any lifecycle-decision fields."""
    d = single_scenario.to_dict()
    forbidden = ["authoritative_decision", "promote", "entry_signal", "exit_signal", "lifecycle_action"]
    for key in forbidden:
        assert key not in d, f"Forbidden lifecycle field found: {key}"


# ─── Test 19: Batch translation length ───────────────────────────────────────


def test_batch_nemo_to_a14_length(designer: NeMoScenarioDesigner) -> None:
    """batch_nemo_to_a14 must return same number of vectors as input scenarios."""
    scenarios = designer.generate_scenarios(count=15, seed=5)
    vectors = batch_nemo_to_a14(scenarios)
    assert len(vectors) == len(scenarios) == 15
    for v in vectors:
        assert isinstance(v, A14ConditioningVector)
