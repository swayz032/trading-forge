"""G2-C — antecedent composition wired into the versioned Opus Phase-1 route (AR-1243 §11).

WHAT IS UNDER TEST, AND WHAT IS NOT
    `evidence_antecedent.bind_qualifier_to_antecedent` has its own birth gate and is not
    re-tested here. What no existing suite could catch is the WIRING: that the route calls that
    helper rather than a second copy of the rule, that a bound composition actually reaches
    fidelity as TWO literal spans, that both spans and their exact character positions survive,
    and that every antecedent failure stays RED instead of quietly reverting to the uncomposed
    evidence.

THE RED→GREEN PAIR IS A REAL ONE
    The condition names a number that appears ONLY in the earlier defining span. Uncomposed, the
    fidelity gate raises `UNSUPPORTED_QUANTITY` — the condition states a figure its evidence does
    not. Composed, the antecedent supplies that figure and the finding disappears. Nothing in the
    fixture was bent to produce this: the number genuinely is absent from the referring span.

Synthetic source only — the route must stay source-agnostic.
"""

from __future__ import annotations

import pytest

from src.engine.extraction import opus_phase1_route as rt

# The antecedent DEFINES the range and carries the number. The reference points back at it
# deictically ("this range") and carries no number at all. Nothing in between redefines a range.
TRANSCRIPT = (
    "welcome back everyone. first thing we do is build our range from the first five minute "
    "candle. then we sit on our hands and let the market settle for a moment. "
    "after that we wait for a close outside of this range before we do anything at all. "
    "the stop goes at the bottom of the fair value candle and you include the wick."
)

ANTECEDENT_QUOTE = "build our range from the first five minute candle"
REFERRING_QUOTE = "we wait for a close outside of this range before we do anything at all"
Q_STOP = "the stop goes at the bottom of the fair value candle and you include the wick"

C_BREAK = {
    "condition_ref": "entry_sequence[1].action",
    "condition_text": "Wait for a close outside of the five minute range.",
}
C_STOP = {
    "condition_ref": "stop.rationale",
    "condition_text": "The stop goes at the bottom of the fair value candle including the wick.",
}

ANTE_START = TRANSCRIPT.index(ANTECEDENT_QUOTE)
ANTE_END = ANTE_START + len(ANTECEDENT_QUOTE)


def _spec(**over):
    """The authored composition request. Every domain term is CALLER-supplied, as the helper's
    generic-by-construction contract requires."""
    spec = {
        "condition_ref": C_BREAK["condition_ref"],
        "qualifier": "five minute",
        "qualifier_synonyms": ("five minute", "5 minute", "5m"),
        "entity_terms": ("range",),
        "definitional_markers": ("build", "mark", "define", "draw"),
        "antecedent_span": [ANTE_START, ANTE_END],
        "authority": "AR-1243 §11 test fixture — synthetic source, no repository semantics",
    }
    spec.update(over)
    return spec


def _run(specs=None, conditions=None, pairs=None):
    conditions = conditions or [C_BREAK, C_STOP]
    pairs = pairs or [
        (C_BREAK["condition_ref"], REFERRING_QUOTE),
        (C_STOP["condition_ref"], Q_STOP),
    ]
    answers = [{"condition_ref": r, "raw_output": q} for r, q in pairs]
    return rt.run_route(TRANSCRIPT, conditions, answers, composition_specs=specs)


def _by_ref(out):
    return {o["condition_ref"]: o for o in out["outcomes"]}


# --------------------------------------------------------------------------- #
# 1. THE RED→GREEN PAIR
# --------------------------------------------------------------------------- #


