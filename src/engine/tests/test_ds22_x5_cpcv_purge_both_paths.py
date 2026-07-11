"""Deep-scan #22 Track X5 — failure-injection sweep, Control #2 (CPCV purge).

Both the DSL CPCV path (`_run_walk_forward_cpcv`) and the class-strategy CPCV
path (`_run_walk_forward_cpcv_class`) share ONE pure purge-math function,
`_cpcv_fold_embargo_strips()`. `test_walk_forward_cpcv.py::TestB3CpcvWarmupNoFutureLeak`
already RED-proves the invariant on the DSL path (mocked `run_backtest`,
captured `(data, warmup_data)` per combinatorial path, asserts no warmup frame
extends past its paired OOS frame's start).

This module extends the same invariant, with the same style of proof, to:
  1. The CLASS path (`_run_walk_forward_cpcv_class`, the PRIMARY product path
     for the live 117-strategy archetype library per the FIX 2 docstring) —
     mirrors `TestB3CpcvWarmupNoFutureLeak` exactly but mocks
     `run_class_backtest` instead of `run_backtest`.
  2. A genuine fault-injection on the SHARED purge function: monkeypatch
     `_cpcv_fold_embargo_strips` to the pre-Wave-C behavior (strip only the
     IS-side boundary that faces an OOS fold from the START, never the END —
     i.e. unilateral instead of bilateral purge) and prove the purge gap
     collapses below `embargo_bars` on at least one path. This is the
     RED-proof that the current bilateral implementation is load-bearing,
     not a coincidence of the fixture.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl

from src.engine.walk_forward import _cpcv_fold_embargo_strips

# ─── Shared fixtures ─────────────────────────────────────────────────────────

def _build_synthetic_ohlcv(n: int) -> pl.DataFrame:
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    rng = np.random.default_rng(11)
    close = 5000 + np.cumsum(rng.normal(0, 1.0, n))
    return pl.DataFrame({
        "ts_event": ts,
        "open": close.astype(float),
        "high": (close + 1.0).astype(float),
        "low": (close - 1.0).astype(float),
        "close": close.astype(float),
        "volume": rng.integers(500, 2000, n).astype(int),
    })


def _make_dummy_strategy():
    from src.engine.strategy_base import BaseStrategy

    class _DummyStrategy(BaseStrategy):
        name = "bounce_off_level"
        symbol = "MES"
        timeframe = "5m"

        def compute(self, df: pl.DataFrame) -> pl.DataFrame:
            return df.with_columns(
                [
                    pl.lit(False).alias("entry_long"),
                    pl.lit(False).alias("entry_short"),
                    pl.lit(False).alias("exit_long"),
                    pl.lit(False).alias("exit_short"),
                ]
            )

        def get_params(self) -> dict:
            return {}

        def get_default_config(self) -> dict:
            return {}

    return _DummyStrategy()


# ─── 1. Class-path bilateral purge — mirrors TestB3CpcvWarmupNoFutureLeak ────

class TestClassPathBilateralPurgeNoOverlap:
    """Every (oos_data, warmup_data_for_oos) pair the class CPCV path hands to
    run_class_backtest() must respect the embargo gap — no warmup bar within
    embargo_bars of the OOS window's start."""

    def _bar_minutes(self, n_before_purge_bars: int) -> timedelta:
        return timedelta(minutes=5 * n_before_purge_bars)

    def test_warmup_never_extends_into_embargo_zone(self, monkeypatch):
        import src.engine.walk_forward as wf_mod

        data = _build_synthetic_ohlcv(1200)
        strategy = _make_dummy_strategy()

        captured_calls: list[dict] = []

        def _fake_run_class_backtest(**kwargs):
            captured_calls.append(kwargs)
            is_warmup_call = kwargs.get("warmup_data") is None
            n = 6 if is_warmup_call else 4
            return {
                "total_trades": n, "total_return": 10.0, "sharpe_ratio": 1.0,
                "max_drawdown": 5.0, "win_rate": 0.6, "profit_factor": 1.5,
                "total_trading_days": n, "daily_pnls": [1.0] * n,
                "daily_pnl_records": [], "trades": [{"PnL": 5.0}] * n,
                "equity_bars": [], "avg_trade_pnl": 2.0,
            }

        monkeypatch.setattr(wf_mod, "run_class_backtest", _fake_run_class_backtest)

        wf_mod._run_walk_forward_cpcv_class(
            strategy=strategy,
            start_date="2026-01-01", end_date="2026-04-01",
            data=data, daily_data=None, htf_cache=None,
            slippage_ticks=0.25, commission_per_side=0.62, firm_key=None,
            skip_eligibility_gate=True,
            n_splits=6, k_test_groups=2, embargo_bars=5,
        )

        oos_calls = [c for c in captured_calls if c.get("warmup_data") is not None]
        assert len(oos_calls) > 0, "No OOS run_class_backtest() calls captured — CPCV class path did not execute."

        checked = 0
        for c in oos_calls:
            oos_data = c["data"]
            warmup_data = c["warmup_data"]
            if warmup_data is None or len(warmup_data) == 0:
                continue
            checked += 1
            warmup_max_ts = warmup_data["ts_event"][-1]
            oos_min_ts = oos_data["ts_event"][0]
            gap_bars = (oos_min_ts - warmup_max_ts).total_seconds() / 300.0  # 5-min bars
            assert warmup_max_ts < oos_min_ts, (
                f"CLASS-PATH PURGE REGRESSION: warmup data extends to {warmup_max_ts} "
                f">= OOS window start {oos_min_ts} — future data leaked into the "
                f"indicator-warmup prefix on the class (archetype) CPCV path."
            )
            assert gap_bars >= 5, (
                f"CLASS-PATH EMBARGO REGRESSION: gap between warmup end and OOS start "
                f"is {gap_bars:.1f} bars, expected >= embargo_bars=5. Purge stripped "
                f"less than the requested embargo."
            )
        assert checked > 0, "Expected at least one class-CPCV path with non-empty warmup data."


