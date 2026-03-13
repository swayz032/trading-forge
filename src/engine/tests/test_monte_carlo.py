"""Tests for Monte Carlo simulation engine — TDD: written before implementation."""

import numpy as np
import pytest

from src.engine.monte_carlo import (
    get_array_module,
    trade_resample,
    return_bootstrap,
    run_monte_carlo,
)
from src.engine.config import MonteCarloRequest


# ─── Helpers ──────────────────────────────────────────────────────

def _make_trades(n: int = 100, mean: float = 75.0, std: float = 200.0, seed: int = 42) -> np.ndarray:
    """Synthetic trade P&Ls for testing."""
    rng = np.random.default_rng(seed)
    return rng.normal(mean, std, size=n)


def _make_daily_pnls(n: int = 250, mean: float = 250.0, std: float = 400.0, seed: int = 42) -> np.ndarray:
    """Synthetic daily P&Ls for testing."""
    rng = np.random.default_rng(seed)
    return rng.normal(mean, std, size=n)


# ─── GPU Fallback ─────────────────────────────────────────────────

class TestGetArrayModule:
    def test_cpu_fallback(self):
        xp = get_array_module(use_gpu=False)
        assert xp is np

    def test_gpu_request_returns_module(self):
        """When GPU requested, returns either cupy or numpy (no crash)."""
        xp = get_array_module(use_gpu=True)
        # Must be a module with array creation capabilities
        assert hasattr(xp, "array")
        assert hasattr(xp, "cumsum")


# ─── Trade Resampling ────────────────────────────────────────────

class TestTradeResample:
    def test_output_shape(self):
        trades = _make_trades(100)
        paths = trade_resample(trades, n_sims=500, seed=42)
        assert paths.shape == (500, 100)

    def test_deterministic_with_seed(self):
        trades = _make_trades(50)
        a = trade_resample(trades, n_sims=100, seed=123)
        b = trade_resample(trades, n_sims=100, seed=123)
        np.testing.assert_array_equal(a, b)

    def test_different_seeds_differ(self):
        trades = _make_trades(50)
        a = trade_resample(trades, n_sims=100, seed=1)
        b = trade_resample(trades, n_sims=100, seed=2)
        assert not np.array_equal(a, b)

    def test_paths_are_cumulative(self):
        """Each path should be cumsum of resampled trades."""
        trades = _make_trades(20)
        paths = trade_resample(trades, n_sims=10, seed=42)
        # Last value of each path should be sum of that path's trades
        # Since paths are cumsum, the final column is the total P&L
        assert paths.shape[1] == 20
        # All paths should have monotonic-ish behavior (cumsum property)
        # Just verify it's not all zeros
        assert np.any(paths != 0)

    def test_empty_trades_raises(self):
        with pytest.raises(ValueError, match="empty"):
            trade_resample(np.array([]), n_sims=100, seed=42)


# ─── Return Bootstrapping ────────────────────────────────────────

class TestReturnBootstrap:
    def test_output_shape(self):
        daily = _make_daily_pnls(250)
        paths = return_bootstrap(daily, n_sims=500, n_days=250, seed=42)
        assert paths.shape == (500, 250)

    def test_deterministic_with_seed(self):
        daily = _make_daily_pnls(100)
        a = return_bootstrap(daily, n_sims=50, n_days=200, seed=99)
        b = return_bootstrap(daily, n_sims=50, n_days=200, seed=99)
        np.testing.assert_array_equal(a, b)

    def test_custom_n_days(self):
        """Can simulate more days than original data."""
        daily = _make_daily_pnls(50)
        paths = return_bootstrap(daily, n_sims=100, n_days=500, seed=42)
        assert paths.shape == (100, 500)

    def test_empty_returns_raises(self):
        with pytest.raises(ValueError, match="empty"):
            return_bootstrap(np.array([]), n_sims=100, n_days=250, seed=42)


# ─── Full Monte Carlo Run ────────────────────────────────────────

class TestRunMonteCarlo:
    def _run(self, method="both", n_sims=500) -> dict:
        trades = _make_trades(80).tolist()
        daily_pnls = _make_daily_pnls(200).tolist()
        equity_curve = np.cumsum(daily_pnls).tolist()
        request = MonteCarloRequest(
            backtest_id="test-123",
            num_simulations=n_sims,
            method=method,
            use_gpu=False,
            max_paths_to_store=20,
            initial_capital=100_000.0,
        )
        return run_monte_carlo(request, trades, daily_pnls, equity_curve)

    def test_trade_resample_method(self):
        result = self._run(method="trade_resample")
        assert result["method"] == "trade_resample"
        assert "confidence_intervals" in result
        assert "risk_metrics" in result

    def test_return_bootstrap_method(self):
        result = self._run(method="return_bootstrap")
        assert result["method"] == "return_bootstrap"

    def test_both_method(self):
        result = self._run(method="both")
        assert result["method"] == "both"

    def test_confidence_intervals_present(self):
        result = self._run()
        ci = result["confidence_intervals"]
        assert "max_drawdown" in ci
        assert "sharpe_ratio" in ci

    def test_confidence_intervals_sorted(self):
        """p5 <= p25 <= p50 <= p75 <= p95 for drawdown."""
        result = self._run(n_sims=2000)
        dd = result["confidence_intervals"]["max_drawdown"]
        assert dd["p5"] <= dd["p25"] <= dd["p50"] <= dd["p75"] <= dd["p95"]

    def test_risk_metrics_complete(self):
        result = self._run()
        rm = result["risk_metrics"]
        expected_keys = [
            "probability_of_ruin", "var_95", "var_99",
            "cvar_95", "cvar_99", "calmar_ratio", "ulcer_index",
        ]
        for key in expected_keys:
            assert key in rm, f"Missing risk metric: {key}"

    def test_paths_count_capped(self):
        result = self._run(n_sims=500)
        assert len(result["paths"]) <= 20  # max_paths_to_store

    def test_execution_time_tracked(self):
        result = self._run()
        assert result["execution_time_ms"] >= 0

    def test_gpu_accelerated_flag(self):
        result = self._run()
        assert result["gpu_accelerated"] is False  # use_gpu=False

    def test_initial_capital_in_paths(self):
        """Equity paths should start from initial_capital."""
        result = self._run()
        for path in result["paths"]:
            assert path[0] == pytest.approx(100_000.0, abs=1.0)

    def test_num_simulations_in_result(self):
        result = self._run(n_sims=300)
        assert result["num_simulations"] == 300
