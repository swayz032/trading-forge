from __future__ import annotations

from types import SimpleNamespace

from research import current_mnq_strategy_v2_4_targets as tgt


def _zone(touches=2):
    return SimpleNamespace(touches=touches)


def _loc(name, lo, hi, *, source="WICK_ZONE", quality=.85, touches=2):
    return tgt.core.Location(
        id=name, side="R", lo=float(lo), hi=float(hi), mid=(lo+hi)/2,
        source=source, quality=quality, confluence=1,
        entry_authorized=True, zone=_zone(touches),
    )


def _fvg(lo, hi, name="2026-08-17T09:45:00-04:00"):
    return SimpleNamespace(lo=float(lo), hi=float(hi), mid=(lo+hi)/2, formed_at=SimpleNamespace(isoformat=lambda: name))


def test_broad_15m_zone_keeps_first_contact_but_uses_earlier_internal_5m_cluster_for_precision():
    p = tgt.core.Params(tp_depth=.5)
    primary = _loc("HTF", 120, 140, quality=.9)
    cluster = _loc("5M", 124, 128, quality=.9)
    fvg = _fvg(132, 138)
    d = tgt._refine_primary("KEY_ZONE_15M", primary, [cluster], [fvg], 100.0, "L", p)
    assert d.first_contact_distance == 20.0  # broad HTF reaction starts first
    assert d.target_raw == 126.0             # precise 5m safe middle
    assert d.precision_source == "LIQUIDITY_CLUSTER_5M"
    assert d.kind == "KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M"


def test_fvg_inside_winning_15m_zone_beats_later_internal_liquidity_cluster():
    p = tgt.core.Params(tp_depth=.5)
    primary = _loc("HTF", 120, 145, quality=.9)
    cluster = _loc("5M", 135, 139, quality=.9)
    fvg = _fvg(125, 131)
    d = tgt._refine_primary("KEY_ZONE_15M", primary, [cluster], [fvg], 100.0, "L", p)
    assert d.first_contact_distance == 20.0
    assert d.target_raw == 128.0
    assert d.precision_source == "FVG_15M_NATIVE"
    assert d.fvg_confluent is True


def test_no_internal_feature_uses_safe_middle_of_broad_key_zone():
    p = tgt.core.Params(tp_depth=.5)
    primary = _loc("HTF", 120, 140, quality=.9)
    d = tgt._refine_primary("KEY_ZONE_15M", primary, [], [], 100.0, "L", p)
    assert d.first_contact_distance == 20.0
    assert d.target_raw == 130.0
    assert d.precision_source is None
    assert d.kind == "KEY_ZONE_15M"


def test_exact_internal_contact_tie_prefers_5m_precision_not_farther_feature():
    p = tgt.core.Params(tp_depth=.5)
    primary = _loc("HTF", 120, 140, quality=.9)
    cluster = _loc("5M", 125, 129, quality=.9)
    fvg = _fvg(125, 133)
    d = tgt._refine_primary("KEY_ZONE_15M", primary, [cluster], [fvg], 100.0, "L", p)
    assert d.precision_source == "LIQUIDITY_CLUSTER_5M"
    assert d.target_raw == 127.0


def test_short_precision_is_mirrored_by_physical_near_edge_not_midpoint():
    p = tgt.core.Params(tp_depth=.5)
    primary = _loc("HTF", 160, 180, quality=.9)
    cluster = _loc("5M", 171, 175, quality=.9)
    fvg = _fvg(162, 168)
    # SHORT from 200 reaches cluster high=175 before FVG high=168.
    d = tgt._refine_primary("KEY_ZONE_15M", primary, [cluster], [fvg], 200.0, "S", p)
    assert d.first_contact_distance == 20.0
    assert d.precision_source == "LIQUIDITY_CLUSTER_5M"
    assert d.target_raw == 173.0
