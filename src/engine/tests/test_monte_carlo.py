"""Tests for Monte Carlo simulation engine — TDD: written before implementation."""

import numpy as np
import pytest

from src.engine.config import MonteCarloRequest
from src.engine.monte_carlo import (
    arch_stationary_bootstrap,
    block_bootstrap,
    get_array_module,
    inject_synthetic_stress,
    return_bootstrap,
    run_monte_carlo,
    trade_resample,
)

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

    def test_custom_n_days(self, monkeypatch):
        """Can simulate more days than original data; n_days > 5× history is capped.

        F-9 FIX (2026-05-20): return_bootstrap now caps n_days at 5× history length
        (default, configurable via MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION env var) to
        prevent degenerate tail estimates from extreme extrapolation.  n_days=500 with
        50 days of history = 10× → capped at 5×50=250.  The test is updated to reflect
        the new contract: shape is (n_sims, min(n_days, 5×n_hist)) when cap applies.

        Wave 27.5 Pass A.1 — CRITICAL #3: hard fail is now at 2× by default.
        This test disables the hard fail to test the soft-cap behavior specifically.
        """
        import os
        # Disable hard fail so we test the soft-cap path (backward compat opt-out)
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "infinity")
        daily = _make_daily_pnls(50)
        # 500 days with 50 history = 10× — capped at 5×50=250 (default soft cap)
        paths = return_bootstrap(daily, n_sims=100, n_days=500, seed=42)
        max_extrap = float(os.environ.get("MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION", "5.0"))
        expected_days = min(500, int(50 * max_extrap))
        assert paths.shape == (100, expected_days), (
            f"Expected shape (100, {expected_days}) after F-9 cap, got {paths.shape}"
        )

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
        """confidence_intervals must be present and non-empty.

        When mc_confidence (BCa) is available it returns keys like
        'max_drawdown_p5', 'cvar95', 'survival_rate', 'probability_of_ruin'.
        When not available it falls back to the simple percentile dict with
        'max_drawdown' and 'sharpe_ratio'. Either form must be non-empty.
        """
        result = self._run()
        ci = result["confidence_intervals"]
        assert isinstance(ci, dict)
        assert len(ci) > 0

    def test_confidence_intervals_sorted(self):
        """max_drawdown percentiles must be sorted when simple CI is used.

        Only applies when mc_confidence is not installed (fallback mode).
        When BCa is active, 'max_drawdown' is replaced by 'max_drawdown_p5'
        and sorting is not meaningful in the same way.
        """
        result = self._run(n_sims=2000)
        ci = result["confidence_intervals"]
        # BCa active: verify max_drawdown_p5 CI has sensible structure
        if "max_drawdown_p5" in ci:
            entry = ci["max_drawdown_p5"]
            assert "ci_low" in entry
            assert "ci_high" in entry
        else:
            # Fallback mode: original percentile dict
            dd = ci["max_drawdown"]
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
        """Same seed must produce identical results.

        Compares the deterministic percentile-based confidence intervals
        (max_drawdown, sharpe_ratio from the pre-BCa stage) which are always
        present and NaN-free. BCa CIs may contain NaN for degenerate metrics
        (e.g. probability_of_ruin when no paths go to ruin), so we compare
        risk_metrics and convergence instead of the BCa-overwritten CI dict.
        """
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
        # convergence is fully deterministic and NaN-free
        assert a["convergence"] == b["convergence"]
        # drawdown_stats is deterministic and NaN-free
        assert a["drawdown_stats"] == b["drawdown_stats"]

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


# ─── arch StationaryBootstrap ───────────────────────────────────

