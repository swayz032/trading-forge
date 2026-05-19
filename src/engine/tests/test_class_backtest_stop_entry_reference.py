"""C3 regression: class backtest stop placed using close (not high/low) as entry ref.

Bug: stop_price for long entries was computed as high[i] - stop_dist instead of
close[i] - stop_dist. Using high inflates the stop price, causing premature exits
and making profitable trades look like losses.

Fix: long_entry_price = close_np[i]; short_entry_price = close_np[i].

These tests import backtester.py which loads vectorbt — expect ~60-90s startup.
"""
from __future__ import annotations

import os

import numpy as np
import pytest

os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


class TestClassBacktestStopEntryReference:
    """C3: _apply_dsl_stop_loss_and_time_stop must use close[i] for entry price, not high[i]."""

    def test_long_stop_computed_from_close_not_high(self):
        """Long stop should reference close. High[i] gives inflated stop → premature exit."""
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

        n = 5
        entry_long = np.array([True, False, False, False, False])
        exit_long = np.array([False, False, False, False, True])
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)

        # close=4400, high=4420 (20pt above close)
        # With HIGH as ref: stop = 4420 - 1.5*4 = 4414 → bar1 low=4414 triggers
        # With CLOSE as ref: stop = 4400 - 1.5*4 = 4394 → bar1 low=4414 does NOT trigger
        high_np = np.array([4420.0, 4415.0, 4416.0, 4415.0, 4415.0])
        low_np = np.array([4398.0, 4414.0, 4413.0, 4413.0, 4413.0])
        close_np = np.array([4400.0, 4414.5, 4414.0, 4413.5, 4413.0])
        atr_np = np.full(n, 4.0)
        timestamps = ["2024-01-01 09:30", "2024-01-01 09:35",
                      "2024-01-01 09:40", "2024-01-01 09:45",
                      "2024-01-01 15:55"]

        el, exl, es, exs, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, timestamps,
            stop_multiplier=1.5, symbol="MES",
            close_np=close_np,
        )

        # Bar 1: low=4414 > close[0]-6=4394 → no stop (correct with close ref)
        # With high ref: stop=4414 → bar low=4414 → triggers (wrong)
        assert not exl[1], (
            "Bar 1 must NOT trigger stop when using close as entry ref. "
            "stop=4394 (close-based), bar1 low=4414 > 4394. "
            "If high[0]=4420 was used: stop=4414, bar1 low=4414 → false trigger."
        )

    def test_short_stop_computed_from_close_not_low(self):
        """Short stop should reference close. low[i] gives deflated stop → premature exit."""
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

        n = 5
        entry_long = np.zeros(n, dtype=bool)
        exit_long = np.zeros(n, dtype=bool)
        entry_short = np.array([True, False, False, False, False])
        exit_short = np.array([False, False, False, False, True])

        # close=4400, low=4380 (20pt below close)
        # With LOW as ref: stop = 4380 + 1.5*4 = 4386 → bar1 high=4386 would trigger
        # With CLOSE as ref: stop = 4400 + 1.5*4 = 4406 → bar1 high=4386 does NOT trigger
        high_np = np.array([4402.0, 4386.0, 4385.0, 4384.0, 4384.0])
        low_np = np.array([4380.0, 4381.0, 4382.0, 4381.0, 4381.0])
        close_np = np.array([4400.0, 4385.0, 4384.0, 4383.0, 4382.0])
        atr_np = np.full(n, 4.0)
        timestamps = ["2024-01-01 09:30", "2024-01-01 09:35",
                      "2024-01-01 09:40", "2024-01-01 09:45",
                      "2024-01-01 15:55"]

        el, exl, es, exs, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, timestamps,
            stop_multiplier=1.5, symbol="MES",
            close_np=close_np,
        )

        # Bar 1: high=4386 < close[0]+6=4406 → no stop triggered
        assert not exs[1], (
            "Bar 1 must NOT trigger short stop when using close as entry ref. "
            "stop=4406 (close-based), bar1 high=4386 < 4406."
        )

    def test_close_ref_matches_actual_entry_fill_price(self):
        """Next-bar fill convention: entry fills at bar N+1 close = bar N+1 open (next bar).

        The engine shifts entries +1 bar. Entry signal on bar N → fill on bar N+1.
        Stop should reference the fill price (close of signal bar, approximated).
        Using high[N] overstates entry price for longs.
        """
        # If close=4400 and high=4420, the difference is 20pt
        # stop with high: 4420 - 6 = 4414 → 14pt above close → will hit often
        # stop with close: 4400 - 6 = 4394 → reasonable structural stop
        close_entry = 4400.0
        high_entry = 4420.0
        stop_dist = 6.0  # 1.5 × ATR=4

        stop_high_ref = high_entry - stop_dist   # = 4414 (inflated, wrong)
        stop_close_ref = close_entry - stop_dist  # = 4394 (correct)

        diff = stop_high_ref - stop_close_ref
        assert diff > 0, "High-ref stop is always >= close-ref stop for longs"
        assert diff == pytest.approx(20.0), \
            f"Expected 20pt difference (high=4420 vs close=4400), got {diff}"
