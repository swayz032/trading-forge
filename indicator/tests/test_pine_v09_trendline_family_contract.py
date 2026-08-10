from pathlib import Path
import re
import unittest

PINE = (
    Path(__file__).parents[1]
    / "pine"
    / "slumdawg_platform_parity_v0_9_trendline_family.pine"
)
SRC = PINE.read_text()


class PineV09TrendlineFamilyContractTests(unittest.TestCase):
    def test_identity_and_safety_gate(self):
        self.assertIn('indicator("Slumdawg traders indicator"', SRC)
        self.assertIn('const bool LIVE_DECISION_SUPPORT_APPROVED = false', SRC)
        self.assertIn('PLATFORM_PARITY_ONLY', SRC)

    def test_event_sourced_freeze_not_old_recapture_counter(self):
        self.assertIn('boardFreezeTime = input.time(', SRC)
        self.assertIn('confirm = true', SRC)
        self.assertIn('freezeEvent = not boardInitialized', SRC)
        self.assertNotIn('trendlineSet', SRC)

    def test_all_ten_line_visibility_controls_exist(self):
        for token in [
            'showDGreen',
            'showDRed',
            'show4HGreen',
            'show4HRed',
            'show1HGreen',
            'show1HRed',
            'show15MGreen',
            'show15MRed',
            'show5MGreen',
            'show5MRed',
        ]:
            self.assertIn(f'bool {token} = input.bool(true', SRC)

    def test_child_geometry_is_parent_b_to_child_a(self):
        self.assertIn('int aT = pBT', SRC)
        self.assertIn('float aP = pBP', SRC)
        self.assertIn('f_child(', SRC)
        self.assertIn('distinctPath', SRC)

    def test_selective_repair_events_and_later_b_guard(self):
        for n in (1, 2, 3):
            self.assertIn(f'repair{n}Enabled = input.bool(false', SRC)
            self.assertIn(f'repair{n}Time = input.time(', SRC)
        self.assertIn('minBExclusive', SRC)
        self.assertIn('bool afterOld = na(minBExclusive)', SRC)
        self.assertIn(
            '// SELECTIVE REPAIR EVENTS. Valid lines are never assigned inside this block.',
            SRC,
        )

    def test_violation_uses_each_source_timeframe_confirmed_close(self):
        for tf in ['"D"', '"240"', '"60"', '"15"', '"5"']:
            pat = (
                rf'request\.security\(syminfo\.tickerid, {tf}, '
                rf'\[close\[1\], time_close\[1\]\], lookahead = barmerge\.lookahead_on\)'
            )
            self.assertRegex(SRC, pat, tf)
        self.assertIn('violationCloses = input.int(2', SRC)
        self.assertIn('nextViolated := true', SRC)

    def test_tuple_outputs_are_declared_then_scalar_reassigned(self):
        self.assertNotIn('] :=', SRC)
        self.assertIn('[nextDGBreach, nextDGViolated] = f_violation', SRC)
        self.assertIn('dGBreach := nextDGBreach', SRC)

    def test_d_w_lines_full_span_and_hidden_geometry_is_na(self):
        self.assertIn('extend = extend.both', SRC)
        self.assertIn(
            'line.set_extend(id, fullSpan ? extend.both : extend.right)',
            SRC,
        )
        self.assertIn('line.set_xy1(id, na, na)', SRC)
        self.assertIn('line.set_xy2(id, na, na)', SRC)

    def test_no_timeframe_labels_are_attached_to_trendline_rays(self):
        self.assertIn(
            'f_sync_trend(line id, bool valid, bool visible, int aT, float aP, int bT, float bP, color c)',
            SRC,
        )
        trend_fn = SRC.split('f_sync_trend(line id', 1)[1].split('bool goSet', 1)[0]
        self.assertNotIn('label.', trend_fn)
        self.assertNotIn('D GREEN', trend_fn)
        self.assertNotIn('5M GREEN', trend_fn)

    def test_violated_lines_stay_drawn_but_are_not_next_walls(self):
        self.assertIn('violated lines stay visible but are not walls', SRC)
        self.assertIn('not dRViolated', SRC)
        self.assertIn('not dGViolated', SRC)
        drawing_start = SRC.index('// DRAWINGS — no timeframe labels on trendline rays.')
        drawing_end = SRC.index('// BEGINNER SEMANTICS / RUNTIME GUARDS')
        draw = SRC[drawing_start:drawing_end]
        self.assertNotIn('dGViolated', draw)
        self.assertNotIn('dRViolated', draw)

    def test_request_limits_have_headroom(self):
        self.assertEqual(SRC.count('request.security('), 14)
        self.assertIn('Combined request tuple count remains under Pine', SRC)

    def test_research_guards_are_explicit_not_certified(self):
        self.assertIn('Research/calibration value. Not production-certified.', SRC)
        self.assertIn(
            'Slumdawg robustness layer, not attributed to the external trendline teaching.',
            SRC,
        )


if __name__ == "__main__":
    unittest.main()
