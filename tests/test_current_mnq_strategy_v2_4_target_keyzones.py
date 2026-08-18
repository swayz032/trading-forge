from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_targets as tgt

TZ = "America/New_York"


def _h15():
    idx = pd.date_range("2026-08-17 08:00", periods=12, freq="15min", tz=TZ)
    q = pd.DataFrame({
        "open": [100.0] * len(idx), "high": [101.0] * len(idx),
        "low": [99.0] * len(idx), "close": [100.0] * len(idx),
        "atr": [10.0] * len(idx),
    }, index=idx)
    return q


def _loc(name, lo, hi, source="WICK_ZONE", quality=.8, zone=None):
    return tgt.core.Location(
        id=name, side="R", lo=lo, hi=hi, mid=(lo+hi)/2,
        source=source, quality=quality, confluence=1,
        entry_authorized=True, zone=zone,
    )


def test_frozen_15m_key_zone_before_fvg_wins(monkeypatch):
    monkeypatch.setattr(tgt.core, "build_zones", lambda *a, **k: [])
    monkeypatch.setattr(tgt, "build_entry_locations_v24", lambda *a, **k: ([
        _loc("HTF", 120.0, 124.0, "WICK_ZONE", .9)
    ], []))
    monkeypatch.setattr(tgt, "active_15m_fvgs", lambda *a, **k: [
        SimpleNamespace(lo=140.0, hi=150.0, mid=145.0,
                        formed_at=pd.Timestamp("2026-08-17 09:45", tz=TZ))
    ])
    d = pd.Timestamp("2026-08-17").date()
    out = tgt.build_reaction_destinations(
        pd.DataFrame(), pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ)), _h15(),
        pd.Timestamp("2026-08-17 10:30", tz=TZ), tgt.core.Params(min_room_r=1.0),
        {}, {}, d, 100.0, "L", piv15=pd.DataFrame({"x": [1]}),
    )
    assert out[0].kind == "KEY_ZONE_15M"
    assert out[0].first_contact_distance == 20.0
    assert out[0].target_raw == 122.0


def test_fvg_before_frozen_15m_key_zone_wins(monkeypatch):
    monkeypatch.setattr(tgt.core, "build_zones", lambda *a, **k: [])
    monkeypatch.setattr(tgt, "build_entry_locations_v24", lambda *a, **k: ([
        _loc("HTF", 150.0, 154.0, "WICK_ZONE", .9)
    ], []))
    monkeypatch.setattr(tgt, "active_15m_fvgs", lambda *a, **k: [
        SimpleNamespace(lo=120.0, hi=140.0, mid=130.0,
                        formed_at=pd.Timestamp("2026-08-17 09:45", tz=TZ))
    ])
    d = pd.Timestamp("2026-08-17").date()
    out = tgt.build_reaction_destinations(
        pd.DataFrame(), pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ)), _h15(),
        pd.Timestamp("2026-08-17 10:30", tz=TZ), tgt.core.Params(min_room_r=1.0),
        {}, {}, d, 100.0, "L", piv15=pd.DataFrame({"x": [1]}),
    )
    assert out[0].kind == "FVG_15M"
    assert out[0].first_contact_distance == 20.0
    assert out[0].target_raw == 130.0


def test_frozen_15m_map_is_requested_at_930_not_entry_time(monkeypatch):
    seen = {}
    monkeypatch.setattr(tgt.core, "build_zones", lambda *a, **k: [])
    monkeypatch.setattr(tgt, "active_15m_fvgs", lambda *a, **k: [])
    def fake(env, dte, open_ts, p):
        seen["ts"] = open_ts
        return [], []
    monkeypatch.setattr(tgt, "build_entry_locations_v24", fake)
    d = pd.Timestamp("2026-08-17").date()
    tgt.build_reaction_destinations(
        pd.DataFrame(), pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ)), _h15(),
        pd.Timestamp("2026-08-17 11:45", tz=TZ), tgt.core.Params(),
        {}, {}, d, 100.0, "L", piv15=pd.DataFrame({"x": [1]}),
    )
    assert seen["ts"] == pd.Timestamp("2026-08-17 09:30", tz=TZ)


def test_liquidity_cluster_meaning_reuses_established_zone_gate_not_magic_062():
    z = SimpleNamespace(touches=2)
    loc = _loc("C", 120, 124, "WICK_ZONE", quality=.59, zone=z)
    p = tgt.core.Params(min_zone_quality=.58)
    assert tgt._structurally_meaningful_cluster(loc, p)
    weak = _loc("W", 120, 124, "WICK_ZONE", quality=.57, zone=z)
    assert not tgt._structurally_meaningful_cluster(weak, p)
