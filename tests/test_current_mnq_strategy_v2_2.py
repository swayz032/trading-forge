import json
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from research import current_mnq_strategy_v2_2_engine as e


def ts(s):
    return pd.Timestamp(s, tz=e.TZ)


def loc(side="S", quality=0.8, conf=1, source="WICK_ZONE"):
    return e.Location("L1", side, 99.0, 101.0, 100.0, source, quality, conf, True, None)


def test_f01_polarity_contract_is_not_reversal_mirror():
    c = e.synthetic_fidelity_fixtures()["polarity_contract"]
    assert c == {"REV_LONG": "SUPPORT", "REV_SHORT": "RESISTANCE", "BRK_LONG": "RESISTANCE", "BRK_SHORT": "SUPPORT"}


def test_f02_old_15m_close_cannot_confirm_new_attempt():
    idx = pd.DatetimeIndex([ts("2026-03-25 09:30"), ts("2026-03-25 09:45")])
    h = pd.DataFrame({"open": [100, 100], "high": [105, 103], "low": [99, 99], "close": [104, 102]}, index=idx)
    p = e.PendingBreakout("L", "R1", ts("2026-03-25 09:50"), 99, 101)
    assert e.latest_new_15m_confirmation(h, p, ts("2026-03-25 09:55")) is None
    assert e.latest_new_15m_confirmation(h, p, ts("2026-03-25 10:00")) == ts("2026-03-25 10:00")


def test_f03_location_gate_is_independent_from_touch_count():
    p = e.Params()
    z = e.Zone("z", "S", 99, 101, 100, 5, .5, .8, .8, .8, .8, .8,
               p.min_zone_quality + .01, ts("2026-03-01 10:00"), ts("2026-03-01 09:30"),
               confluence=0, state=e.ZoneState.ACTIVE_SUPPORT)
    assert not e.valid_location(z, p)
    assert e.valid_location(replace(z, confluence=1), p)
    assert e.valid_location(replace(z, quality=p.high_zone_quality + .01), p)


def test_f04_counter_bias_uses_actual_story_completion():
    plan = e.PremarketPlan("BEAR", -2, "S", "L", "x", None, None, None, None,
                           None, None, None, None, -0.2, "DOWN", "LOWER_PRIOR_RANGE")
    incomplete = e.Story(True, True, True, True, True, True, True, True, False, True, False)
    complete = replace(incomplete, follow_through=True, decision=True)
    strong_loc = loc("S", quality=.85, conf=2)
    assert not e.plan_allows(plan, "L", "REV", incomplete, strong_loc)
    assert e.plan_allows(plan, "L", "REV", complete, strong_loc)


def test_f05_close_strong_blocker_rejects_far_target():
    p = e.Params(min_room_r=1.5, stop=10.0)
    blocker = replace(loc("R", quality=.8, conf=1, source="WICK_ZONE"), lo=107, hi=109, mid=108)
    dest = replace(loc("R", quality=.9, conf=2, source="PDH"), id="D", lo=130, hi=132, mid=131)
    picked, reason = e.classify_path_and_destination([(blocker, False), (dest, False)], 100.0, "L", "REV", p, False)
    assert picked is None
    assert reason.startswith("HARD_BLOCKER")


def test_f05_strong_breakout_can_cross_only_weak_shelf():
    p = e.Params(min_room_r=1.5, stop=10.0)
    weak = replace(loc("R", quality=.3, conf=0), lo=107, hi=109, mid=108)
    dest = replace(loc("R", quality=.9, conf=2, source="PDH"), id="D", lo=130, hi=132, mid=131)
    picked, reason = e.classify_path_and_destination([(weak, False), (dest, False)], 100.0, "L", "BRK5", p, True)
    assert reason == "OK"
    assert picked.location.source == "PDH"


def test_f06_every_order_rounding_is_mnq_tick_valid():
    vals = [e.executable_target(20000.375, "L"), e.executable_target(20000.125, "S"),
            e.executable_stop(19982.625, "L"), e.executable_stop(20017.375, "S")]
    assert all(e.tick_valid(x) for x in vals)


