"""Parameter collision — the red-proof R-679 §2 could not reach until now (R-681 §5).

THE DEFECT UNDER TEST
    The per-family evaluation caches are keyed by FAMILY, not by parameters:
        if ctx["wait_structure"] is None:
            ctx["wait_structure"] = self._eval_wait_structure(...)
    So the SECOND condition of a family never recomputes — it receives the FIRST
    condition's array. Harmless while nothing varies per condition; a silent
    parameter-loss channel the moment a taught number can differ between two
    conditions of the same family (R-679 §2).

WHY IT WAS UNREACHABLE UNTIL THIS COMMIT (AR-741, Lane 3's stop condition)
    A cache defect exists only if removing the cache would change a result. Every
    evaluator ignored its binding, so nothing COULD vary. The missing ingredient was an
    input that varies per condition — not the cache, which has been wrong all along.

WHAT SUPPLIES THAT INGREDIENT HERE, AND WHAT DOES NOT
    * ConditionBinding.parameters (R-681 §5(2)) is real, committed, and carries the period.
    * The parameter-CONSUMING evaluator is supplied by monkeypatch, in this file only.
      No src/ code was edited to produce the failure (R-681 §5, forbidden).
    * *** THE CACHE THAT COLLIDES IS REAL, UNPATCHED PRODUCTION CODE. *** The patch on
      _h_structure WRAPS the original and delegates to it, so the caching decision under
      test is production's, not the test's. If this file goes red, the defect is the
      engine's.

DISPATCH PATH
    Runs under TF_FAMILY_META_ENFORCED=true, because that is the path where the binding
    reaches the handler (_dispatch_enforced -> _h_structure(b, ctx)). MEASURED: the
    default inline ladder calls self._eval_wait_structure(n, df) WITHOUT the binding
    (spec_condition_compiler.py:1215-1217), so on that path a parameter cannot reach the
    evaluator at all without a call-site change. That is a separate finding, reported in
    AR-747 §4 — not a reason to weaken this test.

THIS IS NOT A COMPILER PASS. It proves one cache loses one parameter. Nothing about
educator fidelity, and nothing about the parameter grammar (reserved: R-678 §6).
"""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.indicators.core import compute_sma
from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import compile_binding_plan

FAST_PERIOD = 10
SLOW_PERIOD = 200
N_BARS = 200


def _df(seed: int = 11, n: int = N_BARS) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.5, n)
    low = close - rng.uniform(0.1, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    ts = [datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "ts_event": ts, "volume": [100] * n}
    )


def _spec(first_period: int, second_period: int) -> dict:
    """Two conditions of the SAME family, differing only in their taught period."""
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "fast", "type": "WAIT_STRUCTURE",
             "object": f"close above the {first_period} period moving average", "role": "spine"},
            {"id": "slow", "type": "WAIT_STRUCTURE",
             "object": f"close above the {second_period} period moving average", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def _plan_with_periods(spec: dict, periods: dict[str, int]):
    """Populate ConditionBinding.parameters — ONLY here, never in production code."""
    plan = compile_binding_plan(spec)
    for i, b in enumerate(plan.bindings):
        if b.condition_id in periods:
            plan.bindings[i] = dataclasses.replace(
                b, parameters=(("period", periods[b.condition_id]),)
            )
    return plan


def _ma_gate(df: pl.DataFrame, period: int) -> np.ndarray:
    """A real period-dependent signal: close above its own N-period SMA."""
    close = df["close"]
    sma = compute_sma(close, period).to_numpy()
    out = close.to_numpy() > sma
    return np.nan_to_num(out, nan=False).astype(bool)


@pytest.fixture
def parameter_aware_engine(monkeypatch):
    """Make the WAIT_STRUCTURE evaluator consume its condition's taught period.

    The wrapper on _h_structure DELEGATES to the original handler — production's caching
    decision is executed unmodified. Only the evaluator becomes period-sensitive.
    """
    monkeypatch.setenv("TF_FAMILY_META_ENFORCED", "true")

    original_handler = SpecConditionStrategy._h_structure

    def handler_recording_period(self, b, ctx):
        # expose THIS condition's period, then run production's real cache logic
        params = dict(b.parameters or ())
        self._probe_period = params.get("period")
        self._probe_calls = getattr(self, "_probe_calls", [])
        self._probe_calls.append(self._probe_period)
        return original_handler(self, b, ctx)

    def period_sensitive_eval(self, n, df):
        # count real evaluations so an over-broad "fix" that simply deletes the cache is
        # detectable (R-679 §4c — that proof is explicitly not optional)
        self._probe_eval_calls = getattr(self, "_probe_eval_calls", [])
        self._probe_eval_calls.append(self._probe_period)
        return _ma_gate(df, self._probe_period)

    monkeypatch.setattr(SpecConditionStrategy, "_h_structure", handler_recording_period)
    monkeypatch.setattr(SpecConditionStrategy, "_eval_wait_structure", period_sensitive_eval)


def _run(spec: dict, periods: dict[str, int]) -> SpecConditionStrategy:
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "collisiontest"},
        symbol="MES",
        timeframe="15m",
        binding_plan=_plan_with_periods(spec, periods),
    )
    strat.compute(_df())
    return strat


