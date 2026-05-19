"""Tests for First-Loss Governor (Phase 4.15).

Tests:
- Governor starts in NORMAL state
- 2 consecutive losses -> ALERT
- 3 consecutive losses -> CAUTIOUS (size 0.75x)
- 5 consecutive losses -> LOCKOUT (size 0x)
- Win streak recovers from ALERT -> NORMAL
- Session end transitions LOCKOUT -> RECOVERY
- 2 profitable sessions in RECOVERY -> NORMAL
- Loss in RECOVERY -> back to LOCKOUT
- Trade filter blocks during LOCKOUT
- Trade filter reduces contracts during DEFENSIVE
- Governor backtest shows DD reduction
- Session tracker accumulates correctly
- Config profiles have correct thresholds
"""

import pytest

from src.engine.governor.state_machine import Governor, GovernorState, SIZE_MULTIPLIERS
from src.engine.governor.session_tracker import SessionTracker
from src.engine.governor.trade_filter import filter_trade
from src.engine.governor.governor_backtest import backtest_governor
from src.engine.governor.governor_config import (
    DEFAULT_CONFIG,
    AGGRESSIVE_CONFIG,
    CONSERVATIVE_CONFIG,
    get_config,
)


# ─── Governor State Machine Tests ────────────────────────────────


class TestGovernorStateMachine:
    def test_starts_in_normal_state(self):
        gov = Governor(strategy_id="test")
        assert gov.state == GovernorState.NORMAL
        status = gov.get_status()
        assert status["state"] == "normal"
        assert status["can_trade"] is True
        assert status["size_multiplier"] == 1.0

    def test_two_consecutive_losses_to_alert(self):
        gov = Governor(strategy_id="test")
        gov.on_trade(pnl=-100.0)
        assert gov.state == GovernorState.NORMAL  # 1 loss not enough
        result = gov.on_trade(pnl=-100.0)
        assert result["new_state"] == "alert"
        assert result["changed"] is True
        assert result["can_trade"] is True
        assert result["size_multiplier"] == 1.0  # Alert doesn't reduce size

    def test_three_consecutive_losses_to_cautious(self):
        gov = Governor(strategy_id="test")
        gov.on_trade(pnl=-100.0)
        gov.on_trade(pnl=-100.0)  # -> alert
        result = gov.on_trade(pnl=-100.0)  # -> cautious
        assert result["new_state"] == "cautious"
        assert result["size_multiplier"] == 0.75

    def test_five_consecutive_losses_to_lockout(self):
        gov = Governor(strategy_id="test")
        for _ in range(4):
            gov.on_trade(pnl=-100.0)
        assert gov.state == GovernorState.DEFENSIVE
        result = gov.on_trade(pnl=-100.0)  # 5th loss -> lockout
        assert result["new_state"] == "lockout"
        assert result["size_multiplier"] == 0.0
        assert result["can_trade"] is False

    def test_four_consecutive_losses_to_defensive(self):
        gov = Governor(strategy_id="test")
        for _ in range(3):
            gov.on_trade(pnl=-100.0)
        assert gov.state == GovernorState.CAUTIOUS
        result = gov.on_trade(pnl=-100.0)  # 4th loss -> defensive
        assert result["new_state"] == "defensive"
        assert result["size_multiplier"] == 0.50

    def test_win_streak_recovers_alert_to_normal(self):
        gov = Governor(strategy_id="test")
        gov.on_trade(pnl=-100.0)
        gov.on_trade(pnl=-100.0)  # -> alert
        assert gov.state == GovernorState.ALERT
        gov.on_trade(pnl=100.0)
        result = gov.on_trade(pnl=100.0)  # 2 wins -> normal
        assert result["new_state"] == "normal"

    def test_session_end_lockout_to_recovery(self):
        gov = Governor(strategy_id="test")
        for _ in range(5):
            gov.on_trade(pnl=-100.0)
        assert gov.state == GovernorState.LOCKOUT
        result = gov.on_session_end()
        assert result["new_state"] == "recovery"
        assert result["changed"] is True
        assert result["size_multiplier"] == 0.50

    def test_two_profitable_sessions_recovery_to_normal(self):
        gov = Governor(strategy_id="test", initial_state="recovery")
        # First profitable session
        gov.session_pnl = 200.0
        result1 = gov.on_session_end()
        assert result1["new_state"] == "recovery"
        assert gov.profitable_sessions == 1

        # Second profitable session
        gov.session_pnl = 150.0
        result2 = gov.on_session_end()
        assert result2["new_state"] == "normal"

    def test_loss_in_recovery_back_to_lockout(self):
        gov = Governor(strategy_id="test", initial_state="recovery")
        result = gov.on_trade(pnl=-100.0)
        assert result["new_state"] == "lockout"
        assert result["can_trade"] is False

    def test_session_loss_pct_triggers_alert(self):
        gov = Governor(strategy_id="test", daily_loss_budget=500.0)
        # Single big loss = 40% of budget -> should trigger alert
        result = gov.on_trade(pnl=-200.0)
        assert result["new_state"] == "alert"

    def test_get_status_fields(self):
        gov = Governor(strategy_id="test-strat", daily_loss_budget=750.0)
        gov.on_trade(pnl=-100.0)
        status = gov.get_status()
        assert status["strategy_id"] == "test-strat"
        assert status["daily_loss_budget"] == 750.0
        assert status["session_pnl"] == -100.0
        assert status["session_trades"] == 1

    def test_reset_session(self):
        gov = Governor(strategy_id="test")
        gov.on_trade(pnl=-100.0)
        gov.on_trade(pnl=-100.0)
        gov.reset_session()
        assert gov.session_pnl == 0.0
        assert gov.session_trades == 0
        # consecutive_losses persists across sessions for cross-session streak tracking
        assert gov.consecutive_losses == 2


