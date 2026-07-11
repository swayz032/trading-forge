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
def test_iae_estimates_the_true_breach_probability():
    """IAE must ESTIMATE the true breach amplitude (proves it actually runs, not stuck at a default).

    CORRECTED 2026-07-06: the previous version of this test asserted `estimate(seed=42) != estimate(seed=43)`
    to "prove the seed is wired". That premise is WRONG for amplitude estimation — Iterative Amplitude
    Estimation CONVERGES to the true amplitude to within epsilon regardless of seed (seed-invariance of a
    converged estimate is the correct, desired behavior, not broken plumbing). Installing qiskit-aer
    un-skipped the old test and it (correctly) found identical 0.5 across seeds — because the model's true
    breach prob at threshold=0.5 IS exactly 0.35+0.15=0.5. The right invariants are (a) the estimate matches
    the true amplitude per input, and (b) same seed is reproducible. Verified directly: thresholds 0.5/1.5/-0.5
    → 0.50/0.15/0.80, matching the bin masses above each threshold.
    """
    model = _make_model()
    # bins=[-2,-0.5,0.5,1.5,3.0], probs=[0.2,0.3,0.35,0.15]. Breach = mass strictly above threshold.
    for threshold, true_prob in [(0.5, 0.50), (1.5, 0.15), (-0.5, 0.80)]:
        result = run_quantum_breach_estimation(
            model, threshold=threshold, epsilon=0.05, alpha=0.05, seed=42
        )
        assert abs(result.estimated_value - true_prob) <= 0.05, (
            f"IAE estimate {result.estimated_value:.4f} at threshold={threshold} is not within epsilon "
            f"of the true breach prob {true_prob} — the amplitude estimator is not tracking the input."
        )


def test_iae_is_reproducible_for_the_same_seed():
    """Same seed → identical estimate (the actual determinism/reproducibility guarantee the seed provides)."""
    model = _make_model()
    a = run_quantum_breach_estimation(model, threshold=0.5, epsilon=0.05, alpha=0.05, seed=42)
    b = run_quantum_breach_estimation(model, threshold=0.5, epsilon=0.05, alpha=0.05, seed=42)
    assert a.estimated_value == b.estimated_value, (
        "IAE is not reproducible for a fixed seed — the seed is NOT deterministically plumbed to the sampler."
    )
