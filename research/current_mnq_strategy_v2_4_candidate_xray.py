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
from research.current_mnq_strategy_v2_4_entries import (
    breakout_followthrough_after_first_print,
    displacement_sequence_prebreak,
    repeat_test_momentum_prebreak,
    reversal_story_v24,
)
from research.current_mnq_strategy_v2_4_force import decision_times, force_snapshot
from research.current_mnq_strategy_v2_4_fvg_interaction import active_fvg_interaction_locations
from research.current_mnq_strategy_v2_4_kernel import (
    _as_location,
    _bucket_starts,
    _latest_completed_atr,
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
LEGAL_ROUTES = (ROUTE_A_REJECTION, ROUTE_B_BREAKOUT, ROUTE_C_DISPLACEMENT, ROUTE_D_RETEST)

# Earliest-gate vocabulary. A candidate dies at exactly one of these.
GATE_NO_FORCE = "FORCE_NOT_CONFIRMED"
GATE_NO_LOCATION = "NO_AUTHORIZED_LOCATION_ON_THIS_SIDE"
GATE_STORY_INCOMPLETE = "REJECTION_STORY_INCOMPLETE"
GATE_PLAN_VETO = "STRUCTURAL_PRIOR_VETO"
GATE_NO_ROUTE = "NO_LEGAL_ROUTE_MATCHED"
GATE_NOT_RANKED = "LOST_RANKING_TO_ANOTHER_CANDIDATE"


def xray_session(env: dict, dte: date, p: prod.Params,
                 as_of: pd.Timestamp | None = None) -> dict:
    """Return every candidate considered in one session, with its killing gate."""
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
    meta["premarket_primary"] = str(getattr(plan, "primary", "NEUTRAL"))
    meta["premarket_structure"] = str(getattr(plan, "pm_structure", ""))
    meta["authorized_locations"] = len(authorized)

    def rec(**kw):
        records.append(kw)

    for ts in bucket_starts:
        if ts.time() < core.TRADE_START:
            continue
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
            survivors: list[str] = []

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
                for loc in side_locs:
                    story = reversal_story_v24(full5, ts, partial, direction, loc, p, pad)
                    if not story.complete:
                        rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                            route=ROUTE_A_REJECTION, direction=direction,
                            location_id=str(loc.id), location_source=str(loc.source),
                            outcome="REJECTED", killed_at=GATE_STORY_INCOMPLETE,
                            story_flags=_story_flags(story))
                        continue
                    if not plan_allows_v24(plan, direction, "REV", story, loc, p):
                        rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                            route=ROUTE_A_REJECTION, direction=direction,
                            location_id=str(loc.id), location_source=str(loc.source),
                            outcome="REJECTED", killed_at=GATE_PLAN_VETO,
                            story_flags=_story_flags(story))
                        continue
                    tag = f"{ROUTE_A_REJECTION}|{direction}|{loc.id}"
                    survivors.append(tag)
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=ROUTE_A_REJECTION, direction=direction,
                        location_id=str(loc.id), location_source=str(loc.source),
                        outcome="SURVIVED_TO_RANKING", killed_at=None,
                        story_flags=_story_flags(story), tag=tag)

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
                for loc in side_locs:
                    disp = displacement_sequence_prebreak(full5, ts, partial, direction, loc, p, pad)
                    retest = False
                    if not disp:
                        retest = repeat_test_momentum_prebreak(
                            full5, ts, partial, direction, loc, p, pad)
                    post = breakout_followthrough_after_first_print(
                        full5, ts, partial, direction, loc, p)

                    if disp:
                        route = ROUTE_C_DISPLACEMENT
                    elif retest:
                        route = ROUTE_D_RETEST
                    elif post:
                        route = ROUTE_B_BREAKOUT
                    else:
                        rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                            route="B_C_D_BREAKOUT_FAMILY", direction=direction,
                            location_id=str(loc.id), location_source=str(loc.source),
                            outcome="REJECTED", killed_at=GATE_NO_ROUTE,
                            displacement=False, retest=False, post_break=False)
                        continue

                    if not plan_allows_v24(plan, direction, "BRK5", None, loc, p):
                        rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                            route=route, direction=direction,
                            location_id=str(loc.id), location_source=str(loc.source),
                            outcome="REJECTED", killed_at=GATE_PLAN_VETO)
                        continue
                    tag = f"{route}|{direction}|{loc.id}"
                    survivors.append(tag)
                    rec(bucket=ts.isoformat(), clock=decision_time.isoformat(),
                        route=route, direction=direction,
                        location_id=str(loc.id), location_source=str(loc.source),
                        outcome="SURVIVED_TO_RANKING", killed_at=None,
                        displacement=bool(disp), retest=bool(retest), post_break=bool(post),
                        tag=tag)

            # Ranking is where survivors compete. Losers are recorded, not discarded.
            if len(survivors) > 1:
                for r in records:
                    if r.get("tag") in survivors[1:] and r["outcome"] == "SURVIVED_TO_RANKING":
                        r["outcome"] = "REJECTED"
                        r["killed_at"] = GATE_NOT_RANKED

    return {"meta": meta, "records": records}


def _story_flags(story) -> dict:
    """Expose the story's self-reported states so §5 H1/H2/H6 can be tested."""
    return {k: bool(getattr(story, k, False))
            for k in ("complete", "approach", "takeover", "rejection", "momentum")}


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
