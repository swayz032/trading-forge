from pathlib import Path


SRC = Path("indicator/pine/slumdawg_platform_parity_v0_18_0_canonical_tp_shelves.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_v0180_canonical_fusion_precedes_tp_numbering():
    s = text()
    assert "f_expand_canonical_zone" in s
    assert "lo <= zoneHi + fusionGap and hi >= zoneLo - fusionGap" in s
    assert "f_next_short_canonical_zone" in s
    assert "f_next_long_canonical_zone" in s
    assert "canonicalShelfGap" in s
    assert "array<float> shortCandTarget" not in s
    assert "array<float> longCandTarget" not in s


def test_v0180_auto_target_is_strictly_inside_canonical_shelf():
    s = text()
    assert "f_safe_short_target_from_zone" in s
    assert "f_safe_long_target_from_zone" in s
    assert "float minInside = lo + syminfo.mintick" in s
    assert "float maxInside = hi - syminfo.mintick" in s
    assert "minInside <= maxInside ? math.min(math.max(rounded, minInside), maxInside) : na" in s


def test_v0180_recomputes_final_target_from_fused_bounds():
    s = text()
    assert "float target = f_safe_short_target_from_zone(lo, hi, penetration)" in s
    assert "float target = f_safe_long_target_from_zone(lo, hi, penetration)" in s
    assert "float shortTp1Price = shortTp1Raw" in s
    assert "float longTp1Price = longTp1Raw" in s


def test_v0180_entry_confirmation_contract_preserved():
    s = text()
    assert "🕯️ ENTRY CONFIRMATION" in s
    assert "NOT ACTIVE YET" in s
    assert "👀 WATCHING CANDLES" in s
    assert "✅ ENTRY BREAK CONFIRMED" in s
    assert "✅ MOMENTUM CONFIRMED" in s
    assert "CANDLE SETUP" not in s


def test_v0180_visual_and_runtime_marker():
    s = text()
    assert "🎯 TAKE PROFIT ZONE 1" in s
    assert "🎯 TAKE PROFIT ZONE 2" in s
    assert "🎯 TAKE PROFIT ZONE 3" in s
    assert '" + CANONICAL TP"' in s
