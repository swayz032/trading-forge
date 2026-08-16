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


# --------------------------------------------------------------------------- #
# AR-1206 §2.2 — CAUSAL CLAIMS. The contract named them; the gate must execute them.
# --------------------------------------------------------------------------- #


def test_causal_inflation_fires_when_source_states_only_sequence():
    """A source that says B happens AFTER A does not license "A CAUSES B"."""
    findings = check_condition_fidelity(
        "The displacement causes the gap to fill.",
        ["once that candle has printed, the gap forms just after it"],
    )
    assert "CAUSAL_INFLATION" in _kinds(findings), findings


def test_causal_claim_supported_by_source_causal_language_does_not_fire():
    findings = check_condition_fidelity(
        "The displacement causes the gap to fill.",
        ["the gap fills because of that displacement candle"],
    )
    assert "CAUSAL_INFLATION" not in _kinds(findings), findings


def test_non_causal_condition_never_raises_causal():
    findings = check_condition_fidelity(
        "Mark the high and low of the range.",
        ["mark the high of the candle here. And then mark out the low."],
    )
    assert "CAUSAL_INFLATION" not in _kinds(findings), findings


# --------------------------------------------------------------------------- #
# AR-1206 §2.3 — SEMANTIC ATTACHMENT. This is the birth control that must exist
# BEFORE the guard is allowed any certificate authority.
# --------------------------------------------------------------------------- #


def test_unrelated_hedge_in_the_window_does_not_license_a_modifier():
    """🛑 AR-1206 §2.3, verbatim: an unrelated sentence saying `price will probably
    retest` must NOT license `high-probability` attached to a different object.

    Without this, the modifier check is satisfiable by any stray occurrence of the
    stem anywhere in the evidence window — which is exactly the false-green shape
    this whole campaign exists to kill.
    """
    findings = check_condition_fidelity(
        "The FVG provides a high-probability entry point.",
        ["price will probably retest the level before continuing lower"],
    )
    assert "UNSUPPORTED_MODIFIER" in _kinds(findings), findings


def test_modifier_attached_to_the_same_object_is_licensed():
    """The control's control: real, attached support must still pass, or the rule
    above is just an always-red assertion."""
    findings = check_condition_fidelity(
        "The FVG provides a high-probability entry point.",
        ["this fvg entry point is a high probability setup"],
    )
    assert "UNSUPPORTED_MODIFIER" not in _kinds(findings), findings


def test_adding_an_unrelated_support_stem_does_not_change_the_verdict():
    """AR-1206 §2.3 control 4 — MONOTONICITY.

    Appending a sentence that is irrelevant to the target clause must leave that
    clause's verdict untouched. If it can flip a finding off, then the detector is
    silenceable by unrelated text and every clean result is worthless.
    """
    condition = "The FVG provides a high-probability entry point."
    base = ["the gap prints outside the range and we can enter"]
    contaminated = [base[0] + " Also, you're probably wondering what the setup is."]

    before = _kinds(check_condition_fidelity(condition, base))
    after = _kinds(check_condition_fidelity(condition, contaminated))
    assert before == after, (
        f"an unrelated support stem changed the verdict: {before} -> {after}"
    )
    assert "UNSUPPORTED_MODIFIER" in after, after


def test_unrelated_certainty_elsewhere_does_not_license_certainty():
    """Same attachment rule for certainty: a certainty verb about some other object
    must not silently satisfy a certainty claim about this one."""
    findings = check_condition_fidelity(
        "The breakout confirms the market direction.",
        ["I can confirm my subscription renewed, but that only gives us an idea "
         "of the direction"],
    )
    assert "CERTAINTY_INFLATION" in _kinds(findings), findings


# =========================================================================== #
# AR-1239 §3.1 — UNSUPPORTED_CERTAINTY / UNSUPPORTED_RISK_BENEFIT
#
# The gap these close, measured on the real sVkm slice: a condition asserting certainty
# against a source that is SILENT emitted nothing at all, because the certainty leg only
# fired when the source actively hedged. "confirms the FVG structure and minimizes entry
# risk" therefore passed every gate. Each control below is one AR-1239 §3.1 names.
# =========================================================================== #

_SVKM_CAUSAL_ROW = "Entering on the closure confirms the FVG structure and minimizes entry risk."
_SVKM_QUOTE = (
    "in order for this fair value gap to be a valid fair value gap, the fair value gap has "
    "to actually be formed. And the way that happens is when the third candle of the "
    "sequence has been printed"
)


def _kinds_for(cond, quotes):
    return {f.kind for f in check_condition_fidelity(cond, quotes)}


