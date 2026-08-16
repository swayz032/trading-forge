"""AR-1239 §4 — term-equivalence normalization for relevance. Every control §4 names.

The pressure this module lives under is that widening it always makes some refused condition
pass. So the controls are weighted toward what must STILL FAIL, and the two that matter most
are: the AR-1223 disclaimer misgroundings, and an unknown near-synonym that would improve a
grade. If either ever flips, the seam has become a grade-fixing device.
"""

from __future__ import annotations

import os

import pytest

from src.engine.extraction import term_equivalence as te
from src.engine.extraction.evidence_relevance import evaluate_evidence_relevance

# The real teaching passage and the real disclaimer, both from the pinned slice. They are
# EVIDENCE FIXTURES for a discrimination test, not answers wired into any module.
DISCLAIMER = "I do want to reiterate that this model is not perfect. You are going to lose on this model"
SOURCE_DOC = (
    "at 9:30 we mark the high and the low of the first five minute candle to form our range. "
    "then we wait for a one minute candle to close outside of that five minute range. "
    "what we are looking for is a fair value gap sequence printing outside of the range. "
    "my entry is on the closure of that third candle. "
    "the stop goes at the bottom of the fair value candle, include the wick. "
    "the fixed target is a risk to reward ratio of two. " + DISCLAIMER
)


def _rel(condition, quote, rivals=()):
    return evaluate_evidence_relevance(
        condition_text=condition, quote=quote,
        rival_conditions=list(rivals), source_document=SOURCE_DOC,
    )


# --------------------------------------------------------------------------- #
# §4 control 1 — FVG <-> fair value gap
# --------------------------------------------------------------------------- #


def test_control_1_abbreviation_and_expansion_are_the_same_concept():
    assert "eq_fair_value_gap" in te.equivalence_tokens("wait for the FVG to form")
    assert "eq_fair_value_gap" in te.equivalence_tokens("wait for the fair value gap to form")


def test_control_1_end_to_end_the_normalised_paraphrase_is_no_longer_refused():
    """THE AR-1225 FALSE REJECT, closed. The condition uses the abbreviation, the source uses
    the expansion; before this seam they shared no content term at all."""
    v = _rel(
        "A FVG sequence must print outside the range.",
        "what we are looking for is a fair value gap sequence printing outside of the range",
        rivals=["The stop goes at the bottom of the candle.", "The target is two times risk."],
    )
    assert v.grounded, v.reason


# --------------------------------------------------------------------------- #
# §4 control 2 — timeframe forms
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("text", ["1m candle", "1-minute candle", "one minute candle",
                                  "1 min candle", "1minute candle"])
def test_control_2_all_one_minute_forms_canonicalise_together(text):
    assert "tf_min_1" in te.equivalence_tokens(text)


def test_control_2_different_timeframes_do_NOT_collapse():
    """DISCRIMINATOR: if every timeframe folded to one token the rule would be worse than
    nothing — it would make a 5m condition match a 1m span."""
    assert "tf_min_5" not in te.equivalence_tokens("one minute candle")
    assert "tf_min_1" not in te.equivalence_tokens("five minute range")


def test_control_2_the_rule_generalises_beyond_any_written_list():
    """It is morphology, not a lookup: nobody wrote these down."""
    assert "tf_min_7" in te.equivalence_tokens("a 7-minute chart")
    assert "tf_min_45" in te.equivalence_tokens("the forty-five minute chart")
    assert "tf_hour_4" in te.equivalence_tokens("the 4h bias")


# --------------------------------------------------------------------------- #
# §4 controls 3 + 4 — WHAT MUST STILL FAIL
# --------------------------------------------------------------------------- #

_AR1223_MISGROUNDED = [
    "At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle.",
    "Wait for the 1-minute candle to close outside of the established 5-minute range.",
    "Wait for a Fair Value Gap (FVG) sequence to form outside of the 5-minute range.",
    "Enter the trade on the closure of the third candle of the FVG sequence.",
    "The stop is placed at the bottom of the fair value candle including the wick.",
    "The target is a fixed 2R.",
]


