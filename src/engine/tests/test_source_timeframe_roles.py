"""AR-1110 §4/§5 — the source-owned timeframe-role carrier.

Authority: AR-1110 (gpt-rulings `25a7d8d5`) §4 "Minimum semantic carrier", §5 "Fail-closed".

Every refusal below exists because the thing it refuses is what the OLD scalar did:
pick a plausible number and let it stand in for four different source facts.
"""

from __future__ import annotations

import pytest

from src.engine.source_timeframe_roles import (
    ACCEPTED_GRADES,
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    EXPLICIT,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    REQUIRED_ROLES,
    SOURCE_RESOLVED_BY_CONTINUITY,
    TIMEFRAME_ROLES_SCHEMA,
    SourceTimeframeRoleError,
    SourceTimeframeRoles,
    TimeframeRoleBinding,
)

# ── THE sVkm ROLE SET, EXACTLY AS AR-1110 §4 SPECIFIES IT ────────────────────
# Quotes are the teacher's, read from `youtube_evidence_archive.transcript_text`
# for `sVkmZklJDHI` at the character spans reported in AR-1109 §1.
SVKM_ROLES = SourceTimeframeRoles(
    bindings=(
        TimeframeRoleBinding(
            role=OPENING_RANGE_WINDOW,
            timeframe="5m",
            evidence_grade=EXPLICIT,
            source_quote=(
                "9:30 a.m. Eastern time, go on the 5-minute candle. And what you're going "
                "to find is that first 9:30 candle, once it's printed"
            ),
            condition_id="OPENING_RANGE_DEFINITION:the-opening-range#0",
        ),
        TimeframeRoleBinding(
            role=BREAKOUT_CONFIRMATION,
            timeframe="1m",
            evidence_grade=EXPLICIT,
            source_quote=(
                "We are essentially waiting for the one minute time frame candles to print "
                "into one of these sides of the range. ... What has to happen is the candles "
                "need to close outside of this 5m minute range."
            ),
            condition_id="BREAKOUT_CONFIRMATION:close-outside-the-range#0",
        ),
        TimeframeRoleBinding(
            role=FVG_DETECTION,
            timeframe="1m",
            evidence_grade=SOURCE_RESOLVED_BY_CONTINUITY,
            source_quote=(
                "A fair value gap is when you get a three candle pattern where the low of "
                "candle one does not overlap the high of candle three."
            ),
            condition_id="WAIT_STRUCTURE:the-fair-value-gap#0",
        ),
        TimeframeRoleBinding(
            role=ENTRY_COMPLETION,
            timeframe="1m",
            evidence_grade=SOURCE_RESOLVED_BY_CONTINUITY,
            source_quote="my entry is going to be on the closure of that third candle",
            condition_id="ENTRY:third-candle-close#0",
        ),
    )
)


def _binding(role=OPENING_RANGE_WINDOW, **over):
    kw = dict(
        role=role,
        timeframe="5m",
        evidence_grade=EXPLICIT,
        source_quote="a taught sentence",
        condition_id="C#0",
    )
    kw.update(over)
    return TimeframeRoleBinding(**kw)


def _full(**over) -> SourceTimeframeRoles:
    by_role = {
        OPENING_RANGE_WINDOW: "5m",
        BREAKOUT_CONFIRMATION: "1m",
        FVG_DETECTION: "1m",
        ENTRY_COMPLETION: "1m",
    }
    by_role.update(over)
    return SourceTimeframeRoles(
        bindings=tuple(_binding(role=r, timeframe=tf) for r, tf in by_role.items())
    )


# ── THE POSITIVE WITNESS ─────────────────────────────────────────────────────


def test_the_svkm_role_set_is_representable_and_keeps_its_two_timeframes():
    """The whole point: FOUR facts, TWO timeframes, not one scalar."""
    assert SVKM_ROLES.timeframe_for(OPENING_RANGE_WINDOW) == "5m"
    assert SVKM_ROLES.timeframe_for(BREAKOUT_CONFIRMATION) == "1m"
    assert SVKM_ROLES.timeframe_for(FVG_DETECTION) == "1m"
    assert SVKM_ROLES.timeframe_for(ENTRY_COMPLETION) == "1m"
    # The old scalar collapsed this to a single '1m' and lost the 5m entirely.
    assert len({SVKM_ROLES.timeframe_for(r) for r in REQUIRED_ROLES}) == 2


def test_the_weaker_grades_survive_and_are_not_laundered_into_explicit():
    """AR-1110 §3: do NOT upgrade Q2/Q3 to EXPLICIT just because they equal 1m."""
    assert SVKM_ROLES.for_role(BREAKOUT_CONFIRMATION).evidence_grade == EXPLICIT
    assert SVKM_ROLES.for_role(FVG_DETECTION).evidence_grade == SOURCE_RESOLVED_BY_CONTINUITY
    assert SVKM_ROLES.for_role(ENTRY_COMPLETION).evidence_grade == SOURCE_RESOLVED_BY_CONTINUITY
    # FVG and BREAKOUT agree on '1m' and DISAGREE on how well it is evidenced.
    # A carrier that stored only the value would make these indistinguishable.
    assert (
        SVKM_ROLES.timeframe_for(FVG_DETECTION)
        == SVKM_ROLES.timeframe_for(BREAKOUT_CONFIRMATION)
    )
    assert (
        SVKM_ROLES.for_role(FVG_DETECTION).evidence_grade
        != SVKM_ROLES.for_role(BREAKOUT_CONFIRMATION).evidence_grade
    )


