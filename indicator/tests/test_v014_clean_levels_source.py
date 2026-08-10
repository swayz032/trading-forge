from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_14_clean_levels_no_trendlines.pine"


class V014CleanLevelsSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")

    def test_main_price_scale_is_preserved(self):
        self.assertIn('overlay = true', self.text)
        self.assertNotIn('scale = scale.none', self.text)

    def test_automatic_trendline_engine_is_removed(self):
        self.assertNotIn('f_sync_trend', self.text)
        self.assertNotIn('boardFreezeTime', self.text)
        self.assertNotIn('activeTlCount', self.text)
        self.assertNotIn('"TRENDLINES"', self.text)

    def test_only_key_level_higher_timeframe_requests_remain(self):
        self.assertEqual(self.text.count('request.security('), 4)

    def test_level_chips_are_title_only_and_small(self):
        self.assertIn('label.set_text(lid, name)', self.text)
        self.assertIn('label.set_size(lid, size.small)', self.text)
        self.assertNotIn('name + "  " + str.tostring(price', self.text)

    def test_coach_has_full_and_collapsed_states(self):
        self.assertIn('input.bool(true, "Show Slumdawg coach"', self.text)
        self.assertIn('"SLUMDAWG  ▸"', self.text)

    def test_shorttitle_stays_within_platform_limit(self):
        self.assertIn('shorttitle = "SLUMDAWG"', self.text)


if __name__ == "__main__":
    unittest.main()
