"""AR-1224 §5 REDS A–D for the evidence-relevance / grounding gate.

Every quote below is a REAL span from the committed pinned transcript, so these are witnesses
against the actual defect rather than synthetic strings.

The defining witness (RED A) is the `19546` disclaimer that six different executable conditions
were all anchored to.
"""
from __future__ import annotations

import hashlib
import pathlib

import pytest

from src.engine.extraction.evidence_relevance import evaluate_evidence_relevance

PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
FIXTURE = (
    pathlib.Path(__file__).resolve().parents[3]
    / "src" / "engine" / "extraction" / "fixtures" / "source-evidence"
    / "sVkmZklJDHI.transcript.txt"
)

# The extraction's real condition texts (test data — never in the module).
C_TARGET = "The strategy uses a fixed mechanical target based on a 2R risk-to-reward ratio."
C_BREAKOUT = "The 1m candle must close outside of the initial 5m range."
C_STOP = "The stop loss is placed at the low of the fair value gap, including the wick."
C_ENTRY3 = "Enter on the closure of the third candle of the FVG sequence."
C_SESSION = "The trade must be initiated during the 9:30 AM ET New York session."

ALL_CONDITIONS = [C_TARGET, C_BREAKOUT, C_STOP, C_ENTRY3, C_SESSION]


@pytest.fixture(scope="module")
def transcript() -> str:
    text = FIXTURE.read_text(encoding="utf-8", newline="")
    assert hashlib.sha256(text.encode("utf-8")).hexdigest() == PIN
    return text


def _rivals(own: str) -> list[str]:
    return [c for c in ALL_CONDITIONS if c != own]


# --------------------------------------------------------------------------- #
# RED A — the defining witness: exact, literal, and about the wrong thing
# --------------------------------------------------------------------------- #


def test_red_a_the_disclaimer_span_grounds_none_of_the_conditions(transcript):
    """🛑 THE DEFECT. The real char-19546 span — a generic loss disclaimer — was accepted as the
    anchor for SIX different entry/stop/target conditions because it is literally present.

    Literal presence must PASS (it is real text) and relevance must FAIL.
    """
    disclaimer = transcript[19546:19757]
    assert "not perfect" in disclaimer, "fixture drift: this is not the disclaimer span"

    for condition in ALL_CONDITIONS:
        v = evaluate_evidence_relevance(condition, disclaimer, _rivals(condition), source_document=transcript)
        assert not v.grounded, (
            f"the disclaimer was accepted as evidence for {condition!r}: {v.reason}"
        )
        assert v.reason.startswith("MISGROUNDED"), v.reason


# --------------------------------------------------------------------------- #
# RED B / C / D — positive controls. Without these the gate could just always fail.
# --------------------------------------------------------------------------- #


def test_red_b_the_real_2R_span_grounds_the_target_condition(transcript):
    i = transcript.find("the fixed target we're looking for is a risk-to-reward ratio of two")
    assert i >= 0
    quote = transcript[i:i + 120]
    v = evaluate_evidence_relevance(C_TARGET, quote, _rivals(C_TARGET), source_document=transcript)
    assert v.grounded, v.reason


def test_red_c_the_real_breakout_span_grounds_the_breakout_condition(transcript):
    i = transcript.find("the candles need to close outside of this 5m minute range")
    assert i >= 0
    quote = transcript[i - 120:i + 80]
    v = evaluate_evidence_relevance(C_BREAKOUT, quote, _rivals(C_BREAKOUT), source_document=transcript)
    assert v.grounded, v.reason


def test_red_d_the_real_stop_span_grounds_the_stop_condition(transcript):
    i = transcript.find("we would put our stop to the low of the fair value gap")
    if i < 0:
        i = transcript.find("put our stop to the low of the fair value gap")
    assert i >= 0
    quote = transcript[i:i + 110]
    v = evaluate_evidence_relevance(C_STOP, quote, _rivals(C_STOP), source_document=transcript)
    assert v.grounded, v.reason


def test_red_d_relevance_pass_does_not_settle_executable_geometry(transcript):
    """AR-1224 §5 RED D's second half: a relevance PASS must not be readable as an exact stop
    primitive. The verdict object carries no geometry, no anchor and no price — by construction
    it cannot be mistaken for one."""
    i = transcript.find("put our stop to the low of the fair value gap")
    v = evaluate_evidence_relevance(C_STOP, transcript[i:i + 110], _rivals(C_STOP), source_document=transcript)
    assert v.grounded
    for forbidden in ("anchor", "stop_price", "geometry", "fvg_low", "displacement"):
        assert not hasattr(v, forbidden), f"the relevance verdict leaks {forbidden!r}"


# --------------------------------------------------------------------------- #
# Paraphrase safety — the failure class AR-1224 §4 warned a keyword rule would cause
# --------------------------------------------------------------------------- #


def test_a_faithful_paraphrase_is_not_rejected():
    """The educator and the extractor legitimately use different words. A RELATIVE gate must
    still pass a paraphrase that shares little absolute vocabulary, because it resembles its own
    condition more than the rivals."""
    condition = "Enter on the closure of the third candle of the FVG sequence."
    paraphrase = "my entry is going to be on the closure of that third candle"
    v = evaluate_evidence_relevance(condition, paraphrase, _rivals(C_ENTRY3))
    assert v.grounded, v.reason


def test_no_rivals_yields_an_explicitly_weak_pass():
    """Without a comparison set the discriminating question cannot be asked. The gate must say
    so rather than reporting a confident pass."""
    v = evaluate_evidence_relevance(C_TARGET, "a risk-to-reward ratio of two", [])
    assert v.grounded
    assert "WEAK_PASS" in v.reason


def test_refusals_are_not_silent_passes():
    assert not evaluate_evidence_relevance("", "anything").grounded
    assert not evaluate_evidence_relevance(C_TARGET, "").grounded
    assert "NO_EVIDENCE" in evaluate_evidence_relevance(C_TARGET, "").reason


def test_module_contains_no_source_specific_strings():
    import inspect

    from src.engine.extraction import evidence_relevance as m

    src = inspect.getsource(m).lower()
    for banned in ("svkm", "fair value", "nasdaq", "9:30", "fvg", "risk-to-reward"):
        assert banned not in src, f"module hardcodes source-specific string: {banned!r}"
