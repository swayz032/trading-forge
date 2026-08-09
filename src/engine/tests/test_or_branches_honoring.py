"""Tests for the OR-Branches Honoring Fix
(docs/designs/or-branches-honoring-fix-2026-07-05.md):
  - BUG FIX 1: `_eval_wait_bias`/`_resolve_wait_bias_bearish` — want_bearish is now derived from
    the condition's own object text (+ spec.direction fallback), not hard-coded False.
  - BUG FIX 2: WAIT_CONFIRMATION — `_select_directional_arrays` selects directionally instead of
    OR-blending bullish_confirm | bearish_confirm.
  - or_branches honoring: `TF_OR_BRANCHES_ENABLED` (default OFF) — conditions sharing an
    or_branch group combine via ANY-holds (OR); the branch's OR-result enters the spine
    conjunction as ONE term instead of every alternative being individually ANDed.

Every test that flips TF_OR_BRANCHES_ENABLED restores the prior env state in a try/finally so
this file never leaks the flag into other tests run in the same process/session (same convention
as test_composition_bundle_dispatch.py / test_fvg_identity_dispatch.py).

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection over the full
src/engine/tests directory hangs because some module transitively imports the vectorbt-JIT
backtester):

    python -m pytest src/engine/tests/test_or_branches_honoring.py -v
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl

from src.engine.spec_condition_compiler import TRACE_RECORD_ENTRY_BAR, SpecConditionStrategy

N_BARS = 300


@contextmanager
def or_branches_enabled(enabled: bool):
    prior = os.environ.get("TF_OR_BRANCHES_ENABLED")
    os.environ["TF_OR_BRANCHES_ENABLED"] = "true" if enabled else "false"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_OR_BRANCHES_ENABLED", None)
        else:
            os.environ["TF_OR_BRANCHES_ENABLED"] = prior


def _synthetic_df(n: int = N_BARS, seed: int = 42) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    close = 5000 + np.cumsum(rng.normal(0, 1.0, n))
    high = close + rng.uniform(0.2, 1.5, n)
    low = close - rng.uniform(0.2, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    vol = rng.integers(500, 2000, n)
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


def _monotonic_uptrend_df(n: int = N_BARS) -> pl.DataFrame:
    """Deterministic, strictly-increasing close series — after EMA warmup, the fast/slow EMA
    cross-check underlying _eval_wait_bias is bullish-lean (fast > slow) for essentially the
    entire series. Used to prove bug 1's fix: a "bearish bias" spine condition must never be
    satisfied here (pre-fix, it silently WAS, because want_bearish was hard-coded False)."""
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    close = 5000 + np.arange(n, dtype=np.float64) * 0.5
    high = close + 0.3
    low = close - 0.3
    open_ = close - 0.1
    return pl.DataFrame(
        {
            "ts_event": ts,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": np.full(n, 1000, dtype=np.int64),
        }
    )


def _cond(cid: str, ctype: str, obj: str, role: str, span_start: int = 0) -> dict:
    return {
        "id": cid,
        "type": ctype,
        "object": obj,
        "role": role,
        "span": {"start": span_start, "end": span_start + 1},
        "evidence": f"ev-{cid}",
    }


def _spec(
    entry_conditions: list[dict],
    entry_trigger_id: str,
    direction: str = "long",
    and_groups: list[list[str]] | None = None,
    or_branches: list[list[str]] | None = None,
    invalidations: list[dict] | None = None,
) -> dict:
    return {
        "direction": direction,
        "entry_conditions": entry_conditions,
        "and_groups": and_groups or [],
        "or_branches": or_branches or [],
        "invalidations": invalidations or [],
        "entry_trigger_id": entry_trigger_id,
    }


def _strategy(spec: dict, **kwargs) -> SpecConditionStrategy:
    return SpecConditionStrategy({"spec": spec, "spec_hash": "testhash"}, **kwargs)


# ═══════════════════════════════════════════════════════════════════════════
# BUG FIX 1 — _eval_wait_bias / _resolve_wait_bias_bearish
# ═══════════════════════════════════════════════════════════════════════════

def test_bug1_resolve_bearish_object_keyword_returns_true():
    spec = _spec(
        [_cond("t1", "ENABLE_ENTRY", "entry", "trigger"), _cond("s1", "WAIT_BIAS", "bearish bias", "spine")],
        "t1",
        direction="long",
    )
    strat = _strategy(spec)
    assert strat._resolve_wait_bias_bearish("bearish bias") is True


def test_bug1_resolve_bullish_object_keyword_returns_false():
    spec = _spec(
        [_cond("t1", "ENABLE_ENTRY", "entry", "trigger"), _cond("s1", "WAIT_BIAS", "bullish bias", "spine")],
        "t1",
        direction="short",  # even with direction=short, object keyword wins over spec.direction
    )
    strat = _strategy(spec)
    assert strat._resolve_wait_bias_bearish("bullish bias") is False


def test_bug1_no_keyword_falls_back_to_spec_direction_short():
    spec = _spec([_cond("t1", "ENABLE_ENTRY", "entry", "trigger")], "t1", direction="short")
    strat = _strategy(spec)
    assert strat._resolve_wait_bias_bearish("ambiguous market bias") is True


def test_bug1_no_keyword_falls_back_to_bullish_default_for_long_and_both():
    """Documents the ONLY-INTENDED-CHANGE contract: for direction=long/both with no object
    keyword, want_bearish still resolves False — IDENTICAL to the pre-fix hard-coded default.
    The fix's behavioral drift is isolated to (a) object text naming a direction and (b)
    direction=short with no keyword — never long/both-with-no-keyword."""
    for direction in ("long", "both"):
        spec = _spec([_cond("t1", "ENABLE_ENTRY", "entry", "trigger")], "t1", direction=direction)
        strat = _strategy(spec)
        assert strat._resolve_wait_bias_bearish("market bias") is False, direction


def test_bug1_bearish_object_never_satisfied_in_monotonic_uptrend():
    """The regression proof: pre-fix, EVERY WAIT_BIAS condition (including one whose object says
    "bearish bias") was evaluated with want_bearish=False, so it was satisfied whenever the
    EMA fast>slow bullish lean held — i.e. for the entire warmed-up length of a monotonic
    uptrend. Post-fix, a "bearish bias" condition must be satisfied ONLY when the EMA lean is
    actually bearish, which never happens in a strictly-increasing series — so this spec must
    produce ZERO entries. Pre-fix this same spec+df would have fired entries throughout the
    uptrend (a real, confirmed metric-drift bug, not a hypothetical)."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_BIAS", "bearish bias", "spine"),
        ],
        "t1",
        direction="short",
    )
    df = _monotonic_uptrend_df()
    strat = _strategy(spec)
    out = strat.compute(df)
    # Bar 0 is excluded: compute_ema's ewm_mean seeds fast[0]==slow[0]==close[0] (an EMA-tie
    # artifact of bar-0 warmup, pre-existing and unrelated to this fix — bullish_lean=False by
    # the fast>slow tie-break, so want_bearish=True reads True at bar 0 regardless of trend).
    # Every bar AFTER warmup must show the true bearish-bias non-satisfaction this test targets.
    assert not any(out["entry_short"].to_list()[1:]), "bearish-bias condition must not fire in a monotonic uptrend post-fix"


