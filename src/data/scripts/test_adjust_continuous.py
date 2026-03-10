"""Tests for continuous contract adjustment logic."""

import pytest
import polars as pl
from datetime import datetime, timedelta
from adjust_continuous import detect_roll_dates, ratio_adjust, panama_adjust


def make_synthetic_data(
    n_days: int = 20,
    roll_day: int = 10,
    pre_roll_close: float = 100.0,
    post_roll_open: float = 105.0,
    daily_move: float = 1.0,
) -> pl.DataFrame:
    """Create synthetic 1-min OHLCV data with a single roll."""
    rows = []
    bars_per_day = 390  # 6.5 hours of trading
    instrument_id = 1

    for day in range(n_days):
        date = datetime(2024, 1, 1) + timedelta(days=day)

        if day == roll_day:
            instrument_id = 2  # New contract

        base_price = pre_roll_close + (day * daily_move)
        if day >= roll_day:
            # Post-roll: prices jump by the gap
            gap = post_roll_open - pre_roll_close
            base_price = post_roll_open + ((day - roll_day) * daily_move)

        for bar in range(bars_per_day):
            ts = date.replace(hour=9, minute=30) + timedelta(minutes=bar)
            noise = (bar % 5) * 0.1
            rows.append({
                "ts_event": ts,
                "open": base_price + noise,
                "high": base_price + noise + 0.5,
                "low": base_price + noise - 0.5,
                "close": base_price + noise + 0.2,
                "volume": 100 + bar,
                "instrument_id": instrument_id,
            })

    return pl.DataFrame(rows).sort("ts_event")


class TestDetectRollDates:
    def test_detects_single_roll(self):
        df = make_synthetic_data(roll_day=10)
        rolls = detect_roll_dates(df)
        assert len(rolls) == 1
        assert rolls[0]["roll_idx"] > 0

    def test_no_roll_when_single_contract(self):
        df = make_synthetic_data(roll_day=999)  # No roll within data
        rolls = detect_roll_dates(df)
        assert len(rolls) == 0


class TestRatioAdjust:
    def test_post_roll_prices_unchanged(self):
        df = make_synthetic_data(
            roll_day=10, pre_roll_close=100.0, post_roll_open=105.0
        )
        rolls = detect_roll_dates(df)
        adjusted = ratio_adjust(df, rolls)

        # Post-roll rows should be identical
        roll_idx = rolls[0]["roll_idx"]
        orig_post = df.slice(roll_idx)
        adj_post = adjusted.slice(roll_idx)

        assert orig_post["close"].to_list() == pytest.approx(
            adj_post["close"].to_list(), rel=1e-6
        )

    def test_pre_roll_prices_scaled(self):
        df = make_synthetic_data(
            roll_day=10, pre_roll_close=100.0, post_roll_open=105.0
        )
        rolls = detect_roll_dates(df)
        adjusted = ratio_adjust(df, rolls)

        roll_idx = rolls[0]["roll_idx"]
        ratio = rolls[0]["ratio"]

        # Pre-roll close should be multiplied by ratio
        orig_pre_close = df["close"][0]
        adj_pre_close = adjusted["close"][0]
        assert adj_pre_close == pytest.approx(orig_pre_close * ratio, rel=1e-6)

    def test_no_negative_prices(self):
        df = make_synthetic_data(
            roll_day=10, pre_roll_close=100.0, post_roll_open=105.0
        )
        rolls = detect_roll_dates(df)
        adjusted = ratio_adjust(df, rolls)
        assert adjusted.filter(pl.col("close") < 0).height == 0
        assert adjusted.filter(pl.col("open") < 0).height == 0

    def test_row_count_unchanged(self):
        df = make_synthetic_data(roll_day=10)
        rolls = detect_roll_dates(df)
        adjusted = ratio_adjust(df, rolls)
        assert adjusted.height == df.height


class TestPanamaAdjust:
    def test_post_roll_prices_unchanged(self):
        df = make_synthetic_data(
            roll_day=10, pre_roll_close=100.0, post_roll_open=105.0
        )
        rolls = detect_roll_dates(df)
        adjusted = panama_adjust(df, rolls)

        roll_idx = rolls[0]["roll_idx"]
        orig_post = df.slice(roll_idx)
        adj_post = adjusted.slice(roll_idx)

        assert orig_post["close"].to_list() == pytest.approx(
            adj_post["close"].to_list(), rel=1e-6
        )

    def test_pre_roll_prices_shifted(self):
        df = make_synthetic_data(
            roll_day=10, pre_roll_close=100.0, post_roll_open=105.0
        )
        rolls = detect_roll_dates(df)
        adjusted = panama_adjust(df, rolls)

        gap = rolls[0]["gap"]
        orig_close_0 = df["close"][0]
        adj_close_0 = adjusted["close"][0]
        assert adj_close_0 == pytest.approx(orig_close_0 + gap, rel=1e-6)

    def test_row_count_unchanged(self):
        df = make_synthetic_data(roll_day=10)
        rolls = detect_roll_dates(df)
        adjusted = panama_adjust(df, rolls)
        assert adjusted.height == df.height
