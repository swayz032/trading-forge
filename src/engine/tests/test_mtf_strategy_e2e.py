"""W23H.1 — E2E test: MTF-gated strategy produces fewer entries than ungated.

This test exercises the full MTF pipeline:
  1. Synthetic 15m exec bars + 4H bars
  2. compute_htf_indicators() with suffix '_4h'
  3. forward_fill_htf_to_exec() backward join
  4. generate_signals() with AND-gated grammar referencing ema_50_4h + ema_200_4h

The MTF-gated strategy must produce FEWER entries than the same strategy
without the HTF bias filter, because the bias filter acts as an additional gate.

Run:
    python -m pytest src/engine/tests/test_mtf_strategy_e2e.py -v
"""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest
from datetime import datetime, timedelta, timezone

from src.engine.config import IndicatorConfig, StrategyConfig


# ─── Synthetic data helpers ──────────────────────────────────────────────────

def _utc(dt_str: str) -> datetime:
    return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)


def _make_exec_df(n_bars: int = 200) -> pl.DataFrame:
    """Generate n_bars of 15-minute OHLCV data with a trending pattern.

    Price oscillates up/down to ensure some EMA crossover signals exist.
    """
    base = datetime(2024, 1, 2, 9, 30, tzinfo=timezone.utc)
    timestamps = [base + timedelta(minutes=15 * i) for i in range(n_bars)]

    # Simple zigzag pattern: rising for 20 bars, falling for 20, etc.
    closes = []
    base_price = 500.0
    for i in range(n_bars):
        cycle = (i // 20) % 2
        if cycle == 0:
            closes.append(base_price + (i % 20) * 1.5)
        else:
            closes.append(base_price + 20 * 1.5 - (i % 20) * 1.5)

    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    opens = [c - 0.25 for c in closes]

    return pl.DataFrame({
        "ts_event": timestamps,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": [1000.0] * n_bars,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


def _make_htf_df(exec_df: pl.DataFrame) -> pl.DataFrame:
    """Generate 4H OHLCV bars spanning the same period as exec_df."""
    ts_min = exec_df["ts_event"].min()
    ts_max = exec_df["ts_event"].max()

    start = datetime(2024, 1, 2, 6, 0, tzinfo=timezone.utc)
    timestamps = []
    t = start
    while t <= ts_max + timedelta(hours=4):
        timestamps.append(t)
        t += timedelta(hours=4)

    n = len(timestamps)
    # HTF price: steadily rising so ema_50 > ema_200 for FIRST half, then below
    base_price = 495.0
    closes = [base_price + i * 0.5 for i in range(n)]
    highs = [c + 1.0 for c in closes]
    lows = [c - 1.0 for c in closes]
    opens = [c - 0.5 for c in closes]

    return pl.DataFrame({
        "ts_event": timestamps,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": [5000.0] * n,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


def _make_minimal_strategy_config(
    entry_long: str,
    entry_short: str,
) -> StrategyConfig:
    """Build a minimal StrategyConfig for signal generation."""
    from src.engine.config import StopConfig, PositionSizeConfig
    return StrategyConfig(
        name="test_mtf_e2e",
        symbol="MES",
        timeframe="15m",
        indicators=[
            IndicatorConfig(type="ema", period=9),
            IndicatorConfig(type="ema", period=21),
        ],
        entry_long=entry_long,
        entry_short=entry_short,
        exit="ema_9 crosses_below ema_21",
        stop_loss=StopConfig(type="atr", value=1.5),
        position_size=PositionSizeConfig(type="risk_derived_pyramid", contracts=6),
        overnight_hold=False,
    )


class TestMtfStrategyE2E:
    """End-to-end tests for MTF bias-gated strategy."""

    def test_mtf_gated_strategy_has_fewer_entries(self):
        """Strategy with HTF bias gate must fire fewer entries than ungated version.

        Setup:
          - exec-TF: 15m bars with EMA crossover signals
          - HTF: 4H bars — ema_50_4h computed from steadily-rising 4H data
          - MTF gate: ema_50_4h > ema_200_4h (bullish bias → long entries only)
          - Ungated strategy: same LTF EMA crossover, no HTF filter

        The MTF-gated strategy must produce <= ungated entry count (it can only
        REDUCE signals, never add them).
        """
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators, compute_indicators
        from src.engine.indicators.mtf_join import forward_fill_htf_to_exec
        from src.engine.signals import generate_signals

        exec_df = _make_exec_df(200)
        htf_df_raw = _make_htf_df(exec_df)

        # Compute HTF indicators with _4h suffix
        htf_df_ind = compute_htf_indicators(
            htf_df_raw,
            [
                IndicatorConfig(type="ema", period=50),
                IndicatorConfig(type="ema", period=200),
            ],
            suffix="_4h",
        )

        htf_value_cols = ["ema_50_4h", "ema_200_4h"]

        # Join HTF columns into exec_df
        exec_with_htf = forward_fill_htf_to_exec(exec_df, htf_df_ind, htf_value_cols)

        # Compute LTF indicators on the exec+HTF df
        exec_with_all_ind = compute_indicators(
            exec_with_htf,
            [
                IndicatorConfig(type="ema", period=9),
                IndicatorConfig(type="ema", period=21),
            ],
        )

        # MTF-gated strategy: entry_long AND HTF bias
        config_mtf = _make_minimal_strategy_config(
            entry_long="(ema_9 crosses_above ema_21) AND (ema_50_4h > ema_200_4h)",
            entry_short="ema_9 crosses_below ema_21",
        )
        df_mtf_signals = generate_signals(exec_with_all_ind, config_mtf)
        mtf_long_entries = int(df_mtf_signals["entry_long"].sum())

        # Ungated strategy: same LTF entry, no HTF filter
        config_ungated = _make_minimal_strategy_config(
            entry_long="ema_9 crosses_above ema_21",
            entry_short="ema_9 crosses_below ema_21",
        )
        df_ungated_signals = generate_signals(exec_with_all_ind, config_ungated)
        ungated_long_entries = int(df_ungated_signals["entry_long"].sum())

        assert mtf_long_entries <= ungated_long_entries, (
            f"MTF-gated strategy ({mtf_long_entries} entries) must have <= "
            f"ungated entries ({ungated_long_entries}). HTF gate should only REDUCE."
        )

        # Non-zero check: ungated strategy must have some long entries
        assert ungated_long_entries > 0, (
            "Ungated strategy produced 0 long entries — synthetic data may be broken."
        )

    def test_mtf_columns_present_after_join(self):
        """After MTF join, ema_50_4h and ema_200_4h columns exist in exec_df."""
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators
        from src.engine.indicators.mtf_join import forward_fill_htf_to_exec

        exec_df = _make_exec_df(50)
        htf_df_raw = _make_htf_df(exec_df)
        htf_df_ind = compute_htf_indicators(
            htf_df_raw,
            [IndicatorConfig(type="ema", period=50), IndicatorConfig(type="ema", period=200)],
            suffix="_4h",
        )
        result = forward_fill_htf_to_exec(exec_df, htf_df_ind, ["ema_50_4h", "ema_200_4h"])
        assert "ema_50_4h" in result.columns
        assert "ema_200_4h" in result.columns

    def test_mtf_no_lookahead_sanity(self):
        """Verify that no exec bar has a HTF value from a bar that starts AFTER it.

        For each exec bar at time T, the joined ema_50_4h value must come from a
        4H bar whose ts_event <= T (backward join invariant).
        """
        from src.engine.config import IndicatorConfig
        from src.engine.indicators.core import compute_htf_indicators
        from src.engine.indicators.mtf_join import forward_fill_htf_to_exec

        exec_df = _make_exec_df(96)  # 24 hours of 15-min bars
        htf_df_raw = _make_htf_df(exec_df)
        htf_df_ind = compute_htf_indicators(
            htf_df_raw,
            [IndicatorConfig(type="ema", period=50)],
            suffix="_4h",
        )
        result = forward_fill_htf_to_exec(exec_df, htf_df_ind, ["ema_50_4h"])
        result_sorted = result.sort("ts_event")

        htf_sorted = htf_df_ind.sort("ts_event")
        exec_ts = result_sorted["ts_event"].to_list()
        ema_vals = result_sorted["ema_50_4h"].to_list()
        htf_ts = htf_sorted["ts_event"].to_list()
        htf_ema = htf_sorted["ema_50_4h"].to_list()

        for i, (et, ev) in enumerate(zip(exec_ts, ema_vals)):
            if ev is None:
                continue  # null = no HTF bar yet, acceptable
            # Find which HTF bar this value came from
            # It should be the latest HTF bar with ts_event <= et
            expected_htf_bar = None
            for j, ht in enumerate(htf_ts):
                if ht <= et:
                    expected_htf_bar = htf_ema[j]
                else:
                    break
            if expected_htf_bar is not None:
                assert abs(ev - expected_htf_bar) < 1e-6, (
                    f"At exec bar {i} (ts={et}): joined ema_50_4h={ev:.4f} "
                    f"but expected {expected_htf_bar:.4f} from HTF backward join. "
                    f"Look-ahead bias detected."
                )
