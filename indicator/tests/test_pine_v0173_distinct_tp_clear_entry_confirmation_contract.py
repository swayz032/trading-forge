from pathlib import Path


SRC = Path("indicator/pine/slumdawg_platform_parity_v0_17_3_distinct_tp_clear_entry_confirmation.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_v0173_final_tp_merge_carries_zone_bounds_not_only_prices():
    s = text()
    assert "f_add_zone_candidate" in s
    assert "array<float> shortCandLo" in s
    assert "array<float> shortCandHi" in s
    assert "array<float> shortCandTarget" in s
    assert "f_next_short_zone" in s
    assert "shortTp1Lo" in s
    assert "shortTp1Hi" in s


def test_v0173_tp2_requires_full_zone_separation_and_shelf_fusion_gap():
    s = text()
    assert "mergedShelfFusionGap" in s
    assert "distinctZoneGap = math.max(mergedZoneGap, mergedShelfFusionGap)" in s
    assert "bool distinct = hi <= boundaryLo - gap" in s
    assert "bool distinct = lo >= boundaryHi + gap" in s
    assert "shortTp2Lo" in s and "shortTp3Lo" in s
    assert "shortTp2Raw" in s and "shortTp3Raw" in s


def test_v0173_does_not_use_ternary_expression_to_return_tuple():
    s = text()
    assert "Ternary expressions are intentionally not used to return tuples" in s
    assert "? f_next_short_zone" not in s
    assert "? f_next_long_zone" not in s


def test_v0173_panel_uses_clear_entry_confirmation_language():
    s = text()
    assert "🕯️ ENTRY CONFIRMATION" in s
    assert "NOT ACTIVE YET" in s
    assert "👀 WATCHING CANDLES" in s
    assert "✅ ENTRY BREAK CONFIRMED" in s
    assert "✅ MOMENTUM CONFIRMED" in s
    assert "⏳ WAIT FOR PRICE TO BREAK " in s
    assert "ENTRY_READY" in s
    assert "CANDLE SETUP" not in s


def test_v0173_preserves_requested_visual_semantics():
    s = text()
    assert "🤖 SLUMDAWG TRADERS" in s
    assert "🟢 LONG - ENTRY ZONE" in s
    assert "🔴 SHORT - ENTRY ZONE" in s
    assert "🎯 TAKE PROFIT ZONE 1" in s
    assert "🎯 TAKE PROFIT ZONE 2" in s
    assert "🎯 TAKE PROFIT ZONE 3" in s