@pytest.mark.parametrize("condition", _AR1223_MISGROUNDED)
def test_control_3_the_six_AR1223_disclaimer_misgroundings_STILL_FAIL(condition):
    """THE CONTROL THAT MATTERS MOST. Normalization must not rescue the generic disclaimer —
    that cluster is why the relevance gate exists at all. Note these conditions are exactly
    the ones normalization HELPS elsewhere, so this is a real test of the boundary."""
    rivals = [c for c in _AR1223_MISGROUNDED if c != condition]
    v = _rel(condition, DISCLAIMER, rivals=rivals)
    assert not v.grounded, f"the disclaimer was rescued by normalization: {v.reason}"


def test_control_4_a_literal_but_wrong_topic_quote_still_fails():
    v = _rel(
        "The target is a fixed 2R.",
        "the stop goes at the bottom of the fair value candle, include the wick",
        rivals=["The stop is placed at the bottom of the fair value candle including the wick."],
    )
    assert not v.grounded, v.reason


# --------------------------------------------------------------------------- #
# §4 control 5 — an unknown near-synonym does NOT become equivalent
# --------------------------------------------------------------------------- #


def test_control_5_an_unknown_near_synonym_is_not_equivalent_however_convenient():
    """`imbalance` and `inefficiency` are what traders often call the same structure. They are
    NOT in the reviewed table, so they are NOT equivalent here. Adding them because it would
    make a condition pass is the precise failure this module is built to refuse."""
    assert te.equivalence_tokens("wait for the imbalance to form") == set()
    assert te.equivalence_tokens("price leaves an inefficiency") == set()
    assert "eq_fair_value_gap" not in te.equivalence_tokens("wait for the imbalance")


def test_control_5_ambiguous_bare_abbreviations_do_not_fire_on_ordinary_english():
    """`or` and `ob` are ordinary tokens. A bare-word mapping would fire on conjunctions and
    turn every condition into an opening-range condition."""
    assert "eq_opening_range" not in te.equivalence_tokens("enter long or short")
    assert "eq_opening_range" in te.equivalence_tokens("mark the opening range")


# --------------------------------------------------------------------------- #
# §4 control 6 — relevance only, NEVER fidelity strength
# --------------------------------------------------------------------------- #


def test_control_6_the_fidelity_guard_does_not_import_this_seam():
    """The ownership boundary §4 drew, asserted mechanically rather than promised in prose."""
    import src.engine.extraction.source_fidelity_guard as sfg
    body = open(sfg.__file__, encoding="utf-8").read()
    assert "term_equivalence" not in body
    assert not hasattr(sfg, "equivalence_tokens")


def test_control_6_normalization_cannot_soften_an_inflated_claim():
    """Same condition, same evidence, run through fidelity: the abbreviation/expansion mismatch
    must not turn an unsupported certainty claim into a supported one."""
    from src.engine.extraction.source_fidelity_guard import check_condition_fidelity
    kinds = {f.kind for f in check_condition_fidelity(
        "Entering on the closure confirms the FVG structure.",
        ["what we are looking for is a fair value gap sequence printing outside of the range"],
    )}
    assert "UNSUPPORTED_CERTAINTY" in kinds


# --------------------------------------------------------------------------- #
# §4 control 7 — no source pins, and the scanner is proven live
# --------------------------------------------------------------------------- #

_SOURCE_SPECIFIC = [
    "sVkmZklJDHI",
    "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc",
    "19546", "14488", "not perfect",
]


def test_control_7_the_equivalence_table_carries_no_source_pin_or_answer_span():
    body = open(os.path.join(os.path.dirname(te.__file__), "term_equivalence.py"),
                encoding="utf-8").read()
    hits = [n for n in _SOURCE_SPECIFIC if n in body]
    assert hits == [], f"source-specific material in a global vocabulary module: {hits}"
    assert [n for n in _SOURCE_SPECIFIC if n in body + "\nV='sVkmZklJDHI'"], "scanner is dead"


def test_every_abbreviation_row_states_where_it_is_established():
    """A table entry with no cited authority is someone's guess with a version number on it."""
    for row in te.describe()["abbreviations"]:
        assert row["established_by"].strip(), row
        assert row["forms"], row
