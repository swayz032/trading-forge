"""RED TESTS for the source-fidelity birth gate (AR-1204 §6 LANE 1).

Contract, verbatim from AR-1204 §6:

    normalized terminology is allowed; unsupported certainty, modifiers,
    timing windows, quantities, and causal claims are not.

The guard therefore inspects EPISTEMIC language only — certainty verbs, hedges,
probability/quality modifiers, temporal quantifiers, quantities. It never matches
domain nouns, which is precisely why AR-1204 §2's correction holds by construction:
`broken out of` supports `breakout` because the guard never looks at either word.

Every case below is drawn from the AR-1203 blind-rater verdict on the pinned sVkm
transcript, but the GUARD ITSELF CONTAINS NO sVkm STRINGS (AR-1204 §6: "The repair
must be generic. No sVkm-specific strings in production logic.").
"""
from __future__ import annotations

import pytest

from src.engine.extraction.source_fidelity_guard import (
    FidelityFinding,
    check_condition_fidelity,
)

# --------------------------------------------------------------------------- #
# MUST FIRE — the three transformations AR-1204 §6 names explicitly
# --------------------------------------------------------------------------- #


def _kinds(findings: list[FidelityFinding]) -> set[str]:
    return {f.kind for f in findings}


def test_certainty_inflation_gives_us_an_idea_is_not_confirms():
    """AR-1204 §3.1 / §6: `gives us an idea` -> `confirms` is PROVEN inflation."""
    findings = check_condition_fidelity(
        "The breakout confirms the market direction (up or down) for the trade.",
        ["That gives us an idea of the direction in which the market wants to go for the day."],
    )
    assert "CERTAINTY_INFLATION" in _kinds(findings), findings


def test_unsupported_probability_modifier():
    """AR-1204 §3.2 / §6: no probability claim in source -> `high-probability`."""
    findings = check_condition_fidelity(
        "The FVG provides a high-probability entry point after the initial directional breakout.",
        ["As soon as we see this gap being printed outside of the range and confirming, "
         "then we can enter the trade."],
    )
    assert "UNSUPPORTED_MODIFIER" in _kinds(findings), findings


def test_timing_window_widening_point_time_to_session():
    """AR-1204 §3.3 / §6: `at 9:30` -> `during the ... session`."""
    findings = check_condition_fidelity(
        "The trade must be initiated during the 9:30 AM ET New York session.",
        ["So, this strategy needs to be traded at 9:30 a.m. Eastern time, New York time."],
    )
    assert "TIMING_WINDOW_WIDENING" in _kinds(findings), findings


# --------------------------------------------------------------------------- #
# MUST NOT FIRE — the control that stops this from being an always-red gate
# --------------------------------------------------------------------------- #


def test_confirmed_condition_does_not_fire():
    """AR-1203: `entry_sequence[0].action` was blind-CONFIRMED on these two spans.

    A guard that flags a condition an independent blind rater CONFIRMED is an
    always-red gate, and an always-red gate discriminates nothing.
    """
    findings = check_condition_fidelity(
        "At 9:30 AM ET, define the initial range by marking the high and low "
        "of the first 5-minute candle.",
        [
            "So again, 9:30 a.m. Eastern time, go on the 5-minute candle. And what you're "
            "going to find is that first 9:30 candle, once it's printed, this is your 5minute candle",
            "And what that now gives me is a range on the five minute. Right? So that's how "
            "high the price went within the first 5 minutes and that's how low it went.",
        ],
    )
    assert findings == [], findings


def test_morphological_variant_is_supported_not_flagged():
    """🛑 AR-1204 §2, the STRUCK claim. `broken out of` MUST support `breakout`.

    "Do not use exact-token absence as a semantic-fidelity verdict."
    """
    findings = check_condition_fidelity(
        "Wait for the breakout of the range.",
        ["this yellow box needs to be essentially broken out of"],
    )
    assert findings == [], findings


def test_hedged_source_with_hedged_condition_does_not_fire():
    """Certainty inflation needs the CONDITION to be stronger than the SOURCE.
    Equally-hedged pairs are faithful and must pass."""
    findings = check_condition_fidelity(
        "The move may indicate the likely direction for the day.",
        ["That gives us an idea of the direction in which the market wants to go for the day."],
    )
    assert findings == [], findings


def test_certainty_in_condition_matched_by_certainty_in_source_does_not_fire():
    """If the teacher himself says `confirming`, `confirms` is faithful."""
    findings = check_condition_fidelity(
        "The gap printing outside the range confirms the entry.",
        ["As soon as we see this gap being printed outside of the range and confirming, "
         "then we can enter the trade."],
    )
    assert "CERTAINTY_INFLATION" not in _kinds(findings), findings


# --------------------------------------------------------------------------- #
# THE EVIDENCE-WINDOW DEMONSTRATION (AR-1203 §2 class 2 / AR-1204 §3.4)
# --------------------------------------------------------------------------- #


def test_quantity_unsupported_on_the_narrow_window():
    """The narrow packet span genuinely does NOT carry the 1-minute timeframe."""
    findings = check_condition_fidelity(
        "The 1m candle must close outside of the initial 5m range.",
        ["What has to happen is the candles need to close outside of this 5m minute range."],
    )
    assert "UNSUPPORTED_QUANTITY" in _kinds(findings), findings


def test_same_quantity_supported_once_the_window_includes_the_timeframe_clause():
    """...and the SAME condition stops firing when the window includes the clause the
    packet cut off — 103 chars earlier. This is the AR-1203 §2 Class-2 defect,
    reproduced as an executable discriminator rather than a claim.

    Numeral/word normalisation is required here: the source says `one minute`,
    the condition says `1m`.
    """
    findings = check_condition_fidelity(
        "The 1m candle must close outside of the initial 5m range.",
        ["We are essentially waiting for the one minute time frame candles to print into "
         "one of these sides of the range. Now, what does that mean? What has to happen is "
         "the candles need to close outside of this 5m minute range."],
    )
    assert "UNSUPPORTED_QUANTITY" not in _kinds(findings), findings


# --------------------------------------------------------------------------- #
# Structural
# --------------------------------------------------------------------------- #


def test_guard_contains_no_source_specific_strings():
    """AR-1204 §6/§7: no sVkm-specific hardcode in production logic."""
    import inspect

    from src.engine.extraction import source_fidelity_guard as g

    src = inspect.getsource(g).lower()
    for banned in ("svkm", "fair value", "nasdaq", "9:30", "yellow box", "opening range"):
        assert banned not in src, f"guard hardcodes source-specific string: {banned!r}"


def test_empty_quote_set_is_refusal_not_pass():
    """No evidence must never read as clean evidence."""
    findings = check_condition_fidelity("The breakout confirms the direction.", [])
    assert findings, "a condition with NO supporting quote must not pass silently"
    assert "NO_SUPPORTING_EVIDENCE" in _kinds(findings), findings


@pytest.mark.parametrize("condition", ["", "   "])
def test_blank_condition_refuses(condition):
    findings = check_condition_fidelity(condition, ["anything at all"])
    assert "EMPTY_CONDITION" in _kinds(findings), findings
