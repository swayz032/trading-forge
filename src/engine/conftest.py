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
