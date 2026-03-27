"""Tests for quantum MC engine."""
import numpy as np
import pytest
from src.engine.quantum_models import fit_truncated_normal, UncertaintyModel
from src.engine.quantum_mc import (
    run_quantum_breach_estimation,
    run_quantum_ruin_estimation,
    run_quantum_target_hit_estimation,
    run_quantum_tail_loss_estimation,
    run_hybrid_compare,
    QuantumRunResult,
    GOVERNANCE_LABELS,
)


class TestQuantumMC:
    def _make_model(self):
        data = np.random.default_rng(42).normal(50, 100, 500)
        return fit_truncated_normal(data)

    def test_breach_estimation_returns_result(self):
        model = self._make_model()
        result = run_quantum_breach_estimation(model, threshold=200)
        assert isinstance(result, QuantumRunResult)
        assert 0 <= result.estimated_value <= 1
        assert result.reproducibility_hash != ""

    def test_ruin_estimation(self):
        model = self._make_model()
        result = run_quantum_ruin_estimation(model, threshold=500)
        assert 0 <= result.estimated_value <= 1

    def test_target_hit_estimation(self):
        model = self._make_model()
        result = run_quantum_target_hit_estimation(model, threshold=100)
        assert 0 <= result.estimated_value <= 1

    def test_tail_loss_estimation(self):
        model = self._make_model()
        result = run_quantum_tail_loss_estimation(model, threshold=200)
        assert 0 <= result.estimated_value <= 1

    def test_governance_labels_always_present(self):
        model = self._make_model()
        result = run_quantum_breach_estimation(model, threshold=200)
        assert result.governance_labels["experimental"] is True
        assert result.governance_labels["authoritative"] is False
        assert result.governance_labels["decision_role"] == "challenger_only"

    def test_hybrid_compare(self):
        model = self._make_model()
        q_result = run_quantum_breach_estimation(model, threshold=200)
        compare = run_hybrid_compare(0.15, q_result)
        assert hasattr(compare, "within_tolerance")
        assert compare.absolute_delta >= 0

    def test_confidence_interval_valid(self):
        model = self._make_model()
        result = run_quantum_breach_estimation(model, threshold=200)
        ci = result.confidence_interval
        assert ci["lower"] <= result.estimated_value <= ci["upper"]

    def test_reproducibility_hash_deterministic(self):
        model = self._make_model()
        r1 = run_quantum_breach_estimation(model, threshold=200, seed=42)
        r2 = run_quantum_breach_estimation(model, threshold=200, seed=42)
        assert r1.reproducibility_hash == r2.reproducibility_hash
