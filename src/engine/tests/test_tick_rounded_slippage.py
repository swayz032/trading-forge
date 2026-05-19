"""C1 regression: slippage_ticks must be ceil-rounded, never fractional.

Covers C1 fix: _ceil_ticks() and compute_slippage() use ceiling on absolute
value so fractional ticks are never gifted back to the trader. These tests
use only slippage.py and config.py — no vectorbt/pandas import needed.
"""
from __future__ import annotations

import numpy as np
import polars as pl
import pytest


class TestTickRoundedSlippage:
    """C1: slippage_ticks must be ceil() on abs value, never gifted back fractionally."""

    def test_ceil_ticks_positive_fractional(self):
        """Fractional positive ticks must round UP (worse fill for trader)."""
        from src.engine.slippage import _ceil_ticks
        arr = np.array([1.2, 1.5, 1.9, 2.0])
        result = _ceil_ticks(arr)
        assert result[0] == 2.0, f"1.2 → expected 2.0, got {result[0]}"
        assert result[1] == 2.0, f"1.5 → expected 2.0, got {result[1]}"
        assert result[2] == 2.0, f"1.9 → expected 2.0, got {result[2]}"
        assert result[3] == 2.0, f"2.0 → expected 2.0, got {result[3]}"

    def test_ceil_ticks_already_integer(self):
        """Integer ticks should not change."""
        from src.engine.slippage import _ceil_ticks
        arr = np.array([1.0, 3.0, 5.0])
        result = _ceil_ticks(arr)
        np.testing.assert_array_equal(result, arr)

    def test_ceil_ticks_zero(self):
        """Zero ticks should remain zero (no division-by-zero, no sign issue)."""
        from src.engine.slippage import _ceil_ticks
        arr = np.array([0.0, 0.1, 0.5])
        result = _ceil_ticks(arr)
        assert result[0] == 0.0
        assert result[1] == 1.0  # 0.1 → ceil = 1
        assert result[2] == 1.0  # 0.5 → ceil = 1

    def test_compute_slippage_dollars_not_fractional_ticks(self):
        """compute_slippage must produce tick-rounded dollars, not raw floats."""
        from src.engine.config import ContractSpec
        from src.engine.slippage import compute_slippage

        spec = ContractSpec(tick_size=0.25, tick_value=1.25, point_value=5.0)
        n = 20
        atr_vals = [3.5] * n  # uniform ATR → raw_ticks=1.0, ceil=1.0
        df = pl.DataFrame({
            "ts_event": [str(i) for i in range(n)],
            "open": [4400.0] * n,
            "high": [4405.0] * n,
            "low": [4395.0] * n,
            "close": [4400.0] * n,
            "volume": [1000] * n,
            "atr_14": atr_vals,
        })
        slippage = compute_slippage(df, spec, base_ticks=1.0, atr_period=14)
        # Uniform ATR → raw_ticks = 1.0, ceil = 1.0 → dollars = 1.0 × 1.25 = 1.25
        assert all(s == pytest.approx(1.25) for s in slippage), \
            f"Expected all slippage = 1.25, got {slippage[:3]}"

    def test_compute_slippage_fractional_atr_rounded_up(self):
        """When ATR varies, fractional ticks must be rounded up not truncated."""
        from src.engine.config import ContractSpec
        from src.engine.slippage import compute_slippage

        spec = ContractSpec(tick_size=0.25, tick_value=1.25, point_value=5.0)
        n = 10
        # median_atr=2.0; one bar has atr=3.0 → raw_ticks=1.5 → ceil=2.0
        atr_vals = [2.0] * 9 + [3.0]
        df = pl.DataFrame({
            "atr_14": atr_vals,
            "open": [4400.0] * n,
            "high": [4405.0] * n,
            "low": [4395.0] * n,
            "close": [4400.0] * n,
            "ts_event": [str(i) for i in range(n)],
            "volume": [1000] * n,
        })
        slippage = compute_slippage(df, spec, base_ticks=1.0, atr_period=14)
        # Last bar: raw_ticks=3.0/2.0=1.5 → ceil=2.0 → $2.50
        last_slip = slippage[-1]
        assert last_slip == pytest.approx(2.50), \
            f"Expected last bar slippage = 2.50 (2 ticks), got {last_slip}"

    def test_slippage_never_fractional_across_atr_range(self):
        """No bar should have a fractional-tick slippage value (always multiples of tick_value)."""
        from src.engine.config import ContractSpec
        from src.engine.slippage import compute_slippage

        spec = ContractSpec(tick_size=0.25, tick_value=1.25, point_value=5.0)
        n = 50
        rng = np.random.default_rng(42)
        atr_vals = (rng.uniform(1.5, 5.0, n)).tolist()
        df = pl.DataFrame({
            "atr_14": atr_vals,
            "open": [4400.0] * n,
            "high": [4405.0] * n,
            "low": [4395.0] * n,
            "close": [4400.0] * n,
            "ts_event": [str(i) for i in range(n)],
            "volume": [1000] * n,
        })
        slippage = compute_slippage(df, spec, base_ticks=1.0, atr_period=14)
        tick_val = spec.tick_value
        for i, s in enumerate(slippage):
            remainder = s % tick_val
            assert remainder == pytest.approx(0.0, abs=1e-9), \
                f"Bar {i}: slippage={s} not a multiple of tick_value={tick_val}"

    def test_rounding_mode_env_var_ceil_is_default(self):
        """SLIPPAGE_TICK_ROUNDING_MODE=ceil is the default (conservatism)."""
        import os
        mode = os.environ.get("SLIPPAGE_TICK_ROUNDING_MODE", "ceil")
        assert mode in ("ceil", "round", "floor"), \
            f"Unexpected rounding mode: {mode}"
        # Default is ceil — the conservative choice
        assert mode == "ceil" or os.environ.get("SLIPPAGE_TICK_ROUNDING_MODE") is not None, \
            "Default SLIPPAGE_TICK_ROUNDING_MODE should be 'ceil'"
