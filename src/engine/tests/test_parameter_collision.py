"""Parameter collision — RE-HOMED TO THE CONSUMING ROUTE BY R-704 §3.

WHAT HAPPENED TO THIS FILE, AND WHY IT IS NOT A WEAKENING
    This file was built (R-679 §2, R-681 §5) to red-proof a real defect: the per-family
    evaluation cache was keyed by FAMILY, not by parameters, so the SECOND condition of a
    family silently received the FIRST condition's array. That defect was real and the
    repair was real.

    But it proved the property on `_h_structure`, and it could only do so by
    MONKEYPATCHING a period-consuming evaluator into `_eval_wait_structure` -- whose real
    signature is `(self, n, df)` and cannot accept a period at all. So the fixture supplied
    the very capability production lacks and then asserted production had it.
    `A TEST THAT MONKEYPATCHES IN THE BEHAVIOUR IT VERIFIES IS A MIRROR, NOT AN INSTRUMENT.`

    Lane 28 (R-702 §6 / R-703 §1) then made the contradiction explicit: no route may accept
    a parameter it does not consume, and `A PARAMETER IS NOT CONSUMED MERELY BECAUSE IT
    CHANGES THE CACHE KEY`. Those two statements cannot both hold for `_h_structure`.
    R-704 §2 ruled: consume-or-refuse applies, no exemption, and the older property
    SURVIVES BUT MOVES -- "different semantic parameter sets must not share one cached
    result" is a property OF A ROUTE THAT CONSUMES THEM.

OLD PROPERTY -> NEW PROPERTY (R-704 §3 requires this table BEFORE any test is edited)
    | old (on _h_structure, monkeypatched)      | new (on _h_wait_bias, spy-free)          |
    |-------------------------------------------|------------------------------------------|
    | both conditions reach the handler with    | both parameterized conditions reach the  |
    | their own period (probe list)             | REAL evaluator, each output matching an  |
    |                                           | INDEPENDENT recomputation of its OWN     |
    |                                           | taught periods                           |
    | two different periods must evaluate       | two OFF-DEFAULT canonical parameter      |
    | differently                               | objects differ AND each equals its own   |
    |                                           | recomputation -- differing because       |
    |                                           | CONSUMED, not because a key changed      |
    | identical periods share one computation   | unchanged in meaning; counted on the     |
    |                                           | REAL `_eval_wait_bias`, by a counter     |
    |                                           | that DELEGATES and computes nothing      |
    | reversing order changes the shared value  | INVERTED PER R-704 §3.4: reversing       |
    | (assertion already checked invariance,    | declaration order must not change EITHER |
    | and only for one of the two arms)         | condition's result -- both arms checked  |
    | (none)                                    | NEW, MANDATORY: `_h_structure` refuses a |
    |                                           | parameterized binding BEFORE evaluation  |
    |                                           | and BEFORE cache mutation                |

    Per R-704 §3's emphasis -- "DO NOT SIMPLY CHANGE `WAIT_STRUCTURE` TO `WAIT_BIAS`
    WITHOUT VERIFYING THAT EACH TEST STILL WITNESSES ITS STATED PROPERTY" -- every
    re-homed test below asserts against an INDEPENDENT recomputation rather than against
    "the arrays differ", so a test that passes for a new reason is not silently accepted.
    `A RE-HOMED TEST THAT PASSES FOR A NEW REASON IS A TEST YOU HAVE SILENTLY DELETED.`

WHAT NO LONGER HAPPENS HERE
    Nothing monkeypatches period semantics into `_eval_wait_structure` (R-704 §3, first
    bullet). The only patch remaining is a CALL COUNTER that delegates to the real
    evaluator and computes nothing -- it observes how often production ran, never what
    production returned.

STILL NOT A COMPILER PASS. It proves one cache honours one parameter. Nothing about
educator fidelity, and nothing about the parameter grammar (reserved: R-678 §6).
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from src.engine.family_meta_enforcement import FLAG_ENV
from src.engine.spec_condition_compiler import (
    BIAS_EMA_FAST,
    BIAS_EMA_SLOW,
    SpecConditionStrategy,
)
from src.engine.spec_family_bindings import ConditionBinding, compile_binding_plan
from src.engine.tests.test_bias_refusal_surface import _df, _ema_cross

# TWO CANONICAL PARAMETER OBJECTS, BOTH OFF-DEFAULT IN BOTH LEGS (R-704 §3.2 requires
# off-default values: a taught period equal to the engine default cannot distinguish
# "consumed the teaching" from "fell back to the default").
ARM_A = {"fast_period": 7, "slow_period": 90}
ARM_B = {"fast_period": 12, "slow_period": 30}
assert BIAS_EMA_FAST not in (ARM_A["fast_period"], ARM_B["fast_period"])
assert BIAS_EMA_SLOW not in (ARM_A["slow_period"], ARM_B["slow_period"])

N_BARS = 200


@pytest.fixture
def flag_on(monkeypatch):
    """EXPLICIT, NEVER INHERITED (R-697 §5.7). The enforced dispatcher is the only path on
    which a binding reaches `_h_wait_bias` at all."""
    monkeypatch.setenv(FLAG_ENV, "true")


@pytest.fixture
def count_real_bias_evaluations(monkeypatch):
    """A CALL COUNTER, NOT AN EVALUATOR.

    It delegates to the unmodified `_eval_wait_bias` and returns whatever production
    returns; it fabricates no semantics and replaces no calculation. That distinction is
    the whole reason this file was reconciled: the fixture it replaces INVENTED a
    period-consuming evaluator and then asserted production had one.
    """
    original = SpecConditionStrategy._eval_wait_bias
    calls: list = []

    def counting(self, *args, **kwargs):
        calls.append((args, tuple(sorted(kwargs.items()))))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(SpecConditionStrategy, "_eval_wait_bias", counting)
    return calls


@pytest.fixture
def count_real_structure_evaluations(monkeypatch):
    """Same contract, aimed at `_eval_wait_structure`, for the mandatory negative test:
    it answers "did the evaluator run at all?" without changing what it computes."""
    original = SpecConditionStrategy._eval_wait_structure
    calls: list = []

    def counting(self, *args, **kwargs):
        calls.append(True)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(SpecConditionStrategy, "_eval_wait_structure", counting)
    return calls


def _spec(ids: tuple[str, ...], ctype: str = "WAIT_BIAS", obj: str = "bullish trend") -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            *[{"id": cid, "type": ctype, "object": obj, "role": "spine"} for cid in ids],
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def _plan_with_parameters(spec: dict, params: dict[str, dict]):
    """Populate ConditionBinding.parameters — ONLY here, never in production code.

    R-702 §5 re-derived that fact at runtime over 21,663 real bindings: 0 parameterized.
    """
    plan = compile_binding_plan(spec)
    for i, b in enumerate(plan.bindings):
        if b.condition_id in params:
            plan.bindings[i] = dataclasses.replace(
                b, parameters=tuple(sorted(params[b.condition_id].items()))
            )
    return plan


def _run(spec: dict, params: dict[str, dict]) -> SpecConditionStrategy:
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "collisiontest"},
        symbol="MES",
        timeframe="15m",
        binding_plan=_plan_with_parameters(spec, params),
    )
    strat.compute(_df())
    return strat


# ─── POSITIVE CONTROL ──────────────────────────────────────────────────────────────────────

def test_the_two_parameter_objects_actually_produce_different_signals():
    """Without this, a 'collision' red could merely mean the two parameter objects make no
    difference. Prints its VALUE — a control that returns zero has not passed, it has not
    run (R-675 §1)."""
    df = _df()
    a = _ema_cross(df, ARM_A["fast_period"], ARM_A["slow_period"])
    b = _ema_cross(df, ARM_B["fast_period"], ARM_B["slow_period"])
    differing = int(np.sum(a != b))
    print(f"\n[POSITIVE CONTROL] EMA{tuple(ARM_A.values())} vs EMA{tuple(ARM_B.values())} "
          f"differ on {differing} of {N_BARS} bars")
    assert differing > 0, (
        "CONTROL DEAD: the two parameter objects produce identical signals, so any "
        "collision result below would be meaningless."
    )


def test_both_parameterized_conditions_reach_the_real_consuming_evaluator(flag_on):
    """RE-HOMED FROM `test_both_conditions_are_actually_dispatched` (R-704 §3.1).

    Positive witness that the path RAN, and a stronger one than the probe list it
    replaces: each condition's output is compared against an INDEPENDENT recomputation of
    its OWN taught periods. 'They got the same array' is also satisfied by 'neither was
    ever evaluated' — matching two different independent recomputations is not.
    SPY-FREE: nothing is patched in this test.
    """
    strat = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B})
    assert set(strat.last_per_condition_bool) >= {"armA", "armB"}
    df = _df()
    for cid, params in (("armA", ARM_A), ("armB", ARM_B)):
        produced = strat.last_per_condition_bool[cid]
        expected = _ema_cross(df, params["fast_period"], params["slow_period"])
        off_default = int(np.sum(produced != _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)))
        print(f"\n[EXECUTION WITNESS] {cid} matches EMA{tuple(params.values())} and differs "
              f"from the engine default on {off_default}/{len(produced)} bars")
        assert np.array_equal(produced, expected), (
            f"{cid} did not receive its own taught periods {params}"
        )
        assert off_default > 0, (
            f"{cid} is byte-identical to the engine-default answer, so this witness cannot "
            f"tell 'consumed the teaching' from 'fell back to the default'"
        )


# ─── THE RED ───────────────────────────────────────────────────────────────────────────────

def test_two_same_family_conditions_with_different_periods_must_evaluate_differently(flag_on):
    """R-681 §5(4) proof form 1, re-homed to the consuming route (R-704 §3.2).

    R-704 §3.2 is explicit about what this must witness: "The result must differ because
    the evaluator CONSUMED different periods, not merely because the cache key changed."
    So differing is asserted AND each arm is pinned to its own independent recomputation.
    """
    strat = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B})
    a = strat.last_per_condition_bool["armA"]
    b = strat.last_per_condition_bool["armB"]
    identical = int(np.sum(a == b))
    assert not np.array_equal(a, b), (
        f"PARAMETER COLLISION: two WAIT_BIAS conditions taught {ARM_A} and {ARM_B} received "
        f"IDENTICAL arrays ({identical}/{len(a)} bars equal). The second condition never "
        f"recomputed — the cache handed it the first condition's value."
    )
    df = _df()
    assert np.array_equal(a, _ema_cross(df, ARM_A["fast_period"], ARM_A["slow_period"]))
    assert np.array_equal(b, _ema_cross(df, ARM_B["fast_period"], ARM_B["slow_period"]))


def test_identical_periods_still_share_one_computation(flag_on, count_real_bias_evaluations):
    """R-679 §4c, explicitly NOT optional: caching must still HAPPEN.

    Two conditions teaching the SAME parameter object must be computed once, not twice.
    Without this, 'delete the cache entirely' passes every other test in this file and
    ships a performance regression wearing a correctness fix's clothes. Green before AND
    after by design — it constrains the SHAPE of the repair, not its result.
    """
    strat = _run(_spec(("a", "b")), {"a": ARM_A, "b": ARM_A})
    print(f"\n[REUSE GUARD] real _eval_wait_bias invocations for two identical "
          f"{ARM_A} conditions: {len(count_real_bias_evaluations)}")
    assert len(count_real_bias_evaluations) == 1, (
        f"two conditions with the SAME taught parameters must share one computation; the "
        f"evaluator ran {len(count_real_bias_evaluations)} times — the cache was removed "
        f"rather than re-keyed"
    )
    assert np.array_equal(
        strat.last_per_condition_bool["a"], strat.last_per_condition_bool["b"]
    ), "identical parameters must yield identical arrays"


def test_reversing_declaration_order_does_not_change_either_result(flag_on):
    """INVERTED BY R-704 §3.4, DELIBERATELY, AND THE OLD NAME WAS THE PROBLEM.

    The old test was called `..._changes_the_shared_value` while its assertion checked the
    OPPOSITE (that the value was unchanged), and it checked only ONE of the two arms.
    R-704 §3.4: "do NOT preserve an assertion that production order-dependence is
    acceptable" — the property is that reversing declaration order must not change EITHER
    condition's parameter-specific result. Both arms are now checked.
    """
    forward = _run(_spec(("armA", "armB")), {"armA": ARM_A, "armB": ARM_B})
    reversed_ = _run(_spec(("armB", "armA")), {"armA": ARM_A, "armB": ARM_B})
    for cid in ("armA", "armB"):
        assert np.array_equal(
            forward.last_per_condition_bool[cid], reversed_.last_per_condition_bool[cid]
        ), (
            f"ORDER DEPENDENCE: {cid}'s value changed when its declaration position moved. "
            f"Its own taught parameters did not change — only its position did, which means "
            f"it is receiving whatever a sibling computed."
        )


# ─── THE MANDATORY NEGATIVE TEST FOR `_h_structure` (R-704 §3) ─────────────────────────────

def test_h_structure_refuses_parameters_before_evaluation_and_cache_mutation(
    flag_on, count_real_structure_evaluations
):
    """MANDATORY, PERMANENT, PRODUCTION-PATH (R-704 §3): flag ON · WAIT_STRUCTURE · any
    non-empty parameter set · refusal BEFORE evaluation AND cache mutation.

    THE ORDERING IS WITNESSED BY EXECUTION, NOT BY A POST-RUN FIELD. R-702 §3 convicted the
    previous ordering fixture for reading `last_per_condition_bool`, which `compute()`
    publishes only at its END and therefore reads `{}` however much already ran.
    `A POST-RUN PUBLICATION FIELD CANNOT PROVE WHEN AN EVENT OCCURRED DURING THE RUN.`
    Here the counter records real invocations of `_eval_wait_structure` as they happen, and
    the POSITIVE CONTROL below proves the counter can record — otherwise "it never ran" is
    equally satisfied by a counter that never works.
    """
    with pytest.raises(ValueError, match="parameter_supplied_to_non_consuming_route") as exc:
        _run(_spec(("s1",), ctype="WAIT_STRUCTURE", obj="market structure"), {"s1": ARM_A})
    message = str(exc.value)
    print(f"\n[MANDATORY NEGATIVE] {message}")
    assert "s1" in message, "the refusal must name the condition (R-701 §3)"
    assert "fast_period" in message and "slow_period" in message, (
        "R-704 §4(A): the refusal must name the UNSUPPORTED PARAMETER KEYS, not only the "
        f"condition and route. Got: {message}"
    )
    assert count_real_structure_evaluations == [], (
        f"the refusal fired AFTER the evaluator ran ({len(count_real_structure_evaluations)} "
        f"invocations). It must precede every evaluator and cache write."
    )


def test_positive_control_the_structure_evaluator_does_run_without_parameters(
    flag_on, count_real_structure_evaluations
):
    """THE WITNESS THAT MAKES THE NEGATIVE ABOVE MEAN SOMETHING. A parameterless
    WAIT_STRUCTURE condition must actually reach `_eval_wait_structure`, so "zero
    invocations" in the test above is a measured absence rather than a broken counter.
    `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.`"""
    _run(_spec(("s1",), ctype="WAIT_STRUCTURE", obj="market structure"), {})
    print(f"\n[POSITIVE CONTROL] real _eval_wait_structure invocations without parameters: "
          f"{len(count_real_structure_evaluations)}")
    assert count_real_structure_evaluations, (
        "the counter recorded nothing even on the legacy parameterless path, so it cannot "
        "witness the ordering property above"
    )


# ─────────────────────────────────────────────────────────────────────────────
# R-687 §5 Lane 14 — PERMANENT WITNESS for the F-4 / F-5 repairs (AR-758).
#
# These guards were red-proofed once, in a scratchpad, and R-687 §2 named that
# this desk's own scoping defect: "WHEN YOU SCOPE A REPAIR'S FILES, SCOPE ITS
# PROOF'S FILES WITH IT — OTHERWISE YOU HAVE ORDERED A GUARD AND FORBIDDEN ITS
# WITNESS." A red path proven only in a transcript decays unwitnessed (R-681 §2).
#
# The oracle here asserts OBSERVABLE BEHAVIOUR (does construction raise? is the
# key present?) and deliberately does NOT restate production's logic — a test
# that reimplements the rule it checks agrees with itself, not with the code.
# ─────────────────────────────────────────────────────────────────────────────

def _binding(**overrides) -> ConditionBinding:
    base = dict(
        condition_id="c0", type="WAIT_STRUCTURE", role="entry", object="bos",
        bindable=True, primitive="structure", approximation=False, executed=True,
    )
    base.update(overrides)
    return ConditionBinding(**base)


def test_f4_unhashable_parameter_is_refused_at_construction():
    """F-4: `object` admitted list/dict/set. Construction succeeded and the
    TypeError surfaced deep inside compute(), far from the caller who chose the
    value. The refusal must happen at the boundary."""
    with pytest.raises(TypeError):
        _binding(parameters=(("levels", [1, 2]),))


def test_f4_the_refusal_names_the_offending_key():
    """A refusal that does not say WHICH key is a refusal the caller cannot act
    on — the whole cost of the deferred failure was that it named nothing."""
    with pytest.raises(TypeError) as exc:
        _binding(parameters=(("levels", [1, 2]), ("period", 20)))
    assert "levels" in str(exc.value), (
        f"the error must name the unhashable key; got: {exc.value!r}"
    )


def test_f4_positive_control_hashable_parameters_still_construct_and_hash():
    """Discriminates 'refuses unhashable' from 'refuses everything'. Without
    this, deleting the field entirely would pass the two tests above."""
    b = _binding(parameters=(("period", 20), ("source", "close")))
    hash(b)  # frozen dataclass must stay hashable — this is the invariant F-4 protects
    assert b.parameters == (("period", 20), ("source", "close"))


def test_f5_empty_tuple_serialises_identically_to_absent():
    """F-5: the caption said OMIT-WHEN-EMPTY, the predicate said `is not None`.
    `()` — the natural encoding for "the producer looked and found none" — added
    a key to every binding, which is AR-739 §1's 0-vs-18 re-seal hazard."""
    empty = _binding(parameters=()).to_dict()
    absent = _binding(parameters=None).to_dict()
    assert empty == absent, (
        f"parameters=() emitted {empty.get('parameters')!r}; an empty parameter set "
        "must serialise byte-identically to a binding that predates the field"
    )
    assert "parameters" not in empty


def test_f5_positive_control_populated_parameters_still_serialise():
    """Discriminates 'omits when empty' from 'omits always' — the mutation that
    would satisfy the test above by deleting the branch."""
    out = _binding(parameters=(("period", 20),)).to_dict()
    assert out["parameters"] == {"period": 20}
