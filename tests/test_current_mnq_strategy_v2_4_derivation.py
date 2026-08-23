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

def _classify(rows, direction="L"):
    return D.classify_interaction(bars(rows), direction, LO, HI, BODY, CLOSE_LOC, WICK)


def test_a_touch_with_no_directional_control_is_refused():
    """`touch_without_directional_control -> WAIT_OR_NO_TRADE`."""
    # comes from above, touches, but the last bar is a limp doji - no control
    r = _classify([(110, 111, 109, 110), (109, 110, 103, 104),
                   (102, 102.4, 100.1, 102.1), (102, 102.2, 101.8, 102.02)])
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
                   (103.5, 110.0, 100.0, 109.7)])
    assert r.approach.real is True
    assert r.kind == D.TOUCH_AND_REJECT, r
    assert r.control is True
    assert r.valid is True


def test_a_sweep_that_takes_liquidity_below_and_closes_back_is_named():
    r = _classify([(110, 111, 109, 110), (109, 110, 104, 105),
                   (104, 105, 99.0, 104.5)])
    assert r.kind in (D.SWEEP_AND_RECLAIM, D.TOUCH_AND_REJECT), r
    assert r.approach.real is True


def test_a_failed_breakout_back_inside_is_named():
    """A COMPLETED close beyond the zone, then back inside."""
    r = _classify([(110, 111, 109, 110), (109, 110, 98, 98.5),
                   (98.5, 101.5, 98.4, 101.2)])
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


#: A clean long: comes from above, wicks the zone, closes strongly up. Reused as the POSITIVE
#: WITNESS everywhere below, so every refusal is proven to be about the defect and not about
#: the layer refusing everything.
CLEAN_LONG = [(112, 113, 111, 112), (111, 112, 103, 104), (103.5, 110.0, 100.0, 109.7)]


def test_the_positive_witness_completes():
    s = _story(CLEAN_LONG)
    assert s.complete is True, s
    assert s.approach and s.fight and s.decision
    assert s.refusal is None


def test_fixture_mere_approach_that_never_reaches_zone():
    s = _story([(120, 121, 119, 120), (119, 120, 118, 119), (118, 119, 117, 118)])
    assert s.complete is False
    assert s.refusal == D.NO_TOUCH


def test_fixture_mixed_overlap_and_two_sided_wicks():
    """A bar that argues with itself is not a decision. `mixed_or_indecisive_control -> WAIT`."""
    rows = CLEAN_LONG[:-1] + [(105, 110.0, 100.0, 105.2)]   # big both wicks, tiny body
    s = _story(rows)
    assert s.two_sided_conflict is True
    assert s.refusal == D.TWO_SIDED_CONFLICT
    assert s.complete is False


def test_fixture_doji_at_zone_without_directional_takeover():
    """Touches the level, but nobody takes control."""
    rows = CLEAN_LONG[:-1] + [(101.0, 102.3, 100.2, 101.05)]
    s = _story(rows)
    assert s.complete is False
    assert s.refusal in (D.NO_TAKEOVER, D.TWO_SIDED_CONFLICT), s


def test_fixture_counter_bias_reversal_without_completed_control_transfer():
    """Control geometry on the bar, but it does not carry the direction forward."""
    rows = [(112, 113, 111, 112), (111, 112, 103, 111.5),
            (103.5, 110.0, 100.0, 109.7)]
    s = _story(rows)
    # the trigger closes BELOW the prior close, so there is no forward decision
    assert s.refusal == D.NO_CONTROL_TRANSFER, s
    assert s.fight is True, "the fight happened; the decision did not"
    assert s.complete is False


def test_two_sided_wick_conflict_discriminates():
    """POSITIVE AND NEGATIVE. It must fire on a conflicted bar and stay silent on a clean one."""
    conflicted = bars([(105, 110.0, 100.0, 105.2)]).iloc[0]
    clean = bars([(103.5, 110.0, 100.0, 109.7)]).iloc[0]
    assert D.two_sided_wick_conflict(conflicted) is True
    assert D.two_sided_wick_conflict(clean) is False


def test_a_refusal_always_names_itself():
    """A story that refuses without saying why teaches nobody anything."""
    for rows in ([(120, 121, 119, 120)] * 3,
                 CLEAN_LONG[:-1] + [(105, 110.0, 100.0, 105.2)],
                 CLEAN_LONG[:-1] + [(101.0, 102.3, 100.2, 101.05)]):
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
