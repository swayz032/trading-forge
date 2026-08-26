"""The derivation layer must DECIDE, not default. Every predicate proven both ways.

ALGO-029 item 1. The code this replaces returns `approach=True` unconditionally, so the tests
that matter here are the NEGATIVE ones: price that never touched the zone, price that sat
inside it all along, and a touch without directional control must all be REFUSED. A derivation
layer that says yes as often as the literal it replaces has achieved nothing.
"""
from __future__ import annotations

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_derivation as D

TZ = "America/New_York"
LO, HI = 100.0, 102.0
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35


def bars(rows):
    """rows: list of (open, high, low, close), oldest first."""
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


# --- APPROACH: the conjunct that is currently a hardcoded True ---------------------------

def test_price_that_never_touches_the_zone_is_NOT_an_approach():
    """`mere_approach_without_touch -> NO_TRADE`. The spec's line, enforced."""
    b = bars([(110, 111, 109, 110), (109, 110, 108, 109), (108, 109, 107, 108)])
    a = D.derive_approach(b, LO, HI)
    assert a.reached is False and a.real is False
    assert a.reason == D.NO_TOUCH


def test_price_that_sat_INSIDE_the_zone_all_along_has_approached_nothing():
    """The subtlest case, and the one the literal gets most wrong.

    Every bar touches the band, so a naive `_reaches` says yes on all of them. But nothing
    CAME to the level - it was already there. There is no approach to have a story about.
    """
    b = bars([(101, 101.5, 100.5, 101), (101, 101.6, 100.4, 100.8), (100.8, 101.2, 100.2, 101)])
    a = D.derive_approach(b, LO, HI)
    assert a.reached is True, "it does touch"
    assert a.came_from_outside is False
    assert a.real is False, "touching is not approaching"


def test_coming_down_from_above_and_touching_IS_an_approach():
    # bar0 wholly above; bar1 already touching; bar2 touching -> the last WHOLLY OUTSIDE bar
    # is two back, which is what `bars_since_outside` reports.
    b = bars([(110, 111, 109, 110), (109, 110, 101.5, 102.5), (102.5, 103, 100.5, 101)])
    a = D.derive_approach(b, LO, HI)
    assert a.real is True
    assert a.approached_from == "ABOVE"
    assert a.bars_since_outside == 2


def test_coming_up_from_below_and_touching_IS_an_approach():
    b = bars([(90, 91, 89, 90), (90, 95, 90, 95), (95, 100.5, 95, 100.2)])
    a = D.derive_approach(b, LO, HI)
    assert a.real is True and a.approached_from == "BELOW"


def test_too_few_bars_refuses_rather_than_guessing():
    a = D.derive_approach(bars([(110, 111, 109, 110)]), LO, HI)
    assert a.real is False and a.reason == D.NOT_ENOUGH_BARS


def test_approach_is_never_true_by_default():
    """The whole point. There must be NO input for which `real` is true without a touch."""
    for rows in ([(110, 111, 109, 110)] * 4, [(90, 91, 89, 90)] * 4):
        assert D.derive_approach(bars(rows), LO, HI).real is False


# --- INTERACTION: which of the spec's six -------------------------------------------------

#: A neutral trailing trigger. `_classify` drops it, and `derive_story` reads only its
#: follow-through - it must never be where the interaction evidence lives (ALGO-033).
TRIGGER = (109.7, 111.0, 109.5, 110.5)


def _classify(rows, direction="L"):
    """Classify the interaction over the COMPLETED window, dropping the trigger.

    ALGO-033: interaction geometry reads on completed bars ending at the prior bar, and the
    trigger carries force and follow-through only. `derive_story` splits them itself; this
    helper mirrors that split so the tests exercise the same call the real path makes.
    """
    return D.classify_interaction(bars(rows[:-1]), direction, LO, HI, BODY, CLOSE_LOC, WICK)


