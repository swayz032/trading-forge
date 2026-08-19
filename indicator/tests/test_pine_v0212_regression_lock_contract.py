import unittest
from pathlib import Path


SRC = Path("indicator/pine/slumdawg_platform_parity_v0_21_2_5m_map_live_tp_rescan.pine")


class PineV0212RegressionLockContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = SRC.read_text(encoding="utf-8")

    def test_version_and_safety_lock(self):
        self.assertIn("v0.21.2 — 5M MAP RENDER LOCK + LIVE TP RESCAN", self.s)
        self.assertIn("const bool LIVE_DECISION_SUPPORT_APPROVED = false", self.s)

    def test_locked_structural_go_cannot_get_easier(self):
        self.assertIn("autoLongCandidate > lockedLongEntry", self.s)
        self.assertIn("autoShortCandidate < lockedShortEntry", self.s)
        self.assertNotIn("autoLongCandidate < lockedLongEntry", self.s)
        self.assertNotIn("autoShortCandidate > lockedShortEntry", self.s)

    def test_live_proof_is_directional_ratchet(self):
        self.assertIn("side == 1 ? math.max(prior, candidate) : math.min(prior, candidate)", self.s)
        self.assertIn('"🟢 LONG - LIVE PROOF"', self.s)
        self.assertIn('"🔴 SHORT - LIVE PROOF"', self.s)

    def test_daily_and_weekly_levels_remain_independent(self):
        self.assertIn("bool pdhValid = not na(pdh)", self.s)
        self.assertIn("bool pdlValid = not na(pdl)", self.s)
        self.assertIn("bool pwhValid = not na(pwh)", self.s)
        self.assertIn("bool pwlValid = not na(pwl)", self.s)
        self.assertIn("showWeeklyWhenNear and pwhValid", self.s)
        self.assertIn("showWeeklyWhenNear and pwlValid", self.s)

    def test_5m_map_renderer_is_not_time_close_dependent(self):
        self.assertIn("xloc = xloc.bar_index", self.s)
        self.assertIn("int labelX = bar_index + LABEL_OFFSET_BARS", self.s)
        self.assertIn("line.set_xy1(id, bar_index, price)", self.s)
        self.assertIn("line.set_xy2(id, bar_index + 1, price)", self.s)
        self.assertNotIn("int chartBarMs", self.s)

    def test_live_5m_reaction_history_is_rescanned_from_current_yellow_boundary(self):
        marker = "[l5live_1lo, l5live_1hi, l5live_1"
        self.assertIn(marker, self.s)
        self.assertIn("displayedLongEntry, displayedShortEntry, longFirstGap, shortFirstGap)", self.s)
        self.assertIn("f_add_zone(longCandLo, longCandHi, l5live_1lo, l5live_1hi, l5live_1)", self.s)
        self.assertIn("f_add_zone(longCandLo, longCandHi, l5live_2lo, l5live_2hi, l5live_2)", self.s)
        self.assertIn("f_add_zone(longCandLo, longCandHi, l5live_3lo, l5live_3hi, l5live_3)", self.s)

    def test_live_rescan_occurs_before_final_tp_numbering(self):
        live_pos = self.s.index("[l5live_1lo, l5live_1hi, l5live_1")
        final_pos = self.s.index("[longTp1, longTp1Lo, longTp1Hi] = f_next_long_zone")
        self.assertLess(live_pos, final_pos)
        self.assertIn("f_next_long_zone(longCandLo, longCandHi, displayedLongEntry, longFirstGap)", self.s)
        self.assertIn("longTp1 > displayedLongEntry", self.s)
        self.assertIn("shortTp1 < displayedShortEntry", self.s)

    def test_tp_placement_and_first_shelf_rules_remain_locked(self):
        self.assertIn("tpLongInteriorDepth = input.float(0.55", self.s)
        self.assertIn("tpShortInteriorDepth = input.float(0.50", self.s)
        self.assertIn("f_expand_zone", self.s)
        self.assertIn("tpCanonicalFusionAtr", self.s)
        self.assertIn("tpMinReactionDisplacementAtr", self.s)


if __name__ == "__main__":
    unittest.main()
