"""deep-scan #22 LOW item — htf_narrative.py caller-contract lock-in test.

NOT a functional fix (see docstrings added to
`compute_htf_narrative()` and `compute_bias()` for the full explanation).
`compute_htf_narrative()` does NOT slice `intraday_bars` by `current_bar_idx`
— `current_bar_idx` indexes a DIFFERENT frame (the exec-TF DataFrame) and is
stored only for replay traceability. The REAL causal-safety contract is
upstream: the CALLER must pass an `intraday_bars` frame that already ends at
"now".

This test locks in that documented contract with a concrete demonstration:
passing a full-session `intraday_bars` frame that extends past the intended
"current bar" DOES leak the future close into `daily_dealing.current_quadrant`
(and `current_bar_idx` does nothing to prevent it). This is intentional,
current, dormant-in-production behavior — NOT something this test asserts
should be fixed. Its purpose is to make the contract testable so a future
change to this function's truncation semantics is a deliberate, reviewed
decision (see AGENT-LOGS / CLAUDE.md §2 for the "if behavior changes, it
must be explained and tested" mandate) instead of a silent regression in
either direction.
"""
from __future__ import annotations

import datetime as dt

import polars as pl
import pytest


def _make_daily(rows: list[tuple[str, float, float, float]]) -> pl.DataFrame:
    """rows: (date_str, high, low, close). Builds 2 daily bars: PDH/PDL + today."""
    return pl.DataFrame({
        "ts_event": [dt.datetime.fromisoformat(f"{d}T00:00:00") for d, _, _, _ in rows],
        "open": [c for _, _, _, c in rows],
        "high": [h for _, h, _, _ in rows],
        "low": [l for _, _, l, _ in rows],
        "close": [c for _, _, _, c in rows],
        "volume": [1000] * len(rows),
    })


def _make_intraday_bar(hour: int, minute: int, close: float, day: int = 3) -> dict:
    return {
        "ts_event": dt.datetime(2024, 1, day, hour, minute),
        "open": close, "high": close + 1, "low": close - 1, "close": close,
    }


class TestIntradayBarsCallerContract:
    def test_uncut_intraday_bars_leak_future_close_into_daily_dealing(self):
        """Demonstrates the documented contract: `compute_htf_narrative()`
        reads `intraday_bars["close"][-1]` as "current price" for
        `daily_dealing.current_quadrant`, completely independent of
        `current_bar_idx`. If the caller passes bars PAST the intended
        "now" bar, the quadrant reflects the FUTURE close, not the
        "current_bar_idx" bar's close.
        """
        from src.engine.context.htf_narrative import compute_htf_narrative

        # PDH=5100, PDL=4900 (yesterday, 2024-01-02). Range midpoint = 5000.
        daily = _make_daily([
            ("2024-01-02", 5100.0, 4900.0, 4980.0),
            ("2024-01-03", 5050.0, 4950.0, 5000.0),  # today forming
        ])

        # "Now" bar (intended current bar, idx=0 in this 1-row-so-far frame):
        # pct = (4920-4900)/200 = 0.10 -> discount_lower quadrant (near PDL).
        now_bar = _make_intraday_bar(13, 30, 4920.0)

        # A FUTURE bar appended after "now": close=5099 -> premium_upper
        # quadrant (near PDH). A caller that (incorrectly) passes the whole
        # day instead of "bars up to now" hands this bar to the function.
        future_bar = _make_intraday_bar(14, 0, 5099.0)

        intraday_now_only = pl.DataFrame({
            "ts_event": [now_bar["ts_event"]],
            "open": [now_bar["open"]], "high": [now_bar["high"]],
            "low": [now_bar["low"]], "close": [now_bar["close"]],
        })
        intraday_with_future = pl.DataFrame({
            "ts_event": [now_bar["ts_event"], future_bar["ts_event"]],
            "open": [now_bar["open"], future_bar["open"]],
            "high": [now_bar["high"], future_bar["high"]],
            "low": [now_bar["low"], future_bar["low"]],
            "close": [now_bar["close"], future_bar["close"]],
        })

        # Correct usage: caller truncates to "now" -> discount_lower.
        result_correct = compute_htf_narrative(
            daily_bars=daily, intraday_bars=intraday_now_only,
            htf_bars=None, current_bar_idx=0,
        )
        assert result_correct.daily_dealing.current_quadrant == "discount_lower"

        # Documented risk: caller passes the full (unsliced) frame, with
        # current_bar_idx STILL set to 0 (the "now" bar's position) — this
        # does NOT protect against the future bar being present, because
        # current_bar_idx is never used to truncate intraday_bars.
        result_leaked = compute_htf_narrative(
            daily_bars=daily, intraday_bars=intraday_with_future,
            htf_bars=None, current_bar_idx=0,
        )
        assert result_leaked.daily_dealing.current_quadrant == "premium_upper", (
            "This assertion documents CURRENT behavior (not desired behavior): "
            "compute_htf_narrative() reads intraday_bars['close'][-1] as "
            "'current price' regardless of current_bar_idx, so a caller that "
            "passes bars past 'now' leaks them into daily_dealing. See the "
            "CAUSAL SAFETY docstring on compute_htf_narrative() — the fix "
            "belongs at the CALLER (pre-truncate intraday_bars), not here, "
            "because current_bar_idx indexes a different frame than "
            "intraday_bars and cannot be used to slice it safely."
        )

        # The two calls disagree ONLY because of the extra future bar —
        # proving current_bar_idx=0 in both cases did nothing to equalize them.
        assert (
            result_correct.daily_dealing.current_quadrant
            != result_leaked.daily_dealing.current_quadrant
        )

    def test_no_production_caller_passes_intraday_bars_today(self):
        """Locks in the 'dormant in production' finding: compute_bias() is
        the only caller of compute_htf_narrative() in production code, and
        as of deep-scan #22 neither context_runner.py nor backtester.py
        (its only two call sites) passes `intraday_bars`. If a future
        change wires this up, this test should be updated/removed as part
        of that change (not silently left green while the risk goes live).
        """
        import inspect

        from src.engine import backtester, context_runner

        src_ctx_runner = inspect.getsource(context_runner)
        src_backtester = inspect.getsource(backtester)

        for src, name in ((src_ctx_runner, "context_runner.py"), (src_backtester, "backtester.py")):
            for line in src.splitlines():
                stripped = line.strip()
                if stripped.startswith("compute_bias(") or ".compute_bias(" in stripped:
                    # Found a call site — scan forward a few lines for intraday_bars=
                    idx = src.splitlines().index(line)
                    window = "\n".join(src.splitlines()[idx: idx + 12])
                    assert "intraday_bars=" not in window, (
                        f"{name} now passes intraday_bars= to compute_bias() — "
                        f"the 'dormant in production' assumption in the "
                        f"CAUSAL SAFETY docstring is stale. Verify the caller "
                        f"pre-truncates intraday_bars to 'now' before "
                        f"updating/removing this trip-wire test."
                    )
