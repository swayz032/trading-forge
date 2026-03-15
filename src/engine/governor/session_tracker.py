"""Track session events for governor state machine."""

from __future__ import annotations

from typing import Any


class SessionTracker:
    """
    Tracks all events within a trading session for governor input.
    """

    def __init__(self, strategy_id: str, daily_budget: float = 500.0):
        self.strategy_id = strategy_id
        self.daily_budget = daily_budget
        self.trades: list[dict] = []
        self.session_pnl = 0.0
        self.max_session_loss = 0.0
        self.max_mae = 0.0

    def add_trade(
        self,
        pnl: float,
        mae: float = 0.0,
        entry_time: str = "",
        exit_time: str = "",
    ) -> dict:
        """Record a trade and return session summary."""
        self.trades.append({
            "pnl": pnl,
            "mae": mae,
            "entry_time": entry_time,
            "exit_time": exit_time,
        })

        self.session_pnl += pnl

        # Track worst session P&L point
        if self.session_pnl < self.max_session_loss:
            self.max_session_loss = self.session_pnl

        # Track worst MAE
        if mae > self.max_mae:
            self.max_mae = mae

        return self.get_session_summary()

    def get_session_summary(self) -> dict:
        """
        Returns:
            {
                "total_trades": int,
                "session_pnl": float,
                "loss_pct_of_budget": float,
                "consecutive_losses": int,
                "max_mae": float,
                "winning_trades": int,
                "losing_trades": int,
            }
        """
        winning = sum(1 for t in self.trades if t["pnl"] >= 0)
        losing = sum(1 for t in self.trades if t["pnl"] < 0)

        # Calculate current consecutive losses (from end of trade list)
        consec_losses = 0
        for t in reversed(self.trades):
            if t["pnl"] < 0:
                consec_losses += 1
            else:
                break

        loss_pct = 0.0
        if self.daily_budget > 0 and self.session_pnl < 0:
            loss_pct = abs(self.session_pnl) / self.daily_budget

        return {
            "total_trades": len(self.trades),
            "session_pnl": round(self.session_pnl, 2),
            "loss_pct_of_budget": round(loss_pct, 4),
            "consecutive_losses": consec_losses,
            "max_mae": round(self.max_mae, 2),
            "winning_trades": winning,
            "losing_trades": losing,
        }
