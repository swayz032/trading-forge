import unittest

from indicator.reference.market_structure import (
    Direction,
    OverallDirection,
    ReactionZone,
    TargetCandidate,
    TargetSelectorConfig,
    Timeframe,
    select_target,
)
from indicator.reference.price_grid import MNQ_GRID, is_on_grid


CFG = TargetSelectorConfig(.35, .5, .75, .75)


class TargetGridIntegrationTests(unittest.TestCase):
    def test_long_raw_target_is_floored_to_quarter_tick(self):
        z = ReactionZone('upper', Timeframe.M15, 110, 114, .8, 3, 0, 1)
        d = select_target([TargetCandidate(z, 1.0)], Direction.LONG, OverallDirection.BULLISH, .5, CFG)
        self.assertAlmostEqual(d.raw_target_price, 111.4)
        self.assertEqual(d.target_price, 111.25)
        self.assertTrue(is_on_grid(d.target_price, MNQ_GRID))
        self.assertLessEqual(d.target_price, d.raw_target_price)

    def test_short_raw_target_is_ceiled_to_quarter_tick(self):
        z = ReactionZone('lower', Timeframe.M15, 90, 94, .8, 3, 0, 1)
        d = select_target([TargetCandidate(z, 1.0)], Direction.SHORT, OverallDirection.BEARISH, .5, CFG)
        self.assertAlmostEqual(d.raw_target_price, 92.6)
        self.assertEqual(d.target_price, 92.75)
        self.assertTrue(is_on_grid(d.target_price, MNQ_GRID))
        self.assertGreaterEqual(d.target_price, d.raw_target_price)

    def test_no_target_has_no_raw_or_tradable_price(self):
        d = select_target([], Direction.SHORT, OverallDirection.BEARISH, .5, CFG)
        self.assertIsNone(d.raw_target_price)
        self.assertIsNone(d.target_price)


if __name__ == '__main__':
    unittest.main()
