import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PINE = ROOT / "indicator" / "pine" / "slumdawg_platform_parity_v0_12_stable_5m_board.pine"


class PineV012Stable5mBoardContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_key_levels_are_not_5m_gated(self):
        self.assertIn("bool showPdh = dayValuesValid", self.src)
        self.assertIn("bool showPdl = dayValuesValid", self.src)
        self.assertNotIn("bool showPdh = isFiveMinute", self.src)
        self.assertNotIn("bool showPdl = isFiveMinute", self.src)

    def test_restored_completed_day_week_bridge(self):
        self.assertIn("dailyCurrentCompletedNow", self.src)
        self.assertIn("weeklyCurrentCompletedNow", self.src)
        self.assertIn("float pdh = dailyCurrentCompletedNow ? dHighCurrent : dHighPrev", self.src)
        self.assertIn("float pwh = weeklyCurrentCompletedNow ? wHighCurrent : wHighPrev", self.src)

    def test_trendlines_are_5m_render_only(self):
        self.assertIn("if isFiveMinute and valid and visible", self.src)
        self.assertIn('"KEY LEVELS ACTIVE | TL ON 5M"', self.src)

    def test_old_runtime_gate_is_gone(self):
        self.assertNotIn("f_gate_pair_5m", self.src)
        self.assertNotIn("f_recent_clean_one", self.src)

    def test_snapshot_uses_confirmed_source_history(self):
        self.assertGreaterEqual(self.src.count("int baseOff = 1"), 2)
        self.assertIn('request.security(syminfo.tickerid, "M"', self.src)
        self.assertIn("lookahead = barmerge.lookahead_on", self.src)

    def test_full_timeframe_board_present(self):
        for marker in ("Monthly GREEN", "Weekly GREEN", "Daily GREEN", "4H GREEN", "1H GREEN", "15M GREEN", "5M GREEN"):
            self.assertIn(marker, self.src)
        for marker in ("Monthly RED", "Weekly RED", "Daily RED", "4H RED", "1H RED", "15M RED", "5M RED"):
            self.assertIn(marker, self.src)


if __name__ == "__main__":
    unittest.main()
