"""Deep-scan #22 Track X5 — failure-injection sweep, Control #8 (zero-volume
trade-critical bar wiring at the management-LOOP level).

`test_volume_zero_fail_loud.py` already RED-proves the pure guard function
`check_zero_volume_trade_critical()` in isolation (raises on volume=0 for a
stop/tp/entry action). It does not exercise the actual per-bar management loop
call site: does `_apply_static_styleC_management()` (the live Style C 33/33/34
path, `BACKTEST_STATIC_C_PARTIALS_ENABLED` default ON) really invoke the guard
when a bar that would otherwise trigger a stop/TP has volume=0? This module
closes that wiring gap with an end-to-end call into the real management
function (mocking vectorbt at sys.modules level so importing backtester.py
does not JIT-compile).

Covers:
  1. Fault injection: a long trade whose stop is hit on bar 2, with
     volume=0 on that exact bar -> `_apply_static_styleC_management()` must
     raise `ZeroVolumeOnTradeCriticalBar` (fail-loud default).
  2. Clean path: identical scenario but volume > 0 on the stop bar -> no
     exception; the trade manages normally (stop exit recorded).
  3. Env opt-out (`BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=false`)
     restores legacy silent-skip at the SAME call site (belt-and-suspenders:
     confirms the wiring honors the same env contract the pure-function tests
     already cover, at the loop level).
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest


def _install_vbt_mock():
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock


_install_vbt_mock()


class _Spec:
    tick_size = 0.25
    point_value = 5.0
    symbol = "MES"


def _make_stop_hit_scenario(
    entry_p: float = 5000.0,
    atr_val: float = 4.0,          # risk_points = min(14.0, 4.0*1.5) = 6.0 (MES ceiling not binding)
    tick: float = 0.25,
    n_bars: int = 6,
    stop_bar: int = 2,
    zero_vol_at_stop_bar: bool = True,
):
    """Long trade whose stop is hit exactly at `stop_bar`. All other bars are
    quiet (no stop/TP trigger) so the zero-volume guard, if it fires, fires on
    exactly that one bar."""
    risk_points = min(14.0, atr_val * 1.5)  # matches backtester's atr_fallback_points formula
    initial_stop = entry_p - risk_points

    n = n_bars
    highs = np.full(n, entry_p + tick * 2)     # quiet — never reaches TP1 (+1R = entry+risk_points)
    lows = np.full(n, initial_stop + 1.0)      # quiet everywhere except stop_bar
    lows[stop_bar] = initial_stop - 0.5        # breaches the stop on stop_bar

    closes = np.full(n, entry_p)
    opens = closes.copy()
    atr_np = np.full(n, atr_val)
    volumes = np.full(n, 5000.0)
    if zero_vol_at_stop_bar:
        volumes[stop_bar] = 0.0

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
        "volume": volumes,
    })

    spec = _Spec()
    spec.tick_size = tick
    return records, highs, lows, closes, opens, atr_np, df_bar, spec, risk_points, initial_stop


def _load_fn():
    from src.engine.backtester import _apply_static_styleC_management
    return _apply_static_styleC_management


class TestZeroVolumeStopBarRaisesFailLoud:
    def test_zero_volume_on_stop_bar_raises(self, monkeypatch):
        from src.engine.data_loader import ZeroVolumeOnTradeCriticalBar

        monkeypatch.setenv("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", "true")
        fn = _load_fn()
        records, highs, lows, closes, opens, atr_np, df_bar, spec, rp, initial_stop = (
            _make_stop_hit_scenario(zero_vol_at_stop_bar=True)
        )

        with pytest.raises(ZeroVolumeOnTradeCriticalBar) as exc_info:
            fn(
                trades_records=records, high_np=highs, low_np=lows, close_np=closes,
                atr_np=atr_np, spec=spec, htf_cache=None, df=df_bar, open_np=opens,
            )
        assert exc_info.value.symbol == "MES"
        assert "stop" in exc_info.value.attempted_action.lower() or "trigger" in exc_info.value.attempted_action.lower()

    def test_nonzero_volume_on_stop_bar_does_not_raise(self, monkeypatch):
        """Clean path: same stop-hit geometry, but volume > 0 on the stop bar
        — the trade must manage normally (no exception), proving the guard is
        actually keyed on volume, not on the stop trigger itself."""
        monkeypatch.setenv("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", "true")
        fn = _load_fn()
        records, highs, lows, closes, opens, atr_np, df_bar, spec, rp, initial_stop = (
            _make_stop_hit_scenario(zero_vol_at_stop_bar=False)
        )

        result = fn(
            trades_records=records, high_np=highs, low_np=lows, close_np=closes,
            atr_np=atr_np, spec=spec, htf_cache=None, df=df_bar, open_np=opens,
        )
        assert len(result) == 1, "Expected one managed trade result"
        trade = result[0]
        assert trade["exit_price"] < 5000.0, (
            f"Expected a stopped-out long trade (exit below entry); got exit_price={trade['exit_price']}"
        )

    def test_env_disabled_restores_silent_skip_at_loop_level(self, monkeypatch):
        """BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=false at the SAME call
        site: no exception, bar is skipped (management continues past it)."""
        monkeypatch.setenv("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", "false")
        fn = _load_fn()
        records, highs, lows, closes, opens, atr_np, df_bar, spec, rp, initial_stop = (
            _make_stop_hit_scenario(zero_vol_at_stop_bar=True)
        )

        # Must not raise despite volume=0 on the stop-triggering bar.
        result = fn(
            trades_records=records, high_np=highs, low_np=lows, close_np=closes,
            atr_np=atr_np, spec=spec, htf_cache=None, df=df_bar, open_np=opens,
        )
        assert len(result) == 1
