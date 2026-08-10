from pathlib import Path
import unittest

PINE = (
    Path(__file__).parents[1]
    / "pine"
    / "slumdawg_platform_parity_v0_10_trendline_geometry.pine"
)
SRC = PINE.read_text()


class PineV010TrendlineGeometryContractTests(unittest.TestCase):
    def test_identity_safety_and_no_autoscale_contract(self):
        self.assertIn('indicator("Slumdawg traders indicator"', SRC)
        self.assertIn('scale = scale.none', SRC)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', SRC)
        self.assertIn('PLATFORM_PARITY_ONLY', SRC)

    def test_coach_has_clear_show_hide_control(self):
        self.assertIn('bool showCoach = input.bool(true, "Show Slumdawg coach"', SRC)
        self.assertIn('if showCoach', SRC)
        self.assertIn('table.cell(coach, 0, r, "")', SRC)
        self.assertIn('table.cell(coach, 1, r, "")', SRC)

    def test_monthly_weekly_through_five_minute_visibility_controls_exist(self):
        for token in [
            'showMGreen', 'showMRed',
            'showWGreen', 'showWRed',
            'showDGreen', 'showDRed',
            'show4HGreen', 'show4HRed',
            'show1HGreen', 'show1HRed',
            'show15MGreen', 'show15MRed',
            'show5MGreen', 'show5MRed',
        ]:
            self.assertIn(f'bool {token} = input.bool(true', SRC)

    def test_source_timeframes_are_explicit_and_not_host_timeframe_aliases(self):
        for tf in ['"M"', '"W"', '"D"', '"240"', '"60"', '"15"', '"5"']:
            self.assertIn(f'request.security(syminfo.tickerid, {tf}', SRC)
        self.assertNotIn('timeframe.period, f_root_candidate', SRC)
        self.assertNotIn('timeframe.period, f_child_candidate', SRC)

    def test_root_uses_true_window_extreme_not_latest_local_pivot(self):
        self.assertIn('float extreme = bullish ? 1e20 : -1e20', SRC)
        self.assertIn('bool better = bullish ? v < extreme : v > extreme', SRC)
        self.assertIn('aOff := i', SRC)
        self.assertIn('float aP = bullish ? low[aOff] : high[aOff]', SRC)

    def test_fresh_ray_checks_actual_candle_path(self):
        self.assertIn('for k = firstOff to aOff - 1', SRC)
        self.assertIn('bullish and low[k] < lp - tol', SRC)
        self.assertIn('not bullish and high[k] > lp + tol', SRC)
        self.assertIn('for k = firstOff to maxOff', SRC)

    def test_child_inherits_parent_b_exactly(self):
        self.assertIn('candAT := parentBT', SRC)
        self.assertIn('candAP := parentBP', SRC)
        self.assertIn('bool afterParent = jt > parentBT', SRC)
        self.assertIn('bool distinct = na(parentProjected) or math.abs(candidateP - parentProjected) >= separation', SRC)

    def test_snapshot_is_freeze_timestamp_driven(self):
        self.assertIn('sourceStartedByFreeze = freezeTs > 0 and time <= freezeTs', SRC)
        self.assertIn('ta.valuewhen(sourceStartedByFreeze, candValid, 0)', SRC)
        self.assertIn('ta.valuewhen(sourceStartedByFreeze, candAT, 0)', SRC)
        self.assertIn('ta.valuewhen(sourceStartedByFreeze, candBT, 0)', SRC)

    def test_trendlines_use_time_price_geometry_and_no_timeframe_tags(self):
        self.assertGreaterEqual(SRC.count('xloc = xloc.bar_time'), 14)
        trend_fn = SRC.split('f_sync_trend(line id', 1)[1].split('var line goDraw', 1)[0]
        self.assertIn('line.set_xy1(id, aT, aP)', trend_fn)
        self.assertIn('line.set_xy2(id, bT, bP)', trend_fn)
        self.assertNotIn('label.', trend_fn)

    def test_all_accepted_slots_draw_independent_of_host_chart_timeframe(self):
        draw_start = SRC.index('if barstate.islast')
        draw = SRC[draw_start:]
        for token in [
            'f_sync_trend(mGreenLine', 'f_sync_trend(mRedLine',
            'f_sync_trend(wGreenLine', 'f_sync_trend(wRedLine',
            'f_sync_trend(dGreenLine', 'f_sync_trend(dRedLine',
            'f_sync_trend(h4GreenLine', 'f_sync_trend(h4RedLine',
            'f_sync_trend(h1GreenLine', 'f_sync_trend(h1RedLine',
            'f_sync_trend(m15GreenLine', 'f_sync_trend(m15RedLine',
            'f_sync_trend(m5GreenLine', 'f_sync_trend(m5RedLine',
        ]:
            self.assertIn(token, draw)
        self.assertNotIn('if isFiveMinute\n    f_sync_trend', draw)

    def test_geometry_gate_does_not_claim_repair_is_implemented(self):
        self.assertIn('LOCKED | GEOMETRY GATE', SRC)
        self.assertNotIn('Repair #1', SRC)
        self.assertNotIn('repairEvent', SRC)

    def test_request_budget_has_headroom(self):
        # 20 request.security calls is below TradingView's standard 40-unique-call limit.
        self.assertEqual(SRC.count('request.security('), 20)


if __name__ == "__main__":
    unittest.main()
