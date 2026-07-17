"""fixwave adaptive-exit-engine-safe-surface (2026-07-17) — HIGH finding:

The adaptive exit management loop (backtester.py::_apply_adaptive_management)
did not short-circuit when a regime-selected scaling tuple has runner_pct=0
(e.g. LOW_LIQ_CHOP's canonical 50/50/0 in REGIME_SCALING_DEFAULTS — "no
runner, chop kills convexity"). When TP1 and TP2 both filled and the runner
leg is 0% of the position, the trade has already closed 100% of size — there
is no remaining runner position to manage. But the per-bar loop kept
advancing `trail_stop` for that phantom 0%-weighted runner leg after TP2
filled, and if a LATER bar's low/high crossed that phantom trail, the exit
was mislabeled exit_reason="stop_loss"/"trailing_stop" instead of a
TP-complete "take_profit" label — even though the blended final_exit PRICE
was still numerically correct (scaling.runner_pct=0 zeroes that term's
weight in the blended calc; only the label + exit_idx were wrong).

Fix: at the TP2-fill site, short-circuit (set exit_reason="take_profit",
stamp exit_idx/exit_price, break the bar loop) the moment TP2 fills when
scaling.runner_pct <= 0 — there is no runner to trail.

RED-proof: reverting the fix (removing the `if scaling.runner_pct <= 0: ...
break` block) makes test_zero_runner_mislabeled_as_stop_without_fix fail
(exit_reason comes back as "trailing_stop" instead of "take_profit").

Run targeted:
    python -m pytest src/engine/tests/test_fixwave_zero_runner_exit_reason.py -v
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import polars as pl

from src.engine.config import AdaptiveExitContext

# ─── Import _apply_adaptive_management without triggering vectorbt JIT ────────
# (same pattern as test_apply_trade_management_branching.py)

def _get_adaptive_fn():
    if "vectorbt" not in sys.modules:
        vbt_mock = types.ModuleType("vectorbt")
        vbt_mock.Portfolio = MagicMock()
        sys.modules["vectorbt"] = vbt_mock

    heavy_mocks = [
        "src.engine.nvtx_markers",
        "src.engine.decay.half_life",
        "src.engine.decay.sub_signals",
        "src.engine.prop_sim",
        "src.engine.cross_validation",
    ]
    for mod_name in heavy_mocks:
        if mod_name not in sys.modules:
            mock_mod = types.ModuleType(mod_name)
            for attr in ["range_push", "range_pop", "fit_decay",
                         "composite_decay_score", "simulate_all_firms",
                         "run_cross_validation"]:
                setattr(mock_mod, attr, MagicMock(return_value={}))
            sys.modules[mod_name] = mock_mod

    from src.engine.backtester import _apply_adaptive_management
    return _apply_adaptive_management


def _make_spec():
    @dataclass
    class FakeSpec:
        tick_size: float = 0.25
        tick_value: float = 1.25
        point_value: float = 5.0
        symbol: str = "MES"
    return FakeSpec()


def _make_trades_records(entry_p: float, exit_p: float, entry_idx: int, exit_idx: int) -> pd.DataFrame:
    return pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [exit_p],
        "Size": [6.0],
        "Direction": ["Long"],
        "Entry Idx": [entry_idx],
        "Exit Idx": [exit_idx],
    })


def _build_zero_runner_bar_sequence():
    """Construct a bar sequence that:

    1. Spikes bar 1 far enough to fill BOTH TP1 and TP2 in the same bar
       (LOW_LIQ_CHOP scaling is 50/50/0 — the runner leg is 0%, so once
       TP2 fills, 100% of the position is economically closed).
    2. Reverts hard on bar 2 — low enough to cross whatever phantom
       trail_stop the (buggy) runner-advance logic would have set after
       TP2 filled, so that WITHOUT the fix, exit_reason gets overwritten
       to "trailing_stop" on a trade that was already fully TP-complete.

    All bar timestamps are pinned to 09:00 ET (before the 11:30 ET
    pre-lunch-partial trigger and nowhere near the 15:55 ET time-stop) so
    neither of those invariants interferes with this test's assertions.
    """
    n = 10
    entry_p = 4000.0

    # risk_points = managed_stop_pts("MES", atr=6.0, atr_stop_multiplier=1.5)
    #             = min(ceiling=14, 6.0*1.5=9.0) = 9.0
    # TP1 (R-multiple fallback, no liquidity snapshot) = entry + 1.0R = 4009.0
    # TP2 (R-multiple fallback)                        = entry + 2.0R = 4018.0
    high = np.full(n, entry_p + 1.0)
    low = np.full(n, entry_p - 1.0)
    close = np.full(n, entry_p)
    open_ = np.full(n, entry_p)
    atr = np.full(n, 6.0)

    # bar1: spike well past TP2 (4018) to fill TP1 + TP2 in the same bar.
    # bar1 low stays safely above the initial stop (entry-9=3991) so the
    # stop-loss check (which runs before the TP checks each bar) doesn't
    # fire first.
    high[1] = entry_p + 40.0   # 4040.0
    low[1] = entry_p + 30.0    # 4030.0 (>> initial stop 3991.0)
    close[1] = entry_p + 35.0
    open_[1] = entry_p + 31.0

    # bar2: hard reversion. If TP2 short-circuits the loop (the fix), bar2
    # is never evaluated at all. If it doesn't (the bug), the runner-trail
    # advance on bar1 pushed trail_stop up to roughly
    # bar1_high(4040) - risk_points(9) = 4031, and bar2's low crosses it.
    high[2] = entry_p + 33.0
    low[2] = entry_p + 20.0    # 4020.0 < phantom trail_stop ~4031
    close[2] = entry_p + 22.0
    open_[2] = entry_p + 30.0  # < phantom trail_stop ~4031 -> gap-through exit

    dates = [datetime(2025, 6, 10, 9, 0) for _ in range(n)]  # 09:00 ET, constant
    df = pl.DataFrame({
        "ts_event": dates,
        "close": close.tolist(),
        "high": high.tolist(),
        "low": low.tolist(),
        "open": open_.tolist(),
    })

    trades = _make_trades_records(
        entry_p=entry_p, exit_p=entry_p + 20.0, entry_idx=0, exit_idx=n - 1,
    )

    return trades, high, low, close, atr, open_, df


def _make_low_liq_chop_ctx() -> AdaptiveExitContext:
    return AdaptiveExitContext(
        liquidity_snapshot=[],
        regime_at_entry="LOW_LIQ_CHOP",
        pre_lunch_threshold_r=0.3,
        delta_div_threshold=0.6,
    )


class TestZeroRunnerExitReasonFix:
    """LOW_LIQ_CHOP (50/50/0 scaling) — TP1+TP2 full close must be labeled
    take_profit, never stop_loss/trailing_stop, and must not run the bar
    loop past the bar where TP2 filled."""

    def test_zero_runner_full_close_labeled_take_profit(self):
        fn = _get_adaptive_fn()
        trades, high, low, close, atr, open_, df = _build_zero_runner_bar_sequence()
        ctx = _make_low_liq_chop_ctx()

        result = fn(
            trades, high, low, close, atr,
            _make_spec(), df.to_pandas(), ctx,
            open_np=open_,
        )

        assert len(result) == 1
        t = result[0]

        # Non-vacuous: prove the scenario actually exercised the TP1+TP2
        # full-close path this test is designed to hit.
        assert t["adaptive_tp1_filled"] is True, "TP1 must fill for this test to be meaningful"
        assert t["adaptive_tp2_filled"] is True, "TP2 must fill for this test to be meaningful"
        assert t["adaptive_scaling"] == "50%/50%/0%", (
            f"Expected LOW_LIQ_CHOP's 50/50/0 scaling, got {t['adaptive_scaling']!r}"
        )

        # THE FIX: exit_reason must be take_profit, not stop_loss/trailing_stop,
        # for a trade whose entire size closed via TP1+TP2 with a 0% runner leg.
        assert t["exit_reason"] == "take_profit", (
            f"Expected exit_reason='take_profit' for a fully-filled TP1+TP2 "
            f"trade with runner_pct=0 (LOW_LIQ_CHOP), got {t['exit_reason']!r}. "
            "A 0%-weighted phantom runner leg must not let a later bar's "
            "price reversion mislabel this trade as a stop-out."
        )

        # THE FIX: the loop must short-circuit at the TP2-fill bar (bar 1),
        # not run on into bar 2's reversion.
        assert t["exit_idx"] == 1, (
            f"Expected exit_idx=1 (the bar TP2 filled on) once the runner_pct=0 "
            f"short-circuit fires, got {t['exit_idx']!r}. The loop must not "
            "continue managing a phantom 0%-weighted runner leg."
        )

    def test_nonzero_runner_regime_unaffected(self):
        """Control: TRENDING_UP (20/30/50 — real runner leg) must NOT
        short-circuit at TP2 fill; the runner-trail logic should still run
        and the loop must be free to continue past the TP2 bar."""
        fn = _get_adaptive_fn()
        trades, high, low, close, atr, open_, df = _build_zero_runner_bar_sequence()
        ctx = AdaptiveExitContext(
            liquidity_snapshot=[],
            regime_at_entry="TRENDING_UP",
            pre_lunch_threshold_r=0.3,
            delta_div_threshold=0.6,
        )

        result = fn(
            trades, high, low, close, atr,
            _make_spec(), df.to_pandas(), ctx,
            open_np=open_,
        )

        assert len(result) == 1
        t = result[0]
        assert t["adaptive_tp1_filled"] is True
        assert t["adaptive_tp2_filled"] is True
        assert t["adaptive_scaling"] == "20%/30%/50%"
        # With a real 50% runner leg, the loop legitimately continues past
        # the TP2 bar and the bar-2 reversion is a genuine trailing-stop
        # hit on the runner position — this is correct behavior, not a bug.
        assert t["exit_idx"] == 2, (
            f"TRENDING_UP has a real 50% runner leg — the loop should "
            f"continue managing it past the TP2 bar, got exit_idx={t['exit_idx']!r}"
        )
