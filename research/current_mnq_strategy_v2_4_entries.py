#!/usr/bin/env python3
"""Trader-fidelity entry sequences for Current MNQ v2.4.

This module deliberately separates ordinary directional momentum from true
range-expanding displacement. It also keeps the trader's only two pre-break
early-entry families explicit and fail-closed.

No PnL-tuned threshold is introduced here. Geometry reuses the frozen Params
body/close/range and room parameters.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_candles import classify_patterns

core = prod.core
EPS = 1e-12


@dataclass(frozen=True)
class RawGeometry:
    bullish: bool
    bearish: bool
    range: float
    body: float
    body_frac: float
    close_loc: float
    upper_frac: float
    lower_frac: float


def _geom(row) -> RawGeometry:
    o = float(row.open); h = float(row.high); l = float(row.low); c = float(row.close)
    rg = max(h - l, EPS)
    body = abs(c - o)
    upper = max(0.0, h - max(o, c))
    lower = max(0.0, min(o, c) - l)
    return RawGeometry(
        bullish=c > o, bearish=c < o, range=rg, body=body,
        body_frac=body / rg, close_loc=(c - l) / rg,
        upper_frac=upper / rg, lower_frac=lower / rg,
    )


def _ohlc(frame: pd.DataFrame) -> pd.DataFrame:
    return frame[["open", "high", "low", "close"]].copy()


def momentum_bar(row, direction: str, p: core.Params) -> bool:
    """Directional control candle. Range expansion is intentionally NOT required."""
    g = _geom(row)
    if direction == "L":
        return bool(g.bullish and g.body_frac >= float(p.body_frac) and
                    g.close_loc >= float(p.close_loc))
    if direction == "S":
        return bool(g.bearish and g.body_frac >= float(p.body_frac) and
                    g.close_loc <= 1.0 - float(p.close_loc))
    raise ValueError("direction must be L or S")


def displacement_bar(row, direction: str, p: core.Params,
                     reference_range: float | None = None) -> bool:
    """True displacement = momentum PLUS range expansion; not every strong candle."""
    if not momentum_bar(row, direction, p):
        return False
    if reference_range is not None and np.isfinite(reference_range) and reference_range > 0:
        return bool(_geom(row).range >= float(reference_range) * float(p.range_ratio))
    rr = getattr(row, "rr", np.nan)
    return bool(np.isfinite(rr) and float(rr) >= float(p.range_ratio))


def _outside(row, loc: core.Location, direction: str) -> bool:
    if direction == "L":
        return float(row.close) > float(loc.hi)
    return float(row.close) < float(loc.lo)


def _reaches(row, loc: core.Location, pad: float = 0.0) -> bool:
    return bool(float(row.high) >= float(loc.lo) - float(pad) and
                float(row.low) <= float(loc.hi) + float(pad))


def _valid_rejection_side(row, loc: core.Location, direction: str,
                          pad: float = 0.0) -> bool:
    if not _reaches(row, loc, pad):
        return False
    if direction == "L":
        return bool(float(row.close) >= float(loc.lo) - float(pad))
    return bool(float(row.close) <= float(loc.hi) + float(pad))


def _shrinking_into_zone(frame: pd.DataFrame, end_pos: int,
                         direction: str) -> bool:
    if end_pos < 2:
        return False
    q = frame.iloc[end_pos - 2:end_pos + 1]
    gs = [_geom(r) for _, r in q.iterrows()]
    shrinking = gs[1].range <= gs[0].range and gs[2].range <= gs[1].range
    closes = q.close.to_numpy(float)
    toward = bool(closes[0] >= closes[1] >= closes[2]) if direction == "L" else bool(
        closes[0] <= closes[1] <= closes[2]
    )
    return bool(shrinking and toward)


def reversal_story_v24(full5: pd.DataFrame, ts: pd.Timestamp, row,
                       direction: str, loc: core.Location,
                       p: core.Params, pad: float) -> core.Story:
    """Zone rejection/control story followed by a distinct momentum trigger.

    Recognized trader families include doji/pin/inside-bar -> momentum,
    shrinking candles into the level -> rejection -> reverse momentum, and two
    momentum candles after the rejection. The current momentum candle may not
    self-certify as the earlier rejection/control event.
    """
    prior = full5[full5.index < ts].tail(5)
    current = pd.DataFrame([row], index=[ts])
    q = pd.concat([prior, current])
    if len(q) < 2 or not momentum_bar(row, direction, p):
        return core.Story(False, False, False, False, False, False,
                          False, False, False, False, False)

    start = max(0, len(q) - 4)
    event_pos = None
    for j in range(len(q) - 2, start - 1, -1):
        if _valid_rejection_side(q.iloc[j], loc, direction, pad):
            event_pos = j
            break
    if event_pos is None:
        return core.Story(False, False, False, False, False, False,
                          False, False, False, False, False)

    event = q.iloc[event_pos]
    ev = classify_patterns(_ohlc(q.iloc[:event_pos + 1].tail(5)))
    eg = _geom(event)
    shrink = _shrinking_into_zone(q, event_pos, direction)
    inside = False
    if event_pos >= 1:
        prev = q.iloc[event_pos - 1]
        inside = bool(float(event.high) <= float(prev.high) and
                      float(event.low) >= float(prev.low))

    if direction == "L":
        directional_pattern = bool(ev.bullish_reversal)
        wick_rejection = bool(eg.lower_frac >= float(p.reject_wick))
        reclaimed = bool(float(event.close) >= float(loc.lo))
        follow = bool(float(row.close) >= float(event.close) and _geom(row).close_loc >= 0.60)
    else:
        directional_pattern = bool(ev.bearish_reversal)
        wick_rejection = bool(eg.upper_frac >= float(p.reject_wick))
        reclaimed = bool(float(event.close) <= float(loc.hi))
        follow = bool(float(row.close) <= float(event.close) and _geom(row).close_loc <= 0.40)

    first_momentum = momentum_bar(event, direction, p)
    pattern_story = bool(ev.indecision or directional_pattern or ev.compression or inside)
    fight = bool(reclaimed and (wick_rejection or pattern_story or shrink or first_momentum))

    prior_ranges = [_geom(r).range for _, r in prior.tail(3).iterrows()]
    ref = float(np.median(prior_ranges)) if prior_ranges else None
    disp = displacement_bar(row, direction, p, ref)

    return core.Story(
        approach=True,
        weakening=bool(shrink),
        compression=bool(ev.compression or inside),
        rejection=bool(wick_rejection),
        failed_push=bool(_reaches(event, loc, 0.0) and reclaimed),
        reclaim=bool(reclaimed),
        takeover=True,
        displacement=bool(disp),
        follow_through=bool(follow),
        fight=bool(fight),
        decision=bool(follow),
    )


def first_break_print(full5: pd.DataFrame, ts: pd.Timestamp, row,
                      direction: str, loc: core.Location) -> bool:
    if not _outside(row, loc, direction):
        return False
    prior = full5[full5.index < ts].tail(1)
    if prior.empty:
        return True
    return not _outside(prior.iloc[-1], loc, direction)


def weak_first_break_print(full5: pd.DataFrame, ts: pd.Timestamp, row,
                           direction: str, loc: core.Location,
                           p: core.Params) -> bool:
    """A weak first break is a new close beyond the zone without momentum geometry."""
    return bool(
        first_break_print(full5, ts, row, direction, loc)
        and not momentum_bar(row, direction, p)
    )


def breakout_followthrough_after_first_print(full5: pd.DataFrame, ts: pd.Timestamp,
                                             row, direction: str,
                                             loc: core.Location,
                                             p: core.Params) -> bool:
    """First 5m close beyond level is setup; next forming 5m must extend it with force.

    Trader fidelity: do not merely remain beyond the key level. For a long, the
    following forming 5m candle must trade above the completed breakout candle's
    high; for a short it must trade below that candle's low. The caller separately
    proves sustained intra-5m force causally before this function can authorize.
    """
    prior = full5[full5.index < ts].tail(2)
    if len(prior) < 2 or not momentum_bar(row, direction, p) or not _outside(row, loc, direction):
        return False
    pre, first = prior.iloc[-2], prior.iloc[-1]
    if not (_outside(first, loc, direction) and not _outside(pre, loc, direction)):
        return False
    if direction == "L":
        return bool(float(row.high) > float(first.high))
    return bool(float(row.low) < float(first.low))


def repeat_test_momentum_prebreak(full5: pd.DataFrame, ts: pd.Timestamp, row,
                                  direction: str, loc: core.Location,
                                  p: core.Params, pad: float) -> bool:
    """Early exception #1: distinct prior test -> reset away -> momentum re-attack."""
    if _outside(row, loc, direction) or not momentum_bar(row, direction, p):
        return False
    if not _reaches(row, loc, pad):
        return False
    prior = full5[full5.index < ts].tail(6)
    if len(prior) < 2:
        return False
    reached = [bool(_reaches(r, loc, pad) and not _outside(r, loc, direction))
               for _, r in prior.iterrows()]
    # A repeat test is not several adjacent bars sitting on the same level. The
    # earlier test must be followed by at least one completed bar that no longer
    # reaches the zone before the current momentum attack returns to it.
    for i, hit in enumerate(reached[:-1]):
        if hit and any(not later_hit for later_hit in reached[i + 1:]):
            return True
    return False