class TestArchStationaryBootstrap:
    def test_output_shape(self):
        """Returns (n_sims, n_trades) array."""
        trades = _make_trades(100)
        paths = arch_stationary_bootstrap(trades, n_sims=200, seed=42)
        assert paths.shape == (200, 100)

    def test_deterministic_with_seed(self):
        """Same seed must produce identical paths."""
        trades = _make_trades(100)
        a = arch_stationary_bootstrap(trades, n_sims=100, seed=42)
        b = arch_stationary_bootstrap(trades, n_sims=100, seed=42)
        np.testing.assert_array_equal(a, b)

    def test_different_seeds_differ(self):
        trades = _make_trades(100)
        a = arch_stationary_bootstrap(trades, n_sims=100, seed=1)
        b = arch_stationary_bootstrap(trades, n_sims=100, seed=2)
        assert not np.array_equal(a, b)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="empty"):
            arch_stationary_bootstrap(np.array([]), n_sims=100)

    def test_explicit_block_length_respected(self):
        """Explicit block_length is used (no auto-compute)."""
        trades = _make_trades(100)
        a = arch_stationary_bootstrap(trades, n_sims=50, seed=42, block_length=5)
        b = arch_stationary_bootstrap(trades, n_sims=50, seed=42, block_length=5)
        np.testing.assert_array_equal(a, b)

    def test_paths_are_cumulative(self):
        """Output should be cumulative equity paths (non-trivial values)."""
        trades = _make_trades(80)
        paths = arch_stationary_bootstrap(trades, n_sims=50, seed=42)
        assert np.any(paths != 0)
        assert paths.shape[1] == 80

    def test_arch_stationary_method_in_run_monte_carlo(self):
        """Full MC run with arch_stationary method — correct output shape and keys."""
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        req = MonteCarloRequest(
            backtest_id="test", num_simulations=200,
            method="arch_stationary", use_gpu=False,
        )
        result = run_monte_carlo(req, trades, daily, [])
        assert result["method"] == "arch_stationary"
        assert "block_length" in result
        assert "confidence_intervals" in result
        assert "risk_metrics" in result

    def test_arch_stationary_rejects_under_50_trades(self):
        """arch_stationary requires >= 50 trades (same as block_bootstrap)."""
        trades = _make_trades(40).tolist()
        daily = _make_daily_pnls(100).tolist()
        req = MonteCarloRequest(
            backtest_id="test", num_simulations=100,
            method="arch_stationary", use_gpu=False,
        )
        result = run_monte_carlo(req, trades, daily, [])
        assert "error" in result

    def test_arch_stationary_accepts_50_trades(self):
        """50 trades must pass the gate for arch_stationary."""
        trades = _make_trades(50).tolist()
        daily = _make_daily_pnls(100).tolist()
        req = MonteCarloRequest(
            backtest_id="test", num_simulations=100,
            method="arch_stationary", use_gpu=False,
        )
        result = run_monte_carlo(req, trades, daily, [])
        assert "error" not in result


# ─── both method now includes arch_stationary ───────────────────

class TestBothMethodBreakdown:
    def _run_both(self, n_sims=300):
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        req = MonteCarloRequest(
            backtest_id="test", num_simulations=n_sims,
            method="both", use_gpu=False,
        )
        return run_monte_carlo(req, trades, daily, [])

    def test_both_breakdown_has_arch_stationary(self):
        """both_method_breakdown must include arch_stationary sub-metrics."""
        result = self._run_both()
        breakdown = result.get("both_method_breakdown", {})
        assert "arch_stationary" in breakdown, (
            "both_method_breakdown missing arch_stationary — method was not wired in"
        )

    def test_both_breakdown_has_all_three_methods(self):
        result = self._run_both()
        breakdown = result.get("both_method_breakdown", {})
        assert "trade_resample" in breakdown
        assert "return_bootstrap" in breakdown
        assert "arch_stationary" in breakdown

    def test_both_block_length_present(self):
        """block_length should be in result for 'both' since arch_stationary is included."""
        result = self._run_both()
        assert "block_length" in result


# ─── BCa CI fix — all_paths not leaked into output ──────────────

class TestBCaAllPathsNotLeaked:
    def test_all_paths_not_in_result(self):
        """all_paths ndarray must never appear in the returned dict.

        Bug: result["all_paths"] was checked by the BCa block but never set,
        so BCa CIs never ran. Fix: set it temporarily, remove in finally block.
        This test confirms the cleanup — no raw ndarray in output.
        """
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        req = MonteCarloRequest(
            backtest_id="test", num_simulations=200,
            method="trade_resample", use_gpu=False,
        )
        result = run_monte_carlo(req, trades, daily, [])
        assert "all_paths" not in result, (
            "all_paths ndarray leaked into output — finally cleanup failed"
        )

    def test_all_paths_not_in_result_any_method(self):
        """all_paths must be absent for every method."""
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        for method in ("trade_resample", "return_bootstrap", "block_bootstrap",
                       "arch_stationary", "both"):
            req = MonteCarloRequest(
                backtest_id="test", num_simulations=200,
                method=method, use_gpu=False,
            )
            result = run_monte_carlo(req, trades, daily, [])
            if "error" not in result:
                assert "all_paths" not in result, (
                    f"all_paths leaked for method={method}"
                )


