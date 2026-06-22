"""Production-scale BCa memory-safety tests.

Wave hardening 2026-06-22, MC BCa scale fix (F1).

Before the fix, scipy BCa's O(n²) jackknife OOM'd at n ≥ 15K sims:
  n=15K → 1.68 GiB  (MemoryError)
  n=20K → 2.98 GiB  (MemoryError)
  n=100K (default) → ~80 GiB (guaranteed OOM, caught by bare `except Exception: pass`)

The fix caps the bootstrap resample input at BCA_MAX_SAMPLE (default 5000).
point_estimate always uses the full sample; only the CI computation is bounded.

Covers:
  - No MemoryError on (12000, 80) paths (n > BCA_MAX_SAMPLE)
  - No MemoryError on (20000, 80) paths (live-probe scale)
  - n_effective ≤ BCA_MAX_SAMPLE when n > cap
  - point_estimate equals full-sample mean(terminal <= 0) — subsampling never touches it
  - ci_high is a finite float (not NaN, not inf)
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.mc_confidence import BCA_MAX_SAMPLE, compute_all_mc_cis


def _make_paths(n_sims: int, n_steps: int = 80, seed: int = 42) -> np.ndarray:
    """Return cumulative-PnL paths with mild downward drift to ensure non-zero ruin."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(-0.05, 1.0, size=(n_sims, n_steps))
    return np.cumsum(returns, axis=1)


class TestBcaScaleNoOOM:
    def test_12k_paths_no_memory_error(self):
        """(12000, 80) paths must return finite ci_high without MemoryError."""
        paths = _make_paths(n_sims=12000)
        result = compute_all_mc_cis(paths, n_resamples=999, seed=42)
        ci = result["probability_of_ruin_ci"]
        assert np.isfinite(ci["ci_high"]), f"ci_high is not finite: {ci['ci_high']}"

    def test_20k_paths_no_memory_error(self):
        """(20000, 80) paths previously OOM'd at 2.98 GiB — must now succeed."""
        paths = _make_paths(n_sims=20000)
        result = compute_all_mc_cis(paths, n_resamples=999, seed=42)
        ci = result["probability_of_ruin_ci"]
        assert np.isfinite(ci["ci_high"]), f"ci_high is not finite: {ci['ci_high']}"


class TestBcaScaleCapContract:
    def test_n_effective_leq_bca_max_sample(self):
        """n_effective must be ≤ BCA_MAX_SAMPLE when n_sims > cap."""
        paths = _make_paths(n_sims=BCA_MAX_SAMPLE + 1000)
        result = compute_all_mc_cis(paths, n_resamples=499, seed=42)
        ci = result["probability_of_ruin_ci"]
        assert "n_effective" in ci, "n_effective key must be present in CI dict"
        assert ci["n_effective"] <= BCA_MAX_SAMPLE, (
            f"n_effective={ci['n_effective']} exceeds BCA_MAX_SAMPLE={BCA_MAX_SAMPLE}"
        )

    def test_n_effective_equals_full_n_when_below_cap(self):
        """When n_sims ≤ BCA_MAX_SAMPLE, n_effective must equal n_sims."""
        small_n = min(200, BCA_MAX_SAMPLE)
        paths = _make_paths(n_sims=small_n)
        result = compute_all_mc_cis(paths, n_resamples=199, seed=42)
        ci = result["probability_of_ruin_ci"]
        assert ci["n_effective"] == small_n, (
            f"n_effective={ci['n_effective']} should equal n_sims={small_n} when below cap"
        )

    def test_point_estimate_equals_full_sample_ruin(self):
        """point_estimate must equal mean(terminal <= 0) over the FULL paths array.

        Subsampling only applies to the CI computation — the point estimate is
        always computed on the full dataset. This is the institutional-safety
        invariant: subsampling widens CIs (conservative), never shifts the estimate.
        """
        paths = _make_paths(n_sims=BCA_MAX_SAMPLE + 2000, seed=7)
        result = compute_all_mc_cis(paths, n_resamples=499, seed=42)
        ci = result["probability_of_ruin_ci"]

        terminal = paths[:, -1]
        expected_ruin = float(np.mean(terminal <= 0))
        assert ci["point_estimate"] == pytest.approx(expected_ruin, abs=1e-9), (
            f"point_estimate={ci['point_estimate']} != full-sample ruin={expected_ruin} "
            "(subsampling must never touch the point estimate)"
        )

    def test_all_metrics_have_n_effective(self):
        """All four metric CI dicts must carry the n_effective key."""
        paths = _make_paths(n_sims=BCA_MAX_SAMPLE + 500)
        result = compute_all_mc_cis(paths, n_resamples=299, seed=42)
        for metric in ("survival_rate", "probability_of_ruin", "max_drawdown_p5", "cvar95"):
            assert "n_effective" in result[metric], (
                f"n_effective key missing from {metric} CI dict"
            )
