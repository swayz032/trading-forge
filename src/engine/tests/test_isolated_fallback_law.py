"""G2-D0 — the frozen isolated-fallback selection law (AR-1247 §9).

The two controls the ruling names by hand are `test_a_condition_that_becomes_accepted_leaves…`
and `test_an_unregistered_blocking_disposition_is_detected…`. The rest pin the properties that
make the later expensive run auditable: one attempt, no retry, no best-of, raw preserved first,
and a selection that no caller can hand-write.

Synthetic route records only — the law must be source-agnostic.
"""

from __future__ import annotations

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction import opus_phase1_route as rt

PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}

TEXTS = {
    "c[0]": "Wait for a close outside of the five minute range.",
    "c[1]": "The stop goes at the bottom of the fair value candle including the wick.",
    "c[2]": "The target is a fixed two times risk on every trade.",
}


def _route(*dispositions):
    """A minimal route record shaped exactly like `run_route`'s return."""
    return {
        "route_version": rt.ROUTE_VERSION,
        "outcomes": [
            {"condition_ref": ref, "disposition": d, "gate": "g", "reason": "r"}
            for ref, d in zip(TEXTS, dispositions)
        ],
    }


def _freeze(*dispositions):
    return law.freeze_isolated_queue(_route(*dispositions), PINNED, TEXTS)


# --------------------------------------------------------------------------- #
# 1. THE TWO CONTROLS AR-1247 §9 NAMES
# --------------------------------------------------------------------------- #


def test_a_condition_that_becomes_accepted_leaves_the_isolated_queue():
    """§9's first named control. Same three conditions, one flipped blocking -> ACCEPTED."""
    blocking = _freeze(rt.REFUSED_RELEVANCE, rt.RED_FIDELITY, rt.RED_ANTECEDENT_UNBOUND)
    assert blocking.refs() == ["c[0]", "c[1]", "c[2]"]

    flipped = _freeze(rt.ACCEPTED, rt.RED_FIDELITY, rt.RED_ANTECEDENT_UNBOUND)
    assert flipped.refs() == ["c[1]", "c[2]"], "an ACCEPTED condition must drop out"
    assert any(e["condition_ref"] == "c[0]" for e in flipped.excluded)
    assert "ACCEPTED" in flipped.excluded[0]["why"]


def test_an_unregistered_blocking_disposition_is_detected_not_silently_dropped():
    """§9's second named control. A disposition that blocks acceptance but is absent from the
    route's published escalation contract must RAISE — dropping it would leave the condition
    looking handled while nothing ever re-queried it."""
    record = _route(rt.REFUSED_RELEVANCE, "HELD_SOMETHING_NOBODY_REGISTERED", rt.RED_FIDELITY)
    with pytest.raises(ValueError, match="NOT in the route's published"):
        law.freeze_isolated_queue(record, PINNED, TEXTS)


def test_the_unregistered_check_does_not_fire_on_a_fully_registered_route():
    """The discriminating control for the test above: it must not be always-red."""
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.RED_FIDELITY, rt.ACCEPTED)
    assert frozen.refs() == ["c[0]", "c[1]"]


# --------------------------------------------------------------------------- #
# 2. THE SELECTION CANNOT BE HAND-WRITTEN
# --------------------------------------------------------------------------- #


def test_there_is_no_parameter_through_which_a_caller_can_name_the_conditions():
    """§9: the law derives from route disposition, not a manually chosen list."""
    import inspect

    params = set(inspect.signature(law.freeze_isolated_queue).parameters)
    assert params == {"route_record", "pinned_inputs", "condition_texts"}
    # condition_texts supplies TEXT for refs the route already chose; it cannot add a ref
    frozen = law.freeze_isolated_queue(
        _route(rt.ACCEPTED, rt.RED_FIDELITY, rt.ACCEPTED),
        PINNED,
        {**TEXTS, "c[99]": "a condition the route never dispositioned"},
    )
    assert frozen.refs() == ["c[1]"], "an extra text entry must not create a queue entry"


def test_an_attempt_for_a_condition_outside_the_frozen_queue_is_refused():
    frozen = _freeze(rt.ACCEPTED, rt.RED_FIDELITY, rt.ACCEPTED)
    with pytest.raises(ValueError, match="not in the frozen queue"):
        law.record_attempt(frozen, "c[0]")


# --------------------------------------------------------------------------- #
# 3. ONE ATTEMPT, NO RETRY, NO OVERWRITE
# --------------------------------------------------------------------------- #


def test_one_attempt_per_condition_and_the_second_is_refused():
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED)
    law.record_attempt(frozen, "c[0]")
    with pytest.raises(ValueError, match="already used its 1 permitted"):
        law.record_attempt(frozen, "c[0]")


