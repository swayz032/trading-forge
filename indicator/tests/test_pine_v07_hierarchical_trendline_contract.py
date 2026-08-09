from pathlib import Path
import unittest

PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_7_hierarchical_trendlines.pine"


class PineV07HierarchicalTrendlineContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_clean_indicator_name_and_release_lock(self):
        self.assertIn('indicator("Slumdawg traders indicator", shorttitle = "Slumdawg traders indicator"', self.src)
        self.assertIn('const string BUILD_CLASSIFICATION = "PLATFORM_PARITY_ONLY"', self.src)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)

    def test_all_ten_picker_toggles_default_on(self):
        for token in (
            'bool showDGreen = input.bool(true, "Daily GREEN"',
            'bool showDRed = input.bool(true, "Daily RED"',
            'bool show4HGreen = input.bool(true, "4H GREEN"',
            'bool show4HRed = input.bool(true, "4H RED"',
            'bool show1HGreen = input.bool(true, "1H GREEN"',
            'bool show1HRed = input.bool(true, "1H RED"',
            'bool show15MGreen = input.bool(true, "15M GREEN"',
            'bool show15MRed = input.bool(true, "15M RED"',
            'bool show5MGreen = input.bool(true, "5M GREEN"',
            'bool show5MRed = input.bool(true, "5M RED"',
        ):
            self.assertIn(token, self.src)
        self.assertNotIn('trendlineVisibleCount', self.src)
        self.assertNotIn('array.sort_indices(tlDistances', self.src)

    def test_chart_trendline_names_removed(self):
        self.assertIn('f_sync_trend(line id, bool valid, bool visible', self.src)
        self.assertNotIn('var label dGreenLabel', self.src)
        self.assertNotIn('var label m5RedLabel', self.src)
        self.assertNotIn('label.set_text(lid, name)', self.src)

    def test_widest_clean_pair_is_preferred_over_latest_pair(self):
        self.assertIn('bool g30 = g30Base', self.src)
        self.assertIn('bool g20 = g20Base', self.src)
        self.assertIn('bool g10 =', self.src)
        self.assertIn('int gT1 = g30 ? gt3 : g20 ? gt2 : g10 ? gt1 : na', self.src)
        self.assertIn('bool r30 = r30Base', self.src)
        self.assertIn('int rT1 = r30 ? rt3 : r20 ? rt2 : r10 ? rt1 : na', self.src)

    def test_close_up_lines_require_bigger_parent_connection(self):
        self.assertIn('f_anchor_connects(', self.src)
        self.assertIn('math.abs(py1 - cp1) <= syminfo.mintick', self.src)
        self.assertIn('15M and 5M are never allowed to become standalone close-up roots.', self.src)
        self.assertIn('m15GreenHasParent and m15GreenConnected', self.src)
        self.assertIn('m15RedHasParent and m15RedConnected', self.src)
        self.assertIn('m5GreenHasParent and m5GreenConnected', self.src)
        self.assertIn('m5RedHasParent and m5RedConnected', self.src)

    def test_picker_is_display_only_not_logic_deletion(self):
        self.assertIn('// All qualified trendlines are available. Picker inputs only control chart display.', self.src)
        self.assertIn('f_add_wall(dRedValid and dRedNow > close', self.src)
        self.assertNotIn('showDRed and dRedValid and dRedNow > close', self.src)

    def test_blue_level_contract_preserved(self):
        self.assertIn('bool showPdh = dayValuesValid', self.src)
        self.assertIn('bool showPdl = dayValuesValid', self.src)
        self.assertIn('line.set_extend(id, fullSpan ? extend.both : extend.right)', self.src)
        self.assertIn('math.abs(pwh - close) <= dailyVisualEnvelope', self.src)
        self.assertIn('math.abs(pwl - close) <= dailyVisualEnvelope', self.src)

    def test_trendline_cross_still_not_direction_or_entry_trigger(self):
        self.assertIn('A trendline cross never flips BIG DIRECTION or creates an entry.', self.src)
        self.assertNotIn('trendlineBreakBullish', self.src)
        self.assertNotIn('priceCrossRedFlipsDirection', self.src)
        self.assertNotIn('priceCrossGreenFlipsDirection', self.src)

    def test_existing_state_machine_stays_present(self):
        self.assertIn('else if stage == WAIT_BREAK', self.src)
        self.assertIn('else if stage == BREAK_STAGE', self.src)
        self.assertIn('else if stage == PUSH_1', self.src)
        self.assertGreaterEqual(self.src.count('NON-ACTIONABLE parity event'), 4)


if __name__ == "__main__":
    unittest.main()
