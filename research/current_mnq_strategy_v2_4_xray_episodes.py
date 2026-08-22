#!/usr/bin/env python3
"""Episode-level de-duplication for the candidate X-ray — ALGO-011 §8. DIAGNOSTIC ONLY.

WHY THIS EXISTS. The X-ray reported 315 `SURVIVED_TO_RANKING` observations across 14 sessions
and I compared that to 7 trader trades as a "45:1 permission ratio". GPT ruled that comparison
inadmissible, and it is right: the X-ray re-evaluates the same route and location at every
successive 1-minute decision clock, so ONE PERSISTENT SETUP MANUFACTURES MANY OBSERVATIONS.
315 counts observations, not opportunities. Only a deduplicated episode count can support a
claim about how permissive the authorization layer is.

★ The error underneath is one I keep making: I divided two numbers that were not
  commensurable. 315 is a per-decision-clock count; 7 is a per-decision count.

THE GROUPING RULE, stated because it is a choice and not a fact:
    episode key = (session, direction, legal_route, location_id)
    a NEW episode starts when the gap between consecutive permission clocks for the same key
    exceeds EPISODE_GAP_MINUTES.
`EPISODE_GAP_MINUTES = 5` is one 5-minute parent bucket: two permissions more than a bucket
apart are separate interactions with the level rather than one continuous story. This is a
DIAGNOSTIC grouping parameter and never a strategy threshold. Sensitivity across
{1, 5, 15, 30} is reported so no conclusion rests on the choice.

A NOTE ON EXECUTABILITY. `would_be_executable_first_valid` marks the FIRST episode in a
session by first-permission clock. Under the real one-trade budget
(`current_mnq_strategy_v2_4_session_budget`) only that episode could ever reach execution;
every later one is visible to the X-ray only because the X-ray deliberately ignores the
budget. Per ALGO-011 §2 this may never be cited as evidence that production takes more than
one trade.
"""
from __future__ import annotations

from collections import defaultdict

import pandas as pd

EPISODE_GAP_MINUTES = 5
SENSITIVITY_GAPS = (1, 5, 15, 30)
DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Episode grouping is a reporting aid. It changes no production "
    "behaviour, defines no strategy threshold, and may not be cited as evidence about the "
    "one-trade-per-session budget. ALGO-011 §2 and §8."
)


def _episodes_for_gap(records: list[dict], session: str, gap_minutes: int) -> list[dict]:
    survivors = [r for r in records if r.get("outcome") == "SURVIVED_TO_RANKING"]
    keyed: dict[tuple, list[dict]] = defaultdict(list)
    for r in survivors:
        keyed[(r["route"], r["direction"], r.get("location_id"))].append(r)

    episodes: list[dict] = []
    for (route, direction, loc), rows in keyed.items():
        rows.sort(key=lambda x: x["clock"])
        cur: list[dict] = []
        for r in rows:
            if not cur:
                cur = [r]
                continue
            gap = (pd.Timestamp(r["clock"]) - pd.Timestamp(cur[-1]["clock"])).total_seconds()
            if gap > gap_minutes * 60:
                episodes.append(_close(cur, session, route, direction, loc))
                cur = [r]
            else:
                cur.append(r)
        if cur:
            episodes.append(_close(cur, session, route, direction, loc))

    episodes.sort(key=lambda e: e["first_permission_clock"])
    for i, e in enumerate(episodes):
        e["would_be_executable_first_valid"] = (i == 0)
    return episodes


def _close(rows: list[dict], session: str, route: str, direction: str, loc) -> dict:
    return {
        "session": session,
        "legal_route": route,
        "direction": direction,
        "location_id": loc,
        "location_source": rows[0].get("location_source"),
        "first_permission_clock": rows[0]["clock"],
        "last_permission_clock": rows[-1]["clock"],
        "repeated_decision_clock_observations": len(rows),
        "span_minutes": round(
            (pd.Timestamp(rows[-1]["clock"]) - pd.Timestamp(rows[0]["clock"])).total_seconds()
            / 60.0, 1),
    }


def episodes_for_session(xr: dict, gap_minutes: int = EPISODE_GAP_MINUTES) -> dict:
    """Deduplicate one session's X-ray into candidate EPISODES."""
    session = xr["meta"]["session"]
    records = xr["records"]
    eps = _episodes_for_gap(records, session, gap_minutes)

    # Candidates that never earned permission, grouped by the gate that killed them earliest.
    never: dict[str, int] = defaultdict(int)
    for r in records:
        if r.get("outcome") == "REJECTED" and r.get("killed_at"):
            never[r["killed_at"]] += 1

    sensitivity = {
        str(g): len(_episodes_for_gap(records, session, g)) for g in SENSITIVITY_GAPS
    }

    return {
        "session": session,
        "gap_minutes": gap_minutes,
        "raw_survivor_observations":
            sum(1 for r in records if r.get("outcome") == "SURVIVED_TO_RANKING"),
        "deduplicated_episodes": len(eps),
        "executable_under_one_trade_budget": sum(
            1 for e in eps if e["would_be_executable_first_valid"]),
        "episode_count_sensitivity_to_gap": sensitivity,
        "never_permitted_by_earliest_gate": dict(sorted(never.items())),
        "episodes": eps,
    }
