"""Anchor-locator birth fixtures (Wave-4, pre-reg addendum 3 -- A-prime).

Birth-gates the MECHANICAL verifier deterministically -- no gemma call is
ever made; `propose_fn` is injected in every test. Covers the 5 states the
brief requires:
  1. locates-known            -- correct injected proposal -> LOCATED, span resolves.
  2. abstains-on-ungroundable -- gemma-stub returns None -> UNANCHORED(locator_declined).
  3. literal-only guard       -- non-substring (hallucinated) proposal -> UNANCHORED
                                  (proposed_quote_not_literal_substring).
  4. whitespace-normalization-only -- whitespace-only diff -> LOCATED; a
                                  single-token diff -> UNANCHORED.
  5. assembler parity         -- a LOCATED anchor, fed as a Tier1Detection,
                                  satisfies cert_assembler's every_anchor_resolves
                                  invariant (same f2_coverage_gate authority).

Imports ONLY the pure-stdlib extraction package (no vectorbt / no
backtester), matching test_cert_assembler.py / test_compile_lints.py.
"""

from src.engine.extraction.anchor_locator import (
    REASON_LOCATOR_DECLINED,
    REASON_NOT_LITERAL_SUBSTRING,
    _resolves_as_anchor,
    _verify_and_locate,
    locate_anchor,
)
from src.engine.extraction.cert_assembler import assemble_certificate
from src.engine.extraction.tier1_detectors import Tier1Detection

TRANSCRIPT = (
    "We enter long when RSI  crosses\nabove 30 on the chart during the "
    "New York session, and the stop goes below the recent swing low."
)


# --------------------------------------------------------------------------- #
# 1. locates-known
# --------------------------------------------------------------------------- #


def test_locates_known_via_verify_and_locate_directly():
    span = _verify_and_locate(TRANSCRIPT, "RSI crosses above 30")
    assert span is not None
    assert TRANSCRIPT[span[0]:span[1]] == "RSI  crosses\nabove 30"


def test_locates_known_end_to_end_with_stubbed_gemma():
    def stub_propose(transcript, condition_text):
        assert transcript == TRANSCRIPT
        return "RSI crosses above 30"

    result = locate_anchor(TRANSCRIPT, "entry trigger: RSI > 30", propose_fn=stub_propose)
    assert result.located is True
    assert result.reason is None
    s, e = result.char_span
    assert TRANSCRIPT[s:e] == result.quote
    assert result.quote == "RSI  crosses\nabove 30"


# --------------------------------------------------------------------------- #
# 2. abstains-on-ungroundable
# --------------------------------------------------------------------------- #


def test_abstains_on_ungroundable_when_gemma_declines():
    def stub_decline(transcript, condition_text):
        return None

    result = locate_anchor(TRANSCRIPT, "some condition with no grounding", propose_fn=stub_decline)
    assert result.located is False
    assert result.reason == REASON_LOCATOR_DECLINED
    assert result.quote is None
    assert result.char_span is None


# --------------------------------------------------------------------------- #
# 3. literal-only (hallucination guard)
# --------------------------------------------------------------------------- #


def test_hallucinated_paraphrase_is_not_literal_substring():
    def stub_hallucinate(transcript, condition_text):
        return "MACD crosses above the zero line"  # never appears verbatim

    result = locate_anchor(TRANSCRIPT, "entry trigger", propose_fn=stub_hallucinate)
    assert result.located is False
    assert result.reason == REASON_NOT_LITERAL_SUBSTRING
    assert result.quote is None
    assert result.char_span is None


def test_hallucinated_paraphrase_rejected_directly():
    assert _verify_and_locate(TRANSCRIPT, "MACD crosses above the zero line") is None


# --------------------------------------------------------------------------- #
# 4. whitespace-normalization-only (not fuzzy)
# --------------------------------------------------------------------------- #


def test_whitespace_only_difference_is_accepted():
    # transcript has a double-space + newline inside "crosses\nabove"; the
    # proposal is clean single-spaced -- must still resolve.
    span = _verify_and_locate(TRANSCRIPT, "RSI crosses above 30")
    assert span is not None


def test_extra_whitespace_and_newlines_in_proposal_also_accepted():
    span = _verify_and_locate(TRANSCRIPT, "  RSI\n\ncrosses   above 30  ")
    assert span is not None
    assert TRANSCRIPT[span[0]:span[1]] == "RSI  crosses\nabove 30"


def test_single_token_difference_is_rejected():
    # "30" -> "40": a token change, not a whitespace change -- must fail.
    assert _verify_and_locate(TRANSCRIPT, "RSI crosses above 40") is None


def test_single_word_substitution_is_rejected():
    assert _verify_and_locate(TRANSCRIPT, "RSI moves above 30") is None


# --------------------------------------------------------------------------- #
# word-boundary discipline (F-2 collision class), via the reused authority
# --------------------------------------------------------------------------- #


def test_midword_match_does_not_resolve_as_anchor():
    transcript = "the stock is arranged neatly on the range."
    # "range" occurs mid-word inside "arranged" first, then as a real token
    # later -- the locator must skip the mid-word hit and resolve the real one.
    span = _verify_and_locate(transcript, "range")
    assert span is not None
    assert transcript[span[0]:span[1]] == "range"
    assert span[0] == transcript.rindex("range")  # the standalone occurrence, not "arranged"


def test_resolves_as_anchor_rejects_midword_span_directly():
    transcript = "the stock is arranged neatly."
    start = transcript.index("arranged") + 2  # "range" inside "aRRANGEd"
    midword_span = (start, start + len("range"))
    assert transcript[midword_span[0]:midword_span[1]] == "range"
    assert _resolves_as_anchor(transcript, "range", midword_span) is False


# --------------------------------------------------------------------------- #
# 5. assembler parity -- REUSED authority, not a divergent check
# --------------------------------------------------------------------------- #


def test_located_anchor_satisfies_cert_assembler_every_anchor_resolves():
    def stub_propose(transcript, condition_text):
        return "the stop goes below the recent swing low"

    result = locate_anchor(TRANSCRIPT, "stop placement rule", propose_fn=stub_propose)
    assert result.located is True

    detection = Tier1Detection(
        surface_class="stop",
        quote_anchor=result.quote,
        char_span=result.char_span,
    )
    cert = assemble_certificate(
        full_transcript=TRANSCRIPT,
        full_transcript_sha256="sha-anchor-locator-test",
        source_video_id="v-anchor-test",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[detection],
        tier1_fallthroughs=[],
    )
    assert cert["conditions"]
    for c in cert["conditions"]:
        s, e = c["char_span"]
        assert TRANSCRIPT[s:e] == c["quote_anchor"]
    assert cert["compile_integrity"]["f2_coverage_gate"]["status"] == "PASS"
    assert cert["pilot_grade"] is True
