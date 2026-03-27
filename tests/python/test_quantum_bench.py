"""Tests for quantum benchmarking framework."""
import pytest
from src.engine.quantum_mc import QuantumRunResult
from src.engine.quantum_bench import (
    benchmark_against_classical, validate_tolerance,
    build_reproducibility_hash, persist_benchmark,
    ToleranceConfig, BenchmarkResult,
)


class TestQuantumBench:
    def _make_quantum_result(self, value=0.12):
        return QuantumRunResult(
            estimated_value=value,
            confidence_interval={"lower": value - 0.01, "upper": value + 0.01, "confidence_level": 0.95},
            reproducibility_hash="abc123",
        )

    def test_benchmark_within_tolerance(self):
        qr = self._make_quantum_result(0.12)
        result = benchmark_against_classical(qr, 0.13, metric="breach_probability")
        assert result.absolute_delta == pytest.approx(0.01, abs=0.001)
        assert result.passes is True

    def test_benchmark_exceeds_tolerance(self):
        qr = self._make_quantum_result(0.12)
        result = benchmark_against_classical(qr, 0.25, metric="breach_probability")
        assert result.passes is False

    def test_custom_tolerance(self):
        qr = self._make_quantum_result(0.12)
        # Use generous relative tolerance to ensure pass with |0.12-0.25|/0.25 = 0.52
        tol = ToleranceConfig(absolute_tolerance=0.2, relative_tolerance=0.6)
        result = benchmark_against_classical(qr, 0.25, tolerance=tol)
        assert result.passes is True

    def test_validate_tolerance_function(self):
        tol = ToleranceConfig(absolute_tolerance=0.05)
        assert validate_tolerance(0.03, tol) is True
        assert validate_tolerance(0.06, tol) is False

    def test_hash_deterministic(self):
        config = {"a": 1, "b": 2}
        h1 = build_reproducibility_hash(config)
        h2 = build_reproducibility_hash(config)
        assert h1 == h2
        assert len(h1) == 64  # SHA-256

    def test_hash_changes_with_input(self):
        h1 = build_reproducibility_hash({"a": 1})
        h2 = build_reproducibility_hash({"a": 2})
        assert h1 != h2

    def test_persist_benchmark_format(self):
        qr = self._make_quantum_result(0.12)
        result = benchmark_against_classical(qr, 0.13)
        persisted = persist_benchmark(result)
        assert "metric" in persisted
        assert "quantum_value" in persisted
        assert isinstance(persisted["quantum_value"], str)

    def test_governance_on_benchmark(self):
        qr = self._make_quantum_result()
        result = benchmark_against_classical(qr, 0.13)
        assert result.governance_labels["experimental"] is True

    def test_all_methods_compared(self):
        """Benchmark works for all metric types."""
        for metric in ["breach_probability", "ruin_probability", "target_hit", "tail_loss"]:
            qr = self._make_quantum_result(0.1)
            result = benchmark_against_classical(qr, 0.11, metric=metric)
            assert result.metric == metric
