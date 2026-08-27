"""The refusal classifier must classify AT HIS ENTRY CLOCK, and must not match on substrings.

ALGO-062 §2. A wrong classifier publishes a clean-looking table, so it owes a red-proof exactly
like a test does. The convicting case is real: the first version returned GATE_OVER_STRICT with
`acceptance_bars` named for all four lost sessions, because it matched "ACCEPTED_BREAK" inside
Route D's COMPOSITE refusal `NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED`
— a name that means "neither D form qualified" — while the gate actually killing the candidates
was something else entirely.
"""
from __future__ import annotations

import pytest

from research import run_refusal_diagnosis_lost_four as D

#: Route D's composite refusal. It CONTAINS the string "ACCEPTED_BREAK" while saying that
#: NEITHER form qualified, and its detail names the real sub-reasons.
COMPOSITE_WITH_FOREIGN_SUBSTRING = (
    "NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED: "
    "accepted_break=NO_COMPLETED_PRINT_BEYOND_THE_ZONE; "
    "repeat_test=REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST")

#: The same shape, but where the acceptance requirement genuinely IS the operative sub-reason.
COMPOSITE_WHERE_ACCEPTANCE_IS_OPERATIVE = (
    "NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED: "
    "accepted_break=BREAK_NOT_ACCEPTED_BEFORE_RETEST; "
    "repeat_test=REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST")


def _rec(killed_at, refusal=None, outcome="REJECTED"):
    return {"outcome": outcome, "killed_at": killed_at,
            "route_refusals": {"D_PREBREAK_RETEST_BREAKOUT": refusal} if refusal else None}


def _old_substring_logic(rows) -> bool:
    """THE LOGIC THAT WAS WRONG, kept so the fixture can prove it WOULD have fired.

    A red-proof of a classifier has to show the defect being caught, and the only way to show
    that is to run the defect. This is the exact scan-then-never-rank shape of the first
    version: split off the detail, then look for the substring in what remains.
    """
    for r in rows:
        for _route, why in (r.get("route_refusals") or {}).items():
            head = str(why).split(":")[0]
            if "ACCEPTED_BREAK" in head or "NOT_ACCEPTED" in head:
                return True          # would have said GATE_OVER_STRICT / acceptance_bars
    return False


def test_DISCRIMINATES_a_composite_containing_another_gates_substring():
    """The ordered fixture: composite carries the substring, a DIFFERENT gate is operative.

    The old logic must fire (proving the fixture reproduces the defect) and the current
    classifier must NOT call it an acceptance problem.
    """
    rows = [_rec("REJECTION_STORY_INCOMPLETE", COMPOSITE_WITH_FOREIGN_SUBSTRING),
            _rec("REJECTION_STORY_INCOMPLETE", COMPOSITE_WITH_FOREIGN_SUBSTRING)]

    assert _old_substring_logic(rows) is True, (
        "the fixture does not reproduce the defect - it proves nothing")

    cls, why = D.classify_at_clock(rows)
    assert cls == "STORY_NOT_RECOGNIZED", f"got {cls}: {why}"
    assert "acceptance_bars" not in why
    assert "acceptance is NOT operative" in why


def test_it_DOES_name_acceptance_when_that_sub_reason_is_genuinely_operative():
    """POSITIVE CONTROL. Without it the test above passes for a classifier that never blames
    acceptance at all, which would be a different wrong answer."""
    rows = [_rec("NO_LEGAL_ROUTE_MATCHED", COMPOSITE_WHERE_ACCEPTANCE_IS_OPERATIVE)]
    cls, why = D.classify_at_clock(rows)
    assert cls == "GATE_OVER_STRICT", f"got {cls}: {why}"
    assert "acceptance_bars" in why
    assert D.ACCEPTANCE_REFUSAL in why


def test_the_subreason_parser_keeps_the_detail_after_the_colon():
    """The detail is the only part that says WHICH form failed; the old code discarded it."""
    subs = D._subreasons([_rec("NO_LEGAL_ROUTE_MATCHED", COMPOSITE_WITH_FOREIGN_SUBSTRING)])
    assert any("accepted_break=NO_COMPLETED_PRINT_BEYOND_THE_ZONE" in k for k in subs), subs
    assert any("repeat_test=REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST" in k for k in subs), subs
    assert not any(k.endswith("NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED")
                   for k in subs), "the composite head was kept instead of its sub-reasons"


def test_NO_CANDIDATE_AT_ENTRY_is_its_own_class():
    """ALGO-062: arguably the most important answer, so it may not fall into OTHER."""
    cls, why = D.classify_at_clock([])
    assert cls == D.NO_CANDIDATE_AT_ENTRY
    assert "not deciding at all" in why


def test_AN_EMPTY_ZONE_MATCH_WITH_A_BUSY_BUCKET_IS_A_DIFFERENT_ANSWER():
    """The split the repaired join made visible, and it changes which repair is indicated.

    No candidate AT HIS ZONE while the machine is evaluating dozens on his side means it WAS
    deciding and simply has no authorized location at his level - a location-map finding, not
    "it never reached the interaction". One class covering both would hide that.
    """
    zone = {"lo": 100.0, "hi": 100.25, "role": "SUPPORT"}
    on_side = [{"location_lo": 127.0, "location_hi": 135.0, "killed_at": "X"},
               {"location_lo": 150.0, "location_hi": 160.0, "killed_at": "X"}]
    cls, why = D.classify_at_clock([], on_side, zone)
    assert cls == D.LOCATION_NOT_IN_MAP
    assert "NONE of its locations covers" in why
    assert "gap 26.75 points" in why, why