def test_ar1239_control_1_the_real_svkm_causal_risk_row_now_FAILS():
    """CONTROL 1: the row AR-1236 §4 named and AR-1237 measured as undetected."""
    kinds = _kinds_for(_SVKM_CAUSAL_ROW, [_SVKM_QUOTE])
    assert "UNSUPPORTED_CERTAINTY" in kinds
    assert "UNSUPPORTED_RISK_BENEFIT" in kinds


def test_ar1239_control_2_a_source_that_explicitly_confirms_is_NOT_falsely_rejected():
    """CONTROL 2: no false reject when the source really does assert the certainty."""
    kinds = _kinds_for(
        "Entering on the closure confirms the FVG structure.",
        ["once that third candle closes it confirms the fair value gap structure is valid"],
    )
    assert "UNSUPPORTED_CERTAINTY" not in kinds
    assert "CERTAINTY_INFLATION" not in kinds


def test_ar1239_control_3_a_source_that_explicitly_reduces_risk_is_NOT_falsely_rejected():
    """CONTROL 3: no false reject when the source really does offer the benefit."""
    kinds = _kinds_for(
        "Waiting for the close minimizes entry risk.",
        ["waiting for the candle to close minimizes your entry risk on the trade"],
    )
    assert "UNSUPPORTED_RISK_BENEFIT" not in kinds


def test_ar1239_control_4_an_unrelated_risk_or_confirm_sentence_does_not_license_it():
    """CONTROL 4: clause attachment. A `risk`/`confirm` sentence about something ELSE may not
    silence the finding — the AR-1206 §2.2 failure, re-proven for the new legs."""
    kinds = _kinds_for(
        "Entering on the closure confirms the FVG structure and minimizes entry risk.",
        ["please confirm your broker connection before the session. manage your daily risk "
         "limit sensibly."],
    )
    assert "UNSUPPORTED_CERTAINTY" in kinds
    assert "UNSUPPORTED_RISK_BENEFIT" in kinds


def test_ar1239_MEASURED_LIMITATION_a_comma_joined_clause_can_still_license_a_claim():
    """A LIMITATION PINNED AS A TEST, NOT HIDDEN IN A COMMENT.

    MEASURED while writing control 4: `_CLAUSE_SPLIT` breaks on `.!?;` and on
    but/however/although/whereas/while — NOT on commas. So an unrelated marker and a
    topic word joined by a comma land in ONE clause, and the clause-attachment screen
    reads that as support. Below, `confirm` (about a broker connection) and `risk`
    (about a daily limit) sit in one comma-joined clause and together silence the
    certainty finding.

    This is a property of the existing screen, whose own docstring already says it is a
    cheap deterministic check and can be fooled by a same-topic clause. Widening the
    splitter would change the verdict of every condition in the library, and AR-1239
    §3.1 authorized two new outcomes — not a re-cut of clause boundaries. So it is
    RECORDED and left alone rather than quietly widened.

    If this test ever fails, the splitter changed: re-measure the whole corpus before
    treating that as an improvement.
    """
    kinds = _kinds_for(
        "Entering on the closure confirms the FVG structure and minimizes entry risk.",
        ["please confirm your broker connection before the session, and manage your daily "
         "risk limit sensibly"],
    )
    assert "UNSUPPORTED_CERTAINTY" not in kinds, (
        "the comma-joined-clause limitation has changed — re-measure the corpus"
    )


def test_ar1239_control_5_source_silence_is_reported_as_UNSUPPORTED_not_as_DISPROVEN():
    """CONTROL 5: silence is not evidence of the opposite, and the wording must say so."""
    findings = check_condition_fidelity(_SVKM_CAUSAL_ROW, [_SVKM_QUOTE])
    for f in findings:
        if f.kind in ("UNSUPPORTED_CERTAINTY", "UNSUPPORTED_RISK_BENEFIT"):
            assert "NOT DISPROVEN" in f.detail
            for forbidden in ("false", "contradict", "disproves", "refutes"):
                assert forbidden not in f.detail.lower()


def test_ar1239_hedged_source_keeps_the_STRONGER_certainty_verdict():
    """The two verdicts must stay distinct: an explicitly hedged source is a stronger finding
    than a silent one, and collapsing them lets silence borrow a contradiction's authority."""
    kinds = _kinds_for(
        "The breakout confirms the market direction.",
        ["this breakout may be telling us the market wants to go lower"],
    )
    assert "CERTAINTY_INFLATION" in kinds
    assert "UNSUPPORTED_CERTAINTY" not in kinds


def test_ar1239_the_bare_word_risk_does_not_fire_the_benefit_leg():
    """DISCRIMINATOR: `risk` appears in almost every trading sentence. A rule that fired on the
    bare noun would fire on everything and would therefore mean nothing."""
    kinds = _kinds_for(
        "The stop defines the risk on the trade.",
        ["the stop goes at the bottom of the candle and that is your risk"],
    )
    assert "UNSUPPORTED_RISK_BENEFIT" not in kinds
