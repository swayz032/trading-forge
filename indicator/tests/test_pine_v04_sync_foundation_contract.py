from pathlib import Path
import unittest

PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_4_sync_foundation.pine"

class PineV04SyncFoundationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_release_safety_is_hard_locked(self):
        self.assertIn("//@version=6", self.src)
        self.assertIn('const string BUILD_CLASSIFICATION = "PLATFORM_PARITY_ONLY"', self.src)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)

    def test_beginner_language_is_frozen(self):
        for token in (
            '"BIG DIRECTION"',
            '"CURRENT MOVE"',
            '"NEXT WALL"',
            '"GO LINE"',
            '"SAFE TARGET"',
            '"NOW"',
            '"SYSTEM"',
        ):
            self.assertIn(token, self.src)

    def test_unknown_direction_cannot_be_called_with_trend(self):
        self.assertIn('bool directionKnown = bigDirection != "NOT SET"', self.src)
        self.assertIn('not directionKnown ? "WAITING FOR DIRECTION"', self.src)

    def test_chart_timeframe_is_exposed(self):
        self.assertIn('string chartTfText = timeframe.period', self.src)
        self.assertIn('" — USE 5 MIN"', self.src)
        self.assertIn('not isFiveMinute ? "CHANGE CHART TO 5 MIN"', self.src)

    def test_no_zero_sentinel_is_left_on_hidden_price_drawings(self):
        self.assertIn('line.set_xy1(id, na, na)', self.src)
        self.assertIn('line.set_xy2(id, na, na)', self.src)
        self.assertIn('label.set_xy(lid, na, na)', self.src)
        self.assertNotIn('f_sync_level(goDraw, goLabel, 0.0', self.src)
        self.assertNotIn('color.new(c, 100)', self.src)

    def test_dw_visuals_are_relevance_limited_without_changing_values(self):
        self.assertIn('int dwVisibleCount = input.int(2, "D/W lines on chart"', self.src)
        self.assertIn('array.sort_indices(levelDistances, order.ascending)', self.src)
        for token in ('plot(pdh, "PDH data", display = display.none)',
                      'plot(pdl, "PDL data", display = display.none)',
                      'plot(pwh, "PWH data", display = display.none)',
                      'plot(pwl, "PWL data", display = display.none)'):
            self.assertIn(token, self.src)

    def test_closed_gap_dw_bridge_is_explicit_and_bounded(self):
        self.assertIn('const int NORMAL_CLOSED_GAP_MS = 72 * 60 * 60 * 1000', self.src)
        self.assertIn('bool dailyCurrentCompletedNow = recentClosedGap', self.src)
        self.assertIn('bool weeklyCurrentCompletedNow = recentClosedGap', self.src)
        self.assertIn('"EXTENDED CLOSE — D/W VERIFY"', self.src)
        self.assertIn('"EXTENDED CLOSE — VERIFY LEVELS"', self.src)

    def test_prior_confirmed_dw_requests_remain_present(self):
        self.assertIn('[high[1], low[1]], lookahead = barmerge.lookahead_on', self.src)
        self.assertIn('"D"', self.src)
        self.assertIn('"W"', self.src)

    def test_target_zone_is_manual_and_not_overclaimed(self):
        self.assertIn('float safeTargetLow = input.price(0.0', self.src)
        self.assertIn('float safeTargetHigh = input.price(0.0', self.src)
        self.assertIn('string nextWallText = "NOT LOADED — TRENDLINE LADDER NEXT"', self.src)
        self.assertIn('Automatic selection is not certified yet', self.src)

    def test_engineering_is_hidden_by_default(self):
        self.assertIn('input.bool(false, "Engineering diagnostics"', self.src)
        self.assertIn('input.bool(false, "Tiny parity markers"', self.src)

    def test_state_chain_remains_one_stage_per_update(self):
        self.assertIn('else if stage == WAIT_BREAK', self.src)
        self.assertIn('else if stage == BREAK_STAGE', self.src)
        self.assertIn('else if stage == PUSH_1', self.src)
        self.assertNotIn('trendlineBreakBullish', self.src)
        self.assertNotIn('priceCrossRedFlipsDirection', self.src)

    def test_debug_alerts_are_non_actionable(self):
        self.assertGreaterEqual(self.src.count("NON-ACTIONABLE parity event"), 4)

if __name__ == "__main__":
    unittest.main()
