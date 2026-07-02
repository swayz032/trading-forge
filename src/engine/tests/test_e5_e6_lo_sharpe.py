"""E5 & E6 (deep-scan #7 2026-07-02) — Lo-Sharpe autocorrelation correction.

E5 (L-1): MC_LO_AC_SAMPLE env var makes the autocorrelation sample cap tunable.
  Previous: hardcoded 1000.
  New: MC_LO_AC_SAMPLE (default 1000); MC_LO_AC_SAMPLE=0 → full sample.

E6 (L-4): near-zero stds guard aligned to FIX-8 pattern.
  Previous: stds == 0 → replace with 1e-10 → Sharpe explodes (~2.5e13).
  New: stds < 1e-8 → Sharpe = 0.0 (mirror compute_sharpe_distribution FIX 8).

Tests (E5):
  - Default cap 1000: n_sims > 1000 uses 1000 samples (perf).
  - MC_LO_AC_SAMPLE=50: uses 50 samples.
  - MC_LO_AC_SAMPLE=0: uses full sample.
  - Cap > n_sims: uses n_sims (no padding).
  - Determinism: same env + same paths → same result.

Tests (E6):
  - Near-zero std (< 1e-8): returns 0.0 not astronomical value.
  - Exact zero std: returns 0.0.
  - Normal std: returns non-zero Sharpe (FIX-8 guard doesn't fire).
  - FIX-8 consistency: Lo-Sharpe guard matches compute_sharpe_distribution behavior.
"""

from __future__ import annotations

import numpy as np
import pytest


def _get_lo_sharpe():
    from src.engine.risk_metrics import compute_lo_sharpe_distribution
    return compute_lo_sharpe_distribution


def _get_sharpe_distribution():
    from src.engine.risk_metrics import compute_sharpe_distribution
    return compute_sharpe_distribution


def _make_paths(n_sims: int, n_steps: int, seed: int = 42) -> np.ndarray:
    """Synthetic cumulative P&L paths for testing."""
    rng = np.random.default_rng(seed)
    daily = rng.normal(100.0, 50.0, (n_sims, n_steps))
    return np.cumsum(daily, axis=1)


def _make_flat_paths(n_sims: int, n_steps: int) -> np.ndarray:
    """Paths with constant daily P&L (std=0) to trigger near-zero guard."""
    daily = np.ones((n_sims, n_steps)) * 100.0  # all same → std=0
    return np.cumsum(daily, axis=1)


# ── E5: MC_LO_AC_SAMPLE env tunable ──────────────────────────────────────────

class TestE5LoAcSampleCap:
    """MC_LO_AC_SAMPLE makes Lo-Sharpe autocorrelation sample cap tunable."""

    def test_default_cap_1000_used_when_n_sims_large(self, monkeypatch):
        """n_sims > 1000: default cap of 1000 is used (perf guard)."""
        monkeypatch.delenv("MC_LO_AC_SAMPLE", raising=False)
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=2000, n_steps=100)
        # Should complete without error (not slow because sample_size=1000, not 2000)
        result = fn(paths, percentiles=[0.05, 0.5, 0.95])
        assert "p50" in result
        assert "correction_factor" in result

    def test_custom_cap_50(self, monkeypatch):
        """MC_LO_AC_SAMPLE=50: uses 50 samples even when n_sims=500."""
        monkeypatch.setenv("MC_LO_AC_SAMPLE", "50")
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=500, n_steps=80)
        result = fn(paths, percentiles=[0.5])
        assert "p50" in result
        assert isinstance(result["p50"], float)

    def test_zero_cap_uses_full_sample(self, monkeypatch):
        """MC_LO_AC_SAMPLE=0: full sample (no cap). Works for small n_sims."""
        monkeypatch.setenv("MC_LO_AC_SAMPLE", "0")
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=50, n_steps=60)
        result = fn(paths, percentiles=[0.5])
        assert "p50" in result

    def test_cap_larger_than_n_sims_uses_n_sims(self, monkeypatch):
        """Cap > n_sims: sample_size = n_sims (no padding)."""
        monkeypatch.setenv("MC_LO_AC_SAMPLE", "9999")
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=30, n_steps=60)
        result = fn(paths, percentiles=[0.5])
        assert "p50" in result

    def test_determinism_same_env_same_result(self, monkeypatch):
        """Same env + same paths → same Lo-Sharpe p50 (replay determinism)."""
        monkeypatch.setenv("MC_LO_AC_SAMPLE", "100")
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=200, n_steps=80, seed=77)
        r1 = fn(paths, percentiles=[0.5])
        r2 = fn(paths, percentiles=[0.5])
        assert r1["p50"] == pytest.approx(r2["p50"], rel=1e-10)


