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


# ═══════════════════════════════════════════════════════════════════════════════════════════
# VECTORBT-TEST-ISOLATION-1 (AR-1101 §2) — ORDER-DEPENDENCE IS A DEFECT, NOT A QUIRK
# ═══════════════════════════════════════════════════════════════════════════════════════════
# 🛑 THE CLASS THIS CLOSES. ~23 test modules mutate `sys.modules["vectorbt"]` AT MODULE SCOPE
# and never restore it. `backtester` imports vectorbt LAZILY IN-FUNCTION (by design, for perf),
# so such a stub OUTLIVES the module that installed it and every later backtest in the session
# resolves to it. When the stub is a `MagicMock`, `int(MagicMock()) == 1` — so `pf.trades.count()`
# silently returns 1.
#
# ⚠️ THAT IS THE SAME NUMBER, IN THE SAME FIELD, ON THE SAME ROUTE as the real F-4 trade-population
# collapse. A test artifact and a production defect became indistinguishable, and it cost a
# 365-file bisect to tell them apart (AR-1097 §5, AR-1100 §3).
# ★ `A MOCK THAT OUTLIVES ITS TEST IS NOT A TEST DOUBLE, IT IS A GLOBAL REDEFINITION OF REALITY.`
#
# 🛑 WHY A SESSION FIXTURE ALONE CANNOT DO THIS — AR-1101 §2 CORRECTED THE SHAPE I PROPOSED.
# pytest IMPORTS test modules during COLLECTION, which happens BEFORE ordinary fixture setup.
# A fixture that snapshots on first test execution would snapshot the ALREADY-POISONED state and
# canonize the defect as the baseline. `pytest_sessionstart` runs after conftest import and
# BEFORE any test module is imported, so it is the earliest point that can see a clean namespace.
# ★ `A BASELINE TAKEN AFTER THE CONTAMINATION IS NOT A BASELINE, IT IS A RECORD OF THE DAMAGE.`

_VBT_BASELINE: dict | None = None


def _vbt_namespace_keys() -> list:
    """Every `vectorbt` / `vectorbt.*` key currently in sys.modules."""
    return [k for k in list(sys.modules) if k == "vectorbt" or k.startswith("vectorbt.")]


def _is_fake_module(mod) -> bool:
    """A stub, not the real package.

    Two shapes are installed by the poisoners and both are caught here:
      * `MagicMock()` — not a ModuleType at all. (Note `getattr(mock, "__file__")` returns a
        truthy auto-attribute, so a `__file__` check ALONE would miss it — the isinstance test
        is what discriminates.)
      * `types.ModuleType("vectorbt")` — a real ModuleType with NO `__file__`.
    The genuine package is a ModuleType WITH a `__file__`.
    """
    if not isinstance(mod, types.ModuleType):
        return True
    return getattr(mod, "__file__", None) is None


def _restore_vbt_baseline() -> list:
    """Drop fake vectorbt entries and restore replaced baseline objects. Returns what changed.

    🛑 FAKES ARE REMOVED, REALS ARE LEFT ALONE. Evicting a genuinely imported vectorbt would
    force a full re-import (and JIT warm-up) on the very next test that needs it — paying a real
    cost to fix an imaginary problem. Only stubs are evicted.
    """
    if _VBT_BASELINE is None:
        return []
    changed = []
    for key in _vbt_namespace_keys():
        current = sys.modules.get(key)
        baseline = _VBT_BASELINE.get(key)
        if key not in _VBT_BASELINE:
            if _is_fake_module(current):
                del sys.modules[key]
                changed.append(f"-{key}")
        elif current is not baseline:
            sys.modules[key] = baseline
            changed.append(f"~{key}")
    return changed


def pytest_sessionstart(session):  # noqa: ARG001 — pytest hook signature
    """Snapshot the vectorbt namespace BEFORE any test module is imported (AR-1101 §2.1)."""
    global _VBT_BASELINE
    _VBT_BASELINE = {k: sys.modules[k] for k in _vbt_namespace_keys()}


@pytest.fixture(autouse=True)
def vectorbt_namespace_isolation():
    """Restore the pre-collection vectorbt baseline around EVERY test (AR-1101 §2.2/§2.3).

    Before, so a module-scope poisoner imported during collection cannot reach this test; and
    after, so a runtime mutation cannot reach the next one.

    Tests that genuinely want a fake vectorbt opt in through `TF_MOCK_VBT=1` /
    `mock_vectorbt_session` — an EXPLICIT, restoring mechanism. What is no longer permitted is a
    permanent module-scope global side effect used as cross-test infrastructure.
    """
    if os.environ.get("TF_MOCK_VBT") == "1":
        yield
        return
    _restore_vbt_baseline()
    yield
    _restore_vbt_baseline()


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

    # 🛑 CORRECTED (AR-1101 §2). This line used to read "Inject before any test module imports —
    # session scope runs first." THAT IS FALSE, and the false claim is why this class went
    # unnoticed: pytest imports test modules during COLLECTION, and ordinary fixture setup —
    # session-scoped included — runs only when the first test that requests it EXECUTES, which is
    # after collection. This fixture cannot pre-empt a module-scope poisoner; only the
    # `pytest_sessionstart` hook above runs early enough.
    # ★ `A COMMENT ASSERTING AN ORDERING GUARANTEE IS STILL A CLAIM, AND THIS ONE WAS WRONG.`
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
