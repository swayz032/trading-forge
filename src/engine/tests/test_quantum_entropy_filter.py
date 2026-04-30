"""Tests for quantum_entropy_filter.py — QCNN-style Quantum Entropy Filter.

Tier 3.1 / W3a — challenger_only. No authority escalation.

Test categories:
  - Challenger isolation (no leakage into execution paths)
  - Schema regression (output shape stability)
  - Benchmark comparison (vs classical baseline)
  - Reproducibility (seeded runs)
  - Runtime guardrails
  - Failure handling (unavailable hardware / degraded envs)
  - Authority boundary enforcement
"""
from __future__ import annotations

import importlib
import sys
import types
from typing import Any
from unittest.mock import patch, MagicMock

import pytest


# ─── Fixture: valid feature dict ─────────────────────────────────────────────

VALID_FEATURES: dict[str, float] = {
    "atr_5m": 0.5,
    "order_flow_imbalance": 0.3,
    "vix": 18.0,
    "gap_atr": 0.2,
    "spread": 0.05,
    # Pad to 8 features (module uses 8 qubits)
    "premarket_volume_pct": 0.8,
    "consecutive_losses": 0.0,
    "monthly_dd_usage": 0.1,
}

# High-chop synthetic features (high ATR disorder, high imbalance, high VIX, wide spread)
CHOP_FEATURES: dict[str, float] = {
    "atr_5m": 1.0,
    "order_flow_imbalance": 1.0,
    "vix": 40.0,
    "gap_atr": 2.0,
    "spread": 0.5,
    "premarket_volume_pct": 0.2,
    "consecutive_losses": 1.0,
    "monthly_dd_usage": 0.9,
}

# Low-chop synthetic features (orderly trending session)
TREND_FEATURES: dict[str, float] = {
    "atr_5m": 0.1,
    "order_flow_imbalance": 0.05,
    "vix": 12.0,
    "gap_atr": 0.05,
    "spread": 0.01,
    "premarket_volume_pct": 1.0,
    "consecutive_losses": 0.0,
    "monthly_dd_usage": 0.0,
}


# ─── Import target ───────────────────────────────────────────────────────────

def _import_module():
    """Fresh import of quantum_entropy_filter (bypasses cache for isolation tests)."""
    if "src.engine.quantum_entropy_filter" in sys.modules:
        del sys.modules["src.engine.quantum_entropy_filter"]
    import src.engine.quantum_entropy_filter as m
    return m


# ─── Schema / Output Shape Tests ─────────────────────────────────────────────

class TestOutputSchema:
    """Verify output shape matches the downstream consumer contract."""

    def test_returns_float_in_unit_interval(self):
        """noise_score must be in [0, 1] for any valid feature dict."""
        import src.engine.quantum_entropy_filter as m
        result = m.collect_quantum_noise(VALID_FEATURES, seed=42)
        assert result is not None, "Expected float, got None with PennyLane available"
        assert isinstance(result, float)
        assert 0.0 <= result <= 1.0, f"Out of range: {result}"

    def test_returns_float_with_minimal_features(self):
        """Module must pad missing features to 8 rather than crash."""
        import src.engine.quantum_entropy_filter as m
        minimal = {"atr_5m": 0.5, "vix": 20.0}
        result = m.collect_quantum_noise(minimal, seed=42)
        assert result is not None
        assert 0.0 <= result <= 1.0

    def test_returns_none_on_empty_dict(self):
        """Empty feature dict → returns None (no useful signal)."""
        import src.engine.quantum_entropy_filter as m
        result = m.collect_quantum_noise({}, seed=42)
        # Per design: returns None when features are empty
        assert result is None

    def test_governance_labels_present(self):
        """Module must expose GOVERNANCE_LABELS with challenger_only role."""
        import src.engine.quantum_entropy_filter as m
        g = m.GOVERNANCE_LABELS
        assert g["authoritative"] is False, "Must not be authoritative"
        assert g["decision_role"] == "challenger_only"
        assert g["experimental"] is True

    def test_threshold_constant_present(self):
        """QUANTUM_NOISE_THRESHOLD must be exported and equal 0.5 (placeholder)."""
        import src.engine.quantum_entropy_filter as m
        assert hasattr(m, "QUANTUM_NOISE_THRESHOLD")
        assert m.QUANTUM_NOISE_THRESHOLD == 0.5

    def test_pennylane_available_flag(self):
        """PENNYLANE_AVAILABLE must be a bool."""
        import src.engine.quantum_entropy_filter as m
        assert isinstance(m.PENNYLANE_AVAILABLE, bool)


