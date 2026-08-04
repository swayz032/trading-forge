"""HANDOFF 5 (R-695 §7, R-696 §7) — THE REFUSAL SURFACE OF THE BIAS PARAMETER CHANNEL.

WHY THIS FILE EXISTS AND WHY IT IS SEPARATE FROM test_bias_parameter_transmission.py
    The independent grade of Lane 21 returned PASS_WITH_BOUNDED_FINDINGS at band 7, and
    said WHY it was not 8: `THE REFUSAL SURFACE IS INCOMPLETE`. That is a different
    property from the one the transmission file proves. Transmission asks "does a taught
    number reach the evaluator"; this file asks "what happens to a number that is NOT
    usable, and does the engine say so or quietly invent one".
    `ONE FIXTURE THAT CAN FAIL FOR TWO REASONS IS NOT A CONTROL FOR EITHER` (R-679 §4) —
    so they are separate files, not separate tests in one file.

THE THREE DEFECTS THIS FILE RED-PROOFS, ALL CONFIRMED AT THE EXECUTABLE LINE BY THE
ADVISOR DESK BEFORE THEY WERE ASSIGNED (R-695 §3/§4/§5)

    F-2 (HIGH) — `_resolve_bias_periods` iterates ONLY the two canonical keys, and
        `key not in params` treats UNRECOGNISED exactly like ABSENT. So {'period': 7}
        yields (20, 50): the engine defaults, no refusal, no error, no trace. The
        docstring directly above that loop claims the function `REFUSES RATHER THAN
        SUBSTITUTES ... never quietly replaced by a default`.
        ROOT CAUSE, NAMED: A TAXONOMY WITH NO RESIDUAL. Its categories are
        {absent -> default | present-and-usable -> use | present-and-unusable -> raise};
        `PRESENT UNDER ANOTHER NAME` has no category, so it mis-files as `absent`.
        R-684 §7.2 minted the missing code -- `unknown_parameter_key` -- and the
        evaluator never implemented it. `A BLOCK CODE IN A RULING IS NOT A BRANCH IN
        THE ENGINE.`

    F-1 (HIGH) — `_eval_wait_bias`'s WIRED-HTF branch returns at :801 BEFORE `eff_fast`
        and `eff_slow` exist. The taught periods are received as arguments and never
        read. The comment at :805 saying they are consumed sits BELOW that return.
        `THE ARGUMENT THAT ARRIVED IS NOT THE ARGUMENT THAT WAS READ. AN INVOCATION
        WITNESS IS NOT A CONSUMPTION WITNESS -- ONLY A DIFFERING OUTPUT IS` (R-695 §8).

    F-3 (MEDIUM) — the warm-up floor `if n < eff_slow + 2: return out` returns all-False,
        which is INDISTINGUISHABLE from "the parameter did not transmit". It fails in
        the direction that looks like the hypothesis (R-692 §4). `A MOVING FLOOR REFUSES
        NOTHING.`

WHAT THIS FILE IS NOT
    It makes NO parity claim of any kind (R-696 §4). TypeScript/Python parity is
    [UNENUMERATED]. It does not touch the producer: nothing here extracts a number from
    a transcript, and no numeric parser is authored. RECEIVES, never EXTRACTS.
"""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.indicators.core import compute_ema
from src.engine.spec_condition_compiler import (
    BIAS_EMA_FAST,
    BIAS_EMA_SLOW,
    SpecConditionStrategy,
)
from src.engine.spec_family_bindings import compile_binding_plan

N_BARS = 200

# The taught arm. Deliberately off every engine default (the transmission file asserts
# that property against the imported constants; this file reuses the same numbers so a
# reader does not have to reconcile two fixtures).
TAUGHT = {"fast_period": 7, "slow_period": 90}


