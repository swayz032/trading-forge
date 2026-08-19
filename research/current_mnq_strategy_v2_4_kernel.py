#!/usr/bin/env python3
"""Shared causal candidate kernel for Current MNQ v2.4.

Single path for historical validation and live/shadow formation:
PREMARKET -> LEVEL -> CANDLE STORY -> INTRA-CANDLE FORCE -> A+.

Momentum is a LIVE trigger. The trader watches the forming candle and enters once
buyer/seller control is sustained; waiting for the 5m close can be materially too
late against the frozen 17.25-point stop. Historical/live parity therefore uses
completed 1m sub-bars to reconstruct the forming 5m/15m candle without tick-order
lookahead.
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
    repeat_test_momentum_prebreak,
    reversal_story_v24,
    weak_first_break_print,
)
from research.current_mnq_strategy_v2_4_force import decision_times, force_snapshot
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_premarket import plan_allows_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = prod.core


def completed_candle_window(full5: pd.DataFrame, ts: pd.Timestamp, n: int = 5) -> pd.DataFrame:
    return full5[full5.index <= ts].tail(n)[["open", "high", "low", "close"]].copy()


def _as_location(loc: core.Location, z) -> core.Location:
    return replace(loc, zone=z, side=z.side, quality=z.quality, confluence=z.confluence)


def _bucket_starts(r5: pd.DataFrame, one: pd.DataFrame, dte: date,
                   as_of: pd.Timestamp | None) -> list[pd.Timestamp]:
    starts = set(r5[r5.index.date == dte].index.tolist())
    one_day = one[one.index.date == dte]
    if as_of is not None:
        one_day = one_day[(one_day.index + pd.Timedelta(minutes=1)) <= as_of]
    for ts in one_day.index:
        b = ts.floor("5min")
        if b.time() >= core.TRADE_START and b.time() <= core.LAST_ENTRY:
            starts.add(b)
    return sorted(starts)


def _latest_completed_atr(full5: pd.DataFrame, ts: pd.Timestamp) -> float | None:
    prior = full5[full5.index < ts]
    if prior.empty or "atr" not in prior.columns:
        return None
    vals = pd.to_numeric(prior.atr, errors="coerce")
    vals = vals[np.isfinite(vals)]
    return float(vals.iloc[-1]) if len(vals) else None


def _intra15_confirmation(h15: pd.DataFrame, one: pd.DataFrame, pending,
                          known_at: pd.Timestamp, p: prod.Params):
    """Weak break -> completed 15m break/pullback -> LIVE force in forming bar 3."""
    parent_start = known_at.floor("15min")
    parent_end = parent_start + pd.Timedelta(minutes=15)
    if not (parent_start < known_at < parent_end):
        return None

    snap = force_snapshot(one, parent_start, 15, pending.direction, known_at, p)
    if not snap.confirmed:
        return None
    c = snap.as_row()
    if c is None:
        return None

    completed = h15[
        ((h15.index + pd.Timedelta(minutes=15)) >= pending.attempted_at)
        & ((h15.index + pd.Timedelta(minutes=15)) <= parent_start)
    ].copy()
    if len(completed) < 2:
        return None

    for i in range(1, len(completed)):
        a, b = completed.iloc[i - 1], completed.iloc[i]
        a_ts, b_ts = completed.index[i - 1], completed.index[i]
        if b_ts != a_ts + pd.Timedelta(minutes=15):
            continue
        if b_ts + pd.Timedelta(minutes=15) != parent_start:
            continue
        if pending.direction == "L":
            bar1 = float(a.close) > float(pending.zone_hi)
            pullback = float(b.close) < float(a.close) and float(b.close) >= float(pending.zone_lo)
            resume = float(c.close) > float(a.close)
        else:
            bar1 = float(a.close) < float(pending.zone_lo)
            pullback = float(b.close) > float(a.close) and float(b.close) <= float(pending.zone_hi)
            resume = float(c.close) < float(a.close)
        if bar1 and pullback and resume:
            return snap
    return None


def _rank_and_yield(candidates: list[core.Candidate], actionable: pd.Timestamp,
                    plan, as_of: pd.Timestamp | None):
    if not candidates or len(set(c.direction for c in candidates)) != 1:
        return None
    rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
    cand = max(candidates, key=lambda c: (
        rank[c.setup], c.location.quality, c.location.confluence,
    ))
    if actionable.time() > core.LAST_ENTRY:
        return None
    if as_of is not None and actionable > as_of:
        return None
    return cand, actionable, plan


def iter_actionable_candidates(env: dict, dte: date, p: prod.Params,
                               as_of: pd.Timestamp | None = None):
    full5, r5, h15, one = env["full5"], env["r5"], env["h15"], env["one"]
    bucket_starts = _bucket_starts(r5, one, dte, as_of)
    if not bucket_starts:
        return
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    if full5.empty or open_ts - full5.index.min() < pd.Timedelta(days=core.MIN_WARMUP_DAYS):
        return

    plan = core.premarket_plan(full5, dte, env["pdm"], env["pwm"], env["pcm"])
    locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    pending: dict[tuple[str, str], core.PendingBreakout] = {}
    pending_locs: dict[tuple[str, str], core.Location] = {}
    completed_session = r5[r5.index.date == dte]

    for ts in bucket_starts:
        if ts.time() < core.TRADE_START:
            continue
        bar_close = ts + pd.Timedelta(minutes=5)
        atr_ref = _latest_completed_atr(full5, ts)
        if atr_ref is None or not np.isfinite(atr_ref):
            continue
        pad = max(core.TICK * 2, p.touch_pad_atr * float(atr_ref))

        # Location state is frozen at the start of the forming 5m candle. A role
        # change caused by this candle cannot authorize an entry inside itself.
        pre_locs: list[core.Location] = []
        for loc in authorized:
            if loc.zone is None:
                pre_locs.append(loc)
                continue
            before = zone_state_at_v24(loc.zone, full5, ts, p)
            if before.active:
                pre_locs.append(_as_location(loc, before))

        # Every completed 1m inside the parent 5m is a causal decision clock.
        # The parent close itself is excluded: if force was not proven before the
        # close, this candle did not earn the trader's early momentum entry.
        for decision_time in decision_times(one, ts, 5, as_of):
            candidates: list[core.Candidate] = []

            # Rejection momentum is live: prior rejection/control event must be
            # complete, then the forming 5m must prove sustained directional force.
            for direction, side in (("L", "S"), ("S", "R")):
                force = force_snapshot(one, ts, 5, direction, decision_time, p)
                if not force.confirmed:
                    continue
                partial = force.as_row(atr_ref)
                for loc in [x for x in pre_locs if x.side == side]:
                    story = reversal_story_v24(full5, ts, partial, direction, loc, p, pad)
                    if story.complete and plan_allows_v24(plan, direction, "REV", story, loc, p):
                        candidates.append(core.Candidate(
                            direction, "REV", loc, story, ts, decision_time,
                            "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
                        ))

            # Breakout/repeat-test/displacement momentum uses the same force gate.
            for direction, side in (("L", "R"), ("S", "S")):
                force = force_snapshot(one, ts, 5, direction, decision_time, p)
                if not force.confirmed:
                    continue
                partial = force.as_row(atr_ref)
                for loc in [x for x in pre_locs if x.side == side]:
                    key = (direction, loc.id)
                    early_displacement = displacement_sequence_prebreak(
                        full5, ts, partial, direction, loc, p, pad,
                    )
                    early_repeat_test = False
                    if not early_displacement:
                        early_repeat_test = repeat_test_momentum_prebreak(
                            full5, ts, partial, direction, loc, p, pad,
                        )
                    post_break_momentum = breakout_followthrough_after_first_print(
                        full5, ts, partial, direction, loc, p,
                    )

                    reason = None
                    if early_displacement:
                        reason = "PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE"
                    elif early_repeat_test:
                        reason = "PREBREAK_REPEAT_TEST_INTRA5_FORCE"
                    elif post_break_momentum:
                        reason = "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE"

                    if reason and plan_allows_v24(plan, direction, "BRK5", None, loc, p):
                        candidates.append(core.Candidate(
                            direction, "BRK5", loc, None, ts, decision_time, reason,
                        ))
                        pending.pop(key, None)
                        pending_locs.pop(key, None)

            # A pending weak-break 15m continuation also uses LIVE force in bar 3.
            for key, pen in list(pending.items()):
                loc = pending_locs[key]
                if decision_time - pen.attempted_at > pd.Timedelta(minutes=60):
                    pending.pop(key, None); pending_locs.pop(key, None)
                    continue
                force15 = _intra15_confirmation(h15, one, pen, decision_time, p)
                if force15 is not None and plan_allows_v24(plan, pen.direction, "BRK15", None, loc, p):
                    candidates.append(core.Candidate(
                        pen.direction, "BRK15", loc, None, pen.attempted_at,
                        decision_time, "WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE",
                    ))
                    pending.pop(key, None); pending_locs.pop(key, None)

            chosen = _rank_and_yield(candidates, decision_time, plan, as_of)
            if chosen is not None:
                yield chosen

        # Only a COMPLETED weak first break can arm the 15m continuation path.
        if ts in completed_session.index and (as_of is None or bar_close <= as_of):
            r = completed_session.loc[ts]
            for direction, side in (("L", "R"), ("S", "S")):
                for loc in [x for x in pre_locs if x.side == side]:
                    key = (direction, loc.id)
                    if weak_first_break_print(full5, ts, r, direction, loc, p):
                        pending.setdefault(
                            key,
                            core.PendingBreakout(direction, loc.id, bar_close, loc.lo, loc.hi),
                        )
                        pending_locs.setdefault(key, loc)

            # Preserve fail-closed invalidation for already-pending attempts.
            for key, pen in list(pending.items()):
                if breakout_failed(r, pen.direction, pen.zone_lo, pen.zone_hi):
                    pending.pop(key, None); pending_locs.pop(key, None)
