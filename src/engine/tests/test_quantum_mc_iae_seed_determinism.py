"""
test_quantum_mc_iae_seed_determinism.py — Wave 29 Production Hardening Fix 1

Verifies that seeded IAE sampler calls are deterministic:
  - Same seed → bit-exact estimated_value across calls
  - Different seeds → different estimated_value (seed is actually plumbed)

Tests are skipped when qiskit-aer is not available (CI environments without
the full Qiskit stack use the StatevectorSampler fallback instead).

Authority: challenger-only — these tests verify the quantum challenger evidence
layer's reproducibility contract, not any authoritative execution path.
"""
from __future__ import annotations

# ruff: noqa: I001, E402 — try/except import block needed for skip-gating on qiskit-aer availability

import pytest

from src.engine.quantum_mc import run_quantum_breach_estimation
from src.engine.quantum_models import UncertaintyModel

try:
    from qiskit_aer.primitives import Sampler as _AerSamplerProbe  # noqa: F401
    AER_SAMPLER_AVAILABLE = True
except ImportError:
    try:
        from qiskit.primitives import Sampler as _AerSamplerProbe  # type: ignore[no-redef]  # noqa: F401
        AER_SAMPLER_AVAILABLE = True
    except ImportError:
        AER_SAMPLER_AVAILABLE = False

# ── Fixtures ───────────────────────────────────────────────────────────────────

def _make_model() -> UncertaintyModel:
    """Minimal binned UncertaintyModel for fast CI.

    n_qubits is determined by len(probs) — we use 4 bins (2^2) for speed.
    bins must have len(probs) + 1 edges.
    """
    bins = [-2.0, -0.5, 0.5, 1.5, 3.0]    # 4 bins, n_qubits=2
    probs = [0.2, 0.3, 0.35, 0.15]         # sums to 1.0
    return UncertaintyModel(
        model_type="empirical_binned",
        parameters={},
        n_samples=100,
        bins=bins,
        probabilities=probs,
    )


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(
    not AER_SAMPLER_AVAILABLE,
    reason="requires qiskit-aer (Sampler primitive unavailable in this env)",
)
def test_iae_estimate_bit_exact_across_seeded_calls():
    """Same seed + same config → estimated_value must be identical across two calls.

    The Wave 27 replay-grading harness rests on determinism: identical inputs
    must produce the same reproducibility_hash and the same IAE estimate.
    Without seeding, the Sunday Discord verdict can flip on identical data.
    """
    model = _make_model()

    result_a = run_quantum_breach_estimation(
        model, threshold=0.5, epsilon=0.05, alpha=0.05, seed=42
    )
    result_b = run_quantum_breach_estimation(
        model, threshold=0.5, epsilon=0.05, alpha=0.05, seed=42
    )

    assert result_a.estimated_value == result_b.estimated_value, (
        f"IAE estimates differ across seeded calls with seed=42: "
        f"{result_a.estimated_value} vs {result_b.estimated_value}. "
        "Seed is not being plumbed to the AerSampler backend_options."
    )


@pytest.mark.skipif(
    not AER_SAMPLER_AVAILABLE,
    reason="requires qiskit-aer (Sampler primitive unavailable in this env)",
)
def test_iae_estimate_differs_across_different_seeds():
    """Different seeds → estimated_value should differ (seed is actually wired).

    This test proves the seed parameter is not a no-op. If both seeds produce
    the same result the seed plumbing is broken (silently ignored by the sampler).

    Note: there is a very small probability that both seeds produce the same IAE
    estimate by coincidence. If this test is flaky, increase n_qubits or use a
    threshold that splits the distribution more unevenly.
    """
    model = _make_model()

    result_42 = run_quantum_breach_estimation(
        model, threshold=0.5, epsilon=0.05, alpha=0.05, seed=42
    )
    result_43 = run_quantum_breach_estimation(
        model, threshold=0.5, epsilon=0.05, alpha=0.05, seed=43
    )

    assert result_42.estimated_value != result_43.estimated_value, (
        "IAE estimates are identical for seed=42 and seed=43 — seed may not be "
        "plumbed through to the AerSampler. If this is a rare collision, re-run; "
        "persistent failure indicates broken seed wiring."
    )