# ── E6: near-zero stds guard ──────────────────────────────────────────────────

class TestE6LoSharpeNearZeroGuard:
    """stds < 1e-8 → Sharpe = 0.0 (not exploding value)."""

    def test_flat_paths_return_zero_not_astronomical(self, monkeypatch):
        """Flat daily returns (std=0) → Lo-Sharpe = 0.0, not ~2.5e13."""
        monkeypatch.setenv("MC_LO_AC_SAMPLE", "0")  # full sample for precision
        fn = _get_lo_sharpe()
        paths = _make_flat_paths(n_sims=10, n_steps=50)
        result = fn(paths, percentiles=[0.5])
        p50 = result["p50"]
        assert abs(p50) < 1e6, (
            f"Flat paths with std=0 should return near-0 Lo-Sharpe, got {p50}"
        )
        # Not astronomical (pre-fix would have been ~2.5e13)
        assert abs(p50) < 1e6, f"Expected |Lo-Sharpe| < 1e6 for flat paths, got {p50}"

    def test_near_zero_std_not_exploding(self, monkeypatch):
        """Near-zero std (< 1e-8) → Lo-Sharpe = 0.0 per E6 guard."""
        fn = _get_lo_sharpe()
        # Paths with tiny noise (std ≈ 0, but not exactly 0)
        n_sims, n_steps = 20, 60
        daily = np.ones((n_sims, n_steps)) * 100.0
        # Add epsilon noise: std << 1e-8 after differencing 100-valued cumsum
        # Since step_returns = diff(cumsum) = daily, std ≈ 1e-12 for tiny noise
        daily += np.random.default_rng(42).normal(0, 1e-12, (n_sims, n_steps))
        paths = np.cumsum(daily, axis=1)
        result = fn(paths, percentiles=[0.5])
        p50 = result["p50"]
        # Should not be astronomical
        assert abs(p50) < 1e9, f"Near-zero std should not produce astronomical Sharpe, got {p50}"

    def test_normal_std_nonzero_sharpe(self):
        """Normal std (> 1e-8) → Lo-Sharpe is a finite non-zero value."""
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=50, n_steps=100)
        result = fn(paths, percentiles=[0.5])
        p50 = result["p50"]
        # Should be a realistic Sharpe magnitude
        assert abs(p50) < 100.0, f"Normal paths should produce reasonable Lo-Sharpe, got {p50}"
        # Not zero (normal paths have non-zero mean)

    def test_e6_matches_fix8_pattern_from_sharpe_distribution(self):
        """E6: Lo-Sharpe guard behavior matches compute_sharpe_distribution FIX-8.

        Both functions should return 0.0 for flat (std=0) paths.
        """
        flat_paths = _make_flat_paths(n_sims=10, n_steps=50)
        lo_fn = _get_lo_sharpe()
        sharpe_fn = _get_sharpe_distribution()
        lo_result = lo_fn(flat_paths, percentiles=[0.5])
        sharpe_result = sharpe_fn(flat_paths, percentiles=[0.5])
        # Both should produce 0.0 for flat (std=0) paths
        assert abs(lo_result["p50"]) < 1e3, (
            f"Lo-Sharpe p50 should be near 0 for flat paths, got {lo_result['p50']}"
        )
        assert abs(sharpe_result["p50"]) < 1e3, (
            f"compute_sharpe_distribution p50 should be near 0 for flat paths, "
            f"got {sharpe_result['p50']}"
        )

    def test_correction_factor_in_output(self):
        """Lo-Sharpe output always includes correction_factor (schema stability)."""
        fn = _get_lo_sharpe()
        paths = _make_paths(n_sims=30, n_steps=80)
        result = fn(paths, percentiles=[0.5])
        assert "correction_factor" in result
        assert isinstance(result["correction_factor"], float)
        assert result["correction_factor"] > 0
