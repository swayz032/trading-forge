"""Materialize real HTF context as per-bar COLUMNS on the exec frame (WIRE-1 seam).

THE SEAM (ratified R-066 §1): the spec-condition evaluator receives only the
exec-TF frame, so its bias/structure bindings fall back to cheap proxies
(EMA-slope, self-referential structure window) — measured at ~0.99
binding-approximation. Rather than duplicate multi-TF plumbing into every
strategy instance, we materialize the REAL signals the adapter already computes
as columns on the frame the evaluator reads, upstream of `strategy.compute(df)`.

★ CAUSALITY (R-066 §2): a bar on day D reads `htf_cache[D]`, and that entry was
built by `htf_cache_builder.build_htf_cache` from **strictly the days before D**
(prior completed period). So a materialized value is a function of the PAST only.
This is the same no-look-ahead law the mtf join rides. A same-day or later-day
value stamped onto bar t would be silent look-ahead with an OPTIMISTIC error
direction — it would make a fidelity gain look like recovered edge. Proven by
truncated replay in `tests/test_htf_cache_causality.py`.

ENGAGEMENT EVIDENCE (campaign law 1): `attach_htf_columns` returns the count of
bars that received a REAL context value. A column that is entirely null is a
DORMANT feed, not a wired one — the caller must not claim the wire is live
without a non-zero engaged count.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import polars as pl

from src.engine.context.htf_cache_builder import day_key_of

# The materialized column names. `approximation=False` is only claimed for a
# binding when its column is present AND non-null on the bar being evaluated.
COL_DAILY_TREND: str = "htf_daily_trend"
# ★ WITHDRAWN — DO NOT MATERIALIZE (independent grade F-1, 2026-07-20).
# `compute_htf_context` computes `four_h_trend` from the ENTIRE UNSLICED 4h frame
# (htf_context.py:143-149 -> c4[-1], c4[-20:], c4[-50:], c4[-200:]) and its `bar_date`
# filter (htf_context.py:78-79) applies ONLY to `daily_df` — never to four_h_df/one_h_df.
# So for a cache entry keyed to day D this value reflects the END OF THE WHOLE LOADED
# HISTORY, not day D. That is a genuine LOOK-AHEAD with the usual OPTIMISTIC direction.
# It was dormant (zero consumers) so no measured number is affected, but it is NOT
# materialized any more: an unsafe column sitting in the frame is a trap waiting for the
# next wire to read it. Re-enable ONLY after htf_context is fixed under its own packet.
COL_FOUR_H_TREND: str = "htf_four_h_trend"  # withdrawn; name kept for the test that guards it
COL_PD_LOCATION: str = "htf_pd_location"
HTF_COLUMNS: Tuple[str, ...] = (COL_DAILY_TREND, COL_PD_LOCATION)  # four_h WITHDRAWN (F-1)


def exec_ts_col(df: pl.DataFrame) -> Optional[str]:
    """Exec-frame timestamp column, ts_et preferred (same convention as day keys —
    a UTC/ET mismatch at midnight would silently shift a bar into the wrong day)."""
    for c in ("ts_et", "ts_event", "ts", "timestamp"):
        if c in df.columns:
            return c
    return None


COL_STRUCTURE_ACTIVE: str = "htf_structure_active"


def attach_structure_column(
    df: pl.DataFrame,
    htf_df: Optional[pl.DataFrame],
    tf: str = "4h",
    exec_window_bars: int = 250,
) -> Tuple[pl.DataFrame, int]:
    """Materialize the REAL-HTF structure-activity column as a STEP FUNCTION.

    TWO GRANULARITIES (R-067 §3): bias columns are per-DAY constants; structure columns
    are STEP FUNCTIONS advancing per COMPLETED HTF bar. A daily-frozen structure column
    would UNDER-shoot fidelity; a forming-bar leak would FAKE it. Both failures are
    silent, so this computes at each HTF-bar boundary and forward-fills between them.

    ★ CAUSALITY: at boundary `b` the structure state is computed from HTF bars whose
    CLOSE ≤ b (`completed_htf_slice`) and exec bars at/before `b` — never the forming
    bar straddling `b`. The value is then visible only to exec bars AT OR AFTER `b`,
    so no exec bar sees a state derived from its own future.

    This is the WIRE-1 fidelity change: `compute_structure_state`'s `htf_bars` argument
    stops being the self-referential exec window and becomes a REAL higher-timeframe
    frame.

    Returns (df_with_column, engaged_bar_count). Zero engaged = DORMANT feed.
    """
    if htf_df is None or not len(htf_df):
        return df, 0
    ts_col = exec_ts_col(df)
    if ts_col is None:
        return df, 0

    from src.engine.context.htf_availability import completed_htf_slice, htf_period, ts_col_of
    from src.engine.context.structure_engine import compute_structure_state

    htf_ts = ts_col_of(htf_df)
    if htf_ts is None:
        return df, 0
    period = htf_period(tf)

    exec_ts = df[ts_col].to_list()
    # Boundary = the CLOSE time of each HTF bar: the first instant its state is usable.
    boundaries = [t + period for t in htf_df[htf_ts].to_list()]

    out: list[Optional[bool]] = [None] * len(exec_ts)
    engaged = 0
    bi = 0
    state_now: Optional[bool] = None
    for i, t in enumerate(exec_ts):
        if t is None:
            continue
        # Advance the step: adopt every HTF bar that has CLOSED at or before this bar.
        advanced = False
        while bi < len(boundaries) and boundaries[bi] <= t:
            bi += 1
            advanced = True
        if advanced:
            htf_slice = completed_htf_slice(htf_df, t, tf)
            if len(htf_slice):
                lo = max(0, i - exec_window_bars + 1)
                exec_slice = df.slice(lo, i - lo + 1)
                try:
                    st = compute_structure_state(exec_slice, htf_slice)
                except Exception:  # noqa: BLE001 — fail-soft to the prior step value
                    st = None
                state_now = bool(
                    st is not None and (st.bos_recent or st.choch_recent or st.mss_recent)
                ) if st is not None else state_now
        if state_now is not None:
            out[i] = state_now
            engaged += 1

    return df.with_columns(pl.Series(COL_STRUCTURE_ACTIVE, out, dtype=pl.Boolean)), engaged


def attach_htf_columns(
    df: pl.DataFrame,
    htf_cache: Optional[Dict[str, Any]],
) -> Tuple[pl.DataFrame, int]:
    """Attach per-bar HTF context columns to the exec frame.

    Returns (df_with_columns, engaged_bar_count). `engaged_bar_count == 0` means the
    feed is DORMANT (no day matched the cache) — never claim a live wire on it.
    A bar whose day is absent from the cache (pre-warmup, or a data gap) gets null,
    and the evaluator must fall back to its proxy with approximation=True.
    """
    if htf_cache is None or not htf_cache:
        return df, 0
    ts_col = exec_ts_col(df)
    if ts_col is None:
        return df, 0

    daily: list[Optional[str]] = []
    pd_loc: list[Optional[str]] = []
    engaged = 0
    for ts in df[ts_col].to_list():
        # ★ bar on day D reads cache[D] == context built from days STRICTLY < D.
        ctx = htf_cache.get(day_key_of(ts)) if ts is not None else None
        if ctx is None:
            daily.append(None)
            pd_loc.append(None)
            continue
        engaged += 1
        daily.append(getattr(ctx, "daily_trend", None))
        pd_loc.append(getattr(ctx, "pd_location", None))

    out = df.with_columns([
        pl.Series(COL_DAILY_TREND, daily, dtype=pl.Utf8),
        pl.Series(COL_PD_LOCATION, pd_loc, dtype=pl.Utf8),
    ])
    return out, engaged
