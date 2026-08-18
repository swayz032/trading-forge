from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_fvg as fvg
from research import current_mnq_strategy_v2_4_targets as tgt


def h15(rows, start="2026-08-17 09:00"):
    idx = pd.date_range(start, periods=len(rows), freq="15min", tz="America/New_York")
    q = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)
    q["atr"] = 10.0
    return q


def test_adapter_uses_classic_native_three_candle_fvg_and_completed_15m_only():
    q = h15([
        (99.5, 100.0, 99.0, 99.75),
        (100.0, 102.0, 99.75, 101.75),
        (101.25, 102.5, 101.0, 102.0),  # low 101 > bar0 high 100 => bullish FVG 100-101
    ])
    # Third bar is not known until 09:45 ET.
    assert fvg.active_15m_fvgs(q, pd.Timestamp("2026-08-17 09:44:59", tz="America/New_York")) == []
    out = fvg.active_15m_fvgs(q, pd.Timestamp("2026-08-17 09:45:00", tz="America/New_York"))
    assert len(out) == 1
    assert out[0].lo == 100.0
    assert out[0].hi == 101.0
    assert out[0].mid == 100.5


def test_native_fvg_stops_being_target_after_later_15m_reentry():
    q = h15([
        (99.5, 100.0, 99.0, 99.75),
        (100.0, 102.0, 99.75, 101.75),
        (101.25, 102.5, 101.0, 102.0),
        (102.0, 103.0, 100.5, 102.5),  # re-enters 100-101 zone
    ])
    out = fvg.active_15m_fvgs(q, pd.Timestamp("2026-08-17 10:00:00", tz="America/New_York"))
    assert out == []


def _loc(name, lo, hi, source="WICK_ZONE", quality=0.8):
    return tgt.core.Location(name, "B", lo, hi, (lo + hi) / 2, source, quality, 0, False, None)


def _dest(name, lo, hi, kind, contact, raw, meaningful=True, quality=0.8):
    return tgt.ReactionDestination(
        _loc(name, lo, hi, tgt.FVG_SOURCE if kind == "FVG_15M" else "WICK_ZONE", quality),
        kind, contact, raw, quality, meaningful, False,
    )


def test_liquidity_cluster_before_fvg_wins():
    p = tgt.core.Params(min_room_r=1.0)
    cluster = _dest("cluster", 120, 124, "LIQUIDITY_CLUSTER", 20, 122)
    gap = _dest("gap", 140, 150, "FVG_15M", 40, 145)
    picked, reason = tgt.classify_first_reaction_destination([cluster, gap], 100, "L", "REV", p, False)
    assert reason == "FIRST_REACTION:LIQUIDITY_CLUSTER"
    assert picked.location.id == "cluster"
    assert picked.raw_price == 122


def test_fvg_before_liquidity_cluster_wins_and_targets_fvg_middle():
    p = tgt.core.Params(min_room_r=1.0)
    gap = _dest("gap", 120, 140, "FVG_15M", 20, 130)
    cluster = _dest("cluster", 145, 149, "LIQUIDITY_CLUSTER", 45, 147)
    picked, reason = tgt.classify_first_reaction_destination([gap, cluster], 100, "L", "REV", p, False)
    assert reason == "FIRST_REACTION:FVG_15M"
    assert picked.location.id == "gap"
    assert picked.raw_price == 130


def test_first_reaction_too_close_cancels_trade_instead_of_skipping_to_far_fvg():
    p = tgt.core.Params(stop=17.25, min_room_r=1.5)
    cluster = _dest("cluster", 110, 112, "LIQUIDITY_CLUSTER", 10, 111)
    gap = _dest("gap", 150, 160, "FVG_15M", 50, 155)
    picked, reason = tgt.classify_first_reaction_destination([cluster, gap], 100, "L", "REV", p, False)
    assert picked is None
    assert reason.startswith("FIRST_REACTION_TOO_CLOSE:LIQUIDITY_CLUSTER")


