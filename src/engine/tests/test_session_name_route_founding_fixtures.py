"""FOUNDING FIXTURES for the name-first session resolver (REDESIGN sub-packet 1,
R-284 Decision A) — AUTHORED BY THE INDEPENDENT GRADER (doer != grader).

WHY THIS FILE EXISTS
────────────────────
The build (cdb94a84) made the (ii)-honesty conjunction and turned the
clock-derived coarse-overlap bind into a REFUSAL. This file is the grader's
founding red-proof battery for that change: 14 founding instances, each the
FIRST test case of a defect class the redesign closes, each CONVICTED by the new
resolver, and each carrying an ANTI-VACUITY COMPANION so no assertion can pass
vacuously (a resolver that always-refused, or always-bound, would flip a
companion red).

Three classes (8 + 3 + 3 = 14):

  A. MIS-TYPE-BIND (8) — the "dead 8". A clock/anchor-derived COARSE overlap that
     the OLD lane BOUND (approximation=True, mistyped as an honest bind). Precision
     0/8 BY CONSTRUCTION: none of the 8 carries an unambiguous closed-enum NAME, so
     none has an exact window `is_in_killzone` can gate — every one must now REFUSE
     (bindable=False, never approximation=True). ANTI-VACUITY: the pure NAME for the
     SAME zone still binds it (approximation=False) — proving the refusal is about the
     clock-coarse nature, not an inability to bind that zone.

  B. FALSE-REFUSAL (3) — the false-NEGATIVE direction. A genuine PURE-NAME teaching
     (closed-enum, NO clock) that MUST bind its exact window. ANTI-VACUITY: a
     minimally-different near-miss (same name + a clock, or the ambiguous bare "New
     York session") must REFUSE — proving the bind is earned by the pure name, not by
     any mention of the word.

  C. SECOND-DEFECT (3) — windows-wrong-even-when-typed-right. A taught window that
     WRAPS midnight: min/max coarse derivation returns the COMPLEMENT (the wrong
     killzone) — a bind that is wrong even if you accept the bind. The new resolver
     REFUSES it by name (wrapping_window_unrepresentable). ANTI-VACUITY: the pure NAME
     for a real zone binds the CORRECT window — proving the refusal is the wrap defect,
     not incapacity.

Every literal here was authored by the grader for this file. Scored through
`bind_condition()` — the PRODUCTION entry point — never `classify_session_role`
directly, so a resolver correct in isolation but mis-wired still shows up here.
"""

from __future__ import annotations

import pytest

from src.engine.spec_family_bindings import (
    SESSION_TEACHING_UNBOUND_REASON,
    SESSION_WRAPPING_WINDOW_UNBOUND_REASON,
    bind_condition,
)

NAME_ROUTE_PRIMITIVE = "session_windows.is_in_killzone"
NOT_RECOGNIZED = "no_recognized_session_keyword"


@pytest.fixture
def role_resolver_on(monkeypatch):
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")


def _bind(text: str):
    return bind_condition(
        {"id": "fixture:" + text[:40], "type": "WAIT_SESSION", "object": text, "role": "spine"}
    )


# ─────────────────────────────────────────────────────────────────────────────
# CLASS A — 8 MIS-TYPE-BINDS (the dead 8). Each: a clock/anchor-derived coarse
# teaching that the OLD lane bound approximation=True; the new resolver REFUSES.
# companion_name = the pure NAME for the SAME zone (anti-vacuity: must still bind).
# ─────────────────────────────────────────────────────────────────────────────
MIS_TYPE_BINDS = [
    # (id, coarse_text, coarse_zone_under_old, companion_name, companion_zone)
    ("A1_ny_am_830",  "only take the setup after 8:30 a.m. once the range has formed", "ny_am", "ny am", "ny_am"),
    ("A2_ny_am_930",  "wait for the 9:30 a.m. candle to close before entering",        "ny_am", "new york am", "ny_am"),
    ("A3_ny_pm_3pm",  "price usually reverses around 3 p.m. so I flatten before that", "ny_pm", "ny pm", "ny_pm"),
    ("A4_ny_am_span", "from 7:00 a.m. to 9:00 a.m. I am only watching, not trading",   "ny_am", "new york morning", "ny_am"),
    ("A5_sb_1011",    "I take one trade between 10:00 a.m. and 11:00 a.m. on the index futures", "silver_bullet", "silver bullet", "silver_bullet"),
    ("A6_ny_am_nyse", "the NYSE open is the only time I will take a market order",      "ny_am", "ny morning", "ny_am"),
    ("A7_ny_pm_345",  "I scale out into 3:45 p.m. as the close approaches",            "ny_pm", "new york pm", "ny_pm"),
    ("A8_ny_am_cash", "I only trade the two hours following the cash open",            "ny_am", "am session", "ny_am"),
]


@pytest.mark.parametrize("fid,coarse,coarse_zone,name,name_zone", MIS_TYPE_BINDS, ids=[r[0] for r in MIS_TYPE_BINDS])
def test_mis_type_bind_now_refuses_and_companion_name_still_binds(fid, coarse, coarse_zone, name, name_zone, role_resolver_on):
    """RED-PROOF: a clock/anchor coarse teaching must NOT bind (precision 0/8).
    ANTI-VACUITY: the pure name for the same zone still binds approximation=False."""
    b = _bind(coarse)
    # The mis-type-bind is convicted: it refuses, and NEVER produces an approximation=True bind.
    assert b.bindable is False, f"{fid}: clock-coarse teaching wrongly bound zone={b.session_zone}"
    assert not (b.bindable and b.approximation), f"{fid}: approximation=True coarse bind resurrected"
    assert b.reason in (SESSION_TEACHING_UNBOUND_REASON, NOT_RECOGNIZED), (fid, b.reason)

    # ANTI-VACUITY companion: the resolver CAN bind this zone by its pure name.
    c = _bind(name)
    assert c.bindable is True, f"{fid}: companion name {name!r} failed to bind (anti-vacuity broken)"
    assert c.approximation is False and c.primitive == NAME_ROUTE_PRIMITIVE, (fid, c.primitive)
    assert c.session_zone == name_zone, (fid, c.session_zone)


