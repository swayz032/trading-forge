"""Failure-injection regression test — deep-scan #22 FIX 1 (CRITICAL).

`compute_htf_context()` filtered `daily_df` by `bar_date` but did NOT slice
`four_h_df`/`one_h_df` — callers (`run_class_backtest()` /
`run_walk_forward_class()`) load the 4H frame ONCE for the whole backtest
range and pass the SAME full-range frame into `compute_htf_context()` on
every iteration of the per-day cache-build loop. Without filtering inside
the function, `four_h_trend` could read 4H bars from strictly AFTER the
current trading day — a real look-ahead leak feeding the bias/eligibility
gate.

This test constructs a 4H frame where the bars BEFORE `bar_date` encode a
clean BEARISH trend and the bars AT/AFTER `bar_date` encode a clean BULLISH
trend with a distinctive, unmistakable price level (50000 vs ~100). An
exec bar evaluated early in the range (`bar_date` sitting between the two
regimes) must classify `four_h_trend` as "bearish" (from the past-only
data) — NEVER "bullish" (which would only happen if the future block
leaked into the last-200/50/20/1 slices `compute_htf_context` uses).

Must FAIL against the pre-fix code (four_h_df used unfiltered) and PASS
after FIX 1 (four_h_df filtered by `bar_date` via `_filter_htf_bars_before`).
"""
from __future__ import annotations

import datetime as dt

import polars as pl
import pytest


def _make_daily_df(n: int = 250) -> pl.DataFrame:
    """Flat/neutral daily frame — only used to satisfy the `len(d) >= 200`
    gate in compute_htf_context(); daily_trend/weekly logic is not under
    test here."""
    start = dt.datetime(2020, 1, 1, 16, 0)
    rows = []
    for i in range(n):
        d = start + dt.timedelta(days=i)
        rows.append({"ts_event": d, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0})
    return pl.DataFrame({
        "ts_event": [r["ts_event"] for r in rows],
        "open": [r["open"] for r in rows],
        "high": [r["high"] for r in rows],
        "low": [r["low"] for r in rows],
        "close": [r["close"] for r in rows],
        "volume": [10000] * len(rows),
    })


def _make_split_four_h_df(bar_date: dt.datetime, n_before: int = 250, n_after: int = 250) -> pl.DataFrame:
    """4H frame with a BEARISH regime strictly before `bar_date` and a
    BULLISH regime strictly at/after `bar_date`, at wildly different price
    levels so leakage is unmistakable (not just a noisy classification
    flip)."""
    rows = []

    # BEARISH regime before bar_date: declining closes, ends low (~50).
    # sma_20 < sma_50 < sma_200 and close < sma_20 required for "bearish".
    ts = bar_date - dt.timedelta(hours=4 * n_before)
    close = 200.0
    for i in range(n_before):
        close -= 0.6  # steady decline -> sma_20 < sma_50 < sma_200
        rows.append({"ts_event": ts, "open": close, "high": close + 0.5, "low": close - 0.5, "close": close})
        ts += dt.timedelta(hours=4)

    # BULLISH regime at/after bar_date: huge distinctive jump + rising closes.
    # sma_20 > sma_50 > sma_200 and close > sma_20 required for "bullish".
    close = 50000.0
    for i in range(n_after):
        close += 5.0
        rows.append({"ts_event": ts, "open": close, "high": close + 5, "low": close - 5, "close": close})
        ts += dt.timedelta(hours=4)

    return pl.DataFrame({
        "ts_event": [r["ts_event"] for r in rows],
        "open": [r["open"] for r in rows],
        "high": [r["high"] for r in rows],
        "low": [r["low"] for r in rows],
        "close": [r["close"] for r in rows],
        "volume": [1000] * len(rows),
    })


class TestFourHLookaheadLeak:
    def test_four_h_trend_cannot_see_future_bars(self):
        """The exec bar sits at `bar_date`, exactly on the boundary between
        the past BEARISH 4H regime and the future BULLISH 4H regime. The
        context computed for this bar_date must reflect ONLY the past
        (bearish) regime.

        Pre-fix: four_h_df passed through unfiltered -> the last 200/50/20
        4H bars (df[-200:], df[-50:], df[-20:], df[-1]) are dominated by
        the FUTURE bullish block (250 bars, price ~50000+) -> classifies
        "bullish". This is the leak.

        Post-fix: four_h_df is filtered to `ts_event < bar_date` first ->
        only the past bearish block remains -> classifies "bearish".
        """
        from src.engine.context.htf_context import compute_htf_context

        bar_date = dt.datetime(2024, 6, 1, 0, 0)
        daily_df = _make_daily_df(250)
        four_h_df = _make_split_four_h_df(bar_date, n_before=250, n_after=250)

        # Sanity: the future block really is in this frame and really is
        # at the distinctive price level (protects against a broken fixture
        # silently passing).
        future_closes = four_h_df.filter(pl.col("ts_event") >= bar_date)["close"]
        assert len(future_closes) > 0
        assert float(future_closes.min()) > 40000.0

        ctx = compute_htf_context(
            daily_df=daily_df,
            four_h_df=four_h_df,
            one_h_df=None,
            current_price=100.0,
            bar_date=bar_date,
        )

        assert ctx.four_h_trend == "bearish", (
            f"LEAK: four_h_trend={ctx.four_h_trend!r} — expected 'bearish' "
            f"(past-only regime). A 'bullish' result means the future 4H "
            f"block (price level >40000) leaked into the classification."
        )

    def test_one_h_df_filtered_defensively_even_though_currently_unused(self):
        """`one_h_df` is not yet consumed by any field in compute_htf_context
        (dead parameter today), but FIX 1 filters it defensively so a future
        caller that starts reading it does not silently reopen the leak.
        This test locks in that the helper is applied and does not raise on
        one_h_df with no matching columns / None bar_date."""
        from src.engine.context.htf_context import _filter_htf_bars_before

        bar_date = dt.datetime(2024, 6, 1, 0, 0)
        one_h_df = _make_split_four_h_df(bar_date, n_before=10, n_after=10)

        filtered = _filter_htf_bars_before(one_h_df, bar_date)
        assert filtered is not None
        assert len(filtered) == 10
        assert (filtered["ts_event"] < bar_date).all()

        # None passthrough
        assert _filter_htf_bars_before(None, bar_date) is None
        # No bar_date -> unchanged passthrough (matches daily_df fallback contract)
        unfiltered = _filter_htf_bars_before(one_h_df, None)
        assert len(unfiltered) == 20
