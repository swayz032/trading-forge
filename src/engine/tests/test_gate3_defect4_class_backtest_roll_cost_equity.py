"""Corpus v3 Gate 3 re-run protocol — DEFECT 4 regression test (2026-07-06).

See docs/designs/corpus-v3-gate1-respecification-2026-07-05.md, "GATE 3 RE-RUN
— SYSTEMATIC SIBLING-PARITY AUDIT" section, for the locked scope this test
belongs to, and the "FROZEN FINDING" section for the bounded/stratified
characterization of the pre-fix defect.

DEFECT 4 (VERIFIED): `run_class_backtest()` (src/engine/backtester.py, def
~6509) computes `net_pnl = gross - slip_cost - comm_cost - _roll_cost_usd_cls`
(includes roll cost) but the bar-level equity-curve loop that builds
`bar_dollar_pnls` (used for `equity_curve`, `equity_bars`, `daily_pnls`, and
every equity-derived metric) previously deducted only
`(entry_slip + half_comm)` / `(exit_slip + half_comm)` — RollSpreadCost was
never subtracted from `bar_dollar_pnls`. The reconciliation check a few lines
below (`abs(equity_total - trades_total) > 1.0 -> raise ValueError`) BOUNDED
the damage to <=$1 per completed run (real roll costs are a few ticks), so no
historically COMPLETED class-path run was ever wrong by more than that $1
tolerance — but the bug was real and would raise/silently understate equity
for any trade with a large enough roll cost.

Fix applied: deduct the per-trade `RollSpreadCost` into `bar_dollar_pnls` at
the EXIT bar (mirrors the existing entry/exit slip+commission split pattern;
roll cost itself is not split entry/exit — it is already a single combined
entry+exit roll-day charge from `compute_roll_spread_cost()`).

Blade wording (per the design doc's correction): this fix is
"verdict-variable-preserving, NOT computation-preserving" — it changes equity
curves and every equity-derived metric, but does NOT change trade signals or
trade counts, which is all Gate 3's frozen rule (revival/regression) measures.

Test strategy: mock vectorbt (module-local lazy import in `run_class_backtest`
— safe per the tower's known vectorbt-JIT collection hang) to return exactly
one synthetic trade whose entry bar is flagged as a CME rollover day, and
monkeypatch `compute_roll_spread_cost()` to return a DELIBERATELY LARGE
roll cost ($42, far above the $1 reconciliation tolerance) so the test is
DECISIVE: pre-fix, this exact scenario would raise
`ValueError: RECONCILIATION FAILED` (reconciliation_error ~= $42); post-fix,
it must return cleanly with a reconciliation error near zero. A large synthetic
roll cost is used deliberately — real roll costs are small enough that the old
$1 tolerance often hid this defect (see FROZEN FINDING), so a test relying on a
real-sized roll cost would not be discriminating.

Also monkeypatches `_apply_trade_management()` to bypass all bar-by-bar
stop/TP/trailing logic and return one deterministic managed trade — the E7
roll-spread accounting and equity reconciliation being tested live entirely
downstream of that call, not inside it.

SCOPE NOTE: this file is instrument-only per the Gate 3 re-run protocol's scope
lock — it adds test coverage for DEFECT 4 and touches nothing else (no
classifier, spec, or role logic).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pandas as pd
import polars as pl
import pytest


def _install_vbt_one_trade_mock():
    """Inject a vectorbt stub whose Portfolio.from_signals() deterministically
    returns a portfolio with exactly one trade, independent of the actual
    entry/exit signal arrays passed in (the strategy below never fires a real
    signal — see _make_never_fires_strategy — so the fake trade is fully
    decoupled from signal-pipeline behavior and isolates the equity-loop math
    under test).
    """

    _fake_trade_row = pd.DataFrame(
        {
            "Avg Entry Price": [4000.0],
            "Avg Exit Price": [4010.0],  # overridden by the mocked _apply_trade_management below
            "Size": [1.0],
            "Direction": ["Long"],
            "Entry Idx": [10],
            "Exit Idx": [15],
        }
    )

    class _FakeTrades:
        def count(self):
            return 1

        @property
        def records_readable(self):
            return _fake_trade_row

    class _FakePortfolio:
        def __init__(self, *args, **kwargs):
            self.trades = _FakeTrades()

    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio.from_signals = MagicMock(side_effect=lambda *a, **kw: _FakePortfolio())
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        sys.modules[mod] = _vbt_mock
    return _vbt_mock


def _make_ohlcv_with_rollover(n: int = 200, base: float = 4000.0, trend: float = 0.5) -> pl.DataFrame:
    """Synthetic daily OHLCV with `is_rollover_day` flagged True at bar 10 only.

    Bar 10 is the fake trade's Entry Idx — flagging it as a rollover day drives
    the entry-side roll-cost branch in run_class_backtest's per-trade loop.
    Bar 15 (Exit Idx) is deliberately NOT a rollover day, so exactly one
    (entry-side) roll-cost deduction fires — isolates the test to a single,
    unambiguous code path.
    """
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [base + i * trend + (i % 5) * 2 for i in range(n)]
    is_rollover = [i == 10 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": dates,
            "open": [c - 2.0 for c in closes],
            "high": [c + 5.0 for c in closes],
            "low": [c - 5.0 for c in closes],
            "close": closes,
            "volume": [50000] * n,
            "is_rollover_day": is_rollover,
        }
    )


class TestGate3Defect4ClassBacktestRollCostEquity:
    """GATE3-DEFECT-4: RollSpreadCost must be reflected in bar_dollar_pnls."""

    def _run(self, monkeypatch, roll_cost: float = 42.0):
        _install_vbt_one_trade_mock()

        import src.engine.backtester as backtester_module
        import src.engine.roll_spread_cost as roll_spread_cost_module

        # Deliberately large ($42, >> the $1 reconciliation tolerance) so the
        # test is decisive rather than marginal — see module docstring.
        monkeypatch.setattr(
            roll_spread_cost_module,
            "compute_roll_spread_cost",
            lambda symbol, roll_date, contracts: roll_cost,
        )
        monkeypatch.setattr(
            roll_spread_cost_module,
            "build_roll_spread_audit",
            lambda symbol, roll_date, contracts, cost: {
                "symbol": symbol, "roll_date": str(roll_date), "contracts": contracts, "cost": float(cost),
            },
        )

        # Bypass all bar-by-bar stop/TP/trailing logic — Defect 4 lives entirely
        # in the equity-loop code downstream of managed_trades, not inside
        # _apply_trade_management itself.
        monkeypatch.setattr(
            backtester_module,
            "_apply_trade_management",
            lambda *a, **k: [
                {
                    "exit_price": 4010.0,
                    "exit_idx": 15,
                    "exit_reason": "signal",
                    "risk_points": 5.0,
                    "stop_basis": "atr_fallback",
                }
            ],
        )

        from src.engine.config import (
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.strategy_base import ExpressionStrategy

        config = StrategyConfig(
            name="Gate3 Defect4 Never Fires",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close > 9999999",  # unreachable — the fake trade is injected via vectorbt mock
            entry_short="high < low",  # never-true sentinel (W23F.L convention)
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        strategy = ExpressionStrategy(config)

        df = _make_ohlcv_with_rollover(200)
        small_daily = _make_ohlcv_with_rollover(10)

        return backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
        )

    def test_no_reconciliation_error_with_large_roll_cost(self, monkeypatch):
        """DEFECT 4 (pre-fix): a $42 roll cost would raise
        `ValueError: RECONCILIATION FAILED` because bar_dollar_pnls omitted
        RollSpreadCost while net_pnl included it. Post-fix: must NOT raise.
        """
        result = self._run(monkeypatch, roll_cost=42.0)  # must NOT raise
        assert result["total_trades"] == 1

    def test_roll_spread_cost_captured_on_trade(self, monkeypatch):
        """RollSpreadCost is recorded on the trade dict (pre-existing, unchanged)."""
        result = self._run(monkeypatch, roll_cost=42.0)
        assert result["trades"][0]["RollSpreadCost"] == pytest.approx(42.0, abs=0.01)

    def test_equity_reconciles_tightly_with_trade_pnl(self, monkeypatch):
        """Post-fix: sum(bar_dollar_pnls) (equity_bars) must equal sum(trade PnL)
        to a TIGHT tolerance — much tighter than the $1 raise-threshold that
        merely bounded (rather than fixed) the pre-fix defect.
        """
        result = self._run(monkeypatch, roll_cost=42.0)
        equity_bars = result["equity_bars"]
        starting_capital = 50_000.0
        equity_total = equity_bars[-1] - starting_capital
        trades_total = sum(t["PnL"] for t in result["trades"])
        assert abs(equity_total - trades_total) < 0.01, (
            f"equity_total={equity_total:.4f} trades_total={trades_total:.4f} "
            f"diff={abs(equity_total - trades_total):.4f} — should be ~0 post-fix"
        )

    def test_small_roll_cost_also_reconciles(self, monkeypatch):
        """Sanity check at a realistic (small) roll-cost magnitude too —
        the fix must hold at both scales, not just the discriminating $42 case.
        """
        result = self._run(monkeypatch, roll_cost=7.50)
        equity_total = result["equity_bars"][-1] - 50_000.0
        trades_total = sum(t["PnL"] for t in result["trades"])
        assert abs(equity_total - trades_total) < 0.01
