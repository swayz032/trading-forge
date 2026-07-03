"""deepscan14-cf Track A (engine) — B2 full closure regression tests.

Deep-scan #14 Track 4 fixed the commission_per_side ambiguity *inside*
backtester.py (model_fields_set disambiguation for run_backtest, an
unambiguous `None` default for run_class_backtest) but explicitly deferred
the schema-level fix to config.py/walk_forward.py as "out of scope for this
track" (see backtester.py's B2 comment block above the commission resolution
logic, ~line 3708). This file proves that follow-up closure:

  1. `BacktestRequest.commission_per_side` (config.py) now defaults to None,
     not 0.62 — an omitted commission is a real, distinct pydantic field-set
     state from an explicit `commission_per_side: 0.62` in the payload.
  2. `run_walk_forward_class`'s own `commission_per_side` param (walk_forward.py)
     mirrors the sibling `run_class_backtest` fix: default None, not 0.62.
  3. `run_walk_forward_class` forwards whatever it receives to
     `run_class_backtest` UNCHANGED — it does not itself reintroduce the
     ambiguity by rewriting an omitted/None value to 0.62 before forwarding.

None of this changes effective behavior for the current MES/MNQ/MCL universe,
where `spec.default_commission == 0.62` for all three (ContractSpec base
default) — backtester.py's defensive `if commission is None: commission =
spec.default_commission` net (Track 4) resolves None to the same numeric
value either way. It only matters once Phase 5 mini contracts
(ES/NQ/CL, default_commission=3.70) are enabled, or for any firm whose
per-symbol commission diverges from 0.62.

NOTE: backtester.py imports vectorbt — mock before importing (mirrors the
existing pattern in test_deepscan14_dsl_flatten.py / test_fix6_dsl_dst_time_stop.py).
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _install_vbt_mock():
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock
    return _vbt_mock


_install_vbt_mock()

import inspect  # noqa: E402

import polars as pl  # noqa: E402
import pytest  # noqa: E402


class TestConfigPyCommissionDefault:
    """FIX 1 item 1 — BacktestRequest.commission_per_side schema default."""

    def test_backtest_request_commission_default_is_none(self):
        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )

        strategy = StrategyConfig(
            name="Test",
            symbol="MES",
            timeframe="daily",
            indicators=[IndicatorConfig(type="sma", period=20)],
            entry_long="close > sma_20",
            entry_short="close < sma_20",
            exit="close < sma_20",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        req = BacktestRequest(strategy=strategy, start_date="2023-01-01", end_date="2023-06-30")

        assert req.commission_per_side is None, (
            "deepscan14-cf FIX 1: BacktestRequest.commission_per_side must default "
            "to None (unambiguous 'omitted' sentinel), not the old 0.62 literal — "
            "an explicit `commission_per_side: 0.62` in a request payload must be "
            "distinguishable from a caller who never set the field at all."
        )
        assert "commission_per_side" not in req.model_fields_set

    def test_explicit_0_62_still_distinguishable_from_omitted(self):
        """Companion check: explicit 0.62 is real, present-in-set state."""
        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )

        strategy = StrategyConfig(
            name="Test",
            symbol="MES",
            timeframe="daily",
            indicators=[IndicatorConfig(type="sma", period=20)],
            entry_long="close > sma_20",
            entry_short="close < sma_20",
            exit="close < sma_20",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        req = BacktestRequest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-06-30",
            commission_per_side=0.62,
        )
        assert req.commission_per_side == pytest.approx(0.62)
        assert "commission_per_side" in req.model_fields_set


class TestRunWalkForwardClassCommissionDefault:
    """FIX 1 item 2 — run_walk_forward_class signature default mirrors
    run_class_backtest's already-fixed None sentinel (Track 4)."""

    def test_signature_default_is_none_not_0_62(self):
        from src.engine.walk_forward import run_walk_forward_class

        sig = inspect.signature(run_walk_forward_class)
        assert sig.parameters["commission_per_side"].default is None, (
            "deepscan14-cf FIX 1: run_walk_forward_class's commission_per_side "
            "default must be None, mirroring the sibling run_class_backtest fix "
            "(Track 4) — a plain-Python `float = 0.62` default cannot distinguish "
            "'caller omitted' from 'caller explicitly wants 0.62', the exact "
            "ambiguity class B2 identified."
        )

    def test_both_class_wf_functions_agree_on_sentinel(self):
        """run_walk_forward_class forwards commission_per_side verbatim into
        run_class_backtest (walk_forward.py:2488) — both signatures must use
        the same sentinel type or the forwarding contract silently breaks."""
        from src.engine.backtester import run_class_backtest
        from src.engine.walk_forward import run_walk_forward_class

        wf_default = inspect.signature(run_walk_forward_class).parameters["commission_per_side"].default
        cb_default = inspect.signature(run_class_backtest).parameters["commission_per_side"].default
        assert wf_default is cb_default is None


