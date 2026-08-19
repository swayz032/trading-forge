import unittest
from pathlib import Path

SRC = Path("indicator/pine/slumdawg_platform_parity_v0_21_1_daily_weekly_live_tp_reanchor.pine")


def text():
    return SRC.read_text(encoding="utf-8")


class PineV0211MapLevelsLiveTpContractTests(unittest.TestCase):
    def test_daily_levels_are_independently_valid_and_drawn(self):
        s = text()
        self.assertIn("v0.21.1 — MAP LEVEL RESTORE + LIVE TP RE-ANCHOR", s)
        self.assertIn("bool pdhValid = not na(pdh)", s)
        self.assertIn("bool pdlValid = not na(pdl)", s)
        self.assertIn('f_sync_level(pdhLine, pdhLabel, pdh, "PDH", BLUE_DAY, pdhValid', s)
        self.assertIn('f_sync_level(pdlLine, pdlLabel, pdl, "PDL", BLUE_DAY, pdlValid', s)
        self.assertNotIn("dayValuesValid", s)

    def test_weekly_levels_are_independent_but_still_near_only(self):
        s = text()
        self.assertIn("bool pwhValid = not na(pwh)", s)
        self.assertIn("bool pwlValid = not na(pwl)", s)
        self.assertIn("float planningEnvelope = dailyEnvelope", s)
        self.assertIn("math.abs(longEntry - close)", s)
        self.assertIn("math.abs(shortEntry - close)", s)
        self.assertIn("showWeeklyWhenNear and pwhValid", s)
        self.assertIn("showWeeklyWhenNear and pwlValid", s)
        self.assertIn('f_sync_level(pwhLine, pwhLabel, pwh, "PWH", BLUE_WEEK, showPwh', s)
        self.assertIn('f_sync_level(pwlLine, pwlLabel, pwl, "PWL", BLUE_WEEK, showPwl', s)

    def test_full_body_shelves_cluster_by_overlap_not_identical_edge(self):
        s = text()
        overlap = "lo <= seedHi + tolerance and hi >= seedLo - tolerance"
        self.assertGreaterEqual(s.count(overlap), 2)
        self.assertIn("Reaction zone adjacency × ATR", s)

    def test_15m_tp_lane_uses_no_easier_locked_anchor(self):
        s = text()
        self.assertIn("f_tp_lane_locked15() =>", s)
        self.assertIn("candidateLong15 > lockedLong15", s)
        self.assertIn("candidateShort15 < lockedShort15", s)
        self.assertIn('request.security(syminfo.tickerid, "15", f_tp_lane_locked15()', s)
        self.assertNotIn("f_tp_lane_auto15", s)

    def test_tp_ladder_is_numbered_after_live_proof_boundary_exists(self):
        s = text()
        display_pos = s.index("float displayedLongEntry")
        select_pos = s.index("[longTp1, longTp1Lo, longTp1Hi] = f_next_long_zone")
        self.assertLess(display_pos, select_pos)
        self.assertIn("f_next_long_zone(longCandLo, longCandHi, displayedLongEntry, longFirstGap)", s)
        self.assertIn("f_next_short_zone(shortCandLo, shortCandHi, displayedShortEntry, shortFirstGap)", s)
        self.assertIn("longTp1 > displayedLongEntry", s)
        self.assertIn("shortTp1 < displayedShortEntry", s)

    def test_live_proof_does_not_silently_hide_old_tp_ladder(self):
        s = text()
        self.assertIn('float longFirstGap = armedSide == 1 and entryStage != "WAIT_PROOF" ? mergedZoneGap : mergedEntryGap', s)
        self.assertIn('float shortFirstGap = armedSide == -1 and entryStage != "WAIT_PROOF" ? mergedZoneGap : mergedEntryGap', s)
        self.assertNotIn("drawLongTp1Ok", s)
        self.assertNotIn("drawShortTp1Ok", s)

    def test_preserves_structural_and_live_ratchet_invariants(self):
        s = text()
        self.assertIn("autoLongCandidate > lockedLongEntry", s)
        self.assertIn("autoShortCandidate < lockedShortEntry", s)
        self.assertIn("side == 1 ? math.max(prior, candidate) : math.min(prior, candidate)", s)
        self.assertIn('"🟢 LONG - LIVE PROOF"', s)
        self.assertIn('"🔴 SHORT - LIVE PROOF"', s)


if __name__ == "__main__":
    unittest.main()
