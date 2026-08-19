import unittest

from indicator.reference.reaction_cluster_selector import (
    ReactionCluster,
    ReactionInterval,
    TargetLevel,
    merge_distinct_target_ladders,
    select_target_ladder,
)


class ReactionClusterSelectorTests(unittest.TestCase):
    def test_short_golden_semantics_reject_entry_neighbor_and_isolated_pivot(self):
        intervals = [
            # Rejected: same neighborhood as ~29,719 short entry and only one touch.
            ReactionInterval(29702.0, 29714.0, "entry-neighbor"),
            # Golden TP1 shelf: aggregate zone 29582 -> 29644. 25% penetration = 29628.50.
            ReactionInterval(29582.0, 29644.0, "tp1-a"),
            ReactionInterval(29590.0, 29642.0, "tp1-b"),
            # Rejected isolated in-between pivot around the old bad ~29,583 selection.
            ReactionInterval(29570.0, 29583.0, "isolated-29583"),
            # Golden TP2 shelf: aggregate zone 29489 -> 29540. 25% penetration = 29527.25.
            ReactionInterval(29489.0, 29540.0, "tp2-a"),
            ReactionInterval(29495.0, 29538.0, "tp2-b"),
        ]
        ladder = select_target_ladder(
            intervals,
            side="SHORT",
            entry=29719.0,
            entry_gap=20.0,
            zone_gap=10.0,
            tolerance=5.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            max_targets=3,
        )
        self.assertEqual(len(ladder), 2)
        self.assertEqual(ladder[0].price, 29628.50)
        self.assertEqual(ladder[1].price, 29527.25)
        self.assertNotIn("entry-neighbor", ladder[0].cluster.member_ids)
        self.assertNotIn("isolated-29583", ladder[1].cluster.member_ids)

    def test_target_is_inside_cluster_not_on_near_edge(self):
        intervals = [
            ReactionInterval(100.0, 120.0, "a"),
            ReactionInterval(102.0, 119.0, "b"),
        ]
        short = select_target_ladder(
            intervals,
            side="SHORT",
            entry=150.0,
            entry_gap=10.0,
            zone_gap=5.0,
            tolerance=3.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            max_targets=1,
        )[0]
        self.assertLess(short.price, short.cluster.upper)
        self.assertGreater(short.price, short.cluster.lower)

        long = select_target_ladder(
            intervals,
            side="LONG",
            entry=80.0,
            entry_gap=10.0,
            zone_gap=5.0,
            tolerance=3.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            max_targets=1,
        )[0]
        self.assertGreater(long.price, long.cluster.lower)
        self.assertLess(long.price, long.cluster.upper)

    def test_fail_closed_when_no_multitouch_cluster_exists(self):
        ladder = select_target_ladder(
            [ReactionInterval(90.0, 95.0, "only-one")],
            side="SHORT",
            entry=120.0,
            entry_gap=10.0,
            zone_gap=5.0,
            tolerance=2.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
        )
        self.assertEqual(ladder, ())

    def test_weak_near_long_shelf_cannot_outrank_real_reaction_zone(self):
        # Frozen Aug-11 semantic class: LONG entry ~29,900.  A weak micro-cluster
        # just above entry must not consume TP1 ahead of the first meaningful
        # reaction shelf around the upper 29,93x area.
        intervals = [
            ReactionInterval(29912.0, 29918.0, "weak-near-a", reaction_strength=0.20),
            ReactionInterval(29913.0, 29919.0, "weak-near-b", reaction_strength=0.25),
            ReactionInterval(29934.0, 29944.0, "real-zone-a", reaction_strength=0.85),
            ReactionInterval(29935.0, 29943.0, "real-zone-b", reaction_strength=0.75),
            ReactionInterval(29936.0, 29945.0, "real-zone-c", reaction_strength=0.90),
        ]
        ladder = select_target_ladder(
            intervals,
            side="LONG",
            entry=29900.0,
            entry_gap=5.0,
            zone_gap=5.0,
            tolerance=3.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            max_targets=1,
            min_reaction_strength=0.50,
        )
        self.assertEqual(len(ladder), 1)
        self.assertGreaterEqual(ladder[0].cluster.lower, 29934.0)
        self.assertGreater(ladder[0].price, 29900.0)
        self.assertTrue(all("weak-near" not in member for member in ladder[0].cluster.member_ids))

    def test_reaction_quality_gate_runs_before_distance(self):
        intervals = [
            ReactionInterval(101.0, 104.0, "near-weak-a", reaction_strength=0.10),
            ReactionInterval(101.5, 104.5, "near-weak-b", reaction_strength=0.10),
            ReactionInterval(110.0, 116.0, "far-strong-a", reaction_strength=1.00),
            ReactionInterval(111.0, 115.0, "far-strong-b", reaction_strength=0.90),
        ]
        ladder = select_target_ladder(
            intervals,
            side="LONG",
            entry=90.0,
            entry_gap=5.0,
            zone_gap=5.0,
            tolerance=2.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            min_reaction_strength=0.50,
            max_targets=1,
        )
        self.assertEqual(ladder[0].cluster.member_ids, ("far-strong-a", "far-strong-b"))

    def test_profit_side_is_hard_invariant(self):
        long_ladder = select_target_ladder(
            [
                ReactionInterval(110.0, 120.0, "long-a", reaction_strength=1.0),
                ReactionInterval(111.0, 119.0, "long-b", reaction_strength=1.0),
            ],
            side="LONG",
            entry=100.0,
            entry_gap=5.0,
            zone_gap=2.0,
            tolerance=2.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            min_reaction_strength=0.5,
        )
        self.assertTrue(all(level.price > 100.0 for level in long_ladder))

        short_ladder = select_target_ladder(
            [
                ReactionInterval(80.0, 90.0, "short-a", reaction_strength=1.0),
                ReactionInterval(81.0, 89.0, "short-b", reaction_strength=1.0),
            ],
            side="SHORT",
            entry=100.0,
            entry_gap=5.0,
            zone_gap=2.0,
            tolerance=2.0,
            min_touches=2,
            penetration_fraction=0.25,
            tick=0.25,
            min_reaction_strength=0.5,
        )
        self.assertTrue(all(level.price < 100.0 for level in short_ladder))

    def test_cross_lane_same_shelf_cannot_consume_tp2(self):
        # Two timeframe adapters describe adjacent pieces of one physical shelf.
        # The first shelf should count once; the genuinely deeper shelves promote.
        lane_15 = (
            TargetLevel(ReactionCluster(29688.0, 29699.0, 3, ("15m-a", "15m-b", "15m-c")), 29696.25, 29696.25),
            TargetLevel(ReactionCluster(29635.0, 29648.0, 2, ("15m-deep-a", "15m-deep-b")), 29644.75, 29644.75),
            TargetLevel(ReactionCluster(29580.0, 29596.0, 2, ("15m-deeper-a", "15m-deeper-b")), 29592.0, 29592.0),
        )
        lane_5 = (
            # Adjacent/nested representation of the SAME first destination.
            TargetLevel(ReactionCluster(29672.0, 29682.0, 5, ("5m-a", "5m-b", "5m-c", "5m-d", "5m-e")), 29679.5, 29679.5),
            TargetLevel(ReactionCluster(29634.0, 29646.0, 4, ("5m-deep-a", "5m-deep-b", "5m-deep-c", "5m-deep-d")), 29643.0, 29643.0),
        )

        merged = merge_distinct_target_ladders(
            (lane_15, lane_5),
            side="SHORT",
            entry=29719.0,
            entry_gap=10.0,
            zone_gap=4.0,
            fusion_gap=10.0,
            max_targets=3,
        )

        self.assertEqual(len(merged), 3)
        self.assertEqual(merged[0].price, 29696.25)
        # 29679.5 is rejected as the same shelf neighborhood, so the old deeper
        # destination promotes into TP2.
        self.assertEqual(merged[1].price, 29644.75)
        self.assertEqual(merged[2].price, 29592.0)
        self.assertNotEqual(merged[1].price, 29679.5)


if __name__ == "__main__":
    unittest.main()
