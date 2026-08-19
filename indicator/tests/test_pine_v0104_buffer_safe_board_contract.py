from pathlib import Path
import unittest

PINE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_10_4_buffer_safe_board.pine"
SRC = PINE.read_text()


class PineV0104BufferSafeBoardContractTests(unittest.TestCase):
    def test_identity_and_non_actionable_lock(self):
        self.assertIn('shorttitle = "SLUMDAWG"', SRC)
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', SRC)

    def test_dynamic_offset_series_are_explicitly_sized(self):
        for series in ["time", "time_close", "low", "high"]:
            self.assertIn(f"max_bars_back({series}, SAFE_HISTORY_BUFFER)", SRC)

    def test_gate_sizes_buffers_inside_requested_context(self):
        gate = SRC.split("f_recent_clean_one", 1)[1].split("f_gate_pair_5m", 1)[0]
        self.assertIn("max_bars_back(time, SAFE_HISTORY_BUFFER)", gate)
        self.assertIn("max_bars_back(time_close, SAFE_HISTORY_BUFFER)", gate)
        self.assertIn("max_bars_back(low, SAFE_HISTORY_BUFFER)", gate)
        self.assertIn("max_bars_back(high, SAFE_HISTORY_BUFFER)", gate)

    def test_canonical_five_minute_board_remains(self):
        self.assertIn('Board board = request.security(syminfo.tickerid, "5"', SRC)
        for tf in ['"M"', '"W"', '"D"', '"240"', '"60"', '"15"']:
            self.assertIn(f'request.security(syminfo.tickerid, {tf}', SRC)

    def test_no_intersection_gate_remains(self):
        self.assertIn("bullish and low[k] < lp - tol", SRC)
        self.assertIn("not bullish and high[k] > lp + tol", SRC)

    def test_restored_completed_day_week_bridge_remains(self):
        self.assertIn("dailyCurrentCompletedNow", SRC)
        self.assertIn("weeklyCurrentCompletedNow", SRC)
        self.assertIn("dHighPrev", SRC)
        self.assertIn("wHighPrev", SRC)

    def test_coach_hide_toggle_remains(self):
        self.assertIn('showCoach = input.bool(true, "Show Slumdawg coach"', SRC)


if __name__ == "__main__":
    unittest.main()
