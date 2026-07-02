"""pytest configuration for the Trading Forge backtest engine.

Autouse fixture that enables determinism mode for ALL engine tests.
This ensures that:
- BLAS/OMP thread counts are limited to 1.
- numpy global RNG is seeded.
- All 4 determinism env vars are set before any test imports numpy.

Note: the determinism module applies env vars at import time (module-level),
so importing conftest first is sufficient to set them before numpy loads.

This file is discovered automatically by pytest when placed at the package
root (src/engine/). No explicit conftest registration is needed.
"""

import os
import sys
import types

import pytest

from src.engine.determinism import enable_determinism

# H7 fix: allow fixed_contracts=1 in all unit tests.
# The H7 guard (raises ValueError on fixed_contracts=1 without this flag)
# is a production safety check — not appropriate for unit tests that intentionally
# use fixed_contracts=1 for simplicity. This env var is set session-wide here
# so all existing tests continue to work without modification.
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


@pytest.fixture(autouse=True, scope="session")
def determinism_mode():
    """Session-scoped autouse fixture: enable determinism once for all engine tests.

    Session scope is correct here because:
    1. BLAS thread limits and env vars are process-global — setting per-test
       would be redundant and add overhead.
    2. numpy global RNG seed is reset once at session start; individual tests
       that need per-test RNG control should use their own local RNG instances
       (np.random.Generator), which are not affected by this seed.
    3. threadpoolctl limits persist for the duration of the process.

    If threadpoolctl is not installed, the fixture raises ImportError with a
    clear message rather than silently proceeding with nondeterministic state.
    """
    enable_determinism(seed=42)
    yield
    # No teardown needed — determinism stays on for the full test session.
    # Restoring thread pools would be complex and the process exits anyway.


@pytest.fixture(scope="session", autouse=False)
def mock_vectorbt_session():
    """OPT-IN session-scoped fixture: inject a minimal vectorbt stub into sys.modules.

    Activated when env TF_MOCK_VBT=1 is set before running pytest.
    Integration tests that require the real vectorbt JIT backtester must leave
    TF_MOCK_VBT unset (or set to any value other than "1").

    Usage:
        TF_MOCK_VBT=1 python -m pytest src/engine/tests/test_my_module.py

    The stub exposes only the attributes that engine modules reference at import
    time (Portfolio class).  Tests that actually call vectorbt methods need to
    patch those methods in the test body; this fixture only prevents the Numba
    JIT compilation hang that occurs when vectorbt is imported for collection.

    L2 fix 2026-06-28: centralises the vectorbt stub that was previously
    copy-pasted into each test file, reducing maintenance surface and preventing
    the multi-minute Numba JIT hang under pytest collection on the tower.
    """
    if os.environ.get("TF_MOCK_VBT") != "1":
        # Not requested — do nothing; existing test behaviour is unchanged.
        yield
        return

    # Build a minimal stub module hierarchy: vectorbt + vectorbt.portfolio
    _vbt_portfolio_stub = types.ModuleType("vectorbt.portfolio")
    _vbt_portfolio_stub.Portfolio = type("Portfolio", (), {})  # type: ignore[assignment]

    _vbt_stub = types.ModuleType("vectorbt")
    _vbt_stub.portfolio = _vbt_portfolio_stub  # type: ignore[attr-defined]
    _vbt_stub.Portfolio = _vbt_portfolio_stub.Portfolio  # convenience alias

    # Inject before any test module imports — session scope runs first.
    _previously_present = "vectorbt" in sys.modules
    _old_vbt = sys.modules.get("vectorbt")
    _old_vbt_portfolio = sys.modules.get("vectorbt.portfolio")

    sys.modules["vectorbt"] = _vbt_stub
    sys.modules["vectorbt.portfolio"] = _vbt_portfolio_stub

    yield

    # Restore previous state (important for test isolation if multiple sessions run).
    if _previously_present and _old_vbt is not None:
        sys.modules["vectorbt"] = _old_vbt
    else:
        sys.modules.pop("vectorbt", None)

    if _old_vbt_portfolio is not None:
        sys.modules["vectorbt.portfolio"] = _old_vbt_portfolio
    else:
        sys.modules.pop("vectorbt.portfolio", None)
