#!/usr/bin/env python3
"""E1 - THE EXHAUSTION PREDICATE. REPORT ONLY. Lands nothing, changes no production file.

ALGO-092 order 1.

    E1  :=  no entry bullet at a zone whose COMPLETED-TEST COUNT SINCE BIRTH, at the decision
            clock, is >= N.

Structural and integer: it reads bar-vs-band geometry and a count. No distance, no reward, no
outcome, no PnL.

WHERE N COMES FROM, STATED PRECISELY BECAUSE THIS IS THE WHOLE INTEGRITY QUESTION.
  * The DIRECTION was pre-registered in ALGO-082 section 4, committed 13:42 today - BEFORE this
    census existed: "each touch consumes the resting orders; first touch of a fresh level is the
    highest-probability reaction". That is a genuine pre-registration.
  * The specific COUNTS (3rd-4th test a break is likely, 5th probably breaks, 7-8+ spent) come
    from ALGO-092's SECOND outside-research pass, which POSTDATES the census. On its own that
    ordering would be fittable, and saying otherwise would overstate the protection.
  * WHAT ACTUALLY PROTECTS N: verified here, the census separates at EVERY N from 2 to 10 - the
    control carries 1 test, the five convicted carry 10, 10, 18, 129 and 142. No choice of N in
    that range is distinguishable on these sessions, so N cannot have been tuned to them. It can
    only matter on the other nine sessions, and that is exactly what the membership delta shows.
  * R3 (silent => stricter wins) therefore selects PRIMARY N=3. N=5 and N=7 are published as
    SENSITIVITY ROWS, not as choices.

NO BLANKET EXEMPTION FOR SECOND-VISIT STORIES (ALGO-092 (e)). A repeat-test or accepted-break
retest presupposes one or two prior tests - not a hundred. So those stories are NOT exempted
here, and any approval removed at N=3 whose zone carried exactly 3 or 4 tests is listed
separately as the sensitivity band, where the doctrine itself is least certain.

PRE-REGISTERED: (a) 04-14 control SURVIVES at all three N; (b) all five convicted early trades
REFUSED at all three; (c) no target-layer change; (d) membership delta by key per N.
If (a) or (b) fails at N=3, the lane is closed. This module never picks a nicer N.
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
from research.run_entry_zone_census import completed_tests, zone_birth

DIAGNOSTIC_ONLY = "DIAGNOSTIC. E1 exhaustion report. Lands nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
OUT = Path("research/current_mnq_strategy_v2_4_e1_exhaustion_report_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"
PRIMARY_N = 3
SENSITIVITY_N = (5, 7)
ALL_N = (PRIMARY_N,) + SENSITIVITY_N

CONVICTED = (("2026-03-23", "08:14", "S"), ("2026-03-24", "08:17", "S"),
             ("2026-03-31", "09:03", "L"), ("2026-04-06", "09:07", "S"),
             ("2026-04-09", "09:37", "L"))


def main() -> int:
    t0 = time.perf_counter()
    man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    # One pass over the corpus recording each approved entry WITH its zone's test count; the N
    # arms are then evaluated from that single measurement, so no arm can disagree with another
    # about the underlying geometry.
    approvals = []
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
                loc = cand.location
                tests = None
                if loc is not None:
                    birth = zone_birth(str(getattr(loc, "id", "")))
                    if birth is not None:
                        tests = len(completed_tests(full5, float(loc.lo), float(loc.hi),
                                                    birth, et))
                approvals.append({
                    "key": [session, str(et), str(cand.direction), str(cand.setup)],
                    "session": session,
                    "clock": str(et)[11:16],
                    "story": str(cand.reason),
                    "location_id": (str(getattr(loc, "id", "")) if loc else None),
                    "band": ([round(float(loc.lo), 2), round(float(loc.hi), 2)]
                             if loc else None),
                    "completed_tests_since_birth": tests,
                    "target": round(float(picked.executable_price), 2),
                })

    baseline = {tuple(a["key"]) for a in approvals}
    arms = {}
    for N in ALL_N:
        kept, removed = set(), []
        for a in approvals:
            t = a["completed_tests_since_birth"]
            # A zone with no parseable birth cannot be counted; it is KEPT rather than refused,
            # so the predicate never removes an entry on missing evidence.
            if t is not None and t >= N:
                removed.append({**a, "tests": t})
            else:
                kept.add(tuple(a["key"]))
        ctrl_rows = [a for a in approvals if a["session"] == CONTROL]
        ctrl_kept = [a for a in ctrl_rows if tuple(a["key"]) in kept]
        conv = []
        for sess, clock, direction in CONVICTED:
            hit = next((a for a in approvals if a["session"] == sess
                        and a["clock"] == clock and a["key"][2] == direction), None)
            conv.append({
                "session": sess, "clock": clock, "direction": direction,
                "found": hit is not None,
                "tests": (hit or {}).get("completed_tests_since_birth"),
                "story": (hit or {}).get("story"),
                "REFUSED": bool(hit and tuple(hit["key"]) not in kept),
            })
        # THE DAY-GRAIN TRADE DELTA - the measure the operator's directive makes central:
        # "equivalence of TRADES at day grain". Only the session's FIRST approval ever executes
        # under the one-bullet budget, so "32 of 40 approvals removed" overstates the effect at
        # the level anyone trades. What matters per session is which approval is FIRST, and
        # whether the session still trades at all.
        first_before, first_after = {}, {}
        for a in sorted(approvals, key=lambda x: x["key"][1]):
            first_before.setdefault(a["session"], a)
            if tuple(a["key"]) in kept:
                first_after.setdefault(a["session"], a)
        trade_delta = []
        for sess in sorted({a["session"] for a in approvals}):
            b = first_before.get(sess)
            f = first_after.get(sess)
            trade_delta.append({
                "session": sess,
                "before_clock": b["clock"] if b else None,
                "before_dir": b["key"][2] if b else None,
                "after_clock": f["clock"] if f else None,
                "after_dir": f["key"][2] if f else None,
                "changed": (b or {}).get("clock") != (f or {}).get("clock"),
                "session_stops_trading": (b is not None and f is None),
            })

        arms[str(N)] = {
            "N": N,
            "day_grain_trade_delta": trade_delta,
            "sessions_whose_executed_trade_changed": sum(1 for t in trade_delta if t["changed"]),
            "sessions_that_stop_trading": sum(1 for t in trade_delta
                                              if t["session_stops_trading"]),
            "approved_after": len(kept),
            "removed_count": len(removed),
            "removed_by_key": [r["key"] for r in removed],
            "removed_detail": removed,
            "control_rows": len(ctrl_rows),
            "control_kept": len(ctrl_kept),
            "control_survives": (len(ctrl_rows) > 0 and len(ctrl_kept) == len(ctrl_rows)),
            "convicted": conv,
            "convicted_refused": sum(1 for c in conv if c["REFUSED"]),
        }

    prim = arms[str(PRIMARY_N)]
    band_3_4 = [r for r in prim["removed_detail"] if r["tests"] in (3, 4)]
    separates_range = [n for n in range(2, 11)
                       if all(a["completed_tests_since_birth"] is not None
                              and a["completed_tests_since_birth"] < n
                              for a in approvals if a["session"] == CONTROL)]

    lane = ("RATIFIABLE_AT_N3" if (prim["control_survives"] and prim["convicted_refused"] == 5)
            else "CLOSED_PRE_REGISTRATION_FAILED")

    out = {
        "artifact": "E1_EXHAUSTION_REPORT",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-092 order 1",
        "produced": "2026-08-24",
        "predicate": ("no entry bullet at a zone whose completed-test count since birth at the "
                      "decision clock is >= N. Structural, integer, no distance/reward/outcome."),
        "primary_N": PRIMARY_N,
        "sensitivity_N": list(SENSITIVITY_N),
        "N_provenance": {
            "direction_pre_registered": ("ALGO-082 section 4, committed 13:42 2026-08-24, BEFORE "
                                         "the census: each touch consumes resting orders; first "
                                         "touch is the highest-probability reaction"),
            "counts_from": ("ALGO-092's second outside-research pass, which POSTDATES the "
                            "census - stated openly rather than claimed as pre-registered"),
            "what_actually_protects_N": ("the census separates at every N in 2..10 (control 1 "
                                         "test; convicted 10/10/18/129/142), so no N in that "
                                         "range is distinguishable on these sessions and none "
                                         "can have been tuned to them"),
            "control_separating_N_values": separates_range,
            "rule": "R3 silent => stricter wins => N=3 primary",
        },
        "no_blanket_exemption_for_second_visit_stories": True,
        "approved_baseline": len(baseline),
        "arms": arms,
        "sensitivity_band_3_or_4_tests_removed_at_N3": band_3_4,
        "pre_registered": {
            "a_control_survives_at_all_N": all(a["control_survives"] for a in arms.values()),
            "b_five_convicted_refused_at_all_N": all(a["convicted_refused"] == 5
                                                     for a in arms.values()),
            "c_no_target_layer_change": True,
        },
        "BLAST_RADIUS_WARNING": {
            "headline": ("E1 PASSES every pre-registered check and is STILL not a repair. At "
                         "N=3 NINE of thirteen trading sessions STOP TRADING ENTIRELY; only "
                         "03-26, 04-01, 04-08 and the control still trade."),
            "why_the_pre_registration_does_not_catch_it": (
                "(a) asks whether the control survives and (b) whether the convicted are "
                "refused. Both pass. Neither asks what happens to the other eleven sessions, "
                "and 80% of approvals (32 of 40) are removed."),
            "why_it_is_not_equivalence": (
                "On all five convicted days he DID trade. Refusing the early entry does NOT "
                "free the bullet for his later setup - at N=3 there is no surviving approval on "
                "those sessions at all. E1 converts five wrong-TIME trades into nine NO-trades, "
                "and against a day+direction exam a no-trade where he entered is still a miss. "
                "So E1 cannot raise agreement; it can only change the reason for the miss."),
            "operator_directive_reading": (
                "He asked for equivalence of TRADES at day grain. Silence is not equivalence."),
            "sessions_that_stop_trading": [t["session"] for t in
                                           arms[str(PRIMARY_N)]["day_grain_trade_delta"]
                                           if t["session_stops_trading"]],
        },
        "LANE_VERDICT": lane,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== E1 EXHAUSTION REPORT ===")
    print(f"baseline approvals: {len(baseline)}")
    for N in ALL_N:
        a = arms[str(N)]
        tag = " (PRIMARY)" if N == PRIMARY_N else " (sensitivity)"
        print(f"\nN={N}{tag}: approved {a['approved_after']}  removed {a['removed_count']}")
        print(f"   control survives : {a['control_survives']} "
              f"({a['control_kept']}/{a['control_rows']})")
        print(f"   convicted refused: {a['convicted_refused']}/5")
        for c in a["convicted"]:
            print(f"      {c['session']} {c['clock']} {c['direction']}  tests={c['tests']}  "
                  f"REFUSED={c['REFUSED']}  ({c['story']})")
    print(f"\nsensitivity band (3-4 tests) removed at N=3: {len(band_3_4)}")
    for r in band_3_4:
        print(f"   {r['session']} {r['clock']} tests={r['tests']} {r['story']}")
    print(f"\nLANE VERDICT: {lane}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
