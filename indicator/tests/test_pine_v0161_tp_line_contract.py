import unittest
from pathlib import Path


PINE = Path("indicator/pine/slumdawg_platform_parity_v0_16_1_tp_lines_near_side.pine")


class PineV0161TargetLineContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_entry_selector_contract_is_retained(self):
        self.assertIn('ENTRY_SWING_MEMORY = 8', self.src)
        self.assertIn('request.security(syminfo.tickerid, "15", f_outer_entry_pair_15m()', self.src)
        self.assertIn('🟢 LONG - ENTRY ZONE', self.src)
        self.assertIn('🔴 SHORT - ENTRY ZONE', self.src)

    def test_take_profit_is_rendered_as_lines_not_boxes(self):
        self.assertIn('var line longTp1Line', self.src)
        self.assertIn('var line shortTp1Line', self.src)
        self.assertIn('🎯 TAKE PROFIT ZONE 1', self.src)
        self.assertNotIn('f_sync_tp_box', self.src)
        self.assertNotIn('var box longTp1Box', self.src)

    def test_long_target_uses_near_lower_edge_not_far_wick(self):
        self.assertIn('longTp1Set ? f_round_down_tick(longTp1Lo) : na', self.src)
        self.assertNotIn('longTp1Set ? f_round_down_tick(longTp1Hi)', self.src)

    def test_short_target_uses_near_upper_edge_not_far_wick(self):
        self.assertIn('shortTp1Set ? f_round_up_tick(shortTp1Hi) : na', self.src)
        self.assertNotIn('shortTp1Set ? f_round_up_tick(shortTp1Lo)', self.src)

    def test_original_panel_palette_is_restored_with_new_header(self):
        self.assertIn('🤖 SLUMDAWG TRADERS', self.src)
        self.assertIn('PANEL_DARK = color.rgb(18, 20, 25)', self.src)
        self.assertIn('PANEL_MID = color.rgb(37, 41, 49)', self.src)
        self.assertIn('GOLD_ACCENT = color.rgb(205, 165, 70)', self.src)
        self.assertIn('bgcolor = YELLOW_GO', self.src)
        self.assertIn('bgcolor = BLUE_TARGET', self.src)
        self.assertIn('bgcolor = ORANGE_WAIT', self.src)


if __name__ == "__main__":
    unittest.main()