class TestRunWalkForwardClassForwardsCommissionUnchanged:
    """FIX 1 item 3 — run_walk_forward_class must not rewrite an
    omitted/None commission_per_side to 0.62 (or anything else) before
    forwarding to run_class_backtest per OOS window. It is a pure pass-through.

    Data loading + the full class-backtest pipeline are mocked out entirely —
    this test exercises ONLY the forwarding contract at the walk_forward.py
    layer (the layer this fix actually touches), not run_class_backtest's own
    resolution net (already covered by test_deepscan14_dsl_flatten.py).
    """

    class _DummyStrategy:
        """Minimal BaseStrategy-shaped stub — avoids ABC instantiation
        friction unrelated to this fix (compute()/get_params()/
        get_default_config() are never invoked on this path since
        run_class_backtest itself is mocked out)."""

        name = "dummy_commission_forward_test"
        symbol = "MES"
        timeframe = "daily"
        preferred_regime = None
        overnight_hold = False

        def compute(self, df: pl.DataFrame) -> pl.DataFrame:  # pragma: no cover
            return df

        def get_params(self) -> dict:  # pragma: no cover
            return {}

        def get_default_config(self) -> dict:  # pragma: no cover
            return {}

    @staticmethod
    def _tiny_ohlcv(n: int = 20) -> pl.DataFrame:
        # No ts_event/ts_et column — run_walk_forward_class's date-boundary
        # helpers fall back to start_date/end_date in that case (see
        # _ts_col_wf / _ts_col_cls), so this deliberately-minimal frame is
        # sufficient for split_walk_forward_windows() + the per-window loop.
        return pl.DataFrame({"close": [float(4000 + i) for i in range(n)]})

    def _run_and_capture(self, monkeypatch, commission_kwarg: dict) -> list:
        import src.engine.data_loader as data_loader_module
        import src.engine.walk_forward as wf_module

        captured_calls: list = []

        def _fake_load_ohlcv(*args, **kwargs):
            return self._tiny_ohlcv()

        def _fake_run_class_backtest(*args, **kwargs):
            captured_calls.append(kwargs.get("commission_per_side"))
            return {}

        monkeypatch.setattr(data_loader_module, "load_ohlcv", _fake_load_ohlcv)
        monkeypatch.setattr(wf_module, "run_class_backtest", _fake_run_class_backtest)

        wf_module.run_walk_forward_class(
            strategy=self._DummyStrategy(),
            start_date="2023-01-01",
            end_date="2023-02-01",
            n_splits=2,
            is_ratio=0.5,
            embargo_bars=0,
            optimize=False,
            **commission_kwarg,
        )
        return captured_calls

    def test_omitted_commission_forwards_as_none(self, monkeypatch):
        """Caller omits commission_per_side entirely — run_class_backtest
        must receive None (not a silently-injected 0.62), so IT is the one
        that resolves the effective value via spec.default_commission."""
        calls = self._run_and_capture(monkeypatch, commission_kwarg={})
        assert len(calls) >= 1, "run_class_backtest was never invoked — window split produced 0 windows"
        assert all(c is None for c in calls), (
            f"deepscan14-cf FIX 1 REGRESSION: run_walk_forward_class forwarded a "
            f"non-None commission_per_side ({calls!r}) when the caller omitted it "
            f"— it must pass None through unchanged to run_class_backtest."
        )

    def test_explicit_commission_forwards_unchanged(self, monkeypatch):
        """Caller explicitly passes a non-default commission — must reach
        run_class_backtest byte-identical, not silently reset to spec default."""
        calls = self._run_and_capture(
            monkeypatch, commission_kwarg={"commission_per_side": 1.23}
        )
        assert len(calls) >= 1, "run_class_backtest was never invoked — window split produced 0 windows"
        assert all(c == pytest.approx(1.23) for c in calls), (
            f"deepscan14-cf FIX 1 REGRESSION: explicit commission_per_side=1.23 "
            f"was not forwarded unchanged to run_class_backtest — got {calls!r}"
        )

    def test_explicit_0_62_not_conflated_with_omitted(self, monkeypatch):
        """The historical ambiguity case: explicit 0.62 (the old default
        literal) must still reach run_class_backtest as 0.62, not None —
        proving the two states remain distinguishable end-to-end through the
        walk_forward.py forwarding layer."""
        calls = self._run_and_capture(
            monkeypatch, commission_kwarg={"commission_per_side": 0.62}
        )
        assert len(calls) >= 1, "run_class_backtest was never invoked — window split produced 0 windows"
        assert all(c == pytest.approx(0.62) for c in calls)
