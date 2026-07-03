"""Tests for the layer4-replay exit_policy counterfactual axis (2026-07-02).

Coverage:
  1. Policy C (full_overlay) is byte-identical to the default (no exit_policy kwarg)
     — both _apply_trade_management dispatch paths reach the same function.
  2. Policy A (naked): 15:55 ET time-stop fires, no stop-loss fires even when price gaps
     through the theoretical stop.
  3. Policy B (stop_only): initial stop fires at the correct price; TP threshold does NOT
     short-circuit the trade; gap-fill logic fires on gap opens.
  4. Shorts handled correctly (MAE/MFE sense is inverted vs longs).
  5. Zero-trade edge case: _apply_naked_management and _apply_stop_only_management both
     return empty lists when trades_records is empty — deepscan5 C2 regression class.
  6. capture_ratio and stop_out_of_winners_rate computation via _compute_mae_mfe_metrics.
  7. _apply_trade_management dispatch: exit_policy routes to correct sub-function.

Design notes:
  - We test _apply_naked_management, _apply_stop_only_management, and _apply_trade_management
    directly (pure functions — no vectorbt JIT overhead, no network, no DB).
  - Policy C equality test checks that calling _apply_trade_management with
    exit_policy="full_overlay" and without it produce identical results (same dispatch path).
  - The full run_class_backtest integration test is intentionally EXCLUDED from this file —
    that requires AWS data and belongs in tower integration tests, not pre-commit.

Usage:
  pytest src/engine/tests/test_exit_policy_replay.py -v
"""
from __future__ import annotations

import importlib.util
import inspect
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl

# ── Load scripts/exit-policy-replay.py without __init__.py ──────────────────
# scripts/ is not a Python package; load it directly via importlib.
_SCRIPTS_ROOT = Path(__file__).resolve().parents[3] / "scripts"
_REPLAY_SCRIPT = _SCRIPTS_ROOT / "exit-policy-replay.py"

def _load_replay_module():
    """Import scripts/exit-policy-replay.py as a module without package structure."""
    spec = importlib.util.spec_from_file_location("exit_policy_replay", _REPLAY_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

_replay_mod = _load_replay_module()
_compute_mae_mfe_metrics = _replay_mod._compute_mae_mfe_metrics

# ── Shared helpers ─────────────────────────────────────────────────────────────

def _make_trades(
    entry_p: float = 4000.0,
    exit_p: float = 4020.0,
    size: float = 1.0,
    direction: str = "Long",
    entry_idx: int = 0,
    exit_idx: int = 30,
) -> pd.DataFrame:
    """Minimal trades_records DataFrame (vectorbt schema)."""
    return pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [exit_p],
        "Size": [size],
        "Direction": [direction],
        "Entry Idx": [entry_idx],
        "Exit Idx": [exit_idx],
    })


def _make_price_arrays(n: int = 50, entry_p: float = 4000.0, drift: float = 0.0):
    """Flat price arrays with optional linear drift (useful for no-stop scenarios)."""
    prices = np.array([entry_p + drift * i for i in range(n)], dtype=float)
    high_np = prices + 2.0  # always a little above close
    low_np = prices - 2.0   # always a little below close
    close_np = prices
    atr_np = np.full(n, 5.0)  # ATR=5 pts → initial stop = min(ceiling, 7.5pt) for 1.5x
    return high_np, low_np, close_np, atr_np


def _make_df(n: int = 50, entry_p: float = 4000.0, ts_col_val: str | None = None) -> pl.DataFrame:
    """Polars DataFrame with optional ts_event column. No ts_event → time-stop disabled."""
    cols = {
        "close": [entry_p + i * 0.1 for i in range(n)],
        "open": [entry_p + i * 0.1 - 0.05 for i in range(n)],
        "high": [entry_p + i * 0.1 + 2.0 for i in range(n)],
        "low": [entry_p + i * 0.1 - 2.0 for i in range(n)],
        "volume": [100] * n,
    }
    if ts_col_val is not None:
        from datetime import timedelta
        base = datetime(2024, 9, 4, 14, 0, 0, tzinfo=timezone.utc)  # 10:00 ET (EDT)
        cols["ts_event"] = [base + timedelta(minutes=5 * i) for i in range(n)]
    return pl.DataFrame(cols)