def test_wide_fvg_is_ranked_by_near_edge_not_midpoint(monkeypatch):
    # FVG starts first at 110 but has midpoint 130. Cluster starts later at 112
    # and midpoint 113. The trader's rule says FVG is still first reaction.
    p = tgt.core.Params(min_room_r=0.25)
    monkeypatch.setattr(tgt.core, "build_zones", lambda *a, **k: [])
    monkeypatch.setattr(tgt.core, "enrich_confluence", lambda z, *a, **k: z)
    monkeypatch.setattr(tgt.core, "zone_locations", lambda z: [])
    monkeypatch.setattr(tgt.core, "make_key_locations", lambda *a, **k: [
        _loc("cluster", 112, 114, "PDH", 0.8)
    ])
    monkeypatch.setattr(tgt, "active_15m_fvgs", lambda *a, **k: [
        SimpleNamespace(lo=110.0, hi=150.0, mid=130.0,
                        formed_at=pd.Timestamp("2026-08-17 09:45", tz="America/New_York"))
    ])
    dummy = h15([(100, 101, 99, 100)] * 5)
    out = tgt.build_reaction_destinations(
        pd.DataFrame(), pd.DataFrame(), dummy,
        pd.Timestamp("2026-08-17 10:30", tz="America/New_York"),
        p, {}, {}, pd.Timestamp("2026-08-17").date(), 100.0, "L",
    )
    assert out[0].kind == "FVG_15M"
    assert out[0].first_contact_distance == 10.0
    assert out[0].target_raw == 130.0


def test_meaningful_15m_reaction_zone_can_block_target_without_authorizing_entry(monkeypatch):
    p = tgt.core.Params()
    created = pd.Timestamp("2026-08-10 10:45", tz="America/New_York")
    z = tgt.core.Zone(
        id="REACTION_ONLY", side="R", lo=120.0, hi=124.0, mid=122.0,
        touches=2, wick_quality=.4, close_away=.7, displacement=.8,
        compactness=.8, independence=.8, recency=.8, quality=.60,
        created=created, last_event=created - pd.Timedelta(minutes=45),
        source="WICK_ZONE", confluence=0,
        state=tgt.core.ZoneState.ACTIVE_RESISTANCE,
    )
    # It is meaningful structure but fails the stricter fresh-entry rule because
    # it has neither confluence nor high_zone_quality.
    assert tgt.core.valid_location(z, p) is False
    monkeypatch.setattr(tgt, "active_15m_fvgs", lambda *a, **k: [])
    monkeypatch.setattr(tgt.core, "build_zones", lambda *a, **k: [])
    monkeypatch.setattr(tgt.core, "enrich_confluence", lambda z, *a, **k: z)
    monkeypatch.setattr(tgt.core, "zone_locations", lambda z: [])
    monkeypatch.setattr(tgt, "build_entry_locations_v24", lambda *a, **k: ([], [z]))
    dummy = h15([(100, 101, 99, 100)] * 5)
    out = tgt.build_reaction_destinations(
        pd.DataFrame(), pd.DataFrame(), dummy,
        pd.Timestamp("2026-08-17 10:30", tz="America/New_York"),
        p, {}, {}, pd.Timestamp("2026-08-17").date(), 100.0, "L",
        piv15=pd.DataFrame(),
    )
    assert len(out) == 1
    assert out[0].kind == "KEY_ZONE_15M"
    assert out[0].location.id == "REACTION_ONLY"
    assert out[0].location.entry_authorized is False
    assert out[0].meaningful is True


def test_tp_contract_separates_reaction_significance_from_entry_authorization():
    from research.current_mnq_strategy_v2_4_policy import load_fvg_spec
    r = load_fvg_spec()["trader_target_rule"]
    assert r["reaction_significance_is_distinct_from_entry_authorization"] is True
    assert r["target_only_zone_can_create_entry"] is False
    assert "at least 2 independent rejections" in r["target_only_15m_zone_rule"]


def test_semantics_hash_changes_if_fvg_contract_changes(tmp_path):
    from research.current_mnq_strategy_v2_4_policy import semantics_hash
    spec = tmp_path / "spec.json"; spec.write_text("{}")
    f = tmp_path / "fvg.json"; f.write_text('{"x":1}')
    a = semantics_hash(spec, f)
    f.write_text('{"x":2}')
    b = semantics_hash(spec, f)
    assert a != b
