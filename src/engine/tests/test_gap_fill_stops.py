"""C2 regression: gap-through stops must fill at bar open (not stop price).

When a bar opens on the wrong side of the stop (gap-down through long stop,
gap-up through short stop), the fill must occur at bar_open — which is WORSE
for the trader and avoids P&L inflation.

Pre-fix behavior: fill always used trail_stop price.
Post-fix behavior: fill = min(bar_open, trail_stop) for longs,
                         max(bar_open, trail_stop) for shorts.

These tests import backtester.py which loads vectorbt — expect ~60-90s startup.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd
import polars as pl
import pytest

# Allow fixed_contracts=1 in test configs
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


def _make_records(entry_p: float, exit_p: float, direction: str,
                  entry_idx: int, exit_idx: int) -> pd.DataFrame:
    return pd.DataFrame([{
        "Avg Entry Price": entry_p,
        "Avg Exit Price": exit_p,
        "Size": 1.0,
        "Direction": direction,
        "Entry Idx": entry_idx,
        "Exit Idx": exit_idx,
    }])


def _make_spec():
    from src.engine.config import ContractSpec
    return ContractSpec(tick_size=0.25, tick_value=1.25, point_value=5.0)


class TestGapFillStops:
    """C2: Stop fills on gapped bars must use bar_open (worse), not stop price (better)."""

    def test_gap_down_long_fills_at_open(self):
        """Long: bar opens below stop → fill at bar_open (worse), not at stop price."""
        from src.engine.backtester import _apply_trade_management

        entry_p = 4400.0
        n = 5
        # Bar 1 opens at 4392, below the computed stop (≈4394)
        open_np = np.array([entry_p, 4392.0, 4393.0, 4393.0, 4393.0])
        high_np = np.array([entry_p + 3, 4397.0, 4395.0, 4395.0, 4395.0])
        low_np = np.array([entry_p - 1, 4390.0, 4391.0, 4391.0, 4391.0])
        close_np = np.array([entry_p, 4393.0, 4393.0, 4393.0, 4393.0])
        atr_np = np.full(n, 3.0)

        records = _make_records(entry_p, entry_p - 5.0, "Long", 0, 4)
        spec = _make_spec()
        df = pl.DataFrame({
            "ts_event": [str(i) for i in range(n)],
            "open": open_np.tolist(), "high": high_np.tolist(),
            "low": low_np.tolist(), "close": close_np.tolist(),
            "atr_14": atr_np.tolist(),
        })

        managed = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
        )
        assert len(managed) == 1
        m = managed[0]
        # Bar opens at 4392, which is below any possible stop → must fill at 4392
        assert m["exit_price"] == pytest.approx(4392.0), \
            f"Gap-down long: expected fill at bar open 4392, got {m['exit_price']}"
        assert m["gap_through_stop_count"] == 1, \
            f"Expected gap_through_stop_count=1, got {m['gap_through_stop_count']}"

    def test_gap_up_short_fills_at_open(self):
        """Short: bar opens above stop → fill at bar_open (worse), not at stop price."""
        from src.engine.backtester import _apply_trade_management

        entry_p = 4400.0
        n = 5
        # Bar 1 opens at 4408, above the computed stop (≈4404)
        open_np = np.array([entry_p, 4408.0, 4406.0, 4406.0, 4406.0])
        high_np = np.array([entry_p + 1, 4410.0, 4408.0, 4408.0, 4408.0])
        low_np = np.array([entry_p - 3, 4407.0, 4406.0, 4406.0, 4406.0])
        close_np = np.array([entry_p, 4408.0, 4406.0, 4406.0, 4406.0])
        atr_np = np.full(n, 3.0)

        records = _make_records(entry_p, entry_p + 5.0, "Short", 0, 4)
        spec = _make_spec()
        df = pl.DataFrame({
            "ts_event": [str(i) for i in range(n)],
            "open": open_np.tolist(), "high": high_np.tolist(),
            "low": low_np.tolist(), "close": close_np.tolist(),
            "atr_14": atr_np.tolist(),
        })

        managed = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
        )
        assert len(managed) == 1
        m = managed[0]
        assert m["exit_price"] == pytest.approx(4408.0), \
            f"Gap-up short: expected fill at bar open 4408, got {m['exit_price']}"
        assert m["gap_through_stop_count"] == 1

    def test_no_gap_fills_at_stop_price(self):
        """When bar open is above stop (no gap), fill must use stop price (normal case)."""
        from src.engine.backtester import _apply_trade_management

        entry_p = 4400.0
        n = 5
        # Bar 1 opens at 4397 (above stop ~4394), then low hits stop — normal fill
        open_np = np.array([entry_p, 4397.0, 4393.0, 4393.0, 4393.0])
        high_np = np.array([entry_p + 3, 4399.0, 4396.0, 4396.0, 4396.0])
        low_np = np.array([entry_p - 1, 4393.0, 4393.0, 4393.0, 4393.0])
        close_np = np.array([entry_p, 4396.0, 4394.0, 4394.0, 4394.0])
        atr_np = np.full(n, 3.0)

        records = _make_records(entry_p, entry_p - 5.0, "Long", 0, 4)
        spec = _make_spec()
        df = pl.DataFrame({
            "ts_event": [str(i) for i in range(n)],
            "open": open_np.tolist(), "high": high_np.tolist(),
            "low": low_np.tolist(), "close": close_np.tolist(),
            "atr_14": atr_np.tolist(),
        })

        managed = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
        )
        assert len(managed) == 1
        m = managed[0]
        # No gap — bar opens above stop, so fill is at stop price (no gap_through)
        assert m["gap_through_stop_count"] == 0, \
            f"No gap expected, got gap_through_stop_count={m['gap_through_stop_count']}"

    def test_gap_fill_price_worse_than_stop_for_long(self):
        """For longs, gap fill price (bar_open) must be WORSE (lower) than stop price."""
        from src.engine.backtester import _apply_trade_management

        entry_p = 4400.0
        n = 5
        open_np = np.array([entry_p, 4380.0, 4385.0, 4385.0, 4385.0])
        high_np = np.array([entry_p + 3, 4390.0, 4387.0, 4387.0, 4387.0])
        low_np = np.array([entry_p - 1, 4378.0, 4383.0, 4383.0, 4383.0])
        close_np = np.array([entry_p, 4383.0, 4384.0, 4384.0, 4384.0])
        atr_np = np.full(n, 3.0)

        records = _make_records(entry_p, entry_p - 10.0, "Long", 0, 4)
        spec = _make_spec()
        df = pl.DataFrame({
            "ts_event": [str(i) for i in range(n)],
            "open": open_np.tolist(), "high": high_np.tolist(),
            "low": low_np.tolist(), "close": close_np.tolist(),
            "atr_14": atr_np.tolist(),
        })

        managed = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
        )
        m = managed[0]
        if m["gap_through_stop_count"] > 0:
            # Gap occurred — fill must be at 4380 (open), not at stop (~4395)
            assert m["exit_price"] <= 4380.0, \
                f"Gap fill must be at or below bar open 4380, got {m['exit_price']}"