def test_f07_broken_support_is_not_active_support():
    p = e.Params()
    z = e.Zone("z", "S", 99, 101, 100, 2, .5, .8, .8, .8, .8, .8, .8,
               ts("2026-03-25 09:00"), ts("2026-03-25 08:00"), state=e.ZoneState.ACTIVE_SUPPORT)
    idx = pd.DatetimeIndex([ts("2026-03-25 09:05"), ts("2026-03-25 09:10")])
    bars = pd.DataFrame({"open": [100, 99], "high": [101, 99.5], "low": [98.5, 97.5], "close": [98.5, 98], "atr": [10, 10]}, index=idx)
    zz = e.zone_state_at(z, bars, ts("2026-03-25 09:15"), p)
    assert zz.state in (e.ZoneState.BROKEN, e.ZoneState.FLIPPED_RETEST)
    assert zz.state != e.ZoneState.ACTIVE_SUPPORT


def test_f08_warmup_blocks_first_60_days():
    idx = pd.date_range("2026-01-01 09:30", "2026-03-20 15:55", freq="5min", tz=e.TZ)
    full5 = pd.DataFrame(index=idx)
    days = pd.date_range("2026-01-02", "2026-03-20", freq="B").date
    r_idx = []
    for d in days:
        r_idx.extend(pd.date_range(f"{d} 09:30", f"{d} 15:55", freq="5min", tz=e.TZ))
    r5 = pd.DataFrame({"x": 1}, index=pd.DatetimeIndex(r_idx))
    got = e.scoreable_days({"full5": full5, "r5": r5})
    assert got
    assert pd.Timestamp(str(got[0])) >= pd.Timestamp("2026-03-02")


def test_f09_manifest_hash_mismatch_refuses():
    observed = {"5m": {"source_commit": "a", "source_path": "x", "sha256": "bad", "rows": 1, "first_timestamp": "a", "last_timestamp": "b"}}
    lock = {"files": {"5m": {"source_commit": "a", "source_path": "x", "sha256": "good", "rows": 1, "first_timestamp": "a", "last_timestamp": "b"}}}
    with pytest.raises(RuntimeError, match="DATA_MANIFEST_MISMATCH"):
        e.verify_manifest(observed, lock)


def test_f10_contract_provenance_is_explicit_and_not_claimed_front_month():
    assert e.SOURCE_CONTRACT_ID == "CON.F.US.MNQ.M26"
    assert "NOT" in e.SOURCE_CONTRACT_NOTE and "front-month" in e.SOURCE_CONTRACT_NOTE


def test_f24_gap_through_stop_fills_no_better_than_open():
    p = e.Params(stop=10, exit_slip_points=.25)
    idx = pd.DatetimeIndex([ts("2026-03-25 10:00")])
    one = pd.DataFrame({"open":[88.0],"high":[90.0],"low":[87.0],"close":[89.0]}, index=idx)
    _, fill, why, _, _ = e.exit_1m_realistic(one, idx[0], "L", 100.0, 130.0, p)
    assert why == "STOP_GAP"
    assert fill <= 87.75


def test_f25_target_requires_trade_through_not_touch():
    p = e.Params(stop=10, exit_slip_points=0)
    idx = pd.DatetimeIndex([ts("2026-03-25 10:00"), ts("2026-03-25 10:01")])
    one = pd.DataFrame({"open":[100,100], "high":[110,110.25], "low":[99,99], "close":[109,110]}, index=idx)
    xt, fill, why, _, _ = e.exit_1m_realistic(one, idx[0], "L", 100.0, 110.0, p)
    assert xt == idx[1]
    assert why == "TARGET_TRADETHROUGH"


def test_parameter_registry_covers_all_decision_thresholds():
    required = {"ztol_atr","min_wick","min_disp_atr","min_zone_quality","high_zone_quality",
                "body_frac","range_ratio","close_loc","reject_wick","breakout_clear_atr",
                "touch_pad_atr","compression_ratio","weakening_ratio","min_room_r","tp_depth",
                "recency_half_life_days","fvg_overlap_atr","key_level_pad_atr",
                "weak_blocker_quality","strong_blocker_quality"}
    assert required.issubset(e.PARAMETER_REGISTRY)
