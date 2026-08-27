"""Capture in-window grant attempts for ALL FOURTEEN sessions, keyed for membership.

The ALGO-070 guard is now the MEMBERSHIP form: every new in-window grant attempt must be listed
with clock+key and pass (i)-(v). A count is no longer the test, so the capture has to be at
grant level and across the whole corpus, not just the sessions whose counter moved.

Run in an arena at the pre-repair pin and at the current head; the diff is the membership.
"""
import io
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")

out_path = sys.argv[1] if len(sys.argv) > 1 else "grants_all14.json"

man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                  old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
p = v24.Params()

out = {}
total = 0
for session in sorted(man):
    lo = pd.Timestamp(man[session]["replay_start"])
    hi = pd.Timestamp(man[session]["replay_end"])
    recs = xray_session(env, date.fromisoformat(session), p)["records"]
    rows = []
    for r in recs:
        if r.get("outcome") != "SURVIVED_TO_RANKING":
            continue
        c = r.get("clock")
        if not c or not (lo <= pd.Timestamp(c) <= hi):
            continue
        rows.append({
            "key": [r.get("bucket"), r.get("clock"), r.get("direction"),
                    r.get("location_id"), r.get("route")],
            "location_band": [r.get("location_lo"), r.get("location_hi")],
            "location_source": r.get("location_source"),
            "form": r.get("form"),
            "reason": r.get("reason"),
            "variant": r.get("variant"),
        })
    out[session] = rows
    total += len(rows)
    print(f"  {session}: {len(rows)} in-window grant attempts")

io.open(out_path, "w", encoding="utf-8").write(json.dumps(out, indent=2))
print(f"TOTAL in-window grant attempts across 14 sessions: {total}")
print(f"wrote {out_path}")
