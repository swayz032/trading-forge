#!/usr/bin/env python3
"""Trader-confirmed trigger semantics for Current MNQ v2.4.

This module deliberately separates MOMENTUM from DISPLACEMENT.
A strong red/green momentum candle may confirm a rejection without being a
true displacement event. Displacement is reserved for the more exceptional
pre-break continuation setup and requires ATR-scale repricing.

The trader-confirmed trigger families are:
- rejection story at a key zone -> directional momentum;
- first close beyond a key zone -> NEXT 5m momentum candle;
- repeat-test + momentum pre-break early entry;
- genuine displacement sequence into a key zone + third-bar momentum pre-break;
- weak break -> pullback -> 15m three-bar continuation.

No PnL is used here. All windows are causal and use completed bars only.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_candles import classify_patterns, geometry
from research.current_mnq_strategy_v2_4_zone_candles import zone_interaction

core = prod.core


@dataclass(frozen=True)
class RejectionTrigger:
    confirmed: bool
    reason: str
    approach: bool
    weakening: bool
    compression: bool
    rejection: bool
    momentum: bool
    displacement: bool


def _window(bars: pd.DataFrame, n: int = 6) -> pd.DataFrame:
    if bars is None or len(bars) == 0:
        return pd.DataFrame(columns=["open", "high", "low", "close"])
    return bars.tail(n)[["open", "high", "low", "close"]].copy()


def _dir(g, direction: str) -> bool:
    return bool(g.bullish) if direction == "L" else bool(g.bearish)


def _close_extreme(g, direction: str, p) -> bool:
    return bool(g.close_loc >= float(p.close_loc)) if direction == "L" else bool(g.close_loc <= 1.0 - float(p.close_loc))


def momentum_candle(bars: pd.DataFrame, direction: str, p) -> bool:
    """Directional force; intentionally broader than displacement.

    Uses the already-frozen body/range/close-location strategy parameters. The
    range baseline excludes the trigger bar, so a second strong candle is not
    penalized merely because the first momentum candle was also large.
    """
    q = _window(bars, 6)
    if len(q) < 2 or direction not in {"L", "S"}:
        return False
    gs = [geometry(r) for _, r in q.iterrows()]
    g = gs[-1]
    prior = np.asarray([x.range for x in gs[:-1]], dtype=float)
    prior = prior[np.isfinite(prior) & (prior > 0)]
    if len(prior) == 0:
        return False
    baseline = float(np.median(prior))
    return bool(
        _dir(g, direction)
        and g.body_frac >= float(p.body_frac)
        and g.range >= baseline * float(p.range_ratio)
        and _close_extreme(g, direction, p)
    )


def displacement_candle(bars: pd.DataFrame, direction: str, p,
                        atr: float | None) -> bool:
    """Exceptional force; never synonymous with every strong candle.

    A displacement candle must first qualify as momentum and then reprice by at
    least one current ATR in total range while its real body also clears the
    frozen min_disp_atr floor. Missing/invalid ATR fails closed.
    """
    if atr is None or not np.isfinite(float(atr)) or float(atr) <= 0:
        return False
    q = _window(bars, 6)
    if not momentum_candle(q, direction, p):
        return False
    g = geometry(q.iloc[-1])
    return bool(
        g.range >= float(atr)
        and g.body >= float(p.min_disp_atr) * float(atr)
    )


def _approach_toward_zone(pre: pd.DataFrame, direction: str) -> bool:
    if len(pre) < 2:
        return False
    a = float(pre.close.iloc[0]); b = float(pre.close.iloc[-1])
    # Long rejection occurs at support after price approaches downward.
    return bool(b < a) if direction == "L" else bool(b > a)


def _shrinking_into_zone(pre: pd.DataFrame, direction: str) -> bool:
    if len(pre) < 3:
        return False
    q = pre.tail(3)
    ranges = (q.high - q.low).to_numpy(float)
    bodies = (q.close - q.open).abs().to_numpy(float)
    shrink = bool(ranges[1] <= ranges[0] and ranges[2] <= ranges[1]) or bool(
        bodies[1] <= bodies[0] and bodies[2] <= bodies[1]
    )
    toward = bool(q.close.iloc[-1] <= q.close.iloc[0]) if direction == "L" else bool(q.close.iloc[-1] >= q.close.iloc[0])
    return bool(shrink and toward)


def rejection_momentum_trigger(bars: pd.DataFrame, zone_side: str,
                               zone_lo: float, zone_hi: float,
                               direction: str, p,
                               atr: float | None = None) -> RejectionTrigger:
    """Pattern/rejection story first, momentum trigger second.

    Supports the trader's examples: two momentum candles, doji -> momentum,
    pinbar -> momentum, inside-bar -> momentum, and shrinking candles into the
    key level -> rejection -> reverse momentum. The final momentum bar itself
    does not have to be the candle that first touched the zone.
    """
    q = _window(bars, 7)
    if len(q) < 3 or direction not in {"L", "S"}:
        return RejectionTrigger(False, "INSUFFICIENT_REJECTION_SEQUENCE", False, False, False, False, False, False)

    trigger = q.iloc[-1:]
    pre = q.iloc[:-1]
    momentum = momentum_candle(q, direction, p)
    disp = displacement_candle(q, direction, p, atr)
    approach = _approach_toward_zone(pre.tail(5), direction)

    interactions = [zone_interaction(r, zone_side, zone_lo, zone_hi, 0.0) for _, r in pre.tail(3).iterrows()]
    rejection = any(x.value in {"TOUCH", "SWEEP_RECLAIM_UP", "SWEEP_RECLAIM_DOWN"} for x in interactions)

    ev = classify_patterns(pre.tail(4))
    aligned_reversal = bool(ev.bullish_reversal) if direction == "L" else bool(ev.bearish_reversal)
    pattern_story = bool(
        aligned_reversal
        or ev.indecision
        or ev.compression
        or "INSIDE_BAR" in ev.patterns
        or "INSIDE_BODY" in ev.patterns
        or "BULLISH_PIN_REJECTION" in ev.patterns
        or "BEARISH_PIN_REJECTION" in ev.patterns
    )
    shrinking = _shrinking_into_zone(pre.tail(4), direction)

    # Two momentum candles is a valid story when the first momentum bar is the
    # zone-interaction bar and the second confirms continued control.
    two_momentum = False
    if len(q) >= 3:
        first = q.iloc[:-1].tail(6)
        two_momentum = bool(
            momentum_candle(first, direction, p)
            and zone_interaction(q.iloc[-2], zone_side, zone_lo, zone_hi, 0.0).value != "NONE"
        )

    ranges = (pre.high - pre.low).tail(3).to_numpy(float)
    weakening = bool(len(ranges) >= 2 and ranges[-1] <= ranges[0])
    compression = bool(ev.compression or "INSIDE_BAR" in ev.patterns or shrinking)
    story = bool(pattern_story or shrinking or two_momentum)
    confirmed = bool(approach and rejection and story and momentum)

    if confirmed:
        if shrinking:
            reason = "SHRINKING_INTO_ZONE_REJECTION_THEN_MOMENTUM"
        elif two_momentum:
            reason = "ZONE_REJECTION_TWO_MOMENTUM_CANDLES"
        else:
            reason = "ZONE_PATTERN_REJECTION_THEN_MOMENTUM"
    else:
        reason = "ZONE_REJECTION_SEQUENCE_NOT_CONFIRMED"
    return RejectionTrigger(confirmed, reason, approach, weakening, compression, rejection, momentum, disp)


def repeat_test_prebreak_trigger(bars: pd.DataFrame, zone_side: str,
                                 zone_lo: float, zone_hi: float,
                                 direction: str, p, pad: float = 0.0) -> bool:
    """Early-entry exception #1: prior test, reset away, second momentum attack."""
    q = _window(bars, 7)
    if len(q) < 4 or not momentum_candle(q, direction, p):
        return False
    last = geometry(q.iloc[-1])
    if direction == "L":
        if zone_side != "R" or last.close > float(zone_hi):
            return False
        current_near = last.high >= float(zone_lo) - float(pad)
    else:
        if zone_side != "S" or last.close < float(zone_lo):
            return False
        current_near = last.low <= float(zone_hi) + float(pad)
    if not current_near:
        return False

    prior = q.iloc[:-1]
    flags = [zone_interaction(r, zone_side, zone_lo, zone_hi, pad).value != "NONE" for _, r in prior.iterrows()]
    # Require a true earlier test and at least one intervening bar away from the
    # zone before the current renewed attack.
    for i, hit in enumerate(flags[:-1]):
        if hit and any(not x for x in flags[i + 1:]):
            return True
    return False


