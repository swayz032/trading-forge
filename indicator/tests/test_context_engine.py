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
    def test_daily_bearish_macro_wins_over_bullish_4h_pullback_on_seed(self):
        engine = PersistentBigDirection()
        daily_bear = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        h4_bull_pullback = StructureSnapshot(close=99, high0=101, high1=97, low0=94, low1=90)
        self.assertEqual(engine.update(h4_bull_pullback, daily_bear), Dir.DOWN)
        self.assertEqual(engine.reason, "INITIALIZED_FROM_DAILY_MACRO_STRUCTURE")

    def test_bearish_macro_persists_through_large_bullish_4h_pullback(self):
        engine = PersistentBigDirection()
        daily_bear = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        h4_bear = StructureSnapshot(close=95, high0=100, high1=110, low0=90, low1=94)
        self.assertEqual(engine.update(h4_bear, daily_bear), Dir.DOWN)
        protected = engine.protected_level

        # 4H can become a large HH/HL countertrend rally while the Daily macro
        # structure is still lower-high/lower-low. BIG DIRECTION must stay DOWN.
        h4_big_uptrend = StructureSnapshot(close=103, high0=106, high1=101, low0=96, low1=90)
        self.assertEqual(engine.update(h4_big_uptrend, daily_bear), Dir.DOWN)
        self.assertEqual(engine.protected_level, daily_bear.high0)
        self.assertEqual(engine.reason, "BEARISH_DAILY_MACRO_PERSISTS")
        self.assertNotEqual(engine.protected_level, h4_big_uptrend.low0)
        self.assertTrue(protected is not None)

    def test_macro_flip_requires_protected_break_and_opposite_macro_structure(self):
        engine = PersistentBigDirection()
        daily_bear = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        h4_bear = StructureSnapshot(close=95, high0=100, high1=110, low0=90, low1=94)
        engine.update(h4_bear, daily_bear)

        # Bullish 4H alone cannot reverse a still-bearish Daily macro.
        h4_bull = StructureSnapshot(close=112, high0=115, high1=108, low0=101, low1=96)
        self.assertEqual(engine.update(h4_bull, daily_bear), Dir.DOWN)

        # Once Daily itself confirms opposite structure and closes through the
        # protected bearish high, the macro state can reverse.
        daily_bull_break = StructureSnapshot(close=118, high0=120, high1=110, low0=106, low1=98)
        self.assertEqual(engine.update(h4_bull, daily_bull_break), Dir.UP)
        self.assertEqual(
            engine.reason,
            "BEARISH_MACRO_INVALIDATED_AND_BULLISH_STRUCTURE_CONFIRMED",
        )

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

    def test_full_engine_keeps_macro_and_current_move_separate(self):
        engine = CanonicalContextEngine()
        daily = StructureSnapshot(close=95, high0=105, high1=115, low0=88, low1=92)
        h4_up_pullback = StructureSnapshot(close=103, high0=106, high1=101, low0=96, low1=90)
        m15_down = StructureSnapshot(close=95, high0=100, high1=105, low0=90, low1=92)
        state = engine.update(h4=h4_up_pullback, daily=daily, m15=m15_down)
        self.assertEqual(state.big_direction, Dir.DOWN)
        self.assertEqual(state.current_move, Dir.DOWN)
        self.assertEqual(relationship_label(state.big_direction, state.current_move), "📉 DOWN WITH DIRECTION")


if __name__ == "__main__":
    unittest.main()
