"""AR-1206 LANE B acceptance tests — antecedent binding for the `initial` qualifier.

The ruling's acceptance criterion, verbatim:

    removing the antecedent breaks support for `initial`, while restoring the correct
    antecedent repairs it. That is a better deterministic regression than repeatedly
    widening prose windows.

These run against the COMMITTED pinned transcript fixture, so every offset below is
reconstructable from GitHub by anyone — no local-only evidence.
"""
from __future__ import annotations

import hashlib
import pathlib

import pytest

from src.engine.extraction.evidence_antecedent import (
    Span,
    bind_qualifier_to_antecedent,
)

PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
FIXTURE = (
    pathlib.Path(__file__).resolve().parents[3]
    / "src" / "engine" / "extraction" / "fixtures" / "source-evidence"
    / "sVkmZklJDHI.transcript.txt"
)

# The rule that refers to the range deictically ("this 5m minute range").
REFERRING = Span(9294, 9512)

# Domain vocabulary lives HERE, in the test, never in the module.
QUALIFIER = "initial"
QUALIFIER_SYNONYMS = ("first", "initial", "opening")
ENTITY_TERMS = ("range",)
DEFINITIONAL_MARKERS = ("mark", "draw", "define", "gives me", "gives us")


@pytest.fixture(scope="module")
def transcript() -> str:
    text = FIXTURE.read_text(encoding="utf-8", newline="")
    assert hashlib.sha256(text.encode("utf-8")).hexdigest() == PIN, "fixture is not the pin"
    return text


def _antecedent(transcript: str) -> Span:
    """The already-CONFIRMED defining step: the first 5 minutes' high and low."""
    start = transcript.find("And what that now gives me is a range on the five minute.")
    end = transcript.find("that's how low it went.") + len("that's how low it went.")
    assert start >= 0 and end > start
    return Span(start, end)


def test_the_pinned_spans_are_what_we_think_they_are(transcript):
    """Positive control: the fixture really contains both spans, and the referring span
    really is the deictic one. Without this the rest is assertion about nothing."""
    assert "first 5 minutes" in _antecedent(transcript).text(transcript)
    ref = REFERRING.text(transcript)
    assert "this 5m minute range" in ref
    assert "initial" not in ref, "the referring span must NOT already contain the qualifier"


def test_initial_is_bound_by_the_antecedent(transcript):
    """GREEN: with the correct antecedent, `initial` is carried by composition."""
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        _antecedent(transcript), ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert r.bound, r.reason


def test_removing_the_antecedent_breaks_support(transcript):
    """RED: the ruling's exact acceptance criterion — remove it and support breaks."""
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        None, ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "NO_ANTECEDENT" in r.reason


def test_an_antecedent_that_does_not_state_the_qualifier_does_not_bind(transcript):
    """A span that precedes but never says first/initial/opening cannot ground it.
    Uses the session-time sentence, which is real source text about a different fact."""
    start = transcript.find("So, this strategy needs to be traded at")
    end = transcript.find("New York time.") + len("New York time.")
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        Span(start, end), ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "QUALIFIER_UNGROUNDED" in r.reason


def test_an_antecedent_after_the_reference_cannot_bind_backwards(transcript):
    """Order check: a later definition may not be carried backwards."""
    later = transcript.find("this first 5m minute 9:30 candle")
    assert later > REFERRING.start
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        Span(later, later + 120), ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "ORDER_VIOLATION" in r.reason


def test_an_intervening_redefinition_blocks_the_binding(transcript):
    """🛑 THE SAFETY CHECK. If the entity is defined again between antecedent and
    reference, the deictic may point at the newer one — so binding must refuse.

    RETARGETED under AR-1247 F-1, and the retarget is itself the finding. This test used to
    move the ANTECEDENT earlier, to a span beginning "So again, 9:30 a.m. Eastern time…".
    That span never contains the word `range` at all — so once the same-entity check existed,
    it refused at `ENTITY_ABSENT_AT_ANTECEDENT` and the redefinition branch was never reached.
    The old test was green because the binding refused, not because check 4 ran. See
    `test_the_old_redefinition_fixture_never_established_the_entity` below, which pins that.

    The real source does define the range twice, so a genuine fixture exists: keep the
    CONFIRMED antecedent and move the REFERENCE later, past the second definition at
    "if I was to draw out the range with more of a structure like this". Both definitions and
    the deictic are real transcript text.
    """
    ante = _antecedent(transcript)
    second_definition = transcript.find("if I was to draw out the range with more of a structure")
    later_ref_start = transcript.find("this range, it means that the price is going down")
    assert 0 <= ante.end < second_definition < later_ref_start, "fixture ordering broke"

    later_ref = Span(later_ref_start, later_ref_start + 120)
    assert "range" in later_ref.text(transcript), "the later reference must name the entity"

    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, later_ref,
        ante, ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "INTERVENING_REDEFINITION" in r.reason, r.reason
    assert r.intervening_redefinition
    assert "draw" in r.intervening_redefinition.lower()


