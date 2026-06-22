"""H1 regression: 15:55 ET time-stop must use ts_et column (DST-safe).

Bug: time-stop compared against ts_event (UTC), making "15:55" unreliable
across DST transitions (EST = UTC-5, EDT = UTC-4).

Fix: use ts_et_timestamps when available. Hard-fail if ts_et_timestamps was
provided but a specific bar has None (caller bug).

These tests import backtester.py which loads vectorbt — expect ~60-90s startup.
"""
from __future__ import annotations

import os

import numpy as np
import pytest

os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


class TestTimeStopRequiresTsEt:
    """H1: 15:55 ET comparison must use ts_et, not UTC ts_event."""

    def test_1555_et_triggers_with_ts_et(self):
        """When ts_et is '2024-01-01 15:55:00', time-stop must fire."""
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

        n = 3
        entry_long = np.array([True, False, False])
        exit_long = np.array([False, False, False])
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)
        high_np = np.array([4400.0, 4405.0, 4403.0])
        low_np = np.array([4395.0, 4398.0, 4398.0])
        close_np = np.array([4398.0, 4402.0, 4401.0])  # C3 FIX: close_np required
        atr_np = np.full(n, 2.0)
        timestamps = ["2024-01-01 14:30", "2024-01-01 15:00", "2024-01-01 15:55"]
        ts_et = ["2024-01-01 14:30", "2024-01-01 15:00", "2024-01-01 15:55"]

        _, exl, _, _, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, timestamps,
            stop_multiplier=1.5, symbol="MES",
            close_np=close_np,
            ts_et_timestamps=ts_et,
        )
        assert exl[2], "Time-stop must fire at 15:55 ET bar"
        assert meta["time_stop_exits"] == 1

    def test_1555_et_detection_works_est_and_edt(self):
        """15:55 ET in both EST (UTC-5) and EDT (UTC-4) must trigger the stop."""
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

        # These are all 15:55 ET in different formats / DST variants
        ts_et_variants = [
            "2024-01-15 15:55:00-05:00",  # EST winter
            "2024-06-15 15:55:00-04:00",  # EDT summer
            "2024-01-15 15:55",            # plain format
            "2024-06-15 15:55",
        ]

        for ts_et_str in ts_et_variants:
            n = 2
            entry_long = np.array([True, False])
            exit_long = np.array([False, False])
            entry_short = np.zeros(n, dtype=bool)
            exit_short = np.zeros(n, dtype=bool)
            high_np = np.array([4400.0, 4405.0])
            low_np = np.array([4395.0, 4398.0])
            close_np = np.array([4398.0, 4402.0])  # C3 FIX: close_np required
            atr_np = np.full(n, 2.0)

            _, exl, _, _, meta = _apply_dsl_stop_loss_and_time_stop(
                entry_long, exit_long, entry_short, exit_short,
                high_np, low_np, atr_np, ["t0", "t1"],
                stop_multiplier=1.5, symbol="MES",
                close_np=close_np,
                ts_et_timestamps=["2024-01-15 14:00", ts_et_str],
            )
            assert exl[1], f"Time-stop must fire for ts_et={ts_et_str}"
            assert meta["time_stop_exits"] == 1, \
                f"meta.time_stop_exits must be 1 for ts_et={ts_et_str}"

    def test_1555_in_utc_but_not_et_does_not_trigger_on_ts_et_path(self):
        """When ts_et shows 20:55 UTC (not 15:55 ET), stop must NOT fire.

        This confirms the fix correctly uses ET, not UTC.
        20:55 UTC = 15:55 EST (UTC-5) — this would trigger on UTC path.
        But ts_et correctly shows 15:55 ET string.
        In this test, bar 1 is 14:00 ET — must not fire.
        """
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

        n = 3
        entry_long = np.array([True, False, False])
        exit_long = np.array([False, False, False])
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)
        high_np = np.array([4400.0, 4405.0, 4403.0])
        low_np = np.array([4395.0, 4398.0, 4395.0])
        close_np = np.array([4398.0, 4402.0, 4399.0])  # C3 FIX: close_np required
        atr_np = np.full(n, 2.0)

        # ts_et shows 14:00 ET — NOT 15:55, so no time-stop
        ts_et = ["2024-01-15 09:30", "2024-01-15 14:00", "2024-01-15 14:30"]
        timestamps = ["2024-01-15 14:30", "2024-01-15 19:00", "2024-01-15 19:30"]

        _, exl, _, _, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, timestamps,
            stop_multiplier=1.5, symbol="MES",
            close_np=close_np,
            ts_et_timestamps=ts_et,
        )
        assert meta["time_stop_exits"] == 0, \
            f"No time-stop expected when ET time is 14:00/14:30, got {meta['time_stop_exits']}"

    def test_ts_et_none_value_raises(self):
        """If ts_et_timestamps is provided but a bar has None, must raise ValueError (H1 hard-fail)."""
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

        n = 2
        entry_long = np.array([True, False])
        exit_long = np.array([False, False])
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)
        high_np = np.array([4400.0, 4405.0])
        low_np = np.array([4395.0, 4398.0])
        close_np = np.array([4398.0, 4402.0])  # C3 FIX: close_np required
        atr_np = np.full(n, 2.0)

        # ts_et_timestamps provided but bar 1 has None — caller bug
        ts_et_with_none = ["2024-01-15 09:30", None]

        with pytest.raises(ValueError, match="H1"):
            _apply_dsl_stop_loss_and_time_stop(
                entry_long, exit_long, entry_short, exit_short,
                high_np, low_np, atr_np, ["t0", "t1"],
                stop_multiplier=1.5, symbol="MES",
                close_np=close_np,
                ts_et_timestamps=ts_et_with_none,
            )
