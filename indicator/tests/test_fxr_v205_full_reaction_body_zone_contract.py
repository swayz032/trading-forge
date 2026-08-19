from pathlib import Path

SRC = Path("indicator/fxr/slumdawg_v2_entry_tp_15m_v0_5.fxr.js")


def text():
    return SRC.read_text(encoding="utf-8")


def test_fxr_v205_uses_one_15m_mtf_lane_and_native_5m():
    s = text()
    assert s.count('mtf.timeframe("15")') == 1
    assert s.count("mtf.timeframe(") == 1
    assert 'collectDirectionalReactions(\n    "15"' in s
    assert 'collectDirectionalReactions(\n    "5"' in s


def test_fxr_v205_full_body_reaction_geometry_matches_pine():
    s = text()
    assert "var loHighZone = Math.min(openHighReact, closeHighReact);" in s
    assert "var hiHighZone = highHighReact;" in s
    assert "var loLowZone = lowLowReact;" in s
    assert "var hiLowZone = Math.max(openLowReact, closeLowReact);" in s
    assert "Math.max(openHighReact, closeHighReact)" not in s
    assert "Math.min(openLowReact, closeLowReact)" not in s


def test_fxr_v205_quality_first_and_first_shelf_ordering():
    s = text()
    assert "strengthHighZone >= minReaction" in s
    assert "strengthLowZone >= minReaction" in s
    assert "eligibleTargets.sort" in s
    assert "var da = side === \"LONG\" ? a.lo - entry : entry - a.hi;" in s
    assert "if (da !== db) return da - db;" in s


def test_fxr_v205_side_specific_inside_zone_targets():
    s = text()
    assert 'input.float("LONG Target Depth Inside Zone", 0.55' in s
    assert 'input.float("SHORT Target Depth Inside Zone", 0.50' in s
    assert 'zone.lo + (zone.hi - zone.lo) * depthTarget' in s
    assert 'zone.hi - (zone.hi - zone.lo) * depthTarget' in s


def test_fxr_v205_hard_profit_side_guards():
    s = text()
    assert 'side === "LONG" ? finite(priceTarget) && priceTarget > entry : finite(priceTarget) && priceTarget < entry' in s
    assert 'longTargetsRun[0].target > pairRun.longEntry' in s
    assert 'shortTargetsRun[0].target < pairRun.shortEntry' in s


def test_fxr_v205_observability_and_parser_safe_patterns_remain():
    s = text()
    assert "SLUMDAWG V2.0.5 ACTIVE" in s
    assert "SLUMDAWG BUILDING STRUCTURE" in s
    assert "plot.line" in s
    assert "band.line" in s
    assert "const runtimeState = [" in s
    assert "..." not in s
