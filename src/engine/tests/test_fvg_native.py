"""Tests for src/engine/indicators/fvg_native.py — the fresh, isolated FVG detector built for
the FVG Identity Dispatch Experiment
(docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md, Part A).

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection over the full
src/engine/tests directory hangs because some module transitively imports the vectorbt-JIT
backtester):

    python -m pytest src/engine/tests/test_fvg_native.py -v
"""

from __future__ import annotations

import ast
from pathlib import Path

import numpy as np

from src.engine.indicators.fvg_native import (
    BEARISH,
    BULLISH,
    compute_fvg_signal,
    detect_fvg_zones,
)

MODULE_PATH = Path(__file__).resolve().parents[1] / "indicators" / "fvg_native.py"


# ─── Verification bar #1: genuine isolation (grep-provable, not just documented) ───────────────

def test_module_imports_only_stdlib_and_numpy():
    """Parses the actual import statements (not a substring grep — a real AST walk) and asserts
    every top-level module name is numpy or a Python stdlib module. Fails loudly if anyone ever
    adds an import of structure_engine / htf_context / bias_engine / any archetype module — the
    exact contamination this file exists to avoid (the point-8 trap: reuse ≠ preservation)."""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    allowed_roots = {"numpy", "__future__", "dataclasses"}
    found_roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found_roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                found_roots.add(node.module.split(".")[0])
    forbidden = found_roots - allowed_roots
    assert not forbidden, (
        f"fvg_native.py imports {forbidden} — this file must stay isolated from "
        "structure_engine/htf_context/bias_engine/archetype modules and any other engine "
        "context. Only numpy + stdlib are permitted."
    )
    # positive control: the file DOES import numpy (a totally empty import set would also
    # trivially pass the assertion above, so assert the expected import is actually present).
    assert "numpy" in found_roots


# ─── Rule correctness (classic 3-candle imbalance) ─────────────────────────────────────────────

def test_bullish_fvg_detected_low_i_gt_high_i_minus_2():
    high = np.array([10.0, 11.0, 15.0])
    low = np.array([9.0, 10.5, 12.0])  # low[2]=12 > high[0]=10 -> bullish gap
    zones = detect_fvg_zones(high, low)
    assert len(zones) == 1
    z = zones[0]
    assert z.direction == BULLISH
    assert z.start_idx == 2
    assert z.upper == 12.0
    assert z.lower == 10.0


def test_bearish_fvg_detected_high_i_lt_low_i_minus_2():
    high = np.array([15.0, 12.0, 9.0])
    low = np.array([13.0, 10.0, 8.0])  # high[2]=9 < low[0]=13 -> bearish gap
    zones = detect_fvg_zones(high, low)
    assert len(zones) == 1
    z = zones[0]
    assert z.direction == BEARISH
    assert z.start_idx == 2
    assert z.upper == 13.0
    assert z.lower == 9.0


def test_no_gap_produces_no_zones():
    # Every bar's [low, high] range overlaps the range 2 bars back -> no imbalance anywhere.
    high = np.array([10.0, 10.0, 10.0, 10.0, 10.0])
    low = np.array([9.0, 9.0, 9.0, 9.0, 9.0])
    zones = detect_fvg_zones(high, low)
    assert zones == []


def test_fewer_than_three_bars_produces_no_zones_and_no_crash():
    high = np.array([10.0, 11.0])
    low = np.array([9.0, 10.0])
    zones = detect_fvg_zones(high, low)
    assert zones == []
    result = compute_fvg_signal(low.copy(), high, low, high.copy())
    assert result.zones == []
    assert list(result.any_active) == [False, False]


# ─── No look-ahead: detection at bar i only reads bars <= i ────────────────────────────────────

