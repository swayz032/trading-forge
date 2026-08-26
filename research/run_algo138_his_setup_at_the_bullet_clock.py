#!/usr/bin/env python3
"""WHAT WAS HIS SETUP DOING AT THE MOMENT THE BULLET WAS SPENT? DIAGNOSTIC ONLY. BY KEY.

ALGO-137's one remaining measurement. His setup is the ZONE REJECTION — Route A. The bullet on
every one of the five measured sessions went to a break-family route. The question is not why the
break won a comparison (there is no comparison: one candidate per decision clock,
`kernel.py:311`). It is whether HIS setup was even on the table at that instant.

PRE-REGISTERED BEFORE THIS RAN, and the two branches point at different worlds:

  A_NOT_AVAILABLE   no Route A candidate survived at that clock ⇒ ARRIVAL ORDER IS THE WHOLE
                    ANSWER. The break simply happened first, and no clause repairs that — it is a
                    fact about the market, not a defect.
  A_REFUSED         a Route A attempt existed and something killed it ⇒ THAT REFUSAL IS THE
                    FINDING, and it has a name.
  RESIDUAL          anything fitting neither. REQUIRED. A three-branch pre-registration without a
                    residual put 91% of its own population in the wrong branch this morning.

AND ONE THING THE BRANCHES DO NOT COVER, REPORTED BESIDE THEM: whether a zone rejection EVER
became available later in the session, after the bullet was already gone. That is the difference
between "his setup never appeared" and "his setup appeared and could not be taken".

EVIDENCE GRADE: ARTIFACT-SOURCED from the X-ray, NOT measured at the kernel. ALGO-096 established
an evaluation-order difference between the two, and it bounds every count here.

Run: PYTHONPATH=. python -m research.run_algo138_his_setup_at_the_bullet_clock
"""
from __future__ import annotations

import io
import json
import time
from collections import Counter
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
CENSUS = Path("research/current_mnq_strategy_v2_4_algo137_bullet_census_RELAND.json")
OUT = Path("research/current_mnq_strategy_v2_4_algo138_his_setup_at_the_bullet_clock.json")

ROUTE_A = "A_NORMAL_REJECTION"


def main() -> int:
    t0 = time.perf_counter()
    census = json.load(io.open(CENSUS, encoding="utf-8"))["rows"]
    old.verify_manifest(old.download_pinned(DATA, include_tick=False),
                        json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    rows = []
    for c in census:
        s = c["session"]
        bullet = pd.Timestamp(c["bullet_entry"])
        recs = xray_session(env, date.fromisoformat(s), p)["records"]

        at_clock = [r for r in recs if r.get("clock") == bullet.isoformat()]
        a_at_clock = [r for r in at_clock if r.get("route") == ROUTE_A]
        a_survived_at_clock = [r for r in a_at_clock
                               if r.get("outcome") == "SURVIVED_TO_RANKING"]

        # Did his setup EVER survive in this session, and when relative to the bullet?
        a_survived_any = sorted(
            (r for r in recs
             if r.get("route") == ROUTE_A and r.get("outcome") == "SURVIVED_TO_RANKING"
             and r.get("clock")),
            key=lambda r: r["clock"])
        first_a = a_survived_any[0]["clock"] if a_survived_any else None

        if a_survived_at_clock:
            branch = "RESIDUAL"
            why = ("a Route A candidate SURVIVED at the same clock as the break, which the "
                   "one-candidate-per-clock measurement says cannot happen - instrument conflict")
        elif a_at_clock:
            branch = "A_REFUSED"
            why = "his setup was attempted at that clock and something killed it"
        else:
            branch = "A_NOT_AVAILABLE"
            why = "no Route A attempt reached the recorder at that clock at all"

        rows.append({
            "session": s,
            "bullet_clock": bullet.isoformat(),
            "bullet_setup": c.get("kernel_setup"),
            "bullet_reason": c.get("candidate_reason"),
            "BRANCH": branch,
            "why": why,
            "route_A_attempts_at_the_bullet_clock": len(a_at_clock),
            "route_A_killed_at_counts": dict(Counter(
                str(r.get("killed_at")) for r in a_at_clock)),
            "route_A_by_key": [
                {"location_id": r.get("location_id"), "location_source": r.get("location_source"),
                 "outcome": r.get("outcome"), "killed_at": r.get("killed_at"),
                 "authority_state": r.get("authority_state"),
                 "authority_refusal": r.get("authority_refusal")}
                for r in a_at_clock],
            "records_at_that_clock_any_route": len(at_clock),
            "routes_present_at_that_clock": dict(Counter(
                str(r.get("route")) for r in at_clock)),
            "his_setup_EVER_survived_this_session": bool(a_survived_any),
            "first_route_A_survivor_clock": first_a,
            "that_survivor_is_AFTER_the_bullet": (
                bool(first_a and pd.Timestamp(first_a) > bullet)),
        })
        print(f"  {s}  bullet {str(bullet)[11:16]} {c.get('kernel_setup'):5s} -> {branch:16s} "
              f"routeA_at_clock={len(a_at_clock):3d}  first_A_survivor="
              f"{(first_a or '-')[11:19]}", flush=True)

    branches = Counter(r["BRANCH"] for r in rows)
    artifact = {
        "artifact": "ALGO138_HIS_SETUP_AT_THE_BULLET_CLOCK",
        "status": "DIAGNOSTIC ONLY. Reports by key. Derives nothing, proposes nothing.",
        "authority": "ALGO-137",
        "evidence_grade": "ARTIFACT-SOURCED from the X-ray, NOT measured at the kernel "
                          "(ALGO-096 evaluation-order difference bounds it)",
        "pre_registered_branches": {
            "A_NOT_AVAILABLE": "arrival order is the whole answer; no clause repairs it",
            "A_REFUSED": "the refusal is the finding and it has a name",
            "RESIDUAL": "required; fits neither",
        },
        "branch_counts": dict(branches),
        "rows": rows,
        "no_pnl": "No PnL, realized outcome, winner/loser label or clean-edge result is read.",
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(artifact, indent=2, sort_keys=True))
    print(f"\nBRANCHES {dict(branches)}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
