from pathlib import Path
import unittest

PINE = Path(__file__).resolve().parents[1] / "pine" / "slumdawg_platform_parity_v0_6_auto_trendlines.pine"


class PineV06AutoTrendlineUiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_indicator_name_is_clean_and_exact(self):
        self.assertIn('indicator("Slumdawg traders indicator", shorttitle = "Slumdawg traders indicator"', self.src)
        self.assertNotIn('Slumdawg v0.5.1', self.src)

    def test_user_inputs_do_not_spam_status_line(self):
        for token in (
            'input.string("NOT SET", "BIG DIRECTION"',
            'input.string("LONG", "PLAN"',
            'input.price(0.0, "GO LINE (yellow)"',
            'input.bool(true, "Auto GREEN/RED trendline suggestions"',
        ):
            start = self.src.index(token)
            snippet = self.src[start:start + 420]
            self.assertIn('display = display.none', snippet)

    def test_auto_trendlines_default_on_and_use_confirmed_pivots(self):
        self.assertIn('bool autoTrendlines = input.bool(true, "Auto GREEN/RED trendline suggestions"', self.src)
        self.assertIn('ta.pivotlow(low, 2, 2)', self.src)
        self.assertIn('ta.pivothigh(high, 2, 2)', self.src)
        self.assertIn('gP2 > gP1', self.src)
        self.assertIn('rP2 < rP1', self.src)

    def test_top_down_auto_requests_exist(self):
        for tf in ('"D"', '"240"', '"60"', '"15"', '"5"'):
            self.assertIn(f'request.security(syminfo.tickerid, {tf}, f_auto_pack()', self.src)

    def test_trendline_cross_cannot_flip_or_enter(self):
        self.assertIn('They are NOT entry triggers and a cross NEVER flips BIG DIRECTION.', self.src)
        self.assertNotIn('priceCrossRedFlipsDirection', self.src)
        self.assertNotIn('priceCrossGreenFlipsDirection', self.src)

    def test_pdh_pdl_full_span_and_weekly_conditional(self):
        self.assertIn('bool showPdh = dayValuesValid', self.src)
        self.assertIn('bool showPdl = dayValuesValid', self.src)
        self.assertIn('math.abs(pwh - close) <= dailyVisualEnvelope', self.src)
        self.assertIn('math.abs(pwl - close) <= dailyVisualEnvelope', self.src)
        self.assertGreaterEqual(self.src.count('extend = extend.both'), 4)
        self.assertIn('f_sync_level(pdhLine, pdhLabel, pdh, "PDH", BLUE_DAY, showPdh, 2, true)', self.src)
        self.assertIn('f_sync_level(pdlLine, pdlLabel, pdl, "PDL", BLUE_DAY, showPdl, 2, true)', self.src)

    def test_chart_clutter_guard_is_preserved(self):
        self.assertIn('int trendlineVisibleCount = input.int(2, "Trendlines prominent"', self.src)
        self.assertIn('array.sort_indices(tlDistances, order.ascending)', self.src)
        self.assertIn('f_rank_visible(0)', self.src)
        self.assertIn('line.set_xy1(id, na, na)', self.src)
        self.assertIn('line.set_xy2(id, na, na)', self.src)

    def test_release_safety_lock_remains(self):
        self.assertIn('const string BUILD_CLASSIFICATION = "PLATFORM_PARITY_ONLY"', self.src)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', self.src)
        self.assertGreaterEqual(self.src.count('NON-ACTIONABLE parity event'), 4)


if __name__ == "__main__":
    unittest.main()