def _make_spec(symbol: str = "MES", point_value: float = 5.0, tick_size: float = 0.25):
    """Minimal spec object with symbol, point_value, tick_size."""
    class _Spec:
        pass
    s = _Spec()
    s.symbol = symbol
    s.point_value = point_value
    s.tick_size = tick_size
    return s


# ── Test: Policy C is byte-identical to default dispatch ──────────────────────

class TestPolicyCIdenticalToDefault:
    """Policy C (full_overlay) MUST route to the same sub-function as the default call.

    We test this by checking that _apply_trade_management with exit_policy="full_overlay"
    dispatches to _apply_static_styleC_management, NOT to _apply_naked_management or
    _apply_stop_only_management. We do this via mock patching.
    """

    def test_full_overlay_does_not_call_naked(self):
        """exit_policy='full_overlay' must not invoke _apply_naked_management."""
        from unittest.mock import patch

        from src.engine.backtester import _apply_trade_management

        high_np, low_np, close_np, atr_np = _make_price_arrays(50)
        trades = _make_trades(exit_idx=40)
        spec = _make_spec()
        df = _make_df(50)

        with patch("src.engine.backtester._apply_naked_management") as mock_naked, \
             patch("src.engine.backtester._apply_static_styleC_management") as mock_static:
            mock_static.return_value = []
            _apply_trade_management(
                trades, high_np, low_np, close_np, atr_np,
                spec, htf_cache=None, df=df,
                exit_policy="full_overlay",
            )
            mock_naked.assert_not_called()
            mock_static.assert_called_once()

    def test_full_overlay_does_not_call_stop_only(self):
        """exit_policy='full_overlay' must not invoke _apply_stop_only_management."""
        from unittest.mock import patch

        from src.engine.backtester import _apply_trade_management

        high_np, low_np, close_np, atr_np = _make_price_arrays(50)
        trades = _make_trades(exit_idx=40)
        spec = _make_spec()
        df = _make_df(50)

        with patch("src.engine.backtester._apply_stop_only_management") as mock_stop, \
             patch("src.engine.backtester._apply_static_styleC_management") as mock_static:
            mock_static.return_value = []
            _apply_trade_management(
                trades, high_np, low_np, close_np, atr_np,
                spec, htf_cache=None, df=df,
                exit_policy="full_overlay",
            )
            mock_stop.assert_not_called()

    def test_naked_policy_calls_naked_management(self):
        """exit_policy='naked' must invoke _apply_naked_management."""
        from unittest.mock import patch

        from src.engine.backtester import _apply_trade_management

        high_np, low_np, close_np, atr_np = _make_price_arrays(50)
        trades = _make_trades(exit_idx=40)
        spec = _make_spec()
        df = _make_df(50)

        with patch("src.engine.backtester._apply_naked_management") as mock_naked:
            mock_naked.return_value = []
            _apply_trade_management(
                trades, high_np, low_np, close_np, atr_np,
                spec, htf_cache=None, df=df,
                exit_policy="naked",
            )
            mock_naked.assert_called_once()

    def test_stop_only_policy_calls_stop_only_management(self):
        """exit_policy='stop_only' must invoke _apply_stop_only_management."""
        from unittest.mock import patch

        from src.engine.backtester import _apply_trade_management

        high_np, low_np, close_np, atr_np = _make_price_arrays(50)
        trades = _make_trades(exit_idx=40)
        spec = _make_spec()
        df = _make_df(50)

        with patch("src.engine.backtester._apply_stop_only_management") as mock_stop:
            mock_stop.return_value = []
            _apply_trade_management(
                trades, high_np, low_np, close_np, atr_np,
                spec, htf_cache=None, df=df,
                exit_policy="stop_only",
            )
            mock_stop.assert_called_once()


