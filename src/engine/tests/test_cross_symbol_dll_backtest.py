"""Wave 24 Pass 1 — Item 14: Cross-symbol DLL backtest parity tests.

Verifies:
  - Single-symbol degenerate case (one symbol's P&L tracks DLL)
  - Multi-symbol 67% halt suppresses new entries
  - 95% force-closes open positions
  - Session resets at day boundary
  - evaluate_cross_symbol_dll pure-function contract
"""

from __future__ import annotations

import numpy as np

from src.engine.context.cross_symbol_dll import (
    apply_cross_symbol_dll_to_entries,
    evaluate_cross_symbol_dll,
)

# ─── evaluate_cross_symbol_dll ────────────────────────────────────────────────

class TestEvaluateCrossSymbolDll:
    def test_no_loss_no_halt(self):
        halt, force = evaluate_cross_symbol_dll(session_pnl=0.0, firm_dll=1000.0)
        assert halt is False
        assert force is False

    def test_profit_never_halts(self):
        halt, force = evaluate_cross_symbol_dll(session_pnl=500.0, firm_dll=1000.0)
        assert halt is False
        assert force is False

    def test_below_halt_threshold_no_halt(self):
        # 66% of $1000 DLL → below 67% threshold
        halt, force = evaluate_cross_symbol_dll(session_pnl=-660.0, firm_dll=1000.0)
        assert halt is False
        assert force is False

    def test_at_halt_threshold_halts(self):
        # exactly 67% of $1000 DLL = -$670
        halt, force = evaluate_cross_symbol_dll(session_pnl=-670.0, firm_dll=1000.0)
        assert halt is True
        assert force is False

    def test_above_halt_threshold_halts(self):
        halt, force = evaluate_cross_symbol_dll(session_pnl=-800.0, firm_dll=1000.0)
        assert halt is True
        assert force is False

    def test_at_force_close_threshold(self):
        # 95% of $1000 DLL = -$950
        halt, force = evaluate_cross_symbol_dll(session_pnl=-950.0, firm_dll=1000.0)
        assert halt is True
        assert force is True

    def test_above_force_close_threshold(self):
        halt, force = evaluate_cross_symbol_dll(session_pnl=-1000.0, firm_dll=1000.0)
        assert halt is True
        assert force is True

    def test_zero_firm_dll_never_halts(self):
        halt, force = evaluate_cross_symbol_dll(session_pnl=-5000.0, firm_dll=0.0)
        assert halt is False
        assert force is False

    def test_custom_halt_pct(self):
        halt, force = evaluate_cross_symbol_dll(
            session_pnl=-500.0, firm_dll=1000.0, halt_pct=0.5,
        )
        assert halt is True

    def test_custom_force_close_pct(self):
        halt, force = evaluate_cross_symbol_dll(
            session_pnl=-800.0, firm_dll=1000.0, halt_pct=0.67, force_close_pct=0.80,
        )
        assert halt is True
        assert force is True


# ─── apply_cross_symbol_dll_to_entries ───────────────────────────────────────

class TestApplyCrossSymbolDll:
    """Integration tests for the full bar-by-bar DLL application."""

    def _make_signals(self, n: int, long_idxs: list[int] | None = None) -> tuple:
        el = np.zeros(n, dtype=bool)
        es = np.zeros(n, dtype=bool)
        xl = np.zeros(n, dtype=bool)
        xs = np.zeros(n, dtype=bool)
        if long_idxs:
            for i in long_idxs:
                el[i] = True
        return el, es, xl, xs

    def _make_timestamps(self, n: int, single_day: str = "2024-01-31") -> list[str]:
        return [f"{single_day}T{9 + i // 4:02d}:{(i % 4) * 15:02d}:00" for i in range(n)]

    def test_degenerate_single_symbol_no_loss_no_halt(self):
        """Single symbol with zero P&L: no entries suppressed."""
        n = 10
        el, es, xl, xs = self._make_signals(n, long_idxs=[0, 5, 9])
        pnls = np.zeros(n)
        ts = self._make_timestamps(n)
        out_el, out_es, out_xl, out_xs, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=1000.0,
        )
        assert meta["entries_suppressed"] == 0
        # All long entries survived
        assert out_el[0] is np.bool_(True)
        assert out_el[5] is np.bool_(True)
        assert out_el[9] is np.bool_(True)

    def test_halt_blocks_new_entries_at_67pct(self):
        """After cumulative session loss >= 67% DLL, new entries are suppressed."""
        n = 10
        el, es, xl, xs = self._make_signals(n, long_idxs=[0, 5])
        # Build P&L array: bar 3 has a big loss that triggers halt at 67% of $1000
        pnls = np.zeros(n)
        pnls[3] = -700.0  # -$700 > 67% of $1000 DLL → halt
        ts = self._make_timestamps(n)
        out_el, out_es, out_xl, out_xs, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=1000.0,
        )
        # Bar 0 entry: before loss → not suppressed
        assert out_el[0] is np.bool_(True)
        # Bar 5 entry: after loss → suppressed
        assert out_el[5] is np.bool_(False)
        assert meta["entries_suppressed"] >= 1

    def test_force_close_sets_exit_signals(self):
        """At 95% DLL breach, exit signals are set for the breach bar."""
        n = 10
        el, es, xl, xs = self._make_signals(n, long_idxs=[0])
        # Bar 3: cumulative loss crosses 95% of $1000 DLL
        pnls = np.zeros(n)
        pnls[3] = -960.0
        ts = self._make_timestamps(n)
        out_el, out_es, out_xl, out_xs, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=1000.0,
        )
        # Exit signal set at breach bar
        assert out_xl[3] is np.bool_(True)
        assert meta["force_close_events"] >= 1

    def test_session_reset_at_day_boundary(self):
        """Session P&L resets at day boundary — halt from day N does not carry to day N+1."""
        n = 6
        el, es, xl, xs = self._make_signals(n, long_idxs=[0, 3])
        # Day 1 bars: 0,1,2 — big loss on bar 1 → halt on bar 2
        # Day 2 bars: 3,4,5 — no loss, new entries allowed
        pnls = np.zeros(n)
        pnls[1] = -700.0  # triggers halt within day 1
        ts = [
            "2024-01-31T09:00:00",
            "2024-01-31T09:15:00",
            "2024-01-31T09:30:00",
            "2024-02-01T09:00:00",  # new day → session reset
            "2024-02-01T09:15:00",
            "2024-02-01T09:30:00",
        ]
        out_el, out_es, out_xl, out_xs, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=1000.0,
        )
        # Day 1 bar 0: no loss yet → allowed
        assert out_el[0] is np.bool_(True)
        # Day 2 bar 3: session reset → allowed again
        assert out_el[3] is np.bool_(True)

    def test_no_firm_dll_zero_no_halt(self):
        """firm_dll=0 → no halting even with massive losses."""
        n = 5
        el, es, xl, xs = self._make_signals(n, long_idxs=[0, 1, 2, 3, 4])
        pnls = np.full(n, -10_000.0)
        ts = self._make_timestamps(n)
        out_el, out_es, out_xl, out_xs, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=0.0,
        )
        assert meta["entries_suppressed"] == 0

    def test_meta_keys_always_present(self):
        """Result meta must always have entries_suppressed and force_close_events."""
        n = 3
        el, es, xl, xs = self._make_signals(n)
        pnls = np.zeros(n)
        ts = self._make_timestamps(n)
        _, _, _, _, meta = apply_cross_symbol_dll_to_entries(
            el, es, xl, xs, pnls, ts, firm_dll=1000.0,
        )
        assert "entries_suppressed" in meta
        assert "force_close_events" in meta
