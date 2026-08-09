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
    select_target,
)


class NumericFailClosedTests(unittest.TestCase):
    def test_reaction_zone_rejects_nonfinite_and_unbounded_scores(self):
        bad_cases = [
            dict(lo=float('nan'), hi=101, reaction=.5),
            dict(lo=100, hi=float('inf'), reaction=.5),
            dict(lo=100, hi=101, reaction=float('nan')),
            dict(lo=100, hi=101, reaction=1.01),
            dict(lo=100, hi=101, reaction=-.01),
        ]
        for case in bad_cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                ReactionZone('z', Timeframe.M5, case['lo'], case['hi'], case['reaction'], 1, 0, 1)

    def test_proof_candidate_rejects_nan_selection_score(self):
        z = ReactionZone('z', Timeframe.M15, 100, 102, .8, 3, 0, 5)
        with self.assertRaises(ValueError):
            ProofCandidate('p', 101, z, 1.0, 1.0, .8, float('nan'))

    def test_proof_candidate_rejects_negative_distance(self):
        z = ReactionZone('z', Timeframe.M15, 100, 102, .8, 3, 0, 5)
        with self.assertRaises(ValueError):
            ProofCandidate('p', 101, z, -.1, 1.0, .8, .8)

    def test_proof_config_rejects_nan_threshold(self):
        with self.assertRaises(ValueError):
            ProofSelectorConfig(float('nan'), 3, .5, .7, .4)

    def test_target_config_rejects_out_of_range_scores(self):
        with self.assertRaises(ValueError):
            TargetSelectorConfig(.35, .5, 1.1, .75)
        with self.assertRaises(ValueError):
            TargetSelectorConfig(.35, .5, .75, float('nan'))

    def test_target_selector_rejects_nan_momentum_score(self):
        z = ReactionZone('z', Timeframe.M15, 110, 114, .8, 3, 0, 5)
        c = TargetCandidate(z, 1.0)
        cfg = TargetSelectorConfig(.35, .5, .75, .75)
        with self.assertRaises(ValueError):
            select_target([c], Direction.LONG, OverallDirection.BULLISH, float('nan'), cfg)


if __name__ == '__main__':
    unittest.main()
