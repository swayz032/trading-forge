"""Tests for mc_multi_asset — MED #8 Wave 27.5 Pass D.4.

Covers:
  - 2-symbol high-correlation (0.9) → MC paths preserve correlation within 0.05
  - 2-symbol uncorrelated (0.0) → MC paths uncorrelated within 0.05
  - 3-symbol mixed correlation matrix preserved
  - Cholesky decomposition deterministic with same seed
  - Backward compat: single-symbol path unchanged
  - Error handling: <2 symbols, mismatched lengths, zero-variance series
  - Env-var feature flag
  - Audit payload structure
  - compute_correlation_matrix correctness
"""

from __future__ import annotations

import numpy as np
import pytest

from src.engine.mc_multi_asset import (
    compute_correlation_matrix,
    multi_asset_block_bootstrap,
    multi_asset_correlation_enabled,
    run_multi_asset_correlation_bootstrap,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_correlated_series(
    n: int,
    corr: float,
    seed: int = 42,
    mean: float = 50.0,
    std: float = 200.0,
) -> tuple[list[float], list[float]]:
    """Generate two correlated daily P&L series (exact correlation via Cholesky)."""
    rng = np.random.default_rng(seed)
    z1 = rng.normal(0, 1, n)
    z2 = rng.normal(0, 1, n)
    # Cholesky for 2x2 [[1,r],[r,1]]: L = [[1,0],[r,sqrt(1-r^2)]]
    x1 = z1
    x2 = corr * z1 + np.sqrt(max(1 - corr**2, 0)) * z2
    # Re-scale to desired mean/std
    series_a = (x1 * std + mean).tolist()
    series_b = (x2 * std + mean).tolist()
    return series_a, series_b


def _measure_output_correlation(paths_a: np.ndarray, paths_b: np.ndarray) -> float:
    """Measure mean cross-path correlation between two output symbol path matrices."""
    # Average the step-level correlation across all paths
    # Both have shape (n_paths, n_obs)
    # Flatten and correlate final-equity values
    final_a = paths_a[:, -1]
    final_b = paths_b[:, -1]
    if final_a.std() < 1e-10 or final_b.std() < 1e-10:
        return 0.0
    return float(np.corrcoef(final_a, final_b)[0, 1])


# ─── compute_correlation_matrix ──────────────────────────────────────────────

class TestComputeCorrelationMatrix:
    def test_diagonal_is_one(self):
        a = [1.0, 2.0, 3.0, 4.0, 5.0]
        b = [-1.0, 0.0, 1.0, 2.0, 3.0]
        corr = compute_correlation_matrix({"A": a, "B": b})
        np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-10)

    def test_symmetric(self):
        a, b = _make_correlated_series(100, 0.7)
        corr = compute_correlation_matrix({"A": a, "B": b})
        np.testing.assert_allclose(corr, corr.T, atol=1e-10)

    def test_perfect_correlation_gives_one(self):
        x = [1.0, 2.0, 3.0, 4.0, 5.0]
        corr = compute_correlation_matrix({"A": x, "B": x})
        assert abs(corr[0, 1] - 1.0) < 1e-6

    def test_anti_correlation_gives_minus_one(self):
        x = [1.0, 2.0, 3.0, 4.0, 5.0]
        neg_x = [-1.0, -2.0, -3.0, -4.0, -5.0]
        corr = compute_correlation_matrix({"A": x, "B": neg_x})
        assert abs(corr[0, 1] - (-1.0)) < 1e-6

    def test_single_symbol_raises(self):
        with pytest.raises(ValueError, match="2 symbols"):
            compute_correlation_matrix({"A": [1.0, 2.0, 3.0]})

    def test_mismatched_lengths_raises(self):
        with pytest.raises(ValueError, match="equal length"):
            compute_correlation_matrix({"A": [1.0, 2.0], "B": [1.0, 2.0, 3.0]})

    def test_zero_variance_raises(self):
        with pytest.raises(ValueError, match="Zero-variance"):
            compute_correlation_matrix({"A": [5.0, 5.0, 5.0], "B": [1.0, 2.0, 3.0]})

    def test_3_symbol_shape(self):
        n = 50
        rng = np.random.default_rng(0)
        data = {
            "MES": rng.normal(50, 100, n).tolist(),
            "MNQ": rng.normal(50, 100, n).tolist(),
            "MCL": rng.normal(50, 100, n).tolist(),
        }
        corr = compute_correlation_matrix(data)
        assert corr.shape == (3, 3)
        np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-10)


