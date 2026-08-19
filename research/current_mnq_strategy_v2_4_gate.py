#!/usr/bin/env python3
"""Low-level zone/candle gate for Current MNQ v2.4 candidates.

The shared kernel owns the full trader-fidelity sequence. This gate remains a
small deterministic contract for unit/integration callers:
- REV: current zone rejection/control evidence may pass to the wider story gate;
- BRK5: a first break print is setup only; a subsequent momentum candle confirms;
- BRK15: the caller must prove the completed 15m three-bar continuation, not a
  generic single acceptance candle.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_candles import Interaction, ZoneCandleDecision
from research.current_mnq_strategy_v2_4_entries import momentum_bar
from research.current_mnq_strategy_v2_4_zone_candles import evaluate_at_zone


@dataclass(frozen=True)
class CandidateGate:
    allowed: bool
    reason: str
    evidence: ZoneCandleDecision


def _break_close(row, direction: str, lo: float, hi: float) -> bool:
    return bool(float(row.close) > float(hi)) if direction == "L" else bool(float(row.close) < float(lo))


def gate_candidate(*, bars: pd.DataFrame, zone_side: str, zone_lo: float,
                   zone_hi: float, direction: str, setup: str,
                   pad: float = 0.0, fifteen_minute_acceptance: bool = False,
                   fifteen_minute_three_bar_continuation: bool | None = None) -> CandidateGate:
    """Fail closed unless the requested setup's local sequence is proven.

    `fifteen_minute_acceptance` is retained only as a compatibility argument; it
    no longer grants BRK15 authority. New callers must pass
    `fifteen_minute_three_bar_continuation=True` after proving that sequence.
    """
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")
    if setup not in {"REV", "BRK5", "BRK15"}:
        raise ValueError("setup must be REV, BRK5 or BRK15")
    if bars is None or len(bars) == 0:
        ev = evaluate_at_zone(bars, zone_side, zone_lo, zone_hi, pad)
        return CandidateGate(False, "NO_ZONE_NO_TRADE", ev)

    p = prod.Params()

    if setup == "REV":
        ev = evaluate_at_zone(bars, zone_side, zone_lo, zone_hi, pad)
        if not ev.reached_zone:
            return CandidateGate(False, "NO_ZONE_NO_TRADE", ev)
        allowed = ev.reversal_long_confirmed if direction == "L" else ev.reversal_short_confirmed
        return CandidateGate(allowed, ev.reason if allowed else "ZONE_REACHED_REVERSAL_NOT_CONFIRMED", ev)

    if setup == "BRK5":
        # First print beyond the level is setup only. Use the first-break bar as
        # zone evidence and require the immediately following candle to carry
        # directional momentum while remaining beyond the broken zone.
        if len(bars) < 3:
            ev = evaluate_at_zone(bars, zone_side, zone_lo, zone_hi, pad)
            return CandidateGate(False, "WAIT_FOR_POST_BREAK_MOMENTUM", ev)
        pre, first, current = bars.iloc[-3], bars.iloc[-2], bars.iloc[-1]
        first_is_new_break = _break_close(first, direction, zone_lo, zone_hi) and not _break_close(
            pre, direction, zone_lo, zone_hi
        )
        ev = evaluate_at_zone(bars.iloc[:-1], zone_side, zone_lo, zone_hi, pad)
        allowed = bool(
            first_is_new_break
            and _break_close(current, direction, zone_lo, zone_hi)
            and momentum_bar(current, direction, p)
        )
        return CandidateGate(
            allowed,
            "FIRST_BREAK_PRINT_THEN_MOMENTUM_CONFIRMATION" if allowed else "WAIT_FOR_POST_BREAK_MOMENTUM",
            ev,
        )

    # BRK15 is specifically the trader's weak-break -> pullback -> completed 15m
    # three-bar continuation path. A generic new 15m acceptance boolean is no
    # longer sufficient, even for backwards-compatible callers.
    ev = evaluate_at_zone(bars, zone_side, zone_lo, zone_hi, pad)
    expected = Interaction.BREAK_CLOSE_UP.value if direction == "L" else Interaction.BREAK_CLOSE_DOWN.value
    if ev.interaction != expected:
        return CandidateGate(False, "WEAK_BREAKOUT_ATTEMPT_DID_NOT_BREAK_ZONE", ev)
    if fifteen_minute_three_bar_continuation is not True:
        return CandidateGate(False, "WAIT_FOR_COMPLETED_15M_THREE_BAR_CONTINUATION", ev)
    return CandidateGate(True, "WEAK_BREAK_CONFIRMED_BY_15M_THREE_BAR_CONTINUATION", ev)