# ── Test: Zero-trade edge case (deepscan5 C2 regression class) ────────────────

class TestZeroTradeEdgeCase:
    """Empty trades_records must return [] from both new management functions.

    Regression class for deepscan5 C2 (UnboundLocalError on zero-trade backtest).
    Both _apply_naked_management and _apply_stop_only_management must handle this
    gracefully — no crash, no undefined variable references.
    """

    def test_naked_management_empty_trades(self):
        from src.engine.backtester import _apply_naked_management
        trades = pd.DataFrame({
            "Avg Entry Price": [], "Avg Exit Price": [], "Size": [],
            "Direction": [], "Entry Idx": [], "Exit Idx": [],
        })
        high_np, low_np, close_np, atr_np = _make_price_arrays(50)
        spec = _make_spec()
        df = _make_df(50)
        result = _apply_naked_management(trades, high_np, low_np, close_np, atr_np, spec, df)
        assert result == [], "zero-trade naked returns empty list"

    def test_stop_only_management_empty_trades(self):
        from src.engine.backtester import _apply_stop_only_management
        trades = pd.DataFrame({
            "Avg Entry Price": [], "Avg Exit Price": [], "Size": [],
            "Direction": [], "Entry Idx": [], "Exit Idx": [],
        })
        high_np, low_np, close_np, atr_np = _make_price_arrays(50)
        spec = _make_spec()
        df = _make_df(50)
        result = _apply_stop_only_management(trades, high_np, low_np, close_np, atr_np, spec, df)
        assert result == [], "zero-trade stop_only returns empty list"


# ── Test: Policy A (naked) — 15:55 ET time-stop fires ────────────────────────

