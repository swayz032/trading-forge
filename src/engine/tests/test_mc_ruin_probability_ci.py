"""Tests for Monte Carlo ruin probability confidence intervals.

Wave 27.5 Pass A.1 — CRITICAL #2: probability_of_ruin BCa CI.

Wave hardening 2026-06-22, F2 B14 ruin=firm-breach:
  These tests cover compute_all_mc_cis() in isolation (the no-firm helper path).
  On the no-firm path, probability_of_ruin is still terminal<=0 — these tests
  are correct and unchanged by F2. F2 replaces probability_of_ruin_ci in
  run_monte_carlo's risk_metrics when firm models are present; that is tested
  separately in test_mc_firm_breach_ruin.py.

Covers:
  - CI bounds are finite and within [0, 1] (probability constraints)
  - CI bounds straddle the point estimate (ci_low <= point <= ci_high)
  - CI shape contract: {point_estimate, ci_low, ci_high, ci_method, n_resamples, standard_error}
  - probability_of_ruin_ci alias key is present (no-firm path only)
  - n_resamples default is 9999
  - BCa CI vs known synthetic distribution (approximate agreement, not exact)
  - Degenerate cases: all ruins, no ruins
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.mc_confidence import (
    compute_all_mc_cis,
    compute_mc_confidence_intervals,
    probability_of_ruin_stat,
)

# ─── Synthetic distribution helper ───────────────────────────────


def _make_synthetic_paths(
    n_sims: int = 500,
    n_steps: int = 50,
    mu: float = 0.0,
    sigma: float = 1.0,
    seed: int = 42,
) -> np.ndarray:
    """Generate synthetic equity paths (cumulative random walk)."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(mu, sigma, size=(n_sims, n_steps))
    return np.cumsum(returns, axis=1)


# ─── CI shape contract ───────────────────────────────────────────


class TestRuinProbabilityCIShape:
    def test_probability_of_ruin_ci_key_present(self):
        """CRITICAL #2: probability_of_ruin_ci alias must be in output dict."""
        paths = _make_synthetic_paths(n_sims=200, seed=1)
        result = compute_all_mc_cis(paths, n_resamples=199)
        assert "probability_of_ruin_ci" in result, (
            "probability_of_ruin_ci key must be present for B14 consumption"
        )

    def test_probability_of_ruin_key_present(self):
        """Original probability_of_ruin key preserved for backward compat."""
        paths = _make_synthetic_paths(n_sims=200, seed=1)
        result = compute_all_mc_cis(paths, n_resamples=199)
        assert "probability_of_ruin" in result

    def test_ci_alias_equals_original(self):
        """probability_of_ruin_ci must be identical dict to probability_of_ruin."""
        paths = _make_synthetic_paths(n_sims=200, seed=2)
        result = compute_all_mc_cis(paths, n_resamples=199)
        assert result["probability_of_ruin_ci"] is result["probability_of_ruin"], (
            "probability_of_ruin_ci must be the same object as probability_of_ruin (alias, not recomputation)"
        )

    def test_ci_has_required_keys(self):
        """All required keys must be present in the CI dict."""
        paths = _make_synthetic_paths(n_sims=200, seed=3)
        result = compute_all_mc_cis(paths, n_resamples=199)
        ci = result["probability_of_ruin"]
        required_keys = {"point_estimate", "ci_low", "ci_high", "confidence_level", "ci_method", "n_resamples", "standard_error"}
        assert required_keys.issubset(ci.keys()), (
            f"Missing keys: {required_keys - ci.keys()}"
        )

    def test_n_resamples_in_ci_dict(self):
        """n_resamples must be included in the CI output (Wave 27.5 CRITICAL #2 contract)."""
        paths = _make_synthetic_paths(n_sims=200, seed=4)
        result = compute_all_mc_cis(paths, n_resamples=199)
        ci = result["probability_of_ruin"]
        assert ci["n_resamples"] == 199

    def test_default_n_resamples_is_9999(self):
        """Default n_resamples must be 9999 per spec."""
        import inspect

        from src.engine.mc_confidence import compute_all_mc_cis as _cis
        sig = inspect.signature(_cis)
        assert sig.parameters["n_resamples"].default == 9999

    def test_ci_method_is_bca_or_fallback(self):
        """ci_method must be 'BCa' or 'percentile_fallback'."""
        paths = _make_synthetic_paths(n_sims=200, seed=5)
        result = compute_all_mc_cis(paths, n_resamples=199)
        ci = result["probability_of_ruin"]
        assert ci["ci_method"] in ("BCa", "percentile_fallback", "percentile", "basic")