def test_RED_without_composition_the_number_is_unsupported_and_the_condition_fails_fidelity():
    """THE RED HALF. The referring span carries no number, so the condition's 'five minute'
    is a figure the evidence does not state."""
    row = _by_ref(_run(specs=None))[C_BREAK["condition_ref"]]

    assert row["disposition"] == rt.RED_FIDELITY, row["reason"]
    kinds = {f["kind"] for f in row["fidelity_findings"]}
    assert "UNSUPPORTED_QUANTITY" in kinds, row["fidelity_findings"]
    # and it got that far honestly — relevance approved the span first
    assert row["relevance"]["grounded"] is True
    # no spec was supplied, so nothing may claim composition happened
    assert row["composition"] is None
    assert row["evidence_is_composed"] is False


def test_GREEN_with_composition_the_antecedent_supplies_the_number_and_the_condition_passes():
    """THE GREEN HALF — same route, same transcript, same quote. The ONLY delta is the authored
    composition spec, so the disposition change is attributable to the wiring and nothing else."""
    row = _by_ref(_run(specs=[_spec()]))[C_BREAK["condition_ref"]]

    assert row["disposition"] == rt.ACCEPTED, row["reason"]
    assert row["fidelity_findings"] == []
    assert row["evidence_is_composed"] is True
    assert row["composition"]["bound"] is True
    assert "BOUND" in row["composition"]["reason"]


# --------------------------------------------------------------------------- #
# 2. THE COMPOSED PACKAGE — two literal spans, never a merged paraphrase
# --------------------------------------------------------------------------- #


def test_fidelity_receives_two_separate_literal_spans_and_not_a_merged_paraphrase(monkeypatch):
    """AR-1239 §3.2: fidelity must SEE the composed evidence explicitly. A single concatenated
    string would satisfy the letter and destroy the property — each element must still be a
    verbatim span of the transcript."""
    seen = []
    real = rt.check_condition_fidelity

    def spy(cond, quotes):
        seen.append((cond, list(quotes)))
        return real(cond, quotes)

    monkeypatch.setattr(rt, "check_condition_fidelity", spy)
    _run(specs=[_spec()])

    gated = [q for c, q in seen if c == C_BREAK["condition_text"]]
    assert gated, "fidelity was never called for the composed condition — the path did not run"
    package = gated[0]
    assert len(package) == 2, f"expected TWO spans, got {package}"
    assert package == [ANTECEDENT_QUOTE, REFERRING_QUOTE], package
    for element in package:
        assert element in TRANSCRIPT, f"{element!r} is not a literal span of the source"


def test_both_spans_and_their_exact_character_positions_survive_into_the_record():
    row = _by_ref(_run(specs=[_spec()]))[C_BREAK["condition_ref"]]
    comp = row["composition"]

    a_start, a_end = comp["antecedent_span"]
    r_start, r_end = comp["referring_span"]

    # the positions are not decoration: they must still address the recorded text
    assert TRANSCRIPT[a_start:a_end] == ANTECEDENT_QUOTE
    assert TRANSCRIPT[r_start:r_end] == REFERRING_QUOTE
    assert comp["antecedent_quote"] == ANTECEDENT_QUOTE
    assert row["quote"] == REFERRING_QUOTE
    assert [a_start, a_end] == [ANTE_START, ANTE_END]
    # order is a fact about the source, and it survived
    assert a_end <= r_start


def test_the_route_calls_the_existing_helper_rather_than_reimplementing_the_rule(monkeypatch):
    """AR-1239 §3.2: 'Reuse it. Do not write a second antecedent engine.' A positive witness that
    the shared helper actually executed — an absence-of-second-engine claim needs one."""
    calls = []
    real = rt.bind_qualifier_to_antecedent

    def spy(**kw):
        calls.append(kw)
        return real(**kw)

    monkeypatch.setattr(rt, "bind_qualifier_to_antecedent", spy)
    _run(specs=[_spec()])

    assert len(calls) == 1, f"expected exactly one binding call, got {len(calls)}"
    kw = calls[0]
    # the caller's terms were passed through untouched — the route invents no domain vocabulary
    assert kw["qualifier"] == "five minute"
    assert kw["entity_terms"] == ("range",)
    assert kw["definitional_markers"] == ("build", "mark", "define", "draw")


