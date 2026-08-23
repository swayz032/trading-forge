"""The kernel's grant must FOLLOW the entry authority's verdict — on every route family.

ALGO-047 discharged §9.2 and ordered the derivation layer and the four-route WAIT-by-default
state machine wired in as the kernel's entry authority. The mutation campaign proves the
MACHINE's own guards bite. It says nothing about whether the kernel obeys the machine, and
"wired" can be faked in ways every existing test would still pass:

    * import the module and ignore `granted`
    * wire Route A only and leave the breakout family on the old hand-rolled predicates
    * wire the 5m routes and leave the BRK15 variant on its own copy of the rule
    * ask the machine, but hand it the wrong frame

So this file pins the PROPERTY — the kernel yields a candidate if and only if the authority
granted one — separately for each route family, with BOTH arms. A one-armed version would pass
against a kernel that never yields anything at all, which is the failure mode a WAIT-by-default
machine makes easy to ship by accident.
"""
from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_entry_authority as auth
from research import current_mnq_strategy_v2_4_kernel as ker

TZ = "America/New_York"


def _env(direction="L"):
    """One 5m bucket with two completed 1m sub-bars, enough to prove force at 10:02."""
    now = pd.Timestamp("2026-08-17 10:00", tz=TZ)
    old = now - pd.Timedelta(days=80)
    full5 = pd.DataFrame(
        {"open": [90.0, 100.0], "high": [91.0, 101.0], "low": [89.0, 99.0],
         "close": [90.5, 100.5], "atr": [10.0, 10.0]},
        index=[old, now],
    )
    r5 = pd.DataFrame(
        {"open": [100.0], "high": [101.0], "low": [99.0], "close": [100.5], "atr": [10.0]},
        index=[now],
    )
    if direction == "L":
        rows = [(now, 100.0, 102.25, 99.75, 102.0),
                (now + pd.Timedelta(minutes=1), 102.0, 104.25, 101.75, 104.0)]
    else:
        rows = [(now, 100.0, 100.25, 97.75, 98.0),
                (now + pd.Timedelta(minutes=1), 98.0, 98.25, 95.75, 96.0)]
    one = pd.DataFrame(
        {"open": [x[1] for x in rows], "high": [x[2] for x in rows],
         "low": [x[3] for x in rows], "close": [x[4] for x in rows]},
        index=[x[0] for x in rows],
    )
    return {"full5": full5, "r5": r5, "one": one, "h15": pd.DataFrame(),
            "pdm": {}, "pwm": {}, "pcm": {}}


def _loc(side):
    return ker.core.Location(
        id=f"{side}1", side=side, lo=99.0, hi=100.0, mid=99.5, source="WICK_ZONE",
        quality=0.9, confluence=2, entry_authorized=True, zone=None,
    )


def _granted(route, form=None, story_complete=True):
    story = SimpleNamespace(complete=story_complete) if route == auth.ROUTE_A_REJECTION else None
    return auth.Authority(auth.GRANTED, route, story, True, None, form)


def _refused(state=auth.WAIT_NO_STORY):
    return auth.Authority(state, None, None, False, state, None)


def _run(monkeypatch, side, verdict_for):
    """Run the kernel with one authorized location and a scripted authority."""
    loc = _loc(side)
    monkeypatch.setattr(ker.core, "premarket_plan",
                        lambda *a, **k: SimpleNamespace(primary="NEUTRAL"))
    monkeypatch.setattr(ker, "build_entry_locations_v24", lambda *a, **k: ([loc], []))
    monkeypatch.setattr(ker.auth, "decide",
                        lambda *a, route=auth.ROUTE_A_REJECTION, **k: verdict_for(route))
    env = _env("L")
    return list(ker.iter_actionable_candidates(env, env["r5"].index[0].date(), eng.Params()))


# --- Route A ----------------------------------------------------------------------------

@pytest.mark.parametrize("granted,expected", [(True, 1), (False, 0)])
def test_route_A_follows_the_authority(granted, expected, monkeypatch):
    got = _run(monkeypatch, "S",
               lambda r: _granted(r) if granted else _refused())
    assert len(got) == expected
    if expected:
        cand, _, _ = got[0]
        assert cand.setup == "REV"
        assert cand.reason == "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE"


