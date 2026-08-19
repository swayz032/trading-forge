import random
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


PROOF_CFG = ProofSelectorConfig(.4, 3.0, .5, .65, .35)
TARGET_CFG = TargetSelectorConfig(.35, .5, .75, .75)
TFS = [Timeframe.M5, Timeframe.M15, Timeframe.H4]


def make_zone(i, rng):
    lo = 100 + i * 3
    return ReactionZone(
        f'z{i}', rng.choice(TFS), lo, lo + rng.uniform(.5, 2.5),
        rng.random(), rng.randint(1, 8), rng.randint(0, 3), rng.randint(0, 100)
    )


class MarketStructurePropertyTests(unittest.TestCase):
    def test_proof_selection_is_permutation_invariant_over_random_sets(self):
        rng = random.Random(2026080901)
        for case in range(5000):
            candidates = []
            for i in range(rng.randint(1, 8)):
                z = make_zone(i, rng)
                candidates.append(
                    ProofCandidate(
                        f'c{i}',
                        (z.lower_bound + z.upper_bound) / 2,
                        z,
                        rng.uniform(0, 4),
                        rng.uniform(0, 3),
                        rng.random(),
                        rng.random(),
                    )
                )
            side = rng.choice([Direction.LONG, Direction.SHORT])
            overall = rng.choice([OverallDirection.BULLISH, OverallDirection.BEARISH, OverallDirection.UNKNOWN])
            baseline = select_proof_level(candidates, side, overall, PROOF_CFG)
            baseline_id = baseline.selected.candidate_id if baseline.selected else None
            baseline_rejected = sorted(baseline.rejected)
            for _ in range(3):
                permuted = list(candidates)
                rng.shuffle(permuted)
                d = select_proof_level(permuted, side, overall, PROOF_CFG)
                self.assertEqual(baseline_id, d.selected.candidate_id if d.selected else None, msg=f'case={case}')
                self.assertEqual(baseline_rejected, sorted(d.rejected), msg=f'case={case}')

    def test_target_selection_is_permutation_invariant_over_random_sets(self):
        rng = random.Random(2026080902)
        for case in range(5000):
            candidates = [TargetCandidate(make_zone(i, rng), rng.uniform(.05, 3.0)) for i in range(rng.randint(1, 8))]
            side = rng.choice([Direction.LONG, Direction.SHORT])
            overall = rng.choice([OverallDirection.BULLISH, OverallDirection.BEARISH, OverallDirection.UNKNOWN])
            momentum = rng.random()
            baseline = select_target(candidates, side, overall, momentum, TARGET_CFG)
            for _ in range(3):
                permuted = list(candidates)
                rng.shuffle(permuted)
                d = select_target(permuted, side, overall, momentum, TARGET_CFG)
                self.assertEqual(baseline.zone.zone_id, d.zone.zone_id, msg=f'case={case}')
                self.assertEqual(baseline.target_price, d.target_price, msg=f'case={case}')
                self.assertEqual(baseline.reason, d.reason, msg=f'case={case}')

    def test_conservative_target_never_leaves_zone(self):
        rng = random.Random(2026080903)
        for _ in range(10000):
            lo = rng.uniform(100, 30000)
            hi = lo + rng.uniform(.25, 100)
            z = ReactionZone('z', Timeframe.M15, lo, hi, .8, 3, 0, 1)
            f = rng.random()
            for side in (Direction.LONG, Direction.SHORT):
                p = conservative_target_price(z, side, f)
                self.assertGreaterEqual(p, z.lower_bound)
                self.assertLessEqual(p, z.upper_bound)

    def test_target_penetration_moves_monotonically_toward_far_extreme(self):
        z = ReactionZone('z', Timeframe.M15, 100, 110, .8, 3, 0, 1)
        long_prices = [conservative_target_price(z, Direction.LONG, f) for f in (0, .25, .5, .75, 1)]
        short_prices = [conservative_target_price(z, Direction.SHORT, f) for f in (0, .25, .5, .75, 1)]
        self.assertEqual(long_prices, sorted(long_prices))
        self.assertEqual(short_prices, sorted(short_prices, reverse=True))


if __name__ == '__main__':
    unittest.main()
