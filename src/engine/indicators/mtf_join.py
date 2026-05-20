"""Multi-Timeframe Join — forward-fill HTF indicator columns into exec-TF DataFrame.

No-Look-Ahead Invariant (HARD RULE):
    Polars join_asof with strategy='backward' ensures that for any execution-TF
    bar at timestamp T, the joined HTF column value is from the MOST RECENTLY
    CLOSED HTF bar whose ts_event <= T.

    Example: exec-TF bar at 10:15 ET (15-minute) joins against 4H bars.
    The active 4H bar at 10:15 is the 10:00-14:00 bar (currently forming).
    backward strategy selects the 06:00-10:00 bar (ts_event=06:00 <= 10:15).
    This is CORRECT: 06:00-10:00 bar is fully closed; 10:00-14:00 bar is not.

    This invariant must never be weakened. If the strategy choice is changed to
    'forward' or 'nearest', look-ahead bias is introduced and ALL backtests using
    HTF columns are invalid. Do not change strategy= without a full regression run.

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
