"""LANE 21 (R-691 §5, refined R-692 §2/§3/§4) — the taught number reaches the evaluator.

WHAT WAS BROKEN, MEASURED BEFORE THE REPAIR (AR-769 step 0)
    `_eval_wait_bias` is a fast/slow EMA crossover whose two periods were the module
    constants BIAS_EMA_FAST=20 / BIAS_EMA_SLOW=50. It took no ConditionBinding, so no
    taught value could reach it. `_h_wait_bias` additionally keyed its cache on
    `want_bearish` ALONE, so two same-direction conditions shared one slot.
    Two conditions taught (7,90) and (31,120) produced arrays differing on 0/200 bars
    from ONE evaluator invocation, while the same periods computed directly differ on
    22/200 bars.

WHY THIS FILE HAS TWO INDEPENDENT FIXTURES AND NOT ONE
    R-692 §2: `A PARAMETER-TRANSMISSION TEST IS NOT A CACHE-CONTROL TEST, AND A CACHE
    TEST IS NOT PROOF THE PRIMITIVE CONSUMED THE PERIOD.` The two defects above produce
    IDENTICAL output symptoms, so one fixture covering both would fail for two reasons
    and control for neither.

WHAT THIS FILE IS PERMITTED TO DO (R-692 §3)
    Build parameterized ConditionBinding objects; use controlled market data; and SPY on
    the production primitive — record its arguments and DELEGATE to the real
    implementation. It never stubs the primitive, and no test-only branch exists for any
    particular period value.

WHAT IT DOES NOT CLAIM (R-692 §5)
    Only that one Python evaluator path consumes a parameter supplied through
    ConditionBinding, and that distinct off-default values produce distinct production
    calculations without cache collision. The PRODUCER end is still absent — nothing
    upstream extracts a taught period into a sealed spec — so this proves a link, not a
    pipeline.
"""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.indicators.core import compute_ema
from src.engine.spec_condition_compiler import (
    ATR_PERIOD,
    BIAS_EMA_FAST,
    BIAS_EMA_SLOW,
    MIN_BARS_REQUIRED,
    POPULATION_A_SWING_LOOKBACK,
    RETEST_LEVEL_EMA_PERIOD,
    STRUCTURE_RECOMPUTE_CADENCE_BARS,
    STRUCTURE_WINDOW_BARS,
    SpecConditionStrategy,
)
from src.engine.spec_family_bindings import compile_binding_plan

# ── The fixture's parameters, and the proof they cannot be supplied by a default ───────
# R-692 §1 enumerated the WHOLE named-constants block rather than the two values R-691
# named, after minting `NAMING TWO MEMBERS OF A SET IS NOT NAMING THE SET`. This tuple is
# built from the imported constants themselves, so if someone edits a default to 7 or 31
# the guard test below goes red instead of the suite quietly losing its discriminator.
ENGINE_DEFAULTS: frozenset[int] = frozenset(
    {
        STRUCTURE_RECOMPUTE_CADENCE_BARS,
        STRUCTURE_WINDOW_BARS,
        BIAS_EMA_FAST,
        BIAS_EMA_SLOW,
        RETEST_LEVEL_EMA_PERIOD,
        MIN_BARS_REQUIRED,
        ATR_PERIOD,
        POPULATION_A_SWING_LOOKBACK,
    }
)

ARM_A = {"fast_period": 7, "slow_period": 90}
ARM_B = {"fast_period": 31, "slow_period": 120}

# BAR COUNT DECLARED WITH THE PERIODS (R-692 §4). The longest leg is slow_period=120 and
# `_eval_wait_bias` needs slow+2 bars, so 200 clears the floor for BOTH arms with margin.
# A fixture too short for the longer arm returns all-False on that arm, which is
# indistinguishable from "the parameter did not transmit".
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


def _spec(ids: tuple[str, ...]) -> dict:
    """N WAIT_BIAS conditions of the same family and the SAME direction.

    Same direction on purpose: `want_bearish` is already part of the cache key, so two
    opposite-direction conditions would be separated even by the OLD key and could not
    witness a parameter-driven separation.
    """
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            *[
                {"id": cid, "type": "WAIT_BIAS", "object": "bullish trend", "role": "spine"}
                for cid in ids
            ],
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def _plan(spec: dict, params: dict[str, dict]):
    plan = compile_binding_plan(spec)
    for i, b in enumerate(plan.bindings):
        if b.condition_id in params:
            plan.bindings[i] = dataclasses.replace(
                b, parameters=tuple(sorted(params[b.condition_id].items()))
            )
    return plan


