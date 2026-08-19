from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_16_take_profit_zones_panel.pine"


class V016TakeProfitPanelContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")

    def test_accepted_entry_selector_is_preserved(self):
        self.assertIn('const int ENTRY_SWING_MEMORY = 8', self.text)
        self.assertIn('f_outer_entry_pair_15m()', self.text)
        self.assertIn('request.security(syminfo.tickerid, "15", f_outer_entry_pair_15m()', self.text)
        self.assertIn('"🟢 LONG - ENTRY ZONE"', self.text)
        self.assertIn('"🔴 SHORT - ENTRY ZONE"', self.text)

    def test_take_profit_reaction_lane_is_separate_and_ordered(self):
        self.assertIn('f_tp_candidates_15m()', self.text)
        self.assertIn('f_pick_long_zone', self.text)
        self.assertIn('f_pick_short_zone', self.text)
        self.assertIn('"🎯 TAKE PROFIT ZONE 1"', self.text)
        self.assertIn('"🎯 TAKE PROFIT ZONE 2"', self.text)
        self.assertIn('"🎯 TAKE PROFIT ZONE 3"', self.text)
        self.assertIn('targetMode = input.string("AUTO"', self.text)

    def test_key_level_engine_stays_on_main_price_scale(self):
        self.assertIn('overlay = true', self.text)
        self.assertNotIn('scale = scale.none', self.text)
        self.assertIn('float pdh = dailyCurrentCompletedNow ? dHighCurrent : dHighPrev', self.text)
        self.assertIn('float pwh = weeklyCurrentCompletedNow ? wHighCurrent : wHighPrev', self.text)

    def test_panel_is_black_lime_and_merged(self):
        self.assertIn('color PANEL_BLACK = color.rgb(0, 0, 0)', self.text)
        self.assertIn('color LIME_FRAME = color.rgb(80, 255, 80)', self.text)
        self.assertIn('table.merge_cells(coach, 0, 0, 1, 0)', self.text)
        self.assertIn('"🤖 SLUMDAWG TRADERS"', self.text)
        self.assertIn('text_color = color.white', self.text)

    def test_trendlines_remain_removed(self):
        self.assertNotIn('f_sync_trend', self.text)
        self.assertNotIn('boardFreezeTime', self.text)
        self.assertNotIn('"TRENDLINES"', self.text)


if __name__ == "__main__":
    unittest.main()
