"""Corpus v3 Gate 3 re-run protocol — DEFECT 1 regression test (2026-07-06).

See docs/designs/corpus-v3-gate1-respecification-2026-07-05.md, "GATE 3 RE-RUN
PROTOCOL" section, for the locked instrument-repair scope this test belongs to.

DEFECT 1 (VERIFIED): `run_class_backtest()` (src/engine/backtester.py, def ~6509)
assigns `winners` / `losers` / `avg_winner` / `avg_loser` only inside the
`if trades_records is not None:` block (~7169-7170, ~7173-7174), but the
"expectancy_per_trade" dict entry near the function's `return {...}` (~7506-7507)
references `len(winners)` / `len(losers)` unconditionally. A zero-signal class
backtest (total_trades == 0 → trades_records = None) skips the assigning block
entirely and raises `UnboundLocalError` instead of returning a clean
`total_trades=0` result.

This mirrors the C2 FIX (deepscan5 2026-06-29) already applied to the sibling
`run_backtest()` — see test_backtester.py::TestBacktesterOutput::
test_zero_trade_backtest_does_not_crash for that fixed reference case. The
Gate 3 corpus-v3 revival harness (scripts/corpus-v3-shadow-gate3.py) exercises
the class-backtest path for archetype/v3-shadow specs, and hits exactly this
crash whenever a spec produces zero signals over the OOS window — which is
precisely the zero-to-nonzero transition the harness exists to measure. Per the
METHODOLOGY FREEZE in the design doc, a harness that crashes on the transition
it is measuring systematically masks the effect under test.

Fix applied: hoisted `winners = np.array([])` / `losers = np.array([])` /
`avg_winner = 0.0` / `avg_loser = 0.0` defaults above the
`if trades_records is not None:` block in `run_class_backtest`, alongside the
pre-existing `win_rate` / `profit_factor` / `avg_trade_pnl` / `winner_loser_ratio`
/ `trades_list` / `trade_pnls_arr` hoist at the same location — mirrors the
existing hoist in the sibling `run_backtest` (~line 5032-5035).

SCOPE NOTE: this file is instrument-only per the Gate 3 re-run protocol's scope
lock — it adds test coverage for DEFECT 1 and touches nothing else (no
classifier, spec, or role logic).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import polars as pl


def _install_vbt_zero_trade_mock():
    """Inject a vectorbt stub whose Portfolio.from_signals() deterministically
    returns a portfolio with trades.count() == 0 — the zero-signal path.

    `run_class_backtest()` (like its sibling `run_backtest()`) touches the
    vectorbt portfolio object `pf` in exactly two places: `pf.trades.count()`
    and `pf.trades.records_readable` (the latter only when count() > 0). A
    zero-trade stub therefore needs nothing else to drive this test.

    Note: `import vectorbt as vbt` inside `run_class_backtest` is a LAZY,
    function-local import (not a module-level import in backtester.py), so
    importing `run_class_backtest` itself never touches vectorbt. This stub
    is injected into `sys.modules` before the call so that lazy import
    resolves deterministically instead of exercising (or JIT-compiling) the
    real vectorbt package — avoiding the tower's known collection-time hang
    hazard on any code path that pulls in real vectorbt.
    """

    class _FakeTrades:
        def count(self):
            return 0

    class _FakePortfolio:
        def __init__(self, *args, **kwargs):
            self.trades = _FakeTrades()

    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio.from_signals = MagicMock(side_effect=lambda *a, **kw: _FakePortfolio())
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        sys.modules[mod] = _vbt_mock
    return _vbt_mock


def _make_ohlcv(n: int = 200, base: float = 4000.0, trend: float = 0.5) -> pl.DataFrame:
    """Synthetic daily OHLCV — mirrors test_backtester.py::_make_ohlcv."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [base + i * trend + (i % 5) * 2 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": dates,
            "open": [c - 2.0 for c in closes],
            "high": [c + 5.0 for c in closes],
            "low": [c - 5.0 for c in closes],
            "close": closes,
            "volume": [50000] * n,
        }
    )


class TestGate3Defect1ClassBacktestZeroSignal:
    """GATE3-DEFECT-1: run_class_backtest() zero-signal path must not crash."""

    def test_zero_signal_class_backtest_returns_clean_zero_trades(self):
        _install_vbt_zero_trade_mock()

        from src.engine.backtester import run_class_backtest
        from src.engine.config import (
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.strategy_base import ExpressionStrategy

        config = StrategyConfig(
            name="Gate3 Defect1 Never Fires",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close > 9999999",  # unreachable at any synthetic MES price → zero entries
            entry_short="high < low",  # never-true sentinel (W23F.L convention)
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        strategy = ExpressionStrategy(config)

        df = _make_ohlcv(200)
        # A small (<200-row) daily_data satisfies "not None" (skips the S3
        # daily-context fetch attempt) while staying below the htf_cache
        # build's len(daily_data) >= 200 gate — neither path is needed here.
        small_daily = _make_ohlcv(10)

        result = run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
        )  # must NOT raise (GATE3-DEFECT-1: UnboundLocalError pre-fix)

        # Core contract: a zero-signal window returns a clean result, never crashes.
        assert result["total_trades"] == 0
        assert result.get("win_rate") == 0.0
        assert result.get("expectancy_per_trade") == 0.0
        assert isinstance(result.get("equity_curve"), list)
