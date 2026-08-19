from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_15_auto_yellow_entries.pine"


class V015AutoYellowEntrySourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")

    def test_key_level_engine_stays_on_main_price_scale(self):
        self.assertIn('overlay = true', self.text)
        self.assertNotIn('scale = scale.none', self.text)
        self.assertIn('[dHighCurrent, dLowCurrent, dCloseTimeCurrent]', self.text)
        self.assertIn('[wHighCurrent, wLowCurrent, wCloseTimeCurrent]', self.text)

    def test_automatic_trendlines_stay_removed(self):
        self.assertNotIn('f_sync_trend', self.text)
        self.assertNotIn('boardFreezeTime', self.text)
        self.assertNotIn('activeTlCount', self.text)
        self.assertNotIn('"TRENDLINES"', self.text)

    def test_entry_selector_uses_confirmed_15m_pivots(self):
        self.assertIn('ta.pivothigh(high, ENTRY_PIVOT_LEFT, ENTRY_PIVOT_RIGHT)', self.text)
        self.assertIn('ta.pivotlow(low, ENTRY_PIVOT_LEFT, ENTRY_PIVOT_RIGHT)', self.text)
        self.assertIn('request.security(syminfo.tickerid, "15", f_outer_entry_pair_15m(), lookahead = barmerge.lookahead_off)', self.text)
        self.assertIn('const int ENTRY_SWING_MEMORY = 8', self.text)

    def test_outer_not_nearest_selection_is_explicit(self):
        self.assertIn('float outerHigh = f_max_na', self.text)
        self.assertIn('float outerLow = f_min_na', self.text)
        self.assertNotIn('nearest wick', self.text.lower().replace('not the nearest wick', ''))

    def test_both_yellow_entry_lines_are_full_width(self):
        self.assertIn('var line longEntryLine = line.new', self.text)
        self.assertIn('var line shortEntryLine = line.new', self.text)
        self.assertIn('extend = extend.both', self.text)
        self.assertIn('"LONG"', self.text)
        self.assertIn('"SHORT"', self.text)
        self.assertIn('YELLOW_GO', self.text)

    def test_entry_and_key_level_labels_share_right_side_spacing(self):
        self.assertIn('const int LEVEL_LABEL_OFFSET_BARS = 16', self.text)
        self.assertIn('label.set_xy(lid, labelX, price)', self.text)

    def test_entry_lines_do_not_become_targets_or_walls(self):
        self.assertIn('Entry lines are proof levels, not walls/targets.', self.text)
        self.assertNotIn('f_add_wall(longEntry', self.text)
        self.assertNotIn('f_add_wall(shortEntry', self.text)

    def test_coach_exposes_both_structural_entry_candidates(self):
        self.assertIn('"LONG YELLOW"', self.text)
        self.assertIn('"SHORT YELLOW"', self.text)
        self.assertIn('"WATCH LONG YELLOW"', self.text)
        self.assertIn('"WATCH SHORT YELLOW"', self.text)


if __name__ == "__main__":
    unittest.main()