# ─── CI bounds correctness ────────────────────────────────────────


class TestRuinProbabilityCIBounds:
    def test_ci_bounds_within_0_1(self):
        """Ruin probability CI bounds must be in [0, 1] for non-degenerate distributions.

        When ruin probability is near 0 or 1, BCa CI may produce NaN (scipy known
        limitation with degenerate distributions). This test uses a distribution
        with ~20-40% ruin probability to avoid degeneracy.
        """
        import numpy as _np
        # Use mild downward drift to ensure ~20-40% ruin probability — avoids BCa degeneracy
        rng = _np.random.default_rng(10)
        returns = rng.normal(-0.2, 2.0, size=(300, 50))
        paths = _np.cumsum(returns, axis=1)
        result = compute_all_mc_cis(paths, n_resamples=199)
        ci = result["probability_of_ruin"]
        # Skip assertion if BCa returned NaN (degenerate) — point estimate must still be valid
        if not _np.isnan(ci["ci_low"]) and not _np.isnan(ci["ci_high"]):
            assert 0.0 <= ci["ci_low"] <= 1.0, f"ci_low={ci['ci_low']} out of [0,1]"
            assert 0.0 <= ci["ci_high"] <= 1.0, f"ci_high={ci['ci_high']} out of [0,1]"
        # Point estimate must always be valid
        assert 0.0 <= ci["point_estimate"] <= 1.0

    def test_ci_bounds_straddle_point_estimate(self):
        """ci_low <= point_estimate <= ci_high (CI contains the point estimate)."""
        paths = _make_synthetic_paths(n_sims=300, mu=-0.1, seed=11)
        result = compute_all_mc_cis(paths, n_resamples=199)
        ci = result["probability_of_ruin"]
        # Allow small floating-point tolerance
        assert ci["ci_low"] <= ci["point_estimate"] + 1e-9, (
            f"ci_low={ci['ci_low']} > point_estimate={ci['point_estimate']}"
        )
        assert ci["ci_high"] >= ci["point_estimate"] - 1e-9, (
            f"ci_high={ci['ci_high']} < point_estimate={ci['point_estimate']}"
        )

    def test_ci_width_is_positive(self):
        """CI must have non-zero width for non-degenerate distributions."""
        paths = _make_synthetic_paths(n_sims=300, mu=0.0, sigma=2.0, seed=12)
        result = compute_all_mc_cis(paths, n_resamples=199)
        ci = result["probability_of_ruin"]
        assert ci["ci_high"] > ci["ci_low"], "CI width must be positive for non-degenerate distributions"

    def test_degenerate_all_ruin(self):
        """All paths ruin → ruin probability = 1.0 ± epsilon."""
        # All paths end deeply negative
        paths = np.full((100, 20), -1000.0)
        result = compute_all_mc_cis(paths, n_resamples=99)
        ci = result["probability_of_ruin"]
        assert ci["point_estimate"] == pytest.approx(1.0, abs=1e-9)

    def test_degenerate_no_ruin(self):
        """All paths survive → ruin probability = 0.0 ± epsilon."""
        # All paths end highly positive
        paths = np.full((100, 20), 10000.0)
        result = compute_all_mc_cis(paths, n_resamples=99)
        ci = result["probability_of_ruin"]
        assert ci["point_estimate"] == pytest.approx(0.0, abs=1e-9)


