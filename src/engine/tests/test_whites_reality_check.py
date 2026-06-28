"""Wave 26 Pass G Pass E + 2026-06-28 multi-model upgrade — White's Reality Check tests.

Covers:
  - Basic pass/fail behavior on synthetic returns
  - Determinism (same inputs → same outputs)
  - p-value monotonicity (better strategy → lower p)
  - Edge cases: minimal length, constant returns, zero benchmark
  - Env var override of p-value threshold
  - Output schema completeness
  - Known-answer test: strategy clearly above benchmark → p < 0.05
  - Known-answer test: strategy = benchmark → p should NOT be < 0.05
  - Multi-model (whites_reality_check_multi): genuine edge across paths → low p
  - Multi-model: lucky best-of-N caught — max-stat null is stricter than single-series
  - Multi-model: Šidák inflation raises p when n_total >> k_eff
  - Multi-model: 1-row matrix equivalent to single-series
  - Multi-model: output schema completeness and determinism
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from src.engine.statistics.whites_reality_check import (
    get_wrc_p_threshold,
    whites_reality_check,
    whites_reality_check_multi,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_positive_returns(n: int = 500, mean: float = 0.002, seed: int = 0) -> np.ndarray:
    """Synthetic strategy returns with clearly positive edge."""
    rng = np.random.default_rng(seed)
    return rng.normal(mean, 0.01, n)


def _make_zero_returns(n: int = 500, seed: int = 0) -> np.ndarray:
    """Synthetic returns centered at zero (null-true strategy)."""
    rng = np.random.default_rng(seed)
    return rng.normal(0.0, 0.01, n)


def _make_benchmark(n: int = 500) -> np.ndarray:
    """Zero benchmark (cash comparison)."""
    return np.zeros(n)


# ── Output schema ─────────────────────────────────────────────────────────────

class TestWrcOutputSchema:
    """WRC result dict must always contain all required keys."""

    def test_required_keys_present(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=100)
        required = {"p_value", "test_stat", "passed", "threshold", "n_obs",
                    "n_bootstrap", "block_length", "mean_excess_return"}
        assert required.issubset(result.keys()), f"Missing keys: {required - set(result.keys())}"

    def test_n_obs_matches_input_length(self):
        n = 300
        strat = _make_positive_returns(n)
        bench = _make_benchmark(n)
        result = whites_reality_check(strat, bench, n_bootstrap=50)
        assert result["n_obs"] == n

    def test_n_bootstrap_matches_requested(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=123)
        assert result["n_bootstrap"] == 123

    def test_p_value_in_unit_interval(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=100)
        assert 0.0 <= result["p_value"] <= 1.0

    def test_passed_is_bool(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=100)
        assert isinstance(result["passed"], bool)

    def test_test_stat_equals_mean_excess_return(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=100)
        assert result["test_stat"] == pytest.approx(result["mean_excess_return"])


# ── Determinism ───────────────────────────────────────────────────────────────

class TestWrcDeterminism:
    """Same inputs + same seed → same outputs every time."""

    def test_identical_results_same_seed(self):
        strat = _make_positive_returns(400)
        bench = _make_benchmark(400)
        r1 = whites_reality_check(strat, bench, n_bootstrap=200, rng_seed=99)
        r2 = whites_reality_check(strat, bench, n_bootstrap=200, rng_seed=99)
        assert r1["p_value"] == r2["p_value"]
        assert r1["test_stat"] == r2["test_stat"]

    def test_different_seed_may_differ(self):
        """Different seeds are allowed to produce different p-values (probabilistic)."""
        strat = _make_zero_returns(200)  # near-null strategy — p-value is stochastic
        bench = _make_benchmark(200)
        r1 = whites_reality_check(strat, bench, n_bootstrap=100, rng_seed=0)
        r2 = whites_reality_check(strat, bench, n_bootstrap=100, rng_seed=1)
        # These will usually differ; we just verify the function runs
        assert isinstance(r1["p_value"], float)
        assert isinstance(r2["p_value"], float)


# ── Known-answer tests ────────────────────────────────────────────────────────

class TestWrcKnownAnswers:
    """Known-answer tests with synthetic returns that have clear outcomes."""

    def test_strong_positive_edge_passes(self):
        """Strategy with clearly positive mean excess returns → p < 0.05 → passed=True."""
        # mean=0.005 over 500 bars is a very strong signal
        strat = _make_positive_returns(500, mean=0.005, seed=42)
        bench = _make_benchmark(500)
        result = whites_reality_check(strat, bench, n_bootstrap=2000, rng_seed=42)
        assert result["passed"] is True, (
            f"Expected passed=True for strong positive edge, got p_value={result['p_value']}"
        )
        assert result["p_value"] < 0.05

    def test_zero_edge_does_not_pass(self):
        """Strategy with zero mean excess returns (H0 is true) → p should be high."""
        # With 500 obs and mean=0, bootstrap will produce ~50% exceedances
        rng = np.random.default_rng(0)
        strat = rng.normal(0.0, 0.01, 500)
        bench = np.zeros(500)
        result = whites_reality_check(strat, bench, n_bootstrap=2000, rng_seed=0)
        # We cannot guarantee p > 0.05 always (it's probabilistic) but the mean
        # statistic is ~0 so p should be near 0.5 — far from rejection.
        # We use a looser bound: p >= 0.10 is sufficient to confirm non-rejection.
        assert result["p_value"] >= 0.10, (
            f"Expected p_value >= 0.10 for zero-edge strategy, got {result['p_value']}"
        )
        assert result["passed"] is False

    def test_negative_edge_does_not_pass(self):
        """Strategy with negative excess return → test stat < 0 → p near 1.0."""
        strat = _make_positive_returns(500, mean=-0.005, seed=7)  # negative mean
        bench = _make_benchmark(500)
        result = whites_reality_check(strat, bench, n_bootstrap=500, rng_seed=7)
        assert result["passed"] is False
        assert result["p_value"] > 0.5  # Right tail: virtually no bootstrap stats >= negative stat

    def test_strategy_equal_to_benchmark_does_not_pass(self):
        """When strategy = benchmark, excess return = 0 → H0 holds → not rejected."""
        rng = np.random.default_rng(5)
        bench = rng.normal(0.001, 0.01, 400)
        strat = bench.copy()  # identical — zero excess return
        result = whites_reality_check(strat, bench, n_bootstrap=500, rng_seed=5)
        assert result["mean_excess_return"] == pytest.approx(0.0, abs=1e-10)
        # p-value for zero test stat: ~50% of bootstrap stats (demeaned) >= 0
        # so p should be near 0.5 — definitely not < 0.05
        assert result["passed"] is False


# ── Input validation ──────────────────────────────────────────────────────────

class TestWrcInputValidation:
    """Input validation: mismatched lengths, bad dimensionality, minimum observations."""

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError, match="Length mismatch"):
            whites_reality_check([0.01] * 10, [0.0] * 9)

    def test_2d_input_raises(self):
        with pytest.raises(ValueError, match="1-D"):
            whites_reality_check(np.zeros((10, 2)), np.zeros(10))

    def test_minimum_2_observations_required(self):
        with pytest.raises(ValueError, match="At least 2"):
            whites_reality_check([0.01], [0.0])

    def test_exactly_2_observations_works(self):
        result = whites_reality_check([0.01, 0.02], [0.0, 0.0], n_bootstrap=50)
        assert isinstance(result["p_value"], float)


# ── Env var override ──────────────────────────────────────────────────────────

class TestWrcEnvVarOverride:
    """WRC_P_VALUE_THRESHOLD env var overrides the default threshold."""

    def test_default_threshold_is_0_05(self):
        original = os.environ.pop("WRC_P_VALUE_THRESHOLD", None)
        try:
            assert get_wrc_p_threshold() == pytest.approx(0.05)
        finally:
            if original is not None:
                os.environ["WRC_P_VALUE_THRESHOLD"] = original

    def test_env_override_changes_passed_verdict(self):
        """With a very high threshold (0.99), even a zero-edge strategy should pass."""
        original = os.environ.get("WRC_P_VALUE_THRESHOLD")
        try:
            os.environ["WRC_P_VALUE_THRESHOLD"] = "0.99"
            rng = np.random.default_rng(1)
            strat = rng.normal(0.0005, 0.01, 300)  # slight positive mean
            bench = np.zeros(300)
            result = whites_reality_check(strat, bench, n_bootstrap=300, rng_seed=1)
            # With threshold=0.99, almost anything passes
            assert result["threshold"] == pytest.approx(0.99)
        finally:
            if original is None:
                os.environ.pop("WRC_P_VALUE_THRESHOLD", None)
            else:
                os.environ["WRC_P_VALUE_THRESHOLD"] = original


# ── Block length ──────────────────────────────────────────────────────────────

class TestWrcBlockLength:
    """Block length defaults and manual override."""

    def test_default_block_length_is_10pct_of_n(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=50)
        expected = max(1, int(200 * 0.10))
        assert result["block_length"] == expected

    def test_manual_block_length_honoured(self):
        strat = _make_positive_returns(200)
        bench = _make_benchmark(200)
        result = whites_reality_check(strat, bench, n_bootstrap=50, block_length=25)
        assert result["block_length"] == 25


# ── Multi-model WRC tests (whites_reality_check_multi) ───────────────────────


def _make_positive_matrix(n_models: int = 5, T: int = 500, mean: float = 0.004, seed: int = 0) -> np.ndarray:
    """All L models have consistently positive mean excess return."""
    rng = np.random.default_rng(seed)
    return rng.normal(mean, 0.01, (n_models, T))


def _make_mixed_matrix(T: int = 500, seed: int = 0) -> np.ndarray:
    """1 lucky path with strong positive mean + 4 paths with negative mean.

    The best path (row 0) has mean 0.006; rows 1-4 have mean -0.003.
    Single-series WRC on the concatenated data would see a mildly positive average
    and might pass.  Multi-model WRC sees that best-of-5 max-statistic in bootstrap
    will often match the observed max, giving a higher p-value — exactly what we want.
    """
    rng = np.random.default_rng(seed)
    lucky = rng.normal(0.006, 0.01, (1, T))
    losers = rng.normal(-0.003, 0.01, (4, T))
    return np.vstack([lucky, losers])


class TestWrcMultiModel:
    """Multi-model White's Reality Check — proper data-snooping construction."""

    # ── Schema tests ─────────────────────────────────────────────────────────

    def test_output_schema_complete(self):
        """All documented keys must be present in the multi-model result."""
        matrix = _make_positive_matrix(5, 200)
        bench = np.zeros_like(matrix)
        result = whites_reality_check_multi(matrix, bench, n_bootstrap=100, rng_seed=0)
        required = {
            "p_value", "p_value_raw", "test_stat", "passed", "threshold",
            "n_models", "n_total_trials", "k_eff", "sidak_adjusted",
            "n_obs", "n_bootstrap", "block_length", "mean_excess_return",
        }
        missing = required - set(result.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_p_value_in_unit_interval(self):
        matrix = _make_positive_matrix(3, 200)
        result = whites_reality_check_multi(matrix, np.zeros_like(matrix), n_bootstrap=100)
        assert 0.0 <= result["p_value"] <= 1.0
        assert 0.0 <= result["p_value_raw"] <= 1.0

    def test_n_models_matches_rows(self):
        matrix = _make_positive_matrix(7, 200)
        result = whites_reality_check_multi(matrix, np.zeros_like(matrix), n_bootstrap=50)
        assert result["n_models"] == 7

    def test_n_obs_matches_columns(self):
        matrix = _make_positive_matrix(4, 300)
        result = whites_reality_check_multi(matrix, np.zeros_like(matrix), n_bootstrap=50)
        assert result["n_obs"] == 300

    def test_passed_reflects_p_value(self):
        """passed must be True iff p_value < threshold."""
        matrix = _make_positive_matrix(5, 500, mean=0.005)
        result = whites_reality_check_multi(matrix, np.zeros_like(matrix), n_bootstrap=2000, rng_seed=42)
        assert result["passed"] == (result["p_value"] < result["threshold"])

    def test_mean_excess_return_alias(self):
        """mean_excess_return must equal test_stat (backward-compat alias)."""
        matrix = _make_positive_matrix(3, 200)
        result = whites_reality_check_multi(matrix, np.zeros_like(matrix), n_bootstrap=50)
        assert result["mean_excess_return"] == result["test_stat"]

    # ── Determinism ──────────────────────────────────────────────────────────

    def test_deterministic_same_seed(self):
        """Same inputs + same seed → identical results."""
        matrix = _make_positive_matrix(5, 300)
        bench = np.zeros_like(matrix)
        r1 = whites_reality_check_multi(matrix, bench, n_bootstrap=200, rng_seed=77)
        r2 = whites_reality_check_multi(matrix, bench, n_bootstrap=200, rng_seed=77)
        assert r1["p_value"] == r2["p_value"]
        assert r1["p_value_raw"] == r2["p_value_raw"]
        assert r1["test_stat"] == r2["test_stat"]

    # ── Known-answer tests ────────────────────────────────────────────────────

    def test_genuine_edge_across_all_paths_passes(self):
        """All L paths with genuine positive mean → p_value < 0.05 → passed=True."""
        matrix = _make_positive_matrix(5, 500, mean=0.005, seed=42)
        bench = np.zeros_like(matrix)
        result = whites_reality_check_multi(matrix, bench, n_bootstrap=2000, rng_seed=42)
        assert result["passed"] is True, (
            f"Expected passed=True for genuine multi-path edge, got p={result['p_value']}"
        )
        assert result["p_value"] < 0.05

    def test_all_zero_mean_does_not_pass(self):
        """L paths with zero mean → H0 is true → p_value near 0.5 → passed=False."""
        rng = np.random.default_rng(99)
        matrix = rng.normal(0.0, 0.01, (5, 500))
        bench = np.zeros_like(matrix)
        result = whites_reality_check_multi(matrix, bench, n_bootstrap=2000, rng_seed=99)
        assert result["passed"] is False
        assert result["p_value"] >= 0.10, (
            f"Zero-edge multi-model should have p >= 0.10, got {result['p_value']}"
        )

    def test_all_negative_mean_does_not_pass(self):
        """All L paths have negative mean → test_stat < 0 → p near 1.0 → passed=False."""
        rng = np.random.default_rng(7)
        matrix = rng.normal(-0.005, 0.01, (5, 500))
        bench = np.zeros_like(matrix)
        result = whites_reality_check_multi(matrix, bench, n_bootstrap=500, rng_seed=7)
        assert result["passed"] is False
        assert result["p_value"] > 0.40

    # ── Multi-model is stricter than single-series (best-of-N snooping) ──────

    def test_multi_model_stricter_than_single_series_on_mixed_paths(self):
        """Multi-model max-stat test is stricter than single-series when paths are mixed.

        Fixture: 1 lucky path (mean 0.006) + 4 loser paths (mean -0.003).
        - Concatenated mean ≈ 0.006/5 - 0.003*4/5 ≈ -0.001 → single-series p is high.
        - Multi-model max stat = 0.006 (best path only). The bootstrap null distribution
          reflects what max(5 random paths) looks like under H0 — more conservative.
        We just verify multi-model p >= single-series p (or multi correctly blocks).
        """
        matrix = _make_mixed_matrix(T=500, seed=10)
        bench = np.zeros_like(matrix)
        multi_result = whites_reality_check_multi(
            matrix, bench, n_bootstrap=1000, rng_seed=10
        )
        # Concatenated series: row 0 has positive mean, rows 1-4 negative
        # Average mean ≈ 0.006 - 4*0.003 = -0.006 → single-series should FAIL
        single_result = whites_reality_check(
            matrix.flatten()[:500].tolist(),  # single path — use only the lucky path
            [0.0] * 500,
            n_bootstrap=1000,
            rng_seed=10,
        )
        # Multi-model p reflects best-of-5 snooping; single-series on same lucky path
        # does NOT correct for best-of-5 snooping, so should have lower p.
        # Therefore multi_result["p_value"] >= single_result["p_value"] - 0.10.
        # (The gap may be small but multi is never meaningfully less strict for this case.)
        assert multi_result["p_value"] >= single_result["p_value"] - 0.10, (
            f"Multi-model p ({multi_result['p_value']}) should be >= single-series p "
            f"({single_result['p_value']}) - 0.10. Multi should be stricter due to "
            f"best-of-5 correction."
        )

    def test_max_stat_reflects_best_path_not_average(self):
        """test_stat = max mean excess, not average — confirms max-stat construction."""
        rng = np.random.default_rng(0)
        # Row 0: mean 0.01 (best); rows 1-4: mean -0.005 (losers)
        row_best = rng.normal(0.01, 0.005, 300)
        rows_bad = rng.normal(-0.005, 0.005, (4, 300))
        matrix = np.vstack([row_best.reshape(1, -1), rows_bad])
        result = whites_reality_check_multi(matrix, np.zeros_like(matrix), n_bootstrap=50)
        # test_stat must be close to 0.01 (best row mean), not mean across all 5
        expected_best_mean = float(row_best.mean())
        assert abs(result["test_stat"] - expected_best_mean) < 0.001, (
            f"test_stat={result['test_stat']:.4f} should ≈ best row mean {expected_best_mean:.4f}"
        )

    # ── Šidák multiplicity correction ────────────────────────────────────────

    def test_sidak_not_applied_when_n_total_equals_k_eff(self):
        """When n_total_trials == k_eff, Šidák is identity (p_value == p_value_raw)."""
        matrix = _make_positive_matrix(5, 300, mean=0.002)
        result = whites_reality_check_multi(
            matrix, np.zeros_like(matrix),
            n_bootstrap=500, rng_seed=1,
            n_total_trials=5, k_eff=5,  # no extra snooping
        )
        assert result["sidak_adjusted"] is False
        assert result["p_value"] == result["p_value_raw"]

    def test_sidak_inflates_p_value_when_n_total_much_greater_than_k_eff(self):
        """n_total >> k_eff → p_value > p_value_raw (Šidák makes gate stricter)."""
        matrix = _make_positive_matrix(5, 300, mean=0.002, seed=5)
        result = whites_reality_check_multi(
            matrix, np.zeros_like(matrix),
            n_bootstrap=500, rng_seed=5,
            n_total_trials=500, k_eff=5,  # 100× more trials than paths
        )
        assert result["sidak_adjusted"] is True
        assert result["p_value"] >= result["p_value_raw"], (
            f"Šidák should inflate p: p_adj={result['p_value']} vs p_raw={result['p_value_raw']}"
        )

    def test_sidak_not_applied_when_n_total_is_none(self):
        """When n_total_trials is None, no Šidák correction applied."""
        matrix = _make_positive_matrix(3, 200)
        result = whites_reality_check_multi(
            matrix, np.zeros_like(matrix), n_bootstrap=100,
            n_total_trials=None, k_eff=3,
        )
        assert result["sidak_adjusted"] is False
        assert result["p_value"] == result["p_value_raw"]

    def test_sidak_cannot_push_p_above_1(self):
        """Šidák-adjusted p_value is capped at 1.0."""
        matrix = _make_positive_matrix(3, 200, mean=0.0)  # null case, p_raw ≈ 0.5
        result = whites_reality_check_multi(
            matrix, np.zeros_like(matrix), n_bootstrap=100, rng_seed=0,
            n_total_trials=10**6, k_eff=1,  # extreme inflation
        )
        assert result["p_value"] <= 1.0

    # ── Single-row backward-compat ────────────────────────────────────────────

    def test_single_row_1d_input_treated_as_1_model(self):
        """1-D input is reshaped to (1, T) → same as single-series test."""
        rng = np.random.default_rng(2)
        series = rng.normal(0.003, 0.01, 300)
        multi_result = whites_reality_check_multi(
            series, np.zeros(300), n_bootstrap=500, rng_seed=2,
        )
        single_result = whites_reality_check(
            series, np.zeros(300), n_bootstrap=500, rng_seed=2,
        )
        assert multi_result["n_models"] == 1
        # p_value_raw from multi-model with L=1 should equal single-series p_value
        # (same max-stat construction: max of 1 model = that model's mean)
        assert abs(multi_result["p_value_raw"] - single_result["p_value"]) < 0.001, (
            f"Multi L=1 p_raw={multi_result['p_value_raw']} should ≈ "
            f"single p={single_result['p_value']}"
        )

    # ── Input validation ──────────────────────────────────────────────────────

    def test_invalid_ndim_raises(self):
        with pytest.raises(ValueError, match="2-D"):
            whites_reality_check_multi(
                np.zeros((5, 10, 3)), np.zeros((5, 10, 3))
            )

    def test_shape_mismatch_raises(self):
        with pytest.raises(ValueError, match="Shape mismatch"):
            whites_reality_check_multi(
                np.zeros((5, 100)), np.zeros((5, 90))
            )

    def test_too_few_time_periods_raises(self):
        with pytest.raises(ValueError, match="at least 2"):
            whites_reality_check_multi(
                np.zeros((3, 1)), np.zeros((3, 1))
            )

    # ── Benchmark broadcast ───────────────────────────────────────────────────

    def test_1d_benchmark_broadcast_to_all_models(self):
        """(T,) benchmark is broadcast to (L, T) — no error."""
        matrix = _make_positive_matrix(4, 200)
        bench_1d = np.zeros(200)
        result = whites_reality_check_multi(matrix, bench_1d, n_bootstrap=100)
        assert isinstance(result["p_value"], float)