def test_the_nearest_band_reports_ZERO_gap_when_it_actually_overlaps():
    """Positive control for the gap measure - otherwise every gap could be nonzero garbage."""
    zone = {"lo": 100.0, "hi": 102.0, "role": "SUPPORT"}
    gap, lo, hi = D._nearest_band([{"location_lo": 101.0, "location_hi": 105.0}], zone)
    assert (gap, lo, hi) == (0.0, 101.0, 105.0)


def test_a_survivor_at_his_clock_is_BUDGET_not_a_refusal():
    cls, _ = D.classify_at_clock([_rec(None, None, outcome="SURVIVED_TO_RANKING")])
    assert cls == "BUDGET"


@pytest.mark.parametrize("gate,expected", [
    ("NO_AUTHORIZED_LOCATION_ON_THIS_SIDE", "LOCATION"),
    ("FORCE_NOT_CONFIRMED", "FORCE"),
    ("REJECTION_STORY_INCOMPLETE", "STORY_NOT_RECOGNIZED"),
])
def test_each_gate_maps_to_its_own_class(gate, expected):
    cls, _ = D.classify_at_clock([_rec(gate)])
    assert cls == expected


def test_the_zone_join_is_by_PRICE_overlap_not_by_id():
    """He marks a band; the machine has its own locations. The join must be geometric."""
    zone = {"lo": 100.0, "hi": 102.0, "role": "SUPPORT"}
    assert D._overlaps({"location_lo": 101.0, "location_hi": 105.0}, zone) is True
    assert D._overlaps({"location_lo": 98.0, "location_hi": 100.0}, zone) is True
    assert D._overlaps({"location_lo": 103.0, "location_hi": 110.0}, zone) is False
    assert D._overlaps({"location_lo": None, "location_hi": None}, zone) is False
    assert D._overlaps({"location_lo": 101.0, "location_hi": 105.0}, None) is False


def test_a_long_joins_SUPPORT_and_a_short_joins_RESISTANCE():
    label = {"trader_zones": [{"lo": 1, "hi": 2, "role": "SUPPORT"},
                              {"lo": 9, "hi": 10, "role": "RESISTANCE"}]}
    assert D._his_zone(label, "L")["role"] == "SUPPORT"
    assert D._his_zone(label, "S")["role"] == "RESISTANCE"


# ── ALGO-066: a BREAK entry must never be read against Route A ──────────────────────────────
#
# My zone join assumed every entry is a REJECTION (long at support, short at resistance) and
# picked the wrong zone on THREE of five sessions, including the control. ALGO-009's contract
# says price either REJECTS or BREAKS the level; on a BREAK a long interacts with RESISTANCE
# and a short with SUPPORT. These pin the derivation so the assumption cannot come back.

from research import run_j16_unified_session_resolution as J  # noqa: E402


@pytest.mark.parametrize("role,direction,expected", [
    ("SUPPORT", "L", "REJECT"),        # long bouncing off support
    ("RESISTANCE", "S", "REJECT"),     # short rejecting resistance
    ("RESISTANCE", "L", "BREAK"),      # long THROUGH resistance - the case I deleted
    ("SUPPORT", "S", "BREAK"),         # short THROUGH support - likewise
])
def test_the_interaction_is_derived_from_role_and_direction(role, direction, expected):
    assert J.interaction_of(role, direction) == expected


def test_an_unknown_role_is_PUBLISHED_not_forced_into_a_family():
    assert J.interaction_of("FVG_BAND", "L") == J.UNCLASSIFIED


def test_a_BREAK_entry_is_not_judged_against_the_REJECTION_family():
    """THE WITNESS ALGO-066 ORDERED. A long at resistance is a BREAK; asking Route A for a
    rejection story there and calling the refusal a finding is what produced my 03-31 reading.

    A refusal of the WRONG family is not a refusal.
    """
    assert J.interaction_of("RESISTANCE", "L") == J.BREAK
    assert J.interaction_of("RESISTANCE", "L") != J.REJECT
    # And the break family the story lane must ask is the B/C/D set, never Route A.
    assert J.ROUTE_A not in J.BREAK_FAMILY
    assert len(J.BREAK_FAMILY) == 3


def test_zone_selection_is_GEOMETRIC_and_prefers_the_bar_it_is_inside():
    """J1: inside the entry bar wins; the role plays no part in the selection."""
    class Bar:
        low, high = 23416.75, 23531.5          # 2026-03-31's entry bar
    zones = [{"lo": 23311.75, "hi": 23312.0, "role": "SUPPORT", "marked_time": "x"},
             {"lo": 23436.5, "hi": 23436.75, "role": "RESISTANCE", "marked_time": "x"}]
    sel = J.select_zone(zones, Bar())
    assert sel["selected"]["role"] == "RESISTANCE", "geometry must beat the role assumption"
    assert sel["selected"]["inside_entry_bar"] is True
    assert sel["ambiguous"] is False


def test_BOTH_zones_plausible_is_published_as_AMBIGUOUS_never_picked():
    """J1: an ambiguity resolved by a preference is a preference wearing a measurement's coat."""
    class Bar:
        low, high = 100.0, 200.0
    zones = [{"lo": 120.0, "hi": 120.25, "role": "SUPPORT", "marked_time": "x"},
             {"lo": 180.0, "hi": 180.25, "role": "RESISTANCE", "marked_time": "x"}]
    sel = J.select_zone(zones, Bar())
    assert sel["ambiguous"] is True
    assert sel["selected"] is None, "an ambiguous selection must not silently pick one"