def _ema_cross(df: pl.DataFrame, fast: int, slow: int) -> np.ndarray:
    """An INDEPENDENT recomputation of the proxy, used only to prove the engine's answer
    is the one these periods imply — never to supply the engine's answer."""
    s = df["close"]
    f = compute_ema(s, fast).to_numpy()
    sl = compute_ema(s, slow).to_numpy()
    out = np.zeros(len(f), dtype=bool)
    for i in range(len(f)):
        if not (np.isnan(f[i]) or np.isnan(sl[i])):
            out[i] = f[i] > sl[i]
    return out


class _Spy:
    """Records the arguments the PRODUCTION primitive was invoked with, then delegates.

    R-692 §3 permits exactly this and prohibits a stub. Every array this file asserts on
    is computed by unmodified production code.
    """

    def __init__(self, monkeypatch):
        self.eval_calls: list[tuple[int, int]] = []
        self.handler_params: list[dict] = []
        original_eval = SpecConditionStrategy._eval_wait_bias
        original_handler = SpecConditionStrategy._h_wait_bias
        spy = self

        def eval_spy(inner, close, n, want_bearish=False, htf_trend=None,
                    fast_period=None, slow_period=None):
            spy.eval_calls.append((fast_period, slow_period))
            return original_eval(
                inner, close, n, want_bearish=want_bearish, htf_trend=htf_trend,
                fast_period=fast_period, slow_period=slow_period,
            )

        def handler_spy(inner, b, ctx):
            spy.handler_params.append(dict(b.parameters or ()))
            return original_handler(inner, b, ctx)

        monkeypatch.setenv("TF_FAMILY_META_ENFORCED", "true")
        monkeypatch.setattr(SpecConditionStrategy, "_eval_wait_bias", eval_spy)
        monkeypatch.setattr(SpecConditionStrategy, "_h_wait_bias", handler_spy)


@pytest.fixture
def spy(monkeypatch):
    return _Spy(monkeypatch)


def _run(spec: dict, params: dict[str, dict], df: pl.DataFrame) -> SpecConditionStrategy:
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane21"},
        symbol="MES",
        timeframe="15m",
        binding_plan=_plan(spec, params),
    )
    strat.compute(df)
    return strat


# ══ CONTROLS ══════════════════════════════════════════════════════════════════════════

def test_control_arms_are_off_default():
    """R-692 §1/§3: a fixture whose periods equal ANY engine default is prohibited.

    Asserted against the IMPORTED constants, so editing a default to collide with an arm
    fails here rather than silently disarming every discriminator in this file.
    """
    print(f"\n[CONTROL] engine defaults = {sorted(ENGINE_DEFAULTS)}")
    used = set(ARM_A.values()) | set(ARM_B.values())
    print(f"[CONTROL] fixture periods = {sorted(used)}")
    assert not (used & ENGINE_DEFAULTS), (
        f"fixture periods {sorted(used & ENGINE_DEFAULTS)} collide with an engine default; "
        f"such a fixture cannot witness parameter transmission because the default would "
        f"produce the same answer"
    )


def test_control_the_two_arms_differ_when_actually_computed():
    """A control that returns zero has not passed, it has not run. Prints its VALUE."""
    df = _df()
    a = _ema_cross(df, ARM_A["fast_period"], ARM_A["slow_period"])
    b = _ema_cross(df, ARM_B["fast_period"], ARM_B["slow_period"])
    differing = int(np.sum(a != b))
    print(f"\n[CONTROL] EMA{ARM_A['fast_period']}/{ARM_A['slow_period']} vs "
          f"EMA{ARM_B['fast_period']}/{ARM_B['slow_period']} differ on {differing}/{N_BARS} bars")
    assert differing > 0, "CONTROL DEAD: the two arms are indistinguishable even when computed"


def test_control_bar_count_clears_the_warmup_floor_for_both_arms():
    """R-692 §4: a fixture that fails for want of data fails in the direction that looks
    like the hypothesis. Prove the data is sufficient BEFORE reading any result."""
    longest = max(ARM_A["slow_period"], ARM_B["slow_period"])
    print(f"\n[CONTROL] N_BARS={N_BARS}, longest slow leg={longest}, floor=slow+2={longest + 2}")
    assert N_BARS >= longest + 2
    for arm in (ARM_A, ARM_B):
        gate = _ema_cross(_df(), arm["fast_period"], arm["slow_period"])
        assert int(gate.sum()) > 0, f"arm {arm} produced an all-False gate — data too short"


