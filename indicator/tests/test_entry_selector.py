import unittest

from indicator.reference.entry_selector import EntrySelectorConfig, select_outer_swing_entry_pair
from indicator.reference.swing_detector import SwingKind, SwingPoint


def swing(kind, pivot, confirmed, price):
    return SwingPoint(kind, pivot, confirmed, price)


class EntrySelectorTests(unittest.TestCase):
    def test_selects_outer_not_nearest_wicks(self):
        points = [
            swing(SwingKind.HIGH, 10, 12, 29960.00),
            swing(SwingKind.HIGH, 20, 22, 30073.25),
            swing(SwingKind.HIGH, 30, 32, 29985.00),
            swing(SwingKind.LOW, 11, 13, 29455.00),
            swing(SwingKind.LOW, 21, 23, 29280.00),
            swing(SwingKind.LOW, 31, 33, 29820.00),
        ]
        decision = select_outer_swing_entry_pair(points, EntrySelectorConfig(8))
        self.assertEqual(decision.long_price, 30073.25)
        self.assertEqual(decision.short_price, 29280.00)
        self.assertEqual(decision.long_source_bar_id, 20)
        self.assertEqual(decision.short_source_bar_id, 21)
        self.assertEqual(decision.reason, "OUTER_CONFIRMED_SWING_PAIR")

    def test_recent_memory_prevents_ancient_outer_point_from_winning(self):
        points = [
            swing(SwingKind.HIGH, 1, 2, 40000.00),
            swing(SwingKind.HIGH, 10, 11, 100.00),
            swing(SwingKind.HIGH, 20, 21, 110.00),
            swing(SwingKind.LOW, 2, 3, 1.00),
            swing(SwingKind.LOW, 12, 13, 90.00),
            swing(SwingKind.LOW, 22, 23, 80.00),
        ]
        decision = select_outer_swing_entry_pair(points, EntrySelectorConfig(2))
        self.assertEqual(decision.long_price, 110.00)
        self.assertEqual(decision.short_price, 80.00)

    def test_directional_tick_rounding_is_conservative(self):
        points = [
            swing(SwingKind.HIGH, 1, 3, 101.40),
            swing(SwingKind.LOW, 2, 4, 98.60),
        ]
        decision = select_outer_swing_entry_pair(points)
        self.assertEqual(decision.long_price, 101.50)
        self.assertEqual(decision.short_price, 98.50)

    def test_missing_side_fails_closed_without_inventing_level(self):
        points = [swing(SwingKind.HIGH, 1, 3, 101.50)]
        decision = select_outer_swing_entry_pair(points)
        self.assertEqual(decision.long_price, 101.50)
        self.assertIsNone(decision.short_price)
        self.assertEqual(decision.reason, "LONG_ONLY_CONFIRMED")

    def test_memory_must_be_positive(self):
        with self.assertRaises(ValueError):
            EntrySelectorConfig(0)


if __name__ == "__main__":
    unittest.main()
