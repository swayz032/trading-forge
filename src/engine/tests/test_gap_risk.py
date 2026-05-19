"""Tests for overnight gap risk model (Task 3.9)."""

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.gap_risk import (
    GAP_DISTRIBUTIONS,
    compute_overnight_gaps,
    tag_trades_overnight,
    compute_gap_adjusted_mae,
    compute_gap_adjusted_drawdown,
)


def _make_multi_day_df(days: int = 5, bars_per_day: int = 10) -> pl.DataFrame:
    """Create multi-day OHLCV data with clear session boundaries."""
    timestamps = []
    opens = []
    highs = []
    lows = []
    closes = []
    volumes = []

    for day in range(days):
        base_date = datetime(2024, 1, 1 + day, 9, 30)  # 9:30 AM
        base_price = 4000.0 + day * 5.0
        gap = 3.0 if day > 0 else 0.0  # gap between sessions

        for bar in range(bars_per_day):
            ts = base_date + timedelta(minutes=bar * 30)
            timestamps.append(ts)
            o = base_price + gap + bar * 0.5
            c = o + 1.0
            opens.append(o)
            highs.append(c + 2.0)
            lows.append(o - 2.0)
            closes.append(c)
            volumes.append(50000)

    return pl.DataFrame({
        "ts_event": timestamps,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    })


class TestOvernightGaps:
    def test_gaps_detected_at_session_open(self):
        """Gaps are computed at the first bar of each new date."""
        df = _make_multi_day_df(3, 5)
        gaps = compute_overnight_gaps(df)
        assert len(gaps) == len(df)

        # First bar of first day: no prior close → gap = 0
        assert gaps[0] == 0.0

        # First bar of second day: should have a gap
        # Gap = open[5] - close[4]
        gap_day2 = gaps[5]
        assert gap_day2 != 0.0, "Should detect gap at session open"

    def test_non_session_open_bars_zero(self):
        """Non-session-open bars have zero gap."""
        df = _make_multi_day_df(3, 5)
        gaps = compute_overnight_gaps(df)

        # Bars 1-4 (mid-session) should be 0
        for i in [1, 2, 3, 4]:
            assert gaps[i] == 0.0


class TestTradeTagging:
    def test_intraday_trade(self):
        """Trade 10 AM → 2 PM same day = INTRADAY_ONLY."""
        df = _make_multi_day_df(3, 10)
        trades = [{
            "Entry Index": 2,   # same day
            "Exit Index": 5,    # same day
            "PnL": 100,
        }]

        tagged = tag_trades_overnight(trades, df["ts_event"])
        assert tagged[0]["hold_type"] == "INTRADAY_ONLY"

    def test_overnight_trade(self):
        """Trade 3:30 PM → next day 10 AM = HOLDS_OVERNIGHT."""
        df = _make_multi_day_df(3, 10)
        trades = [{
            "Entry Index": 8,    # end of day 1
            "Exit Index": 12,    # start of day 2
            "PnL": -50,
        }]

        tagged = tag_trades_overnight(trades, df["ts_event"])
        assert tagged[0]["hold_type"] == "HOLDS_OVERNIGHT"

    def test_preserves_original_fields(self):
        """Tagging preserves all original trade fields."""
        df = _make_multi_day_df(3, 10)
        trades = [{"Entry Index": 2, "Exit Index": 5, "PnL": 100, "custom": "data"}]

        tagged = tag_trades_overnight(trades, df["ts_event"])
        assert tagged[0]["PnL"] == 100
        assert tagged[0]["custom"] == "data"


