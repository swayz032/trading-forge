"""Tests for the Composition Fidelity Experiment bundle-restoration wiring
(docs/designs/composition-fidelity-experiment-2026-07-05.md, Step 1):
  - src/engine/indicators/{bias,confirmation,sweep,mss}_native.py: fresh, isolated evaluators
  - src/engine/spec_family_bindings.py: TF_COMPOSITION_BUNDLE_ENABLED + per-condition
    restore_condition_ids-gated bundle binding
  - src/engine/spec_condition_compiler.py: SpecConditionStrategy dispatches restored conditions
    to the matching native primitive and records it as a distinct trace contributor

Every test that flips TF_COMPOSITION_BUNDLE_ENABLED restores the prior env state in a
try/finally so this file never leaks the flag into other tests run in the same process/session.

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection over the full
src/engine/tests directory hangs because some module transitively imports the vectorbt-JIT
backtester):

    python -m pytest src/engine/tests/test_composition_bundle_dispatch.py -v
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.indicators.bias_native import compute_bias_signal
from src.engine.indicators.confirmation_native import compute_confirmation_signal
from src.engine.indicators.mss_native import compute_mss_signal
from src.engine.indicators.sweep_native import compute_sweep_signal
from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import bind_condition, compile_binding_plan, resolve_bundle_primitive


@contextmanager
def bundle_enabled(enabled: bool):
    prior = os.environ.get("TF_COMPOSITION_BUNDLE_ENABLED")
    os.environ["TF_COMPOSITION_BUNDLE_ENABLED"] = "true" if enabled else "false"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_COMPOSITION_BUNDLE_ENABLED", None)
        else:
            os.environ["TF_COMPOSITION_BUNDLE_ENABLED"] = prior


def _synthetic_df(n: int = 200, seed: int = 11) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.5, n)
    low = close - rng.uniform(0.1, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    ts = [datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "ts_event": ts, "volume": [100] * n}
    )


# ─── Purity contract (verification bar #1) ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "module_path",
    [
        "src/engine/indicators/bias_native.py",
        "src/engine/indicators/confirmation_native.py",
        "src/engine/indicators/sweep_native.py",
        "src/engine/indicators/mss_native.py",
    ],
)
def test_native_evaluator_purity_contract_no_engine_context_imports(module_path):
    import ast

    with open(module_path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=module_path)

    forbidden_substrings = (
        "structure_engine",
        "bias_engine",
        "htf_context",
        "location_score",
        "archetype",
        "context",
    )
    allowed = {"numpy", "dataclasses", "__future__"}

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                assert top in allowed, f"{module_path} imports disallowed module: {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            top = mod.split(".")[0]
            assert top in allowed, f"{module_path} imports disallowed module: {mod}"
            for forbidden in forbidden_substrings:
                assert forbidden not in mod, f"{module_path} imports forbidden substring '{forbidden}' via {mod}"


# ─── Native evaluator determinism + directionality ─────────────────────────────────────────────

def test_bias_signal_deterministic_and_mutually_exclusive():
    df = _synthetic_df()
    o, h, low_, c = (df[col].to_numpy() for col in ("open", "high", "low", "close"))
    r1 = compute_bias_signal(o, h, low_, c)
    r2 = compute_bias_signal(o, h, low_, c)
    assert np.array_equal(r1.bullish_active, r2.bullish_active)
    assert np.array_equal(r1.bearish_active, r2.bearish_active)
    assert not np.any(r1.bullish_active & r1.bearish_active), "bias must never be both directions on the same bar"
    assert np.array_equal(r1.any_active, r1.bullish_active | r1.bearish_active)


def test_confirmation_signal_deterministic():
    df = _synthetic_df(seed=3)
    o, h, low_, c = (df[col].to_numpy() for col in ("open", "high", "low", "close"))
    r1 = compute_confirmation_signal(o, h, low_, c)
    r2 = compute_confirmation_signal(o, h, low_, c)
    assert np.array_equal(r1.bullish_active, r2.bullish_active)
    assert np.array_equal(r1.bearish_active, r2.bearish_active)


def test_sweep_signal_no_lookahead_shorter_prefix_is_prefix_consistent():
    """A sweep/mss event decided at bar i must never depend on bars > i: truncating the array to
    the first k bars must reproduce the same signal for bars < k - active_bars (persistence window
    aside) as the full-length run."""
    df = _synthetic_df(seed=5, n=120)
    o, h, low_, c = (df[col].to_numpy() for col in ("open", "high", "low", "close"))
    full = compute_sweep_signal(o, h, low_, c)
    truncated = compute_sweep_signal(o[:60], h[:60], low_[:60], c[:60])
    # First 50 bars (well clear of the 60-bar truncation boundary and the 5-bar persistence
    # window) must be byte-identical regardless of what happens after bar 60.
    assert np.array_equal(full.any_active[:50], truncated.any_active[:50])


def test_mss_signal_runs_without_error_on_short_series():
    df = _synthetic_df(seed=9, n=15)
    o, h, low_, c = (df[col].to_numpy() for col in ("open", "high", "low", "close"))
    result = compute_mss_signal(o, h, low_, c)
    assert len(result.any_active) == 15


# ─── spec_family_bindings.py — bundle dispatch resolution ──────────────────────────────────────

def test_resolve_bundle_primitive_covers_expected_families():
    assert resolve_bundle_primitive("WAIT_BIAS", "bullish bias") == "bias_native.compute_bias_signal"
    assert resolve_bundle_primitive("CONFIRM_DIRECTION", "market direction") == "bias_native.compute_bias_signal"
    assert resolve_bundle_primitive("WAIT_CONFIRMATION", "bullish engulfing") == "confirmation_native.compute_confirmation_signal"
    assert resolve_bundle_primitive("WAIT_STRUCTURE", "liquidity sweep") == "sweep_native.compute_sweep_signal"
    assert resolve_bundle_primitive("WAIT_CONFIRMATION", "mss or change in state delivery") == "mss_native.compute_mss_signal"
    assert resolve_bundle_primitive("WAIT_STRUCTURE", "fvg presence") == "fvg_native.compute_fvg_signal"
    assert resolve_bundle_primitive("WAIT_STRUCTURE", "volume profile") is None, "no built evaluator covers this object — honest gap"
    assert resolve_bundle_primitive("WAIT_RETEST", "price") is None, "WAIT_RETEST is not in the built bundle"


def test_bind_condition_restores_only_when_both_flag_and_restore_true():
    cond = {"id": "c1", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"}

    # restore=False, flag on: unaffected (byte-identical to pre-experiment generic binding).
    with bundle_enabled(True):
        b_no_restore = bind_condition(cond, restore=False)
    assert b_no_restore.approximation is True
    assert b_no_restore.primitive == "bias_engine.classify_institutional_regime"

    # restore=True, flag off: unaffected.
    os.environ.pop("TF_COMPOSITION_BUNDLE_ENABLED", None)
    b_flag_off = bind_condition(cond, restore=True)
    assert b_flag_off.approximation is True

    # restore=True, flag on: restored.
    with bundle_enabled(True):
        b_restored = bind_condition(cond, restore=True)
    assert b_restored.approximation is False
    assert b_restored.primitive == "bias_native.compute_bias_signal"


def test_default_restore_condition_ids_none_is_byte_identical():
    """Verification bar #3 (single-variable, byte-identical control): compile_binding_plan's
    new optional param defaults to None, and every existing (pre-experiment) caller passes no
    value — so the binding plan is byte-identical to pre-experiment behavior even with the env
    flag on, as long as no condition id is explicitly targeted."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan_flag_off = compile_binding_plan(spec)
    with bundle_enabled(True):
        plan_flag_on_no_targets = compile_binding_plan(spec)  # restore_condition_ids=None (default)

    by_id_off = {b.condition_id: b for b in plan_flag_off.bindings}
    by_id_on = {b.condition_id: b for b in plan_flag_on_no_targets.bindings}
    assert by_id_off["s1"].to_dict() == by_id_on["s1"].to_dict()