@pytest.fixture(autouse=True)
def enforced(monkeypatch):
    """THE ENFORCED DISPATCHER IS THE PATH UNDER TEST, AND IT IS DEFAULT-OFF.

    `TF_FAMILY_META_ENFORCED` defaults to OFF (family_meta_enforcement.py:146, and
    R-695 §6(2) measured it), so a fixture that does not set it exercises the legacy
    `b.type` ladder -- where `_h_wait_bias` is never called and no parameter can reach
    `_resolve_bias_periods` at all.

    THIS FIXTURE WAS ADDED AFTER MY OWN CONTROL CAUGHT ITS ABSENCE, AND THE SEQUENCE IS
    WORTH KEEPING: the first run of this file went RED on all four refusal tests AND on
    the positive control, which reported the taught arm differing from the engine
    default on 0/200 bars. Four reds that look like the defect, produced by a fixture
    that never reached the defect's code. `A RED FROM A FIXTURE THAT COULD NOT HAVE
    REACHED THE DEFECT IS NOT A RED-PROOF` -- the control is what discriminated, which
    is the whole reason R-681 §1 requires one.

    IT SETS ONLY THE FLAG. No primitive is patched, so every array asserted on in this
    file is produced by unmodified production code: `AN INVOCATION WITNESS IS NOT A
    CONSUMPTION WITNESS -- ONLY A DIFFERING OUTPUT IS` (R-695 §8).
    """
    monkeypatch.setenv("TF_FAMILY_META_ENFORCED", "true")


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
    """INDEPENDENT recomputation, used only to identify WHICH periods produced an answer."""
    s = df["close"]
    f = compute_ema(s, fast).to_numpy()
    sl = compute_ema(s, slow).to_numpy()
    out = np.zeros(len(f), dtype=bool)
    for i in range(len(f)):
        if not (np.isnan(f[i]) or np.isnan(sl[i])):
            out[i] = f[i] > sl[i]
    return out


def _run(spec: dict, params: dict[str, dict], df: pl.DataFrame) -> SpecConditionStrategy:
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "handoff5"},
        symbol="MES",
        timeframe="15m",
        binding_plan=_plan(spec, params),
    )
    strat.compute(df)
    return strat


# ══ F-2 — AN UNRECOGNISED KEY MUST REFUSE, NAMING THE KEY ═════════════════════════════
#
# THE THREE SHAPES ARE THE GRADER'S OWN, NOT MINE (R-695 §7(1)). They are a regression
# corpus now: the grade measured all three reproducing the defect with 0/200 bars
# differing from the engine-default answer.
UNRECOGNISED_KEY_SHAPES = [
    ({"period": 7}, "a single generic `period`"),
    ({"fast": 7, "slow": 90}, "abbreviated fast/slow"),
    ({"ema_fast": 7, "ema_slow": 90}, "indicator-prefixed names"),
]


@pytest.mark.parametrize("params, shape", UNRECOGNISED_KEY_SHAPES)
def test_f2_unrecognised_parameter_key_is_refused_naming_the_key(params, shape):
    """RED BEFORE THE REPAIR, GREEN AFTER. The defect is silent, so this is the only
    assertion that can see it: before the branch existed, `_run` returned normally and
    the condition carried the EMA(20/50) answer.

    The refusal must NAME THE OFFENDING KEY. A refusal that says only "bad parameters"
    is a red you cannot act on -- the same objection R-694 §7(2) raised against a gate
    whose red did not identify the offender.
    """
    with pytest.raises(ValueError, match="supplied_parameter_cannot_fall_back_to_default") as exc:
        _run(_spec(("armA",)), {"armA": params}, _df())
    message = str(exc.value)
    print(f"\n[F-2 REFUSAL] {shape}: {message}")
    for key in params:
        assert key in message, (
            f"the refusal did not name the offending key {key!r}. A block code without "
            f"the key is not actionable: {message}"
        )
    assert "armA" in message, "the refusal did not name the condition it came from"


