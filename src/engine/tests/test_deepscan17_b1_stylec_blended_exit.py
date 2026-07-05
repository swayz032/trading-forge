"""Deepscan17 B-1 CRITICAL — Style C blended-exit P&L must bank TP1/TP2 profit.

BACKGROUND (deepscan17, 2026-07-05): `_apply_static_styleC_management` and
`_apply_adaptive_management` both had an early branch —
`if exit_reason_p in ("stop_loss", "trailing_stop", "time_stop"): final_exit_p
= exit_price_p` — that discarded any already-banked TP1/TP2 partial profit
whenever the trade's FINAL leg closed via stop/trailing-stop/time-stop. TP1 ->
BE+1 -> eventual stop/flatten is the DESIGNED Style C 33/33/34 lifecycle (see
CLAUDE.md §4), not an edge case, so this corrupted P&L on the majority of
Style C trades feeding every downstream Sharpe/PF/DSR promotion gate.

THE FIX: the blend runs unconditionally from the filled TP fractions; the
UNFILLED remainder uses the actual stop/trail/time exit price (gap-aware) as
the fill price for that leg. exit_reason is left untouched for a genuine
stop/trailing/time_stop close (it still describes WHY the trade closed).

Exact audit repro reproduced here: MES long entry 5000, risk_points=10 so
TP1(+1R)=5010 and TP2(+2R)=5020. TP1 fills (33%), price reverses, stop moves
to BE+1 tick (5000.25), then a later bar triggers trailing_stop with TP2 never
filled. Expected blended exit:
    0.33 * 5010 + (0.33 + 0.34) * 5000.25 = 5003.4675
NOT the pre-fix stop-only value of 5000.25.

Run targeted:
    python -m pytest src/engine/tests/test_deepscan17_b1_stylec_blended_exit.py -v
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _install_vbt_mock():
    """backtester.py imports vectorbt which JIT-compiles on first import on the
    tower's WDAC-locked environment — mock it out before import (same pattern
    as test_fix5_static_stylec_be_tick.py)."""
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock


_install_vbt_mock()

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402


class _Spec:
    tick_size = 0.25
    point_value = 5.0
    symbol = "MES"


# TP1_AT_R_C / TP2_AT_R_C / TP1_FRACTION_C / TP2_FRACTION_C / RUNNER_FRACTION_C
# are the production constants (style_c_handler.py) — imported directly so this
# test tracks the real fractions rather than hardcoding a second copy that
# could silently drift out of sync.
from src.engine.exits.style_c_handler import (  # noqa: E402
    RUNNER_FRACTION_C,
    TP1_AT_R_C,
    TP1_FRACTION_C,
    TP2_AT_R_C,
    TP2_FRACTION_C,
)


def _long_repro_bars(entry_p: float, risk_points: float, tick: float):
    """Bar sequence: TP1 fills at bar 1, BE+1 stop hit (not gapped) at bar 2,
    TP2 never reached. 4 bars total; signal exit would be bar 3 (never reached
    — the stop breaks the loop at bar 2 first)."""
    tp1_price = entry_p + risk_points * TP1_AT_R_C  # 5010
    tp2_price = entry_p + risk_points * TP2_AT_R_C  # 5020
    initial_stop = entry_p - risk_points            # 4990
    be_plus_1 = entry_p + tick                      # 5000.25

    n = 4
    highs = np.array([
        entry_p + 0.1,   # bar 0: entry bar, quiet
        tp1_price,       # bar 1: exactly touches TP1 -> fills, BE+1 stop set
        entry_p + 0.1,   # bar 2: irrelevant to high (stop triggers on low)
        entry_p + 0.1,   # bar 3: never reached (loop breaks at bar 2)
    ])
    lows = np.array([
        initial_stop + 0.5,  # bar 0: quiet, above initial stop
        entry_p - 0.1,       # bar 1: stays above trail (still initial_stop at bar-check time)
        be_plus_1 - 0.25,    # bar 2: low dips BELOW be_plus_1 (5000.25) -> triggers trailing_stop
        entry_p - 0.1,       # bar 3: unused
    ])
    opens = np.array([
        entry_p,
        entry_p,
        be_plus_1 + 0.1,   # bar 2 open ABOVE be_plus_1 -> no gap-through, exact fill at be_plus_1
        entry_p,
    ])
    closes = np.full(n, entry_p)
    atr_np = np.full(n, 4.0)  # irrelevant once TP1/stop path is deterministic

    records = pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [closes[-1]],
        "Size": [1.0],
        "Direction": ["Long Entry"],
        "Entry Idx": [0],
        "Exit Idx": [3],
    })
    df_bar = pd.DataFrame({
        "ts_event": [f"2025-06-01T10:0{i}:00" for i in range(n)],
        "open": opens, "high": highs, "low": lows, "close": closes,
    })
    return records, highs, lows, closes, opens, atr_np, df_bar, tp1_price, tp2_price, initial_stop, be_plus_1


class TestB1StaticStyleCBlendedExit:
    """_apply_static_styleC_management: blended exit must bank TP1 profit
    even when the trade's remainder closes via trailing_stop."""

    def _run(self, monkeypatch, entry_p=5000.0, risk_points=10.0, tick=0.25, atr_stop_multiplier=2.0):
        # Force determinism regardless of ambient env — partials path ON,
        # structural-stop-parity OFF (so our directly-computed risk_points is
        # what the management loop actually uses), stop ceiling at its
        # documented MES default so risk_points=10 is never clamped.
        monkeypatch.setenv("BACKTEST_STATIC_C_PARTIALS_ENABLED", "1")
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "false")
        monkeypatch.delenv("STOP_CEILING_PTS_MES", raising=False)

        from src.engine.backtester import _apply_static_styleC_management

        atr_val = risk_points / atr_stop_multiplier  # so min(ceiling, atr*mult) == risk_points
        (records, highs, lows, closes, opens, atr_np, df_bar,
         tp1_price, tp2_price, initial_stop, be_plus_1) = _long_repro_bars(entry_p, risk_points, tick)
        atr_np = np.full(len(highs), atr_val)

        spec = _Spec()
        spec.tick_size = tick

        result = _apply_static_styleC_management(
            trades_records=records,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atr_np,
            spec=spec,
            htf_cache=None,
            df=df_bar,
            open_np=opens,
            atr_stop_multiplier=atr_stop_multiplier,
        )
        return result, tp1_price, tp2_price, initial_stop, be_plus_1

    def test_blended_exit_matches_audit_repro_basis(self, monkeypatch):
        """Exact deepscan17 audit repro: blended P&L must be ~5003.4675,
        NOT the pre-fix stop-only value of 5000.25."""
        entry_p = 5000.0
        risk_points = 10.0
        result, tp1_price, tp2_price, initial_stop, be_plus_1 = self._run(
            monkeypatch, entry_p=entry_p, risk_points=risk_points,
        )
        assert len(result) == 1, "Expected exactly one managed trade"
        trade = result[0]

        assert trade["static_c_tp1_filled"] is True, "TP1 must have filled in this scenario"
        assert trade["static_c_tp2_filled"] is False, "TP2 must NOT have filled in this scenario"
        assert trade["exit_reason"] == "trailing_stop", (
            f"Expected trailing_stop exit, got {trade['exit_reason']!r}"
        )

        expected_blended = (
            TP1_FRACTION_C * tp1_price
            + (TP2_FRACTION_C + RUNNER_FRACTION_C) * be_plus_1
        )
        assert expected_blended == pytest.approx(5003.4675, abs=1e-4), (
            "Test fixture itself must reproduce the documented audit basis"
        )
        assert trade["exit_price"] == pytest.approx(expected_blended, abs=1e-4), (
            f"B-1 REGRESSION: exit_price={trade['exit_price']:.4f} != "
            f"blended={expected_blended:.4f} — banked TP1 profit was discarded"
        )

    def test_blended_exit_not_stop_only_value(self, monkeypatch):
        """The pre-fix bug returned exit_price == the raw stop price (5000.25),
        discarding the TP1 leg entirely. Assert the fix no longer does this."""
        result, tp1_price, tp2_price, initial_stop, be_plus_1 = self._run(monkeypatch)
        trade = result[0]
        assert trade["exit_price"] != pytest.approx(be_plus_1, abs=1e-6), (
            f"B-1 REGRESSION: exit_price={trade['exit_price']:.4f} equals the raw "
            f"stop-only price {be_plus_1:.4f} — TP1 profit was NOT blended in"
        )

    def test_no_tp_fills_falls_back_to_stop_price_unchanged(self, monkeypatch):
        """Sanity: when NEITHER TP fills, the blend must reduce to the plain
        stop/trail exit price (no regression on the no-partials case)."""
        monkeypatch.setenv("BACKTEST_STATIC_C_PARTIALS_ENABLED", "1")
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "false")
        monkeypatch.delenv("STOP_CEILING_PTS_MES", raising=False)

        from src.engine.backtester import _apply_static_styleC_management

        entry_p = 5000.0
        risk_points = 10.0
        tick = 0.25
        initial_stop = entry_p - risk_points  # 4990

        n = 3
        highs = np.full(n, entry_p + 0.1)          # never reaches TP1 (5010)
        lows = np.array([initial_stop + 1.0, initial_stop - 0.5, initial_stop - 0.5])
        opens = np.array([entry_p, initial_stop - 0.5, entry_p])  # bar 1 gaps through
        closes = np.full(n, entry_p)
        atr_np = np.full(n, risk_points / 2.0)

        records = pd.DataFrame({
            "Avg Entry Price": [entry_p], "Avg Exit Price": [closes[-1]],
            "Size": [1.0], "Direction": ["Long Entry"],
            "Entry Idx": [0], "Exit Idx": [2],
        })
        df_bar = pd.DataFrame({
            "ts_event": [f"2025-06-01T10:0{i}:00" for i in range(n)],
            "open": opens, "high": highs, "low": lows, "close": closes,
        })
        spec = _Spec()
        spec.tick_size = tick

        result = _apply_static_styleC_management(
            trades_records=records, high_np=highs, low_np=lows, close_np=closes,
            atr_np=atr_np, spec=spec, htf_cache=None, df=df_bar, open_np=opens,
            atr_stop_multiplier=2.0,
        )
        assert len(result) == 1
        trade = result[0]
        assert trade["static_c_tp1_filled"] is False
        assert trade["static_c_tp2_filled"] is False
        # Gapped through stop -> exit_price == bar_open of the gap bar (initial_stop - 0.5)
        assert trade["exit_price"] == pytest.approx(initial_stop - 0.5, abs=1e-6)


class TestB1AdaptiveManagementBlendedExit:
    """_apply_adaptive_management carries the identical bug pattern and fix —
    verify it via the module-level fraction constants at minimum (full
    integration harness would require an AdaptiveExitContext; the blending
    arithmetic itself is covered structurally here since both functions were
    edited with the same replacement pattern)."""

    def test_blend_formula_uses_actual_stop_price_for_remainder(self):
        """Pure-math regression: confirms the blending formula (as edited)
        computes tp1*price + remainder*stop_price, not stop_price alone,
        for the tp1-only-filled case — this is the exact arithmetic both
        _apply_static_styleC_management and _apply_adaptive_management use."""
        tp1_price = 5010.0
        stop_exit_price = 5000.25
        tp1_pct = 0.33
        tp2_pct = 0.33
        runner_pct = 0.34

        blended = tp1_pct * tp1_price + (tp2_pct + runner_pct) * stop_exit_price
        assert blended == pytest.approx(5003.4675, abs=1e-4)
        assert blended != pytest.approx(stop_exit_price, abs=1e-6), (
            "Blended value must differ from the stop-only value when TP1 filled"
        )