def test_a_touch_with_no_directional_control_is_refused():
    """`touch_without_directional_control -> WAIT_OR_NO_TRADE`."""
    # comes from above, touches, but the last bar is a limp doji - no control
    # ALGO-096B: moved to a bar HIS definition also refuses. The old bar entered the band
    # and closed back out ABOVE hi=102 - a REJECTION under ALGO-071 s3, refused only by the
    # retired body_frac. This one closes at 99.5, BELOW lo=100: the level BROKE.
    r = _classify([(110, 111, 109, 110), (109, 110, 103, 104),
                   (102, 102.4, 99.0, 99.5), (102, 102.2, 101.8, 102.02)])
    assert r.valid is False
    assert r.reason == D.NO_CONTROL


def test_touch_and_reject_is_named():
    """Comes from above, wicks into the zone, closes back up WITH CONTROL.

    The control bar has to satisfy three thresholds at once - body >= 0.62R, close in the top
    0.22R, and a lower wick >= 0.35R - which a big-wick/small-body hammer does NOT. A first
    fixture here was a 0.125 body-fraction pin and the module correctly refused it. That
    refusal is the spec's `touch_without_directional_control` line working, so the fixture was
    fixed rather than the module.
    """
    r = _classify([(112, 113, 111, 112), (111, 112, 103, 104),
                   (103.5, 110.0, 100.0, 109.7), TRIGGER])
    assert r.approach.real is True
    assert r.kind == D.TOUCH_AND_REJECT, r
    assert r.control is True
    assert r.valid is True


def test_a_sweep_that_takes_liquidity_below_and_closes_back_is_named():
    r = _classify([(110, 111, 109, 110), (109, 110, 104, 105),
                   (104, 105, 99.0, 104.5), TRIGGER])
    assert r.kind in (D.SWEEP_AND_RECLAIM, D.TOUCH_AND_REJECT), r
    assert r.approach.real is True


def test_a_failed_breakout_back_inside_is_named():
    """A COMPLETED close beyond the zone, then back inside."""
    r = _classify([(110, 111, 109, 110), (109, 110, 98, 98.5),
                   (98.5, 101.5, 98.4, 101.2), TRIGGER])
    assert r.kind == D.FAILED_BREAKOUT_BACK_INSIDE, r


def test_the_six_interaction_names_match_the_frozen_spec_verbatim():
    """If the spec is edited, this must be updated deliberately, not silently drift."""
    import io
    import json
    spec = json.load(io.open("research/current_mnq_strategy_v2_4_spec.json", encoding="utf-8"))
    frozen = spec["zone_gate"]["valid_rejection_interactions"]
    stripped = [f.replace("_then_live_force", "") for f in frozen]
    assert sorted(stripped) == sorted(D.INTERACTIONS), (
        f"spec says {sorted(stripped)}, module says {sorted(D.INTERACTIONS)}")


def test_no_interaction_is_returned_without_a_real_approach():
    """Every branch is downstream of the approach gate - none can bypass it."""
    inside_forever = [(101, 101.5, 100.5, 101)] * 5
    r = _classify(inside_forever)
    assert r.kind is None and r.valid is False


# --- it is BUILD ONLY --------------------------------------------------------------------

def test_it_is_not_imported_by_the_kernel_or_the_entry_path():
    """ALGO-029 section 2: build now, accept later. It must not be wired in yet."""
    import ast
    import io
    for mod in ("current_mnq_strategy_v2_4_kernel", "current_mnq_strategy_v2_4_entries",
                "current_mnq_strategy_v2_4_engine", "current_mnq_strategy_v2_4_signal"):
        tree = ast.parse(io.open(f"research/{mod}.py", encoding="utf-8").read())
        for n in ast.walk(tree):
            mods = []
            if isinstance(n, ast.ImportFrom):
                mods = [n.module or ""]
            elif isinstance(n, ast.Import):
                mods = [a.name for a in n.names]
            assert not any("v2_4_derivation" in m for m in mods), (
                f"{mod} imports the derivation layer - acceptance is still gated on the grade")


def test_it_declares_itself_build_only():
    assert "BUILD_ONLY" in D.DIAGNOSTIC_ONLY
    assert "grade passes" in D.DIAGNOSTIC_ONLY


@pytest.mark.parametrize("name", list(D.INTERACTIONS))
def test_every_declared_interaction_is_a_real_constant(name):
    assert isinstance(name, str) and name and not name.endswith("_then_live_force")