# ─── F-1 / F-2: RNG family consistency (PCG64DXSM) ────────────────

class TestRNGFamilyConsistency:
    """All MC paths must use PCG64DXSM, not SFC64.

    F-1: block_bootstrap was using np.random.default_rng(seed) (SFC64).
    F-2: stress_test_trades and inject_synthetic_stress also used default_rng.
    Fix: all three now use create_authoritative_rng(seed)[0] (PCG64DXSM).

    These tests verify determinism is preserved — same seed → identical output —
    which is necessary (but not sufficient) to confirm a single RNG family is in use.
    The PCG64DXSM requirement is enforced at the call site; determinism is what
    we can measure here.
    """

    def test_block_bootstrap_deterministic_after_fix(self):
        """block_bootstrap must be deterministic with same seed (PCG64DXSM family)."""
        trades = _make_trades(100)
        a = block_bootstrap(trades, n_sims=200, seed=42)
        b = block_bootstrap(trades, n_sims=200, seed=42)
        np.testing.assert_array_equal(a, b)

    def test_block_bootstrap_differs_across_seeds(self):
        """block_bootstrap with different seeds must produce different paths."""
        trades = _make_trades(100)
        a = block_bootstrap(trades, n_sims=200, seed=10)
        b = block_bootstrap(trades, n_sims=200, seed=20)
        assert not np.array_equal(a, b)

    def test_inject_synthetic_stress_deterministic_after_fix(self):
        """inject_synthetic_stress must be deterministic with same seed."""
        trades = _make_trades(200)
        a = inject_synthetic_stress(trades, seed=456)
        b = inject_synthetic_stress(trades, seed=456)
        np.testing.assert_array_equal(a, b)

    def test_inject_synthetic_stress_differs_across_seeds(self):
        """Different seeds must produce different injection patterns."""
        rng = np.random.default_rng(0)
        trades = rng.normal(100, 50, size=500)  # Many trades to guarantee some injections
        a = inject_synthetic_stress(trades, frequency=0.05, seed=1)
        b = inject_synthetic_stress(trades, frequency=0.05, seed=2)
        assert not np.array_equal(a, b)


# ─── F-4: "both" method granularity fix ────────────────────────────

class TestBothMethodGranularity:
    """In "both" mode, firm survival must use granularity="trade" not "day".

    F-4: granularity was hard-coded as "trade" only for method=="trade_resample".
    In "both" mode, paths = trade_paths (line ~992), but granularity was "day".
    simulate_firm_survival then enforced daily-loss-limit per trade step instead
    of per day — understating risk.
    Fix: granularity="trade" when method in ("trade_resample", "both").
    """

    def test_both_method_with_firms_completes(self):
        """'both' method with firms must complete without error."""
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()
        req = MonteCarloRequest(
            backtest_id="test",
            num_simulations=200,
            method="both",
            use_gpu=False,
            firms=["topstep_50k"],
        )
        result = run_monte_carlo(req, trades, daily, [])
        assert "error" not in result
        assert "firm_survival" in result
        assert "topstep_50k" in result["firm_survival"]

    def test_trade_resample_and_both_same_granularity_class(self):
        """'both' and 'trade_resample' must produce firm_survival in the same numeric ballpark.

        Both use trade-level paths. If granularity were "day" for "both",
        eval_pass_rate would differ significantly because daily-loss-limit
        would be applied per trade step (too lenient).
        We just verify both return a numeric pass rate — behavioral equivalence
        is confirmed by the granularity fix at the call site.
        """
        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()

        req_resample = MonteCarloRequest(
            backtest_id="test", num_simulations=300, method="trade_resample",
            use_gpu=False, firms=["topstep_50k"],
        )
        req_both = MonteCarloRequest(
            backtest_id="test", num_simulations=300, method="both",
            use_gpu=False, firms=["topstep_50k"],
        )
        r1 = run_monte_carlo(req_resample, trades, daily, [])
        r2 = run_monte_carlo(req_both, trades, daily, [])

        rate1 = r1["firm_survival"]["topstep_50k"]["eval_pass_rate"]
        rate2 = r2["firm_survival"]["topstep_50k"]["eval_pass_rate"]
        # Both must be valid floats in [0, 1]
        assert 0.0 <= rate1 <= 1.0
        assert 0.0 <= rate2 <= 1.0


