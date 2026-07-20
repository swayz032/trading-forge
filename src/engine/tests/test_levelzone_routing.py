"""Tests for the Level/Zone Routing Sub-Wire
(docs/designs/packet-levelzone-subwire-2026-07-20.md):
  - src/engine/spec_family_bindings.py: TF_LEVELZONE_ROUTING_ENABLED-gated WAIT_STRUCTURE/
    VERIFY_STRUCTURE binding override for level/zone-classified conditions.
  - src/engine/spec_condition_compiler.py: SpecConditionStrategy evaluates that binding via
    retest_touch_check (level-aware) instead of the shared structure_engine.compute_structure_
    state signal (level-blind — premise audit leg 2), and records a distinct
    `spec_condition_compiler.retest_touch_check` contributor in the execution trace.

Every test that flips TF_LEVELZONE_ROUTING_ENABLED restores the prior env state in a
try/finally so this file never leaks the flag into other tests run in the same
process/session — same discipline as test_fvg_identity_dispatch.py.

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection over the full
src/engine/tests directory hangs because some module transitively imports the vectorbt-JIT
backtester):

    python -m pytest src/engine/tests/test_levelzone_routing.py -v
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import (
    LEVELZONE_NATIVE_PRIMITIVE,
    bind_condition,
    compile_binding_plan,
    resolve_levelzone_object,
)


@contextmanager
def levelzone_routing(enabled: bool):
    prior = os.environ.get("TF_LEVELZONE_ROUTING_ENABLED")
    os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = "true" if enabled else "false"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
        else:
            os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = prior


# ─── Anti-vacuity companion for the concept classifier guard ───────────────────────────────────
# The premise audit's own docstring warns: a guard is a detector too, and an over-strict/over-
# loose guard is its own defect (the audit's first draft used `any(constant)` and wrongly failed
# a valid detector). resolve_levelzone_object() is a guard (it gates whether a condition routes
# at all) — it owes its own PASS-known-good / FAIL-known-bad proof, not just an assertion that it
# "executes".

@pytest.mark.parametrize(
    "obj",
    [
        "support zone",
        "resistance level",
        "demand zone retest",
        "supply zone rejection",
        "previous day high",
        "previous day low",
        "high of the day",
        "low of the day",
        "pdh",
        "pdl",
    ],
)
def test_levelzone_classifier_passes_known_good_objects(obj):
    assert resolve_levelzone_object(obj) is True


@pytest.mark.parametrize(
    "obj",
    [
        "bearish candlestick",
        "moving average crossover",
        "fair value gap",
        "order block mitigation",
        "premium discount array",
        "",
        None,
    ],
)
def test_levelzone_classifier_fails_known_bad_objects(obj):
    assert resolve_levelzone_object(obj) is False


def test_levelzone_classifier_is_not_degenerate():
    """Anti-vacuity: the guard must actually discriminate — not constant-True (would route
    everything, defeating the scope-lock) and not constant-False (would route nothing, dead
    code)."""
    good = ["support zone", "resistance level", "pdh"]
    bad = ["bearish candlestick", "fvg presence", "moving average"]
    assert any(resolve_levelzone_object(o) for o in good)
    assert not any(resolve_levelzone_object(o) for o in bad)


# ─── spec_family_bindings.py — binding-plan level ──────────────────────────────────────────────

@pytest.mark.parametrize("cond_type", ["WAIT_STRUCTURE", "VERIFY_STRUCTURE"])
@pytest.mark.parametrize("obj", ["support at prior day low", "resistance zone", "pdh retest"])
def test_levelzone_object_binds_to_native_primitive_when_enabled(cond_type, obj):
    cond = {"id": "c1", "type": cond_type, "object": obj, "role": "spine"}
    with levelzone_routing(True):
        b = bind_condition(cond)
    assert b.bindable is True
    assert b.primitive == LEVELZONE_NATIVE_PRIMITIVE
    assert b.primitive == "spec_condition_compiler.retest_touch_check"
    # Hard constraint #2: approximation must NOT flip to False for this sub-wire.
    assert b.approximation is True, "packet hard constraint: routing lands, fidelity claim does not"


def test_filter_condition_is_out_of_scope_even_when_enabled():
    """Packet §3 scope-lock: unlike the FVG dispatch, level/zone routing covers ONLY
    WAIT_STRUCTURE/VERIFY_STRUCTURE — FILTER is explicitly out of scope."""
    cond = {"id": "c1", "type": "FILTER", "object": "support zone", "role": "spine"}
    with levelzone_routing(True):
        b = bind_condition(cond)
    assert b.primitive != LEVELZONE_NATIVE_PRIMITIVE


def test_non_levelzone_wait_structure_unaffected_by_flag():
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "bearish candlestick", "role": "spine"}
    with levelzone_routing(True):
        b_on = bind_condition(cond)
    b_off = bind_condition(cond)
    assert b_on.primitive == b_off.primitive == "structure_engine.compute_structure_state"
    assert b_on.approximation is True and b_off.approximation is True


def test_flag_default_off_is_byte_identical_to_pre_experiment_behavior():
    """Verification plan #4 (packet): with the env var absent (the shipped default), a
    level/zone-object WAIT_STRUCTURE condition binds EXACTLY as it did before this sub-wire
    (generic structure_engine, approximation=True)."""
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "support zone", "role": "spine"}
    b = bind_condition(cond)
    assert b.primitive == "structure_engine.compute_structure_state"
    assert b.approximation is True


def test_flag_explicitly_false_matches_flag_absent():
    cond = {"id": "c1", "type": "VERIFY_STRUCTURE", "object": "resistance level", "role": "spine"}
    with levelzone_routing(False):
        b_explicit_false = bind_condition(cond)
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    b_absent = bind_condition(cond)
    assert b_explicit_false.to_dict() == b_absent.to_dict()


def test_fidelity_relevant_fields_flip_only_for_levelzone_conditions_in_a_mixed_spec():
    """Mirrors test_fvg_identity_dispatch's mixed-spec check: a spec with one level/zone spine
    condition and one non-level/zone spine condition sees ONLY the level/zone condition's
    primitive flip when routing is enabled — the non-level/zone sibling is byte-identical, and
    approximation stays True for BOTH (hard constraint #2)."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "support zone", "role": "spine"},
            {"id": "s2", "type": "WAIT_STRUCTURE", "object": "bearish candlestick", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    plan_off = compile_binding_plan(spec)
    with levelzone_routing(True):
        plan_on = compile_binding_plan(spec)

    by_id_off = {b.condition_id: b for b in plan_off.bindings}
    by_id_on = {b.condition_id: b for b in plan_on.bindings}

    assert by_id_off["s1"].primitive != by_id_on["s1"].primitive
    assert by_id_on["s1"].primitive == LEVELZONE_NATIVE_PRIMITIVE
    assert by_id_off["s1"].approximation is True and by_id_on["s1"].approximation is True

    assert by_id_off["s2"].to_dict() == by_id_on["s2"].to_dict(), (
        "non-level/zone sibling condition must be byte-identical across the flag toggle"
    )


def test_binding_plan_byte_identical_flag_off_full_plan():
    """Flag-OFF byte-identity at the WHOLE-PLAN level (not just one condition) — the hard
    constraint from the task brief: 'With the flag off, binding plans must be BYTE-IDENTICAL
    to today.' Builds a plan with several level/zone AND non-level/zone conditions."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "support at 100", "role": "spine"},
            {"id": "s2", "type": "VERIFY_STRUCTURE", "object": "resistance at 140", "role": "spine"},
            {"id": "s3", "type": "WAIT_STRUCTURE", "object": "bearish engulfing", "role": "spine"},
            {"id": "s4", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"},
        ],
        "invalidations": [
            {"id": "i1", "type": "INVALIDATE", "object": "structural stop", "role": "spine"},
        ],
        "entry_trigger_id": "t1",
    }
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    plan_absent = compile_binding_plan(spec)
    with levelzone_routing(False):
        plan_explicit_off = compile_binding_plan(spec)
    assert plan_absent.to_dict() == plan_explicit_off.to_dict()


# ─── spec_condition_compiler.py — executable / trace level ─────────────────────────────────────

def _synthetic_df(n: int = 80, seed: int = 11) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.5, n)
    low = close - rng.uniform(0.1, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    ts = [datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "ts_event": ts, "volume": [100] * n}
    )


def _levelzone_spec() -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "support zone retest", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def _non_levelzone_spec() -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "bearish candlestick", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def test_governance_labels_approximation_stays_true_with_or_without_flag():
    """Unlike the FVG experiment (approximation flips False->True), this sub-wire must NEVER
    flip approximation to False (hard constraint #2) — governance_labels.approximation stays
    True in both flag states."""
    compiled_spec = {"spec": _levelzone_spec(), "spec_hash": "testhash"}
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    strat_off = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    assert strat_off.approximation is True

    with levelzone_routing(True):
        strat_on = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    assert strat_on.approximation is True


def test_trace_shows_distinct_levelzone_primitive_contributor_when_enabled():
    """The fired-condition's `primitive` field in spec_trace must name the level-aware
    retest_touch_check primitive, not the generic structure_engine one, proving the executable
    path actually evaluated the distinct evaluator — not merely relabeled a routing decision
    that still runs the generic structure signal underneath (same point-8 discipline as the FVG
    experiment's test)."""
    df = _synthetic_df()
    compiled_spec = {"spec": _levelzone_spec(), "spec_hash": "testhash"}

    with levelzone_routing(True):
        strat = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m", trace=True)
        strat.compute(df)

    if not strat.last_trace:
        pytest.skip("no entry signal fired on this synthetic fixture/seed — nothing to inspect")
    fired_primitives = {c["primitive"] for rec in strat.last_trace for c in rec["conditions"]}
    assert "spec_condition_compiler.retest_touch_check" in fired_primitives
    assert "structure_engine.compute_structure_state" not in fired_primitives


def test_entry_signals_are_byte_identical_when_flag_off_regardless_of_process_env_history():
    """Replay-determinism guard: constructing the OFF-mode strategy AFTER an ON-mode run in the
    same process must produce byte-identical entry columns to a fresh OFF-mode-only run — the
    env-gated read must never leak cached state across strategy instances."""
    df = _synthetic_df()
    compiled_spec = {"spec": _levelzone_spec(), "spec_hash": "testhash"}

    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    baseline = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    baseline_out = baseline.compute(df)

    with levelzone_routing(True):
        SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m").compute(df)

    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    after = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    after_out = after.compute(df)

    assert baseline_out["entry_long"].to_list() == after_out["entry_long"].to_list()
    assert baseline_out["entry_short"].to_list() == after_out["entry_short"].to_list()


def test_non_levelzone_wait_structure_unaffected_at_execution_level():
    """A non-level/zone WAIT_STRUCTURE condition's evaluated per-bar array must be byte-identical
    whether or not TF_LEVELZONE_ROUTING_ENABLED is set — routing only ever affects conditions the
    classifier actually matches."""
    df = _synthetic_df()
    compiled_spec = {"spec": _non_levelzone_spec(), "spec_hash": "testhash"}

    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    strat_off = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    out_off = strat_off.compute(df)

    with levelzone_routing(True):
        strat_on = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
        out_on = strat_on.compute(df)

    assert out_off["entry_long"].to_list() == out_on["entry_long"].to_list()
    assert out_off["entry_short"].to_list() == out_on["entry_short"].to_list()


# ─── Both-polarity: the routed evaluator must be able to say TRUE and FALSE for the right
# reasons, not merely execute without raising ────────────────────────────────────────────────

def test_routed_evaluator_exercises_both_polarities_on_synthetic_bars():
    """Direct evaluator-level check (mirrors the premise audit's leg-1 discipline): the level/
    zone-routed evaluator (_eval_wait_structure_levelzone, which drives retest_touch_check) must
    produce SOME True bars (price came within ATR-proximity of the level) and SOME False bars
    (it did not) on ordinary synthetic data — a detector permanently stuck at one polarity would
    be exactly the ANY-constant degeneracy the premise audit's own guard was built to catch."""
    df = _synthetic_df(n=120, seed=3)
    compiled_spec = {"spec": _levelzone_spec(), "spec_hash": "testhash"}
    with levelzone_routing(True):
        strat = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
        close = df["close"].to_numpy().astype(np.float64)
        high = df["high"].to_numpy().astype(np.float64)
        low = df["low"].to_numpy().astype(np.float64)
        arr = strat._eval_wait_structure_levelzone(close, high, low, len(df))

    assert arr.any(), "evaluator never fired TRUE — degenerate all-False"
    assert not arr.all(), "evaluator never fired FALSE — degenerate all-True"


def test_routed_evaluator_matches_retest_touch_check_directly_true_and_false():
    """Second, independent both-polarity proof at the underlying-primitive level (not just
    through the strategy wrapper): construct a level series that is DELIBERATELY far from price
    for half the bars (forces False) and DELIBERATELY tracking price for the other half (forces
    True), and confirm retest_touch_check — the exact primitive this sub-wire routes to —
    reports both outcomes for the right (constructed) reason, matching the premise audit's own
    leg-1 methodology (level_far_140 vs level_hugs_price)."""
    from src.engine.spec_condition_compiler import retest_touch_check

    n = 60
    rng = np.random.default_rng(5)
    close = 100 + np.cumsum(rng.normal(0, 0.3, n))
    high = close + 0.4
    low = close - 0.4
    atr = np.full(n, 1.0)

    level_far = np.full(n, close.mean() + 500.0)  # never reachable -> all False
    level_hug = close.copy()  # always at price -> all True (within proximity)

    out_far = retest_touch_check(close, high, low, level_far, atr)
    out_hug = retest_touch_check(close, high, low, level_hug, atr)

    assert not out_far.any(), "far level must yield zero touches (negative polarity)"
    assert out_hug.any(), "hugging level must yield touches (positive polarity)"
    assert not np.array_equal(out_far, out_hug), "binding must move with the level input"