# ═════════════════════════════════════════════════════════════════════════════════════════
# THE STORY LAYER. The spec's `negative_semantic_fixtures` ARE the acceptance criteria, so
# each one this layer is responsible for gets a test named after it. A story layer is proven
# by what it REFUSES, not by what it permits.
# ═════════════════════════════════════════════════════════════════════════════════════════

def _story(rows, direction="L"):
    return D.derive_story(bars(rows), direction, LO, HI, BODY, CLOSE_LOC, WICK)


#: A clean long IN THE TAUGHT SHAPE (ALGO-033): the rejection candle COMPLETES, and only then
#: does the trigger follow through. Four bars:
#:   0  wholly above the zone
#:   1  travelling down, still wholly above  -> together these make the APPROACH
#:   2  THE REJECTION - touches the zone, big lower wick, strong body, closes back up
#:   3  THE TRIGGER   - a forming bar whose only job is to carry the direction forward
#: Reused as the POSITIVE WITNESS everywhere below, so every refusal is proven to be about the
#: defect and not about a layer that refuses everything.
CLEAN_LONG = [(112, 113, 111, 112), (111, 112, 103, 104),
              (103.5, 110.0, 100.0, 109.7), (109.7, 111.0, 109.5, 110.5)]


def test_the_positive_witness_completes():
    s = _story(CLEAN_LONG)
    assert s.complete is True, s
    assert s.approach and s.fight and s.decision
    assert s.refusal is None


def test_fixture_mere_approach_that_never_reaches_zone():
    s = _story([(120, 121, 119, 120), (119, 120, 118, 119),
                (118, 119, 117, 118), (117, 118, 116, 117)])
    assert s.complete is False
    assert s.refusal == D.NO_TOUCH


def test_fixture_mixed_overlap_and_two_sided_wicks():
    """A bar that argues with itself is not a decision. `mixed_or_indecisive_control -> WAIT`.

    The conflict now has to be planted on the COMPLETED rejection bar, because that is where
    the story is read - the trigger's wicks are still forming (ALGO-033).
    """
    rows = CLEAN_LONG[:2] + [(101.2, 110.0, 92.0, 101.0)] + CLEAN_LONG[-1:]
    s = _story(rows)
    assert s.two_sided_conflict is True
    assert s.refusal == D.TWO_SIDED_CONFLICT
    assert s.complete is False


def test_fixture_doji_at_zone_without_directional_takeover():
    """Touches the level, but nobody takes control - planted on the completed bar."""
    rows = CLEAN_LONG[:2] + [(101.0, 102.3, 100.2, 101.05)] + CLEAN_LONG[-1:]
    s = _story(rows)
    assert s.complete is False
    assert s.refusal in (D.NO_TAKEOVER, D.TWO_SIDED_CONFLICT), s


def test_fixture_counter_bias_reversal_without_completed_control_transfer():
    """A complete rejection, and then a TRIGGER that gives the direction straight back.

    This is the cleanest separation of the two stages: the fight is won on the completed bar
    and the decision is refused on the trigger.
    """
    rows = CLEAN_LONG[:-1] + [(109.7, 110.0, 108.0, 108.5)]   # trigger closes DOWN
    s = _story(rows)
    assert s.refusal == D.NO_CONTROL_TRANSFER, s
    assert s.fight is True, "the fight happened; the decision did not"
    assert s.complete is False


def test_two_sided_wick_conflict_discriminates():
    """POSITIVE AND NEGATIVE. It must fire on a conflicted bar and stay silent on a clean one."""
    # ALGO-096B: the taught negative is kept; only its EXPRESSION changes. Indecision is now
    # "the completed bar closed INSIDE the band", not a pair of wick fractions.
    conflicted = bars([(101.2, 110.0, 92.0, 101.0)]).iloc[0]   # close 101.0 INSIDE [100,102]
    clean = bars([(103.5, 110.0, 100.0, 109.7)]).iloc[0]       # close 109.7 OUT on near side
    assert D.two_sided_wick_conflict(conflicted, LO, HI) is True
    assert D.two_sided_wick_conflict(clean, LO, HI) is False


