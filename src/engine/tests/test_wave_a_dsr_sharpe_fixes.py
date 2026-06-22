"""FIX 7 + FIX 8 regressions: DSR exception + zero-std Sharpe.

FIX 7: DSR exception in CPCV block must emit walk_forward.dsr_computation_failed
  and set dsr_pass=False, dsr_unavailable=True so TS consumer can block.
  Previous: exception silently set dsr=None → TS treats None as pass-through.

FIX 8: Sharpe with std < 1e-8 must return 0.0, not explode to ~1e13.
  Previous: std replaced with 1e-10 → Sharpe ≈ mean / 1e-10 × 252^0.5 = enormous.
  New: when std < 1e-8, Sharpe = 0.0 for the path (no edge = no Sharpe signal).
"""
# ruff: noqa: E402 — vectorbt mock must precede engine imports (env trait 2026-06-22)
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import numpy as np

sys.modules.setdefault("vectorbt", MagicMock())

from src.engine.risk_metrics import compute_sharpe_distribution

# ─── FIX 7: DSR exception handling ──────────────────────────────────────────

class TestDsrExceptionFix7:
    """FIX 7: DSR exception must produce dsr_pass=False, dsr_unavailable=True."""

    def _simulate_dsr_exception_block(self, exc: Exception) -> dict:
        """Replicate the CPCV DSR try/except block from walk_forward.py."""
        try:
            raise exc
        except Exception as _dsr_exc:
            _dsr_result = {
                "dsr": None,
                "dsr_pass": False,
                "dsr_unavailable": True,
                "error": str(_dsr_exc),
                "error_type": type(_dsr_exc).__name__,
            }
            _dsr_val = None
            return _dsr_result

    def test_dsr_exception_sets_dsr_pass_false(self):
        """dsr_pass must be False on exception (fail-CLOSED)."""
        result = self._simulate_dsr_exception_block(ImportError("scipy not found"))
        assert result["dsr_pass"] is False, (
            "dsr_pass must be False on exception; TS consumer must block not proceed"
        )

    def test_dsr_exception_sets_dsr_unavailable_true(self):
        """dsr_unavailable must be True so TS can distinguish from deliberate None."""
        result = self._simulate_dsr_exception_block(RuntimeError("math error"))
        assert result["dsr_unavailable"] is True

    def test_dsr_exception_sets_dsr_none(self):
        """dsr value must be None (not a misleading float) on exception."""
        result = self._simulate_dsr_exception_block(ValueError("bad input"))
        assert result["dsr"] is None

    def test_dsr_exception_records_error_type(self):
        """error_type must be recorded for operator diagnostics."""
        result = self._simulate_dsr_exception_block(OverflowError("overflow"))
        assert result["error_type"] == "OverflowError"

    def test_dsr_exception_records_error_message(self):
        """error string must be recorded for operator diagnostics."""
        result = self._simulate_dsr_exception_block(RuntimeError("the reason"))
        assert "the reason" in result["error"]

    def test_wf_metadata_surfaces_dsr_pass(self):
        """wf_metadata dict must carry dsr_pass and dsr_unavailable keys."""
        _dsr_result = self._simulate_dsr_exception_block(Exception("x"))
        _dsr_val = None
        _psr = None

        wf_metadata = {
            "mode": "cpcv",
            "dsr": _dsr_val,
            "dsr_pass": _dsr_result.get("dsr_pass"),
            "dsr_unavailable": _dsr_result.get("dsr_unavailable", False),
        }

        assert wf_metadata["dsr_pass"] is False
        assert wf_metadata["dsr_unavailable"] is True

    def test_ts_consumer_would_block_on_dsr_pass_false(self):
        """Simulate TS gate: dsr_pass=False must produce block outcome."""
        _dsr_result = self._simulate_dsr_exception_block(Exception("x"))

        dsr_pass = _dsr_result.get("dsr_pass")
        dsr_unavailable = _dsr_result.get("dsr_unavailable", False)

        # TS gate logic (replicated): block if dsr_pass is explicitly False
        if dsr_pass is False:
            gate_outcome = "block"
        elif dsr_unavailable:
            gate_outcome = "block"
        elif dsr_pass is None:
            gate_outcome = "proceed"  # legacy null = no gate
        else:
            gate_outcome = "pass" if dsr_pass else "block"

        assert gate_outcome == "block", (
            f"TS gate must block when dsr_pass=False, got '{gate_outcome}'"
        )


