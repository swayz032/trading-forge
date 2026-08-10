"""TRIGGER SAFETY — the golden breakout is refused, and the refusal BLOCKS EXECUTION.

AUTHORITY: `R-746 §3` · `R-747 §3` (the six-step mutation) · `R-747 §4` (load-bearing
eligibility) · `R-747 §6`.

WHAT THIS FILE EXISTS TO STOP
-----------------------------
`AR-842 §2` measured the golden strategy's entry trigger — *"when price breaks above the
range high"* — bound to `structure_engine.compute_structure_state`, a primitive whose own
handler docstring says the OBJECT text *"is not checked — only generic BOS/CHoCH/MSS
activity."* The strategy traded on it: `entry_short = 7`.

`AR-843` then measured the thing that makes the naive fix dangerous: **unbinding the trigger
leaves those seven entries EXACTLY UNCHANGED** while the gating set drops `3 → 2`.

    `A REFUSAL THAT WORKS BY REMOVING A CONSTRAINT IS NOT A REFUSAL — IT IS A RELAXATION
     WEARING A REFUSAL'S NAME.`

So there are TWO halves and each is useless alone: the binding must be REFUSED, and the
refusal must be CONSUMED at a strategy-level boundary. `test_six_step_mutation_sequence`
below is the control that proves both, by turning each half off and requiring the seven
phantom entries to come back.

WHY THE OLD LOCALITY CONTROL IS NOT HERE
----------------------------------------
`R-746 §3` originally ordered a mutation that RESTORED the generic structure binding and
required nonzero entries. `R-747 §3` WITHDREW it as measured-dead: `AR-843` proved the
trigger is non-discriminating on this fixture, so restoring it changes nothing and the
mutation would pass whatever the code did.

    `A GLOBALLY RESPONSIVE SYSTEM DOES NOT VALIDATE A LOCALLY NULL EXPERIMENT.` (`R-726 §1`)

The six-step sequence replaces it because it mutates the ELIGIBILITY CONSUMER — something
`AR-843` measured CAN move the output.
"""

from __future__ import annotations

import dataclasses
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from src.engine import spec_family_bindings as sfb
from src.engine.breakout_confirmation_ambiguity import (
    AMBIGUITY_BREAKOUT_CONFIRMATION,
    REASON_BREAKOUT_CONFIRMATION_UNRESOLVED,
    BreakoutAmbiguityVerdict,
    classify_breakout_confirmation_ambiguity,
)
from src.engine.extraction.spec_producer import (
    produce_spec_artifact,
    produce_spec_artifact_from_record,
)
from src.engine.spec_condition_compiler import (
    EXECUTION_STATUS_EXECUTED,
    EXECUTION_STATUS_REFUSED,
    TRACE_OUTCOME_ENTRIES_PRESENT,
    TRACE_OUTCOME_EXECUTION_REFUSED,
    TRACE_OUTCOME_INSUFFICIENT_BARS,
    TRACE_OUTCOME_NO_MARKET_SETUP,
    TRACE_RECORD_ENTRY_BAR,
    TRACE_RECORD_EXECUTION_SUMMARY,
    SpecConditionStrategy,
)
from src.engine.spec_family_bindings import compile_binding_plan

GOLDEN_EXTRACTION = Path(
    "docs/replay-results/h1-battery/tier-a-extraction-provenance/st5e-YJRfKc__s0.json"
)

# THE DETERMINISTIC FIXTURE. Pinned exactly as AR-843 ran it, because the seven firing bars
# below are only meaningful against these candles. NOTHING HERE MAY BE TUNED: R-747 §4
# forbids changing the fixture until no setup appears, which would convert a real refusal
# into a fixture that never had anything to refuse.
N_BARS = 400
SEED = 7
TIMEFRAME = "5m"

NEIGHBOUR_TEXT = (
    "After the first break of structure, price performs a healthy pullback and then forms "
    "another break of structure, further confirming the trend"
)


def _frame() -> pl.DataFrame:
    rng = np.random.default_rng(SEED)
    close = 100 + np.cumsum(rng.normal(0, 0.5, N_BARS))
    return pl.DataFrame(
        {
            "open": close + rng.normal(0, 0.3, N_BARS),
            "high": close + rng.uniform(0.1, 1.5, N_BARS),
            "low": close - rng.uniform(0.1, 1.5, N_BARS),
            "close": close,
            "ts_event": [
                datetime(2026, 1, 5, 14, 30, tzinfo=UTC) + timedelta(minutes=5 * i)
                for i in range(N_BARS)
            ],
            "volume": [100] * N_BARS,
        }
    )


def _golden_spec() -> dict:
    doc = json.loads(GOLDEN_EXTRACTION.read_text(encoding="utf-8"))
    art = produce_spec_artifact(
        doc["strategies"][0], video="st5e-YJRfKc__s0", certificate=None, transcript_chars=0
    )
    return art["spec"]


def _neighbour_spec() -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": NEIGHBOUR_TEXT, "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


# ─────────────────────────────────────────────────────────────────────────────────────────
# CANDIDATE-AWARE CONSTRUCTION (S6 EXECUTION ACTIVATION, authorized at R-785 §6-4)
#
# The golden record's opening-range condition is now ACTIVATED, so an execution instance
# must be told WHICH taught window it runs or it refuses at the adapter boundary. That
# refusal is correct and is proven elsewhere; here it would simply mask the trigger-safety
# property these fixtures exist to measure.
#
# 🛑 FIXTURE TRANSITION ONLY. NOT ONE SAFETY ASSERTION BELOW IS TOUCHED, and no production
# default is created — the wiring lives here, in the test's own setup.
#
# 🛑 SELECTION IS BY AN EXPLICIT TAUGHT DURATION, NEVER BY POSITION. `candidates[0]` would
# read identically today and would silently follow taught order if it ever changed:
#
#     `AN INDEX IS A SILENT DEFAULT WEARING A TEST'S CLOTHES.`
#
# The 5m window drives the matrix for cost, and
# `test_control_the_trigger_refusal_is_not_specific_to_one_taught_window` runs the same
# safety property across ALL THREE taught candidates so this choice cannot hide a
# duration-specific result.
# ─────────────────────────────────────────────────────────────────────────────────────────
_SAFETY_MATRIX_WINDOW_MINUTES = 5


def _taught_candidates() -> tuple:
    """The golden record's taught execution candidates, through the REAL full-record
    boundary — never hand-built, so a change in what the source teaches reaches here."""
    doc = json.loads(GOLDEN_EXTRACTION.read_text(encoding="utf-8"))
    return produce_spec_artifact_from_record(doc, video="st5e-YJRfKc__s0").opening_range_candidates


def _candidate_for(plan, duration_minutes: int = _SAFETY_MATRIX_WINDOW_MINUTES):
    """The taught candidate for THIS plan, chosen by DURATION, or None if the plan has no
    opening-range condition at all (the neighbour spec, which must stay candidate-free)."""
    if not any(b.type == "OPENING_RANGE_DEFINITION" for b in plan.bindings):
        return None
    matching = [c for c in _taught_candidates() if c.variant.duration_minutes == duration_minutes]
    assert len(matching) == 1, (
        f"expected exactly one taught {duration_minutes}m window, found {len(matching)}; "
        "the fixture's explicit selection no longer identifies a unique taught alternative"
    )
    return matching[0]