def displacement_sequence_prebreak(full5: pd.DataFrame, ts: pd.Timestamp, row,
                                   direction: str, loc: core.Location,
                                   p: core.Params, pad: float) -> bool:
    """Early exception #2: genuine displacement drive + third momentum candle.

    At least one of the first two drive candles must be true displacement. The
    other may be ordinary directional momentum; this preserves the trader's
    explicit rule that every strong candle is not displacement. Candle three
    must retain directional momentum and the sequence must keep progressing
    toward the authorized key zone.
    """
    if _outside(row, loc, direction) or not _reaches(row, loc, pad):
        return False
    prior = full5[full5.index < ts].tail(5)
    if len(prior) < 5:
        return False
    seq = pd.concat([prior.tail(2), pd.DataFrame([row], index=[ts])])
    baseline = prior.head(3)
    ref = float(np.median([_geom(r).range for _, r in baseline.iterrows()]))
    a, b, c = seq.iloc[0], seq.iloc[1], seq.iloc[2]
    first_two_directional = bool(momentum_bar(a, direction, p) and
                                 momentum_bar(b, direction, p))
    genuine_displacement = bool(displacement_bar(a, direction, p, ref) or
                                displacement_bar(b, direction, p, ref))
    if not (first_two_directional and genuine_displacement and momentum_bar(c, direction, p)):
        return False
    closes = seq.close.to_numpy(float)
    if direction == "L":
        return bool(closes[0] < closes[1] < closes[2])
    return bool(closes[0] > closes[1] > closes[2])


