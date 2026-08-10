from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_14_1_level_label_spacing.pine"


class V0141LevelLabelSpacingSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")

    def test_key_level_engine_stays_on_main_price_scale(self):
        self.assertIn('overlay = true', self.text)
        self.assertNotIn('scale = scale.none', self.text)
        self.assertEqual(self.text.count('request.security('), 4)

    def test_trendline_engine_stays_removed(self):
        self.assertNotIn('f_sync_trend', self.text)
        self.assertNotIn('boardFreezeTime', self.text)
        self.assertNotIn('activeTlCount', self.text)
        self.assertNotIn('"TRENDLINES"', self.text)

    def test_level_chips_remain_title_only_but_are_larger(self):
        self.assertIn('label.set_text(lid, name)', self.text)
        self.assertIn('label.set_size(lid, size.normal)', self.text)
        self.assertNotIn('name + "  " + str.tostring(price', self.text)

    def test_level_chips_move_into_future_chart_space(self):
        self.assertIn('const int LEVEL_LABEL_OFFSET_BARS = 8', self.text)
        self.assertIn('int chartBarMs = not na(time_close) and time_close > time ? time_close - time : FALLBACK_BAR_MS', self.text)
        self.assertIn('int levelLabelX = (not na(time_close) ? time_close : time) + chartBarMs * LEVEL_LABEL_OFFSET_BARS', self.text)
        self.assertIn('label.set_xy(lid, labelX, price)', self.text)

    def test_coach_collapse_behavior_is_preserved(self):
        self.assertIn('input.bool(true, "Show Slumdawg coach"', self.text)
        self.assertIn('"SLUMDAWG  ▸"', self.text)

    def test_shorttitle_stays_within_platform_limit(self):
        self.assertIn('shorttitle = "SLUMDAWG"', self.text)


if __name__ == "__main__":
    unittest.main()
