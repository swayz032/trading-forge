"""Shared HTF-cache builder (WIRE-1 seam, R-066 §2/§3).

THE ONE THING: ONE implementation of "build the per-day HTF context cache", used
by BOTH the downstream eligibility gate and the new upstream column
materialization. R-066 §3 requires upstream and gate values to agree byte-for-byte;
sharing a single builder makes that agreement STRUCTURAL (there is no second
implementation that can drift) rather than merely tested.

★ CAUSALITY LAW (R-066 §2) — encoded here, not left to callers:
    `cache[day_key]` for day D is computed from **strictly the days BEFORE D**
    (`daily_df.slice(0, day_idx)` is exclusive of `day_idx`) with
    `current_price = close[day_idx - 1]` (the PRIOR day's close). `compute_htf_context`
    itself contracts "COMPLETED bars only (shift-1 safe)". So the context a bar on
    day D may read is a function of the PAST only — never of D's own in-progress
    session, and never of any later day. A bar-t value computed from bars > t is
    silent look-ahead whose error direction is OPTIMISTIC; the truncated-replay
    test in `tests/test_htf_cache_causality.py` proves this law by re-derivation.

Extracted verbatim from the existing builds (`backtester.py:6652-6668` class path,
`:4391-4401` DSL path) so behavior is unchanged — this is a de-duplication, not a
re-implementation.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import polars as pl

MIN_DAILY_BARS: int = 200  # the adapter's warmup requirement (SMA-200 alignment)


def daily_ts_col(daily_df: pl.DataFrame) -> str:
    """Day keys use ts_et when present to avoid a UTC/ET date mismatch at the
    midnight boundary (the existing convention at both call sites)."""
    return "ts_et" if "ts_et" in daily_df.columns else "ts_event"


def day_key_of(bar_date: Any) -> str:
    """The cache key convention: the ISO date prefix of the bar's timestamp."""
    return str(bar_date)[:10]


def build_htf_cache(
    daily_df: Optional[pl.DataFrame],
    four_h_df: Optional[pl.DataFrame] = None,
    one_h_df: Optional[pl.DataFrame] = None,
    min_daily_bars: int = MIN_DAILY_BARS,
) -> Optional[Dict[str, Any]]:
    """Build {day_key -> HTFContext} using COMPLETED PRIOR days only.

    Returns None when there is insufficient warmup (< `min_daily_bars` daily bars)
    — the caller's documented passthrough condition, preserved exactly.
    """
    if daily_df is None or len(daily_df) < min_daily_bars:
        return None

    from src.engine.context.htf_context import compute_htf_context

    ts_col = daily_ts_col(daily_df)
    cache: Dict[str, Any] = {}
    for day_idx in range(min_daily_bars, len(daily_df)):
        bar_date = daily_df[ts_col][day_idx]
        # ★ CAUSALITY: slice(0, day_idx) is EXCLUSIVE of day_idx -> strictly prior
        # days; current_price is the PRIOR day's close. Never day_idx's own data.
        cache[day_key_of(bar_date)] = compute_htf_context(
            daily_df=daily_df.slice(0, day_idx),
            four_h_df=four_h_df,
            one_h_df=one_h_df,
            current_price=float(daily_df["close"][day_idx - 1]),
            bar_date=bar_date,
        )
    return cache