def _run(
    spec: dict, duration_minutes: int = _SAFETY_MATRIX_WINDOW_MINUTES
) -> tuple[SpecConditionStrategy, pl.DataFrame]:
    plan = compile_binding_plan(spec)
    strategy = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "trigger-safety"},
        symbol="MES",
        timeframe=TIMEFRAME,
        binding_plan=plan,
        opening_range_candidate=_candidate_for(plan, duration_minutes),
    )
    return strategy, strategy.compute(_frame())


def _short_bars(out: pl.DataFrame) -> tuple[int, ...]:
    """The EXACT firing bar indices, not merely how many.

    `R-747 §3` says *"the exact seven firing bars"*. A count can be reproduced by a different
    seven bars, and a mutation control that only counts cannot tell a restored defect from a
    coincidentally equal one.
    """
    return tuple(int(i) for i in np.flatnonzero(out["entry_short"].to_numpy()))


# ─────────────────────────────────────────────────────────────────────────────────────────
# THE DEFECTIVE ROUTE'S POPULATION, AND THE RULE THAT PRODUCES IT (R-787 §4)
#
# This was `== 7` and it is now an exact six-member tuple PLUS the semantic rule beside it.
# `DAILY-RESET-1` removed bar 230 — a 2026-01-06 04:40 America/New_York entry gated by the
# PREVIOUS session's completed opening range, 4h55m before that day's own 09:35 lock. It was
# never an eligible entry, so the trigger-refusal property is unchanged at six.
#
#     `PAIR EVERY DETERMINISTIC POPULATION WITH THE SEMANTIC RULE THAT PRODUCED IT — THE
#      TUPLE CATCHES DRIFT, THE RULE EXPLAINS IT, AND A TUPLE ALONE JUST BECOMES THE NEXT
#      STALE NUMBER.`
# ─────────────────────────────────────────────────────────────────────────────────────────
_DEFECTIVE_ROUTE_BARS = (30, 60, 110, 160, 300, 380)
_DAILY_RESET_CARRYOVER_BAR = 230


def _assert_every_entry_is_at_or_after_its_own_session_lock(strategy, bars) -> None:
    """R-787 §4 clause 6 — the CAUSAL assertion that keeps the tuple above from embalming.

    A hand-copied population is exactly what `== 7` was, and it survived a real defect for a
    commit. This rule is DERIVED FROM THE SPECIFICATION — the taught `session_start_local`
    plus the EXPLICITLY SELECTED candidate's duration, resolved through the adapter's OWN
    `_window_bounds` — so the next time a legitimate repair moves the population, the tuple
    fails loudly and this says WHY.

    🛑 ONE calculator only. This reads the production window helper; it does not reimplement
    the arithmetic, and it does not parse `trading_day_rule` (R-787 §6: the lowering layer is
    the source-evidence parser, and a second reader in a consumer is parser drift).
    """
    from zoneinfo import ZoneInfo

    from src.engine.opening_range_adapter import _window_bounds

    # POSITIVE WITNESS: a per-member rule over an EMPTY population passes vacuously and would
    # read exactly like a satisfied invariant.
    assert bars, "the per-session-lock rule was handed an EMPTY population; it proved nothing"

    candidate = _candidate_for(strategy.binding_plan)
    assert candidate is not None, (
        "no taught candidate on this plan, so the lock below would be unresolvable and this "
        "rule vacuous"
    )
    zone = ZoneInfo(candidate.definition.source_timezone)
    stamps = _frame()["ts_event"].to_list()

    for bar in bars:
        local = stamps[bar].astimezone(zone)
        _start, lock = _window_bounds(candidate.definition, candidate.variant, local.date())
        assert local >= lock, (
            f"bar {bar} fires at {local:%Y-%m-%d %H:%M %Z}, BEFORE its own session's "
            f"{lock:%H:%M} lock for the taught {candidate.variant.duration_minutes}m window. "
            "An entry gated by a range its own trading day has not finished forming is the "
            "DAILY-RESET-1 defect returning."
        )


# ═══════════════════════════════════════════════════════════════════════════════════════
# 1. THE CLASSIFIER — four conditions, ALL required
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_no_strategy_identity_appears_in_the_classification_rule():
    """R-747 §6: no video id, no strategy id, no condition id in production classification.

    Asserted against the module SOURCE, so the rule cannot quietly acquire a lookup table
    later. Two frozen members are then DISCRIMINATING EVIDENCE rather than a hardcoded answer.
    """
    src = Path("src/engine/breakout_confirmation_ambiguity.py").read_text(encoding="utf-8")
    for forbidden in ("st5e-YJRfKc", "dENM6gt8ZRg", "__s0", "#4"):
        assert forbidden not in src, (
            f"{forbidden!r} appears in the classification rule; the refusal must follow from "
            "what the SENTENCE says, or the frozen members stop being evidence"
        )


@pytest.mark.parametrize(
    "text,expected_ambiguous,expected_standdown",
    [
        # Reaches condition (4) and finds NO confirmation -> AMBIGUOUS.
        ("enter when price breaks above the range high", True, None),
        # Reaches (4) and finds explicit confirmation -> stands down THERE.
        ("enter when price breaks above the range high and closes above it", False, "confirmation_specified"),
        ("enter when price breaks above the range high with a wick through the level", False, "confirmation_specified"),
        ("enter when price breaks above the range high and then retests it", False, "confirmation_specified"),
        ("go long when price crosses the opening range high on a 5 minute close", False, "confirmation_specified"),
        # Never reaches (4): no opening-range boundary named at all.
        (NEIGHBOUR_TEXT, False, "references_boundary"),
    ],
)
def test_classifier_discriminates_and_stands_down_at_the_right_condition(
    text, expected_ambiguous, expected_standdown
):
    """The verdict AND the branch that produced it.

    ⚠️ THIS ASSERTION SHAPE EXISTS BECAUSE MY FIRST DISCRIMINATION SET PASSED 6/6 AND PROVED
    LESS THAN IT LOOKED (AR-845 §4). "a candle closes above the range high" stood down at
    `crossing_relationship` — my crossing vocabulary has no "closes above" — so condition (4),
    the branch that protects a CLEARER TEACHER, was never exercised by any passing case.

        `A CONTROL THAT PASSES BY LUCK IS NOT A CONTROL, AND THE ONLY WAY TO TELL WHICH KIND
         YOU WROTE IS TO ASSERT WHICH BRANCH DECIDED.`
    """
    verdict = classify_breakout_confirmation_ambiguity(
        is_entry_trigger=True, text=text, opening_range_defined_in_spec=True
    )
    assert verdict.ambiguous is expected_ambiguous
    if expected_standdown is not None:
        assert verdict.evidence[-1][0] == expected_standdown, (
            f"stood down at {verdict.evidence[-1][0]!r}, expected {expected_standdown!r}; the "
            "right answer for the wrong reason leaves the intended branch untested"
        )
        # THE SPAN IS REQUIRED ONLY WHERE STANDING DOWN MEANS SOMETHING WAS *FOUND*.
        # `confirmation_specified` stands down BECAUSE it matched, so it owes the matched
        # text — that span is what lets a reader check the teacher really did specify.
        # Every other condition stands down because it did NOT match, and its empty span is
        # the correct record of that. Requiring a span everywhere was my own over-assertion
        # and it failed on the neighbour case, correctly.
        if expected_standdown == "confirmation_specified":
            assert verdict.evidence[-1][1], (
                "the confirmation stand-down carries no matched span, so a reader cannot "
                "audit the claim that the teacher specified one"
            )
        else:
            assert verdict.evidence[-1][1] == "", (
                "a condition that did NOT match reported a span; the evidence would then "
                "read as though the missing thing had been found"
            )
    else:
        assert verdict.reason == REASON_BREAKOUT_CONFIRMATION_UNRESOLVED
        assert verdict.ambiguity == AMBIGUITY_BREAKOUT_CONFIRMATION


