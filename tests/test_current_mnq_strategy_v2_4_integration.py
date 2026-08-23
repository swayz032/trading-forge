from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_kernel as ker
from research import current_mnq_strategy_v2_4_signal as sig


def _env(direction="L"):
    now = pd.Timestamp("2026-08-17 10:00", tz="America/New_York")
    old = now - pd.Timedelta(days=80)
    full5 = pd.DataFrame(
        {
            "open": [90.0, 100.0], "high": [91.0, 101.0],
            "low": [89.0, 99.0], "close": [90.5, 100.5],
            "atr": [10.0, 10.0],
        },
        index=[old, now],
    )
    r5 = pd.DataFrame(
        {"open": [100.0], "high": [101.0], "low": [99.0], "close": [100.5], "atr": [10.0]},
        index=[now],
    )
    if direction == "L":
        rows = [
            (now, 100.0, 102.25, 99.75, 102.0),
            (now + pd.Timedelta(minutes=1), 102.0, 104.25, 101.75, 104.0),
        ]
    else:
        rows = [
            (now, 100.0, 100.25, 97.75, 98.0),
            (now + pd.Timedelta(minutes=1), 98.0, 98.25, 95.75, 96.0),
        ]
    one = pd.DataFrame(
        {
            "open": [x[1] for x in rows], "high": [x[2] for x in rows],
            "low": [x[3] for x in rows], "close": [x[4] for x in rows],
        },
        index=[x[0] for x in rows],
    )
    return {
        "full5": full5, "r5": r5, "one": one, "h15": pd.DataFrame(),
        "pdm": {}, "pwm": {}, "pcm": {},
    }


def _grant(story_complete: bool = True):
    """A Route A GRANT from the entry authority, built as the real dataclass."""
    return ker.auth.Authority(
        ker.auth.GRANTED, ker.auth.ROUTE_A_REJECTION,
        SimpleNamespace(complete=story_complete), True, None)


def _wait(state=None):
    """A refusal from the entry authority. `granted` is False by construction."""
    state = state or ker.auth.WAIT_NO_STORY
    return ker.auth.Authority(state, None, None, False, state)


def _patch_authority(monkeypatch, verdict):
    """Stub the ENTRY AUTHORITY, which is what the kernel now asks.

    It is stubbed rather than driven with real bars for the same reason its predecessor stubbed
    `reversal_story_v24`: these are kernel-plumbing tests, and the derived machine refuses the
    overwhelming majority of synthetic frames, so an unstubbed veto test would pass no matter
    what the kernel did with the verdict — a green with no path to red. Both directions are
    reachable here because both verdicts are injectable.
    """
    monkeypatch.setattr(ker.auth, "decide", lambda *a, **k: verdict)


def _patch_long_reversal(monkeypatch):
    loc = ker.core.Location(
        id="S1", side="S", lo=99.0, hi=100.0, mid=99.5, source="WICK_ZONE",
        quality=0.9, confluence=2, entry_authorized=True, zone=None,
    )
    monkeypatch.setattr(ker.core, "premarket_plan", lambda *a, **k: SimpleNamespace(primary="BULL"))
    monkeypatch.setattr(ker, "build_entry_locations_v24", lambda *a, **k: ([loc], []))
    _patch_authority(monkeypatch, _grant())
    monkeypatch.setattr(ker, "plan_allows_v24", lambda *a, **k: True)
    return loc


def test_historical_and_live_import_the_exact_same_candidate_kernel():
    assert eng.iter_actionable_candidates is ker.iter_actionable_candidates
    assert sig.iter_actionable_candidates is ker.iter_actionable_candidates


def test_kernel_uses_v24_level_builder_not_legacy_entry_map():
    source = open(ker.__file__, encoding="utf-8").read()
    assert "build_entry_locations_v24" in source
    assert "core.build_entry_locations(env" not in source


@pytest.mark.parametrize("verdict,expected", [(_wait(), 0), (_grant(), 1)])
def test_the_entry_authority_can_veto_even_when_live_force_is_present(verdict, expected,
                                                                     monkeypatch):
    """The story layer's veto survives the wiring — and the positive control proves it bites.

    Parametrised so the SAME frame, with the same force, produces a trade or no trade purely on
    the authority's verdict. Without the grant arm this test could pass against a kernel that
    never yields anything at all.
    """
    env = _env("L"); ts = env["r5"].index[0]
    loc = ker.core.Location(
        id="S1", side="S", lo=99.0, hi=100.0, mid=99.5, source="WICK_ZONE",
        quality=0.9, confluence=2, entry_authorized=True, zone=None,
    )
    monkeypatch.setattr(ker.core, "premarket_plan", lambda *a, **k: SimpleNamespace(primary="BULL"))
    monkeypatch.setattr(ker, "build_entry_locations_v24", lambda *a, **k: ([loc], []))
    _patch_authority(monkeypatch, verdict)
    monkeypatch.setattr(ker, "plan_allows_v24", lambda *a, **k: True)
    got = list(ker.iter_actionable_candidates(env, ts.date(), eng.Params()))
    assert len(got) == expected


