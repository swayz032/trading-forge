from pathlib import Path
import unittest

PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_8_locked_trendlines.pine"


class PineV08LockedTrendlineContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_release_lock_and_clean_name(self):
        self.assertIn('indicator("Slumdawg traders indicator", shorttitle = "Slumdawg traders indicator"', self.src)
        self.assertIn('const string BUILD_CLASSIFICATION = "PLATFORM_PARITY_ONLY"', self.src)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)

    def test_operator_controls_explicit_recap_version(self):
        self.assertIn('int trendlineSet = input.int(1, "Trendline set"', self.src)
        self.assertIn('var int capturedTrendlineSet = na', self.src)
        self.assertIn('capturedTrendlineSet != trendlineSet', self.src)
        self.assertIn('capturedTrendlineSet := trendlineSet', self.src)

    def test_candidate_geometry_is_snapshotted_only_at_capture(self):
        self.assertIn('if barstate.islast and (na(capturedTrendlineSet) or capturedTrendlineSet != trendlineSet)', self.src)
        for token in (
            'dGT1 := dGT1C', 'dGP1 := dGP1C', 'dGT2 := dGT2C', 'dGP2 := dGP2C',
            'h4GT1 := h4GT1C', 'h1GT1 := h1GT1C', 'm15GT1 := m15GT1C', 'm5GT1 := m5GT1C',
        ):
            self.assertIn(token, self.src)
        self.assertIn('// Picker toggles only hide/show frozen lines; they never change A/B anchors.', self.src)

    def test_drawings_consume_frozen_not_candidate_anchors(self):
        self.assertIn('f_sync_trend(dGreenLine, dGreenValid, showDGreen, dGT1, dGP1, dGT2, dGP2, GREEN_UP)', self.src)
        self.assertNotIn('f_sync_trend(dGreenLine, dGreenCandidate, showDGreen, dGT1C, dGP1C', self.src)
        self.assertIn('float dGreenNow = dGreenValid ? f_line_at(dGT1, dGP1, dGT2, dGP2, projectionTime) : na', self.src)

    def test_all_picker_toggles_remain_available(self):
        for label in (
            'Daily GREEN', 'Daily RED', '4H GREEN', '4H RED', '1H GREEN', '1H RED',
            '15M GREEN', '15M RED', '5M GREEN', '5M RED',
        ):
            self.assertIn(f'"{label}"', self.src)

    def test_no_timeframe_names_are_drawn_on_rays(self):
        self.assertIn('f_sync_trend(line id, bool valid, bool visible, int t1, float p1, int t2, float p2, color c)', self.src)
        self.assertNotIn('label.set_text(lid, name)', self.src)
        self.assertNotIn('var label dGreenLabel', self.src)

    def test_structural_parent_rule_preserved(self):
        self.assertIn('Lower-timeframe close-up lines require a connected same-color bigger parent.', self.src)
        self.assertIn('m15GreenHasParent and m15GreenConnected', self.src)
        self.assertIn('m15RedHasParent and m15RedConnected', self.src)
        self.assertIn('m5GreenHasParent and m5GreenConnected', self.src)
        self.assertIn('m5RedHasParent and m5RedConnected', self.src)

    def test_full_width_blue_levels_preserved(self):
        self.assertIn('bool showPdh = dayValuesValid', self.src)
        self.assertIn('bool showPdl = dayValuesValid', self.src)
        self.assertIn('line.set_extend(id, fullSpan ? extend.both : extend.right)', self.src)

    def test_momentum_engine_stays_locked_and_present(self):
        self.assertIn('else if stage == WAIT_BREAK', self.src)
        self.assertIn('else if stage == BREAK_STAGE', self.src)
        self.assertIn('else if stage == PUSH_1', self.src)
        self.assertGreaterEqual(self.src.count('NON-ACTIONABLE parity event'), 4)


if __name__ == "__main__":
    unittest.main()