def test_f2_control_recognised_keys_are_still_accepted():
    """POSITIVE CONTROL FOR THE REFUSAL ABOVE, AND IT IS NOT OPTIONAL.

    Without it, an implementation that raises on EVERY parameterized binding satisfies
    all three refusal tests and destroys the channel handoff 6 proved. This asserts the
    taught arm still produces the array ITS OWN periods imply -- not merely that it did
    not raise.
    """
    df = _df()
    strat = _run(_spec(("armA",)), {"armA": TAUGHT}, df)
    produced = strat.last_per_condition_bool["armA"]
    expected = _ema_cross(df, TAUGHT["fast_period"], TAUGHT["slow_period"])
    default_answer = _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)
    from_default = int(np.sum(produced != default_answer))
    print(
        f"\n[F-2 CONTROL] taught {TAUGHT} accepted; matches its own periods="
        f"{np.array_equal(produced, expected)}; differs from the engine default on "
        f"{from_default}/{N_BARS} bars"
    )
    assert np.array_equal(produced, expected)
    assert from_default > 0


def test_f2_control_absent_parameters_still_take_the_documented_default():
    """SECOND POSITIVE CONTROL, ON THE OTHER SIDE OF THE TAXONOMY.

    `absent` and `present-under-another-name` are the two categories the defect fused.
    A repair that fixed the fusion by ALSO refusing `absent` would break every binding
    this repo builds today, all of which carry parameters=None.
    """
    df = _df()
    strat = _run(_spec(("plain",)), {}, df)
    produced = strat.last_per_condition_bool["plain"]
    print("\n[F-2 CONTROL] unparameterized binding still runs on the engine defaults")
    assert np.array_equal(produced, _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW))


def test_f2_partial_recognition_still_refuses():
    """THE SHAPE THAT WOULD SURVIVE A KEY-COUNT CHECK.

    A repair written as `len(params) != 2 -> refuse` passes all three shapes above and
    lets THIS one through: one recognised key beside one unrecognised key. The taught
    `fast_period` would be honoured while `slow` was silently dropped to the default --
    the parameter-loss channel, half open.
    """
    with pytest.raises(ValueError, match="supplied_parameter_cannot_fall_back_to_default") as exc:
        _run(_spec(("armA",)), {"armA": {"fast_period": 7, "slow": 90}}, _df())
    message = str(exc.value)
    print(f"\n[F-2 MIXED] one recognised + one unrecognised key: {message}")
    assert "['slow']" in message, (
        f"the refusal must name EXACTLY the unrecognised key, not the whole set: {message}"
    )


def test_f2_mirror_partial_recognition_still_refuses():
    """LANE 30 / `M3` (`R-702 §6(2)`, widened by `R-707 §6(2)`) — THE OTHER HALF OF THE
    HYBRID, WHICH NOTHING HAD EVER MEASURED.

    `F-2D` and the test above only ever exercised ONE direction: canonical `fast_period`
    honoured while `slow` was dropped. The mirror -- canonical `slow_period` honoured while
    the FAST leg arrives under an unrecognised key -- was never asserted, so a regression
    that reopened the parameter-loss channel on the fast side would have shipped green.

    🛑 **THIS IS A COVERAGE HOLE, NOT A LIVE DEFECT, AND THE DISTINCTION IS THE RULING'S:**
    `[MEASURED HERE before writing this test]` shipped code ALREADY refuses this input and
    already names exactly `['fast']`. `R-702 §6` says it in one line -- *"THESE ARE TESTS
    THAT CANNOT FAIL, NOT LIVE DEFECTS"*. What was missing was the ability to DETECT a
    regression, and that is what this adds.

    BOTH DIRECTIONS NOW REFUSE PERMANENTLY, and each names ONLY the offending key.
    """
    with pytest.raises(ValueError, match="supplied_parameter_cannot_fall_back_to_default") as exc:
        _run(_spec(("armA",)), {"armA": {"fast": 7, "slow_period": 90}}, _df())
    message = str(exc.value)
    print(f"\n[M3 MIRROR] canonical slow_period + unrecognised fast: {message}")
    assert "key(s) ['fast']" in message, (
        f"the refusal must name EXACTLY the unrecognised key responsible for the hybrid. "
        f"Naming the whole set, or the canonical key alongside it, tells a reader to go "
        f"looking instead of telling them what to change: {message}"
    )


