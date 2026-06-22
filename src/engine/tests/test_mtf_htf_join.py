"""W23H.1 — Unit tests for MTF HTF column join.

Tests the core no-look-ahead invariant: exec-TF bar at 10:15 must get the
4H value from the 06:00-10:00 bar (closed), NOT the 10:00-14:00 bar (forming).

Run:
    python -m pytest src/engine/tests/test_mtf_htf_join.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone

import polars as pl
import pytest

from src.engine.indicators.mtf_join import forward_fill_htf_to_exec


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _ts(dt_str: str) -> datetime:
    """Parse 'YYYY-MM-DD HH:MM' to UTC datetime."""
    return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)


def _make_15m_bars(dates_times: list[str]) -> pl.DataFrame:
    """Build a minimal 15-minute exec DataFrame."""
    ts = [_ts(d) for d in dates_times]
    n = len(ts)
    return pl.DataFrame({
        "ts_event": ts,
        "open": [100.0] * n,
        "high": [101.0] * n,
        "low": [99.0] * n,
        "close": [100.5] * n,
        "volume": [1000.0] * n,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


def _make_4h_bars_with_ema(ts_and_ema: list[tuple[str, float]]) -> pl.DataFrame:
    """Build a 4H DataFrame with a pre-computed ema_50_4h column."""
    ts = [_ts(d) for d, _ in ts_and_ema]
    ema_vals = [v for _, v in ts_and_ema]
    n = len(ts)
    return pl.DataFrame({
        "ts_event": ts,
        "open": [100.0] * n,
        "high": [101.0] * n,
        "low": [99.0] * n,
        "close": [100.5] * n,
        "volume": [5000.0] * n,
        "ema_50_4h": ema_vals,
        "ema_200_4h": [c + 1.0 for c in ema_vals],  # slightly above ema_50_4h
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestForwardFillHtfToExec:
    """Tests for forward_fill_htf_to_exec()."""

    def test_ema_50_4h_column_appears_on_exec_df(self):
        """After join, exec_df must have ema_50_4h column."""
        exec_df = _make_15m_bars([
            "2024-01-02 09:30",
            "2024-01-02 09:45",
            "2024-01-02 10:00",
        ])
        htf_df = _make_4h_bars_with_ema([
            ("2024-01-02 06:00", 50.0),
            ("2024-01-02 10:00", 51.0),
        ])
        result = forward_fill_htf_to_exec(exec_df, htf_df, ["ema_50_4h", "ema_200_4h"])
        assert "ema_50_4h" in result.columns
        assert "ema_200_4h" in result.columns

    def test_no_lookahead_at_10_15(self):
        """CORE invariant: exec bar at 10:15 must see the LAST CLOSED HTF bar (06:00-10:00).

        CRITICAL look-ahead fix 2026-06-22 — HTF cols shifted +1; exec sees last CLOSED
        HTF bar. ts_event is the HTF bar's OPEN time (Databento standard). Each HTF row's
        indicator value is computed from that bar's CLOSE, only known when the bar closes.

        The +1 shift means: for an exec bar at time T, the joined HTF value is from the
        LAST FULLY CLOSED HTF bar (the bar whose ts_event is <= T, SHIFTED BACK by one
        HTF bar). The still-forming HTF bar (the one T sits inside) is NOT visible.

        Setup: HTF bars at 02:00→49, 06:00→50, 10:00→51 (open-stamped ts_event).
        - exec@09:45: last HTF ts_event <= 09:45 is the 06:00 bar. After +1 shift,
          that row holds the value from the 02:00 bar = 49.0. The 06:00-10:00 bar
          is still forming at 09:45, so its close-derived value (50.0) is invisible.
        - exec@10:15: last HTF ts_event <= 10:15 is the 10:00 bar. After +1 shift,
          that row holds the value from the 06:00 bar = 50.0. The 06:00-10:00 bar
          CLOSED at 10:00, so its value (50.0) now becomes visible. The 10:00-14:00
          bar (ts_event=10:00, still forming at 10:15) is never directly visible.

        This is the regression proof for the CRITICAL fix. The OLD behavior (no shift)
        would have returned 51.0 at 10:15 — leaking the forming bar's final value.
        """
        exec_df = _make_15m_bars([
            "2024-01-02 09:30",
            "2024-01-02 09:45",
            "2024-01-02 10:00",
            "2024-01-02 10:15",  # <-- must see 50.0 (last CLOSED bar), NOT 51.0 (forming)
            "2024-01-02 10:30",
        ])

        # HTF bars with open-stamped ts_event. Values are close-derived indicators.
        # 02:00 bar closes at 06:00, value=49.0
        # 06:00 bar closes at 10:00, value=50.0
        # 10:00 bar closes at 14:00, value=51.0 (forming at 10:15 — must NOT be visible)
        htf_df = _make_4h_bars_with_ema([
            ("2024-01-02 02:00", 49.0),  # 02:00-06:00 bar — closed at 06:00
            ("2024-01-02 06:00", 50.0),  # 06:00-10:00 bar — closed at 10:00
            ("2024-01-02 10:00", 51.0),  # 10:00-14:00 bar — forming at 10:15 (invisible)
        ])

        result = forward_fill_htf_to_exec(exec_df, htf_df, ["ema_50_4h"])
        result_sorted = result.sort("ts_event")

        # CRITICAL look-ahead fix 2026-06-22 — HTF cols shifted +1; exec sees last CLOSED HTF bar.
        # Bar at 10:15: last HTF ts_event <= 10:15 is 10:00 bar; after +1 shift → 06:00 bar's
        # close-derived value = 50.0. The forming 10:00-14:00 bar (51.0) is invisible.
        idx_1015 = 3  # 0-indexed row in sorted result
        val_at_1015 = result_sorted["ema_50_4h"][idx_1015]
        assert val_at_1015 == 50.0, (
            f"Expected 50.0 at 10:15 (last CLOSED HTF bar is 06:00-10:00, value=50.0), "
            f"got {val_at_1015}. The forming 10:00-14:00 bar (51.0) must NOT be visible."
        )

        # Bar at 09:45: last HTF ts_event <= 09:45 is 06:00 bar; after +1 shift → 02:00 bar's
        # close-derived value = 49.0. The forming 06:00-10:00 bar (50.0) is invisible at 09:45.
        idx_0945 = 1
        val_at_0945 = result_sorted["ema_50_4h"][idx_0945]
        assert val_at_0945 == 49.0, (
            f"Expected 49.0 at 09:45 (last CLOSED HTF bar is 02:00-06:00, value=49.0), "
            f"got {val_at_0945}. The forming 06:00-10:00 bar (50.0) must NOT be visible."
        )

    def test_future_htf_bars_not_visible(self):
        """CRITICAL look-ahead fix 2026-06-22 — HTF cols shifted +1; exec sees last CLOSED HTF bar.

        The first HTF bar's close-derived value is NEVER visible until that bar closes
        (i.e., until the NEXT HTF bar's ts_event). Exec bars inside the first forming
        HTF bar always get null — there is no prior closed bar to see.

        Setup:
        - HTF bar 1: ts_event=06:00 → value=55.0 (this is the 06:00-10:00 bar;
          its close-derived value 55.0 is only known at 10:00)
        - HTF bar 2: ts_event=10:00 → value=66.0 (added to make bar 1 visible after close)

        Post-fix invariant:
        - exec@05:00: no HTF bar with ts_event <= 05:00 → null (no data at all)
        - exec@06:00: HTF bar at 06:00 matches (ts_event <= 06:00). After +1 shift that
          row is null (no prior bar exists). The forming 06:00-10:00 bar is invisible.
        - exec@06:15: same as 06:00 — inside the forming bar → null
        - exec@10:00: HTF bar at 10:00 matches. After +1 shift → the 06:00 bar's value
          = 55.0. The 06:00-10:00 bar has now CLOSED, so 55.0 finally becomes visible.
        """
        exec_df = _make_15m_bars([
            "2024-01-02 05:00",   # before any HTF bar
            "2024-01-02 06:00",   # at first HTF bar open — forming, still invisible
            "2024-01-02 06:15",   # inside forming bar — still invisible
            "2024-01-02 10:00",   # at second HTF bar open — first bar NOW closed, visible
        ])
        # Two HTF bars so that bar 1's value becomes visible when bar 2 appears
        htf_df = _make_4h_bars_with_ema([
            ("2024-01-02 06:00", 55.0),   # 06:00-10:00 bar; closes at 10:00
            ("2024-01-02 10:00", 66.0),   # 10:00-14:00 bar; makes bar 1 visible via shift
        ])
        result = forward_fill_htf_to_exec(exec_df, htf_df, ["ema_50_4h"])
        result_sorted = result.sort("ts_event")

        # Bar before HTF start → null (no data at all)
        val_before = result_sorted["ema_50_4h"][0]
        assert val_before is None, (
            f"Expected null before first HTF bar, got {val_before}. "
            f"Look-ahead: future HTF value injected into past exec bar."
        )

        # CRITICAL look-ahead fix 2026-06-22 — HTF cols shifted +1; exec sees last CLOSED HTF bar.
        # exec@06:00 — AT the forming bar's open. After +1 shift the 06:00 row is null
        # (no prior bar). The forming bar's value (55.0) must NOT be visible.
        val_at_0600 = result_sorted["ema_50_4h"][1]
        assert val_at_0600 is None, (
            f"Expected null at 06:00 (inside forming 06:00-10:00 HTF bar, no prior closed bar), "
            f"got {val_at_0600}. The forming bar's close-derived value must NOT be visible."
        )

        # exec@06:15 — still inside the forming bar → null
        val_at_0615 = result_sorted["ema_50_4h"][2]
        assert val_at_0615 is None, (
            f"Expected null at 06:15 (inside forming 06:00-10:00 HTF bar), "
            f"got {val_at_0615}."
        )

        # exec@10:00 — the 10:00 HTF bar is now the last with ts_event <= 10:00.
        # After +1 shift that row holds the 06:00 bar's value = 55.0.
        # The 06:00-10:00 bar has now CLOSED; its close-derived value is finally visible.
        val_at_1000 = result_sorted["ema_50_4h"][3]
        assert val_at_1000 == 55.0, (
            f"Expected 55.0 at 10:00 (the 06:00-10:00 HTF bar just closed; its value "
            f"becomes visible at exactly 10:00), got {val_at_1000}."
        )

    def test_column_count_preserved(self):
        """exec_df row count must be unchanged by the join."""
        exec_df = _make_15m_bars([
            "2024-01-02 09:30",
            "2024-01-02 09:45",
            "2024-01-02 10:00",
            "2024-01-02 10:15",
        ])
        htf_df = _make_4h_bars_with_ema([
            ("2024-01-02 06:00", 50.0),
        ])
        result = forward_fill_htf_to_exec(exec_df, htf_df, ["ema_50_4h"])
        assert len(result) == len(exec_df), (
            f"Row count changed: before={len(exec_df)}, after={len(result)}"
        )

    def test_raises_on_missing_ts_event_in_exec(self):
        """ValueError if exec_df is missing ts_event."""
        exec_df = pl.DataFrame({"close": [100.0, 101.0]})
        htf_df = _make_4h_bars_with_ema([("2024-01-02 06:00", 50.0)])
        with pytest.raises(ValueError, match="ts_event"):
            forward_fill_htf_to_exec(exec_df, htf_df, ["ema_50_4h"])

    def test_raises_on_missing_ts_event_in_htf(self):
        """ValueError if htf_df_with_indicators is missing ts_event."""
        exec_df = _make_15m_bars(["2024-01-02 09:30"])
        htf_df = pl.DataFrame({"ema_50_4h": [50.0]})
        with pytest.raises(ValueError, match="ts_event"):
            forward_fill_htf_to_exec(exec_df, htf_df, ["ema_50_4h"])

    def test_raises_on_missing_value_col(self):
        """ValueError if a requested column is absent from htf_df."""
        exec_df = _make_15m_bars(["2024-01-02 09:30"])
        htf_df = _make_4h_bars_with_ema([("2024-01-02 06:00", 50.0)])
        with pytest.raises(ValueError, match="nonexistent_col"):
            forward_fill_htf_to_exec(exec_df, htf_df, ["nonexistent_col"])

    def test_empty_htf_value_cols_is_noop(self):
        """Empty htf_value_cols returns exec_df unchanged."""
        exec_df = _make_15m_bars(["2024-01-02 09:30"])
        htf_df = _make_4h_bars_with_ema([("2024-01-02 06:00", 50.0)])
        result = forward_fill_htf_to_exec(exec_df, htf_df, [])
        # Should still have original columns, no crash
        assert set(exec_df.columns).issubset(set(result.columns))


class TestComputeHtfIndicators:
    """Tests for compute_htf_indicators() in indicators/core.py."""

    def _make_htf_bars(self, n: int = 30) -> pl.DataFrame:
        import polars as pl
        from datetime import datetime, timedelta, timezone
        base_ts = datetime(2024, 1, 2, 6, 0, tzinfo=timezone.utc)
        timestamps = [base_ts + timedelta(hours=4 * i) for i in range(n)]
        return pl.DataFrame({
            "ts_event": timestamps,
            "open": [100.0 + i * 0.1 for i in range(n)],
            "high": [101.0 + i * 0.1 for i in range(n)],
            "low": [99.0 + i * 0.1 for i in range(n)],
            "close": [100.5 + i * 0.1 for i in range(n)],
            "volume": [5000.0] * n,
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

    def test_ema_columns_get_suffix(self):
        """compute_htf_indicators emits ema_50_4h, ema_200_4h with suffix."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators
        htf_df = self._make_htf_bars(40)
        configs = [
            IndicatorConfig(type="ema", period=50),
            IndicatorConfig(type="ema", period=200),
        ]
        result = compute_htf_indicators(htf_df, configs, suffix="_4h")
        assert "ema_50_4h" in result.columns
        assert "ema_200_4h" in result.columns
        # Ensure original columns still present
        assert "close" in result.columns

    def test_rsi_and_atr_get_suffix(self):
        """RSI and ATR columns are suffixed correctly."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators
        htf_df = self._make_htf_bars(30)
        configs = [
            IndicatorConfig(type="rsi", period=14),
            IndicatorConfig(type="atr", period=14),
        ]
        result = compute_htf_indicators(htf_df, configs, suffix="_4h")
        assert "rsi_14_4h" in result.columns
        assert "atr_14_4h" in result.columns

    def test_empty_suffix_raises(self):
        """Empty suffix raises ValueError to prevent column collisions."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators
        htf_df = self._make_htf_bars(10)
        with pytest.raises(ValueError, match="suffix"):
            compute_htf_indicators(htf_df, [IndicatorConfig(type="ema", period=9)], suffix="")

    def test_no_unsuffixed_indicator_cols_in_result(self):
        """Suffixed HTF cols must not collide with LTF col names (e.g. no bare ema_50)."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators
        htf_df = self._make_htf_bars(30)
        result = compute_htf_indicators(
            htf_df, [IndicatorConfig(type="ema", period=50)], suffix="_4h"
        )
        # bare 'ema_50' should NOT exist — only 'ema_50_4h'
        assert "ema_50" not in result.columns
        assert "ema_50_4h" in result.columns
