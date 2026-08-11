from pathlib import Path

SRC = Path("indicator/pine/slumdawg_platform_parity_v0_21_1_daily_weekly_live_tp_reanchor.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_v0211_daily_levels_are_independently_valid_and_drawn():
    s = text()
    assert "v0.21.1 — MAP LEVEL RESTORE + LIVE TP RE-ANCHOR" in s
    assert "bool pdhValid = not na(pdh)" in s
    assert "bool pdlValid = not na(pdl)" in s
    assert 'f_sync_level(pdhLine, pdhLabel, pdh, "PDH", BLUE_DAY, pdhValid' in s
    assert 'f_sync_level(pdlLine, pdlLabel, pdl, "PDL", BLUE_DAY, pdlValid' in s
    assert "dayValuesValid" not in s


def test_v0211_weekly_levels_are_independent_but_still_near_only():
    s = text()
    assert "bool pwhValid = not na(pwh)" in s
    assert "bool pwlValid = not na(pwl)" in s
    assert "float planningEnvelope = dailyEnvelope" in s
    assert "math.abs(longEntry - close)" in s
    assert "math.abs(shortEntry - close)" in s
    assert "showWeeklyWhenNear and pwhValid" in s
    assert "showWeeklyWhenNear and pwlValid" in s
    assert 'f_sync_level(pwhLine, pwhLabel, pwh, "PWH", BLUE_WEEK, showPwh' in s
    assert 'f_sync_level(pwlLine, pwlLabel, pwl, "PWL", BLUE_WEEK, showPwl' in s


def test_v0211_full_body_shelves_cluster_by_overlap_not_identical_edge():
    s = text()
    overlap = "lo <= seedHi + tolerance and hi >= seedLo - tolerance"
    assert s.count(overlap) >= 2
    assert "Reaction zone adjacency × ATR" in s


def test_v0211_15m_tp_lane_uses_no_easier_locked_anchor():
    s = text()
    assert "f_tp_lane_locked15() =>" in s
    assert "candidateLong15 > lockedLong15" in s
    assert "candidateShort15 < lockedShort15" in s
    assert 'request.security(syminfo.tickerid, "15", f_tp_lane_locked15()' in s
    assert "f_tp_lane_auto15" not in s


def test_v0211_tp_ladder_is_numbered_after_live_proof_boundary_exists():
    s = text()
    display_pos = s.index("float displayedLongEntry")
    select_pos = s.index("[longTp1, longTp1Lo, longTp1Hi] = f_next_long_zone")
    assert display_pos < select_pos
    assert "f_next_long_zone(longCandLo, longCandHi, displayedLongEntry, longFirstGap)" in s
    assert "f_next_short_zone(shortCandLo, shortCandHi, displayedShortEntry, shortFirstGap)" in s
    assert "longTp1 > displayedLongEntry" in s
    assert "shortTp1 < displayedShortEntry" in s


def test_v0211_live_proof_does_not_silently_hide_old_tp_ladder():
    s = text()
    assert "float longFirstGap = armedSide == 1 and entryStage != \"WAIT_PROOF\" ? mergedZoneGap : mergedEntryGap" in s
    assert "float shortFirstGap = armedSide == -1 and entryStage != \"WAIT_PROOF\" ? mergedZoneGap : mergedEntryGap" in s
    assert "drawLongTp1Ok" not in s
    assert "drawShortTp1Ok" not in s


def test_v0211_preserves_structural_and_live_ratchet_invariants():
    s = text()
    assert "autoLongCandidate > lockedLongEntry" in s
    assert "autoShortCandidate < lockedShortEntry" in s
    assert "side == 1 ? math.max(prior, candidate) : math.min(prior, candidate)" in s
    assert '"🟢 LONG - LIVE PROOF"' in s
    assert '"🔴 SHORT - LIVE PROOF"' in s