def test_role_flip_already_confirmed_before_forming_bar_can_use_live_force(monkeypatch):
    env = _env("S"); ts = env["r5"].index[0]
    original = ker.core.Zone(
        id="S:2026-08-10T10:00:00-04:00:400", side="S",
        lo=99.0, hi=101.0, mid=100.0, touches=2,
        wick_quality=.8, close_away=.8, displacement=1.2,
        compactness=.9, independence=.9, recency=.9, quality=.9,
        created=ts - pd.Timedelta(days=7), last_event=ts - pd.Timedelta(days=6),
        source="WICK_ZONE", confluence=2, state=ker.core.ZoneState.ACTIVE_SUPPORT,
    )
    loc = ker.core.Location(
        id=original.id, side="S", lo=99.0, hi=101.0, mid=100.0,
        source="WICK_ZONE", quality=.9, confluence=2,
        entry_authorized=True, zone=original,
    )
    flipped = replace(original, side="R", state=ker.core.ZoneState.FLIPPED_RETEST)

    monkeypatch.setattr(ker.core, "premarket_plan", lambda *a, **k: SimpleNamespace(primary="BEAR"))
    monkeypatch.setattr(ker, "build_entry_locations_v24", lambda *a, **k: ([loc], []))
    monkeypatch.setattr(ker, "zone_state_at_v24", lambda z, bars, asof, p: flipped)
    _patch_authority(monkeypatch, _grant())
    monkeypatch.setattr(ker, "plan_allows_v24", lambda *a, **k: True)

    got = list(ker.iter_actionable_candidates(env, ts.date(), eng.Params()))
    assert len(got) == 1
    cand, actionable, _ = got[0]
    assert cand.direction == "S"
    assert cand.setup == "REV"
    assert cand.location.side == "R"
    assert cand.reason == "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE"
    assert actionable == ts + pd.Timedelta(minutes=2)
    assert actionable < ts + pd.Timedelta(minutes=5)


def test_live_asof_and_historical_mode_agree_on_first_force_minute_without_future_leak(monkeypatch):
    env = _env("L"); ts = env["r5"].index[0]
    _patch_long_reversal(monkeypatch)

    # At 10:01 only one 1m sub-bar has completed. The force equation requires
    # two, so live mode must refuse even though future data exists in env["one"].
    too_early = list(ker.iter_actionable_candidates(
        env, ts.date(), eng.Params(), as_of=ts + pd.Timedelta(minutes=1)
    ))
    assert too_early == []

    # At 10:02 two completed sub-bars prove force. Live and full historical mode
    # must identify the exact same first decision minute and reason.
    live = list(ker.iter_actionable_candidates(
        env, ts.date(), eng.Params(), as_of=ts + pd.Timedelta(minutes=2)
    ))
    hist = list(ker.iter_actionable_candidates(env, ts.date(), eng.Params(), as_of=None))
    assert len(live) == 1
    assert len(hist) == 1
    live_cand, live_at, _ = live[0]
    hist_cand, hist_at, _ = hist[0]
    assert live_at == hist_at == ts + pd.Timedelta(minutes=2)
    assert live_cand.reason == hist_cand.reason == "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE"
    assert live_cand.direction == hist_cand.direction == "L"
    assert live_at < ts + pd.Timedelta(minutes=5)


def test_entry_fidelity_paths_are_present_in_shared_kernel():
    source = open(ker.__file__, encoding="utf-8").read()
    assert "force_snapshot" in source
    assert "decision_times" in source
    # The four reads are no longer four hand-rolled predicates in this file — ALGO-047 wired
    # them into the state machine, which is asked once per route. What must still be true is
    # that the kernel reaches every route family and the BRK15 variant.
    assert "entry_authority" in source
    assert "ROUTE_A_REJECTION" in source
    assert "ROUTE_B_BREAKOUT" in source
    assert "ROUTE_C_PREBREAK_DISPLACEMENT" in source
    assert "ROUTE_D_PREBREAK_RETEST" in source
    assert "VARIANT_BRK15" in source
    assert "_intra15_confirmation" in source
    assert "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE" in source
    assert "WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE" in source
    assert "PREBREAK_REPEAT_TEST_INTRA5_FORCE" in source
    assert "PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE" in source
    assert "pending_locs" in source
    assert "WAIT_FOR_NEW_COMPLETED_15M_ACCEPTANCE" not in source
