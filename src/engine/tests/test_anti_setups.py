"""Tests for Anti-Setup Filters (Phase 4.14).

Tests:
- Miner finds time-of-day anti-setup from clustered losing trades
- Miner finds volatility anti-setup (high ATR -> losses)
- Miner respects min_sample_size threshold
- Miner respects min_failure_rate threshold
- Filter gate blocks trade matching anti-setup
- Filter gate allows trade not matching anti-setup
- Condition analyzer clusters losing trades correctly
- Backtest shows P&L improvement from filtering
- Empty trades list returns no anti-setups
"""

import pytest

from src.engine.anti_setups.miner import mine_anti_setups
from src.engine.anti_setups.filter_gate import should_filter
from src.engine.anti_setups.condition_analyzer import cluster_losing_conditions
from src.engine.anti_setups.anti_setup_backtest import backtest_with_filters


# ─── Fixtures ────────────────────────────────────────────────────


@pytest.fixture
def clustered_losing_trades():
    """Trades where 14:00-15:59 entries lose heavily."""
    trades = []
    # 30 losing trades at 14:xx-15:xx
    for i in range(30):
        trades.append({
            "entry_time": f"2025-01-{(i % 28) + 1:02d}T14:30:00",
            "exit_time": f"2025-01-{(i % 28) + 1:02d}T15:30:00",
            "pnl": -200.0 - (i * 5),
            "direction": "long",
            "entry_price": 5000.0,
        })
    # 10 winning trades at 14:xx-15:xx (so 30/40 = 75% failure)
    for i in range(10):
        trades.append({
            "entry_time": f"2025-02-{(i % 28) + 1:02d}T14:45:00",
            "exit_time": f"2025-02-{(i % 28) + 1:02d}T15:45:00",
            "pnl": 150.0,
            "direction": "long",
            "entry_price": 5000.0,
        })
    # 25 trades at other times (mixed results, below failure threshold)
    for i in range(25):
        trades.append({
            "entry_time": f"2025-01-{(i % 28) + 1:02d}T10:00:00",
            "exit_time": f"2025-01-{(i % 28) + 1:02d}T11:00:00",
            "pnl": 100.0 if i % 2 == 0 else -50.0,
            "direction": "long",
            "entry_price": 5000.0,
        })
    return trades


@pytest.fixture
def high_atr_losing_trades():
    """Trades where high ATR entries lose disproportionately."""
    trades = []
    # 25 trades with high ATR (will be > 2x of mean), mostly losers
    for i in range(25):
        trades.append({
            "entry_time": f"2025-01-{(i % 28) + 1:02d}T10:00:00",
            "pnl": -300.0 if i < 18 else 100.0,  # 18/25 = 72% fail
            "atr": 25.0 + i * 0.5,  # ATR 25-37: well above 2x of mean ~13
        })
    # 50 trades with normal ATR, mixed results (pushes mean down)
    for i in range(50):
        trades.append({
            "entry_time": f"2025-02-{(i % 28) + 1:02d}T10:00:00",
            "pnl": 100.0 if i % 2 == 0 else -80.0,
            "atr": 5.0 + (i % 5) * 0.5,  # ATR 5-7: low
        })
    return trades


@pytest.fixture
def sample_anti_setups():
    """Pre-mined anti-setups for filter testing."""
    return [
        {
            "condition": "time_of_day",
            "filter": {"hour_start": 14, "hour_end": 16},
            "failure_rate": 0.75,
            "sample_size": 40,
            "avg_loss": -250.0,
            "confidence": 0.85,
            "impact_if_filtered": {"pnl_improvement": 4500.0, "trades_removed": 40},
        },
        {
            "condition": "regime",
            "filter": {"regime": "RANGE"},
            "failure_rate": 0.70,
            "sample_size": 30,
            "avg_loss": -180.0,
            "confidence": 0.82,
            "impact_if_filtered": {"pnl_improvement": 3200.0, "trades_removed": 30},
        },
    ]


# ─── Miner Tests ─────────────────────────────────────────────────


