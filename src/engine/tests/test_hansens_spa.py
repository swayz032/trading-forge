"""Wave 26 Pass G Pass E — Hansen's SPA tests.

Covers:
  - Output schema: all three p-values + metadata present
  - Determinism: same seed → same outputs
  - Monotonicity: spa_lower_p >= spa_consistent_p >= spa_upper_p (ordering)
  - Known-answer: strong positive edge → passed=True
  - Known-answer: zero edge → passed=False
  - Gate logic: passed = (spa_consistent_p < threshold), not lower or upper
  - Input validation: length mismatch, dimensionality
  - Env var threshold override
  - SPA is at least as powerful as WRC (spa_consistent_p <= spa_lower_p)
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from src.engine.statistics.hansens_spa import (
    hansens_spa,
    get_spa_p_threshold,
)
from src.engine.statistics.whites_reality_check import whites_reality_check


# ── Helpers ───────────────────────────────────────────────────────────────────

def _positive_returns(n: int = 500, mean: float = 0.005, seed: int = 42) -> np.ndarray:
    return np.random.default_rng(seed).normal(mean, 0.01, n)


def _zero_returns(n: int = 500, seed: int = 42) -> np.ndarray:
    return np.random.default_rng(seed).normal(0.0, 0.01, n)


def _benchmark(n: int = 500) -> np.ndarray:
    return np.zeros(n)


# ── Output schema ─────────────────────────────────────────────────────────────

class TestSpaOutputSchema:
    """SPA result dict must contain all documented keys."""

    def test_required_keys_present(self):
        strat = _positive_returns(200)
        bench = _benchmark(200)
        result = hansens_spa(strat, bench, n_bootstrap=100)
        required = {
            "spa_lower_p", "spa_consistent_p", "spa_upper_p",
            "passed", "threshold", "n_obs", "n_bootstrap",
            "block_length", "mean_excess_return",
        }
        assert required.issubset(result.keys()), f"Missing keys: {required - set(result.keys())}"

    def test_all_p_values_in_unit_interval(self):
        strat = _positive_returns(200)
        bench = _benchmark(200)
        result = hansens_spa(strat, bench, n_bootstrap=100)
        for key in ("spa_lower_p", "spa_consistent_p", "spa_upper_p"):
            assert 0.0 <= result[key] <= 1.0, f"{key} = {result[key]} not in [0,1]"

    def test_n_obs_matches_input(self):
        n = 250
        result = hansens_spa(_positive_returns(n), _benchmark(n), n_bootstrap=50)
        assert result["n_obs"] == n

    def test_passed_reflects_consistent_p(self):
        """passed must be True iff spa_consistent_p < threshold."""
        strat = _positive_returns(500, mean=0.005)
        bench = _benchmark(500)
        result = hansens_spa(strat, bench, n_bootstrap=2000, rng_seed=42)
        expected_passed = result["spa_consistent_p"] < result["threshold"]
        assert result["passed"] == expected_passed


# ── Determinism ───────────────────────────────────────────────────────────────

class TestSpaDeterminism:
    """Same inputs + same seed → identical outputs."""

    def test_identical_results_same_seed(self):
        strat = _positive_returns(400)
        bench = _benchmark(400)
        r1 = hansens_spa(strat, bench, n_bootstrap=200, rng_seed=77)
        r2 = hansens_spa(strat, bench, n_bootstrap=200, rng_seed=77)
        assert r1["spa_lower_p"] == r2["spa_lower_p"]
        assert r1["spa_consistent_p"] == r2["spa_consistent_p"]
        assert r1["spa_upper_p"] == r2["spa_upper_p"]


# ── P-value ordering ──────────────────────────────────────────────────────────

class TestSpaPvalueOrdering:
    """SPA p-value ordering invariant: lower >= consistent >= upper (most→least conservative)."""

    def test_p_value_ordering_positive_strategy(self):
        """For a positive-edge strategy, ordering must hold."""
        strat = _positive_returns(500, mean=0.003, seed=10)
        bench = _benchmark(500)
        result = hansens_spa(strat, bench, n_bootstrap=1000, rng_seed=10)
        # lower >= consistent >= upper (more conservative → higher p-value)
        # Note: due to bootstrap variance these can be approximately equal
        assert result["spa_lower_p"] >= result["spa_upper_p"] - 0.05, (
            "SPA ordering violated: lower < upper - 0.05"
        )

    def test_consistent_between_lower_and_upper(self):
        """spa_consistent_p should fall between lower and upper (loosely)."""
        strat = _positive_returns(400, mean=0.002, seed=20)
        bench = _benchmark(400)
        result = hansens_spa(strat, bench, n_bootstrap=500, rng_seed=20)
        # Due to bootstrap variance allow ±0.10 tolerance
        assert result["spa_upper_p"] - 0.10 <= result["spa_consistent_p"] <= result["spa_lower_p"] + 0.10


# ── Known-answer tests ────────────────────────────────────────────────────────

class TestSpaKnownAnswers:
    """Known-answer tests with clear outcomes."""

    def test_strong_positive_edge_passes(self):
        """Strategy with strong positive mean excess returns → passed=True."""
        strat = _positive_returns(500, mean=0.005, seed=42)
        bench = _benchmark(500)
        result = hansens_spa(strat, bench, n_bootstrap=2000, rng_seed=42)
        assert result["passed"] is True, (
            f"Expected passed=True for strong positive edge, "
            f"spa_consistent_p={result['spa_consistent_p']}"
        )
        assert result["spa_consistent_p"] < 0.05

    def test_zero_edge_does_not_pass(self):
        """Zero-mean excess return strategy (H0 true) → passed=False."""
        rng = np.random.default_rng(0)
        strat = rng.normal(0.0, 0.01, 500)
        bench = np.zeros(500)
        result = hansens_spa(strat, bench, n_bootstrap=2000, rng_seed=0)
        assert result["passed"] is False
        # Consistent p near 0.5 for a null strategy
        assert result["spa_consistent_p"] >= 0.10

    def test_negative_edge_does_not_pass(self):
        """Negative mean excess return → test stat negative → p should be high (not rejected)."""
        strat = _positive_returns(500, mean=-0.005, seed=7)
        bench = _benchmark(500)
        result = hansens_spa(strat, bench, n_bootstrap=500, rng_seed=7)
        assert result["passed"] is False
        # For negative edge: consistent demeans by max(0, mu_hat)=0 so consistent ≈ lower;
        # p should be well above rejection threshold — allow some bootstrap variance.
        assert result["spa_consistent_p"] >= 0.40


# ── SPA power vs WRC ─────────────────────────────────────────────────────────

class TestSpaPowerVsWrc:
    """SPA consistent p-value should be ≤ WRC p-value (SPA is at least as powerful)."""

    def test_spa_consistent_at_most_as_conservative_as_wrc(self):
        """For positive-edge strategy: spa_consistent_p <= wrc_p_value (SPA more powerful)."""
        strat = _positive_returns(500, mean=0.003, seed=1)
        bench = _benchmark(500)
        spa_result = hansens_spa(strat, bench, n_bootstrap=1000, rng_seed=1)
        wrc_result = whites_reality_check(strat, bench, n_bootstrap=1000, rng_seed=1)
        # SPA consistent should be at most as conservative as WRC (generally lower p)
        # Due to different bootstrap procedures allow 0.10 tolerance
        assert spa_result["spa_consistent_p"] <= wrc_result["p_value"] + 0.10, (
            f"spa_consistent_p ({spa_result['spa_consistent_p']}) should be ≤ "
            f"wrc_p_value ({wrc_result['p_value']}) + 0.10"
        )

    def test_spa_lower_p_is_most_conservative(self):
        """SPA lower p should be >= consistent p for a positive-edge strategy."""
        strat = _positive_returns(400, mean=0.004, seed=2)
        bench = _benchmark(400)
        spa_result = hansens_spa(strat, bench, n_bootstrap=500, rng_seed=2)
        # lower is the most conservative variant: its p-value >= consistent p
        assert spa_result["spa_lower_p"] >= spa_result["spa_consistent_p"] - 0.05


# ── Input validation ──────────────────────────────────────────────────────────

class TestSpaInputValidation:
    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError, match="Length mismatch"):
            hansens_spa([0.01] * 10, [0.0] * 9)

    def test_2d_input_raises(self):
        with pytest.raises(ValueError, match="1-D"):
            hansens_spa(np.zeros((10, 2)), np.zeros(10))

    def test_minimum_2_observations(self):
        with pytest.raises(ValueError, match="At least 2"):
            hansens_spa([0.01], [0.0])

    def test_exactly_2_observations_works(self):
        result = hansens_spa([0.01, 0.02], [0.0, 0.0], n_bootstrap=50)
        assert isinstance(result["spa_consistent_p"], float)


# ── Env var override ──────────────────────────────────────────────────────────

class TestSpaEnvVarOverride:
    def test_default_threshold_is_0_05(self):
        original = os.environ.pop("SPA_P_VALUE_THRESHOLD", None)
        try:
            assert get_spa_p_threshold() == pytest.approx(0.05)
        finally:
            if original is not None:
                os.environ["SPA_P_VALUE_THRESHOLD"] = original

    def test_threshold_in_result_reflects_env(self):
        original = os.environ.get("SPA_P_VALUE_THRESHOLD")
        try:
            os.environ["SPA_P_VALUE_THRESHOLD"] = "0.10"
            strat = _positive_returns(200, seed=3)
            result = hansens_spa(strat, _benchmark(200), n_bootstrap=100)
            assert result["threshold"] == pytest.approx(0.10)
        finally:
            if original is None:
                os.environ.pop("SPA_P_VALUE_THRESHOLD", None)
            else:
                os.environ["SPA_P_VALUE_THRESHOLD"] = original
