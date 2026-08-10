import unittest

from indicator.reference.candle_features import Candle
from indicator.reference.entry_quality import CandleQualityConfig, classify_candle_quality


CFG = CandleQualityConfig(
    doji_max_body_fraction=0.15,
    rejection_min_wick_fraction=0.45,
    strong_body_fraction=0.60,
    strong_displacement_atr=0.80,
    favorable_close_fraction=0.75,
    max_rejection_wick_fraction=0.20,
    min_room_atr=1.0,
)


class EntryQualityTests(unittest.TestCase):
    def test_short_rejection_engulf_sequence_can_qualify_momentum_candidate(self):
        two_back = Candle(open=100.0, high=101.0, low=99.0, close=99.9)  # doji-like
        previous = Candle(open=100.0, high=101.0, low=97.0, close=100.5)  # large rejection wick
        current = Candle(open=100.75, high=100.8, low=96.0, close=96.5)  # strong bearish engulf
        result = classify_candle_quality(
            side="SHORT",
            current=current,
            previous=previous,
            two_back=two_back,
            proof_level=98.0,
            target_price=94.0,
            atr=2.0,
            config=CFG,
        )
        self.assertTrue(result.strong_engulf)
        self.assertTrue(result.rejection_sequence)
        self.assertTrue(result.momentum_entry_candidate)
        self.assertEqual(result.label, "🕯️ REJECTION -> ENGULF")

    def test_strong_engulf_without_room_does_not_qualify_early_entry(self):
        two_back = Candle(open=100, high=101, low=99, close=100.5)
        previous = Candle(open=100.5, high=101, low=99.5, close=100)
        current = Candle(open=100.75, high=100.8, low=97, close=97.2)
        result = classify_candle_quality(
            side="SHORT",
            current=current,
            previous=previous,
            two_back=two_back,
            proof_level=98.0,
            target_price=97.0,
            atr=2.0,
            config=CFG,
        )
        self.assertTrue(result.strong_engulf)
        self.assertFalse(result.momentum_entry_candidate)

    def test_named_pattern_alone_is_not_trade_authorization(self):
        two_back = Candle(open=100.0, high=101.0, low=99.0, close=99.9)
        previous = Candle(open=100.0, high=101.0, low=97.0, close=100.5)
        weak = Candle(open=100.6, high=100.7, low=99.0, close=99.5)
        result = classify_candle_quality(
            side="SHORT",
            current=weak,
            previous=previous,
            two_back=two_back,
            proof_level=98.0,
            target_price=94.0,
            atr=2.0,
            config=CFG,
        )
        self.assertFalse(result.momentum_entry_candidate)


if __name__ == "__main__":
    unittest.main()
