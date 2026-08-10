import unittest

from indicator.reference.canonical_shelf_selector import (
    canonicalize_target_shelves,
    select_canonical_target_ladder,
)
from indicator.reference.reaction_cluster_selector import ReactionCluster, TargetLevel


def level(lo, hi, price, *ids):
    return TargetLevel(ReactionCluster(lo, hi, len(ids), tuple(ids)), price, price)


class CanonicalShelfSelectorTests(unittest.TestCase):
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
            (lane15, lane5),
            side="SHORT",
            entry=29719.0,
            entry_gap=10.0,
            zone_gap=4.0,
            fusion_gap=10.0,
            penetration_fraction=0.25,
            tick=0.25,
            max_targets=3,
        )

        self.assertEqual(len(out), 3)
        self.assertEqual((out[0].cluster.lower, out[0].cluster.upper), (29672.0, 29699.0))
        # Final target is recomputed from the FULL fused shelf; it is not either
        # lane's old 29696.25/29679.50 target.
        self.assertEqual(out[0].price, 29692.25)
        self.assertNotIn(out[0].price, {29696.25, 29679.5})
        # The old deeper destination is now TP2, not a second slice of TP1.
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
            (lane,),
            side="SHORT",
            entry=110.0,
            entry_gap=1.0,
            zone_gap=0.0,
            fusion_gap=0.0,
            penetration_fraction=0.05,
            tick=0.25,
            max_targets=1,
        )[0]

        self.assertEqual(short.price, 100.25)
        self.assertGreater(short.price, short.cluster.lower)
        self.assertLess(short.price, short.cluster.upper)

    def test_too_narrow_for_an_interior_tick_fails_closed(self):
        lane = (level(100.0, 100.25, 100.25, "one-tick"),)

        short = select_canonical_target_ladder(
            (lane,),
            side="SHORT",
            entry=110.0,
            entry_gap=1.0,
            zone_gap=0.0,
            fusion_gap=0.0,
            penetration_fraction=0.25,
            tick=0.25,
            max_targets=1,
        )

        self.assertEqual(short, ())


if __name__ == "__main__":
    unittest.main()