# ─── POSITIVE CONTROL ──────────────────────────────────────────────────────────────────────

def test_the_two_periods_actually_produce_different_signals():
    """Without this, a 'collision' red could merely mean the periods make no difference.
    Prints its VALUE — a control that returns zero has not passed, it has not run
    (R-675 §1)."""
    fast = _ma_gate(_df(), FAST_PERIOD)
    slow = _ma_gate(_df(), SLOW_PERIOD)
    differing = int(np.sum(fast != slow))
    print(f"\n[POSITIVE CONTROL] SMA({FAST_PERIOD}) vs SMA({SLOW_PERIOD}) gates differ on "
          f"{differing} of {N_BARS} bars")
    assert differing > 0, (
        "CONTROL DEAD: the two periods produce identical gates, so any collision result "
        "below would be meaningless."
    )


def test_both_conditions_are_actually_dispatched(parameter_aware_engine):
    """Positive witness that the path RAN. A negative assertion needs proof of execution
    before it means anything — otherwise 'they got the same array' is also satisfied by
    'neither was ever evaluated'."""
    strat = _run(_spec(FAST_PERIOD, SLOW_PERIOD), {"fast": FAST_PERIOD, "slow": SLOW_PERIOD})
    print(f"\n[EXECUTION WITNESS] _h_structure received periods: {strat._probe_calls}")
    assert strat._probe_calls == [FAST_PERIOD, SLOW_PERIOD], (
        "both conditions must reach the handler carrying their own period"
    )
    assert set(strat.last_per_condition_bool) >= {"fast", "slow"}


# ─── THE RED ───────────────────────────────────────────────────────────────────────────────

def test_two_same_family_conditions_with_different_periods_must_evaluate_differently(
    parameter_aware_engine,
):
    """R-681 §5(4), proof form 1: 'both conditions receive the same computed value'.

    FAILING CARRIER: the single-slot `wait_structure` cache
    (spec_condition_compiler.py:515-517 on the enforced path).
    """
    strat = _run(_spec(FAST_PERIOD, SLOW_PERIOD), {"fast": FAST_PERIOD, "slow": SLOW_PERIOD})

    fast_arr = strat.last_per_condition_bool["fast"]
    slow_arr = strat.last_per_condition_bool["slow"]
    identical = int(np.sum(fast_arr == slow_arr))

    assert not np.array_equal(fast_arr, slow_arr), (
        f"PARAMETER COLLISION: the two WAIT_STRUCTURE conditions taught periods "
        f"{FAST_PERIOD} and {SLOW_PERIOD} received IDENTICAL arrays "
        f"({identical}/{len(fast_arr)} bars equal). The second condition never recomputed — "
        f"the family-keyed `wait_structure` cache handed it the first condition's value."
    )


def test_identical_periods_still_share_one_computation(parameter_aware_engine):
    """R-679 §4c, explicitly NOT optional: caching must still HAPPEN.

    Two conditions teaching the SAME period must be computed once, not twice. Without this
    assertion, 'delete the cache entirely' passes every other test in this file and ships a
    performance regression wearing a correctness fix's clothes. This test is green before
    AND after the repair by design — it constrains the SHAPE of the repair, not its result.
    """
    spec = _spec(FAST_PERIOD, FAST_PERIOD)
    spec["entry_conditions"][1]["id"] = "a"
    spec["entry_conditions"][2]["id"] = "b"
    strat = _run(spec, {"a": FAST_PERIOD, "b": FAST_PERIOD})

    print(f"\n[REUSE GUARD] evaluator invocations for two identical SMA({FAST_PERIOD}) "
          f"conditions: {strat._probe_eval_calls}")
    assert len(strat._probe_eval_calls) == 1, (
        f"two conditions with the SAME taught period must share one computation; the "
        f"evaluator ran {len(strat._probe_eval_calls)} times — the cache was removed rather "
        f"than re-keyed"
    )
    assert np.array_equal(
        strat.last_per_condition_bool["a"], strat.last_per_condition_bool["b"]
    ), "identical periods must yield identical arrays"


def test_reversing_condition_order_changes_the_shared_value(parameter_aware_engine):
    """R-681 §5(4), proof form 2: 'reversing their order changes which value both receive'.

    Order-dependence is the signature that isolates a CACHE defect from a mere
    coincidence: if both conditions were independently evaluated, declaration order could
    not change either one's value."""
    forward = _run(_spec(FAST_PERIOD, SLOW_PERIOD), {"fast": FAST_PERIOD, "slow": SLOW_PERIOD})
    reverse_spec = _spec(SLOW_PERIOD, FAST_PERIOD)
    reverse_spec["entry_conditions"][1]["id"] = "slow"
    reverse_spec["entry_conditions"][2]["id"] = "fast"
    reversed_ = _run(reverse_spec, {"fast": FAST_PERIOD, "slow": SLOW_PERIOD})

    assert np.array_equal(
        forward.last_per_condition_bool["fast"], reversed_.last_per_condition_bool["fast"]
    ), (
        "ORDER DEPENDENCE: the 'fast' condition's value changed when it was declared "
        "second. Its own taught period did not change — only its position did, which means "
        "it is receiving whatever the first-evaluated sibling computed."
    )
