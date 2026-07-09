"""Corpus v3 Gate 3 re-run protocol — DEFECT 5 regression test (2026-07-06).

See docs/designs/corpus-v3-gate1-respecification-2026-07-05.md, "GATE 3 RE-RUN
— SYSTEMATIC SIBLING-PARITY AUDIT" section, for the locked scope this test
belongs to.

DEFECT 5 (VERIFIED, found by the systematic sibling-parity audit — NOT in the
originally-known Defect 1-4 set): `run_class_backtest()` (src/engine/
backtester.py, def ~6509) never called `_apply_dsl_stop_loss_and_time_stop()`
(Wave 21 E.3 ATR stop-ceiling entry-skip + E.5 unconditional 15:55 ET
time-stop-on-signal-array) or `_apply_dll_halt_to_entries()` (Wave 21 E.4 —
67% personal-DLL entry halt / 95% force-close), while its sibling
`run_backtest()` calls both unconditionally, wrapped in a fail-safe
try/except with an explicit `guards_failed` disclosure (deepscan16 Wave-1
Track2 CRITICAL E-1: "an unguarded backtest ... could show great Sharpe/PF/DSR
and sail through WFE/PBO/B14 to DEPLOY_READY with zero machine-readable
trace"). Every strategy compiled through the class path — the path the whole
corpus runs through, per CLAUDE.md §2b — was running with ZERO enforcement of
the DLL institutional hard gate, and had no unconditional stop-ceiling/
time-stop layer independent of the (skippable/optional) 7-layer eligibility
gate.

Fix applied: mirrors run_backtest's exact call pattern for both guard
functions (same shared functions, same fail-safe try/except wrapper,
`result["dsl_guards"]` carries the same schema key/shape as run_backtest's
`dsl_guards` disclosure so downstream TS consumers get one contract from
either engine path).

NOTE on scope: this fix IS trade-signal-affecting (unlike Defect 4's
equity-only fix) — DLL halt can suppress entries and the ATR-ceiling check can
skip entries whose structural stop exceeds the per-symbol ceiling. It is
engine-level (not spec-level), so it applies identically to v2 and every
v3-shadow spec in the Gate 3 re-run — the comparison stays apples-to-apples.

This test suite verifies WIRING and FAIL-SAFETY, not a forced real DLL breach
(forcing an actual $-based DLL halt requires an intraday multi-bar-per-session
dataset carefully tuned so ATR-based estimated loss crosses the threshold
within one session — out of scope for a lightweight unit test; the underlying
_apply_dll_halt_to_entries() / _apply_dsl_stop_loss_and_time_stop() functions
already have their own direct-unit coverage via the run_backtest() call site):
  1. Both guard functions are actually invoked exactly once per
     run_class_backtest() call (the exact omission Defect 5 fixes).
  2. `result["dsl_guards"]` is present with the same schema as run_backtest's,
     and `guards_failed=False` on a clean run.
  3. Fail-safe: an exception inside either guard function must NOT crash the
     backtest — `result["dsl_guards"]["guards_failed"]=True` +
     `guards_failed_reason` set + `guards_failed_audit_action="backtest.dsl_guards_failed"`,
     and the backtest otherwise completes normally (mirrors run_backtest's
     deepscan16 Wave-1 Track2 CRITICAL E-1 fail-safe contract).

SCOPE NOTE: this file is instrument-only per the Gate 3 re-run protocol's scope
lock — it adds test coverage for DEFECT 5 and touches nothing else (no
classifier, spec, or role logic).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import polars as pl


def _install_vbt_zero_trade_mock():
    """Mirrors test_gate3_defect1_class_backtest_zero_signal.py's mock — a
    zero-trade vectorbt stub is sufficient here because these tests exercise
    the ENTRY-SIGNAL-LEVEL guard wiring (which runs before vectorbt), not
    trade-management or equity-loop behavior.
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


