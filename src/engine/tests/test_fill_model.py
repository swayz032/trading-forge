"""Tests for fill probability model (Task 3.10)."""

from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import polars as pl
import pytest

from src.engine.fill_model import (
    compute_fill_probabilities,
    apply_fill_model,
    DEFAULT_FILL_CONFIG,
    estimate_spread_ticks,
    compute_fill_probabilities_v2,
)


def _make_df_with_rsi(n: int = 50, rsi_values: list[float] | None = None) -> pl.DataFrame:
    """Create synthetic DataFrame with RSI column."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    if rsi_values is None:
        rsi_values = [50.0] * n  # neutral RSI

    return pl.DataFrame({
        "ts_event": dates,
        "open":   [4000.0] * n,
        "high":   [4005.0] * n,
        "low":    [3995.0] * n,
        "close":  [4001.0] * n,
        "volume": [50000] * n,
        "rsi_14": rsi_values,
    })


class TestMarketOrders:
    def test_market_order_all_entries_preserved(self):
        """Market orders: 100% fill rate, all entries preserved."""
        df = _make_df_with_rsi(20)
        entries = np.array([True, False, True, False, True] + [False] * 15)

        config = {"order_type": "market"}
        fill_probs = compute_fill_probabilities(df, config, entries)

        assert np.all(fill_probs == 1.0)

    def test_market_order_apply_no_change(self):
        """Market order fill model doesn't mask any entries."""
        entries = np.array([True, False, True, False, True] + [False] * 15)
        fill_probs = np.ones(20)
        sizes = np.full(20, 3.0)

        filtered, adj_sizes = apply_fill_model(entries, fill_probs, sizes, seed=42)
        np.testing.assert_array_equal(filtered, entries)
        np.testing.assert_array_equal(adj_sizes, sizes)


class TestLimitOrders:
    def test_limit_at_extreme_rsi_lower_fill(self):
        """Limit orders at extreme RSI (>70 or <30) get lower fill probability."""
        rsi = [75.0] * 10 + [50.0] * 10  # first 10 extreme, last 10 normal
        df = _make_df_with_rsi(20, rsi)
        entries = np.ones(20, dtype=bool)

        config = {
            "order_type": "limit",
            "limit_at_current": 0.95,
            "limit_at_extreme": 0.50,
            "limit_at_sr": 0.60,
        }
        fill_probs = compute_fill_probabilities(df, config, entries)

        # Extreme RSI bars should have lower fill probability
        assert fill_probs[0] == 0.50  # RSI 75 → extreme
        assert fill_probs[15] == 0.95  # RSI 50 → normal

    def test_limit_at_sr_medium_fill(self):
        """RSI 60-70 range gets S/R-level fill probability."""
        rsi = [65.0] * 5 + [50.0] * 15
        df = _make_df_with_rsi(20, rsi)
        entries = np.ones(20, dtype=bool)

        config = {
            "order_type": "limit",
            "limit_at_current": 0.95,
            "limit_at_extreme": 0.50,
            "limit_at_sr": 0.60,
        }
        fill_probs = compute_fill_probabilities(df, config, entries)
        assert fill_probs[0] == 0.60  # RSI 65 → near S/R

    def test_some_entries_masked_with_seed(self):
        """Limit orders at extreme RSI: some entries get masked out."""
        rsi = [80.0] * 20  # all extreme RSI
        df = _make_df_with_rsi(20, rsi)
        entries = np.ones(20, dtype=bool)
        sizes = np.full(20, 3.0)

        config = {
            "order_type": "limit",
            "limit_at_current": 0.95,
            "limit_at_extreme": 0.50,
            "limit_at_sr": 0.60,
        }
        fill_probs = compute_fill_probabilities(df, config, entries)

        filtered, adj_sizes = apply_fill_model(entries, fill_probs, sizes, seed=42)

        # With 50% fill prob, roughly half should be masked
        num_filled = np.sum(filtered)
        assert num_filled < 20, "Some entries should be masked"
        assert num_filled > 0, "At least some entries should fill"


class TestPartialFills:
    def test_partial_fill_reduces_size(self):
        """When fill_prob < threshold (0.70), size reduced to 50%."""
        entries = np.array([True, True, False] + [False] * 17)
        fill_probs = np.array([0.50, 0.90] + [1.0] * 18)  # first below threshold
        sizes = np.full(20, 4.0)

        # We need a seed where the first entry fills (random < 0.50)
        # Try multiple seeds to find one
        for seed in range(100):
            filtered, adj_sizes = apply_fill_model(entries, fill_probs, sizes, seed=seed)
            if filtered[0]:
                # First entry filled with prob < 0.70 → partial fill
                assert adj_sizes[0] == 2, f"Size should be halved (seed={seed})"
                break
        else:
            # If no seed worked in 100 tries, that's statistically improbable
            pytest.skip("No seed produced a fill in 100 tries")

    def test_above_threshold_full_size(self):
        """When fill_prob >= threshold (0.70), size stays the same."""
        entries = np.array([True] + [False] * 19)
        fill_probs = np.array([0.95] + [1.0] * 19)  # above threshold
        sizes = np.full(20, 4.0)

        # With prob 0.95, most seeds will fill
        filtered, adj_sizes = apply_fill_model(entries, fill_probs, sizes, seed=42)
        if filtered[0]:
            assert adj_sizes[0] == 4.0  # No reduction