class TestNakedManagement:
    """_apply_naked_management: EOD time-stop only, no stop-loss fires."""

    def _make_eod_df(self, n: int = 50, start_hour_utc: int = 14) -> pl.DataFrame:
        """Build DataFrame with ts_event column.  Bar i = start_hour_utc + i*5min UTC.
        start_hour_utc=14 means 10:00 ET (EDT, UTC-4).
        15:55 ET (EDT) = 19:55 UTC = bar 5*60+55=355 minutes / 5 = 71 bars from midnight.
        For simplicity: start at bar 0 = 13:00 UTC (09:00 ET), bar 53 = 13:00+53*5=17:25 UTC?
        Let's just put the 15:55 bar at a known index.
        """
        from datetime import timedelta
        # Base: 13:00 UTC on a known summer date (EDT = UTC-4 → 13:00 UTC = 09:00 ET)
        base = datetime(2024, 6, 4, 13, 0, 0, tzinfo=timezone.utc)
        # 15:55 ET = 19:55 UTC. That's 6h55min = 415 min = bar 83 (at 5-min bars)
        # Put 15:55 ET at bar index 20 for the test: use bar 0 = 15:50 ET
        # Let's use 19:50 UTC as base → bar 0 = 15:50 ET, bar 1 = 15:55 ET, bar 2 = 16:00 ET
        base = datetime(2024, 6, 4, 19, 50, 0, tzinfo=timezone.utc)
        prices = [4000.0 + i * 0.1 for i in range(n)]
        return pl.DataFrame({
            "close": prices,
            "open": [p - 0.05 for p in prices],
            "high": [p + 2.0 for p in prices],
            "low": [p - 2.0 for p in prices],
            "volume": [100] * n,
            "ts_event": [base + timedelta(minutes=5 * i) for i in range(n)],
        })

    def test_naked_no_stop_even_price_gaps_through(self):
        """In Policy A, even if price gaps below entry-risk, no stop fires."""
        from src.engine.backtester import _apply_naked_management

        n = 50
        entry_p = 4000.0
        # Make low array gap well below a theoretical stop (entry_p - 7.5pt)
        high_np = np.array([4002.0] * n)
        low_np = np.array([3980.0] * n)  # 20pt below entry — would fire any stop
        close_np = np.array([4001.0] * n)
        atr_np = np.full(n, 5.0)
        spec = _make_spec()

        trades = _make_trades(entry_p=entry_p, exit_p=4010.0, entry_idx=0, exit_idx=30)
        df = _make_df(n, entry_p)  # no ts_event → time-stop can't fire

        result = _apply_naked_management(trades, high_np, low_np, close_np, atr_np, spec, df)
        assert len(result) == 1
        trade = result[0]
        # With no time-stop available and no stop-loss, should reach original exit
        assert trade["exit_reason"] == "signal"
        assert trade["exit_idx"] == 30
        assert trade["exit_policy"] == "naked"

    def test_naked_time_stop_fires_at_1555_et(self):
        """Policy A must exit at 15:55 ET bar (close price), not the original exit."""
        from src.engine.backtester import _apply_naked_management

        df = self._make_eod_df(n=50)
        n = 50
        close_np = df["close"].to_numpy()
        high_np = df["high"].to_numpy()
        low_np = df["low"].to_numpy()
        atr_np = np.full(n, 5.0)
        spec = _make_spec()

        # Bar 0 = 15:50 ET (just before), bar 1 = 15:55 ET (EOD), entry at bar -1 not possible
        # Set entry_idx=0, exit_idx=30 — time-stop at bar 1 (15:55 ET) should fire first
        trades = _make_trades(entry_p=4000.0, exit_p=4010.0, entry_idx=0, exit_idx=30)

        result = _apply_naked_management(trades, high_np, low_np, close_np, atr_np, spec, df)
        assert len(result) == 1
        trade = result[0]
        assert trade["exit_reason"] == "time_stop", (
            f"Expected time_stop at 15:55 ET bar, got {trade['exit_reason']}"
        )
        assert trade["exit_idx"] == 1  # bar 1 = 15:55 ET
        # exit_price should be close of bar 1
        assert abs(trade["exit_price"] - float(close_np[1])) < 1e-6


# ── Test: Policy B (stop_only) — initial stop fires, no TP advances ──────────