# ══ FIXTURE A — PARAMETER TRANSMISSION (R-692 §2) ═════════════════════════════════════

def test_fixture_a_binding_carries_the_declared_value(spy):
    """Witness 1 of 6: ConditionBinding.parameters actually carries what was declared."""
    plan = _plan(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B})
    carried = {b.condition_id: dict(b.parameters or ()) for b in plan.bindings if b.parameters}
    print(f"\n[WITNESS 1] bindings carry: {carried}")
    assert carried == {"armA": ARM_A, "armB": ARM_B}


def test_fixture_a_handler_receives_and_primitive_is_invoked_with_the_periods(spy):
    """Witnesses 2 and 3: the handler RECEIVES the parameters and the PRODUCTION primitive
    is INVOKED with them.

    Witness 3 is the one that separates this repair from the convicted one: a cache-key-only
    change would still show the handler receiving parameters while the primitive was called
    with the hardcoded defaults.
    """
    _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B}, _df())
    print(f"\n[WITNESS 2] handler received: {spy.handler_params}")
    print(f"[WITNESS 3] primitive invoked with (fast, slow): {spy.eval_calls}")
    assert spy.handler_params == [ARM_A, ARM_B]
    assert sorted(spy.eval_calls) == sorted(
        [(ARM_A["fast_period"], ARM_A["slow_period"]), (ARM_B["fast_period"], ARM_B["slow_period"])]
    ), "the production primitive must be invoked with the taught periods, not the defaults"


def test_fixture_a_the_condition_decision_changes_on_controlled_bars(spy):
    """Witnesses 4 and 5: the produced array changes, and the per-condition DECISION
    differs on at least one bar. This is the assertion the red baseline failed 0/200."""
    strat = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B}, _df())
    a = strat.last_per_condition_bool["armA"]
    b = strat.last_per_condition_bool["armB"]
    differing = int(np.sum(a != b))
    print(f"\n[WITNESS 4/5] taught {ARM_A} vs {ARM_B}: decisions differ on {differing}/{len(a)} bars")
    assert differing > 0, (
        f"PARAMETER SEVERANCE: two WAIT_BIAS conditions taught {ARM_A} and {ARM_B} produced "
        f"identical decisions on all {len(a)} bars. The evaluator ignored its taught periods."
    )


def test_fixture_a_no_hardcoded_default_supplied_the_result(spy):
    """Witness 6: neither arm's answer is the engine-default answer.

    Without this, an implementation that read the parameters, discarded them, and computed
    EMA(20/50) twice would satisfy every witness above except the decision one — and would
    satisfy that too whenever the defaults happened to differ between cache slots.
    """
    df = _df()
    strat = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B}, df)
    default_answer = _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)
    for cid, arm in (("armA", ARM_A), ("armB", ARM_B)):
        produced = strat.last_per_condition_bool[cid]
        expected = _ema_cross(df, arm["fast_period"], arm["slow_period"])
        from_default = int(np.sum(produced != default_answer))
        print(f"\n[WITNESS 6] {cid}: matches its own periods={np.array_equal(produced, expected)}; "
              f"differs from EMA{BIAS_EMA_FAST}/{BIAS_EMA_SLOW} on {from_default}/{N_BARS} bars")
        assert np.array_equal(produced, expected), (
            f"{cid} did not produce the array its own taught periods imply"
        )
        assert from_default > 0, (
            f"{cid} is byte-identical to the engine-default answer — the default may be "
            f"supplying the result"
        )


# ══ FIXTURE B — CACHE ISOLATION (R-692 §2) ════════════════════════════════════════════

def test_fixture_b_different_periods_create_distinct_entries(spy):
    """Two distinct parameter sets must produce TWO real evaluations, not one shared one."""
    _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B}, _df())
    print(f"\n[CACHE] evaluator invocations for two distinct period sets: {spy.eval_calls}")
    assert len(spy.eval_calls) == 2, (
        f"expected two distinct cache entries, got {len(spy.eval_calls)} evaluation(s)"
    )


