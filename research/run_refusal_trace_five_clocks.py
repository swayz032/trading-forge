#!/usr/bin/env python3
"""STEP 1 - THE REFUSAL TRACE AT HIS FIVE CLOCKS. Fast report, lands nothing.

ALGO-094 order 1. Refusal-only predicates are retired as a repair class; the open problem is
WHY NO CANDIDATE EXISTS AT HIS CLOCK. This traces that directly: at each of his five entry
clocks, for every route family asked, the FIRST refusing predicate, its executable line, and its
provenance - TAUGHT (with the citation) or UNTAUGHT MAGNITUDE (named, with its value).

The 04-14 control is carried with its SURVIVING path, so the trace shows both what refuses on
the failing days and what passes on the one that works.

PROVENANCE IS THE POINT. A refusal resting on a taught structure is the machine being faithful.
A refusal resting on an untaught magnitude is a number somebody chose. Those need opposite
responses, and the trace separates them per route rather than per session.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import time
from collections import Counter
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Refusal trace at his five clocks. Lands nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_refusal_trace_five_clocks_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"
SUBJECTS = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")

#: Refusal literal -> (executable site, provenance, detail). UNTAUGHT names the magnitude and
#: its value so the reader can see exactly which number is doing the refusing.
PROVENANCE = {
    "TOUCH_WITHOUT_DIRECTIONAL_CONTROL": (
        "derivation.py:160 `_control` - body_frac >= 0.62 AND close_loc >= 0.78",
        "UNTAUGHT_MAGNITUDE",
        "body_frac=0.62 and close_loc=0.78 are Params defaults with zero citations in any spec, "
        "transcript or video-evidence doc. THIS IS THE GATE R2 RETIRES: his rejection is "
        "binary - a wick into the band and a close back without breaking the level."),
    "MERE_APPROACH_WITHOUT_TOUCH": (
        "derivation.py `derive_approach` - the band was never reached",
        "TAUGHT",
        "no touch, no interaction: structural, no magnitude decides it"),
    "TOUCHED_BUT_NO_RECOGNISED_INTERACTION": (
        "derivation.py `classify_interaction` - none of the six named forms matched",
        "TAUGHT_SHAPE_UNTAUGHT_GATES",
        "the six forms are taught, but several of their branches call _control and the wick "
        "fractions, so an untaught magnitude can be what actually refused"),
    "INSUFFICIENT_PRIOR_BARS": (
        "derivation.py - fewer than `lookback` completed bars", "TAUGHT",
        "structural"),
    "NORMAL_BREAKOUT_TRIGGER_MUST_BE_THE_BAR_FOLLOWING_THE_FIRST_PRINT": (
        "breakout_derivation.py:158 `normal_breakout`", "TAUGHT",
        "ALGO-009 7.6/7.7 - 'the FOLLOWING forming 5m'; bar ordering, no magnitude"),
    "BREAK_NOT_ACCEPTED_BEFORE_RETEST": (
        "breakout_derivation.py:195 `break_retest`", "UNTAUGHT_MAGNITUDE",
        "acceptance_bars=3; the spec says DURABLE and names no count (UNFROZEN_CHOICES)"),
    "DISPLACEMENT_THIRD_CANDLE_REVERSED_CONTROL": (
        "breakout_derivation.py:232 `prebreak_displacement`", "TAUGHT",
        "ALGO-009 7.9 - a third candle that reverses control kills the sequence"),
    "REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST": (
        "breakout_derivation.py:261 `prebreak_repeat_test`", "TAUGHT_SHAPE_UNTAUGHT_GATE",
        "7.10 is structural, but the prior test must clear reject_wick=0.35 - an untaught "
        "Params default"),
    "REPEAT_TEST_WITHOUT_A_MEANINGFUL_RESET": (
        "breakout_derivation.py `prebreak_repeat_test`", "TAUGHT", "7.11 structural"),
    "REPEAT_TEST_WITHOUT_A_TRUE_RETURN_ATTACK": (
        "breakout_derivation.py `prebreak_repeat_test`", "TAUGHT_SHAPE_UNTAUGHT_GATE",
        "7.12 structural, but the trigger must clear _momentum(body_frac, close_loc)"),
    "FORCE_NOT_CONFIRMED": (
        "force.py:123 `force_snapshot` - efficiency >= Params.body_frac",
        "UNTAUGHT_MAGNITUDE",
        "body_frac=0.62 gates PATH EFFICIENCY here, in the FORCE module. This is the SAME "
        "untaught number R2 retires from Route A's story gate - but at a DIFFERENT SITE that "
        "R2 does not touch. On 03-23 and 04-09 this is what kills every Route A candidate at "
        "his clock, before the story gate is ever reached."),
    "REJECTION_STORY_INCOMPLETE": (
        "derivation.py `classify_interaction` via the authority decision",
        "TAUGHT_SHAPE_UNTAUGHT_GATES",
        "the six forms are taught; several branches call _control(body_frac, close_loc)"),
    "NO_COMPLETED_PRINT_BEYOND_THE_ZONE": (
        "breakout_derivation.py `normal_breakout` / `break_retest`", "TAUGHT",
        "no completed close beyond the band: structural, no magnitude"),
    "ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT": (
        "breakout_derivation.py `is_true_displacement`", "TAUGHT_SHAPE_UNTAUGHT_GATE",
        "ALGO-009 7.8 is taught, but the test calls range_ratio and body_frac"),
    "NO_VALID_RETEST_OF_THE_BROKEN_LEVEL": (
        "breakout_derivation.py `break_retest`", "TAUGHT",
        "return-to-the-level is taught; band overlap only, no threshold of its own"),
}


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def main() -> int:
    t0 = time.perf_counter()
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        for session in SUBJECTS + (CONTROL,):
            lab = labels[session]
            his = pd.Timestamp(lab["first_entry_time"])
            bucket = his.floor("5min")
            direction = "L" if lab["final_action"] == "ENTER_LONG" else "S"
            recs = xray_session(env, date.fromisoformat(session), p)["records"]
            at = [r for r in recs
                  if r.get("bucket") is not None
                  and pd.Timestamp(r["bucket"]) == bucket
                  and r.get("direction") == direction]
            survived = [r for r in at if r.get("outcome") == "SURVIVED_TO_RANKING"]

            # FIRST refusing predicate per route.
            #
            # ROUTE A'S REFUSAL IS NOT IN `route_refusals`. That field only ever carries the
            # BREAK family; Route A records its refusal in `killed_at` and `authority_refusal`.
            # Reading only `route_refusals` made Route A look as though it were never asked at
            # all - on every session including the control - which was wrong, and would have
            # sent a repair at a route the trace claimed did not run.
            per_route = {}
            for r in at:
                route = str(r.get("route") or "")
                if route.startswith("A_"):
                    lit = str(r.get("authority_refusal") or r.get("killed_at") or "UNKNOWN")
                    per_route.setdefault(route, Counter())[lit] += 1
                for br, refusal in (r.get("route_refusals") or {}).items():
                    per_route.setdefault(str(br), Counter())[str(refusal)] += 1
            routes = {}
            for route, counter in per_route.items():
                top, n = counter.most_common(1)[0]
                site, prov, detail = PROVENANCE.get(
                    top, ("(unmapped)", "UNMAPPED", "refusal literal not in the table"))
                routes[route] = {
                    "first_refusing_predicate": top, "count": n,
                    "executable_site": site, "provenance": prov, "detail": detail,
                    "all_refusals": dict(counter),
                }

            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "his_clock": str(his),
                "bucket": str(bucket),
                "direction": direction,
                "candidates_at_his_bucket": len(at),
                "survived_to_ranking": len(survived),
                "surviving_path": ([{"route": s.get("route"), "reason": s.get("reason"),
                                     "location_id": s.get("location_id")}
                                    for s in survived[:3]] if survived else None),
                "routes": routes,
                "rejection_family_asked": any(k.startswith("A_") for k in routes),
                "break_family_asked": any(k.startswith(("B_", "C_", "D_")) for k in routes),
            })

    untaught = []
    for r in rows:
        for route, d in r["routes"].items():
            if d["provenance"].startswith("UNTAUGHT"):
                untaught.append({"session": r["session"], "route": route,
                                 "predicate": d["first_refusing_predicate"],
                                 "detail": d["detail"]})

    out = {
        "artifact": "REFUSAL_TRACE_FIVE_CLOCKS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-094 order 1",
        "produced": "2026-08-24",
        "rows": rows,
        "untaught_magnitude_refusals": untaught,
        "untaught_count": len(untaught),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== REFUSAL TRACE AT HIS FIVE CLOCKS ===")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        print(f"\n{r['session']}{tag}  {r['his_clock'][11:16]} {r['direction']}  "
              f"candidates={r['candidates_at_his_bucket']}  survived={r['survived_to_ranking']}")
        if r["surviving_path"]:
            for s in r["surviving_path"]:
                print(f"   SURVIVES: {s['route']}  {s['reason']}")
        for route, d in sorted(r["routes"].items()):
            print(f"   {route:<28} {d['first_refusing_predicate']}  [{d['provenance']}]")
    print(f"\nrefusals resting on an UNTAUGHT magnitude: {len(untaught)}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