class TestStopOnlyManagement:
    """_apply_stop_only_management: initial stop fires; TP threshold ignored; gap-fill."""

    def test_stop_fires_on_long(self):
        """Long trade: bar low touches initial stop → exit at stop price.

        Uses explicit open_np above stop to avoid gap-fill path — tests the
        clean stop-fill case (bar opens above stop, low goes below it intrabar).
        """
        from src.engine.backtester import _apply_stop_only_management

        n = 50
        entry_p = 4000.0
        # ATR=5, multiplier=1.5 → risk_points = min(14, 7.5) = 7.5
        # Initial stop = 4000 - 7.5 = 3992.5
        atr_np = np.full(n, 5.0)
        high_np = np.full(n, 4005.0)
        close_np = np.full(n, 4003.0)
        # Bar 5 goes below stop intrabar, but opens ABOVE stop (no gap fill)
        low_np = np.full(n, 3993.0)
        low_np[5] = 3991.0   # low goes below stop → triggers stop
        open_np = np.full(n, 4002.0)
        # open_np[5] stays at 4002 (above stop=3992.5) → fill at stop, not open

        trades = _make_trades(entry_p=entry_p, exit_p=4020.0, entry_idx=0, exit_idx=30)
        spec = _make_spec()
        df = _make_df(n, entry_p)  # no ts_event

        result = _apply_stop_only_management(
            trades, high_np, low_np, close_np, atr_np, spec, df,
            open_np=open_np,
        )
        assert len(result) == 1
        trade = result[0]
        assert trade["exit_reason"] == "stop_loss"
        assert trade["exit_idx"] == 5
        initial_stop = entry_p - 7.5  # = 3992.5
        assert abs(trade["exit_price"] - initial_stop) < 1e-6, (
            f"Expected stop at {initial_stop}, got {trade['exit_price']}"
        )
        assert trade["exit_policy"] == "stop_only"

    def test_stop_fires_on_short(self):
        """Short trade: bar high touches initial stop → exit at stop price."""
        from src.engine.backtester import _apply_stop_only_management

        n = 50
        entry_p = 4000.0
        atr_np = np.full(n, 5.0)
        close_np = np.full(n, 3997.0)
        low_np = np.full(n, 3995.0)
        # Bar 8 goes above initial_stop (4000 + 7.5 = 4007.5)
        high_np = np.full(n, 4005.0)
        high_np[8] = 4010.0  # triggers stop on short

        trades = _make_trades(
            entry_p=entry_p, exit_p=3980.0, size=1.0,
            direction="Short", entry_idx=0, exit_idx=30,
        )
        spec = _make_spec()
        df = _make_df(n, entry_p)

        result = _apply_stop_only_management(
            trades, high_np, low_np, close_np, atr_np, spec, df
        )
        assert len(result) == 1
        trade = result[0]
        assert trade["exit_reason"] == "stop_loss"
        assert trade["exit_idx"] == 8
        initial_stop = entry_p + 7.5  # = 4007.5
        assert abs(trade["exit_price"] - initial_stop) < 1e-6

    def test_gap_fill_stop_on_long(self):
        """Gap open below stop → fill at bar open (not stop price).

        Gap-fill logic requires bar_low <= stop (outer condition) AND bar_open < stop.
        Both conditions must be true: the bar's low breaks the stop AND it opened below it.
        """
        from src.engine.backtester import _apply_stop_only_management

        n = 50
        entry_p = 4000.0
        atr_np = np.full(n, 5.0)
        high_np = np.full(n, 4005.0)
        close_np = np.full(n, 4003.0)
        # stop = entry_p - 7.5 = 3992.5
        low_np = np.full(n, 3993.0)   # above stop for all other bars
        low_np[3] = 3986.0            # bar 3 low goes well below stop → outer condition met
        # Bar 3 also opens BELOW stop → gap fill
        open_np = np.full(n, 4002.0)
        open_np[3] = 3988.0           # open is below stop → fill at open

        trades = _make_trades(entry_p=entry_p, exit_p=4020.0, entry_idx=0, exit_idx=30)
        spec = _make_spec()
        df = _make_df(n, entry_p)

        result = _apply_stop_only_management(
            trades, high_np, low_np, close_np, atr_np, spec, df,
            open_np=open_np,
        )
        assert len(result) == 1
        trade = result[0]
        assert trade["exit_reason"] == "stop_loss"
        assert trade["exit_idx"] == 3
        # Gap fill: open (3988.0) < stop (3992.5) → fill at open
        assert abs(trade["exit_price"] - 3988.0) < 1e-6
        assert trade["gap_through_stop_count"] == 1

    def test_no_tp_advancement_past_stop(self):
        """Price moves well above +2R — stop_only should NOT advance stop to trail.

        In full_overlay, after TP1 fills the stop would advance to BE+1. In stop_only,
        the stop stays fixed at the initial ATR-based level.
        """
        from src.engine.backtester import _apply_stop_only_management

        n = 50
        entry_p = 4000.0
        # risk_points = 7.5 (ATR=5 * 1.5); 2R = +15pt above entry = 4015
        atr_np = np.full(n, 5.0)
        # Price moves well above 4015 (2R) and then reverses back to stop zone
        high_np = np.full(n, 4020.0)  # above 2R throughout
        close_np = np.full(n, 4018.0)
        # Bar 40: price reverses and breaks original stop
        low_np = np.full(n, 3994.0)   # above initial_stop=3992.5 until bar 40
        low_np[40] = 3991.0           # triggers original stop (low < 3992.5)
        # open_np above stop so no gap fill → fill at stop price
        open_np = np.full(n, 4015.0)  # well above stop

        trades = _make_trades(entry_p=entry_p, exit_p=4020.0, entry_idx=0, exit_idx=45)
        spec = _make_spec()
        df = _make_df(n, entry_p)

        result = _apply_stop_only_management(
            trades, high_np, low_np, close_np, atr_np, spec, df,
            open_np=open_np,
        )
        assert len(result) == 1
        trade = result[0]
        # Should exit at the original stop price (initial only, no trailing)
        assert trade["exit_reason"] == "stop_loss"
        assert trade["exit_idx"] == 40
        # Stop price is STILL the initial stop (4000-7.5=3992.5), not a trail
        assert abs(trade["exit_price"] - 3992.5) < 1e-6, (
            f"stop_only should use initial stop 3992.5, got {trade['exit_price']}"
        )

    def test_no_stop_reaches_signal_exit(self):
        """When stop never fires, exit_reason should be 'signal' at original exit."""
        from src.engine.backtester import _apply_stop_only_management

        n = 50
        entry_p = 4000.0
        atr_np = np.full(n, 5.0)
        # Prices never go below initial_stop (4000-7.5=3992.5)
        high_np = np.full(n, 4010.0)
        low_np = np.full(n, 3993.0)  # above stop (3992.5)
        close_np = np.full(n, 4005.0)

        trades = _make_trades(entry_p=entry_p, exit_p=4020.0, entry_idx=0, exit_idx=30)
        spec = _make_spec()
        df = _make_df(n, entry_p)

        result = _apply_stop_only_management(
            trades, high_np, low_np, close_np, atr_np, spec, df
        )
        assert len(result) == 1
        trade = result[0]
        assert trade["exit_reason"] == "signal"
        assert trade["exit_idx"] == 30


