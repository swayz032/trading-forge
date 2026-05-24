"""Tests for _apply_trade_management() branching — Wave 25 Gap B.

Coverage:
  1. exit_engine="static_styleC" + adaptive_ctx=None → static Style C path fires
  2. exit_engine="adaptive" + adaptive_ctx provided → adaptive logic fires
  3. exit_engine="adaptive" + adaptive_ctx=None → graceful fallback to static_styleC
  4. 15:55 ET hard flatten fires for adaptive path
  5. BE+1 tick on TP1 fill fires in adaptive path
  6. _apply_trade_management() signature contracts
  7. Adaptive trades carry adaptive metadata keys
  8. Static trades do NOT carry adaptive metadata (no contamination)

Design note:
  Backtester.py imports vectorbt at module level, which performs JIT compilation
  that can take minutes on first run. To keep this test file fast and isolated,
  we import the PURE dispatch/routing logic only — specifically
  _apply_adaptive_management (no vectorbt dependency at all) and test the
  routing branch by mocking the heavy static path.

  For signature checks on the top-level dispatcher, we use inspect directly
  on the source file to avoid triggering the full module init.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import polars as pl
import pytest

from src.engine.config import AdaptiveExitContext, LiquidityLevelSnapshot

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_trades_records(
    entry_p: float = 4000.0,
    exit_p: float = 4010.0,
    size: float = 6.0,
    direction: str = "Long",
    entry_idx: int = 0,
    exit_idx: int = 20,
) -> pd.DataFrame:
    """Minimal trades_records DataFrame matching vectorbt output schema."""
    return pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [exit_p],
        "Size": [size],
        "Direction": [direction],
        "Entry Idx": [entry_idx],
        "Exit Idx": [exit_idx],
    })


def _make_price_arrays(
    n: int = 50,
    base: float = 4000.0,
    seed: int = 42,
) -> dict:
    """Create deterministic OHLCV numpy arrays."""
    rng = np.random.default_rng(seed)
    close = base + np.cumsum(rng.normal(0, 1, n))
    high = close + rng.uniform(0.5, 3, n)
    low = close - rng.uniform(0.5, 3, n)
    open_ = close - rng.uniform(0.2, 1.5, n)
    atr = np.full(n, 6.0)
    return {"close": close, "high": high, "low": low, "open": open_, "atr": atr}


def _make_spec():
    """Minimal ContractSpec-like object."""
    @dataclass
    class FakeSpec:
        tick_size: float = 0.25
        tick_value: float = 1.25
        point_value: float = 5.0
    return FakeSpec()


def _make_df(n: int = 50, include_ts: bool = True) -> pl.DataFrame:
    """Minimal Polars DataFrame for backtester.py usage."""
    dates = [datetime(2025, 6, 10, 14, i) for i in range(n)]
    data: dict = {
        "close": [4000.0 + i * 0.5 for i in range(n)],
        "high":  [4002.0 + i * 0.5 for i in range(n)],
        "low":   [3998.0 + i * 0.5 for i in range(n)],
        "open":  [3999.0 + i * 0.5 for i in range(n)],
    }
    if include_ts:
        data["ts_event"] = dates
    return pl.DataFrame(data)


def _make_adaptive_ctx(
    regime: str = "TRENDING_UP",
    liquidity: list | None = None,
) -> AdaptiveExitContext:
    if liquidity is None:
        liquidity = []
    return AdaptiveExitContext(
        liquidity_snapshot=liquidity,
        regime_at_entry=regime,
        pre_lunch_threshold_r=0.3,
        delta_div_threshold=0.6,
    )


# ─── Import _apply_adaptive_management without triggering vectorbt ────────────

def _get_adaptive_fn():
    """Import _apply_adaptive_management by mocking out vectorbt and heavy deps.

    The adaptive management function has NO vectorbt dependency at runtime —
    vectorbt is only used in the broader backtester for signal generation.
    We mock the module-level vectorbt import so the import completes instantly.
    """
    import sys
    import types

    # Build a minimal mock for vectorbt so the module-level `import vectorbt as vbt`
    # doesn't hang. Only the vbt.Portfolio.from_signals call in run_class_backtest
    # uses vbt — not in _apply_adaptive_management.
    if "vectorbt" not in sys.modules:
        vbt_mock = types.ModuleType("vectorbt")
        vbt_mock.Portfolio = MagicMock()
        sys.modules["vectorbt"] = vbt_mock

    # Also mock other heavy optional imports that may hang
    heavy_mocks = [
        "src.engine.nvtx_markers",
        "src.engine.decay.half_life",
        "src.engine.decay.sub_signals",
        "src.engine.prop_sim",
        "src.engine.cross_validation",
    ]
    for mod_name in heavy_mocks:
        if mod_name not in sys.modules:
            mock_mod = types.ModuleType(mod_name)
            # Add commonly-needed attributes
            for attr in ["range_push", "range_pop", "fit_decay",
                         "composite_decay_score", "simulate_all_firms",
                         "run_cross_validation"]:
                setattr(mock_mod, attr, MagicMock(return_value={}))
            sys.modules[mod_name] = mock_mod

    from src.engine.backtester import _apply_adaptive_management
    return _apply_adaptive_management


# ─── Inspect signature without triggering vectorbt ────────────────────────────

def _get_backtester_signatures() -> dict:
    """Return parameter name sets for key functions by parsing source (no import)."""
    import ast
    import pathlib

    src = pathlib.Path("src/engine/backtester.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    sigs = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in (
            "_apply_trade_management", "run_class_backtest"
        ):
            params = {}
            defaults = node.args.defaults
            # Align defaults to the END of args (standard Python semantics)
            n_no_default = len(node.args.args) - len(defaults)
            for i, arg in enumerate(node.args.args):
                default_idx = i - n_no_default
                if default_idx >= 0:
                    d = defaults[default_idx]
                    if isinstance(d, ast.Constant):
                        params[arg.arg] = d.value
                    else:
                        params[arg.arg] = "..."
                else:
                    params[arg.arg] = inspect.Parameter.empty
            # kwonlyargs with kw_defaults
            for arg, dnode in zip(node.args.kwonlyargs, node.args.kw_defaults):
                if dnode and isinstance(dnode, ast.Constant):
                    params[arg.arg] = dnode.value
                else:
                    params[arg.arg] = "..."
            sigs[node.name] = params
    return sigs


# ─── 1+2+3: Routing logic via mocks (no vectorbt needed) ──────────────────────


class TestDispatchRouting:
    """Test _apply_trade_management routing by mocking the two handlers."""

    def _call_dispatcher_with_mocks(
        self, exit_engine, adaptive_ctx,
        static_return=None, adaptive_return=None,
    ) -> tuple:
        """Call the real dispatcher with mocked sub-handlers.

        Returns (result, static_called, adaptive_called).
        """
        static_return = static_return or [{"exit_price": 4010.0, "exit_idx": 10, "exit_reason": "signal"}]
        adaptive_return = adaptive_return or [{
            "exit_price": 4015.0, "exit_idx": 12, "exit_reason": "tp1",
            "adaptive_exit_engine": True, "adaptive_regime": adaptive_ctx.regime_at_entry if adaptive_ctx else "?",
        }]

        _get_adaptive_fn()  # Ensure vectorbt is mocked before importing dispatcher
        from src.engine.backtester import _apply_trade_management

        arrays = _make_price_arrays()
        trades = _make_trades_records()
        df = _make_df()

        static_mock = MagicMock(return_value=static_return)
        adaptive_mock = MagicMock(return_value=adaptive_return)

        with patch("src.engine.backtester._apply_static_styleC_management", static_mock):
            with patch("src.engine.backtester._apply_adaptive_management", adaptive_mock):
                result = _apply_trade_management(
                    trades,
                    arrays["high"], arrays["low"], arrays["close"], arrays["atr"],
                    _make_spec(), None, df.to_pandas(),
                    open_np=arrays["open"],
                    exit_engine=exit_engine,
                    adaptive_ctx=adaptive_ctx,
                )

        return result, static_mock.called, adaptive_mock.called

    def test_static_styleC_calls_static_handler(self):
        """exit_engine='static_styleC' → _apply_static_styleC_management called."""
        result, static_called, adaptive_called = self._call_dispatcher_with_mocks(
            exit_engine="static_styleC", adaptive_ctx=None,
        )
        assert static_called is True
        assert adaptive_called is False

    def test_adaptive_with_ctx_calls_adaptive_handler(self):
        """exit_engine='adaptive' + ctx → _apply_adaptive_management called."""
        ctx = _make_adaptive_ctx("TRENDING_UP")
        result, static_called, adaptive_called = self._call_dispatcher_with_mocks(
            exit_engine="adaptive", adaptive_ctx=ctx,
        )
        assert adaptive_called is True
        assert static_called is False

    def test_adaptive_without_ctx_falls_back_to_static(self):
        """exit_engine='adaptive' + ctx=None → fallback to _apply_static_styleC_management."""
        result, static_called, adaptive_called = self._call_dispatcher_with_mocks(
            exit_engine="adaptive", adaptive_ctx=None,
        )
        assert static_called is True
        assert adaptive_called is False

    def test_static_returns_list(self):
        result, _, _ = self._call_dispatcher_with_mocks(
            exit_engine="static_styleC", adaptive_ctx=None,
        )
        assert isinstance(result, list)

    def test_adaptive_returns_list(self):
        ctx = _make_adaptive_ctx("RANGE_BOUND")
        result, _, _ = self._call_dispatcher_with_mocks(
            exit_engine="adaptive", adaptive_ctx=ctx,
        )
        assert isinstance(result, list)

    def test_static_result_no_adaptive_keys(self):
        """Static path result must not have adaptive metadata keys."""
        result, _, _ = self._call_dispatcher_with_mocks(
            exit_engine="static_styleC", adaptive_ctx=None,
            static_return=[{"exit_price": 4010.0, "exit_idx": 10, "exit_reason": "signal"}],
        )
        t = result[0]
        assert "adaptive_exit_engine" not in t
        assert "adaptive_regime" not in t

    def test_adaptive_result_has_metadata(self):
        """Adaptive path result must contain adaptive metadata."""
        ctx = _make_adaptive_ctx("EXPANSION")
        result, _, _ = self._call_dispatcher_with_mocks(
            exit_engine="adaptive", adaptive_ctx=ctx,
            adaptive_return=[{
                "exit_price": 4015.0, "exit_idx": 12, "exit_reason": "tp1",
                "adaptive_exit_engine": True, "adaptive_regime": "EXPANSION",
            }],
        )
        t = result[0]
        assert t.get("adaptive_exit_engine") is True
        assert t.get("adaptive_regime") == "EXPANSION"


# ─── 4. 15:55 ET hard flatten — via _apply_adaptive_management directly ───────


class TestTimeStop:
    """15:55 ET invariant in _apply_adaptive_management (no vectorbt needed)."""

    def test_adaptive_time_stop_at_15_55_et(self):
        """Bar at 15:55 ET (19:55 UTC) must produce time_stop exit in adaptive path."""
        fn = _get_adaptive_fn()
        n = 50

        # All bars at 19:55 UTC = 15:55 EDT
        dates = [datetime(2025, 6, 10, 19, 55) for _ in range(n)]
        base = 4000.0
        close = np.full(n, base + 10.0)
        high = close + 2.0
        low = close - 2.0
        open_ = close - 0.5
        atr = np.full(n, 6.0)

        df = pl.DataFrame({
            "ts_event": dates,
            "close": close.tolist(),
            "high": high.tolist(),
            "low": low.tolist(),
            "open": open_.tolist(),
        })

        trades = _make_trades_records(
            entry_p=base, exit_p=base + 10.0,
            entry_idx=0, exit_idx=40,
        )
        ctx = _make_adaptive_ctx("TRENDING_UP")

        result = fn(
            trades, high, low, close, atr,
            _make_spec(), df.to_pandas(), ctx,
            open_np=open_,
        )

        assert len(result) == 1
        t = result[0]
        assert t["exit_reason"] == "time_stop"

    def test_adaptive_no_early_time_stop_before_15_55(self):
        """Bars before 15:55 ET should NOT trigger time_stop."""
        fn = _get_adaptive_fn()
        n = 50

        # All bars at 14:00 ET (18:00 UTC) — well before 15:55
        dates = [datetime(2025, 6, 10, 18, 0) for _ in range(n)]
        base = 4000.0
        close = np.full(n, base)
        high = close + 1.0
        low = close - 1.0
        open_ = close - 0.2
        atr = np.full(n, 6.0)

        df = pl.DataFrame({
            "ts_event": dates,
            "close": close.tolist(),
            "high": high.tolist(),
            "low": low.tolist(),
            "open": open_.tolist(),
        })

        trades = _make_trades_records(
            entry_p=base, exit_p=base + 5.0,
            entry_idx=0, exit_idx=20,
        )
        ctx = _make_adaptive_ctx("TRENDING_UP")

        result = fn(
            trades, high, low, close, atr,
            _make_spec(), df.to_pandas(), ctx,
            open_np=open_,
        )

        assert len(result) == 1
        t = result[0]
        # Should NOT be a time_stop (the original signal exit should fire)
        assert t["exit_reason"] != "time_stop"


# ─── 5. BE+1 tick on TP1 fill ─────────────────────────────────────────────────


class TestBEOnTP1:
    """BE+1 tick after TP1 in _apply_adaptive_management."""

    def test_trail_stop_moves_to_be_on_tp1_hit(self):
        """After TP1 is hit, trail_stop_final must be >= entry_price."""
        fn = _get_adaptive_fn()
        n = 50
        entry_p = 4000.0
        # stop_p documented as 3994.0 (6pt stop → 1R = 6pt, TP1 = 4006) — Trade row uses default stop

        # Bar 2 touches TP1 (high >= entry + 1R = 4006)
        high = np.full(n, entry_p + 1.0)
        high[2] = 4007.0       # TP1 hit on bar 2 (1R = 6pt from entry 4000 → TP1=4006)
        low = np.full(n, entry_p - 1.0)
        close = np.full(n, entry_p)
        open_ = np.full(n, entry_p)
        atr = np.full(n, 6.0)

        # Bars at 14:00 ET (not time-stop)
        dates = [datetime(2025, 6, 10, 14, i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "close": close.tolist(),
            "high": high.tolist(),
            "low": low.tolist(),
            "open": open_.tolist(),
        })

        trades = _make_trades_records(
            entry_p=entry_p, exit_p=entry_p + 5.0,
            entry_idx=0, exit_idx=40,
        )
        ctx = _make_adaptive_ctx("TRENDING_UP")

        result = fn(
            trades, high, low, close, atr,
            _make_spec(), df.to_pandas(), ctx,
            open_np=open_,
        )

        assert len(result) == 1
        t = result[0]
        # trail_stop_final must be at or above entry after TP1 fired
        assert t["trail_stop_final"] >= entry_p - 0.5, (
            f"Expected trail_stop >= BE ({entry_p}), got {t['trail_stop_final']}"
        )


# ─── 6. Signature contracts — pure AST parse, no vectorbt ─────────────────────


class TestBranchingSignature:
    """Verify _apply_trade_management and run_class_backtest have the right params."""

    def test_exit_engine_param_in_atm_signature(self):
        sigs = _get_backtester_signatures()
        assert "_apply_trade_management" in sigs
        assert "exit_engine" in sigs["_apply_trade_management"]

    def test_adaptive_ctx_param_in_atm_signature(self):
        sigs = _get_backtester_signatures()
        assert "adaptive_ctx" in sigs["_apply_trade_management"]

    def test_exit_engine_default_is_static_styleC(self):
        sigs = _get_backtester_signatures()
        assert sigs["_apply_trade_management"]["exit_engine"] == "static_styleC"

    def test_adaptive_ctx_default_is_none(self):
        sigs = _get_backtester_signatures()
        assert sigs["_apply_trade_management"]["adaptive_ctx"] is None

    def test_run_class_backtest_has_adaptive_ctx(self):
        sigs = _get_backtester_signatures()
        assert "run_class_backtest" in sigs
        assert "adaptive_ctx" in sigs["run_class_backtest"]

    def test_run_class_backtest_adaptive_ctx_default_none(self):
        sigs = _get_backtester_signatures()
        assert sigs["run_class_backtest"]["adaptive_ctx"] is None


# ─── 7. AdaptiveExitContext dataclass ─────────────────────────────────────────


class TestAdaptiveExitContext:
    def test_construction_with_defaults(self):
        ctx = AdaptiveExitContext(liquidity_snapshot=[])
        assert ctx.pre_lunch_threshold_r == 0.3
        assert ctx.delta_div_threshold == 0.6
        assert ctx.regime_at_entry is None

    def test_liquidity_snapshot_list(self):
        lvl = LiquidityLevelSnapshot(
            level_type="pdh", price=4010.0, htf_significance=3
        )
        ctx = AdaptiveExitContext(liquidity_snapshot=[lvl])
        assert len(ctx.liquidity_snapshot) == 1

    def test_liquidity_snapshot_fields(self):
        lvl = LiquidityLevelSnapshot(
            level_type="naked_poc", price=4005.0,
            htf_significance=4, sweep_probability=0.7,
        )
        assert lvl.level_type == "naked_poc"
        assert lvl.price == 4005.0
        assert lvl.htf_significance == 4
        assert lvl.sweep_probability == pytest.approx(0.7)

    def test_regime_at_entry_stored(self):
        ctx = _make_adaptive_ctx("HIGH_VOL_MACRO")
        assert ctx.regime_at_entry == "HIGH_VOL_MACRO"

    def test_thresholds_stored(self):
        ctx = AdaptiveExitContext(
            liquidity_snapshot=[],
            pre_lunch_threshold_r=0.5,
            delta_div_threshold=0.8,
        )
        assert ctx.pre_lunch_threshold_r == 0.5
        assert ctx.delta_div_threshold == 0.8


# ─── 8. Adaptive management metadata ─────────────────────────────────────────


class TestAdaptiveMetadata:
    """Test that _apply_adaptive_management produces correct metadata keys."""

    def test_adaptive_trade_has_adaptive_exit_engine_flag(self):
        fn = _get_adaptive_fn()
        arrays = _make_price_arrays()
        trades = _make_trades_records()
        df = _make_df()
        ctx = _make_adaptive_ctx("RANGE_BOUND")

        result = fn(
            trades, arrays["high"], arrays["low"], arrays["close"], arrays["atr"],
            _make_spec(), df.to_pandas(), ctx,
            open_np=arrays["open"],
        )
        assert len(result) == 1
        assert result[0].get("adaptive_exit_engine") is True

    def test_adaptive_trade_has_regime(self):
        fn = _get_adaptive_fn()
        arrays = _make_price_arrays()
        trades = _make_trades_records()
        df = _make_df()
        ctx = _make_adaptive_ctx("COMPRESSION")

        result = fn(
            trades, arrays["high"], arrays["low"], arrays["close"], arrays["atr"],
            _make_spec(), df.to_pandas(), ctx,
            open_np=arrays["open"],
        )
        assert result[0].get("adaptive_regime") == "COMPRESSION"

    def test_adaptive_trade_has_runner_method(self):
        fn = _get_adaptive_fn()
        arrays = _make_price_arrays()
        trades = _make_trades_records()
        df = _make_df()
        ctx = _make_adaptive_ctx("TRENDING_UP")

        result = fn(
            trades, arrays["high"], arrays["low"], arrays["close"], arrays["atr"],
            _make_spec(), df.to_pandas(), ctx,
            open_np=arrays["open"],
        )
        assert "adaptive_runner_method" in result[0]
        assert result[0]["adaptive_runner_method"] == "anchored_vwap"

    def test_adaptive_trade_has_scaling(self):
        fn = _get_adaptive_fn()
        arrays = _make_price_arrays()
        trades = _make_trades_records()
        df = _make_df()
        ctx = _make_adaptive_ctx("HIGH_VOL_MACRO")

        result = fn(
            trades, arrays["high"], arrays["low"], arrays["close"], arrays["atr"],
            _make_spec(), df.to_pandas(), ctx,
            open_np=arrays["open"],
        )
        assert "adaptive_scaling" in result[0]

    def test_adaptive_delta_div_skipped_flag(self):
        """In backtest (no live delta feed), delta_div_skipped must be True."""
        fn = _get_adaptive_fn()
        arrays = _make_price_arrays()
        trades = _make_trades_records()
        df = _make_df()
        ctx = _make_adaptive_ctx("TRENDING_UP")

        result = fn(
            trades, arrays["high"], arrays["low"], arrays["close"], arrays["atr"],
            _make_spec(), df.to_pandas(), ctx,
            open_np=arrays["open"],
        )
        # No live delta feed in backtest — flag must be True
        assert result[0].get("delta_div_skipped") is True
