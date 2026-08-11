from pathlib import Path

SRC = Path("indicator/pine/slumdawg_platform_parity_v0_20_0_full_reaction_body_zones.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_v020_builds_full_body_to_extreme_reaction_zones():
    s = text()
    assert "v0.20.0 — FULL REACTION-BODY ZONES + WHITE-LINE GOLDEN FIX" in s
    assert "float zLoLong = math.min(open[i], close[i])" in s
    assert "float zHiLong = high[i]" in s
    assert "float zLoShort = low[i]" in s
    assert "float zHiShort = math.max(open[i], close[i])" in s
    # Old thin wick-strip definitions are forbidden in the v0.20 detector.
    assert "float zLoLong = math.max(open[i], close[i])" not in s
    assert "float zHiShort = math.min(open[i], close[i])" not in s


def test_v020_reaction_quality_precedes_distance_and_first_shelf_owns_tp1():
    s = text()
    assert "reactionDown >= tpMinReactionDisplacementAtr" in s
    assert "reactionUp >= tpMinReactionDisplacementAtr" in s
    assert s.index("reactionDown >= tpMinReactionDisplacementAtr") < s.index("float dist = cLo - floorPrice")
    assert "[longTp1, longTp1Lo, longTp1Hi] = f_next_long_zone" in s
    assert "[shortTp1, shortTp1Lo, shortTp1Hi] = f_next_short_zone" in s


def test_v020_operator_interior_geometry_is_side_specific():
    s = text()
    assert 'input.float(0.55, "LONG target depth inside zone"' in s
    assert 'input.float(0.50, "SHORT target depth inside zone"' in s
    assert "float raw = lo + (hi - lo) * tpLongInteriorDepth" in s
    assert "float raw = hi - (hi - lo) * tpShortInteriorDepth" in s


def test_v020_hard_profit_side_guards_cover_static_and_rolled_entry():
    s = text()
    assert "target > longEntry" in s
    assert "target < shortEntry" in s
    assert "longTp1 > displayedLongEntry" in s
    assert "shortTp1 < displayedShortEntry" in s


def test_v020_golden_white_line_values_are_frozen_as_case_references_not_constants():
    s = text()
    assert "LONG ~29953.25 from ~29900 entry" in s
    assert "SHORT ~29600.75 from ~29666 entry" in s
    # Golden values may appear only in comments; they must never be assigned to executable prices.
    assert "= 29953.25" not in s
    assert "= 29600.75" not in s


def test_v020_keeps_beginner_panel_and_entry_confirmation():
    s = text()
    assert "🤖 SLUMDAWG TRADERS" in s
    assert "🕯️ ENTRY CONFIRMATION" in s
    assert "LONG TAKE PROFIT ZONE 1" in s
    assert "SHORT TAKE PROFIT ZONE 1" in s
    assert "FULL BODY ZONES + FIRST SHELF" in s
