"""Multi-Timeframe Join — forward-fill HTF indicator columns into exec-TF DataFrame.

No-Look-Ahead Invariant (HARD RULE):
    `ts_event` is the HTF bar's OPEN time (Databento standard). The HTF indicator
    columns hold each bar's FINAL (close-derived) values, known only at the bar's
    CLOSE. So `forward_fill_htf_to_exec` SHIFTS the HTF value columns +1 HTF bar
    before the backward-asof join: each exec-TF bar at time T then sees the LAST
    FULLY CLOSED HTF bar's values, never the still-forming bar it sits inside.

    Example: a 15-min exec bar at 09:00 ET sits INSIDE the 06:00-10:00 4H bar
    (which does not close until 10:00). WITHOUT the shift, backward-asof on the
    open-stamped ts_event (06:00 <= 09:00) would bind the 06:00-10:00 bar's
    close-derived EMA/RSI/ATR to the 09:00 exec bar — a look-ahead leak. WITH the
    +1 shift, the 09:00 exec bar correctly sees the 02:00-06:00 bar (closed 06:00).

    This invariant must never be weakened. Removing the +1 shift, or changing
    strategy= to 'forward'/'nearest', reintroduces look-ahead bias and ALL
    backtests using HTF columns become invalid. (CRITICAL fix 2026-06-22 — the
    prior version joined open-stamped ts_event with no shift and leaked.)

Downstream consumers:
    - backtester.py: calls forward_fill_htf_to_exec() before compute_indicators
    - signals.py: reads suffixed columns (e.g., ema_50_4h) from the exec_df
    - dsl-compiler.ts: emits AND-gated grammar referencing suffixed col names
"""

from __future__ import annotations

import polars as pl


def forward_fill_htf_to_exec(
    exec_df: pl.DataFrame,
    htf_df_with_indicators: pl.DataFrame,
    htf_value_cols: list[str],
) -> pl.DataFrame:
    """Join HTF indicator columns into exec-TF DataFrame using backward asof join.

    For each exec-TF bar, the joined HTF value is from the most recently CLOSED
    HTF bar (ts_event <= exec bar ts_event). This is the no-look-ahead invariant.

    Args:
        exec_df: Execution-timeframe DataFrame with 'ts_event' column.
        htf_df_with_indicators: HTF DataFrame with 'ts_event' + HTF indicator cols.
            Must already have suffixed column names (e.g., 'ema_50_4h').
        htf_value_cols: List of column names to join from htf_df_with_indicators.
            Must be present in htf_df_with_indicators.

    Returns:
        exec_df with htf_value_cols added (forward-filled from last closed HTF bar).
        Rows before the first HTF bar get null values (expected for early exec bars).

    Raises:
        ValueError: if 'ts_event' is missing from either DataFrame.
        ValueError: if any column in htf_value_cols is missing from htf_df_with_indicators.
    """
    if "ts_event" not in exec_df.columns:
        raise ValueError("exec_df must have 'ts_event' column")
    if "ts_event" not in htf_df_with_indicators.columns:
        raise ValueError("htf_df_with_indicators must have 'ts_event' column")

    missing = [c for c in htf_value_cols if c not in htf_df_with_indicators.columns]
    if missing:
        raise ValueError(
            f"Columns missing from htf_df_with_indicators: {missing}. "
            f"Available: {htf_df_with_indicators.columns}"
        )

    if len(htf_value_cols) == 0:
        return exec_df

    # Ensure ts_event columns are both sorted (required for join_asof)
    exec_sorted = exec_df.sort("ts_event")
    htf_select = ["ts_event"] + htf_value_cols
    htf_sorted = htf_df_with_indicators.select(htf_select).sort("ts_event")

    # ── No-look-ahead STRUCTURAL guard (CRITICAL fix, 2026-06-22) ──────────────
    # Each HTF row's indicator values are that bar's FINAL (close-derived) values,
    # only known at the bar's CLOSE. But `ts_event` is the bar's OPEN time (Databento
    # standard, preserved by data_loader). Without a shift, backward-asof binds a
    # still-FORMING HTF bar's final values to every exec bar INSIDE it (e.g. an exec
    # bar at 09:00 would see the 06:00-10:00 bar's close-derived EMA/RSI/ATR — a
    # look-ahead leak that optimistically biases every HTF-filtered backtest).
    # Shifting the value columns +1 HTF bar makes each exec bar see the LAST FULLY
    # CLOSED HTF bar's values: at 09:00 it now sees the 02:00-06:00 bar (closed 06:00),
    # not the forming 06:00-10:00 bar. First HTF row -> null (no prior closed bar).
    # Verified equivalent to re-stamping ts_event to close-time, and robust to HTF gaps.
    htf_sorted = htf_sorted.with_columns(
        [pl.col(c).shift(1).alias(c) for c in htf_value_cols]
    )

    # Ensure compatible datetime types for join_asof.
    # Polars requires both sides to have the same dtype for the join key.
    exec_ts_dtype = exec_sorted["ts_event"].dtype
    htf_ts_dtype = htf_sorted["ts_event"].dtype

    # Normalize both to Datetime("us", "UTC") if there's a mismatch.
    # Common mismatch: exec has tz-aware Datetime; htf has naive Datetime
    # (or vice versa) depending on how each was loaded.
    if exec_ts_dtype != htf_ts_dtype:
        try:
            # Try casting HTF to match exec dtype
            htf_sorted = htf_sorted.with_columns(
                pl.col("ts_event").cast(exec_ts_dtype)
            )
        except Exception:
            # If direct cast fails, normalize both to UTC microseconds
            exec_sorted = exec_sorted.with_columns(
                pl.col("ts_event")
                .cast(pl.Datetime("us"))
                .alias("ts_event")
            )
            htf_sorted = htf_sorted.with_columns(
                pl.col("ts_event")
                .cast(pl.Datetime("us"))
                .alias("ts_event")
            )

    # join_asof: backward strategy = for each exec bar, take the HTF bar with
    # the largest ts_event that is still <= exec bar ts_event.
    # This is the no-look-ahead join. See module docstring for the invariant.
    joined = exec_sorted.join_asof(
        htf_sorted,
        on="ts_event",
        strategy="backward",
    )

    # Verify the join added the expected columns
    added = [c for c in htf_value_cols if c in joined.columns]
    if len(added) != len(htf_value_cols):
        still_missing = [c for c in htf_value_cols if c not in joined.columns]
        raise RuntimeError(
            f"join_asof did not produce expected columns: {still_missing}"
        )

    return joined


