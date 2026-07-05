"""Tests for the FVG Identity Dispatch Experiment wiring
(docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md, Part B):
  - src/engine/spec_family_bindings.py: TF_FVG_IDENTITY_ENABLED-gated FVG-family binding override
  - src/engine/spec_condition_compiler.py: SpecConditionStrategy evaluates that binding via
    fvg_native.compute_fvg_signal and records a distinct `fvg_native.compute_fvg_signal`
    contributor in the execution trace (point-8: routing != preservation unless the executable
    path actually evaluates the distinct primitive).

Every test that flips TF_FVG_IDENTITY_ENABLED restores the prior env state in a try/finally so
this file never leaks the flag into other tests run in the same process/session.

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection over the full
src/engine/tests directory hangs because some module transitively imports the vectorbt-JIT
backtester):

    python -m pytest src/engine/tests/test_fvg_identity_dispatch.py -v
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import bind_condition, compile_binding_plan


@contextmanager
def fvg_identity(enabled: bool):
    prior = os.environ.get("TF_FVG_IDENTITY_ENABLED")
    os.environ["TF_FVG_IDENTITY_ENABLED"] = "true" if enabled else "false"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
        else:
            os.environ["TF_FVG_IDENTITY_ENABLED"] = prior


# ─── spec_family_bindings.py — binding-plan level ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "obj",
    ["fvg presence", "fair value gap retest", "market imbalance", "put limit order right fvg"],
)
def test_fvg_object_binds_to_native_primitive_when_enabled(obj):
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": obj, "role": "spine"}
    with fvg_identity(True):
        b = bind_condition(cond)
    assert b.bindable is True
    assert b.primitive == "fvg_native.compute_fvg_signal"
    assert b.approximation is False, "the fresh detector is a faithful port, not an approximation"


def test_fvg_filter_condition_also_dispatches_when_enabled():
    cond = {"id": "c1", "type": "FILTER", "object": "fvg overlap with range high", "role": "spine"}
    with fvg_identity(True):
        b = bind_condition(cond)
    assert b.primitive == "fvg_native.compute_fvg_signal"
    assert b.approximation is False


def test_non_fvg_wait_structure_unaffected_by_flag():
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "bearish candlestick", "role": "spine"}
    with fvg_identity(True):
        b_on = bind_condition(cond)
    b_off = bind_condition(cond)
    assert b_on.primitive == b_off.primitive == "structure_engine.compute_structure_state"
    assert b_on.approximation is True and b_off.approximation is True


def test_flag_default_off_is_byte_identical_to_pre_experiment_behavior():
    """Verification bar #3 (single-variable, byte-identical control) at the binding-plan level:
    with the env var absent (the shipped default), an FVG-object WAIT_STRUCTURE condition binds
    EXACTLY as it did before this experiment (generic structure_engine, approximation=True)."""
    os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "fvg presence", "role": "spine"}
    b = bind_condition(cond)
    assert b.primitive == "structure_engine.compute_structure_state"
    assert b.approximation is True


def test_flag_explicitly_false_matches_flag_absent():
    cond = {"id": "c1", "type": "FILTER", "object": "fvg candle position", "role": "spine"}
    with fvg_identity(False):
        b_explicit_false = bind_condition(cond)
    os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    b_absent = bind_condition(cond)
    assert b_explicit_false.to_dict() == b_absent.to_dict()


def test_fidelity_relevant_fields_flip_only_for_fvg_conditions_in_a_mixed_spec():
    """Fidelity-score mechanical check (verification bar #2): a spec with one FVG spine
    condition and one non-FVG spine condition sees ONLY the FVG condition's approximation flag
    flip when the identity dispatch is enabled — the non-FVG sibling is untouched."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "fvg presence", "role": "spine"},
            {"id": "s2", "type": "WAIT_STRUCTURE", "object": "bearish candlestick", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    plan_off = compile_binding_plan(spec)
    with fvg_identity(True):
        plan_on = compile_binding_plan(spec)

    by_id_off = {b.condition_id: b for b in plan_off.bindings}
    by_id_on = {b.condition_id: b for b in plan_on.bindings}

    assert by_id_off["s1"].approximation is True and by_id_on["s1"].approximation is False
    assert by_id_off["s1"].primitive != by_id_on["s1"].primitive

    assert by_id_off["s2"].to_dict() == by_id_on["s2"].to_dict(), (
        "non-FVG sibling condition must be byte-identical across the flag toggle"
    )


# ─── spec_condition_compiler.py — executable / trace level ─────────────────────────────────────

def _synthetic_df(n: int = 60, seed: int = 7) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.5, n)
    low = close - rng.uniform(0.1, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    ts = [datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "ts_event": ts, "volume": [100] * n}
    )


def _fvg_spec() -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "fvg presence", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def test_governance_labels_approximation_flips_with_the_flag():
    compiled_spec = {"spec": _fvg_spec(), "spec_hash": "testhash"}
    os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    strat_off = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    assert strat_off.approximation is True

    with fvg_identity(True):
        strat_on = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    assert strat_on.approximation is False


def test_trace_shows_distinct_fvg_primitive_contributor_when_enabled():
    """Point-8 verification (verification bar #4): the fired-condition's `primitive` field in
    spec_trace must name the fresh fvg_native primitive, not the generic structure_engine one,
    proving the executable path actually evaluated the distinct object — not merely relabeled a
    routing decision that still runs the generic evaluator underneath."""
    df = _synthetic_df()
    compiled_spec = {"spec": _fvg_spec(), "spec_hash": "testhash"}

    with fvg_identity(True):
        strat = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m", trace=True)
        strat.compute(df)

    if not strat.last_trace:
        pytest.skip("no entry signal fired on this synthetic fixture/seed — nothing to inspect")
    fired_primitives = {c["primitive"] for rec in strat.last_trace for c in rec["conditions"]}
    assert "fvg_native.compute_fvg_signal" in fired_primitives
    assert "structure_engine.compute_structure_state" not in fired_primitives


def test_entry_signals_are_byte_identical_when_flag_off_regardless_of_process_env_history():
    """Replay-determinism guard: constructing the OFF-mode strategy AFTER an ON-mode run in the
    same process must produce byte-identical entry columns to a fresh OFF-mode-only run — the
    env-gated read must never leak cached state across strategy instances."""
    df = _synthetic_df()
    compiled_spec = {"spec": _fvg_spec(), "spec_hash": "testhash"}

    os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    baseline = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    baseline_out = baseline.compute(df)

    with fvg_identity(True):
        SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m").compute(df)

    os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    after = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    after_out = after.compute(df)

    assert baseline_out["entry_long"].to_list() == after_out["entry_long"].to_list()
    assert baseline_out["entry_short"].to_list() == after_out["entry_short"].to_list()
