"""Backtest P&L with vs without governor intervention."""

from __future__ import annotations

from typing import Any

from .state_machine import Governor, SIZE_MULTIPLIERS
from .trade_filter import filter_trade


def backtest_governor(
    trades: list[dict],
    daily_loss_budget: float = 500.0,
) -> dict:
    """
    Replay trades with governor active and compare to ungoverned P&L.

    Returns:
        {
            "original": {"pnl": float, "max_dd": float, "trades": int},
            "governed": {"pnl": float, "max_dd": float, "trades": int,
                         "trades_blocked": int, "trades_reduced": int},
            "improvement": {
                "pnl_delta": float,
                "dd_reduction": float,
                "dd_reduction_pct": float,
            },
            "state_history": [...],
            "lockout_events": int,
        }
    """
    if not trades:
        empty = {"pnl": 0.0, "max_dd": 0.0, "trades": 0}
        return {
            "original": empty,
            "governed": {**empty, "trades_blocked": 0, "trades_reduced": 0},
            "improvement": {"pnl_delta": 0.0, "dd_reduction": 0.0, "dd_reduction_pct": 0.0},
            "state_history": [],
            "lockout_events": 0,
        }

    gov = Governor(strategy_id="backtest", daily_loss_budget=daily_loss_budget)

    # Original stats
    original_pnl = 0.0
    original_peak = 0.0
    original_max_dd = 0.0

    for t in trades:
        original_pnl += t.get("pnl", 0)
        original_peak = max(original_peak, original_pnl)
        dd = original_peak - original_pnl
        original_max_dd = max(original_max_dd, dd)

    # Governed replay
    governed_pnl = 0.0
    governed_peak = 0.0
    governed_max_dd = 0.0
    trades_blocked = 0
    trades_reduced = 0
    trades_taken = 0
    state_history: list[dict] = []
    lockout_events = 0

    current_session: str | None = None

    for t in trades:
        pnl = t.get("pnl", 0)
        mae = t.get("mae", 0.0)
        contracts = t.get("contracts", 1)

        # Detect session boundary (by date if available)
        session = _get_session(t)
        if current_session is not None and session != current_session:
            result = gov.on_session_end()
            state_history.append({
                "event": "session_end",
                "session": current_session,
                **result,
            })
        current_session = session

        # Check if governor allows this trade
        filtered = filter_trade(
            governor_state=gov.state.value,
            size_multiplier=SIZE_MULTIPLIERS[gov.state.value],
            requested_contracts=contracts,
        )

        if not filtered["allowed"]:
            trades_blocked += 1
            # Still process the trade outcome for governor state tracking
            # (governor sees the loss it would have taken)
            gov.on_trade(pnl, mae)
            state_history.append({
                "event": "trade_blocked",
                "pnl_avoided": pnl,
                "state": gov.state.value,
            })
            if gov.state.value == "lockout":
                lockout_events += 1
            continue

        # Adjust P&L proportionally to contract reduction
        if filtered["adjusted_contracts"] < contracts and contracts > 0:
            trades_reduced += 1
            adj_ratio = filtered["adjusted_contracts"] / contracts
            adj_pnl = pnl * adj_ratio
        else:
            adj_pnl = pnl

        governed_pnl += adj_pnl
        governed_peak = max(governed_peak, governed_pnl)
        dd = governed_peak - governed_pnl
        governed_max_dd = max(governed_max_dd, dd)
        trades_taken += 1

        # Feed actual (unadjusted) outcome to governor for state tracking
        result = gov.on_trade(pnl, mae)
        state_history.append({
            "event": "trade",
            "original_pnl": pnl,
            "adjusted_pnl": round(adj_pnl, 2),
            **result,
        })

        if gov.state.value == "lockout":
            lockout_events += 1

    # Final session end
    if current_session is not None:
        result = gov.on_session_end()
        state_history.append({"event": "session_end", "session": current_session, **result})

    dd_reduction = original_max_dd - governed_max_dd
    dd_reduction_pct = (dd_reduction / original_max_dd * 100) if original_max_dd > 0 else 0.0

    return {
        "original": {
            "pnl": round(original_pnl, 2),
            "max_dd": round(original_max_dd, 2),
            "trades": len(trades),
        },
        "governed": {
            "pnl": round(governed_pnl, 2),
            "max_dd": round(governed_max_dd, 2),
            "trades": trades_taken,
            "trades_blocked": trades_blocked,
            "trades_reduced": trades_reduced,
        },
        "improvement": {
            "pnl_delta": round(governed_pnl - original_pnl, 2),
            "dd_reduction": round(dd_reduction, 2),
            "dd_reduction_pct": round(dd_reduction_pct, 2),
        },
        "state_history": state_history,
        "lockout_events": lockout_events,
    }


def _get_session(trade: dict) -> str:
    """Extract session identifier (date) from trade."""
    entry_time = trade.get("entry_time", "")
    if entry_time:
        dt_str = str(entry_time)
        # Extract date portion
        if "T" in dt_str:
            return dt_str.split("T")[0]
        if " " in dt_str:
            return dt_str.split(" ")[0]
        return dt_str
    return trade.get("session", "unknown")