def test_a_non_trigger_sentence_is_never_claimed():
    """Condition (1). The same taught sentence, not the entry trigger -> untouched."""
    verdict = classify_breakout_confirmation_ambiguity(
        is_entry_trigger=False,
        text="enter when price breaks above the range high",
        opening_range_defined_in_spec=True,
    )
    assert verdict.ambiguous is False
    assert verdict.evidence[-1][0] == "is_entry_trigger"


def test_a_dangling_range_reference_is_a_different_defect_and_is_not_claimed():
    """Condition (2). No opening range is constructed in this spec at all.

    Deliberately NOT claimed: a trigger naming a range high in a spec that never builds one
    is a dangling reference, which is a different finding. `A CLASSIFIER THAT TOUCHES MORE
    THAN IT NAMES IS A MIGRATION WEARING A FIX'S NAME.`
    """
    verdict = classify_breakout_confirmation_ambiguity(
        is_entry_trigger=True,
        text="enter when price breaks above the range high",
        opening_range_defined_in_spec=False,
    )
    assert verdict.ambiguous is False
    assert verdict.evidence[-1][0] == "opening_range_defined_in_spec"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 2. THE BINDING REFUSAL — exact, and it deletes nothing
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_golden_trigger_is_refused_exactly_and_keeps_its_prose():
    """R-746 §3's ordered end state, field by field.

    `REFUSAL IS NOT ABSENCE` (R-747 §2): the condition stays in the plan, in place, carrying
    its taught sentence and its role. If it VANISHED, `A AND B AND broken` would become
    `A AND B` and the new mask could not be stricter.
    """
    spec = _golden_spec()
    plan = compile_binding_plan(spec)
    trigger = next(b for b in plan.bindings if b.condition_id == spec["entry_trigger_id"])

    assert trigger.bindable is False
    assert trigger.executed is False
    assert trigger.primitive is None
    assert trigger.disposition == "SOURCE_AMBIGUOUS"
    assert trigger.reason == REASON_BREAKOUT_CONFIRMATION_UNRESOLVED
    assert trigger.ambiguity == AMBIGUITY_BREAKOUT_CONFIRMATION
    assert plan.compiled is False

    # PRESERVED, and this is the half a careless repair drops.
    assert trigger.role == "spine"
    assert "breaks above the range high" in trigger.object
    assert trigger in plan.bindings, "the refused condition must remain IN the plan"


def test_the_refusal_names_the_confirmation_not_the_direction():
    """The teacher TAUGHT the direction. Only the confirmation is unresolved.

    `PARTIALLY SPECIFIED IS A THIRD SILENCE` — reporting this as an absent direction would
    erase what the source actually said, which is the opposite of a fidelity repair.
    """
    spec = _golden_spec()
    plan = compile_binding_plan(spec)
    trigger = next(b for b in plan.bindings if b.condition_id == spec["entry_trigger_id"])
    assert trigger.ambiguity == "breakout_confirmation_semantics"
    assert "direction" not in (trigger.ambiguity or "")
    assert "above" in trigger.object, "the taught direction must survive in the prose"


def test_control_the_trigger_refusal_is_not_specific_to_one_taught_window():
    """THE THREE-CANDIDATE CONTROL (R-785 §6-4). Required BECAUSE the matrix above runs
    on one explicitly-chosen taught window.

    🛑 WHAT IT DISCRIMINATES. Every candidate-aware fixture in this file is constructed
    with the 5m window. That is a cost decision, and it silently assumes the
    trigger-safety property is independent of which taught window the instance carries.
    If it were not — if the refusal held for 5m and quietly stopped holding for 30m —
    the entire matrix would stay green while the property was false for two thirds of
    the bots the factory builds.

      `A MATRIX PINNED TO ONE MEMBER OF A POPULATION PROVES THE PROPERTY FOR THAT MEMBER
       AND ASSUMES IT FOR THE REST — AND THE ASSUMPTION IS INVISIBLE ONCE IT IS GREEN.`

    So the golden refusal is re-measured across ALL THREE taught windows and must be
    IDENTICAL: same refusal, same reason, same ambiguity, on every one.
    """
    candidates = _taught_candidates()
    durations = [c.variant.duration_minutes for c in candidates]
    assert len(durations) == 3 and len(set(durations)) == 3, (
        f"the control cannot discriminate: taught windows are {durations}"
    )
    assert _SAFETY_MATRIX_WINDOW_MINUTES in durations, (
        f"the matrix runs on a {_SAFETY_MATRIX_WINDOW_MINUTES}m window that the source does "
        f"not teach ({durations}) — the fixture is measuring an invented alternative"
    )

    spec = _golden_spec()
    frame = _frame()
    observed = []
    for duration in durations:
        strategy = _traced(spec, frame, duration_minutes=duration)
        assert strategy.last_trace, f"{duration}m: a refused strategy produced an EMPTY trace"
        head = strategy.last_trace[0]
        observed.append(
            (head["trace_outcome"], head["execution_status"], head["reason"], head["ambiguity"])
        )

    assert len(set(observed)) == 1, (
        "the trigger-safety refusal is NOT identical across the taught windows, so the "
        "one-window matrix above is proving a property that does not hold for the others.\n"
        + "\n".join(f"  {d}m -> {o}" for d, o in zip(durations, observed, strict=True))
    )


def test_only_the_trigger_is_touched():
    """Blast radius. Every other condition binds exactly as before the rule existed."""
    spec = _golden_spec()
    plan = compile_binding_plan(spec)
    refused = [b for b in plan.bindings if b.disposition == "SOURCE_AMBIGUOUS"]
    assert [b.condition_id for b in refused] == [spec["entry_trigger_id"]]
    # ── BLAST-RADIUS COUNT: 7 -> 8 (S6 EXECUTION ACTIVATION, R-785 §6-4) ─────────────
    # This is a change to what the fixture EXPECTS, not to what it PROTECTS. The count was
    # 7 while OPENING_RANGE_DEFINITION was declared unsupported and therefore unbindable;
    # activating it binds exactly one more condition. The trigger-safety property — that
    # the refusal rule touches ONLY the trigger — is unchanged and still asserted above.
    #
    # 🛑 AND THE COUNT ALONE WOULD BE WEAKER THAN WHAT IT REPLACED: a bare `== 8` is
    # satisfied by ANY binding flipping bindable, including one this activation had no
    # business touching. So the newly-bindable member is NAMED, and the pre-existing seven
    # are asserted to still exclude it. `A COUNT THAT MOVED FOR A REASON SHOULD ASSERT THE
    # REASON, NOT JUST THE NEW NUMBER.`
    bindable = [b for b in plan.bindings if b.bindable]
    assert len(bindable) == 8
    opening_range = [b for b in bindable if b.type == "OPENING_RANGE_DEFINITION"]
    assert len(opening_range) == 1, (
        "the 8th bindable condition is not the activated opening-range definition; "
        f"something else changed binding state: {[b.type for b in bindable]}"
    )
    assert len([b for b in bindable if b.type != "OPENING_RANGE_DEFINITION"]) == 7, (
        "the seven pre-existing bindable conditions did not survive the activation unchanged"
    )