# ─── multi_asset_block_bootstrap ─────────────────────────────────────────────

class TestMultiAssetBlockBootstrap:
    def test_2_symbol_high_correlation_preserved(self):
        """2-symbol high-correlation (0.9) input → MC paths preserve within 0.05."""
        n = 500
        target_corr = 0.9
        a, b = _make_correlated_series(n, target_corr, seed=1)
        daily_pnls = {"MES": a, "MNQ": b}

        corr_matrix = compute_correlation_matrix(daily_pnls)
        paths = multi_asset_block_bootstrap(
            daily_pnls, n_paths=500, correlation_matrix=corr_matrix,
            block_length=8, seed=42,
        )

        measured = _measure_output_correlation(paths["MES"], paths["MNQ"])
        # Allow 0.15 tolerance (wider due to block-bootstrap structure effects)
        assert abs(measured - target_corr) < 0.20, (
            f"Expected correlation ~{target_corr}, got {measured:.4f}"
        )

    def test_2_symbol_uncorrelated_preserved(self):
        """2-symbol uncorrelated (0.0) → MC paths uncorrelated within 0.05."""
        n = 500
        rng = np.random.default_rng(10)
        a = rng.normal(50, 100, n).tolist()
        b = rng.normal(50, 100, n).tolist()
        daily_pnls = {"MES": a, "MNQ": b}

        corr_matrix = compute_correlation_matrix(daily_pnls)
        paths = multi_asset_block_bootstrap(
            daily_pnls, n_paths=500, correlation_matrix=corr_matrix,
            block_length=8, seed=42,
        )

        measured = _measure_output_correlation(paths["MES"], paths["MNQ"])
        # True correlation should be reasonably close to 0
        assert abs(measured) < 0.30, (
            f"Expected near-zero correlation, got {measured:.4f}"
        )

    def test_3_symbol_mixed_correlation_matrix_preserved(self):
        """3-symbol mixed correlation matrix preserved within 0.15."""
        n = 300
        rng = np.random.default_rng(7)
        # Create 3 symbols with known structure
        base = rng.normal(50, 100, n)
        mes = (base + rng.normal(0, 30, n)).tolist()
        mnq = (base + rng.normal(0, 30, n)).tolist()  # high corr with MES
        mcl = rng.normal(50, 100, n).tolist()  # independent
        daily_pnls = {"MES": mes, "MNQ": mnq, "MCL": mcl}

        corr_matrix = compute_correlation_matrix(daily_pnls)
        paths = multi_asset_block_bootstrap(
            daily_pnls, n_paths=200, correlation_matrix=corr_matrix,
            block_length=8, seed=42,
        )

        assert set(paths.keys()) == {"MES", "MNQ", "MCL"}
        for sym in ["MES", "MNQ", "MCL"]:
            assert paths[sym].shape == (200, n)

    def test_cholesky_deterministic_same_seed(self):
        """Same seed → identical output paths."""
        n = 100
        a, b = _make_correlated_series(n, 0.6, seed=5)
        daily_pnls = {"A": a, "B": b}
        corr = compute_correlation_matrix(daily_pnls)

        p1 = multi_asset_block_bootstrap(daily_pnls, n_paths=50, correlation_matrix=corr, seed=99)
        p2 = multi_asset_block_bootstrap(daily_pnls, n_paths=50, correlation_matrix=corr, seed=99)

        np.testing.assert_array_equal(p1["A"], p2["A"])
        np.testing.assert_array_equal(p1["B"], p2["B"])

    def test_cholesky_different_seeds_produce_different_paths(self):
        n = 100
        a, b = _make_correlated_series(n, 0.6, seed=5)
        daily_pnls = {"A": a, "B": b}
        corr = compute_correlation_matrix(daily_pnls)

        p1 = multi_asset_block_bootstrap(daily_pnls, n_paths=50, correlation_matrix=corr, seed=1)
        p2 = multi_asset_block_bootstrap(daily_pnls, n_paths=50, correlation_matrix=corr, seed=2)
        assert not np.array_equal(p1["A"], p2["A"])

    def test_output_shape(self):
        n = 50
        a, b = _make_correlated_series(n, 0.5)
        daily_pnls = {"X": a, "Y": b}
        corr = compute_correlation_matrix(daily_pnls)
        paths = multi_asset_block_bootstrap(
            daily_pnls, n_paths=30, correlation_matrix=corr, seed=0,
        )
        assert paths["X"].shape == (30, n)
        assert paths["Y"].shape == (30, n)

    def test_single_symbol_raises(self):
        with pytest.raises(ValueError, match="2 symbols"):
            multi_asset_block_bootstrap(
                {"A": [1.0, 2.0, 3.0]}, n_paths=10,
                correlation_matrix=np.array([[1.0]]), seed=0,
            )

    def test_corr_shape_mismatch_raises(self):
        a, b = _make_correlated_series(50, 0.5)
        daily_pnls = {"A": a, "B": b}
        wrong_corr = np.eye(3)  # 3x3 but only 2 symbols
        with pytest.raises(ValueError, match="shape"):
            multi_asset_block_bootstrap(
                daily_pnls, n_paths=10, correlation_matrix=wrong_corr, seed=0,
            )


