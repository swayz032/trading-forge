"""LANE 28 (R-702 §6, widened by R-703 §1) — NO ROUTE MAY ACCEPT A PARAMETER IT DOES NOT
CONSUME, IN EITHER FLAG STATE.

THE INVARIANT, VERBATIM (R-703 §1)
    In either flag state, every non-empty `ConditionBinding.parameters` object is either
    consumed by the real semantic evaluator or refused before evaluator/cache/state
    mutation.

THE FINDING THAT GENERALISES, VERBATIM (R-703 §1)
    A parameter is not consumed merely because it changes the cache key. A route that
    accepts a parameter must pass it into the real semantic computation or refuse it
    before execution.

THE DEFECT (F-A), REPRODUCED ON THIS SEAT'S OWN INSTRUMENT BEFORE ANY LINE WAS CHANGED
    Flag ON, two arms differing ONLY in `parameters`:

        WAIT_BIAS          _h_wait_bias      differ 10/200  <- CONSUMED (the control)
        WAIT_STRUCTURE     _h_structure      differ  0/200  <- accepted and discarded
        WAIT_RETEST        _h_retest         differ  0/200  <- accepted and discarded
        WAIT_CONFIRMATION  _h_confirmation   differ  0/200  <- accepted and discarded
        VERIFY_STRUCTURE   _h_structure      differ  0/200  <- accepted and discarded
        FILTER             _h_non_gating     differ  0/200  <- accepted and discarded

    ON THE `22/200` IN R-703 §1, STATED RATHER THAN QUIETLY DIVERGED FROM: the grade
    receipt reports 22/200 for WAIT_BIAS but does not publish its armA/armB parameter
    values, so that exact magnitude is NOT reproducible from the artifact. This file
    therefore asserts the PROPERTY the control exists to protect -- a non-zero differing
    output, plus independent per-parameter caching -- and never a hand-copied 22.
    `A HARDCODED EXPECTED VALUE COPIED FROM ANOTHER FIXTURE IS A FABRICATED SAFETY CLAIM.`

WHY `_h_structure` IS THE WORST OF THEM
    It does not ignore `b.parameters`; it uses them as a CACHE KEY and then calls
    `_eval_wait_structure(ctx["n"], ctx["df"])`, whose signature cannot accept a period.
    The taught numbers visibly affect cache occupancy while changing no answer.
    `AN ACCEPTED PARAMETER THAT ONLY MOVES THE CACHE KEY IS THE MOST CONVINCING FORM OF
    ACCEPT-AND-DISCARD.`

THE INVERSION THIS FILE CLOSES (R-702 §1)
    Before this lane the ONLY guard covering those five routes was Lane 27's, which fires
    only when the flag is OFF. Turning enforcement ON -- the entire point of activation
    safety -- REMOVED the last guard on five of six routes. This file's own module already
    carries the law: `A GUARD THAT ONLY WATCHES THE PATH YOU TURNED ON IS NOT WATCHING
    PRODUCTION.` F-A is its mirror image.

WHAT THIS FILE DOES NOT DO
    It does not enable `TF_FAMILY_META_ENFORCED` in production (R-697 §5.10 stands) and
    does not authorize activation. It invents no period argument for evaluators that take
    none. NO PARITY CLAIM: TypeScript/Python parity is [UNENUMERATED]. The producer is
    untouched: RECEIVES, never EXTRACTS.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from src.engine.family_meta_enforcement import FLAG_ENV
from src.engine.spec_condition_compiler import (
    CONSUMES_SUPPORTED_PARAMETERS,
    ENFORCED_DISPATCH,
    ENVIRONMENT_GATED_UNVERIFIED,
    HANDLER_PARAMETER_CLASSIFICATION,
    PARAMETER_CONSUMING_HANDLERS,
    PARAMETERLESS_BY_CONTRACT,
    REFUSES_ALL_PARAMETERS,
    SpecConditionStrategy,
)
from src.engine.spec_family_bindings import compile_binding_plan
from src.engine.tests.test_bias_refusal_surface import TAUGHT, _df

REFUSAL = "parameter_supplied_to_non_consuming_route"
LANE_27_REFUSAL = "parameterized_binding_requires_enforced_dispatch"

# A SECOND taught arm, distinct from TAUGHT in BOTH legs, so "the two arms differ" cannot
# be satisfied by one leg alone.
TAUGHT_B = {"fast_period": 12, "slow_period": 30}

# The five routes the grade measured. R-703 §1: this list is a FLOOR, NOT A CENSUS -- the
# census is the by-member table below.
GRADED_ROUTES: tuple[tuple[str, str], ...] = (
    ("WAIT_STRUCTURE", "market structure"),
    ("WAIT_RETEST", "retest of the level"),
    ("WAIT_CONFIRMATION", "confirmation candle"),
    ("VERIFY_STRUCTURE", "structure holds"),
    ("FILTER", "volume confluence"),
)
CONSUMING_ROUTE = ("WAIT_BIAS", "bullish trend")


@pytest.fixture
def flag_on(monkeypatch):
    """EXPLICIT, NEVER INHERITED (R-697 §5.7). The enforced dispatcher is the path under
    test and it is default-OFF, so a fixture that merely assumes the ambient shell tests
    the other ladder entirely -- which is exactly how AR-776's first run produced four
    reds from a fixture that never reached the defect."""
    monkeypatch.setenv(FLAG_ENV, "true")


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv(FLAG_ENV, raising=False)


def _spec(ctype: str, obj: str, *, invalidation: bool = False) -> dict:
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "c1", "type": ctype, "object": obj, "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    if invalidation:
        spec["invalidations"] = [
            {"id": "v1", "type": ctype, "object": obj, "role": "invalidation"}
        ]
    return spec


def _apply(plan, target: str, params: dict | None, primitive: str | None):
    for bucket in (plan.bindings, plan.invalidation_bindings):
        for i, b in enumerate(bucket):
            if b.condition_id != target:
                continue
            changes: dict = {}
            if params:
                changes["parameters"] = tuple(sorted(params.items()))
            if primitive is not None:
                changes["primitive"] = primitive
            if changes:
                bucket[i] = dataclasses.replace(b, **changes)
    return plan


def _run(
    ctype: str,
    obj: str,
    params: dict | None,
    primitive: str | None = None,
    *,
    target: str = "c1",
    invalidation: bool = False,
):
    """Build and run one arm. `primitive` overrides the bound primitive so the census below
    can reach handlers no spec in this repo routes to -- including the env-gated experiment
    primitives and `_h_session`, both of which the grade left UNPROBED."""
    spec = _spec(ctype, obj, invalidation=invalidation)
    plan = _apply(compile_binding_plan(spec), target, params, primitive)
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane28"},
        symbol="MES",
        timeframe="15m",
        binding_plan=plan,
    )
    strat.compute(_df())
    return strat


# ══ 1. THE GRADER'S TABLE, TURNED INTO A REFUSAL ═══════════════════════════════════════

@pytest.mark.parametrize(("ctype", "obj"), GRADED_ROUTES)
def test_non_consuming_route_refuses_when_parameterized(flag_on, ctype, obj):
    """Each of the five must REFUSE. Nothing here can consume: `_eval_wait_structure(n,
    df)`, `retest_touch_check`, `candle_confirmation_check` and the non-gating constant
    take no period, and inventing one would be the fabricated implementation the packet
    prohibits by name (`DO NOT INVENT PARAMETER SEMANTICS`, R-703 §1)."""
    with pytest.raises(ValueError, match=REFUSAL) as exc:
        _run(ctype, obj, TAUGHT)
    message = str(exc.value)
    print(f"\n[{ctype}] {message}")
    assert "c1" in message, "the refusal must name the offending condition (R-701 §3)"


def test_refusal_names_the_condition_and_its_route(flag_on):
    """R-701 §3 RESTORED THIS OBLIGATION AFTER THE EXTERNAL CHANNEL DROPPED IT FROM ITS OWN
    list: *the refusal names the affected condition*. An alarm without an address is a
    worse instrument than no alarm, because it reads as diagnosed."""
    with pytest.raises(ValueError) as exc:
        _run("WAIT_STRUCTURE", "market structure", TAUGHT)
    message = str(exc.value)
    assert "c1" in message
    assert "structure_engine.compute_structure_state" in message, (
        "the refusal must name the ROUTE too -- 'some condition refused' does not tell a "
        "reader which handler could not honour the parameter"
    )


def test_invalidation_bindings_are_covered_by_the_same_guard(flag_on):
    """R-703 §1's REAL CATCH, AND IT WAS NOT IN R-702 §6.

    Invalidation bindings share this dispatcher, and Lane 27's flag-OFF guard already
    iterates `(*bindings, *invalidation_bindings)` -- so they CAN carry parameters and
    nothing had ever checked what their handlers do with them. A guard that covered only
    the spine would have left the invalidation half in exactly the pre-Lane-28 state.
    """
    with pytest.raises(ValueError, match=REFUSAL) as exc:
        _run("WAIT_STRUCTURE", "market structure", TAUGHT, target="v1", invalidation=True)
    print(f"\n[INVALIDATION] {exc.value}")
    assert "v1" in str(exc.value), "the invalidation binding must be named"


# ══ 2. THE POSITIVE CONTROLS — THE HALF THAT CATCHES A PLAUSIBLE BAD FIX ═══════════════

def test_wait_bias_still_consumes_and_is_the_positive_control(flag_on):
    """POSITIVE CONTROL, AND IT IS THE ONE THAT MATTERS: a repair that reddened the one
    working channel would satisfy every refusal test above and have destroyed the
    consumption Lane 21 certified. `A CONTROL MUST DISCRIMINATE.`"""
    ctype, obj = CONSUMING_ROUTE
    plain = _run(ctype, obj, None).last_per_condition_bool["c1"]
    taught = _run(ctype, obj, TAUGHT).last_per_condition_bool["c1"]
    differing = int(np.sum(plain != taught))
    print(f"\n[{ctype}] consumed: taught arm differs on {differing}/{len(plain)} bars")
    assert differing > 0, (
        "WAIT_BIAS no longer consumes its taught periods. The Lane 28 guard has swallowed "
        "the one route that was working, which is a worse defect than the one it repairs."
    )


def test_distinct_parameters_remain_independently_cached(flag_on):
    """R-703 §1 ADDED THIS CONTROL AND IT WOULD HAVE CAUGHT THE PLAUSIBLE BAD FIX.

    The naive repair for F-A is *"stop keying caches on b.parameters"*. It fixes the
    finding and silently collapses `_h_wait_bias`'s LEGITIMATE per-parameter caching into
    one slot -- returning the first arm's answer for the second. That is a new
    silent-substitution defect introduced by the fix for a silent-substitution defect.

    Two WAIT_BIAS conditions in ONE plan, different taught periods, must produce DIFFERENT
    arrays. If they are ever equal, the cache is shared and one arm's teaching was lost.
    """
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "armA", "type": "WAIT_BIAS", "object": "bullish trend", "role": "spine"},
            {"id": "armB", "type": "WAIT_BIAS", "object": "bullish trend", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    plan = _apply(plan, "armA", TAUGHT, None)
    plan = _apply(plan, "armB", TAUGHT_B, None)
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane28"}, symbol="MES", timeframe="15m", binding_plan=plan
    )
    strat.compute(_df())
    a = strat.last_per_condition_bool["armA"]
    b = strat.last_per_condition_bool["armB"]
    differing = int(np.sum(a != b))
    print(f"\n[CACHE INDEPENDENCE] armA{TAUGHT} vs armB{TAUGHT_B}: "
          f"differ on {differing}/{len(a)} bars")
    assert differing > 0, (
        f"armA and armB produced IDENTICAL arrays despite different taught periods "
        f"({TAUGHT} vs {TAUGHT_B}). The per-parameter cache has collapsed into one slot "
        f"and one arm is being served the other's answer -- a silent substitution "
        f"introduced by the guard, which is the failure R-703 §1 named in advance."
    )


# ══ 3. CLOSE THE CLASS, NOT THE FIVE — THE MANDATORY TAXONOMY (R-703 §1) ═══════════════

def test_every_reachable_handler_is_classified_exactly_once(flag_on):
    """`NO HANDLER MAY REMAIN IN AN UNCLASSIFIED STATE` (R-703 §1).

    Coverage is asserted in BOTH directions against the dispatcher's own values, so a
    handler added without a classification goes RED here rather than defaulting silently.
    """
    routed = set(ENFORCED_DISPATCH.values())
    classified = set(HANDLER_PARAMETER_CLASSIFICATION)
    assert classified == routed, (
        f"classification and dispatch disagree. UNCLASSIFIED (routed, not classified): "
        f"{sorted(routed - classified)}. STALE (classified, not routed): "
        f"{sorted(classified - routed)}."
    )
    valid = {
        CONSUMES_SUPPORTED_PARAMETERS,
        REFUSES_ALL_PARAMETERS,
        PARAMETERLESS_BY_CONTRACT,
        ENVIRONMENT_GATED_UNVERIFIED,
    }
    bad = {h: c for h, c in HANDLER_PARAMETER_CLASSIFICATION.items() if c not in valid}
    assert not bad, f"handlers carry a category outside the adopted taxonomy: {bad}"

    print("\n[TAXONOMY] every handler reachable through the enforced dispatcher:")
    for category in sorted(valid):
        members = sorted(h for h, c in HANDLER_PARAMETER_CLASSIFICATION.items() if c == category)
        print(f"  {category} ({len(members)}):")
        for m in members:
            print(f"    {m}")


def test_census_every_non_consuming_handler_actually_refuses(flag_on):
    """THE CENSUS, BY MEMBER, EXERCISED — not merely declared.

    R-702 §6 ordered the class closed rather than the five instances, and named what the
    grade had NOT probed: the env-gated experiment primitives and `_h_session`. Those are
    unreachable from any spec this repo builds, so the primitive is overridden directly --
    the guard is a pure function of (parameters, primitive) and runs before `ctx` exists,
    so no market data has to reach the handler for the property to be decidable.

    `A PINNED POPULATION IS NOT A CHECK ON THAT POPULATION` -- this is the check.
    """
    refusing, consuming = [], []
    for primitive, handler in sorted(ENFORCED_DISPATCH.items()):
        if handler in PARAMETER_CONSUMING_HANDLERS:
            consuming.append(f"{primitive} -> {handler}")
            continue
        with pytest.raises(ValueError, match=REFUSAL):
            _run("WAIT_BIAS", "bullish trend", TAUGHT, primitive=primitive)
        refusing.append(f"{primitive} -> {handler} [{HANDLER_PARAMETER_CLASSIFICATION[handler]}]")

    print(f"\n[CENSUS] {len(ENFORCED_DISPATCH)} routed primitives, "
          f"{len(set(ENFORCED_DISPATCH.values()))} distinct handlers")
    print("  REFUSING, each exercised:")
    for row in refusing:
        print(f"    {row}")
    print("  CONSUMING (allowlisted, proven by differing output above):")
    for row in consuming:
        print(f"    {row}")
    assert refusing, "POSITIVE WITNESS: the census must actually have exercised routes"
    assert len(refusing) == len(ENFORCED_DISPATCH) - len(consuming)


def test_an_unrouted_primitive_also_refuses(flag_on):
    """FAIL-CLOSED ON THE UNKNOWN. A primitive absent from ENFORCED_DISPATCH resolves to no
    handler at all, so it cannot be in the allowlist and must refuse. A guard that passed
    the unrecognised case would be `treats UNRECOGNISED as ABSENT` (F-2) rebuilt one layer
    up -- the same taxonomy-with-no-residual defect, in the dispatcher instead of the
    period resolver."""
    with pytest.raises(ValueError, match=REFUSAL):
        _run("WAIT_BIAS", "bullish trend", TAUGHT, primitive="not.a.real.primitive")


def test_the_consuming_allowlist_is_derived_and_earns_its_membership():
    """THE CHECK THAT MAKES THE ALLOWLIST EXPENSIVE TO EXTEND.

    Membership is a CLAIM that the handler passes parameters into its real evaluator.
    Anyone adding a name must make this file prove it with a differing-output witness, or
    the entry is exactly the unverified declaration this lane exists to delete.
    """
    assert PARAMETER_CONSUMING_HANDLERS == frozenset(
        h for h, c in HANDLER_PARAMETER_CLASSIFICATION.items()
        if c == CONSUMES_SUPPORTED_PARAMETERS
    ), "the allowlist must stay DERIVED from the classification; two hand-kept lists drift"
    assert PARAMETER_CONSUMING_HANDLERS == frozenset({"_h_wait_bias"}), (
        "the consuming set changed. Add that route's own differing-output AND "
        "cache-independence witnesses to this file in the same commit -- membership "
        "without them is a declaration, not evidence."
    )


# ══ 4. THE LEGACY CONTROLS — THIS REPAIR MUST NOT MOVE THEM ════════════════════════════

@pytest.mark.parametrize(("ctype", "obj"), (*GRADED_ROUTES, CONSUMING_ROUTE))
def test_parameterless_bindings_are_untouched_under_enforcement(flag_on, ctype, obj):
    """Every binding this repo builds today carries `parameters=None` (Lane 27's census,
    re-derived at R-702 §5 by runtime instrumentation over 21,663 real bindings, 0
    parameterized). A refusal that fired here would break production on the spot."""
    strat = _run(ctype, obj, None)
    assert "c1" in strat.last_per_condition_bool


@pytest.mark.parametrize(("ctype", "obj"), GRADED_ROUTES)
def test_flag_off_still_refuses_via_lane_27(flag_off, ctype, obj):
    """THE `EITHER FLAG STATE` HALF OF THE INVARIANT. Lane 27 covers OFF, Lane 28 covers
    ON; this asserts the OFF half did not regress, so the two guards together leave no
    state in which a parameter is accepted and dropped."""
    with pytest.raises(ValueError, match=LANE_27_REFUSAL):
        _run(ctype, obj, TAUGHT)


def test_mutation_control_the_defect_reproduces_when_parameters_are_stripped(flag_on):
    """MUTATION CONTROL: express the pre-repair behaviour exactly -- strip the parameters
    the guard keys on -- and the accept-and-discard shape must come back, identical arms
    and no refusal. If this ever goes red, the refusal tests above are proving something
    other than what they claim."""
    ctype, obj = GRADED_ROUTES[0]
    spec = _spec(ctype, obj)
    plan = compile_binding_plan(spec)
    plan.bindings[:] = [dataclasses.replace(b, parameters=None) for b in plan.bindings]
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane28"}, symbol="MES", timeframe="15m", binding_plan=plan
    )
    strat.compute(_df())                       # must NOT raise: the plant removed the signal
    stripped = strat.last_per_condition_bool["c1"]
    plain = _run(ctype, obj, None).last_per_condition_bool["c1"]
    differing = int(np.sum(stripped != plain))
    print(f"\n[MUTATION CONTROL] stripped arm differs from the plain arm on "
          f"{differing}/{len(plain)} bars (must be 0 -- this IS the discarded shape)")
    assert differing == 0, (
        "MUTATION CONTROL DEAD: stripping the parameters changed the answer, so the "
        "refusals above are not testing accept-and-discard."
    )