# --------------------------------------------------------------------------- #
# 3. FAIL CLOSED — every antecedent failure stays RED
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "label,override,expect_in_reason",
    [
        ("no antecedent supplied", {"antecedent_span": None}, "NO_ANTECEDENT"),
        (
            "antecedent does not precede the reference",
            {"antecedent_span": [len(TRANSCRIPT) - 40, len(TRANSCRIPT) - 1]},
            "ORDER_VIOLATION",
        ),
        (
            "qualifier is not grounded in the antecedent",
            {"qualifier": "thirty minute", "qualifier_synonyms": ("thirty minute", "30m")},
            "QUALIFIER_UNGROUNDED",
        ),
    ],
)
def test_every_antecedent_failure_is_RED_and_never_falls_back_to_the_uncomposed_evidence(
    label, override, expect_in_reason
):
    """THE FALL-BACK IS THE DANGER. Reverting to the primary span on a failed binding would hand
    the WEAKER package the acceptance the stronger one just failed to earn — and it would look
    like a pass. The condition must end unresolved."""
    row = _by_ref(_run(specs=[_spec(**override)]))[C_BREAK["condition_ref"]]

    assert row["disposition"] == rt.RED_ANTECEDENT_UNBOUND, f"{label}: {row['disposition']}"
    assert row["gate"] == "evidence_antecedent"
    assert expect_in_reason in row["reason"], row["reason"]
    assert row["composition"]["bound"] is False
    assert row["evidence_is_composed"] is False
    assert row["escalate_to_isolated"] is True
    assert row["condition_ref"] in _run(specs=[_spec(**override)])["escalate_to_isolated"]


def test_an_intervening_redefinition_is_RED():
    """Check 3 of the helper, exercised THROUGH the route. A second 'we build our range' between
    the antecedent and the reference means the deictic may point at the newer one."""
    transcript = (
        "welcome back everyone. first thing we do is build our range from the first five minute "
        "candle. later on we build our range again off the fifteen minute candle instead. "
        "after that we wait for a close outside of this range before we do anything at all. "
        "the stop goes at the bottom of the fair value candle and you include the wick."
    )
    ante = "build our range from the first five minute candle"
    start = transcript.index(ante)
    spec = _spec(antecedent_span=[start, start + len(ante)])
    answers = [
        {"condition_ref": C_BREAK["condition_ref"], "raw_output": REFERRING_QUOTE},
        {"condition_ref": C_STOP["condition_ref"], "raw_output": Q_STOP},
    ]
    out = rt.run_route(transcript, [C_BREAK, C_STOP], answers, composition_specs=[spec])
    row = _by_ref(out)[C_BREAK["condition_ref"]]

    assert row["disposition"] == rt.RED_ANTECEDENT_UNBOUND
    assert "INTERVENING_REDEFINITION" in row["reason"]
    assert row["composition"]["intervening_redefinition"]


# --------------------------------------------------------------------------- #
# 4. THE SPEC ITSELF IS GUARDED
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "label,override",
    [
        ("no authority", {"authority": ""}),
        ("blank authority", {"authority": "   "}),
        ("no qualifier", {"qualifier": ""}),
    ],
)
def test_an_unauthored_or_empty_spec_is_refused_before_any_gate_runs(label, override):
    """AR-1243 §11 allows only caller-supplied definitions 'whose authority is explicit'. An
    unauthored spec is an invented per-video alias wearing a parameter's clothes."""
    with pytest.raises(ValueError):
        _run(specs=[_spec(**override)])


def test_a_spec_for_an_unknown_condition_is_a_join_error_not_a_silent_no_op():
    with pytest.raises(ValueError, match="not in this run"):
        _run(specs=[_spec(condition_ref="entry_sequence[99].action")])