class TestAntiSetupMiner:
    def test_finds_time_of_day_anti_setup(self, clustered_losing_trades):
        results = mine_anti_setups(
            clustered_losing_trades, bars=[], min_sample_size=20, min_failure_rate=0.65,
        )
        time_setups = [r for r in results if r["condition"] == "time_of_day"]
        assert len(time_setups) >= 1
        best = time_setups[0]
        assert best["failure_rate"] >= 0.65
        assert best["sample_size"] >= 20
        assert best["filter"]["hour_start"] == 14

    def test_finds_volatility_anti_setup(self, high_atr_losing_trades):
        results = mine_anti_setups(
            high_atr_losing_trades, bars=[], min_sample_size=20, min_failure_rate=0.65,
        )
        vol_setups = [r for r in results if r["condition"] == "volatility"]
        assert len(vol_setups) >= 1
        best = vol_setups[0]
        assert best["failure_rate"] >= 0.65
        assert best["sample_size"] >= 20

    def test_respects_min_sample_size(self, clustered_losing_trades):
        # Set sample size so high nothing qualifies
        results = mine_anti_setups(
            clustered_losing_trades, bars=[], min_sample_size=500, min_failure_rate=0.50,
        )
        assert len(results) == 0

    def test_respects_min_failure_rate(self, clustered_losing_trades):
        # Set failure rate so high nothing qualifies
        results = mine_anti_setups(
            clustered_losing_trades, bars=[], min_sample_size=5, min_failure_rate=0.99,
        )
        assert len(results) == 0

    def test_empty_trades_returns_no_anti_setups(self):
        results = mine_anti_setups([], bars=[])
        assert results == []

    def test_results_sorted_by_failure_rate(self, clustered_losing_trades):
        results = mine_anti_setups(
            clustered_losing_trades, bars=[], min_sample_size=5, min_failure_rate=0.50,
        )
        if len(results) >= 2:
            for i in range(len(results) - 1):
                assert results[i]["failure_rate"] >= results[i + 1]["failure_rate"]

    def test_anti_setup_has_required_fields(self, clustered_losing_trades):
        results = mine_anti_setups(
            clustered_losing_trades, bars=[], min_sample_size=20, min_failure_rate=0.65,
        )
        for r in results:
            assert "condition" in r
            assert "filter" in r
            assert "failure_rate" in r
            assert "sample_size" in r
            assert "avg_loss" in r
            assert "confidence" in r
            assert "impact_if_filtered" in r


# ─── Filter Gate Tests ───────────────────────────────────────────


class TestFilterGate:
    def test_blocks_trade_matching_anti_setup(self, sample_anti_setups):
        context = {"hour": 14, "time": "2025-01-15T14:30:00"}
        result = should_filter(context, sample_anti_setups, confidence_threshold=0.80)
        assert result["filter"] is True
        assert len(result["matched_conditions"]) >= 1
        assert result["strongest_match"] is not None
        assert result["confidence"] > 0

    def test_allows_trade_not_matching_anti_setup(self, sample_anti_setups):
        context = {"hour": 10, "time": "2025-01-15T10:30:00", "regime": "TREND"}
        result = should_filter(context, sample_anti_setups, confidence_threshold=0.80)
        assert result["filter"] is False
        assert len(result["matched_conditions"]) == 0
        assert result["strongest_match"] is None

    def test_respects_confidence_threshold(self, sample_anti_setups):
        context = {"hour": 14}
        # Very high threshold — should not match even though condition matches
        result = should_filter(context, sample_anti_setups, confidence_threshold=0.99)
        assert result["filter"] is False

    def test_matches_regime_condition(self, sample_anti_setups):
        context = {"hour": 10, "regime": "RANGE"}
        result = should_filter(context, sample_anti_setups, confidence_threshold=0.80)
        assert result["filter"] is True
        assert any(m["condition"] == "regime" for m in result["matched_conditions"])

    def test_empty_anti_setups(self):
        context = {"hour": 14}
        result = should_filter(context, [], confidence_threshold=0.80)
        assert result["filter"] is False


