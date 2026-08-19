#!/usr/bin/env python3
"""Shared causal candidate kernel for Current MNQ v2.4.

Single path for historical validation and live/shadow formation:
PREMARKET -> LEVEL -> REACH/APPROACH-EXCEPTION -> CANDLE STORY -> MOMENTUM -> A+.

Trader-fidelity rules:
- ordinary momentum is not automatically displacement;
- rejection entries use a zone story followed by momentum;
- a normal first close beyond a key zone is setup only, with the next momentum
  candle providing confirmation;
- a weak break may mature into a 15m three-bar continuation after pullback;
- only two pre-break early entries exist: repeat-test momentum attack and a
  genuine displacement sequence whose third candle retains momentum.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_entries import (
    breakout_failed,
    breakout_followthrough_after_first_print,
    displacement_sequence_prebreak,
    fifteen_minute_three_bar_continuation,
    first_break_print,
    repeat_test_momentum_prebreak,
    reversal_story_v24,
)
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_premarket import plan_allows_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = prod.core


def completed_candle_window(full5: pd.DataFrame, ts: pd.Timestamp, n: int = 5) -> pd.DataFrame:
    return full5[full5.index <= ts].tail(n)[["open", "high", "low", "close"]].copy()


def _as_location(loc: core.Location, z) -> core.Location:
    return replace(loc, zone=z, side=z.side, quality=z.quality, confluence=z.confluence)


def iter_actionable_candidates(env: dict, dte: date, p: prod.Params,
                               as_of: pd.Timestamp | None = None):
    full5, r5, h15 = env["full5"], env["r5"], env["h15"]
    session = r5[r5.index.date == dte]
    if session.empty:
        return
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    if open_ts - full5.index.min() < pd.Timedelta(days=core.MIN_WARMUP_DAYS):
        return

    plan = core.premarket_plan(full5, dte, env["pdm"], env["pwm"], env["pcm"])
    locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    pending: dict[tuple[str, str], core.PendingBreakout] = {}
    pending_locs: dict[tuple[str, str], core.Location] = {}

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

        pre_locs: list[core.Location] = []
        transition_reversal_locs: list[core.Location] = []
        for loc in authorized:
            if loc.zone is None:
                pre_locs.append(loc)
                continue
            before = zone_state_at_v24(loc.zone, full5, ts, p)
            if before.active:
                pre_locs.append(_as_location(loc, before))
                continue
            after = zone_state_at_v24(loc.zone, full5, bar_close, p)
            if after.active and after.state in {core.ZoneState.TESTED, core.ZoneState.FLIPPED_RETEST}:
                transition_reversal_locs.append(_as_location(loc, after))

        reversal_locs = pre_locs + transition_reversal_locs
        breakout_locs = pre_locs

        candidates: list[core.Candidate] = []
        pad = max(core.TICK * 2, p.touch_pad_atr * float(r.atr))

        # REJECTION FAMILY: the zone event may occur on an earlier candle; the
        # current candle is the directional momentum trigger. Displacement is
        # supporting evidence only and is not mandatory for rejection entries.
        for direction, side in (("L", "S"), ("S", "R")):
            for loc in [x for x in reversal_locs if x.side == side]:
                story = reversal_story_v24(full5, ts, r, direction, loc, p, pad)
                if story.complete and plan_allows_v24(plan, direction, "REV", story, loc, p):
                    candidates.append(core.Candidate(
                        direction, "REV", loc, story, ts, bar_close,
                        "ZONE_REJECTION_STORY_THEN_MOMENTUM",
                    ))

        # BREAKOUT FAMILY. A first completed close beyond the level is not an
        # entry by itself. The next momentum candle confirms the normal breakout.
        # Before the close-through, only the two trader-approved exceptions can
        # create a candidate.
        for direction, side in (("L", "R"), ("S", "S")):
            for loc in [x for x in breakout_locs if x.side == side]:
                key = (direction, loc.id)
                early_displacement = displacement_sequence_prebreak(
                    full5, ts, r, direction, loc, p, pad,
                )
                early_repeat_test = False
                if not early_displacement:
                    early_repeat_test = repeat_test_momentum_prebreak(
                        full5, ts, r, direction, loc, p, pad,
                    )
                post_break_momentum = breakout_followthrough_after_first_print(
                    full5, ts, r, direction, loc, p,
                )

                reason = None
                if early_displacement:
                    reason = "PREBREAK_DISPLACEMENT_SEQUENCE_THIRD_CANDLE_MOMENTUM"
                elif early_repeat_test:
                    reason = "PREBREAK_REPEAT_TEST_MOMENTUM_ATTACK"
                elif post_break_momentum:
                    reason = "FIRST_BREAK_PRINT_THEN_MOMENTUM_CONFIRMATION"

                if reason and plan_allows_v24(plan, direction, "BRK5", None, loc, p):
                    candidates.append(core.Candidate(
                        direction, "BRK5", loc, None, ts, bar_close, reason,
                    ))
                    pending.pop(key, None)
                    pending_locs.pop(key, None)

                # Every first print can seed the weak-break continuation question.
                # A normal momentum follow-through on the next 5m candle resolves
                # it earlier; otherwise the 15m three-bar path remains available.
                if first_break_print(full5, ts, r, direction, loc):
                    if key not in pending:
                        pending[key] = core.PendingBreakout(
                            direction, loc.id, bar_close, loc.lo, loc.hi,
                        )
                        pending_locs[key] = loc

        # WEAK BREAK -> PULLBACK -> 15m THREE-BAR CONTINUATION.
        for key, pen in list(pending.items()):
            loc = pending_locs[key]
            if breakout_failed(r, pen.direction, pen.zone_lo, pen.zone_hi):
                pending.pop(key, None); pending_locs.pop(key, None)
                continue
            # Four 15m slots cover a three-bar continuation despite alignment of
            # the initial 5m break inside a 15m candle. This is structural timing,
            # not a fitted performance threshold.
            if bar_close - pen.attempted_at > pd.Timedelta(minutes=60):
                pending.pop(key, None); pending_locs.pop(key, None)
                continue
            confirmed = fifteen_minute_three_bar_continuation(h15, pen, bar_close, p)
            if confirmed is None or confirmed > bar_close:
                continue
            if plan_allows_v24(plan, pen.direction, "BRK15", None, loc, p):
                candidates.append(core.Candidate(
                    pen.direction, "BRK15", loc, None, pen.attempted_at,
                    confirmed, "WEAK_BREAK_PULLBACK_15M_THREE_BAR_CONTINUATION",
                ))
            pending.pop(key, None); pending_locs.pop(key, None)

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
