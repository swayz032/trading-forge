from pathlib import Path

ENTRY = Path("indicator/fxr/slumdawg_v2_entry_tp_15m_v0_4.fxr.js")
MACRO = Path("indicator/fxr/slumdawg_v2_macro_daily_v0_2.fxr.js")
CONTEXT4H = Path("indicator/fxr/slumdawg_v2_context_4h.fxr.js")
DOC = Path("indicator/fxr/V2_BUNDLE.md")


def test_fxr_v04_uses_one_15m_mtf_request_and_native_chart_5m():
    s = ENTRY.read_text(encoding="utf-8")
    assert s.count('mtf.timeframe("15")') == 1
    assert s.count("mtf.timeframe(") == 1
    assert '"15",\n    320,' in s
    assert '"5",\n    scan5,' in s
    assert "pair.longEntry" in s
    assert "pair.shortEntry" in s


def test_fxr_v04_fuses_reaction_zones_before_target_numbering():
    s = ENTRY.read_text(encoding="utf-8")
    assert "qualifyingClusters" in s
    assert "canonicalizeZones" in s
    assert "selectCanonicalTargets" in s
    assert "safeTargetFromZone" in s
    assert "ladderFromRows" not in s
    assert "mergeDistinctZones" not in s


def test_fxr_v04_mid_vs_safe_semantics_match_pine_contract():
    s = ENTRY.read_text(encoding="utf-8")
    assert 'input.str("BIG DIRECTION (match Daily helper)"' in s
    assert "const withBigDirection = move !== 0 && move === bigDir" in s
    assert "const targetDepth = withBigDirection ? 0.50 : inputs.tppenetration" in s
    assert 'const mode = withBigDirection ? "MID" : "SAFE"' in s


def test_fxr_v04_preserves_bos_and_standard_entry_state():
    s = ENTRY.read_text(encoding="utf-8")
    assert "currentMove" in s
    assert '"WAIT_PROOF"' in s
    assert 'state[1] = "BREAK"' in s
    assert 'state[1] = "PUSH_1"' in s
    assert 'state[1] = "ENTRY_READY"' in s


def test_fxr_bundle_documents_daily_macro_mirror_and_platform_limit():
    s = DOC.read_text(encoding="utf-8")
    assert "BIG DIRECTION input" in s
    assert "one requested MTF timeframe per script" in s
    assert "full one-panel Python/Pine/FXR parity remains a certification blocker" in s
    assert CONTEXT4H.exists()
    assert MACRO.exists()


def test_fxr_v045_reaction_quality_precedes_distance_ranking():
    s = ENTRY.read_text(encoding="utf-8")
    assert 'input.int("TP Reaction Confirm Bars", 6, "reactionbars"' in s
    assert 'input.float("Minimum TP Reaction x ATR", 0.75, "minreactionatr"' in s
    assert "reactionDownStrength" in s
    assert "reactionUpStrength" in s
    assert "highReactionStrength >= minReactionAtr" in s
    assert "lowReactionStrength >= minReactionAtr" in s
    assert s.index("highReactionStrength >= minReactionAtr") < s.index("eligible.sort")


def test_fxr_v045_target_reaction_polarity_and_profit_side_are_hard():
    s = ENTRY.read_text(encoding="utf-8")
    assert 'if (isHigh && finite(longEntry)' in s
    assert 'if (isLow && finite(shortEntry)' in s
    assert 'candidateZone.lo >= entry + entryGap' in s
    assert 'candidateZone.hi <= entry - entryGap' in s
    assert 'const profitSide = side === "LONG" ? finite(target) && target > entry : finite(target) && target < entry;' in s


def test_fxr_v045_observability_remains_present():
    s = ENTRY.read_text(encoding="utf-8")
    assert 'plot.line("SLUMDAWG ACTIVE"' in s
    assert 'band.line("SLUMDAWG BUILDING STRUCTURE"' in s
    assert 'plot.line("SLUMDAWG LONG TP1"' in s
    assert 'plot.line("SLUMDAWG SHORT TP1"' in s
