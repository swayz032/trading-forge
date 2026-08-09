from pathlib import Path
import unittest


PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_3_beginner_visual.pine"


class PineBeginnerVisualContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_pine_v6_and_live_block_remain(self):
        self.assertIn("//@version=6", self.src)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)

    def test_beginner_panel_is_large_and_plain_english(self):
        # Lock the actual user-visible numbered coach strings rather than searching
        # for an unnumbered quoted substring that is not a literal in the script.
        for token in (
            '"BIG beginner coach panel"',
            '"SLUMDAWG"',
            '"5M COACH"',
            '"OVERALL"',
            '"YELLOW ENTRY"',
            '"NOW"',
            '"1  WAIT FOR A CANDLE PAST YELLOW"',
            '"4  PUSH 1 — NOW WATCH PUSH 2"',
        ):
            self.assertIn(token, self.src)
        self.assertIn('text_size = 20', self.src)

    def test_chart_level_labels_are_large_and_named(self):
        for token in ('"PDH"', '"PDL"', '"PWH"', '"PWL"', '"YELLOW ENTRY"'):
            self.assertIn(token, self.src)
        self.assertIn('label.set_size(lb, size.large)', self.src)

    def test_old_stair_step_plots_are_hidden(self):
        for token in (
            'plot(pdh, "PDH data", display = display.none)',
            'plot(pdl, "PDL data", display = display.none)',
            'plot(pwh, "PWH data", display = display.none)',
            'plot(pwl, "PWL data", display = display.none)',
        ):
            self.assertIn(token, self.src)

    def test_beginner_color_key_exists(self):
        for token in (
            '"RED = OVERALL MARKET"',
            '"BLUE = MARKET MAP / LEVELS"',
            '"YELLOW = ENTRY / PROOF"',
            '"GREEN = ENTRY READY"',
        ):
            self.assertIn(token, self.src)

    def test_engineering_and_debug_are_hidden_by_default(self):
        self.assertIn('input.bool(false, "Engineering diagnostics"', self.src)
        self.assertIn('input.bool(false, "Tiny test markers"', self.src)

    def test_countertrend_is_visually_explicit(self):
        self.assertIn('" PULLBACK / COUNTERTREND"', self.src)

    def test_no_automatic_red_trendline_flip(self):
        for forbidden in ("trendlineBreakBullish", "trendlineBreakBearish", "priceCrossRedFlipsDirection"):
            self.assertNotIn(forbidden, self.src)

    def test_debug_alerts_remain_non_actionable(self):
        self.assertGreaterEqual(self.src.count("NON-ACTIONABLE parity event"), 4)


if __name__ == "__main__":
    unittest.main()
