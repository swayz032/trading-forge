from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_signal as sig


def test_completed_inputs_physically_remove_unclosed_1m_and_5m_bars():
    idx5 = pd.date_range("2026-08-17 09:30", periods=3, freq="5min", tz="America/New_York")
    idx1 = pd.date_range("2026-08-17 09:30", periods=12, freq="1min", tz="America/New_York")
    five = pd.DataFrame({"close": [1, 2, 3]}, index=idx5)
    one = pd.DataFrame({"close": range(12)}, index=idx1)
    asof = pd.Timestamp("2026-08-17 09:40", tz="America/New_York")
    f, o = sig._completed_inputs(five, one, asof)
    assert list(f.index) == list(idx5[:2])
    assert list(o.index) == list(idx1[:10])


def _patch_candidate(monkeypatch, direction: str, actionable: pd.Timestamp):
    loc = sig.core.Location(
        id="LOC1", side="R" if direction == "L" else "S",
        lo=90.0, hi=91.0, mid=90.5, source="WICK_ZONE",
        quality=0.9, confluence=2, entry_authorized=True, zone=None,
    )
    cand = sig.core.Candidate(
        direction=direction, setup="BRK5", location=loc, story=None,
        signal_time=actionable - pd.Timedelta(minutes=5), confirmed_time=actionable,
        reason="ZONE_CANDLE_BRK5:TEST",
    )
    plan = SimpleNamespace(
        primary="BULL" if direction == "L" else "BEAR", score=1.0,
        pm_structure="TREND", location_state="ROOM",
    )
    monkeypatch.setattr(sig, "iter_actionable_candidates", lambda env, dte, p, as_of=None: iter([(cand, actionable, plan)]))
    target_loc = sig.core.Location(
        id="T1", side="R" if direction == "L" else "S",
        lo=140.0 if direction == "L" else 60.0,
        hi=141.0 if direction == "L" else 61.0,
        mid=140.5 if direction == "L" else 60.5,
        source="PDH" if direction == "L" else "PDL",
        quality=0.9, confluence=1, entry_authorized=False, zone=None,
    )
    picked = sig.core.Target(
        location=target_loc, raw_price=140.0 if direction == "L" else 60.0,
        executable_price=140.0 if direction == "L" else 60.0,
        distance=40.0, quality=0.9, blocker=False, destination=True, fvg_confluent=False,
    )
    monkeypatch.setattr(sig.core, "build_target_locations", lambda *a, **k: [])
    monkeypatch.setattr(sig.core, "classify_path_and_destination", lambda *a, **k: (picked, "OK"))


def _env(d: date):
    return {
        "contract_by_session": {d: "CON.F.US.MNQ.U26"},
        "adjustment_by_session": {d: 0.0},
        "dataset_manifest": {"dataset_sha256": "abc"},
        "piv5": pd.DataFrame(), "full5": pd.DataFrame(), "h15": pd.DataFrame(),
        "pdm": {}, "pwm": {}, "one": pd.DataFrame(),
    }


def test_fresh_long_binds_ask_and_v24_semantics(monkeypatch):
    d = date(2026, 8, 17); actionable = pd.Timestamp("2026-08-17 10:05", tz="America/New_York")
    _patch_candidate(monkeypatch, "L", actionable)
    decision = sig.find_first_actionable_signal(
        _env(d), d, sig.prod.Params(), actionable + pd.Timedelta(seconds=1),
        live_bid_raw=100.0, live_ask_raw=100.25,
    )
    assert decision.reference_entry == 100.25
    assert decision.reference_source == "LIVE_ASK"
    assert decision.engine_version.startswith("MNQ-V2.4")
    assert decision.semantics_sha256 == sig.semantics_hash()


def test_fresh_short_binds_bid(monkeypatch):
    d = date(2026, 8, 17); actionable = pd.Timestamp("2026-08-17 10:05", tz="America/New_York")
    _patch_candidate(monkeypatch, "S", actionable)
    decision = sig.find_first_actionable_signal(
        _env(d), d, sig.prod.Params(), actionable + pd.Timedelta(seconds=1),
        live_bid_raw=100.0, live_ask_raw=100.25,
    )
    assert decision.reference_entry == 100.0
    assert decision.reference_source == "LIVE_BID"


def test_old_first_setup_remains_missed_not_retroactive(monkeypatch):
    d = date(2026, 8, 17); actionable = pd.Timestamp("2026-08-17 10:05", tz="America/New_York")
    asof = actionable + pd.Timedelta(minutes=5)
    _patch_candidate(monkeypatch, "L", actionable)
    monkeypatch.setattr(sig, "_historical_reference", lambda *a, **k: (actionable, 99.5, "HISTORICAL_NEXT_1M"))
    decision = sig.find_first_actionable_signal(_env(d), d, sig.prod.Params(), asof,
                                                 live_bid_raw=120.0, live_ask_raw=120.25)
    assert decision.reference_entry == 99.5
    assert decision.reference_source == "HISTORICAL_NEXT_1M"
    assert not sig.signal_is_fresh(decision, asof)