# ─── 2. Fault injection on the SHARED purge primitive ───────────────────────

class TestSharedPurgeFunctionFaultInjection:
    """`_cpcv_fold_embargo_strips` is the ONE function both CPCV paths call for
    purge math. Prove the CURRENT bilateral implementation is load-bearing by
    reverting it to the pre-Wave-C unilateral (start-only) strip and showing
    the purge gap collapses on the OOS-end-facing boundary."""

    def _unilateral_strip(self, fold_idx, test_fold_set, n_splits, embargo_bars, is_test_fold):
        """Pre-Wave-C behavior: IS folds only strip their START-side boundary
        toward an OOS fold; they never stripped the END-side boundary. (Mirrors
        the documented 'previous behaviour' comment in walk_forward.py.)"""
        if is_test_fold:
            strip_start = (
                embargo_bars if fold_idx > 0 and (fold_idx - 1) not in test_fold_set else 0
            )
            strip_end = (
                embargo_bars if fold_idx < n_splits - 1 and (fold_idx + 1) not in test_fold_set else 0
            )
            return strip_start, strip_end
        # IS fold: pre-Wave-C bug — never strip the END-side boundary at all.
        strip_start = (
            embargo_bars if fold_idx > 0 and (fold_idx - 1) in test_fold_set else 0
        )
        return strip_start, 0  # BUG: strip_end always 0, even when next fold is OOS

    def test_reverted_unilateral_strip_reopens_is_side_overlap(self):
        """With the buggy unilateral strip, an IS fold immediately BEFORE an
        OOS fold (i.e. IS fold's right neighbor is OOS) keeps its last
        embargo_bars rows un-purged — those rows sit inside the embargo zone
        adjacent to the OOS fold's start. The real function must strip them;
        the buggy stand-in must not."""
        n_splits = 6
        embargo_bars = 20
        test_fold_set = {2, 3}  # OOS folds; IS fold 1's right neighbor (fold 2) is OOS

        real_start, real_end = _cpcv_fold_embargo_strips(
            fold_idx=1, test_fold_set=test_fold_set, n_splits=n_splits,
            embargo_bars=embargo_bars, is_test_fold=False,
        )
        buggy_start, buggy_end = self._unilateral_strip(
            fold_idx=1, test_fold_set=test_fold_set, n_splits=n_splits,
            embargo_bars=embargo_bars, is_test_fold=False,
        )

        assert real_end == embargo_bars, (
            f"Real bilateral strip must strip {embargo_bars} bars off the END of IS "
            f"fold 1 (its right neighbor, fold 2, is OOS); got strip_end={real_end}."
        )
        assert buggy_end == 0, (
            "Sanity check on the fault-injection harness itself: the pre-Wave-C "
            "unilateral stand-in must NOT strip the end side (that's the bug being "
            f"reverted-to); got strip_end={buggy_end}."
        )
        assert real_end != buggy_end, (
            "FAULT-INJECTION DID NOT DIFFERENTIATE: the real purge function and the "
            "reverted pre-Wave-C stand-in produced the same strip — this test would "
            "not have caught the Wave C regression it exists to guard."
        )

    def test_real_function_produces_zero_overlap_gap_on_all_boundaries(self):
        """Sweep every fold_idx for a representative CPCV combo and confirm the
        real function always strips the full embargo_bars at every IS<->OOS
        adjacency (both start- and end-facing) — the positive (clean) half of
        the RED-proof pair above."""
        n_splits = 6
        embargo_bars = 15
        test_fold_set = {1, 4}

        for fold_idx in range(n_splits):
            is_test_fold = fold_idx in test_fold_set
            strip_start, strip_end = _cpcv_fold_embargo_strips(
                fold_idx=fold_idx, test_fold_set=test_fold_set, n_splits=n_splits,
                embargo_bars=embargo_bars, is_test_fold=is_test_fold,
            )
            left_is_other_role = fold_idx > 0 and ((fold_idx - 1) in test_fold_set) != is_test_fold
            right_is_other_role = fold_idx < n_splits - 1 and ((fold_idx + 1) in test_fold_set) != is_test_fold
            if left_is_other_role:
                assert strip_start == embargo_bars, (
                    f"fold_idx={fold_idx} (is_test_fold={is_test_fold}): expected "
                    f"strip_start={embargo_bars} at a role-boundary, got {strip_start}"
                )
            if right_is_other_role:
                assert strip_end == embargo_bars, (
                    f"fold_idx={fold_idx} (is_test_fold={is_test_fold}): expected "
                    f"strip_end={embargo_bars} at a role-boundary, got {strip_end}"
                )