# ═══════════════════════════════════════════════════════════════════════════════════════
# 3. THE SIX-STEP MUTATION (R-747 §3) — the control that proves BOTH halves
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_six_step_mutation_sequence(monkeypatch):
    """R-747 §3, adopted verbatim, replacing the withdrawn locality control.

    (1) defective route reproduces the exact firing-bar population
    (2) trigger unbinding ALONE preserves it               <- encodes AR-843
    (3) refusal PLUS eligibility enforcement -> zero
    (4) disable ONLY the eligibility consumer
    (5) the identical population MUST return
    (6) restore -> zero again

    Steps (4)-(5) are the load-bearing ones: they prove the zero in step (3) is produced by
    the ENFORCEMENT and not by some unrelated drift, because turning the consumer off brings
    the identical bars back.

    🛑 THE POPULATION WAS SEVEN AND IS NOW SIX (R-787 §4). `DAILY-RESET-1` repaired
    `_h_opening_range`, which had computed the taught opening range ONCE from the first bar's
    session and then treated it as available forever. Bar 230 — 2026-01-06 04:40
    America/New_York — was an entry taken 4h55m BEFORE that day's own 09:35 lock, gated by
    the PREVIOUS session's completed range. It was never an eligible entry; it was a
    previous-session carry-over. The trigger-refusal property this file exists to prove is
    UNCHANGED and survives at six.

    🛑 AND THE COUNT IS NO LONGER WHAT IS ASSERTED, because `== 7` embalmed itself for
    exactly one commit too long. Membership is exact AND the semantic rule that produced it
    is asserted beside it — see `_assert_every_entry_is_at_or_after_its_own_session_lock`.
    """
    spec = _golden_spec()

    # ── (1) THE DEFECTIVE ROUTE, restored by defeating the classifier ────────────────
    # The trigger goes back to being bound to the generic structure primitive, exactly as it
    # was before this commit.
    monkeypatch.setattr(
        sfb,
        "_refuse_ambiguous_breakout_trigger",
        lambda binding, trigger_id, opening_range_defined: binding,
    )
    defective_strategy, defective_out = _run(spec)
    defective_bars = _short_bars(defective_out)
    # ── (1a) EXACT MEMBERSHIP, NEVER A COUNT (R-787 §4 clause 1) ─────────────────────
    assert defective_bars == _DEFECTIVE_ROUTE_BARS, (
        f"the defective route no longer reproduces the exact firing-bar population "
        f"(got {defective_bars}, expected {_DEFECTIVE_ROUTE_BARS}); this control cannot "
        "measure a repair whose defect it cannot restore"
    )
    # ── (1b) THE CARRY-OVER BAR IS NAMED AND MUST STAY ABSENT (clause 5) ─────────────
    assert _DAILY_RESET_CARRYOVER_BAR not in defective_bars, (
        f"bar {_DAILY_RESET_CARRYOVER_BAR} is back — that is the DAILY-RESET-1 phantom, an "
        "entry gated by the PREVIOUS session's opening range before its own session's lock"
    )
    # ── (1c) THE CAUSAL RULE THAT PRODUCES THAT MEMBERSHIP (clause 6) ────────────────
    _assert_every_entry_is_at_or_after_its_own_session_lock(defective_strategy, defective_bars)
    assert defective_strategy.execution_status == EXECUTION_STATUS_EXECUTED
    trigger_binding = next(
        b for b in defective_strategy.binding_plan.bindings
        if b.condition_id == spec["entry_trigger_id"]
    )
    assert trigger_binding.primitive == "structure_engine.compute_structure_state"

    # ── (2) UNBINDING ALONE PRESERVES THE SEVEN — AR-843, encoded ────────────────────
    # The classifier refuses (so the trigger is unbound) but the eligibility consumer is
    # disabled, isolating the subtraction effect.
    monkeypatch.undo()
    monkeypatch.setattr(
        SpecConditionStrategy,
        "_derive_entry_eligibility",
        lambda self, spine_satisfied, n: _permissive_eligibility(spine_satisfied, n),
    )
    unbound_strategy, unbound_out = _run(spec)
    assert _short_bars(unbound_out) == defective_bars, (
        "unbinding the trigger changed which bars fire; AR-843 measured them IDENTICAL, and "
        "if that ever stops holding the subtraction hazard has changed shape"
    )
    unbound_trigger = next(
        b for b in unbound_strategy.binding_plan.bindings
        if b.condition_id == spec["entry_trigger_id"]
    )
    assert unbound_trigger.bindable is False, "step (2) must run with the trigger REFUSED"

    # ── (4)/(5) THE CONSUMER IS THE CAUSE: with it off, the exact seven RETURN ───────
    # (this is the same run as (2) — stated explicitly so the sequence's numbering is honest
    # rather than padded with a duplicate execution)
    assert _short_bars(unbound_out) == defective_bars

    # ── (3)/(6) RESTORE THE CONSUMER -> ZERO ─────────────────────────────────────────
    monkeypatch.undo()
    enforced_strategy, enforced_out = _run(spec)
    assert _short_bars(enforced_out) == (), (
        "the eligibility boundary did not block execution; a refused strategy that still "
        "publishes entries is the exact defect this commit exists to remove"
    )
    assert enforced_strategy.execution_status == EXECUTION_STATUS_REFUSED
    assert int(enforced_out["entry_long"].sum()) == 0


def _permissive_eligibility(spine_satisfied, n):
    """A stand-in eligibility that always permits — used ONLY to disable the consumer."""
    from src.engine.entry_eligibility import EntryEligibility

    return EntryEligibility(
        boolean_spine_satisfied_bars=int(np.count_nonzero(spine_satisfied)) if n else 0,
        total_bars=n,
        trigger_bound=True,
        may_enter=True,
        refusal_reason=None,
    )


# ═══════════════════════════════════════════════════════════════════════════════════════
# 4. THE POSITIVE CONTROL — both flag states
# ═══════════════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("enforced", ["", "1"])
def test_a_faithfully_eligible_neighbour_still_trades(monkeypatch, enforced):
    """R-747 §4, MANDATORY.

    `AN ENGINE THAT REFUSES EVERY STRATEGY ALSO PRODUCES ZERO GOLDEN ENTRIES.` Without this,
    the golden's zero is unfalsifiable — it would be equally well explained by a consumer
    that refuses everything it is handed.
    """
    monkeypatch.setenv("TF_FAMILY_META_ENFORCED", enforced)
    strategy, out = _run(_neighbour_spec())

    assert strategy.execution_status == EXECUTION_STATUS_EXECUTED
    assert strategy.entry_eligibility().may_enter is True
    assert int(out["entry_long"].sum()) > 0, (
        "the neighbouring strategy produced no entries through the same eligibility "
        "consumer; the golden's zero then proves nothing about the golden"
    )
    decisions = strategy.last_per_condition_bool["s1"]
    assert 0 < int(decisions.sum()) < N_BARS, (
        "the neighbour's decisions are CONSTANT; a dead route and a pass-through are both "
        "constant, so a constant array cannot witness that the engine still decides"
    )


@pytest.mark.parametrize("enforced", ["", "1"])
def test_the_golden_is_refused_in_both_flag_states(monkeypatch, enforced):
    """`A GUARD THAT ONLY WATCHES THE PATH YOU TURNED ON IS NOT WATCHING PRODUCTION.`

    Enforcement OFF is the production default, so a refusal that only holds with the flag ON
    would be a refusal production never sees.
    """
    monkeypatch.setenv("TF_FAMILY_META_ENFORCED", enforced)
    strategy, out = _run(_golden_spec())

    assert strategy.execution_status == EXECUTION_STATUS_REFUSED
    assert int(out["entry_long"].sum()) == 0
    assert int(out["entry_short"].sum()) == 0
    eligibility = strategy.entry_eligibility()
    assert eligibility.may_enter is False
    assert eligibility.refusal_reason == REASON_BREAKOUT_CONFIRMATION_UNRESOLVED