def _make_strategy():
    from src.engine.config import (
        IndicatorConfig,
        PositionSizeConfig,
        StopConfig,
        StrategyConfig,
    )
    from src.engine.strategy_base import ExpressionStrategy

    config = StrategyConfig(
        name="Gate3 Defect5 Guards Wiring",
        symbol="MES",
        timeframe="daily",
        indicators=[
            IndicatorConfig(type="sma", period=5),
            IndicatorConfig(type="sma", period=15),
            IndicatorConfig(type="atr", period=14),
        ],
        entry_long="close > 9999999",  # never fires — signal content is irrelevant to these wiring tests
        entry_short="high < low",  # never-true sentinel (W23F.L convention)
        exit="close crosses_below sma_15",
        stop_loss=StopConfig(type="atr", multiplier=2.0),
        position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
    )
    return ExpressionStrategy(config)


class TestGate3Defect5DslGuardsWiring:
    """GATE3-DEFECT-5: DLL halt + stop-ceiling/time-stop guards must be
    invoked by run_class_backtest() (previously never called at all)."""

    def test_both_guard_functions_invoked_exactly_once(self, monkeypatch):
        _install_vbt_zero_trade_mock()

        import src.engine.backtester as backtester_module

        calls = {"stop_time": 0, "dll": 0}
        _real_stop_time = backtester_module._apply_dsl_stop_loss_and_time_stop
        _real_dll = backtester_module._apply_dll_halt_to_entries

        def _spy_stop_time(*a, **k):
            calls["stop_time"] += 1
            return _real_stop_time(*a, **k)

        def _spy_dll(*a, **k):
            calls["dll"] += 1
            return _real_dll(*a, **k)

        monkeypatch.setattr(backtester_module, "_apply_dsl_stop_loss_and_time_stop", _spy_stop_time)
        monkeypatch.setattr(backtester_module, "_apply_dll_halt_to_entries", _spy_dll)

        strategy = _make_strategy()
        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        result = backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
        )

        assert calls["stop_time"] == 1, (
            "DEFECT 5: _apply_dsl_stop_loss_and_time_stop was never called by "
            "run_class_backtest() pre-fix — must be called exactly once."
        )
        assert calls["dll"] == 1, (
            "DEFECT 5: _apply_dll_halt_to_entries was never called by "
            "run_class_backtest() pre-fix — must be called exactly once."
        )
        assert result["total_trades"] == 0  # sanity: zero-trade mock still returns cleanly

    def test_dsl_guards_key_present_with_clean_schema(self, monkeypatch):
        _install_vbt_zero_trade_mock()

        import src.engine.backtester as backtester_module

        strategy = _make_strategy()
        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        result = backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
        )

        assert "dsl_guards" in result, (
            "DEFECT 5: result['dsl_guards'] key was absent pre-fix — TS "
            "backtest-service.ts's guards_failed audit check silently never "
            "fired for ANY class-path backtest."
        )
        guards = result["dsl_guards"]
        for key in ("stop_ceiling_skips", "time_stop_exits", "dll_halt_blocks",
                    "guards_failed", "guards_failed_reason", "guards_failed_audit_action"):
            assert key in guards, f"dsl_guards missing expected key: {key}"
        assert guards["guards_failed"] is False
        assert guards["guards_failed_reason"] is None
        assert guards["guards_failed_audit_action"] is None

    def test_guard_exception_fails_safe_not_crash(self, monkeypatch):
        """Mirrors run_backtest's deepscan16 Wave-1 Track2 CRITICAL E-1
        fail-safe contract: a guard-path exception must degrade to a visible
        guards_failed=True disclosure, NOT crash the backtest."""
        _install_vbt_zero_trade_mock()

        import src.engine.backtester as backtester_module

        def _raise(*a, **k):
            raise RuntimeError("synthetic guard failure for fail-safe test")

        monkeypatch.setattr(backtester_module, "_apply_dsl_stop_loss_and_time_stop", _raise)

        strategy = _make_strategy()
        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        result = backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
        )  # must NOT raise — fail-safe

        assert result["total_trades"] == 0  # backtest still completed
        guards = result["dsl_guards"]
        assert guards["guards_failed"] is True
        assert "synthetic guard failure" in (guards["guards_failed_reason"] or "")
        assert guards["guards_failed_audit_action"] == "backtest.dsl_guards_failed"
