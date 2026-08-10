from pathlib import Path
import re
import unittest

PINE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_10_2_runtime_hotfix.pine"
SRC = PINE.read_text()


class PineV0102RuntimeHotfixContractTests(unittest.TestCase):
    def test_shorttitle_is_within_tradingview_limit(self):
        match = re.search(r'shorttitle\s*=\s*"([^"]+)"', SRC)
        self.assertIsNotNone(match)
        self.assertLessEqual(len(match.group(1)), 10)
        self.assertEqual(match.group(1), "SLUMDAWG")

    def test_dynamic_history_has_explicit_safe_buffer(self):
        self.assertIn('max_bars_back = 925', SRC)
        self.assertIn('const int SAFE_HISTORY_BUFFER = 925', SRC)
        self.assertIn('const int FREEZE_PADDING = 320', SRC)

    def test_user_lookback_maxima_fit_declared_buffer(self):
        pairs = re.findall(r'input\.int\([^\n]*?maxval\s*=\s*(\d+)[^\n]*?structural bars', SRC)
        # regex order is not reliable with labels before maxval, so lock exact maxima too.
        for expected in [
            'Monthly structural bars", minval = 12, maxval = 120',
            'Weekly structural bars", minval = 20, maxval = 260',
            'Daily structural bars", minval = 30, maxval = 500',
            '4H structural bars", minval = 40, maxval = 600',
            '1H structural bars", minval = 60, maxval = 600',
            '15M structural bars", minval = 80, maxval = 600',
            '5M structural bars", minval = 100, maxval = 600',
        ]:
            self.assertIn(expected, SRC)
        self.assertLess(600 + 320, 925)

    def test_requested_contexts_stay_bounded(self):
        self.assertEqual(SRC.count('request.security('), 9)
        self.assertGreaterEqual(SRC.count('calc_bars_count ='), 10)
        self.assertIn('calc_bars_count = 1000', SRC)

    def test_geometry_rules_survive_hotfix(self):
        self.assertIn('low[i] < gExtreme', SRC)
        self.assertIn('high[i] > rExtreme', SRC)
        self.assertIn('bullish and low[k] < lp - tol', SRC)
        self.assertIn('not bullish and high[k] > lp + tol', SRC)
        self.assertIn('outAT := parentBT', SRC)
        self.assertIn('outAP := parentBP', SRC)
        self.assertGreaterEqual(SRC.count('xloc = xloc.bar_time'), 14)

    def test_coach_can_be_hidden(self):
        self.assertIn('showCoach = input.bool(true, "Show Slumdawg coach"', SRC)
        self.assertIn('if showCoach', SRC)

    def test_research_only_safety_lock(self):
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', SRC)
        self.assertIn('PLATFORM_PARITY_ONLY', SRC)


if __name__ == "__main__":
    unittest.main()
