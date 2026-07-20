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
COL_FOUR_H_TREND: str = "htf_four_h_trend"
COL_PD_LOCATION: str = "htf_pd_location"
HTF_COLUMNS: Tuple[str, ...] = (COL_DAILY_TREND, COL_FOUR_H_TREND, COL_PD_LOCATION)


def exec_ts_col(df: pl.DataFrame) -> Optional[str]:
    """Exec-frame timestamp column, ts_et preferred (same convention as day keys —
    a UTC/ET mismatch at midnight would silently shift a bar into the wrong day)."""
    for c in ("ts_et", "ts_event", "ts", "timestamp"):
        if c in df.columns:
            return c
    return None


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
    four_h: list[Optional[str]] = []
    pd_loc: list[Optional[str]] = []
    engaged = 0
    for ts in df[ts_col].to_list():
        # ★ bar on day D reads cache[D] == context built from days STRICTLY < D.
        ctx = htf_cache.get(day_key_of(ts)) if ts is not None else None
        if ctx is None:
            daily.append(None)
            four_h.append(None)
            pd_loc.append(None)
            continue
        engaged += 1
        daily.append(getattr(ctx, "daily_trend", None))
        four_h.append(getattr(ctx, "four_h_trend", None))
        pd_loc.append(getattr(ctx, "pd_location", None))

    out = df.with_columns([
        pl.Series(COL_DAILY_TREND, daily, dtype=pl.Utf8),
        pl.Series(COL_FOUR_H_TREND, four_h, dtype=pl.Utf8),
        pl.Series(COL_PD_LOCATION, pd_loc, dtype=pl.Utf8),
    ])
    return out, engaged
