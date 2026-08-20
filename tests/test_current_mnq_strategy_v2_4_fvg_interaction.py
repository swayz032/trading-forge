from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_fvg_interaction as inter

TZ = "America/New_York"


def test_bullish_fvg_maps_to_support_and_bearish_fvg_maps_to_resistance(monkeypatch):
    formed = pd.Timestamp("2026-08-20 10:00", tz=TZ)
    monkeypatch.setattr(inter, "active_15m_fvgs", lambda *a, **k: [
        SimpleNamespace(direction="bullish", lo=100.0, hi=104.0, mid=102.0, formed_at=formed),
        SimpleNamespace(direction="bearish", lo=120.0, hi=126.0, mid=123.0, formed_at=formed),
    ])
    got = inter.active_fvg_interaction_locations(
        pd.DataFrame(), pd.Timestamp("2026-08-20 10:30", tz=TZ)
    )
    assert len(got) == 2
    support = next(x for x in got if x.mid == 102.0)
    resistance = next(x for x in got if x.mid == 123.0)
    assert support.side == "S"
    assert resistance.side == "R"
    assert support.entry_authorized is True
    assert resistance.entry_authorized is True
    assert support.source == inter.FVG_INTERACTION_SOURCE
    assert resistance.source == inter.FVG_INTERACTION_SOURCE


def test_fvg_location_preserves_full_band_edges_for_rejection_or_clearance(monkeypatch):
    formed = pd.Timestamp("2026-08-20 10:00", tz=TZ)
    monkeypatch.setattr(inter, "active_15m_fvgs", lambda *a, **k: [
        SimpleNamespace(direction="bearish", lo=120.0, hi=126.0, mid=123.0, formed_at=formed),
    ])
    got = inter.active_fvg_interaction_locations(
        pd.DataFrame(), pd.Timestamp("2026-08-20 10:30", tz=TZ)
    )[0]
    assert got.lo == 120.0
    assert got.hi == 126.0
    assert got.mid == 123.0
