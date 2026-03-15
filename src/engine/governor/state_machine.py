"""
First-Loss Governor — 6-state behavioral state machine.
Controls strategy behavior after adverse events (losses, MAE spikes, etc.)

States:
  NORMAL -> ALERT -> CAUTIOUS -> DEFENSIVE -> LOCKOUT -> RECOVERY

Transitions based on:
  - Consecutive losses
  - Session P&L vs daily budget
  - MAE (Maximum Adverse Excursion) spikes
  - Recovery progress
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class GovernorState(str, Enum):
    NORMAL = "normal"
    ALERT = "alert"
    CAUTIOUS = "cautious"
    DEFENSIVE = "defensive"
    LOCKOUT = "lockout"
    RECOVERY = "recovery"


# State transition rules
TRANSITIONS = {
    "normal": {
        "to_alert": {"consecutive_losses": 2, "or_session_loss_pct": 0.30},
    },
    "alert": {
        "to_cautious": {"consecutive_losses": 3, "or_session_loss_pct": 0.50},
        "to_normal": {"consecutive_wins": 2, "or_session_profit": True},
    },
    "cautious": {
        "to_defensive": {"consecutive_losses": 4, "or_session_loss_pct": 0.65},
        "to_alert": {"consecutive_wins": 2},
    },
    "defensive": {
        "to_lockout": {"consecutive_losses": 5, "or_session_loss_pct": 0.80},
        "to_cautious": {"consecutive_wins": 3},
    },
    "lockout": {
        "to_recovery": {"session_ended": True},
    },
    "recovery": {
        "to_normal": {"profitable_sessions": 2},
        "to_lockout": {"loss_in_recovery": True},
    },
}

# Size multipliers per state
SIZE_MULTIPLIERS = {
    "normal": 1.0,
    "alert": 1.0,
    "cautious": 0.75,
    "defensive": 0.50,
    "lockout": 0.0,
    "recovery": 0.50,
}


class Governor:
    """
    Per-strategy governor instance.
    Tracks state and transitions based on trade outcomes.
    """

    def __init__(
        self,
        strategy_id: str,
        daily_loss_budget: float = 500.0,
        initial_state: str = "normal",
    ):
        self.strategy_id = strategy_id
        self.daily_loss_budget = daily_loss_budget
        self.state = GovernorState(initial_state)
        self.consecutive_losses = 0
        self.consecutive_wins = 0
        self.session_pnl = 0.0
        self.session_trades = 0
        self.profitable_sessions = 0
        self.history: list[dict] = []

    def on_trade(self, pnl: float, mae: float = 0.0) -> dict:
        """
        Process a trade result and potentially transition state.

        Returns:
            {
                "previous_state": str,
                "new_state": str,
                "changed": bool,
                "size_multiplier": float,
                "can_trade": bool,
                "reason": str,
            }
        """
        previous = self.state.value

        # Update counters
        self.session_pnl += pnl
        self.session_trades += 1

        if pnl < 0:
            self.consecutive_losses += 1
            self.consecutive_wins = 0
        else:
            self.consecutive_wins += 1
            self.consecutive_losses = 0

        session_loss_pct = self._session_loss_pct()

        # Evaluate transitions based on current state
        reason = "no_change"
        new_state = self.state

        if self.state == GovernorState.NORMAL:
            if (self.consecutive_losses >= 2 or session_loss_pct >= 0.30):
                new_state = GovernorState.ALERT
                reason = self._transition_reason("alert", session_loss_pct)

        elif self.state == GovernorState.ALERT:
            if (self.consecutive_losses >= 3 or session_loss_pct >= 0.50):
                new_state = GovernorState.CAUTIOUS
                reason = self._transition_reason("cautious", session_loss_pct)
            elif (self.consecutive_wins >= 2 or self.session_pnl > 0):
                new_state = GovernorState.NORMAL
                reason = "recovered_to_normal"

        elif self.state == GovernorState.CAUTIOUS:
            if (self.consecutive_losses >= 4 or session_loss_pct >= 0.65):
                new_state = GovernorState.DEFENSIVE
                reason = self._transition_reason("defensive", session_loss_pct)
            elif self.consecutive_wins >= 2:
                new_state = GovernorState.ALERT
                reason = "win_streak_recovery"

        elif self.state == GovernorState.DEFENSIVE:
            if (self.consecutive_losses >= 5 or session_loss_pct >= 0.80):
                new_state = GovernorState.LOCKOUT
                reason = self._transition_reason("lockout", session_loss_pct)
            elif self.consecutive_wins >= 3:
                new_state = GovernorState.CAUTIOUS
                reason = "win_streak_recovery"

        elif self.state == GovernorState.LOCKOUT:
            # No trade-based transitions from lockout — only session_end
            reason = "locked_out"

        elif self.state == GovernorState.RECOVERY:
            if pnl < 0:
                new_state = GovernorState.LOCKOUT
                reason = "loss_in_recovery"
                self.profitable_sessions = 0

        changed = new_state != self.state
        self.state = new_state

        result = {
            "previous_state": previous,
            "new_state": self.state.value,
            "changed": changed,
            "size_multiplier": SIZE_MULTIPLIERS[self.state.value],
            "can_trade": self.state != GovernorState.LOCKOUT,
            "reason": reason,
        }

        self.history.append(result)
        return result

    def on_session_end(self) -> dict:
        """End of session processing. May transition lockout -> recovery."""
        previous = self.state.value

        if self.state == GovernorState.LOCKOUT:
            self.state = GovernorState.RECOVERY
            self.profitable_sessions = 0
            reason = "session_ended_entering_recovery"
        elif self.state == GovernorState.RECOVERY:
            if self.session_pnl > 0:
                self.profitable_sessions += 1
                if self.profitable_sessions >= 2:
                    self.state = GovernorState.NORMAL
                    reason = f"recovery_complete_{self.profitable_sessions}_profitable_sessions"
                else:
                    reason = f"recovery_progress_{self.profitable_sessions}/2_sessions"
            else:
                self.state = GovernorState.LOCKOUT
                self.profitable_sessions = 0
                reason = "unprofitable_session_in_recovery"
        else:
            reason = "session_ended"

        result = {
            "previous_state": previous,
            "new_state": self.state.value,
            "changed": previous != self.state.value,
            "size_multiplier": SIZE_MULTIPLIERS[self.state.value],
            "can_trade": self.state != GovernorState.LOCKOUT,
            "reason": reason,
        }

        self.history.append(result)
        # Reset session counters for next session
        self.reset_session()
        return result

    def reset_session(self):
        """Reset session-level counters (called at start of new session)."""
        self.session_pnl = 0.0
        self.session_trades = 0
        self.consecutive_losses = 0
        self.consecutive_wins = 0

    def get_status(self) -> dict:
        """Current governor state summary."""
        return {
            "strategy_id": self.strategy_id,
            "state": self.state.value,
            "size_multiplier": SIZE_MULTIPLIERS[self.state.value],
            "can_trade": self.state != GovernorState.LOCKOUT,
            "consecutive_losses": self.consecutive_losses,
            "consecutive_wins": self.consecutive_wins,
            "session_pnl": round(self.session_pnl, 2),
            "session_trades": self.session_trades,
            "session_loss_pct": round(self._session_loss_pct(), 4),
            "daily_loss_budget": self.daily_loss_budget,
            "profitable_sessions": self.profitable_sessions,
            "transitions": len(self.history),
        }

    def _session_loss_pct(self) -> float:
        """Session loss as a percentage of daily budget."""
        if self.daily_loss_budget <= 0 or self.session_pnl >= 0:
            return 0.0
        return abs(self.session_pnl) / self.daily_loss_budget

    def _transition_reason(self, target: str, session_loss_pct: float) -> str:
        parts = []
        thresholds = {
            "alert": (2, 0.30),
            "cautious": (3, 0.50),
            "defensive": (4, 0.65),
            "lockout": (5, 0.80),
        }
        loss_thresh, pct_thresh = thresholds.get(target, (0, 0))
        if self.consecutive_losses >= loss_thresh:
            parts.append(f"{self.consecutive_losses}_consecutive_losses")
        if session_loss_pct >= pct_thresh:
            parts.append(f"session_loss_{session_loss_pct:.0%}_of_budget")
        return f"escalated_to_{target}:" + "+".join(parts) if parts else f"escalated_to_{target}"
