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


def _reference_dsl_inline_build(daily_data: pl.DataFrame):
    """VERBATIM transcription of the OTHER original build — the DSL path
    (`backtester.py:4391-4401`). It differs from the class path by passing
    four_h_df=None / one_h_df=None, so byte-neutrality must be proven for THIS
    shape too (R-067 §2: byte-identical vs the originals, not just one of them)."""
    from src.engine.context.htf_context import compute_htf_context

    _dsl_htf_cache = {}
    _htf_ts_col = "ts_et" if "ts_et" in daily_data.columns else "ts_event"
    for _day_idx in range(200, len(daily_data)):
        _bar_date = daily_data[_htf_ts_col][_day_idx]
        _day_key = str(_bar_date)[:10]
        _dsl_htf_cache[_day_key] = compute_htf_context(
            daily_df=daily_data.slice(0, _day_idx),
            four_h_df=None,
            one_h_df=None,
            current_price=float(daily_data["close"][_day_idx - 1]),
            bar_date=_bar_date,
        )
    return _dsl_htf_cache


def test_shared_builder_matches_the_DSL_inline_build_byte_for_byte():
    """R-067 §2 — the extraction is a RESULT-NEUTRAL refactor for BOTH real cache
    build sites. Without this, drift introduced during extraction would masquerade
    as the wire's effect in the 0.99 re-measure and the ablation would read a lie."""
    df = _daily_frame()
    shared = build_htf_cache(df, four_h_df=None, one_h_df=None)
    reference = _reference_dsl_inline_build(df)

    assert shared is not None and reference
    assert set(shared.keys()) == set(reference.keys()), "day-key sets diverged (DSL shape)"
    for key in reference:
        assert _fields(shared[key]) == _fields(reference[key]), (
            f"EQUIVALENCE ALARM (DSL shape): shared builder != inline build at {key}"
        )


def _intraday_frame(n_days: int = N_DAYS, bars_per_day: int = 6) -> pl.DataFrame:
    """A real NON-NULL higher-TF frame (4h/1h shape) so the non-None argument shape
    is genuinely exercised."""
    rows = []
    for i in range(n_days):
        day = f"20{20 + i // 365:02d}-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}"
        for b in range(bars_per_day):
            c = 100.0 + i * 0.4 + b * 0.15
            rows.append({
                "ts_event": f"{day} {b * 4:02d}:00:00",
                "open": c - 0.2, "high": c + 0.5, "low": c - 0.5,
                "close": c, "volume": 500.0 + b,
            })
    return pl.DataFrame(rows)


def test_shared_builder_matches_inline_build_with_NON_NULL_four_h_and_one_h():
    """★ GRADER-CAUGHT GAP (R-068 check (c)): the two tests above BOTH pass
    four_h_df=None/one_h_df=None — they prove ONE argument shape twice, not two.
    The class site's real signature can receive NON-None frames
    (`build_htf_cache(daily_data, four_h_df=_four_h_data, one_h_df=_one_h_data)`),
    and that shape was proven by NEITHER. It is currently dead code repo-wide (no
    strategy declares htf_tf/itf_tf), but nothing stops one being added later
    without re-checking this gap. This test closes it for real."""
    df = _daily_frame()
    four_h = _intraday_frame()
    one_h = _intraday_frame(bars_per_day=12)

    shared = build_htf_cache(df, four_h_df=four_h, one_h_df=one_h)
    reference = _reference_inline_build(df, four_h=four_h, one_h=one_h)

    assert shared is not None and reference
    assert set(shared.keys()) == set(reference.keys()), "day-key sets diverged (non-None shape)"
    for key in reference:
        assert _fields(shared[key]) == _fields(reference[key]), (
            f"EQUIVALENCE ALARM (non-None 4h/1h shape): shared builder != inline build at {key}"
        )


def test_non_null_htf_frames_actually_change_the_context():
    """Anti-vacuity for the test above: if passing 4h/1h frames produced an IDENTICAL
    context to passing None, the non-None proof would be vacuous (it would be
    re-testing the None path under a different name)."""
    df = _daily_frame()
    four_h = _intraday_frame()
    with_frames = build_htf_cache(df, four_h_df=four_h, one_h_df=_intraday_frame(bars_per_day=12))
    without = build_htf_cache(df, four_h_df=None, one_h_df=None)

    differs = any(_fields(with_frames[k]) != _fields(without[k]) for k in with_frames)
    assert differs, (
        "VACUOUS: supplying 4h/1h frames produced byte-identical contexts to None, so "
        "the non-None equivalence test exercises nothing the None test did not."
    )


def test_below_warmup_matches_the_originals_passthrough_condition():
    """Both originals guard on `len(daily) >= 200` and fall back to passthrough.
    The shared builder must reproduce that boundary exactly, not fabricate a cache."""
    assert build_htf_cache(_daily_frame(199)) is None
    assert build_htf_cache(_daily_frame(200)) == {}  # loop range empty at exactly 200


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


def test_four_h_trend_column_stays_WITHDRAWN():
    """★ F-1 GUARD (independent grade, 2026-07-20). `compute_htf_context` computes
    `four_h_trend` from the UNSLICED 4h frame — its bar_date filter touches only
    `daily_df` — so that value is a LOOK-AHEAD for any bar before the frame's end. It was
    dormant, but a dormant unsafe column in the frame is a trap for the next wire. This
    test fails if it is ever materialized again before htf_context is fixed under its own
    packet."""
    import polars as pl_

    from src.engine.context.htf_columns import COL_FOUR_H_TREND, HTF_COLUMNS, attach_htf_columns

    assert COL_FOUR_H_TREND not in HTF_COLUMNS, "four_h_trend re-entered HTF_COLUMNS"

    df = build_htf_cache(_daily_frame())
    exec_df = pl_.DataFrame({
        "ts_event": ["2021-01-01 10:00:00", "2021-01-01 10:05:00"],
        "close": [1.0, 2.0],
    })
    out, _ = attach_htf_columns(exec_df, df)
    assert COL_FOUR_H_TREND not in out.columns, (
        "the withdrawn look-ahead column was materialized onto the frame"
    )