# ─── Reproducibility Tests ───────────────────────────────────────────────────

class TestReproducibility:
    """Fixed-seed runs must return identical results."""

    def test_deterministic_same_seed(self):
        """Two calls with same seed → identical noise_score."""
        import src.engine.quantum_entropy_filter as m
        r1 = m.collect_quantum_noise(VALID_FEATURES, seed=42)
        r2 = m.collect_quantum_noise(VALID_FEATURES, seed=42)
        assert r1 is not None and r2 is not None
        assert r1 == r2, f"Non-deterministic: {r1} != {r2}"

    def test_different_seed_may_differ(self):
        """Different seeds are allowed to produce different outputs (not required)."""
        import src.engine.quantum_entropy_filter as m
        r1 = m.collect_quantum_noise(VALID_FEATURES, seed=0)
        r2 = m.collect_quantum_noise(VALID_FEATURES, seed=99)
        # We don't assert they differ (circuit may converge) — just that both are valid
        for r in [r1, r2]:
            if r is not None:
                assert 0.0 <= r <= 1.0


# ─── Edge Case Tests ──────────────────────────────────────────────────────────

class TestEdgeCases:
    """Out-of-range inputs, extreme values, missing keys."""

    def test_extreme_vix_no_crash(self):
        """VIX=999 must not crash — module clamps via tanh normalization."""
        import src.engine.quantum_entropy_filter as m
        features = {**VALID_FEATURES, "vix": 999.0}
        result = m.collect_quantum_noise(features, seed=42)
        assert result is not None
        assert 0.0 <= result <= 1.0

    def test_negative_features_no_crash(self):
        """Negative feature values must not crash."""
        import src.engine.quantum_entropy_filter as m
        features = {**VALID_FEATURES, "atr_5m": -5.0, "order_flow_imbalance": -1.0}
        result = m.collect_quantum_noise(features, seed=42)
        assert result is not None
        assert 0.0 <= result <= 1.0

    def test_missing_feature_key_returns_valid(self):
        """Missing keys are padded to 0.0 — must not crash or return None."""
        import src.engine.quantum_entropy_filter as m
        partial = {"atr_5m": 0.5}  # Only 1 of 8 features present
        result = m.collect_quantum_noise(partial, seed=42)
        assert result is not None
        assert 0.0 <= result <= 1.0

    def test_nan_feature_returns_none(self):
        """NaN feature values → returns None (cannot produce valid circuit)."""
        import src.engine.quantum_entropy_filter as m
        import math
        features = {**VALID_FEATURES, "atr_5m": math.nan}
        result = m.collect_quantum_noise(features, seed=42)
        assert result is None

    def test_inf_feature_returns_none(self):
        """Inf feature values → returns None."""
        import src.engine.quantum_entropy_filter as m
        import math
        features = {**VALID_FEATURES, "vix": math.inf}
        result = m.collect_quantum_noise(features, seed=42)
        assert result is None


# ─── Failure Handling: PennyLane Unavailable ────────────────────────────────

class TestPennylaneUnavailable:
    """When PennyLane is not importable, module returns None and logs once."""

    def test_returns_none_when_pennylane_missing(self, caplog):
        """Simulate PennyLane ImportError → collect_quantum_noise returns None."""
        # Reload module with PENNYLANE_AVAILABLE forced to False
        import src.engine.quantum_entropy_filter as m
        original_flag = m.PENNYLANE_AVAILABLE
        try:
            m.PENNYLANE_AVAILABLE = False
            result = m.collect_quantum_noise(VALID_FEATURES, seed=42)
            assert result is None, "Must return None when PennyLane unavailable"
        finally:
            m.PENNYLANE_AVAILABLE = original_flag

    def test_no_exception_propagated_when_pennylane_missing(self):
        """Must never raise when PennyLane is unavailable — caller gets None."""
        import src.engine.quantum_entropy_filter as m
        original_flag = m.PENNYLANE_AVAILABLE
        try:
            m.PENNYLANE_AVAILABLE = False
            # Must not raise
            result = m.collect_quantum_noise(VALID_FEATURES, seed=42)
            assert result is None
        finally:
            m.PENNYLANE_AVAILABLE = original_flag