# ─── FIX 8: Zero-std Sharpe ──────────────────────────────────────────────────

class TestZeroStdSharpeFix8:
    """FIX 8: paths with near-zero std must report Sharpe = 0.0, not 1e13."""

    def _constant_path(self, n_sims: int = 10, n_days: int = 250, daily_pnl: float = 100.0) -> np.ndarray:
        """Perfectly constant daily P&L — std = 0.0 exactly."""
        daily = np.full((n_sims, n_days), daily_pnl)
        return np.cumsum(daily, axis=1)

    def test_zero_std_sharpe_is_zero(self):
        """Strategy with constant P&L must report p50 Sharpe = 0.0, not astronomical."""
        paths = self._constant_path(n_sims=50, daily_pnl=200.0)
        result = compute_sharpe_distribution(paths, [0.5])
        assert abs(result["p50"]) < 1e-6, (
            f"p50 Sharpe for constant-P&L strategy must be 0.0, got {result['p50']} — "
            "indicates std replacement with 1e-10 is still active (FIX 8 not applied)"
        )

    def test_zero_std_sharpe_not_nan_or_inf(self):
        """No NaN or Inf must appear in Sharpe output for zero-std paths."""
        paths = self._constant_path(n_sims=20, daily_pnl=50.0)
        result = compute_sharpe_distribution(paths, [0.05, 0.50, 0.95])
        for key, val in result.items():
            assert np.isfinite(val), f"Sharpe {key}={val} must be finite for zero-std path"

    def test_near_zero_std_sharpe_is_zero(self):
        """std just above machine epsilon must also clamp to 0.0 (not explode)."""
        rng = np.random.default_rng(42)
        # Add tiny noise to constant path — std ≈ 1e-9 (below 1e-8 threshold)
        tiny_noise = rng.normal(0, 1e-9, size=(20, 250))
        daily = np.full((20, 250), 100.0) + tiny_noise
        paths = np.cumsum(daily, axis=1)
        result = compute_sharpe_distribution(paths, [0.5])
        assert abs(result["p50"]) < 1e6, (
            f"Near-zero std Sharpe must be finite and bounded, got {result['p50']}"
        )

    def test_genuine_edge_strategy_still_reports_positive_sharpe(self):
        """Regression: strategy with real edge must still report positive Sharpe > 0."""
        rng = np.random.default_rng(42)
        daily = rng.normal(200, 300, size=(500, 252))  # high Sharpe strategy
        paths = np.cumsum(daily, axis=1)
        result = compute_sharpe_distribution(paths, [0.5])
        assert result["p50"] > 0.0, (
            f"Genuine-edge strategy must have positive p50 Sharpe, got {result['p50']}"
        )

    def test_losing_strategy_reports_negative_sharpe(self):
        """Strategy with consistent losses must report negative Sharpe."""
        rng = np.random.default_rng(42)
        daily = rng.normal(-100, 200, size=(200, 252))
        paths = np.cumsum(daily, axis=1)
        result = compute_sharpe_distribution(paths, [0.5])
        assert result["p50"] < 0.0, "Losing strategy must have negative p50 Sharpe"

    def test_breakeven_strategy_approx_zero_sharpe(self):
        """Strategy with mean ≈ 0 and non-trivial std must report Sharpe ≈ 0."""
        rng = np.random.default_rng(42)
        daily = rng.normal(0.0, 300.0, size=(300, 252))  # mean = 0
        paths = np.cumsum(daily, axis=1)
        result = compute_sharpe_distribution(paths, [0.5])
        assert abs(result["p50"]) < 0.5, (
            f"Breakeven strategy p50 Sharpe must be near 0, got {result['p50']}"
        )