# ─── Condition Analyzer Tests ────────────────────────────────────


class TestConditionAnalyzer:
    def test_clusters_losing_trades(self):
        losing_trades = [
            {"pnl": -100, "hour": 14, "regime": "RANGE"},
            {"pnl": -150, "hour": 14, "regime": "RANGE"},
            {"pnl": -200, "hour": 15, "regime": "TREND"},
            {"pnl": -120, "hour": 10, "regime": "RANGE"},
            {"pnl": -180, "hour": 14, "regime": "RANGE"},
            {"pnl": -90, "hour": 10, "regime": "TREND"},
        ]
        clusters = cluster_losing_conditions(losing_trades, context_features=["regime"])
        assert len(clusters) > 0
        # RANGE should have more trades
        range_clusters = [c for c in clusters if c["bin"] == "RANGE"]
        assert len(range_clusters) == 1
        assert range_clusters[0]["count"] == 4

    def test_clusters_numeric_features(self):
        losing_trades = [
            {"pnl": -100, "hour": 9},
            {"pnl": -150, "hour": 10},
            {"pnl": -200, "hour": 14},
            {"pnl": -120, "hour": 15},
            {"pnl": -180, "hour": 16},
            {"pnl": -90, "hour": 11},
        ]
        clusters = cluster_losing_conditions(losing_trades, context_features=["hour"])
        assert len(clusters) > 0
        # Should have low/medium/high bins
        bins = {c["bin"] for c in clusters}
        assert "low" in bins or "medium" in bins or "high" in bins

    def test_empty_trades(self):
        clusters = cluster_losing_conditions([])
        assert clusters == []


# ─── Backtest Tests ──────────────────────────────────────────────


class TestAntiSetupBacktest:
    def test_backtest_shows_improvement(self, sample_anti_setups):
        # Create trades: some match anti-setups (losers), some don't (winners)
        trades = []
        for i in range(20):
            trades.append({
                "entry_time": f"2025-01-{(i % 28) + 1:02d}T14:30:00",
                "pnl": -200.0,
                "hour": 14,
            })
        for i in range(30):
            trades.append({
                "entry_time": f"2025-01-{(i % 28) + 1:02d}T10:30:00",
                "pnl": 150.0,
                "hour": 10,
            })

        result = backtest_with_filters(trades, sample_anti_setups, confidence_threshold=0.80)

        assert result["original"]["trades"] == 50
        assert result["filtered"]["trades"] < 50
        assert result["improvement"]["trades_removed"] > 0
        # Filtering losers should improve P&L
        assert result["filtered"]["pnl"] > result["original"]["pnl"]
        assert result["improvement"]["pnl_delta"] > 0

    def test_backtest_empty_trades(self):
        result = backtest_with_filters([], [])
        assert result["original"]["trades"] == 0
        assert result["filtered"]["trades"] == 0
        assert result["improvement"]["pnl_delta"] == 0.0

    def test_backtest_has_filter_breakdown(self, sample_anti_setups):
        trades = [
            {"entry_time": "2025-01-01T14:30:00", "pnl": -200.0, "hour": 14},
            {"entry_time": "2025-01-02T14:30:00", "pnl": -150.0, "hour": 14},
            {"entry_time": "2025-01-03T10:30:00", "pnl": 100.0, "hour": 10},
        ]
        result = backtest_with_filters(trades, sample_anti_setups, confidence_threshold=0.80)
        assert "filter_breakdown" in result
        assert isinstance(result["filter_breakdown"], list)

    def test_backtest_win_rate_improves(self, sample_anti_setups):
        trades = []
        # 20 losers in anti-setup window
        for i in range(20):
            trades.append({"pnl": -200.0, "hour": 14})
        # 30 winners outside anti-setup window
        for i in range(30):
            trades.append({"pnl": 150.0, "hour": 10})

        result = backtest_with_filters(trades, sample_anti_setups, confidence_threshold=0.80)
        assert result["filtered"]["win_rate"] >= result["original"]["win_rate"]
