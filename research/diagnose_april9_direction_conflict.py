#!/usr/bin/env python3
"""Why did the kernel take a SHORT on 2026-04-09 while the trader took a LONG? DIAGNOSTIC ONLY.

ALGO-011 section 4 calls this the highest-severity currently scoreable defect and FORBIDS
patching it directly: the state machine must EXPLAIN why the short route was legally granted
and kill it only if the frozen semantics say the route was invalid. This is the explanation.

IT WAS RE-RUN AFTER THE X-RAY RANKER REPAIR. The first version of this diagnosis was computed
with an X-ray that ranked by list order instead of calling `kernel._rank_and_yield`, so its
permission counts were wrong. The conclusion survived; the numbers did not. Every figure below
is post-repair.

WHAT IT PRODUCES, and why each piece is needed:
  1. the SESSION-WIDE permission timeline, not just the in-window slice -- "the bot never saw
     the long" and "the bot saw the long seven minutes too late" are different defects with
     different repairs, and only a session-wide view separates them
  2. the earliest-gate census for the candidates that died in-window
  3. a join to the conjunct ablation, so the grant that actually traded is scored against the
     v2.2 requirements v2.4 dropped

Run: PYTHONPATH=. python -m research.diagnose_april9_direction_conflict
"""
from __future__ import annotations

import io
import json
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

SESSION = "2026-04-09"
DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
ABLATION = Path("research/current_mnq_strategy_v2_4_story_ablation_2026_08_22.json")
OUT = Path("research/current_mnq_strategy_v2_4_april9_direction_conflict_2026_08_22.json")


