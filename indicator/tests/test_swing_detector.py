import unittest

from indicator.reference.swing_detector import (
    Bar,
    ClusterConfig,
    SwingDetectorConfig,
    SwingKind,
    SwingPoint,
    cluster_swings,
    detect_confirmed_swings,
)


class SwingDetectorTests(unittest.TestCase):
    def test_swing_not_visible_before_right_side_confirmation(self):
        bars = [
            Bar(0, 10, 8),
            Bar(1, 12, 9),
            Bar(2, 15, 10),
            Bar(3, 13, 9),
            Bar(4, 11, 8),
        ]
        cfg = SwingDetectorConfig(left_bars=2, right_bars=2)
        before = detect_confirmed_swings(bars, cfg, as_of_bar_id=3)
        after = detect_confirmed_swings(bars, cfg, as_of_bar_id=4)
        self.assertFalse(any(p.kind == SwingKind.HIGH and p.pivot_bar_id == 2 for p in before))
        self.assertTrue(any(p.kind == SwingKind.HIGH and p.pivot_bar_id == 2 for p in after))

    def test_equal_highs_do_not_get_arbitrary_pivot_identity(self):
        bars = [
            Bar(0, 10, 8),
            Bar(1, 12, 9),
            Bar(2, 15, 10),
            Bar(3, 15, 9),
            Bar(4, 11, 8),
            Bar(5, 10, 7),
        ]
        cfg = SwingDetectorConfig(left_bars=1, right_bars=1)
        points = detect_confirmed_swings(bars, cfg)
        highs = [p for p in points if p.kind == SwingKind.HIGH]
        self.assertFalse(any(p.pivot_bar_id in {2, 3} for p in highs))

    def test_future_bars_beyond_confirmation_do_not_rewrite_fixed_window_pivot(self):
        base = [
            Bar(0, 10, 8),
            Bar(1, 12, 9),
            Bar(2, 15, 10),
            Bar(3, 13, 9),
            Bar(4, 11, 8),
        ]
        extended = base + [Bar(5, 20, 12), Bar(6, 18, 11)]
        cfg = SwingDetectorConfig(left_bars=2, right_bars=2)
        base_points = detect_confirmed_swings(base, cfg)
        ext_points = detect_confirmed_swings(extended, cfg)
        base_pivot = [p for p in base_points if p.kind == SwingKind.HIGH and p.pivot_bar_id == 2]
        ext_pivot = [p for p in ext_points if p.kind == SwingKind.HIGH and p.pivot_bar_id == 2]
        self.assertEqual(base_pivot, ext_pivot)

    def test_rejects_nonmonotonic_bar_ids(self):
        bars = [Bar(0, 10, 8), Bar(0, 11, 9), Bar(2, 12, 10)]
        with self.assertRaises(ValueError):
            detect_confirmed_swings(bars, SwingDetectorConfig(1, 1))


class ReactionClusterTests(unittest.TestCase):
    def test_clusters_nearby_confirmed_highs(self):
        pts = [
            SwingPoint(SwingKind.HIGH, 10, 12, 100.0),
            SwingPoint(SwingKind.HIGH, 20, 22, 100.3),
            SwingPoint(SwingKind.HIGH, 30, 32, 103.0),
        ]
        clusters = cluster_swings(
            pts, SwingKind.HIGH, ClusterConfig(merge_distance=.5, min_points=2, min_zone_width=.25)
        )
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0].origin_bar_ids, (10, 20))
        self.assertAlmostEqual(clusters[0].lower_bound, 100.0)
        self.assertAlmostEqual(clusters[0].upper_bound, 100.3)

    def test_single_wick_is_not_automatically_called_a_pool(self):
        pts = [SwingPoint(SwingKind.LOW, 10, 12, 100.0)]
        clusters = cluster_swings(
            pts, SwingKind.LOW, ClusterConfig(merge_distance=.5, min_points=2, min_zone_width=.25)
        )
        self.assertEqual(clusters, [])

    def test_exact_equal_prices_expand_to_minimum_zone_width(self):
        pts = [
            SwingPoint(SwingKind.LOW, 10, 12, 100.0),
            SwingPoint(SwingKind.LOW, 20, 22, 100.0),
        ]
        clusters = cluster_swings(
            pts, SwingKind.LOW, ClusterConfig(merge_distance=.5, min_points=2, min_zone_width=.25)
        )
        self.assertEqual(len(clusters), 1)
        self.assertAlmostEqual(clusters[0].upper_bound - clusters[0].lower_bound, .25)

    def test_input_order_does_not_change_cluster_output(self):
        pts = [
            SwingPoint(SwingKind.HIGH, 10, 12, 100.0),
            SwingPoint(SwingKind.HIGH, 20, 22, 100.3),
            SwingPoint(SwingKind.HIGH, 30, 32, 100.4),
        ]
        cfg = ClusterConfig(merge_distance=.5, min_points=2, min_zone_width=.25)
        a = cluster_swings(pts, SwingKind.HIGH, cfg)
        b = cluster_swings(list(reversed(pts)), SwingKind.HIGH, cfg)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
