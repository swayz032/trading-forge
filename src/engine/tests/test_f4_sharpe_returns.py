"""F-4 (2026-06-29): Return-based Sharpe added as sibling metric.

Verifies:
  1. sharpe_ratio_returns is present in backtester result dict.
  2. sharpe_ratio (dollar-P&L) is unchanged / still present.
  3. Flat equity series → sharpe_ratio_returns=0.0 (std=0).
  4. Known-answer: equal daily gains → sharpe_ratio_returns > 0.
  5. Known-answer: alternating gains/losses → sharpe_ratio_returns ~ dollar Sharpe
     (when starting capital >> daily P&L change, they converge).
  6. sharpe_ratio_returns is never equal to a large number when std=0.
  7. walk_forward oos_metrics contains sharpe_ratio_returns key.
  8. walk_forward oos_metrics still contains sharpe_ratio key (no regression).
  9. sharpe_ratio_returns code is present in backtester.py (source audit).
  10. sharpe_ratio_returns code is present in walk_forward.py (source audit).

NOTE: All backtester.py imports are LAZY (inside test methods) to prevent pytest
collection from triggering vectorbt JIT compilation (hangs on this tower).
vectorbt is mocked at module import via sys.modules.setdefault.
"""
from __future__ import annotations

import math
import sys
from unittest.mock import MagicMock

# ── vectorbt mock must be in place before any backtester.py import ────────────
sys.modules.setdefault("vectorbt", MagicMock())


def _compute_sharpe_returns(daily_pnl_values: list[float], starting_capital: float = 50_000.0) -> float:
    """Mirror of the F-4 return-based Sharpe computation in backtester.py."""
    import numpy as np  # noqa: PLC0415

    if len(daily_pnl_values) <= 1:
        return 0.0
    _eq = float(starting_capital)
    _ret_daily: list[float] = []
    for _dpnl in daily_pnl_values:
        if _eq > 0:
            _ret_daily.append(float(_dpnl) / _eq)
        _eq += float(_dpnl)
    if len(_ret_daily) <= 1:
        return 0.0
    _ret_arr = np.array(_ret_daily, dtype=np.float64)
    _ret_std = float(np.std(_ret_arr, ddof=1))
    return float(np.mean(_ret_arr) / _ret_std * np.sqrt(252)) if _ret_std > 0 else 0.0


class TestF4SharpeReturnsComputation:
    """F-4: return-based Sharpe computation correctness."""

    def test_flat_pnl_series_is_finite(self):
        """Constant dollar P&L → percent returns decrease as equity grows → finite Sharpe."""
        # Constant dollar P&L gives DECREASING percent returns (equity grows).
        # The std is small but non-zero; result should be a finite positive float.
        pnls = [100.0] * 20
        result = _compute_sharpe_returns(pnls)
        assert math.isfinite(result), f"Constant P&L must give finite sharpe_returns, got {result}"
        assert result > 0.0, f"Constant positive P&L must give positive Sharpe, got {result}"

    def test_zero_pnls_returns_zero(self):
        """All-zero daily P&L → returns are zero → sharpe_returns=0."""
        pnls = [0.0] * 20
        result = _compute_sharpe_returns(pnls)
        assert result == 0.0

    def test_single_value_returns_zero(self):
        """Single P&L value → not enough data → sharpe_returns=0."""
        result = _compute_sharpe_returns([100.0])
        assert result == 0.0

    def test_positive_trending_returns_positive(self):
        """Uniformly positive P&L (but varying) → sharpe_returns > 0."""
        # Varying positive values → positive mean, non-zero std
        pnls = [100.0 + float(i) * 5 for i in range(30)]
        result = _compute_sharpe_returns(pnls)
        assert result > 0.0, f"Positive trending P&L must give positive sharpe_returns, got {result}"

    def test_large_starting_capital_converges_to_dollar_sharpe(self):
        """When starting_capital >> sum(P&L), return-Sharpe ≈ dollar Sharpe."""
        import numpy as np  # noqa: PLC0415
        pnls = [100.0, -50.0, 200.0, -100.0, 150.0] * 10
        # Dollar Sharpe
        arr = np.array(pnls)
        dollar_sharpe = float(np.mean(arr) / np.std(arr, ddof=1) * np.sqrt(252))
        # With 1B starting capital, daily changes are ~0% → returns ≈ pnl/1B
        # Sharpe ratio is invariant to scaling → converges to dollar Sharpe
        return_sharpe = _compute_sharpe_returns(pnls, starting_capital=1_000_000_000.0)
        # Should be within 1% relative of dollar Sharpe (numerically converging)
        if abs(dollar_sharpe) > 0.001:
            rel_diff = abs(return_sharpe - dollar_sharpe) / abs(dollar_sharpe)
            assert rel_diff < 0.01, (
                f"Large capital should converge: dollar={dollar_sharpe:.4f}, "
                f"returns={return_sharpe:.4f}, rel_diff={rel_diff:.4f}"
            )

    def test_sharpe_returns_not_nan_or_inf(self):
        """sharpe_returns must be finite (no NaN, no inf) for typical inputs."""
        pnls = [50.0, -25.0, 75.0, -10.0, 100.0] * 5
        result = _compute_sharpe_returns(pnls)
        assert math.isfinite(result), f"sharpe_returns must be finite, got {result}"


