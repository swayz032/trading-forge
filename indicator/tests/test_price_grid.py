import unittest
from decimal import Decimal

from indicator.reference.price_grid import (
    GridPolicy,
    MNQ_GRID,
    NQ_GRID,
    conservative_target_to_grid,
    is_on_grid,
    normalize_price,
    snap_to_grid,
    ticks_between,
)


class PriceGridTests(unittest.TestCase):
    def test_nq_and_mnq_use_quarter_point_grid(self):
        self.assertEqual(NQ_GRID.tick_size, Decimal("0.25"))
        self.assertEqual(MNQ_GRID.tick_size, Decimal("0.25"))

    def test_valid_quarter_tick_prices_pass(self):
        for p in ("19000", "19000.25", "19000.50", "19000.75"):
            self.assertTrue(is_on_grid(p, MNQ_GRID))
            self.assertEqual(normalize_price(p, MNQ_GRID), Decimal(p))

    def test_off_grid_price_fails_closed_by_default(self):
        with self.assertRaisesRegex(ValueError, "OFF_TICK_GRID"):
            normalize_price("19000.10", MNQ_GRID)

    def test_explicit_snap_policy_is_deterministic(self):
        self.assertEqual(
            normalize_price("19000.13", MNQ_GRID, GridPolicy.SNAP_HALF_EVEN),
            Decimal("19000.25"),
        )
        self.assertEqual(snap_to_grid("19000.12", MNQ_GRID), Decimal("19000.00"))

    def test_long_conservative_tp_rounds_toward_current_price(self):
        # Raw target 111.40 inside an upper pool -> LONG approaches from below.
        self.assertEqual(conservative_target_to_grid("111.40", MNQ_GRID, trade_side="LONG"), Decimal("111.25"))

    def test_short_conservative_tp_rounds_toward_current_price(self):
        # Raw target 92.60 inside a lower pool -> SHORT approaches from above.
        self.assertEqual(conservative_target_to_grid("92.60", MNQ_GRID, trade_side="SHORT"), Decimal("92.75"))

    def test_directional_rounding_never_moves_deeper_into_pool(self):
        raw = Decimal("111.40")
        self.assertLessEqual(conservative_target_to_grid(raw, MNQ_GRID, trade_side="LONG"), raw)
        raw_short = Decimal("92.60")
        self.assertGreaterEqual(conservative_target_to_grid(raw_short, MNQ_GRID, trade_side="SHORT"), raw_short)

    def test_69_ticks_equals_17_25_index_points(self):
        self.assertEqual(ticks_between("19000.00", "19017.25", MNQ_GRID), 69)
        self.assertEqual(ticks_between("19017.25", "19000.00", MNQ_GRID), -69)

    def test_non_finite_price_rejected(self):
        for p in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValueError):
                normalize_price(p, MNQ_GRID)


if __name__ == "__main__":
    unittest.main()
