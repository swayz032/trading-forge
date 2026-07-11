"""Deep-scan #22 Track X5 — failure-injection sweep, Control #1 (HTF look-ahead).

`test_htf_context_leak_fix.py` already proves the FIX 1 contract at the
`compute_htf_context()` level: a 4H frame with a future bullish block does not
leak into `four_h_trend` once `bar_date` is supplied. This module extends that
into a BROADER, RED-provable probe per the ds22 8->9 mandate: it must show the
guard actually BITES — i.e. that reverting the fix (unfiltered four_h_df /
one_h_df) would make the existing regression test fail — not just that the
current code happens to produce the right answer.

Covers:
  1. Fault injection: monkeypatch `_filter_htf_bars_before` to an identity
     passthrough (the exact pre-FIX-1 behavior — four_h_df used AS-IS) and
     prove the future-bullish block DOES leak (four_h_trend flips to
     "bullish") under that regression. This is the RED-proof: it shows the
     real fix is load-bearing, not a no-op.
  2. Clean path: with the real `_filter_htf_bars_before` in place, the same
     fixture classifies "bearish" (no leak) — the control bites.
  3. Boundary equality: a 4H bar with `ts_event == bar_date` (not `>`) must
     still be excluded — the filter is strict `<`, so an exact-boundary future
     bar must not leak in either.
  4. Call-site spy: `compute_htf_context()` must actually invoke
     `_filter_htf_bars_before` for BOTH four_h_df and one_h_df on every call
     (guards a future regression where someone re-inlines a bespoke filter or
     forgets to call the helper for one of the two frames).
"""

from __future__ import annotations

import datetime as dt

import polars as pl


def _make_daily_df(n: int = 250) -> pl.DataFrame:
    start = dt.datetime(2020, 1, 1, 16, 0)
    ts = [start + dt.timedelta(days=i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": ts,
        "open": [100.0] * n, "high": [101.0] * n, "low": [99.0] * n,
        "close": [100.0] * n, "volume": [10000] * n,
    })


def _make_split_four_h_df(bar_date: dt.datetime, n_before: int = 250, n_after: int = 250) -> pl.DataFrame:
    """Bearish regime strictly before bar_date; bullish regime at/after bar_date
    at a wildly different (unmistakable) price level."""
    rows = []
    ts = bar_date - dt.timedelta(hours=4 * n_before)
    close = 200.0
    for _ in range(n_before):
        close -= 0.6
        rows.append({"ts_event": ts, "open": close, "high": close + 0.5, "low": close - 0.5, "close": close})
        ts += dt.timedelta(hours=4)

    close = 50000.0
    for _ in range(n_after):
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