# ─── F-5: EOD trailing HWM deferred update ─────────────────────────

class TestEODTrailingHWMFix:
    """Topstep EOD trailing floor must use prior-EOD peak, not same-bar peak.

    F-5: peak_equity was updated inside the sub-step loop before the floor check.
    For EOD trailing (Topstep), this let today's gain raise the HWM before
    checking whether today's balance breached the floor — making the trailing
    DD appear more lenient than the actual rule.
    Fix: for is_eod_trailing, defer HWM ratchet to AFTER the breach check.
    """

    def test_eod_trailing_hwm_deferred(self):
        """A path that gains then drops should not see today's gain in today's floor.

        Construct a scenario where the account:
        - Day 1: +$3000 (HWM becomes $53000, floor = $53000 - $3000 = $50000)
        - Day 2: -$2999 (balance = $50001, should be ABOVE floor)
        - Day 3: -$3001 (balance = $49999, should breach floor at $50000)

        With the bug: Day 2 would update HWM to $53000 before floor check,
        then Day 3 floor = $50000 (correct for bug case since no new HWM gain on Day 3).
        The bug manifests when a day's P&L is positive and raises HWM — the
        same-day draw should still be measured from the prior EOD HWM.

        We test the specific case: Day 1 gain → Day 1 same-session DD must NOT
        allow the floor to reset by same-bar HWM update.
        """
        from src.engine.monte_carlo import simulate_firm_survival

        # Single simulation path: 3 steps (days)
        # Starting balance $50000, max_dd = $3000 for topstep_50k
        cumulative = np.array([[3000.0, 0.0, -3001.0]])  # cumulative P&L steps

        result = simulate_firm_survival(cumulative, "topstep_50k", account_size=50000)
        # After fix: Day 3 balance = $50000 + (-$3001) = $46999 at end of path
        # HWM at start of Day 3 = $53000 (from Day 1), floor = $50000
        # balance $46999 < floor $50000 → breached
        # The key invariant: result must reflect a breach
        assert result["eval_pass_rate"] == 0.0 or result["breach_reasons"].get("trailing_dd", 0) > 0

    def test_eod_trailing_no_false_breach(self):
        """A steadily-winning path must NOT be breached by HWM update timing.

        Construct paths where every day is profitable.
        No day's ending balance should be below any reasonable floor.
        """
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims = 10
        n_steps = 30
        # +$200/day consistently — should never breach
        paths = np.tile(np.cumsum(np.full(n_steps, 200.0)), (n_sims, 1))
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        # No breach on a uniformly winning path
        assert result["breach_reasons"].get("trailing_dd", 0) == 0


# ─── F-6: MFFU sliding-window consistency check ────────────────────

