import unittest

from indicator.reference.market_structure import (
    Direction,
    OverallDirection,
    ProofCandidate,
    ProofSelectorConfig,
    ReactionZone,
    TargetCandidate,
    TargetSelectorConfig,
    Timeframe,
    conservative_target_price,
    select_proof_level,
    select_target,
)


PROOF_CFG = ProofSelectorConfig(
    min_distance_normalized=0.5,
    max_distance_normalized=3.0,
    min_room_to_target_normalized=0.75,
    min_countertrend_structural_score=0.70,
    min_withtrend_structural_score=0.40,
)

TARGET_CFG = TargetSelectorConfig(
    conservative_penetration_fraction=0.35,
    close_distance_normalized=0.5,
    major_zone_reaction_score=0.75,
    strong_momentum_threshold=0.75,
)


def zone(zone_id, tf, lo, hi, reaction=.8, count=3, confluence=0, age=10):
    return ReactionZone(zone_id, tf, lo, hi, reaction, count, confluence, age)


class ProofSelectorTests(unittest.TestCase):
    def test_countertrend_rejects_nearest_tiny_wick(self):
        tiny = ProofCandidate(
            "tiny-near", 101,
            zone("z-tiny", Timeframe.M5, 100.8, 101.2, reaction=.3, count=1),
            distance_normalized=.2, room_to_target_normalized=2.0,
            structural_score=.3, selection_score=.3,
        )
        meaningful = ProofCandidate(
            "meaningful", 105,
            zone("z-major", Timeframe.M15, 104.5, 105.5, reaction=.9, count=4),
            distance_normalized=1.4, room_to_target_normalized=2.0,
            structural_score=.85, selection_score=.9,
        )
        d = select_proof_level([tiny, meaningful], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        self.assertEqual(d.selected.candidate_id, "meaningful")
        self.assertIn(("tiny-near", "TOO_CLOSE_NOISE_RISK"), d.rejected)

    def test_rejects_impractically_far_level(self):
        far = ProofCandidate(
            "far", 120,
            zone("z-far", Timeframe.H4, 119, 121, reaction=.95, count=6),
            distance_normalized=5.0, room_to_target_normalized=2.0,
            structural_score=.95, selection_score=.95,
        )
        d = select_proof_level([far], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        self.assertIsNone(d.selected)
        self.assertIn(("far", "TOO_FAR_LATE_RISK"), d.rejected)

    def test_countertrend_requires_more_structure_than_withtrend(self):
        c = ProofCandidate(
            "middle", 105,
            zone("z-middle", Timeframe.M15, 104, 106, reaction=.65, count=3),
            distance_normalized=1.2, room_to_target_normalized=1.5,
            structural_score=.60, selection_score=.60,
        )
        counter = select_proof_level([c], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        withtrend = select_proof_level([c], Direction.LONG, OverallDirection.BULLISH, PROOF_CFG)
        self.assertIsNone(counter.selected)
        self.assertEqual(withtrend.selected.candidate_id, "middle")

    def test_higher_timeframe_wins_true_tie(self):
        m5 = ProofCandidate(
            "m5", 105,
            zone("a", Timeframe.M5, 104, 106, reaction=.8, count=3, confluence=1, age=5),
            1.2, 1.5, .8, .8,
        )
        h4 = ProofCandidate(
            "h4", 105,
            zone("b", Timeframe.H4, 104, 106, reaction=.8, count=3, confluence=1, age=5),
            1.2, 1.5, .8, .8,
        )
        d = select_proof_level([m5, h4], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        self.assertEqual(d.selected.candidate_id, "h4")

    def test_calibrated_selection_score_beats_timeframe_when_not_tied(self):
        m5 = ProofCandidate(
            "m5-strong", 105,
            zone("m5-zone", Timeframe.M5, 104, 106, reaction=.9, count=5),
            1.2, 1.5, .9, .95,
        )
        h4 = ProofCandidate(
            "h4-weaker", 105,
            zone("h4-zone", Timeframe.H4, 104, 106, reaction=.8, count=3),
            1.2, 1.5, .8, .80,
        )
        d = select_proof_level([h4, m5], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        self.assertEqual(d.selected.candidate_id, "m5-strong")

    def test_same_inputs_same_selection_regardless_input_order(self):
        a = ProofCandidate(
            "a", 105,
            zone("a-zone", Timeframe.M15, 104, 106, reaction=.8, count=3),
            1.0, 1.2, .8, .8,
        )
        b = ProofCandidate(
            "b", 106,
            zone("b-zone", Timeframe.M15, 105, 107, reaction=.8, count=3),
            1.0, 1.2, .8, .8,
        )
        d1 = select_proof_level([a, b], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        d2 = select_proof_level([b, a], Direction.LONG, OverallDirection.BEARISH, PROOF_CFG)
        self.assertEqual(d1.selected.candidate_id, d2.selected.candidate_id)


class TargetSelectorTests(unittest.TestCase):
    def test_long_target_is_inside_near_side_not_far_wick(self):
        z = zone("upper", Timeframe.M15, 110, 114)
        p = conservative_target_price(z, Direction.LONG, .35)
        self.assertGreater(p, z.lower_bound)
        self.assertLess(p, z.upper_bound)
        self.assertAlmostEqual(p, 111.4)

    def test_short_target_is_inside_near_side_not_far_wick(self):
        z = zone("lower", Timeframe.M15, 90, 94)
        p = conservative_target_price(z, Direction.SHORT, .35)
        self.assertGreater(p, z.lower_bound)
        self.assertLess(p, z.upper_bound)
        self.assertAlmostEqual(p, 92.6)

    def test_countertrend_prefers_closest_pool(self):
        close = TargetCandidate(zone("close", Timeframe.M5, 105, 107, reaction=.5), .4)
        far = TargetCandidate(zone("far", Timeframe.H4, 110, 114, reaction=.95), 1.5)
        d = select_target([far, close], Direction.LONG, OverallDirection.BEARISH, momentum_score=.95, config=TARGET_CFG)
        self.assertEqual(d.zone.zone_id, "close")
        self.assertEqual(d.reason, "COUNTERTREND_CONSERVATIVE_NEAREST_ZONE")

    def test_strong_withtrend_can_skip_close_minor_pool(self):
        close = TargetCandidate(zone("close", Timeframe.M5, 105, 107, reaction=.4), .4)
        next_major = TargetCandidate(zone("major", Timeframe.M15, 110, 114, reaction=.9), 1.2)
        d = select_target([close, next_major], Direction.LONG, OverallDirection.BULLISH, momentum_score=.9, config=TARGET_CFG)
        self.assertEqual(d.zone.zone_id, "major")
        self.assertEqual(d.reason, "STRONG_WITHTREND_SKIP_CLOSE_MINOR_ZONE")

    def test_weak_withtrend_takes_close_pool(self):
        close = TargetCandidate(zone("close", Timeframe.M5, 105, 107, reaction=.4), .4)
        next_major = TargetCandidate(zone("major", Timeframe.M15, 110, 114, reaction=.9), 1.2)
        d = select_target([close, next_major], Direction.LONG, OverallDirection.BULLISH, momentum_score=.5, config=TARGET_CFG)
        self.assertEqual(d.zone.zone_id, "close")
        self.assertEqual(d.reason, "NON_STRONG_MOMENTUM_NEAREST_ZONE")


if __name__ == "__main__":
    unittest.main()
