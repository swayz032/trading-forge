"""Birth gate for the versioned Opus Phase-1 route (AR-1236 §10).

The route owns NO gate of its own, so these tests do not re-test the gates. They test the two
things an orchestrator can get wrong and that no gate's own suite can catch:

  ORDER   — a relevance-rejected condition must never be GATED on fidelity, because fidelity
            would then be comparing a condition against a span that is not about it. (It is
            still swept ADVISORILY, in a separate field that decides nothing — see §3b.)
  CLOSURE — there must be no path to ACCEPTED that skips a gate, and no unresolved condition
            may be absorbed into a green.

Synthetic source only. The route must be source-agnostic and its birth gate must not hand it a
real one.
"""

from __future__ import annotations

import pytest

from src.engine.extraction import opus_phase1_route as rt

TRANSCRIPT = (
    "welcome back everyone. at nine thirty we mark the high and the low of the first five "
    "minute candle to build our range for the day. after that we wait for a one minute candle "
    "to close outside of the five minute range before we do anything at all. it might be "
    "telling us the market wants to go lower, it is not a guarantee of anything. "
    "the stop goes at the bottom of the fair value candle and you include the wick. "
    "our target is a fixed two times risk on every single trade. "
    "i do want to reiterate that this model is not perfect and you will lose on this model."
)

C_RANGE = {"condition_ref": "entry_sequence[0].action",
           "condition_text": "Mark the high and the low of the first five minute candle to build the range."}
C_BREAK = {"condition_ref": "entry_sequence[1].action",
           "condition_text": "Wait for a one minute candle to close outside of the five minute range."}
C_STOP = {"condition_ref": "stop.rationale",
          "condition_text": "The stop goes at the bottom of the fair value candle including the wick."}
C_TARGET = {"condition_ref": "targets[0].rationale",
            "condition_text": "The target is a fixed two times risk on every trade."}

Q_RANGE = "we mark the high and the low of the first five minute candle to build our range"
Q_BREAK = "we wait for a one minute candle to close outside of the five minute range"
Q_STOP = "the stop goes at the bottom of the fair value candle and you include the wick"
Q_TARGET = "our target is a fixed two times risk on every single trade"
Q_DISCLAIMER = "this model is not perfect and you will lose on this model"


def _run(pairs, conditions=None):
    conditions = conditions or [C_RANGE, C_BREAK, C_STOP, C_TARGET]
    answers = [{"condition_ref": r, "raw_output": q} for r, q in pairs]
    return rt.run_route(TRANSCRIPT, conditions, answers)


def _by_ref(out):
    return {o["condition_ref"]: o for o in out["outcomes"]}


# --------------------------------------------------------------------------- #
# 1. The clean path — and what its green is NOT
# --------------------------------------------------------------------------- #


