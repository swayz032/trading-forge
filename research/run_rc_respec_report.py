#!/usr/bin/env python3
"""R-C RE-SPEC: freshness counted from the DEFINING REJECTION FORWARD. REPORT ONLY.

ALGO-090 order 1. R-C-as-specified was rejected because counting freshness from a zone's BIRTH
spends the zone with its own defining rejection candle - the touch that CREATES significance was
also the touch that consumed it, inverting the first-touch teaching R-C cites. The corrected
predicate moves the anchor:

    FRESH  :=  no completed bar has tested the band between the zone's DEFINING REJECTION
               (the candle that draws it under his ratified [wick extreme, close] rule) and the
               decision clock.

PRE-REGISTERED BY ALGO-090, before this ran:
  * the 04-14 control SURVIVES, or the freshness lane is CLOSED as unexpressible
  * honest ceiling is 1 of 5 convicted (04-06) - the other four are exempt by taught stories
  * no target-layer change

WHAT THE CENSUS ALREADY SHOWS, and why this report is short. The corrected predicate needs a
DEFINING REJECTION to anchor on. Measured over the machine's own entry locations, four of seven
zones - INCLUDING THE CONTROL - have NO completed 5m/15m candle whose [wick extreme, close]
reproduces their band. The machine builds narrow bands from swing displacement and wick-zone
geometry that his construction simply does not draw. Where there is no definer, the corrected
predicate is not strict or lenient: IT IS UNDEFINED.

So this report does not tune an anchor. It measures how many zones can carry the predicate at
all, and lets the pre-registered rule decide the lane.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import time
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import build_and_classify
from research.run_entry_zone_census import (
    defining_rejection, completed_tests, zone_birth, DRAW_TIMEFRAMES, DRAW_TOL_POINTS)

DIAGNOSTIC_ONLY = "DIAGNOSTIC. R-C re-spec report. Lands nothing, changes no production file."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
OUT = Path("research/current_mnq_strategy_v2_4_rc_respec_report_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"

RC_TAUGHT_EXCEPTIONS = ("ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE",
                        "PREBREAK_REPEAT_TEST_INTRA5_FORCE")


def main() -> int:
    t0 = time.perf_counter()
    man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    baseline_keys, respec_keys = set(), set()
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        full5 = env["full5"]
        for session in sorted(man):
            dte = date.fromisoformat(session)
            end = pd.Timestamp(man[session]["replay_end"])
            for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
                ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
                if ent is None:
                    continue
                et, epx, _ = ent
                if et > end or et.time() > eng.core.LAST_ENTRY:
                    continue
                picked, _pr = build_and_classify(
                    env["piv5"], full5, env["h15"], et, p, env["pdm"], env["pwm"], dte,
                    float(epx), cand.direction, cand.setup, cand.setup == "BRK5",
                    piv15=env["piv15"], entry_location=cand.location,
                    candidate_reason=cand.reason)
                if picked is None:
                    continue
                key = (session, str(et), str(cand.direction), str(cand.setup))
                baseline_keys.add(key)
                reason = str(cand.reason)
                loc = cand.location
                if reason in RC_TAUGHT_EXCEPTIONS or loc is None:
                    respec_keys.add(key)
                    rows.append({"key": list(key), "session": session, "story": reason,
                                 "disposition": "EXEMPT_TAUGHT_STORY"})
                    continue
                lo, hi = float(loc.lo), float(loc.hi)
                birth = zone_birth(str(getattr(loc, "id", "")))
                definer = defining_rejection(full5, lo, hi, et, not_before=birth)
                if definer is None:
                    respec_keys.add(key)
                    rows.append({
                        "key": list(key), "session": session, "story": reason,
                        "band": [round(lo, 2), round(hi, 2)],
                        "disposition": "UNDEFINED_NO_DEFINING_REJECTION",
                        "note": ("his [wick extreme, close] rule draws no 5m/15m candle "
                                 "reproducing this band, so the corrected predicate has no "
                                 "anchor - it is neither strict nor lenient here"),
                    })
                    continue
                after = pd.Timestamp(definer["bucket"]) + pd.Timedelta(
                    minutes=int(definer["timeframe"][:-1]))
                tests = completed_tests(full5, lo, hi, after, et)
                fresh = not tests
                if fresh:
                    respec_keys.add(key)
                rows.append({
                    "key": list(key), "session": session, "story": reason,
                    "band": [round(lo, 2), round(hi, 2)],
                    "defining_rejection": definer,
                    "completed_tests_after_definer": len(tests),
                    "evidence": tests[:3],
                    "disposition": "FRESH_KEPT" if fresh else "REFUSED_NOT_FRESH",
                })

    undefined = [r for r in rows if r["disposition"] == "UNDEFINED_NO_DEFINING_REJECTION"]
    refused = [r for r in rows if r["disposition"] == "REFUSED_NOT_FRESH"]
    ctrl = [r for r in rows if r["session"] == CONTROL]
    ctrl_survives = all(r["disposition"] != "REFUSED_NOT_FRESH" for r in ctrl) and bool(ctrl)
    ctrl_undefined = any(r["disposition"] == "UNDEFINED_NO_DEFINING_REJECTION" for r in ctrl)

    lane = ("CLOSED_AS_UNEXPRESSIBLE" if ctrl_undefined else
            "SURVIVES_CONTROL" if ctrl_survives else "CLOSED_CONTROL_KILLED")

    out = {
        "artifact": "RC_RESPEC_REPORT",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-090 order 1",
        "produced": "2026-08-24",
        "predicate": ("FRESH := no completed bar tested the band between the zone's DEFINING "
                      "REJECTION (his [wick extreme, close] rule) and the decision clock"),
        "draw_rule": {"timeframes": [f"{t}m" for t in DRAW_TIMEFRAMES],
                      "tolerance_points": DRAW_TOL_POINTS},
        "approved_baseline": len(baseline_keys),
        "approved_with_respec": len(respec_keys),
        "entries_REMOVED": sorted(list(k) for k in (baseline_keys - respec_keys)),
        "rows": rows,
        "counts": {
            "undefined_no_definer": len(undefined),
            "refused_not_fresh": len(refused),
            "exempt_taught": sum(1 for r in rows
                                 if r["disposition"] == "EXEMPT_TAUGHT_STORY"),
        },
        "control_rows": ctrl,
        "control_has_no_definer": ctrl_undefined,
        "control_survives": ctrl_survives,
        "LANE_VERDICT": lane,
        "why": ("The corrected predicate needs a defining rejection to anchor on. Where the "
                "machine's entry band is not reproducible by any completed 5m/15m "
                "[wick extreme, close] candle, the predicate is UNDEFINED - and that includes "
                "the control. A rule that cannot be evaluated on the one day the machine agrees "
                "cannot be the rule that separates the days it does not."),
        "no_target_layer_change": True,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== R-C RE-SPEC REPORT (freshness from the defining rejection forward) ===")
    print(f"approved: baseline {len(baseline_keys)} -> re-spec {len(respec_keys)}  "
          f"removed {len(baseline_keys - respec_keys)}")
    print(f"dispositions: {out['counts']}")
    print(f"\ncontrol rows ({CONTROL}):")
    for r in ctrl:
        print(f"   {r['key'][1][11:16]}  {r['story']}  -> {r['disposition']}")
    print(f"\ncontrol has no definer: {ctrl_undefined}   control survives: {ctrl_survives}")
    print(f"LANE VERDICT: {lane}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
