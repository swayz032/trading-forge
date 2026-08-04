"""LANE 29 (R-705 §5) — PARAMETER ACKNOWLEDGEMENT PRECEDES EVERY EARLY RETURN.

THE CONTRACT, VERBATIM (R-705 §5)
    Parameter acknowledgement must precede every short-frame early return capable of
    discarding a binding. THE SIX-ROW MATRIX:
        1. n=20, flag OFF, parameterized binding            -> refuse
        2. n=29, flag OFF, parameterized binding            -> refuse
        3. n=20, flag ON,  unsupported parameterized route  -> refuse
        4. n=29, flag ON,  unsupported parameterized route  -> refuse
        5. short frame + parameterless binding              -> legacy output UNCHANGED
        6. short frame + valid parameterized WAIT_BIAS      -> taught-parameter
           insufficiency refusal, NEVER a silent all-False output
    ORDERING -- the check occurs before ALL SIX: `candle_confirmation_check`, enforced or
    legacy dispatch, evaluator invocation, cache construction or mutation, per-condition
    state publication, and the `n < MIN_BARS_REQUIRED` return.

THE DEFECT, LOCATED BEFORE ANY LINE WAS CHANGED (AR-784 §3)
    Lane 27's flag-OFF refusal and Lane 28's flag-ON refusal both sat inline in `compute()`
    at :1417-:1509 -- roughly SEVENTY LINES BELOW its warm-up floor at :1346. A frame with
    fewer than MIN_BARS_REQUIRED bars returned four all-False columns and reached NEITHER.
    Both lanes closed against their own conditions and neither covered the short path.
    `A GUARD BELOW AN EARLY RETURN IS A GUARD THE SHORT PATH NEVER MEETS.`

WHY ROW 6 IS NOT A NEW BEHAVIOUR — THE PART THE RULING DOES NOT SAY
    `test_bias_refusal_surface`'s F-3 ALREADY refuses a taught slow leg longer than the
    frame (`supplied_parameter_cannot_fall_back_to_default`). But it fires inside
    `_h_wait_bias`, which is also below the floor -- so below MIN_BARS_REQUIRED bars that
    refusal is ITSELF unreachable. Row 6 is an existing refusal an early return had been
    hiding, not an invented one. `A REFUSAL THAT LIVES BELOW AN EARLY RETURN IS NOT A
    REFUSAL ON THE SHORT PATH.`

    THE BOUNDARY PAIR BELOW PROVES THEY ARE DIFFERENT REFUSALS AND NOT ONE IN DISGUISE:
    it teaches periods SHORTER than the frame (3/8), so F-3's condition is false in both
    arms, and the only variable is one bar of frame length -- 29 refuses, 30 computes.

WHAT THIS FILE DOES NOT DO
    It does not enable `TF_FAMILY_META_ENFORCED` (R-697 §5.10 stands). It does not widen
    row 5: the UNTAUGHT short frame keeps the documented legacy all-False, which is the
    boundary `test_f3_control_untaught_short_frame_keeps_the_legacy_all_false` already
    pins and this lane does not own. NO PARITY CLAIM -- TypeScript/Python parity is
    [UNENUMERATED]. The producer is untouched.

WITNESS DISCIPLINE (R-705 §5)
    "A DIRECT EXECUTION WITNESS, NEVER A FIELD PUBLISHED ONLY AFTER `compute()` FINISHES."
    Two are used, and neither is a post-run publication:

    (a) THE SENTINEL, which discriminates in BOTH directions using ONE instrument. A
        sentinel is seeded onto `last_per_condition_bool` BEFORE the call. The short-frame
        branch OVERWRITES it with `{}` as its first act. So: sentinel SURVIVES => the
        refusal fired above that branch; sentinel CLEARED => the legacy branch ran. Row 5
        asserts the cleared direction, which is what stops the surviving-sentinel
        assertion from being satisfied by a strategy object that simply never ran.
    (b) DELEGATING CALL COUNTERS on `candle_confirmation_check` and the real
        `_eval_wait_bias`, ratified as observation rather than fabrication by R-705 §3 --
        they inject no semantics and return production's own value. They are exercised on
        a FULL frame, where both would otherwise run, because on a short frame they would
        read zero even with no guard at all. `A NEGATIVE ASSERTION NEEDS A POSITIVE
        WITNESS THAT THE PATH RAN`, and the positive control is the same counters
        recording >0 on the parameterless arm of the identical fixture.
"""

