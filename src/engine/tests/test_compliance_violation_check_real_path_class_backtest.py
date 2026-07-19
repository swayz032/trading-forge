"""test_compliance_violation_check_real_path_class_backtest.py — ratify-packet
docs/ratify-packets/backtest-compliance-sizing-gaps-2026-07-17.md, Finding 1,
§1.1c class-path sibling extension.

Verification plan RED-proof #6 (§1.4 item 8): landing only the DSL-path
(`run_backtest`) wiring and marking Finding 1 closed while `run_class_backtest`
stays silently uncovered is exactly the missed-sibling failure this repo's
fix-the-whole-class discipline (memory
feedback_fix_the_pattern_class_not_the_instance) exists to catch.

This test drives the REAL `run_class_backtest()` end-to-end (vectorbt mocked
per the tower's documented JIT-collection hang — CLAUDE.md pinned fact — but
`_apply_trade_management`, `check_violation`, and
`detect_trade_compliance_violations` are never mocked) with a single
synthetic trade whose stop-distance genuinely risks more than 2% of the MFFU
$48,000 starting floor ($960), against `firm_key="mffu_50k"`. Asserts the
class path's `compliance_violation_audit` result key reflects the SAME real
violation the DSL-path test (test_compliance_violation_check_real_path.py)
exercises through `detect_trade_compliance_violations()` directly.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pandas as pd
import polars as pl
import pytest


def _install_vbt_one_trade_mock():
    _fake_trade_row = pd.DataFrame(
        {
            "Avg Entry Price": [4000.0],
            "Avg Exit Price": [4010.0],
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


def _make_ohlcv(n: int = 200, base: float = 4000.0, trend: float = 0.5) -> pl.DataFrame:
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
            "is_rollover_day": [False] * n,
        }
    )


class TestComplianceViolationCheckRealPathClassBacktest:
    """§1.1c: the same MFFU 2%-rule shadow audit, exercised through the REAL
    run_class_backtest() trade loop instead of the helper directly."""

    def _run(self, monkeypatch, *, gate_enabled: bool, risk_points: float, firm_key: str = "mffu_50k"):
        if gate_enabled:
            monkeypatch.setenv("BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED", "true")
        else:
            monkeypatch.delenv("BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED", raising=False)

        _install_vbt_one_trade_mock()

        import src.engine.backtester as backtester_module

        monkeypatch.setattr(
            backtester_module,
            "_apply_trade_management",
            lambda *a, **k: [
                {
                    "exit_price": 4010.0,
                    "exit_idx": 15,
                    "exit_reason": "signal",
                    "risk_points": risk_points,
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
            name="Compliance Violation Class Path Never Fires",
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

        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        return backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
            firm_key=firm_key,
        )

    def test_real_two_percent_violation_flagged_when_gate_enabled(self, monkeypatch):
        """risk_points=250 on MES ($5/pt) with 1 contract -> intended_max_loss
        = $1,250, well over 2% of the MFFU $48,000 starting floor ($960)."""
        result = self._run(monkeypatch, gate_enabled=True, risk_points=250.0)

        assert result["total_trades"] == 1
        assert result["trades"][0]["intended_max_loss"] == pytest.approx(1_250.0, abs=0.01)

        audit = result["compliance_violation_audit"]
        assert len(audit) == 1
        assert audit[0]["trade_index"] == 0
        assert audit[0]["symbol"] == "MES"
        assert any("2%" in v or "two_percent" in v.lower() for v in audit[0]["violations"]), audit[0]["violations"]

    def test_compliant_trade_not_flagged_negative_control(self, monkeypatch):
        """risk_points=5 -> intended_max_loss = $25, well inside the $960
        budget -- proves the class-path wiring is a real conditional, not an
        unconditional flag-everything bug."""
        result = self._run(monkeypatch, gate_enabled=True, risk_points=5.0)

        assert result["trades"][0]["intended_max_loss"] == pytest.approx(25.0, abs=0.01)
        assert result["compliance_violation_audit"] == []

    def test_gate_disabled_means_no_audit_even_on_a_genuine_violation(self, monkeypatch):
        """Same egregious violation as the first test, but with the gate OFF
        (default) -- the class path must not invoke detection at all."""
        result = self._run(monkeypatch, gate_enabled=False, risk_points=250.0)

        assert result["trades"][0]["intended_max_loss"] == pytest.approx(1_250.0, abs=0.01)
        assert result["compliance_violation_audit"] == []

    def test_non_mffu_firm_is_a_no_op_even_with_the_same_violation(self, monkeypatch):
        """The 2%-rule check is MFFU-specific (compliance_gate.py) -- a
        Topstep class-path backtest with the identical over-2% risk must not
        be flagged. Honest scoping, not an oversight (packet §1.1b)."""
        result = self._run(monkeypatch, gate_enabled=True, risk_points=250.0, firm_key="topstep_50k")

        assert result["compliance_violation_audit"] == []
