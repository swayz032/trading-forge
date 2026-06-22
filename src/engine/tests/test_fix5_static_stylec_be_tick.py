"""FIX 5 — TDD: _apply_static_styleC_management must move stop to BE+1 tick
on TP1/>=1R, not bare breakeven.

Bug: lines 966-971 in backtester.py set trail_stop = max(trail_stop, entry_p)
  (exact breakeven) on pnl_points >= risk_points. The adaptive path (line 1208)
  correctly does entry_p + tick. The paper style_d_handler.py computes
  be_stop_price = entry_price + tick_size (long). This is a confirmed parity break.

Fix: use entry_p + tick for long (entry_p - tick for short).

NOTE: backtester.py imports vectorbt which JIT-compiles on first import (WDAC env).
Mock sys.modules before importing backtester to avoid hang.

Design for testability:
  _apply_static_styleC_management calls compute_single_tp (structural DOL) which
  returns None when no HTF data is available → tp_price = +inf (long).
  This means the TP branch never fires in tests, letting us focus on the BE stop.
  We craft bars where bar 1 goes to >= 1R gain so that pnl_points >= risk_points
  on the trail-advance check (step 3 in the bar loop), then bars 2+ are quiet so
  we can read trail_stop_final.
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


_install_vbt_mock()

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402


class _Spec:
    tick_size = 0.25
    point_value = 5.0
    symbol = "MES"


def _make_long_scenario(
    entry_p: float = 5000.0,
    atr_val: float = 4.0,          # with multiplier 1.5 → risk_points = 6.0 min(6, 4*1.5)
    tick: float = 0.25,
    n_bars: int = 6,
    profit_bars: list[int] | None = None,  # bars where high goes to 1R+ above entry
):
    """Build a minimal long-trade scenario for _apply_static_styleC_management.

    risk_points = min(6.0, atr_val * 1.5) — must ensure this matches expectations.
    For atr_val=4.0: risk_points = min(6.0, 6.0) = 6.0
    initial_stop = entry_p - 6.0 = 4994.0

    We set highs on profit_bars to entry_p + risk_points (exactly 1R above entry).
    The TP is set to +inf (no HTF data → compute_single_tp returns None).
    The stop never fires (lows stay above initial_stop).
    """
    if profit_bars is None:
        profit_bars = [1]  # bar 1 hits 1R

    # risk_points computed same way as backtester
    risk_points = min(6.0, atr_val * 1.5)
    initial_stop = entry_p - risk_points

    n = n_bars
    highs = np.full(n, entry_p + tick * 2)   # quiet — below 1R
    lows = np.full(n, initial_stop + 0.5)     # quiet — above initial stop

    for bar in profit_bars:
        highs[bar] = entry_p + risk_points    # exactly 1R → pnl_points = risk_points

    closes = np.full(n, entry_p)
    opens = closes.copy()
    atr_np = np.full(n, atr_val)

    # Trade record: entry at bar 0, exit at last bar (signal exit — no stop/TP fires)
    records = pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [closes[-1]],
        "Size": [1.0],
        "Direction": ["Long Entry"],
        "Entry Idx": [0],
        "Exit Idx": [n - 1],
    })

    df_bar = pd.DataFrame({
        "ts_event": [f"2025-06-01T10:{i:02d}:00" for i in range(n)],
        "open": opens, "high": highs, "low": lows, "close": closes,
    })

    spec = _Spec()
    spec.tick_size = tick

    return records, highs, lows, closes, opens, atr_np, df_bar, spec, risk_points, initial_stop


def _make_short_scenario(
    entry_p: float = 5000.0,
    atr_val: float = 4.0,
    tick: float = 0.25,
    n_bars: int = 6,
    profit_bars: list[int] | None = None,
):
    """Short trade scenario: 1R gain when low = entry_p - risk_points."""
    if profit_bars is None:
        profit_bars = [1]

    risk_points = min(6.0, atr_val * 1.5)
    initial_stop = entry_p + risk_points

    n = n_bars
    lows = np.full(n, entry_p - tick * 2)    # quiet — above -1R
    highs = np.full(n, initial_stop - 0.5)   # quiet — below initial stop

    for bar in profit_bars:
        lows[bar] = entry_p - risk_points    # exactly 1R gain for short

    closes = np.full(n, entry_p)
    opens = closes.copy()
    atr_np = np.full(n, atr_val)

    records = pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [closes[-1]],
        "Size": [1.0],
        "Direction": ["Short Entry"],
        "Entry Idx": [0],
        "Exit Idx": [n - 1],
    })

    df_bar = pd.DataFrame({
        "ts_event": [f"2025-06-01T10:{i:02d}:00" for i in range(n)],
        "open": opens, "high": highs, "low": lows, "close": closes,
    })

    spec = _Spec()
    spec.tick_size = tick

    return records, highs, lows, closes, opens, atr_np, df_bar, spec, risk_points, initial_stop


class TestFix5StaticStyleCBeTick:
    """Static Style C BE stop must be entry_p +/- tick, not bare entry_p."""

    def _load_fn(self):
        from src.engine.backtester import _apply_static_styleC_management
        return _apply_static_styleC_management

    def _run_long(self, profit_bars=None, n_bars=6, atr_val=4.0, tick=0.25):
        fn = self._load_fn()
        records, highs, lows, closes, opens, atr_np, df_bar, spec, rp, initial_stop = (
            _make_long_scenario(profit_bars=profit_bars, n_bars=n_bars,
                                atr_val=atr_val, tick=tick)
        )
        result = fn(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
        )
        return result, rp, initial_stop

    def _run_short(self, profit_bars=None, n_bars=6, atr_val=4.0, tick=0.25):
        fn = self._load_fn()
        records, highs, lows, closes, opens, atr_np, df_bar, spec, rp, initial_stop = (
            _make_short_scenario(profit_bars=profit_bars, n_bars=n_bars,
                                 atr_val=atr_val, tick=tick)
        )
        result = fn(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
        )
        return result, rp, initial_stop

    # ── LONG: BE+1 tick ────────────────────────────────────────────────────────

    def test_long_be_stop_greater_than_bare_be(self):
        """After 1R, trail_stop must be > entry_p (not bare BE)."""
        entry_p = 5000.0
        tick = 0.25
        result, risk_points, initial_stop = self._run_long(profit_bars=[1], tick=tick)

        assert len(result) == 1, "Expected one managed trade"
        trade = result[0]
        assert trade["trail_stop_final"] > entry_p, (
            f"trail_stop_final={trade['trail_stop_final']:.4f} must be > "
            f"bare_be={entry_p:.4f} — FIX NOT APPLIED (was bare BE)"
        )

    def test_long_be_stop_is_exactly_entry_plus_tick(self):
        """After exactly 1R (bars 2+ are quiet, never reaching 2R), trail_stop
        must settle at entry_p + tick exactly."""
        entry_p = 5000.0
        tick = 0.25
        atr_val = 4.0
        risk_points = min(6.0, atr_val * 1.5)  # 6.0

        # 6 bars: bar 0 entry (quiet), bar 1 hits exactly 1R, bars 2-5 quiet
        # Ensure bars 2-5 never reach 2R so the 2R trail doesn't advance the stop
        fn = self._load_fn()
        n = 6
        highs = np.array([
            entry_p + 0.1,           # bar 0: entry bar
            entry_p + risk_points,   # bar 1: exactly 1R → BE move fires
            entry_p + 0.5,           # bar 2: quiet < 2R
            entry_p + 0.5,           # bar 3: quiet
            entry_p + 0.5,           # bar 4: quiet
            entry_p + 0.5,           # bar 5: quiet (exit by signal)
        ])
        initial_stop = entry_p - risk_points  # 4994.0
        lows = np.full(n, initial_stop + 0.5)  # never fires stop
        closes = np.full(n, entry_p)
        opens = closes.copy()
        atr_np = np.full(n, atr_val)

        import pandas as pd
        records = pd.DataFrame({
            "Avg Entry Price": [entry_p],
            "Avg Exit Price": [closes[-1]],
            "Size": [1.0],
            "Direction": ["Long Entry"],
            "Entry Idx": [0],
            "Exit Idx": [5],
        })
        df_bar = pd.DataFrame({
            "ts_event": [f"2025-06-01T10:0{i}:00" for i in range(n)],
            "open": opens, "high": highs, "low": lows, "close": closes,
        })

        spec = _Spec()
        spec.tick_size = tick

        result = fn(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
        )

        assert len(result) == 1
        trade = result[0]
        expected = entry_p + tick
        assert abs(trade["trail_stop_final"] - expected) < 1e-6, (
            f"trail_stop_final={trade['trail_stop_final']:.6f} != "
            f"BE+1tick={expected:.6f} (entry={entry_p} tick={tick})"
        )

    def test_long_be_not_applied_below_1r(self):
        """When high never reaches 1R, stop stays at initial level."""
        entry_p = 5000.0
        tick = 0.25
        atr_val = 4.0
        risk_points = min(6.0, atr_val * 1.5)  # 6.0
        initial_stop = entry_p - risk_points

        fn = self._load_fn()
        n = 5
        # Highs only go to 0.5R — never reach 1R
        highs = np.full(n, entry_p + risk_points * 0.5)
        lows = np.full(n, initial_stop + 0.5)
        closes = np.full(n, entry_p)
        opens = closes.copy()
        atr_np = np.full(n, atr_val)

        import pandas as pd
        records = pd.DataFrame({
            "Avg Entry Price": [entry_p],
            "Avg Exit Price": [closes[-1]],
            "Size": [1.0],
            "Direction": ["Long Entry"],
            "Entry Idx": [0],
            "Exit Idx": [4],
        })
        df_bar = pd.DataFrame({
            "ts_event": [f"2025-06-01T10:0{i}:00" for i in range(n)],
            "open": opens, "high": highs, "low": lows, "close": closes,
        })
        spec = _Spec()

        result = fn(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
        )

        assert len(result) == 1
        trade = result[0]
        assert abs(trade["trail_stop_final"] - initial_stop) < 1e-6, (
            f"trail_stop_final={trade['trail_stop_final']:.4f} should stay at "
            f"initial_stop={initial_stop:.4f} when profit < 1R"
        )

    # ── SHORT: BE+1 tick = entry_p - tick ─────────────────────────────────────

    def test_short_be_stop_less_than_bare_be(self):
        """After 1R gain (short), trail_stop must be < entry_p (BE-1 tick for short)."""
        entry_p = 5000.0
        tick = 0.25
        result, risk_points, initial_stop = self._run_short(profit_bars=[1], tick=tick)

        assert len(result) == 1
        trade = result[0]
        assert trade["trail_stop_final"] < entry_p, (
            f"trail_stop_final={trade['trail_stop_final']:.4f} must be < "
            f"bare_be={entry_p:.4f} for short — FIX NOT APPLIED"
        )

    def test_short_be_stop_is_exactly_entry_minus_tick(self):
        """After exactly 1R (short), trail_stop must settle at entry_p - tick."""
        entry_p = 5000.0
        tick = 0.25
        atr_val = 4.0
        risk_points = min(6.0, atr_val * 1.5)  # 6.0
        initial_stop = entry_p + risk_points

        fn = self._load_fn()
        n = 6
        # Bar 1: low = entry_p - risk_points → pnl_points = risk_points for short
        lows = np.array([
            entry_p - 0.1,             # bar 0: entry bar quiet
            entry_p - risk_points,     # bar 1: exactly 1R gain (short)
            entry_p - 0.5,             # bar 2: quiet
            entry_p - 0.5,             # bar 3: quiet
            entry_p - 0.5,             # bar 4: quiet
            entry_p - 0.5,             # bar 5: signal exit
        ])
        highs = np.full(n, initial_stop - 0.5)  # never fires stop
        closes = np.full(n, entry_p)
        opens = closes.copy()
        atr_np = np.full(n, atr_val)

        import pandas as pd
        records = pd.DataFrame({
            "Avg Entry Price": [entry_p],
            "Avg Exit Price": [closes[-1]],
            "Size": [1.0],
            "Direction": ["Short Entry"],
            "Entry Idx": [0],
            "Exit Idx": [5],
        })
        df_bar = pd.DataFrame({
            "ts_event": [f"2025-06-01T10:0{i}:00" for i in range(n)],
            "open": opens, "high": highs, "low": lows, "close": closes,
        })
        spec = _Spec()
        spec.tick_size = tick

        result = fn(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
        )

        assert len(result) == 1
        trade = result[0]
        expected = entry_p - tick
        assert abs(trade["trail_stop_final"] - expected) < 1e-6, (
            f"trail_stop_final={trade['trail_stop_final']:.6f} != "
            f"BE+1tick(short)={expected:.6f} (entry={entry_p} tick={tick})"
        )

    # ── Parity: static must match adaptive path ────────────────────────────────

    def test_be_stop_matches_adaptive_path_value(self):
        """The BE stop value set by the static path must equal entry_p + tick,
        matching the adaptive path (line 1208: `be_offset = tick; entry_p + be_offset`)."""
        entry_p = 4980.0
        tick = 0.25
        atr_val = 3.0
        risk_points = min(6.0, atr_val * 1.5)  # 4.5

        fn = self._load_fn()
        n = 5
        highs = np.array([
            entry_p + 0.1,
            entry_p + risk_points,  # 1R hit
            entry_p + 0.1,
            entry_p + 0.1,
            entry_p + 0.1,
        ])
        lows = np.full(n, entry_p - risk_points + 0.5)
        closes = np.full(n, entry_p)
        opens = closes.copy()
        atr_np = np.full(n, atr_val)

        import pandas as pd
        records = pd.DataFrame({
            "Avg Entry Price": [entry_p],
            "Avg Exit Price": [closes[-1]],
            "Size": [1.0],
            "Direction": ["Long Entry"],
            "Entry Idx": [0],
            "Exit Idx": [4],
        })
        df_bar = pd.DataFrame({
            "ts_event": [f"2025-06-01T10:0{i}:00" for i in range(n)],
            "open": opens, "high": highs, "low": lows, "close": closes,
        })
        spec = _Spec()
        spec.tick_size = tick

        result = fn(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
        )

        assert len(result) == 1
        trade = result[0]
        # Adaptive path sets: trail_stop = max(trail_stop, entry_p + tick)
        adaptive_be = entry_p + tick
        assert abs(trade["trail_stop_final"] - adaptive_be) < 1e-6, (
            f"Static path trail_stop_final={trade['trail_stop_final']:.6f} "
            f"!= adaptive BE+1tick={adaptive_be:.6f}"
        )