def test_a_disappointing_answer_cannot_be_discarded_and_retried():
    """The attempt is claimed BEFORE the answer is known, so a bad answer has already spent the
    budget. This is the retry-until-green loop closed at the ledger rather than by policy."""
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED)
    law.record_attempt(frozen, "c[0]")
    law.substitute_isolated_answer(frozen, "c[0]", "a quote that will turn out to be worse")
    with pytest.raises(ValueError, match="already used its 1 permitted"):
        law.record_attempt(frozen, "c[0]")


def test_a_stored_raw_answer_cannot_be_overwritten():
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED)
    law.record_attempt(frozen, "c[0]")
    law.substitute_isolated_answer(frozen, "c[0]", "first and only")
    with pytest.raises(ValueError, match="already has a stored isolated answer"):
        law.substitute_isolated_answer(frozen, "c[0]", "a nicer second answer")


def test_an_answer_with_no_recorded_attempt_is_refused():
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED)
    with pytest.raises(ValueError, match="no attempt was recorded"):
        law.substitute_isolated_answer(frozen, "c[0]", "an answer that skipped the ledger")


def test_the_raw_return_is_preserved_verbatim_before_any_parsing():
    """§9: raw isolated output preserved before parse/verification."""
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED)
    law.record_attempt(frozen, "c[0]")
    messy = '  {"quote": "we wait for a close"}  \n\ntrailing model chatter'
    a = law.substitute_isolated_answer(frozen, "c[0]", messy)
    assert a["raw_output"] == messy, "the raw return was altered before it was stored"
    assert a["completed"] is True


def test_the_module_offers_no_way_to_compare_batch_against_isolated():
    """§9 forbids best-of cherry-picking. The strongest form of that guarantee is that no such
    API exists — a policy can be forgotten, a missing function cannot be called."""
    public = set(law.__all__)
    for banned in ("compare", "best_of", "choose", "prefer", "score", "rank"):
        assert not any(banned in name.lower() for name in public), banned
    import inspect

    src = inspect.getsource(law).lower()
    assert "batch_answer" not in src, "the law must not read the batch candidate at all"


# --------------------------------------------------------------------------- #
# 4. THE FREEZE IS IDENTIFIED AND PINNED
# --------------------------------------------------------------------------- #


def test_the_frozen_artifact_pins_every_item_the_ruling_lists():
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.RED_FIDELITY, rt.ACCEPTED)
    d = frozen.as_dict()
    assert d["input_route_version"] == rt.ROUTE_VERSION
    assert d["max_attempts_per_condition"] == 1
    assert set(d["eligible_dispositions"]) == set(rt.ESCALATES_TO_ISOLATED)
    assert d["pinned_inputs"] == dict(sorted(PINNED.items()))
    assert d["substitution_rule"] == law.SUBSTITUTION_RULE
    assert all(e["task_input_sha256"] for e in d["queue"])


def test_the_substitution_rule_is_hashed_so_a_later_edit_is_detectable():
    frozen = _freeze(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED)
    import hashlib

    expected = hashlib.sha256(law.SUBSTITUTION_RULE.encode("utf-8")).hexdigest()
    assert frozen.substitution_rule_sha256 == expected
    # and the rule really does forbid the two things it claims to
    assert "worse isolated answer does not restore the batch candidate" in law.SUBSTITUTION_RULE
    assert "no way to keep whichever grades greener" in law.SUBSTITUTION_RULE


def test_the_task_hash_changes_when_the_pinned_inputs_change():
    """A hash that does not move when the inputs move would certify nothing."""
    a = law.freeze_isolated_queue(_route(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED),
                                  PINNED, TEXTS)
    b = law.freeze_isolated_queue(_route(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED),
                                  {**PINNED, "transcript_sha256": "c" * 64}, TEXTS)
    assert a.queue[0]["task_input_sha256"] != b.queue[0]["task_input_sha256"]
    # and it is stable across identical freezes
    c = law.freeze_isolated_queue(_route(rt.REFUSED_RELEVANCE, rt.ACCEPTED, rt.ACCEPTED),
                                  PINNED, TEXTS)
    assert a.queue[0]["task_input_sha256"] == c.queue[0]["task_input_sha256"]


def test_an_unidentified_route_or_unpinned_inputs_are_refused():
    with pytest.raises(ValueError, match="no `route_version`"):
        law.freeze_isolated_queue({"outcomes": []}, PINNED, TEXTS)
    with pytest.raises(ValueError, match="no pinned inputs"):
        law.freeze_isolated_queue(_route(rt.REFUSED_RELEVANCE), {}, TEXTS)


def test_a_queued_condition_with_no_text_is_refused():
    with pytest.raises(ValueError, match="no condition text"):
        law.freeze_isolated_queue(_route(rt.REFUSED_RELEVANCE), PINNED, {})


def test_the_law_contains_no_source_specific_strings():
    import inspect

    src = inspect.getsource(law).lower()
    for banned in ("svkm", "fair value", "nasdaq", "9:30", "opening range", "五"):
        assert banned not in src, f"the law hardcodes a source-specific string: {banned!r}"