def join_n_timeframes_to_exec(
    exec_df: pl.DataFrame,
    htf_dict: dict[str, pl.DataFrame],
) -> pl.DataFrame:
    """Backward-asof joins all HTFs in htf_dict onto exec_df. No look-ahead.

    W25.4 — Composes forward_fill_htf_to_exec() sequentially for N timeframes.
    Each HTF DataFrame in htf_dict must have ts_event plus any indicator columns
    that should be joined. Columns must already carry their TF suffix to prevent
    collisions (e.g. 'ema_50_4h', 'close_1h').

    Empty htf_dict returns exec_df unchanged.

    Args:
        exec_df: Execution-timeframe DataFrame with 'ts_event' column.
        htf_dict: Dict of {tf_string: htf_df}. Each htf_df must have 'ts_event'.
            Any non-ts_event columns present in the htf_df are joined to exec_df.

    Returns:
        exec_df with all HTF non-ts_event columns backward-asof joined.
        Row count is preserved (same as forward_fill_htf_to_exec guarantee).

    Raises:
        ValueError: if exec_df is missing 'ts_event'.
        ValueError: if any htf_df in htf_dict is missing 'ts_event'.
    """
    if "ts_event" not in exec_df.columns:
        raise ValueError("join_n_timeframes_to_exec: exec_df must have 'ts_event' column")

    result = exec_df
    for tf, htf_df in htf_dict.items():
        if "ts_event" not in htf_df.columns:
            raise ValueError(
                f"join_n_timeframes_to_exec: htf_df for tf='{tf}' must have 'ts_event' column"
            )
        # All columns in the HTF df except ts_event are joined
        value_cols = [c for c in htf_df.columns if c != "ts_event"]
        if not value_cols:
            continue
        result = forward_fill_htf_to_exec(result, htf_df, value_cols)

    return result