# ─── Session Tracker Tests ───────────────────────────────────────


class TestSessionTracker:
    def test_accumulates_correctly(self):
        tracker = SessionTracker(strategy_id="test", daily_budget=500.0)
        summary = tracker.add_trade(pnl=100.0, mae=50.0)
        assert summary["total_trades"] == 1
        assert summary["session_pnl"] == 100.0
        assert summary["winning_trades"] == 1
        assert summary["losing_trades"] == 0

        summary = tracker.add_trade(pnl=-80.0, mae=120.0)
        assert summary["total_trades"] == 2
        assert summary["session_pnl"] == 20.0
        assert summary["winning_trades"] == 1
        assert summary["losing_trades"] == 1
        assert summary["max_mae"] == 120.0

    def test_consecutive_losses_tracking(self):
        tracker = SessionTracker(strategy_id="test")
        tracker.add_trade(pnl=100.0)
        tracker.add_trade(pnl=-50.0)
        tracker.add_trade(pnl=-60.0)
        summary = tracker.add_trade(pnl=-70.0)
        assert summary["consecutive_losses"] == 3

    def test_loss_pct_of_budget(self):
        tracker = SessionTracker(strategy_id="test", daily_budget=500.0)
        tracker.add_trade(pnl=-200.0)
        summary = tracker.get_session_summary()
        assert abs(summary["loss_pct_of_budget"] - 0.4) < 0.01

    def test_max_session_loss_tracked(self):
        tracker = SessionTracker(strategy_id="test")
        tracker.add_trade(pnl=-100.0)
        tracker.add_trade(pnl=-150.0)  # session at -250
        tracker.add_trade(pnl=200.0)   # session at -50
        assert tracker.max_session_loss == -250.0


# ─── Trade Filter Tests ─────────────────────────────────────────


class TestTradeFilter:
    def test_blocks_during_lockout(self):
        result = filter_trade(
            governor_state="lockout",
            size_multiplier=0.0,
            requested_contracts=4,
        )
        assert result["allowed"] is False
        assert result["adjusted_contracts"] == 0
        assert "lockout" in result["reason"]

    def test_reduces_contracts_during_defensive(self):
        result = filter_trade(
            governor_state="defensive",
            size_multiplier=0.50,
            requested_contracts=4,
        )
        assert result["allowed"] is True
        assert result["adjusted_contracts"] == 2
        assert result["original_contracts"] == 4

    def test_reduces_contracts_during_cautious(self):
        result = filter_trade(
            governor_state="cautious",
            size_multiplier=0.75,
            requested_contracts=4,
        )
        assert result["allowed"] is True
        assert result["adjusted_contracts"] == 3  # floor(4 * 0.75) = 3

    def test_full_size_during_normal(self):
        result = filter_trade(
            governor_state="normal",
            size_multiplier=1.0,
            requested_contracts=4,
        )
        assert result["allowed"] is True
        assert result["adjusted_contracts"] == 4

    def test_minimum_one_contract_when_allowed(self):
        result = filter_trade(
            governor_state="recovery",
            size_multiplier=0.50,
            requested_contracts=1,
        )
        assert result["allowed"] is True
        assert result["adjusted_contracts"] == 1  # min 1


