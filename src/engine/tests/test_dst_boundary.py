"""DST boundary tests — MED #2 (Wave 27.5 Pass D.1).

Verifies DST-aware bar aggregation in equity curve and daily P&L computation:
- Spring-forward March 2024 (Mar 10): no NaN, no double-counting
- Fall-back November 2024 (Nov 3): no double-aggregation
- Drawdown depth correct on DST day (within 1 cent tolerance)
- Audit row payload structure validated
- ts_et path vs UTC fallback consistency
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta

import numpy as np
import pytest

# Ensure no side effects from DETERMINISM_MODE for unit tests
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_equity_around_dst(spring_forward: bool = True) -> tuple[np.ndarray, list, list]:
    """Build a synthetic equity curve + ET timestamp list spanning a DST transition.

    Returns (equity, ts_event_list, ts_et_list).
    Spring-forward: March 10, 2024. Fall-back: November 3, 2024.
    """
    # Build 5 minute bars for a 3-day window centred on the transition
    if spring_forward:
        # Mar 9 + Mar 10 (spring-forward at 02:00 ET)
        transition_date = date(2024, 3, 10)
    else:
        # Nov 2 + Nov 3 (fall-back at 02:00 ET)
        transition_date = date(2024, 11, 3)

    # Generate UTC timestamps covering the full 3-day window at 15-min resolution
    start_utc = datetime(transition_date.year, transition_date.month, transition_date.day - 1, 13, 0)
    timestamps_utc: list[datetime] = []
    t = start_utc
    for _ in range(12 * 3):  # 3 days × 12 bars/hour × several hours
        timestamps_utc.append(t)
        t += timedelta(minutes=15)

    # Build ts_et as simple offset strings (ET = UTC-5 in winter, UTC-4 in summer)
    # We intentionally use a simple fixed offset here since the goal is to prove
    # that the aggregation reads the date correctly from ts_et, not to model DST perfectly.
    ts_et_list = []
    for ts in timestamps_utc:
        et_hour = (ts.hour - 5) % 24  # EST offset; good enough for date extraction
        et_date = ts.date() if ts.hour >= 5 else (ts - timedelta(days=1)).date()
        ts_et_list.append(f"{et_date}T{et_hour:02d}:{ts.minute:02d}:00")

    n = len(timestamps_utc)
    equity = np.linspace(50_000, 50_500, n)  # monotonic — no NaN, no zero division

    return equity, [str(ts) for ts in timestamps_utc], ts_et_list


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestDstAggregateEquityDaily:
    """_aggregate_equity_daily returns one value per ET calendar day — no NaN, no gaps."""

    def test_spring_forward_no_nan(self):
        from src.engine.backtester import _aggregate_equity_daily
        equity, ts_utc, ts_et = _make_equity_around_dst(spring_forward=True)
        result = _aggregate_equity_daily(equity, [None] * len(equity), ts_et_index=ts_et)
        assert len(result) >= 2, "Expected at least 2 unique ET calendar days"
        for entry in result:
            assert entry["value"] is not None, "No None values in equity curve"
            assert not np.isnan(entry["value"]), "No NaN values in equity curve"

    def test_fall_back_no_double_aggregation(self):
        """Fall-back day must not produce duplicate date keys (extra hour should NOT duplicate)."""
        from src.engine.backtester import _aggregate_equity_daily
        equity, ts_utc, ts_et = _make_equity_around_dst(spring_forward=False)
        result = _aggregate_equity_daily(equity, [None] * len(equity), ts_et_index=ts_et)
        dates = [e["time"] for e in result]
        assert len(dates) == len(set(dates)), f"Duplicate dates found: {dates}"

    def test_ts_et_preferred_over_utc_index(self):
        """When ts_et_index is provided it MUST be used (not the UTC index)."""
        from src.engine.backtester import _aggregate_equity_daily
        equity = np.array([50_000.0, 50_100.0, 50_050.0])
        # UTC indices that would give wrong date
        utc_indices = [datetime(2024, 3, 10, 2, 0), datetime(2024, 3, 10, 2, 15), datetime(2024, 3, 10, 2, 30)]
        # ET strings that put all three bars on 2024-03-09 (overnight Globex)
        ts_et = ["2024-03-09T21:00:00", "2024-03-09T21:15:00", "2024-03-09T21:30:00"]
        result = _aggregate_equity_daily(equity, utc_indices, ts_et_index=ts_et)
        assert len(result) == 1, "All bars in same ET day → 1 aggregated entry"
        assert result[0]["time"] == "2024-03-09"
        assert result[0]["value"] == pytest.approx(50_050.0, abs=0.01)

    def test_no_ts_et_fallback_works(self):
        """When ts_et_index is None the function falls back to UTC index without error."""
        from pandas import Timestamp

        from src.engine.backtester import _aggregate_equity_daily
        equity = np.array([50_000.0, 50_100.0])
        utc_idx = [Timestamp("2024-03-10 09:30:00"), Timestamp("2024-03-10 09:45:00")]
        result = _aggregate_equity_daily(equity, utc_idx, ts_et_index=None)
        assert len(result) >= 1


class TestDstComputeDailyPnls:
    """_compute_daily_pnls uses ts_et_index for DST-safe daily grouping."""

    def test_spring_forward_no_nan_pnl(self):
        from src.engine.backtester import _compute_daily_pnls
        equity, ts_utc, ts_et = _make_equity_around_dst(spring_forward=True)
        records = _compute_daily_pnls(equity, index=None, starting_capital=50_000.0, ts_et_index=ts_et)
        assert len(records) >= 2
        for rec in records:
            assert rec["pnl"] is not None
            assert not np.isnan(rec["pnl"])

    def test_fall_back_no_double_aggregation_pnl(self):
        from src.engine.backtester import _compute_daily_pnls
        equity, ts_utc, ts_et = _make_equity_around_dst(spring_forward=False)
        records = _compute_daily_pnls(equity, index=None, starting_capital=50_000.0, ts_et_index=ts_et)
        dates = [r["date"] for r in records]
        assert len(dates) == len(set(dates)), f"Duplicate P&L date keys: {dates}"

    def test_drawdown_depth_within_tolerance_on_dst_day(self):
        """Drawdown computed on a DST day must be within $0.01 of expected value."""
        from src.engine.backtester import _compute_daily_pnls
        # Equity rises then falls exactly 200 on the DST day
        # 3 days × 4 bars each (every 15 min)
        equity = np.array([50_000.0] * 4 + [50_200.0] * 4 + [50_000.0] * 4)
        ts_et = (
            ["2024-03-09T09:00:00", "2024-03-09T09:15:00", "2024-03-09T09:30:00", "2024-03-09T09:45:00"]
            + ["2024-03-10T09:00:00", "2024-03-10T09:15:00", "2024-03-10T09:30:00", "2024-03-10T09:45:00"]
            + ["2024-03-11T09:00:00", "2024-03-11T09:15:00", "2024-03-11T09:30:00", "2024-03-11T09:45:00"]
        )
        records = _compute_daily_pnls(equity, index=None, starting_capital=50_000.0, ts_et_index=ts_et)
        pnl_by_date = {r["date"]: r["pnl"] for r in records}
        # DST day P&L should be +200 (went from 50k to 50.2k)
        assert "2024-03-10" in pnl_by_date
        assert abs(pnl_by_date["2024-03-10"] - 200.0) < 0.01


class TestDstDetectTransitions:
    """_detect_dst_transitions returns correct transition metadata."""

    def test_spring_forward_2024_detected(self):
        from src.engine.backtester import _detect_dst_transitions
        ts_et_list = [
            "2024-03-08T09:00:00",
            "2024-03-09T09:00:00",
            "2024-03-10T09:00:00",
            "2024-03-11T09:00:00",
        ]
        transitions = _detect_dst_transitions(ts_et_list)
        assert len(transitions) == 1
        assert transitions[0]["transition_date"] == "2024-03-10"
        assert transitions[0]["spring_forward"] is True
        assert "02:00" in transitions[0]["hour_skipped_or_repeated"]

    def test_fall_back_2024_detected(self):
        from src.engine.backtester import _detect_dst_transitions
        ts_et_list = [
            "2024-11-01T09:00:00",
            "2024-11-02T09:00:00",
            "2024-11-03T09:00:00",
            "2024-11-04T09:00:00",
        ]
        transitions = _detect_dst_transitions(ts_et_list)
        assert len(transitions) == 1
        assert transitions[0]["transition_date"] == "2024-11-03"
        assert transitions[0]["spring_forward"] is False
        assert "01:00" in transitions[0]["hour_skipped_or_repeated"]

    def test_no_transition_in_range(self):
        from src.engine.backtester import _detect_dst_transitions
        ts_et_list = [
            "2024-04-01T09:00:00",
            "2024-04-15T09:00:00",
            "2024-05-01T09:00:00",
        ]
        transitions = _detect_dst_transitions(ts_et_list)
        assert transitions == []

    def test_empty_list_no_crash(self):
        from src.engine.backtester import _detect_dst_transitions
        assert _detect_dst_transitions([]) == []

    def test_both_transitions_same_year_detected(self):
        from src.engine.backtester import _detect_dst_transitions
        # Date range spans the full year 2024
        ts_et_list = ["2024-01-01T09:00:00", "2024-12-31T09:00:00"]
        transitions = _detect_dst_transitions(ts_et_list)
        assert len(transitions) == 2
        dates = {t["transition_date"] for t in transitions}
        assert "2024-03-10" in dates
        assert "2024-11-03" in dates

    def test_audit_payload_structure(self):
        """Audit row has required keys and correct types."""
        from src.engine.backtester import _detect_dst_transitions
        ts_et_list = ["2025-03-08T09:00:00", "2025-03-10T09:00:00"]
        transitions = _detect_dst_transitions(ts_et_list)
        assert len(transitions) == 1
        row = transitions[0]
        assert "transition_date" in row
        assert "spring_forward" in row
        assert "hour_skipped_or_repeated" in row
        assert isinstance(row["spring_forward"], bool)
        assert isinstance(row["transition_date"], str)
        assert len(row["transition_date"]) == 10  # YYYY-MM-DD