def test_non_gating_sibling_condition_stays_generic_when_only_gating_id_is_restored():
    """Verification bar #3, sibling proof: within ONE strategy, restoring only the gating
    condition's id must leave a non-gating sibling condition of the SAME family untouched."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"},
            {"id": "s2", "type": "WAIT_BIAS", "object": "market bias", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    with bundle_enabled(True):
        plan = compile_binding_plan(spec, restore_condition_ids=frozenset({"s1"}))

    by_id = {b.condition_id: b for b in plan.bindings}
    assert by_id["s1"].approximation is False
    assert by_id["s1"].primitive == "bias_native.compute_bias_signal"
    assert by_id["s2"].approximation is True, "non-targeted sibling must stay on the generic path"
    assert by_id["s2"].primitive == "bias_engine.classify_institutional_regime"


# ─── spec_condition_compiler.py — executable dispatch level ────────────────────────────────────

def _bundle_spec() -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"},
            {"id": "s2", "type": "WAIT_CONFIRMATION", "object": "bullish engulfing", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def test_governance_approximation_flips_when_gating_conditions_restored():
    compiled_spec = {"spec": _bundle_spec(), "spec_hash": "testhash"}
    strat_off = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    assert strat_off.approximation is True

    with bundle_enabled(True):
        strat_on = SpecConditionStrategy(
            compiled_spec, symbol="MES", timeframe="15m", restore_condition_ids=frozenset({"s1", "s2"})
        )
    assert strat_on.approximation is False


def test_compute_populates_last_per_condition_bool_for_restored_conditions():
    df = _synthetic_df()
    compiled_spec = {"spec": _bundle_spec(), "spec_hash": "testhash"}
    with bundle_enabled(True):
        strat = SpecConditionStrategy(
            compiled_spec, symbol="MES", timeframe="15m", restore_condition_ids=frozenset({"s1", "s2"})
        )
        strat.compute(df)
    assert set(strat.last_per_condition_bool.keys()) == {"s1", "s2"}
    assert strat.last_per_condition_bool["s1"].dtype == np.bool_
    assert strat.last_per_condition_bool["s2"].dtype == np.bool_


def test_entry_signals_byte_identical_when_bundle_off_regardless_of_process_env_history():
    """Replay-determinism guard, same pattern as the FVG experiment's equivalent test: building
    the OFF-mode strategy AFTER an ON-mode run in the same process must produce byte-identical
    entries to a fresh OFF-mode-only run."""
    df = _synthetic_df()
    compiled_spec = {"spec": _bundle_spec(), "spec_hash": "testhash"}

    os.environ.pop("TF_COMPOSITION_BUNDLE_ENABLED", None)
    baseline = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    baseline_out = baseline.compute(df)

    with bundle_enabled(True):
        SpecConditionStrategy(
            compiled_spec, symbol="MES", timeframe="15m", restore_condition_ids=frozenset({"s1", "s2"})
        ).compute(df)

    os.environ.pop("TF_COMPOSITION_BUNDLE_ENABLED", None)
    after = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    after_out = after.compute(df)

    assert baseline_out["entry_long"].to_list() == after_out["entry_long"].to_list()
    assert baseline_out["entry_short"].to_list() == after_out["entry_short"].to_list()


def test_non_target_strategy_byte_identical_when_restore_condition_ids_empty():
    """Non-target control (Step 2): a strategy passed an EMPTY restore set (none of its
    conditions are in any gating set) must be byte-identical to the bundle-off baseline even
    with the flag on."""
    df = _synthetic_df()
    compiled_spec = {"spec": _bundle_spec(), "spec_hash": "testhash"}

    baseline = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    baseline_out = baseline.compute(df)

    with bundle_enabled(True):
        non_target = SpecConditionStrategy(
            compiled_spec, symbol="MES", timeframe="15m", restore_condition_ids=frozenset()
        )
        non_target_out = non_target.compute(df)

    assert baseline_out["entry_long"].to_list() == non_target_out["entry_long"].to_list()
    assert baseline_out["entry_short"].to_list() == non_target_out["entry_short"].to_list()
    assert non_target.approximation is True