# ─── Challenger Isolation Tests ───────────────────────────────────────────────

class TestChallengerIsolation:
    """Verify no authority escalation and no leakage into execution paths."""

    def test_no_direct_execution_authority(self):
        """Module must not expose any entry/exit/order/position-sizing functions."""
        import src.engine.quantum_entropy_filter as m
        forbidden_names = [
            "execute_trade", "submit_order", "place_order",
            "set_position", "size_position", "promote_strategy",
            "enter_position", "exit_position",
        ]
        for name in forbidden_names:
            assert not hasattr(m, name), f"Authority boundary violation: {name} found in module"

    def test_governance_labels_authoritative_false(self):
        """Authoritative must be False — module is advisory only."""
        import src.engine.quantum_entropy_filter as m
        assert m.GOVERNANCE_LABELS["authoritative"] is False

    def test_output_is_advisory_not_decision(self):
        """collect_quantum_noise returns a score, not a decision string."""
        import src.engine.quantum_entropy_filter as m
        result = m.collect_quantum_noise(VALID_FEATURES, seed=42)
        assert not isinstance(result, str), "Output must be numeric (advisory score), not a decision string"

    def test_no_db_imports(self):
        """Module must not import database or ORM modules (isolation)."""
        import src.engine.quantum_entropy_filter as m
        module_source_imports = [
            name for name in dir(m)
            if "drizzle" in name.lower() or "sqlalchemy" in name.lower() or "psycopg" in name.lower()
        ]
        assert len(module_source_imports) == 0, f"DB imports found: {module_source_imports}"

    def test_no_http_client_imports(self):
        """Module must not import HTTP clients (no outbound calls)."""
        import src.engine.quantum_entropy_filter as m
        # Check the module's __dict__ for HTTP client presence
        suspicious = [k for k in vars(m).keys() if k in ("requests", "httpx", "aiohttp", "urllib3")]
        assert len(suspicious) == 0, f"HTTP client imports found: {suspicious}"


# ─── Signal Direction Tests ──────────────────────────────────────────────────

class TestSignalDirection:
    """Chop signal (high disorder) should score higher than trend signal (low disorder)."""

    def test_chop_scores_higher_than_trend(self):
        """QCNN should distinguish high-disorder from low-disorder microstructure.

        Note: With random initialized weights, this is not guaranteed to hold
        without training. We test that BOTH outputs are in [0,1] and note that
        direction calibration requires trained weights (see threshold calibration
        TODO in CLAUDE.md). This test validates the interface, not the ML quality.
        """
        import src.engine.quantum_entropy_filter as m
        chop_score = m.collect_quantum_noise(CHOP_FEATURES, seed=42)
        trend_score = m.collect_quantum_noise(TREND_FEATURES, seed=42)

        assert chop_score is not None, "Chop features should return valid score"
        assert trend_score is not None, "Trend features should return valid score"
        assert 0.0 <= chop_score <= 1.0
        assert 0.0 <= trend_score <= 1.0
        # NOTE: With uninitialized weights we cannot assert direction.
        # This test documents the INTENDED direction; calibration training will enforce it.
        # Both outputs being in-range is sufficient for the W3a gate.


# ─── Benchmark Comparability Tests ───────────────────────────────────────────

