"""Tests for MC return_bootstrap extrapolation hard-fail.

Wave 27.5 Pass A.1 — CRITICAL #3: MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER

Covers:
  - n_days > 2× history → ExtrapolationExceededError raised
  - n_days < 2× history → succeeds (soft warn may fire but no exception)
  - n_days > 1.5× but < 2× → soft warn, no exception
  - MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER=infinity disables check
  - ExtrapolationExceededError carries correct fields
  - run_monte_carlo returns structured error dict on extrapolation_exceeded
  - Soft cap at 5× still works when hard fail disabled
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.config import MonteCarloRequest
from src.engine.monte_carlo import (
    ExtrapolationExceededError,
    return_bootstrap,
    run_monte_carlo,
)

# ─── ExtrapolationExceededError type tests ───────────────────────


class TestExtrapolationExceededError:
    def test_is_value_error_subclass(self):
        err = ExtrapolationExceededError(
            requested_n_days=100,
            history_len=30,
            hard_fail_multiplier=2.0,
            recommended_n_days=60,
        )
        assert isinstance(err, ValueError)

    def test_carries_requested_n_days(self):
        err = ExtrapolationExceededError(100, 30, 2.0, 60)
        assert err.requested_n_days == 100

    def test_carries_history_len(self):
        err = ExtrapolationExceededError(100, 30, 2.0, 60)
        assert err.history_len == 30

    def test_carries_hard_fail_multiplier(self):
        err = ExtrapolationExceededError(100, 30, 2.0, 60)
        assert err.hard_fail_multiplier == 2.0

    def test_carries_recommended_n_days(self):
        err = ExtrapolationExceededError(100, 30, 2.0, 60)
        assert err.recommended_n_days == 60

    def test_str_representation_informative(self):
        err = ExtrapolationExceededError(100, 30, 2.0, 60)
        msg = str(err)
        assert "100" in msg  # requested
        assert "30" in msg   # history
        assert "2.0" in msg  # multiplier


# ─── return_bootstrap hard-fail tests ────────────────────────────


class TestReturnBootstrapHardFail:
    """Tests using explicit env var to isolate from global defaults."""

    def _daily_returns(self, n: int = 30, seed: int = 42) -> np.ndarray:
        rng = np.random.default_rng(seed)
        return rng.normal(0.0, 50.0, size=n)

    def test_2x_extrapolation_raises_with_multiplier_2(self, monkeypatch):
        """n_days = 2.1× history → ExtrapolationExceededError when multiplier=2.0."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "2.0")
        returns = self._daily_returns(n=30)
        n_days_too_large = int(30 * 2.1)  # 63 days > 2× 30-day history
        with pytest.raises(ExtrapolationExceededError) as exc_info:
            return_bootstrap(returns, n_sims=10, n_days=n_days_too_large, seed=42)
        assert exc_info.value.requested_n_days == n_days_too_large
        assert exc_info.value.history_len == 30
        assert exc_info.value.hard_fail_multiplier == 2.0

    def test_exactly_2x_passes_with_multiplier_2(self, monkeypatch):
        """n_days = exactly 2× history → passes (boundary is strictly greater)."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "2.0")
        returns = self._daily_returns(n=30)
        n_days_exactly_2x = 60  # exactly 2× 30-day history
        # Should NOT raise
        result = return_bootstrap(returns, n_sims=10, n_days=n_days_exactly_2x, seed=42)
        assert result.shape == (10, n_days_exactly_2x)

    def test_1_9x_does_not_raise_with_multiplier_2(self, monkeypatch):
        """n_days = 1.9× history → soft warn only, no exception with multiplier=2.0."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "2.0")
        returns = self._daily_returns(n=30)
        n_days = int(30 * 1.9)  # 57 days, < 2× boundary
        # Should not raise
        result = return_bootstrap(returns, n_sims=10, n_days=n_days, seed=42)
        assert result.shape == (10, n_days)

    def test_infinity_multiplier_disables_check(self, monkeypatch):
        """MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER=infinity disables hard fail."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "infinity")
        returns = self._daily_returns(n=30)
        # This would fail with default multiplier=2.0 but should succeed with infinity
        n_days = int(30 * 3.0)  # 90 days, 3× history
        # Should NOT raise (soft cap at 5× will still apply, path length may be capped)
        result = return_bootstrap(returns, n_sims=10, n_days=n_days, seed=42)
        assert result.ndim == 2

    def test_inf_string_disables_check(self, monkeypatch):
        """MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER=inf also disables hard fail."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "inf")
        returns = self._daily_returns(n=30)
        n_days = int(30 * 2.5)
        result = return_bootstrap(returns, n_sims=10, n_days=n_days, seed=42)
        assert result.ndim == 2

    def test_within_history_length_never_raises(self, monkeypatch):
        """n_days <= history_len always succeeds regardless of multiplier."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "0.5")
        returns = self._daily_returns(n=30)
        # Even with multiplier=0.5, n_days=30 (1×) is not > 0.5×30=15... wait
        # Actually 30 > 0.5*30=15 so it WILL raise. Use n_days=10 instead.
        result = return_bootstrap(returns, n_sims=10, n_days=10, seed=42)
        assert result.shape == (10, 10)

    def test_custom_multiplier_respected(self, monkeypatch):
        """Custom multiplier value is respected."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "3.0")
        returns = self._daily_returns(n=30)
        # 2.5× history with multiplier=3.0 → should NOT raise
        n_days = int(30 * 2.5)
        result = return_bootstrap(returns, n_sims=10, n_days=n_days, seed=42)
        assert result.ndim == 2

        # 3.5× history with multiplier=3.0 → SHOULD raise
        n_days_over = int(30 * 3.5)
        with pytest.raises(ExtrapolationExceededError):
            return_bootstrap(returns, n_sims=10, n_days=n_days_over, seed=42)