def test_two_specs_for_one_condition_are_refused_rather_than_arbitrated():
    with pytest.raises(ValueError, match="two composition specs"):
        _run(specs=[_spec(), _spec(qualifier="one minute")])


# --------------------------------------------------------------------------- #
# 5. SCOPE HONESTY — what the record must not let a reader assume
# --------------------------------------------------------------------------- #


def test_a_spec_on_a_condition_stopped_earlier_records_that_composition_was_NOT_reached():
    """A bare missing `composition` reads identically to 'composition was not requested'. Those
    are different facts about what this run checked, so the row must distinguish them."""
    # A literal span of the source that is about NOTHING in either condition. It must not overlap
    # the stop quote either: an overlapping span is HELD by the collision gate, which is a
    # different earlier gate and would test a different thing than this test names.
    off_topic = "then we sit on our hands and let the market settle for a moment"
    assert off_topic in TRANSCRIPT and off_topic not in Q_STOP
    out = _run(
        specs=[_spec()],
        pairs=[
            (C_BREAK["condition_ref"], off_topic),
            (C_STOP["condition_ref"], Q_STOP),
        ],
    )
    row = _by_ref(out)[C_BREAK["condition_ref"]]

    assert row["disposition"] == rt.REFUSED_RELEVANCE
    assert row["composition"]["attempted"] is False
    assert row["composition"]["bound"] is False
    assert "NOT_REACHED" in row["composition"]["reason"]


def test_the_relevance_verdict_declares_it_was_computed_on_the_primary_span_alone():
    """Composition runs AFTER relevance (AR-1243 §12's order), so a composed row's green
    relevance verdict never saw the antecedent. The record must say so rather than let the
    reader assume relevance vetted both spans."""
    row = _by_ref(_run(specs=[_spec()]))[C_BREAK["condition_ref"]]
    assert row["relevance"]["evaluated_on"] == "primary_span_only"
    assert row["evidence_is_composed"] is True


def test_the_route_record_names_composition_in_its_gate_order_and_policy():
    out = _run(specs=[_spec()])
    assert any("antecedent" in g for g in out["gate_order"]), out["gate_order"]
    assert "never a merged paraphrase" in out["composition_policy"]
    # the fidelity gate must be named as running on possibly-composed evidence
    assert any("composed" in g for g in out["gate_order"])


# --------------------------------------------------------------------------- #
# 6. THE ESCALATION CONSTANT MUST STAY HONEST
# --------------------------------------------------------------------------- #


def test_the_new_disposition_is_registered_as_escalating_and_the_constant_is_not_decorative():
    """`ESCALATES_TO_ISOLATED` is a published contract about what G2-D will re-query. A
    disposition that blocks acceptance but is missing from it would be silently dropped from the
    fallback queue."""
    assert rt.RED_ANTECEDENT_UNBOUND in rt.ESCALATES_TO_ISOLATED

    blocking = {
        rt.REFUSED_NO_EVIDENCE, rt.REFUSED_NOT_LITERAL, rt.HELD_DUPLICATE_ROLE,
        rt.HELD_EVIDENCE_REUSE, rt.REFUSED_RELEVANCE, rt.RED_ANTECEDENT_UNBOUND,
        rt.RED_FIDELITY,
    }
    assert rt.ESCALATES_TO_ISOLATED == blocking, (
        "the escalation set and the set of blocking dispositions have diverged; one of them is "
        "lying about what the fallback will be asked to fix"
    )
    assert rt.ACCEPTED not in rt.ESCALATES_TO_ISOLATED


def test_without_any_spec_no_row_claims_composition_and_dispositions_are_unaffected():
    """THE NO-OP PROOF. G2-C must be inert until a caller authors a spec, or it would have
    changed the standing route artifact by merely existing."""
    out = _run(specs=None)
    for row in out["outcomes"]:
        assert row["composition"] is None
        assert row["evidence_is_composed"] is False
    assert _by_ref(out)[C_STOP["condition_ref"]]["disposition"] == rt.ACCEPTED