def test_fixture_b_identical_periods_still_reuse_one_computation(spy):
    """The cache must still CACHE. An over-broad 'fix' that simply deletes the cache would
    pass every other test in this file and silently double the engine's work."""
    _run(_spec(("one", "two")), {"one": ARM_A, "two": dict(ARM_A)}, _df())
    print(f"\n[CACHE] evaluator invocations for two IDENTICAL period sets: {spy.eval_calls}")
    assert len(spy.eval_calls) == 1, (
        f"two conditions teaching identical periods must share one computation; "
        f"got {len(spy.eval_calls)}"
    )


def test_fixture_b_reversing_declaration_order_changes_nothing(spy):
    """Order-independence: whichever condition is declared first, each keeps its own answer."""
    df = _df()
    forward = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B}, df)
    reverse = _run(_spec(("armB", "armA")), {"armA": ARM_A, "armB": ARM_B}, df)
    for cid in ("armA", "armB"):
        same = np.array_equal(forward.last_per_condition_bool[cid], reverse.last_per_condition_bool[cid])
        print(f"\n[CACHE] {cid} identical across declaration orders: {same}")
        assert same, f"{cid}'s result depends on declaration order — the cache is order-sensitive"


def test_fixture_b_mutation_control_single_slot_key_is_detected(monkeypatch):
    """MUTATION CONTROL (R-692 §2): this fixture must FAIL if the cache key is reverted.

    The reverted body below is the VERBATIM pre-repair implementation, not a strawman —
    bare `want_bearish` key, no periods passed. If the assertions in Fixture A/B can pass
    against it, they are not testing what they claim to test.
    """
    monkeypatch.setenv("TF_FAMILY_META_ENFORCED", "true")
    original_eval = SpecConditionStrategy._eval_wait_bias

    def reverted_handler(inner, b, ctx):
        want_bearish = inner._resolve_wait_bias_bearish(b.object)
        cache = ctx["wait_bias_cache"]
        if want_bearish not in cache:
            cache[want_bearish] = original_eval(
                inner, ctx["close"], ctx["n"], want_bearish=want_bearish, htf_trend=ctx["htf_trend"]
            )
        return cache[want_bearish]

    monkeypatch.setattr(SpecConditionStrategy, "_h_wait_bias", reverted_handler)
    strat = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B}, _df())
    a = strat.last_per_condition_bool["armA"]
    b = strat.last_per_condition_bool["armB"]
    differing = int(np.sum(a != b))
    print(f"\n[MUTATION CONTROL] reverted single-slot handler: decisions differ on "
          f"{differing}/{len(a)} bars (must be 0 — this is the defect being repaired)")
    assert differing == 0, (
        "MUTATION CONTROL DEAD: the reverted single-slot implementation produced DIFFERING "
        "arrays, so Fixture A's core assertion would pass against the unrepaired code and "
        "proves nothing."
    )


# ══ REFUSAL BEHAVIOUR — a present-but-unusable parameter is never silently defaulted ═══

@pytest.mark.parametrize(
    "bad, why",
    [
        ({"fast_period": 0, "slow_period": 90}, "zero"),
        ({"fast_period": -7, "slow_period": 90}, "negative"),
        ({"fast_period": 7.5, "slow_period": 90}, "non-integer"),
        ({"fast_period": 90, "slow_period": 7}, "fast >= slow"),
    ],
)
def test_unusable_parameter_is_refused_not_defaulted(spy, bad, why):
    """A silent fallback to the engine default is how a taught number becomes an engine
    number without leaving a trace. The refusal must name the condition."""
    with pytest.raises(ValueError, match="armA"):
        _run(_spec(("armA",)), {"armA": bad}, _df())
    print(f"\n[REFUSAL] {why}: refused, naming the condition")


def test_absent_parameters_take_the_documented_default(spy):
    """POSITIVE CONTROL for the refusal above: 'not taught' is legitimate and must still
    run. Without this the refusal tests are also satisfied by an always-raising path."""
    df = _df()
    strat = _run(_spec(("plain",)), {}, df)
    produced = strat.last_per_condition_bool["plain"]
    print(f"\n[POSITIVE CONTROL] unparameterized binding invoked with: {spy.eval_calls}")
    assert spy.eval_calls == [(BIAS_EMA_FAST, BIAS_EMA_SLOW)]
    assert np.array_equal(produced, _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)), (
        "an unparameterized binding must behave exactly as it did before this repair"
    )