def test_the_old_redefinition_fixture_never_established_the_entity(transcript):
    """AR-1247 F-1, pinned on real data. The span this suite previously used as an antecedent
    does not name the entity at all, so under the pre-F-1 helper it reached — and passed — the
    redefinition check on an entity that had never been established. Order + grounding +
    no-redefinition were not sufficient, exactly as GPT found.

    Kept as a permanent negative so the retarget above cannot be quietly reverted."""
    early = transcript.find("So again, 9:30 a.m. Eastern time, go on the 5-minute candle.")
    assert 0 <= early < REFERRING.start
    span = Span(early, early + 200)
    assert "range" not in span.text(transcript).lower(), (
        "this fixture is only meaningful while the span genuinely lacks the entity"
    )
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        span, ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "ENTITY_ABSENT_AT_ANTECEDENT" in r.reason, r.reason


# --------------------------------------------------------------------------- #
# AR-1247 F-1 / F-2 — the same-entity invariant and the non-vacuous vocabulary
# --------------------------------------------------------------------------- #


def test_an_antecedent_about_the_wrong_object_cannot_carry_the_qualifier(transcript):
    """F-1's conceptual discriminator, on real text. The session-time sentence contains the
    qualifier synonym but is about a different object entirely; it must not bind."""
    start = transcript.find("So, this strategy needs to be traded at")
    end = transcript.find("New York time.") + len("New York time.")
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        Span(start, end), ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    # it fails at grounding or at the entity check — either is a refusal, never a bind
    assert r.reason.split(":")[0] in {"QUALIFIER_UNGROUNDED", "ENTITY_ABSENT_AT_ANTECEDENT"}


def test_an_antecedent_that_mentions_the_entity_but_never_defines_it_does_not_bind(transcript):
    """G. A passing mention is not the definition a deictic points at, so a marker-free
    antecedent must refuse even though the entity and qualifier are both present."""
    ante = _antecedent(transcript)
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        ante, ENTITY_TERMS, ("no_such_marker_appears_anywhere",),
    )
    assert not r.bound
    assert "ANTECEDENT_DOES_NOT_DEFINE" in r.reason, r.reason


def test_a_reference_that_does_not_name_the_entity_has_nothing_to_carry_across(transcript):
    """F. Without the entity at the referring end there is no shared object, so the qualifier
    has no link to travel along."""
    ante = _antecedent(transcript)
    # Must sit AFTER the antecedent, or the order check fires first and this proves nothing.
    literal = "Now knowing those levels on their own doesn't really mean anything."
    start = transcript.find(literal)
    ref = Span(start, start + len(literal))
    assert "range" not in ref.text(transcript).lower()
    assert ante.end <= ref.start, "the reference must follow the antecedent"
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, ref,
        ante, ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "ENTITY_ABSENT_AT_REFERENCE" in r.reason, r.reason


@pytest.mark.parametrize(
    "label,entity,markers,expect",
    [
        ("empty entity vocabulary", (), DEFINITIONAL_MARKERS, "VACUOUS_ENTITY_VOCABULARY"),
        ("empty definitional vocabulary", ENTITY_TERMS, (), "VACUOUS_DEFINITIONAL_VOCABULARY"),
    ],
)
def test_an_empty_vocabulary_is_itself_a_refusal(transcript, label, entity, markers, expect):
    """F-2. With nothing declared, the same-entity and redefinition checks cannot fail — the
    gate goes vacuous while the receipt still reads like a governed binding."""
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        _antecedent(transcript), entity, markers,
    )
    assert not r.bound, label
    assert expect in r.reason, r.reason


@pytest.mark.parametrize(
    "label,span",
    [
        ("negative start", Span(-50, 100)),
        ("inverted", Span(900, 100)),
        ("end beyond the transcript", Span(10, 10**9)),
        ("empty span", Span(100, 100)),
    ],
)
def test_an_out_of_bounds_span_is_refused_rather_than_silently_sliced(transcript, label, span):
    """F-2. Python does not raise on a bad slice — it returns different text, and that text
    would become the provenance."""
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        span, ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound, label
    assert "SPAN_OUT_OF_BOUNDS" in r.reason, r.reason


def test_module_contains_no_source_specific_strings():
    """Same structural rule as the fidelity detector: the domain lives in the caller."""
    import inspect

    from src.engine.extraction import evidence_antecedent as m

    src = inspect.getsource(m).lower()
    for banned in ("svkm", "fair value", "nasdaq", "9:30", "5m", "initial 5m", "opening range"):
        assert banned not in src, f"module hardcodes source-specific string: {banned!r}"
