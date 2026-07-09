"""Corpus v3 Gate 3 re-run protocol — DEFECT 6 regression test (2026-07-06).

See docs/designs/corpus-v3-gate1-respecification-2026-07-05.md, "GATE 3 RE-RUN
— SYSTEMATIC SIBLING-PARITY AUDIT" section, for the locked scope this test
belongs to.

DEFECT 6 (VERIFIED, found by the systematic sibling-parity audit): deep-scan
#18c's "C-3 fix" (2026-07-05) surfaced `apply_eligibility_gate()`'s
`gate_stats["mode"]` (+ `"passthrough_reason"`) into
`result["eligibility_gate_mode"]` via `_build_eligibility_gate_mode_disclosure()`
— but it was wired into `run_backtest()` ONLY. `run_class_backtest()` never
gained the equivalent field, so the passthrough<->gated flip (e.g. a strategy
silently running in `passthrough_strategy_unregistered` mode instead of the
real `tf_institutional_overlay` gate) was queryable for DSL backtests but
NOT for class-path backtests — the exact same observability gap deep-scan
#18c closed for one sibling and missed for the other.

Fix applied: call the same `_build_eligibility_gate_mode_disclosure()` helper
in `run_class_backtest()` and add the same `result["eligibility_gate_mode"]`
key with the same shape.

NOTE on severity: unlike Defect 5, this is PURE ADDITIVE TELEMETRY — it does
NOT affect trade signals, trade counts, or P&L (computation-preserving, same
tier as Defect 1). It is a low-risk, high-value observability fix.

SCOPE NOTE: this file is instrument-only per the Gate 3 re-run protocol's scope
lock — it adds test coverage for DEFECT 6 and touches nothing else (no
classifier, spec, or role logic).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import polars as pl


def _install_vbt_zero_trade_mock():
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


class TestGate3Defect6EligibilityGateModeDisclosure:
    """GATE3-DEFECT-6: result['eligibility_gate_mode'] must be present on the
    class path, mirroring run_backtest's deep-scan #18c C-3 fix."""

    def test_eligibility_gate_mode_key_present_when_gate_active(self, monkeypatch):
        _install_vbt_zero_trade_mock()

        import src.engine.backtester as backtester_module
        from src.engine.config import (
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.strategy_base import ExpressionStrategy

        config = StrategyConfig(
            name="Gate3 Defect6 Eligibility Gate Mode",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close > 9999999",
            entry_short="high < low",
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        strategy = ExpressionStrategy(config)

        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        # skip_eligibility_gate=False (default) — the gate runs (in whatever
        # mode: passthrough_htf_unavailable here, since htf_cache stays None
        # with a <200-row daily_data) and gate_stats["mode"] must be
        # surfaced into the top-level result.
        result = backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
        )

        assert "eligibility_gate_mode" in result, (
            "DEFECT 6: result['eligibility_gate_mode'] was absent pre-fix — "
            "the passthrough<->gated flip was unobservable for class-path backtests."
        )
        mode_block = result["eligibility_gate_mode"]
        for key in ("long", "long_passthrough_reason", "short", "short_passthrough_reason"):
            assert key in mode_block, f"eligibility_gate_mode missing expected key: {key}"
        # htf_cache stays None (daily_data has only 10 rows, < 200 required) ->
        # both sides should report the passthrough mode/reason, not silent None.
        assert mode_block["long"] == "passthrough_htf_unavailable"
        assert mode_block["short"] == "passthrough_htf_unavailable"

    def test_eligibility_gate_mode_present_even_when_gate_skipped(self, monkeypatch):
        """skip_eligibility_gate=True still must produce a well-shaped (if
        all-None) disclosure dict — mirrors run_backtest's
        use_eligibility_gate=False contract (empty_stats has no "mode" key;
        the helper's .get() default must not KeyError)."""
        _install_vbt_zero_trade_mock()

        import src.engine.backtester as backtester_module
        from src.engine.config import (
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.strategy_base import ExpressionStrategy

        config = StrategyConfig(
            name="Gate3 Defect6 Skip Gate",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close > 9999999",
            entry_short="high < low",
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        strategy = ExpressionStrategy(config)

        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        result = backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
            skip_eligibility_gate=True,
        )

        assert "eligibility_gate_mode" in result
        mode_block = result["eligibility_gate_mode"]
        assert mode_block["long"] is None
        assert mode_block["short"] is None
