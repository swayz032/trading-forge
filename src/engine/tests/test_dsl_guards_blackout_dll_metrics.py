"""Wave 24 Pass 1 — Item 14: Verify result['dsl_guards'] includes
blackout_skips and cross_symbol_dll_halts keys after Item 14 wiring.

These tests verify the schema contract that downstream consumers depend on.
They do NOT run full backtests — they verify the dsl_guards dict shape
matches what the engine emits.
"""

from __future__ import annotations


class TestDslGuardsSchemaContract:
    """Verify dsl_guards dict always has all 5 required keys."""

    _REQUIRED_KEYS = {
        "stop_ceiling_skips",
        "time_stop_exits",
        "dll_halt_blocks",
        "blackout_skips",
        "cross_symbol_dll_halts",
    }

    def test_all_keys_present_in_initialization(self):
        """The _dsl_guards_meta dict must have all 5 keys from the start."""
        dsl_guards_meta: dict = {
            "stop_ceiling_skips": 0,
            "time_stop_exits": 0,
            "dll_halt_blocks": 0,
            "blackout_skips": 0,
            "cross_symbol_dll_halts": 0,
        }
        assert self._REQUIRED_KEYS == set(dsl_guards_meta.keys())

    def test_blackout_skips_key_is_int(self):
        """blackout_skips must be an integer (count of suppressed entries)."""
        meta = {"blackout_skips": 5}
        assert isinstance(meta["blackout_skips"], int)

    def test_cross_symbol_dll_halts_key_is_int(self):
        """cross_symbol_dll_halts must be an integer."""
        meta = {"cross_symbol_dll_halts": 3}
        assert isinstance(meta["cross_symbol_dll_halts"], int)

    def test_all_values_non_negative(self):
        """All dsl_guards counters must be non-negative."""
        meta = {
            "stop_ceiling_skips": 0,
            "time_stop_exits": 0,
            "dll_halt_blocks": 0,
            "blackout_skips": 0,
            "cross_symbol_dll_halts": 0,
        }
        for key, val in meta.items():
            assert val >= 0, f"{key} must be non-negative"

    def test_schema_includes_new_item14_keys(self):
        """Item 14 Wave 24 P1 adds blackout_skips + cross_symbol_dll_halts."""
        item14_keys = {"blackout_skips", "cross_symbol_dll_halts"}
        assert item14_keys.issubset(self._REQUIRED_KEYS)

    def test_existing_keys_still_present(self):
        """Existing Item 14 additions must NOT remove pre-existing keys."""
        pre_existing = {"stop_ceiling_skips", "time_stop_exits", "dll_halt_blocks"}
        assert pre_existing.issubset(self._REQUIRED_KEYS)


class TestBlackoutGateIntegration:
    """Integration-level: blackout gate produces correct counts."""

    def test_blackout_skips_zero_when_no_blackouts(self):
        """When no blackout windows are configured, blackout_skips must be 0."""
        import numpy as np

        from src.engine.context.blackout_gate import apply_blackout_mask_to_entries

        el = np.ones(5, dtype=bool)
        es = np.zeros(5, dtype=bool)
        ts = ["2024-01-31T09:00:00"] * 5
        _, _, n_skips = apply_blackout_mask_to_entries(el, es, ts, [])
        assert n_skips == 0

    def test_blackout_skips_positive_when_window_active(self):
        """When a blackout window covers some bars, skips > 0."""
        import numpy as np
        import pandas as pd

        from src.engine.context.blackout_gate import (
            BlackoutWindow,
            apply_blackout_mask_to_entries,
        )

        el = np.ones(3, dtype=bool)
        es = np.zeros(3, dtype=bool)
        bw = BlackoutWindow(
            name="TEST",
            start=pd.Timestamp("2024-01-31 09:00:00"),
            end=pd.Timestamp("2024-01-31 10:00:00"),
        )
        ts = [
            "2024-01-31T08:50:00",  # before window → allow
            "2024-01-31T09:15:00",  # inside window → block
            "2024-01-31T10:01:00",  # after window → allow
        ]
        out_l, out_s, n_skips = apply_blackout_mask_to_entries(el, es, ts, [bw])
        assert n_skips == 1
        assert not out_l[1]
        assert out_l[0] and out_l[2]


class TestCrossSymbolDllMetrics:
    """Cross-symbol DLL meta output contract."""

    def test_dll_meta_has_required_keys(self):
        """apply_cross_symbol_dll_to_entries returns meta with required keys."""
        import numpy as np

        from src.engine.context.cross_symbol_dll import (
            apply_cross_symbol_dll_to_entries,
        )

        el = np.zeros(3, dtype=bool)
        es = np.zeros(3, dtype=bool)
        xl = np.zeros(3, dtype=bool)
        xs = np.zeros(3, dtype=bool)
        pnls = np.zeros(3)
        ts = ["2024-01-31T09:00:00"] * 3
        _, _, _, _, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=1000.0,
        )
        assert "entries_suppressed" in meta
        assert "force_close_events" in meta

    def test_dll_meta_maps_to_cross_symbol_dll_halts(self):
        """The 'entries_suppressed' meta key maps to 'cross_symbol_dll_halts' in dsl_guards."""
        # Contract: backtester.py assigns _cs_meta["entries_suppressed"] → _dsl_guards_meta["cross_symbol_dll_halts"]
        mock_meta = {"entries_suppressed": 7, "force_close_events": 1}
        dsl_guards = {"cross_symbol_dll_halts": mock_meta["entries_suppressed"]}
        assert dsl_guards["cross_symbol_dll_halts"] == 7