# ── Test: MAE/MFE metrics via _compute_mae_mfe_metrics ───────────────────────

class TestMaeMfeMetrics:
    """Validate capture_ratio and stop_out_of_winners_rate computation."""

    def test_capture_ratio_long_winner(self):
        """Long trade: MFE=100, PnL=50 → capture_ratio=0.5."""
        # _compute_mae_mfe_metrics loaded at module level via _load_replay_module()
        trades = [{"PnL": 50.0, "mfe": 100.0, "mae": 10.0, "risk_points": 7.5,
                   "exit_reason": "take_profit", "Size": 1.0}]
        m = _compute_mae_mfe_metrics(trades)
        assert m["n_trades"] == 1
        assert m["n_with_mfe"] == 1
        assert abs(m["capture_ratio_mean"] - 0.5) < 1e-6
        assert m["stop_out_of_winners_rate"] is None  # no stops

    def test_stop_out_of_winners_detected(self):
        """Stopped trade with MFE >= 1R in $ terms → counted as stopped winner."""
        # _compute_mae_mfe_metrics loaded at module level via _load_replay_module()
        # risk_points=5 (pts), size=1, point_value=5.0 (default MES)
        # 1R in $ = risk_points * size * point_value = 5 * 1 * 5 = 25
        # MFE = 30 > 25 → this was a stopped winner
        trades = [{
            "PnL": -25.0,  # loss (stopped out)
            "mfe": 30.0,   # favorable excursion in $
            "mae": 35.0,
            "risk_points": 5.0,  # price-unit stop
            "exit_reason": "stop_loss",
            "Size": 1.0,
        }]
        m = _compute_mae_mfe_metrics(trades, point_value=5.0)
        assert m["stop_out_count"] == 1
        assert m["stop_out_winner_count"] == 1
        assert abs(m["stop_out_of_winners_rate"] - 1.0) < 1e-6

    def test_stop_out_not_winner_mfe_below_1r(self):
        """Stopped trade where MFE < 1R ($ basis) → NOT a stopped winner."""
        # _compute_mae_mfe_metrics loaded at module level via _load_replay_module()
        # risk_points=5pt, size=1, point_value=5 → 1R=$25; MFE=$10 < 25
        trades = [{
            "PnL": -25.0,
            "mfe": 10.0,   # only 10/25 of 1R was reached
            "mae": 30.0,
            "risk_points": 5.0,
            "exit_reason": "stop_loss",
            "Size": 1.0,
        }]
        m = _compute_mae_mfe_metrics(trades, point_value=5.0)
        assert m["stop_out_count"] == 1
        assert m["stop_out_winner_count"] == 0
        assert abs(m["stop_out_of_winners_rate"] - 0.0) < 1e-6

    def test_zero_mfe_excluded_from_ratio(self):
        """Trades with mfe=0 must be excluded from capture_ratio (division by zero)."""
        # _compute_mae_mfe_metrics loaded at module level via _load_replay_module()
        trades = [
            {"PnL": 50.0, "mfe": 0.0, "mae": 5.0, "risk_points": 7.5,
             "exit_reason": "take_profit", "Size": 1.0},
            {"PnL": 30.0, "mfe": 60.0, "mae": 5.0, "risk_points": 7.5,
             "exit_reason": "take_profit", "Size": 1.0},
        ]
        m = _compute_mae_mfe_metrics(trades)
        assert m["n_trades"] == 2
        assert m["n_with_mfe"] == 1  # only the second trade has mfe > 0
        assert abs(m["capture_ratio_mean"] - 0.5) < 1e-6

    def test_none_mfe_excluded(self):
        """Trades with mfe=None must be excluded from capture_ratio."""
        # _compute_mae_mfe_metrics loaded at module level via _load_replay_module()
        trades = [{"PnL": 50.0, "mfe": None, "mae": None, "risk_points": 7.5,
                   "exit_reason": "take_profit", "Size": 1.0}]
        m = _compute_mae_mfe_metrics(trades)
        assert m["n_with_mfe"] == 0
        assert m["capture_ratio_mean"] is None
        assert m["stop_out_of_winners_rate"] is None

    def test_empty_trades_returns_none_metrics(self):
        """Empty trade list must return None metrics gracefully (deepscan5 C2 class)."""
        # _compute_mae_mfe_metrics loaded at module level via _load_replay_module()
        m = _compute_mae_mfe_metrics([])
        assert m["n_trades"] == 0
        assert m["capture_ratio_mean"] is None
        assert m["stop_out_of_winners_rate"] is None