from __future__ import annotations

import numpy as np
import pytest

from src.engine import spec_condition_compiler as scc
from src.engine.family_meta_enforcement import FLAG_ENV
from src.engine.spec_condition_compiler import (
    BIAS_EMA_FAST,
    BIAS_EMA_SLOW,
    MIN_BARS_REQUIRED,
    SpecConditionStrategy,
)
from src.engine.spec_family_bindings import compile_binding_plan
from src.engine.tests.test_bias_refusal_surface import TAUGHT, _df
from src.engine.tests.test_parameter_acceptance_guard import _apply, _spec

LANE_27_REFUSAL = "parameterized_binding_requires_enforced_dispatch"
LANE_28_REFUSAL = "parameter_supplied_to_non_consuming_route"
LANE_29_REFUSAL = "taught_parameters_require_a_sufficient_frame"

# R-705 §5 names these two frame lengths. They are the ruling's, not chosen here.
SHORT_FRAMES = (20, 29)

UNSUPPORTED_ROUTE = ("WAIT_STRUCTURE", "market structure")
CONSUMING_ROUTE = ("WAIT_BIAS", "bullish trend")

# Taught periods SHORTER than every frame in this file, so F-3's "taught leg longer than
# the frame" condition is FALSE in both arms of the boundary pair and cannot be what makes
# the short arm refuse. Off-default in BOTH legs, asserted at import against the engine's
# own constants rather than by a comment.
TAUGHT_SHORT = {"fast_period": 3, "slow_period": 8}
assert TAUGHT_SHORT["fast_period"] != BIAS_EMA_FAST
assert TAUGHT_SHORT["slow_period"] != BIAS_EMA_SLOW
assert max(TAUGHT_SHORT.values()) < min(SHORT_FRAMES)

SENTINEL_KEY = "__lane29_sentinel__"


@pytest.fixture
def flag_on(monkeypatch):
    """EXPLICIT, NEVER INHERITED (R-697 §5.7). The enforced dispatcher is default-OFF, so
    a fixture that assumes the ambient shell tests the other ladder entirely."""
    monkeypatch.setenv(FLAG_ENV, "true")


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv(FLAG_ENV, raising=False)


@pytest.fixture
def witness(monkeypatch):
    """DELEGATING counters -- they observe and fabricate nothing (R-705 §3)."""
    calls = {"confirmation": 0, "evaluator": 0}

    real_confirm = scc.candle_confirmation_check

    def counting_confirm(*args, **kwargs):
        calls["confirmation"] += 1
        return real_confirm(*args, **kwargs)

    real_eval = SpecConditionStrategy._eval_wait_bias

    def counting_eval(self, *args, **kwargs):
        calls["evaluator"] += 1
        return real_eval(self, *args, **kwargs)

    monkeypatch.setattr(scc, "candle_confirmation_check", counting_confirm)
    monkeypatch.setattr(SpecConditionStrategy, "_eval_wait_bias", counting_eval)
    return calls


def _strategy(route: tuple[str, str], params: dict | None) -> SpecConditionStrategy:
    ctype, obj = route
    spec = _spec(ctype, obj)
    plan = _apply(compile_binding_plan(spec), "c1", params, None)
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane29"},
        symbol="MES",
        timeframe="15m",
        binding_plan=plan,
    )
    # Seeded BEFORE the call. The short-frame branch's first act is to overwrite this with
    # an empty dict, so its survival times the refusal against that branch specifically.
    strat.last_per_condition_bool = {SENTINEL_KEY: np.ones(1, dtype=bool)}
    strat.last_trace = [SENTINEL_KEY]
    return strat


def _assert_nothing_was_published(strat, label: str) -> None:
    assert SENTINEL_KEY in strat.last_per_condition_bool, (
        f"[{label}] the sentinel was cleared, so `compute()` reached the short-frame "
        f"branch before refusing. The refusal must fire ABOVE the early return, not "
        f"after it has already published an empty per-condition map."
    )
    assert strat.last_trace == [SENTINEL_KEY], (
        f"[{label}] `last_trace` was reset, so state was mutated before the refusal. "
        f"A REFUSAL THAT FIRES AFTER A MUTATION IS A PARTIAL RUN WEARING AN EXCEPTION."
    )