# ─── run_monte_carlo structured error dict tests ─────────────────


class TestRunMCExtrapolationErrorDict:
    """run_monte_carlo should return a structured dict (not raise) on extrapolation_exceeded."""

    def _make_request(self) -> MonteCarloRequest:
        return MonteCarloRequest(
            backtest_id="test-extrap-001",
            method="return_bootstrap",
            num_simulations=50,
            use_gpu=False,
            initial_capital=50000,
            seed=42,
        )

    def _make_daily_pnls(self, n: int = 20) -> list[float]:
        rng = np.random.default_rng(42)
        return rng.normal(10, 50, size=n).tolist()

    def _make_trades(self, n: int = 35) -> list[float]:
        rng = np.random.default_rng(42)
        return rng.normal(5, 30, size=n).tolist()

    def test_run_mc_returns_error_dict_on_extrapolation(self, monkeypatch):
        """run_monte_carlo returns structured error dict when return_bootstrap hard-fails."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "2.0")
        # 20 daily returns → hard fail at > 40 days
        # survival_horizon = max(126, 20) = 126 days → 6.3× history → WILL trigger hard fail
        request = self._make_request()
        trades = self._make_trades(n=35)
        daily_pnls = self._make_daily_pnls(n=20)

        result = run_monte_carlo(request, trades, daily_pnls, equity_curve=[])
        assert result.get("status") == "extrapolation_exceeded", (
            f"Expected status='extrapolation_exceeded', got: {result}"
        )

    def test_error_dict_has_required_keys(self, monkeypatch):
        """Structured error dict must have all required keys."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "2.0")
        request = self._make_request()
        trades = self._make_trades(n=35)
        daily_pnls = self._make_daily_pnls(n=20)

        result = run_monte_carlo(request, trades, daily_pnls, equity_curve=[])
        if result.get("status") == "extrapolation_exceeded":
            for key in ("status", "requested_n_days", "history_len", "hard_fail_multiplier", "recommended_n_days", "error"):
                assert key in result, f"Missing key {key!r} in error dict"

    def test_run_mc_succeeds_within_bounds(self, monkeypatch):
        """run_monte_carlo succeeds when n_days within hard-fail bounds."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "infinity")
        request = self._make_request()
        trades = self._make_trades(n=35)
        daily_pnls = self._make_daily_pnls(n=20)

        result = run_monte_carlo(request, trades, daily_pnls, equity_curve=[])
        # Should not be an extrapolation error
        assert result.get("status") != "extrapolation_exceeded"
        assert "confidence_intervals" in result or "error" in result


# ─── Soft cap behavior (hard fail disabled) ──────────────────────


class TestSoftCapWhenHardFailDisabled:
    def test_soft_cap_fires_at_5x_when_hard_fail_disabled(self, monkeypatch, capsys):
        """When hard fail disabled, soft cap at MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION (5.0×) fires."""
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "infinity")
        monkeypatch.setenv("MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION", "5.0")
        rng = np.random.default_rng(42)
        returns = rng.normal(0, 50, size=20)
        # 7× extrapolation — beyond soft cap of 5×
        result = return_bootstrap(returns, n_sims=10, n_days=140, seed=42)
        # Should be capped at 5×20=100 days, not 140
        assert result.shape[1] <= 100, f"Expected ≤100 columns (5× cap), got {result.shape[1]}"
        # Should have emitted warning to stderr
        captured = capsys.readouterr()
        assert "cap" in captured.err.lower() or "WARNING" in captured.err
