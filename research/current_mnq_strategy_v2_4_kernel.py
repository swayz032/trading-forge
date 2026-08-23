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
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research import current_mnq_strategy_v2_4_entry_authority as auth
from research.current_mnq_strategy_v2_4_entries import (
    breakout_failed,
    weak_first_break_print,
)
from research.current_mnq_strategy_v2_4_force import decision_times, force_snapshot
from research.current_mnq_strategy_v2_4_fvg_interaction import active_fvg_interaction_locations
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_premarket import build_premarket_plan_v24, plan_allows_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = prod.core

#: The completed-bar history the derivation layer reads behind the trigger. It is the SAME
#: value the derivation's own default, its checkpoint and the acceptance-bars exam used, so the
#: wired kernel asks the question those instruments already answered rather than a neighbouring
#: one. Changing it changes what every one of them measured.
LOOKBACK = 6

#: Route precedence for the breakout family, PRESERVED FROM THE KERNEL'S OWN elif CHAIN
#: (displacement -> repeat-test -> post-break). The state machine decides whether a route
#: grants; it does not decide which route is asked first, and inventing a new precedence here
#: would be a semantic change nobody ruled.
BREAKOUT_ROUTE_ORDER = (
    auth.ROUTE_C_PREBREAK_DISPLACEMENT,
    auth.ROUTE_D_PREBREAK_RETEST,
    auth.ROUTE_B_BREAKOUT,
)

#: form -> the kernel's reason literal. Keyed on the FORM, never the route, because Route D has
#: two legal forms and naming an accepted-break-retest grant "PREBREAK_REPEAT_TEST" would put a
#: false evidence label on a real entry. The four pre-existing literals are unchanged - they are
#: pinned in frozen custody artifacts - and `break_retest` is the one grant path the kernel did
#: not previously have, so it gets its own name instead of borrowing another's.
REASON_BY_FORM = {
    brk.EXCEPTION_DISPLACEMENT: "PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE",
    brk.EXCEPTION_REPEAT_TEST: "PREBREAK_REPEAT_TEST_INTRA5_FORCE",
    brk.FORM_BREAK_RETEST: "ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE",
    brk.FORM_NORMAL_BREAKOUT: "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE",
    brk.VARIANT_BRK15: "WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE",
}


def completed_candle_window(full5: pd.DataFrame, ts: pd.Timestamp, n: int = 5) -> pd.DataFrame:
    return full5[full5.index <= ts].tail(n)[["open", "high", "low", "close"]].copy()


