"""Tests for Deepscan #19 B-3 — exit-side volume-impact fill-price degradation.

apply_volume_partial_fills() (Wave 27.5 Pass C.1 / HIGH #6) only ever degrades ENTRY
bars. Exits (stop-outs, TP fills, 15:55 ET hard flatten) always filled at the naive
idealized price regardless of bar volume, overstating exit quality on thin bars.

apply_exit_volume_price_impact() is the symmetric exit-side counterpart: since an exit
can never be "partially filled" (a stop-out must close the FULL remaining position),
it degrades the fill PRICE instead of the size, using the same 3-zone qty/bar-volume
ratio shape as the entry-side model.

Verifies:
- BACKTEST_EXIT_PARTIAL_FILL_ENABLED unset/false (default) -> price UNCHANGED
  (byte-identical to pre-B-3 behavior) — this is the critical off-path regression guard.
- Small closing order relative to bar volume -> no degradation even when enabled.
- Medium closing order (linear zone) -> degraded price, correct direction per side.
- Large closing order (> bar volume) -> forced max impact (MAX_EXIT_IMPACT_TICKS).
- Edge cases (zero/absent volume, invalid exit_size, out-of-range bar_idx) -> no-op.
- Determinism: same inputs -> same output (no randomness in this model).

Per CLAUDE.md: fill model outputs adjusted PRICES here; P&L is always computed by
backtester.py using the futures formula, never passed to vectorbt slippage/fees.
"""

from __future__ import annotations

import importlib
import os
from datetime import datetime, timedelta
from unittest.mock import patch

import numpy as np
import polars as pl
import pytest


def _make_df_with_volume(n: int = 20, volume_per_bar: int = 10000) -> pl.DataFrame:
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4500.0] * n,
        "high": [4505.0] * n,
        "low": [4495.0] * n,
        "close": [4502.0] * n,
        "volume": [volume_per_bar] * n,
    })


def _make_df_no_volume(n: int = 10) -> pl.DataFrame:
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4500.0] * n,
        "high": [4505.0] * n,
        "low": [4495.0] * n,
        "close": [4502.0] * n,
    })


RAW_PRICE = 4500.0
TICK_SIZE = 0.25


# ─── Off-path (default) regression guard ────────────────────────────────────


class TestOffPathUnchanged:
    """The flag defaults FALSE. This is the load-bearing regression guard: it must
    fail loudly if a future edit flips the default or short-circuits incorrectly."""

    def test_env_unset_returns_price_unchanged(self):
        df = _make_df_with_volume(n=5, volume_per_bar=5)  # thin bar, would degrade if ON
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("BACKTEST_EXIT_PARTIAL_FILL_ENABLED", None)
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=100.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == RAW_PRICE
        assert audit["enabled"] is False
        assert audit["impact_ticks"] == 0.0

    def test_env_explicit_false_returns_price_unchanged(self):
        df = _make_df_with_volume(n=5, volume_per_bar=5)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "false"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price_long, _ = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=1000.0,
                df=df, tick_size=TICK_SIZE,
            )
            price_short, _ = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=True, bar_idx=0, exit_size=1000.0,
                df=df, tick_size=TICK_SIZE,
            )

        # Even a massively oversized closing order (1000 contracts on a 5-volume
        # bar — zone 3, would be forced to max impact if enabled) must produce
        # byte-identical output to today when the flag is off.
        assert price_long == RAW_PRICE
        assert price_short == RAW_PRICE


# ─── On-path behavior ────────────────────────────────────────────────────────


class TestOnPathDegradation:
    def test_small_order_no_degradation_even_when_enabled(self):
        # bar_volume=10000, exit_size=50 -> ratio=0.005 < default threshold 0.1
        df = _make_df_with_volume(n=3, volume_per_bar=10000)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == pytest.approx(RAW_PRICE, abs=1e-9)
        assert audit["enabled"] is True
        assert audit["impact_ticks"] == pytest.approx(0.0, abs=1e-9)

    def test_medium_order_long_exit_degrades_price_downward(self):
        # bar_volume=100, exit_size=50 -> ratio=0.5 (linear zone [0.1, 1.0])
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE, volume_threshold=0.1,
            )

        expected_ticks = fm.MAX_EXIT_IMPACT_TICKS * (0.5 - 0.1) / (1.0 - 0.1 + 1e-10)
        assert audit["impact_ticks"] == pytest.approx(expected_ticks, rel=0.01)
        assert 0.0 < audit["impact_ticks"] < fm.MAX_EXIT_IMPACT_TICKS
        # Closing a LONG realizes LESS: price must move DOWN (worse for the seller)
        assert price < RAW_PRICE
        assert price == pytest.approx(RAW_PRICE - expected_ticks * TICK_SIZE, rel=0.01)

    def test_medium_order_short_exit_degrades_price_upward(self):
        # Same ratio as above, but closing a SHORT: buy-to-cover costs MORE (price up)
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=True, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE, volume_threshold=0.1,
            )

        assert price > RAW_PRICE
        assert audit["impact_ticks"] > 0.0

    def test_large_order_forced_max_impact(self):
        # bar_volume=10, exit_size=50 -> ratio=5.0 > 1.0 (zone 3)
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert audit["impact_ticks"] == pytest.approx(fm.MAX_EXIT_IMPACT_TICKS, abs=1e-9)
        assert price == pytest.approx(RAW_PRICE - fm.MAX_EXIT_IMPACT_TICKS * TICK_SIZE, abs=1e-9)

    def test_impact_never_favorable(self):
        """Impact must never IMPROVE the exit price, regardless of side."""
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price_long, _ = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE,
            )
            price_short, _ = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=True, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price_long <= RAW_PRICE
        assert price_short >= RAW_PRICE


# ─── Edge cases (all no-op even when enabled) ────────────────────────────────


class TestEdgeCasesAreNoOp:
    def test_zero_volume_bar_is_noop(self):
        df = _make_df_with_volume(n=3, volume_per_bar=0)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=1000.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == RAW_PRICE
        assert audit["reason"] == "zero_or_invalid_bar_volume"

    def test_no_volume_column_is_noop(self):
        df = _make_df_no_volume(n=5)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=1000.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == RAW_PRICE
        assert audit["reason"] == "no_volume_data"

    def test_out_of_range_bar_idx_is_noop(self):
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=99, exit_size=1000.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == RAW_PRICE
        assert audit["reason"] == "no_volume_data"

    def test_zero_exit_size_is_noop(self):
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=0.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == RAW_PRICE
        assert audit["reason"] == "zero_or_invalid_exit_size"

    def test_negative_exit_size_is_noop(self):
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price, audit = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=-5.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price == RAW_PRICE
        assert audit["reason"] == "zero_or_invalid_exit_size"


# ─── Determinism ──────────────────────────────────────────────────────────────


class TestDeterminism:
    def test_same_inputs_same_output(self):
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        with patch.dict(os.environ, {"BACKTEST_EXIT_PARTIAL_FILL_ENABLED": "true"}):
            import src.engine.fill_model as fm
            importlib.reload(fm)
            price_a, audit_a = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE,
            )
            price_b, audit_b = fm.apply_exit_volume_price_impact(
                RAW_PRICE, is_short=False, bar_idx=0, exit_size=50.0,
                df=df, tick_size=TICK_SIZE,
            )

        assert price_a == price_b
        assert audit_a["impact_ticks"] == audit_b["impact_ticks"]
