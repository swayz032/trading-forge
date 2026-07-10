"""Class-path fill-model wiring — bar-alignment RED-proof (deep-scan 2026-07-09, ratified).

BACKGROUND: run_class_backtest() (the archetype/class-strategy engine path) had NO
fill-model wiring at all — run_backtest() (the DSL path) applies the Stage-2
volume-based partial-fill model (next-bar-aligned per the 2026-07-09 alignment fix
in test_fill_model_next_bar_alignment.py), but run_class_backtest() did not, so
archetype strategies backtested with idealized (100%) fills while DSL strategies
did not, despite both feeding the same lifecycle promotion gates (B14/WFE/PBO).

FIX: `src.engine.fill_model.apply_class_path_fill_model()` threads the identical
Stage-2 model into the class path. This test proves the ALIGNMENT CONTRACT the fix
depends on: the fill ratio must be computed from the EXECUTION bar's volume (bar
N+1, where the order actually fills) — not the SIGNAL bar's volume (bar N, where
the strategy decided to enter). run_class_backtest, like run_backtest, shifts
entries forward one bar (`np.roll(entries, 1)`) before feeding vectorbt.

Testing-constraint note (CLAUDE.md): a bare import of any module that transitively
pulls the vectorbt-JIT backtester hangs under pytest collection on the tower. This
file imports ONLY `src.engine.fill_model` (pure numpy/polars, no vectorbt) — the
wiring logic is intentionally factored into a standalone, side-effect-free helper
so it is unit-testable without mocking vectorbt or importing backtester.py at all.
"""
from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from src.engine.fill_model import apply_class_path_fill_model


def _enable_partial_fill(monkeypatch):
    monkeypatch.setenv("BACKTEST_PARTIAL_FILL_ENABLED", "true")
    monkeypatch.setenv("BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD", "0.1")
    import src.engine.fill_model as fm
    fm._get_partial_fill_enabled.cache_clear()
    fm._get_partial_fill_volume_threshold.cache_clear()
    return fm