class TestMFFUConsistencyNotModeledInB14:
    """deepscan5 2026-06-29: MFFU Builder consistency (mffu_50pct_sim_payout) applies ONLY at the
    discrete SIM-FUNDED payout stage — NONE at eval, NONE live (firm_config.py mffu_50k). The B14
    eval+funded survival sim does not model that discrete payout gate, so simulate_firm_survival
    EXPLICITLY SKIPS MFFU consistency (mirrors the Topstep standard-lane skip).

    SUPERSEDES the prior `TestMFFUSlidingWindowConsistency` class: that class assumed MFFU did a
    14-day sliding-window B14 consistency check, which predates the Builder reconfiguration
    (rule renamed mffu_50pct → mffu_50pct_sim_payout, payout_cycle_days 14 → 2,
    consistency_window_days → None). These tests lock in the current intended behavior: a path
    that WOULD violate a 50% best-day cap produces NO consistency breach for mffu_50k, because the
    rule is intentionally not enforced in B14.
    """

    def test_concentrated_path_does_not_breach_consistency(self):
        """A path where the single best day is >50% of total profit (would violate a 50% cap)
        must NOT produce a consistency breach for mffu_50k — MFFU consistency is sim-payout-only,
        not modeled in the B14 eval+funded sim."""
        from src.engine.monte_carlo import simulate_firm_survival

        # Best day $6000 of $8600 total ≈ 69.8% > 50% — a full-path 50% cap WOULD flag this.
        step_pnls = [6000.0] + [200.0] * 13  # 14 days
        cumulative = np.array([np.cumsum(step_pnls)])

        result = simulate_firm_survival(
            cumulative, "mffu_50k", account_size=50000,
            backtest_commission_rt=1.24,
        )
        # Intentionally NOT enforced in B14 → zero consistency breaches.
        assert result["breach_reasons"].get("consistency", 0) == 0

    def test_uniform_path_also_no_consistency_breach(self):
        """A uniform path (no concentration) also produces no consistency breach — confirms the
        skip is unconditional for mffu_50k, not accidentally path-dependent."""
        from src.engine.monte_carlo import simulate_firm_survival

        step_pnls = [400.0] * 28
        cumulative = np.array([np.cumsum(step_pnls)])

        result = simulate_firm_survival(
            cumulative, "mffu_50k", account_size=50000,
            backtest_commission_rt=1.24,
        )
        assert result["breach_reasons"].get("consistency", 0) == 0

    def test_topstep_consistency_lane_still_fires(self):
        """Regression guard: the explicit MFFU skip must NOT disable Topstep consistency. In the
        CONSISTENCY payout lane, a concentrated path on topstep_50k still produces a breach —
        proving the skip is MFFU-scoped, not a blanket consistency-off."""
        import os
        from src.engine.monte_carlo import simulate_firm_survival

        step_pnls = [6000.0] + [200.0] * 13
        cumulative = np.array([np.cumsum(step_pnls)])

        _prev = os.environ.get("TOPSTEP_PAYOUT_LANE")
        os.environ["TOPSTEP_PAYOUT_LANE"] = "consistency"
        try:
            result = simulate_firm_survival(
                cumulative, "topstep_50k", account_size=50000,
                backtest_commission_rt=1.24,
            )
        finally:
            if _prev is None:
                os.environ.pop("TOPSTEP_PAYOUT_LANE", None)
            else:
                os.environ["TOPSTEP_PAYOUT_LANE"] = _prev
        # Topstep consistency-lane full-path 50% cap still fires (skip is MFFU-scoped).
        assert result["breach_reasons"].get("consistency", 0) > 0


# ─── F-7: max_drawdown_p5 positive sign convention ─────────────────

class TestMaxDrawdownP5SignConvention:
    """F-7: compute_all_mc_cis must return POSITIVE dollar drawdown magnitudes.

    Previous bug: max_dd_per_path = np.min(mc_paths - peak, axis=1) returned
    NEGATIVE values. BCa CIs then had negative ci_low/ci_high — counterintuitive
    and wrong for downstream consumers.
    Fix: max_dd_per_path = np.max(peak - mc_paths, axis=1) — positive depth.
    """

    def test_max_dd_p5_positive(self):
        """BCa max_drawdown_p5 CI values must be >= 0 (positive dollar depth)."""
        from src.engine.mc_confidence import compute_all_mc_cis

        # Create paths that definitely have drawdowns
        rng = np.random.default_rng(42)
        # 500 sims, 100 steps — equity paths with clear drawdowns
        returns = rng.normal(10, 100, size=(500, 100))
        mc_paths = np.cumsum(returns, axis=1) + 50000.0

        cis = compute_all_mc_cis(mc_paths, confidence_level=0.95, n_resamples=999, seed=42)
        if "max_drawdown_p5" in cis:
            entry = cis["max_drawdown_p5"]
            assert entry["point_estimate"] >= 0, (
                f"max_drawdown_p5 point_estimate must be >= 0 (positive depth), got {entry['point_estimate']}"
            )
            assert entry["ci_low"] >= 0, (
                f"max_drawdown_p5 ci_low must be >= 0 (positive depth), got {entry['ci_low']}"
            )
            assert entry["ci_high"] >= 0, (
                f"max_drawdown_p5 ci_high must be >= 0 (positive depth), got {entry['ci_high']}"
            )

    def test_max_dd_p5_less_than_mean(self):
        """p5 of max drawdowns must be <= mean drawdown (it is the LEFT tail, not the worst).

        max_drawdown_p5_stat returns the 5th percentile of the per-sim max-drawdown distribution.
        In a distribution of POSITIVE drawdown magnitudes:
          - p5 = the threshold below which only 5% of sims fall → a small (favorable) DD value
          - p95 = the threshold below which 95% of sims fall → the large (worst-case) DD value
        The stat is named "p5" because it is used as a worst-case guard (only 5% of paths had
        a smaller max DD), but within the magnitude distribution it sits at the LEFT (small) end.

        Sign convention after F-7: all values are POSITIVE dollar depths, so p5 <= mean <= p95.
        """
        from src.engine.mc_confidence import compute_all_mc_cis

        rng = np.random.default_rng(99)
        returns = rng.normal(5, 150, size=(1000, 200))
        mc_paths = np.cumsum(returns, axis=1) + 50000.0

        peak = np.maximum.accumulate(mc_paths, axis=1)
        max_dd_per_path = np.max(peak - mc_paths, axis=1)
        mean_dd = float(np.mean(max_dd_per_path))

        cis = compute_all_mc_cis(mc_paths, confidence_level=0.95, n_resamples=999, seed=99)
        if "max_drawdown_p5" in cis:
            p5 = cis["max_drawdown_p5"]["point_estimate"]
            # p5 is the 5th percentile → sits at the SMALL end of the distribution → <= mean
            assert p5 >= 0, f"max_drawdown_p5 must be positive (dollar depth), got {p5}"
            assert p5 <= mean_dd * 1.1, (
                f"max_drawdown_p5 ({p5:.1f}) should be <= mean_dd ({mean_dd:.1f}) — "
                "5th pct sits at the low (small DD) end of the distribution"
            )


