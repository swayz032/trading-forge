"""Real-time session monitoring — tracks intra-session signals for mid-day adjustments."""

from __future__ import annotations

from typing import Any


class SessionMonitor:
    """
    Tracks session state and can upgrade TRADE->REDUCE or REDUCE->SKIP mid-session.
    NOT for pre-session use — this is real-time during trading hours.
    """

    DECISION_LEVELS = {"TRADE": 0, "REDUCE": 1, "SKIP": 2}
    DECISION_NAMES = {0: "TRADE", 1: "REDUCE", 2: "SKIP"}

    def __init__(
        self,
        initial_decision: str,
        strategy_id: str,
        daily_budget: float = 2000.0,
    ):
        self.decision = initial_decision
        self.strategy_id = strategy_id
        self.daily_budget = daily_budget
        self.session_pnl = 0.0
        self.trades_taken = 0
        self.max_adverse = 0.0
        self._consecutive_session_losers = 0
        self._trade_pnls: list[float] = []

    def _escalate(self) -> None:
        """Escalate decision one level (TRADE->REDUCE or REDUCE->SKIP)."""
        current_level = self.DECISION_LEVELS.get(self.decision, 0)
        new_level = min(current_level + 1, 2)
        self.decision = self.DECISION_NAMES[new_level]

    def update(self, trade_pnl: float, current_dd: float = 0.0) -> dict[str, Any]:
        """
        Update session state after a trade. May escalate decision.

        Rules:
        - If session loss > 50% of daily budget -> escalate to REDUCE
        - If session loss > 75% of daily budget -> escalate to SKIP (stop trading)
        - If 3 consecutive intra-session losers -> escalate one level

        Args:
            trade_pnl: P&L of the completed trade.
            current_dd: Current drawdown (absolute value).

        Returns:
            {
                "decision": current decision after update,
                "escalated": bool,
                "reason": str or None,
                "session_pnl": float,
                "trades_taken": int,
            }
        """
        previous_decision = self.decision

        self.session_pnl += trade_pnl
        self.trades_taken += 1
        self._trade_pnls.append(trade_pnl)

        # Track max adverse excursion
        if self.session_pnl < self.max_adverse:
            self.max_adverse = self.session_pnl

        # Track consecutive session losers
        if trade_pnl < 0:
            self._consecutive_session_losers += 1
        else:
            self._consecutive_session_losers = 0

        escalation_reason = None

        # Check session loss thresholds
        if self.daily_budget > 0 and self.session_pnl < 0:
            loss_ratio = abs(self.session_pnl) / self.daily_budget

            if loss_ratio > 0.75:
                # Force SKIP
                if self.DECISION_LEVELS.get(self.decision, 0) < 2:
                    self.decision = "SKIP"
                    escalation_reason = (
                        f"session loss {abs(self.session_pnl):.0f} > 75% "
                        f"of daily budget {self.daily_budget:.0f}"
                    )
            elif loss_ratio > 0.50:
                # At least REDUCE
                if self.DECISION_LEVELS.get(self.decision, 0) < 1:
                    self.decision = "REDUCE"
                    escalation_reason = (
                        f"session loss {abs(self.session_pnl):.0f} > 50% "
                        f"of daily budget {self.daily_budget:.0f}"
                    )

        # Check consecutive losers
        if self._consecutive_session_losers >= 3 and escalation_reason is None:
            old_level = self.DECISION_LEVELS.get(self.decision, 0)
            self._escalate()
            if self.DECISION_LEVELS.get(self.decision, 0) > old_level:
                escalation_reason = (
                    f"{self._consecutive_session_losers} consecutive "
                    f"intra-session losers"
                )

        escalated = self.decision != previous_decision

        return {
            "decision": self.decision,
            "escalated": escalated,
            "reason": escalation_reason,
            "session_pnl": round(self.session_pnl, 2),
            "trades_taken": self.trades_taken,
        }

    def get_status(self) -> dict[str, Any]:
        """Return current session monitor state."""
        return {
            "decision": self.decision,
            "strategy_id": self.strategy_id,
            "session_pnl": round(self.session_pnl, 2),
            "trades_taken": self.trades_taken,
            "max_adverse": round(self.max_adverse, 2),
            "consecutive_session_losers": self._consecutive_session_losers,
            "daily_budget": self.daily_budget,
            "trade_pnls": [round(p, 2) for p in self._trade_pnls],
        }
