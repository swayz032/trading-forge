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
from src.engine.extraction.spec_producer import produce_spec_artifact
from src.engine.spec_condition_compiler import (
    EXECUTION_STATUS_EXECUTED,
    EXECUTION_STATUS_REFUSED,
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


def _run(spec: dict) -> tuple[SpecConditionStrategy, pl.DataFrame]:
    strategy = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "trigger-safety"},
        symbol="MES",
        timeframe=TIMEFRAME,
        binding_plan=compile_binding_plan(spec),
    )
    return strategy, strategy.compute(_frame())


def _short_bars(out: pl.DataFrame) -> tuple[int, ...]:
    """The EXACT firing bar indices, not merely how many.

    `R-747 §3` says *"the exact seven firing bars"*. A count can be reproduced by a different
    seven bars, and a mutation control that only counts cannot tell a restored defect from a
    coincidentally equal one.
    """
    return tuple(int(i) for i in np.flatnonzero(out["entry_short"].to_numpy()))


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


def test_only_the_trigger_is_touched():
    """Blast radius. Every other condition binds exactly as before the rule existed."""
    spec = _golden_spec()
    plan = compile_binding_plan(spec)
    refused = [b for b in plan.bindings if b.disposition == "SOURCE_AMBIGUOUS"]
    assert [b.condition_id for b in refused] == [spec["entry_trigger_id"]]
    assert sum(1 for b in plan.bindings if b.bindable) == 7


# ═══════════════════════════════════════════════════════════════════════════════════════
# 3. THE SIX-STEP MUTATION (R-747 §3) — the control that proves BOTH halves
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_six_step_mutation_sequence(monkeypatch):
    """R-747 §3, adopted verbatim, replacing the withdrawn locality control.

    (1) defective route reproduces the exact seven firing bars
    (2) trigger unbinding ALONE preserves those seven      <- encodes AR-843
    (3) refusal PLUS eligibility enforcement -> zero
    (4) disable ONLY the eligibility consumer
    (5) the exact seven MUST return
    (6) restore -> zero again

    Steps (4)-(5) are the load-bearing ones: they prove the zero in step (3) is produced by
    the ENFORCEMENT and not by some unrelated drift, because turning the consumer off brings
    the identical seven bars back.
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
    assert len(defective_bars) == 7, (
        f"the defective route no longer reproduces seven entries (got {len(defective_bars)}); "
        "this control cannot measure a repair whose defect it cannot restore"
    )
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
    with pytest.raises(Exception):
        verdict.ambiguous = False  # frozen
    names = [name for name, _span in verdict.evidence]
    assert names == [
        "is_entry_trigger",
        "opening_range_defined_in_spec",
        "references_boundary",
        "crossing_relationship",
        "confirmation_specified",
    ]
