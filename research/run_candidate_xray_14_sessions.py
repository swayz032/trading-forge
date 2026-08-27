#!/usr/bin/env python3
"""Run the candidate X-ray across the 14 frozen sessions — ALGO-009 §4.

Answers the question the score cannot: what shared permission is the machine granting that
the trader's brain does not? Compares the nine false-positive cases against the five AGREE
cases and all seven trader-entry cases, by EARLIEST SEMANTIC GATE.

DIAGNOSTIC ONLY. No production behaviour, no bullet consumption, no PnL.

Run: PYTHONPATH=. python -m research.run_candidate_xray_14_sessions
"""
from __future__ import annotations

import hashlib
import io
import json
import time
from collections import Counter
from datetime import date
from pathlib import Path

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import (
    LEGAL_ROUTES,
    summarise,
    xray_session,
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_candidate_xray_census_2026_08_21.json")


def main() -> None:
    t0 = time.perf_counter()
    sc = json.load(io.open(SCORECARD, encoding="utf-8"))
    by_session = {c["session"]: c for c in sc["cases"]}

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text()))
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    env = old.prepare(raw5, raw1)
    p = v24.Params()

    sessions = []
    for sess in sorted(by_session):
        t = time.perf_counter()
        xr = xray_session(env, date.fromisoformat(sess), p)
        s = summarise(xr)
        case = by_session[sess]
        s["trader_state"] = case["trader_state"]
        s["bot_state"] = case["bot_state"]
        s["mismatch_class"] = case["mismatch_class"]
        s["seconds"] = round(time.perf_counter() - t, 2)
        sessions.append(s)
        print(f"  {sess}  {case['mismatch_class']:38} "
              f"evals={s['total_candidate_evaluations']:5}  {s['seconds']}s")

    # ---- the comparison ALGO-009 §4 actually asks for --------------------------------
    agree = [s for s in sessions if s["mismatch_class"] == "AGREE"]
    false_pos = [s for s in sessions if s["mismatch_class"].startswith(
        ("BOT_ONLY_ENTRY", "EARLIER_OPPOSITE"))]

    def pooled(rows, key):
        c: Counter = Counter()
        for s in rows:
            c.update(s[key])
        return dict(sorted(c.items()))

    out = {
        "artifact": "CANDIDATE_XRAY_CENSUS_14_SESSIONS",
        "authority": "ALGO-009 §4",
        "status": "DIAGNOSTIC_ONLY_NO_PRODUCTION_BEHAVIOUR",
        "produced": "2026-08-21",
        "scorecard_sha256": hashlib.sha256(io.open(SCORECARD, "rb").read()).hexdigest(),
        "legal_routes": list(LEGAL_ROUTES),
        "pnl_used": False,
        "totals": {
            "sessions": len(sessions),
            "candidate_evaluations": sum(s["total_candidate_evaluations"] for s in sessions),
            "runtime_seconds": round(time.perf_counter() - t0, 2),
        },
        "comparison": {
            "agree_sessions": {
                "count": len(agree),
                "earliest_gate_census": pooled(agree, "earliest_gate_census"),
                "surviving_by_route": pooled(agree, "surviving_by_route"),
            },
            "false_positive_sessions": {
                "count": len(false_pos),
                "earliest_gate_census": pooled(false_pos, "earliest_gate_census"),
                "surviving_by_route": pooled(false_pos, "surviving_by_route"),
            },
        },
        "sessions": sessions,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"\nwrote {OUT}")
    print(f"  total candidate evaluations : {out['totals']['candidate_evaluations']}")
    print(f"  AGREE sessions surviving    : {out['comparison']['agree_sessions']['surviving_by_route']}")
    print(f"  FALSE-POS surviving         : {out['comparison']['false_positive_sessions']['surviving_by_route']}")
    print(f"  runtime                     : {out['totals']['runtime_seconds']}s")


if __name__ == "__main__":
    # ALGO-057 4.1: ONE WRITER PER ARTIFACT, and the lock covers the whole RUN. Two processes
    # each computing for twenty minutes and then writing the same file is the incident; a
    # guard at the write instant would have let both do the work and still collide.
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        main()
