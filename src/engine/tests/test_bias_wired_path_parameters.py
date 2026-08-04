"""LANE 26 (R-697 §6 Step 2) — F-1: THE WIRED-HTF BRANCH MUST NOT ACCEPT AND DISCARD.

THE DEFECT, CONFIRMED AT THE EXECUTABLE LINE BY THE ADVISOR DESK (R-695 §3)
    `_eval_wait_bias` computes the real HTF signal per bar, and when EVERY bar is
    covered it returns at :801 -- BEFORE `eff_fast`/`eff_slow` are assigned at :815-816.
    The taught periods arrive as arguments and are never read. The comment at :805 that
    says "THE TAUGHT PERIODS ARE CONSUMED HERE" sits BELOW that return and is true only
    of the proxy fallback, so a reader who greps it learns the opposite of the wired
    path's behaviour. The path is live: `attach_htf_columns` is called by the real
    backtester at backtester.py:6736.

WHY A REFUSAL AND NOT A CONSUMPTION, WHICH IS THE ONE REAL DESIGN CHOICE IN THIS LANE
    R-697 §6 permits either: "consume them on that branch or REFUSE". CONSUMING IS NOT
    AVAILABLE HERE WITHOUT INVENTING A MECHANISM. The taught parameters describe a
    fast/slow EMA crossover -- that is what the PROXY computes. The wired path reads a
    different signal entirely: the precomputed `htf_daily_trend` column, SMA 20/50/200
    alignment on strictly-prior DAILY bars (htf_columns.py). There is no defensible way
    to apply a taught 15-minute EMA pair to a precomputed daily-SMA regime label, and
    fabricating one would be exactly the invented behaviour worker-execution §6 forbids.
    So: the engine REFUSES, naming the condition, rather than accepting a number it
    cannot honour. `UNRESOLVED_SOURCE_AMBIGUITY`-shaped honesty, at the evaluator.

THE SCOPE IS EXACTLY THE EARLY RETURN, AND THE CONTROL BELOW PROVES IT
    On a PARTIALLY wired frame the proxy still runs for the uncovered bars and the taught
    periods ARE consumed -- measured, 9/200 bars differing between two arms. Only the
    FULLY-covered case discards them. A refusal any wider would destroy a channel that
    demonstrably works.

WITNESS DISCIPLINE (R-695 §8, R-697 §6)
    Every array below is produced by unmodified production code. NOTHING IS SPIED. The
    author's own "invoked-with-the-taught-periods" witness goes GREEN on this path while
    the arms differ 0/200 -- which is the whole reason this file asserts on OUTPUT.
    `AN INVOCATION WITNESS IS NOT A CONSUMPTION WITNESS -- ONLY A DIFFERING OUTPUT IS.`

NO PARITY CLAIM (R-696 §4). TS/Python parity is [UNENUMERATED]. runtime-production is
[UNENUMERATED]. The producer is untouched: RECEIVES, never EXTRACTS.
"""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.tests.test_bias_refusal_surface import (
    N_BARS,
    _df,
    _plan,
    _spec,
)

ARM_A = {"fast_period": 7, "slow_period": 90}
ARM_B = {"fast_period": 31, "slow_period": 120}

# Bars 0..119 uncovered, 120..199 covered. The uncovered block is long enough for both
# arms' warm-up (the longer slow leg is 120, and the floor needs slow+2 of the FRAME,
# not of the uncovered block).
PARTIAL_NULL_BARS = 120


@pytest.fixture(autouse=True)
def enforced(monkeypatch):
    """The enforced dispatcher is the path under test and it is default-OFF. Flag only --
    no primitive is patched, so every array asserted on here is production output."""
    monkeypatch.setenv("TF_FAMILY_META_ENFORCED", "true")


def _wired(df: pl.DataFrame, null_before: int = 0) -> pl.DataFrame:
    """Attach the REAL column the compiler reads (`htf_daily_trend`, spec_condition_compiler
    .py:1240), rather than reaching into ctx. `None` is what htf_columns.py writes for a bar
    whose day is absent from the cache -- pre-warmup or a data gap."""
    n = len(df)
    trend = [
        None if i < null_before else ("bullish" if i % 3 else "bearish")
        for i in range(n)
    ]
    return df.with_columns(pl.Series("htf_daily_trend", trend, dtype=pl.Utf8))


def _run(
    df: pl.DataFrame, params: dict[str, dict], ids: tuple[str, ...] | None = None
) -> SpecConditionStrategy:
    """`ids` is explicit rather than derived from `params`, because the untaught control
    needs a condition that carries NO parameters -- deriving the id set from the params
    dict made that fixture build a spec with zero conditions and fail on a KeyError that
    looked nothing like the property under test."""
    spec = _spec(ids if ids is not None else tuple(params))
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane26"},
        symbol="MES",
        timeframe="15m",
        binding_plan=_plan(spec, params),
    )
    strat.compute(df)
    return strat


