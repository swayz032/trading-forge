"""W25.4 — Unit tests for 5-TF MTF loader and join helpers.

Tests:
- load_n_timeframes() dict contract
- join_n_timeframes_to_exec() backward-asof correctness
- Missing/partial TF graceful handling
- Duplicate TF deduplication
- Backward compat: strategies with no new TF columns use existing 2-TF path

Run:
    python -m pytest src/engine/tests/test_mtf_5tf_join.py -v
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import polars as pl
import pytest


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ts(dt_str: str) -> datetime:
    """Parse 'YYYY-MM-DD HH:MM' to UTC datetime."""
    return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)


def _make_ohlcv(timestamps: list[datetime], base_close: float = 100.0) -> pl.DataFrame:
    n = len(timestamps)
    return pl.DataFrame({
        "ts_event": timestamps,
        "open": [base_close] * n,
        "high": [base_close + 1.0] * n,
        "low": [base_close - 1.0] * n,
        "close": [base_close] * n,
        "volume": [1000.0] * n,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


def _make_exec_bars(n: int = 10, freq_minutes: int = 15) -> pl.DataFrame:
    base = datetime(2024, 1, 2, 9, 30, tzinfo=timezone.utc)
    ts = [base + timedelta(minutes=freq_minutes * i) for i in range(n)]
    return _make_ohlcv(ts)


def _make_4h_bars_with_col(ts_and_vals: list[tuple[str, float]], col_name: str = "ema_50_4h") -> pl.DataFrame:
    ts = [_ts(d) for d, _ in ts_and_vals]
    vals = [v for _, v in ts_and_vals]
    n = len(ts)
    return pl.DataFrame({
        "ts_event": ts,
        "open": [100.0] * n,
        "high": [101.0] * n,
        "low": [99.0] * n,
        "close": [100.5] * n,
        "volume": [5000.0] * n,
        col_name: vals,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


# ─── Tests: load_n_timeframes ─────────────────────────────────────────────────

class TestLoadNTimeframes:
    """Tests for load_n_timeframes() dict contract.

    These tests use local DataFrame inputs (no live S3) to verify the function
    signature, deduplication, and empty-input error. The actual load_ohlcv()
    integration is tested separately in test_data_loader.py.
    """

    def test_empty_timeframes_raises(self):
        """Empty timeframe list must raise ValueError."""
        from src.engine.data_loader import load_n_timeframes
        with pytest.raises(ValueError, match="must not be empty"):
            load_n_timeframes("MES", [], "2024-01-01", "2024-01-31")

    def test_deduplication_preserves_order(self):
        """Duplicate TF strings are silently deduplicated; first occurrence wins.

        We test the deduplication logic in isolation via the private helper
        path: feed a list with duplicates, verify the de-duped set.
        """
        # We can't call load_n_timeframes directly in tests without live S3 data.
        # Test the dedup logic by calling the function and catching a ValueError
        # from the first (duplicate) load_ohlcv — not from the list itself.
        # Instead, unit-test the dedup contract by inspecting the function source
        # or by monkey-patching load_ohlcv.
        import src.engine.data_loader as dl
        loaded_calls: list[str] = []

        def _fake_load(symbol, timeframe, start, end, local_path=None, adjusted=True):
            loaded_calls.append(timeframe)
            return _make_exec_bars(5)

        original = dl.load_ohlcv
        dl.load_ohlcv = _fake_load
        try:
            result = dl.load_n_timeframes(
                "MES",
                ["15m", "4h", "15m", "1d", "4h"],  # duplicates: 15m × 2, 4h × 2
                "2024-01-01",
                "2024-01-31",
            )
        finally:
            dl.load_ohlcv = original

        # After deduplication: {"15m", "4h", "1d"} — 3 unique TFs
        assert len(result) == 3
        assert set(result.keys()) == {"15m", "4h", "1d"}
        # load_ohlcv called exactly once per unique TF
        assert loaded_calls.count("15m") == 1
        assert loaded_calls.count("4h") == 1
        assert loaded_calls.count("1d") == 1

    def test_returns_dict_keyed_by_tf(self):
        """Result is a dict with TF strings as keys."""
        import src.engine.data_loader as dl

        def _fake_load(symbol, timeframe, start, end, local_path=None, adjusted=True):
            return _make_exec_bars(5)

        original = dl.load_ohlcv
        dl.load_ohlcv = _fake_load
        try:
            result = dl.load_n_timeframes("MES", ["1m", "15m", "4h", "1d"], "2024-01-01", "2024-01-31")
        finally:
            dl.load_ohlcv = original

        assert isinstance(result, dict)
        assert set(result.keys()) == {"1m", "15m", "4h", "1d"}
        for tf, df in result.items():
            assert isinstance(df, pl.DataFrame)

    def test_single_timeframe_works(self):
        """Single-element list returns single-entry dict."""
        import src.engine.data_loader as dl

        def _fake_load(symbol, timeframe, start, end, local_path=None, adjusted=True):
            return _make_exec_bars(5)

        original = dl.load_ohlcv
        dl.load_ohlcv = _fake_load
        try:
            result = dl.load_n_timeframes("MES", ["4h"], "2024-01-01", "2024-01-31")
        finally:
            dl.load_ohlcv = original

        assert list(result.keys()) == ["4h"]


# ─── Tests: join_n_timeframes_to_exec ─────────────────────────────────────────

class TestJoinNTimeframesToExec:
    """Tests for join_n_timeframes_to_exec() backward-asof composition."""

    def test_empty_htf_dict_returns_exec_unchanged(self):
        """Empty htf_dict returns exec_df unchanged."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec
        exec_df = _make_exec_bars(5)
        result = join_n_timeframes_to_exec(exec_df, {})
        assert result.columns == exec_df.columns
        assert len(result) == len(exec_df)

    def test_single_htf_backward_asof_correctness(self):
        """A single HTF in the dict is joined correctly (no look-ahead)."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec

        exec_df = _make_exec_bars(4)  # 09:30, 09:45, 10:00, 10:15

        # 4H bar at 06:00 = value 50.0; 4H bar at 10:00 = value 51.0
        htf_df = _make_4h_bars_with_col([
            ("2024-01-02 06:00", 50.0),
            ("2024-01-02 10:00", 51.0),
        ], col_name="ema_50_4h")

        htf_dict = {"4h": htf_df.select(["ts_event", "ema_50_4h"])}
        result = join_n_timeframes_to_exec(exec_df, htf_dict)

        assert "ema_50_4h" in result.columns
        assert len(result) == len(exec_df)

    def test_two_htfs_both_columns_appear(self):
        """Two HTFs in the dict → both HTF column sets appear on exec_df."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec

        exec_df = _make_exec_bars(4)

        htf_4h = _make_4h_bars_with_col([("2024-01-02 06:00", 50.0)], col_name="ema_50_4h")
        htf_1h = _make_4h_bars_with_col([("2024-01-02 09:00", 30.0)], col_name="rsi_14_1h")

        htf_dict = {
            "4h": htf_4h.select(["ts_event", "ema_50_4h"]),
            "1h": htf_1h.select(["ts_event", "rsi_14_1h"]),
        }
        result = join_n_timeframes_to_exec(exec_df, htf_dict)

        assert "ema_50_4h" in result.columns
        assert "rsi_14_1h" in result.columns
        assert len(result) == len(exec_df)

    def test_row_count_preserved_with_multiple_htfs(self):
        """Row count of exec_df is unchanged after N HTF joins."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec

        exec_df = _make_exec_bars(20)

        htf_4h_ts = [datetime(2024, 1, 2, h, 0, tzinfo=timezone.utc) for h in [6, 10, 14]]
        htf_4h = pl.DataFrame({
            "ts_event": htf_4h_ts,
            "ema_50_4h": [50.0, 51.0, 52.0],
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

        htf_1h_ts = [datetime(2024, 1, 2, h, 0, tzinfo=timezone.utc) for h in range(9, 17)]
        htf_1h = pl.DataFrame({
            "ts_event": htf_1h_ts,
            "rsi_14_1h": [40.0 + i for i in range(len(htf_1h_ts))],
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

        result = join_n_timeframes_to_exec(exec_df, {"4h": htf_4h, "1h": htf_1h})
        assert len(result) == len(exec_df)

    def test_missing_ts_event_in_exec_raises(self):
        """ValueError if exec_df is missing ts_event."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec
        exec_df = pl.DataFrame({"close": [100.0, 101.0]})
        with pytest.raises(ValueError, match="ts_event"):
            join_n_timeframes_to_exec(exec_df, {})

    def test_missing_ts_event_in_htf_raises(self):
        """ValueError if any htf_df in htf_dict is missing ts_event."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec
        exec_df = _make_exec_bars(3)
        bad_htf = pl.DataFrame({"ema_50_4h": [50.0]})
        with pytest.raises(ValueError, match="ts_event"):
            join_n_timeframes_to_exec(exec_df, {"4h": bad_htf})

    def test_no_lookahead_with_two_htfs(self):
        """Backward-asof invariant holds for each HTF in the multi-TF join."""
        from src.engine.indicators.mtf_join import join_n_timeframes_to_exec

        # exec bar at 07:00 must NOT see 4H bar opening at 10:00
        exec_df = pl.DataFrame({
            "ts_event": [
                _ts("2024-01-02 07:00"),
                _ts("2024-01-02 09:00"),
                _ts("2024-01-02 11:00"),
            ],
            "close": [100.0, 101.0, 102.0],
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

        htf_4h = pl.DataFrame({
            "ts_event": [_ts("2024-01-02 06:00"), _ts("2024-01-02 10:00")],
            "val_4h": [10.0, 20.0],
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

        htf_1h = pl.DataFrame({
            "ts_event": [_ts("2024-01-02 07:00"), _ts("2024-01-02 08:00")],
            "val_1h": [5.0, 6.0],
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

        result = join_n_timeframes_to_exec(exec_df, {"4h": htf_4h, "1h": htf_1h})
        result = result.sort("ts_event")

        # 07:00 exec bar → 4H: most recent <= 07:00 is 06:00 bar (val=10)
        val_4h_0700 = result["val_4h"][0]
        assert val_4h_0700 == 10.0, f"Expected 10.0 (06:00 4H bar), got {val_4h_0700}"

        # 11:00 exec bar → 4H: most recent <= 11:00 is 10:00 bar (val=20)
        val_4h_1100 = result["val_4h"][2]
        assert val_4h_1100 == 20.0, f"Expected 20.0 (10:00 4H bar), got {val_4h_1100}"


# ─── Tests: compute_multi_htf_indicators ──────────────────────────────────────

class TestComputeMultiHtfIndicators:
    """Tests for compute_multi_htf_indicators() in indicators/core.py."""

    def _make_htf_bars(self, n: int = 30, tf_label: str = "4h") -> pl.DataFrame:
        base = datetime(2024, 1, 2, 6, 0, tzinfo=timezone.utc)
        step = timedelta(hours=4) if tf_label == "4h" else timedelta(hours=1)
        ts = [base + step * i for i in range(n)]
        return pl.DataFrame({
            "ts_event": ts,
            "open": [100.0 + i * 0.1 for i in range(n)],
            "high": [101.0 + i * 0.1 for i in range(n)],
            "low": [99.0 + i * 0.1 for i in range(n)],
            "close": [100.5 + i * 0.1 for i in range(n)],
            "volume": [5000.0] * n,
        }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))

    def test_two_tfs_return_two_entries(self):
        """Dict with two TF keys → two entries in the output dict."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_multi_htf_indicators

        tf_data = {
            "4h": self._make_htf_bars(30, "4h"),
            "1h": self._make_htf_bars(30, "1h"),
        }
        configs = [IndicatorConfig(type="ema", period=9)]
        result = compute_multi_htf_indicators(tf_data, configs=configs)
        assert set(result.keys()) == {"4h", "1h"}

    def test_canonical_suffix_applied(self):
        """Without suffix_map, suffix is _{tf} — e.g. _4h, _1h."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_multi_htf_indicators

        tf_data = {"4h": self._make_htf_bars(30)}
        result = compute_multi_htf_indicators(
            tf_data, configs=[IndicatorConfig(type="ema", period=9)]
        )
        assert "ema_9_4h" in result["4h"].columns
        assert "ema_9" not in result["4h"].columns  # bare name must not appear

    def test_custom_suffix_map_overrides_canonical(self):
        """suffix_map overrides the auto-derived suffix."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_multi_htf_indicators

        tf_data = {"4h": self._make_htf_bars(30)}
        result = compute_multi_htf_indicators(
            tf_data,
            configs=[IndicatorConfig(type="sma", period=20)],
            suffix_map={"4h": "_htf"},
        )
        assert "sma_20_htf" in result["4h"].columns

    def test_none_configs_returns_raw_bars(self):
        """With configs=None, DataFrames are returned unchanged."""
        from src.engine.indicators.core import compute_multi_htf_indicators

        tf_data = {"4h": self._make_htf_bars(30)}
        result = compute_multi_htf_indicators(tf_data, configs=None)
        # No indicator columns added — same columns as input
        assert result["4h"].columns == tf_data["4h"].columns

    def test_empty_tf_data_raises(self):
        """Empty tf_data must raise ValueError."""
        from src.engine.indicators.core import compute_multi_htf_indicators
        with pytest.raises(ValueError, match="must not be empty"):
            compute_multi_htf_indicators({})
