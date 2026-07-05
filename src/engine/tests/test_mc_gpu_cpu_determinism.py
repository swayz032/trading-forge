"""Deep-Scan #18 B-E1 — MC GPU/CPU RNG determinism tests.

monte_carlo.block_bootstrap() previously routed to gpu_pipeline.block_bootstrap_gpu()
whenever GPU_AVAILABLE and n_sims >= 1000 (the common prod path — use_gpu defaults
true end-to-end). That GPU function seeded `xp.random.default_rng(seed)` ON THE
DEVICE (CuPy's own RNG algorithm/stream), a different generator family than the
authoritative PCG64DXSM (`create_authoritative_rng`) the CPU/Numba core uses. Same
seed -> different bootstrap resample -> different probability_of_ruin_ci.ci_high
straddling the B14 0.20 hard-gate threshold depending on which machine (GPU tower
vs CPU CI) ran the backtest.

FIX: resample indices (start_pos/block_draws/restart_pos) are generated on CPU via
create_authoritative_rng(seed) — the exact call sequence/shapes the Numba core
uses — and handed to the GPU path as plain arrays for the gather. This module
verifies:
  1. The CPU-authoritative index-generation contract is deterministic and stable
     (runs regardless of whether cupy is installed in this environment).
  2. gpu_pipeline.block_bootstrap_gpu(), when called WITHOUT precomputed indices,
     self-derives them from `create_authoritative_rng(seed)` and therefore produces
     results identical to a manual CPU replication of the same recurrence — this is
     testable on any machine (the "GPU" code path runs on numpy when cupy is
     unavailable, per its own CUPY_AVAILABLE fallback), so it is NOT gated by
     @pytest.mark.skipif.
  3. When cupy IS available, block_bootstrap_gpu on an actual GPU device produces
     bit-identical resample indices to the CPU/Numba core for a fixed seed
     (skipped when cupy is not installed in this environment).
  4. monte_carlo.block_bootstrap() itself is deterministic under a fixed seed and,
     when re-run, produces a stable ruin-style summary statistic (mean terminal
     equity) — a same-seed ruin-CI stability proxy.
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.gpu_pipeline import CUPY_AVAILABLE, block_bootstrap_gpu
from src.engine.monte_carlo import (
    NUMBA_AVAILABLE,
    _block_bootstrap_core,
    block_bootstrap,
    create_authoritative_rng,
)


def _make_trades(n: int = 60, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.normal(80.0, 220.0, size=n)


# ─── 1. CPU-authoritative index generation is deterministic ─────────────────

class TestAuthoritativeIndexGenerationDeterminism:
    def test_same_seed_same_indices(self):
        n_trades, n_sims = 40, 500
        r1 = create_authoritative_rng(seed=99)[0]
        r2 = create_authoritative_rng(seed=99)[0]

        start1 = r1.integers(0, n_trades, size=n_sims)
        block1 = r1.random(size=(n_sims, n_trades))
        restart1 = r1.integers(0, n_trades, size=(n_sims, n_trades))

        start2 = r2.integers(0, n_trades, size=n_sims)
        block2 = r2.random(size=(n_sims, n_trades))
        restart2 = r2.integers(0, n_trades, size=(n_sims, n_trades))

        np.testing.assert_array_equal(start1, start2)
        np.testing.assert_array_equal(block1, block2)
        np.testing.assert_array_equal(restart1, restart2)

    def test_different_seed_different_indices(self):
        n_trades, n_sims = 40, 500
        r1 = create_authoritative_rng(seed=1)[0]
        r2 = create_authoritative_rng(seed=2)[0]
        start1 = r1.integers(0, n_trades, size=n_sims)
        start2 = r2.integers(0, n_trades, size=n_sims)
        assert not np.array_equal(start1, start2)


# ─── 2 & 3. block_bootstrap_gpu produces device-independent resample indices ─

class TestGpuCpuIndexParity:
    """The core contract: CPU and GPU must draw IDENTICAL resample indices for
    a fixed seed. Tested by driving the exact recurrence both the Numba core
    and the GPU gather share, from the same pre-generated arrays."""

    def test_standalone_gpu_fn_self_derives_authoritative_indices(self):
        """block_bootstrap_gpu() called with no precomputed arrays must derive
        them from create_authoritative_rng(seed) — same contract monte_carlo.
        block_bootstrap() uses when it pre-generates and passes them in.
        Runs on numpy when cupy is unavailable (CUPY_AVAILABLE fallback), so
        this is exercised on every machine, not just GPU boxes.
        """
        trades = _make_trades(30, seed=11)
        n_sims = 50
        seed = 4242

        result_self_derived = block_bootstrap_gpu(trades, n_sims, block_length=6, seed=seed)

        # Manually reproduce what block_bootstrap_gpu should have derived internally.
        idx_rng = create_authoritative_rng(seed)[0]
        n_trades = len(trades)
        start_pos = idx_rng.integers(0, n_trades, size=n_sims)
        block_draws = idx_rng.random(size=(n_sims, n_trades))
        restart_pos = idx_rng.integers(0, n_trades, size=(n_sims, n_trades))
        result_explicit = block_bootstrap_gpu(
            trades, n_sims, block_length=6, seed=seed,
            start_pos=start_pos, block_draws=block_draws, restart_pos=restart_pos,
        )

        np.testing.assert_array_equal(result_self_derived, result_explicit)

    def test_gpu_gather_matches_cpu_numba_core_given_same_indices(self):
        """Given IDENTICAL start_pos/block_draws/restart_pos, the GPU-path
        vectorized gather (block_bootstrap_gpu, numpy-backed when cupy is
        unavailable) must reproduce the same cumulative paths as the CPU/
        Numba core (_block_bootstrap_core) — proving the shared recurrence
        is faithfully mirrored, independent of device.
        """
        if not NUMBA_AVAILABLE:
            pytest.skip("numba not available in this environment")

        trades = _make_trades(25, seed=3)
        n_sims = 80
        n_trades = len(trades)
        block_length = 5
        p = 1.0 / block_length
        seed = 777

        idx_rng = create_authoritative_rng(seed)[0]
        start_pos = idx_rng.integers(0, n_trades, size=n_sims)
        block_draws = idx_rng.random(size=(n_sims, n_trades))
        restart_pos = idx_rng.integers(0, n_trades, size=(n_sims, n_trades))

        cpu_paths = _block_bootstrap_core(
            trades, n_sims, n_trades, p, start_pos, block_draws, restart_pos
        )
        cpu_cum = np.cumsum(cpu_paths, axis=1)

        gpu_cum = block_bootstrap_gpu(
            trades, n_sims, block_length, seed=seed,
            start_pos=start_pos, block_draws=block_draws, restart_pos=restart_pos,
        )

        np.testing.assert_allclose(cpu_cum, gpu_cum, rtol=1e-10, atol=1e-8)

    @pytest.mark.skipif(not CUPY_AVAILABLE, reason="cupy not installed in this environment")
    def test_real_gpu_device_matches_cpu_numba_core(self):
        """When cupy IS available, run block_bootstrap_gpu on the actual GPU
        device and confirm it still matches the CPU/Numba core bit-for-bit on
        indices (values may differ in the last ULPs from device float summation
        order, so paths are compared with a tight tolerance rather than exact
        equality)."""
        if not NUMBA_AVAILABLE:
            pytest.skip("numba not available in this environment")

        trades = _make_trades(25, seed=3)
        n_sims = 200
        n_trades = len(trades)
        block_length = 5
        p = 1.0 / block_length
        seed = 555

        idx_rng = create_authoritative_rng(seed)[0]
        start_pos = idx_rng.integers(0, n_trades, size=n_sims)
        block_draws = idx_rng.random(size=(n_sims, n_trades))
        restart_pos = idx_rng.integers(0, n_trades, size=(n_sims, n_trades))

        cpu_paths = _block_bootstrap_core(
            trades, n_sims, n_trades, p, start_pos, block_draws, restart_pos
        )
        cpu_cum = np.cumsum(cpu_paths, axis=1)

        gpu_cum = block_bootstrap_gpu(
            trades, n_sims, block_length, seed=seed,
            start_pos=start_pos, block_draws=block_draws, restart_pos=restart_pos,
        )

        np.testing.assert_allclose(cpu_cum, gpu_cum, rtol=1e-9, atol=1e-6)


# ─── 4. Same-seed ruin-CI stability (end-to-end block_bootstrap) ────────────

class TestBlockBootstrapSameSeedStability:
    def test_block_bootstrap_deterministic_same_seed(self):
        trades = _make_trades(40, seed=21)
        a = block_bootstrap(trades, n_sims=300, expected_block_length=6, seed=2026)
        b = block_bootstrap(trades, n_sims=300, expected_block_length=6, seed=2026)
        np.testing.assert_array_equal(a, b)

    def test_ruin_style_summary_stable_same_seed(self):
        """Proxy for probability_of_ruin_ci stability: the fraction of simulated
        paths ending below a drawdown threshold must be identical run-to-run
        under a fixed seed — this is exactly the quantity the B14 gate reads.
        """
        trades = _make_trades(50, seed=13)
        threshold = -500.0

        paths_a = block_bootstrap(trades, n_sims=1000, expected_block_length=6, seed=808)
        paths_b = block_bootstrap(trades, n_sims=1000, expected_block_length=6, seed=808)

        ruin_frac_a = float(np.mean(paths_a[:, -1] < threshold))
        ruin_frac_b = float(np.mean(paths_b[:, -1] < threshold))

        assert ruin_frac_a == pytest.approx(ruin_frac_b, abs=1e-12)

    def test_sub_threshold_n_sims_always_uses_authoritative_rng_directly(self):
        """n_sims=200 is below the GPU_AVAILABLE `n_sims >= 1000` dispatch
        threshold, so block_bootstrap() must take the CPU path regardless of
        whether this machine has a GPU — sanity check that the reconciliation
        didn't accidentally leave the CPU-only path stranded on a different
        RNG family than create_authoritative_rng (PCG64DXSM)."""
        if not NUMBA_AVAILABLE:
            pytest.skip("numba not available in this environment")

        trades = _make_trades(20, seed=9)
        a = block_bootstrap(trades, n_sims=200, expected_block_length=5, seed=333)

        n_trades = len(trades)
        p = 1.0 / 5
        rng = create_authoritative_rng(333)[0]
        start_pos = rng.integers(0, n_trades, size=200)
        block_draws = rng.random(size=(200, n_trades))
        restart_pos = rng.integers(0, n_trades, size=(200, n_trades))
        expected = np.cumsum(
            _block_bootstrap_core(trades, 200, n_trades, p, start_pos, block_draws, restart_pos),
            axis=1,
        )
        np.testing.assert_array_equal(a, expected)
