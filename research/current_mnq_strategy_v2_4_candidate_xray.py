#!/usr/bin/env python3
"""Candidate X-ray — ALGO-009 §4. DIAGNOSTIC ONLY. Changes no production behaviour.

The canonical 14-case baseline says the kernel's failure is one-sided: it misses ZERO trader
entries and produces nine it should not. The one-trade-per-session bullet then hides every
later candidate, so the score alone cannot say WHICH permission the machine is granting that
the trader's brain does not.

This module answers that. It walks the same causal loop as
`kernel.iter_actionable_candidates`, calling THE SAME gate functions, and records every
candidate considered at every decision clock together with the EARLIEST SEMANTIC GATE that
killed it. It never yields a trade, never consumes a bullet, and is never imported by
production.

WHY IT MIRRORS RATHER THAN WRAPS: the kernel yields only the single ranked winner per clock
and discards the rest, so a wrapper cannot see rejected candidates. The mirror imports the
identical gate functions, so a semantic change in production cannot silently diverge from the
X-ray without changing both call sites. `test_..._candidate_xray.py` pins that correspondence.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_candidate_xray
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_entry_authority as auth
from research.current_mnq_strategy_v2_4_entries import (
    breakout_failed,
    weak_first_break_print,
)
from research.current_mnq_strategy_v2_4_force import decision_times, force_snapshot
from research.current_mnq_strategy_v2_4_fvg_interaction import active_fvg_interaction_locations
from research.current_mnq_strategy_v2_4_kernel import (
    BREAKOUT_ROUTE_ORDER,
    LOOKBACK,
    REASON_BY_FORM,
    _as_location,
    _bucket_starts,
    _intra15_confirmation,
    _latest_completed_atr,
    _rank_and_yield,
    authority_bars,
)
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_premarket import build_premarket_plan_v24, plan_allows_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = prod.core

# The legal terminal routes. ALGO-009 §3: there is no fifth.
ROUTE_A_REJECTION = "A_NORMAL_REJECTION"
ROUTE_B_BREAKOUT = "B_NORMAL_BREAKOUT"
ROUTE_C_DISPLACEMENT = "C_PREBREAK_DISPLACEMENT"
ROUTE_D_RETEST = "D_PREBREAK_RETEST_BREAKOUT"

# ALGO-020 section 2 RULED: BRK15 is a VARIANT of Route B, not a fifth route. ALGO-009 section 3
# forbids new pre-break PERMISSION paths; it does not forbid mirroring a route the kernel already
# ranks (`kernel.py:115` ranks BRK5=3 > BRK15=2 > REV=1 and `:242` builds the candidates).
# Recording it under Route B with an explicit variant tag keeps the four-route taxonomy intact
# and stops the X-ray under-counting a family that OUTRANKS every reversal.
VARIANT_BRK15 = "BRK15_WEAK_FIRST_BREAK_CONTINUATION"
LEGAL_ROUTES = (ROUTE_A_REJECTION, ROUTE_B_BREAKOUT, ROUTE_C_DISPLACEMENT, ROUTE_D_RETEST)

# Earliest-gate vocabulary. A candidate dies at exactly one of these.
GATE_NO_FORCE = "FORCE_NOT_CONFIRMED"
GATE_NO_LOCATION = "NO_AUTHORIZED_LOCATION_ON_THIS_SIDE"
GATE_STORY_INCOMPLETE = "REJECTION_STORY_INCOMPLETE"
GATE_PLAN_VETO = "STRUCTURAL_PRIOR_VETO"
GATE_NO_ROUTE = "NO_LEGAL_ROUTE_MATCHED"
GATE_NOT_RANKED = "LOST_RANKING_TO_ANOTHER_CANDIDATE"
GATE_DIRECTION_CONFLICT = "BOTH_DIRECTIONS_PERMITTED_KERNEL_YIELDS_NOTHING"
GATE_PAST_LAST_ENTRY = "DECISION_CLOCK_PAST_LAST_ENTRY"
GATE_PENDING_EXPIRED = "WEAK_BREAK_PENDING_WINDOW_EXPIRED"
GATE_NO_INTRA15_FORCE = "INTRA_15M_FORCE_NOT_CONFIRMED"


def xray_session(env: dict, dte: date, p: prod.Params,
                 as_of: pd.Timestamp | None = None,
                 on_rejection_candidate=None,
                 on_breakout_candidate=None) -> dict:
    """Return every candidate considered in one session, with its killing gate.

    `on_rejection_candidate(record, **inputs)` is an OPTIONAL diagnostic hook fired for each
    Route A candidate that reaches ranking, carrying the live objects the story was evaluated
    on. It exists so a downstream diagnostic never has to RE-WALK this loop: a duplicated loop
    is precisely how the ranking rule came to diverge from the kernel's. The hook cannot
    change any outcome, and when it is None this function behaves exactly as before.

    `on_breakout_candidate(record, **inputs)` is the same thing for the B/C/D family, added
    when those routes were derived. Same reason and same guarantee: without it a breakout
    census would have to re-walk this loop, and a re-walked loop is what diverged last time.
    It also carries `kernel_route`, so a census can ask whether the kernel and the derivation
    agree on WHICH route this is - a question that cannot be asked from a re-walk at all.
    """
    full5, r5, h15, one = env["full5"], env["r5"], env["h15"], env["one"]
    records: list[dict] = []
    meta = {"session": str(dte), "aborted": None}

    bucket_starts = _bucket_starts(r5, one, dte, as_of)
    if not bucket_starts:
        meta["aborted"] = "NO_BUCKET_STARTS"
        return {"meta": meta, "records": records}

    open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    if full5.empty or open_ts - full5.index.min() < pd.Timedelta(days=core.MIN_WARMUP_DAYS):
        meta["aborted"] = "INSUFFICIENT_WARMUP"
        return {"meta": meta, "records": records}

    plan = build_premarket_plan_v24(full5, dte)
    locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    # BRK15 pending state, mirroring `iter_actionable_candidates` exactly. Without it the
    # X-ray produced NO BRK15 candidate at all, so a rank-2 continuation never competed
    # against a rank-1 reversal and never triggered the direction-conflict veto.
    pending: dict = {}
    pending_locs: dict = {}
    completed_session = r5[r5.index.date == dte]
    meta["premarket_primary"] = str(getattr(plan, "primary", "NEUTRAL"))
    meta["premarket_structure"] = str(getattr(plan, "pm_structure", ""))
    meta["authorized_locations"] = len(authorized)

    def rec(**kw):
        records.append(kw)
        return kw

    for ts in bucket_starts:
        if ts.time() < core.TRADE_START:
            continue
        bar_close = ts + pd.Timedelta(minutes=5)
        atr_ref = _latest_completed_atr(full5, ts)
        if atr_ref is None or not np.isfinite(atr_ref):
            continue
        pad = max(core.TICK * 2, p.touch_pad_atr * float(atr_ref))

        pre_locs: list[core.Location] = []
        for loc in authorized:
            if loc.zone is None:
                pre_locs.append(loc)
                continue
            before = zone_state_at_v24(loc.zone, full5, ts, p)
            if before.active:
                pre_locs.append(_as_location(loc, before))
        known = {x.id for x in pre_locs}
        for fvg_loc in active_fvg_interaction_locations(h15, ts):
            if fvg_loc.id not in known:
                pre_locs.append(fvg_loc)
                known.add(fvg_loc.id)

        for decision_time in decision_times(one, ts, 5, as_of):
            # (tag, the core.Candidate the kernel would build, this record) — the ranker
            # is the KERNEL'S OWN `_rank_and_yield`, never a local re-implementation.
            survivors: list[tuple] = []

            # ---- ROUTE A: normal rejection -------------------------------------------
            for direction, side in (("L", "S"), ("S", "R")):
                force = force_snapshot(one, ts, 5, direction, decision_time, p)
                side_locs = [x for x in pre_locs if x.side == side]
                if not force.confirmed:
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=ROUTE_A_REJECTION, direction=direction,
                        location_id=None, location_source=None,
                        outcome="REJECTED", killed_at=GATE_NO_FORCE,
                        locations_on_side=len(side_locs))
                    continue
                if not side_locs:
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=ROUTE_A_REJECTION, direction=direction,
                        location_id=None, location_source=None,
                        outcome="REJECTED", killed_at=GATE_NO_LOCATION,
                        locations_on_side=0)
                    continue
                partial = force.as_row(atr_ref)
                bars = authority_bars(full5, ts, partial)
                for loc in side_locs:
                    # THE SAME AUTHORITY THE KERNEL ASKS, on the same frame. Both gates are
                    # supplied rather than recomputed, exactly as the kernel supplies them.
                    a = auth.decide(
                        bars, direction, float(loc.lo), float(loc.hi),
                        location_authorized=True, force_confirmed=True,
                        body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                        reject_wick=float(p.reject_wick), pad=float(pad), lookback=LOOKBACK,
                        route=auth.ROUTE_A_REJECTION,
                    )
                    story = a.story
                    if not a.granted:
                        # The machine names the EARLIEST unmet step, which is strictly more
                        # information than the single old gate token. The token is kept so the
                        # earliest-gate census stays comparable across the wiring, and the
                        # machine's own state and refusal ride alongside it.
                        rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                            route=ROUTE_A_REJECTION, direction=direction,
                            location_id=str(loc.id), location_source=str(loc.source),
                            location_lo=float(loc.lo), location_hi=float(loc.hi),
                            outcome="REJECTED", killed_at=GATE_STORY_INCOMPLETE,
                            authority_state=a.state, authority_refusal=a.reason,
                            story_flags=_story_flags(story))
                        continue
                    if not plan_allows_v24(plan, direction, "REV", story, loc, p):
                        rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                            route=ROUTE_A_REJECTION, direction=direction,
                            location_id=str(loc.id), location_source=str(loc.source),
                            location_lo=float(loc.lo), location_hi=float(loc.hi),
                            outcome="REJECTED", killed_at=GATE_PLAN_VETO,
                            story_flags=_story_flags(story))
                        continue
                    tag = f"{ROUTE_A_REJECTION}|{direction}|{loc.id}"
                    r_ = rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                             route=ROUTE_A_REJECTION, direction=direction,
                             location_id=str(loc.id), location_source=str(loc.source),
                            location_lo=float(loc.lo), location_hi=float(loc.hi),
                             outcome="SURVIVED_TO_RANKING", killed_at=None,
                             authority_state=a.state, authority_refusal=None,
                             story_flags=_story_flags(story), tag=tag)
                    survivors.append((tag, core.Candidate(
                        direction, "REV", loc, story, ts, decision_time,
                        "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE"), r_))
                    if on_rejection_candidate is not None:
                        on_rejection_candidate(r_, full5=full5, ts=ts, row=partial,
                                               direction=direction, loc=loc, p=p, pad=pad)

            # ---- ROUTES B / C / D: breakout family ------------------------------------
            for direction, side in (("L", "R"), ("S", "S")):
                force = force_snapshot(one, ts, 5, direction, decision_time, p)
                side_locs = [x for x in pre_locs if x.side == side]
                if not force.confirmed:
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route="B_C_D_BREAKOUT_FAMILY", direction=direction,
                        location_id=None, location_source=None,
                        outcome="REJECTED", killed_at=GATE_NO_FORCE,
                        locations_on_side=len(side_locs))
                    continue
                if not side_locs:
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route="B_C_D_BREAKOUT_FAMILY", direction=direction,
                        location_id=None, location_source=None,
                        outcome="REJECTED", killed_at=GATE_NO_LOCATION,
                        locations_on_side=0)
                    continue
                partial = force.as_row(atr_ref)
                bars = authority_bars(full5, ts, partial)
                for loc in side_locs:
                    # The kernel's own route precedence, asked of the same authority. The
                    # per-route refusals are all recorded: a family rejection that says only
                    # "no legal route" hides WHICH door was closest to opening.
                    route = None
                    form = None
                    refusals: dict[str, str] = {}
                    # WHICH ROUTES WERE ACTUALLY ASKED, recorded rather than inferred. The
                    # loop stops at the first grant, so a candidate that Route C granted was
                    # never put to Route D at all. A consumer selecting a route's CONSIDERED
                    # population must join on this fact; inferring it from a gate token would
                    # be a guess about control flow that lives in another file (ALGO-054).
                    asked: list[str] = []
                    for candidate_route in BREAKOUT_ROUTE_ORDER:
                        asked.append(candidate_route)
                        a = auth.decide(
                            bars, direction, float(loc.lo), float(loc.hi),
                            location_authorized=True, force_confirmed=True,
                            body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                            reject_wick=float(p.reject_wick), pad=float(pad),
                            lookback=LOOKBACK, route=candidate_route,
                            range_ratio=float(p.range_ratio),
                        )
                        if a.granted:
                            route, form = candidate_route, a.form
                            break
                        refusals[candidate_route] = a.reason

                    if route is None:
                        r_ = rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                                 route="B_C_D_BREAKOUT_FAMILY", direction=direction,
                                 location_id=str(loc.id), location_source=str(loc.source),
                            location_lo=float(loc.lo), location_hi=float(loc.hi),
                                 outcome="REJECTED", killed_at=GATE_NO_ROUTE,
                                 routes_asked=list(asked), route_refusals=refusals)
                        # ALGO-054: the hook fires on the REFUSAL branch too. A parameter
                        # sensitivity run whose population is the set of candidates the
                        # CURRENT value granted can never see a grant appear at a laxer value,
                        # so its monotonicity would hold BY CONSTRUCTION rather than by
                        # measurement. CONSIDERED, not granted.
                        if on_breakout_candidate is not None:
                            on_breakout_candidate(r_, full5=full5, ts=ts, row=partial,
                                                  direction=direction, loc=loc, p=p, pad=pad,
                                                  kernel_route=None)
                        continue

                    if not plan_allows_v24(plan, direction, "BRK5", None, loc, p):
                        # The ROUTE granted here and the PLAN vetoed. For a route-parameter
                        # sensitivity that is still a candidate the route CONSIDERED, so it
                        # carries `routes_asked` and fires the hook like the others.
                        r_ = rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                                 route=route, direction=direction,
                                 location_id=str(loc.id), location_source=str(loc.source),
                            location_lo=float(loc.lo), location_hi=float(loc.hi),
                                 outcome="REJECTED", killed_at=GATE_PLAN_VETO,
                                 routes_asked=list(asked), form=form)
                        if on_breakout_candidate is not None:
                            on_breakout_candidate(r_, full5=full5, ts=ts, row=partial,
                                                  direction=direction, loc=loc, p=p, pad=pad,
                                                  kernel_route=route)
                        continue
                    tag = f"{route}|{direction}|{loc.id}"
                    r_ = rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                             route=route, direction=direction,
                             location_id=str(loc.id), location_source=str(loc.source),
                            location_lo=float(loc.lo), location_hi=float(loc.hi),
                             outcome="SURVIVED_TO_RANKING", killed_at=None,
                             form=form, reason=REASON_BY_FORM[form],
                             routes_asked=list(asked), route_refusals=refusals, tag=tag)
                    survivors.append((tag, core.Candidate(
                        direction, "BRK5", loc, None, ts, decision_time, route), r_))
                    # MIRROR THE KERNEL: a BRK5 candidate on this key CONSUMES the pending
                    # weak-break attempt (`kernel.py` pops it at the same point). Without this
                    # the X-ray keeps the pending alive and the BRK15 block below can emit a
                    # SECOND candidate for the same (direction, location) that the kernel
                    # would never produce. Found by the independent grader; on this corpus it
                    # changes nothing because zero BRK15 candidates survive, so it is a LATENT
                    # divergence rather than a wrong number - which is exactly when to fix it.
                    pending.pop((direction, loc.id), None)
                    pending_locs.pop((direction, loc.id), None)
                    if on_breakout_candidate is not None:
                        on_breakout_candidate(r_, full5=full5, ts=ts, row=partial,
                                              direction=direction, loc=loc, p=p, pad=pad,
                                              kernel_route=route)

            # ---- BRK15: pending weak-first-break 15m continuation ----------------------
            # Route B variant. Uses LIVE force in bar 3 through a FIFTEEN-minute parent.
            for key, pen in list(pending.items()):
                loc = pending_locs[key]
                if decision_time - pen.attempted_at > pd.Timedelta(minutes=60):
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=ROUTE_B_BREAKOUT, variant=VARIANT_BRK15,
                        direction=pen.direction, location_id=str(loc.id),
                        location_source=str(loc.source),
                        outcome="REJECTED", killed_at=GATE_PENDING_EXPIRED)
                    pending.pop(key, None)
                    pending_locs.pop(key, None)
                    continue
                force15 = _intra15_confirmation(h15, one, pen, decision_time, p)
                if force15 is None:
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=ROUTE_B_BREAKOUT, variant=VARIANT_BRK15,
                        direction=pen.direction, location_id=str(loc.id),
                        location_source=str(loc.source),
                        outcome="REJECTED", killed_at=GATE_NO_INTRA15_FORCE)
                    continue
                if not plan_allows_v24(plan, pen.direction, "BRK15", None, loc, p):
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=ROUTE_B_BREAKOUT, variant=VARIANT_BRK15,
                        direction=pen.direction, location_id=str(loc.id),
                        location_source=str(loc.source),
                        outcome="REJECTED", killed_at=GATE_PLAN_VETO)
                    continue
                tag = f"{ROUTE_B_BREAKOUT}|{VARIANT_BRK15}|{pen.direction}|{loc.id}"
                r_ = rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                         route=ROUTE_B_BREAKOUT, variant=VARIANT_BRK15,
                         direction=pen.direction, location_id=str(loc.id),
                         location_source=str(loc.source),
                         outcome="SURVIVED_TO_RANKING", killed_at=None, tag=tag)
                survivors.append((tag, core.Candidate(
                    pen.direction, "BRK15", loc, None, pen.attempted_at, decision_time,
                    "WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE"), r_))
                if on_breakout_candidate is not None:
                    # The BRK15 trigger is a FIFTEEN-minute parent, not a forming 5m partial,
                    # so this carries `h15` and sets `row=None`. A consumer shaped for 5m must
                    # SKIP variant records explicitly and count what it skipped - silently
                    # dropping them is how a whole family goes unmeasured. Until the window
                    # amendment no BRK15 candidate ever survived on this corpus, so the gap
                    # was invisible; at 08:00 they survive and the missing hook surfaced as a
                    # BREAKOUT_GRANT_WITHOUT_INPUTS abort, which is the guard working.
                    on_breakout_candidate(r_, full5=full5, h15=h15, ts=ts, row=None,
                                          direction=pen.direction, loc=loc, p=p, pad=pad,
                                          kernel_route=ROUTE_B_BREAKOUT,
                                          variant=VARIANT_BRK15, pending=pen)
                pending.pop(key, None)
                pending_locs.pop(key, None)

            # ---- RANKING: the kernel's own `_rank_and_yield`, not a local rule ---------
            # PREVIOUSLY THIS WAS WRONG IN FOUR WAYS and a positive control caught it:
            #   (a) it kept `survivors[0]` — LIST ORDER — while the kernel takes the MAX by
            #       (BRK5=3 > BRK15=2 > REV=1, location.quality, location.confluence). Route A
            #       is appended first and is REV, the LOWEST rank, so whenever a breakout
            #       coexisted the X-ray recorded the OPPOSITE winner from the one that trades.
            #   (b) it had no direction-conflict veto. The kernel yields NOTHING when both
            #       directions have candidates at one clock; the X-ray granted one anyway.
            #   (c) it had no decision-clock LAST_ENTRY cutoff. `_bucket_starts` filters BUCKET
            #       starts, but a 1-minute decision clock inside a legal bucket can still fall
            #       past LAST_ENTRY, and the kernel refuses those.
            #   (d) it demoted by scanning ALL accumulated `records` for a matching tag, so a
            #       tag that WON at an earlier clock was retroactively demoted when the same
            #       tag lost at a later one.
            # Calling the kernel's function removes all four and makes a future divergence a
            # test failure rather than a silent one.
            if survivors:
                chosen = _rank_and_yield([c for _, c, _ in survivors], decision_time,
                                         plan, as_of)
                if chosen is None:
                    gate = (GATE_DIRECTION_CONFLICT
                            if len({c.direction for _, c, _ in survivors}) != 1
                            else GATE_PAST_LAST_ENTRY)
                    for _, _, r_ in survivors:
                        r_["outcome"] = "REJECTED"
                        r_["killed_at"] = gate
                else:
                    won = chosen[0]
                    for _, cand, r_ in survivors:
                        if cand is not won:
                            r_["outcome"] = "REJECTED"
                            r_["killed_at"] = GATE_NOT_RANKED

        # Only a COMPLETED weak first break can arm the 15m continuation path.
        if ts in completed_session.index and (as_of is None or bar_close <= as_of):
            r = completed_session.loc[ts]
            for direction, side in (("L", "R"), ("S", "S")):
                for loc in [x for x in pre_locs if x.side == side]:
                    key = (direction, loc.id)
                    if weak_first_break_print(full5, ts, r, direction, loc, p):
                        pending.setdefault(key, core.PendingBreakout(
                            direction, loc.id, bar_close, loc.lo, loc.hi))
                        pending_locs.setdefault(key, loc)
            # Fail-closed invalidation for already-pending attempts.
            for key, pen in list(pending.items()):
                if breakout_failed(r, pen.direction, pen.zone_lo, pen.zone_hi):
                    pending.pop(key, None)
                    pending_locs.pop(key, None)

    return {"meta": meta, "records": records}


def _story_flags(story) -> dict:
    """Expose the story's self-reported states so §5 H1/H2/H6 can be tested.

    Re-keyed to the DERIVED story's vocabulary when the wiring made that the story the kernel
    actually reads. The old keys (`takeover`, `rejection`, `momentum`) belonged to the legacy
    `core.Story`; kept as a `getattr` default they would have reported a confident `False` for
    three states the object does not model at all, which is worse than not reporting them.
    `interaction` is the named form the entry earned, and it is the field this census is for.
    """
    if story is None:
        return {}
    flags = {k: bool(getattr(story, k, False))
             for k in ("complete", "approach", "fight", "decision")}
    flags["interaction"] = getattr(story, "interaction", None)
    flags["all_kinds"] = list(getattr(story, "all_kinds", ()) or ())
    flags["two_sided_conflict"] = bool(getattr(story, "two_sided_conflict", False))
    return flags


def summarise(xr: dict) -> dict:
    """Earliest-gate census for one session."""
    recs = xr["records"]
    gates: dict[str, int] = {}
    for r in recs:
        k = r.get("killed_at") or "SURVIVED_TO_RANKING"
        gates[k] = gates.get(k, 0) + 1
    routes: dict[str, int] = {}
    for r in recs:
        if r["outcome"] == "SURVIVED_TO_RANKING":
            routes[r["route"]] = routes.get(r["route"], 0) + 1
    return {
        "session": xr["meta"]["session"],
        "total_candidate_evaluations": len(recs),
        "earliest_gate_census": dict(sorted(gates.items())),
        "surviving_by_route": dict(sorted(routes.items())),
        "premarket_primary": xr["meta"].get("premarket_primary"),
        "authorized_locations": xr["meta"].get("authorized_locations"),
    }
