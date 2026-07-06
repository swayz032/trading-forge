"""Corpus v3 Gate 3 re-run protocol — PARITY-GUARD TEST (2026-07-06).

See docs/designs/corpus-v3-gate1-respecification-2026-07-05.md, "GATE 3 RE-RUN
— SYSTEMATIC SIBLING-PARITY AUDIT" section:

    "Parity-guard test (durable output, IN SCOPE this commit): Add a test that
    runs both paths on identical inputs and asserts agreement on all shared
    outputs, so the NEXT un-mirrored fix is caught by CI, not by a
    four-defect Gate 3 postmortem. (Deeper cure — factor out the duplicated
    logic so there's nothing to mirror — is REGISTERED as post-certification
    engineering, NOT started now.)"

This test runs the literal SAME `StrategyConfig` through both
`run_backtest()` (the DSL path) and `run_class_backtest()` (the class path,
wrapped via `ExpressionStrategy`) on the literal same synthetic OHLCV data,
and asserts the two independently-implemented engines agree on every SHARED
output: trade count, net P&L per trade, equity-curve total, and friction
totals (slippage + commission + roll cost).

Design choice — DECOUPLE from signal generation entirely: `run_backtest()`
evaluates DSL expressions via its own signal-generation pipeline while
`run_class_backtest()` calls `ExpressionStrategy.compute()` — two genuinely
different implementations of "turn a DSL string into entry/exit boolean
arrays" that are NOT claimed to be byte-identical at every indicator-warmup
edge case (that is a signal-generation-layer concern, not a
run_backtest-vs-run_class_backtest sibling-parity concern — this suite
intentionally does not test it). To keep the parity check honest and stable,
both strategies use an entry condition that NEVER fires
(`entry_long="close > 9999999"`), and vectorbt is mocked identically for both
calls to always return the SAME single hardcoded trade (fixed Entry Idx /
Size / Direction), regardless of the (empty) real entry signals. This
isolates exactly what this test suite is meant to guard: the SHARED
downstream machinery both engines are supposed to treat identically —
`_apply_trade_management()` (real invocation, not mocked, operating on
identical high/low/atr/close arrays for both calls), per-trade P&L
construction, the bar-level equity loop, and the `dsl_guards` disclosure
contract. This is exactly the class of divergence Defects 1/4/5 found.

  - Both eligibility gates are disabled (`use_eligibility_gate=False` /
    `skip_eligibility_gate=True`) — out of scope for this suite (has its own
    dedicated test coverage).
  - `load_ohlcv` is monkeypatched to fail fast (no network/S3 dependency) so
    run_backtest's internal (unconditional) daily-HTF-cache-build attempt
    fails-soft into passthrough mode immediately.
  - vectorbt is mocked (module-local lazy import in both engines — safe per
    the tower's known vectorbt-JIT collection hang) with a single shared
    hardcoded-trade fake (`_FakeFixedTradePortfolio`) used identically by
    BOTH engine calls.
  - No rollover day / no VIX / firm_key=None → the Wave 21 E.3/E.4/E.5 guards
    (present in both engines as of the Defect 5 fix) and the roll-cost
    equity deduction (Defect 4 fix) are all no-ops here by construction;
    RollSpreadCost==0 is intentional (Defects 4 and 5 have their own
    dedicated, discriminating regression tests — see
    test_gate3_defect4_class_backtest_roll_cost_equity.py and
    test_gate3_defect5_class_backtest_dsl_guards_parity.py).

SCOPE NOTE: this file is instrument-only per the Gate 3 re-run protocol's
scope lock — it adds a durable parity-guard test and touches nothing else
(no classifier, spec, or role logic).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pandas as pd
import polars as pl
import pytest

_FIXED_ENTRY_IDX = 20
_FIXED_EXIT_IDX_FALLBACK = 35  # only used if _apply_trade_management leaves it unmanaged (should not happen)


class _FakeTradesFixed:
    def __init__(self, records_df: pd.DataFrame):
        self._df = records_df

    def count(self):
        return len(self._df)

    @property
    def records_readable(self):
        return self._df


class _FakeFixedTradePortfolio:
    """Always returns the SAME single hardcoded trade regardless of the real
    (empty, by design) entry/exit signal arrays — see module docstring for
    why this decoupling from signal generation is the correct design for a
    run_backtest-vs-run_class_backtest sibling-parity check.
    """

    def __init__(self, close=None, **kwargs):
        close_arr = close.to_numpy() if hasattr(close, "to_numpy") else close
        entry_price = float(close_arr[_FIXED_ENTRY_IDX])
        exit_price_fallback = float(close_arr[min(_FIXED_EXIT_IDX_FALLBACK, len(close_arr) - 1)])
        df = pd.DataFrame([{
            "Entry Idx": _FIXED_ENTRY_IDX,
            "Exit Idx": min(_FIXED_EXIT_IDX_FALLBACK, len(close_arr) - 1),
            "Avg Entry Price": entry_price,
            "Avg Exit Price": exit_price_fallback,
            "Size": 1.0,
            "Direction": "Long",
        }])
        self.trades = _FakeTradesFixed(df)


def _install_vbt_fixed_trade_mock():
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio.from_signals = MagicMock(
        side_effect=lambda **kw: _FakeFixedTradePortfolio(**kw)
    )
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        sys.modules[mod] = _vbt_mock
    return _vbt_mock


def _make_ohlcv(n: int = 70, base: float = 4000.0, trend: float = 0.5) -> pl.DataFrame:
    """Synthetic daily OHLCV — mirrors test_backtester.py::_make_ohlcv. Small
    high/low spread keeps ATR modest so _apply_trade_management's real
    stop/target computation (shared by both engines) stays well inside the
    MES stop ceiling for the fixed trade at bar 20.
    """
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [base + i * trend + (i % 5) * 0.5 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": dates,
            "open": [c - 0.25 for c in closes],
            "high": [c + 1.5 for c in closes],
            "low": [c - 1.5 for c in closes],
            "close": closes,
            "volume": [50000] * n,
        }
    )


def _make_shared_config():
    from src.engine.config import (
        IndicatorConfig,
        PositionSizeConfig,
        StopConfig,
        StrategyConfig,
    )

    return StrategyConfig(
        name="Gate3 Parity Guard Fixed Trade",
        symbol="MES",
        timeframe="daily",
        indicators=[
            IndicatorConfig(type="sma", period=5),
            IndicatorConfig(type="sma", period=15),
            IndicatorConfig(type="atr", period=14),
        ],
        entry_long="close > 9999999",  # never fires — the fixed trade is injected via the vectorbt mock
        entry_short="high < low",  # never-true sentinel (W23F.L convention)
        exit="close crosses_below sma_15",
        stop_loss=StopConfig(type="atr", multiplier=2.0),
        # dynamic_atr (not "fixed") so this suite runs without requiring the
        # TF_ALLOW_FIXED_1 env var — the fixed fake trade below hardcodes
        # Size=1.0 regardless of the sizing config, so sizing TYPE here only
        # affects the (no-op, entries are all-False) DLL-halt guard's inputs.
        position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
    )


class TestGate3SiblingParityGuard:
    """Runs run_backtest() and run_class_backtest() on identical inputs and
    asserts agreement on all shared outputs. Catches the NEXT un-mirrored
    fix between the two engine paths."""

    def _run_both(self, monkeypatch):
        import src.engine.backtester as backtester_module

        # Fail-fast HTF daily load — no S3/network dependency in a unit test.
        # run_backtest() attempts this unconditionally (independent of
        # use_eligibility_gate) for its htf_cache build; the surrounding
        # try/except falls back cleanly to passthrough mode.
        def _raise_load_ohlcv(*a, **k):
            raise FileNotFoundError("test: no real data source available")

        monkeypatch.setattr(backtester_module, "load_ohlcv", _raise_load_ohlcv)

        config = _make_shared_config()
        df = _make_ohlcv(70)

        # ─── run_backtest() (DSL path) ──────────────────────────────
        _install_vbt_fixed_trade_mock()
        from src.engine.config import BacktestRequest

        request = BacktestRequest(
            strategy=config,
            start_date="2023-01-01",
            end_date="2023-12-31",
        )
        result_dsl = backtester_module.run_backtest(
            request,
            data=df.clone(),
            use_eligibility_gate=False,
        )

        # ─── run_class_backtest() (class path) ──────────────────────
        _install_vbt_fixed_trade_mock()
        from src.engine.strategy_base import ExpressionStrategy

        strategy = ExpressionStrategy(config)
        small_daily = _make_ohlcv(10)  # <200 rows -> htf_cache=None, symmetric passthrough
        result_cls = backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df.clone(),
            daily_data=small_daily,
            skip_eligibility_gate=True,
        )

        return result_dsl, result_cls

    def test_both_engines_produce_one_trade(self, monkeypatch):
        result_dsl, result_cls = self._run_both(monkeypatch)
        assert result_dsl["total_trades"] == 1, "DSL path did not pick up the fixed fake trade"
        assert result_cls["total_trades"] == 1, "class path did not pick up the fixed fake trade"

    def test_trade_count_agrees(self, monkeypatch):
        result_dsl, result_cls = self._run_both(monkeypatch)
        assert result_dsl["total_trades"] == result_cls["total_trades"]

    def test_net_pnl_agrees(self, monkeypatch):
        result_dsl, result_cls = self._run_both(monkeypatch)
        pnl_dsl = sum(t["PnL"] for t in result_dsl["trades"])
        pnl_cls = sum(t["PnL"] for t in result_cls["trades"])
        assert pnl_dsl == pytest.approx(pnl_cls, abs=0.05), (
            f"net P&L diverged between engines: dsl={pnl_dsl:.2f} cls={pnl_cls:.2f}"
        )

    def test_equity_curve_total_agrees(self, monkeypatch):
        result_dsl, result_cls = self._run_both(monkeypatch)
        equity_total_dsl = result_dsl["equity_bars"][-1] - 50_000.0
        equity_total_cls = result_cls["equity_bars"][-1] - 50_000.0
        assert equity_total_dsl == pytest.approx(equity_total_cls, abs=0.05), (
            f"equity-curve total diverged: dsl={equity_total_dsl:.2f} "
            f"cls={equity_total_cls:.2f}"
        )

    def test_equity_reconciles_against_trades_on_both_engines(self, monkeypatch):
        """Each engine's OWN internal reconciliation invariant (equity_bars
        total == sum(trade PnL)) must hold — this is what Defect 4 broke on
        the class-path side specifically."""
        result_dsl, result_cls = self._run_both(monkeypatch)
        for label, result in (("dsl", result_dsl), ("cls", result_cls)):
            equity_total = result["equity_bars"][-1] - 50_000.0
            trades_total = sum(t["PnL"] for t in result["trades"])
            assert abs(equity_total - trades_total) < 0.05, (
                f"[{label}] equity/trade reconciliation broken: "
                f"equity={equity_total:.2f} trades={trades_total:.2f}"
            )

    def test_friction_totals_agree(self, monkeypatch):
        result_dsl, result_cls = self._run_both(monkeypatch)
        friction_dsl = sum(
            t.get("SlippageCost", 0) + t.get("CommissionCost", 0) + t.get("RollSpreadCost", 0)
            for t in result_dsl["trades"]
        )
        friction_cls = sum(
            t.get("SlippageCost", 0) + t.get("CommissionCost", 0) + t.get("RollSpreadCost", 0)
            for t in result_cls["trades"]
        )
        assert friction_dsl == pytest.approx(friction_cls, abs=0.05), (
            f"friction totals diverged: dsl={friction_dsl:.2f} cls={friction_cls:.2f}"
        )

    def test_dsl_guards_schema_present_on_both_engines(self, monkeypatch):
        """Defect 5 regression net at the parity level: both engines must
        expose the same `dsl_guards` contract (not just the class path in
        isolation, which test_gate3_defect5_*.py already covers)."""
        result_dsl, result_cls = self._run_both(monkeypatch)
        assert "dsl_guards" in result_dsl
        assert "dsl_guards" in result_cls
        for key in ("stop_ceiling_skips", "time_stop_exits", "dll_halt_blocks", "guards_failed"):
            assert key in result_dsl["dsl_guards"]
            assert key in result_cls["dsl_guards"]
