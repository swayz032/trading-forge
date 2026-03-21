"""End-to-end backtest smoke test.

Tests the full pipeline: data → indicators → signals → backtest →
performance gate → prop compliance — all on synthetic data.
"""

import json
from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.backtester import run_backtest
from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)
from src.engine.performance_gate import check_performance_gate, classify_tier, compute_forge_score
from src.engine.prop_compliance import run_prop_compliance


def _make_trending_data(n: int = 200) -> pl.DataFrame:
    """Create synthetic trending data for E2E test."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    # Uptrend with mean-reversion noise
    closes = [4000.0 + i * 0.5 + (i % 7) * 3 - 10 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 2.0 for c in closes],
        "high":   [c + 5.0 for c in closes],
        "low":    [c - 5.0 for c in closes],
        "close":  closes,
        "volume": [50000] * n,
    })


class TestE2EBacktest:
    """Full pipeline integration test."""

    def _make_request(self) -> BacktestRequest:
        return BacktestRequest(
            strategy=StrategyConfig(
                name="SMA Cross E2E",
                symbol="ES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=10),
                    IndicatorConfig(type="sma", period=30),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_10",
                entry_short="close crosses_below sma_10",
                exit="close crosses_below sma_30",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(
                    type="dynamic_atr", target_risk_dollars=500
                ),
            ),
            start_date="2023-01-01",
            end_date="2023-06-30",
            commission_per_side=4.50,
        )

    def test_full_pipeline_runs(self):
        """Backtest produces all required output fields."""
        data = _make_trending_data(200)
        request = self._make_request()
        result = run_backtest(request, data=data)

        # Required fields
        assert "total_return" in result
        assert "sharpe_ratio" in result
        assert "max_drawdown" in result
        assert "win_rate" in result
        assert "profit_factor" in result
        assert "total_trades" in result
        assert "equity_curve" in result
        assert "trades" in result
        assert "daily_pnls" in result
        assert "execution_time_ms" in result

    def test_output_is_json_serializable(self):
        """Output must be JSON-serializable for Node bridge."""
        data = _make_trending_data(200)
        request = self._make_request()
        result = run_backtest(request, data=data)

        json_str = json.dumps(result)
        parsed = json.loads(json_str)
        assert parsed["total_trades"] == result["total_trades"]
        assert len(parsed["equity_curve"]) == len(result["equity_curve"])

    def test_performance_gate_runs(self):
        """Performance gate processes backtest results."""
        data = _make_trending_data(200)
        request = self._make_request()
        result = run_backtest(request, data=data)

        # Build stats for gate check
        stats = {
            "avg_daily_pnl": result["avg_daily_pnl"],
            "winning_days": result["winning_days"],
            "total_trading_days": max(result["total_trading_days"], 1),
            "worst_month_win_days": result["winning_days"],  # Simplified
            "profit_factor": result["profit_factor"],
            "sharpe_ratio": result["sharpe_ratio"],
            "avg_winner_to_loser_ratio": result["avg_winner_to_loser_ratio"],
            "max_drawdown": abs(result["max_drawdown"]) * 50000,  # Convert from fraction (50K account)
            "max_consecutive_losing_days": result["max_consecutive_losing_days"],
            "avg_loss_on_red_days": -100,
            "avg_win_on_green_days": 200,
        }

        passed, rejections = check_performance_gate(stats)
        tier = classify_tier(stats)
        score = compute_forge_score(stats)

        # These should return valid results regardless of pass/fail
        assert isinstance(passed, bool)
        assert isinstance(rejections, list)
        assert tier in ("TIER_1", "TIER_2", "TIER_3", "REJECTED")
        assert 0 <= score <= 100

    def test_prop_compliance_runs(self):
        """Prop compliance processes daily P&Ls."""
        data = _make_trending_data(200)
        request = self._make_request()
        result = run_backtest(request, data=data)

        daily_pnls = result["daily_pnls"]
        if not daily_pnls:
            daily_pnls = [0.0]  # Ensure non-empty

        stats = {
            "avg_daily_pnl": result["avg_daily_pnl"],
            "max_drawdown": abs(result["max_drawdown"]) * 50000,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }

        compliance = run_prop_compliance(daily_pnls, stats)

        # Must have all 7 firms
        assert len(compliance) == 7
        for firm, details in compliance.items():
            assert "passed" in details
            assert "expected_eval_cost" in details
            assert "payout_split" in details

    def test_equity_curve_starts_at_init_cash(self):
        """Equity curve should start near initial cash ($50K)."""
        data = _make_trending_data(200)
        request = self._make_request()
        result = run_backtest(request, data=data)

        if result["equity_curve"]:
            assert result["equity_curve"][0]["value"] == pytest.approx(50000.0, rel=0.01)

    def test_daily_pnls_match_equity(self):
        """Daily P&Ls should approximately match equity curve diffs."""
        data = _make_trending_data(200)
        request = self._make_request()
        result = run_backtest(request, data=data)

        equity = result["equity_curve"]
        pnls = result["daily_pnls"]

        if len(equity) > 1 and len(pnls) > 0:
            # First PnL should match equity[1]["value"] - equity[0]["value"]
            assert pnls[0] == pytest.approx(equity[1]["value"] - equity[0]["value"], abs=0.01)

    def test_walk_forward_mode(self):
        """Walk-forward mode returns OOS metrics."""
        from src.engine.walk_forward import run_walk_forward

        data = _make_trending_data(1000)
        request = self._make_request()
        result = run_walk_forward(request, data=data, n_splits=3)

        assert "oos_metrics" in result
        assert "windows" in result
        assert len(result["windows"]) == 3
        assert "total_return" in result["oos_metrics"]
        assert "sharpe_ratio" in result["oos_metrics"]