# ══ F-1 — A FULLY-WIRED FRAME MUST REFUSE TAUGHT PERIODS IT CANNOT HONOUR ═════════════

def test_f1_fully_wired_frame_refuses_taught_periods_it_cannot_honour():
    """RED BEFORE THE REPAIR, GREEN AFTER.

    Before: `_run` returned normally and both arms carried the identical wired answer --
    the taught numbers were accepted, discarded, and left no trace. After: the engine
    says so, naming the condition.
    """
    with pytest.raises(ValueError, match="supplied_parameter_cannot_fall_back_to_default") as exc:
        _run(_wired(_df()), {"armA": ARM_A})
    message = str(exc.value)
    print(f"\n[F-1 REFUSAL] fully-wired frame, taught {ARM_A}: {message}")
    assert "armA" in message, "the refusal must name the condition it came from"
    assert "fast_period" in message and "slow_period" in message, (
        f"the refusal must name the taught keys it cannot honour: {message}"
    )


def test_f1_control_partially_wired_frame_still_consumes_the_taught_periods():
    """THE CONTROL THAT MAKES THE REFUSAL ABOVE MEAN SOMETHING, AND IT IS THE HEART OF
    THIS FILE.

    Same fixture, same two arms, ONE variable changed: HTF coverage. On a partially
    wired frame the proxy runs for the uncovered bars, the taught periods reach the real
    calculation, and the arms DIFFER. Without this, the refusal test is satisfied by an
    engine that refuses every parameterized binding on every frame -- and the 0/200 in
    the mutation control below would be indistinguishable from a dead fixture.
    """
    strat = _run(_wired(_df(), null_before=PARTIAL_NULL_BARS), {"armA": ARM_A, "armB": ARM_B})
    a = strat.last_per_condition_bool["armA"]
    b = strat.last_per_condition_bool["armB"]
    differing = int(np.sum(a != b))
    print(
        f"\n[F-1 CONTROL] partially wired ({PARTIAL_NULL_BARS} uncovered bars): "
        f"armA vs armB differ on {differing}/{N_BARS} bars; wired_bars={strat._wire1_bias_bars}"
    )
    assert strat._wire1_bias_bars == N_BARS - PARTIAL_NULL_BARS, (
        "the fixture did not produce the intended partial coverage"
    )
    assert differing > 0, (
        "PARAMETER SEVERANCE ON THE PROXY PATH: two arms taught different periods "
        "produced identical decisions, so this control cannot witness consumption."
    )


def test_f1_control_unparameterized_binding_on_a_fully_wired_frame_still_runs():
    """POSITIVE CONTROL: the refusal must not have become 'no WAIT_BIAS on a wired frame'.

    A binding that teaches nothing has nothing to discard, so the fully-wired path is
    legitimate and must still produce the institutional answer.
    """
    df = _wired(_df())
    strat = _run(df, {}, ids=("plain",))
    produced = strat.last_per_condition_bool["plain"]
    expected = np.array(
        [t == "bullish" for t in df["htf_daily_trend"].to_list()], dtype=bool
    )
    print(
        f"\n[F-1 CONTROL] fully wired, nothing taught: no refusal; "
        f"{int(np.sum(produced))}/{len(produced)} bars True"
    )
    assert np.array_equal(produced, expected), (
        "the untaught fully-wired path must still return the real HTF signal"
    )


def test_f1_mutation_control_planted_accept_and_discard_yields_identical_arms():
    """THE PLANTED RESTORATION OF THE DEFECT, WHICH MUST MAKE THE REFUSAL ABOVE FAIL.

    Reverting `_htf_fully_covers` to a constant False restores the pre-repair behaviour
    exactly: no refusal fires, and the evaluator falls through to the proxy loop which
    skips every covered bar, so the OUTPUT is unchanged from the early return. Under the
    plant the two arms are identical on all 200 bars -- accept-and-discard, live.

    If this test cannot reproduce 0/200, the refusal test above is a green check with no
    path to red.
    """
    import src.engine.spec_condition_compiler as _scc
    original = _scc._htf_fully_covers
    df = _wired(_df())
    try:
        _scc._htf_fully_covers = lambda htf_trend, n: False
        strat = _run(df, {"armA": ARM_A, "armB": ARM_B})
        a = strat.last_per_condition_bool["armA"]
        b = strat.last_per_condition_bool["armB"]
    finally:
        _scc._htf_fully_covers = original

    differing = int(np.sum(a != b))
    print(
        f"\n[MUTATION CONTROL] planted accept-and-discard: armA vs armB differ on "
        f"{differing}/{N_BARS} bars (must be 0 — this IS the defect)"
    )
    assert differing == 0, (
        "MUTATION CONTROL DEAD: the planted pre-repair path produced DIFFERING arms, so "
        "the refusal test above could pass against unrepaired code and proves nothing."
    )


