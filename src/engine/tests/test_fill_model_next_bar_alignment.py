"""HIGH bar-alignment fix (deep-scan 2026-07-09, operator-ratified).

The backtest engine fills a signal on bar N at bar N+1 (np.roll(entries, 1)), so a
volume-based partial-fill degradation must be computed against bar N+1's volume (the
execution bar), NOT the signal bar's. Before the fix, a signal fired on a high-volume
bar whose fill landed on a thin next bar was scored full-fill — under-degrading large
orders and silently inflating Sharpe/PF/DSR once the fill model is wired.

compute_volume_based_fill_ratios(next_bar_fill=True) shifts the volume by -1 so
order_quantities[N] is divided by volume[N+1]. next_bar_fill=False (default) preserves
the legacy same-bar behavior for backward-compat.
"""
import os

import numpy as np
import polars as pl
import pytest


def _enable_partial_fill(monkeypatch):
    monkeypatch.setenv("BACKTEST_PARTIAL_FILL_ENABLED", "true")
    monkeypatch.setenv("BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD", "0.1")
    import src.engine.fill_model as fm
    fm._get_partial_fill_enabled.cache_clear()
    fm._get_partial_fill_volume_threshold.cache_clear()
    return fm


def test_next_bar_fill_uses_execution_bar_volume(monkeypatch):
    fm = _enable_partial_fill(monkeypatch)
    # Signal bar 0 has high volume (1000); the fill lands on bar 1, which is THIN (60).
    df = pl.DataFrame({"volume": [1000.0, 60.0]})
    order_q = np.array([50.0, 0.0])  # 50-contract order signalled on bar 0

    # Legacy same-bar: 50/1000 = 0.05 < 0.1 threshold → zone 1 → no degradation.
    same_bar = fm.compute_volume_based_fill_ratios(df, order_q, next_bar_fill=False)
    assert same_bar[0] == pytest.approx(1.0), "same-bar should NOT degrade (0.05 ratio)"

    # Execution-bar (fixed): 50/60 = 0.83 → zone 2 → degraded below 1.0.
    exec_bar = fm.compute_volume_based_fill_ratios(df, order_q, next_bar_fill=True)
    assert exec_bar[0] < 1.0, "next_bar_fill must degrade using the thin execution bar"
    # zone 2 linear: 1.0 - 0.5 * (0.833.. - 0.1)/(0.9) ≈ 0.593
    assert exec_bar[0] == pytest.approx(1.0 - 0.5 * ((50.0 / 60.0) - 0.1) / (1.0 - 0.1), rel=1e-3)


def test_next_bar_fill_forces_partial_when_next_bar_volume_insufficient(monkeypatch):
    fm = _enable_partial_fill(monkeypatch)
    # Fill bar volume (bar 1) is smaller than the order → zone 3 → forced 0.5.
    df = pl.DataFrame({"volume": [10_000.0, 30.0]})
    order_q = np.array([50.0, 0.0])
    exec_bar = fm.compute_volume_based_fill_ratios(df, order_q, next_bar_fill=True)
    assert exec_bar[0] == pytest.approx(0.5), "50 order into 30-volume next bar → forced 0.5"


def test_apply_volume_partial_fills_threads_next_bar_flag(monkeypatch):
    fm = _enable_partial_fill(monkeypatch)
    df = pl.DataFrame({"volume": [1000.0, 60.0]})
    entries = np.array([True, False])       # entry signalled on bar 0
    sizes = np.array([50.0, 0.0])
    # With next_bar_fill=True the size at the entry bar is degraded (execution bar thin).
    adj, ratios, audit = fm.apply_volume_partial_fills(entries, sizes, df, next_bar_fill=True)
    assert ratios[0] < 1.0
    assert adj[0] < 50.0, "degraded ratio must shrink the filled size"
    # Legacy path (default) does not degrade on this fixture.
    adj2, ratios2, _ = fm.apply_volume_partial_fills(entries, sizes, df)
    assert ratios2[0] == pytest.approx(1.0)
    assert adj2[0] == pytest.approx(50.0)