# ═══════════════════════════════════════════════════════════════════════════════════════
# 5. NON-EQUIVALENCE, AND THE ALL-FALSE ARRAYS' PROVENANCE
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_the_boolean_subtotal_cannot_be_read_as_tradable():
    """R-744 §4's property, demonstrated rather than asserted.

    The spine subtotal is satisfied on many bars while the strategy may NOT enter. A consumer
    reading only the subtotal would conclude "tradable" and be wrong — which is precisely why
    the two must be separately readable and why the refusal carries its reason.
    """
    strategy, _out = _run(_golden_spec())
    eligibility = strategy.entry_eligibility()
    assert eligibility.boolean_spine_satisfied_bars > 0
    assert eligibility.may_enter is False
    assert eligibility.refusal_reason
    with pytest.raises(TypeError):
        bool(eligibility)  # truthiness is refused; `if eligibility:` must not read as tradable


def test_all_false_entries_come_from_the_strategy_boundary_not_a_faked_predicate():
    """R-747 §4: all-false arrays are permitted ONLY from the explicit refusal boundary.

    The per-condition arrays must still hold REAL evaluations after a refusal, so the trace
    can distinguish `no market setup occurred` from `execution was refused` — and so a
    diagnostic reader can still see what the market actually did.
    """
    strategy, out = _run(_golden_spec())
    assert strategy.execution_status == EXECUTION_STATUS_REFUSED
    assert int(out["entry_short"].sum()) == 0
    assert strategy.last_per_condition_bool, "per-condition arrays were emptied by the refusal"
    assert any(
        0 < int(arr.sum()) < N_BARS for arr in strategy.last_per_condition_bool.values()
    ), "every per-condition array is constant; the refusal faked the predicates"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 6. THE BACKTESTER MUST CONSUME IT
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_refused_strategy_publishes_no_performance_surface():
    """R-747 §4 / R-748 §3: no P&L, Sharpe or profitability result.

    `A ZERO-TRADE BACKTEST THAT STILL REPORTS A SHARPE READS AS A RESULT, NOT A REFUSAL.`
    The record is checked at the strategy boundary the backtester gate consumes, and the
    omitted keys are NAMED so a consumer learns why they are gone rather than reading a
    missing key as zero.
    """
    strategy, _ = _run(_golden_spec())
    refusal = strategy.execution_refusal()

    assert refusal is not None
    assert refusal["execution_status"] == EXECUTION_STATUS_REFUSED
    assert refusal["compiled"] is False
    assert refusal["entry_eligible"] is False
    assert refusal["disposition"] == "SOURCE_AMBIGUOUS"
    assert refusal["ambiguity"] == AMBIGUITY_BREAKOUT_CONFIRMATION
    assert "breaks above the range high" in refusal["source_prose"]
    for metric in ("pnl", "sharpe", "profit_factor", "win_rate", "total_return"):
        assert metric not in refusal, (
            f"the refusal record carries {metric!r}; a refusal that reports performance is a "
            "result wearing a refusal's label"
        )


def test_a_neighbour_is_not_refused_by_the_backtester_gate():
    """The gate's positive control: `None` means "may execute", and it must still happen."""
    strategy, _ = _run(_neighbour_spec())
    assert strategy.execution_refusal() is None


def test_classifier_verdict_is_frozen_and_carries_its_evidence():
    """A refusal must be auditable against the video without re-running the classifier."""
    verdict = classify_breakout_confirmation_ambiguity(
        is_entry_trigger=True,
        text="enter when price breaks above the range high",
        opening_range_defined_in_spec=True,
    )
    assert isinstance(verdict, BreakoutAmbiguityVerdict)
    # PRE-EXISTING at HEAD (ruff B017), surfaced only because this commit stages this file
    # and the hook lints whole files. NAMED rather than silenced: a blind `Exception` here
    # would also be satisfied by an unrelated `AttributeError` or a typo in the attribute
    # name, so this assertion could have passed on a verdict that was never frozen at all.
    # `A GUARD THAT ACCEPTS ANY EXCEPTION CANNOT TELL THE ONE IT MEANT FROM THE ONE IT GOT.`
    with pytest.raises(dataclasses.FrozenInstanceError):
        verdict.ambiguous = False  # frozen
    names = [name for name, _span in verdict.evidence]
    assert names == [
        "is_entry_trigger",
        "opening_range_defined_in_spec",
        "references_boundary",
        "crossing_relationship",
        "confirmation_specified",
    ]


# ═══════════════════════════════════════════════════════════════════════════════════════
# 7. THE INVERSION (R-749 §4-4) — a CLEARER teacher must not compile onto a blind primitive
# ═══════════════════════════════════════════════════════════════════════════════════════

CONFIRMED_SUFFIXES = [
    " and closes above it",
    " with a wick through the level",
    " and then retests it",
    " on a 5 minute close",
]


def _golden_spec_with_trigger_suffix(suffix: str) -> dict:
    import copy

    spec = copy.deepcopy(_golden_spec())
    for cond in spec["entry_conditions"]:
        if cond["id"] == spec["entry_trigger_id"]:
            cond["object"] = cond["object"] + suffix
    return spec


@pytest.mark.parametrize("suffix", CONFIRMED_SUFFIXES)
def test_a_confirmed_trigger_refuses_with_engine_primitive_missing(suffix):
    """R-749 §4-4, asserted on the FINAL BINDING — not on the classifier's branch.

    ★★★★★ THE DEFECT THIS EXISTS TO STOP WAS AN INVERTED SAFETY PROPERTY. The first version
    of this rule refused only VAGUENESS, so `if not verdict.ambiguous: return binding` handed
    a PRECISE teacher's trigger back to the normal binding path — which gave it
    `compute_structure_state`, a primitive that never reads the sentence.

        `A REFUSAL RULE THAT ONLY FIRES ON VAGUENESS PROTECTS THE VAGUE TEACHER AND EXPOSES
         THE PRECISE ONE — THE CLEARER THE TEACHING, THE MORE LIKELY IT COMPILES ONTO A
         PRIMITIVE THAT NEVER READS IT.`

    ⚠️ AND THE ASSERTION MUST BE ON THE PRIMITIVE. `AR-846 §3` strengthened these controls to
    assert WHICH BRANCH decided, which is exactly ONE HOP SHORT of the consequence — and that
    hop is where the defect lived. `A CONTROL THAT ASSERTS THE DECISION BUT NOT THE
    CONSEQUENCE IS GREEN FOR THE WRONG REASON.`
    """
    spec = _golden_spec_with_trigger_suffix(suffix)
    plan = compile_binding_plan(spec)
    trigger = next(b for b in plan.bindings if b.condition_id == spec["entry_trigger_id"])

    # POSITIVE CONTROL FIRST: the mutation actually reached the binding. R-749's own first
    # probe truncated the text and made two different arms look identical.
    assert trigger.object.endswith(suffix), "the mutation never reached the binding"

    assert trigger.primitive is None, (
        f"a trigger specifying its confirmation still bound to {trigger.primitive!r}; the "
        "engine has no evaluator that reads it, so binding it to one that ignores it is the "
        "founding defect under a new name"
    )
    assert trigger.primitive != "structure_engine.compute_structure_state"
    assert trigger.bindable is False
    assert trigger.executed is False
    assert trigger.disposition == "ENGINE_PRIMITIVE_MISSING"
    assert trigger.ambiguity == "exact_opening_range_breakout_trigger_evaluator"
    # REFUSAL IS NOT ABSENCE.
    assert trigger.role == "spine"
    assert "range high" in trigger.object


