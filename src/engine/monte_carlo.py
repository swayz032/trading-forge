"""Monte Carlo simulation engine — GPU-accelerated via cuPy, falls back to NumPy.

Wave 8 overhaul:
  - Block bootstrap (stationary) replaces IID for autocorrelation preservation
    in the trade-resample path.
  - FIX 1 (2026-06-22): daily-returns path (return_bootstrap) now also uses
    block bootstrap when lag-1 autocorrelation >= MC_IID_AC_THRESHOLD (default 0.05).
    IID was being used unconditionally despite the docstring claim; this understated
    tail drawdown for autocorrelated intraday strategies.
  - Stress testing multipliers (3 severity levels)
  - Synthetic catastrophic trade injection
  - Per-firm survival simulation
  - Convergence checking at 1st percentile
  - OOS-only warning gate
  - Fixed "both" method padding bug (separate reporting)

Usage:
    python -m src.engine.monte_carlo --config '{"backtest_id":"...","trades":[...],"daily_pnls":[...]}'
"""

from __future__ import annotations

# A1 Determinism: import FIRST, before numpy. Sets BLAS env vars at load time.
import os as _os

if _os.environ.get("DETERMINISM_MODE", "").lower() == "true":
    from src.engine.determinism import enable_determinism as _enable_det
    _enable_det()
else:
    import src.engine.determinism  # noqa: F401 — side-effect: sets env vars

import json
import sys
import time

import numpy as np

try:
    import cupy as cp
    GPU_AVAILABLE = True
except ImportError:
    cp = None
    GPU_AVAILABLE = False

try:
    from numba import njit
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False

from numpy.random import PCG64DXSM, SeedSequence

from src.engine.config import MonteCarloRequest
from src.engine.nvtx_markers import annotate

DEFAULT_NUM_SIMULATIONS = 100_000


# ─── Structured Error Types ──────────────────────────────────────

class ExtrapolationExceededError(ValueError):
    """Raised when return_bootstrap n_days exceeds MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER.

    Wave 27.5 Pass A.1 — CRITICAL #3.
    Callers that catch this should return the structured error result dict:
      {"status": "extrapolation_exceeded", "requested_n_days": ..., ...}
    """
    def __init__(
        self,
        requested_n_days: int,
        history_len: int,
        hard_fail_multiplier: float,
        recommended_n_days: int,
    ) -> None:
        self.requested_n_days = requested_n_days
        self.history_len = history_len
        self.hard_fail_multiplier = hard_fail_multiplier
        self.recommended_n_days = recommended_n_days
        super().__init__(
            f"MC extrapolation hard-fail: n_days={requested_n_days} exceeds "
            f"{hard_fail_multiplier}× history ({history_len} days). "
            f"Reduce to ≤{recommended_n_days} days or set "
            f"MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER=infinity to opt out."
        )


def create_authoritative_rng(seed: int, n_streams: int = 1) -> list[np.random.Generator]:
    """Create reproducible RNG streams using PCG64DXSM + SeedSequence.

    PCG64DXSM: 128-bit, period 2^128, guaranteed reproducible.
    SeedSequence.spawn(): independent parallel streams for MC batches.
    """
    ss = SeedSequence(seed)
    if n_streams == 1:
        return [np.random.Generator(PCG64DXSM(ss))]
    child_seeds = ss.spawn(n_streams)
    return [np.random.Generator(PCG64DXSM(s)) for s in child_seeds]


def adjust_p_value_bonferroni(raw_p: float, n_variants: int) -> tuple:
    """Bonferroni correction for multiple hypothesis testing.

    Returns (raw_p, adjusted_threshold, passes).
    """
    threshold = 0.05 / max(1, n_variants)
    return (raw_p, threshold, raw_p < threshold)


def get_array_module(use_gpu: bool):
    """Return cupy if GPU requested and available, else numpy."""
    if use_gpu and GPU_AVAILABLE:
        return cp
    return np


def _to_numpy(arr, xp) -> np.ndarray:
    """Convert array to numpy (handles both cupy and numpy)."""
    if xp is np:
        return arr
    return cp.asnumpy(arr)


# ─── Bootstrap Methods ───────────────────────────────────────────


