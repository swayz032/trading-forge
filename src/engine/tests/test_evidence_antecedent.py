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

    Constructed by moving the antecedent EARLIER so that the real defining sentence
    ("mark ... the low", which yields the range) falls inside the gap. This is a real
    intervening definition from the actual source, not a synthetic string.
    """
    early = transcript.find("So again, 9:30 a.m. Eastern time, go on the 5-minute candle.")
    assert 0 <= early < REFERRING.start
    r = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS, REFERRING,
        Span(early, early + 200), ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    assert not r.bound
    assert "INTERVENING_REDEFINITION" in r.reason
    assert r.intervening_redefinition


def test_module_contains_no_source_specific_strings():
    """Same structural rule as the fidelity detector: the domain lives in the caller."""
    import inspect

    from src.engine.extraction import evidence_antecedent as m

    src = inspect.getsource(m).lower()
    for banned in ("svkm", "fair value", "nasdaq", "9:30", "5m", "initial 5m", "opening range"):
        assert banned not in src, f"module hardcodes source-specific string: {banned!r}"
