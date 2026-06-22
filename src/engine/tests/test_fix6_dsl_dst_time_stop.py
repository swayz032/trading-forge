"""FIX 6 — TDD: _apply_dsl_stop_loss_and_time_stop must correctly detect
15:55 ET when ts_et_timestamps is None (legacy path).

Bug: the legacy fallback `"15:55" in ts_str` searches the RAW timestamp string.
When raw timestamps are UTC (Databento Parquet typical format), a Nov (EST)
bar at 15:55 ET = 20:55 UTC. The string "2024-11-15 20:55:00" does NOT contain
"15:55", so the time-stop MISSES in winter.

Fix: When ts_et_timestamps is None, parse the UTC timestamp and convert via
_dst_correct_et_hour() before checking "15:55".

NOTE: backtester.py imports vectorbt — mock before importing.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _install_vbt_mock():
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock
    return _vbt_mock


_install_vbt_mock()

import numpy as np  # noqa: E402


def _make_arrays(
    n: int,
    entry_bar: int,
    timestamp_strings: list[str],
    entry_p: float = 5000.0,
    risk_points: float = 4.0,
):
    """Build minimal signal arrays + price arrays for _apply_dsl_stop_loss_and_time_stop."""
    # Entry long at entry_bar; exit sentinel at last bar
    entry_long = np.zeros(n, dtype=bool)
    exit_long = np.zeros(n, dtype=bool)
    entry_short = np.zeros(n, dtype=bool)
    exit_short = np.zeros(n, dtype=bool)

    entry_long[entry_bar] = True

    # ATR that yields a stop distance well below ceiling (14pt for MES)
    atr_np = np.full(n, risk_points / 1.5)  # so stop_dist = 1.5 * ATR = risk_points

    # Price arrays: steady, no stop/TP hit during simulation
    close_np = np.full(n, entry_p)
    high_np = np.full(n, entry_p + 0.5)
    low_np = np.full(n, entry_p - 0.5)

    return entry_long, exit_long, entry_short, exit_short, high_np, low_np, atr_np, close_np


class TestFix6DslDstTimeStop:
    """DSL time-stop must fire at 15:55 ET regardless of DST offset in UTC."""

    def _load_fn(self):
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop
        return _apply_dsl_stop_loss_and_time_stop

    # ── Case 1: Summer (EDT, UTC-4) — should already work ────────────────────

    def test_summer_1555_et_fires_timestop(self):
        """Jun bar at 15:55 ET = 19:55 UTC. UTC string contains 19:55, not 15:55.
        The fix must detect this as 15:55 ET via DST-correct conversion."""
        fn = self._load_fn()
        n = 5
        entry_bar = 1
        # UTC timestamps: bar 3 is 15:55 ET = 19:55 UTC in summer (EDT)
        timestamps = [
            "2025-06-15 09:30:00+00:00",  # 05:30 ET — quiet
            "2025-06-15 14:00:00+00:00",  # 10:00 ET — entry
            "2025-06-15 18:00:00+00:00",  # 14:00 ET — quiet
            "2025-06-15 19:55:00+00:00",  # 15:55 ET (EDT) = 19:55 UTC
            "2025-06-15 20:00:00+00:00",  # 16:00 ET — after close
        ]

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar, timestamps)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=None,  # Force legacy path — the one being fixed
        )

        assert meta["time_stop_exits"] >= 1, (
            f"Expected time_stop_exits >= 1 for summer 15:55 ET bar, "
            f"got time_stop_exits={meta['time_stop_exits']} (legacy UTC path missing DST fix)"
        )
        # The exit should be set at bar 3 (the 15:55 ET bar)
        assert bool(xl_out[3]), (
            "exit_long must be True at bar 3 (15:55 ET = 19:55 UTC summer)"
        )

    # ── Case 2: Winter (EST, UTC-5) — the bug ────────────────────────────────

    def test_winter_1555_et_fires_timestop(self):
        """Nov bar at 15:55 ET = 20:55 UTC (EST). UTC string '20:55' does NOT
        contain '15:55' — the old bug would MISS this. Fix must fire."""
        fn = self._load_fn()
        n = 5
        entry_bar = 1
        # UTC timestamps: bar 3 is 15:55 ET = 20:55 UTC in winter (EST)
        timestamps = [
            "2024-11-15 14:30:00+00:00",  # 09:30 ET (EST) — open
            "2024-11-15 15:00:00+00:00",  # 10:00 ET — entry
            "2024-11-15 19:00:00+00:00",  # 14:00 ET — quiet
            "2024-11-15 20:55:00+00:00",  # 15:55 ET (EST) = 20:55 UTC ← THE BUG BAR
            "2024-11-15 21:00:00+00:00",  # 16:00 ET — after close
        ]

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar, timestamps)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=None,  # Force legacy path — the bug lives here
        )

        assert meta["time_stop_exits"] >= 1, (
            f"REGRESSION: time_stop_exits={meta['time_stop_exits']} — "
            f"winter 15:55 ET bar (20:55 UTC) was NOT detected. "
            f"Legacy UTC string-match '15:55' in '20:55:00' fails for EST."
        )
        assert bool(xl_out[3]), (
            "exit_long must be True at bar 3 (15:55 ET = 20:55 UTC winter/EST)"
        )

    # ── Case 3: Non-1555 bar must NOT fire ───────────────────────────────────

    def test_winter_1500_et_does_not_fire_timestop(self):
        """15:00 ET bar must NOT trigger the time-stop (only 15:55 does)."""
        fn = self._load_fn()
        n = 4
        entry_bar = 0
        # Bar 2: 15:00 ET (EST) = 20:00 UTC
        timestamps = [
            "2024-11-15 14:30:00+00:00",  # 09:30 ET — entry
            "2024-11-15 18:00:00+00:00",  # 13:00 ET — quiet
            "2024-11-15 20:00:00+00:00",  # 15:00 ET (EST) = 20:00 UTC — should NOT fire
            "2024-11-15 20:30:00+00:00",  # 15:30 ET — quiet
        ]

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar, timestamps)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=None,
        )

        assert meta["time_stop_exits"] == 0, (
            f"15:00 ET bar must NOT trigger time-stop, "
            f"got time_stop_exits={meta['time_stop_exits']}"
        )
        assert not bool(xl_out[2]), (
            "exit_long must NOT be set at bar 2 (15:00 ET = 20:00 UTC)"
        )

    # ── Case 4: ts_et_timestamps provided — existing behavior unchanged ───────

    def test_with_ts_et_still_works(self):
        """When ts_et_timestamps is provided, the existing ts_et path is used
        (unchanged). This test ensures we didn't break it."""
        fn = self._load_fn()
        n = 4
        entry_bar = 0
        utc_timestamps = [
            "2024-11-15 14:30:00+00:00",
            "2024-11-15 18:00:00+00:00",
            "2024-11-15 20:55:00+00:00",  # 15:55 ET (EST)
            "2024-11-15 21:30:00+00:00",
        ]
        # ET equivalents passed explicitly
        et_timestamps = [
            "2024-11-15 09:30:00",   # 09:30 ET
            "2024-11-15 13:00:00",   # 13:00 ET
            "2024-11-15 15:55:00",   # 15:55 ET — should fire
            "2024-11-15 16:30:00",   # 16:30 ET
        ]

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar, utc_timestamps)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(utc_timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=et_timestamps,  # Explicit ET column
        )

        assert meta["time_stop_exits"] >= 1, (
            "ts_et path must still fire at 15:55 ET"
        )
        assert bool(xl_out[2]), (
            "exit_long must be True at bar 2 when ts_et='15:55' provided explicitly"
        )