def test_the_fixture_premise_holds():
    """The whole file is meaningless if these frames are not below the floor. Pinned to
    the imported constant so a future change to MIN_BARS_REQUIRED fails HERE, loudly,
    rather than silently converting every row below into a long-frame test."""
    assert MIN_BARS_REQUIRED == 30
    assert all(n < MIN_BARS_REQUIRED for n in SHORT_FRAMES)


# ══ ROWS 1-2 — FLAG OFF, PARAMETERIZED, SHORT FRAME ════════════════════════════════════

@pytest.mark.parametrize("n", SHORT_FRAMES)
def test_row_1_2_flag_off_parameterized_binding_refuses_on_a_short_frame(flag_off, n):
    """Lane 27's refusal, now reachable on the path it never covered. The flag-OFF ladder
    never reads `b.parameters` at any frame length; before this lane a short frame simply
    returned all-False and the taught numbers vanished with no error and no trace."""
    strat = _strategy(CONSUMING_ROUTE, TAUGHT)
    with pytest.raises(ValueError, match=LANE_27_REFUSAL) as exc:
        strat.compute(_df(n=n))
    assert "c1" in str(exc.value), "the refusal must name the offending condition (R-701 §3)"
    _assert_nothing_was_published(strat, f"row 1/2 n={n}")


# ══ ROWS 3-4 — FLAG ON, UNSUPPORTED ROUTE, SHORT FRAME ═════════════════════════════════

@pytest.mark.parametrize("n", SHORT_FRAMES)
def test_row_3_4_unsupported_route_refuses_on_a_short_frame(flag_on, n):
    """Lane 28's refusal, same treatment. `_h_structure` cannot consume a period at ANY
    frame length -- `_eval_wait_structure(n, df)` has no period argument -- so the short
    frame must not be the one place it is allowed to accept one and drop it."""
    strat = _strategy(UNSUPPORTED_ROUTE, TAUGHT)
    with pytest.raises(ValueError, match=LANE_28_REFUSAL) as exc:
        strat.compute(_df(n=n))
    message = str(exc.value)
    assert "c1" in message
    assert "structure_engine.compute_structure_state" in message, (
        "the refusal must name the ROUTE that could not honour the parameter"
    )
    _assert_nothing_was_published(strat, f"row 3/4 n={n}")


# ══ ROW 5 — THE BOUNDARY THIS LANE DOES NOT OWN ════════════════════════════════════════

@pytest.mark.parametrize("n", SHORT_FRAMES)
@pytest.mark.parametrize("flag", ["on", "off"])
def test_row_5_untaught_short_frame_keeps_the_legacy_output_unchanged(
    monkeypatch, n, flag
):
    """POSITIVE CONTROL, AND IT IS THE HALF THAT KEEPS THE REPAIR INSIDE ITS LANE.

    With nothing taught there is nothing to drop, so the genuinely-absent case must still
    take the documented legacy behaviour in BOTH flag states. A guard that refused here
    would change the DEFAULT-configured path and every short frame in the suite.

    It is also the sentinel's other direction: here the sentinel must be CLEARED, proving
    the legacy branch actually executed. Without this arm, "the sentinel survived" in the
    rows above would also be satisfied by a `compute()` that never ran at all.
    """
    if flag == "on":
        monkeypatch.setenv(FLAG_ENV, "true")
    else:
        monkeypatch.delenv(FLAG_ENV, raising=False)

    strat = _strategy(CONSUMING_ROUTE, None)
    out = strat.compute(_df(n=n))

    assert SENTINEL_KEY not in strat.last_per_condition_bool, (
        "the legacy short-frame branch did not run -- it must overwrite the "
        "per-condition map, and its doing so is what makes the surviving-sentinel "
        "assertion in the refusal rows non-vacuous"
    )
    assert strat.last_per_condition_bool == {}
    for column in ("entry_long", "entry_short", "exit_long", "exit_short"):
        assert not out[column].any(), f"legacy all-False broken for {column}"


# ══ ROW 6 — SHORT FRAME, VALID PARAMETERIZED WAIT_BIAS ═════════════════════════════════

