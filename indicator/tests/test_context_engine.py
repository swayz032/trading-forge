import unittest

from indicator.reference.context_engine import (
    CanonicalContextEngine,
    Dir,
    PersistentBigDirection,
    PersistentCurrentMove,
    StructureSnapshot,
    relationship_label,
)


class CanonicalContextEngineTests(unittest.TestCase):
    def test_bearish_big_direction_persists_through_bullish_pullback(self):
        engine = PersistentBigDirection()
        bearish = StructureSnapshot(close=95, high0=100, high1=110, low0=90, low1=94)
        daily_bear = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        self.assertEqual(engine.update(bearish, daily_bear), Dir.DOWN)
        protected = engine.protected_level

        # Strong rally / mixed-to-up local structure, but still below protected high
        # and Daily remains clearly bearish. BIG DIRECTION must not flip.
        pullback = StructureSnapshot(close=99, high0=98, high1=96, low0=93, low1=91)
        self.assertEqual(engine.update(pullback, daily_bear), Dir.DOWN)
        self.assertEqual(engine.protected_level, protected)
        self.assertEqual(engine.reason, "BEARISH_STATE_PERSISTS_THROUGH_PULLBACK")

    def test_big_direction_requires_protected_break_and_opposite_structure(self):
        engine = PersistentBigDirection()
        bearish = StructureSnapshot(close=95, high0=100, high1=110, low0=90, low1=94)
        daily_bear = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        engine.update(bearish, daily_bear)

        bullish_break = StructureSnapshot(close=112, high0=115, high1=108, low0=101, low1=96)
        # Daily still clearly bearish: veto final BIG DIRECTION flip.
        self.assertEqual(engine.update(bullish_break, daily_bear), Dir.DOWN)

        daily_mixed = StructureSnapshot(close=108, high0=116, high1=115, low0=95, low1=96)
        self.assertEqual(engine.update(bullish_break, daily_mixed), Dir.UP)

    def test_current_move_down_persists_until_lower_high_break(self):
        move = PersistentCurrentMove()
        bearish = StructureSnapshot(close=95, high0=100, high1=105, low0=90, low1=92)
        self.assertEqual(move.update(bearish), Dir.DOWN)

        bounce_below_lower_high = StructureSnapshot(close=99, high0=100, high1=105, low0=90, low1=92)
        self.assertEqual(move.update(bounce_below_lower_high), Dir.DOWN)

        bullish_bos = StructureSnapshot(close=101, high0=100, high1=105, low0=90, low1=92)
        self.assertEqual(move.update(bullish_bos), Dir.UP)
        self.assertEqual(move.reason, "BULLISH_15M_BOS")

    def test_relationship_labels(self):
        self.assertEqual(relationship_label(Dir.DOWN, Dir.UP), "📈 UP PULLBACK")
        self.assertEqual(relationship_label(Dir.DOWN, Dir.DOWN), "📉 DOWN WITH DIRECTION")
        self.assertEqual(relationship_label(Dir.UP, Dir.DOWN), "📉 DOWN PULLBACK")

    def test_full_engine_keeps_context_and_move_separate(self):
        engine = CanonicalContextEngine()
        h4 = StructureSnapshot(close=95, high0=100, high1=110, low0=90, low1=94)
        daily = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        m15_up = StructureSnapshot(close=99, high0=101, high1=98, low0=94, low1=92)
        state = engine.update(h4=h4, daily=daily, m15=m15_up)
        self.assertEqual(state.big_direction, Dir.DOWN)
        self.assertEqual(state.current_move, Dir.UP)
        self.assertEqual(relationship_label(state.big_direction, state.current_move), "📈 UP PULLBACK")


if __name__ == "__main__":
    unittest.main()
