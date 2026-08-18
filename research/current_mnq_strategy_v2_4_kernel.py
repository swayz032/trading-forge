#!/usr/bin/env python3
"""Shared causal candidate kernel for Current MNQ v2.4.

This is the single candidate-formation path used by both historical validation and
live/shadow signal formation. It layers the trader's explicit correction on top of
v2.3 production plumbing:

    PREMARKET -> REACH ZONE -> REJECT/BREAK -> CANDLE CONTROL -> A+.

No candlestick pattern can create a candidate away from an authorized location.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_gate import gate_candidate

core = prod.core


def completed_candle_window(full5: pd.DataFrame, ts: pd.Timestamp, n: int = 5) -> pd.DataFrame:
    """Return only bars known at the close of the current 5m bar."""
    return full5[full5.index <= ts].tail(n)[["open", "high", "low", "close"]].copy()


def iter_actionable_candidates(env: dict, dte: date, p: prod.Params,
                               as_of: pd.Timestamp | None = None):
    """Yield chronological single-direction A+ candidates before target selection.

    If as_of is supplied, bars whose close is later than as_of are physically
    excluded. Historical validation passes as_of=None but every decision still
    uses only current/prior completed bars.
    """
    full5, r5, h15 = env["full5"], env["r5"], env["h15"]
    session = r5[r5.index.date == dte]
    if session.empty:
        return
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    if open_ts - full5.index.min() < pd.Timedelta(days=core.MIN_WARMUP_DAYS):
        return

    plan = core.premarket_plan(full5, dte, env["pdm"], env["pwm"], env["pcm"])
    locations, _ = core.build_entry_locations(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    pending: dict[tuple[str, str], core.PendingBreakout] = {}

    for i in range(len(session)):
        ts = session.index[i]
        bar_close = ts + pd.Timedelta(minutes=5)
        if ts.time() < core.TRADE_START:
            continue
        if as_of is not None and bar_close > as_of:
            continue
        r = session.iloc[i]
        if not np.isfinite(r.atr):
            continue

        # Resolve state immediately BEFORE the current completed bar. The current
        # break/reclaim candle may not erase the very question it is answering.
        current_locs = []
        for loc in authorized:
            if loc.zone is None:
                current_locs.append(loc)
                continue
            zs = core.zone_state_at(loc.zone, full5, ts, p)
            if zs.active:
                current_locs.append(replace(
                    loc, zone=zs, side=zs.side, quality=zs.quality,
                    confluence=zs.confluence,
                ))

        candidates: list[core.Candidate] = []
        pad = max(core.TICK * 2, p.touch_pad_atr * float(r.atr))
        candle_window = completed_candle_window(full5, ts)

        # Reversal: zone touch/reclaim is mandatory, THEN candle control, THEN
        # existing multi-bar Approach->Fight->Decision and premarket plan gates.
        for direction, side in (("L", "S"), ("S", "R")):
            near = [loc for loc in current_locs if loc.side == side and core.bar_interacts(loc, r, pad)]
            for loc in near:
                zgate = gate_candidate(
                    bars=candle_window, zone_side=side, zone_lo=loc.lo, zone_hi=loc.hi,
                    direction=direction, setup="REV", pad=0.0,
                )
                if not zgate.allowed:
                    continue
                story = core.reversal_story(full5, ts, r, direction, loc, p)
                if story.complete and core.plan_allows(plan, direction, "REV", story, loc):
                    candidates.append(core.Candidate(
                        direction, "REV", loc, story, ts, bar_close,
                        f"ZONE_CANDLE_REV:{zgate.reason}",
                    ))

        # Breakout: price must actually fail the correct side of the zone. Strong
        # 5m acceptance can confirm immediately. Weak attempts are remembered and
        # require a NEW completed 15m acceptance tied to that exact attempt.
        for direction, side in (("L", "R"), ("S", "S")):
            relevant = [loc for loc in current_locs if loc.side == side]
            for loc in relevant:
                if not core.decisive_outside(loc, r, direction, p):
                    continue
                if not core.breakout_pressure(full5, ts, direction):
                    continue
                if core.strong_bar(r, direction, p):
                    zgate = gate_candidate(
                        bars=candle_window, zone_side=side, zone_lo=loc.lo, zone_hi=loc.hi,
                        direction=direction, setup="BRK5", pad=0.0,
                    )
                    if zgate.allowed and core.plan_allows(plan, direction, "BRK5", None, loc):
                        candidates.append(core.Candidate(
                            direction, "BRK5", loc, None, ts, bar_close,
                            f"ZONE_CANDLE_BRK5:{zgate.reason}",
                        ))
                else:
                    zgate = gate_candidate(
                        bars=candle_window, zone_side=side, zone_lo=loc.lo, zone_hi=loc.hi,
                        direction=direction, setup="BRK15", pad=0.0,
                        fifteen_minute_acceptance=False,
                    )
                    if zgate.reason == "WAIT_FOR_NEW_COMPLETED_15M_ACCEPTANCE":
                        key = (direction, loc.id)
                        pending.setdefault(key, core.PendingBreakout(
                            direction, loc.id, bar_close, loc.lo, loc.hi,
                        ))

        # Confirm weak breakouts using the original attempt candle + a later 15m
        # acceptance. Use the original authorized location even if the attempt has
        # now caused its current state to become BROKEN.
        for key, pen in list(pending.items()):
            loc = next((x for x in authorized if x.id == pen.location_id), None)
            if loc is None:
                pending.pop(key, None)
                continue
            if bar_close - pen.attempted_at > pd.Timedelta(minutes=30):
                pending.pop(key, None)
                continue
            confirmed = core.latest_new_15m_confirmation(h15, pen, bar_close)
            if confirmed is None or confirmed > bar_close:
                continue
            attempt_ts = pen.attempted_at - pd.Timedelta(minutes=5)
            attempt_window = completed_candle_window(full5, attempt_ts)
            side = "R" if pen.direction == "L" else "S"
            zgate = gate_candidate(
                bars=attempt_window, zone_side=side, zone_lo=pen.zone_lo, zone_hi=pen.zone_hi,
                direction=pen.direction, setup="BRK15", pad=0.0,
                fifteen_minute_acceptance=True,
            )
            if zgate.allowed and core.plan_allows(plan, pen.direction, "BRK15", None, loc):
                candidates.append(core.Candidate(
                    pen.direction, "BRK15", loc, None, pen.attempted_at,
                    confirmed, f"ZONE_CANDLE_BRK15:{zgate.reason}",
                ))
            pending.pop(key, None)

        if not candidates or len(set(c.direction for c in candidates)) != 1:
            continue
        rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
        cand = max(candidates, key=lambda c: (
            rank[c.setup], c.location.quality, c.location.confluence,
        ))
        actionable = max(bar_close, cand.confirmed_time)
        if actionable.time() > core.LAST_ENTRY:
            continue
        if as_of is not None and actionable > as_of:
            continue
        yield cand, actionable, plan