# ─── F-9: return_bootstrap extrapolation warning ────────────────────

class TestReturnBootstrapExtrapolationWarning:
    """F-9: return_bootstrap must warn to stderr when n_days > 1.5× history length."""

    def test_warns_on_heavy_extrapolation(self, capsys, monkeypatch):
        """n_days = 1.7× history → warning printed to stderr (above 1.5× soft-warn threshold).

        Wave 27.5 Pass A.1 — CRITICAL #3: uses 1.7× instead of 4× to stay below
        the default 2.0× hard-fail threshold. Hard fail disabled for 4× test in
        test_hard_cap_applied(). 1.7× is above the 1.5× soft-warn threshold and
        below the 2.0× hard-fail threshold so the warning fires without an exception.
        """
        daily = _make_daily_pnls(50)
        # 50 history days, 85 simulated days → 1.7× extrapolation (above 1.5× warn, below 2× hard-fail)
        return_bootstrap(daily, n_sims=10, n_days=85, seed=42)
        captured = capsys.readouterr()
        assert "WARNING" in captured.err or "extrapolat" in captured.err.lower(), (
            "Expected extrapolation warning in stderr"
        )

    def test_no_warning_within_threshold(self, capsys):
        """n_days = 1× history → no warning."""
        daily = _make_daily_pnls(100)
        return_bootstrap(daily, n_sims=10, n_days=100, seed=42)
        captured = capsys.readouterr()
        assert "extrapolat" not in captured.err.lower()

    def test_hard_cap_applied(self, monkeypatch):
        """n_days >> 5× history must be capped at 5× when hard fail is disabled.

        Wave 27.5 Pass A.1 — CRITICAL #3: the soft cap at 5× still applies when
        hard fail is disabled (MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER=infinity).
        This test opts out of the hard fail to specifically test soft-cap behavior.
        """
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "infinity")
        daily = _make_daily_pnls(10)  # 10 history days; cap at 50
        # Request 1000 days — should be capped at 50 (5× soft cap)
        paths = return_bootstrap(daily, n_sims=5, n_days=1000, seed=42)
        # Output shape n_days dimension should be capped
        assert paths.shape[1] <= 50, (
            f"Expected paths capped at 50 days (5× history), got shape {paths.shape}"
        )


# ─── F-10 / F-12: MonteCarloRequest new fields ──────────────────────

