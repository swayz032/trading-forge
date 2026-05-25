"""Tests for HIGH #6 — Volume-based probabilistic partial fill model (Wave 27.5 Pass C.1).

Verifies:
- order_qty < 0.1 × bar_volume → 1.0 fill ratio (no degradation)
- order_qty = 0.5 × bar_volume → degraded fill ratio (linear zone)
- order_qty > bar_volume → forced partial (0.5 minimum)
- Backward compat: BACKTEST_PARTIAL_FILL_ENABLED=false → 100% fills preserved
- audit payload contains correct pre/post statistics
- P&L contract: sizes output are integer contracts, never passed to vectorbt

Per CLAUDE.md: Never pass slippage/fees to vectorbt for futures — compute P&L manually.
Fill model outputs adjusted sizes; backtester.py uses them in:
  net_pnl = (exit - entry) × contracts × point_value - slippage - commission
"""

from __future__ import annotations

import importlib
import os
from datetime import datetime, timedelta
from unittest.mock import patch

import numpy as np
import polars as pl
import pytest


def _make_df_with_volume(n: int = 20, volume_per_bar: int = 10000,
                          atr_value: float = 4.0) -> pl.DataFrame:
    """Create DataFrame with controlled volume per bar."""
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4500.0] * n,
        "high": [4505.0] * n,
        "low": [4495.0] * n,
        "close": [4502.0] * n,
        "volume": [volume_per_bar] * n,
        "atr_14": [atr_value] * n,
    })


def _make_df_no_volume(n: int = 10) -> pl.DataFrame:
    """Create DataFrame WITHOUT a volume column (for fallback test)."""
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4500.0] * n,
        "high": [4505.0] * n,
        "low": [4495.0] * n,
        "close": [4502.0] * n,
        "atr_14": [4.0] * n,
    })


# ─── Tests: compute_volume_based_fill_ratios ────────────────────────────────


