from pathlib import Path

SRC = Path("indicator/pine/slumdawg_platform_parity_v0_19_0_reaction_zone_targets.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_v019_native_5m_is_anchored_to_final_entry_not_its_own_outer_pair():
    s = text()
    assert "f_tp_zone_ladder_anchored" in s
    assert "true, longEntry, shortEntry)" in s
    # The TP engine no longer asks 1H/4H lanes to prefilter against their own outer entries.
    assert '"60", f_tp_zone_ladder_local' not in s
    assert '"240", f_tp_zone_ladder_local' not in s


def test_v019_midpoint_when_current_move_matches_big_direction():
    s = text()
    assert "bool tpWithBigDirection = bigDir != 0 and currentMoveDir == bigDir and planDir == bigDir" in s
    assert "float autoTpDepth = tpWithBigDirection ? 0.50 : tpPenetrationFraction" in s
    assert "canonicalShelfGap, autoTpDepth" in s
    assert 'string autoTpMode = tpWithBigDirection ? "MID" : "SAFE"' in s


def test_v019_targets_are_strictly_inside_reaction_zone():
    s = text()
    assert "f_safe_short_target_from_zone" in s
    assert "f_safe_long_target_from_zone" in s
    assert "float minInside = lo + syminfo.mintick" in s
    assert "float maxInside = hi - syminfo.mintick" in s
    assert "minInside <= maxInside ? math.min(math.max(rounded, minInside), maxInside) : na" in s


def test_v019_reaction_strength_and_ui_contract():
    s = text()
    assert 'input.int(2, "15m minimum reactions"' in s
    assert 'input.int(3, "5m fallback minimum reactions"' in s
    assert "🎯 TAKE PROFIT ZONE 1" in s
    assert "🕯️ ENTRY CONFIRMATION" in s
    assert "NO QUALIFIED REACTION ZONE" in s
    assert "CANDLE SETUP" not in s


def test_v019_target_reactions_are_directional_not_any_pivot_below_above_entry():
    s = text()
    assert "LONG destinations are prior high-side rejection/supply zones" in s
    assert "SHORT destinations are prior low-side reaction/demand zones" in s
    assert "if localHigh and not na(anchorLong)" in s
    assert "if localLow and not na(anchorShort)" in s
    assert 'if entryMode == "AUTO"' in s