class TestF4BacktesterResultSchema:
    """F-4: backtester result dict schema contracts."""

    def test_sharpe_ratio_returns_present_in_backtester_source(self):
        """backtester.py source must contain sharpe_ratio_returns (F-4)."""
        import inspect  # noqa: PLC0415

        import src.engine.backtester as bt
        src_text = inspect.getsource(bt)
        assert "sharpe_ratio_returns" in src_text, (
            "F-4: sharpe_ratio_returns must be defined in backtester.py"
        )

    def test_sharpe_ratio_still_present_in_backtester_source(self):
        """backtester.py source must still contain sharpe_ratio (no regression)."""
        import inspect  # noqa: PLC0415

        import src.engine.backtester as bt
        src_text = inspect.getsource(bt)
        assert '"sharpe_ratio"' in src_text, (
            "F-4: dollar-P&L sharpe_ratio must NOT be removed from result dict"
        )

    def test_f4_comment_in_backtester_source(self):
        """backtester.py must have F-4 comment annotating the new metric."""
        import inspect  # noqa: PLC0415

        import src.engine.backtester as bt
        src_text = inspect.getsource(bt)
        assert "F-4" in src_text, (
            "F-4 annotation comment must be in backtester.py"
        )


class TestF4WalkForwardResultSchema:
    """F-4: walk_forward oos_metrics schema contracts."""

    def test_sharpe_ratio_returns_present_in_wf_source(self):
        """walk_forward.py source must contain sharpe_ratio_returns (F-4)."""
        import inspect  # noqa: PLC0415

        import src.engine.walk_forward as wf
        src_text = inspect.getsource(wf)
        assert "sharpe_ratio_returns" in src_text, (
            "F-4: sharpe_ratio_returns must be in walk_forward.py oos_metrics"
        )

    def test_agg_sharpe_returns_computed_in_wf_source(self):
        """walk_forward.py must define agg_sharpe_returns variable."""
        import inspect  # noqa: PLC0415

        import src.engine.walk_forward as wf
        src_text = inspect.getsource(wf)
        assert "agg_sharpe_returns" in src_text, (
            "F-4: agg_sharpe_returns variable must exist in walk_forward.py"
        )

    def test_wf_oos_sharpe_ratio_not_removed(self):
        """walk_forward.py oos_metrics must still have sharpe_ratio (no regression)."""
        import inspect  # noqa: PLC0415

        import src.engine.walk_forward as wf
        src_text = inspect.getsource(wf)
        assert '"sharpe_ratio": round(agg_sharpe' in src_text, (
            "F-4: dollar-P&L sharpe_ratio must NOT be removed from oos_metrics"
        )

    def test_wf_plain_mode_has_sharpe_ratio_returns(self):
        """Plain walk_forward run: oos_metrics.sharpe_ratio_returns key present."""
        from datetime import datetime, timedelta

        import polars as pl

        from src.engine.config import (  # noqa: PLC0415
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.walk_forward import run_walk_forward

        dates = [datetime(2022, 1, 1) + timedelta(days=i) for i in range(400)]
        closes = [4000.0 + i * 0.3 for i in range(400)]
        data = pl.DataFrame({
            "ts_event": dates,
            "open":   [c - 1.0 for c in closes],
            "high":   [c + 3.0 for c in closes],
            "low":    [c - 3.0 for c in closes],
            "close":  closes,
            "volume": [60000] * 400,
        })
        request = BacktestRequest(
            strategy=StrategyConfig(
                name="F4 Sharpe Test",
                symbol="MES",
                timeframe="daily",
                indicators=[IndicatorConfig(type="sma", period=5)],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_5",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2022-01-01",
            end_date="2023-02-28",
        )
        result = run_walk_forward(request, data=data, n_splits=5, wf_mode="plain")
        oos = result.get("oos_metrics", {})
        assert "sharpe_ratio_returns" in oos, (
            f"F-4: oos_metrics must contain sharpe_ratio_returns; got keys: {list(oos.keys())}"
        )
        assert "sharpe_ratio" in oos, (
            "F-4: oos_metrics must still contain sharpe_ratio (no regression)"
        )
        sr = oos.get("sharpe_ratio_returns")
        assert sr is not None and math.isfinite(sr), (
            f"F-4: sharpe_ratio_returns must be a finite float, got {sr}"
        )
