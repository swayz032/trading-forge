"""B1 STEP 6A — controls for lowering a frozen extraction record.

AUTHORITY: R-738 §5, R-740 §3 (the amended population), §4 (the refusal
contract), §5 (two outcomes + the new negative control), §6-2, §6-3, §7.

THE POINT OF THIS SUITE IN ONE SENTENCE
---------------------------------------
The lowering must reproduce R-740 §3's amended population — `3` executable
candidates and `1` exact source refusal — WITHOUT knowing which record is which,
because a rule that recognises a spec by name has memorised its answer.

    `AN ID IN PRODUCTION CODE IS A CLASSIFIER THAT HAS MEMORISED ITS ANSWER;
     AN ID IN A TEST IS A POPULATION ASSERTION.`  (R-732 §2)

So the two ids live HERE, and the module under test contains neither.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from src.engine.opening_range_adapter import compute_opening_range_state
from src.engine.opening_range_candidate import expand_execution_candidates
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeState,
    OpeningRangeWindowStatus,
)
from src.engine.opening_range_lowering import (
    ABSENT,
    COMMITTED_PROVENANCE_DIR,
    CONTRADICTORY,
    REASON_TRADING_DAY_RULE_MISSING,
    REQUIRED_SOURCE_FIELDS,
    UNREADABLE,
    OpeningRangeLoweringDisposition,
    OpeningRangeSourceRefusal,
    lower_opening_range_definition,
)

READY_SPEC = "st5e-YJRfKc__s0"
READY_CONDITION = "WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0"
REFUSING_SPEC = "dENM6gt8ZRg__s0"
REFUSING_CONDITION = "WAIT_STRUCTURE:the-first-five-minute-candle-from-09-30#0"

POSITIVE_CONTROL = (
    "the other frozen census member's record carries an explicit day-reset "
    "sentence that this same locator detects, so the format can carry the field "
    "and the scanner can find it"
)


def _record(stub: str) -> dict:
    return json.load(open(f"{COMMITTED_PROVENANCE_DIR}/{stub}.json", encoding="utf-8"))


def _lower(stub: str, condition: str):
    return lower_opening_range_definition(
        stub, condition, _record(stub), positive_control=POSITIVE_CONTROL
    )


# ── R-740 §6-3: the committed path IS the pinned evidence ────────────────────


def test_the_committed_provenance_matches_the_frozen_census_hash():
    """The census points `extraction_source` at a dead session's temp
    scratchpad. R-740 §6-3 authorises the committed path INSTEAD — on a hash
    match, not on a guess. If these ever diverge, the substitution's licence is
    gone and this test is what says so."""
    import hashlib

    census = json.load(
        open(
            "docs/replay-results/h1-battery/tier-a-compile-census.json", encoding="utf-8"
        )
    )
    pinned = {s["stub"]: s["extraction_sha256"] for s in census["specs"]}
    for stub in (READY_SPEC, REFUSING_SPEC):
        blob = open(f"{COMMITTED_PROVENANCE_DIR}/{stub}.json", "rb").read()
        assert hashlib.sha256(blob).hexdigest() == pinned[stub], (
            f"{stub}: the committed provenance copy no longer matches the frozen "
            "census pin — the path substitution R-740 §6-3 authorised is void"
        )


# ── R-740 §3: the amended population, reproduced not asserted ────────────────


def test_the_taught_record_lowers_to_ready_with_exactly_three_taught_variants():
    result = _lower(READY_SPEC, READY_CONDITION)
    assert result.disposition is OpeningRangeLoweringDisposition.READY
    assert result.refusal is None
    assert isinstance(result.definition, OpeningRangeDefinition)
    assert [v.duration_minutes for v in result.definition.variants] == [5, 15, 30]


def test_the_ready_record_expands_to_exactly_three_candidates_with_distinct_identities():
    """R-740 §3: `3` executable candidates. Obligations 1 and 6 at the
    population level."""
    result = _lower(READY_SPEC, READY_CONDITION)
    candidates = expand_execution_candidates(READY_SPEC, READY_CONDITION, result.definition)
    assert len(candidates) == 3
    assert len({c.cache_identity for c in candidates}) == 3
    assert [c.variant.duration_minutes for c in candidates] == [5, 15, 30]


def test_the_incomplete_record_refuses_naming_exactly_the_trading_day_rule():
    """R-740 §4: EXACT failed field, EXACT internal reason. Naming a second
    field here would report a weak locator as a silent teacher."""
    result = _lower(REFUSING_SPEC, REFUSING_CONDITION)
    assert result.disposition is OpeningRangeLoweringDisposition.SOURCE_INCOMPLETE
    assert result.definition is None
    assert result.refusal.missing_fields == ("trading_day_rule",)
    assert result.refusal.internal_reason == REASON_TRADING_DAY_RULE_MISSING


def test_the_refusal_records_the_five_fields_that_WERE_found():
    """A refusal that only says what is missing invites the reader to assume the
    rest is missing too. R-740 §4 requires the found evidence on the artifact."""
    refusal = _lower(REFUSING_SPEC, REFUSING_CONDITION).refusal
    found = {field for field, _span in refusal.evidence_found}
    assert found == set(REQUIRED_SOURCE_FIELDS) - {"trading_day_rule"}
    spans = dict(refusal.evidence_found)
    assert "five-minute candle" in spans["variants"]
    assert "09:30" in spans["session_start_local"] or "09:30" in spans["variants"]


def test_the_refusal_carries_its_own_positive_control():
    """`A REFUSAL THAT DOES NOT CARRY ITS OWN POSITIVE CONTROL IS
    INDISTINGUISHABLE FROM A BROKEN READER.` (R-740 §4)"""
    refusal = _lower(REFUSING_SPEC, REFUSING_CONDITION).refusal
    assert refusal.positive_control
    assert refusal.extraction_dropped_no_source_statement is True


def test_the_locator_that_found_nothing_here_DOES_fire_on_the_other_member():
    """THE POSITIVE CONTROL ITSELF, EXECUTED — not merely quoted in a string.

    Without this, `missing_fields == ("trading_day_rule",)` is equally well
    explained by a trading-day locator that never matches anything."""
    ready = _lower(READY_SPEC, READY_CONDITION)
    assert "trading day" in ready.definition.trading_day_rule.lower()


# ── the fidelity control the golden record specifically needs ────────────────


def test_the_chart_timezone_never_overrides_the_taught_window_timezone():
    """The golden record says "9:30 a.m. Eastern" in its window sentence and
    "off of the Pacific Standard chart" in its breakout sentence. Those are the
    CLOCK and the CHART, not two answers to one question — and the breakout
    sentence is `UNRESOLVED_SOURCE_AMBIGUITY` scope this lowering may not touch.

    A locator that scanned the record for any timezone token would resolve
    Pacific here roughly one time in two depending on iteration order."""
    result = _lower(READY_SPEC, READY_CONDITION)
    assert result.definition.source_timezone == "America/New_York"
    raw = json.dumps(_record(READY_SPEC))
    assert "Pacific" in raw, "fixture no longer contains the competing zone — control is dead"


def test_market_scope_is_rendered_in_full_and_never_compressed():
    """R-740 §6-2: the incomplete record's demonstrated scope is multi-asset.
    Compressing it to a tidier label is a fidelity claim nobody audits."""
    refusal = _lower(REFUSING_SPEC, REFUSING_CONDITION).refusal
    scope = dict(refusal.evidence_found)["market_scope"]
    for asset in ("S&P500", "Nasdaq", "EUR/USD", "Brent Oil", "Bitcoin"):
        assert asset in scope, f"{asset} dropped from the demonstrated scope"
    assert scope != "US equities"


def test_no_spec_or_video_id_appears_in_the_lowering_module():
    """R-738 §9. The rule must not recognise either record by name, or the
    population assertion above proves nothing."""
    source = open("src/engine/opening_range_lowering.py", encoding="utf-8").read()
    for ident in (READY_SPEC, REFUSING_SPEC, "st5e", "dENM"):
        assert ident not in source, f"{ident!r} is hardcoded in production lowering code"


# ── R-740 §5: the two-outcome type, and what may never be manufactured ───────


def test_a_refusal_cannot_be_constructed_without_naming_a_field():
    with pytest.raises(ValueError, match="at least one missing field"):
        OpeningRangeSourceRefusal(
            source_spec_id="s",
            source_condition_id="c",
            missing_fields=(),
            internal_reason="r",
            evidence_found=(),
            positive_control="p",
            extraction_dropped_no_source_statement=True,
            failure_kind=ABSENT,
        )


def test_a_refusal_cannot_be_constructed_without_a_positive_control():
    with pytest.raises(ValueError, match="positive control"):
        OpeningRangeSourceRefusal(
            source_spec_id="s",
            source_condition_id="c",
            missing_fields=("trading_day_rule",),
            internal_reason="r",
            evidence_found=(),
            positive_control="",
            extraction_dropped_no_source_statement=True,
            failure_kind=ABSENT,
        )


def test_a_refusal_may_not_name_a_field_outside_the_required_population():
    """`[self-certifying-collections]`: a refusal free to invent its own field
    names could always report something plausible."""
    with pytest.raises(ValueError, match="outside the required population"):
        OpeningRangeSourceRefusal(
            source_spec_id="s",
            source_condition_id="c",
            missing_fields=("some_field_nobody_declared",),
            internal_reason="r",
            evidence_found=(),
            positive_control="p",
            extraction_dropped_no_source_statement=True,
            failure_kind=ABSENT,
        )


def test_an_incomplete_source_never_yields_an_expandable_definition():
    """R-740 §5: expansion is FORBIDDEN on SOURCE_INCOMPLETE, and the type is
    what enforces it — there is no definition to expand."""
    result = _lower(REFUSING_SPEC, REFUSING_CONDITION)
    assert result.definition is None
    with pytest.raises((AttributeError, TypeError)):
        expand_execution_candidates(REFUSING_SPEC, REFUSING_CONDITION, result.definition)


# ── R-740 §5: THE NEW NEGATIVE CONTROL ───────────────────────────────────────


def test_the_incomplete_record_can_never_reach_the_adapter():
    """R-740 §5, added to the obligations verbatim: *if `dENM` ever reaches
    `compute_opening_range_state`, THE SUITE MUST FAIL.*

    Enforced structurally rather than by inspection: the adapter's first
    argument is an `OpeningRangeDefinition`, the refusing record produces NONE,
    and there is no path from a refusal to one. The positive witness below is
    what proves the adapter is reachable at all for the OTHER member — without
    it, this test is satisfied by an adapter nobody can call.
    """
    refusing = _lower(REFUSING_SPEC, REFUSING_CONDITION)
    assert refusing.definition is None
    with pytest.raises((AttributeError, TypeError)):
        compute_opening_range_state(
            refusing.definition,
            None,
            [],
            session_date=date(2026, 8, 10),
            bar_interval_minutes=1,
            as_of=datetime(2026, 8, 10, 10, 0),
        )


def test_positive_witness_the_ready_record_DOES_reach_the_adapter():
    """The other half of the pair. A negative assertion needs a positive witness
    that the path RAN, or "never reaches the adapter" is satisfied by an adapter
    that is simply unreachable."""
    ready = _lower(READY_SPEC, READY_CONDITION)
    candidate = expand_execution_candidates(READY_SPEC, READY_CONDITION, ready.definition)[0]
    state = compute_opening_range_state(
        candidate.definition,
        candidate.variant,
        [],
        session_date=date(2026, 8, 10),
        bar_interval_minutes=1,
        # Timezone-AWARE deliberately: the adapter refuses a naive instant, and
        # the zone is the one the LOWERING resolved from source, not one this
        # test chose — so the witness exercises the real join.
        as_of=datetime(2026, 8, 10, 14, 0, tzinfo=ZoneInfo(ready.definition.source_timezone)),
    )
    # The adapter ACCEPTED the lowered definition, the lowered variant and the
    # lowered timezone and returned a typed state — that is the join this
    # witness exists to prove. It refuses on CONTENT (no bars were supplied),
    # which is the correct answer for an empty window and is not the same thing
    # as refusing the inputs: bad inputs RAISE here, they do not return a state.
    assert isinstance(state, OpeningRangeState)
    assert state.opening_range_window_status is OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
    assert state.opening_range_high is None


# ═════════════════════════════════════════════════════════════════════════════
# R-741 CLOSEOUTS 1 AND 2 — the seven ordered controls.
#
# Both defects returned a PLAUSIBLE WRONG ANSWER rather than failing, which is
# exactly why the STEP 6A suite missed them: a shrunken variant set looks like a
# smaller lesson, and a mismatched clock/zone pair looks like a session that
# starts fifteen minutes earlier.
# ═════════════════════════════════════════════════════════════════════════════

_GOLDEN_CONSTRUCTION = "We take the opening range high and the opening range low in between these."
_GOLDEN_DAY_RULE = "It becomes relative for every single trading day."
_CLASSIFICATION = {"asset_class": "equities", "instruments_mentioned": ["S&P 500"]}

_THREE_GOOD = [
    {"variant_label": "5-minute opening range", "description": "from 9:30 a.m. Eastern to 9:35."},
    {"variant_label": "15-minute opening range", "description": "the first 15 minutes."},
    {"variant_label": "30-minute opening range", "description": "the 30 minute is to 10 a.m."},
]


def _synthetic(*, variants=None, entry_extra=()) -> dict:
    """A minimal well-formed record, so each control isolates ONE variable.

    Everything except the field under test is present and valid — a control that
    failed because its fixture was incomplete would convict the wrong thing.
    """
    strategy: dict = {
        "name": "synthetic",
        "entry_sequence": [
            {"action": "The 5m OB takes place from 9:30 a.m. Eastern to 9:35 a.m. Eastern."},
            {"action": _GOLDEN_CONSTRUCTION},
            *({"action": text} for text in entry_extra),
        ],
        "confluences": [{"description": _GOLDEN_DAY_RULE}],
    }
    if variants is not None:
        strategy["variants"] = variants
    return {"strategies": [strategy], "instrument_classification": _CLASSIFICATION}


def _lower_record(record: dict):
    return lower_opening_range_definition(
        "synthetic__s0", "WAIT_STRUCTURE:synthetic#0", record, positive_control=POSITIVE_CONTROL
    )


# ── CLOSEOUT 1: no partial candidate set may survive ─────────────────────────


def test_closeout1_control3_the_unchanged_collection_still_yields_all_three():
    """THE POSITIVE WITNESS, STATED FIRST. Without it, the two controls below are
    both satisfied by a lowering that refuses everything."""
    result = _lower_record(_synthetic(variants=_THREE_GOOD))
    assert result.disposition is OpeningRangeLoweringDisposition.READY
    assert [v.duration_minutes for v in result.definition.variants] == [5, 15, 30]


def test_closeout1_control1_one_unlowerable_member_refuses_the_whole_definition():
    """`A LOOP THAT CONTINUES PAST WHAT IT CANNOT READ IS A COMPILER QUIETLY
    EDITING THE TEACHER.` Three taught variants plus one bad row previously gave
    TWO candidates and no refusal."""
    broken = [
        _THREE_GOOD[0],
        {"variant_label": None, "description": "no duration stated here at all"},
        _THREE_GOOD[2],
    ]
    result = _lower_record(_synthetic(variants=broken))
    assert result.disposition is OpeningRangeLoweringDisposition.SOURCE_INCOMPLETE
    assert result.definition is None, "a partial candidate set survived"
    assert result.refusal.failure_kind == UNREADABLE
    assert "variants" in result.refusal.missing_fields


def test_closeout1_control2_label_and_description_durations_that_disagree_refuse():
    """`AN "or" BETWEEN TWO EVIDENCE SOURCES IS A PRECEDENCE RULE NOBODY DECIDED
    TO WRITE.` The old code silently returned 5m."""
    result = _lower_record(
        _synthetic(
            variants=[
                {"variant_label": "5-minute opening range", "description": "the first 15 minutes."}
            ]
        )
    )
    assert result.disposition is OpeningRangeLoweringDisposition.SOURCE_INCOMPLETE
    assert result.definition is None
    assert result.refusal.failure_kind == CONTRADICTORY, (
        "a record disagreeing with itself was reported as a teacher who stayed silent"
    )
    assert "5" in result.refusal.internal_reason
    assert "15" in result.refusal.internal_reason


def test_closeout1_contradiction_and_absence_do_not_share_a_name():
    """`TWO DIFFERENT SILENCES DESERVE TWO DIFFERENT NAMES` — V1.1 maps one to
    `SOURCE_AMBIGUOUS` and the other to `SOURCE_INCOMPLETE`."""
    absent = _lower(REFUSING_SPEC, REFUSING_CONDITION).refusal
    contradictory = _lower_record(
        _synthetic(
            variants=[{"variant_label": "5-minute", "description": "the first 15 minutes."}]
        )
    ).refusal
    assert absent.failure_kind == ABSENT
    assert contradictory.failure_kind == CONTRADICTORY
    assert absent.internal_reason != contradictory.internal_reason


# ── CLOSEOUT 2: the clock and the zone are ONE atomic pair ───────────────────


def test_closeout2_control1_a_clock_only_span_never_reserves_the_clock_slot():
    """THE DEFECT ITSELF. An earlier clock-only span used to claim
    `session_start_local`, so a later complete span contributed only its zone —
    clock from one sentence, zone from another."""
    # ORDER IS THE WHOLE CONTROL: the clock-only span must be scanned BEFORE any
    # complete pair, or a first-wins implementation passes by luck. Measured:
    # with the defect restored this fixture yields 09:15 + America/New_York —
    # halves from two different sentences — and the assertion below fails.
    record = {
        "strategies": [
            {
                "name": "synthetic",
                "entry_sequence": [
                    {"action": "Some traders start watching at 09:15 before the bell."},
                    {
                        "action": "The first 5-minute candle sets the opening range high "
                        "and the opening range low."
                    },
                    {"action": "The window runs 9:30 a.m. Eastern to 9:35 a.m. Eastern."},
                ],
                "confluences": [{"description": _GOLDEN_DAY_RULE}],
            }
        ],
        "instrument_classification": _CLASSIFICATION,
    }
    result = _lower_record(record)
    assert result.disposition is OpeningRangeLoweringDisposition.READY
    assert result.definition.session_start_local == "09:30", (
        "the clock was taken from a span that carried no timezone"
    )
    assert result.definition.source_timezone == "America/New_York"


def test_closeout2_control2_a_clock_and_a_zone_in_different_spans_refuse():
    """Half the pair in one sentence and half in another is not evidence of a
    session anchor. Refuse, never assemble."""
    record = {
        "strategies": [
            {
                "name": "synthetic",
                "entry_sequence": [
                    {"action": "The opening window begins at 09:30 sharp."},
                    {"action": "All times on this chart are Eastern."},
                    {"action": "The first 5-minute candle sets it."},
                    {"action": _GOLDEN_CONSTRUCTION},
                ],
                "confluences": [{"description": _GOLDEN_DAY_RULE}],
            }
        ],
        "instrument_classification": _CLASSIFICATION,
    }
    result = _lower_record(record)
    assert result.disposition is OpeningRangeLoweringDisposition.SOURCE_INCOMPLETE
    assert {"session_start_local", "source_timezone"} <= set(result.refusal.missing_fields)


def test_closeout2_control3_two_complete_but_disagreeing_pairs_refuse():
    """Two well-formed anchors that disagree is a CONTRADICTION, and the compiler
    may not pick whichever it read first."""
    record = _synthetic(variants=_THREE_GOOD)
    record["strategies"][0]["entry_sequence"].append(
        {"action": "On the west coast session this begins at 06:30 Pacific instead."}
    )
    result = _lower_record(record)
    assert result.disposition is OpeningRangeLoweringDisposition.SOURCE_INCOMPLETE
    assert result.refusal.failure_kind == CONTRADICTORY
    assert "06:30" in result.refusal.internal_reason
    assert "09:30" in result.refusal.internal_reason


def test_closeout2_control4_the_golden_pacific_chart_still_cannot_override_eastern():
    """THE ONE THAT MATTERS MOST AND IS EASIEST TO OMIT (R-741 §3): it proves the
    repair did not simply become "take the last span".

    The golden record's Pacific sentence is real and still present; it names a
    zone but no `HH:MM` clock, so it forms no complete pair and cannot compete.
    """
    result = _lower(READY_SPEC, READY_CONDITION)
    assert result.disposition is OpeningRangeLoweringDisposition.READY
    assert result.definition.source_timezone == "America/New_York"
    assert result.definition.session_start_local == "09:30"
    raw = json.dumps(_record(READY_SPEC))
    assert "Pacific" in raw, "the competing evidence is gone — this control is now dead"