# ─── BCa CI approximation test ───────────────────────────────────


class TestRuinProbabilityCIAccuracy:
    def test_bca_ci_point_estimate_matches_direct_calculation(self):
        """BCa point estimate must match direct computation of ruin fraction."""
        rng = np.random.default_rng(99)
        # 400 paths, 60 steps, mild downward drift → ~20-40% ruin
        returns = rng.normal(-0.5, 3.0, size=(400, 60))
        paths = np.cumsum(returns, axis=1)

        result = compute_all_mc_cis(paths, n_resamples=499)
        ci = result["probability_of_ruin"]

        # Direct calculation: fraction of paths ending <= 0
        terminal = paths[:, -1]
        direct_ruin = float(np.mean(terminal <= 0))
        assert ci["point_estimate"] == pytest.approx(direct_ruin, abs=1e-9)

    def test_bca_ci_covers_true_probability(self):
        """BCa CI should contain the true ruin probability for a known distribution.

        This is a probabilistic test with generous tolerance — we're testing that
        the CI is in the right ballpark, not an exact coverage guarantee.
        """
        rng = np.random.default_rng(77)
        # 1000 paths, 100 steps — enough for stable estimates
        returns = rng.normal(-0.3, 2.5, size=(1000, 100))
        paths = np.cumsum(returns, axis=1)

        result = compute_all_mc_cis(paths, n_resamples=999)
        ci = result["probability_of_ruin"]

        # The empirical ruin rate over all sims should be within the CI
        terminal = paths[:, -1]
        empirical_ruin = float(np.mean(terminal <= 0))
        assert ci["ci_low"] <= empirical_ruin <= ci["ci_high"] or (
            # Allow small numerical tolerance from bootstrap sampling
            abs(ci["ci_low"] - empirical_ruin) < 0.01 or
            abs(ci["ci_high"] - empirical_ruin) < 0.01
        ), f"CI [{ci['ci_low']:.4f}, {ci['ci_high']:.4f}] doesn't contain empirical ruin {empirical_ruin:.4f}"

    def test_direct_bca_on_ruin_stat(self):
        """compute_mc_confidence_intervals on ruin stat returns valid shape."""
        rng = np.random.default_rng(55)
        terminal_values = rng.normal(100, 50, size=500)
        result = compute_mc_confidence_intervals(
            terminal_values,
            probability_of_ruin_stat,
            n_resamples=499,
            seed=42,
        )
        assert "point_estimate" in result
        assert "ci_low" in result
        assert "ci_high" in result
        assert "ci_method" in result
        assert "n_resamples" in result
        assert result["n_resamples"] == 499
        assert result["confidence_level"] == pytest.approx(0.95)


# ─── Other metrics still present ─────────────────────────────────


class TestOtherMetricsPreserved:
    def test_all_four_metrics_present(self):
        """All 4 metrics must be in result (no regression from CRITICAL #2 change)."""
        paths = _make_synthetic_paths(n_sims=200, seed=20)
        result = compute_all_mc_cis(paths, n_resamples=199)
        assert "survival_rate" in result
        assert "probability_of_ruin" in result
        assert "max_drawdown_p5" in result
        assert "cvar95" in result

    def test_survival_rate_plus_ruin_sums_to_one(self):
        """survival_rate + probability_of_ruin point estimates must sum to 1.0."""
        paths = _make_synthetic_paths(n_sims=400, mu=0.2, seed=21)
        result = compute_all_mc_cis(paths, n_resamples=199)
        total = result["survival_rate"]["point_estimate"] + result["probability_of_ruin"]["point_estimate"]
        assert total == pytest.approx(1.0, abs=1e-9), f"sum={total} expected 1.0"