def test_route_A_carries_the_DERIVED_story_as_its_evidence(monkeypatch):
    """The candidate's story must be the one that authorized it, not a parallel object."""
    sentinel = SimpleNamespace(complete=True, interaction="touch_and_reject")
    got = _run(monkeypatch, "S",
               lambda r: auth.Authority(auth.GRANTED, r, sentinel, True, None, None))
    assert len(got) == 1
    cand, _, _ = got[0]
    assert cand.story is sentinel, "the candidate carries a story the authority did not produce"


# --- Routes B / C / D -------------------------------------------------------------------

@pytest.mark.parametrize("route,form,reason", [
    (auth.ROUTE_C_PREBREAK_DISPLACEMENT, brk.EXCEPTION_DISPLACEMENT,
     "PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE"),
    (auth.ROUTE_D_PREBREAK_RETEST, brk.EXCEPTION_REPEAT_TEST,
     "PREBREAK_REPEAT_TEST_INTRA5_FORCE"),
    (auth.ROUTE_D_PREBREAK_RETEST, brk.FORM_BREAK_RETEST,
     "ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE"),
    (auth.ROUTE_B_BREAKOUT, brk.FORM_NORMAL_BREAKOUT,
     "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE"),
])
def test_each_breakout_route_reaches_the_kernel_with_its_OWN_reason(route, form, reason,
                                                                   monkeypatch):
    """Every route family must be reachable, and must be labelled by the FORM it proved.

    Route D appears twice on purpose: it has two legal forms, and the two must not collapse
    onto one label. `break_retest` is the grant path the kernel did not have before the wiring,
    so a mapping that quietly gave it the repeat-test name would put false evidence on a real
    entry and nothing else here would notice.
    """
    got = _run(monkeypatch, "R",
               lambda r: _granted(r, form) if r == route else _refused())
    assert len(got) == 1, f"{route} never reached the kernel"
    cand, _, _ = got[0]
    assert cand.setup == "BRK5"
    assert cand.reason == reason


def test_the_breakout_family_refuses_when_every_route_refuses(monkeypatch):
    assert _run(monkeypatch, "R", lambda r: _refused()) == []


def test_the_kernel_asks_the_routes_in_its_own_precedence(monkeypatch):
    """C before D before B — the kernel's original elif order, preserved by the wiring.

    Pinned by granting ALL THREE at once and checking which label survives: if precedence
    silently reversed, the same inputs would produce a different route's trade.
    """
    asked: list[str] = []

    def spy(route):
        asked.append(route)
        return _granted(route, {
            auth.ROUTE_C_PREBREAK_DISPLACEMENT: brk.EXCEPTION_DISPLACEMENT,
            auth.ROUTE_D_PREBREAK_RETEST: brk.EXCEPTION_REPEAT_TEST,
            auth.ROUTE_B_BREAKOUT: brk.FORM_NORMAL_BREAKOUT,
        }[route])

    got = _run(monkeypatch, "R", spy)
    assert len(got) == 1
    cand, _, _ = got[0]
    assert cand.reason == "PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE"
    assert asked[0] == auth.ROUTE_C_PREBREAK_DISPLACEMENT
    assert tuple(ker.BREAKOUT_ROUTE_ORDER) == (
        auth.ROUTE_C_PREBREAK_DISPLACEMENT, auth.ROUTE_D_PREBREAK_RETEST,
        auth.ROUTE_B_BREAKOUT), "the kernel's route precedence changed"


def test_every_form_the_derivation_can_return_has_a_kernel_reason():
    """Derived, not listed: a new form must not fall through to a KeyError or a wrong label."""
    missing = sorted(set(brk.FORMS) - set(ker.REASON_BY_FORM))
    assert not missing, f"forms with no kernel reason: {missing}"


# --- The BRK15 variant ------------------------------------------------------------------

def _pending_15m(direction="L"):
    """A weak first break, a controlled pullback, and a forming third parent."""
    start = pd.Timestamp("2026-08-17 10:00", tz=TZ)
    idx = [start, start + pd.Timedelta(minutes=15)]
    if direction == "L":
        rows = [(100.0, 101.0, 99.5, 100.8), (100.8, 101.0, 100.0, 100.4)]
    else:
        rows = [(100.0, 100.5, 99.0, 99.2), (99.2, 100.0, 99.0, 99.6)]
    h15 = pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)
    pending = ker.core.PendingBreakout(direction, "R1", start, 99.0, 100.0)
    known_at = start + pd.Timedelta(minutes=35)   # inside the third parent
    return h15, pending, known_at