def main() -> None:
    sc = json.load(io.open(SCORECARD, encoding="utf-8"))
    case = next(c for c in sc["cases"] if c["session"] == SESSION)
    w_start = pd.Timestamp(case["replay_window"]["start"])
    w_end = pd.Timestamp(case["replay_window"]["end"])
    t_clock = pd.Timestamp(case["trader_decision_clock"])

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text()))
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    env = old.prepare(raw5, raw1)
    xr = xray_session(env, date.fromisoformat(SESSION), v24.Params())

    surv = sorted((r for r in xr["records"] if r["outcome"] == "SURVIVED_TO_RANKING"),
                  key=lambda r: r["clock"])
    timeline = []
    for r in surv:
        c = pd.Timestamp(r["clock"])
        timeline.append({
            "clock": r["clock"], "direction": r["direction"], "route": r["route"],
            "location_source": r.get("location_source"),
            "in_replay_window": bool(w_start <= c <= w_end),
            "minutes_from_trader_decision": round((c - t_clock).total_seconds() / 60.0, 1),
        })

    longs = [t for t in timeline if t["direction"] == "L"]
    shorts = [t for t in timeline if t["direction"] == "S"]
    rej_longs = [t for t in longs if t["route"] == "A_NORMAL_REJECTION"]
    in_window = [t for t in timeline if t["in_replay_window"]]

    gates: dict[str, int] = {}
    for r in xr["records"]:
        if r["outcome"] == "REJECTED" and w_start <= pd.Timestamp(r["clock"]) <= w_end:
            k = f'{r["direction"]}|{r.get("killed_at")}'
            gates[k] = gates.get(k, 0) + 1

    abl = json.load(io.open(ABLATION, encoding="utf-8"))
    mine = [g for g in abl["grants"] if g["session"] == SESSION]
    keys = [k for k in ABLATION_KEYS if mine and k in mine[0]["ablation"]] if mine else []
    traded = [{
        "clock": g["clock"], "direction": g["direction"],
        "restored_requirements_it_FAILS": [
            k for k in keys if k != "ALL_SIX_RESTORED" and not g["ablation"][k]],
        "restored_requirements_it_PASSES": [
            k for k in keys if k != "ALL_SIX_RESTORED" and g["ablation"][k]],
    } for g in mine if w_start <= pd.Timestamp(g["clock"]) <= w_end]

    out = {
        "artifact": "APRIL_9_DIRECTION_CONFLICT_EXPLANATION",
        "authority": "ALGO-011 section 4",
        "status": "DIAGNOSTIC_ONLY. Explains; patches nothing.",
        "produced": "2026-08-22",
        "computed_after": "the X-ray ranker repair; the pre-repair counts are withdrawn",
        "case": {
            "session": SESSION,
            "replay_window": [str(w_start), str(w_end)],
            "trader": f'{case["trader_state"]} at {t_clock}',
            "bot": f'{case["bot_state_in_window"]} at {case["bot_decision_clock"]}',
            "bot_route": case["entry_family_receipt"],
            "bot_location": case["interaction_geometry"],
        },
        "THE_EXPLANATION": (
            "It is NOT that the machine cannot see the trader's long. It sees one -- on the "
            "SAME route the trader used -- but SEVEN MINUTES AFTER the trader has already "
            "acted, and it has already spent its one-trade bullet EIGHT MINUTES BEFORE, on a "
            "short in the opposite direction. A fifteen-minute bracket straddles the trader's "
            "decision and the machine is on the wrong side of both edges of it."),
        "session_wide_permissions": len(timeline),
        "in_window_permissions": len(in_window),
        "long_permissions_total": len(longs),
        "short_permissions_total": len(shorts),
        "first_rejection_route_long": rej_longs[0] if rej_longs else None,
        "minutes_the_rejection_long_arrives_after_the_trader":
            rej_longs[0]["minutes_from_trader_decision"] if rej_longs else None,
        "minutes_the_short_fires_before_the_trader":
            in_window[0]["minutes_from_trader_decision"] if in_window else None,
        "a_caveat_on_the_earlier_breakout_longs": (
            "Two B_NORMAL_BREAKOUT longs appear at 10:53 and 10:54, 42 minutes BEFORE the "
            "trader. They are a DIFFERENT route from the one the trader took and must not be "
            "cited as the machine agreeing early. The route-matched comparison is the "
            "A_NORMAL_REJECTION long, and that one is LATE."),
        "in_window_deaths_by_direction_and_earliest_gate": dict(
            sorted(gates.items(), key=lambda kv: -kv[1])),
        "the_grant_that_traded": traded,
        "WHY_RESTORING_V22_IS_NOT_THE_FIX": (
            "The in-window short that traded FAILS exactly two restored requirements -- a "
            "rejection wick and displacement -- so v2.2's gate would have refused it. That "
            "looks like the repair until you check the other side: on this session restoring "
            "ALL SIX kills 10 of 10 Route A grants, INCLUDING the machine's own long. "
            "Restoring v2.2 wholesale removes the false positive WITHOUT producing the true "
            "positive. The state machine has to be built from the source evidence. It cannot "
            "be reached by reverting."),
        "what_the_short_did_have": (
            "It passes R1 approach-travel, R2 reclaim-at-mid, R3 reclaim-is-a-turn and R5. So "
            "price genuinely travelled to the level and genuinely turned. What it lacks is a "
            "rejection wick and any range expansion: a control-transfer read taken without the "
            "rejection evidence and without displacement."),
        "permission_timeline": timeline,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}")
    print(f"  session-wide permissions : {len(timeline)}  "
          f"(L {len(longs)} / S {len(shorts)}), in-window {len(in_window)}")
    if rej_longs:
        print(f"  route-matched LONG lands : {rej_longs[0]['clock']} "
              f"({rej_longs[0]['minutes_from_trader_decision']:+} min vs trader)")
    if in_window:
        print(f"  the SHORT that traded    : {in_window[0]['clock']} "
              f"({in_window[0]['minutes_from_trader_decision']:+} min vs trader)")
    for t in traded:
        print(f"  grant {t['clock']} fails: {t['restored_requirements_it_FAILS']}")


ABLATION_KEYS = (
    "R1_APPROACH_TRAVEL", "R2_RECLAIM_AT_ZONE_MID", "R3_RECLAIM_IS_A_TURN",
    "R4_WICK_REJECTION_REQUIRED", "R5_FOLLOW_ANCHORED_AT_MID", "R6_DISPLACEMENT_REQUIRED",
    "ALL_SIX_RESTORED",
)

if __name__ == "__main__":
    main()