class TestGapAdjustedMAE:
    def test_overnight_mae_increased(self):
        """Gap-adjusted MAE > raw MAE for overnight trades."""
        df = _make_multi_day_df(3, 10)
        gaps = compute_overnight_gaps(df)

        trades = [{
            "Entry Index": 8,
            "Exit Index": 12,
            "PnL": -50,
            "MAE": 100.0,
            "hold_type": "HOLDS_OVERNIGHT",
        }]

        adjusted = compute_gap_adjusted_mae(trades, gaps, symbol="MES", seed=42)
        assert adjusted[0]["gap_adjusted_mae"] > 100.0
        assert adjusted[0]["simulated_gap"] > 0

    def test_intraday_mae_unchanged(self):
        """Intraday-only strategy: gap adjustment = zero effect."""
        df = _make_multi_day_df(3, 10)
        gaps = compute_overnight_gaps(df)

        trades = [{
            "Entry Index": 2,
            "Exit Index": 5,
            "PnL": 100,
            "MAE": 50.0,
            "hold_type": "INTRADAY_ONLY",
        }]

        adjusted = compute_gap_adjusted_mae(trades, gaps, symbol="MES", seed=42)
        assert adjusted[0]["gap_adjusted_mae"] == 50.0
        assert adjusted[0]["simulated_gap"] == 0.0

    def test_deterministic_with_seed(self):
        """Same seed produces same gap-adjusted MAE."""
        df = _make_multi_day_df(3, 10)
        gaps = compute_overnight_gaps(df)

        trades = [{
            "Entry Index": 8,
            "Exit Index": 12,
            "MAE": 100.0,
            "hold_type": "HOLDS_OVERNIGHT",
        }]

        a1 = compute_gap_adjusted_mae(trades, gaps, symbol="MES", seed=42)
        a2 = compute_gap_adjusted_mae(trades, gaps, symbol="MES", seed=42)
        assert a1[0]["gap_adjusted_mae"] == a2[0]["gap_adjusted_mae"]


class TestGapAdjustedDrawdown:
    def test_overnight_increases_drawdown(self):
        """Gap-adjusted drawdown > raw drawdown for overnight strategies."""
        # Equity curve: rising then small dip — gap impact should widen the dip
        equity = [50000, 50010, 50020, 50015, 50018, 50025]
        trades = [{
            "Entry Index": 1,
            "Exit Index": 3,
            "hold_type": "HOLDS_OVERNIGHT",
        }]

        df = _make_multi_day_df(3, 10)
        gaps = compute_overnight_gaps(df)

        gap_dd = compute_gap_adjusted_drawdown(
            equity, trades, gaps, symbol="MES", point_value=5.0, seed=42,
        )

        # Raw max DD: peak at 50020, trough at 50015 → DD = 5
        raw_equity = np.array(equity)
        raw_running_max = np.maximum.accumulate(raw_equity)
        raw_max_dd = float(np.max(raw_running_max - raw_equity))

        assert gap_dd > raw_max_dd, (
            f"Gap-adjusted DD {gap_dd} should exceed raw DD {raw_max_dd}"
        )

    def test_intraday_no_drawdown_change(self):
        """Intraday-only trades don't change gap-adjusted drawdown."""
        equity = [50000, 100500, 101000, 100200, 100800]
        trades = [{
            "Entry Index": 1,
            "Exit Index": 2,
            "hold_type": "INTRADAY_ONLY",
        }]

        df = _make_multi_day_df(3, 10)
        gaps = compute_overnight_gaps(df)

        gap_dd = compute_gap_adjusted_drawdown(
            equity, trades, gaps, symbol="MES", point_value=5.0, seed=42,
        )

        # Should equal raw max DD since no overnight trades
        raw_max_dd = 101000 - 100200  # 800
        assert gap_dd == raw_max_dd

    def test_empty_equity_returns_zero(self):
        """Empty equity curve returns 0 drawdown."""
        df = _make_multi_day_df(1, 5)
        gaps = compute_overnight_gaps(df)
        dd = compute_gap_adjusted_drawdown([], [], gaps)
        assert dd == 0.0


class TestGapDistributions:
    def test_all_micro_symbols_covered(self):
        """MES, MNQ, MCL all have gap distributions."""
        for symbol in ["MES", "MNQ", "MCL"]:
            assert symbol in GAP_DISTRIBUTIONS

    def test_crisis_gaps_larger_than_normal(self):
        """Crisis gap means/stds are larger than normal for all symbols."""
        for symbol, dist in GAP_DISTRIBUTIONS.items():
            assert dist["crisis_mean"] > dist["normal_mean"]
            assert dist["crisis_std"] > dist["normal_std"]