# ─── Governor Backtest Tests ────────────────────────────────────


class TestGovernorBacktest:
    def test_backtest_shows_dd_reduction(self):
        """A series of losses followed by recovery — governor should reduce DD."""
        trades = []
        # 6 losing trades (enough to trigger lockout)
        for i in range(6):
            trades.append({
                "pnl": -100.0,
                "mae": 150.0,
                "contracts": 2,
                "entry_time": f"2025-01-01T{10+i}:00:00",
            })
        # 10 winning trades
        for i in range(10):
            trades.append({
                "pnl": 150.0,
                "mae": 30.0,
                "contracts": 2,
                "entry_time": f"2025-01-02T{10+i}:00:00",
            })

        result = backtest_governor(trades, daily_loss_budget=500.0)

        assert result["original"]["trades"] == 16
        assert result["original"]["max_dd"] > 0
        # Governor should have blocked or reduced some losing trades
        assert result["governed"]["trades_blocked"] > 0 or result["governed"]["trades_reduced"] > 0
        # Max DD should be reduced or equal (governor can't make it worse by blocking)
        assert result["governed"]["max_dd"] <= result["original"]["max_dd"]
        assert result["lockout_events"] >= 1

    def test_backtest_empty_trades(self):
        result = backtest_governor([])
        assert result["original"]["trades"] == 0
        assert result["governed"]["trades"] == 0
        assert result["lockout_events"] == 0

    def test_backtest_has_state_history(self):
        trades = [
            {"pnl": -100.0, "contracts": 1, "entry_time": "2025-01-01T10:00:00"},
            {"pnl": -100.0, "contracts": 1, "entry_time": "2025-01-01T11:00:00"},
            {"pnl": 200.0, "contracts": 1, "entry_time": "2025-01-01T12:00:00"},
        ]
        result = backtest_governor(trades)
        assert len(result["state_history"]) > 0


# ─── Config Tests ────────────────────────────────────────────────


class TestGovernorConfig:
    def test_default_config_thresholds(self):
        config = get_config("default")
        assert config["daily_loss_budget"] == 500.0
        assert config["consecutive_loss_threshold"]["alert"] == 2
        assert config["consecutive_loss_threshold"]["lockout"] == 5
        assert config["enabled"] is True

    def test_aggressive_config(self):
        config = get_config("aggressive")
        assert config["daily_loss_budget"] == 750.0
        assert config["consecutive_loss_threshold"]["alert"] == 3
        assert config["consecutive_loss_threshold"]["lockout"] == 6

    def test_conservative_config(self):
        config = get_config("conservative")
        assert config["daily_loss_budget"] == 300.0
        assert config["consecutive_loss_threshold"]["alert"] == 1
        assert config["consecutive_loss_threshold"]["lockout"] == 4

    def test_unknown_profile_returns_default(self):
        config = get_config("nonexistent")
        assert config == DEFAULT_CONFIG

    def test_session_loss_pct_thresholds(self):
        config = get_config("default")
        thresholds = config["session_loss_pct_threshold"]
        assert thresholds["alert"] == 0.30
        assert thresholds["cautious"] == 0.50
        assert thresholds["defensive"] == 0.65
        assert thresholds["lockout"] == 0.80

    def test_recovery_profitable_sessions(self):
        config = get_config("default")
        assert config["recovery_profitable_sessions"] == 2


# ─── Size Multiplier Tests ───────────────────────────────────────


class TestSizeMultipliers:
    def test_multiplier_values(self):
        assert SIZE_MULTIPLIERS["normal"] == 1.0
        assert SIZE_MULTIPLIERS["alert"] == 1.0
        assert SIZE_MULTIPLIERS["cautious"] == 0.75
        assert SIZE_MULTIPLIERS["defensive"] == 0.50
        assert SIZE_MULTIPLIERS["lockout"] == 0.0
        assert SIZE_MULTIPLIERS["recovery"] == 0.50
