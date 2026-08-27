#!/usr/bin/env python3
"""WHERE EACH LOST ANCHOR MEMBER ACTUALLY DIES. DIAGNOSTIC ONLY - repairs nothing.

Re-exam #2 came back 1/8 with the same four members lost - {03-24, 03-30, 03-31, 04-06} - even
though R1 and R1b were both ratified and both demonstrably changed candidate-level behaviour.
That combination is only possible if the thing R1/R1b fixed is not the thing the exam measures,
so this module stops arguing and traces every lost session through the ACTUAL approval pipeline
the exam uses.

THE PRE-REGISTERED EXPECTATION SAID "03-30 JOINS BY MEMBERSHIP". IT DID NOT, AND THE REASON
MATTERS MORE THAN THE MISS. I reported 03-30 as "recovered to GRANTED" after R1. That was true
of the ENTRY-AUTHORITY STORY at candidate ranking. The exam counts FULLY-APPROVED ENTRIES, and
between those two objects sit two more gates:

    iter_actionable_candidates   ->   one_minute_entry   ->   build_and_classify
    (entry authority: R1/R1b)         (1m fill exists)       (target/reward policy)

"SURVIVED_TO_RANKING" is the first arrow only. Reporting it as a recovery of the case was
measuring the neighbouring object, and the exam is what convicted it.

THE ARM'S TRADING WINDOW IS LOAD-BEARING AND THE FIRST RUN OF THIS MODULE OMITTED IT. Run
outside the context, 03-24 showed five APPROVED entries at 08:17-08:34 - candidates the 09:30
arm cannot see at all - and attributing a loss from those rows would have described a pipeline
the exam never ran. That is the second time in this packet the same class of error appeared, so
both arms are traced and the arm is named in every row.

WHAT THIS EMITS. Per arm, per session: the actionable candidates, which of the three stages each
reaches, and the exact refusal string at the stage that kills it. No verdict is inferred from a
count - the refusal literal is published verbatim so the attribution can be checked, not
believed. 04-14 is the POSITIVE CONTROL: without a session that survives all three stages,
"everything dies at the target gate" is indistinguishable from "the trace is broken".

NO PnL, outcome, or agreement rate is read.
"""
from __future__ import annotations

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

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Attributes each lost anchor member to the stage that refuses it."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
OUT = Path("research/current_mnq_strategy_v2_4_exam2_loss_attribution_2026_08_23.json")

SESSIONS = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", "2026-04-14")
CONTROL = "2026-04-14"
ARMS = (("baseline_0930", W.BASELINE_ARM_START), ("taught_0800", _time(8, 0)))

STAGE_ENTRY_AUTHORITY = "1_ENTRY_AUTHORITY_iter_actionable_candidates"
STAGE_FILL = "2_FILL_one_minute_entry"
STAGE_TARGET = "3_TARGET_POLICY_build_and_classify"


def _trace_session(env, p, dte, start, end):
    cands = []
    for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
        rec = {
            "direction": str(cand.direction),
            "setup": str(cand.setup),
            "signal_time": str(cand.signal_time),
            "confirmed_time": str(cand.confirmed_time),
            "reason": str(cand.reason),
            "reached_stage": STAGE_ENTRY_AUTHORITY,
            "killed_at": None,
            "refusal": None,
        }
        ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
        if ent is None:
            rec["killed_at"] = STAGE_FILL
            rec["refusal"] = "ONE_MINUTE_ENTRY_RETURNED_NONE"
            cands.append(rec)
            continue
        entry_time, entry, _raw = ent
        rec["reached_stage"] = STAGE_FILL
        rec["entry_time"] = str(entry_time)
        rec["entry_price"] = float(entry)
        rec["entry_is_in_replay_window"] = bool(start <= entry_time <= end)
        if entry_time > end or entry_time.time() > eng.core.LAST_ENTRY:
            rec["killed_at"] = STAGE_FILL
            rec["refusal"] = "ENTRY_TIME_PAST_WINDOW_OR_LAST_ENTRY"
            cands.append(rec)
            continue
        picked, path_reason = build_and_classify(
            env["piv5"], env["full5"], env["h15"], entry_time, p,
            env["pdm"], env["pwm"], dte, float(entry), cand.direction, cand.setup,
            cand.setup == "BRK5", piv15=env["piv15"],
            entry_location=cand.location, candidate_reason=cand.reason)
        rec["reached_stage"] = STAGE_TARGET
        if picked is None:
            rec["killed_at"] = STAGE_TARGET
            rec["refusal"] = str(path_reason)
        else:
            rec["FULLY_APPROVED"] = True
        cands.append(rec)
    return cands


