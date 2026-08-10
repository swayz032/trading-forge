from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "fxr" / "slumdawg_entry_v0_1.fxr.js"


class FXREntryV01SourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")

    def test_fxr_lifecycle_and_main_panel_overlay(self):
        self.assertIn('//@version=1', self.text)
        self.assertIn('init = () => {', self.text)
        self.assertIn('onTick = (length, _moment, _, ta, inputs) => {', self.text)
        self.assertIn('indicator({ onMainPanel: true, format: "inherit" })', self.text)

    def test_single_documented_mtf_request_is_15m(self):
        self.assertEqual(self.text.count('mtf.timeframe('), 2)  # one comment + one executable call
        self.assertIn('mtf.timeframe("15")', self.text)

    def test_confirmed_two_left_two_right_pivots(self):
        self.assertIn('const PIVOT_LEFT = 2;', self.text)
        self.assertIn('const PIVOT_RIGHT = 2;', self.text)
        self.assertIn('h > n1 && h > n2 && h > o1 && h > o2', self.text)
        self.assertIn('l < n1 && l < n2 && l < o1 && l < o2', self.text)

    def test_outer_structural_not_nearest_selection(self):
        self.assertIn('Math.max(outerHigh, h)', self.text)
        self.assertIn('Math.min(outerLow, l)', self.text)
        self.assertIn('input.int("Swing Memory", 8', self.text)

    def test_both_yellow_bands_are_drawn(self):
        self.assertIn('band.line("LONG ENTRY"', self.text)
        self.assertIn('band.line("SHORT ENTRY"', self.text)
        self.assertGreaterEqual(self.text.count('"#FFBE19"'), 2)
        self.assertGreaterEqual(self.text.count(', 0, 3, true)'), 2)

    def test_directional_tick_rounding(self):
        self.assertIn('Math.ceil((p - 1e-10) / TICK) * TICK', self.text)
        self.assertIn('Math.floor((p + 1e-10) / TICK) * TICK', self.text)

    def test_does_not_fake_daily_weekly_parity(self):
        self.assertIn("does NOT implement PDH/PDL/PWH/PWL", self.text)
        self.assertNotIn('mtf.timeframe("1D")', self.text)
        self.assertNotIn('mtf.timeframe("1W")', self.text)


if __name__ == "__main__":
    unittest.main()