def test_all_gates_pass_yields_accepted_and_a_green_that_disclaims_certification():
    out = _run([(C_RANGE["condition_ref"], Q_RANGE), (C_BREAK["condition_ref"], Q_BREAK),
                (C_STOP["condition_ref"], Q_STOP), (C_TARGET["condition_ref"], Q_TARGET)])
    assert out["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert out["accepted_count"] == 4
    assert out["escalate_to_isolated"] == []
    # the green must carry its own limit in the artifact, not only in a docstring
    assert "NOT A CERTIFICATE" in out["grade_meaning"]
    assert "certification" in out["grade_meaning"].lower()


# --------------------------------------------------------------------------- #
# 2. ORDER — relevance rejection must stop the pipeline before fidelity
# --------------------------------------------------------------------------- #


def test_a_misgrounded_span_is_refused_by_relevance_and_is_never_GATED_on_fidelity(monkeypatch):
    """THE ORDER RED-PROOF. The disclaimer is real transcript text, so the literal fence passes
    it — AR-1223's exact failure class. Relevance must stop it, and fidelity must never GATE it:
    an inflation check run against a span that is not about the condition is measuring the wrong
    pair and its verdict means nothing.

    The advisory sweep does consult fidelity for this row afterwards, deliberately, writing to a
    field that decides nothing (§3b). The distinction this test defends is GATING, not calling."""
    called = []
    real = rt.check_condition_fidelity

    def spy(cond, quotes):
        called.append(cond)
        return real(cond, quotes)

    monkeypatch.setattr(rt, "check_condition_fidelity", spy)

    out = _run([(C_RANGE["condition_ref"], Q_DISCLAIMER), (C_BREAK["condition_ref"], Q_BREAK),
                (C_STOP["condition_ref"], Q_STOP), (C_TARGET["condition_ref"], Q_TARGET)])
    row = _by_ref(out)[C_RANGE["condition_ref"]]

    assert row["disposition"] == rt.REFUSED_RELEVANCE
    assert row["gate"] == "evidence_relevance"
    # THE GATING FIELD IS EMPTY. `fidelity_findings` is the only fidelity result that can decide
    # a disposition; the later ADVISORY sweep writes to a different field on purpose, and this
    # assertion is what keeps those two from merging back together.
    assert row["fidelity_findings"] == []
    # POSITIVE WITNESS that the spy was live at all.
    assert len(called) >= 3, "the fidelity spy never ran — this test proves nothing"
    # ORDER: the three ACCEPTED conditions were decided by a gating call; the refused one was
    # only ever touched by the advisory sweep, which runs after every disposition is fixed.
    gated = [o for o in out["outcomes"] if o["disposition"] == rt.ACCEPTED]
    assert len(gated) == 3
    assert all(o["fidelity_advisory"] == [] for o in gated)


def test_literal_failure_stops_before_relevance_and_before_fidelity():
    out = _run([(C_RANGE["condition_ref"], "a paraphrase the speaker never uttered aloud"),
                (C_BREAK["condition_ref"], Q_BREAK), (C_STOP["condition_ref"], Q_STOP),
                (C_TARGET["condition_ref"], Q_TARGET)])
    row = _by_ref(out)[C_RANGE["condition_ref"]]
    assert row["disposition"] == rt.REFUSED_NOT_LITERAL
    assert row["gate"] == "literal_verifier"
    assert row["relevance"] is None and row["fidelity_findings"] == []


def test_an_abstention_is_a_refusal_with_its_own_name_not_a_literal_failure():
    out = _run([(C_RANGE["condition_ref"], None), (C_BREAK["condition_ref"], Q_BREAK),
                (C_STOP["condition_ref"], Q_STOP), (C_TARGET["condition_ref"], Q_TARGET)])
    row = _by_ref(out)[C_RANGE["condition_ref"]]
    assert row["disposition"] == rt.REFUSED_NO_EVIDENCE
    assert row["disposition"] != rt.REFUSED_NOT_LITERAL


# --------------------------------------------------------------------------- #
# 3. CLOSURE — fail closed, and no unresolved condition is absorbed
# --------------------------------------------------------------------------- #


def test_one_unresolved_condition_makes_the_whole_route_red():
    out = _run([(C_RANGE["condition_ref"], Q_DISCLAIMER), (C_BREAK["condition_ref"], Q_BREAK),
                (C_STOP["condition_ref"], Q_STOP), (C_TARGET["condition_ref"], Q_TARGET)])
    assert out["grade"] == "RED"
    assert out["accepted_count"] == 3
    assert C_RANGE["condition_ref"] in out["escalate_to_isolated"]


def test_every_non_accepting_disposition_escalates_and_names_its_gate():
    """No disposition may be a dead end: an unresolved condition either resolves or earns an
    isolated re-query. A silent third state is how something unresolved becomes something
    forgotten."""
    out = _run([(C_RANGE["condition_ref"], None),
                (C_BREAK["condition_ref"], "words that appear nowhere in this transcript"),
                (C_STOP["condition_ref"], Q_DISCLAIMER), (C_TARGET["condition_ref"], Q_TARGET)])
    for row in out["outcomes"]:
        if row["disposition"] != rt.ACCEPTED:
            assert row["escalate_to_isolated"] is True, row
            assert row["gate"] and row["reason"], row
    assert out["grade"] == "RED"


def test_a_missing_condition_in_the_batch_map_is_a_no_show_not_a_decline():
    with pytest.raises(ValueError) as exc:
        _run([(C_RANGE["condition_ref"], Q_RANGE), (C_BREAK["condition_ref"], Q_BREAK),
              (C_STOP["condition_ref"], Q_STOP)])
    assert C_TARGET["condition_ref"] in str(exc.value)


def test_the_accepted_set_and_the_escalation_set_are_disjoint_and_exhaustive():
    out = _run([(C_RANGE["condition_ref"], Q_DISCLAIMER), (C_BREAK["condition_ref"], Q_BREAK),
                (C_STOP["condition_ref"], Q_STOP), (C_TARGET["condition_ref"], Q_TARGET)])
    accepted = {o["condition_ref"] for o in out["outcomes"] if o["disposition"] == rt.ACCEPTED}
    escalated = set(out["escalate_to_isolated"])
    assert accepted & escalated == set()
    assert accepted | escalated == {c["condition_ref"] for c in
                                    (C_RANGE, C_BREAK, C_STOP, C_TARGET)}


# --------------------------------------------------------------------------- #
# 3b. The advisory fidelity sweep — §10.7 visible, §10.6 still gating
# --------------------------------------------------------------------------- #

C_INFLATED = {"condition_ref": "entry_sequence[2].rationale",
              "condition_text": "The breakout confirms the trade direction."}
# A HEDGED span the condition shares no content term with: relevance must refuse it, and the
# fidelity guard must still see `confirms` asserted over a source that only says `might`.
Q_HEDGED = "it might be telling us the market wants to go lower, it is not a guarantee of anything"


def test_a_relevance_refused_condition_still_surfaces_its_proven_inflation_as_ADVISORY():
    """MEASURED ON THE REAL SLICE: `confirms` and `high-probability` — two of the four defects
    AR-1236 §10.7 requires the route to catch — never reached the fidelity gate, because
    relevance refused their evidence first. The requirement looked met and was not. The finding
    must be visible even when the evidence it was computed against was refused."""
    out = rt.run_route(
        TRANSCRIPT,
        [C_INFLATED, C_STOP, C_TARGET],
        [{"condition_ref": C_INFLATED["condition_ref"], "raw_output": Q_HEDGED},
         {"condition_ref": C_STOP["condition_ref"], "raw_output": Q_STOP},
         {"condition_ref": C_TARGET["condition_ref"], "raw_output": Q_TARGET}],
    )
    row = _by_ref(out)[C_INFLATED["condition_ref"]]
    assert row["disposition"] == rt.REFUSED_RELEVANCE          # relevance still decides
    assert row["fidelity_findings"] == []                      # fidelity did NOT gate
    kinds = [f["kind"] for f in row["fidelity_advisory"]]
    assert "CERTAINTY_INFLATION" in kinds                      # ...but the defect is VISIBLE
    assert "GATES NOTHING" in out["fidelity_advisory_policy"]


def test_the_advisory_sweep_changes_no_disposition_and_no_grade():
    """The failure mode this guards: an advisory signal quietly acquiring gate authority. Run the
    clean set — every condition ACCEPTED — and prove the sweep produced nothing that moved it."""
    pairs = [(C_RANGE["condition_ref"], Q_RANGE), (C_BREAK["condition_ref"], Q_BREAK),
             (C_STOP["condition_ref"], Q_STOP), (C_TARGET["condition_ref"], Q_TARGET)]
    out = _run(pairs)
    assert out["grade"] == "GREEN_PENDING_CERTIFICATION"
    for row in out["outcomes"]:
        assert row["disposition"] == rt.ACCEPTED
        # an ACCEPTED condition is never given an advisory verdict about itself
        assert row["fidelity_advisory"] == []


def test_an_advisory_finding_never_promotes_a_refusal_into_an_acceptance():
    out = rt.run_route(
        TRANSCRIPT,
        [C_INFLATED, C_STOP, C_TARGET],
        [{"condition_ref": C_INFLATED["condition_ref"], "raw_output": Q_HEDGED},
         {"condition_ref": C_STOP["condition_ref"], "raw_output": Q_STOP},
         {"condition_ref": C_TARGET["condition_ref"], "raw_output": Q_TARGET}],
    )
    assert out["grade"] == "RED"
    assert out["accepted_count"] == 2
    assert C_INFLATED["condition_ref"] in out["escalate_to_isolated"]


# --------------------------------------------------------------------------- #
# 4. Duplicate role vs accidental reuse — AR-1236 §5 / §10.9
# --------------------------------------------------------------------------- #

C_DUP = {"condition_ref": "confluences[1].description",
         "condition_text": "A one minute candle must close outside of the five minute range."}
C_UNRELATED = {"condition_ref": "confluences[0].description",
               "condition_text": "The stop is placed beyond the candle extreme including its wick."}


def test_two_conditions_encoding_the_same_requirement_are_HELD_as_duplicate_role():
    conditions = [C_BREAK, C_DUP, C_TARGET]
    out = rt.run_route(TRANSCRIPT, conditions, [
        {"condition_ref": C_BREAK["condition_ref"], "raw_output": Q_BREAK},
        {"condition_ref": C_DUP["condition_ref"], "raw_output": Q_BREAK},
        {"condition_ref": C_TARGET["condition_ref"], "raw_output": Q_TARGET},
    ])
    rows = _by_ref(out)
    assert rows[C_BREAK["condition_ref"]]["disposition"] == rt.HELD_DUPLICATE_ROLE
    assert rows[C_DUP["condition_ref"]]["disposition"] == rt.HELD_DUPLICATE_ROLE
    # HELD, not deleted, not merged — both conditions survive into the artifact
    assert len(out["outcomes"]) == 3
    assert out["grade"] == "RED"
    assert C_DUP["condition_ref"] in rows[C_BREAK["condition_ref"]]["collision_partners"]


def test_reuse_across_DIFFERENT_requirements_is_held_under_a_DIFFERENT_name():
    """DISCRIMINATOR: same collision mechanics, unrelated condition texts. If both cases produced
    the same label, the classification would be decorative."""
    conditions = [C_BREAK, C_UNRELATED, C_TARGET]
    out = rt.run_route(TRANSCRIPT, conditions, [
        {"condition_ref": C_BREAK["condition_ref"], "raw_output": Q_BREAK},
        {"condition_ref": C_UNRELATED["condition_ref"], "raw_output": Q_BREAK},
        {"condition_ref": C_TARGET["condition_ref"], "raw_output": Q_TARGET},
    ])
    rows = _by_ref(out)
    assert rows[C_BREAK["condition_ref"]]["disposition"] == rt.HELD_EVIDENCE_REUSE
    assert rows[C_BREAK["condition_ref"]]["disposition"] != rt.HELD_DUPLICATE_ROLE


def test_both_hold_classes_escalate_so_a_label_never_becomes_a_pass():
    for other in (C_DUP, C_UNRELATED):
        out = rt.run_route(TRANSCRIPT, [C_BREAK, other, C_TARGET], [
            {"condition_ref": C_BREAK["condition_ref"], "raw_output": Q_BREAK},
            {"condition_ref": other["condition_ref"], "raw_output": Q_BREAK},
            {"condition_ref": C_TARGET["condition_ref"], "raw_output": Q_TARGET},
        ])
        assert C_BREAK["condition_ref"] in out["escalate_to_isolated"]
        assert out["grade"] == "RED"


# --------------------------------------------------------------------------- #
# 5. The route is source-agnostic (AR-1234 control 10, carried forward)
# --------------------------------------------------------------------------- #

_SOURCE_SPECIFIC = ["sVkmZklJDHI", "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc",
                    "19546", "14488"]


def test_route_module_carries_no_source_pin_or_answer_span():
    import os
    path = os.path.join(os.path.dirname(rt.__file__), "opus_phase1_route.py")
    body = open(path, encoding="utf-8").read()
    assert [n for n in _SOURCE_SPECIFIC if n in body] == []
    assert [n for n in _SOURCE_SPECIFIC if n in body + "\nV='sVkmZklJDHI'"], "scanner is dead"