class TestDeterminism:
    def test_same_seed_same_result(self):
        """Same seed produces identical results."""
        entries = np.ones(20, dtype=bool)
        fill_probs = np.full(20, 0.50)
        sizes = np.full(20, 3.0)

        f1, s1 = apply_fill_model(entries, fill_probs, sizes, seed=123)
        f2, s2 = apply_fill_model(entries, fill_probs, sizes, seed=123)

        np.testing.assert_array_equal(f1, f2)
        np.testing.assert_array_equal(s1, s2)

    def test_different_seed_different_result(self):
        """Different seeds produce different results (with high probability)."""
        entries = np.ones(50, dtype=bool)
        fill_probs = np.full(50, 0.50)
        sizes = np.full(50, 3.0)

        f1, _ = apply_fill_model(entries, fill_probs, sizes, seed=1)
        f2, _ = apply_fill_model(entries, fill_probs, sizes, seed=999)

        # Extremely unlikely to be identical with 50 coin flips
        assert not np.array_equal(f1, f2)


# ─── V2 Fill Model Tests ──────────────────────────────────────


class TestSpreadEstimation:
    def test_spread_estimation_scales_with_atr(self):
        """Spread should increase at high ATR percentiles."""
        atr = np.array([1.0] * 80 + [5.0] * 15 + [10.0] * 5)
        spreads = estimate_spread_ticks(atr, contract_tick_size=0.25)
        # Low ATR bars should have base spread
        assert spreads[0] == 1.0
        # High ATR bars should have wider spread
        assert spreads[-1] >= 2.0


class TestFillV2:
    def test_stop_market_prohibited(self):
        """Stop-market orders must raise ValueError per CLAUDE.md.

        P1-E: stop-market orders cause catastrophic slippage in live futures —
        they are prohibited at the fill model level. Use 'stop_limit' instead.
        """
        import pytest as _pytest
        df = pl.DataFrame({
            "ts_event": pd.date_range("2024-01-01", periods=10, freq="h"),
            "open": [100.0] * 10,
            "high": [101.0] * 10,
            "low": [99.0] * 10,
            "close": [100.5] * 10,
            "volume": [1000] * 10,
            "rsi_14": [50.0] * 10,
        })
        entries = np.array([True] * 10)
        config = {"order_type": "stop", "limit_at_current": 0.95}
        with _pytest.raises(ValueError, match="stop_market.*prohibited|prohibited.*stop_market"):
            compute_fill_probabilities_v2(df, config, entries, order_type="stop_market")
        with _pytest.raises(ValueError, match="prohibited"):
            compute_fill_probabilities_v2(df, config, entries, order_type="stop")

    def test_stop_limit_reduced_probability(self):
        """Stop-limit should have lower fill probability than limit."""
        df = pl.DataFrame({
            "ts_event": pd.date_range("2024-01-01", periods=10, freq="h"),
            "open": [100.0] * 10,
            "high": [101.0] * 10,
            "low": [99.0] * 10,
            "close": [100.5] * 10,
            "volume": [1000] * 10,
            "rsi_14": [50.0] * 10,
        })
        entries = np.array([True] * 10)
        config = {"order_type": "limit", "limit_at_current": 0.95, "limit_at_extreme": 0.50, "limit_at_sr": 0.60}

        limit_probs = compute_fill_probabilities_v2(df, config, entries, order_type="limit")
        stop_limit_probs = compute_fill_probabilities_v2(df, config, entries, order_type="stop_limit")

        # Stop-limit should be lower than limit at same RSI
        assert np.all(stop_limit_probs <= limit_probs)

    def test_backward_compat_unchanged(self):
        """Original compute_fill_probabilities should remain unchanged."""
        df = pl.DataFrame({
            "ts_event": pd.date_range("2024-01-01", periods=5, freq="h"),
            "open": [100.0] * 5,
            "high": [101.0] * 5,
            "low": [99.0] * 5,
            "close": [100.5] * 5,
            "volume": [1000] * 5,
            "rsi_14": [50.0] * 5,
        })
        entries = np.array([True] * 5)
        config = {"order_type": "market"}

        # V1 should still work unchanged
        probs = compute_fill_probabilities(df, config, entries)
        assert np.all(probs == 1.0)