# ══ THE SHARED COVERAGE RULE CANNOT BE FORKED OR DROPPED ══════════════════════════════
#
# R-699 §6 UPGRADED THIS FROM A STATEMENT TO AN EXECUTABLE WITNESS, and the upgrade is
# right: `_htf_fully_covers`'s docstring NAMES both directions its two callers could
# disagree in, and until now nothing asserted they do not.
# `A NAMED FAILURE DIRECTION WITH NO TEST IS A PREDICTION, NOT A GUARD.`

def test_the_coverage_rule_is_defined_once_and_called_by_both_consumers():
    """STRUCTURAL WITNESS: goes RED if the rule is forked, or if either caller stops
    using it.

    The two failure directions the docstring names are asymmetric and both are silent:
    a handler that refused where the evaluator would have proxied rejects WORKING
    parameters; an evaluator that early-returns where the handler did not refuse
    RESTORES F-1 with no output signal at all. A copied-and-edited second predicate is
    how that happens in practice — AR-762 convicted `one rule, three copies` in this
    very campaign.
    """
    import ast
    import inspect

    import src.engine.spec_condition_compiler as scc

    tree = ast.parse(inspect.getsource(scc))
    defs = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "_htf_fully_covers"
    ]
    print(f"\n[SHARED RULE] definitions of _htf_fully_covers in the module: {len(defs)}")
    assert len(defs) == 1, (
        f"the coverage rule is defined {len(defs)} times. A forked predicate is exactly "
        f"how the evaluator's early return and the handler's refusal come to disagree."
    )

    callers = {"_eval_wait_bias", "_h_wait_bias"}
    found = {
        fn.name
        for fn in ast.walk(tree)
        if isinstance(fn, ast.FunctionDef) and fn.name in callers
        and any(
            isinstance(c, ast.Call)
            and getattr(c.func, "id", getattr(c.func, "attr", None)) == "_htf_fully_covers"
            for c in ast.walk(fn)
        )
    }
    print(f"[SHARED RULE] consumers calling it: {sorted(found)}")
    assert found == callers, (
        f"expected both {sorted(callers)} to consult the shared rule; only {sorted(found)} "
        f"do. A caller that stops using it has re-opened the disagreement this helper "
        f"exists to prevent."
    )


def test_behavioural_witness_both_consumers_follow_the_same_rule():
    """BEHAVIOURAL WITNESS, because the structural one above can be satisfied by a call
    whose result is ignored.

    ONE object is patched; BOTH consumers must visibly change behaviour.
      - forcing it FALSE on a fully-wired frame  -> the handler stops refusing (consumer 2)
      - forcing it TRUE on a partially-wired one -> the evaluator takes the early return
        and the uncovered bars are never proxied (consumer 1)
    If either consumer held its own copy of the predicate, one of these two would not move.
    """
    import src.engine.spec_condition_compiler as scc

    df_full = _wired(_df())
    df_part = _wired(_df(), null_before=PARTIAL_NULL_BARS)
    original = scc._htf_fully_covers

    # CONSUMER 2 — the handler's refusal follows the rule.
    try:
        scc._htf_fully_covers = lambda htf_trend, n: False
        _run(df_full, {"armA": ARM_A})          # must NOT raise
        handler_followed = True
    finally:
        scc._htf_fully_covers = original

    # CONSUMER 1 — the evaluator's early return follows the rule. Measured on OUTPUT:
    # with the rule forced True the proxy never runs, so the uncovered bars stay False.
    baseline = _run(df_part, {}, ids=("plain",)).last_per_condition_bool["plain"]
    try:
        scc._htf_fully_covers = lambda htf_trend, n: True
        forced = _run(df_part, {}, ids=("plain",)).last_per_condition_bool["plain"]
    finally:
        scc._htf_fully_covers = original

    moved = int(np.sum(baseline != forced))
    print(
        f"\n[SHARED RULE] handler followed the patched rule: {handler_followed}; "
        f"evaluator output moved on {moved}/{N_BARS} bars when the rule was forced True"
    )
    assert handler_followed
    assert moved > 0, (
        "the evaluator did not follow the patched rule, so it is not consulting the same "
        "predicate the handler is — the two can disagree and F-1 can return silently."
    )
