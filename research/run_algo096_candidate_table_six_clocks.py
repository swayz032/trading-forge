#!/usr/bin/env python3
"""ALGO-096 §5 guard, second artifact: the §4 candidate table re-run at his SIX clocks.

Reports, per session, what happens at HIS bucket: the candidate population, every survivor to
ranking WITH ITS KEY (route + location_id + direction + clock), and — per ALGO-096 §6.2 — the
**deepest gate any candidate reached, carried with that candidate's key**. Never the majority
literal: on 04-06 a single `_control` refusal sat behind 44 no-touch records and the modal
literal hid it, which is the error ALGO-096 was written to end.

The gate ranking is DECLARED, and any `killed_at` token not in the declaration is reported as
UNRANKED with its count rather than silently bucketed. That is ALGO-097's lesson applied to my
own instrument: the previous trace reported a whole route family as `UNMAPPED` and then
excluded it from its own headline count.

DIAGNOSTIC. Lands nothing, repairs nothing, proposes nothing.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import sys
import time
from collections import Counter
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Candidate table at his six clocks. Lands nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")

CONTROL = "2026-04-14"
SUBJECTS = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")

#: How far a candidate got, in the X-RAY'S OWN loop order. This is an EVALUATION order, not a
#: causal one (ALGO-096 §6's law) — the X-ray asks FORCE before location and before the story,
#: which is exactly why "never reached the story gate" was a false reading. Named here so the
#: reader can see which order is being reported.
GATE_DEPTH = {
    "FORCE_NOT_CONFIRMED": 0,
    "NO_AUTHORIZED_LOCATION_ON_THIS_SIDE": 1,
    "REJECTION_STORY_INCOMPLETE": 2,
    "NO_LEGAL_ROUTE_MATCHED": 2,
    "INTRA_15M_FORCE_NOT_CONFIRMED": 2,
    "WEAK_BREAK_PENDING_WINDOW_EXPIRED": 2,
    "DECISION_CLOCK_PAST_LAST_ENTRY": 2,
    "STRUCTURAL_PRIOR_VETO": 3,
    "LOST_RANKING_TO_ANOTHER_CANDIDATE": 4,
    "BOTH_DIRECTIONS_PERMITTED_KERNEL_YIELDS_NOTHING": 4,
}
SURVIVED_DEPTH = 5


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _key(r: dict) -> str:
    return "|".join([
        str(r.get("route") or "?"),
        str(r.get("direction") or "?"),
        str(r.get("location_id") or "-"),
        str(r.get("clock") or "?"),
    ])


def main() -> int:
    t0 = time.perf_counter()
    out_path = Path(sys.argv[1] if len(sys.argv) > 1
                    else "algo096_candidate_table_six_clocks.json")
    arm = sys.argv[2] if len(sys.argv) > 2 else "08:00"
    arm_t = _time(*(int(x) for x in arm.split(":")))

    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    unranked_global = Counter()
    with W.trading_window(arm_t):
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

            survivors = [r for r in at if r.get("outcome") == "SURVIVED_TO_RANKING"]

            # DEEPEST GATE **BY KEY** — §6.2. Every candidate carries its own key so a single
            # deep refusal cannot be hidden behind a crowd of shallow ones.
            deepest = None
            unranked = Counter()
            per_key_depth: dict[str, int] = {}
            for r in at:
                if r.get("outcome") == "SURVIVED_TO_RANKING":
                    d = SURVIVED_DEPTH
                else:
                    tok = str(r.get("killed_at") or "")
                    if tok not in GATE_DEPTH:
                        unranked[tok] += 1
                        unranked_global[tok] += 1
                        continue
                    d = GATE_DEPTH[tok]
                k = _key(r)
                per_key_depth[k] = max(per_key_depth.get(k, -1), d)
                if deepest is None or d > deepest[0]:
                    deepest = (d, r)

            deepest_row = None
            if deepest is not None:
                d, r = deepest
                deepest_row = {
                    "depth": d,
                    "gate": ("SURVIVED_TO_RANKING" if d == SURVIVED_DEPTH
                             else str(r.get("killed_at"))),
                    "key": _key(r),
                    "route": r.get("route"),
                    "location_id": r.get("location_id"),
                    "location_band": [r.get("location_lo"), r.get("location_hi")],
                    "authority_state": r.get("authority_state"),
                    "authority_refusal": r.get("authority_refusal"),
                    "reason": r.get("reason"),
                }

            # FULL histogram beside it, so the table never replaces the population with a
            # single row (the mirror error of reporting only the majority).
            hist = Counter(
                "SURVIVED_TO_RANKING" if r.get("outcome") == "SURVIVED_TO_RANKING"
                else str(r.get("killed_at") or "?") for r in at)

            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "his_clock": str(his),
                "bucket": str(bucket),
                "direction": direction,
                "candidates_at_his_bucket": len(at),
                "survivors_to_ranking": len(survivors),
                "survivor_keys": [{
                    "key": _key(s), "route": s.get("route"),
                    "location_id": s.get("location_id"),
                    "location_band": [s.get("location_lo"), s.get("location_hi")],
                    "clock": s.get("clock"), "reason": s.get("reason"),
                } for s in survivors],
                "deepest_gate_reached_BY_KEY": deepest_row,
                "distinct_keys_at_his_bucket": len(per_key_depth),
                "gate_histogram": dict(hist),
                "unranked_kill_tokens": dict(unranked),
            })

    out = {
        "artifact": "ALGO096_CANDIDATE_TABLE_SIX_CLOCKS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-096 §5 guard (second artifact) + §6.2 instrument law",
        "arm_pin": arm,
        "gate_depth_declared": GATE_DEPTH,
        "survived_depth": SURVIVED_DEPTH,
        "rows": rows,
        "unranked_kill_tokens_across_all_sessions": dict(unranked_global),
        "unranked_note": (
            "Any killed_at token absent from the declared ranking is counted here and NOT "
            "bucketed into a neighbouring depth. A silently-bucketed token is how a whole "
            "route family came back UNMAPPED and was then dropped from a headline count "
            "(ALGO-097 §5/§6)."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== CANDIDATE TABLE AT HIS SIX CLOCKS  (arm pin " + arm + ") ===")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        print("\n" + r["session"] + tag + "  " + r["his_clock"][11:16] + " " + r["direction"]
              + "  candidates=" + str(r["candidates_at_his_bucket"])
              + "  distinct_keys=" + str(r["distinct_keys_at_his_bucket"])
              + "  survivors=" + str(r["survivors_to_ranking"]))
        for s in r["survivor_keys"]:
            print("    SURVIVES: " + str(s["key"]) + "  " + str(s["reason"]))
        d = r["deepest_gate_reached_BY_KEY"]
        if d:
            print("    deepest BY KEY: depth " + str(d["depth"]) + "  " + str(d["gate"])
                  + "  @ " + str(d["key"]))
            if d.get("authority_refusal"):
                print("        authority_refusal: " + str(d["authority_refusal"]))
        if r["unranked_kill_tokens"]:
            print("    UNRANKED tokens: " + json.dumps(r["unranked_kill_tokens"]))
    if unranked_global:
        print("\nUNRANKED kill tokens across all sessions: "
              + json.dumps(dict(unranked_global)))
    print("\nwrote " + str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