@pytest.mark.parametrize("n", SHORT_FRAMES)
def test_row_6_taught_parameters_on_a_short_frame_refuse_rather_than_return_all_false(
    flag_on, n
):
    """THE ROW THE OTHER FIVE EXIST TO FRAME.

    The route consumes, the flag is on, the keys are canonical -- everything is correct
    except the frame. The pre-lane behaviour was an all-False array, which is the exact
    observable signature of "the parameter never transmitted": a lane hunting a
    transmission bug would have been handed a manufactured symptom of its own hypothesis
    (the failure direction R-692 §4 named).
    """
    strat = _strategy(CONSUMING_ROUTE, TAUGHT_SHORT)
    with pytest.raises(ValueError, match=LANE_29_REFUSAL) as exc:
        strat.compute(_df(n=n))
    message = str(exc.value)
    print(f"\n[ROW 6 n={n}] {message}")
    assert "c1" in message, "the refusal must name the condition"
    assert "fast_period" in message and "slow_period" in message, (
        "the refusal must name the taught KEYS -- R-704 §4(A) required exactly this of "
        "the Lane 28 message and the same obligation applies here"
    )
    assert str(n) in message and str(MIN_BARS_REQUIRED) in message, (
        "the refusal must name the frame it had and the floor it needed"
    )
    _assert_nothing_was_published(strat, f"row 6 n={n}")


def test_row_6_boundary_one_bar_decides_and_it_is_not_f3_in_disguise(flag_on):
    """THE DISCRIMINATING PAIR. Identical taught periods, identical route, identical flag
    state; the ONLY variable is one bar of frame length.

    n = MIN_BARS_REQUIRED - 1 -> refuses
    n = MIN_BARS_REQUIRED     -> computes, and the taught periods are consumed

    Both arms teach 3/8, well SHORTER than either frame, so F-3's
    `supplied_parameter_cannot_fall_back_to_default` cannot be what fires. Without this,
    an implementation that refused every taught binding regardless of bar count would
    satisfy every row above while destroying the channel entirely.
    """
    with pytest.raises(ValueError, match=LANE_29_REFUSAL):
        _strategy(CONSUMING_ROUTE, TAUGHT_SHORT).compute(_df(n=MIN_BARS_REQUIRED - 1))

    strat = _strategy(CONSUMING_ROUTE, TAUGHT_SHORT)
    strat.compute(_df(n=MIN_BARS_REQUIRED))
    produced = strat.last_per_condition_bool["c1"]
    assert len(produced) == MIN_BARS_REQUIRED
    assert SENTINEL_KEY not in strat.last_per_condition_bool


# ══ ORDERING — MEASURED ON A FULL FRAME, WHERE THE SURFACES WOULD OTHERWISE RUN ════════

def test_refusal_precedes_confirmation_evaluator_and_cache_on_a_full_frame(
    flag_on, witness
):
    """R-705 §5's ordering clause, witnessed directly.

    Measured at 200 bars ON PURPOSE: on a short frame these counters would read zero even
    with no guard at all, so a short-frame ordering claim proves nothing. Here both
    surfaces WOULD run, and both must read zero because the refusal fired first.
    """
    strat = _strategy(UNSUPPORTED_ROUTE, TAUGHT)
    with pytest.raises(ValueError, match=LANE_28_REFUSAL):
        strat.compute(_df())
    assert witness["confirmation"] == 0, (
        "`candle_confirmation_check` ran before the refusal -- the acknowledgement is "
        "not above it"
    )
    assert witness["evaluator"] == 0, "an evaluator ran before the refusal"
    _assert_nothing_was_published(strat, "full-frame ordering")


def test_ordering_witness_positive_control_the_counters_do_record(flag_on, witness):
    """THE CONTROL THAT MAKES THE ZEROES ABOVE MEAN SOMETHING.

    Same fixture, same frame, parameters removed so nothing refuses. Both counters must
    now record. A monkeypatch that silently failed to attach would report zero in the test
    above and pass it while proving nothing at all.
    """
    strat = _strategy(CONSUMING_ROUTE, None)
    strat.compute(_df())
    assert witness["confirmation"] > 0, (
        "the confirmation counter never recorded even on a path that runs -- the witness "
        "is dead and the ordering assertions above are vacuous"
    )
    assert witness["evaluator"] > 0, "the evaluator counter never recorded"