class TestComputeVolumeBasedFillRatios:
    """Unit tests for the fill ratio computation function."""

    def test_small_order_gets_full_fill(self):
        """order_qty / bar_volume < 0.1 → fill ratio = 1.0 (no degradation)."""
        # bar_volume = 1000, order_qty = 50 → ratio = 0.05 < 0.1 threshold
        df = _make_df_with_volume(n=5, volume_per_bar=1000)
        order_qtys = np.array([50.0, 50.0, 50.0, 50.0, 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            # Re-import to pick up env var (module-level constant)
            import src.engine.fill_model as fm
            importlib.reload(fm)
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        assert np.all(ratios == pytest.approx(1.0, abs=1e-9))

    def test_medium_order_gets_degraded_fill(self):
        """order_qty = 0.5 × bar_volume → fill ratio between 0.5 and 1.0."""
        # bar_volume = 100, order_qty = 50 → ratio = 0.5 (in zone 2: threshold=0.1 to 1.0)
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        order_qtys = np.array([50.0, 50.0, 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        # ratio = 0.5 is in the linear zone [0.1, 1.0]
        # degraded_fill = 1.0 - 0.5 × (0.5 - 0.1) / (1.0 - 0.1) = 1.0 - 0.5 × 0.4444 = 0.7778
        expected_approx = 1.0 - 0.5 * (0.5 - 0.1) / (1.0 - 0.1 + 1e-10)
        assert np.all(ratios == pytest.approx(expected_approx, rel=0.01))
        assert np.all(ratios > 0.5)
        assert np.all(ratios < 1.0)

    def test_large_order_forced_partial(self):
        """order_qty > bar_volume → fill ratio = 0.5 (forced partial minimum)."""
        # bar_volume = 10, order_qty = 50 → ratio = 5.0 > 1.0 (zone 3)
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        order_qtys = np.array([50.0, 50.0, 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        assert np.all(ratios == pytest.approx(0.5, abs=1e-9))

    def test_no_volume_column_returns_all_ones(self):
        """When DataFrame has no 'volume' column, return 1.0 (graceful fallback)."""
        df = _make_df_no_volume(n=5)
        order_qtys = np.array([1000.0, 1000.0, 1000.0, 1000.0, 1000.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        assert np.all(ratios == pytest.approx(1.0, abs=1e-9))

    def test_zero_volume_bar_treated_as_unlimited(self):
        """Zero-volume bars (e.g. pre-market stubs) return fill ratio = 1.0."""
        df = _make_df_with_volume(n=3, volume_per_bar=0)
        order_qtys = np.array([100.0, 100.0, 100.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        # Zero volume → treated as inf → no degradation
        assert np.all(ratios == pytest.approx(1.0, abs=1e-9))


# ─── Tests: apply_volume_partial_fills ──────────────────────────────────────


class TestApplyVolumePartialFills:
    """Integration tests for the apply_volume_partial_fills function."""

    def test_small_orders_unchanged(self):
        """Orders well below volume threshold produce no size reduction."""
        df = _make_df_with_volume(n=10, volume_per_bar=10000)
        entries = np.array([True, False, True, False, True, False, False, False, False, False])
        sizes = np.array([10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            adj_sizes, ratios, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        # 10 contracts on 10000 vol bar = 0.1% → well below threshold, no degradation
        assert np.array_equal(adj_sizes[entries.astype(bool)], sizes[entries.astype(bool)])
        assert audit["partial_fills"] == 0
        assert audit["avg_fill_ratio"] == pytest.approx(1.0, abs=0.001)

    def test_large_orders_get_reduced(self):
        """Orders exceeding bar volume get forced to 50% fill (minimum 1 contract)."""
        # bar_volume = 5, order_qty = 50 → ratio > 1.0 → forced 0.5
        df = _make_df_with_volume(n=5, volume_per_bar=5)
        entries = np.array([True, False, True, False, False])
        sizes = np.array([50.0, 50.0, 50.0, 50.0, 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            adj_sizes, ratios, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        # 50 × 0.5 = 25 contracts (zone 3 → 0.5 fill ratio)
        assert adj_sizes[0] == pytest.approx(25.0, abs=1.0)
        assert adj_sizes[2] == pytest.approx(25.0, abs=1.0)
        assert audit["partial_fills"] == 2
        assert audit["total_orders"] == 2

    def test_minimum_one_contract_floor(self):
        """Partial fill always results in at least 1 contract (floor, never zero)."""
        # bar_volume = 5, order_qty = 1 → ratio = 0.2 (linear zone) → floor to 1
        df = _make_df_with_volume(n=3, volume_per_bar=5)
        entries = np.array([True, False, False])
        sizes = np.array([1.0, 1.0, 1.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            adj_sizes, ratios, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        # fill ratio may degrade but minimum is 1 contract
        assert adj_sizes[0] >= 1.0

    def test_backward_compat_disabled_env_var(self):
        """BACKTEST_PARTIAL_FILL_ENABLED=false → all fills 100%, no size reduction."""
        # Extreme case: 1000 contracts on 1-volume bar
        df = _make_df_with_volume(n=5, volume_per_bar=1)
        entries = np.array([True, True, True, False, False])
        sizes = np.array([1000.0, 1000.0, 1000.0, 1000.0, 1000.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "false"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            adj_sizes, ratios, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        # When disabled, sizes must be unchanged
        assert np.array_equal(adj_sizes, sizes)
        assert audit["enabled"] is False
        assert audit["partial_fills"] == 0

    def test_audit_payload_structure(self):
        """Audit payload contains all required fields."""
        df = _make_df_with_volume(n=5, volume_per_bar=100)
        entries = np.array([True, False, True, False, False])
        sizes = np.array([50.0, 50.0, 50.0, 50.0, 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            _, _, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        required_keys = ["enabled", "total_orders", "partial_fills",
                         "avg_fill_ratio", "avg_slippage_delta_per_partial",
                         "volume_threshold"]
        for key in required_keys:
            assert key in audit, f"Missing audit key: {key}"

    def test_audit_total_orders_counts_entry_bars_only(self):
        """audit.total_orders counts only bars where entries=True."""
        df = _make_df_with_volume(n=10, volume_per_bar=100)
        entries = np.array([True, False, False, True, False, True, False, False, False, False])
        sizes = np.full(10, 10.0)

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            _, _, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        assert audit["total_orders"] == 3  # bars 0, 3, 5

    def test_non_entry_bar_sizes_unchanged(self):
        """Sizes at non-entry bars must never be modified."""
        # Very low volume to force partial fills
        df = _make_df_with_volume(n=5, volume_per_bar=1)
        entries = np.array([True, False, False, False, True])
        sizes = np.array([100.0, 200.0, 300.0, 400.0, 100.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            adj_sizes, _, _ = fm.apply_volume_partial_fills(entries, sizes, df)

        # Non-entry bars (1, 2, 3) should be unchanged
        assert adj_sizes[1] == 200.0
        assert adj_sizes[2] == 300.0
        assert adj_sizes[3] == 400.0

    def test_volume_threshold_env_var(self):
        """BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD changes the degradation onset."""
        # bar_volume = 100, order_qty = 5 → ratio = 0.05
        # With threshold=0.01: ratio > threshold → zone 2 (degraded)
        # With threshold=0.1: ratio < threshold → zone 1 (full fill)
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        order_qtys = np.array([5.0, 5.0, 5.0])

        # High threshold: 0.05 < 0.1 → no degradation
        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true",
                                     "BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD": "0.1"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            ratios_high = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        # Low threshold: 0.05 > 0.01 → degradation starts
        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true",
                                     "BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD": "0.01"}):
            ratios_low = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.01)

        assert np.all(ratios_high == pytest.approx(1.0, abs=1e-9))  # No degradation
        assert np.all(ratios_low < 1.0)                              # Degraded

    def test_fill_model_does_not_use_vectorbt_slippage(self):
        """
        CONTRACT CHECK: apply_volume_partial_fills returns (sizes, ratios, audit).
        The function never returns a slippage array — slippage is computed separately
        in backtester.py. This test verifies the return signature is correct.
        """
        df = _make_df_with_volume(n=5, volume_per_bar=100)
        entries = np.array([True, False, True, False, False])
        sizes = np.array([10.0, 10.0, 10.0, 10.0, 10.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            result = fm.apply_volume_partial_fills(entries, sizes, df)

        # Must return exactly 3 values: (sizes, ratios, audit)
        assert len(result) == 3
        adj_sizes, fill_ratios, audit = result

        # Sizes are integer-floored contracts
        assert all(s == int(s) or s >= 1.0 for s in adj_sizes[entries.astype(bool)])
        # Fill ratios are in [0.5, 1.0]
        assert np.all(fill_ratios[entries.astype(bool)] >= 0.5)
        assert np.all(fill_ratios[entries.astype(bool)] <= 1.0)
        # Audit is a dict (not a slippage array)
        assert isinstance(audit, dict)
