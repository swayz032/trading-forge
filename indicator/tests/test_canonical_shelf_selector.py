import unittest

from indicator.reference.canonical_shelf_selector import (
    canonicalize_target_shelves,
    reaction_interval_from_candle,
    select_canonical_target_ladder,
    target_depth_for_context,
    target_depth_for_side,
)
from indicator.reference.reaction_cluster_selector import ReactionCluster, TargetLevel


def level(lo, hi, price, *ids):
    return TargetLevel(ReactionCluster(lo, hi, len(ids), tuple(ids)), price, price)


class CanonicalShelfSelectorTests(unittest.TestCase):
    def test_aligned_short_uses_exact_reaction_zone_midpoint(self):
        depth = target_depth_for_context(big_direction=-1, current_move=-1, safe_fraction=0.25)
        self.assertEqual(depth, 0.5)
        lane = (level(29190.0, 29210.0, 29205.0, "a", "b"),)
        out = select_canonical_target_ladder(
            (lane,), side="SHORT", entry=29666.0, entry_gap=1.0,
            zone_gap=1.0, fusion_gap=0.0, penetration_fraction=depth,
            tick=0.25, max_targets=1,
        )
        self.assertEqual(out[0].price, 29200.0)

    def test_countertrend_short_uses_safer_upper_middle(self):
        depth = target_depth_for_context(big_direction=1, current_move=-1, safe_fraction=0.25)
        self.assertEqual(depth, 0.25)
        lane = (level(100.0, 120.0, 115.0, "a", "b"),)
        out = select_canonical_target_ladder(
            (lane,), side="SHORT", entry=150.0, entry_gap=1.0,
            zone_gap=1.0, fusion_gap=0.0, penetration_fraction=depth,
            tick=0.25, max_targets=1,
        )
        self.assertEqual(out[0].price, 115.0)
        self.assertGreater(out[0].price, 110.0)

    def test_full_body_to_extreme_zone_replaces_thin_wick_strip(self):
        long_zone = reaction_interval_from_candle(
            side="LONG", open_price=29948.0, close_price=29960.0,
            high=29980.0, low=29940.0, source_id="long-reaction",
        )
        short_zone = reaction_interval_from_candle(
            side="SHORT", open_price=29592.0, close_price=29608.0,
            high=29615.0, low=29572.0, source_id="short-reaction",
        )
        self.assertEqual((long_zone.lower, long_zone.upper), (29948.0, 29980.0))
        self.assertEqual((short_zone.lower, short_zone.upper), (29572.0, 29608.0))
        # Old forbidden strips would have been 29960->29980 and 29572->29592.
        self.assertLess(long_zone.lower, 29960.0)
        self.assertGreater(short_zone.upper, 29592.0)

    def test_operator_side_bias_is_middle_with_long_top_lean_and_short_middle(self):
        self.assertEqual(target_depth_for_side(side="LONG"), 0.55)
        self.assertEqual(target_depth_for_side(side="SHORT"), 0.50)
        long_lane = (level(29940.0, 29964.0, 29950.0, "a", "b"),)
        short_lane = (level(29582.0, 29620.0, 29600.0, "c", "d"),)
        long_out = select_canonical_target_ladder(
            (long_lane,), side="LONG", entry=29900.0, entry_gap=1.0,
            zone_gap=1.0, fusion_gap=0.0,
            penetration_fraction=target_depth_for_side(side="LONG"), tick=0.25, max_targets=1,
        )[0]
        short_out = select_canonical_target_ladder(
            (short_lane,), side="SHORT", entry=29666.0, entry_gap=1.0,
            zone_gap=1.0, fusion_gap=0.0,
            penetration_fraction=target_depth_for_side(side="SHORT"), tick=0.25, max_targets=1,
        )[0]
        self.assertGreater(long_out.price, (29940.0 + 29964.0) / 2)
        self.assertLess(long_out.price, 29964.0)
        self.assertEqual(short_out.price, 29601.0)

    def test_duplicate_cross_tf_shelf_counts_once_and_deeper_promotes(self):
        lane15 = (
            level(29688.0, 29699.0, 29696.25, "15a", "15b", "15c"),
            level(29635.0, 29648.0, 29644.75, "15d", "15e"),
            level(29580.0, 29596.0, 29592.0, "15f", "15g"),
        )
        lane5 = (
            level(29672.0, 29682.0, 29679.5, "5a", "5b", "5c", "5d", "5e"),
            level(29634.0, 29646.0, 29643.0, "5f", "5g", "5h", "5i"),
        )
        out = select_canonical_target_ladder(
            (lane15, lane5), side="SHORT", entry=29719.0, entry_gap=10.0,
            zone_gap=4.0, fusion_gap=10.0, penetration_fraction=0.25,
            tick=0.25, max_targets=3,
        )
        self.assertEqual(len(out), 3)
        self.assertEqual((out[0].cluster.lower, out[0].cluster.upper), (29672.0, 29699.0))
        self.assertEqual(out[0].price, 29692.25)
        self.assertNotIn(out[0].price, {29696.25, 29679.5})
        self.assertEqual((out[1].cluster.lower, out[1].cluster.upper), (29634.0, 29648.0))
        self.assertEqual((out[2].cluster.lower, out[2].cluster.upper), (29580.0, 29596.0))

    def test_transitive_fusion_is_order_independent(self):
        a = (level(100.0, 105.0, 104.0, "a"),)
        b = (level(108.0, 112.0, 111.0, "b"),)
        c = (level(115.0, 120.0, 119.0, "c"),)
        s1 = canonicalize_target_shelves((a, b, c), fusion_gap=3.0)
        s2 = canonicalize_target_shelves((c, a, b), fusion_gap=3.0)
        self.assertEqual(s1, s2)
        self.assertEqual(len(s1), 1)
        self.assertEqual((s1[0].lower, s1[0].upper), (100.0, 120.0))

    def test_rounding_can_never_land_on_canonical_shelf_edge(self):
        lane = (level(100.0, 100.5, 100.5, "narrow"),)
        short = select_canonical_target_ladder(
            (lane,), side="SHORT", entry=110.0, entry_gap=1.0,
            zone_gap=0.0, fusion_gap=0.0, penetration_fraction=0.5,
            tick=0.25, max_targets=1,
        )[0]
        self.assertEqual(short.price, 100.25)
        self.assertGreater(short.price, short.cluster.lower)
        self.assertLess(short.price, short.cluster.upper)

    def test_too_narrow_for_an_interior_tick_fails_closed(self):
        lane = (level(100.0, 100.25, 100.25, "one-tick"),)
        short = select_canonical_target_ladder(
            (lane,), side="SHORT", entry=110.0, entry_gap=1.0,
            zone_gap=0.0, fusion_gap=0.0, penetration_fraction=0.25,
            tick=0.25, max_targets=1,
        )
        self.assertEqual(short, ())


if __name__ == "__main__":
    unittest.main()
