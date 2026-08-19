import unittest
from pathlib import Path


PINE = Path("indicator/pine/slumdawg_platform_parity_v0_16_2_reaction_cluster_tp.pine")


class PineV0162ReactionClusterTpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_visually_accepted_entry_selector_is_retained(self):
        self.assertIn('const int ENTRY_SWING_MEMORY = 8', self.src)
        self.assertIn('request.security(syminfo.tickerid, "15", f_outer_entry_pair_15m()', self.src)
        self.assertIn('🟢 LONG - ENTRY ZONE', self.src)
        self.assertIn('🔴 SHORT - ENTRY ZONE', self.src)

    def test_tp_requires_reaction_cluster_not_single_wick(self):
        self.assertIn('tpMinTouches = input.int(2', self.src)
        self.assertIn('touches >= minTouches', self.src)
        self.assertIn('f_pick_long_cluster', self.src)
        self.assertIn('f_pick_short_cluster', self.src)
        self.assertNotIn('f_pick_long_zone(array<float>', self.src)
        self.assertNotIn('f_pick_short_zone(array<float>', self.src)

    def test_tp1_must_be_separate_from_entry_neighborhood(self):
        self.assertIn('tpEntrySeparationAtr', self.src)
        self.assertIn('clusterLo >= floorPrice + requiredGap', self.src)
        self.assertIn('clusterHi <= ceilingPrice - requiredGap', self.src)
        self.assertIn('tpEntryGap', self.src)

    def test_successive_tps_are_distinct_clusters(self):
        self.assertIn('tpZoneSeparationAtr', self.src)
        self.assertIn('tpZoneGap', self.src)
        self.assertIn('longTp1Hi, tpZoneGap', self.src)
        self.assertIn('shortTp1Lo, tpZoneGap', self.src)

    def test_near_side_is_target_and_far_wick_is_not_target(self):
        self.assertIn('longTp1Set ? f_round_down_tick(longTp1Lo) : na', self.src)
        self.assertIn('shortTp1Set ? f_round_up_tick(shortTp1Hi) : na', self.src)
        self.assertNotIn('longTp1Set ? f_round_down_tick(longTp1Hi)', self.src)
        self.assertNotIn('shortTp1Set ? f_round_up_tick(shortTp1Lo)', self.src)

    def test_tp_stays_line_based_and_panel_branding_is_preserved(self):
        self.assertIn('var line longTp1Line', self.src)
        self.assertIn('var line shortTp1Line', self.src)
        self.assertNotIn('var box longTp1Box', self.src)
        self.assertIn('🎯 TAKE PROFIT ZONE 1', self.src)
        self.assertIn('🤖 SLUMDAWG TRADERS', self.src)
        self.assertIn('PANEL_DARK = color.rgb(18, 20, 25)', self.src)
        self.assertIn('GOLD_ACCENT = color.rgb(205, 165, 70)', self.src)

    def test_research_thresholds_are_explicitly_marked_calibration_required(self):
        self.assertIn('TP RESEARCH (CALIBRATION REQUIRED)', self.src)
        self.assertIn('RESEARCH DEFAULTS / CALIBRATION REQUIRED', self.src)
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', self.src)


if __name__ == "__main__":
    unittest.main()