def displacement_prebreak_trigger(bars: pd.DataFrame, zone_side: str,
                                  zone_lo: float, zone_hi: float,
                                  direction: str, p, atr: float | None,
                                  pad: float = 0.0) -> bool:
    """Early-entry exception #2: true displacement drive + third-bar momentum."""
    q = _window(bars, 7)
    if len(q) < 4:
        return False
    last3 = q.tail(3)
    gs = [geometry(r) for _, r in last3.iterrows()]
    if not all(_dir(g, direction) for g in gs):
        return False
    closes = [g.close for g in gs]
    progressive = closes[0] < closes[1] < closes[2] if direction == "L" else closes[0] > closes[1] > closes[2]
    if not progressive or not momentum_candle(q, direction, p):
        return False

    before_third = q.iloc[:-1]
    first_two_have_displacement = bool(
        displacement_candle(before_third.iloc[:-1].tail(6), direction, p, atr)
        or displacement_candle(before_third.tail(6), direction, p, atr)
    )
    if not first_two_have_displacement:
        return False

    g = gs[-1]
    if direction == "L":
        return bool(zone_side == "R" and g.high >= float(zone_lo) - float(pad) and g.close <= float(zone_hi))
    return bool(zone_side == "S" and g.low <= float(zone_hi) + float(pad) and g.close >= float(zone_lo))


