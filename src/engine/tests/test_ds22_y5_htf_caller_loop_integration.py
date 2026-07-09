"""Deep-scan #22 Y5 cap-closer — HTF caller-loop integration test.

Closes cited gap #2: "the HTF caller-loop (`backtester.py:6650-6661`) isn't
integration-tested" (independent cert, 2026-07-09). The FIX 1 look-ahead fix
(`src/engine/context/htf_context.py::_filter_htf_bars_before`, deep-scan #22
Track X5) already has direct unit coverage calling `compute_htf_context()` in
isolation with a hand-sliced `four_h_df`. What has never been driven
end-to-end is the actual CALLER LOOP in `run_class_backtest()`
(`backtester.py` ~lines 6647-6662):

    for day_idx in range(200, len(daily_data)):
        bar_date = daily_data[_htf_ts_col][day_idx]
        htf_cache[day_key] = compute_htf_context(
            daily_df=daily_data.slice(0, day_idx),
            four_h_df=_four_h_data,   # <- SAME object, every iteration
            one_h_df=_one_h_data,     # <- SAME object, every iteration
            current_price=..., bar_date=bar_date,
        )

`daily_df` is correctly re-sliced per day_idx by the CALLER. `four_h_df` /
`one_h_df` are loaded ONCE (before the loop) and reused UNCHANGED on every
iteration — causal safety for the 4H/1H side is delegated entirely to
`compute_htf_context()`'s internal `ts_event < bar_date` cutoff
(`_filter_htf_bars_before`). This test proves that delegation actually holds
in the REAL calling shape, not just in a synthetic unit call.

Harness note (honest disclosure): running `run_class_backtest()` to full
completion needs the vectorbt execution engine, the eligibility gate, and a
working `strategy.compute()` — none of which execute before the HTF-cache
build loop, and none of which are needed to prove or disprove a look-ahead
leak in that loop. This test drives the loop FOR REAL (unmodified
`backtester.py` code, real `compute_htf_context()`) by giving `compute()` a
return frame missing a required signal column, so `run_class_backtest()`
short-circuits via `_empty_result()` immediately AFTER the real `htf_cache`
is built (`backtester.py` ~6684-6694) — this is the smallest faithful harness
that exercises the actual loop-and-reuse pattern without mocking vectorbt.
If a future refactor moves work earlier than the HTF-cache block, this
harness would need to grow; it is not a permanent substitute for a full
backtest smoke test.

RED-prove: `_filter_htf_bars_before()` was temporarily scratchpad-reverted
to an identity passthrough (`return htf_df`, defeating the `ts_event <
bar_date` cutoff) to confirm this test's leak assertion goes RED against the
pre-FIX-1 behavior, then restored to the real filtering body to confirm
GREEN. No permanent source change accompanies this commit.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl

import src.engine.context.htf_context as htf_context_mod
import src.engine.data_loader as data_loader_mod
from src.engine.backtester import run_class_backtest

_REAL_COMPUTE_HTF_CONTEXT = htf_context_mod.compute_htf_context

N_DAYS = 250
FUTURE_BLOCK_START_DAY = 220  # bullish ramp starts far after day_idx=200 (first cached day)
FIRST_CACHED_DAY_IDX = 200


def _make_daily_data(n: int = N_DAYS) -> pl.DataFrame:
    """Perfectly flat daily series — SMA20=SMA50=SMA200 everywhere, so the
    daily side never manufactures its own directional bias that could mask
    a 4H-side leak."""
    dates = [datetime(2020, 1, 1) + timedelta(days=i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4000.0] * n,
        "high": [4001.0] * n,
        "low": [3999.0] * n,
        "close": [4000.0] * n,
        "volume": [50_000] * n,
    })


def _make_four_h_data(n_days: int = N_DAYS, bars_per_day: int = 6) -> pl.DataFrame:
    """4H OHLCV spanning the full daily range, loaded and reused as ONE frame
    (mirrors the real caller pattern): perfectly flat until
    FUTURE_BLOCK_START_DAY, then a sharp sustained bullish ramp for the
    remainder — a genuine "future-bullish 4H block" relative to any day_idx
    well before FUTURE_BLOCK_START_DAY (the first cached day, 200, included).
    """
    n = n_days * bars_per_day
    closes = []
    for h in range(n):
        day_equiv = h // bars_per_day
        if day_equiv < FUTURE_BLOCK_START_DAY:
            closes.append(4000.0)  # flat: SMA20=SMA50=SMA200 -> "neutral"
        else:
            ramp_bars = h - FUTURE_BLOCK_START_DAY * bars_per_day
            closes.append(4000.0 + ramp_bars * 3.0)  # steep, sustained bullish ramp
    dates = [datetime(2020, 1, 1) + timedelta(hours=4 * h) for h in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [c - 1.0 for c in closes],
        "high": [c + 1.0 for c in closes],
        "low": [c - 1.0 for c in closes],
        "close": closes,
        "volume": [10_000] * n,
    })


def _make_exec_data(n: int = 50) -> pl.DataFrame:
    """Minimal exec-timeframe frame — never reaches vectorbt in this harness
    (compute() short-circuits the caller before any trade execution)."""
    dates = [datetime(2020, 1, 1) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4000.0] * n, "high": [4001.0] * n,
        "low": [3999.0] * n, "close": [4000.0] * n,
        "volume": [1000] * n,
    })


class _MissingColumnStrategy:
    """Minimal strategy stub: declares `htf_tf='4h'` so `run_class_backtest()`
    enters the multi-TF HTF-cache-build branch (backtester.py ~6615-6646),
    and `compute()` returns a frame missing a required signal column so the
    caller short-circuits via `_empty_result()` immediately AFTER the real
    `htf_cache` is built — before any vectorbt / eligibility-gate machinery
    would otherwise be needed.
    """

    name = "y5_htf_loop_probe"
    symbol = "MES"
    timeframe = "15m"
    htf_tf = "4h"

    def compute(self, data: pl.DataFrame) -> pl.DataFrame:
        return data  # deliberately missing entry_long/entry_short/exit_long/exit_short


class _HtfContextSpy:
    """Wraps the REAL `compute_htf_context` — delegates every call to it
    unchanged (does not replace or alter its logic) and records
    (bar_date, four_h_df object id, result) so the test can assert on what
    the ACTUAL caller loop produced for the earliest cached day, and confirm
    the loop reuses the identical `four_h_df` object across every iteration
    (the documented caller pattern FIX 1's docstring describes)."""

    def __init__(self):
        self.calls: list[tuple[object, int, object]] = []

    def __call__(self, *, daily_df, four_h_df, one_h_df, current_price, bar_date=None):
        result = _REAL_COMPUTE_HTF_CONTEXT(
            daily_df=daily_df, four_h_df=four_h_df, one_h_df=one_h_df,
            current_price=current_price, bar_date=bar_date,
        )
        self.calls.append((bar_date, id(four_h_df), result))
        return result


class TestY5HtfCallerLoopIntegration:
    def test_early_day_cannot_see_future_bullish_4h_block(self, monkeypatch):
        """Drives the REAL `run_class_backtest()` HTF-cache-build loop
        (`backtester.py` ~6600-6662) end-to-end, unmodified. The first
        cached day (day_idx=200) must resolve `four_h_trend='neutral'` — NOT
        'bullish' — even though the fixture's `four_h_data` (loaded ONCE,
        reused unchanged for every day_idx per the documented caller
        pattern) contains a sharp, sustained bullish ramp later in the SAME
        frame.
        """
        daily_data = _make_daily_data()
        four_h_data = _make_four_h_data()

        spy = _HtfContextSpy()
        monkeypatch.setattr(htf_context_mod, "compute_htf_context", spy)
        monkeypatch.setattr(
            data_loader_mod, "load_n_timeframes",
            lambda symbol, tfs, start, end, **kw: {"4h": four_h_data},
        )

        strategy = _MissingColumnStrategy()
        exec_data = _make_exec_data()

        result = run_class_backtest(
            strategy=strategy,
            start_date="2020-01-01",
            end_date="2020-01-02",  # irrelevant — data= supplied directly below
            data=exec_data,
            daily_data=daily_data,
            htf_cache=None,
        )

        # Sanity: confirm the harness actually reached (and short-circuited
        # at) the expected point — proves we exercised the real code path,
        # not a stub that silently no-ops.
        assert "compute() missing column" in result.get("error", ""), (
            f"Expected the caller to short-circuit via _empty_result() right "
            f"after compute()'s column check; got error={result.get('error')!r}. "
            f"If this fails, the harness no longer reaches the intended "
            f"short-circuit point and the HTF cache below may be incomplete "
            f"or built differently than intended."
        )

        assert len(spy.calls) == N_DAYS - FIRST_CACHED_DAY_IDX, (
            f"Expected {N_DAYS - FIRST_CACHED_DAY_IDX} HTF cache-build calls "
            f"(day_idx {FIRST_CACHED_DAY_IDX}..{N_DAYS - 1}), got {len(spy.calls)}"
        )

        # The caller loop must reuse the SAME four_h_df object on every
        # iteration (the documented pattern) — not re-slice or reload it
        # per day. This is what makes the internal filter load-bearing.
        four_h_ids = {call_id for _, call_id, _ in spy.calls}
        assert len(four_h_ids) == 1, (
            "Caller loop passed DIFFERENT four_h_df objects across "
            "iterations — the documented 'load once, reuse unchanged' "
            "pattern no longer holds; re-scope this test to match the new "
            "caller shape."
        )

        first_bar_date, _, first_result = spy.calls[0]
        assert first_result.four_h_trend != "bullish", (
            "LEAK: day_idx=200's cached HTF context sees a 4H bullish move "
            "that only starts far later in the SAME reused four_h_data "
            "frame. The caller loop (backtester.py) relies entirely on "
            "compute_htf_context()'s internal ts_event<bar_date cutoff "
            "(deep-scan #22 FIX 1, src/engine/context/htf_context.py::"
            "_filter_htf_bars_before) to stay causally safe even though the "
            "full unfiltered frame is passed on every iteration — this "
            "assertion is the integration-level proof that combination "
            "actually holds in the real caller shape, not just in a "
            "hand-sliced unit call."
        )
        assert first_result.four_h_trend == "neutral", (
            f"Expected 'neutral' (the pre-ramp fixture is perfectly flat), "
            f"got {first_result.four_h_trend!r} for day_idx="
            f"{FIRST_CACHED_DAY_IDX} (bar_date={first_bar_date})"
        )

        # Fixture sanity: a LATE cached day (deep into the ramp) DOES read
        # 'bullish' — proves the fixture is capable of producing a
        # detectable directional signal at all (the 'neutral' result above
        # isn't just "this fixture never goes bullish").
        _, _, last_result = spy.calls[-1]
        assert last_result.four_h_trend == "bullish", (
            f"Fixture sanity check failed: expected the LAST cached day to "
            f"read 'bullish' (deep into the ramp), got "
            f"{last_result.four_h_trend!r} — strengthen the ramp or "
            f"re-check fixture construction"
        )
