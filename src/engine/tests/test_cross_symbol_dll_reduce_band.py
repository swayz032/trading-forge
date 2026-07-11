"""
test_cross_symbol_dll_reduce_band.py — MED-7 (deep-scan 2026-07-09, ratified)

Backtest/live PARITY: the TS live path (cross-symbol-pnl.ts) has a 4-band DLL ladder
force_close(95%) > halt(67%) > reduce_size(60%, ×0.5) > none. The Python backtest path
had only halt + force_close — so backtests ran FULL size in the 60-67% window while live
sizes down, a fidelity gap feeding the same B14/WFE/PBO gates. These tests lock the added
60% SOFT reduce band + prove backward-compat (sizes=None → byte-identical to pre-MED-7).
"""

import numpy as np

from src.engine.context.cross_symbol_dll import (
    CrossSymbolDllState,
    apply_cross_symbol_dll_to_bar,
    apply_cross_symbol_dll_to_entries,
    in_reduce_size_band,
)

FIRM_DLL = 1000.0  # 60% = -600, 67% = -670, 95% = -950


def _one_bar_entry():
    return (
        np.array([True]),   # entry_long
        np.array([False]),  # entry_short
        np.array([False]),  # exit_long
        np.array([False]),  # exit_short
    )


# ─── in_reduce_size_band pure evaluator ───────────────────────────────────────

def test_reduce_band_boundaries():
    # non-losing → False
    assert in_reduce_size_band(0.0, FIRM_DLL) is False
    assert in_reduce_size_band(+200.0, FIRM_DLL) is False
    # below 60% → False
    assert in_reduce_size_band(-500.0, FIRM_DLL) is False
    # at 60% → True (band start, inclusive)
    assert in_reduce_size_band(-600.0, FIRM_DLL) is True
    # between 60% and 67% → True
    assert in_reduce_size_band(-650.0, FIRM_DLL) is True
    # at 67% (halt) → False (halt band owns it, not reduce)
    assert in_reduce_size_band(-670.0, FIRM_DLL) is False
    # deep in halt/force-close → False
    assert in_reduce_size_band(-900.0, FIRM_DLL) is False
    # invalid firm_dll → False
    assert in_reduce_size_band(-600.0, 0.0) is False


# ─── apply_cross_symbol_dll_to_bar reduce wiring ──────────────────────────────

def test_reduce_band_halves_size_when_sizes_provided():
    """In the 60-67% band, a firing entry is sized ×0.5 (not blocked)."""
    el, es, xl, xs = _one_bar_entry()
    sizes = np.array([10.0])
    state = CrossSymbolDllState(session_pnl=-650.0)  # in reduce band pre-bar
    apply_cross_symbol_dll_to_bar(
        0, el, es, xl, xs, bar_dollar_pnl=0.0, state=state, firm_dll=FIRM_DLL, sizes=sizes,
    )
    assert el[0] == True, "entry must still FIRE in the reduce band (not halted)"
    assert sizes[0] == 5.0, "size must be halved (10 × 0.5)"
    assert state.entries_reduced == 1
    assert state.entries_suppressed == 0
    assert state.halted is False


def test_reduce_band_never_zeroes_floor_at_one():
    el, es, xl, xs = _one_bar_entry()
    sizes = np.array([1.0])  # 1 × 0.5 = 0.5 → floored to 1
    state = CrossSymbolDllState(session_pnl=-620.0)
    apply_cross_symbol_dll_to_bar(
        0, el, es, xl, xs, bar_dollar_pnl=0.0, state=state, firm_dll=FIRM_DLL, sizes=sizes,
    )
    assert sizes[0] == 1.0, "reduce floors at 1 contract (67% halt is the zero path)"
    assert el[0] == True


def test_halt_band_suppresses_not_reduces():
    """At/above 67% the entry is SUPPRESSED (halt), not reduced — harder band wins."""
    el, es, xl, xs = _one_bar_entry()
    sizes = np.array([10.0])
    state = CrossSymbolDllState(session_pnl=-700.0)  # past halt
    apply_cross_symbol_dll_to_bar(
        0, el, es, xl, xs, bar_dollar_pnl=0.0, state=state, firm_dll=FIRM_DLL, sizes=sizes,
    )
    assert el[0] == False, "entry blocked (halt)"
    assert state.entries_suppressed == 1
    assert state.entries_reduced == 0
    # size untouched (entry is masked anyway)
    assert sizes[0] == 10.0


def test_below_reduce_band_no_change():
    el, es, xl, xs = _one_bar_entry()
    sizes = np.array([10.0])
    state = CrossSymbolDllState(session_pnl=-500.0)  # below 60%
    apply_cross_symbol_dll_to_bar(
        0, el, es, xl, xs, bar_dollar_pnl=0.0, state=state, firm_dll=FIRM_DLL, sizes=sizes,
    )
    assert el[0] == True
    assert sizes[0] == 10.0, "no reduction below the 60% band"
    assert state.entries_reduced == 0


def test_backward_compat_sizes_none_is_byte_identical():
    """MED-7 backward-compat: sizes=None (every pre-MED-7 caller) → NO reduce, identical
    entry-masking behavior to before. In the reduce band, entry still fires, nothing changes."""
    el, es, xl, xs = _one_bar_entry()
    state = CrossSymbolDllState(session_pnl=-650.0)  # in reduce band
    apply_cross_symbol_dll_to_bar(
        0, el, es, xl, xs, bar_dollar_pnl=0.0, state=state, firm_dll=FIRM_DLL,  # sizes omitted
    )
    assert el[0] == True
    assert state.entries_reduced == 0, "no reduce path when sizes is None (backward-compat)"


# ─── Bulk apply_cross_symbol_dll_to_entries (the backtester-used function) ─────

def test_bulk_entries_reduce_band_threads_sizes_and_meta():
    """The bulk vectorised path threads sizes → per-bar reduce and surfaces
    entries_reduced in meta. Bar 0 accumulates -650 P&L (into reduce band), bar 1 fires
    an entry that must be halved."""
    el = np.array([False, True])
    es = np.array([False, False])
    xl = np.array([False, False])
    xs = np.array([False, False])
    sizes = np.array([10.0, 10.0])
    pnls = np.array([-650.0, 0.0])  # bar 0 pushes session into reduce band
    ts = ["2026-01-15T09:30:00", "2026-01-15T09:31:00"]  # same day (no reset)

    _el, _es, _xl, _xs, meta = apply_cross_symbol_dll_to_entries(
        el, es, xl, xs, pnls, ts, FIRM_DLL, sizes=sizes,
    )
    assert _el[1] == True, "entry still fires in the reduce band"
    assert sizes[1] == 5.0, "bulk path halved the reduce-band entry size"
    assert meta["entries_reduced"] == 1
    assert meta["entries_suppressed"] == 0


def test_bulk_meta_has_entries_reduced_key_even_without_sizes():
    """Backward-compat: meta always carries entries_reduced (0 when sizes omitted)."""
    el = np.array([True]); es = np.array([False])
    xl = np.array([False]); xs = np.array([False])
    _el, _es, _xl, _xs, meta = apply_cross_symbol_dll_to_entries(
        el, es, xl, xs, np.array([-650.0]), ["2026-01-15T09:30:00"], FIRM_DLL,  # no sizes
    )
    assert meta["entries_reduced"] == 0
    assert "entries_suppressed" in meta and "force_close_events" in meta
