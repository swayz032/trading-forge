import copy
import unittest

from indicator.reference.momentum_engine import (
    MomentumConfig,
    MomentumEngine,
    Side,
    TickEvent,
)


class HardeningTests(unittest.TestCase):
    def test_invalid_momentum_configs_are_rejected(self):
        bad = [
            dict(min_break=0, min_push=1, max_recoil=.5, max_push_seconds=60),
            dict(min_break=1, min_push=0, max_recoil=.5, max_push_seconds=60),
            dict(min_break=1, min_push=1, max_recoil=-.1, max_push_seconds=60),
            dict(min_break=1, min_push=1, max_recoil=.5, max_push_seconds=0),
            dict(min_break=float('nan'), min_push=1, max_recoil=.5, max_push_seconds=60),
        ]
        for kw in bad:
            with self.subTest(kw=kw), self.assertRaises(ValueError):
                MomentumConfig(**kw)

    def test_nonfinite_event_time_fails_closed(self):
        cfg = MomentumConfig(1, 1, .75, 60)
        e = MomentumEngine(Side.SHORT, cfg)
        e.arm_reference(100, 0, 'MNQ')
        self.assertIsNone(e.on_tick(TickEvent(0, 1, float('nan'), 98.5)))
        self.assertIn(('BAD_TIME', 1), e.errors)
        self.assertEqual(e.entry_count, 0)

    def test_snapshot_schema_is_required(self):
        cfg = MomentumConfig(1, 1, .75, 60)
        e = MomentumEngine(Side.SHORT, cfg)
        e.arm_reference(100, 0, 'MNQ')
        payload = e.snapshot()
        del payload['schema_version']
        with self.assertRaisesRegex(ValueError, 'SNAPSHOT_SCHEMA'):
            MomentumEngine.restore(payload)

    def test_unknown_future_snapshot_schema_rejected(self):
        cfg = MomentumConfig(1, 1, .75, 60)
        e = MomentumEngine(Side.SHORT, cfg)
        e.arm_reference(100, 0, 'MNQ')
        payload = e.snapshot()
        payload['schema_version'] = 999
        with self.assertRaisesRegex(ValueError, 'SNAPSHOT_SCHEMA'):
            MomentumEngine.restore(payload)

    def test_snapshot_restore_does_not_alias_mutable_transition_data(self):
        cfg = MomentumConfig(1, 1, .75, 60)
        e = MomentumEngine(Side.SHORT, cfg)
        e.arm_reference(100, 0, 'MNQ')
        e.on_tick(TickEvent(0, 1, 1, 98.5))
        payload = copy.deepcopy(e.snapshot())
        restored = MomentumEngine.restore(payload)
        payload['transitions'][0]['code'] = 'TAMPERED'
        self.assertNotEqual(restored.transitions[0].code, 'TAMPERED')

    def test_empty_symbol_is_never_accepted(self):
        cfg = MomentumConfig(1, 1, .75, 60)
        e = MomentumEngine(Side.SHORT, cfg)
        with self.assertRaises(ValueError):
            e.arm_reference(100, 0, '')
        with self.assertRaises(ValueError):
            e.on_symbol_change('')


if __name__ == '__main__':
    unittest.main()
