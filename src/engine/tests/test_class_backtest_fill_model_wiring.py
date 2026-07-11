"""End-to-end wiring proof — run_class_backtest() fill-model gap closure
(deep-scan 2026-07-09, ratified).

test_class_path_fill_model_alignment.py proves the ALIGNMENT MATH of the pure
helper (src.engine.fill_model.apply_class_path_fill_model) in isolation. This
file proves the helper is actually WIRED IN to run_class_backtest() end-to-end:
passing `fill_model=FillProbabilityConfig(...)` into a real run_class_backtest()
call must produce a populated `result["partial_fill_modeled"]` audit reflecting
real degradation, and omitting `fill_model` (every pre-existing caller) must be
byte-identical to pre-fix behavior (disabled, zero orders).

Per CLAUDE.md testing constraint: a bare `import vectorbt` (lazy-imported
inside run_class_backtest) hangs under pytest collection via numba JIT. This
suite mocks `sys.modules["vectorbt"]` with a zero-trade fake portfolio BEFORE
calling run_class_backtest — the same pattern used by
test_gate3_defect6_class_backtest_eligibility_gate_mode.py. The fill-model
wiring under test runs entirely on the entries/sizes arrays BEFORE the
vectorbt call, so a zero-trade mock does not blind this test to the wiring
it exercises.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta

import polars as pl
from unittest.mock import MagicMock


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


def _make_ohlcv(n: int = 120, base: float = 4000.0, thin_volume: float = 20.0) -> pl.DataFrame:
    """Synthetic daily OHLCV where EVERY bar after warmup is thin-volume, so a
    large fixed-contract order degrades on (almost) every entry bar once the
    Stage-2 fill model is wired in."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [base + i * 0.5 + (i % 5) * 2 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": dates,
            "open": [c - 2.0 for c in closes],
            "high": [c + 5.0 for c in closes],
            "low": [c - 5.0 for c in closes],
            "close": closes,
            "volume": [thin_volume] * n,
        }
    )


def _make_always_long_config():
    from src.engine.config import (
        IndicatorConfig,
        PositionSizeConfig,
        StopConfig,
        StrategyConfig,
    )

    return StrategyConfig(
        name="ClassBacktest FillModel Wiring Proof",
        symbol="MES",
        timeframe="daily",
        indicators=[
            IndicatorConfig(type="sma", period=5),
            IndicatorConfig(type="atr", period=14),
        ],
        entry_long="close > 0",          # always true after warmup — real, non-trivial signal
        entry_short="high < low",        # never-true sentinel (W23F.L convention)
        exit="close crosses_below sma_5",
        stop_loss=StopConfig(type="atr", multiplier=2.0),
        position_size=PositionSizeConfig(type="fixed", fixed_contracts=100),
    )


class TestRunClassBacktestFillModelWiring:
    def _run(self, monkeypatch, *, fill_model):
        _install_vbt_zero_trade_mock()
        import src.engine.backtester as backtester_module
        from src.engine.strategy_base import ExpressionStrategy

        def _raise_load_ohlcv(*a, **k):
            raise FileNotFoundError("test: no real data source available")

        monkeypatch.setattr(backtester_module, "load_ohlcv", _raise_load_ohlcv)

        config = _make_always_long_config()
        strategy = ExpressionStrategy(config)
        df = _make_ohlcv(120, thin_volume=20.0)
        small_daily = _make_ohlcv(10)  # <200 rows -> htf_cache=None passthrough

        return backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
            skip_eligibility_gate=True,
            fixed_contracts=100,
            fill_model=fill_model,
        )

    def test_fill_model_enabled_degrades_large_orders_on_thin_volume(self, monkeypatch):
        monkeypatch.setenv("BACKTEST_PARTIAL_FILL_ENABLED", "true")
        monkeypatch.setenv("BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD", "0.1")
        import src.engine.fill_model as fm
        fm._get_partial_fill_enabled.cache_clear()
        fm._get_partial_fill_volume_threshold.cache_clear()

        from src.engine.config import FillProbabilityConfig

        result = self._run(monkeypatch, fill_model=FillProbabilityConfig())

        assert "partial_fill_modeled" in result, "fill-model audit key missing from result dict"
        audit = result["partial_fill_modeled"]
        assert audit["enabled"] is True, "fill_model was supplied — audit must report enabled=True"
        assert audit["total_orders"] > 0, "always-long strategy must produce entry orders"
        assert audit["partial_fills"] > 0, (
            "100-contract orders into 20-volume bars must degrade — "
            "100/20=5.0 ratio is deep in forced-partial zone 3"
        )
        assert audit["avg_fill_ratio"] < 1.0

        fm._get_partial_fill_enabled.cache_clear()
        fm._get_partial_fill_volume_threshold.cache_clear()

    def test_fill_model_omitted_is_byte_identical_to_pre_fix_disabled_state(self, monkeypatch):
        """Backward compat: fill_model=None (the default — every pre-existing
        caller) must produce the disabled-audit fallback, same shape as
        run_backtest's pre-fill-model-request behavior."""
        result = self._run(monkeypatch, fill_model=None)

        assert "partial_fill_modeled" in result
        audit = result["partial_fill_modeled"]
        assert audit == {
            "enabled": False,
            "total_orders": 0,
            "partial_fills": 0,
            "avg_fill_ratio": 1.0,
            "avg_slippage_delta_per_partial": None,
        }