def test_f2_mirror_mutation_control_the_hybrid_answer_is_real_and_distinguishable():
    """THE MIRROR'S OWN MUTATION CONTROL — and it pins the EXACT wrong array.

    Under the verbatim pre-repair resolver this input does not error: it honours the taught
    `slow_period=90` and silently defaults the fast leg to `BIAS_EMA_FAST`. That produces
    `EMA(20, 90)` — an answer that is NEITHER the engine default `EMA(20,50)` NOR the
    fully-taught `EMA(7,90)`.

    ★ Asserting the hybrid EQUALS `EMA(20,90)` and DIFFERS from both neighbours is what
    makes this a control rather than a restatement: *"the output changed"* is also
    satisfied by noise, and *"it equals the default"* would be satisfied by a resolver that
    dropped BOTH legs. `A CONTROL MUST DISCRIMINATE.`
    """
    reverted_calls: list[dict] = []

    def reverted_resolver(inner, b):
        params = dict(b.parameters or ())
        reverted_calls.append(params)
        resolved = {}
        for key, default in (("fast_period", BIAS_EMA_FAST), ("slow_period", BIAS_EMA_SLOW)):
            resolved[key] = params.get(key, default)
        return resolved["fast_period"], resolved["slow_period"]

    df = _df()
    original = SpecConditionStrategy._resolve_bias_periods
    try:
        SpecConditionStrategy._resolve_bias_periods = reverted_resolver
        strat = _run(_spec(("armA",)), {"armA": {"fast": 7, "slow_period": 90}}, df)
        produced = strat.last_per_condition_bool["armA"]
    finally:
        SpecConditionStrategy._resolve_bias_periods = original

    hybrid = _ema_cross(df, BIAS_EMA_FAST, 90)          # fast DEFAULTED, slow HONOURED
    engine_default = _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)
    fully_taught = _ema_cross(df, 7, 90)
    print(
        f"\n[M3 MIRROR CONTROL] reverted resolver saw {reverted_calls}; produced "
        f"EMA({BIAS_EMA_FAST},90) — differs from engine default on "
        f"{int(np.sum(produced != engine_default))}/{N_BARS} bars and from the fully-taught "
        f"answer on {int(np.sum(produced != fully_taught))}/{N_BARS} bars"
    )
    assert reverted_calls == [{"fast": 7, "slow_period": 90}], (
        "MUTATION CONTROL DEAD: the reverted resolver never saw the hybrid key set, so "
        "this fixture is not reaching the code the repair changed."
    )
    assert np.array_equal(produced, hybrid), (
        "MUTATION CONTROL DEAD: the silent-default resolver did not produce the "
        "fast-defaulted/slow-honoured hybrid, so the mirror refusal above could pass "
        "against unrepaired code and prove nothing."
    )
    assert not np.array_equal(hybrid, engine_default) and not np.array_equal(hybrid, fully_taught), (
        "THE CONTROL CANNOT DISCRIMINATE: the hybrid answer is indistinguishable from the "
        "engine default or from the fully-taught answer on this fixture, so equality with "
        "it proves nothing. Choose periods that separate all three."
    )


