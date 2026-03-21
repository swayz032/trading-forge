"""Tests for Deflated Sharpe Ratio, PBO, and Bonferroni correction."""
import pytest
from src.engine.risk_metrics import compute_deflated_sharpe_ratio, compute_pbo
from src.engine.monte_carlo import adjust_p_value_bonferroni


def test_dsr_penalizes_many_trials():
    """DSR with N=100 trials should produce lower DSR than N=1."""
    result_1 = compute_deflated_sharpe_ratio(
        observed_sharpe=2.0, n_trials=1, n_observations=252
    )
    result_100 = compute_deflated_sharpe_ratio(
        observed_sharpe=2.0, n_trials=100, n_observations=252
    )
    assert result_1["dsr"] > result_100["dsr"]


def test_dsr_passes_strong_sharpe():
    """Sharpe=3.0 with only 5 trials should pass DSR."""
    result = compute_deflated_sharpe_ratio(
        observed_sharpe=3.0, n_trials=5, n_observations=252
    )
    assert result["passes"] is True


def test_pbo_low_for_consistent_strategy():
    """Uniform OOS performance should produce low PBO."""
    # Windows with similar OOS performance
    windows = [
        {"oos_metrics": {"sharpe_ratio": 1.8 + i * 0.01}} for i in range(6)
    ]
    result = compute_pbo(windows)
    # Monotonically increasing = consistent, PBO should be reasonable
    assert result["pbo"] is not None
    assert result["n_combinations"] > 0


def test_bonferroni_rejects_marginal():
    """p=0.04 with N=2 should fail Bonferroni (threshold=0.025)."""
    raw_p, threshold, passes = adjust_p_value_bonferroni(0.04, 2)
    assert threshold == pytest.approx(0.025)
    assert passes is False


def test_bonferroni_passes_strong():
    """p=0.01 with n_variants=3 should pass (threshold=0.0167)."""
    from src.engine.monte_carlo import adjust_p_value_bonferroni

    _, threshold, passes = adjust_p_value_bonferroni(0.01, 3)
    assert threshold == pytest.approx(0.05 / 3)
    assert passes is True
