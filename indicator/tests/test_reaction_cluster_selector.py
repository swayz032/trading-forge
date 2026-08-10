import unittest

from indicator.reference.reaction_cluster_selector import ReactionInterval, select_target_ladder


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


if __name__ == "__main__":
    unittest.main()
