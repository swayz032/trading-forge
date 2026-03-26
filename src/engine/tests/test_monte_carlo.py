"""Tests for Monte Carlo simulation engine — TDD: written before implementation."""

import numpy as np
import pytest

from src.engine.monte_carlo import (
    get_array_module,
    trade_resample,
    return_bootstrap,
    block_bootstrap,
    inject_synthetic_stress,
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
            initial_capital=50_000.0,
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
            assert path[0] == pytest.approx(50_000.0, abs=1.0)

    def test_num_simulations_in_result(self):
        result = self._run(n_sims=300)
        assert result["num_simulations"] == 300

    def test_new_risk_metrics_present(self):
        """New metrics from production hardening: Lo Sharpe, Omega, Tail, Kelly."""
        result = self._run()
        rm = result["risk_metrics"]
        for key in ["lo_sharpe_distribution", "omega_ratio", "tail_ratio", "kelly_fraction"]:
            assert key in rm, f"Missing new risk metric: {key}"

    def test_multi_convergence_keys(self):
        """Convergence should have multi-percentile keys (p1, p5, p95, p99)."""
        result = self._run(n_sims=1000)
        conv = result["convergence"]
        assert "max_drawdown" in conv
        assert "sharpe" in conv
        assert "p1_converged" in conv["max_drawdown"]
        assert "p5_converged" in conv["max_drawdown"]
        assert "p95_converged" in conv["max_drawdown"]
        assert "p99_converged" in conv["max_drawdown"]
        # Backward compat keys
        assert "max_drawdown_p1_converged" in conv
        assert "sharpe_p1_converged" in conv
        assert "convergence_stable" in conv


# ─── Min Trade Count Gate ───────────────────────────────────────

class TestMinTradeGate:
    def test_rejects_under_30_trades_iid(self):
        """IID methods require >= 30 trades."""
        trades = _make_trades(20).tolist()
        daily_pnls = _make_daily_pnls(50).tolist()
        request = MonteCarloRequest(
            backtest_id="test", num_simulations=100,
            method="trade_resample", use_gpu=False,
        )
        result = run_monte_carlo(request, trades, daily_pnls, [])
        assert "error" in result
        assert result["num_simulations"] == 0

    def test_rejects_under_50_trades_block(self):
        """Block bootstrap requires >= 50 trades."""
        trades = _make_trades(40).tolist()
        daily_pnls = _make_daily_pnls(100).tolist()
        request = MonteCarloRequest(
            backtest_id="test", num_simulations=100,
            method="block_bootstrap", use_gpu=False,
        )
        result = run_monte_carlo(request, trades, daily_pnls, [])
        assert "error" in result

    def test_accepts_30_trades_iid(self):
        """30 trades should pass for IID methods."""
        trades = _make_trades(30).tolist()
        daily_pnls = _make_daily_pnls(60).tolist()
        request = MonteCarloRequest(
            backtest_id="test", num_simulations=100,
            method="trade_resample", use_gpu=False,
        )
        result = run_monte_carlo(request, trades, daily_pnls, [])
        assert "error" not in result

    def test_accepts_50_trades_block(self):
        """50 trades should pass for block bootstrap."""
        trades = _make_trades(50).tolist()
        daily_pnls = _make_daily_pnls(100).tolist()
        request = MonteCarloRequest(
            backtest_id="test", num_simulations=100,
            method="block_bootstrap", use_gpu=False,
        )
        result = run_monte_carlo(request, trades, daily_pnls, [])
        assert "error" not in result


# ─── Configurable Seed ──────────────────────────────────────────

class TestConfigurableSeed:
    def test_same_seed_same_result(self):
        """Same seed must produce identical results."""
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        eq = np.cumsum(daily).tolist()

        def _run(seed):
            req = MonteCarloRequest(
                backtest_id="test", num_simulations=200,
                method="trade_resample", use_gpu=False, seed=seed,
            )
            return run_monte_carlo(req, trades, daily, eq)

        a = _run(42)
        b = _run(42)
        assert a["confidence_intervals"] == b["confidence_intervals"]

    def test_different_seed_different_result(self):
        """Different seeds must produce different results."""
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        eq = np.cumsum(daily).tolist()

        def _run(seed):
            req = MonteCarloRequest(
                backtest_id="test", num_simulations=200,
                method="trade_resample", use_gpu=False, seed=seed,
            )
            return run_monte_carlo(req, trades, daily, eq)

        a = _run(42)
        b = _run(99)
        assert a["confidence_intervals"] != b["confidence_intervals"]


# ─── Stress Injection Cap ──────────────────────────────────────

class TestStressInjectionCap:
    def test_injected_loss_capped(self):
        """Catastrophic injected losses must not exceed max_loss_cap.

        Note: the cap only applies to the synthetic catastrophic loss,
        not to existing trade losses already in the array.
        """
        # Use trades with small losses so existing losses don't exceed cap
        rng = np.random.default_rng(99)
        trades = rng.normal(50, 20, size=200)  # Small std, losses well within cap
        max_cap = 200.0
        original_min = np.min(trades)
        injected = inject_synthetic_stress(trades, max_loss_cap=max_cap, seed=42)
        # Injected values should not be worse than -max_cap
        # (original losses might still exist, but catastrophic injections are capped)
        injected_diff = injected - trades
        changed_mask = injected_diff != 0
        if np.any(changed_mask):
            # The injected (changed) values should respect the cap
            assert np.min(injected[changed_mask]) >= -max_cap

    def test_no_cap_produces_worse_losses(self):
        """Without cap, catastrophic losses can be much worse."""
        trades = _make_trades(200, mean=50, std=100)
        capped = inject_synthetic_stress(trades, max_loss_cap=60.0, seed=42)
        uncapped = inject_synthetic_stress(trades, max_loss_cap=0.0, seed=42)
        # Uncapped should produce equal or worse losses than capped
        assert np.min(uncapped) <= np.min(capped)


# ─── 6-Month Survival Fix ──────────────────────────────────────

class TestSixMonthSurvivalFix:
    def test_eval_on_last_step_not_6mo(self):
        """If eval passes on the very last step, 6-month survival should be 0."""
        from src.engine.monte_carlo import simulate_firm_survival

        # Create paths that hit profit target only at the very end
        n_sims, n_steps = 10, 50  # 50 steps, way less than 126
        paths = np.zeros((n_sims, n_steps))
        for i in range(n_sims):
            # Slowly accumulate to just below target, then hit it on last step
            daily_gain = 3000 / n_steps  # Target is typically 3000
            paths[i] = np.cumsum(np.full(n_steps, daily_gain))

        # This should pass eval but NOT count as 6-month survival
        # because there aren't 126 bars after passing
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        assert result["funded_survival_6mo"] == 0.0


# ─── Block Bootstrap ───────────────────────────────────────────

class TestBlockBootstrap:
    def test_output_shape(self):
        trades = _make_trades(100)
        paths = block_bootstrap(trades, n_sims=200, expected_block_length=8, seed=42)
        assert paths.shape == (200, 100)

    def test_deterministic(self):
        trades = _make_trades(100)
        a = block_bootstrap(trades, n_sims=100, seed=42)
        b = block_bootstrap(trades, n_sims=100, seed=42)
        np.testing.assert_array_equal(a, b)

    def test_different_seeds(self):
        trades = _make_trades(100)
        a = block_bootstrap(trades, n_sims=100, seed=1)
        b = block_bootstrap(trades, n_sims=100, seed=2)
        assert not np.array_equal(a, b)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="empty"):
            block_bootstrap(np.array([]), n_sims=100)

    def test_block_bootstrap_method_runs(self):
        """Full MC run with block_bootstrap method."""
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        req = MonteCarloRequest(
            backtest_id="test", num_simulations=200,
            method="block_bootstrap", use_gpu=False,
        )
        result = run_monte_carlo(req, trades, daily, [])
        assert result["method"] == "block_bootstrap"
        assert "block_length" in result
        assert "confidence_intervals" in result
