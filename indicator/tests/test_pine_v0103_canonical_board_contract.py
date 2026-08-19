from pathlib import Path
import re
import unittest

PINE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_10_3_canonical_board.pine"
SRC = PINE.read_text()


class PineV0103CanonicalBoardContractTests(unittest.TestCase):
    def test_shorttitle_and_safety(self):
        self.assertIn('shorttitle = "SLUMDAWG"', SRC)
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', SRC)

    def test_one_canonical_five_minute_host_bridge(self):
        self.assertIn('Board board = request.security(syminfo.tickerid, "5", f_build_board(', SRC)
        self.assertIn('calc_bars_count = SAFE_HISTORY_BUFFER', SRC)
        self.assertIn('dynamic_requests = true', SRC)

    def test_restores_closed_gap_daily_weekly_bridge(self):
        for token in (
            'dHighCurrent', 'dHighPrev', 'wHighCurrent', 'wHighPrev',
            'dailyCurrentCompletedNow', 'weeklyCurrentCompletedNow',
            'NORMAL_CLOSED_GAP_MS',
        ):
            self.assertIn(token, SRC)
        self.assertIn('float pdh0 = dailyCurrentCompletedNow ? dHighCurrent : dHighPrev', SRC)
        self.assertIn('float pwh0 = weeklyCurrentCompletedNow ? wHighCurrent : wHighPrev', SRC)

    def test_daily_levels_are_full_width_and_time_anchored(self):
        self.assertIn('xloc = xloc.bar_time, extend = extend.both', SRC)
        self.assertIn('line.set_extend(id, extend.both)', SRC)
        self.assertIn('label.set_xy(lid, time_close, price)', SRC)

    def test_full_monthly_to_five_minute_family_is_inside_canonical_engine(self):
        for tf in ['"M"', '"W"', '"D"', '"240"', '"60"', '"15"']:
            self.assertRegex(SRC, rf'request\.security\(syminfo\.tickerid, {tf},')
        self.assertIn('TlPair m5Raw = f_family_pair_fast(', SRC)

    def test_parent_b_to_child_a_contract_survives(self):
        self.assertIn('outAT := parentBT', SRC)
        self.assertIn('outAP := parentBP', SRC)

    def test_recent_five_minute_intersection_gate_exists(self):
        self.assertIn('RECENT_5M_AUDIT_BARS = 600', SRC)
        self.assertIn('f_recent_clean_one', SRC)
        self.assertIn('bullish and low[k] < lp - tol', SRC)
        self.assertIn('not bullish and high[k] > lp + tol', SRC)
        self.assertGreaterEqual(SRC.count('f_gate_pair_5m('), 8)

    def test_visibility_controls_do_not_change_geometry(self):
        self.assertIn('showCoach = input.bool(true, "Show Slumdawg coach"', SRC)
        for tf in ('Monthly', 'Weekly', 'Daily', '4H', '1H', '15M', '5M'):
            self.assertIn(f'"{tf} GREEN"', SRC)
            self.assertIn(f'"{tf} RED"', SRC)

    def test_trend_drawings_use_time_price_anchors(self):
        self.assertGreaterEqual(SRC.count('xloc = xloc.bar_time, extend = extend.right'), 15)
        self.assertIn('line.set_xy1(id, aT, aP)', SRC)
        self.assertIn('line.set_xy2(id, bT, bP)', SRC)


if __name__ == "__main__":
    unittest.main()