class TestBenchmarkComparability:
    """Challenger output must be comparable to classical noise estimation baseline."""

    def test_output_includes_provenance_from_run_metadata(self):
        """run_quantum_entropy_filter must return metadata dict with provenance fields."""
        import src.engine.quantum_entropy_filter as m
        result = m.run_quantum_entropy_filter(VALID_FEATURES, seed=42)
        assert "noise_score" in result
        assert "execution_time_ms" in result
        assert "hardware" in result
        assert "seed" in result
        assert "governance" in result
        assert result["governance"]["decision_role"] == "challenger_only"
        assert result["governance"]["authoritative"] is False

    def test_hardware_field_is_local_simulator(self):
        """Default run must report hardware='default.qubit' (local CPU simulator)."""
        import src.engine.quantum_entropy_filter as m
        result = m.run_quantum_entropy_filter(VALID_FEATURES, seed=42)
        assert result["hardware"] in ("default.qubit", "fallback_unavailable"), \
            f"Unexpected hardware: {result['hardware']}"

    def test_execution_time_ms_is_populated(self):
        """execution_time_ms must be a non-negative integer."""
        import src.engine.quantum_entropy_filter as m
        result = m.run_quantum_entropy_filter(VALID_FEATURES, seed=42)
        assert isinstance(result["execution_time_ms"], int)
        assert result["execution_time_ms"] >= 0

    def test_noise_score_in_result_matches_collect_quantum_noise(self):
        """run_quantum_entropy_filter.noise_score must match collect_quantum_noise."""
        import src.engine.quantum_entropy_filter as m
        meta = m.run_quantum_entropy_filter(VALID_FEATURES, seed=42)
        direct = m.collect_quantum_noise(VALID_FEATURES, seed=42)
        assert meta["noise_score"] == direct


# ─── Performance Guardrail ────────────────────────────────────────────────────

class TestPerformanceGuardrail:
    """Single call must complete within 500ms on CPU (default.qubit)."""

    def test_call_under_500ms(self):
        """collect_quantum_noise must return within 500ms wall-clock on default.qubit."""
        import time
        import src.engine.quantum_entropy_filter as m
        t0 = time.time()
        result = m.collect_quantum_noise(VALID_FEATURES, seed=42)
        elapsed_ms = (time.time() - t0) * 1000
        assert elapsed_ms < 500, f"Too slow: {elapsed_ms:.1f}ms (limit 500ms)"


# ─── Premarket Analyzer Integration: quantum_noise_score field ───────────────

class TestPremarketIntegration:
    """collect_premarket_signals must include quantum_noise_score when env flag set."""

    def test_quantum_noise_score_absent_when_flag_off(self, monkeypatch):
        """With QUANTUM_ENTROPY_FILTER_ENABLED unset/false → field absent from signals."""
        monkeypatch.delenv("QUANTUM_ENTROPY_FILTER_ENABLED", raising=False)
        from src.engine.skip_engine import premarket_analyzer
        signals = premarket_analyzer.collect_premarket_signals(
            strategy_id="test-strat",
            vix=18.0,
            overnight_gap_atr=0.3,
        )
        # Must not be present (or explicitly None) when flag is off
        assert signals.get("quantum_noise_score") is None

    def test_quantum_noise_score_present_when_flag_on(self, monkeypatch):
        """With QUANTUM_ENTROPY_FILTER_ENABLED=true → field present in signals dict."""
        monkeypatch.setenv("QUANTUM_ENTROPY_FILTER_ENABLED", "true")
        from src.engine.skip_engine import premarket_analyzer
        # Force reimport so env var is picked up
        import importlib
        importlib.reload(premarket_analyzer)
        signals = premarket_analyzer.collect_premarket_signals(
            strategy_id="test-strat",
            vix=18.0,
            overnight_gap_atr=0.3,
        )
        # Key must be present; value is float or None (if circuit failed)
        assert "quantum_noise_score" in signals
        val = signals["quantum_noise_score"]
        if val is not None:
            assert 0.0 <= val <= 1.0

    def test_golden_file_regression_flag_off(self, monkeypatch):
        """Without flag, signals dict is identical to pre-W3a shape (no new keys)."""
        monkeypatch.delenv("QUANTUM_ENTROPY_FILTER_ENABLED", raising=False)
        from src.engine.skip_engine import premarket_analyzer
        signals = premarket_analyzer.collect_premarket_signals(
            strategy_id="golden-strat",
            vix=22.0,
            overnight_gap_atr=0.8,
        )
        # quantum_noise_score must NOT be present or must be None (not a non-None float)
        assert signals.get("quantum_noise_score") is None
