"""Cross-symbol DLL enforcement for multi-symbol backtests.

Ports evaluateCrossSymbolDll() semantics from
src/server/services/cross-symbol-pnl.ts into the Python backtest engine.

Paper-side rules (from cross-symbol-pnl.ts):
  - 67% firm DLL across ALL symbols in the same session → halt new entries
  - 95% firm DLL across ALL symbols in the same session → force-close all open positions

Backtester applies this bar-by-bar against the cumulative session P&L
tracked across all symbols in the run.

Single-symbol backtest: degenerate case — same math applied to one symbol's
session P&L. Consistent with paper-side where a single-symbol account still
has a cross-symbol DLL of [that one symbol].

Wave 24 Pass 1 (2026-05-23): Item 14 — cross-symbol DLL backtest parity.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np

# ─── Constants (overridable via env) ─────────────────────────────────────────

_DLL_HALT_PCT: float = float(os.environ.get("DLL_HALT_PCT", "0.67"))
_DLL_FORCE_CLOSE_PCT: float = float(os.environ.get("DLL_FORCE_CLOSE_PCT", "0.95"))


@dataclass
class CrossSymbolDllState:
    """Mutable per-session state for cross-symbol DLL tracking.

    Reset at each session boundary (new trading day).

    Attributes:
        session_pnl: Cumulative realized + unrealized P&L this session
            across ALL symbols in the backtest run (dollars).
        halted: Whether new entries are blocked (67% DLL breached).
        force_closed: Whether all positions have been force-closed (95% DLL breached).
        entries_suppressed: Count of entry signals suppressed by DLL halt.
        force_close_events: Count of force-close events triggered.
    """

    session_pnl: float = 0.0
    halted: bool = False
    force_closed: bool = False
    entries_suppressed: int = 0
    force_close_events: int = 0


def evaluate_cross_symbol_dll(
    session_pnl: float,
    firm_dll: float,
    halt_pct: float = _DLL_HALT_PCT,
    force_close_pct: float = _DLL_FORCE_CLOSE_PCT,
) -> tuple[bool, bool]:
    """Compute halt and force-close signals from session P&L vs firm DLL.

    Args:
        session_pnl:    Cumulative session P&L across all symbols (dollars).
                        Losses are negative.
        firm_dll:       Firm daily loss limit as a positive dollar amount.
        halt_pct:       Fraction of firm DLL that triggers a halt on new entries.
        force_close_pct: Fraction of firm DLL that triggers force-close.

    Returns:
        (should_halt_entries, should_force_close)
        Both are False when session_pnl is non-negative.
    """
    if firm_dll <= 0:
        return False, False

    loss = -session_pnl  # positive when losing
    if loss <= 0:
        return False, False

    halt_threshold = firm_dll * halt_pct
    force_close_threshold = firm_dll * force_close_pct

    should_force_close = loss >= force_close_threshold
    should_halt = loss >= halt_threshold or should_force_close

    return should_halt, should_force_close


def apply_cross_symbol_dll_to_bar(
    bar_idx: int,
    entry_long: "np.ndarray",
    entry_short: "np.ndarray",
    exit_long: "np.ndarray",
    exit_short: "np.ndarray",
    bar_dollar_pnl: float,
    state: CrossSymbolDllState,
    firm_dll: float,
    halt_pct: float = _DLL_HALT_PCT,
    force_close_pct: float = _DLL_FORCE_CLOSE_PCT,
    session_reset: bool = False,
) -> CrossSymbolDllState:
    """Apply cross-symbol DLL logic for a single bar.

    Mutates entry/exit arrays in-place and updates state.

    Args:
        bar_idx:        Index into the bar arrays.
        entry_long:     Boolean numpy array (mutated in-place).
        entry_short:    Boolean numpy array (mutated in-place).
        exit_long:      Boolean numpy array (mutated in-place on force-close).
        exit_short:     Boolean numpy array (mutated in-place on force-close).
        bar_dollar_pnl: Realized P&L for this bar (dollars, negative = loss).
        state:          Current DLL state (mutated in-place and returned).
        firm_dll:       Firm daily loss limit (positive dollars).
        halt_pct:       Halt threshold fraction.
        force_close_pct: Force-close threshold fraction.
        session_reset:  When True, reset session_pnl to 0 (new day boundary).

    Returns:
        Updated CrossSymbolDllState.
    """
    if session_reset:
        state.session_pnl = 0.0
        state.halted = False
        state.force_closed = False

    # Accumulate realized P&L for this bar.
    state.session_pnl += bar_dollar_pnl

    should_halt, should_force_close = evaluate_cross_symbol_dll(
        state.session_pnl, firm_dll, halt_pct, force_close_pct,
    )

    if should_force_close and not state.force_closed:
        # Force-close: set exit signals on any open position at this bar.
        # We set both directions' exits — caller determines which is active.
        exit_long[bar_idx] = True
        exit_short[bar_idx] = True
        state.force_closed = True
        state.halted = True
        state.force_close_events += 1

    if should_halt and not state.halted:
        state.halted = True

    if state.halted and (entry_long[bar_idx] or entry_short[bar_idx]):
        entry_long[bar_idx] = False
        entry_short[bar_idx] = False
        state.entries_suppressed += 1

    return state


def apply_cross_symbol_dll_to_entries(
    entry_long: np.ndarray,
    entry_short: np.ndarray,
    exit_long: np.ndarray,
    exit_short: np.ndarray,
    bar_dollar_pnls: np.ndarray,
    timestamps: list,
    firm_dll: float,
    halt_pct: float = _DLL_HALT_PCT,
    force_close_pct: float = _DLL_FORCE_CLOSE_PCT,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    """Vectorised application of cross-symbol DLL across all bars.

    Args:
        entry_long:       Boolean numpy array (n_bars,).
        entry_short:      Boolean numpy array (n_bars,).
        exit_long:        Boolean numpy array (n_bars,).
        exit_short:       Boolean numpy array (n_bars,).
        bar_dollar_pnls:  Per-bar realized dollar P&L (n_bars,).
        timestamps:       List of bar timestamps (strings or None) for day boundaries.
        firm_dll:         Firm daily loss limit (positive dollars).
        halt_pct:         Halt threshold fraction (default DLL_HALT_PCT env).
        force_close_pct:  Force-close threshold fraction (default DLL_FORCE_CLOSE_PCT env).

    Returns:
        (entry_long, entry_short, exit_long, exit_short, meta)
        meta = {"entries_suppressed": int, "force_close_events": int}
    """
    if firm_dll <= 0:
        return (
            entry_long, entry_short, exit_long, exit_short,
            {"entries_suppressed": 0, "force_close_events": 0},
        )

    el = entry_long.copy()
    es = entry_short.copy()
    xl = exit_long.copy()
    xs = exit_short.copy()

    state = CrossSymbolDllState()
    prev_day: str | None = None

    for i in range(len(el)):
        # Detect day boundary for session reset.
        ts_raw = timestamps[i] if i < len(timestamps) else None
        day_str: str | None = None
        if ts_raw is not None:
            try:
                day_str = str(ts_raw)[:10]
            except Exception:
                pass

        session_reset = (day_str is not None and day_str != prev_day and prev_day is not None)
        if day_str is not None:
            prev_day = day_str

        pnl = float(bar_dollar_pnls[i]) if i < len(bar_dollar_pnls) else 0.0
        apply_cross_symbol_dll_to_bar(
            bar_idx=i,
            entry_long=el,
            entry_short=es,
            exit_long=xl,
            exit_short=xs,
            bar_dollar_pnl=pnl,
            state=state,
            firm_dll=firm_dll,
            halt_pct=halt_pct,
            force_close_pct=force_close_pct,
            session_reset=session_reset,
        )

    return (
        el, es, xl, xs,
        {
            "entries_suppressed": state.entries_suppressed,
            "force_close_events": state.force_close_events,
        },
    )