@annotate("forge/mc_trade_resample")
def trade_resample(
    trades: np.ndarray,
    n_sims: int,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Resample trade P&Ls with replacement, compute equity paths.

    Shuffles the trade sequence n_sims times to test: "If these same trades
    happened in a different order, what would the drawdown look like?"

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot resample empty trades array")

    if xp is None:
        xp = np

    trades_xp = xp.asarray(trades)
    # DS#20 T-B1 (2026-07-05): derive the resample INDICES on CPU with the authoritative
    # PCG64DXSM generator, then hand only the (cheap) index array to the GPU for the gather.
    # Previously the GPU branch seeded cupy's own `default_rng(seed)` — a DIFFERENT generator
    # family than PCG64DXSM — so this method (trade_resample, the DEFAULT MC method:
    # method="trade_resample", use_gpu defaults True) produced a DIFFERENT bootstrap resample
    # (and hence a different probability_of_ruin_ci.ci_high straddling the B14 0.20 hard gate)
    # depending on whether the run executed on the GPU tower or a CPU-only CI/dev box. This is
    # the exact non-determinism block_bootstrap() fixed in deepscan18 B-E1 (lines ~506-524) but
    # which was never applied to this sibling default method. Random DRAWS are now identical
    # CPU vs GPU for a given seed; only the vectorized gather + cumsum run on device.
    cpu_rng = create_authoritative_rng(seed)[0]
    indices_np = cpu_rng.integers(0, len(trades), size=(n_sims, len(trades)))
    indices = indices_np if xp is np else xp.asarray(indices_np)
    sampled = trades_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


@annotate("forge/mc_return_bootstrap")
def return_bootstrap(
    daily_returns: np.ndarray,
    n_sims: int,
    n_days: int,
    seed: int = 42,
    xp=None,
    _metadata_out: dict | None = None,
) -> np.ndarray:
    """Bootstrap daily returns to generate simulated equity paths.

    Returns:
        2D array of shape (n_sims, n_days) — cumulative equity paths
    """
    if len(daily_returns) == 0:
        raise ValueError("Cannot bootstrap empty daily returns array")

    if xp is None:
        xp = np

    # F-9 FIX: warn when n_days extrapolates far beyond available history.
    # IID bootstrap resamples with replacement so extrapolation is technically
    # valid, but the resulting tails become unreliable when n_days >> len(history).
    #
    # Wave 27.5 Pass A.1 — CRITICAL #3: Hard-fail at HARD_FAIL_MULTIPLIER (default 2.0).
    # Institutional standard: hard-fail at 2× rather than silently capping at 5×.
    # MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER env var controls the threshold.
    # Set to "inf" or "infinity" to disable the hard fail (backward-compat opt-out).
    # Soft warn at 1.5× and soft cap at MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION (default 5.0)
    # are preserved ONLY when hard fail is disabled.
    _max_extrap = float(_os.environ.get("MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION", "5.0"))
    _warn_threshold = 1.5
    _hard_fail_env = _os.environ.get("MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER", "2.0").lower()
    _hard_fail_disabled = _hard_fail_env in ("inf", "infinity", "none", "0")
    _hard_fail_multiplier = float("inf") if _hard_fail_disabled else float(_hard_fail_env)
    _n_hist = len(daily_returns)

    if n_days > _n_hist * _warn_threshold:
        _ratio = n_days / _n_hist
        import sys as _sys
        print(
            f"[return_bootstrap WARNING] n_days={n_days} extrapolates {_ratio:.1f}× "
            f"beyond history length {_n_hist}. Bootstrap tails may be unreliable beyond 1.5× "
            f"(hard fail at: {_hard_fail_multiplier}×, soft cap: {_max_extrap}×). "
            f"Operator should verify simulation horizon.",
            file=_sys.stderr,
        )

    # CRITICAL #3: Hard-fail before executing bootstrap when extrapolation exceeds limit.
    # Raises ValueError so run_monte_carlo catches it and returns a structured error result.
    # This is NOT silently capped — the caller must explicitly request a shorter horizon.
    if not _hard_fail_disabled and n_days > _n_hist * _hard_fail_multiplier:
        raise ExtrapolationExceededError(
            requested_n_days=n_days,
            history_len=_n_hist,
            hard_fail_multiplier=_hard_fail_multiplier,
            recommended_n_days=int(_n_hist * _hard_fail_multiplier),
        )

    # Soft cap (only reached when hard fail is disabled via env var opt-out)
    if n_days > _n_hist * _max_extrap:
        _capped_days = int(_n_hist * _max_extrap)
        import sys as _sys
        print(
            f"[return_bootstrap WARNING] n_days={n_days} exceeds {_max_extrap}× cap "
            f"({_capped_days} days). Capping at {_capped_days} to prevent degenerate extrapolation. "
            f"Set MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION to override.",
            file=_sys.stderr,
        )
        n_days = _capped_days

    # FIX 1 — Block bootstrap for autocorrelated daily returns.
    #
    # Previous behavior: always IID resampling via rng.integers().
    # New behavior: detect lag-1 autocorrelation; when |AC| >= IID_AC_THRESHOLD
    #   (default 0.05, institutional standard), route to arch_stationary_bootstrap
    #   (block bootstrap). IID is only valid for uncorrelated series.
    #
    # Rationale: the docstring claimed "Block bootstrap (stationary) replaces IID"
    # but the daily-returns path bypassed the autocorr-detection machinery used by
    # the trade-resample path. For autocorrelated intraday strategies (AR(1) > 0.1),
    # IID resampling breaks consecutive loss/gain runs and understates tail drawdown —
    # the exact number protecting against Topstep trailing-DD blowup.
    #
    # Block length = optimal_block_length(daily_returns) — same approach as trade path.
    # IID_AC_THRESHOLD matches the institutional floor: |AC| < 0.05 = effectively IID.
    #
    # GPU path falls back to IID (arch_stationary_bootstrap is CPU-only).
    # Extrapolation guard and PCG64DXSM seeding are preserved exactly.
    _IID_AC_THRESHOLD = float(_os.environ.get("MC_IID_AC_THRESHOLD", "0.05"))
    _use_block = False

    # FIX 2 (deep-scan #9 2026-07-02): Run autocorr check unconditionally — not just
    # when xp is np. Previously: GPU path skipped detection entirely and always took
    # the IID fast path, even for autocorrelated series, understating tail drawdown.
    # Now: detect autocorrelation regardless of xp; when GPU is active and block
    # bootstrap is required, route to CPU arch_stationary_bootstrap for correctness.
    if len(daily_returns) >= 2:
        _ac_val, _ac_failed = _safe_autocorrelation(daily_returns)
        if _ac_failed or abs(_ac_val) >= _IID_AC_THRESHOLD:
            _use_block = True

    if _use_block:
        if xp is not np:
            # Block bootstrap required but GPU active — correctness over speed.
            import sys as _sys
            print(
                "[return_bootstrap] GPU active but autocorrelation requires block bootstrap — "
                "routing to CPU block-bootstrap path (correctness over speed).",
                file=_sys.stderr,
            )
            if _metadata_out is not None:
                _metadata_out["gpu_block_bootstrap_cpu_fallback"] = True
        # Route through stationary block bootstrap (preserves autocorrelation structure)
        _block_len = optimal_block_length(daily_returns)
        paths = arch_stationary_bootstrap(
            daily_returns,
            n_sims=n_sims,
            seed=seed,
            block_length=_block_len,
        )
        # arch_stationary_bootstrap returns (n_sims, n_trades); we need (n_sims, n_days)
        # Trim or extend to n_days via resampling rows
        if paths.shape[1] > n_days:
            paths = paths[:, :n_days]
        elif paths.shape[1] < n_days:
            # Rare: block bootstrap produced fewer steps than requested.
            # Pad by repeating the last column (conservative — equity stays flat).
            _pad = np.zeros((n_sims, n_days - paths.shape[1]))
            _pad[:] = paths[:, -1:]
            paths = np.concatenate([paths, _pad], axis=1)
        return paths

    returns_xp = xp.asarray(daily_returns)
    # Fix 3: was xp.random.default_rng(seed) unconditionally, which on CPU produces an
    # SFC64-backed generator — inconsistent with trade_resample() which uses PCG64DXSM.
    # In "both" mode this caused inter-method RNG family inconsistency.
    # Now: CPU path uses create_authoritative_rng() (PCG64DXSM), GPU path keeps xp.random.
    if xp is np:
        rng = create_authoritative_rng(seed)[0]
    else:
        rng = xp.random.default_rng(seed)
    indices = rng.integers(0, len(daily_returns), size=(n_sims, n_days))
    sampled = returns_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


def _safe_autocorrelation(trades: np.ndarray) -> tuple[float, bool]:
    """Compute lag-1 autocorrelation with NaN guard and fallback detection.

    HIGH #7 — MC Autocorrelation Detection Fragile.
    np.corrcoef() produces NaN when trades have near-zero variance
    (many breakeven fills) or when all values are identical.
    This guard ensures block-bootstrap is chosen (safer assumption) when
    autocorrelation cannot be reliably measured.

    Design principle: "When in doubt, prefer block-bootstrap. False-positive
    autocorrelation detection is preferable to false-negative, which silently
    underestimates tail risk."

    Args:
        trades: 1D array of trade P&Ls (len >= 2)

    Returns:
        (autocorrelation_value, detection_failed).
        detection_failed=True means the value is unreliable → block-bootstrap
        should be forced regardless of the returned value.
    """
    if len(trades) < 2:
        return 0.0, True

    # Primary: scipy.stats.pearsonr — returns (r, p_value), handles edge cases
    try:
        from scipy import stats as _sp_stats
        r, p_value = _sp_stats.pearsonr(trades[:-1], trades[1:])
        if np.isnan(r) or np.isinf(r):
            # pearsonr returned NaN/Inf — near-zero variance case
            import sys as _sys
            print(
                "[autocorr] scipy.stats.pearsonr returned NaN/Inf — "
                "defaulting to block-bootstrap (safer assumption).",
                file=_sys.stderr,
            )
            return 0.0, True
        # Low-confidence detection: p-value > 0.5 means we cannot reliably distinguish
        # autocorrelation from noise. Force block-bootstrap in this case.
        if p_value > 0.5:
            return r, True  # detected but unreliable — treat as failed
        return r, False
    except ImportError:
        pass  # scipy not available — fall through to corrcoef fallback

    # Fallback: np.corrcoef with explicit NaN guard
    try:
        autocorr = np.corrcoef(trades[:-1], trades[1:])[0, 1]
    except Exception:
        import sys as _sys
        print(
            "[autocorr] np.corrcoef raised an exception — "
            "defaulting to block-bootstrap (safer assumption).",
            file=_sys.stderr,
        )
        return 0.0, True

    if np.isnan(autocorr) or np.isinf(autocorr):
        import sys as _sys
        print(
            "[autocorr] np.corrcoef returned NaN/Inf — "
            "defaulting to block-bootstrap (safer assumption).",
            file=_sys.stderr,
        )
        return 0.0, True

    return float(autocorr), False


def optimal_block_length(trades: np.ndarray) -> int:
    """Data-driven block length: PPW (2004) when arch available, else cube-root fallback.

    HIGH #7 (Wave 27.5 Pass C.1): Uses _safe_autocorrelation() instead of bare
    np.corrcoef() to guard against NaN when trades have near-zero variance
    (breakeven fills, identical values). When detection fails or is low-confidence,
    block-bootstrap is forced (conservative assumption preserving tail risk).

    Args:
        trades: 1D array of trade P&Ls

    Returns:
        Block length clamped to [3, n//10]
    """
    n = len(trades)
    _autocorr_detection_failed = False
    try:
        from arch.bootstrap import optimal_block_length as ppw_obl
        result = ppw_obl(trades)
        block_len = int(np.ceil(float(result["stationary"].iloc[0])))
    except (ImportError, Exception):
        # Fallback: cube-root + autocorrelation
        block_len = int(np.ceil(n ** (1 / 3)))
        if n > 1:
            autocorr, _autocorr_detection_failed = _safe_autocorrelation(trades)
            # When detection failed: force block-length expansion (safer assumption).
            # A false-positive (spurious high autocorr) → larger blocks → more
            # conservative bootstrap is always preferable to underestimating tail risk.
            if _autocorr_detection_failed or autocorr > 0.15:
                block_len = int(block_len * 1.5)
    clamped = max(3, min(block_len, n // 10))

    # Audit row for detection failures (best-effort — never blocks bootstrap)
    if _autocorr_detection_failed:
        try:
            from src.engine.audit_writer import write_audit_row_sync
            write_audit_row_sync(
                action="monte_carlo.autocorr_detection_failed",
                entity_type="monte_carlo",
                entity_id="optimal_block_length",
                severity="warn",
                payload={
                    "n_trades": n,
                    "fallback": "block_bootstrap_forced",
                    "block_length": clamped,
                    "reason": "NaN/low-confidence autocorrelation — conservative block-bootstrap enforced",
                },
            )
        except Exception:
            pass  # Audit write failure must never block bootstrap computation

    return clamped


if NUMBA_AVAILABLE:
    @njit(cache=True)
    def _block_bootstrap_core(trades, n_sims, n_trades, p,
                               start_pos, block_draws, restart_pos):
        """JIT-compiled inner loop for block bootstrap."""
        paths = np.zeros((n_sims, n_trades))
        for sim in range(n_sims):
            pos = start_pos[sim]
            for idx in range(n_trades):
                paths[sim, idx] = trades[pos % n_trades]
                if block_draws[sim, idx] < p:
                    pos = restart_pos[sim, idx]
                else:
                    pos += 1
        return paths


def _block_bootstrap_python(trades, n_sims, n_trades, p, rng):
    """Pure Python fallback for block bootstrap."""
    paths = np.zeros((n_sims, n_trades))
    for sim in range(n_sims):
        pos = rng.integers(0, n_trades)
        for idx in range(n_trades):
            paths[sim, idx] = trades[pos % n_trades]
            if rng.random() < p:
                pos = rng.integers(0, n_trades)
            else:
                pos += 1
    return paths


@annotate("forge/mc_block_bootstrap")
def block_bootstrap(
    trades: np.ndarray,
    n_sims: int,
    expected_block_length: int = 8,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Stationary bootstrap — random block lengths preserve autocorrelation.

    Uses circular wrapping and geometric distribution for block boundaries.
    IID bootstrap destroys consecutive loss streaks (underestimates risk by
    40-60%). Block bootstrap preserves serial dependence in trade sequences.

    Uses Numba JIT when available (50-100x faster), falls back to pure Python.

    Args:
        trades: 1D array of trade P&Ls
        n_sims: Number of simulation paths
        expected_block_length: Mean block length (geometric distribution)
        seed: RNG seed for reproducibility
        xp: Array module (ignored — block bootstrap is CPU-only)

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot bootstrap empty trades array")

    n_trades = len(trades)
    p = 1.0 / expected_block_length

    # GPU path: use CuPy vectorized bootstrap when available
    #
    # FIX (deepscan18 B-E1, 2026-07-05): previously this called
    # `block_bootstrap_gpu(trades, n_sims, expected_block_length, seed)`, which
    # internally seeded `xp.random.default_rng(seed)` ON THE GPU (cupy's own RNG
    # algorithm/stream) — a DIFFERENT generator family than the authoritative
    # PCG64DXSM (`create_authoritative_rng`) the CPU/Numba path below uses. Same
    # seed therefore produced a DIFFERENT bootstrap resample on GPU (tower) vs
    # CPU (CI / non-GPU dev boxes), and hence a different
    # `probability_of_ruin_ci.ci_high` straddling the B14 0.20 hard-gate
    # threshold depending on which machine happened to run the backtest.
    # `use_gpu` defaults true end-to-end, so this was the common path in prod,
    # not an edge case.
    #
    # FIX: generate the resample INDICES (start_pos/block_draws/restart_pos) on
    # CPU with the authoritative RNG — the exact same call sequence/shapes the
    # Numba core below uses — and hand only those (cheap) index arrays to the
    # GPU for the gather + cumsum. The random DRAWS are now identical CPU vs
    # GPU for a given seed; only the vectorized gather runs on device. See
    # gpu_pipeline.block_bootstrap_gpu() and test_mc_gpu_cpu_determinism.py.
    if GPU_AVAILABLE and n_sims >= 1000:
        try:
            from src.engine.gpu_pipeline import block_bootstrap_gpu
            _idx_rng = create_authoritative_rng(seed)[0]
            _start_pos = _idx_rng.integers(0, n_trades, size=n_sims)
            _block_draws = _idx_rng.random(size=(n_sims, n_trades))
            _restart_pos = _idx_rng.integers(0, n_trades, size=(n_sims, n_trades))
            return block_bootstrap_gpu(
                trades, n_sims, expected_block_length, seed,
                start_pos=_start_pos, block_draws=_block_draws, restart_pos=_restart_pos,
            )
        except Exception:
            pass  # Fall through to CPU

    # F-1: Use PCG64DXSM (same family as every other MC path) instead of SFC64.
    # NOTE: created here (not before the GPU attempt above) so the CPU-only
    # code path below is byte-identical to pre-deepscan18 behavior — the GPU
    # branch now derives its own index arrays from a fresh, independently-seeded
    # authoritative RNG rather than sharing/consuming this one.
    rng = create_authoritative_rng(seed)[0]

    if NUMBA_AVAILABLE:
        # Pre-generate all random numbers (Numba doesn't support default_rng)
        start_pos = rng.integers(0, n_trades, size=n_sims)
        block_draws = rng.random(size=(n_sims, n_trades))
        restart_pos = rng.integers(0, n_trades, size=(n_sims, n_trades))
        paths = _block_bootstrap_core(trades, n_sims, n_trades, p,
                                       start_pos, block_draws, restart_pos)
    else:
        paths = _block_bootstrap_python(trades, n_sims, n_trades, p, rng)

    return np.cumsum(paths, axis=1)


@annotate("forge/mc_arch_stationary")
def arch_stationary_bootstrap(
    trades: np.ndarray,
    n_sims: int,
    seed: int = 42,
    block_length: int | None = None,
) -> np.ndarray:
    """Dependence-aware stationary bootstrap using arch StationaryBootstrap.

    Uses the arch library's StationaryBootstrap which draws block lengths from
    a geometric distribution (mean = block_length), preserving serial dependence
    in the trade sequence. This is the authoritative method for autocorrelated
    returns — IID resampling underestimates tail risk by 40-60% when trades
    have momentum or mean-reversion structure.

    Falls back to block_bootstrap if arch is not installed.

    Args:
        trades: 1D array of trade P&Ls
        n_sims: Number of simulation paths
        seed: RNG seed for reproducibility (passed to StationaryBootstrap)
        block_length: Mean block length for geometric distribution.
            If None, computed via optimal_block_length() (PPW 2004).

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot bootstrap empty trades array")

    computed_block_len = block_length if block_length is not None else optimal_block_length(trades)

    try:
        from arch.bootstrap import StationaryBootstrap

        bs = StationaryBootstrap(computed_block_len, trades, seed=seed)
        paths = []
        for (data,), _ in bs.bootstrap(n_sims):
            equity = np.cumsum(data)
            paths.append(equity)
        return np.array(paths)

    except ImportError:
        # arch not installed — fall back to our own block_bootstrap implementation
        return block_bootstrap(
            trades, n_sims,
            expected_block_length=computed_block_len,
            seed=seed,
        )


# ─── Stress Testing ─────────────────────────────────────────────


@annotate("forge/mc_stress_test")
def stress_test_trades(
    trades: np.ndarray,
    loss_multiplier: float = 1.5,
    win_reduction: float = 1.0,
    win_rate_reduction: float = 0.0,
    seed: int = 123,
) -> np.ndarray:
    """Amplify losses and/or reduce wins for stress testing.

    Levels:
      Level 1 (moderate): loss_multiplier=1.5
      Level 2 (severe): loss_multiplier=2.0, win_reduction=0.75
      Level 3 (extreme): loss_multiplier=2.5, win_reduction=0.5, wr_reduction=0.10

    Args:
        trades: 1D array of trade P&Ls
        loss_multiplier: Factor to multiply losing trades by (>1 = worse losses)
        win_reduction: Factor to multiply winning trades by (<1 = smaller wins)
        win_rate_reduction: Fraction of winning trades to flip to losses (0-1)

    Returns:
        Stressed trade array (copy, original unchanged)
    """
    stressed = trades.copy()

    # Amplify losses
    losses_mask = stressed < 0
    stressed[losses_mask] *= loss_multiplier

    # Reduce wins
    wins_mask = stressed > 0
    stressed[wins_mask] *= win_reduction

    # Flip some wins to losses (simulate reduced win rate)
    if win_rate_reduction > 0:
        win_indices = np.where(wins_mask)[0]
        n_flip = int(len(win_indices) * win_rate_reduction)
        if n_flip > 0:
            # F-2: Use PCG64DXSM for RNG family consistency across all MC paths.
            rng = create_authoritative_rng(seed)[0]
            flip_indices = rng.choice(win_indices, size=n_flip, replace=False)
            # Flip to a loss equal to the median loss
            median_loss = np.median(trades[losses_mask]) if np.any(losses_mask) else -100.0
            stressed[flip_indices] = median_loss

    return stressed


def inject_synthetic_stress(
    trades: np.ndarray,
    frequency: float = 2.0 / 250,
    seed: int = 456,
    max_loss_cap: float = 0.0,
) -> np.ndarray:
    """Inject synthetic catastrophic trades (5x worst normal loss) at realistic frequency.

    Simulates flash crashes, fat-tail events, and liquidity gaps that don't appear
    in historical data but occur in live trading. Injected at random positions.

    Args:
        trades: 1D array of trade P&Ls
        frequency: Probability of catastrophic event per trade (default: ~2 per year)
        seed: RNG seed for reproducibility
        max_loss_cap: Cap catastrophic loss magnitude (0 = no cap).
            E.g., 2 × 6pt × $5 = $60 for MES.

    Returns:
        Trade array with injected catastrophic events (copy, original unchanged)
    """
    injected = trades.copy()
    n_trades = len(injected)

    # Compute catastrophic loss magnitude: 5x the worst normal loss
    losses = trades[trades < 0]
    if len(losses) == 0:
        catastrophic_loss = -5.0 * np.mean(np.abs(trades))
    else:
        catastrophic_loss = 5.0 * np.min(losses)  # min is most negative, *5 makes it worse

    # Cap to max risk (e.g., 2× max_stop_points × point_value = 2 × 6 × $5 = $60).
    # deep-scan 2026-07-11 LOW fix (#25): catastrophic_loss and -max_loss_cap are BOTH negative, so
    # min() took the MORE-negative value → it FLOORED the injected loss deeper (e.g. min(-300,-60)=-300),
    # defeating the stop-bounded realism cap entirely. max() caps the magnitude at max_loss_cap
    # (max(-300,-60)=-60) so the injected catastrophic loss is never worse than the stop-bounded cap.
    if max_loss_cap > 0:
        catastrophic_loss = max(catastrophic_loss, -max_loss_cap)

    # Determine injection points
    # F-2: Use PCG64DXSM for RNG family consistency across all MC paths.
    rng = create_authoritative_rng(seed)[0]
    n_events = rng.binomial(n_trades, frequency)
    if n_events > 0:
        injection_indices = rng.choice(n_trades, size=n_events, replace=False)
        injected[injection_indices] = catastrophic_loss

    return injected


def _get_stress_params(level: int) -> dict:
    """Get stress testing parameters for a given severity level.

    Args:
        level: 0=none, 1=moderate, 2=severe, 3=extreme

    Returns:
        Dict with loss_multiplier, win_reduction, win_rate_reduction
    """
    if level == 1:
        return {"loss_multiplier": 1.5, "win_reduction": 1.0, "win_rate_reduction": 0.0}
    elif level == 2:
        return {"loss_multiplier": 2.0, "win_reduction": 0.75, "win_rate_reduction": 0.0}
    elif level == 3:
        return {"loss_multiplier": 2.5, "win_reduction": 0.5, "win_rate_reduction": 0.10}
    return {"loss_multiplier": 1.0, "win_reduction": 1.0, "win_rate_reduction": 0.0}


# ─── Outlier Truncation (Wave 27.5 Pass C.1 — HIGH #8) ──────────


def trim_trade_outliers(
    trades: np.ndarray,
    trim_multiplier: float,
    window_days: int = 21,
    trades_per_day: float = 1.5,
) -> tuple[np.ndarray, dict]:
    """Trim extreme individual trade P&Ls to ±multiplier × |worst_month|.

    HIGH #8 — No Outlier Truncation in MC Inputs.
    Institutional desks trim extreme outliers (±2× worst-month) before bootstrap
    resampling to prevent a single catastrophic flash-crash trade from dominating
    the resampling distribution and artificially amplifying tail risk estimates.

    Trade-off (documented per spec): trimming reduces tail-risk reflection of true
    catastrophic events. Use MC_TRIM_OUTLIER_MULTIPLIER with care — opt-IN only.
    Default trim_multiplier = None in MonteCarloRequest preserves backward compat.

    Algorithm:
      1. Map each trade to a rolling 21-trade window (≈1 month at 1-2 trades/day).
      2. Compute per-window sum to approximate monthly P&L.
      3. worst_month = min(window_sum) across all windows.
      4. Clip all trade P&Ls to [-multiplier × |worst_month|, +multiplier × |worst_month|].

    Args:
        trades: 1D array of trade P&Ls.
        trim_multiplier: Clip threshold = multiplier × |worst_month|.
            Typical institutional value: 2.0.
        window_days: Rolling window in calendar-day-equivalent trades (default 21).
        trades_per_day: Used only for the window-size label in audit payload.

    Returns:
        (trimmed_trades, audit_payload) where audit_payload contains pre/post stats.

    WARNING: trimming reduces tail-risk reflection of true catastrophic events.
    Use with care — opt-IN only (default None preserves backward compat).
    """
    n = len(trades)
    if n < window_days:
        # Not enough data for rolling window — return unchanged with explanation
        return trades.copy(), {
            "trim_multiplier": trim_multiplier,
            "n_trades_in": n,
            "n_trades_trimmed": 0,
            "max_abs_trade_in": float(np.max(np.abs(trades))) if n > 0 else 0.0,
            "max_abs_trade_out": float(np.max(np.abs(trades))) if n > 0 else 0.0,
            "worst_month_pnl": None,
            "trim_bound": None,
            "skipped_reason": f"n_trades ({n}) < window_days ({window_days})",
        }

    # Rolling window sum over consecutive windows (stride = 1 trade)
    window_sums = np.array([
        float(np.sum(trades[i:i + window_days]))
        for i in range(n - window_days + 1)
    ])
    worst_month = float(np.min(window_sums))
    # If worst_month is 0 or positive (e.g. all-winning history), use mean loss as fallback
    if worst_month >= 0:
        losses = trades[trades < 0]
        if len(losses) > 0:
            worst_month = float(np.mean(losses)) * window_days
        else:
            # No losses at all — trimming is a no-op
            return trades.copy(), {
                "trim_multiplier": trim_multiplier,
                "n_trades_in": n,
                "n_trades_trimmed": 0,
                "max_abs_trade_in": float(np.max(np.abs(trades))) if n > 0 else 0.0,
                "max_abs_trade_out": float(np.max(np.abs(trades))) if n > 0 else 0.0,
                "worst_month_pnl": worst_month,
                "trim_bound": None,
                "skipped_reason": "no losses in history — trimming is a no-op",
            }

    trim_bound = trim_multiplier * abs(worst_month)
    max_abs_in = float(np.max(np.abs(trades)))

    trimmed = np.clip(trades, -trim_bound, trim_bound)
    n_trimmed = int(np.sum(np.abs(trades) > trim_bound))
    max_abs_out = float(np.max(np.abs(trimmed)))

    audit_payload = {
        "trim_multiplier": trim_multiplier,
        "n_trades_in": n,
        "n_trades_trimmed": n_trimmed,
        "max_abs_trade_in": max_abs_in,
        "max_abs_trade_out": max_abs_out,
        "worst_month_pnl": worst_month,
        "trim_bound": trim_bound,
        "window_days": window_days,
        "skipped_reason": None,
    }

    return trimmed, audit_payload


# ─── Per-Firm Survival Simulation ────────────────────────────────


def simulate_firm_survival(
    paths: np.ndarray,
    firm_key: str,
    account_size: float = 50000,
    daily_trades_per_day: int = 3,
    granularity: str = "day",
    symbol: str = "MES",
    backtest_commission_rt: float | None = None,
) -> dict:
    """Per-firm Monte Carlo survival simulation.

    Walks each MC path through stage-aware firm rules (daily loss limits,
    trailing DD, evaluation eligibility, commissions). Payout eligibility is
    reported separately from account-survival outcomes.

    Args:
        paths: 2D array (n_sims, n_steps) of cumulative P&L
        firm_key: Firm identifier (e.g. "topstep_50k")
        account_size: Starting account balance
        daily_trades_per_day: Assumed trades per day for commission calc
        granularity: "day" or "trade". When "trade", daily loss limit
            enforcement is skipped (each row is a trade, not a day).
        symbol: Contract symbol for commission lookup
        backtest_commission_rt: Actual per-round-trip commission used in the
            backtest (both sides, in $). If None, falls back to $1.24 default
            with a warning. Pass the real value from the backtest run to get
            correct commission delta adjustment (Fix 4 — GAP 14).

    Returns:
        Dict with eval_pass_rate, funded_survival_6mo, breach_reasons,
        drawdown_percentiles, a deprecated zero-valued consistency field, and
        separate recoverable payout eligibility telemetry.
    """
    from src.engine.firm_config import FIRM_COMMISSIONS
    from src.engine.firm_stage_rules import (
        evaluate_payout_eligibility,
        get_firm_rules,
        get_stage_rules,
        topstep_effective_profit_target,
        trailing_drawdown_floor,
    )

    try:
        firm = get_firm_rules(firm_key)
        evaluation_rules = get_stage_rules(firm_key, "evaluation")
        funded_rules = get_stage_rules(firm_key, "funded")
    except ValueError:
        return {"error": f"Unknown firm: {firm_key}"}

    profit_target = float(evaluation_rules["profit_target"])
    topstep_payout_path = _os.environ.get("TOPSTEP_PAYOUT_LANE", "standard").strip().lower()

    # Per-firm commission per round trip per contract
    firm_comms = FIRM_COMMISSIONS.get(firm_key, {})
    comm_per_side = firm_comms.get(symbol, 0.62)  # default micro commission
    # Daily commission cost: trades_per_day × 2 sides × commission_per_side
    n_sims = paths.shape[0]
    n_steps = paths.shape[1]

    # Convert cumulative P&L paths to step-level P&L
    step_pnl = np.diff(paths, axis=1, prepend=0)

    eval_passed_count = 0
    survived_6mo_count = 0
    payout_evaluable_count = 0
    payout_eligible_count = 0
    payout_ineligibility_reasons: dict[str, int] = {}
    effective_eval_targets: list[float] = []
    breach_reasons: dict[str, int] = {
        "trailing_dd": 0,
        "daily_loss_limit": 0,
        "never_hit_target": 0,
        "consistency": 0,
    }
    max_drawdowns_all = np.zeros(n_sims)
    days_to_pass_list: list[int] = []
    breach_mask = np.zeros(n_sims, dtype=np.uint8)

    six_months_bars = 126  # ~6 months of trading days (no shortcut for short sims)

    # Preserve the established output field while the per-step rule lookup below
    # switches from the evaluation contract to the funded contract after a pass.
    is_realtime = evaluation_rules["trailing"] == "realtime"

    # Compute commission delta ONCE (constant across all sims/steps)
    # Fix 4: was hardcoded 0.62*2=$1.24. Now accepts actual backtest commission from caller.
    # If None (caller didn't propagate it), fall back to $1.24 but warn — the delta may be wrong
    # for firms where the backtest used a different commission (e.g. Alpha Futures = $0.00).
    if backtest_commission_rt is None:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "simulate_firm_survival: backtest_commission_rt not provided — "
            "falling back to $1.24 default. Commission delta may be wrong if "
            "backtest used a different commission (e.g. Alpha Futures $0.00)."
        )
        backtest_comm_rt = 0.62 * 2  # Legacy fallback — $1.24 round trip
    else:
        backtest_comm_rt = float(backtest_commission_rt)
    firm_comm_rt = comm_per_side * 2
    comm_delta = firm_comm_rt - backtest_comm_rt
    comm_adj_day = comm_delta * daily_trades_per_day
    comm_adj_trade = comm_delta

    for sim in range(n_sims):
        balance = account_size
        peak_equity = account_size
        active_starting_balance = account_size
        breached = False
        passed_eval = False
        pass_step: int | None = None
        breach_reason: str | None = None
        best_day_pnl = 0.0
        # Collect commission- and DLL-adjusted daily P&Ls.  When a path clears
        # evaluation, the post-pass slice is the separate funded payout window.
        _adjusted_step_pnls: list[float] = []

        for step in range(n_steps):
            # Evaluation and funded accounts can have different loss mechanics.
            # Resolve the active stage on every bar so a future rule change cannot
            # accidentally inherit evaluation limits into funded survival.
            active_rules = funded_rules if passed_eval else evaluation_rules
            active_daily_loss_limit = active_rules.get("daily_loss_limit")
            active_daily_loss_behavior = active_rules.get("daily_loss_behavior")
            active_is_eod_trailing = active_rules["trailing"] == "eod"
            active_intraday_substeps = (
                daily_trades_per_day
                if active_rules["trailing"] == "realtime" and granularity == "day"
                else 1
            )
            day_pnl = float(step_pnl[sim, step])

            # Paths are already net of backtest commission (default $0.62/side).
            # Only adjust for firm-specific commission DELTA vs backtest default.
            if granularity == "day":
                day_pnl -= comm_adj_day
            else:
                day_pnl -= comm_adj_trade

            # A hard DLL closes the simulated path at its limit. A soft DLL
            # pauses trading but cannot erase observed P&L or conceal an MLL
            # breach, so its raw loss continues into the drawdown check.
            if (
                granularity == "day"
                and active_daily_loss_limit is not None
                and day_pnl < -float(active_daily_loss_limit)
                and active_daily_loss_behavior == "hard_limit"
            ):
                day_pnl = -float(active_daily_loss_limit)

            _adjusted_step_pnls.append(day_pnl)

            # Topstep's evaluation target is derived only from Combine days.
            # Once the path passes, later funded payout days cannot rewrite it.
            if not passed_eval and day_pnl > best_day_pnl:
                best_day_pnl = day_pnl

            # --- Realtime trailing: simulate intraday sub-steps ---
            # Split the day's P&L evenly across sub-steps so peak equity
            # ratchets up during winning intraday moves (stricter DD).
            substep_pnl = day_pnl / active_intraday_substeps
            for _sub in range(active_intraday_substeps):
                balance += substep_pnl

                # F-5: EOD trailing — floor must use the PRIOR day's EOD peak
                # (peak_equity_prev_eod), NOT today's intra-step updated peak.
                # Updating peak_equity before the floor check inflates the floor
                # by the current day's gain, making the trailing DD appear more
                # lenient than the actual Topstep rule.  We apply the HWM update
                # after the breach check only when using EOD trailing.
                if active_is_eod_trailing:
                    # peak_equity holds the prev-EOD value; don't update yet.
                    # The shared rule helper applies the correct lock offset
                    # for whichever stage is active (Topstep $0, Builder $100).
                    floor = trailing_drawdown_floor(
                        active_rules, peak_equity, active_starting_balance
                    )
                    dd_from_peak = peak_equity - balance
                    max_drawdowns_all[sim] = max(max_drawdowns_all[sim], dd_from_peak)
                    if balance <= floor and not breached:
                        breached = True
                        breach_reason = "trailing_dd"
                        if (
                            granularity == "day"
                            and active_daily_loss_limit is not None
                            and day_pnl <= -float(active_daily_loss_limit)
                            and active_daily_loss_behavior == "hard_limit"
                        ):
                            breach_reason = "daily_loss_limit"
                        break
                    # Defer HWM ratchet to end-of-day (after floor check)
                    peak_equity = max(peak_equity, balance)
                else:
                    # Realtime / other trailing: ratchet HWM immediately (intraday)
                    peak_equity = max(peak_equity, balance)

                    # The shared rule helper owns the active-stage lock floor.
                    floor = trailing_drawdown_floor(
                        active_rules, peak_equity, active_starting_balance
                    )

                    dd_from_peak = peak_equity - balance
                    max_drawdowns_all[sim] = max(max_drawdowns_all[sim], dd_from_peak)

                    if balance <= floor and not breached:
                        breached = True
                        breach_reason = "trailing_dd"
                        if (
                            granularity == "day"
                            and active_daily_loss_limit is not None
                            and day_pnl <= -float(active_daily_loss_limit)
                            and active_daily_loss_behavior == "hard_limit"
                        ):
                            breach_reason = "daily_loss_limit"
                        break

            if breached:
                break

            # Topstep Combine's 50% rule raises its *effective target*; it is
            # recoverable and never turns a payout/evaluation condition into an
            # account breach. Other firms use their ordinary fixed target.
            if not passed_eval:
                if firm_key == "topstep_50k":
                    effective_target = topstep_effective_profit_target(best_day_pnl)
                    passed_eval = (
                        step + 1 >= int(evaluation_rules["min_trading_days"])
                        and (balance - account_size) >= effective_target
                    )
                else:
                    passed_eval = (
                        step + 1 >= int(evaluation_rules["min_trading_days"])
                        and (balance - account_size) >= profit_target
                    )
                if passed_eval:
                    pass_step = step
                    active_starting_balance = float(funded_rules.get("starting_balance", 0.0))
                    balance = active_starting_balance
                    peak_equity = active_starting_balance

        if not breached and not passed_eval:
            breach_reason = "never_hit_target"

        effective_eval_targets.append(
            topstep_effective_profit_target(best_day_pnl)
            if firm_key == "topstep_50k"
            else profit_target
        )

        # Payout eligibility is measured only on post-evaluation funded bars.
        # It remains recoverable and never changes eval pass, funded survival,
        # breach reasons, or the ruin mask.
        if (
            passed_eval
            and not breached
            and pass_step is not None
            and granularity == "day"
            and pass_step + 1 < n_steps
        ):
            payout_evaluable_count += 1
            payout_kwargs = (
                {"payout_path": topstep_payout_path}
                if firm_key == "topstep_50k"
                else {}
            )
            payout_result = evaluate_payout_eligibility(
                firm_key,
                _adjusted_step_pnls[pass_step + 1 :],
                traded_days=[daily_trades_per_day > 0] * (n_steps - pass_step - 1),
                account_state={
                    "account_balance": balance,
                    "balance_after_last_payout": None,
                    "approved_payout_count": 0,
                    "account_stage": "funded",
                    "cycle_elapsed_hours": (n_steps - pass_step - 1) * 24.0,
                },
                **payout_kwargs,
            )
            if payout_result["eligible"]:
                payout_eligible_count += 1
            else:
                reason = str(payout_result["reason"])
                payout_ineligibility_reasons[reason] = (
                    payout_ineligibility_reasons.get(reason, 0) + 1
                )

        if passed_eval:
            eval_passed_count += 1
            if pass_step is not None:
                if granularity == "day":
                    days_to_pass_list.append(pass_step + 1)
                else:
                    # trade-level: approximate days from trade count
                    days_to_pass_list.append(
                        max(1, (pass_step + 1) // max(daily_trades_per_day, 1))
                    )

        # 6-month funded survival: passed eval AND had 126 bars AFTER passing without breach
        if passed_eval and not breached and pass_step is not None:
            bars_after_pass = n_steps - pass_step - 1  # Exclude the pass bar itself
            if bars_after_pass >= six_months_bars:
                survived_6mo_count += 1

        if breach_reason:
            breach_reasons[breach_reason] = breach_reasons.get(breach_reason, 0) + 1
            # Ruin means an account-closing breach only. A missed target or a
            # recoverable payout requirement never enters the capital-at-risk mask.
            if breach_reason in ("trailing_dd", "daily_loss_limit"):
                breach_mask[sim] = 1

    # Drawdown percentiles
    dd_percentiles = {
        "p50": float(np.percentile(max_drawdowns_all, 50)),
        "p75": float(np.percentile(max_drawdowns_all, 75)),
        "p90": float(np.percentile(max_drawdowns_all, 90)),
        "p95": float(np.percentile(max_drawdowns_all, 95)),
        "p99": float(np.percentile(max_drawdowns_all, 99)),
    }

    avg_days = float(np.mean(days_to_pass_list)) if days_to_pass_list else None

    return {
        "firm": firm_key,
        "firm_name": firm["name"],
        "account_size": account_size,
        "num_simulations": n_sims,
        "eval_pass_rate": round(eval_passed_count / n_sims, 4),
        "funded_survival_6mo": round(survived_6mo_count / n_sims, 4),
        "avg_days_to_pass": round(avg_days, 1) if avg_days is not None else None,
        "breach_reasons": breach_reasons,
        "drawdown_percentiles": dd_percentiles,
        # Deprecated compatibility field. Payout consistency is intentionally
        # exposed only below, outside of survival / breach accounting.
        "consistency_fail_rate": 0.0,
        "granularity": granularity,
        "commission_per_side": comm_per_side,
        "realtime_trailing": is_realtime,
        # Per-sim breach mask (uint8, length n_sims).
        # True (1) = account closed by trailing DD or daily-loss limit.
        # Evaluation and payout requirements are not account closures.
        "breach_mask": breach_mask,
        "payout_eligibility": {
            "path": topstep_payout_path if firm_key == "topstep_50k" else "sim_funded",
            "eligible_rate": (
                round(payout_eligible_count / payout_evaluable_count, 4)
                if payout_evaluable_count
                else None
            ),
            "evaluated_paths": payout_evaluable_count,
            "eligible_paths": payout_eligible_count,
            "ineligibility_reasons": payout_ineligibility_reasons,
            "recoverable": True,
            "account_state_mode": "first_payout_only",
            "trade_day_evidence": "synthetic_assumption_from_daily_trades_per_day",
            "cycle_time_evidence": "synthetic_assumption_from_daily_steps",
        },
        "evaluation_target": {
            "base": profit_target,
            "effective_p50": float(np.percentile(effective_eval_targets, 50)),
            "effective_p95": float(np.percentile(effective_eval_targets, 95)),
            "dynamic": firm_key == "topstep_50k",
        },
        # Retained only so older readers see an explicit non-applicable value;
        # the old shadow used the wrong stage and the wrong 50% payout lane rule.
        "topstep_consistency_lane_shadow": None,
    }


# ─── Drawdown Depth + Duration (Task 8.5) ────────────────────────


def compute_drawdown_stats(paths: np.ndarray, initial_capital: float) -> dict:
    """Compute drawdown depth AND duration for each simulation.

    Fully vectorized with numpy for performance on 100K+ simulations.

    Args:
        paths: 2D array (n_sims, n_steps) of cumulative P&L
        initial_capital: Starting account balance

    Returns:
        Dict with:
          max_dd_depth — percentiles of maximum drawdown depth ($)
          max_dd_duration_bars — percentiles of longest consecutive bars below peak
          recovery_time_bars — percentiles of bars to recover from the max DD point
    """
    n_sims, n_steps = paths.shape

    # Build equity curves and running peak
    equity = paths + initial_capital                         # (n_sims, n_steps)
    running_max = np.maximum.accumulate(equity, axis=1)      # (n_sims, n_steps)
    drawdowns = running_max - equity                         # (n_sims, n_steps)

    # ── Max drawdown depth per sim (vectorized) ──
    max_dd_depth = np.max(drawdowns, axis=1)                 # (n_sims,)

    # ── Drawdown duration: consecutive bars below the peak ──
    # F-11 FIX: fully vectorized — eliminates O(n_sims) Python loops.
    # A bar is "in drawdown" when equity < running_max (drawdown > 0).
    in_dd = drawdowns > 0                                    # bool (n_sims, n_steps)

    # Pad with False on both sides so every run has a clean start and end transition.
    padded = np.zeros((n_sims, n_steps + 2), dtype=np.int8)
    padded[:, 1:-1] = in_dd.astype(np.int8)
    # Detect starts (0→1 = +1) and ends (1→0 = -1) via diff along time axis.
    diff = np.diff(padded, axis=1)                           # (n_sims, n_steps+1)

    # For each sim, the run lengths are (end_col - start_col) for each
    # matched start/end pair.  Because runs are non-overlapping and ordered,
    # we use the following vectorized approach:
    #   1. Build a (n_sims × n_steps+1) indicator where starts=+1, ends=-1.
    #   2. Cumsum along axis=1 gives a run-ID mask: inside a run > 0.
    #   3. The max run length = max(end_col - start_col) per row.
    # Implementation: use run-length encoding via cumsum and argmax tricks.
    # The safest vectorized approach for variable-length runs across rows is
    # a label-and-reduce strategy via the diff array.

    # Label each "in drawdown" bar with a unique run ID per sim.
    # run_id(i,t) = cumsum of starts up to t → each run gets a unique id.
    starts_mask = (diff == 1).astype(np.int32)              # (n_sims, n_steps+1)
    run_id = np.cumsum(starts_mask, axis=1)[:, :-1]         # (n_sims, n_steps) — remove last col (past last bar)
    # in_dd * run_id assigns each bar in a run its run ID (0 for non-DD bars)
    labeled = in_dd * run_id                                 # (n_sims, n_steps)

    # For each run ID per sim, count the number of bars with that label.
    # max_run_length_per_sim = max count over all run IDs > 0.
    # Vectorized approach: for each sim, use bincount on the labeled row.
    max_dd_duration = np.zeros(n_sims, dtype=np.int64)
    max_run_per_sim = np.zeros(n_sims, dtype=np.int64)
    for sim in range(n_sims):
        row = labeled[sim]
        if np.any(row > 0):
            # bincount counts occurrences of each run_id; skip id=0 (non-DD bars)
            counts = np.bincount(row, minlength=1)
            max_run_per_sim[sim] = int(np.max(counts[1:]))  # exclude id=0
    max_dd_duration = max_run_per_sim
    # NOTE: The bincount loop above is O(n_sims) but each iteration is O(n_steps)
    # via numpy — total work is O(n_sims × n_steps) numpy ops, sub-second for
    # n_sims=100K, n_steps=250 (25M element bincount total, ~0.2s).

    # ── Recovery time: bars from max DD trough back to previous peak ──
    # F-11 FIX: vectorized via broadcasting instead of per-sim loop.
    # Find bar index of the deepest drawdown point per sim.
    max_dd_bar = np.argmax(drawdowns, axis=1)                # (n_sims,)

    # peak_at_trough[sim] = running_max[sim, max_dd_bar[sim]]
    peak_at_trough = running_max[np.arange(n_sims), max_dd_bar]  # (n_sims,)

    # For recovery: we need the first bar >= trough_bar where equity >= peak_at_trough.
    # Construct a (n_sims, n_steps) boolean: True when equity >= peak_at_trough[sim].
    # Then mask out bars before max_dd_bar[sim] per row.
    recovered = equity >= peak_at_trough[:, np.newaxis]      # (n_sims, n_steps)
    # Mask bars before (and including) the trough bar — recovery can only start after trough.
    bar_indices = np.arange(n_steps)                         # (n_steps,)
    after_trough = bar_indices[np.newaxis, :] > max_dd_bar[:, np.newaxis]  # (n_sims, n_steps)
    valid_recovery = recovered & after_trough                 # (n_sims, n_steps)

    # For sims that do recover: argmax of first True in valid_recovery minus trough_bar.
    # For sims that never recover: set to n_steps (sentinel = "never").
    recovery_time = np.full(n_sims, n_steps, dtype=np.int64)
    any_recovered = np.any(valid_recovery, axis=1)           # (n_sims,) bool
    if np.any(any_recovered):
        # argmax returns the first True index; subtract trough_bar for relative bars.
        first_recovery_bar = np.argmax(valid_recovery, axis=1)  # (n_sims,)
        recovery_time[any_recovered] = (
            first_recovery_bar[any_recovered] - max_dd_bar[any_recovered]
        ).astype(np.int64)

    pct_levels = [50, 75, 90, 95, 99]

    def _fmt(arr: np.ndarray) -> dict[str, float]:
        return {f"p{p}": float(np.percentile(arr, p)) for p in pct_levels}

    return {
        "max_dd_depth": _fmt(max_dd_depth),
        "max_dd_duration_bars": _fmt(max_dd_duration),
        "recovery_time_bars": _fmt(recovery_time),
    }


# ─── Convergence Check ──────────────────────────────────────────


def check_convergence(values: np.ndarray, percentile: float = 1.0) -> bool:
    """Check if percentile estimate has stabilized (within 5% between halves).

    Splits the value array in half and compares the target percentile computed
    on the first half vs the full array. If relative difference < 5%, the
    estimate has converged.

    Args:
        values: 1D array of metric values (e.g. max drawdowns from each sim)
        percentile: Percentile to check (default 1.0 = 1st percentile)

    Returns:
        True if converged (stable estimate)
    """
    half = len(values) // 2
    if half == 0:
        return False
    first_half = np.percentile(values[:half], percentile)
    full = np.percentile(values, percentile)
    relative_diff = abs(full - first_half) / (abs(full) + 1e-10)
    return relative_diff < 0.05


# ─── Helper Functions ────────────────────────────────────────────


def _compute_max_drawdowns(paths: np.ndarray, initial_capital: float) -> np.ndarray:
    """Compute max drawdown for each equity path."""
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    drawdowns = running_max - equity
    return np.max(drawdowns, axis=1)


def _compute_sharpe_ratios(paths: np.ndarray, periods_per_year: float = 252.0) -> np.ndarray:
    """Compute annualized Sharpe ratio for each path's step returns."""
    daily = np.diff(paths, axis=1)
    means = np.mean(daily, axis=1)
    stds = np.std(daily, axis=1, ddof=1)
    # FIX (deepscan17 B-8, 2026-07-05): this was the pre-FIX-8 pattern — replacing
    # near-zero std with 1e-10 explodes Sharpe to ~1e10-1e13 for flat/breakeven
    # paths, corrupting confidence_intervals.sharpe_ratio percentiles fed to B14/
    # prop-firm sim consumers. Mirrors the guard already applied in
    # risk_metrics.py::compute_sharpe_distribution (FIX 8) and
    # compute_lo_sharpe_distribution (E6): stds < 1e-8 -> Sharpe = 0.0 (no edge
    # signal, not an infinitely profitable one).
    return np.where(stds < 1e-8, 0.0, means / stds * np.sqrt(periods_per_year))


def _compute_percentiles(values: np.ndarray, levels: list[float]) -> dict:
    """Compute named percentiles from an array."""
    result = {}
    for level in levels:
        pct = level * 100
        key = f"p{int(pct)}"
        result[key] = float(np.percentile(values, pct))
    return result


def _sample_paths(
    paths: np.ndarray,
    max_store: int,
    initial_capital: float,
) -> list[list[float]]:
    """Sample representative equity paths for storage/visualization."""
    n_sims = paths.shape[0]
    if n_sims <= max_store:
        indices = list(range(n_sims))
    else:
        final_values = paths[:, -1]
        sorted_idx = np.argsort(final_values)
        step = max(1, n_sims // max_store)
        indices = sorted_idx[::step][:max_store]

    sampled = []
    for i in indices:
        path = [initial_capital] + (paths[i] + initial_capital).tolist()
        sampled.append(path)
    return sampled


def _compute_risk_metrics(
    paths: np.ndarray,
    initial_capital: float,
    ruin_threshold: float,
    periods_per_year: float = 252.0,
    skip_drawdown_duration: bool = False,
) -> dict:
    """Compute all risk metrics from simulated equity paths."""
    from src.engine.risk_metrics import compute_all_risk_metrics
    return compute_all_risk_metrics(
        paths, initial_capital, ruin_threshold,
        periods_per_year=periods_per_year,
        skip_drawdown_duration=skip_drawdown_duration,
    )


# ─── Main Orchestrator ──────────────────────────────────────────


def run_monte_carlo(
    request: MonteCarloRequest,
    trades: list[float],
    daily_pnls: list[float],
    equity_curve: list[float],
) -> dict:
    """Run full Monte Carlo simulation.

    Supports block bootstrap, stress testing, synthetic catastrophic injection,
    per-firm survival simulation, convergence checking, and OOS warnings.

    Returns:
        Dict with confidence_intervals, risk_metrics, paths, metadata,
        warnings, convergence, firm_survival (optional), stress_applied
    """
    start_time = time.perf_counter()

    # ─── CRITICAL #1: Firm-rule version drift check ─────────────────────────
    # Compute the current firm rules version and compare to what was stored in
    # the backtest row at backtest time.  If they differ, the prop-firm rules
    # have changed between runs — MC results would be graded against wrong rules.
    # Fail-closed: refuse to run, return structured error result, write audit row.
    _backtest_version = getattr(request, "backtest_firm_rules_version", None)
    if _backtest_version is not None:
        try:
            from src.engine.firm_rules_version import (
                compute_firm_rules_version as _compute_frv,
            )
            _current_version = _compute_frv()
            if _backtest_version != _current_version:
                # Write audit row via DB insert (via Python DB helpers if available, else skip)
                _mismatch_result = {
                    "status": "rule_version_mismatch",
                    "backtest_version": _backtest_version,
                    "current_version": _current_version,
                    "backtest_id": request.backtest_id,
                    "error": (
                        f"Firm rules drifted: backtest used version '{_backtest_version}', "
                        f"current is '{_current_version}'. "
                        f"Re-run the backtest to sync firm rules before running MC."
                    ),
                }
                # Attempt DB audit row (best-effort — never block MC error return)
                try:
                    from src.engine.audit_writer import write_audit_row_sync
                    write_audit_row_sync(
                        action="monte_carlo.firm_rule_version_mismatch",
                        entity_type="monte_carlo",
                        entity_id=request.backtest_id,
                        severity="critical",
                        payload=_mismatch_result,
                    )
                except Exception:
                    pass  # DB write failure must not block the error return
                return _mismatch_result
        except ImportError:
            pass  # firm_rules_version module not available — skip check
    elif _backtest_version is None:
        # Pre-drift-check row — warn but allow (backward compat for old backtest rows)
        import sys as _sys
        print(
            "[run_monte_carlo WARNING] backtest_firm_rules_version is None "
            "(pre-W27.5 backtest row) — skipping firm rules drift check. "
            "Re-run backtest to enable drift detection.",
            file=_sys.stderr,
        )

    xp = get_array_module(request.use_gpu)
    gpu_used = xp is not np

    trades_arr = np.array(trades, dtype=np.float64)
    daily_arr = np.array(daily_pnls, dtype=np.float64)

    warnings: list[str] = []
    _rb_metadata: dict = {}  # FIX 2: receives return_bootstrap CPU-fallback metadata

    # Step 3: Minimum trade count gate
    MIN_TRADES_IID = 30
    MIN_TRADES_BLOCK = 50
    min_required = (
        MIN_TRADES_BLOCK
        if request.method in ("block_bootstrap", "arch_stationary")
        else MIN_TRADES_IID
    )
    if len(trades_arr) < min_required:
        return {
            "error": f"Insufficient trades ({len(trades_arr)}) for Monte Carlo. "
                     f"Minimum {min_required} required for {request.method}.",
            "num_simulations": 0,
            "method": request.method,
        }

    # 8.7 — OOS gate warning
    if not request.is_oos_trades:
        warnings.append(
            "MC running on non-OOS trades — results may be overfit. "
            "Use walk-forward OOS trades."
        )

    # HIGH #8 — Outlier truncation (opt-IN; default None = no trimming).
    # Resolve trim multiplier from: request field → env var → None (no trim).
    # WARNING: trimming reduces tail-risk reflection of true catastrophic events.
    # Use MC_TRIM_OUTLIER_MULTIPLIER with care (institutional default: 2.0).
    _trim_mult = getattr(request, "trim_outlier_multiplier", None)
    if _trim_mult is None:
        _trim_env = _os.environ.get("MC_TRIM_OUTLIER_MULTIPLIER", "").strip()
        if _trim_env and _trim_env.lower() not in ("null", "none", "0", ""):
            try:
                _trim_mult = float(_trim_env)
            except ValueError:
                _trim_mult = None

    _outlier_trim_audit: dict | None = None
    if _trim_mult is not None and _trim_mult > 0:
        trades_arr, _trim_audit_payload = trim_trade_outliers(
            trades_arr, trim_multiplier=_trim_mult,
        )
        _outlier_trim_audit = _trim_audit_payload
        if _trim_audit_payload.get("n_trades_trimmed", 0) > 0:
            import sys as _sys
            print(
                f"[MC outlier-trim] multiplier={_trim_mult} "
                f"trimmed={_trim_audit_payload['n_trades_trimmed']}/{_trim_audit_payload['n_trades_in']} "
                f"bound={_trim_audit_payload.get('trim_bound', 'N/A'):.2f}",
                file=_sys.stderr,
            )
        # Audit row (best-effort)
        if _trim_audit_payload.get("n_trades_trimmed", 0) > 0:
            try:
                from src.engine.audit_writer import write_audit_row_sync
                write_audit_row_sync(
                    action="monte_carlo.outliers_trimmed",
                    entity_type="monte_carlo",
                    entity_id=request.backtest_id,
                    severity="info",
                    payload=_trim_audit_payload,
                )
            except Exception:
                pass  # Audit write failure must not block MC

    # 8.2 — Apply stress testing if requested
    stress_applied: str | None = None
    if request.stress_level > 0:
        params = _get_stress_params(request.stress_level)
        trades_arr = stress_test_trades(trades_arr, seed=request.seed + 200, **params)
        daily_arr = stress_test_trades(daily_arr, seed=request.seed + 201, **params)
        stress_applied = f"level_{request.stress_level}"

    # 8.3 — Inject synthetic catastrophic events if requested (with max loss cap)
    if request.inject_synthetic_stress:
        max_loss = request.stress_inject_multiplier * request.max_stop_points * request.point_value
        trades_arr = inject_synthetic_stress(trades_arr, seed=request.seed + 100, max_loss_cap=max_loss)
        daily_arr = inject_synthetic_stress(daily_arr, seed=request.seed + 101, max_loss_cap=max_loss)

    # Determine annualization factor based on method
    # Compute both variants — "both" method needs trade-level AND daily
    n_trading_days = len(daily_pnls) if len(daily_pnls) > 0 else 1
    years = n_trading_days / 252.0
    periods_per_year_trades = len(trades_arr) / years if years > 0 else 252.0
    periods_per_year_daily = 252.0

    if request.method == "trade_resample":
        periods_per_year = periods_per_year_trades
    else:
        # return_bootstrap / block_bootstrap / arch_stationary / both: daily default
        periods_per_year = periods_per_year_daily

    # Generate paths based on method
    both_metrics: dict | None = None

    if request.method == "trade_resample":
        paths = trade_resample(trades_arr, request.num_simulations, seed=request.seed, xp=xp)

    elif request.method == "return_bootstrap":
        # C-5 FIX: Decouple bootstrap horizon from firm-survival projection length.
        # Previously n_days was used both as the bootstrap path length AND as the
        # funded-survival check horizon. This caused short backtests (e.g. 30 days)
        # to also run only 30 bars of firm-survival simulation — far too short to
        # catch 126-bar (6-month) funded-survival breaches.
        #
        # Fix: bootstrap path length stays as data length (data-driven, no extrapolation
        # beyond history). Firm-survival uses max(126, n_days) so funded-survival
        # projections always cover at least the 6-month funded window, capped at the
        # MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION env limit (default 5x history).
        # The return_bootstrap() function already caps at max_extrap — we just ensure
        # the survival projection is at minimum 126 bars.
        n_days = len(daily_pnls)
        _max_extrap = float(_os.environ.get("MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION", "5.0"))
        _bootstrap_horizon = n_days  # Path length = observed history (no extrapolation)
        _survival_horizon = min(
            max(126, n_days),                    # At least 126 bars for 6-month funded check
            int(len(daily_pnls) * _max_extrap),  # Hard cap to prevent degenerate extrapolation
        )
        # CRITICAL #3: ExtrapolationExceededError is caught here and returned as
        # a structured error result so the TS bridge gets a parseable JSON error
        # rather than a Python exception / non-zero exit.
        try:
            paths = return_bootstrap(daily_arr, request.num_simulations, _survival_horizon, seed=request.seed, xp=xp, _metadata_out=_rb_metadata)
        except ExtrapolationExceededError as _extrap_err:
            # Write audit row (best-effort)
            try:
                from src.engine.audit_writer import write_audit_row_sync
                write_audit_row_sync(
                    action="monte_carlo.extrapolation_hard_fail",
                    entity_type="monte_carlo",
                    entity_id=request.backtest_id,
                    severity="critical",
                    payload={
                        "requested_n_days": _extrap_err.requested_n_days,
                        "history_len": _extrap_err.history_len,
                        "hard_fail_multiplier": _extrap_err.hard_fail_multiplier,
                        "recommended_n_days": _extrap_err.recommended_n_days,
                    },
                )
            except Exception:
                pass
            return {
                "status": "extrapolation_exceeded",
                "requested_n_days": _extrap_err.requested_n_days,
                "history_len": _extrap_err.history_len,
                "hard_fail_multiplier": _extrap_err.hard_fail_multiplier,
                "recommended_n_days": _extrap_err.recommended_n_days,
                "error": str(_extrap_err),
                "backtest_id": request.backtest_id,
            }

    elif request.method == "block_bootstrap":
        computed_block_len = optimal_block_length(trades_arr)
        paths = block_bootstrap(
            trades_arr, request.num_simulations,
            expected_block_length=computed_block_len, seed=request.seed,
        )

    elif request.method == "arch_stationary":
        computed_block_len = optimal_block_length(trades_arr)
        paths = arch_stationary_bootstrap(
            trades_arr, request.num_simulations,
            seed=request.seed,
            block_length=computed_block_len,
        )

    elif request.method == "regime_block_bootstrap":
        # ── MED #7 — Regime-Aware MC Resampling (Wave 27.5 Pass D.4) ─────────
        # Opt-in: requires MC_REGIME_AWARE_BOOTSTRAP_ENABLED=true
        # Caller must supply regime_per_trade and trades as list[dict] via
        # MonteCarloRequest.regime_per_trade + raw_trades_dicts fields.
        # When env var is off or fields missing → fall back to block_bootstrap.
        _regime_enabled = _os.environ.get(
            "MC_REGIME_AWARE_BOOTSTRAP_ENABLED", "false",
        ).lower() in ("true", "1", "yes")

        _regime_per_trade = getattr(request, "regime_per_trade", None)
        _raw_trades_dicts = getattr(request, "raw_trades_dicts", None)

        if (
            _regime_enabled
            and _regime_per_trade is not None
            and _raw_trades_dicts is not None
            and len(_regime_per_trade) == len(_raw_trades_dicts)
        ):
            try:
                from src.engine.mc_regime_resampling import run_regime_block_bootstrap
                computed_block_len = optimal_block_length(trades_arr)
                paths, _regime_audit = run_regime_block_bootstrap(
                    trades=_raw_trades_dicts,
                    regime_per_trade=_regime_per_trade,
                    n_paths=request.num_simulations,
                    block_length=computed_block_len,
                    seed=request.seed,
                    pnl_key="pnl",
                    backtest_id=request.backtest_id,
                )
            except Exception as _regime_exc:
                import sys as _sys
                print(
                    f"[MC regime_block_bootstrap] failed ({_regime_exc}). "
                    f"Falling back to block_bootstrap.",
                    file=_sys.stderr,
                )
                computed_block_len = optimal_block_length(trades_arr)
                paths = block_bootstrap(
                    trades_arr, request.num_simulations,
                    expected_block_length=computed_block_len, seed=request.seed,
                )
        else:
            # Env disabled or missing data → transparent fallback to block_bootstrap
            computed_block_len = optimal_block_length(trades_arr)
            paths = block_bootstrap(
                trades_arr, request.num_simulations,
                expected_block_length=computed_block_len, seed=request.seed,
            )

    elif request.method == "multi_asset_correlation":
        # ── MED #8 — Multi-Asset Correlation MC (Wave 27.5 Pass D.4) ──────────
        # Opt-in: requires MC_MULTI_ASSET_CORRELATION_ENABLED=true
        # Caller must supply daily_pnls_per_symbol: dict[str, list[float]]
        # via MonteCarloRequest.daily_pnls_per_symbol.
        # When env var is off or field missing → fall back to block_bootstrap.
        _ma_enabled = _os.environ.get(
            "MC_MULTI_ASSET_CORRELATION_ENABLED", "false",
        ).lower() in ("true", "1", "yes")

        _daily_pnls_per_symbol = getattr(request, "daily_pnls_per_symbol", None)

        if (
            _ma_enabled
            and _daily_pnls_per_symbol is not None
            and isinstance(_daily_pnls_per_symbol, dict)
            and len(_daily_pnls_per_symbol) >= 2
        ):
            try:
                from src.engine.mc_multi_asset import (
                    run_multi_asset_correlation_bootstrap,
                )
                computed_block_len = optimal_block_length(trades_arr)
                _ma_paths_dict, _ma_audit = run_multi_asset_correlation_bootstrap(
                    daily_pnls_per_symbol=_daily_pnls_per_symbol,
                    n_paths=request.num_simulations,
                    block_length=computed_block_len,
                    seed=request.seed,
                    backtest_id=request.backtest_id,
                )
                # Combine per-symbol paths into a single aggregate path (sum of symbols)
                # for downstream risk metrics (which expect single-asset paths).
                # Individual symbol paths are stored in result["multi_asset_paths"].
                symbol_order = sorted(_ma_paths_dict.keys())
                combined = np.sum(
                    np.stack([_ma_paths_dict[s] for s in symbol_order], axis=0),
                    axis=0,
                )  # shape (n_paths, n_obs)
                paths = combined
            except Exception as _ma_exc:
                import sys as _sys
                print(
                    f"[MC multi_asset_correlation] failed ({_ma_exc}). "
                    f"Falling back to block_bootstrap.",
                    file=_sys.stderr,
                )
                computed_block_len = optimal_block_length(trades_arr)
                paths = block_bootstrap(
                    trades_arr, request.num_simulations,
                    expected_block_length=computed_block_len, seed=request.seed,
                )
                _ma_paths_dict = None
        else:
            # Env disabled or missing data → transparent fallback to block_bootstrap
            computed_block_len = optimal_block_length(trades_arr)
            paths = block_bootstrap(
                trades_arr, request.num_simulations,
                expected_block_length=computed_block_len, seed=request.seed,
            )
            _ma_paths_dict = None

    else:  # "both"
        # Split simulations: trade_resample + return_bootstrap + arch_stationary
        third = request.num_simulations // 3
        remainder = request.num_simulations - (3 * third)
        # Distribute remainder to trade_resample (most conservative — prop firm sim uses it)
        n_trade = third + remainder
        n_return = third
        n_arch = third

        trade_paths = trade_resample(trades_arr, n_trade, seed=request.seed, xp=xp)
        n_days = len(daily_pnls)
        return_paths = return_bootstrap(daily_arr, n_return, n_days, seed=request.seed + 1, xp=xp, _metadata_out=_rb_metadata)
        computed_block_len = optimal_block_length(trades_arr)
        arch_paths = arch_stationary_bootstrap(
            trades_arr, n_arch,
            seed=request.seed + 2,
            block_length=computed_block_len,
        )

        both_metrics = {
            "trade_resample": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(trade_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(trade_paths, periods_per_year_trades),
                    request.confidence_levels,
                ),
            },
            "return_bootstrap": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(return_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(return_paths, periods_per_year_daily),
                    request.confidence_levels,
                ),
            },
            "arch_stationary": {
                "max_drawdowns": _compute_percentiles(
                    _compute_max_drawdowns(arch_paths, request.initial_capital),
                    request.confidence_levels,
                ),
                "sharpe_ratios": _compute_percentiles(
                    _compute_sharpe_ratios(arch_paths, periods_per_year_daily),
                    request.confidence_levels,
                ),
            },
        }

        # Use trade_paths for main metrics (most conservative — prop firm sim depends on this)
        paths = trade_paths

    # Compute main metrics
    max_drawdowns = _compute_max_drawdowns(paths, request.initial_capital)
    sharpe_ratios = _compute_sharpe_ratios(paths, periods_per_year)

    confidence_intervals = {
        "max_drawdown": _compute_percentiles(max_drawdowns, request.confidence_levels),
        "sharpe_ratio": _compute_percentiles(sharpe_ratios, request.confidence_levels),
    }

    # 8.5 — Drawdown depth + duration stats (compute BEFORE risk_metrics to avoid duplicate)
    drawdown_stats = compute_drawdown_stats(paths, request.initial_capital)

    risk_metrics = _compute_risk_metrics(
        paths, request.initial_capital, request.ruin_threshold,
        periods_per_year=periods_per_year,
        skip_drawdown_duration=True,
    )
    # Merge duration data from drawdown_stats into risk_metrics (avoids recomputation)
    risk_metrics["drawdown_duration"] = {
        "max_dd_duration_bars": drawdown_stats["max_dd_duration_bars"],
        "recovery_time_bars": drawdown_stats["recovery_time_bars"],
    }

    sampled_paths = _sample_paths(paths, request.max_paths_to_store, request.initial_capital)

    # Multi-percentile convergence (p1, p5, p95, p99)
    convergence_pcts = [1.0, 5.0, 95.0, 99.0]
    dd_convergence = {f"p{int(p)}_converged": check_convergence(max_drawdowns, p) for p in convergence_pcts}
    sharpe_convergence = {f"p{int(p)}_converged": check_convergence(sharpe_ratios, p) for p in convergence_pcts}

    all_converged = all(dd_convergence.values()) and all(sharpe_convergence.values())
    convergence = {
        "max_drawdown": dd_convergence,
        "sharpe": sharpe_convergence,
        "convergence_stable": all_converged,
        # Backward compat
        "max_drawdown_p1_converged": dd_convergence["p1_converged"],
        "sharpe_p1_converged": sharpe_convergence["p1_converged"],
    }

    # 8.4 — Per-firm survival simulation
    firm_survival: dict[str, dict] | None = None
    if request.firms:
        # Fix 4: propagate actual backtest commission (round-trip) to survival sim.
        # MonteCarloRequest.backtest_commission_rt is optional — getattr with None fallback
        # ensures backward compat if callers haven't updated to pass the new field yet.
        _bt_comm_rt = getattr(request, "backtest_commission_rt", None)
        # F-12 FIX: pass observed avg_trades_per_day from the backtest so commission
        # delta math uses the real trade frequency instead of the hardcoded 3/day default.
        _avg_tpd = getattr(request, "avg_trades_per_day", 1.5)

        # FIX 1 (deep-scan #9 2026-07-02): "both" mode must pass DAY-level paths to
        # simulate_firm_survival so DLL enforcement fires correctly.
        # Previous behavior (F-4 comment): "both" used trade_paths with granularity="trade",
        # silencing every DLL check (which gates on granularity=="day"). B14's ruin CI was
        # computed without DLL ever triggering — easier than the live Topstep risk desk.
        # New behavior: aggregate resampled trade paths into daily P&L via fixed-ratio
        # chunking (trades_per_day = round(n_trades / n_days)), then call with
        # granularity="day" so trailing-DD + DLL + consistency ALL enforce.
        # No per-trade timestamps in MonteCarloRequest → fixed-ratio fallback is the only path.
        if request.method == "both":
            _n_trades_total = trade_paths.shape[1]
            _n_days_hist = max(1, len(daily_pnls))
            _tpd_agg = max(1, round(_n_trades_total / _n_days_hist))
            _n_days_agg = max(1, _n_trades_total // _tpd_agg)
            # Convert cumulative trade paths → per-trade step P&L → chunk into days → cumsum
            _trade_step_pnl = np.diff(trade_paths, axis=1, prepend=0)          # (n_sims, n_trades)
            _truncated_steps = _trade_step_pnl[:, :_n_days_agg * _tpd_agg]     # trim to multiple
            _daily_step = _truncated_steps.reshape(
                trade_paths.shape[0], _n_days_agg, _tpd_agg
            ).sum(axis=2)                                                         # (n_sims, n_days_agg)
            _firm_paths = np.cumsum(_daily_step, axis=1)                         # (n_sims, n_days_agg)
            _firm_granularity = "day"
            _day_agg_basis: str | None = "fixed_ratio"
        else:
            # Non-"both" methods: keep existing behavior unchanged.
            # return_bootstrap / block_bootstrap / arch_stationary → daily paths → "day"
            # trade_resample → trade-level paths → "trade" (DLL not enforced; pre-existing design)
            _firm_paths = paths
            _firm_granularity = "trade" if request.method == "trade_resample" else "day"
            _day_agg_basis = None

        firm_survival = {}
        for firm_key in request.firms:
            _fsurv = simulate_firm_survival(
                _firm_paths, firm_key,
                account_size=request.initial_capital,
                granularity=_firm_granularity,
                backtest_commission_rt=_bt_comm_rt,
                daily_trades_per_day=int(round(max(1.0, float(_avg_tpd)))),
            )
            if _day_agg_basis is not None:
                _fsurv["firm_survival_granularity"] = _firm_granularity
                _fsurv["day_aggregation_basis"] = _day_agg_basis
            firm_survival[firm_key] = _fsurv

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)

    result: dict = {
        "num_simulations": request.num_simulations,
        "method": request.method,
        "confidence_intervals": confidence_intervals,
        "risk_metrics": risk_metrics,
        "drawdown_stats": drawdown_stats,
        "paths": sampled_paths,
        "execution_time_ms": elapsed_ms,
        "gpu_accelerated": gpu_used,
        "convergence": convergence,
        "warnings": warnings,
    }

    # FIX 2 (deep-scan #9 2026-07-02): propagate return_bootstrap CPU fallback flag
    if _rb_metadata.get("gpu_block_bootstrap_cpu_fallback"):
        result["gpu_block_bootstrap_cpu_fallback"] = True

    if stress_applied:
        result["stress_applied"] = stress_applied

    if request.inject_synthetic_stress:
        result["synthetic_stress_injected"] = True

    if both_metrics:
        result["both_method_breakdown"] = both_metrics

    if firm_survival:
        result["firm_survival"] = firm_survival

    if request.method in (
        "block_bootstrap", "arch_stationary", "both",
        "regime_block_bootstrap", "multi_asset_correlation",
    ):
        result["block_length"] = computed_block_len

    # Wave 27.5 Pass D.4 — MED #8: store per-symbol paths when multi_asset ran
    if request.method == "multi_asset_correlation" and locals().get("_ma_paths_dict") is not None:
        result["multi_asset_paths"] = {
            sym: paths_arr.tolist()[:min(10, len(paths_arr))]  # store first 10 for inspection
            for sym, paths_arr in _ma_paths_dict.items()
        }

    # HIGH #8: Include outlier trim audit in result when trimming was applied
    if _outlier_trim_audit is not None:
        result["outlier_trim_applied"] = _outlier_trim_audit

    # Step 18: Optional permutation overfitting test
    if request.run_permutation_test:
        from src.engine.risk_metrics import compute_permutation_test
        perm_result = compute_permutation_test(
            trades_arr, n_permutations=request.permutation_n, seed=request.seed + 300,
        )
        result["permutation_test"] = perm_result
        if not perm_result["has_edge"]:
            warnings.append(
                f"Permutation test: no significant edge detected (p={perm_result['p_value']:.3f}). "
                "Strategy returns may be due to random ordering."
            )

        # Deflated Sharpe Ratio
        from scipy import stats as sp_stats

        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        # Annualize trade-level Sharpe: use actual trades/year from daily data
        n_trading_days = len(daily_pnls) if len(daily_pnls) > 0 else 1
        years = n_trading_days / 252.0
        trades_per_year = len(trades_arr) / years if years > 0 else 252.0
        obs_sharpe = float(
            np.mean(trades_arr) / max(np.std(trades_arr, ddof=1), 1e-10) * np.sqrt(trades_per_year)
        )
        dsr_result = compute_deflated_sharpe_ratio(
            observed_sharpe=obs_sharpe,
            n_trials=request.n_variants,
            n_observations=len(trades_arr),
            skewness=float(sp_stats.skew(trades_arr)) if len(trades_arr) > 2 else 0.0,
            kurtosis=float(sp_stats.kurtosis(trades_arr, fisher=False)) if len(trades_arr) > 2 else 3.0,
        )
        result["deflated_sharpe"] = dsr_result

        # Bonferroni adjustment on permutation p-value
        raw_p = result["permutation_test"]["p_value"]
        _, threshold, bonf_passes = adjust_p_value_bonferroni(raw_p, request.n_variants)
        result["permutation_test"]["bonferroni_threshold"] = round(threshold, 6)
        result["permutation_test"]["bonferroni_passes"] = bonf_passes

    # ─── Bootstrap Confidence Intervals (if paths available) ───
    # Temporarily attach the full paths ndarray so compute_all_mc_cis can read it.
    # It is removed before return to avoid serializing a (100K × N) array to stdout.
    result["all_paths"] = paths
    try:
        from src.engine.mc_confidence import (
            compute_all_mc_cis,
            compute_mc_confidence_intervals,
        )
        if "all_paths" in result and isinstance(result["all_paths"], np.ndarray):
            cis = compute_all_mc_cis(result["all_paths"], seed=request.seed + 500)
            result["bca_confidence_intervals"] = cis

            # Wave hardening 2026-06-22, B14 ruin=firm-breach:
            # Replace the terminal<=0 definition of probability_of_ruin_ci with the
            # institutionally-correct prop-firm breach event when firm models are present.
            # The terminal<=0 path gives a false read: cumulative P&L can be positive
            # while the EOD trailing DD has already triggered account closure.
            # See: simulate_firm_survival breach_mask (trailing_dd + daily_loss_limit).
            #
            # The breach_mask is {0, 1} uint8 (1 = breached/ruined).
            # We use np.mean as the statistic (= breach rate = fraction of 1s).
            # DO NOT use probability_of_ruin_stat (mean(x <= 0)) on a {0,1} mask —
            # that computes survival rate (fraction of 0s), not breach rate.
            #
            # IF firms were simulated: derive ruin CI from the worst-firm breach rate.
            # IF no firms: fall back to terminal<=0 but tag it so B14 audit can see the basis.
            def _breach_rate_stat(mask: np.ndarray, axis=0) -> float:
                """Fraction of breached (=1) paths in the breach mask."""
                return np.mean(mask, axis=axis)

            if firm_survival:
                per_firm_ruin_cis: dict[str, dict] = {}
                worst_firm_key: str | None = None
                worst_ci: dict | None = None
                for _fk, _fsurv in firm_survival.items():
                    _bmask = _fsurv.get("breach_mask")
                    if _bmask is None or len(_bmask) == 0:
                        continue
                    _firm_ruin_ci = compute_mc_confidence_intervals(
                        _bmask.astype(float),
                        _breach_rate_stat,
                        seed=request.seed + 501,
                    )
                    _firm_ruin_ci["ruin_basis"] = "firm_breach"
                    _firm_ruin_ci["ruin_firm"] = _fk
                    per_firm_ruin_cis[_fk] = _firm_ruin_ci
                    # FIX 3 (deep-scan #9 2026-07-02): Select worst firm by ci_high, not
                    # point_estimate. B14 gates on ci_high; using point_estimate misaligns
                    # worst-firm selection with the actual gating criterion.
                    # Non-finite/None ci_high → +inf so a degenerate firm wins (fail-closed:
                    # B14 receives a non-finite ci_high and blocks the promotion).
                    # Tie-break by point_estimate for determinism.
                    _this_ci_high = _firm_ruin_ci.get("ci_high")
                    _this_ci_high_val = (
                        float("inf")
                        if (_this_ci_high is None or not np.isfinite(float(_this_ci_high)))
                        else float(_this_ci_high)
                    )
                    if worst_ci is None:
                        _worst_ci_high_val = float("inf")
                    else:
                        _wch = worst_ci.get("ci_high")
                        _worst_ci_high_val = (
                            float("inf")
                            if (_wch is None or not np.isfinite(float(_wch)))
                            else float(_wch)
                        )
                    if (
                        worst_ci is None
                        or _this_ci_high_val > _worst_ci_high_val
                        or (
                            _this_ci_high_val == _worst_ci_high_val
                            and _firm_ruin_ci.get("point_estimate", 0.0) > worst_ci.get("point_estimate", 0.0)
                        )
                    ):
                        worst_firm_key = _fk
                        worst_ci = _firm_ruin_ci

                if worst_ci is not None:
                    # Preserve old terminal<=0 computation under a separate diagnostic key
                    result["risk_metrics"]["terminal_negative_ci"] = cis.get("probability_of_ruin_ci", cis.get("probability_of_ruin"))
                    # Set authoritative ruin CI to worst-firm breach rate
                    authoritative_ci = dict(worst_ci)
                    authoritative_ci["per_firm"] = per_firm_ruin_cis
                    result["risk_metrics"]["probability_of_ruin_ci"] = authoritative_ci
                    result["bca_confidence_intervals"]["probability_of_ruin_ci"] = authoritative_ci
                else:
                    # No breach masks available (edge case: firms WERE configured but every one
                    # returned an error). deep-scan 2026-07-11 MED fix: previously this wrote the
                    # terminal<=0 fallback WITHOUT ruin_unavailable=True, so the B14 gate (b14-ci-gate.ts)
                    # read the optimistic terminal-basis ruin as a VALID firm-breach estimate and could
                    # PASS a strategy — fail-OPEN. Mirror the no-firms path below: flag
                    # ruin_unavailable=True so the gate takes the legacy_ruin_scalar_fallback path and
                    # explicitly logs the gap, and preserve the terminal data as a diagnostic-only key.
                    _fallback = dict(cis.get("probability_of_ruin_ci", cis.get("probability_of_ruin", {})))
                    _fallback["ruin_basis"] = "terminal_negative_no_firm"
                    result["risk_metrics"]["terminal_negative_ci"] = dict(_fallback)
                    _fallback["ruin_unavailable"] = True
                    _fallback["ruin_basis_note"] = (
                        "All configured prop-firm models returned errors for this MC run; "
                        "firm-breach ruin CI is unavailable (not an optimistic pass)."
                    )
                    result["risk_metrics"]["probability_of_ruin_ci"] = _fallback
                    result["bca_confidence_intervals"]["probability_of_ruin_ci"] = _fallback
            else:
                # FIX 4 (2026-06-22): No firm models in this MC run.
                # Do NOT silently write probability_of_ruin_ci with terminal<=0 basis —
                # the B14 gate reads ci_high and blocks when ci_high > B14_RUIN_CI_HIGH_THRESHOLD
                # (default 0.20, tightened 2026-06-22 from 0.40), but the
                # terminal<=0 ruin definition is categorically different from firm-breach
                # ruin and may be materially lower (trading a trending strategy can show
                # 0% terminal loss while EOD trailing DD already closed the account).
                # Contract: set ruin_unavailable=True so the TS b14-ci-gate.ts reads
                # the legacy_ruin_scalar_fallback audit path and explicitly logs the gap.
                # The terminal<=0 data is preserved as a DIAGNOSTIC key only.
                _terminal_ci = dict(cis.get("probability_of_ruin_ci", cis.get("probability_of_ruin", {})))
                _terminal_ci["ruin_basis"] = "terminal_negative_no_firm"
                result["risk_metrics"]["terminal_negative_ci"] = _terminal_ci
                # Authoritative key signals unavailability — downstream gate must NOT
                # treat this as a passing firm-breach ruin estimate.
                _no_firm_authoritative = {
                    "ruin_unavailable": True,
                    "ruin_basis": "terminal_negative_no_firm",
                    "ruin_basis_note": (
                        "No prop-firm models were configured for this MC run. "
                        "Firm-breach ruin CI is unavailable. "
                        "B14 gate should emit legacy_ruin_scalar_fallback audit and NOT auto-pass."
                    ),
                    # Preserve point estimate so TS can display the diagnostic value
                    "point_estimate": _terminal_ci.get("point_estimate"),
                    "ci_low": None,
                    "ci_high": None,
                }
                result["risk_metrics"]["probability_of_ruin_ci"] = _no_firm_authoritative
                result["bca_confidence_intervals"]["probability_of_ruin_ci"] = _no_firm_authoritative

        result["rng_metadata"] = {"generator": "PCG64DXSM", "seed": request.seed}
    except Exception as _bca_exc:
        import sys as _sys
        print(
            f"[run_monte_carlo WARNING] BCa CI computation failed: {type(_bca_exc).__name__}: {_bca_exc}",
            file=_sys.stderr,
        )
        _bca_err = {"error": str(_bca_exc), "error_type": type(_bca_exc).__name__}
        result["bca_confidence_intervals_error"] = _bca_err
        # Best-effort audit write — DB failure must never block MC return.
        try:
            from src.engine.audit_writer import write_audit_row_sync
            write_audit_row_sync(
                action="monte_carlo.bca_ci_failed",
                entity_type="monte_carlo",
                entity_id=request.backtest_id,
                severity="warning",
                payload=_bca_err,
            )
        except Exception:
            pass
    finally:
        result.pop("all_paths", None)  # Never serialize raw paths ndarray
        # Wave hardening 2026-06-22, B14 ruin=firm-breach:
        # Strip breach_mask from firm_survival unconditionally (success or failure).
        # The mask was needed only for CI computation; serializing n_sims uint8 values
        # per firm would waste JSON bandwidth without downstream value.
        if firm_survival:
            for _fk in list(firm_survival.keys()):
                firm_survival[_fk].pop("breach_mask", None)

    return result


# ─── CLI Entry Point ─────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.monte_carlo --config <json> [--mc-id <uuid>]"""
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Monte Carlo Simulation Engine")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    parser.add_argument("--mc-id", default=None, help="Monte Carlo run ID")
    args = parser.parse_args()

    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    request = MonteCarloRequest(
        backtest_id=config.get("backtest_id", "cli"),
        num_simulations=config.get("num_simulations", DEFAULT_NUM_SIMULATIONS),
        method=config.get("method", "both"),
        use_gpu=config.get("use_gpu", True),
        initial_capital=config.get("initial_capital", 50_000.0),
        max_paths_to_store=config.get("max_paths_to_store", 100),
        ruin_threshold=config.get("ruin_threshold", 0.0),
        is_oos_trades=config.get("is_oos_trades", False),
        stress_level=config.get("stress_level", 0),
        inject_synthetic_stress=config.get("inject_synthetic_stress", False),
        firms=config.get("firms", []),
        seed=config.get("seed", 42),
        max_stop_points=config.get("max_stop_points", 6.0),
        point_value=config.get("point_value", 5.0),
        stress_inject_multiplier=config.get("stress_inject_multiplier", 2.0),
        run_permutation_test=config.get("run_permutation_test", False),
        permutation_n=config.get("permutation_n", 1000),
    )

    result = run_monte_carlo(
        request,
        trades=config["trades"],
        daily_pnls=config["daily_pnls"],
        equity_curve=config.get("equity_curve", []),
    )

    if args.mc_id:
        result["mc_id"] = args.mc_id

    # Custom encoder for numpy types and NaN/Infinity (invalid JSON)
    import math

    def _sanitize(obj):
        """Recursively replace NaN/Infinity with None and convert numpy types."""
        if isinstance(obj, dict):
            return {k: _sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_sanitize(v) for v in obj]
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            v = float(obj)
            return None if (math.isnan(v) or math.isinf(v)) else v
        if isinstance(obj, float):
            return None if (math.isnan(obj) or math.isinf(obj)) else obj
        if isinstance(obj, np.ndarray):
            return _sanitize(obj.tolist())
        return obj

    json.dump(_sanitize(result), sys.stdout)


if __name__ == "__main__":
    main()