def next_bar_breakout_momentum(attempt_bar, current_bars: pd.DataFrame,
                               zone_side: str, zone_lo: float, zone_hi: float,
                               direction: str, p) -> bool:
    """Normal breakout: first outside close is setup; NEXT 5m momentum is trigger."""
    q = _window(current_bars, 7)
    if len(q) < 2 or not momentum_candle(q, direction, p):
        return False
    attempt = geometry(attempt_bar)
    current = geometry(q.iloc[-1])
    if direction == "L":
        return bool(
            zone_side == "R"
            and attempt.close > float(zone_hi)
            and current.close > float(zone_hi)
            and current.close > attempt.close
        )
    return bool(
        zone_side == "S"
        and attempt.close < float(zone_lo)
        and current.close < float(zone_lo)
        and current.close < attempt.close
    )


def three_bar_continuation_15m(h15: pd.DataFrame, attempted_at: pd.Timestamp,
                               known_at: pd.Timestamp, zone_side: str,
                               zone_lo: float, zone_hi: float,
                               direction: str, p) -> pd.Timestamp | None:
    """Weak break -> pullback -> 15m three-bar continuation confirmation.

    The three-bar continuation is interpreted as:
      bar 1: directional momentum in breakout direction;
      bar 2: controlled pullback/pause that does not invalidate the broken zone;
      bar 3: renewed directional momentum that exceeds bar 1's extreme.
    The pattern may begin after the initial weak break; every bar must complete
    after the attempted break. No future bars are consulted.
    """
    if h15 is None or h15.empty:
        return None
    completed = h15[
        (h15.index + pd.Timedelta(minutes=15) > attempted_at)
        & (h15.index + pd.Timedelta(minutes=15) <= known_at)
    ][["open", "high", "low", "close"]].copy()
    if len(completed) < 3:
        return None

    # Search causally in completion order and return the first qualifying bar 3.
    for end in range(3, len(completed) + 1):
        tri = completed.iloc[end - 3:end]
        context1 = h15[h15.index <= tri.index[0]].tail(6)[["open", "high", "low", "close"]]
        context3 = h15[h15.index <= tri.index[2]].tail(6)[["open", "high", "low", "close"]]
        if not momentum_candle(context1, direction, p) or not momentum_candle(context3, direction, p):
            continue
        a, b, c = [geometry(r) for _, r in tri.iterrows()]
        pause = bool((b.range <= a.range and b.body <= a.body) or (b.high <= a.high and b.low >= a.low))
        if not pause:
            continue
        if direction == "L":
            if zone_side != "R":
                continue
            pullback_ok = b.close >= float(zone_lo)
            continuation = c.close > a.high and c.close > float(zone_hi)
        else:
            if zone_side != "S":
                continue
            pullback_ok = b.close <= float(zone_hi)
            continuation = c.close < a.low and c.close < float(zone_lo)
        if pullback_ok and continuation:
            return tri.index[2] + pd.Timedelta(minutes=15)
    return None