@pytest.mark.parametrize("granted", [True, False])
def test_the_BRK15_variant_follows_the_authority(granted, monkeypatch):
    """The variant must go through the SAME machine, not a second copy of the rule.

    The hand-rolled version it replaced never tested that the first break was WEAK, so a
    momentum first break could enter here as well as through the normal route — the laxer
    second door ALGO-038/039 ruled out. Both arms, so the test cannot pass by always refusing.
    """
    h15, pending, known_at = _pending_15m("L")
    snap = SimpleNamespace(confirmed=True, as_row=lambda *a, **k: h15.iloc[-1])
    monkeypatch.setattr(ker, "force_snapshot", lambda *a, **k: snap)
    monkeypatch.setattr(ker.auth, "decide",
                        lambda *a, **k: _granted(auth.ROUTE_B_BREAKOUT, brk.VARIANT_BRK15)
                        if granted else _refused(auth.WAIT_NO_INTERACTION))

    got = ker._intra15_confirmation(h15, pd.DataFrame(), pending, known_at, eng.Params())
    assert (got is not None) == granted


def test_the_BRK15_variant_is_asked_as_a_variant_of_route_B(monkeypatch):
    """Route and variant both, because the machine REFUSES the variant under any other route."""
    h15, pending, known_at = _pending_15m("L")
    snap = SimpleNamespace(confirmed=True, as_row=lambda *a, **k: h15.iloc[-1])
    monkeypatch.setattr(ker, "force_snapshot", lambda *a, **k: snap)
    seen: dict = {}

    def spy(*a, route=None, variant=None, **k):
        seen["route"], seen["variant"] = route, variant
        return _granted(auth.ROUTE_B_BREAKOUT, brk.VARIANT_BRK15)

    monkeypatch.setattr(ker.auth, "decide", spy)
    ker._intra15_confirmation(h15, pd.DataFrame(), pending, known_at, eng.Params())
    assert seen == {"route": auth.ROUTE_B_BREAKOUT, "variant": auth.VARIANT_BRK15}


def test_the_BRK15_variant_still_requires_two_contiguous_completed_parents(monkeypatch):
    """The causal window survived the rewrite: a gap in the parents is not a continuation."""
    h15, pending, known_at = _pending_15m("L")
    gapped = h15.copy()
    gapped.index = [h15.index[0] - pd.Timedelta(minutes=15), h15.index[1]]
    snap = SimpleNamespace(confirmed=True, as_row=lambda *a, **k: h15.iloc[-1])
    monkeypatch.setattr(ker, "force_snapshot", lambda *a, **k: snap)
    monkeypatch.setattr(ker.auth, "decide",
                        lambda *a, **k: _granted(auth.ROUTE_B_BREAKOUT, brk.VARIANT_BRK15))

    assert ker._intra15_confirmation(gapped, pd.DataFrame(), pending, known_at,
                                     eng.Params()) is None


# --- the frame the machine reads --------------------------------------------------------

def test_the_authority_reads_completed_history_with_the_forming_bar_last():
    """ALGO-033's split. If the trigger were not last, every route would read the wrong bar."""
    idx = pd.date_range("2026-08-17 09:00", periods=9, freq="5min", tz=TZ)
    hist = pd.DataFrame({"open": range(9), "high": range(9), "low": range(9),
                         "close": range(9)}, index=idx)
    ts = idx[-1]
    trigger = pd.Series({"open": 99.0, "high": 99.0, "low": 99.0, "close": 99.0}, name=ts)

    bars = ker.authority_bars(hist, ts, trigger)

    assert len(bars) == ker.LOOKBACK + 1
    assert bars.index[-1] == ts
    assert float(bars.iloc[-1].close) == 99.0, "the forming bar must be the LAST row"
    assert (bars.index[:-1] < ts).all(), "only COMPLETED bars may precede the trigger"
    assert ts not in bars.index[:-1], "the completed history must not contain the trigger's slot"
