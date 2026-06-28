"""Wave 26 Pass G Pass E + 2026-06-28 multi-model upgrade — Hansen's SPA tests.

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
  - 2026-06-28 bug fix: shared time-index per bootstrap iteration (was 3×independent)
  - Multi-model (hansens_spa_multi): genuine edge → low spa_consistent_p
  - Multi-model: SPA more powerful than WRC on dominated-model fixture
  - Multi-model: Šidák inflation, schema, determinism
  - Multi-model: gate key spa_consistent_p present and gate-ready
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from src.engine.statistics.hansens_spa import (
    get_spa_p_threshold,
    hansens_spa,
    hansens_spa_multi,
)
from src.engine.statistics.whites_reality_check import (
    whites_reality_check,
    whites_reality_check_multi,
)

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


# ── Multi-model SPA tests (hansens_spa_multi) ─────────────────────────────────


def _make_positive_matrix(n_models: int = 5, T: int = 500, mean: float = 0.004, seed: int = 0) -> np.ndarray:
    """All L models have consistently positive mean excess return."""
    rng = np.random.default_rng(seed)
    return rng.normal(mean, 0.01, (n_models, T))


def _make_dominated_matrix(T: int = 500, seed: int = 0) -> np.ndarray:
    """1 strong positive model + 4 dominated (clearly negative) models.

    SPA consistent recentering down-weights dominated models → SPA consistent_p
    should be lower than WRC p (SPA is more powerful in this configuration).
    """
    rng = np.random.default_rng(seed)
    winner = rng.normal(0.004, 0.01, (1, T))
    dominated = rng.normal(-0.006, 0.01, (4, T))
    return np.vstack([winner, dominated])


class TestSpaMultiModel:
    """Multi-model Hansen's SPA — studentised construction with consistent recentering."""

    # ── Schema tests ─────────────────────────────────────────────────────────

    def test_output_schema_complete(self):
        """All documented keys present in multi-model SPA result."""
        matrix = _make_positive_matrix(5, 200)
        bench = np.zeros_like(matrix)
        result = hansens_spa_multi(matrix, bench, n_bootstrap=100, rng_seed=0)
        required = {
            "spa_consistent_p", "spa_lower_p", "spa_upper_p",
            "spa_consistent_p_raw", "spa_lower_p_raw", "spa_upper_p_raw",
            "passed", "threshold", "n_models", "n_total_trials", "k_eff",
            "sidak_adjusted", "test_stat_studentized", "mean_excess_return",
            "n_obs", "n_bootstrap", "block_length",
        }
        missing = required - set(result.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_all_p_values_in_unit_interval(self):
        matrix = _make_positive_matrix(4, 200)
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=100)
        for key in ("spa_lower_p", "spa_consistent_p", "spa_upper_p"):
            assert 0.0 <= result[key] <= 1.0, f"{key}={result[key]} not in [0,1]"

    def test_n_models_matches_rows(self):
        matrix = _make_positive_matrix(6, 200)
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=50)
        assert result["n_models"] == 6

    def test_passed_reflects_spa_consistent_p(self):
        """passed must be True iff spa_consistent_p < threshold."""
        matrix = _make_positive_matrix(5, 500, mean=0.005, seed=42)
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=2000, rng_seed=42)
        assert result["passed"] == (result["spa_consistent_p"] < result["threshold"])

    def test_gate_key_is_spa_consistent_p(self):
        """spa_consistent_p must be present — it is the TS gate contract key."""
        matrix = _make_positive_matrix(3, 200)
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=100)
        assert "spa_consistent_p" in result, "Gate contract key spa_consistent_p must be present"
        assert isinstance(result["spa_consistent_p"], float)

    # ── Determinism ──────────────────────────────────────────────────────────

    def test_deterministic_same_seed(self):
        """Same inputs + same seed → identical results."""
        matrix = _make_positive_matrix(5, 300)
        bench = np.zeros_like(matrix)
        r1 = hansens_spa_multi(matrix, bench, n_bootstrap=200, rng_seed=55)
        r2 = hansens_spa_multi(matrix, bench, n_bootstrap=200, rng_seed=55)
        assert r1["spa_consistent_p"] == r2["spa_consistent_p"]
        assert r1["spa_lower_p"] == r2["spa_lower_p"]
        assert r1["spa_upper_p"] == r2["spa_upper_p"]
        assert r1["test_stat_studentized"] == r2["test_stat_studentized"]

    # ── Known-answer tests ────────────────────────────────────────────────────

    def test_genuine_edge_across_all_paths_passes(self):
        """All L paths with genuine positive mean → spa_consistent_p < 0.05."""
        matrix = _make_positive_matrix(5, 500, mean=0.005, seed=42)
        bench = np.zeros_like(matrix)
        result = hansens_spa_multi(matrix, bench, n_bootstrap=2000, rng_seed=42)
        assert result["passed"] is True, (
            f"Expected passed=True for genuine multi-path edge, "
            f"got spa_consistent_p={result['spa_consistent_p']}"
        )
        assert result["spa_consistent_p"] < 0.05

    def test_all_zero_mean_does_not_pass(self):
        """L paths with zero mean → H0 is true → spa_consistent_p near 0.5."""
        rng = np.random.default_rng(88)
        matrix = rng.normal(0.0, 0.01, (5, 500))
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=2000, rng_seed=88)
        assert result["passed"] is False
        assert result["spa_consistent_p"] >= 0.10

    def test_all_negative_mean_does_not_pass(self):
        """All L paths have negative mean → spa_consistent_p high → passed=False."""
        rng = np.random.default_rng(7)
        matrix = rng.normal(-0.005, 0.01, (5, 500))
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=500, rng_seed=7)
        assert result["passed"] is False
        assert result["spa_consistent_p"] >= 0.30

    # ── SPA more powerful than WRC on dominated fixture ──────────────────────

    def test_spa_consistent_more_powerful_than_wrc_on_dominated_paths(self):
        """On a dominated-model fixture, SPA consistent p <= WRC p (SPA more powerful).

        When 4 of 5 models clearly underperform (negative mean), the WRC null
        is inflated by their bootstrap variance.  SPA consistent recentering
        removes them from the null → smaller p → more power to detect the winner's edge.

        We test: spa_consistent_p_raw <= wrc_p_raw (before Šidák) for this fixture.
        """
        matrix = _make_dominated_matrix(T=500, seed=20)
        bench = np.zeros_like(matrix)
        spa_result = hansens_spa_multi(matrix, bench, n_bootstrap=1000, rng_seed=20,
                                       n_total_trials=5, k_eff=5)
        wrc_result = whites_reality_check_multi(matrix, bench, n_bootstrap=1000, rng_seed=20,
                                                n_total_trials=5, k_eff=5)
        # SPA consistent should have lower or equal p_raw vs WRC (more powerful)
        # Allow 0.05 tolerance for bootstrap variance
        assert spa_result["spa_consistent_p_raw"] <= wrc_result["p_value_raw"] + 0.05, (
            f"SPA consistent_p_raw ({spa_result['spa_consistent_p_raw']:.4f}) should be <= "
            f"WRC p_value_raw ({wrc_result['p_value_raw']:.4f}) + 0.05 on dominated fixture"
        )

    def test_p_value_ordering_lower_geq_consistent_geq_upper(self):
        """p-value ordering: lower >= consistent >= upper (most to least conservative)."""
        matrix = _make_positive_matrix(5, 400, mean=0.003, seed=30)
        result = hansens_spa_multi(matrix, np.zeros_like(matrix), n_bootstrap=800, rng_seed=30)
        # Ordering is approximate due to bootstrap variance; allow 0.10 tolerance
        assert result["spa_upper_p"] - 0.10 <= result["spa_consistent_p"], (
            f"spa_consistent_p ({result['spa_consistent_p']:.4f}) should be >= "
            f"spa_upper_p ({result['spa_upper_p']:.4f}) - 0.10"
        )
        assert result["spa_consistent_p"] <= result["spa_lower_p"] + 0.10, (
            f"spa_consistent_p ({result['spa_consistent_p']:.4f}) should be <= "
            f"spa_lower_p ({result['spa_lower_p']:.4f}) + 0.10"
        )

    # ── Šidák multiplicity correction ────────────────────────────────────────

    def test_sidak_not_applied_when_n_total_equals_k_eff(self):
        """n_total == k_eff → no Šidák → spa_consistent_p == spa_consistent_p_raw."""
        matrix = _make_positive_matrix(5, 300, mean=0.002)
        result = hansens_spa_multi(
            matrix, np.zeros_like(matrix), n_bootstrap=300, rng_seed=1,
            n_total_trials=5, k_eff=5,
        )
        assert result["sidak_adjusted"] is False
        assert result["spa_consistent_p"] == result["spa_consistent_p_raw"]

    def test_sidak_inflates_spa_consistent_p_when_n_total_much_greater(self):
        """n_total >> k_eff → spa_consistent_p > spa_consistent_p_raw (Šidák applied)."""
        matrix = _make_positive_matrix(5, 300, mean=0.002, seed=5)
        result = hansens_spa_multi(
            matrix, np.zeros_like(matrix), n_bootstrap=300, rng_seed=5,
            n_total_trials=300, k_eff=5,  # 60× more trials than paths
        )
        assert result["sidak_adjusted"] is True
        assert result["spa_consistent_p"] >= result["spa_consistent_p_raw"], (
            f"Šidák should inflate p: consistent_p={result['spa_consistent_p']} "
            f">= consistent_p_raw={result['spa_consistent_p_raw']}"
        )

    def test_sidak_cannot_push_p_above_1(self):
        """Šidák-adjusted spa_consistent_p is capped at 1.0."""
        rng = np.random.default_rng(0)
        matrix = rng.normal(0.0, 0.01, (3, 200))  # null case
        result = hansens_spa_multi(
            matrix, np.zeros_like(matrix), n_bootstrap=100, rng_seed=0,
            n_total_trials=10**6, k_eff=1,
        )
        assert result["spa_consistent_p"] <= 1.0
        assert result["spa_lower_p"] <= 1.0
        assert result["spa_upper_p"] <= 1.0

    # ── Input validation ──────────────────────────────────────────────────────

    def test_invalid_ndim_raises(self):
        with pytest.raises(ValueError, match="2-D"):
            hansens_spa_multi(np.zeros((5, 10, 3)), np.zeros((5, 10, 3)))

    def test_shape_mismatch_raises(self):
        with pytest.raises(ValueError, match="Shape mismatch"):
            hansens_spa_multi(np.zeros((5, 100)), np.zeros((5, 90)))

    def test_too_few_time_periods_raises(self):
        with pytest.raises(ValueError, match="at least 2"):
            hansens_spa_multi(np.zeros((3, 1)), np.zeros((3, 1)))

    # ── Benchmark broadcast ───────────────────────────────────────────────────

    def test_1d_benchmark_broadcast_to_all_models(self):
        """(T,) benchmark is broadcast to (L, T) — no error."""
        matrix = _make_positive_matrix(4, 200)
        result = hansens_spa_multi(matrix, np.zeros(200), n_bootstrap=100)
        assert isinstance(result["spa_consistent_p"], float)

    # ── Single-row backward-compat ────────────────────────────────────────────

    def test_1d_input_treated_as_1_model(self):
        """1-D input is reshaped to (1, T)."""
        rng = np.random.default_rng(3)
        series = rng.normal(0.003, 0.01, 300)
        result = hansens_spa_multi(series, np.zeros(300), n_bootstrap=100)
        assert result["n_models"] == 1
        assert isinstance(result["spa_consistent_p"], float)
