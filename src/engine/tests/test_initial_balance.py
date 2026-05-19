"""Tests for initial_balance.py — IB high/low, extension status, edge cases.

Minimum 8 tests as required by Track 2 spec.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.initial_balance import (
    IB_END_MINUTES,
    IB_START_MINUTES,
    InitialBalance,
    compute_initial_balance,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────

def make_rth_bars(
    include_ib: bool = True,
    include_post_ib: bool = True,
    ib_high: float = 5010.0,
    ib_low: float = 5000.0,
    post_ib_high: float = 5005.0,   # within IB by default
    post_ib_low: float = 5002.0,
    date_: str = "2026-01-02",
) -> pl.DataFrame:
    """Build synthetic RTH bars for a single session."""
    rows = []
    base = datetime.fromisoformat(f"{date_} 09:30:00")

    if include_ib:
        # 12 bars x 5min = 60 min covering 9:30-10:30
        for i in range(12):
            ts = base + timedelta(minutes=5 * i)
            rows.append({
                "ts_event": ts,
                "open": (ib_high + ib_low) / 2,
                "high": ib_high,
                "low": ib_low,
                "close": (ib_high + ib_low) / 2,
                "volume": 1000.0,
            })

    if include_post_ib:
        # 12 bars starting at 10:30
        post_start = datetime.fromisoformat(f"{date_} 10:30:00")
        for i in range(12):
            ts = post_start + timedelta(minutes=5 * i)
            rows.append({
                "ts_event": ts,
                "open": (post_ib_high + post_ib_low) / 2,
                "high": post_ib_high,
                "low": post_ib_low,
                "close": (post_ib_high + post_ib_low) / 2,
                "volume": 500.0,
            })

    if not rows:
        return pl.DataFrame({
            "ts_event": pl.Series([], dtype=pl.Datetime("us")),
            "open": pl.Series([], dtype=pl.Float64),
            "high": pl.Series([], dtype=pl.Float64),
            "low": pl.Series([], dtype=pl.Float64),
            "close": pl.Series([], dtype=pl.Float64),
            "volume": pl.Series([], dtype=pl.Float64),
        })

    return pl.DataFrame(rows)


# ─── Test 1: IB high/low computed correctly ───────────────────────────────────

def test_ib_high_low_correct():
    """IB high and low match the extremes of the first-hour bars."""
    bars = make_rth_bars(ib_high=5015.0, ib_low=4998.0)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert abs(ib.ib_high - 5015.0) < 1e-9
    assert abs(ib.ib_low - 4998.0) < 1e-9
    assert abs(ib.ib_range - (5015.0 - 4998.0)) < 1e-9


# ─── Test 2: IB_HOLD when no breakout ───────────────────────────────────────

def test_ib_hold_no_breakout():
    """Post-IB bars stay within IB → IB_HOLD status."""
    bars = make_rth_bars(ib_high=5010.0, ib_low=5000.0, post_ib_high=5009.0, post_ib_low=5001.0)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert ib.ib_extension_status == "IB_HOLD"
    assert not ib.ib_extended_high
    assert not ib.ib_extended_low


# ─── Test 3: IB_EXTENSION_UP when high broken ────────────────────────────────

def test_ib_extension_up():
    """Post-IB high > IB high → IB_EXTENSION_UP."""
    bars = make_rth_bars(ib_high=5010.0, ib_low=5000.0, post_ib_high=5015.0, post_ib_low=5002.0)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert ib.ib_extension_status == "IB_EXTENSION_UP"
    assert ib.ib_extended_high is True
    assert ib.ib_extended_low is False


# ─── Test 4: IB_EXTENSION_DOWN when low broken ───────────────────────────────

def test_ib_extension_down():
    """Post-IB low < IB low → IB_EXTENSION_DOWN."""
    bars = make_rth_bars(ib_high=5010.0, ib_low=5000.0, post_ib_high=5008.0, post_ib_low=4995.0)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert ib.ib_extension_status == "IB_EXTENSION_DOWN"
    assert ib.ib_extended_low is True
    assert ib.ib_extended_high is False


# ─── Test 5: IB_EXTENSION_BOTH when both sides broken ────────────────────────

def test_ib_extension_both():
    """Post-IB high > IB high AND low < IB low → IB_EXTENSION_BOTH."""
    bars = make_rth_bars(ib_high=5010.0, ib_low=5000.0, post_ib_high=5020.0, post_ib_low=4990.0)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert ib.ib_extension_status == "IB_EXTENSION_BOTH"
    assert ib.ib_extended_high is True
    assert ib.ib_extended_low is True


# ─── Test 6: Missing first-hour bars returns None ────────────────────────────

def test_missing_ib_bars_returns_none():
    """If no bars exist in the 9:30-10:30 window → return None."""
    # Only post-IB bars
    bars = make_rth_bars(include_ib=False, include_post_ib=True)
    ib = compute_initial_balance(bars)
    assert ib is None


# ─── Test 7: Bar count tracking ──────────────────────────────────────────────

def test_bar_counts():
    """ib_bar_count and post_ib_bar_count reflect actual bar counts."""
    bars = make_rth_bars(include_ib=True, include_post_ib=True)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert ib.ib_bar_count == 12      # 9:30-10:25 (12 bars, 5m)
    assert ib.post_ib_bar_count == 12  # 10:30-11:25


# ─── Test 8: Half-day session (IB-only bars) ──────────────────────────────────

def test_half_day_only_ib_bars():
    """Session with only IB bars (no post-IB) → IB_HOLD, post_ib_bar_count=0."""
    bars = make_rth_bars(include_ib=True, include_post_ib=False)
    ib = compute_initial_balance(bars)
    assert ib is not None
    assert ib.post_ib_bar_count == 0
    assert ib.ib_extension_status == "IB_HOLD"


# ─── Test 9: Empty DataFrame returns None ────────────────────────────────────

def test_empty_bars_returns_none():
    bars = pl.DataFrame({
        "ts_event": pl.Series([], dtype=pl.Datetime("us")),
        "high": pl.Series([], dtype=pl.Float64),
        "low": pl.Series([], dtype=pl.Float64),
    })
    ib = compute_initial_balance(bars)
    assert ib is None


# ─── Test 10: Determinism ─────────────────────────────────────────────────────

def test_determinism():
    """Same bars always produce identical result."""
    bars = make_rth_bars(ib_high=5010.0, ib_low=5000.0, post_ib_high=5020.0, post_ib_low=4995.0)
    ib1 = compute_initial_balance(bars)
    ib2 = compute_initial_balance(bars)
    assert ib1 is not None and ib2 is not None
    assert ib1.ib_high == ib2.ib_high
    assert ib1.ib_low == ib2.ib_low
    assert ib1.ib_extension_status == ib2.ib_extension_status