@pytest.mark.parametrize("suffix", CONFIRMED_SUFFIXES)
def test_a_confirmed_trigger_is_not_mislabelled_source_ambiguous(suffix):
    """The two refusals must stay DIFFERENT findings.

    `SOURCE_AMBIGUOUS` sends a reader back to the VIDEO; `ENGINE_PRIMITIVE_MISSING` sends
    them to build an EVALUATOR. Collapsing them would send half the work to the wrong place —
    `TWO DIFFERENT SILENCES DESERVE TWO DIFFERENT NAMES` (R-741 §2).
    """
    spec = _golden_spec_with_trigger_suffix(suffix)
    trigger = next(
        b for b in compile_binding_plan(spec).bindings
        if b.condition_id == spec["entry_trigger_id"]
    )
    assert trigger.disposition != "SOURCE_AMBIGUOUS"
    assert trigger.reason != REASON_BREAKOUT_CONFIRMATION_UNRESOLVED


@pytest.mark.parametrize("suffix", CONFIRMED_SUFFIXES)
def test_a_confirmed_trigger_also_blocks_execution(suffix):
    """The refusal must reach the SAME strategy-level boundary, not merely relabel a binding."""
    strategy, out = _run(_golden_spec_with_trigger_suffix(suffix))
    assert strategy.execution_status == EXECUTION_STATUS_REFUSED
    assert int(out["entry_long"].sum()) == 0
    assert int(out["entry_short"].sum()) == 0
    assert strategy.execution_refusal()["disposition"] == "ENGINE_PRIMITIVE_MISSING"


def test_the_ordinary_structure_neighbour_still_binds_to_its_primitive():
    """THE POSITIVE CONTROL FOR THE WHOLE RULE, at the primitive level.

    If every trigger now refused, the assertions above would be satisfied by a rule that had
    simply broken binding. This is the witness that ordinary conditions still reach real
    evaluators.
    """
    spec = _neighbour_spec()
    binding = next(b for b in compile_binding_plan(spec).bindings if b.condition_id == "s1")
    assert binding.bindable is True
    assert binding.primitive == "structure_engine.compute_structure_state"
    assert binding.disposition is None


# ═══════════════════════════════════════════════════════════════════════════════════════
# 6. THE TRACE SAYS WHY THERE ARE NO ENTRIES (R-749 §4-1)
# ═══════════════════════════════════════════════════════════════════════════════════════
#
# `_build_trace` emits one record per ENTRY-SIGNAL BAR. So before this closeout, a REFUSED
# strategy and a strategy that simply never saw its setup produced the SAME artifact: `[]`.
#
#   `A READER MUST NEVER HAVE TO INFER A REFUSAL FROM ZERO ENTRIES.` (R-749 §4-1)
#
# The discrimination below is the whole point: `test_refusal_and_no_setup_are_not_the_same
# _artifact` puts the two side by side on the SAME code path, both with zero entries and
# both with a one-record trace, and requires them to disagree.


def _flat_tape(n: int = N_BARS) -> pl.DataFrame:
    """A tape with no structure event in it, so an ELIGIBLE strategy still enters nothing.

    This is the NO_MARKET_SETUP witness. Without it the refusal assertions are satisfied by
    a trace that says EXECUTION_REFUSED for everything — `A NEGATIVE ASSERTION NEEDS A
    POSITIVE WITNESS THAT THE PATH RAN.`
    """
    close = np.full(n, 100.0)
    return pl.DataFrame(
        {
            "open": close,
            "high": close + 0.25,
            "low": close - 0.25,
            "close": close,
            "ts_event": [
                datetime(2026, 1, 5, 14, 30, tzinfo=UTC) + timedelta(minutes=5 * i)
                for i in range(n)
            ],
            "volume": [100] * n,
        }
    )


def _traced(
    spec: dict, frame: pl.DataFrame, duration_minutes: int = _SAFETY_MATRIX_WINDOW_MINUTES
) -> SpecConditionStrategy:
    plan = compile_binding_plan(spec)
    strategy = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "trigger-safety-trace"},
        symbol="MES",
        timeframe=TIMEFRAME,
        trace=True,
        binding_plan=plan,
        opening_range_candidate=_candidate_for(plan, duration_minutes),
    )
    strategy.compute(frame)
    return strategy


def test_the_refused_trace_carries_the_full_refusal_payload():
    """R-749 §4-1's field list, asserted field by field on the golden refusal."""
    strategy = _traced(_golden_spec(), _frame())
    assert strategy.last_trace, "a refused strategy produced an EMPTY trace — the defect"
    head = strategy.last_trace[0]

    assert head["record_kind"] == TRACE_RECORD_EXECUTION_SUMMARY
    assert head["trace_outcome"] == TRACE_OUTCOME_EXECUTION_REFUSED
    assert head["execution_status"] == EXECUTION_STATUS_REFUSED
    # Stated as literal False, never left to be inferred from the outcome string.
    assert head["trigger_bound"] is False
    assert head["entry_eligible"] is False
    assert head["condition_id"] == _golden_spec()["entry_trigger_id"]
    assert head["disposition"] == "SOURCE_AMBIGUOUS"
    assert head["reason"] == REASON_BREAKOUT_CONFIRMATION_UNRESOLVED
    assert head["ambiguity"] == AMBIGUITY_BREAKOUT_CONFIRMATION
    # REFUSAL IS NOT ABSENCE: the teacher's own words travel with the refusal.
    assert "range high" in head["source_prose"]
    assert head["source_evidence"], "the refusal record dropped the source evidence"


def test_refusal_and_no_setup_are_not_the_same_artifact():
    """THE DISCRIMINATION. Two runs, both zero entries, both a one-record trace.

    Before R-749 §4-1 both produced `[]` and were literally indistinguishable. If this test
    ever passes because the two records are equal, the closeout has been undone.
    """
    refused = _traced(_golden_spec(), _frame())
    no_setup = _traced(_neighbour_spec(), _flat_tape())

    # POSITIVE CONTROL: both really are zero-entry, one-record runs — otherwise the
    # assertion below discriminates on entry count rather than on the marker.
    assert len(refused.last_trace) == 1
    assert len(no_setup.last_trace) == 1
    assert refused.last_trace[0]["entry_bars"] == 0
    assert no_setup.last_trace[0]["entry_bars"] == 0

    assert refused.last_trace[0]["trace_outcome"] == TRACE_OUTCOME_EXECUTION_REFUSED
    assert no_setup.last_trace[0]["trace_outcome"] == TRACE_OUTCOME_NO_MARKET_SETUP
    assert refused.last_trace[0]["trace_outcome"] != no_setup.last_trace[0]["trace_outcome"]

    # The no-setup run must NOT be dressed as a refusal — that would be the inverse lie.
    assert no_setup.last_trace[0]["execution_status"] == EXECUTION_STATUS_EXECUTED
    assert no_setup.last_trace[0]["trigger_bound"] is True
    assert no_setup.last_trace[0]["disposition"] is None


def test_a_short_frame_is_not_reported_as_a_flat_market():
    """The THIRD silence. Nothing about the market was measured, so nothing may be claimed."""
    strategy = _traced(_neighbour_spec(), _flat_tape(n=5))
    head = strategy.last_trace[0]
    assert head["trace_outcome"] == TRACE_OUTCOME_INSUFFICIENT_BARS
    assert head["bars_evaluated"] is False
    assert head["trace_outcome"] != TRACE_OUTCOME_NO_MARKET_SETUP


