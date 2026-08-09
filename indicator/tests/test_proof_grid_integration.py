import unittest

from indicator.reference.market_structure import (
    Direction,
    OverallDirection,
    ProofCandidate,
    ProofSelectorConfig,
    ReactionZone,
    Timeframe,
    select_proof_level,
)
from indicator.reference.price_grid import MNQ_GRID, is_on_grid


CFG = ProofSelectorConfig(.5, 3.0, .5, .7, .4)


def candidate(candidate_id, raw_price):
    z = ReactionZone(f'z-{candidate_id}', Timeframe.M15, raw_price - 1, raw_price + 1, .9, 4, 1, 5)
    return ProofCandidate(candidate_id, raw_price, z, 1.2, 1.5, .9, .9)


class ProofGridIntegrationTests(unittest.TestCase):
    def test_long_proof_is_rounded_up_not_weakened(self):
        raw = 101.40
        d = select_proof_level([candidate('long', raw)], Direction.LONG, OverallDirection.BEARISH, CFG)
        self.assertEqual(d.proof_level_price, 101.50)
        self.assertTrue(is_on_grid(d.proof_level_price, MNQ_GRID))
        self.assertGreaterEqual(d.proof_level_price, raw)

    def test_short_proof_is_rounded_down_not_weakened(self):
        raw = 98.60
        d = select_proof_level([candidate('short', raw)], Direction.SHORT, OverallDirection.BULLISH, CFG)
        self.assertEqual(d.proof_level_price, 98.50)
        self.assertTrue(is_on_grid(d.proof_level_price, MNQ_GRID))
        self.assertLessEqual(d.proof_level_price, raw)

    def test_no_qualified_proof_has_no_tradable_price(self):
        c = candidate('too-close', 101.4)
        c = ProofCandidate(c.candidate_id, c.level_price, c.source_zone, .1, c.room_to_target_normalized, c.structural_score, c.selection_score)
        d = select_proof_level([c], Direction.LONG, OverallDirection.BEARISH, CFG)
        self.assertIsNone(d.selected)
        self.assertIsNone(d.proof_level_price)


if __name__ == '__main__':
    unittest.main()
