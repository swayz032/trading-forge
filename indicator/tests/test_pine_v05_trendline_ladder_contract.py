from pathlib import Path
import unittest

PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_5_trendline_ladder.pine"


class PineV05TrendlineLadderContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_release_safety_stays_hard_locked(self):
        self.assertIn("//@version=6", self.src)
        self.assertIn('const string BUILD_CLASSIFICATION = "PLATFORM_PARITY_ONLY"', self.src)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)

    def test_pdh_pdl_are_always_visible_when_valid(self):
        self.assertIn('bool showPdh = dayValuesValid', self.src)
        self.assertIn('bool showPdl = dayValuesValid', self.src)
        self.assertNotIn('dwVisibleCount', self.src)

    def test_weekly_levels_use_adaptive_visual_near_rule(self):
        self.assertIn('bool showWeeklyWhenNear = input.bool(true, "Show PWH/PWL when near"', self.src)
        self.assertIn('float dailyVisualEnvelope = dayValuesValid ? math.max(math.abs(pdh - close), math.abs(pdl - close)) : na', self.src)
        self.assertIn('math.abs(pwh - close) <= dailyVisualEnvelope', self.src)
        self.assertIn('math.abs(pwl - close) <= dailyVisualEnvelope', self.src)
        self.assertNotIn('weeklyNearPoints', self.src)
        self.assertNotIn('weeklyNearAtr', self.src)

    def test_top_down_green_red_ladder_exists(self):
        for token in (
            '"3A — DAILY TRENDLINES"',
            '"3B — 4H TRENDLINES"',
            '"3C — 1H TRENDLINES"',
            '"3D — 15M TRENDLINES"',
            '"3E — 5M TRENDLINES"',
            '"GREEN bullish"',
            '"RED bearish"',
        ):
            self.assertIn(token, self.src)

    def test_anchor_pairs_use_time_and_price_inputs(self):
        for prefix in ('dGreen', 'dRed', 'h4Green', 'h4Red', 'h1Green', 'h1Red', 'm15Green', 'm15Red', 'm5Green', 'm5Red'):
            self.assertIn(f'int {prefix}T1 = input.time(', self.src)
            self.assertIn(f'float {prefix}P1 = input.price(', self.src)
            self.assertIn(f'int {prefix}T2 = input.time(', self.src)
            self.assertIn(f'float {prefix}P2 = input.price(', self.src)
        self.assertIn('xloc = xloc.bar_time, extend = extend.right', self.src)

    def test_invalid_or_hidden_price_geometry_is_na_not_zero(self):
        self.assertIn('line.set_xy1(id, na, na)', self.src)
        self.assertIn('line.set_xy2(id, na, na)', self.src)
        self.assertIn('label.set_xy(lid, na, na)', self.src)

    def test_trendline_display_is_relevance_limited(self):
        self.assertIn('int trendlineVisibleCount = input.int(2, "Trendlines prominent"', self.src)
        self.assertIn('array.sort_indices(tlDistances, order.ascending)', self.src)
        self.assertIn('f_tl_rank_visible(idx) or nextWallTlIndex == idx', self.src)

    def test_next_wall_scans_opposing_trendline_direction(self):
        self.assertIn('if planSide == "LONG"', self.src)
        self.assertIn('if dRedValid and dRedNow > close', self.src)
        self.assertIn('if h4RedValid and h4RedNow > close', self.src)
        self.assertIn('if planSide == "LONG"', self.src)
        self.assertIn('if dGreenValid and dGreenNow < close', self.src)
        self.assertIn('if h4GreenValid and h4GreenNow < close', self.src)
        self.assertIn('string nextWallText = na(nextWallPrice) ? nextWallName', self.src)

    def test_trendline_cross_is_not_entry_or_direction_flip(self):
        self.assertNotIn('trendlineBreakBullish', self.src)
        self.assertNotIn('priceCrossRedFlipsDirection', self.src)
        self.assertNotIn('priceCrossGreenFlipsDirection', self.src)
        self.assertIn('A trendline cross NEVER flips BIG DIRECTION and NEVER creates GO or READY.', self.src)

    def test_five_minute_state_chain_is_preserved(self):
        self.assertIn('else if stage == WAIT_BREAK', self.src)
        self.assertIn('else if stage == BREAK_STAGE', self.src)
        self.assertIn('else if stage == PUSH_1', self.src)
        self.assertGreaterEqual(self.src.count('NON-ACTIONABLE parity event'), 4)


if __name__ == "__main__":
    unittest.main()
