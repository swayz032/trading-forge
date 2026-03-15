"""Filter trades based on current governor state."""

from __future__ import annotations

import math
from typing import Any


def filter_trade(
    governor_state: str,
    size_multiplier: float,
    requested_contracts: int,
    trade_context: dict | None = None,
) -> dict:
    """
    Apply governor filter to a proposed trade.

    Returns:
        {
            "allowed": bool,
            "original_contracts": int,
            "adjusted_contracts": int,
            "governor_state": str,
            "size_multiplier": float,
            "reason": str,
        }
    """
    # Lockout: no trades allowed
    if governor_state == "lockout" or size_multiplier == 0.0:
        return {
            "allowed": False,
            "original_contracts": requested_contracts,
            "adjusted_contracts": 0,
            "governor_state": governor_state,
            "size_multiplier": size_multiplier,
            "reason": "trade_blocked_governor_lockout",
        }

    # Adjust contracts by multiplier
    adjusted = requested_contracts * size_multiplier

    # Round down, minimum 1 if allowed
    adjusted_int = max(1, math.floor(adjusted))

    # Cap at original
    adjusted_int = min(adjusted_int, requested_contracts)

    reduced = adjusted_int < requested_contracts
    if reduced:
        reason = f"size_reduced_{governor_state}_state_{size_multiplier:.0%}_multiplier"
    else:
        reason = "trade_allowed_full_size"

    return {
        "allowed": True,
        "original_contracts": requested_contracts,
        "adjusted_contracts": adjusted_int,
        "governor_state": governor_state,
        "size_multiplier": size_multiplier,
        "reason": reason,
    }
