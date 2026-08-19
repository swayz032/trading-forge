from pathlib import Path
import re
import unittest

PINE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_10_1_fast_geometry.pine"
SRC = PINE.read_text()


class PineV0101FastGeometryContractTests(unittest.TestCase):
    def test_identity_safety_and_coach_toggle(self):
        self.assertIn('indicator("Slumdawg traders indicator"', SRC)
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', SRC)
        self.assertIn('showCoach = input.bool(true, "Show Slumdawg coach"', SRC)

    def test_host_and_request_history_are_bounded(self):
        self.assertIn('calc_bars_count = 1600', SRC)
        self.assertEqual(SRC.count('request.security('), 9)
        self.assertGreaterEqual(SRC.count('calc_bars_count ='), 10)

    def test_heavy_geometry_is_last_bar_gated(self):
        root = SRC.split('f_root_pair_fast', 1)[1].split('f_family_pair_fast', 1)[0]
        family = SRC.split('f_family_pair_fast', 1)[1].split('// -----------------------------------------------------------------------------\n// TOP-DOWN FAMILY', 1)[0] if '// -----------------------------------------------------------------------------\n// TOP-DOWN FAMILY' in SRC else SRC.split('f_family_pair_fast', 1)[1].split('[mGV,', 1)[0]
        self.assertIn('if barstate.islast and freezeTs > 0', root)
        self.assertIn('if barstate.islast and freezeTs > 0', family)

    def test_candidate_search_is_explicitly_capped(self):
        self.assertIn('const int MAX_B_CANDIDATES = 12', SRC)
        self.assertGreaterEqual(SRC.count('tested >= MAX_B_CANDIDATES'), 2)

    def test_full_candle_intersection_guard_remains(self):
        self.assertIn('bullish and low[k] < lp - tol', SRC)
        self.assertIn('not bullish and high[k] > lp + tol', SRC)

    def test_root_uses_true_window_extreme(self):
        self.assertIn('low[i] < gExtreme', SRC)
        self.assertIn('high[i] > rExtreme', SRC)

    def test_full_monthly_to_five_minute_chain_present(self):
        for tf in ['"M"', '"W"', '"D"', '"240"', '"60"', '"15"', '"5"']:
            self.assertRegex(SRC, rf'request\.security\(syminfo\.tickerid, {tf},')

    def test_child_line_inherits_parent_b(self):
        self.assertIn('outAT := parentBT', SRC)
        self.assertIn('outAP := parentBP', SRC)

    def test_time_price_rendering_is_cross_timeframe_safe(self):
        self.assertGreaterEqual(SRC.count('xloc = xloc.bar_time'), 14)
        self.assertIn('scale = scale.none', SRC)

    def test_old_unbounded_v010_snapshot_engine_not_present(self):
        self.assertNotIn('ta.valuewhen(sourceStartedByFreeze', SRC)
        self.assertNotIn('f_root_candidate(', SRC)
        self.assertNotIn('f_child_candidate(', SRC)


if __name__ == "__main__":
    unittest.main()