def authority_bars(history: pd.DataFrame, ts: pd.Timestamp, trigger) -> pd.DataFrame:
    """Completed history behind `ts`, with the still-forming bar as the last row.

    ALGO-033's split, in one place: the story is read on what the market has FINISHED saying and
    the forming bar carries force and follow-through only. Built here rather than at each call
    site so all four routes see the same frame - a second copy of this two-line join is how the
    X-ray came to disagree with the kernel about what it was reading.
    """
    prior = history[history.index < ts].tail(LOOKBACK)
    return pd.concat([prior, pd.DataFrame([trigger], index=[ts])])


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
    """Weak break -> completed 15m break/pullback -> LIVE force in forming bar 3.

    The read itself is now the state machine's, through Route B's BRK15 variant, so the variant
    is judged by the SAME derivation as every other route instead of by a second hand-rolled
    copy of the rule. That copy was measurably laxer: it never tested that the first break was
    WEAK, so a first break that already carried momentum geometry - the NORMAL breakout, which
    owes the second-5m extension test - could also enter here. ALGO-038/039 ruled weakness a
    REQUIREMENT precisely because a laxer second door to the same trade is how four route
    families quietly become five.

    Returns the force snapshot on a grant, as before, so callers are unchanged.
    """
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

    # The causal window is unchanged: completed parents from the break attempt up to the bar
    # now forming. The variant reads the LAST TWO, so they must be contiguous and bar 2 must be
    # the parent immediately before this one - the same adjacency the previous scan required.
    completed = h15[
        ((h15.index + pd.Timedelta(minutes=15)) >= pending.attempted_at)
        & ((h15.index + pd.Timedelta(minutes=15)) <= parent_start)
    ].copy()
    if len(completed) < 2:
        return None
    if completed.index[-1] + pd.Timedelta(minutes=15) != parent_start:
        return None
    if completed.index[-1] != completed.index[-2] + pd.Timedelta(minutes=15):
        return None

    bars15 = authority_bars(completed, parent_start, c)
    a = auth.decide(
        bars15, pending.direction, float(pending.zone_lo), float(pending.zone_hi),
        location_authorized=True, force_confirmed=True,
        body_frac=float(p.body_frac), close_loc=float(p.close_loc),
        reject_wick=float(p.reject_wick), lookback=LOOKBACK,
        route=auth.ROUTE_B_BREAKOUT, variant=auth.VARIANT_BRK15,
    )
    return snap if a.granted else None


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

    # v2.4 direct trader fidelity: the strategy does not use PDH/PDL/PWH/PWL.
    # Build only the causal premarket price-action structure/control prior.
    plan = build_premarket_plan_v24(full5, dte)
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

        # Structural key-zone state is frozen at the start of the forming 5m
        # candle. A role change caused by this candle cannot authorize itself.
        pre_locs: list[core.Location] = []
        for loc in authorized:
            if loc.zone is None:
                pre_locs.append(loc)
                continue
            before = zone_state_at_v24(loc.zone, full5, ts, p)
            if before.active:
                pre_locs.append(_as_location(loc, before))

        # Direct trader fidelity correction: completed 15m FVGs may themselves be
        # the causal S/R interaction band. They can form intraday, so unlike the
        # frozen pre-open S/R map they are refreshed only from FVGs fully known at
        # this 5m bucket start. They do not create trades by themselves; all normal
        # rejection/breakout story + force + structural-prior + room gates remain.
        known_ids = {x.id for x in pre_locs}
        for fvg_loc in active_fvg_interaction_locations(h15, ts):
            if fvg_loc.id not in known_ids:
                pre_locs.append(fvg_loc)
                known_ids.add(fvg_loc.id)

        # Every completed 1m inside the parent 5m is a causal decision clock.
        # The parent close itself is excluded: if force was not proven before the
        # close, this candle did not earn the trader's early momentum entry.
        for decision_time in decision_times(one, ts, 5, as_of):
            candidates: list[core.Candidate] = []

            # Rejection momentum is live: prior rejection/control event must be
            # complete, then the forming 5m must prove sustained directional force.
            # Route A's read is the state machine's: WAIT unless an approach, a real
            # interaction and a complete story are each PROVEN, and the story it carries is the
            # derived one - the evidence that actually authorized the entry.
            for direction, side in (("L", "S"), ("S", "R")):
                force = force_snapshot(one, ts, 5, direction, decision_time, p)
                if not force.confirmed:
                    continue
                partial = force.as_row(atr_ref)
                bars = authority_bars(full5, ts, partial)
                for loc in [x for x in pre_locs if x.side == side]:
                    # Both gates are supplied, never recomputed: `pre_locs` are already the
                    # authorized, still-active locations and force is confirmed above.
                    a = auth.decide(
                        bars, direction, float(loc.lo), float(loc.hi),
                        location_authorized=True, force_confirmed=True,
                        body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                        reject_wick=float(p.reject_wick), pad=float(pad), lookback=LOOKBACK,
                        route=auth.ROUTE_A_REJECTION,
                    )
                    if a.granted and plan_allows_v24(plan, direction, "REV", a.story, loc, p):
                        candidates.append(core.Candidate(
                            direction, "REV", loc, a.story, ts, decision_time,
                            "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
                        ))

            # Breakout/repeat-test/displacement momentum uses the same force gate.
            # For an opposing FVG this is the trader's "disrespect/clear it" path:
            # the FVG does not disappear merely because price touches it; normal
            # breakout proof and sustained force must establish clearance.
            for direction, side in (("L", "R"), ("S", "S")):
                force = force_snapshot(one, ts, 5, direction, decision_time, p)
                if not force.confirmed:
                    continue
                partial = force.as_row(atr_ref)
                bars = authority_bars(full5, ts, partial)
                for loc in [x for x in pre_locs if x.side == side]:
                    key = (direction, loc.id)
                    # Ask the machine route by route, in the kernel's own precedence, and take
                    # the first grant. The reason is read off the FORM the route actually
                    # proved, so an entry can never carry the label of evidence it does not
                    # have - Route D grants through two different forms.
                    reason = None
                    for route in BREAKOUT_ROUTE_ORDER:
                        a = auth.decide(
                            bars, direction, float(loc.lo), float(loc.hi),
                            location_authorized=True, force_confirmed=True,
                            body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                            reject_wick=float(p.reject_wick), pad=float(pad),
                            lookback=LOOKBACK, route=route,
                            range_ratio=float(p.range_ratio),
                        )
                        if a.granted:
                            reason = REASON_BY_FORM[a.form]
                            break

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