def test_zone_detection_never_reads_beyond_its_own_bar():
    """Appending future bars after a zone's formation bar must not change whether/where that
    zone was detected — proves detect_fvg_zones has no look-ahead in the FORMATION step."""
    high = np.array([10.0, 11.0, 15.0])
    low = np.array([9.0, 10.5, 12.0])
    zones_short = detect_fvg_zones(high, low)

    high_ext = np.concatenate([high, np.array([16.0, 8.0, 20.0])])
    low_ext = np.concatenate([low, np.array([14.0, 7.0, 18.0])])
    zones_ext = detect_fvg_zones(high_ext, low_ext)

    same_prefix = [z for z in zones_ext if z.start_idx <= 2]
    assert [(z.start_idx, z.direction, z.upper, z.lower) for z in zones_short] == [
        (z.start_idx, z.direction, z.upper, z.lower) for z in same_prefix
    ]


# ─── Fill scan (simple forward scan, per locked spec) ──────────────────────────────────────────

def test_zone_fills_on_first_bar_that_re_enters_the_band():
    # bullish zone forms at i=2 (upper=12, lower=10); bar 3 dips into [10,12] -> filled at 3.
    # bar 4 stays flat (no new gap: low[4]=11 is NOT > high[2]=15) so no second zone forms.
    high = np.array([10.0, 11.0, 15.0, 11.5, 11.5])
    low = np.array([9.0, 10.5, 12.0, 11.0, 11.0])
    result = compute_fvg_signal(low.copy(), high, low, high.copy())
    assert bool(result.bullish_active[2]) is True
    # filled at bar 3 -> active signal should be False from bar 3 onward (until re-formed)
    assert bool(result.bullish_active[3]) is False
    assert bool(result.bullish_active[4]) is False


def test_never_filled_zone_stays_active_through_end_of_array():
    high = np.array([10.0, 11.0, 15.0, 16.0, 17.0])
    low = np.array([9.0, 10.5, 12.0, 13.0, 14.0])  # price only rises further away, never returns
    result = compute_fvg_signal(low.copy(), high, low, high.copy())
    assert bool(result.bullish_active[2]) is True
    assert bool(result.bullish_active[3]) is True
    assert bool(result.bullish_active[4]) is True


def test_fill_scan_never_reads_beyond_the_bar_it_evaluates():
    """Fill detection at bar j must only depend on bar j's own high/low — appending MORE future
    bars after j must not retroactively change whether j itself filled the zone."""
    high = np.array([10.0, 11.0, 15.0, 11.5, 20.0])
    low = np.array([9.0, 10.5, 12.0, 11.0, 19.0])
    zones = detect_fvg_zones(high, low)
    from src.engine.indicators.fvg_native import _fill_scan

    filled_short = _fill_scan(zones, high, low)

    high_ext = np.concatenate([high, np.array([30.0])])
    low_ext = np.concatenate([low, np.array([29.0])])
    filled_ext = _fill_scan(zones, high_ext, low_ext)

    assert filled_short[0].filled_at_idx == filled_ext[0].filled_at_idx == 3


# ─── Determinism ────────────────────────────────────────────────────────────────────────────────

def test_deterministic_same_input_same_output():
    rng = np.random.default_rng(11)
    n = 200
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.0, n)
    low = close - rng.uniform(0.1, 1.0, n)
    open_ = close + rng.normal(0, 0.2, n)

    r1 = compute_fvg_signal(open_, high, low, close)
    r2 = compute_fvg_signal(open_, high, low, close)
    assert np.array_equal(r1.bullish_active, r2.bullish_active)
    assert np.array_equal(r1.bearish_active, r2.bearish_active)
    assert np.array_equal(r1.any_active, r2.any_active)
    assert [(z.start_idx, z.direction, z.filled_at_idx) for z in r1.zones] == [
        (z.start_idx, z.direction, z.filled_at_idx) for z in r2.zones
    ]


def test_any_active_is_or_of_bullish_and_bearish():
    rng = np.random.default_rng(3)
    n = 150
    close = 50 + np.cumsum(rng.normal(0, 0.8, n))
    high = close + rng.uniform(0.1, 2.0, n)
    low = close - rng.uniform(0.1, 2.0, n)
    open_ = close.copy()
    result = compute_fvg_signal(open_, high, low, close)
    assert np.array_equal(result.any_active, result.bullish_active | result.bearish_active)
