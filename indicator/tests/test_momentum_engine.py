import json
import random
import unittest

from indicator.reference.momentum_engine import (
    MomentumConfig,
    MomentumEngine,
    Side,
    Stage,
    TickEvent,
)


CFG = MomentumConfig(min_break=1.0, min_push=1.0, max_recoil=0.75, max_push_seconds=60.0)


def run(side, prices, times=None, bars=None):
    engine = MomentumEngine(side, CFG)
    engine.arm_reference(100.0, 0, "MNQ")
    if times is None:
        times = list(range(1, len(prices) + 1))
    if bars is None:
        bars = [0] * len(prices)
    for i, (p, t, b) in enumerate(zip(prices, times, bars), 1):
        engine.on_tick(TickEvent(b, i, float(t), float(p)))
    return engine


class MomentumEngineTests(unittest.TestCase):
    def test_clean_short(self):
        e = run(Side.SHORT, [98.8, 97.7, 96.6])
        self.assertEqual(e.stage, Stage.ENTRY_READY)

    def test_clean_long_mirror(self):
        e = run(Side.LONG, [101.2, 102.3, 103.4])
        self.assertEqual(e.stage, Stage.ENTRY_READY)

    def test_single_spike_advances_only_one_stage(self):
        e = run(Side.SHORT, [90.0])
        self.assertEqual(e.stage, Stage.BREAK)
        self.assertEqual(e.entry_count, 0)

    def test_repeated_equal_low_not_new_push(self):
        e = run(Side.SHORT, [98.8, 98.8, 98.8, 98.8])
        self.assertEqual(e.stage, Stage.BREAK)

    def test_hard_recoil_invalidates_chain(self):
        e = run(Side.SHORT, [98.8, 99.7, 98.0, 97.0])
        self.assertEqual(e.entry_count, 0)
        self.assertIn("RECOIL_RESET", [t.code for t in e.transitions])

    def test_new_bar_promotes_finished_low_and_resets(self):
        e = run(
            Side.SHORT,
            [98.8, 98.2, 98.5, 97.9, 96.8, 95.7],
            [1, 2, 3, 301, 302, 303],
            [0, 0, 0, 1, 1, 1],
        )
        resets = [t for t in e.transitions if t.code == "BAR_RESET"]
        self.assertEqual(len(resets), 1)
        self.assertAlmostEqual(resets[0].price, 98.2)

    def test_slow_push_does_not_qualify(self):
        e = run(Side.SHORT, [98.8, 97.7, 96.6], [1, 100, 200])
        self.assertEqual(e.entry_count, 0)

    def test_bad_price_fails_closed(self):
        e = MomentumEngine(Side.SHORT, CFG)
        e.arm_reference(100.0, 0, "MNQ")
        e.on_tick(TickEvent(0, 1, 1, float("nan")))
        e.on_tick(TickEvent(0, 2, 2, -1))
        self.assertEqual(e.entry_count, 0)
        self.assertEqual(len(e.errors), 2)

    def test_duplicate_event_fails_closed(self):
        e = MomentumEngine(Side.SHORT, CFG)
        e.arm_reference(100.0, 0, "MNQ")
        e.on_tick(TickEvent(0, 1, 1, 98.8))
        e.on_tick(TickEvent(0, 1, 2, 97.5))
        self.assertIn(("DUP_OR_OLD_EVENT", 1), e.errors)
        self.assertEqual(e.stage, Stage.BREAK)

    def test_out_of_order_time_fails_closed(self):
        e = MomentumEngine(Side.SHORT, CFG)
        e.arm_reference(100.0, 0, "MNQ")
        e.on_tick(TickEvent(0, 1, 10, 98.8))
        e.on_tick(TickEvent(0, 2, 9, 97.5))
        self.assertIn(("OUT_OF_ORDER_TIME", 2), e.errors)
        self.assertEqual(e.stage, Stage.BREAK)

    def test_symbol_change_clears_setup(self):
        e = MomentumEngine(Side.SHORT, CFG)
        e.arm_reference(100.0, 0, "MNQ")
        e.on_tick(TickEvent(0, 1, 1, 98.8))
        e.on_symbol_change("MNQZ6")
        self.assertIsNone(e.reference)
        self.assertEqual(e.stage, Stage.WAIT_BREAK)

    def test_snapshot_restore_determinism(self):
        seq = [99.5, 98.8, 98.2, 97.7, 97.2, 96.6, 96.2]
        a = MomentumEngine(Side.SHORT, CFG)
        a.arm_reference(100.0, 0, "MNQ")
        for i, p in enumerate(seq, 1):
            a.on_tick(TickEvent(0, i, i, p))

        b = MomentumEngine(Side.SHORT, CFG)
        b.arm_reference(100.0, 0, "MNQ")
        for i, p in enumerate(seq[:3], 1):
            b.on_tick(TickEvent(0, i, i, p))
        b = MomentumEngine.restore(json.loads(json.dumps(b.snapshot())))
        for i, p in enumerate(seq[3:], 4):
            b.on_tick(TickEvent(0, i, i, p))

        self.assertEqual(a.snapshot(), b.snapshot())

    def test_20k_long_short_mirror_property(self):
        rng = random.Random(20260809)
        for _ in range(20_000):
            p = 100.0
            short_path = []
            for _ in range(20):
                p += rng.gauss(0, 0.8)
                short_path.append(p)
            long_path = [200.0 - x for x in short_path]

            s = run(Side.SHORT, short_path)
            l = run(Side.LONG, long_path)

            sc = [t.code for t in s.transitions if t.code != "REFERENCE_ARMED"]
            lc = [t.code for t in l.transitions if t.code != "REFERENCE_ARMED"]
            self.assertEqual(sc, lc)

    def test_randomized_entry_chain_invariant(self):
        rng = random.Random(42)
        for case in range(50_000):
            side = Side.SHORT if case % 2 == 0 else Side.LONG
            e = MomentumEngine(side, CFG)
            e.arm_reference(100.0, 0, "MNQ")
            price = 100.0
            bar = 0
            for event_id in range(1, rng.randint(8, 40)):
                if event_id > 1 and rng.random() < 0.02:
                    bar += 1
                step = rng.gauss(0, 0.7)
                if rng.random() < 0.02:
                    step += rng.gauss(0, 4.0)
                price = max(1.0, price + step)
                e.on_tick(TickEvent(bar, event_id, event_id + bar * 300, price))

            for idx, tr in enumerate(e.transitions):
                if tr.code != "ENTRY_READY":
                    continue
                prior = [
                    x
                    for x in e.transitions[:idx]
                    if x.bar_id == tr.bar_id and x.code in {"BREAK", "PUSH_1"}
                ]
                self.assertIn("BREAK", [x.code for x in prior])
                self.assertIn("PUSH_1", [x.code for x in prior])
                break_id = max(x.event_id for x in prior if x.code == "BREAK")
                push_id = max(x.event_id for x in prior if x.code == "PUSH_1")
                self.assertLess(break_id, push_id)
                self.assertLess(push_id, tr.event_id)


if __name__ == "__main__":
    unittest.main()