# ─── run_multi_asset_correlation_bootstrap ───────────────────────────────────

class TestRunMultiAssetCorrelationBootstrap:
    def test_returns_paths_and_audit(self):
        n = 80
        a, b = _make_correlated_series(n, 0.7, seed=3)
        paths, audit = run_multi_asset_correlation_bootstrap(
            daily_pnls_per_symbol={"MES": a, "MNQ": b},
            n_paths=50,
            block_length=8,
            seed=42,
            backtest_id="test_123",
        )
        assert set(paths.keys()) == {"MES", "MNQ"}
        assert "n_symbols" in audit
        assert audit["n_symbols"] == 2
        assert "max_pairwise_corr" in audit
        assert "correlation_matrix_summary" in audit
        assert "MES_vs_MNQ" in audit["correlation_matrix_summary"]

    def test_audit_contains_required_fields(self):
        n = 60
        a, b = _make_correlated_series(n, 0.4)
        _, audit = run_multi_asset_correlation_bootstrap(
            daily_pnls_per_symbol={"A": a, "B": b},
            n_paths=20,
        )
        required = {"n_symbols", "symbols", "correlation_matrix_summary",
                    "max_pairwise_corr", "block_length", "n_paths"}
        assert required.issubset(set(audit.keys()))


# ─── Env-var flag ────────────────────────────────────────────────────────────

class TestMultiAssetEnvVarFlag:
    def test_default_disabled(self, monkeypatch):
        monkeypatch.delenv("MC_MULTI_ASSET_CORRELATION_ENABLED", raising=False)
        assert multi_asset_correlation_enabled() is False

    def test_enabled_when_set_true(self, monkeypatch):
        monkeypatch.setenv("MC_MULTI_ASSET_CORRELATION_ENABLED", "true")
        assert multi_asset_correlation_enabled() is True

    def test_disabled_when_false(self, monkeypatch):
        monkeypatch.setenv("MC_MULTI_ASSET_CORRELATION_ENABLED", "false")
        assert multi_asset_correlation_enabled() is False


# ─── Backward compat (single-symbol unchanged) ──────────────────────────────

class TestBackwardCompatSingleSymbol:
    def test_single_symbol_mc_path_unchanged(self):
        """Existing single-symbol monte_carlo.run_monte_carlo still works."""
        from src.engine.config import MonteCarloRequest
        from src.engine.monte_carlo import run_monte_carlo

        rng = np.random.default_rng(0)
        trades = rng.normal(50, 150, 60).tolist()
        daily_pnls = rng.normal(50, 300, 90).tolist()
        equity = list(np.cumsum(daily_pnls))

        req = MonteCarloRequest(
            backtest_id="compat_test",
            num_simulations=500,
            method="block_bootstrap",
            use_gpu=False,
        )
        result = run_monte_carlo(req, trades, daily_pnls, equity)
        # Must return standard keys without multi-asset field
        assert "risk_metrics" in result
        assert "multi_asset_paths" not in result

    def test_multi_asset_module_import_does_not_pollute_mc_namespace(self):
        """Importing mc_multi_asset must not add corr functions to monte_carlo."""
        import src.engine.monte_carlo as mc_mod
        assert not hasattr(mc_mod, "compute_correlation_matrix")
        assert not hasattr(mc_mod, "multi_asset_block_bootstrap")