def test_a_refusal_always_names_itself():
    """A story that refuses without saying why teaches nobody anything."""
    for rows in ([(120, 121, 119, 120)] * 4,
                 CLEAN_LONG[:2] + [(101.2, 110.0, 92.0, 101.0)] + CLEAN_LONG[-1:],
                 CLEAN_LONG[:2] + [(101.0, 102.3, 100.2, 101.05)] + CLEAN_LONG[-1:]):
        s = _story(rows)
        assert s.complete is False
        assert s.refusal, f"refused with no reason: {s}"


def test_complete_requires_all_three_and_no_refusal():
    """The same shape as `core.Story.complete` - but nothing in it is a literal."""
    import inspect
    src = inspect.getsource(D.DerivedStory)
    assert "self.approach and self.fight and self.decision" in src
    assert "self.refusal is None" in src
    # and none of the three is ever assigned a bare True in the deriver
    dsrc = inspect.getsource(D.derive_story)
    assert "approach=True" not in dsrc and "fight=True" not in dsrc


def test_the_refused_fixtures_are_named_in_the_frozen_spec():
    """The refusals must trace to the spec, not to my judgement."""
    import io
    import json
    spec = json.load(io.open("research/current_mnq_strategy_v2_4_spec.json", encoding="utf-8"))
    neg = spec["negative_semantic_fixtures"]
    for needed in ("mixed_overlap_and_two_sided_wicks",
                   "doji_or_spinning_top_at_zone_without_directional_takeover",
                   "counter_bias_reversal_without_completed_control_transfer",
                   "sweep_reclaim_without_hold_or_directional_defense"):
        assert needed in neg, f"{needed} is not in the frozen spec - do not invent refusals"


# ═════════════════════════════════════════════════════════════════════════════════════════
# Two defects the FIRST REAL CHECKPOINT exposed that no synthetic test had. Both are about
# telling the truth rather than about being strict.
# ═════════════════════════════════════════════════════════════════════════════════════════

def test_a_touch_that_matches_no_interaction_does_not_claim_it_never_touched():
    """The checkpoint reported 5 cases as MERE_APPROACH_WITHOUT_TOUCH in state
    WAIT_STORY_INCOMPLETE. They HAD touched - the approach gate had already passed them - and
    the refusal named the wrong reason. A refusal that misdirects is worse than a silent one.
    """
    # comes from above, touches, has control, but no named interaction shape
    rows = [(112, 113, 111, 112), (111, 112, 103, 104),
            (101.9, 102.0, 101.0, 101.98), TRIGGER]
    r = _classify(rows)
    if r.kind is None:
        assert r.reason != D.NO_TOUCH, (
            "it touched - saying MERE_APPROACH_WITHOUT_TOUCH sends the reader to the wrong "
            "place entirely")
        assert r.reason in (D.NO_RECOGNISED_INTERACTION, D.NO_CONTROL)


def test_the_wrong_reason_string_is_unreachable_after_a_real_approach():
    """Whenever the approach IS real, no refusal may claim the approach was not."""
    for rows in ([(112, 113, 111, 112), (111, 112, 103, 104),
                  (101.9, 102.0, 101.0, 101.98), TRIGGER],
                 CLEAN_LONG[:2] + [(101.0, 102.3, 100.2, 101.05)] + CLEAN_LONG[-1:]):
        r = _classify(rows)
        if r.approach.real:
            assert r.reason != D.NO_TOUCH, (rows, r)


def test_all_matching_interactions_are_reported_not_just_the_first():
    """The checkpoint named `touch_and_reject` ZERO times in 68 grants.

    Not because it never happens - because the sequence-level forms shadowed it in an elif
    chain. A single-label classifier hides that; `all_kinds` makes it visible.
    """
    r = _classify(CLEAN_LONG)
    assert r.all_kinds, "no interaction reported at all"
    assert r.kind == r.all_kinds[0], "kind must be the first of all_kinds"
    assert D.TOUCH_AND_REJECT in r.all_kinds, (
        "the clean fixture IS a touch-and-reject; if it cannot be named the ordering is "
        "shadowing it again")


def test_all_kinds_is_a_subset_of_the_frozen_six():
    for rows in (CLEAN_LONG, [(110, 111, 109, 110), (109, 110, 98, 98.5),
                              (98.5, 101.5, 98.4, 101.2)]):
        r = _classify(rows)
        assert set(r.all_kinds) <= set(D.INTERACTIONS), r.all_kinds