def main() -> int:
    t0 = time.perf_counter()
    manifest = {c["session"]: c for c in json.load(open(MANIFEST, encoding="utf-8"))["cases"]}
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    for arm_name, arm_start in ARMS:
        with W.trading_window(arm_start):
            env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                              old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
            p = eng.Params()
            for session in SESSIONS:
                dte = date.fromisoformat(session)
                start = pd.Timestamp(manifest[session]["replay_start"])
                end = pd.Timestamp(manifest[session]["replay_end"])
                cands = _trace_session(env, p, dte, start, end)

                approved = [c for c in cands if c.get("FULLY_APPROVED")]
                # The one-trade budget means ONLY the session's FIRST approved entry can
                # execute. An approval that lands before the replay window therefore spends
                # the bullet and makes every later in-window entry unreachable - which is a
                # different loss from "nothing was ever approved".
                first_approved = approved[0] if approved else None
                spent_before_window = bool(
                    first_approved is not None
                    and pd.Timestamp(first_approved["entry_time"]) < start)

                killers = {}
                for c in cands:
                    if c["killed_at"]:
                        killers.setdefault(c["killed_at"], []).append(c["refusal"])

                if not cands:
                    attribution = "NO_ACTIONABLE_CANDIDATE"
                elif first_approved is None:
                    attribution = sorted(killers)[0] if killers else "UNCLASSIFIED"
                elif spent_before_window:
                    attribution = "BULLET_SPENT_BEFORE_WINDOW"
                else:
                    attribution = "APPROVED_IN_WINDOW"

                rows.append({
                    "arm": arm_name,
                    "session": session,
                    "is_positive_control": session == CONTROL,
                    "replay_window": [str(start), str(end)],
                    "actionable_candidates_through_window_end": len(cands),
                    "fully_approved_entries": len(approved),
                    "first_approved_entry_time": (
                        first_approved["entry_time"] if first_approved else None),
                    "bullet_spent_before_window": spent_before_window,
                    "candidates": cands,
                    "killed_by_stage": {k: sorted(set(v)) for k, v in killers.items()},
                    "attribution": attribution,
                })

    ctrl = [r for r in rows if r["session"] == CONTROL]
    out = {
        "artifact": "EXAM2_LOSS_ATTRIBUTION",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-074 (2), re-exam #2 follow-through",
        "produced": "2026-08-23",
        "pipeline": [STAGE_ENTRY_AUTHORITY, STAGE_FILL, STAGE_TARGET],
        "arms_traced": [a for a, _ in ARMS],
        "positive_control_session": CONTROL,
        "positive_control_reached_approval_in_every_arm": all(
            r["fully_approved_entries"] > 0 for r in ctrl),
        "rows": rows,
        "attribution_summary": {
            a: {r["session"]: r["attribution"] for r in rows if r["arm"] == a}
            for a, _ in ARMS},
        "why_R1_and_R1b_could_not_move_the_headline": (
            "R1 and R1b act on stage 1. A session whose loss is decided at stage 3, or by the "
            "one-bullet budget being spent before the window opens, is untouched by any amount "
            "of entry-authority repair - its candidate-level recovery is real but invisible to "
            "the exam. 'SURVIVED_TO_RANKING' and 'fully-approved in-window entry' are different "
            "objects and I reported the first as if it were the second."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== WHERE EACH LOST ANCHOR MEMBER DIES (per arm) ===")
    for arm, _ in ARMS:
        print(f"\n########## arm {arm} ##########")
        for r in [x for x in rows if x["arm"] == arm]:
            tag = "  [CONTROL]" if r["is_positive_control"] else ""
            print(f"\n{r['session']}{tag}  cands={r['actionable_candidates_through_window_end']}"
                  f"  approved={r['fully_approved_entries']}  -> {r['attribution']}")
            print(f"   window {r['replay_window'][0][11:19]}..{r['replay_window'][1][11:19]}"
                  f"   first approved: {r['first_approved_entry_time']}")
            for c in r["candidates"]:
                mark = "APPROVED" if c.get("FULLY_APPROVED") else f"killed@{c['killed_at'][:1]}"
                print(f"     dir={c['direction']} {c['setup']} "
                      f"confirmed={c['confirmed_time'][11:19]} {mark}")
                if c.get("refusal"):
                    print(f"        {c['refusal']}")
    print(f"\ncontrol approved in every arm: "
          f"{out['positive_control_reached_approval_in_every_arm']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