def test_entry_bar_records_are_tagged_and_the_summary_leads():
    """A consumer iterating the trace can never mistake the summary for an entry bar."""
    strategy = _traced(_neighbour_spec(), _frame())
    head, *bars = strategy.last_trace
    assert head["record_kind"] == TRACE_RECORD_EXECUTION_SUMMARY
    assert head["trace_outcome"] == TRACE_OUTCOME_ENTRIES_PRESENT
    assert bars, "the ENTRIES_PRESENT witness produced no entry-bar records"
    assert head["entry_bars"] == len(bars)
    assert all(r["record_kind"] == TRACE_RECORD_ENTRY_BAR for r in bars)


def test_the_refusal_does_not_cost_the_per_condition_arrays():
    """R-749 §4-1: `Real per-condition arrays stay available for diagnostics.`

    The refusal must not be implemented by suppressing evaluation — a diagnostic reader still
    needs to see what the market actually did under a refused strategy.
    """
    strategy = _traced(_golden_spec(), _frame())
    assert strategy.execution_status == EXECUTION_STATUS_REFUSED
    assert strategy.last_per_condition_bool, (
        "the refusal emptied last_per_condition_bool; the refusal is a strategy-level "
        "boundary, NOT a suppression of condition evaluation"
    )
    assert any(arr.any() for arr in strategy.last_per_condition_bool.values()), (
        "every per-condition array is all-False — the arrays are present but carry no "
        "diagnostic signal, which is the same loss wearing a populated dict"
    )


def test_trace_disabled_still_emits_nothing():
    """C3's additive law is unchanged: flag off ⇒ no trace at all, summary included."""
    strategy, _ = _run(_golden_spec())
    assert strategy.last_trace == []


# ═══════════════════════════════════════════════════════════════════════════════════════
# 7. EXECUTED BACKTESTER SPIES (R-749 §4-2 / R-750 §5-3)
# ═══════════════════════════════════════════════════════════════════════════════════════
#
# 🛑 REPORT THIS AS A REGRESSION GUARD, NOT AS A CATCH. `R-749 §4-2` and both external reads
# agree: today's `if _spec_refusal is not None: … elif mode == "walkforward": … else: …` in
# `main()` ALREADY makes these zeros structurally true. This suite does NOT prove the
# trigger-safety commit repaired an ordering defect. It guards against a FUTURE refactor that
# computes-then-deletes — the shape where metrics are produced and then stripped, leaving the
# consumers reached and the refusal cosmetic.
#
#   `A CONTROL THAT PASSES ON UNCHANGED CODE IS A POSITIVE CONTROL, NOT EVIDENCE OF THE
#    CHANGE.` (fifth instance, R-750 §5-3)
#
# WHY THE DATA SOURCE IS FAKED AND THE CONSUMERS ARE NOT: this box has no market data
# (`DataLoadConfigError: missing AWS_ACCESS_KEY_ID`), so without a frame the NEIGHBOUR arm
# cannot reach any consumer either — and three zeros with no positive control is an absence,
# not a proof. `load_ohlcv` is the DATA SOURCE; the three counted functions are the real
# production callables, wrapped and not replaced.


_SPY_NEIGHBOUR_MIN_CALLS = 1


def _spy_run(monkeypatch, spec: dict) -> tuple[dict, dict]:
    """Run the REAL `main()` dispatch with counting wrappers around the three consumers."""
    import src.engine.backtester as bt
    import src.engine.performance_gate as pg

    calls = {"trade_simulator": 0, "qualification": 0, "performance_calculator": 0}

    real_rcb = bt.run_class_backtest
    real_gate = bt.apply_eligibility_gate
    real_perf = pg.check_performance_gate

    def spy_rcb(*a, **k):
        calls["trade_simulator"] += 1
        return real_rcb(*a, **k)

    def spy_gate(*a, **k):
        calls["qualification"] += 1
        return real_gate(*a, **k)

    def spy_perf(*a, **k):
        calls["performance_calculator"] += 1
        return real_perf(*a, **k)

    monkeypatch.setattr(bt, "run_class_backtest", spy_rcb)
    monkeypatch.setattr(bt, "apply_eligibility_gate", spy_gate)
    monkeypatch.setattr(pg, "check_performance_gate", spy_perf)
    monkeypatch.setattr(bt, "load_ohlcv", lambda *a, **k: _frame())
    # Keep the 8-scenario crisis suite out of a unit test; it is not what is being measured.
    monkeypatch.setenv("TF_STRESS_TEST_MODE", "pipeline")

    config = {
        "compiled_spec": {"spec": spec, "spec_hash": "trigger-safety-spy"},
        "strategy": {"symbol": "MES", "timeframe": TIMEFRAME},
        "start_date": "2026-01-05",
        "end_date": "2026-01-10",
    }
    try:
        bt.main.callback(json.dumps(config), None, "single", None)
    except SystemExit:
        pass
    except Exception:  # noqa: BLE001 — the NEIGHBOUR arm may fail DOWNSTREAM of the
        # consumers on a synthetic frame. That is fine: the question this asks is WHICH
        # CONSUMERS WERE REACHED, and a wrapper increments before the real call runs.
        pass
    return calls, config


def test_a_refused_strategy_reaches_none_of_the_three_consumers(monkeypatch):
    """R-749 §4-2, measured BY EXECUTION rather than read off the `if/elif`."""
    calls, _ = _spy_run(monkeypatch, _golden_spec())
    assert calls["trade_simulator"] == 0
    assert calls["performance_calculator"] == 0
    assert calls["qualification"] == 0


def test_the_neighbour_does_reach_them_positive_control(monkeypatch):
    """THE CONTROL THAT MAKES THE THREE ZEROS MEAN SOMETHING.

    Without this, `test_a_refused_strategy_reaches_none_of_the_three_consumers` is satisfied
    by a harness that never wired the spies at all — which is exactly what my first probe
    did: it counted `0` on BOTH arms because `main` is a click command and `main(...)` raised
    `MissingParameter` before any dispatch. `A SURPRISING RESULT ACCUSES YOUR INSTRUMENT
    FIRST`, and the only reason that was caught is that the control was written first.
    """
    calls, _ = _spy_run(monkeypatch, _neighbour_spec())
    assert calls["trade_simulator"] >= _SPY_NEIGHBOUR_MIN_CALLS, (
        "the eligible neighbour never reached the trade simulator; the spies are not wired "
        "and the refused arm's zeros prove nothing"
    )
    assert calls["qualification"] >= _SPY_NEIGHBOUR_MIN_CALLS
    assert calls["performance_calculator"] >= _SPY_NEIGHBOUR_MIN_CALLS


def test_the_refusal_gate_precedes_both_run_paths_by_execution(monkeypatch):
    """The refusal must beat BOTH `walkforward` and `single`, not just the one under test."""
    import src.engine.backtester as bt

    reached = {"walkforward": 0}
    monkeypatch.setattr(bt, "load_ohlcv", lambda *a, **k: _frame())
    monkeypatch.setenv("TF_STRESS_TEST_MODE", "pipeline")

    import src.engine.walk_forward as wf

    real_wf = wf.run_walk_forward_class

    def spy_wf(*a, **k):
        reached["walkforward"] += 1
        return real_wf(*a, **k)

    monkeypatch.setattr(wf, "run_walk_forward_class", spy_wf)
    config = {
        "compiled_spec": {"spec": _golden_spec(), "spec_hash": "trigger-safety-spy-wf"},
        "strategy": {"symbol": "MES", "timeframe": TIMEFRAME},
        "start_date": "2026-01-05",
        "end_date": "2026-01-10",
    }
    try:
        bt.main.callback(json.dumps(config), None, "walkforward", None)
    except SystemExit:
        pass
    except Exception:  # noqa: BLE001
        pass
    assert reached["walkforward"] == 0


