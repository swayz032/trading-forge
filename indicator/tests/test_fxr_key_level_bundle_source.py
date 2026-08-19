from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1] / "fxr"
DAILY = ROOT / "slumdawg_daily_levels_v0_1.fxr.js"
WEEKLY = ROOT / "slumdawg_weekly_levels_v0_1.fxr.js"


class FXRKeyLevelBundleSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.daily = DAILY.read_text(encoding="utf-8")
        cls.weekly = WEEKLY.read_text(encoding="utf-8")

    def test_daily_uses_one_native_daily_mtf_request(self):
        self.assertIn('mtf.timeframe("1D")', self.daily)
        self.assertIn('const pdh = mtf.high(1, false);', self.daily)
        self.assertIn('const pdl = mtf.low(1, false);', self.daily)
        self.assertIn('band.line("PDH"', self.daily)
        self.assertIn('band.line("PDL"', self.daily)
        self.assertNotIn('mtf.timeframe("15")', self.daily)
        self.assertNotIn('mtf.timeframe("1W")', self.daily)

    def test_weekly_uses_one_native_weekly_mtf_request(self):
        self.assertIn('mtf.timeframe("1W")', self.weekly)
        self.assertIn('const pwh = mtf.high(1, false);', self.weekly)
        self.assertIn('const pwl = mtf.low(1, false);', self.weekly)
        self.assertIn('band.line("PWH"', self.weekly)
        self.assertIn('band.line("PWL"', self.weekly)
        self.assertNotIn('mtf.timeframe("15")', self.weekly)
        self.assertNotIn('mtf.timeframe("1D")', self.weekly)

    def test_both_helpers_use_completed_step_values(self):
        self.assertGreaterEqual(self.daily.count(', false)'), 2)
        self.assertGreaterEqual(self.weekly.count(', false)'), 2)


if __name__ == "__main__":
    unittest.main()