def test_class_a_precision_is_zero_over_eight_by_construction(role_resolver_on):
    """Aggregate: of the 8 clock/anchor coarse rows, ZERO produce a live bind."""
    bound = [r[0] for r in MIS_TYPE_BINDS if _bind(r[1]).bindable]
    assert bound == [], f"clock-coarse rows still binding (precision != 0/8): {bound}"


# ─────────────────────────────────────────────────────────────────────────────
# CLASS B — 3 FALSE-REFUSALS. A genuine PURE-NAME teaching that MUST bind.
# companion = a minimally-different near-miss that MUST refuse (name+clock, or
# the ambiguous bare "New York session"). Anti-vacuity: an always-bind resolver
# would flip the companion red.
# ─────────────────────────────────────────────────────────────────────────────
FALSE_REFUSALS = [
    # (id, pure_name_text, expected_zone, companion_near_miss)
    ("B1_london", "london killzone entries only", "london", "only enter the london killzone after 3 a.m."),
    ("B2_silver_bullet", "trade the silver bullet only", "silver_bullet", "trade the silver bullet at 10 a.m."),
    ("B3_ny_pm", "new york pm session", "ny_pm", "wait for the new york session"),
]


@pytest.mark.parametrize("fid,name,zone,near_miss", FALSE_REFUSALS, ids=[r[0] for r in FALSE_REFUSALS])
def test_pure_name_teaching_binds_and_near_miss_refuses(fid, name, zone, near_miss, role_resolver_on):
    """RED-PROOF: a genuine pure-name teaching must NOT be wrongly refused.
    ANTI-VACUITY: a minimally-different near-miss (clock-carrying, or ambiguous)
    must refuse — proving the bind is earned by the pure closed-enum name."""
    b = _bind(name)
    assert b.bindable is True, f"{fid}: genuine pure-name teaching {name!r} wrongly refused (false-negative)"
    assert b.approximation is False and b.primitive == NAME_ROUTE_PRIMITIVE, (fid, b.primitive)
    assert b.session_zone == zone, (fid, b.session_zone)

    # ANTI-VACUITY companion: the near-miss must NOT bind.
    c = _bind(near_miss)
    assert c.bindable is False, f"{fid}: near-miss {near_miss!r} wrongly bound zone={c.session_zone} (anti-vacuity broken)"


# ─────────────────────────────────────────────────────────────────────────────
# CLASS C — 3 SECOND-DEFECTS (windows-wrong-even-when-typed-right). A window that
# WRAPS midnight: min/max derives the COMPLEMENT killzone — wrong even if bound.
# The new resolver refuses by name. companion = a pure name binding the CORRECT
# window (anti-vacuity: the target zone IS bindable, so the refusal is the wrap
# defect, not incapacity).
# ─────────────────────────────────────────────────────────────────────────────
SECOND_DEFECTS = [
    # (id, wrap_text, coarse_complement_zone, companion_name, companion_zone)
    ("C1_wrap_1600_0930", "trade the range from 4:00 p.m. eastern until 9:30 a.m. eastern on the NYSE", "ny_pm", "ny pm", "ny_pm"),
    ("C2_wrap_1800_0300", "we trade the ES range from 6:00 p.m. until 3:00 a.m. eastern", "ny_am", "london session", "london"),
    ("C3_wrap_2300_0200", "from 11:00 p.m. to 2:00 a.m. eastern the market is quiet, avoid entries on ES", "ny_am", "silver bullet", "silver_bullet"),
]


@pytest.mark.parametrize("fid,wrap,complement,name,name_zone", SECOND_DEFECTS, ids=[r[0] for r in SECOND_DEFECTS])
def test_wrap_window_refused_by_name_and_companion_binds_correct_window(fid, wrap, complement, name, name_zone, role_resolver_on):
    """RED-PROOF: a midnight-wrapping window (whose coarse min/max derives the
    COMPLEMENT killzone) is refused BY NAME, never complement-bound.
    ANTI-VACUITY: the pure name for a real zone binds the CORRECT window."""
    b = _bind(wrap)
    assert b.bindable is False, f"{fid}: wrapping window complement-bound zone={b.session_zone}"
    assert b.session_zone is None, (fid, b.session_zone)
    assert b.reason == SESSION_WRAPPING_WINDOW_UNBOUND_REASON, (fid, b.reason)

    # ANTI-VACUITY companion: a pure name binds the correct exact window.
    c = _bind(name)
    assert c.bindable is True and c.approximation is False, f"{fid}: companion {name!r} did not bind (anti-vacuity broken)"
    assert c.session_zone == name_zone and c.primitive == NAME_ROUTE_PRIMITIVE, (fid, c.session_zone)


def test_fourteen_founding_fixtures_present():
    """The battery is exactly the 14 founding instances (8 + 3 + 3)."""
    assert len(MIS_TYPE_BINDS) == 8
    assert len(FALSE_REFUSALS) == 3
    assert len(SECOND_DEFECTS) == 3
    assert len(MIS_TYPE_BINDS) + len(FALSE_REFUSALS) + len(SECOND_DEFECTS) == 14
