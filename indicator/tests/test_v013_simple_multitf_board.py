from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
PINE = ROOT / "indicator" / "pine" / "slumdawg_platform_parity_v0_13_simple_multitf_board.pine"


class V013SimpleMultiTfBoardContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_price_scale_recovery_is_preserved(self):
        self.assertIn('shorttitle = "SLUMDAWG"', self.src)
        self.assertIn("overlay = true", self.src)
        self.assertNotIn("scale = scale.none", self.src)

    def test_key_levels_are_not_5m_gated(self):
        self.assertIn("bool showPdh = dayValuesValid", self.src)
        self.assertIn("bool showPdl = dayValuesValid", self.src)
        self.assertNotIn("showPdh = isFiveMinute", self.src)
        self.assertNotIn("showPdl = isFiveMinute", self.src)

    def test_all_seven_source_timeframes_exist(self):
        for tf in ['"M"', '"W"', '"D"', '"240"', '"60"', '"15"']:
            self.assertIn(f"request.security(syminfo.tickerid, {tf}", self.src)
        self.assertIn("m5Lookback", self.src)

    def test_trendline_renderer_is_5m_only(self):
        self.assertIn("if isFiveMinute and valid and visible", self.src)
        self.assertIn('"KEY LEVELS ACTIVE | TL ON 5M"', self.src)

    def test_extreme_roots_and_violation_state_are_separate(self):
        self.assertIn("float aP = bullish ? 1e20 : -1e20", self.src)
        self.assertIn("f_clean_between", self.src)
        self.assertIn("f_violated_after", self.src)
        self.assertIn("line.style_dashed", self.src)

    def test_parent_chain_is_deliberately_absent_from_baseline(self):
        self.assertNotIn("f_family_snapshot", self.src)
        self.assertNotIn("parentValid", self.src)

    def test_coach_can_be_hidden(self):
        self.assertIn('input.bool(true, "Show Slumdawg coach"', self.src)
        self.assertIn("if showCoach", self.src)


if __name__ == "__main__":
    unittest.main()
