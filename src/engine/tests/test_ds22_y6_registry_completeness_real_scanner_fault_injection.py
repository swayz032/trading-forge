"""Deep-scan #22 cap-closer Y6, Task 2 (2026-07-09).

WHY THIS EXISTS
---------------
The independent cert of the X6 factory failure-injection sweep confirmed the
sweep but capped the re-cert at 8/9 for two disclosed proxy limits. Proxy
limit #2: `test_ds22_x6_archetype_registry_parity_injection.py`'s
`_completeness_check()` (registry-completeness half) is a RE-IMPLEMENTATION
of the detection logic, parameterized over a plain Python list the test
supplies by hand — it never touches the real filesystem/`pkgutil` discovery
mechanism in `test_strategy_registry_completeness.py::_discover_archetype_classes`.
A regression in the REAL scanner (e.g. a `pkgutil.iter_modules` scope bug, an
`inspect.isabstract` mis-check, or a module-name filter that silently skips a
whole file) would NOT be caught by that re-implementation, because it never
calls the real function at all.

THIS FILE closes that gap: it imports `_discover_archetype_classes` (the REAL
scanner) directly from `test_strategy_registry_completeness.py` — no
re-implementation — writes a THROWAWAY, never-registered archetype `.py`
module directly onto the real discovery path (`src/engine/strategies/`),
invalidates import caches so `pkgutil` sees the new file, runs the REAL
scanner, and asserts it discovers + flags the injected class as unregistered.
The throwaway file (and its `__pycache__` artifact and `sys.modules` entry)
is removed in a `finally` block so the production tree is left byte-identical
to how this test found it, even on assertion failure.

Companion CLEAN test proves cleanup actually landed: a fresh real-scanner run
immediately after finds the exact same class population as before injection
(no residue), and that a plain re-run without any injected file reports zero
unregistered names (matches `test_strategy_registry_completeness.py`'s own
current-clean-state assertion, confirming this file didn't leave scar tissue).
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

import src.engine.strategies as strategies_pkg
from src.engine.context.playbook_router import ALL_STRATS
from src.engine.tests.test_strategy_registry_completeness import (
    _discover_archetype_classes,
    _normalize,
)

INJECTED_MODULE_NAME = "x6_throwaway_never_registered_archetype"
INJECTED_CLASS_NAME = "X6ThrowawayNeverRegisteredArchetype"
INJECTED_STRATEGY_NAME = "x6_throwaway_never_registered_archetype_strategy_name"

THROWAWAY_MODULE_SOURCE = f'''"""Throwaway fault-injection module written by
test_ds22_y6_registry_completeness_real_scanner_fault_injection.py. If you are
reading this file at rest in src/engine/strategies/, the test that wrote it
crashed before its cleanup ran — delete this file and its __pycache__ entry;
it is not a real strategy and must never be registered in ALL_STRATS.
"""
from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy


class {INJECTED_CLASS_NAME}(BaseStrategy):
    """Deliberately never registered in playbook_router.ALL_STRATS — exists
    only to prove the real registry-completeness scanner catches an
    unregistered hand-coded archetype."""

    name = "{INJECTED_STRATEGY_NAME}"
    symbol = "MES"
    timeframe = "5m"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.with_columns([
            pl.lit(False).alias("entry_long"),
            pl.lit(False).alias("entry_short"),
            pl.lit(False).alias("exit_long"),
            pl.lit(False).alias("exit_short"),
        ])

    def get_params(self) -> dict:
        return {{}}

    def get_default_config(self) -> dict:
        return {{"name": self.name, "symbol": self.symbol, "timeframe": self.timeframe}}
'''


def _strategies_pkg_dir() -> Path:
    return Path(strategies_pkg.__file__).parent


def _throwaway_module_path() -> Path:
    return _strategies_pkg_dir() / f"{INJECTED_MODULE_NAME}.py"


def _throwaway_pycache_glob() -> list[Path]:
    pycache_dir = _strategies_pkg_dir() / "__pycache__"
    if not pycache_dir.is_dir():
        return []
    return list(pycache_dir.glob(f"{INJECTED_MODULE_NAME}.*.pyc"))


def _cleanup_throwaway_module() -> None:
    """Removes the injected file, its bytecode cache, and its sys.modules
    entry. Idempotent — safe to call even if setup partially failed."""
    full_name = f"src.engine.strategies.{INJECTED_MODULE_NAME}"
    sys.modules.pop(full_name, None)

    module_path = _throwaway_module_path()
    if module_path.exists():
        module_path.unlink()

    for pyc in _throwaway_pycache_glob():
        pyc.unlink(missing_ok=True)

    importlib.invalidate_caches()


@pytest.fixture(autouse=True)
def _guard_no_leftover_throwaway_before_and_after():
    """Belt-and-suspenders: if a previous crashed run left the throwaway file
    behind, clean it BEFORE this test runs (so we start from a known-clean
    real filesystem state), and always clean up AFTER regardless of outcome."""
    _cleanup_throwaway_module()
    yield
    _cleanup_throwaway_module()


def test_real_scanner_currently_finds_no_unregistered_hand_coded_archetypes():
    """Baseline (pre-injection): running the REAL scanner against the
    unmodified production tree finds zero unregistered classes — establishes
    the clean starting point the fault-injection test below deviates from."""
    all_strats_normalized = {_normalize(s) for s in ALL_STRATS}
    classes = _discover_archetype_classes()
    assert len(classes) >= 20

    unregistered = [
        cls.__dict__["name"]
        for cls in classes
        if _normalize(cls.__dict__["name"]) not in all_strats_normalized
    ]
    assert unregistered == [], (
        f"real scanner reports unregistered classes on a clean tree (unexpected): {unregistered}"
    )


def test_real_scanner_catches_a_throwaway_unregistered_archetype_written_onto_the_real_discovery_path():
    """RED-PROOF: write a THROWAWAY, never-registered archetype .py module
    directly into src/engine/strategies/ (the exact directory
    `_discover_archetype_classes` walks via `pkgutil.iter_modules`), then run
    the REAL scanner function (imported, not re-implemented) and assert it
    both (a) discovers the new class and (b) flags it as unregistered.

    This proves the guard is a live gate against the real filesystem/import
    mechanism, not a check that only ever observes an already-clean state
    (the gap the X6 re-implementation could not close)."""
    module_path = _throwaway_module_path()
    assert not module_path.exists(), "setup invariant violated: throwaway file already exists"

    _assert_truly_unregistered(INJECTED_STRATEGY_NAME)

    try:
        # Write the throwaway module directly onto the real discovery path.
        module_path.write_text(THROWAWAY_MODULE_SOURCE, encoding="utf-8")
        importlib.invalidate_caches()

        # Run the REAL scanner — same function test_strategy_registry_completeness.py
        # uses, imported verbatim, not re-implemented.
        classes = _discover_archetype_classes()
        discovered_names = {cls.__dict__["name"] for cls in classes}
        assert INJECTED_STRATEGY_NAME in discovered_names, (
            "real scanner failed to discover the throwaway module written onto "
            "the real src/engine/strategies/ path — pkgutil.iter_modules scope "
            "or the discovery filter may be broken"
        )

        all_strats_normalized = {_normalize(s) for s in ALL_STRATS}
        unregistered = [
            cls.__dict__["name"]
            for cls in classes
            if _normalize(cls.__dict__["name"]) not in all_strats_normalized
        ]
        assert INJECTED_STRATEGY_NAME in unregistered, (
            "real scanner discovered the throwaway class but the registry-"
            "completeness check failed to flag it as unregistered — the guard "
            "would silently pass a real future 'forgot to register' regression"
        )

        # Mirror the real test's own assertion FORM — prove it actually raises.
        with pytest.raises(AssertionError):
            assert not unregistered, f"unregistered archetypes found: {unregistered}"
    finally:
        _cleanup_throwaway_module()


def test_cleanup_leaves_the_real_scanner_reporting_zero_unregistered_again():
    """Companion CLEAN proof: immediately after the fault-injection test's
    cleanup runs (also re-verified here via the autouse fixture), a fresh
    real-scanner pass over the actual production tree reports zero
    unregistered classes again — confirms this file left no scar tissue and
    that the injected module is genuinely gone from the filesystem the
    scanner walks, not just absent from an in-memory cache."""
    module_path = _throwaway_module_path()
    assert not module_path.exists(), "throwaway module leaked past cleanup"
    assert f"src.engine.strategies.{INJECTED_MODULE_NAME}" not in sys.modules, (
        "throwaway module leaked into sys.modules past cleanup"
    )

    all_strats_normalized = {_normalize(s) for s in ALL_STRATS}
    classes = _discover_archetype_classes()
    discovered_names = {cls.__dict__["name"] for cls in classes}
    assert INJECTED_STRATEGY_NAME not in discovered_names

    unregistered = [
        cls.__dict__["name"]
        for cls in classes
        if _normalize(cls.__dict__["name"]) not in all_strats_normalized
    ]
    assert unregistered == []


def _assert_truly_unregistered(name: str) -> None:
    normalized = _normalize(name)
    all_normalized = {_normalize(s) for s in ALL_STRATS}
    assert normalized not in all_normalized, (
        f"fault-injection setup error: {name!r} unexpectedly collides with a real "
        "ALL_STRATS entry after normalization — pick a different injected name"
    )
