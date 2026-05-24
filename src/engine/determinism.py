"""Trading Forge — Determinism Enforcement Module.

Sets BLAS/LAPACK thread-count environment variables BEFORE any numpy import
so floating-point reduction order is fixed. Also applies threadpoolctl limits
at runtime to cover libraries that ignore env vars.

Usage:
    # At the TOP of any engine entry-point, before other imports:
    from src.engine.determinism import enable_determinism
    enable_determinism()

    # In tests, the conftest autouse fixture handles this automatically.

Opt-in:
    Production: set DETERMINISM_MODE=true in environment.
    CI/tests:   always enabled via conftest.py autouse fixture.

Why env vars must be set before numpy import:
    MKL reads MKL_CBWR at load time; once numpy.so is loaded, setting the var
    has no effect on the current process. We set via os.environ at the top of
    this module (module-level, executed at import time) AND inside
    enable_determinism() for belt-and-suspenders coverage.
"""

from __future__ import annotations

import os
import sys
import hashlib
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ─── BLAS / OMP env vars — set at MODULE LOAD TIME ───────────────────────────
# These must be set before numpy is imported anywhere in the process.
# They are set unconditionally here because this module is imported before
# any other numpy-using module (per the import ordering contract in each
# engine entry-point file).
_DETERMINISM_ENV_VARS: dict[str, str] = {
    "MKL_CBWR": "COMPATIBLE",   # Forces consistent FP rounding in MKL
    "OPENBLAS_NUM_THREADS": "1", # Single-thread OpenBLAS (no reduction-order drift)
    "BLIS_NUM_THREADS": "1",     # Single-thread BLIS
    "OMP_NUM_THREADS": "1",      # OpenMP thread count (covers LAPACK and friends)
}

def _apply_env_vars() -> None:
    """Apply determinism env vars to os.environ (idempotent)."""
    for key, value in _DETERMINISM_ENV_VARS.items():
        os.environ[key] = value


# Apply immediately at module import so MKL sees the vars before numpy loads.
_apply_env_vars()


# ─── Runtime enforcement via threadpoolctl ────────────────────────────────────

def enable_determinism(seed: int = 42) -> None:
    """Enable full determinism mode.

    1. (Re-)applies BLAS env vars (belt-and-suspenders; already done at module load).
    2. Uses threadpoolctl to limit all thread pools to 1 at runtime.
    3. Seeds numpy global RNG with the given seed.
    4. Logs confirmation to stderr for audit trail.

    Call this before any numpy/polars operations in entry-point scripts.

    Args:
        seed: Numpy global RNG seed. Defaults to 42 (matches existing engine seeds).

    Raises:
        ImportError: If threadpoolctl is not installed. This is a hard failure —
            silent threadpool drift would produce nondeterministic results
            without any indication to the caller.
    """
    # Step 1: env vars (idempotent)
    _apply_env_vars()

    # Step 2: threadpoolctl runtime limits
    try:
        from threadpoolctl import threadpool_limits
        threadpool_limits(limits=1)
    except ImportError as exc:
        raise ImportError(
            "threadpoolctl is required for determinism enforcement but is not installed. "
            "Install it with: pip install threadpoolctl>=3.0.0\n"
            f"Original error: {exc}"
        ) from exc

    # Step 3: numpy global RNG seed (legacy API — for any code using np.random.*)
    # Guard: Windows WDAC / AppLocker policies can block numpy.random C extension
    # DLLs (numpy.random._bounded_integers etc.). On affected Windows machines the
    # DLL load can DEADLOCK rather than raise ImportError. We check for a known-safe
    # attribute first; if numpy is not yet imported, skip the seed to avoid triggering
    # the blocked DLL chain. Production paths that use np.random.* will fail loudly
    # at the call site with a clear error — not silently here.
    import sys as _sys
    if "numpy" in _sys.modules:
        # numpy already imported earlier in this process — safe to call random.seed
        # since the DLL was already loaded without blocking.
        import numpy as _np
        try:
            _np.random.seed(seed)
        except Exception as _np_exc:  # noqa: BLE001
            import warnings
            warnings.warn(
                f"numpy.random seed failed (WDAC policy?): {_np_exc}. "
                "Determinism seed NOT applied.",
                RuntimeWarning,
                stacklevel=2,
            )
    else:
        # numpy not yet imported — don't trigger the DLL load here.
        # Polars-only tests (W25.2 structure engine) don't need this seed.
        logger.debug(
            "enable_determinism: numpy not in sys.modules — skipping np.random.seed "
            "(WDAC-safe: DLL load deferred to first numpy import site)"
        )

    # Step 4: audit log
    determinism_env = {k: os.environ.get(k, "NOT SET") for k in _DETERMINISM_ENV_VARS}
    logger.debug(
        "determinism.enabled seed=%d env=%s",
        seed,
        json.dumps(determinism_env),
    )
    print(
        f"[determinism] enabled: seed={seed} "
        f"MKL_CBWR={os.environ.get('MKL_CBWR')} "
        f"OPENBLAS={os.environ.get('OPENBLAS_NUM_THREADS')} "
        f"OMP={os.environ.get('OMP_NUM_THREADS')}",
        file=sys.stderr,
    )


def assert_deterministic() -> None:
    """Assert that all determinism env vars are set correctly.

    Call this at the start of any function that requires determinism and
    cannot call enable_determinism() itself (e.g., a utility called from
    multiple entry points).

    Raises:
        RuntimeError: If any required env var is missing or incorrect.
    """
    missing = []
    for key, expected in _DETERMINISM_ENV_VARS.items():
        actual = os.environ.get(key)
        if actual != expected:
            missing.append(f"{key}={actual!r} (expected {expected!r})")

    if missing:
        raise RuntimeError(
            "Determinism env vars not set correctly. Call enable_determinism() first.\n"
            "Missing or wrong: " + ", ".join(missing)
        )


def canonicalize_result(result: Any, float_precision: int = 6) -> str:
    """Canonicalize a backtest result dict to a stable JSON string for byte-equality tests.

    - Sorts all dict keys recursively.
    - Rounds all floats to `float_precision` decimal places.
    - Returns a UTF-8 JSON string with no extra whitespace.

    Used by the determinism test to compare 10 runs byte-for-byte.

    Args:
        result: Backtest result dict (may be nested).
        float_precision: Number of decimal places to round floats to.

    Returns:
        Canonical JSON string.
    """
    def _normalize(obj: Any) -> Any:
        if isinstance(obj, float):
            if obj != obj:  # NaN
                return "NaN"
            if obj == float("inf"):
                return "Inf"
            if obj == float("-inf"):
                return "-Inf"
            return round(obj, float_precision)
        if isinstance(obj, dict):
            return {k: _normalize(v) for k, v in sorted(obj.items())}
        if isinstance(obj, (list, tuple)):
            return [_normalize(v) for v in obj]
        return obj

    normalized = _normalize(result)
    return json.dumps(normalized, separators=(",", ":"), sort_keys=True)


def result_hash(result: Any) -> str:
    """Compute SHA-256 of a canonicalized backtest result.

    Args:
        result: Backtest result dict.

    Returns:
        64-char hex digest.
    """
    canonical = canonicalize_result(result)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
