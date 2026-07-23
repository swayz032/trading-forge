"""Repository-wide pytest bootstrap.

The suite historically imports the Python engine both as ``engine`` and as
``src.engine``.  Loading both names creates two independent module graphs, so a
fixture can patch one graph while the code under test executes the other.  Use
``src.engine`` as the canonical identity and retain ``engine`` as an alias for
backward-compatible imports.
"""

from __future__ import annotations

import importlib
import sys

import pytest

_canonical_engine = importlib.import_module("src.engine")
sys.modules["engine"] = _canonical_engine

# Several legacy tests install a vectorbt stand-in at module collection time.
# Import the production backtester first so those test-local dependency doubles
# cannot determine the implementation imported by unrelated tests later in the
# same session. Individual tests can still monkeypatch call boundaries.
importlib.import_module("src.engine.backtester")

# Some legacy modules install collection-time vectorbt doubles in sys.modules.
# Preserve the real dependency so integration tests can opt out of that global
# collection side effect without disrupting the tests that intentionally use it.
_real_vectorbt = importlib.import_module("vectorbt")


@pytest.fixture
def real_vectorbt_module():
    return _real_vectorbt