# ═══════════════════════════════════════════════════════════════════════════════════════
# 8. REFUSAL TERMINALITY AT THE PUBLIC BOUNDARY (R-751 §8)
# ═══════════════════════════════════════════════════════════════════════════════════════
#
# 🛑 THIS SECTION EXISTS BECAUSE SECTION 6 WAS GREEN AT THE WRONG LAYER.
# `AR-851` witnessed the refusal summary on the STRATEGY OBJECT and reported §4-1 closed.
# At the PUBLIC `main()` boundary the same run returned `spec_trace: []`, because the
# common governance block at `backtester.py:~8431` reassigns `spec_trace` from
# `strategy.last_trace` — still `[]`, since a refused strategy never runs `compute()`.
#
#   `A CONTRACT THAT NAMES A PAYLOAD BUT NOT ITS OBSERVATION POINT WILL BE SATISFIED AT
#    WHICHEVER LAYER IS EASIEST TO REACH — AND THAT IS NEVER THE PUBLIC ONE.` (R-751 §3)
#
# So every assertion below observes the DICT `main()` ACTUALLY EMITS. The root cause was a
# join key: `"error" not in result` asks "did this blow up?", and a refusal carries no
# `error` key, so it read as a completed backtest.

# The analytical products a refusal must never carry. Kept in the TEST as an independent
# copy of the production tuple: importing the production constant would let one edit move
# both the behaviour and its check together (`[self-certifying-collections]`).
FORBIDDEN_ON_REFUSAL = (
    "crisis_results",
    "forge_score",
    "forge_score_components",
    "invariants",
    "parity_shadow",
    "b15_battery",
    "expected_signals",
)


def _public_run(monkeypatch, spec: dict, *, mode: str = "single", stress: str = "pipeline") -> dict:
    """Invoke the REAL public CLI entry point and return the dict it emits.

    `bt.main` is a `click` command — `bt.main(...)` raises `MissingParameter` before any
    dispatch, which is how AR-851's first spy counted 0 on both arms. `.callback` is the
    function.

    `TF_ALLOW_FIXED_1` is set because a downstream production guard REFUSES
    `position_size.fixed_contracts=1` outside unit tests and names this flag as the
    sanctioned test escape. It gates a SIZING guard, not anything measured here.
    """
    import src.engine.backtester as bt

    monkeypatch.setattr(bt, "load_ohlcv", lambda *a, **k: _frame())
    monkeypatch.setenv("TF_SPEC_TRACE", "true")
    monkeypatch.setenv("TF_STRESS_TEST_MODE", stress)
    monkeypatch.setenv("TF_ALLOW_FIXED_1", "true")

    captured: dict = {}
    real_dumps = bt.json.dumps

    def _spy(obj, *a, **k):
        if isinstance(obj, dict) and ("execution_status" in obj or "invariants" in obj):
            captured["result"] = obj
        return real_dumps(obj, *a, **k)

    monkeypatch.setattr(bt.json, "dumps", _spy)
    config = {
        "compiled_spec": {"spec": spec, "spec_hash": "terminality"},
        "strategy": {"symbol": "MES", "timeframe": TIMEFRAME},
        "start_date": "2026-01-05",
        "end_date": "2026-01-10",
    }
    try:
        bt.main.callback(json.dumps(config), None, mode, None)
    except SystemExit:
        pass
    return captured.get("result", {})


@pytest.mark.parametrize("mode", ["single", "walkforward"])
@pytest.mark.parametrize("stress", ["pipeline", "full"])
def test_public_boundary_returns_the_refusal_trace_not_an_empty_list(monkeypatch, mode, stress):
    """THE ASSERTION WHOSE ABSENCE CAUSED R-751 §1 — observed where a caller reads it."""
    result = _public_run(monkeypatch, _golden_spec(), mode=mode, stress=stress)
    assert result, "main() emitted nothing; the harness is unwired, not the gate proven"
    assert result["execution_status"] == EXECUTION_STATUS_REFUSED

    trace = result.get("spec_trace")
    assert trace, f"spec_trace is {trace!r} at the PUBLIC boundary — the R-751 §1 defect"
    assert trace[0]["record_kind"] == TRACE_RECORD_EXECUTION_SUMMARY
    assert trace[0]["trace_outcome"] == TRACE_OUTCOME_EXECUTION_REFUSED
    assert trace[0]["entry_eligible"] is False
    assert trace[0]["trigger_bound"] is False


@pytest.mark.parametrize("mode", ["single", "walkforward"])
@pytest.mark.parametrize("stress", ["pipeline", "full"])
def test_a_refusal_reaches_no_analytical_surface(monkeypatch, mode, stress):
    """R-751 §8-3, by execution: no analytical product on a refused result."""
    result = _public_run(monkeypatch, _golden_spec(), mode=mode, stress=stress)
    assert result["execution_status"] == EXECUTION_STATUS_REFUSED
    present = [k for k in FORBIDDEN_ON_REFUSAL if k in result]
    assert not present, (
        f"a REFUSED strategy published {present}; a refusal that carries a score is "
        "indistinguishable from a measured result, which is the confusion this whole "
        "trigger-safety lane exists to prevent"
    )


def test_the_eligible_neighbour_still_reaches_them_positive_control(monkeypatch):
    """WITHOUT THIS, the test above is satisfied by a build that computes nothing.

    Three absences with no positive control is an ABSENCE, not a proof — AR-851 §3 was
    caught by exactly this shape and it is not repeated here.
    """
    result = _public_run(monkeypatch, _neighbour_spec())
    assert result, "the neighbour emitted nothing; the positive control is unwired"
    assert result.get("execution_status") != EXECUTION_STATUS_REFUSED
    reached = [k for k in FORBIDDEN_ON_REFUSAL if k in result]
    assert reached, (
        "the eligible neighbour reached NONE of the analytical surfaces, so the refusal "
        "assertions above prove nothing about the gate"
    )
    assert "analysis_omitted" not in result


@pytest.mark.parametrize("mode", ["single", "walkforward"])
def test_omitted_analysis_is_named_and_absent_never_zero(monkeypatch, mode):
    """R-751 §8-5: `A KEY PRESENT AS 0.0 IS A MEASUREMENT; A KEY ABSENT WITH A STATED
    REASON IS A REFUSAL.`"""
    result = _public_run(monkeypatch, _golden_spec(), mode=mode)
    named = result.get("analysis_omitted")
    assert named, "the refusal did not say WHAT it omitted"
    assert set(named) == set(FORBIDDEN_ON_REFUSAL)
    assert result.get("analysis_omitted_reason")
    # ABSENT, not falsy-present. `None`/`0.0`/`[]` would each read as a measurement.
    for key in named:
        assert key not in result, f"{key} is named as omitted but is present"


def test_the_refusal_is_not_disguised_as_a_crash(monkeypatch):
    """R-751 §8-1: the fix must NOT work by injecting a fake `error` key.

    Overloading the crash channel would make every downstream consumer read a deliberate
    refusal as a malformed request — a different lie, not a fix.
    """
    result = _public_run(monkeypatch, _golden_spec())
    assert "error" not in result
    assert result["execution_status"] == EXECUTION_STATUS_REFUSED
    # The refusal payload still explains itself in its own vocabulary.
    assert result["refusal"]["disposition"] == "SOURCE_AMBIGUOUS"
    assert result["metrics_omitted_reason"]