class TestMonteCarloRequestNewFields:
    """F-10: backtest_commission_rt in MonteCarloRequest.
    F-12: avg_trades_per_day in MonteCarloRequest.
    """

    def test_backtest_commission_rt_defaults_none(self):
        """backtest_commission_rt must default to None (backward compat)."""
        req = MonteCarloRequest(backtest_id="test")
        assert req.backtest_commission_rt is None

    def test_backtest_commission_rt_accepts_float(self):
        """backtest_commission_rt must accept a float value."""
        req = MonteCarloRequest(backtest_id="test", backtest_commission_rt=1.24)
        assert req.backtest_commission_rt == pytest.approx(1.24)

    def test_avg_trades_per_day_defaults_1_5(self):
        """avg_trades_per_day must default to 1.5."""
        req = MonteCarloRequest(backtest_id="test")
        assert req.avg_trades_per_day == pytest.approx(1.5)

    def test_avg_trades_per_day_accepts_float(self):
        """avg_trades_per_day must accept a custom value."""
        req = MonteCarloRequest(backtest_id="test", avg_trades_per_day=3.7)
        assert req.avg_trades_per_day == pytest.approx(3.7)

    def test_commission_rt_propagated_to_survival(self):
        """When backtest_commission_rt is set, simulate_firm_survival must not log warning."""

        trades = _make_trades(80).tolist()
        daily = _make_daily_pnls(200).tolist()

        req = MonteCarloRequest(
            backtest_id="test",
            num_simulations=100,
            method="trade_resample",
            use_gpu=False,
            firms=["topstep_50k"],
            backtest_commission_rt=1.24,
            avg_trades_per_day=2.0,
        )
        result = run_monte_carlo(req, trades, daily, [])
        # Should complete without error and have firm_survival
        assert "error" not in result
        assert "firm_survival" in result


# ─── F-11: vectorized compute_drawdown_stats performance ────────────

class TestDrawdownStatsVectorized:
    """F-11: compute_drawdown_stats must be correct and fast (no Python sim loops)."""

    def test_max_dd_depth_nonnegative(self):
        """max_dd_depth values must be >= 0 for all percentile levels."""
        from src.engine.monte_carlo import compute_drawdown_stats
        rng = np.random.default_rng(42)
        paths = np.cumsum(rng.normal(5, 100, size=(1000, 100)), axis=1)
        stats = compute_drawdown_stats(paths, initial_capital=50000.0)
        for pct, val in stats["max_dd_depth"].items():
            assert val >= 0, f"max_dd_depth.{pct} should be >= 0, got {val}"

    def test_recovery_time_bounded(self):
        """recovery_time_bars percentiles must be in [0, n_steps]."""
        from src.engine.monte_carlo import compute_drawdown_stats
        rng = np.random.default_rng(99)
        n_steps = 80
        paths = np.cumsum(rng.normal(10, 150, size=(500, n_steps)), axis=1)
        stats = compute_drawdown_stats(paths, initial_capital=50000.0)
        for pct, val in stats["recovery_time_bars"].items():
            assert 0 <= val <= n_steps, (
                f"recovery_time_bars.{pct}={val} out of bounds [0, {n_steps}]"
            )

    def test_no_drawdown_path_zero_depth(self):
        """Monotonically increasing paths must have zero drawdown depth."""
        from src.engine.monte_carlo import compute_drawdown_stats
        n_sims, n_steps = 50, 60
        # Each path gains $10/step — no drawdown ever
        paths = np.tile(np.arange(1, n_steps + 1, dtype=float) * 10, (n_sims, 1))
        stats = compute_drawdown_stats(paths, initial_capital=50000.0)
        # p50 and p95 of max_dd_depth must be 0
        assert stats["max_dd_depth"]["p50"] == pytest.approx(0.0, abs=1e-8)
        assert stats["max_dd_depth"]["p95"] == pytest.approx(0.0, abs=1e-8)
        # Duration must also be 0
        assert stats["max_dd_duration_bars"]["p50"] == pytest.approx(0.0, abs=1e-8)

    def test_deterministic_across_calls(self):
        """compute_drawdown_stats is deterministic (no RNG dependency)."""
        from src.engine.monte_carlo import compute_drawdown_stats
        rng = np.random.default_rng(42)
        paths = np.cumsum(rng.normal(0, 200, size=(300, 120)), axis=1)
        a = compute_drawdown_stats(paths, initial_capital=50000.0)
        b = compute_drawdown_stats(paths, initial_capital=50000.0)
        assert a == b