def breakout_failed(row, direction: str, zone_lo: float, zone_hi: float) -> bool:
    if direction == "L":
        return bool(float(row.close) < float(zone_lo))
    return bool(float(row.close) > float(zone_hi))


def fifteen_minute_three_bar_continuation(h15: pd.DataFrame, pending,
                                           known_at: pd.Timestamp,
                                           p: core.Params) -> pd.Timestamp | None:
    """Weak break -> pullback -> 15m bar-3 momentum continuation."""
    q = h15[(h15.index + pd.Timedelta(minutes=15) >= pending.attempted_at) &
            (h15.index + pd.Timedelta(minutes=15) <= known_at)].copy()
    if len(q) < 3:
        return None
    for i in range(2, len(q)):
        a, b, c = q.iloc[i - 2], q.iloc[i - 1], q.iloc[i]
        if pending.direction == "L":
            bar1 = float(a.close) > float(pending.zone_hi)
            pullback = float(b.close) < float(a.close) and float(b.close) >= float(pending.zone_lo)
            resume = momentum_bar(c, "L", p) and float(c.close) > float(a.close)
        else:
            bar1 = float(a.close) < float(pending.zone_lo)
            pullback = float(b.close) > float(a.close) and float(b.close) <= float(pending.zone_hi)
            resume = momentum_bar(c, "S", p) and float(c.close) < float(a.close)
        if bar1 and pullback and resume:
            return q.index[i] + pd.Timedelta(minutes=15)
    return None
