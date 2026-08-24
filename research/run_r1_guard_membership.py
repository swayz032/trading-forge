#!/usr/bin/env python3
"""THE TWO NEW MEMBERS R1 ADDED, named and tested against ALGO-070 (i)-(v). DIAGNOSTIC ONLY.

The ALGO-063 §4 guard failed on R1: forbidden-in-window rose 6 -> 8 at the 08:00 window. The
guard was declared "by membership", so ALGO-070 pre-registered the disposition BEFORE either row
was read: NAME the two new members and test each against

    (i)   a grant by the MATCHING family for the J3 interaction at that zone
    (ii)  on a taught story, with its predicate cited
    (iii) not a pre-window grant
    (iv)  not Route A on a BROKEN zone
    (v)   blocked by the one-bullet budget alone

BOTH pass -> R1 stands and the guard is replaced by its membership form. EITHER fails, or
UNCLASSIFIED -> R1 is REJECTED as written.

THE MEMBERS ARE FOUND BY DIFF, NOT BY GUESS. The X-ray is run over the same sessions at the
PRE-R1 pin in a read-only arena and at the current head, and the in-window grants are compared
by MEMBERSHIP on (bucket, clock, direction, location_id, route). Whatever is present now and
absent then is what R1 added - which is a measurement, where "the new ones must be the broken
zones" would be an assumption.

Run: PYTHONPATH=. python -m research.run_r1_guard_membership
"""
from __future__ import annotations

import io
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Names the grant attempts R1 added and tests them against the ALGO-070 "
    "membership clauses. Repairs nothing."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_r1_guard_membership_2026_08_23.json")

#: The SAME query run at the PRE-R1 pin e343dba8 in a read-only `git archive` arena, committed
#: so the diff is reproducible. Without it "these grants are new" would be an assumption, and
#: this module's own docstring promised a diff - a promise the first version did not keep.
PRE_R1 = Path("research/current_mnq_strategy_v2_4_pre_r1_in_window_grants_e343dba8.json")

#: The sessions whose forbidden-in-window count ROSE. Derived from the two scorecards, then
#: pinned here so the run is reproducible; the derivation is published beside them.
MEMBER_SESSIONS = ("2026-04-07", "2026-04-08")

ROUTE_A = "A_NORMAL_REJECTION"
BREAK_ROUTES = ("B_NORMAL_BREAKOUT", "C_PREBREAK_DISPLACEMENT", "D_PREBREAK_RETEST_BREAKOUT")


def _key(r):
    return (r.get("bucket"), r.get("clock"), r.get("direction"),
            r.get("location_id"), r.get("route"))


def _grants_in_window(env, session: str, p, window) -> dict:
    """Every candidate that SURVIVED TO RANKING inside the replay window, keyed for membership."""
    recs = xray_session(env, date.fromisoformat(session), p)["records"]
    lo, hi = pd.Timestamp(window["start"]), pd.Timestamp(window["end"])
    out = {}
    for r in recs:
        if r.get("outcome") != "SURVIVED_TO_RANKING":
            continue
        clock = r.get("clock")
        if not clock:
            continue
        if lo <= pd.Timestamp(clock) <= hi:
            out[_key(r)] = r
    return out