def test_round_trip_through_the_payload_is_lossless():
    restored = SourceTimeframeRoles.from_payload(SVKM_ROLES.to_payload())
    assert restored == SVKM_ROLES
    for r in REQUIRED_ROLES:
        assert restored.for_role(r) == SVKM_ROLES.for_role(r)


def test_the_payload_is_canonical_in_role_order():
    """Two equal role sets built in different orders must serialise identically, or
    a hash keyed on this payload would split one source into two identities."""
    forward = _full()
    reversed_build = SourceTimeframeRoles(bindings=tuple(reversed(forward.bindings)))
    assert forward.to_payload() == reversed_build.to_payload()
    assert forward.to_payload()["schema"] == TIMEFRAME_ROLES_SCHEMA


# ── FAIL-CLOSED (AR-1110 §5) ─────────────────────────────────────────────────


@pytest.mark.parametrize("dropped", REQUIRED_ROLES)
def test_a_missing_role_REFUSES(dropped):
    """'if a required timeframe role is absent, refuse'. Parameterised over all four
    so no single role is silently exempt."""
    kept = tuple(b for b in _full().bindings if b.role != dropped)
    with pytest.raises(SourceTimeframeRoleError) as err:
        SourceTimeframeRoles(bindings=kept)
    assert dropped in str(err.value)


def test_a_conflicting_double_binding_REFUSES():
    """'if two source facts conflict, refuse' — not 'pick the first' and not 'pick
    the lowest', which is the exact heuristic AR-1110 §4 outlawed."""
    doubled = _full().bindings + (_binding(role=FVG_DETECTION, timeframe="5m"),)
    with pytest.raises(SourceTimeframeRoleError) as err:
        SourceTimeframeRoles(bindings=doubled)
    assert FVG_DETECTION in str(err.value)


def test_for_role_REFUSES_rather_than_borrowing_a_sibling():
    """The carrier must never answer a role question with another role's value."""
    roles = _full()
    with pytest.raises(SourceTimeframeRoleError) as err:
        roles.for_role("SOME_ROLE_NOBODY_TAUGHT")
    assert "borrowing" in str(err.value)


def test_an_absent_carrier_REFUSES_and_names_the_forbidden_fallbacks():
    with pytest.raises(SourceTimeframeRoleError) as err:
        SourceTimeframeRoles.from_payload(None)
    blob = str(err.value)
    assert "trigger_tf" in blob and "strategy.timeframe" in blob


def test_an_empty_timeframe_REFUSES():
    """An empty string is what a dropped source fact looks like after a bad join."""
    with pytest.raises(SourceTimeframeRoleError):
        _binding(timeframe="")
    with pytest.raises(SourceTimeframeRoleError):
        _binding(timeframe="   ")


def test_an_ungradeable_role_REFUSES():
    """A role whose evidence cannot be graded may not masquerade as taught. In
    particular the old provenance string — a 0.4-confidence backfill — is not a grade."""
    with pytest.raises(SourceTimeframeRoleError) as err:
        _binding(evidence_grade="backfill_recovered_from_spec")
    assert "accepted grades" in str(err.value)
    for good in ACCEPTED_GRADES:
        assert _binding(evidence_grade=good).evidence_grade == good


def test_a_graded_claim_with_no_quote_REFUSES():
    with pytest.raises(SourceTimeframeRoleError) as err:
        _binding(source_quote="")
    assert "no source quote" in str(err.value)


def test_an_unknown_role_REFUSES():
    with pytest.raises(SourceTimeframeRoleError) as err:
        _binding(role="EXIT_TIMING")
    assert "unknown timeframe role" in str(err.value)


def test_a_wrong_schema_REFUSES():
    payload = SVKM_ROLES.to_payload()
    payload["schema"] = "SOURCE_TIMEFRAME_ROLES/99"
    with pytest.raises(SourceTimeframeRoleError) as err:
        SourceTimeframeRoles.from_payload(payload)
    assert "unrecognised" in str(err.value)


def test_extra_or_missing_payload_keys_REFUSE():
    payload = SVKM_ROLES.to_payload()
    payload["helpful_extra"] = 1
    with pytest.raises(SourceTimeframeRoleError):
        SourceTimeframeRoles.from_payload(payload)

    payload2 = SVKM_ROLES.to_payload()
    payload2["bindings"][0].pop("evidence_grade")
    with pytest.raises(SourceTimeframeRoleError):
        SourceTimeframeRoles.from_payload(payload2)


# ── THE ROLE/DURATION TRAP (R-800 §4) ────────────────────────────────────────


def test_opening_range_window_is_a_CHART_not_a_DURATION():
    """`OPENING-RANGE DURATION IS NOT EXECUTION TIMEFRAME` (R-800 §10).

    sVkm's opening range is measured ON the 5-minute chart and IS 5 minutes long, so
    this source alone cannot discriminate the two concepts. A source whose range is
    15 minutes long measured on a 5-minute chart can — and the carrier must represent
    it without complaint, because collapsing the two is how three bots the teacher
    never taught get shipped.
    """
    fifteen_minute_range_on_a_five_minute_chart = _full(**{OPENING_RANGE_WINDOW: "5m"})
    assert (
        fifteen_minute_range_on_a_five_minute_chart.timeframe_for(OPENING_RANGE_WINDOW)
        == "5m"
    )
    # Nothing in this carrier stores, derives or validates a DURATION. That stays on
    # OpeningRangeDefinition, where R-736's three taught variants live untouched.
    assert not hasattr(SVKM_ROLES.for_role(OPENING_RANGE_WINDOW), "duration_minutes")
