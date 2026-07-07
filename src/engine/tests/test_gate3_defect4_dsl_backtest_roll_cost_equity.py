"""
GATE3-DEFECT-4 (DSL PATH) — durable regression test for the run_backtest() roll-cost /
full-precision reconciliation fix.

Closes the coverage gap the backtest-engine-core certification (2026-07-06) flagged as its
ONLY reason for band 7 vs 9: the DSL-path fixes shipped in commits a697aca (F-1, roll-cost
omitted from the bar-equity loop) + 6b495e7 (F-2, rounded-price precision) had NO durable
test — the existing roll-cost tests (test_gate3_defect4_class_backtest_roll_cost_equity.py,
test_gate3_defect6_class_backtest_mcl_reconciliation.py) call ONLY run_class_backtest(),
never run_backtest() (the DSL path, the majority of the 120-strategy corpus). The a697aca
commit explicitly named "adapt ... to call run_backtest ... assert no RECONCILIATION FAILED"
as a deferred follow-up. This is that follow-up.

Mechanism (mirrors the class-path Defect-4/6 tests): mock vectorbt to inject one known
trade, force a rollover day on the exit bar, bypass the bar-by-bar management loop with an
injected known exit, and force compute_roll_spread_cost() to return a large decisive value
($42, well past the $1 reconciliation tolerance). Then run_backtest() must (a) NOT raise
"RECONCILIATION FAILED" (the $1-tolerance guard passes because the roll cost is deducted from
the bar-equity loop, not just from net_pnl), and (b) return a trade P&L that equals the
hand-computed net including the roll cost.

REGRESSION SEMANTICS: on the PRE-a697aca engine this test FAILS — the omitted RollSpreadCost
makes the bar-equity sum exceed net_pnl by exactly $42, tripping the reconciliation ValueError
(independently confirmed by the certification's before/after probe). So this test genuinely
guards the fix, not a tautology.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pandas as pd
import polars as pl
import pytest

# ─── Known trade (matches the certification's hand-computed LONG MES case) ────
ENTRY_P = 5000.123456789
EXIT_P = 5010.765432101
SIZE = 9.0  # canonical MES base size
COMMISSION_PER_SIDE = 0.62
ROLL_COST_FORCED = 42.0  # matches the F-1 commit's own worked example; >> $1 recon tolerance
POINT_VALUE_MES = 5.0
N_BARS = 40
ENTRY_IDX = 5
EXIT_IDX = 10


def _make_df(n: int = N_BARS) -> pl.DataFrame:
    dates = [datetime(2026, 3, 1) + timedelta(days=i) for i in range(n)]
    closes = [5000.0 + i * 0.5 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": dates,
            "open": [c - 0.25 for c in closes],
            "high": [c + 1.0 for c in closes],
            "low": [c - 1.0 for c in closes],
            "close": closes,
            "volume": [10000] * n,
        }
    )


def _install_vbt_one_trade_mock() -> None:
    fake_trades_df = pd.DataFrame(
        {
            "Avg Entry Price": [ENTRY_P],
            "Avg Exit Price": [EXIT_P],
            "Size": [SIZE],
            "Direction": ["Long"],
            "Entry Idx": [ENTRY_IDX],
            "Exit Idx": [EXIT_IDX],
        }
    )

    class _FakeTrades:
        def count(self):
            return 1

        @property
        def records_readable(self):
            return fake_trades_df

    class _FakePortfolio:
        def __init__(self, *a, **k):
            self.trades = _FakeTrades()

    vbt_mock = MagicMock()
    vbt_mock.Portfolio.from_signals = MagicMock(side_effect=lambda *a, **k: _FakePortfolio())
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        sys.modules[mod] = vbt_mock


class TestDslPathRollCostReconciliation:
    def _run(self, monkeypatch, roll_cost: float = ROLL_COST_FORCED):
        _install_vbt_one_trade_mock()

        import src.engine.backtester as bt
        import src.engine.roll_spread_cost as rsc

        # Force a rollover day exactly on the EXIT bar.
        def _fake_flag_rollover_days(df, symbol):
            n = len(df)
            flags = [False] * n
            if EXIT_IDX < n:
                flags[EXIT_IDX] = True
            return df.with_columns(pl.Series("is_rollover_day", flags))

        monkeypatch.setattr(bt, "flag_rollover_days", _fake_flag_rollover_days)

        # Bypass the real bar-by-bar stop/TP loop; inject the known exit.
        def _fake_apply_trade_management(*a, **k):
            return [
                {
                    "exit_price": EXIT_P,
                    "exit_idx": EXIT_IDX,
                    "exit_reason": "signal",
                    "risk_points": 5.0,
                    "stop_basis": "atr_fallback",
                }
            ]

        monkeypatch.setattr(bt, "_apply_trade_management", _fake_apply_trade_management)

        # Force a large decisive roll cost (imported inside the fn via `from ... import`).
        monkeypatch.setattr(rsc, "compute_roll_spread_cost", lambda symbol, roll_date, size: roll_cost)
        monkeypatch.setattr(
            rsc,
            "build_roll_spread_audit",
            lambda symbol, roll_date, size, cost: {"symbol": symbol, "size": size, "cost": cost},
        )

        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )

        config = StrategyConfig(
            name="DSL Recon Roll-Cost Guard",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close > 9999999",  # unreachable — the trade is injected via the vbt mock
            entry_short="high < low",  # never-true sentinel
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        request = BacktestRequest(
            strategy=config,
            start_date="2026-03-01",
            end_date="2026-04-15",
            slippage_ticks=0.0,  # isolate roll-cost + precision terms only
            commission_per_side=COMMISSION_PER_SIDE,
            firm_key=None,
        )
        return bt.run_backtest(request, data=_make_df(), use_eligibility_gate=False)

    def test_dsl_roll_cost_does_not_trip_reconciliation(self, monkeypatch):
        """run_backtest() must NOT raise RECONCILIATION FAILED when a roll cost applies —
        the roll cost is deducted from the bar-equity loop (F-1), so bar-sum == net_pnl."""
        # If the fix regressed, run_backtest raises ValueError("RECONCILIATION FAILED ...").
        result = self._run(monkeypatch)
        assert result["trades"], "expected one injected trade"

    def test_dsl_roll_cost_deducted_from_trade_pnl(self, monkeypatch):
        """Trade P&L equals the hand-computed net INCLUDING the $42 roll cost, to the cent."""
        result = self._run(monkeypatch)
        trade = result["trades"][0]
        gross = (EXIT_P - ENTRY_P) * SIZE * POINT_VALUE_MES
        expected_net = gross - COMMISSION_PER_SIDE * SIZE * 2 - ROLL_COST_FORCED
        assert trade["PnL"] == pytest.approx(round(expected_net, 2), abs=0.01)
        # And the roll cost is itemized on the trade (not silently bundled into slippage).
        assert float(trade.get("RollSpreadCost", 0.0)) == pytest.approx(ROLL_COST_FORCED, abs=0.01)

    def test_dsl_zero_roll_cost_baseline_reconciles(self, monkeypatch):
        """Control: with roll_cost=0 the engine still reconciles + P&L excludes any roll term."""
        result = self._run(monkeypatch, roll_cost=0.0)
        trade = result["trades"][0]
        gross = (EXIT_P - ENTRY_P) * SIZE * POINT_VALUE_MES
        expected_net = gross - COMMISSION_PER_SIDE * SIZE * 2
        assert trade["PnL"] == pytest.approx(round(expected_net, 2), abs=0.01)