def test_bug1_multiple_wait_bias_bindings_can_resolve_different_directions():
    """Different WAIT_BIAS conditions on the SAME spec must be able to resolve to different
    want_bearish values (the pre-fix single shared `wait_bias_bull` cache could not do this —
    every WAIT_BIAS binding shared ONE array). s1 (bullish) and s2 (bearish) are exact
    complements of the same EMA-lean signal at every bar."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_BIAS", "bullish bias", "spine"),
            _cond("s2", "WAIT_BIAS", "bearish bias", "spine"),
        ],
        "t1",
        direction="long",
    )
    df = _synthetic_df()
    strat = _strategy(spec)
    strat.compute(df)
    bull_arr = strat.last_per_condition_bool["s1"]
    bear_arr = strat.last_per_condition_bool["s2"]
    assert np.array_equal(bear_arr, ~bull_arr), "bullish/bearish WAIT_BIAS siblings must be exact complements"


# ═══════════════════════════════════════════════════════════════════════════
# BUG FIX 2 — WAIT_CONFIRMATION directional selection
# ═══════════════════════════════════════════════════════════════════════════

def test_bug2_select_directional_arrays_bearish_keyword():
    bullish = np.array([True, False, True])
    bearish = np.array([False, True, False])
    out = SpecConditionStrategy._select_directional_arrays(bullish, bearish, "bearish engulfing")
    assert np.array_equal(out, bearish)


def test_bug2_select_directional_arrays_bullish_keyword():
    bullish = np.array([True, False, True])
    bearish = np.array([False, True, False])
    out = SpecConditionStrategy._select_directional_arrays(bullish, bearish, "bullish rejection wick")
    assert np.array_equal(out, bullish)


def test_bug2_select_directional_arrays_no_keyword_falls_back_to_or():
    """Only-intended-change proof: a WAIT_CONFIRMATION object with NO directional keyword must
    stay on the pre-fix OR-blend (any_active) — the fix narrows scope to conditions that
    actually name a direction, it does not change the ambiguous case."""
    bullish = np.array([True, False, True])
    bearish = np.array([False, True, False])
    out = SpecConditionStrategy._select_directional_arrays(bullish, bearish, "confirmation candle")
    assert np.array_equal(out, bullish | bearish)


def test_bug2_wait_confirmation_binding_selects_directionally_in_compute():
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_CONFIRMATION", "bearish engulfing", "spine"),
        ],
        "t1",
        direction="short",
    )
    df = _synthetic_df()
    strat = _strategy(spec)
    strat.compute(df)
    from src.engine.spec_condition_compiler import candle_confirmation_check

    o, h, low_, c = (df[col].to_numpy().astype(np.float64) for col in ("open", "high", "low", "close"))
    bullish_ref, bearish_ref = candle_confirmation_check(o, h, low_, c)
    assert np.array_equal(strat.last_per_condition_bool["s1"], bearish_ref)
    assert not np.array_equal(strat.last_per_condition_bool["s1"], bullish_ref | bearish_ref) or not bullish_ref.any()


# ═══════════════════════════════════════════════════════════════════════════
# 7 SEMANTIC REGRESSION TESTS — or_branches honoring
# ═══════════════════════════════════════════════════════════════════════════

def _or_branch_bias_spec(direction: str = "long") -> dict:
    """s1 (bullish) / s2 (bearish) are exact complements of the same EMA-lean signal at every
    bar. AND(s1, s2) == always False (strict-AND, flag off). OR(s1, s2) == always True (honored,
    flag on). This makes the ANY-vs-ALL distinction mathematically crisp, not merely likely."""
    return _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_BIAS", "bullish bias", "spine"),
            _cond("s2", "WAIT_BIAS", "bearish bias", "spine"),
        ],
        "t1",
        direction=direction,
        or_branches=[["s1", "s2"]],
    )


# 1. OR groups evaluate as ANY, not ALL.
def test_semantic_1_or_group_evaluates_as_any_not_all():
    spec = _or_branch_bias_spec(direction="long")
    df = _synthetic_df()

    strat_off = _strategy(spec)
    out_off = strat_off.compute(df)
    assert not any(out_off["entry_long"].to_list()), "flag OFF: AND(bullish, bearish) is always False -> never fires"

    with or_branches_enabled(True):
        strat_on = _strategy(spec)
        out_on = strat_on.compute(df)
    assert any(out_on["entry_long"].to_list()), "flag ON: OR(bullish, bearish) is always True -> must fire on rising edge"


# 2. Strategies with NO or_branches -> byte-identical.
def test_semantic_2_no_or_branches_byte_identical():
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_SESSION", "ny am session", "spine"),
        ],
        "t1",
        direction="long",
    )
    df = _synthetic_df()

    strat_off = _strategy(spec)
    out_off = strat_off.compute(df)

    with or_branches_enabled(True):
        strat_on = _strategy(spec)
        out_on = strat_on.compute(df)

    assert out_off["entry_long"].to_list() == out_on["entry_long"].to_list()
    assert out_off["entry_short"].to_list() == out_on["entry_short"].to_list()


# 3. AND-only strategies (and_groups populated, or_branches empty) unchanged.
def test_semantic_3_and_only_strategy_unchanged():
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_BIAS", "bullish bias", "spine"),
            _cond("s2", "WAIT_RETEST", "level retest", "spine"),
        ],
        "t1",
        direction="long",
        and_groups=[["s1", "s2"]],  # AND semantics only, no or_branches at all
    )
    df = _synthetic_df()

    strat_off = _strategy(spec)
    out_off = strat_off.compute(df)

    with or_branches_enabled(True):
        strat_on = _strategy(spec)
        out_on = strat_on.compute(df)

    assert out_off["entry_long"].to_list() == out_on["entry_long"].to_list()
    assert out_off["entry_short"].to_list() == out_on["entry_short"].to_list()


# 4. Nested compositions (and_groups containing or_branches) behave per extracted structure:
#    AND(s0, OR(s1, s2)).
def test_semantic_4_nested_and_group_containing_or_branch():
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s0", "WAIT_SESSION", "ny am session", "spine"),
            _cond("s1", "WAIT_BIAS", "bullish bias", "spine"),
            _cond("s2", "WAIT_BIAS", "bearish bias", "spine"),
        ],
        "t1",
        direction="long",
        and_groups=[["s0", "s1", "s2"]],
        or_branches=[["s1", "s2"]],
    )
    df = _synthetic_df()

    strat_off = _strategy(spec)
    out_off = strat_off.compute(df)
    # flag OFF: AND(s0, s1, s2) == AND(s0, False) == always False (s1/s2 are exact complements)
    assert not any(out_off["entry_long"].to_list())

    with or_branches_enabled(True):
        strat_on = _strategy(spec)
        out_on = strat_on.compute(df)
        s0_arr = strat_on.last_per_condition_bool["s0"]

    # flag ON: AND(s0, OR(s1, s2)) == AND(s0, True) == s0 itself.
    entry_signal_expected = np.zeros(len(df), dtype=bool)
    entry_signal_expected[0] = s0_arr[0]
    entry_signal_expected[1:] = s0_arr[1:] & ~s0_arr[:-1]
    assert out_on["entry_long"].to_list() == entry_signal_expected.tolist()


# 5. Sequencing semantics (WAIT_RETEST / temporal) unchanged — a condition's OWN per-bar
#    evaluation is untouched by or_branches honoring; only how results COMBINE changes.
def test_semantic_5_wait_retest_own_evaluation_unaffected_by_or_branch_membership():
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_RETEST", "level retest", "spine"),
            _cond("s2", "WAIT_BIAS", "bullish bias", "spine"),
        ],
        "t1",
        direction="long",
        or_branches=[["s1", "s2"]],
    )
    df = _synthetic_df()

    strat_off = _strategy(spec)
    strat_off.compute(df)
    retest_off = strat_off.last_per_condition_bool["s1"]

    with or_branches_enabled(True):
        strat_on = _strategy(spec)
        strat_on.compute(df)
        retest_on = strat_on.last_per_condition_bool["s1"]

    assert np.array_equal(retest_off, retest_on), "WAIT_RETEST's own per-bar signal must be identical regardless of OR-branch honoring"


# 6. Provenance / trace unchanged (same condition-ids, same per-condition metadata schema).
def test_semantic_6_trace_provenance_condition_metadata_unchanged():
    spec = _or_branch_bias_spec(direction="long")
    df = _synthetic_df()

    strat_off = _strategy(spec, trace=True)
    strat_off.compute(df)

    with or_branches_enabled(True):
        strat_on = _strategy(spec, trace=True)
        strat_on.compute(df)

    # Metadata is keyed by condition_id in the binding plan itself, which is flag-independent —
    # verify both strategies' binding plans expose the SAME condition_id -> (type, object,
    # primitive, approximation) mapping regardless of flag state.
    meta_off = {b.condition_id: (b.type, b.object, b.primitive, b.approximation) for b in strat_off.binding_plan.bindings}
    meta_on = {b.condition_id: (b.type, b.object, b.primitive, b.approximation) for b in strat_on.binding_plan.bindings}
    assert meta_off == meta_on

    # Every trace record's "conditions" entries must draw from the SAME condition_id set in both
    # modes (whichever bars actually fired), and per-condition fields must carry the full schema.
    # Re-keyed on record_kind (R-749 §4-1): the leading summary record has no `conditions`.
    _bars_off = [r for r in strat_off.last_trace if r["record_kind"] == TRACE_RECORD_ENTRY_BAR]
    _bars_on = [r for r in strat_on.last_trace if r["record_kind"] == TRACE_RECORD_ENTRY_BAR]
    ids_off = {c["condition_id"] for rec in _bars_off for c in rec["conditions"]}
    ids_on = {c["condition_id"] for rec in _bars_on for c in rec["conditions"]}
    assert ids_off <= {"s1", "s2"}
    assert ids_on <= {"s1", "s2"}
    for rec in _bars_on:
        for c in rec["conditions"]:
            assert {"condition_id", "type", "object", "primitive", "approximation", "satisfied_at_bar"} <= c.keys()


# 7. Ledger conservation (Ledger D handoff) — no condition-id is silently dropped from
#    evaluation when or_branches honoring is turned on; only the COMBINATION differs.
def test_semantic_7_ledger_conservation_no_condition_dropped():
    spec = _or_branch_bias_spec(direction="long")
    df = _synthetic_df()

    strat_off = _strategy(spec)
    strat_off.compute(df)
    with or_branches_enabled(True):
        strat_on = _strategy(spec)
        strat_on.compute(df)

    assert set(strat_off.last_per_condition_bool.keys()) == set(strat_on.last_per_condition_bool.keys()) == {"s1", "s2"}
    # And the per-condition VALUES themselves (not just the combination) are unchanged — honoring
    # OR never mutates an individual condition's own evaluated boolean array.
    for cid in ("s1", "s2"):
        assert np.array_equal(strat_off.last_per_condition_bool[cid], strat_on.last_per_condition_bool[cid])


# ═══════════════════════════════════════════════════════════════════════════
# Additional determinism / replay-safety guards
# ═══════════════════════════════════════════════════════════════════════════

def test_flag_off_byte_identical_regardless_of_process_env_history():
    """Replay-determinism guard (same pattern as the composition-bundle experiment's equivalent
    test): building the OFF-mode strategy AFTER an ON-mode run in the same process must produce
    byte-identical entries to a fresh OFF-mode-only run."""
    spec = _or_branch_bias_spec(direction="long")
    df = _synthetic_df()

    os.environ.pop("TF_OR_BRANCHES_ENABLED", None)
    baseline = _strategy(spec)
    baseline_out = baseline.compute(df)

    with or_branches_enabled(True):
        _strategy(spec).compute(df)

    os.environ.pop("TF_OR_BRANCHES_ENABLED", None)
    after = _strategy(spec)
    after_out = after.compute(df)

    assert baseline_out["entry_long"].to_list() == after_out["entry_long"].to_list()
    assert baseline_out["entry_short"].to_list() == after_out["entry_short"].to_list()


def test_malformed_or_branches_never_crashes():
    """Defensive: a condition_id appearing in the SAME or_branch entry twice, an or_branches
    entry that isn't a list, or a referenced condition_id absent from entry_conditions must never
    raise — fail-soft per the module's honesty contract."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_BIAS", "bullish bias", "spine"),
        ],
        "t1",
        direction="long",
        or_branches=[["s1", "s1"], "not_a_list", ["ghost_condition_id"]],  # type: ignore[list-item]
    )
    df = _synthetic_df()
    with or_branches_enabled(True):
        strat = _strategy(spec)
        out = strat.compute(df)
    assert "entry_long" in out.columns


def test_condition_appearing_in_two_branches_keeps_first_assignment():
    """Defensive: a condition_id listed in more than one or_branch (malformed spec) must not
    crash — it keeps its FIRST branch assignment (setdefault contract documented in __init__)."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("s1", "WAIT_BIAS", "bullish bias", "spine"),
            _cond("s2", "WAIT_BIAS", "bearish bias", "spine"),
            _cond("s3", "WAIT_RETEST", "level retest", "spine"),
        ],
        "t1",
        direction="long",
        or_branches=[["s1", "s2"], ["s1", "s3"]],
    )
    strat = _strategy(spec)
    assert strat._or_branch_of_condition["s1"] == 0
    assert strat._or_branch_of_condition["s2"] == 0
    assert strat._or_branch_of_condition["s3"] == 1