class TestFaultInjectionProvesFixIsLoadBearing:
    """RED-proof: reverting FIX 1 must reopen the leak on the SAME fixture the
    clean-path assertion uses. This is what distinguishes a bite-proof test
    from a single-pass audit assertion."""

    def test_identity_filter_reopens_the_leak(self, monkeypatch):
        """Monkeypatch _filter_htf_bars_before to a passthrough (pre-FIX-1
        behavior) and confirm four_h_trend flips to 'bullish' — proving the
        real filter (not the fixture, not the classification math) is what
        prevents the leak."""
        import src.engine.context.htf_context as htf_mod

        def _identity_passthrough(htf_df, bar_date):
            return htf_df  # pre-FIX-1: no cutoff applied at all

        monkeypatch.setattr(htf_mod, "_filter_htf_bars_before", _identity_passthrough)

        bar_date = dt.datetime(2024, 6, 1, 0, 0)
        daily_df = _make_daily_df(250)
        four_h_df = _make_split_four_h_df(bar_date, n_before=250, n_after=250)

        ctx = htf_mod.compute_htf_context(
            daily_df=daily_df, four_h_df=four_h_df, one_h_df=None,
            current_price=100.0, bar_date=bar_date,
        )

        assert ctx.four_h_trend == "bullish", (
            "REGRESSION-PROOF FAILED: with _filter_htf_bars_before patched to a "
            "no-op passthrough (the exact pre-FIX-1 behavior), four_h_trend must "
            f"leak to 'bullish' (future block dominates last-200 slice). Got "
            f"{ctx.four_h_trend!r} instead — either the fixture no longer "
            "encodes a real future leak, or compute_htf_context stopped calling "
            "_filter_htf_bars_before entirely (both would hide a real "
            "regression from this test suite)."
        )

    def test_real_filter_prevents_the_same_leak(self):
        """Same fixture, real (unpatched) _filter_htf_bars_before — must NOT
        leak. Paired with the fault-injection test above, this proves the
        guard bites in both directions: broken -> leak, fixed -> no leak."""
        from src.engine.context.htf_context import compute_htf_context

        bar_date = dt.datetime(2024, 6, 1, 0, 0)
        daily_df = _make_daily_df(250)
        four_h_df = _make_split_four_h_df(bar_date, n_before=250, n_after=250)

        ctx = compute_htf_context(
            daily_df=daily_df, four_h_df=four_h_df, one_h_df=None,
            current_price=100.0, bar_date=bar_date,
        )
        assert ctx.four_h_trend == "bearish"


class TestBoundaryEquality:
    """The cutoff is strict `<`, not `<=` — a 4H bar exactly AT bar_date is
    part of the current (not-yet-closed) day and must be excluded."""

    def test_bar_exactly_at_bar_date_is_excluded(self):
        from src.engine.context.htf_context import _filter_htf_bars_before

        bar_date = dt.datetime(2024, 6, 1, 0, 0)
        df = pl.DataFrame({
            "ts_event": [
                bar_date - dt.timedelta(hours=4),
                bar_date,  # exact boundary — must be excluded
                bar_date + dt.timedelta(hours=4),
            ],
            "close": [1.0, 2.0, 3.0],
        })
        filtered = _filter_htf_bars_before(df, bar_date)
        assert len(filtered) == 1, (
            f"Expected only the strictly-before bar to survive; got {len(filtered)} rows "
            f"({filtered['ts_event'].to_list()})"
        )
        assert filtered["ts_event"][0] == bar_date - dt.timedelta(hours=4)


class TestCallSiteSpyBothFramesFiltered:
    """compute_htf_context() must invoke _filter_htf_bars_before for BOTH
    four_h_df and one_h_df on every call — not just four_h_df. Guards a future
    regression where one_h_df starts being consumed by a new field without
    ever being routed through the filter (it is a defensively-filtered dead
    parameter today per the existing test module)."""

    def test_filter_invoked_for_four_h_and_one_h(self, monkeypatch):
        import src.engine.context.htf_context as htf_mod

        calls: list[str] = []
        _real_filter = htf_mod._filter_htf_bars_before

        def _spy(htf_df, bar_date):
            if htf_df is not None:
                calls.append("four_h_or_one_h")
            return _real_filter(htf_df, bar_date)

        monkeypatch.setattr(htf_mod, "_filter_htf_bars_before", _spy)

        bar_date = dt.datetime(2024, 6, 1, 0, 0)
        daily_df = _make_daily_df(250)
        four_h_df = _make_split_four_h_df(bar_date, n_before=250, n_after=250)
        one_h_df = _make_split_four_h_df(bar_date, n_before=10, n_after=10)

        htf_mod.compute_htf_context(
            daily_df=daily_df, four_h_df=four_h_df, one_h_df=one_h_df,
            current_price=100.0, bar_date=bar_date,
        )

        assert len(calls) == 2, (
            f"Expected _filter_htf_bars_before to be invoked for both four_h_df "
            f"and one_h_df (2 calls with non-None frames); got {len(calls)}. "
            "A regression that filters only one frame would silently reopen "
            "the leak for the other."
        )