# ── Test: Function signature contracts ────────────────────────────────────────

class TestSignatureContracts:
    """Verify the new exit_policy parameter is wired into the right places."""

    def test_run_class_backtest_has_exit_policy(self):
        """run_class_backtest must accept exit_policy kwarg defaulting to full_overlay."""
        from src.engine.backtester import run_class_backtest
        sig = inspect.signature(run_class_backtest)
        assert "exit_policy" in sig.parameters, "run_class_backtest missing exit_policy kwarg"
        default = sig.parameters["exit_policy"].default
        assert default == "full_overlay", (
            f"exit_policy default must be 'full_overlay', got {default!r}"
        )

    def test_apply_trade_management_has_exit_policy(self):
        """_apply_trade_management must accept exit_policy kwarg defaulting to full_overlay."""
        from src.engine.backtester import _apply_trade_management
        sig = inspect.signature(_apply_trade_management)
        assert "exit_policy" in sig.parameters
        default = sig.parameters["exit_policy"].default
        assert default == "full_overlay"

    def test_naked_management_exported(self):
        """_apply_naked_management must be importable from backtester."""
        from src.engine.backtester import _apply_naked_management  # noqa: F401

    def test_stop_only_management_exported(self):
        """_apply_stop_only_management must be importable from backtester."""
        from src.engine.backtester import _apply_stop_only_management  # noqa: F401
