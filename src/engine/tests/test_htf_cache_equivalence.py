"""★ EQUIVALENCE TWO-PATH for the WIRE-1 seam (R-066 §3, mandatory).

R-066: the same evaluator functions now run at TWO call sites (the new upstream
column materialization and the existing downstream eligibility gate); their values
must agree BYTE-FOR-BYTE — "a disagreement is an alarm, not a tolerance."

`htf_cache_builder.build_htf_cache` was EXTRACTED from the inline builds at
`backtester.py:6652-6668` (class path) and `:4391-4401` (DSL path) to make that
agreement STRUCTURAL — one implementation cannot drift from itself. This test
proves the extraction is FAITHFUL: the shared builder reproduces the original
inline logic byte-for-byte. Without this, "we reuse the same function" is a claim,
not a fact, and swapping the call sites could silently change measured behavior.

The reference implementation below is transcribed VERBATIM from the pre-extraction
`run_class_backtest` block — deliberately duplicated HERE (and only here) so the
test is an independent oracle rather than a call into the code under test.
"""
from __future__ import annotations

import os
import sys

import polars as pl

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.context.htf_cache_builder import build_htf_cache  # noqa: E402

N_DAYS = 240


def _daily_frame(n: int = N_DAYS) -> pl.DataFrame:
    close = [100.0 + i * 0.4 + (i % 5) for i in range(n)]
    return pl.DataFrame({
        "ts_et": [f"20{20 + i // 365:02d}-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n)],
        "open": [c - 0.4 for c in close],
        "high": [c + 0.9 for c in close],
        "low": [c - 0.9 for c in close],
        "close": close,
        "volume": [900.0 + i for i in range(n)],
    })


def _reference_inline_build(daily_data: pl.DataFrame, four_h=None, one_h=None):
    """VERBATIM transcription of the original inline build (backtester.py:6652-6668)."""
    from src.engine.context.htf_context import compute_htf_context

    htf_cache = {}
    _htf_ts_col = "ts_et" if "ts_et" in daily_data.columns else "ts_event"
    for day_idx in range(200, len(daily_data)):
        bar_date = daily_data[_htf_ts_col][day_idx]
        day_key = str(bar_date)[:10]
        htf_cache[day_key] = compute_htf_context(
            daily_df=daily_data.slice(0, day_idx),
            four_h_df=four_h,
            one_h_df=one_h,
            current_price=float(daily_data["close"][day_idx - 1]),
            bar_date=bar_date,
        )
    return htf_cache


def _fields(ctx) -> dict:
    return {
        "daily_trend": ctx.daily_trend,
        "weekly_trend": ctx.weekly_trend,
        "four_h_trend": ctx.four_h_trend,
        "pd_location": ctx.pd_location,
        "prev_day_high": ctx.prev_day_high,
        "prev_day_low": ctx.prev_day_low,
        "prev_day_close": ctx.prev_day_close,
        "weekly_high": ctx.weekly_high,
        "weekly_low": ctx.weekly_low,
        "adr": ctx.adr,
        "atr_percentile": ctx.atr_percentile,
        "adx": ctx.adx,
    }


def test_shared_builder_matches_the_original_inline_build_byte_for_byte():
    df = _daily_frame()
    shared = build_htf_cache(df)
    reference = _reference_inline_build(df)

    assert shared is not None and reference
    assert set(shared.keys()) == set(reference.keys()), "day-key sets diverged"
    for key in reference:
        assert _fields(shared[key]) == _fields(reference[key]), (
            f"EQUIVALENCE ALARM: shared builder != inline build at {key} — the "
            f"extraction is NOT faithful; swapping call sites would change behavior."
        )


def test_equivalence_probe_is_not_vacuous():
    """Anti-vacuity: the comparison must be able to FAIL. A deliberately wrong
    build (using day_idx's own bar — the look-ahead variant) must be detected."""
    df = _daily_frame()
    shared = build_htf_cache(df)

    from src.engine.context.htf_context import compute_htf_context
    wrong = {}
    for day_idx in range(200, len(df)):
        bar_date = df["ts_et"][day_idx]
        wrong[str(bar_date)[:10]] = compute_htf_context(
            daily_df=df.slice(0, day_idx + 1),            # ← look-ahead: includes day D
            four_h_df=None, one_h_df=None,
            current_price=float(df["close"][day_idx]),     # ← look-ahead: D's own close
            bar_date=bar_date,
        )

    differs = any(_fields(shared[k]) != _fields(wrong[k]) for k in shared)
    assert differs, (
        "VACUOUS PROBE: a known look-ahead build compared EQUAL to the correct one, "
        "so this equivalence test could not detect a real drift."
    )