def main() -> int:
    t0 = time.perf_counter()
    manifest = {c["session"]: c for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    cases = {c["session"]: c for c in json.load(io.open(SCORECARD, encoding="utf-8"))["cases"]}

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    pre = json.load(io.open(PRE_R1, encoding="utf-8"))

    rows = []
    for session in MEMBER_SESSIONS:
        case = cases[session]
        win = {"start": manifest[session]["replay_start"], "end": manifest[session]["replay_end"]}
        grants = _grants_in_window(env, session, p, win)
        bf = case.get("budget_faithful") or {}

        pre_keys = {tuple(k) for k in pre.get(session, [])}
        new_keys = set(grants) - pre_keys
        vanished = pre_keys - set(grants)

        members = []
        for k, r in grants.items():
            bucket, clock, direction, loc_id, route = k
            zone_state = r.get("zone_state_at_bucket")
            family = ("REJECT" if route == ROUTE_A else
                      "BREAK" if (route in BREAK_ROUTES or r.get("variant")) else None)
            members.append({
                "session": session,
                "is_NEW_since_pre_R1": k in new_keys,
                "bucket": bucket,
                "clock": clock,
                "direction": direction,
                "location_id": loc_id,
                "location_band": [r.get("location_lo"), r.get("location_hi")],
                "location_source": r.get("location_source"),
                "route": route,
                "family": family,
                "form": r.get("form"),
                "reason": r.get("reason"),
                "routes_asked": r.get("routes_asked"),
                "route_refusals": r.get("route_refusals"),
                "authority_state": r.get("authority_state"),
                "zone_state_recorded": zone_state,
                # (iv) Route A on a BROKEN zone would be the disqualifying shape.
                "clause_iv_not_route_A_on_a_broken_zone": route != ROUTE_A,
                # (i) the family must match the interaction the route claims.
                "clause_i_grant_by_a_break_family_route": family == "BREAK",
                # (iii) the grant is INSIDE the replay window by construction of this query.
                "clause_iii_not_a_pre_window_grant": True,
            })

        rows.append({
            "session": session,
            "trader_state": case["trader_state"],
            "bot_state_in_window": case["bot_state_in_window"],
            "mismatch_class": case["mismatch_class"],
            "censored": str(case["mismatch_class"]).startswith("CENSORED"),
            "replay_window": win,
            "budget_faithful": bf,
            # (v) the bullet was spent BEFORE the window, so nothing here could execute.
            "clause_v_blocked_by_the_one_bullet_budget_alone": bool(
                bf.get("bullet_spent_before_window") and not bf.get("executable_in_window")),
            "session_first_entry_time": bf.get("session_first_entry_time"),
            "in_window_grants_found": len(grants),
            "in_window_grants_at_the_PRE_R1_pin": len(pre_keys),
            "grants_ADDED_by_R1": len(new_keys),
            "grants_REMOVED_by_R1": sorted(str(v) for v in vanished),
            "forbidden_counter_delta_for_this_session": (
                (bf.get("in_window_entries_the_budget_forbids", 0))),
            "note_on_the_two_numbers": (
                "the number of GRANT ATTEMPTS R1 added and the rise in the forbidden COUNTER "
                "are different quantities and are both reported; the counter is what the guard "
                "was written against"),
            "members": members,
        })

    out = {
        "artifact": "R1_GUARD_MEMBERSHIP",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-070 pre-registered membership disposition",
        "produced": "2026-08-23",
        "guard_that_failed": "ALGO-063 §4: forbidden-in-window may not rise. It rose 6 -> 8.",
        "how_the_member_sessions_were_found": (
            "per-session diff of `budget_faithful.in_window_entries_the_budget_forbids` between "
            "the committed 08:00 exam arm (BEFORE R1) and the canonical scorecard re-run AFTER "
            "R1: 2026-04-07 rose 0 -> 1 and 2026-04-08 rose 0 -> 1; every other session is "
            "unchanged. Totals 6 -> 8."),
        "clauses": {
            "i": "a grant by the MATCHING family for the J3 interaction at that zone",
            "ii": "on a taught story, with its predicate cited",
            "iii": "not a pre-window grant",
            "iv": "not Route A on a BROKEN zone",
            "v": "blocked by the one-bullet budget alone",
        },
        "rows": rows,
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for r in rows:
        print(f"\n=== {r['session']}  trader={r['trader_state']}  "
              f"bot={r['bot_state_in_window']}  class={r['mismatch_class']} ===")
        print(f"    replay window : {r['replay_window']['start']} .. {r['replay_window']['end']}")
        print(f"    bullet spent  : {r['session_first_entry_time']}  "
              f"(clause v: {r['clause_v_blocked_by_the_one_bullet_budget_alone']})")
        print(f"    in-window grants found: {r['in_window_grants_found']}")
        for m in r["members"]:
            print(f"      {m['clock'][11:16]} bucket {str(m['bucket'])[11:16]} "
                  f"dir={m['direction']} route={m['route']} family={m['family']}")
            print(f"        zone {m['location_id']} {m['location_band']} "
                  f"({m['location_source']})")
            print(f"        form={m['form']}  reason={m['reason']}")
            print(f"        (i) break-family grant: {m['clause_i_grant_by_a_break_family_route']}"
                  f"   (iii) in-window: {m['clause_iii_not_a_pre_window_grant']}"
                  f"   (iv) not RouteA-on-broken: "
                  f"{m['clause_iv_not_route_A_on_a_broken_zone']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
