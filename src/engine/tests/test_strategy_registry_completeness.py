"""F-4 regression (deep-scan #21 Band-B2 carry-forward, closed 2026-07-06):
strategy-registry completeness — every hand-coded archetype class in
src/engine/strategies/*.py MUST normalize-match playbook_router.ALL_STRATS.

WHY THIS TEST DIDN'T EXIST BEFORE: eligibility_gate.py::evaluate_signal (and
its mirror, backtester.py::apply_eligibility_gate) both special-case any
strategy_name that fails to normalize-match ALL_STRATS: the LIVE path returns
action="TAKE" unconditionally (bypassing all 9 hard-SKIP checks including the
Check 0 structural-stop-ceiling guard), and the BACKTEST path fully bypasses
the 7-layer eligibility overlay. That bypass is the intentional, audited
mechanism for the ~150-entry graduated DSL library (ExpressionStrategy
instances whose `.name` comes from a live DB row, not a static class
attribute) which are grandfathered until each is explicitly onboarded.

But it ALSO silently swallowed 7 of the 22 hand-coded archetype classes
(bounce_off_level, ict_bias_aligned_continuation, gann_box_4h_continuation,
unicorn, turtle_soup, smt_reversal, ict_2022) — a population that SHOULD
always be registered, since these are permanent engine strategies, not
DB-driven DSL rows. Nothing asserted "the hand-coded population is fully
registered", so the gap survived multiple deep-scans. This test closes that
hole: it dynamically discovers every concrete BaseStrategy subclass under
src/engine/strategies/ and asserts its `.name` is in ALL_STRATS using the
EXACT normalization eligibility_gate.py and backtester.py both use.

Scope: this test intentionally does NOT cover the DSL-graduated library (those
names live in the DB, not in a Python module) — that population's bypass is
the documented, audited grandfather path (see eligibility_gate.py's ds21
comment). This test's job is narrower and permanent: the *hand-coded engine
archetypes* must never silently fall through the same bypass.
"""
from __future__ import annotations

import importlib
import inspect
import pkgutil
from pathlib import Path

import src.engine.strategies as strategies_pkg
from src.engine.context.playbook_router import ALL_STRATS
from src.engine.strategy_base import BaseStrategy, ExpressionStrategy


def _normalize(name: str) -> str:
    """Mirrors eligibility_gate.py / backtester.py's exact normalization."""
    return name.lower().replace("strategy", "").strip().replace("_", "")


def _discover_archetype_classes() -> list[type]:
    """Import every module under src/engine/strategies/ and collect concrete
    BaseStrategy subclasses that declare a static `.name` class attribute
    (i.e. hand-coded archetypes, NOT ExpressionStrategy which sets `.name`
    only at __init__ time from a DB-sourced StrategyConfig)."""
    pkg_path = Path(strategies_pkg.__file__).parent
    classes: list[type] = []

    for _, module_name, is_pkg in pkgutil.iter_modules([str(pkg_path)]):
        if is_pkg:
            continue
        full_name = f"src.engine.strategies.{module_name}"
        module = importlib.import_module(full_name)

        for _, obj in inspect.getmembers(module, inspect.isclass):
            if obj is BaseStrategy or obj is ExpressionStrategy:
                continue
            if not issubclass(obj, BaseStrategy):
                continue
            if obj.__module__ != full_name:
                continue  # skip re-exported/imported classes from other modules
            if inspect.isabstract(obj):
                continue
            # Hand-coded archetypes declare `name` as a plain class attribute
            # (a str, not the bare `name: str` annotation on BaseStrategy).
            class_level_name = obj.__dict__.get("name")
            if not isinstance(class_level_name, str):
                continue
            classes.append(obj)

    return classes


def test_every_hand_coded_archetype_is_registered_in_all_strats():
    """The regression test whose absence let the F-4 gap survive: every
    concrete hand-coded strategy class under src/engine/strategies/*.py must
    normalize-match playbook_router.ALL_STRATS. A failure here means a new
    archetype was added without being routed through the eligibility gate."""
    archetype_classes = _discover_archetype_classes()

    # Sanity: we must actually have discovered a non-trivial population,
    # otherwise this test would trivially "pass" while checking nothing.
    assert len(archetype_classes) >= 20, (
        f"expected >=20 hand-coded archetype classes, found {len(archetype_classes)} "
        f"— the discovery mechanism may be broken (check pkgutil.iter_modules scope)"
    )

    all_strats_normalized = {_normalize(s) for s in ALL_STRATS}

    unregistered = []
    for cls in archetype_classes:
        strat_name = cls.__dict__["name"]
        if _normalize(strat_name) not in all_strats_normalized:
            unregistered.append((cls.__name__, strat_name))

    assert not unregistered, (
        "The following hand-coded archetype classes are NOT registered in "
        "playbook_router.ALL_STRATS — their live signals bypass the full "
        "eligibility gate (action=TAKE unconditionally, including skipping "
        "the Check 0 structural-stop-ceiling guard) and their backtest "
        "signals bypass the 7-layer overlay entirely "
        "(passthrough_strategy_unregistered). Register each in the correct "
        "CONTINUATION_STRATS / REVERSAL_STRATS / MEAN_REV_STRATS / ORB_STRATS "
        "list after verifying its entry-logic docstring: "
        f"{unregistered}"
    )


def test_all_7_f4_archetypes_specifically_registered():
    """Pin the exact 7 archetypes named in the F-4 finding — a narrower,
    faster-to-read companion to the exhaustive scan above. If this test is
    ever the ONLY one failing (exhaustive scan passing), something re-broke
    exactly this documented set."""
    f4_archetypes = [
        "bounce_off_level",
        "ict_bias_aligned_continuation",
        "gann_box_4h_continuation",
        "unicorn",
        "turtle_soup",
        "smt_reversal",
        "ict_2022",
    ]
    all_strats_normalized = {_normalize(s) for s in ALL_STRATS}
    for name in f4_archetypes:
        assert _normalize(name) in all_strats_normalized, (
            f"F-4 archetype {name!r} is missing from playbook_router.ALL_STRATS"
        )


def test_f4_archetypes_route_to_expected_playbook_category():
    """Verifies each F-4 archetype landed in the category its own entry-logic
    docstring supports (see playbook_router.py's F-4 comment block for the
    full per-archetype rationale) — catches a silent re-categorization that
    would route a signal to the wrong per-playbook allow-list."""
    from src.engine.context.playbook_router import (
        CONTINUATION_STRATS,
        MEAN_REV_STRATS,
        REVERSAL_STRATS,
    )

    expected = {
        "ict_bias_aligned_continuation": CONTINUATION_STRATS,
        "gann_box_4h_continuation": CONTINUATION_STRATS,
        "turtle_soup": REVERSAL_STRATS,
        "smt_reversal": REVERSAL_STRATS,
        "ict_2022": REVERSAL_STRATS,
        "unicorn": REVERSAL_STRATS,
        "bounce_off_level": MEAN_REV_STRATS,
    }
    for name, expected_list in expected.items():
        assert name in expected_list, (
            f"{name!r} expected in {expected_list!r} but was not found there "
            "(check for accidental re-categorization)"
        )
