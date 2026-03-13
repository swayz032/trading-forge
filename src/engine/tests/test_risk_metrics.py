"""Tests for risk metrics module — TDD: written before implementation."""

import numpy as np
import pytest

from src.engine.risk_metrics import (
    compute_max_drawdown_distribution,
    compute_probability_of_ruin,
    compute_sharpe_distribution,
    compute_calmar_ratio,
    compute_ulcer_index,
    compute_time_to_recovery,
    compute_var,
    compute_cvar,
    compute_all_risk_metrics,
)


# ─── Helpers ──────────────────────────────────────────────────────

def _profitable_paths(n_sims: int = 100, n_days: int = 250, seed: int = 42) -> np.ndarray:
    """Generate upward-trending equity paths (cumulative P&L, no initial capital)."""
    rng = np.random.default_rng(seed)
    daily = rng.normal(250, 300, size=(n_sims, n_days))
    return np.cumsum(daily, axis=1)


def _losing_paths(n_sims: int = 100, n_days: int = 250, seed: int = 42) -> np.ndarray:
    """Generate downward-trending equity paths."""
    rng = np.random.default_rng(seed)
    daily = rng.normal(-200, 100, size=(n_sims, n_days))
    return np.cumsum(daily, axis=1)


def _monotonic_paths(n_sims: int = 10, n_days: int = 100) -> np.ndarray:
    """Generate perfectly monotonically increasing paths."""
    daily = np.full((n_sims, n_days), 100.0)
    return np.cumsum(daily, axis=1)


PERCENTILES = [0.05, 0.25, 0.50, 0.75, 0.95]


# ─── Max Drawdown Distribution ───────────────────────────────────

class TestMaxDrawdownDistribution:
    def test_drawdowns_non_negative(self):
        paths = _profitable_paths()
        result = compute_max_drawdown_distribution(paths, 100_000.0, PERCENTILES)
        for key, val in result.items():
            assert val >= 0, f"{key} should be non-negative, got {val}"

    def test_percentiles_ordered(self):
        paths = _profitable_paths(n_sims=500)
        result = compute_max_drawdown_distribution(paths, 100_000.0, PERCENTILES)
        assert result["p5"] <= result["p25"] <= result["p50"] <= result["p75"] <= result["p95"]

    def test_monotonic_paths_zero_drawdown(self):
        paths = _monotonic_paths()
        result = compute_max_drawdown_distribution(paths, 100_000.0, PERCENTILES)
        assert result["p50"] == pytest.approx(0.0, abs=0.01)


# ─── Probability of Ruin ─────────────────────────────────────────

class TestProbabilityOfRuin:
    def test_range_zero_to_one(self):
        paths = _profitable_paths()
        ruin = compute_probability_of_ruin(paths, ruin_threshold=0.0, initial_capital=100_000.0)
        assert 0.0 <= ruin <= 1.0

    def test_zero_for_profitable(self):
        """All-profitable monotonic paths should have 0% ruin."""
        paths = _monotonic_paths()
        ruin = compute_probability_of_ruin(paths, ruin_threshold=0.0, initial_capital=100_000.0)
        assert ruin == 0.0

    def test_high_for_losing(self):
        """Losing paths with tight ruin threshold should have high ruin probability."""
        paths = _losing_paths(n_sims=200)
        ruin = compute_probability_of_ruin(paths, ruin_threshold=0.0, initial_capital=50_000.0)
        assert ruin > 0.5


# ─── Sharpe Distribution ─────────────────────────────────────────

class TestSharpeDistribution:
    def test_percentiles_ordered(self):
        paths = _profitable_paths(n_sims=500)
        result = compute_sharpe_distribution(paths, PERCENTILES)
        assert result["p5"] <= result["p25"] <= result["p50"] <= result["p75"] <= result["p95"]

    def test_profitable_has_positive_median(self):
        paths = _profitable_paths()
        result = compute_sharpe_distribution(paths, PERCENTILES)
        assert result["p50"] > 0


# ─── Calmar Ratio ────────────────────────────────────────────────

class TestCalmarRatio:
    def test_positive_for_profitable(self):
        paths = _profitable_paths()
        result = compute_calmar_ratio(paths, 100_000.0)
        assert result["median"] > 0

    def test_returns_percentiles(self):
        paths = _profitable_paths()
        result = compute_calmar_ratio(paths, 100_000.0)
        assert "median" in result
        assert "p5" in result
        assert "p95" in result


# ─── Ulcer Index ──────────────────────────────────────────────────

class TestUlcerIndex:
    def test_zero_for_monotonic(self):
        paths = _monotonic_paths()
        result = compute_ulcer_index(paths, 100_000.0)
        assert result["median"] == pytest.approx(0.0, abs=0.01)

    def test_positive_for_volatile(self):
        paths = _profitable_paths()
        result = compute_ulcer_index(paths, 100_000.0)
        assert result["median"] >= 0


# ─── Time to Recovery ────────────────────────────────────────────

class TestTimeToRecovery:
    def test_non_negative(self):
        paths = _profitable_paths()
        result = compute_time_to_recovery(paths, 100_000.0)
        assert result["median"] >= 0

    def test_zero_for_monotonic(self):
        paths = _monotonic_paths()
        result = compute_time_to_recovery(paths, 100_000.0)
        assert result["median"] == 0


# ─── VaR ──────────────────────────────────────────────────────────

class TestVaR:
    def test_var95_less_severe_than_var99(self):
        paths = _profitable_paths(n_sims=500)
        result = compute_var(paths)
        # VaR99 should be a larger (worse) loss than VaR95
        assert result["var_99"] >= result["var_95"]

    def test_returns_both_levels(self):
        paths = _profitable_paths()
        result = compute_var(paths)
        assert "var_95" in result
        assert "var_99" in result


# ─── CVaR ─────────────────────────────────────────────────────────

class TestCVaR:
    def test_cvar_worse_than_var(self):
        """CVaR (Expected Shortfall) should be >= VaR (more severe)."""
        paths = _profitable_paths(n_sims=1000)
        var_result = compute_var(paths)
        cvar_result = compute_cvar(paths)
        assert cvar_result["cvar_95"] >= var_result["var_95"]
        assert cvar_result["cvar_99"] >= var_result["var_99"]

    def test_returns_both_levels(self):
        paths = _profitable_paths()
        result = compute_cvar(paths)
        assert "cvar_95" in result
        assert "cvar_99" in result


# ─── Compute All ──────────────────────────────────────────────────

class TestComputeAll:
    def test_all_keys_present(self):
        paths = _profitable_paths()
        result = compute_all_risk_metrics(paths, 100_000.0, 0.0)
        expected = [
            "probability_of_ruin", "var_95", "var_99",
            "cvar_95", "cvar_99", "calmar_ratio", "ulcer_index",
            "time_to_recovery", "max_drawdown_distribution",
            "sharpe_distribution",
        ]
        for key in expected:
            assert key in result, f"Missing key: {key}"

    def test_returns_dict(self):
        paths = _profitable_paths()
        result = compute_all_risk_metrics(paths, 100_000.0, 0.0)
        assert isinstance(result, dict)