def test_f2_mutation_control_planted_silent_default_fails_this_file():
    """THE PLANTED RESTORATION OF THE SILENT DEFAULT, WHICH R-697 §6 REQUIRES TO FAIL A
    PERMANENT TEST.

    The body below is the VERBATIM pre-repair resolver -- `key not in params` over the two
    canonical keys, nothing else -- not a strawman. If the refusal assertions in this file
    can pass against it, they are not testing what they claim to test, and the whole file
    is a green check with no path to red.

    This test asserting the DEFECT is the mutation control; the four tests above assert
    the REPAIR. They must disagree, and that disagreement is the only thing that makes
    either of them evidence.
    """
    reverted_calls: list[dict] = []

    def reverted_resolver(inner, b):
        params = dict(b.parameters or ())
        reverted_calls.append(params)
        resolved = {}
        for key, default in (("fast_period", BIAS_EMA_FAST), ("slow_period", BIAS_EMA_SLOW)):
            resolved[key] = params.get(key, default)
        return resolved["fast_period"], resolved["slow_period"]

    df = _df()
    original = SpecConditionStrategy._resolve_bias_periods
    try:
        SpecConditionStrategy._resolve_bias_periods = reverted_resolver
        strat = _run(_spec(("armA",)), {"armA": {"period": 7}}, df)
        produced = strat.last_per_condition_bool["armA"]
    finally:
        SpecConditionStrategy._resolve_bias_periods = original

    default_answer = _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)
    differing = int(np.sum(produced != default_answer))
    print(
        f"\n[MUTATION CONTROL] reverted resolver saw {reverted_calls}; produced an array "
        f"differing from EMA({BIAS_EMA_FAST},{BIAS_EMA_SLOW}) on {differing}/{N_BARS} bars "
        f"(must be 0 — this IS the defect)"
    )
    assert reverted_calls == [{"period": 7}], (
        "MUTATION CONTROL DEAD: the reverted resolver never saw the unrecognised key, so "
        "this fixture is not reaching the code the repair changed."
    )
    assert differing == 0, (
        "MUTATION CONTROL DEAD: the reverted silent-default resolver produced something "
        "OTHER than the engine-default answer, so the refusal tests above could pass "
        "against unrepaired code and prove nothing."
    )


# ══ F-3 — THE WARM-UP FLOOR MUST REFUSE, NOT RETURN ALL-FALSE ═════════════════════════

def test_f3_taught_period_longer_than_the_frame_is_refused():
    """A MOVING FLOOR REFUSES NOTHING.

    Before this repair a taught slow leg longer than the frame returned an all-False
    array — the exact observable signature of "the parameter never transmitted". A lane
    hunting a transmission bug would have been handed a manufactured symptom of its own
    hypothesis, which is the failure direction R-692 §4 named.
    """
    short = _df(n=40)
    with pytest.raises(ValueError, match="supplied_parameter_cannot_fall_back_to_default") as exc:
        _run(_spec(("armA",)), {"armA": TAUGHT}, short)
    message = str(exc.value)
    print(f"\n[F-3 REFUSAL] 40 bars vs a taught slow leg of 90: {message}")
    assert "armA" in message and "90" in message and "40" in message, (
        f"the refusal must name the condition, the taught period and the bars it had: {message}"
    )


def test_f3_control_untaught_short_frame_keeps_the_legacy_all_false():
    """POSITIVE CONTROL, AND IT IS WHAT KEEPS F-3'S REPAIR INSIDE ITS LANE.

    With no taught period there is no hypothesis to confuse, so the genuinely-absent case
    must still take the documented legacy behaviour. A repair that refused here would
    change the DEFAULT-configured path and break every short frame in the suite — the
    blast radius this lane does not own.
    """
    short = _df(n=40)
    strat = _run(_spec(("plain",)), {}, short)
    produced = strat.last_per_condition_bool["plain"]
    print(
        f"\n[F-3 CONTROL] 40 bars, nothing taught: no refusal; "
        f"{int(np.sum(produced))}/{len(produced)} bars True (legacy all-False preserved)"
    )
    assert not produced.any(), (
        "the untaught short-frame path must keep returning the legacy all-False array"
    )


def test_f3_control_frame_long_enough_still_computes():
    """SECOND POSITIVE CONTROL: the floor must not have become an always-raise.

    Without this, an implementation that refused every taught binding regardless of bar
    count would satisfy the refusal test above while destroying the channel entirely.
    """
    df = _df()
    strat = _run(_spec(("armA",)), {"armA": TAUGHT}, df)
    produced = strat.last_per_condition_bool["armA"]
    expected = _ema_cross(df, TAUGHT["fast_period"], TAUGHT["slow_period"])
    print(f"\n[F-3 CONTROL] {N_BARS} bars, taught slow leg 90: computed, no refusal")
    assert np.array_equal(produced, expected)
