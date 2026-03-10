"""Tests for performance gates + Forge Score — TDD."""

import pytest

from src.engine.performance_gate import (
    check_performance_gate,
    classify_tier,
    compute_forge_score,
)


# ─── Helpers ───────────────────────────────────────────────────────

def _tier1_stats():
    """Stats that should pass TIER_1."""
    return {
        "avg_daily_pnl": 600.0,
        "winning_days": 15,
        "total_trading_days": 20,
        "worst_month_win_days": 13,
        "profit_factor": 3.0,
        "sharpe_ratio": 2.5,
        "avg_winner_to_loser_ratio": 2.0,
        "max_drawdown": 1200.0,
        "max_consecutive_losing_days": 2,
        "avg_loss_on_red_days": -200.0,
        "avg_win_on_green_days": 400.0,
    }


def _tier3_stats():
    """Stats that should pass TIER_3 but not TIER_2."""
    return {
        "avg_daily_pnl": 280.0,
        "winning_days": 12,
        "total_trading_days": 20,
        "worst_month_win_days": 11,
        "profit_factor": 1.80,
        "sharpe_ratio": 1.6,
        "avg_winner_to_loser_ratio": 1.6,
        "max_drawdown": 2200.0,
        "max_consecutive_losing_days": 3,
        "avg_loss_on_red_days": -300.0,
        "avg_win_on_green_days": 400.0,
    }


def _failing_stats():
    """Stats that should be REJECTED."""
    return {
        "avg_daily_pnl": 150.0,
        "winning_days": 10,
        "total_trading_days": 20,
        "worst_month_win_days": 8,
        "profit_factor": 1.3,
        "sharpe_ratio": 1.0,
        "avg_winner_to_loser_ratio": 1.2,
        "max_drawdown": 3000.0,
        "max_consecutive_losing_days": 6,
        "avg_loss_on_red_days": -500.0,
        "avg_win_on_green_days": 300.0,
    }


# ─── Performance Gate ─────────────────────────────────────────────

class TestPerformanceGate:
    def test_tier1_passes(self):
        passed, rejections = check_performance_gate(_tier1_stats())
        assert passed is True
        assert len(rejections) == 0

    def test_tier3_passes(self):
        passed, rejections = check_performance_gate(_tier3_stats())
        assert passed is True

    def test_failing_stats_rejected(self):
        passed, rejections = check_performance_gate(_failing_stats())
        assert passed is False
        assert len(rejections) > 0

    def test_low_daily_pnl_rejected(self):
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 200.0
        passed, rejections = check_performance_gate(stats)
        assert passed is False
        assert any("avg_daily_pnl" in r for r in rejections)

    def test_high_drawdown_rejected(self):
        stats = _tier1_stats()
        stats["max_drawdown"] = 2600.0
        passed, rejections = check_performance_gate(stats)
        assert passed is False
        assert any("drawdown" in r.lower() for r in rejections)

    def test_low_win_rate_rejected(self):
        stats = _tier1_stats()
        stats["winning_days"] = 11
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_too_many_consecutive_losers_rejected(self):
        stats = _tier1_stats()
        stats["max_consecutive_losing_days"] = 5
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_low_profit_factor_rejected(self):
        stats = _tier1_stats()
        stats["profit_factor"] = 1.5
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_low_sharpe_rejected(self):
        stats = _tier1_stats()
        stats["sharpe_ratio"] = 1.2
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_losers_bigger_than_winners_rejected(self):
        stats = _tier1_stats()
        stats["avg_loss_on_red_days"] = -500.0
        stats["avg_win_on_green_days"] = 300.0
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_worst_month_too_few_wins(self):
        stats = _tier1_stats()
        stats["worst_month_win_days"] = 9
        passed, rejections = check_performance_gate(stats)
        assert passed is False


# ─── Tier Classification ──────────────────────────────────────────

class TestClassifyTier:
    def test_tier1(self):
        assert classify_tier(_tier1_stats()) == "TIER_1"

    def test_tier3(self):
        assert classify_tier(_tier3_stats()) == "TIER_3"

    def test_rejected(self):
        assert classify_tier(_failing_stats()) == "REJECTED"

    def test_tier2(self):
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 400.0
        stats["winning_days"] = 13
        stats["max_drawdown"] = 1800.0
        stats["profit_factor"] = 2.2
        stats["sharpe_ratio"] = 1.8
        assert classify_tier(stats) == "TIER_2"

    def test_boundary_tier1_pnl(self):
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 500.0  # Exactly at boundary
        assert classify_tier(stats) == "TIER_1"

    def test_boundary_tier3_pnl(self):
        stats = _tier3_stats()
        stats["avg_daily_pnl"] = 250.0  # Exactly at boundary
        assert classify_tier(stats) == "TIER_3"


# ─── Forge Score ───────────────────────────────────────────────────

class TestForgeScore:
    def test_score_range(self):
        score = compute_forge_score(_tier1_stats())
        assert 0 <= score <= 100

    def test_tier1_scores_high(self):
        score = compute_forge_score(_tier1_stats())
        assert score >= 70  # TIER_1 should score well

    def test_failing_scores_low(self):
        score = compute_forge_score(_failing_stats())
        assert score < 50

    def test_score_components_sum(self):
        """Score is earnings(30) + survival(25) + drawdown(20) + consistency(25)."""
        score = compute_forge_score(_tier1_stats())
        assert isinstance(score, float)

    def test_higher_pnl_higher_score(self):
        stats_low = _tier3_stats()
        stats_high = _tier1_stats()
        score_low = compute_forge_score(stats_low)
        score_high = compute_forge_score(stats_high)
        assert score_high > score_low
