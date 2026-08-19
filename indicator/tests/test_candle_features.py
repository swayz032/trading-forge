import unittest

from indicator.reference.candle_features import (
    Candle,
    DojiConfig,
    MomentumObservation,
    MoveSide,
    candle_features,
    is_doji_like,
    momentum_features,
)


class CandleFeatureTests(unittest.TestCase):
    def test_geometry_sums_to_range(self):
        c = Candle(open=100, high=110, low=90, close=106)
        f = candle_features(c)
        self.assertAlmostEqual(f.body_size + f.upper_wick + f.lower_wick, f.range_size)
        self.assertAlmostEqual(
            f.body_fraction + f.upper_wick_fraction + f.lower_wick_fraction,
            1.0,
        )

    def test_doji_threshold_is_explicit_not_hidden(self):
        c = Candle(open=100, high=110, low=90, close=101)
        self.assertTrue(is_doji_like(c, DojiConfig(max_body_fraction=.06)))
        self.assertFalse(is_doji_like(c, DojiConfig(max_body_fraction=.04)))

    def test_zero_range_is_doji_like(self):
        c = Candle(open=100, high=100, low=100, close=100)
        self.assertTrue(is_doji_like(c, DojiConfig(max_body_fraction=.05)))

    def test_invalid_candle_fails_closed(self):
        with self.assertRaises(ValueError):
            Candle(open=100, high=99, low=90, close=101)


class MomentumFeatureTests(unittest.TestCase):
    def test_short_large_lower_wick_is_rejection(self):
        clean = MomentumObservation(
            MoveSide.SHORT, 10, 5, 1,
            Candle(open=110, high=111, low=99, close=100),
            previous_push_distance=9,
        )
        rejected = MomentumObservation(
            MoveSide.SHORT, 10, 5, 1,
            Candle(open=110, high=111, low=94, close=100),
            previous_push_distance=9,
        )
        self.assertLess(
            momentum_features(clean).rejection_wick_fraction,
            momentum_features(rejected).rejection_wick_fraction,
        )

    def test_long_and_short_hold_are_direction_normalized(self):
        long = MomentumObservation(
            MoveSide.LONG, 10, 5, 1,
            Candle(open=100, high=111, low=99, close=110),
        )
        short = MomentumObservation(
            MoveSide.SHORT, 10, 5, 1,
            Candle(open=110, high=111, low=99, close=100),
        )
        self.assertAlmostEqual(
            momentum_features(long).hold_near_favorable_extreme,
            momentum_features(short).hold_near_favorable_extreme,
        )

    def test_recoil_fraction_is_scale_free(self):
        a = momentum_features(MomentumObservation(
            MoveSide.LONG, 10, 2, 2, Candle(100, 111, 99, 110)
        ))
        b = momentum_features(MomentumObservation(
            MoveSide.LONG, 20, 4, 4, Candle(100, 111, 99, 110)
        ))
        self.assertAlmostEqual(a.recoil_fraction, b.recoil_fraction)
        self.assertAlmostEqual(a.speed, b.speed)

    def test_acceleration_ratio_is_explicit(self):
        f = momentum_features(MomentumObservation(
            MoveSide.LONG, 12, 3, 1, Candle(100, 113, 99, 112), previous_push_distance=8
        ))
        self.assertAlmostEqual(f.acceleration_ratio, 1.5)

    def test_bad_observation_fails_closed(self):
        with self.assertRaises(ValueError):
            MomentumObservation(MoveSide.LONG, 0, 1, 0, Candle(100, 101, 99, 100))


if __name__ == "__main__":
    unittest.main()
