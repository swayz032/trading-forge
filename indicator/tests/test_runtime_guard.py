import unittest

from indicator.reference.runtime_guard import (
    FeedState,
    RuntimeContext,
    RuntimeMode,
    evaluate_runtime,
)


def ctx(**kw):
    base = dict(
        mode=RuntimeMode.LIVE_DECISION_SUPPORT,
        feed_state=FeedState.REALTIME,
        symbol_root="MNQ",
        chart_timeframe_minutes=5,
        seconds_since_last_update=0.5,
        platform="TradingView",
    )
    base.update(kw)
    return RuntimeContext(**base)


class RuntimeGuardTests(unittest.TestCase):
    def test_realtime_5m_mnq_allows_signal(self):
        d = evaluate_runtime(ctx())
        self.assertTrue(d.signal_allowed)
        self.assertTrue(d.display_allowed)
        self.assertEqual(d.codes, ())

    def test_10_min_delayed_feed_is_not_live_actionable(self):
        d = evaluate_runtime(ctx(feed_state=FeedState.DELAYED))
        self.assertFalse(d.signal_allowed)
        self.assertTrue(d.display_allowed)
        self.assertIn("FEED_DELAYED", d.codes)

    def test_delayed_feed_can_be_used_for_study_display(self):
        d = evaluate_runtime(
            ctx(mode=RuntimeMode.STUDY, feed_state=FeedState.DELAYED)
        )
        self.assertTrue(d.signal_allowed)
        self.assertTrue(d.display_allowed)
        self.assertIn("FEED_DELAYED", d.codes)

    def test_gap_blocks_display_and_signal(self):
        d = evaluate_runtime(ctx(feed_state=FeedState.GAP_DETECTED))
        self.assertFalse(d.signal_allowed)
        self.assertFalse(d.display_allowed)
        self.assertIn("FEED_GAP", d.codes)

    def test_stale_by_clock_blocks(self):
        d = evaluate_runtime(ctx(seconds_since_last_update=30.0))
        self.assertFalse(d.signal_allowed)
        self.assertIn("STALE_BY_CLOCK", d.codes)

    def test_wrong_timeframe_blocks_execution_logic(self):
        d = evaluate_runtime(ctx(chart_timeframe_minutes=15))
        self.assertFalse(d.signal_allowed)
        self.assertIn("WRONG_EXECUTION_TIMEFRAME", d.codes)

    def test_wrong_symbol_blocks(self):
        d = evaluate_runtime(ctx(symbol_root="ES"))
        self.assertFalse(d.signal_allowed)
        self.assertIn("WRONG_SYMBOL", d.codes)

    def test_unknown_feed_state_blocks(self):
        d = evaluate_runtime(ctx(feed_state=FeedState.UNKNOWN))
        self.assertFalse(d.signal_allowed)
        self.assertFalse(d.display_allowed)
        self.assertIn("FEED_STATE_UNKNOWN", d.codes)


if __name__ == "__main__":
    unittest.main()
