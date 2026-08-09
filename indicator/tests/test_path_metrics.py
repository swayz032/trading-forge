import unittest

from indicator.research.path_metrics import (
    FirstHit,
    TradePathSpec,
    TradeSide,
    evaluate_ordered_path,
    stop_price_from_ticks,
    zone_penetration_fraction,
)


class PathMetricTests(unittest.TestCase):
    def test_69_tick_stop_is_17_25_points(self):
        self.assertEqual(stop_price_from_ticks(19000, TradeSide.LONG, 69), 18982.75)
        self.assertEqual(stop_price_from_ticks(19000, TradeSide.SHORT, 69), 19017.25)

    def test_long_target_first(self):
        spec = TradePathSpec(TradeSide.LONG, 100, 95, 110)
        out = evaluate_ordered_path(spec, [100, 102, 99, 106, 110, 94])
        self.assertEqual(out.first_hit, FirstHit.TARGET_FIRST)
        self.assertEqual(out.first_hit_index, 4)
        self.assertEqual(out.mae_points, 6)  # full observed path metric, independent of first hit
        self.assertEqual(out.mfe_points, 10)

    def test_long_stop_first(self):
        spec = TradePathSpec(TradeSide.LONG, 100, 95, 110)
        out = evaluate_ordered_path(spec, [100, 98, 95, 108, 111])
        self.assertEqual(out.first_hit, FirstHit.STOP_FIRST)
        self.assertEqual(out.first_hit_index, 2)

    def test_short_target_first(self):
        spec = TradePathSpec(TradeSide.SHORT, 100, 105, 90)
        out = evaluate_ordered_path(spec, [100, 101, 97, 93, 90, 106])
        self.assertEqual(out.first_hit, FirstHit.TARGET_FIRST)
        self.assertEqual(out.first_hit_index, 4)

    def test_short_stop_first(self):
        spec = TradePathSpec(TradeSide.SHORT, 100, 105, 90)
        out = evaluate_ordered_path(spec, [100, 103, 105, 95, 89])
        self.assertEqual(out.first_hit, FirstHit.STOP_FIRST)
        self.assertEqual(out.first_hit_index, 2)

    def test_neither(self):
        spec = TradePathSpec(TradeSide.SHORT, 100, 105, 90)
        out = evaluate_ordered_path(spec, [100, 101, 99, 98, 102])
        self.assertEqual(out.first_hit, FirstHit.NEITHER)
        self.assertIsNone(out.first_hit_index)

    def test_long_zone_penetration(self):
        self.assertAlmostEqual(zone_penetration_fraction(TradeSide.LONG, 110, 114, [108, 110, 111.4]), .35)
        self.assertEqual(zone_penetration_fraction(TradeSide.LONG, 110, 114, [108, 115]), 1.0)
        self.assertEqual(zone_penetration_fraction(TradeSide.LONG, 110, 114, [108, 109]), 0.0)

    def test_short_zone_penetration(self):
        self.assertAlmostEqual(zone_penetration_fraction(TradeSide.SHORT, 90, 94, [96, 94, 92.6]), .35)
        self.assertEqual(zone_penetration_fraction(TradeSide.SHORT, 90, 94, [96, 89]), 1.0)
        self.assertEqual(zone_penetration_fraction(TradeSide.SHORT, 90, 94, [96, 95]), 0.0)

    def test_bad_trade_geometry_rejected(self):
        with self.assertRaises(ValueError):
            TradePathSpec(TradeSide.LONG, 100, 110, 95)
        with self.assertRaises(ValueError):
            TradePathSpec(TradeSide.SHORT, 100, 95, 110)


if __name__ == '__main__':
    unittest.main()
