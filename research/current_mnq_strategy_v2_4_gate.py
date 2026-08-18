#!/usr/bin/env python3
"""Mandatory zone + candlestick gate for Current MNQ v2.4 candidates."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from research.current_mnq_strategy_v2_4_candles import Interaction, ZoneCandleDecision
from research.current_mnq_strategy_v2_4_zone_candles import evaluate_at_zone


@dataclass(frozen=True)
class CandidateGate:
    allowed: bool
    reason: str
    evidence: ZoneCandleDecision


def gate_candidate(*, bars: pd.DataFrame, zone_side: str, zone_lo: float,
                   zone_hi: float, direction: str, setup: str,
                   pad: float = 0.0, fifteen_minute_acceptance: bool = False) -> CandidateGate:
    """No candidate can exist before an authorized zone interaction.

    setup: REV, BRK5 or BRK15
    direction: L or S
    """
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")
    if setup not in {"REV", "BRK5", "BRK15"}:
        raise ValueError("setup must be REV, BRK5 or BRK15")
    ev = evaluate_at_zone(bars, zone_side, zone_lo, zone_hi, pad)
    if not ev.reached_zone:
        return CandidateGate(False, "NO_ZONE_NO_TRADE", ev)

    if setup == "REV":
        allowed = ev.reversal_long_confirmed if direction == "L" else ev.reversal_short_confirmed
        return CandidateGate(allowed, ev.reason if allowed else "ZONE_REACHED_REVERSAL_NOT_CONFIRMED", ev)

    if setup == "BRK5":
        allowed = ev.breakout_long_confirmed if direction == "L" else ev.breakout_short_confirmed
        return CandidateGate(allowed, ev.reason if allowed else "ZONE_REACHED_5M_BREAKOUT_NOT_CONFIRMED", ev)

    expected = Interaction.BREAK_CLOSE_UP.value if direction == "L" else Interaction.BREAK_CLOSE_DOWN.value
    if ev.interaction != expected:
        return CandidateGate(False, "WEAK_BREAKOUT_ATTEMPT_DID_NOT_BREAK_ZONE", ev)
    if not fifteen_minute_acceptance:
        return CandidateGate(False, "WAIT_FOR_NEW_COMPLETED_15M_ACCEPTANCE", ev)
    return CandidateGate(True, "WEAK_BREAKOUT_CONFIRMED_BY_NEW_15M_ACCEPTANCE", ev)
