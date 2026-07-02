"""Tests for candle_patterns.py — the groundability-audit priority evaluator family (2026-06-30).

Stdlib-only module: safe under tower pytest collection (no vectorbt pull).
"""
from src.engine.indicators.candle_patterns import (
    detect_strength,
    detect_weakness,
    is_bearish_engulfing,
    is_bullish_engulfing,
    is_rejection_lower,
    is_rejection_upper,
    is_strong_close,
)


class TestEngulfing:
    def test_bullish_engulfing_detects(self):
        # prior bearish 100→98; this bar bullish 97.5→100.5 engulfs the prior body
        assert is_bullish_engulfing(100.0, 98.0, 97.5, 100.5)

    def test_bullish_requires_prior_bearish(self):
        assert not is_bullish_engulfing(98.0, 100.0, 97.5, 100.5)  # prior bullish → no

    def test_bearish_engulfing_detects(self):
        assert is_bearish_engulfing(98.0, 100.0, 100.5, 97.5)

    def test_equal_bodies_do_not_engulf(self):
        assert not is_bullish_engulfing(100.0, 98.0, 98.0, 100.0)  # same size body


class TestRejection:
    def test_upper_rejection_shooting_star(self):
        # o=100 c=100.5 h=103 l=99.8 → upper wick 2.5 = 5×body, 78% of range
        assert is_rejection_upper(100.0, 103.0, 99.8, 100.5)

    def test_lower_rejection_hammer(self):
        assert is_rejection_lower(100.5, 100.7, 97.5, 100.0)

    def test_balanced_bar_is_not_rejection(self):
        assert not is_rejection_upper(100.0, 101.0, 99.0, 100.9)  # big body, small wick

    def test_zero_range_bar_never_matches(self):
        assert not is_rejection_upper(100.0, 100.0, 100.0, 100.0)
        assert not is_rejection_lower(100.0, 100.0, 100.0, 100.0)
        assert not is_strong_close(100.0, 100.0, 100.0, 100.0)


class TestStrongClose:
    def test_conviction_candle(self):
        assert is_strong_close(100.0, 102.1, 99.9, 102.0)  # body 2.0 of range 2.2 ≈ 91%

    def test_indecision_candle(self):
        assert not is_strong_close(100.0, 102.0, 98.0, 100.2)  # body 0.2 of range 4.0


class TestWeakness:
    # MKsj idiolect: "valid high taken with weakness closing lower" — sweep-and-reject.
    O = [100.0, 100.5, 101.0, 102.0]
    H = [101.0, 101.5, 102.0, 103.5]   # bar 3 takes out the prior max high (102.0)
    L = [99.5, 100.0, 100.5, 100.8]
    C = [100.5, 101.0, 101.8, 101.0]   # bar 3 closes back BELOW 102.0 with a bearish body

    def test_sweep_and_reject_is_weakness(self):
        assert detect_weakness(self.O, self.H, self.L, self.C, i=3, lookback=3)

    def test_no_weakness_when_close_holds_above(self):
        c = [*self.C[:3], 103.2]  # takes the high AND closes above → continuation, not weakness
        assert not detect_weakness(self.O, self.H, self.L, c, i=3, lookback=3)

    def test_no_weakness_without_taking_the_high(self):
        h = [*self.H[:3], 101.9]  # never exceeds the reference high
        assert not detect_weakness(self.O, h, self.L, self.C, i=3, lookback=3)

    def test_explicit_reference_high(self):
        assert detect_weakness(self.O, self.H, self.L, self.C, i=3, reference_high=102.5)
        assert not detect_weakness(self.O, self.H, self.L, self.C, i=3, reference_high=104.0)

    def test_strength_is_the_long_mirror(self):
        o = [100.0, 99.5, 99.0, 98.0]
        h = [100.5, 100.0, 99.5, 99.6]
        lo = [99.0, 98.5, 98.0, 96.5]   # bar 3 takes out prior min low (98.0)
        c = [99.5, 99.0, 98.2, 99.2]    # closes back above with bullish body
        assert detect_strength(o, h, lo, c, i=3, lookback=3)

    def test_bounds_are_safe(self):
        assert not detect_weakness(self.O, self.H, self.L, self.C, i=0)
        assert not detect_weakness(self.O, self.H, self.L, self.C, i=99)
