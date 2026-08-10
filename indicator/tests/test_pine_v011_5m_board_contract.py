from pathlib import Path
import unittest

PINE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_11_5m_board.pine"
SRC = PINE.read_text()


class PineV011FiveMinuteBoardContractTests(unittest.TestCase):
    def test_identity_and_non_live_lock(self):
        self.assertIn('shorttitle = "SLUMDAWG"', SRC)
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', SRC)

    def test_five_minute_is_only_supported_view(self):
        self.assertIn('bool isFiveMinute = timeframe.isminutes and timeframe.multiplier == 5', SRC)
        self.assertIn('"SWITCH TO 5 MIN"', SRC)
        self.assertIn('if isFiveMinute and valid and visible', SRC)

    def test_no_nested_canonical_5m_gate(self):
        self.assertNotIn('f_gate_pair_5m', SRC)
        self.assertNotIn('f_recent_clean_one', SRC)
        self.assertNotIn('Board board = request.security', SRC)
        self.assertNotIn('request.security_lower_tf', SRC)

    def test_snapshot_is_event_driven_not_current_bar_backscan(self):
        self.assertIn('f_freeze_event', SRC)
        self.assertIn('time <= freezeTs and time_close >= freezeTs', SRC)
        self.assertIn('ta.valuewhen(event, gAT0, 0)', SRC)
        self.assertIn('ta.valuewhen(event, rAT0, 0)', SRC)

    def test_full_top_down_chain_is_present(self):
        for tf in ['"M"', '"W"', '"D"', '"240"', '"60"', '"15"']:
            self.assertIn(f'request.security(syminfo.tickerid, {tf},', SRC)
        self.assertIn('[m5GV, m5GAT, m5GAP, m5GBT, m5GBP, m5RV, m5RAT, m5RAP, m5RBT, m5RBP] = f_family_snapshot', SRC)

    def test_root_extremes_and_parent_b_inheritance_remain(self):
        self.assertIn('low[i] < gExtreme', SRC)
        self.assertIn('high[i] > rExtreme', SRC)
        self.assertIn('outAT := parentBT', SRC)
        self.assertIn('outAP := parentBP', SRC)

    def test_fresh_ray_uses_full_source_candle_envelope(self):
        self.assertIn('f_ray_clean_envelope', SRC)
        self.assertIn('low[k] < math.max(lineOpen, lineClose) - tol', SRC)
        self.assertIn('high[k] > math.min(lineOpen, lineClose) + tol', SRC)

    def test_working_daily_weekly_bridge_is_restored(self):
        self.assertIn('[dHighCurrent, dLowCurrent, dCloseTimeCurrent]', SRC)
        self.assertIn('[dHighPrev, dLowPrev]', SRC)
        self.assertIn('[wHighCurrent, wLowCurrent, wCloseTimeCurrent]', SRC)
        self.assertIn('[wHighPrev, wLowPrev]', SRC)
        self.assertIn('dailyCurrentCompletedNow', SRC)
        self.assertIn('weeklyCurrentCompletedNow', SRC)

    def test_coach_can_hide_without_changing_board(self):
        self.assertIn('showCoach = input.bool(true, "Show Slumdawg coach"', SRC)
        self.assertIn('if showCoach', SRC)


if __name__ == "__main__":
    unittest.main()