class TestClassPathFillModelExecutionBarAlignment:
    """RED-PROOF: the degraded size at the execution bar must reflect the
    EXECUTION bar's volume, not the signal bar's. A signal fired on a busy bar
    whose fill lands on a thin next bar must degrade — scoring it full-fill
    because the signal bar was busy silently inflates Sharpe/PF/DSR."""

    def test_long_signal_on_busy_bar_degrades_using_thin_execution_bar_volume(self, monkeypatch):
        _enable_partial_fill(monkeypatch)

        # Signal fires (pre-roll) on bar 0 — a BUSY bar (volume=100_000).
        # Execution happens on bar 1 (post-roll) — a THIN bar (volume=20).
        long_pre = np.array([True, False, False])
        long_post = np.array([False, True, False])  # np.roll(long_pre, 1)
        short_pre = np.zeros(3, dtype=bool)
        short_post = np.zeros(3, dtype=bool)

        sizes = np.array([100.0, 100.0, 100.0])  # fixed order size, no entry-independent decay
        df = pl.DataFrame({"volume": [100_000.0, 20.0, 20.0]})

        final_sizes, audit = apply_class_path_fill_model(
            sizes, df,
            long_entries_pre_roll=long_pre,
            short_entries_pre_roll=short_pre,
            long_entries_post_roll=long_post,
            short_entries_post_roll=short_post,
        )

        # 100 contracts / 20 (execution-bar volume) = 5.0 ratio > 1.0 → zone 3 →
        # forced 0.5 fill ratio → floor(100 * 0.5) = 50.
        assert final_sizes[1] == pytest.approx(50.0), (
            "Execution-bar (bar 1, volume=20) is thin — the order MUST degrade. "
            f"Got {final_sizes[1]}, meaning the ratio used the wrong bar's volume "
            "(signal bar 0 has volume=100_000, which would produce NO degradation)."
        )
        assert audit["total_orders"] == 1
        assert audit["partial_fills"] == 1

    def test_long_signal_on_thin_bar_with_busy_execution_bar_does_not_degrade(self, monkeypatch):
        """Inverse fixture: signal bar is THIN, execution bar is BUSY. If the
        implementation wrongly used the signal bar's volume, this order would
        incorrectly degrade (thin signal bar) even though it actually fills
        into a busy, liquid execution bar."""
        _enable_partial_fill(monkeypatch)

        long_pre = np.array([True, False, False])
        long_post = np.array([False, True, False])
        short_pre = np.zeros(3, dtype=bool)
        short_post = np.zeros(3, dtype=bool)

        sizes = np.array([100.0, 100.0, 100.0])
        # Signal bar (0) is THIN (volume=50); execution bar (1) is BUSY (volume=100_000).
        df = pl.DataFrame({"volume": [50.0, 100_000.0, 100_000.0]})

        final_sizes, audit = apply_class_path_fill_model(
            sizes, df,
            long_entries_pre_roll=long_pre,
            short_entries_pre_roll=short_pre,
            long_entries_post_roll=long_post,
            short_entries_post_roll=short_post,
        )

        assert final_sizes[1] == pytest.approx(100.0), (
            "Execution bar is busy (volume=100_000) — no degradation should occur. "
            f"Got {final_sizes[1]}, meaning the ratio used the thin SIGNAL bar's "
            "volume instead of the busy EXECUTION bar's."
        )
        assert audit["partial_fills"] == 0

    def test_short_side_uses_same_execution_bar_alignment(self, monkeypatch):
        _enable_partial_fill(monkeypatch)

        short_pre = np.array([True, False, False])
        short_post = np.array([False, True, False])
        long_pre = np.zeros(3, dtype=bool)
        long_post = np.zeros(3, dtype=bool)

        sizes = np.array([100.0, 100.0, 100.0])
        df = pl.DataFrame({"volume": [100_000.0, 15.0, 15.0]})

        final_sizes, audit = apply_class_path_fill_model(
            sizes, df,
            long_entries_pre_roll=long_pre,
            short_entries_pre_roll=short_pre,
            long_entries_post_roll=long_post,
            short_entries_post_roll=short_post,
        )

        assert final_sizes[1] == pytest.approx(50.0), (
            "Short-side execution bar is thin (volume=15) — must degrade using "
            "the execution bar's volume, mirroring the long-side contract."
        )
        assert audit["total_orders"] == 1
        assert audit["partial_fills"] == 1

    def test_bars_with_no_entry_keep_original_per_bar_size(self, monkeypatch):
        """Bars that never have an entry (pre- or post-roll) must be untouched —
        this function must not clobber the natural per-bar sizing output of
        compute_position_sizes() anywhere except at the remapped execution bar."""
        _enable_partial_fill(monkeypatch)

        long_pre = np.array([True, False, False, False])
        long_post = np.array([False, True, False, False])
        short_pre = np.zeros(4, dtype=bool)
        short_post = np.zeros(4, dtype=bool)

        sizes = np.array([100.0, 100.0, 42.0, 7.0])
        df = pl.DataFrame({"volume": [100_000.0, 20.0, 100_000.0, 100_000.0]})

        final_sizes, _audit = apply_class_path_fill_model(
            sizes, df,
            long_entries_pre_roll=long_pre,
            short_entries_pre_roll=short_pre,
            long_entries_post_roll=long_post,
            short_entries_post_roll=short_post,
        )

        assert final_sizes[2] == pytest.approx(42.0)
        assert final_sizes[3] == pytest.approx(7.0)


class TestClassPathFillModelBackwardCompat:
    def test_disabled_env_leaves_sizes_untouched(self, monkeypatch):
        """BACKTEST_PARTIAL_FILL_ENABLED=false must fully disable degradation
        even when the caller invokes apply_class_path_fill_model — the env gate
        composes with the fill_model-enable gate exactly like the DSL path."""
        monkeypatch.setenv("BACKTEST_PARTIAL_FILL_ENABLED", "false")
        import src.engine.fill_model as fm
        fm._get_partial_fill_enabled.cache_clear()

        long_pre = np.array([True, False, False])
        long_post = np.array([False, True, False])
        short_pre = np.zeros(3, dtype=bool)
        short_post = np.zeros(3, dtype=bool)

        sizes = np.array([100.0, 100.0, 100.0])
        df = pl.DataFrame({"volume": [100_000.0, 20.0, 20.0]})

        final_sizes, audit = apply_class_path_fill_model(
            sizes, df,
            long_entries_pre_roll=long_pre,
            short_entries_pre_roll=short_pre,
            long_entries_post_roll=long_post,
            short_entries_post_roll=short_post,
        )

        assert final_sizes[1] == pytest.approx(100.0)
        assert audit["enabled"] is False

        fm._get_partial_fill_enabled.cache_clear()
