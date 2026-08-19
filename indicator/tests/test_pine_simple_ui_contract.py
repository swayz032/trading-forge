from pathlib import Path
import unittest


PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_2_simple_ui.pine"


class PineSimpleUiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_is_pine_v6(self):
        self.assertIn("//@version=6", self.src)

    def test_live_approval_remains_hardcoded_false(self):
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)

    def test_parity_engine_defaults_off(self):
        self.assertIn('input.bool(false, "Enable parity engine"', self.src)

    def test_engineering_panel_defaults_hidden(self):
        self.assertIn('input.bool(false, "Show engineering diagnostics"', self.src)

    def test_debug_markers_default_hidden(self):
        self.assertIn('input.bool(false, "Show parity transition markers"', self.src)

    def test_current_levels_are_human_labeled(self):
        for token in ('"PDH"', '"PDL"', '"PWH"', '"PWL"', '"YELLOW ENTRY / PROOF"'):
            self.assertIn(token, self.src)

    def test_historical_htf_plots_are_hidden(self):
        for token in ('plot(pdh, "PDH data", display = display.none)',
                      'plot(pdl, "PDL data", display = display.none)',
                      'plot(pwh, "PWH data", display = display.none)',
                      'plot(pwl, "PWL data", display = display.none)'):
            self.assertIn(token, self.src)

    def test_simple_panel_uses_plain_language(self):
        for token in ('"YELLOW ENTRY"', '"WAITING FOR BREAK"', '"PUSH 1 — WATCH PUSH 2"', '"SET YELLOW ENTRY"'):
            self.assertIn(token, self.src)

    def test_tick_mismatch_is_diagnostic_not_silently_waived(self):
        self.assertIn('bool tickGridExpected = syminfo.mintick == EXPECTED_TICK', self.src)
        self.assertIn('"PLATFORM TICK"', self.src)
        self.assertIn('"EXPECTED TICK"', self.src)
        self.assertIn('"TICK METADATA MISMATCH"', self.src)

    def test_debug_alerts_remain_non_actionable(self):
        self.assertGreaterEqual(self.src.count("NON-ACTIONABLE parity event"), 4)

    def test_trendline_cross_autoflip_is_not_introduced(self):
        forbidden = (
            "trendlineBreakBullish",
            "trendlineBreakBearish",
            "priceCrossRedFlipsDirection",
        )
        for token in forbidden:
            self.assertNotIn(token, self.src)


if __name__ == "__main__":
    unittest.main()
