from pathlib import Path
import unittest


SOURCE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_12_1_price_scale_recovery.pine"


class PineV0121PriceScaleRecoveryContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")

    def test_overlay_uses_host_chart_price_scale(self):
        declaration = self.text.splitlines()[1]
        self.assertIn("overlay = true", declaration)
        self.assertNotIn("scale =", declaration)
        self.assertNotIn("scale.none", declaration)

    def test_key_levels_are_not_gated_to_5m(self):
        self.assertIn("bool showPdh = dayValuesValid", self.text)
        self.assertIn("bool showPdl = dayValuesValid", self.text)
        self.assertNotIn("bool showPdh = isFiveMinute", self.text)
        self.assertNotIn("bool showPdl = isFiveMinute", self.text)

    def test_trendline_drawings_remain_5m_only(self):
        self.assertIn("if isFiveMinute and valid and visible", self.text)

    def test_coach_hide_toggle_remains(self):
        self.assertIn('input.bool(true, "Show Slumdawg coach"', self.text)


if __name__ == "__main__":
    unittest.main()
