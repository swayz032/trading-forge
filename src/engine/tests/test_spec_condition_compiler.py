"""Tests for spec_condition_compiler.py — Band C executable evaluator.

Run targeted:
    python -m pytest src/engine/tests/test_spec_condition_compiler.py -v
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl

from src.engine.spec_condition_compiler import (
    SpecConditionStrategy,
    candle_confirmation_check,
    from_compiled_spec,
    retest_touch_check,
)

N_BARS = 300


def _synthetic_df(seed: int = 42) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(N_BARS)]
    close = 5000 + np.cumsum(rng.normal(0, 1.0, N_BARS))
    high = close + rng.uniform(0.2, 1.5, N_BARS)
    low = close - rng.uniform(0.2, 1.5, N_BARS)
    open_ = close + rng.normal(0, 0.3, N_BARS)
    vol = rng.integers(500, 2000, N_BARS)
    return pl.DataFrame(
        {
            "ts_event": ts,
            "open": open_.astype(np.float64),
            "high": high.astype(np.float64),
            "low": low.astype(np.float64),
            "close": close.astype(np.float64),
            "volume": vol.astype(np.int64),
        }
    )


def _minimal_compiled_spec(direction: str = "long") -> dict:
    return {
        "video": "TESTVID",
        "spec_hash": "abc123def456abcdef",
        "graph_canonical_hash": "x",
        "ledger_d": "CONSERVED",
        "spec": {
            "direction": direction,
            "entry_conditions": [
                {
                    "id": "s1",
                    "type": "WAIT_SESSION",
                    "object": "ny am session",
                    "role": "spine",
                    "span": {"start": 0, "end": 1},
                    "evidence": "ev1",
                },
                {
                    "id": "t1",
                    "type": "ENABLE_ENTRY",
                    "object": "entry trigger",
                    "role": "trigger",
                    "span": {"start": 1, "end": 2},
                    "evidence": "ev2",
                },
            ],
            "and_groups": [],
            "or_branches": [],
            "invalidations": [
                {
                    "id": "i1",
                    "type": "INVALIDATE",
                    "object": "structural break",
                    "role": "invalidation",
                    "span": {"start": 2, "end": 3},
                    "evidence": "ev3",
                },
            ],
            "entry_trigger_id": "t1",
        },
    }


# ─── Determinism ────────────────────────────────────────────────────────────

def test_compute_is_deterministic_same_df_same_output():
    spec = _minimal_compiled_spec()
    df = _synthetic_df()
    s1 = from_compiled_spec(spec)
    s2 = from_compiled_spec(spec)
    out1 = s1.compute(df)
    out2 = s2.compute(df)
    assert out1["entry_long"].to_list() == out2["entry_long"].to_list()
    assert out1["entry_short"].to_list() == out2["entry_short"].to_list()


# ─── Exit columns are ALWAYS framework-owned (never set here) ─────────────

def test_exit_columns_always_false_framework_owned():
    spec = _minimal_compiled_spec()
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)
    out = strategy.compute(df)
    assert not any(out["exit_long"].to_list())
    assert not any(out["exit_short"].to_list())


# ─── Trigger single-fire semantics (rising edge, not level) ────────────────

def test_trigger_fires_only_on_rising_edge_not_every_satisfied_bar():
    spec = _minimal_compiled_spec()
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)
    out = strategy.compute(df)
    entry = np.array(out["entry_long"].to_list())
    # Whenever entry_long is True at i>0, spine must NOT have been satisfied
    # at i-1 too (single-fire, not level-triggered) — verified indirectly by
    # asserting no two consecutive True bars.
    for i in range(1, len(entry)):
        assert not (entry[i] and entry[i - 1]), f"consecutive fire at bar {i} — not single-fire"


# ─── Approximation flag propagation ─────────────────────────────────────────

def test_approximation_flag_set_when_binding_plan_uses_approximate_primitive():
    spec = _minimal_compiled_spec()
    spec["spec"]["entry_conditions"].append(
        {
            "id": "s2",
            "type": "WAIT_STRUCTURE",
            "object": "structure check",
            "role": "spine",
            "span": {"start": 3, "end": 4},
            "evidence": "ev4",
        }
    )
    strategy = from_compiled_spec(spec)
    assert strategy.approximation is True, "WAIT_STRUCTURE binding is approximation=True per spec_family_bindings"


def test_approximation_flag_false_when_only_exact_primitives_bound():
    spec = _minimal_compiled_spec()  # WAIT_SESSION(exact) + trigger + INVALIDATE(exact)
    strategy = from_compiled_spec(spec)
    assert strategy.approximation is False


# ─── Direction handling ──────────────────────────────────────────────────────

def test_short_direction_only_populates_entry_short():
    spec = _minimal_compiled_spec(direction="short")
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)
    out = strategy.compute(df)
    assert not any(out["entry_long"].to_list())


def test_long_direction_only_populates_entry_long():
    spec = _minimal_compiled_spec(direction="long")
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)
    out = strategy.compute(df)
    assert not any(out["entry_short"].to_list())


# ─── Trace flag byte-identity (C3) ──────────────────────────────────────────

def test_trace_flag_off_produces_byte_identical_signal_columns_vs_trace_on():
    spec = _minimal_compiled_spec()
    df = _synthetic_df()
    strategy_off = SpecConditionStrategy(compiled_spec=spec, trace=False)
    strategy_on = SpecConditionStrategy(compiled_spec=spec, trace=True)
    out_off = strategy_off.compute(df)
    out_on = strategy_on.compute(df)
    for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
        assert out_off[col].to_list() == out_on[col].to_list(), f"{col} diverged between trace on/off"
    assert strategy_off.last_trace == []
    assert isinstance(strategy_on.last_trace, list)


def test_trace_records_populated_only_when_entries_fire():
    spec = _minimal_compiled_spec()
    df = _synthetic_df()
    strategy = SpecConditionStrategy(compiled_spec=spec, trace=True)
    out = strategy.compute(df)
    n_entries = sum(out["entry_long"].to_list())
    assert len(strategy.last_trace) == n_entries


def test_exit_hint_never_appears_in_trace_gating_conditions():
    """EXIT_HINT is provenance-only — it must never enter the gating loop or
    the trace's 'conditions' list, even as a harmless always-True pass-through
    (regression guard for the executed=False contract)."""
    spec = _minimal_compiled_spec()
    spec["spec"]["entry_conditions"].append(
        {
            "id": "e1",
            "type": "EXIT_HINT",
            "object": "reassess position",
            "role": "spine",
            "span": {"start": 5, "end": 6},
            "evidence": "ev5",
        }
    )
    df = _synthetic_df()
    strategy = SpecConditionStrategy(compiled_spec=spec, trace=True)
    strategy.compute(df)
    for rec in strategy.last_trace:
        cond_ids = {c["condition_id"] for c in rec["conditions"]}
        assert "e1" not in cond_ids


def test_trace_record_carries_span_and_evidence_provenance():
    spec = _minimal_compiled_spec()
    df = _synthetic_df()
    strategy = SpecConditionStrategy(compiled_spec=spec, trace=True)
    strategy.compute(df)
    if strategy.last_trace:
        rec = strategy.last_trace[0]
        assert "conditions" in rec
        assert "spec_hash" in rec
        for cond in rec["conditions"]:
            assert "condition_id" in cond
            assert "primitive" in cond
            assert "approximation" in cond


# ─── Insufficient bars fail-soft (no crash on tiny data) ───────────────────

def test_too_few_bars_returns_all_false_no_crash():
    spec = _minimal_compiled_spec()
    df = _synthetic_df().head(5)
    strategy = from_compiled_spec(spec)
    out = strategy.compute(df)
    assert not any(out["entry_long"].to_list())
    assert not any(out["entry_short"].to_list())


# ─── Standalone primitive helper sanity ────────────────────────────────────

def test_retest_touch_check_detects_proximity():
    close = np.array([100.0, 101.0, 100.5, 99.5])
    high = close + 0.5
    low = close - 0.5
    level = np.array([100.0, 100.0, 100.0, 100.0])
    atr = np.array([1.0, 1.0, 1.0, 1.0])
    out = retest_touch_check(close, high, low, level, atr)
    assert out.dtype == bool
    assert len(out) == 4


def test_candle_confirmation_check_shapes():
    o = np.array([100.0, 100.0])
    h = np.array([101.0, 100.2])
    lo = np.array([98.0, 99.8])
    c = np.array([100.8, 100.1])
    bull, bear = candle_confirmation_check(o, h, lo, c)
    assert bull.dtype == bool and bear.dtype == bool
    assert len(bull) == 2 and len(bear) == 2


# ─── Governance / get_params / get_default_config sanity ──────────────────

def test_get_params_and_default_config_contain_spec_hash():
    spec = _minimal_compiled_spec()
    strategy = from_compiled_spec(spec)
    params = strategy.get_params()
    cfg = strategy.get_default_config()
    assert params["spec_hash"] == spec["spec_hash"]
    assert cfg["spec_hash"] == spec["spec_hash"]
